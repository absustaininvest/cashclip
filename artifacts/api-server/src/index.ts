import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { storage } from "./storage";
import { RESERVED_ADMIN_USERNAMES } from "./auth";
import { isPayPalConfigured, isPayPalWebhookConfigured } from "./paypal";
import { loadPersistedIntegrationKeys } from "./lib/integrationKeyStore";
import { loadRuntimeSettings } from "./lib/runtimeSettings";
import { startWebhookAuditCleanupJob } from "./jobs/webhookAuditCleanup";
import { startSecurityAuditCleanupJob } from "./jobs/securityAuditCleanup";
import { startConversionRateJob } from "./jobs/conversionRateJob";
import { startAdmobAlertsJob } from "./jobs/admobAlertsJob";
import { startAdmobSyncJob } from "./jobs/admobSyncJob";
import { startDedupeCleanupJob } from "./jobs/dedupeCleanup";
import { startLoginAttemptsCleanupJob } from "./jobs/loginAttemptsCleanup";
import bcrypt from "bcryptjs";

loadPersistedIntegrationKeys();

// Per-account seed secrets — each admin account has its own independent secret
// so resetting one never affects the other.
const ADMIN_SEED_SECRETS: Record<string, string> = {
  "support@absustaininvest.com": "SEED_PASSWORD_SUPPORT",
  "support@cash-clip.app": "SEED_PASSWORD_CASHCLIP",
};

async function seedAdmins() {
  const forceReset = process.env["SEED_ADMIN_FORCE_RESET"] === "true";
  const nukeRecreate = process.env["SEED_ADMIN_NUKE_RECREATE"] === "true";

  for (const username of RESERVED_ADMIN_USERNAMES) {
    const secretKey = ADMIN_SEED_SECRETS[username];
    const seedPassword = secretKey ? process.env[secretKey] : undefined;

    if (!seedPassword) {
      logger.info({ username, secretKey }, "Seed secret not set — skipping account provisioning");
      continue;
    }

    const existing = await storage.getUserByUsername(username);
    if (existing && nukeRecreate) {
      await storage.deleteUser(existing.id);
      logger.warn({ username }, "Admin account DELETED via SEED_ADMIN_NUKE_RECREATE — recreating fresh");
      const hashed = await bcrypt.hash(seedPassword, 12);
      await storage.createUser({ username, password: hashed, role: "admin" });
      logger.warn({ username }, "Admin account recreated fresh — remove SEED_ADMIN_NUKE_RECREATE and rotate password after login");
    } else if (!existing) {
      const hashed = await bcrypt.hash(seedPassword, 12);
      await storage.createUser({ username, password: hashed, role: "admin" });
      logger.info({ username }, "Created admin account via seed — rotate this password immediately after first login");
    } else if (existing.role !== "admin") {
      logger.warn({ username }, "Reserved admin username exists but was NOT promoted — this account was publicly registered and is untrusted.");
    } else if (forceReset) {
      const hashed = await bcrypt.hash(seedPassword, 12);
      await storage.updateUserPassword(existing.id, hashed);
      logger.warn({ username }, "Admin password RESET via SEED_ADMIN_FORCE_RESET — remove that env var immediately and rotate password after login");
    } else {
      logger.info({ username }, "Admin account already exists, skipping seed");
    }
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Loud startup alarm for the silent PayPal-payout failure mode: credentials
  // are set (so payouts CAN go out) but PAYPAL_WEBHOOK_ID is missing, which
  // makes /api/paypal/webhook fail closed (401) on every PayPal status
  // callback. Withdrawals then stay stuck in "paying"/"pending" forever. This
  // surfaces it in the deployment logs immediately rather than after payouts
  // pile up. Operators can also see it in the admin Integration Hub.
  if (isPayPalConfigured() && !isPayPalWebhookConfigured()) {
    logger.error(
      { secret: "PAYPAL_WEBHOOK_ID" },
      "PayPal payouts are configured but PAYPAL_WEBHOOK_ID is NOT set — webhook signature verification is disabled, all PayPal status callbacks will be rejected (401), and withdrawals will stay stuck in 'paying'/'pending'. Set PAYPAL_WEBHOOK_ID in Production app secrets and re-publish the API.",
    );
  }

  seedAdmins().catch((e) => logger.error({ err: e }, "Admin seed failed"));
  loadRuntimeSettings().catch((e) => logger.error({ err: e }, "Runtime settings load failed"));
  startWebhookAuditCleanupJob();
  startSecurityAuditCleanupJob();
  startConversionRateJob();
  startAdmobSyncJob();
  startAdmobAlertsJob();
  startDedupeCleanupJob();
  startLoginAttemptsCleanupJob();
});

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
// The platform restarts the server by sending SIGTERM. Without a handler the
// process is killed mid-flight and the restart shows up in the deployment logs
// as an error exit ("signal: terminated"). Here we stop accepting new
// connections, let in-flight requests drain, then close the DB pool so a
// restart is a clean, expected shutdown instead of a crash.
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutdown signal received — draining connections");

  // Hard stop if drain hangs, so the platform's own kill timeout is never the
  // thing that ends us (which would still look like an error exit).
  const forceTimer = setTimeout(() => {
    logger.warn("Graceful shutdown timed out — forcing exit");
    process.exit(0);
  }, 10_000);
  forceTimer.unref();

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, "Error closing HTTP server during shutdown");
    }
    try {
      await pool.end();
      logger.info("Database pool closed — shutdown complete");
    } catch (e) {
      logger.error({ err: e }, "Error closing database pool during shutdown");
    } finally {
      clearTimeout(forceTimer);
      process.exit(0);
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
