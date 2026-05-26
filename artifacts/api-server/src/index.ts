import app from "./app";
import { logger } from "./lib/logger";
import { storage } from "./storage";
import { RESERVED_ADMIN_USERNAMES } from "./auth";
import { loadPersistedIntegrationKeys } from "./lib/integrationKeyStore";
import { startWebhookAuditCleanupJob } from "./jobs/webhookAuditCleanup";
import bcrypt from "bcryptjs";

loadPersistedIntegrationKeys();

// Per-account seed secrets — each admin account has its own independent secret
// so resetting one never affects the other.
const ADMIN_SEED_SECRETS: Record<string, string> = {
  "support@absustaininvest.com": "SEED_PASSWORD_SUPPORT",
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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  seedAdmins().catch((e) => logger.error({ err: e }, "Admin seed failed"));
  startWebhookAuditCleanupJob();
});
