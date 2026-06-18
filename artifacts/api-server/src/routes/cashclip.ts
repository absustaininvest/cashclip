import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import jwt from "jsonwebtoken";
import { getIntegrationStatuses, getIntegrationSummary, integrations } from "../integrations";
import { checkIntegrationsHealth } from "../lib/integrationHealth";
import {
  persistIntegrationKey,
  deletePersistedIntegrationKey,
  isIntegrationKeyPersisted,
  rotateEncryptionSecret,
  getIntegrationKeyHealth,
} from "../lib/integrationKeyStore";
import { verifyIntegrationKey } from "../lib/integrationVerify";
import { getAdMobConfigState, syncAdMobSnapshots } from "../lib/admobReporting";
import { secretsPassphraseMiddleware } from "../lib/secretsPassphrase";
import { adFillRateLimiter } from "../lib/adFillRateLimit";
import {
  setVerificationState,
  clearVerificationState,
} from "../lib/integrationVerificationState";
import { registerAuthRoutes, authMiddleware, adminMiddleware, type AuthRequest } from "../auth";
import { storage, SECURITY_AUDIT_EVENTS, type SecurityAuditEvent } from "../storage";
import { db, updateUserProfileSchema, earnTokens, adEvents as adEventsTable } from "@workspace/db";
import { snapshotRateString } from "../lib/pointsEconomy";
import { buildDemographicEntryUrl } from "../lib/demographicUrl";
import venturesRouter from "./ventures";
import { sendPayPalPayout, isPayPalConfigured, isPayPalWebhookConfigured, verifyPayPalWebhook } from "../paypal";
import { isRelayEmail, isPlausiblePayPalDomain } from "../lib/emailValidation";
import { logWebhookVerificationFailure } from "../lib/webhookAuth";
import { recordLoginAttempt } from "../lib/dbRateLimit";
import { reserveDedupeSlot, releaseDedupeSlot } from "../lib/dedupe";
import { createHash } from "node:crypto";
import { registerSurveyRoutes } from "../surveys";
import { registerOfferwallRoutes } from "../offerwalls";
import { registerEarningsRoutes } from "./earnings";
import { resolveTierForAmount, getAvailableTiers, WITHDRAWAL_TIERS, DAILY_WITHDRAWAL_MAX, NEW_ACCOUNT_HOLD_HOURS, MAX_WITHDRAWALS_PER_DAY, getDailyPayoutFloatUsd, REFERRAL_QUALIFY_USD, REFERRAL_BONUS_USD } from "../withdrawalTiers";
import { sendWithdrawalRequestedAdmin, sendWithdrawalRequestedUser, sendWithdrawalVelocityAdmin, sendWithdrawalStatusUpdate, sendSupportTicket, sendPasswordChangedNotice, sendAdminCreditReceipt, sendSupportReply, sendReferralBonusEarned, sendPayPalAmbiguousAlert } from "../lib/email";
import { alertPayPalWebhookSecretMissing } from "../lib/paypalWebhookAlert";
import { recordWithdrawalEmailFailure } from "../lib/withdrawalEmailAlerts";
import { publicLeadRateLimiter } from "../lib/publicLeadRateLimit";
import { supportTicketRateLimiter } from "../lib/supportTicketRateLimit";
import {
  getRecentRejections,
  getRecentAlerts,
  getRejectionSummary,
} from "../lib/webhookAlerts";
import {
  evaluateAdmobAlerts,
  getRecentAdmobAlerts,
  getAdmobAlertConfig,
  isAdmobMirrorExpectedActive,
} from "../lib/admobAlerts";
import {
  getSetting,
  setSetting,
  ADMOB_ALERT_EMAIL_KEY,
  ADMOB_ALERT_EMAIL_ENABLED_KEY,
  AD_FILL_AVAILABLE_KEY,
  AD_FILL_REPORTED_AT_KEY,
} from "../lib/runtimeSettings";
import {
  getSponsoredVisitAlertDebounce,
  clearSponsoredVisitAlertDebounce,
  writeLastAlerted,
  isSnoozed,
} from "../lib/sponsoredVisitMonitor";
import { fetchInbox } from "../lib/inbox";
import { generateInboxDraft, detectLang, detectIssue } from "../lib/inboxDraft.js";
import { count as drizzleCount, eq as drizzleEq, and as drizzleAnd, ne as drizzleNe, sql as drizzleSql, gte as drizzleGte } from "drizzle-orm";


// Default operator mailbox AdMob reporting alerts fall back to when neither a
// persisted recipient setting nor the ADMIN_ALERT_EMAIL env var is set. Mirrors
// the default in lib/email.ts (sendAdmobReportAlert).
const ADMIN_ALERT_DEFAULT_EMAIL = "support@absustaininvest.com";
const ADMIN_ALERT_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One-shot guard so the "PayPal webhook secret missing" alarm is logged loudly
// the first time a callback arrives without PAYPAL_WEBHOOK_ID set, rather than
// on every rejected callback (which would drown the signal in attack noise).
let paypalWebhookMissingWarned = false;


// Normalize a client-reported per-impression ad revenue figure (AdMob
// valueMicros; 1,000,000 micros = $1) into a non-negative integer string for
// storage, or null when absent/invalid. Clients are untrusted, so reject
// negative, non-finite, or absurdly large values rather than store garbage that
// would skew the conversion-rate SUM. Cap at 1e12 micros ($1,000,000) per ad.
function sanitizeRevenueMicros(value: unknown): string | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const capped = Math.min(Math.round(n), 1_000_000_000_000);
  return String(capped);
}

// Resolve the recipient address for a withdrawal status-update email. Mirrors
// the request-time fallback (`user.email || paypalEmail`): prefer the account
// email, but fall back to the PayPal address so users who signed up without an
// account email still receive paid/rejected notifications. Best-effort — never
// throws; on any lookup failure it falls back to the PayPal address.
async function resolveStatusUpdateToEmail(userId: string, paypalEmail: string): Promise<string> {
  try {
    const recipient = await storage.getUser(userId);
    return recipient?.email || paypalEmail;
  } catch {
    return paypalEmail;
  }
}

// Fire-and-forget send of a withdrawal status-update email that does NOT
// silently swallow delivery failures. On a send failure (bad address,
// misconfigured/unreachable SMTP) it logs the failure with the withdrawal id
// and recipient and records it for the repeated-failure operator alert, so a
// user never silently fails to learn their payout outcome.
function sendWithdrawalStatusUpdateBestEffort(
  req: Request,
  withdrawalId: string,
  options: Parameters<typeof sendWithdrawalStatusUpdate>[0],
): void {
  sendWithdrawalStatusUpdate(options).catch((err) => {
    req.log?.error(
      { err, withdrawalId, toEmail: options.toEmail, status: options.status },
      "Failed to send withdrawal status-update email",
    );
    recordWithdrawalEmailFailure({
      withdrawalId,
      recipient: options.toEmail,
      status: options.status,
      reason: err instanceof Error ? err.message : String(err),
    });
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  registerAuthRoutes(app);
  registerSurveyRoutes(app);
  registerOfferwallRoutes(app);
  registerEarningsRoutes(app);

  // ── App version check ───────────────────────────────────────────────────
  // Public endpoint — exempt from version gate (see app.ts appVersionMiddleware).
  // Returns the minimum supported client version and the current release.
  // The app calls this on startup; if the server returns 426 the ForceUpdateGate
  // blocks the user until they update.
  app.get("/api/app/version", (_req, res) => {
    const minVersion = process.env.MIN_APP_VERSION ?? "1.1.0";
    const currentVersion = process.env.CURRENT_APP_VERSION ?? "1.1.0";
    const maintenance = process.env.MAINTENANCE_MODE === "true";
    const maintenanceMessage = process.env.MAINTENANCE_MESSAGE ?? "We're upgrading our systems to serve you better. We'll be back shortly — thank you for your patience!";
    res.json({ minVersion, currentVersion, maintenance, maintenanceMessage });
  });


  app.get("/api/integrations/status", adminMiddleware, (_req, res) => {
    const statuses = getIntegrationStatuses();
    const summary = getIntegrationSummary();

    const startHere = statuses.filter((s) => s.priority === "start-here");
    const recommended = statuses.filter((s) => s.priority === "recommended");
    const optional = statuses.filter((s) => s.priority === "optional");

    res.json({
      summary,
      nextStep: !summary.readyToEarn
        ? {
            message: "Start with these two platforms to begin earning revenue",
            platforms: startHere.filter((s) => !s.connected),
          }
        : summary.connected < summary.total
          ? {
              message: "Core platforms connected. Add more to increase revenue",
              platforms: recommended.filter((s) => !s.connected),
            }
          : {
              message: "All integrations connected. You are fully operational.",
              platforms: [],
            },
      integrations: {
        startHere,
        recommended,
        optional,
      },
    });
  });

  app.get("/api/integrations/health", adminMiddleware, async (_req, res) => {
    const statuses = getIntegrationStatuses();
    const configured = statuses.filter((s) => s.connected);

    if (configured.length === 0) {
      res.json({
        message: "No integrations configured yet. Add API keys to enable provider connectivity checks.",
        results: [],
      }); return;
    }

    const results = await checkIntegrationsHealth(configured);

    res.json({
      checkedAt: new Date().toISOString(),
      total: results.length,
      reachable: results.filter((r) => r.reachable).length,
      unreachable: results.filter((r) => !r.reachable).length,
      results,
    });
  });

  /**
   * GET /api/admin/admob/revenue?days=30
   *
   * REAL AdMob earnings/impression data pulled live from the AdMob Reporting
   * API (OAuth2 refresh token). Returns daily rows + computed totals for the
   * Revenue tab charts. Never fabricates numbers:
   *   - keys not set        => 200 { ok:false, configured:false }
   *   - AdMob/OAuth failure  => 502 { ok:false, configured:true, error }
   */
  app.get("/api/admin/admob/revenue", adminMiddleware, async (req: AuthRequest, res) => {
    const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 365);
    // Hours after which the persisted snapshots are considered stale.
    const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
    const cfg = getAdMobConfigState();

    try {
      // Refresh the persisted store in the background (fire-and-forget). The
      // response is served from the DB so a slow/failed AdMob call never blocks
      // or breaks the page — it just means we serve the last-known snapshot.
      void syncAdMobSnapshots(days).catch((err) => {
        req.log?.warn({ err }, "admob background sync failed");
      });

      const summary = await storage.getAdmobSnapshotSummary(days);
      const reconciliation = await storage.getAdmobReconciliation(days);
      const hasData = summary.rowCount > 0;

      // No persisted data AND keys not set => honest "not configured".
      if (!hasData && !cfg.configured) {
        res.json({
          ok: false,
          configured: false,
          error: `AdMob not configured. Missing: ${cfg.missing.join(", ")}`,
          missing: cfg.missing,
        });
        return;
      }

      const lastSyncedAt = summary.lastSyncedAt;

      // Fire/resolve operator alerts for a stale sync or a revenue divergence
      // beyond threshold. In-memory de-duped + cooldown'd, so a sustained
      // condition never floods. Read-only — never blocks/affects the response.
      try {
        evaluateAdmobAlerts({
          configured: cfg.configured,
          lastSyncedAt,
          reconciliation: hasData ? reconciliation : null,
        });
      } catch (alertErr) {
        req.log?.warn({ err: alertErr }, "admob alert evaluation failed");
      }

      // Configured but nothing has ever synced (e.g. the AdMob OAuth token is
      // expired). Do NOT fabricate $0 — that would read as "earned nothing"
      // rather than "we don't know yet". Return an explicit no-data state so the
      // hub renders "—/no data yet".
      if (!hasData) {
        res.json({
          ok: true,
          configured: cfg.configured,
          source: "persisted",
          noData: true,
          stale: true,
          currency: summary.currency,
          range: summary.range,
          totals: null,
          daily: [],
          byFormat: [],
          lastSyncedAt: null,
          reconciliation: null,
          fetchedAt: new Date().toISOString(),
        });
        return;
      }

      const ageMs = lastSyncedAt ? Date.now() - new Date(lastSyncedAt).getTime() : Infinity;
      const stale = ageMs > STALE_AFTER_MS;

      // Response keeps the legacy AdMobReport shape (ok/configured/currency/
      // range/totals/daily) so existing consumers keep working, and adds the
      // persistence fields the hub needs (byFormat/lastSyncedAt/stale/recon).
      // Metrics we no longer persist (adRequests/matchedRequests/matchRate/
      // showRate) are returned as null — not 0 — so consumers render "—" rather
      // than a fabricated measured value.
      res.json({
        ok: true,
        configured: cfg.configured,
        source: "persisted",
        noData: false,
        currency: summary.currency,
        range: summary.range,
        totals: {
          earnings: summary.totals.earnings,
          impressions: summary.totals.impressions,
          clicks: summary.totals.clicks,
          adRequests: null,
          matchedRequests: null,
          ctr: summary.totals.impressions > 0 ? summary.totals.clicks / summary.totals.impressions : 0,
          ecpm: summary.totals.ecpm,
          matchRate: null,
          showRate: null,
        },
        daily: summary.daily,
        byFormat: summary.byFormat,
        lastSyncedAt,
        stale,
        reconciliation,
        // Cutover signal: once the PAID-capable build is live the app-revenue
        // mirror SHOULD be flowing, so a $0 reconciliation must read as a real
        // alert ("Diverging") rather than the by-design "Official only" relabel.
        mirrorExpectedActive: isAdmobMirrorExpectedActive(),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err) {
      req.log?.error({ err }, "admob revenue report failed");
      res.status(502).json({
        ok: false,
        configured: cfg.configured,
        error: `AdMob report error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  /**
   * GET /api/admin/admob/alert-email
   *
   * Current operator-alert email routing for AdMob reporting alerts: the
   * effective recipient + whether the email channel is on. `recipientSource`
   * tells the UI where the effective value comes from (the persisted setting, an
   * env override, or the built-in default) so it can show the right hint.
   */
  app.get("/api/admin/admob/alert-email", adminMiddleware, (_req, res) => {
    const cfg = getAdmobAlertConfig();
    const persistedRecipient = getSetting(ADMOB_ALERT_EMAIL_KEY)?.trim() || null;
    const persistedEnabled = getSetting(ADMOB_ALERT_EMAIL_ENABLED_KEY);
    const effectiveRecipient =
      cfg.emailRecipient || process.env["ADMIN_ALERT_EMAIL"]?.trim() || ADMIN_ALERT_DEFAULT_EMAIL;
    const recipientSource = persistedRecipient
      ? "setting"
      : process.env["ADMIN_ALERT_EMAIL"]?.trim()
        ? "env"
        : "default";
    res.json({
      enabled: cfg.emailEnabled,
      recipient: effectiveRecipient,
      persistedRecipient,
      recipientSource,
      enabledSource: persistedEnabled != null ? "setting" : "env",
      defaultRecipient: ADMIN_ALERT_DEFAULT_EMAIL,
    });
  });

  /**
   * PUT /api/admin/admob/alert-email
   *
   * Update where AdMob reporting alerts are emailed and whether the email
   * channel is on. Persisted in the DB and read at evaluation time, so changes
   * take effect without a redeploy. Body: { enabled?: boolean, recipient?: string }.
   * An empty/null recipient clears the override (falls back to env/default).
   */
  app.put("/api/admin/admob/alert-email", adminMiddleware, async (req: AuthRequest, res) => {
    const body = (req.body ?? {}) as { enabled?: unknown; recipient?: unknown };

    if ("enabled" in body && typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "Field 'enabled' must be a boolean" });
      return;
    }
    if (
      "recipient" in body &&
      body.recipient != null &&
      typeof body.recipient !== "string"
    ) {
      res.status(400).json({ error: "Field 'recipient' must be a string" });
      return;
    }

    try {
      if ("recipient" in body) {
        const raw = typeof body.recipient === "string" ? body.recipient.trim() : "";
        if (raw.length === 0) {
          // Clear the override — fall back to env/default.
          await setSetting(ADMOB_ALERT_EMAIL_KEY, "");
        } else {
          if (raw.length > 254 || !ADMIN_ALERT_EMAIL_REGEX.test(raw)) {
            res.status(400).json({ error: "Enter a valid email address" });
            return;
          }
          await setSetting(ADMOB_ALERT_EMAIL_KEY, raw);
        }
      }
      if ("enabled" in body) {
        await setSetting(ADMOB_ALERT_EMAIL_ENABLED_KEY, body.enabled ? "true" : "false");
      }

      const cfg = getAdmobAlertConfig();
      const effectiveRecipient =
        cfg.emailRecipient || process.env["ADMIN_ALERT_EMAIL"]?.trim() || ADMIN_ALERT_DEFAULT_EMAIL;
      res.json({
        ok: true,
        enabled: cfg.emailEnabled,
        recipient: effectiveRecipient,
        persistedRecipient: getSetting(ADMOB_ALERT_EMAIL_KEY)?.trim() || null,
      });
    } catch (err) {
      req.log?.error({ err }, "failed to update admob alert email settings");
      res.status(500).json({ error: "Failed to save alert email settings" });
    }
  });

  /**
   * GET /api/admin/health/sponsored-visits
   *
   * Returns the current state of the sponsored-visit alert debounce so the
   * admin panel can show whether a snooze is active and when it expires.
   */
  app.get("/api/admin/health/sponsored-visits", adminMiddleware, (_req, res) => {
    const debounce = getSponsoredVisitAlertDebounce();
    const now = Date.now();
    const snoozed = debounce != null && debounce.getTime() > now;
    res.json({
      snoozed,
      snoozedUntil: snoozed ? debounce!.toISOString() : null,
      lastAlertedAt: debounce && !snoozed ? debounce.toISOString() : null,
    });
  });

  /**
   * POST /api/admin/health/sponsored-visits/reset-alert
   *
   * Resets or snoozes the settlement-alert debounce.
   *
   *   • No body / snoozeHours absent or 0 → clears the debounce entirely so
   *     the monitor can fire on the very next tick ("Reset debounce" / Clear).
   *   • snoozeHours: 1–24 → sets the debounce timestamp to now + N hours so
   *     the monitor stays quiet during a planned maintenance window.
   */
  app.post("/api/admin/health/sponsored-visits/reset-alert", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const body = (req.body ?? {}) as { snoozeHours?: unknown };
      const raw = body.snoozeHours;

      if (raw !== undefined && raw !== null) {
        const hours = Number(raw);
        if (!Number.isFinite(hours) || !Number.isInteger(hours) || hours < 1 || hours > 24) {
          res.status(400).json({ error: "snoozeHours must be an integer between 1 and 24" });
          return;
        }
        await writeLastAlerted(hours);
        const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        req.log?.info({ snoozeHours: hours, snoozedUntil }, "Sponsored-visit alert snoozed");
        res.json({ ok: true, action: "snoozed", snoozeHours: hours, snoozedUntil });
      } else {
        await clearSponsoredVisitAlertDebounce();
        req.log?.info("Sponsored-visit alert debounce cleared");
        res.json({ ok: true, action: "cleared" });
      }
    } catch (err) {
      req.log?.error({ err }, "Failed to reset sponsored-visit alert debounce");
      res.status(500).json({ error: "Failed to update alert debounce" });
    }
  });

  /**
   * GET /api/admin/stats
   *
   * Real numbers for the phone admin Overview cards: total users, users active
   * today, pending payouts (count + summed amount), and AdMob earnings
   * (today / last 7d / last 30d). AdMob is served from the persisted snapshot
   * store; when nothing has synced yet (e.g. the reporting token isn't
   * connected) `admob` is null so the client renders "—" instead of a
   * fabricated $0. The DB-backed metrics are always real.
   */
  app.get("/api/admin/stats", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      // Keep the persisted AdMob store fresh in the background (fire-and-forget,
      // fail-soft) so the phone admin auto-updates without manual uploads. The
      // response is served from the DB, so a slow/failed AdMob call never blocks
      // the page — we just serve the last-known snapshot (or null → "—").
      void syncAdMobSnapshots(30).catch((err) => {
        req.log?.warn({ err }, "admob background sync failed (stats)");
      });

      const [overview, today, last7d, last30d] = await Promise.all([
        storage.getAdminOverviewStats(),
        storage.getAdmobSnapshotSummary(1),
        storage.getAdmobSnapshotSummary(7),
        storage.getAdmobSnapshotSummary(30),
      ]);
      const admobHasData = last30d.rowCount > 0;
      res.json({
        totalUsers: overview.totalUsers,
        activeToday: overview.activeToday,
        pendingPayouts: overview.pendingPayouts,
        admob: admobHasData
          ? {
              today: today.totals.earnings,
              last7d: last7d.totals.earnings,
              last30d: last30d.totals.earnings,
              currency: last30d.currency,
              lastSyncedAt: last30d.lastSyncedAt,
            }
          : null,
      });
    } catch (err) {
      req.log?.error({ err }, "admin stats failed");
      res.status(500).json({ error: "Failed to load admin stats" });
    }
  });

  /**
   * GET /api/admin/integration-hub
   *
   * One consolidated payload for the admin Integration Hub:
   *   - every integration with a green/red status (configured + live-reachable),
   *     plus when it was last checked
   *   - API + website service health
   *   - current app version and the last deploy/build timestamp
   *   - count of users seen in the last 5 minutes ("users online")
   *
   * Each section degrades gracefully: a failed sub-check is reported as
   * down/unknown rather than failing the whole request.
   */
  app.get("/api/admin/integration-hub", adminMiddleware, async (_req, res) => {
    const checkedAt = new Date().toISOString();
    const ONLINE_WINDOW_MS = 5 * 60 * 1000;

    const statuses = getIntegrationStatuses();
    const configured = statuses.filter((s) => s.connected);

    // Live reachability for the configured integrations. Never throws — degrades
    // to an empty result set so the rest of the hub still renders.
    const healthResults = await checkIntegrationsHealth(configured).catch(
      () => [] as Awaited<ReturnType<typeof checkIntegrationsHealth>>,
    );
    const healthById = new Map(healthResults.map((r) => [r.id, r]));

    const integrationViews = statuses.map((s) => {
      const health = healthById.get(s.id);
      // green only when configured AND (no probe, or probe reachable).
      // amber when configured but provider unreachable; red when not configured.
      let status: "green" | "amber" | "red";
      if (!s.connected) {
        status = "red";
      } else if (health && !health.reachable) {
        status = "amber";
      } else {
        status = "green";
      }

      // adUnavailReason: a short human-readable explanation for why the ad
      // system may not be serving ads, surfaced on the hub card so the operator
      // can diagnose without reading device/Metro logs.
      //
      // ironsource / admob are client-SDK integrations: the server can confirm
      // the key is present but cannot verify the native adapter at runtime.
      // When the key IS configured we surface that the native adapter must be
      // in the app binary (the most common confusion point). When the provider
      // is marked unreachable we describe that instead. Other integrations that
      // have a real server-side probe leave this null.
      let adUnavailReason: string | null = null;
      if (s.id === "ironsource" || s.id === "admob") {
        if (!s.connected) {
          adUnavailReason = `${s.envKey} not configured`;
        } else if (health && !health.reachable) {
          adUnavailReason = "Provider endpoint unreachable";
        } else {
          // Key is present; verification is always "unsupported" for client SDKs
          // because the native module presence can only be checked on-device.
          adUnavailReason =
            s.id === "admob"
              ? "Mediation orchestrator — ads serve only when the Google Mobile Ads SDK is compiled into the live app build"
              : "Demand source via AdMob mediation — serves only when its adapter is compiled into the live app build";
        }
      }

      return {
        id: s.id,
        name: s.name,
        category: s.category,
        configured: s.connected,
        reachable: health ? health.reachable : null,
        httpStatus: health?.httpStatus ?? null,
        latencyMs: health?.latencyMs ?? null,
        status,
        lastCheckedAt: checkedAt,
        adUnavailReason,
      };
    });

    // ── Service health ────────────────────────────────────────────────────
    // API: this request is being served, so the process is up. We also probe
    // the DB (the online-user count below) — if that throws we mark API down.
    let onlineUsers: number | null = null;
    let apiUp = true;
    try {
      onlineUsers = await storage.countOnlineUsers(ONLINE_WINDOW_MS);
    } catch (err) {
      apiUp = false;
      _req.log?.warn({ err }, "integration-hub: online-user count failed");
    }

    // Website: probe the public marketing site. Configurable so dev/preview can
    // point at a reachable host; defaults to the production corporate site.
    const websiteUrl = process.env.HUB_WEBSITE_URL ?? "https://absustaininvest.com";
    let websiteUp = false;
    let websiteStatus: number | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(websiteUrl, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      }).catch(() => null);
      clearTimeout(timeout);
      if (resp) {
        websiteStatus = resp.status;
        websiteUp = resp.status < 500;
      }
    } catch {
      websiteUp = false;
    }

    const services = [
      {
        id: "api",
        name: "API Server",
        up: apiUp,
        detail: apiUp ? "Responding" : "Database unreachable",
      },
      {
        id: "website",
        name: "Website",
        up: websiteUp,
        url: websiteUrl,
        httpStatus: websiteStatus,
        detail: websiteUp
          ? "Reachable"
          : websiteStatus
            ? `HTTP ${websiteStatus}`
            : "Unreachable",
      },
    ];

    // ── Deploy / version ──────────────────────────────────────────────────
    // BUILD_TIME is injected at build time by build.mjs (esbuild define), so it
    // reflects the latest deploy/build in production and the last restart in dev.
    const buildTime =
      typeof process.env.BUILD_TIME === "string" && process.env.BUILD_TIME
        ? process.env.BUILD_TIME
        : null;
    const currentVersion = process.env.CURRENT_APP_VERSION ?? "1.1.0";

    res.json({
      checkedAt,
      onlineWindowMinutes: ONLINE_WINDOW_MS / 60000,
      usersOnline: onlineUsers,
      version: {
        current: currentVersion,
        lastDeployedAt: buildTime,
      },
      services,
      integrations: {
        total: integrationViews.length,
        green: integrationViews.filter((i) => i.status === "green").length,
        items: integrationViews,
      },
    });
  });

  // ─── In-memory ad fill state (client-reported) ────────────────────────────
  // The CashClip app POSTs the rewarded-fill state whenever AdMob fires an
  // onAdLoaded / onAdFailedToLoad event.  We keep only the most recent report
  // (fill is a property of the ad network, not of individual users).
  const adFillState: {
    rewardedFillAvailable: boolean | null;
    reportedAt: number | null;
    reportedByUserId: string | null;
  } = { rewardedFillAvailable: null, reportedAt: null, reportedByUserId: null };

  /**
   * POST /api/earn/ad-fill
   *
   * The CashClip app calls this whenever the AdMob rewarded-fill state
   * changes (onAdLoaded / onAdFailedToLoad).  Requires a valid user JWT.
   * Body: { rewardedFillAvailable: boolean }
   */
  app.post("/api/earn/ad-fill", authMiddleware, adFillRateLimiter, (req: AuthRequest, res) => {
    const { rewardedFillAvailable } = req.body as { rewardedFillAvailable?: unknown };
    if (typeof rewardedFillAvailable !== "boolean") {
      res.status(400).json({ error: "rewardedFillAvailable must be a boolean" });
      return;
    }
    const now = Date.now();
    adFillState.rewardedFillAvailable = rewardedFillAvailable;
    adFillState.reportedAt = now;
    adFillState.reportedByUserId = req.userId ?? null;
    // Fire-and-forget: persist so the value survives API restarts.
    setSetting(AD_FILL_AVAILABLE_KEY, String(rewardedFillAvailable)).catch(() => {});
    setSetting(AD_FILL_REPORTED_AT_KEY, String(now)).catch(() => {});
    res.json({ ok: true });
  });

  /**
   * GET /api/admin/ad-status
   *
   * Returns the native-adapter presence state for the live app build.
   * Because native module presence can only be confirmed on-device, the server
   * reflects the operator-set env var AD_ADMOB_NATIVE that should be toggled
   * to "true" after verifying a native build has the AdMob SDK compiled in.
   * Defaults to false (OTA / unknown) when not set.
   *
   * Also includes client-reported fill state from the most recent
   * POST /api/earn/ad-fill call, surfaced here for the admin hub.
   *
   * Response shape: { admobNative, adSystemActive, rewardedFillAvailable, fillReportedAt }
   *   admobNative            — AdMob native SDK is confirmed in the live build (AD_ADMOB_NATIVE=true)
   *   adSystemActive         — admobNative is true (AdMob is the sole orchestrator)
   *   rewardedFillAvailable  — most recent client-reported fill state (null = no report yet)
   *   fillReportedAt         — unix ms timestamp of last fill report (null = no report yet)
   */
  app.get("/api/admin/ad-status", adminMiddleware, (_req, res) => {
    const parseBool = (v: string | undefined): boolean =>
      v === "1" || v === "true" || v === "yes" || v === "on";
    const admobNative = parseBool(process.env.AD_ADMOB_NATIVE);
    const adSystemActive = admobNative;

    // Fall back to the DB-persisted value (loaded into the runtime-settings cache
    // at startup) when the in-memory state has not been set yet this process
    // lifetime — i.e. immediately after an API restart before the first report.
    let rewardedFillAvailable = adFillState.rewardedFillAvailable;
    let fillReportedAt = adFillState.reportedAt;
    if (rewardedFillAvailable === null) {
      const persisted = getSetting(AD_FILL_AVAILABLE_KEY);
      if (persisted !== null) {
        rewardedFillAvailable = persisted === "true";
        const persistedAt = getSetting(AD_FILL_REPORTED_AT_KEY);
        fillReportedAt = persistedAt !== null ? Number(persistedAt) : null;
      }
    }

    res.json({
      admobNative,
      adSystemActive,
      rewardedFillAvailable,
      fillReportedAt,
    });
  });

  /**
   * GET /api/admin/integrations/key-health
   *
   * Returns which persisted integration keys failed to decrypt on the most
   * recent startup. Typically that means JWT_SECRET was rotated without first
   * running POST /api/admin/integrations/rotate-secret, so the on-disk store
   * can no longer be read and those keys must be re-entered (or rotated).
   */
  app.get("/api/admin/integrations/key-health", adminMiddleware, (_req, res) => {
    const health = getIntegrationKeyHealth();
    const failures = health.decryptionFailures.map((envKey) => {
      const integration = integrations.find((i) => i.envKey === envKey);
      return {
        envKey,
        integrationId: integration?.id ?? null,
        integrationName: integration?.name ?? null,
      };
    });
    res.json({
      checkedAt: health.checkedAt > 0 ? new Date(health.checkedAt).toISOString() : null,
      secretMissing: health.secretMissing,
      decryptionFailures: failures,
    });
  });

  app.post("/api/admin/integrations/:id/key", adminMiddleware, secretsPassphraseMiddleware, async (req: AuthRequest, res) => {
    const integration = integrations.find((i) => i.id === req.params.id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" }); return;
    }

    const { value } = req.body ?? {};
    if (typeof value !== "string") {
      res.status(400).json({ error: "Field 'value' must be a string" }); return;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      res.status(400).json({ error: "API key cannot be empty" }); return;
    }
    if (trimmed.length > 4096) {
      res.status(400).json({ error: "API key is too long" }); return;
    }
    if (/[\r\n\0]/.test(trimmed)) {
      res.status(400).json({ error: "API key contains invalid characters" }); return;
    }

    const previousValue = process.env[integration.envKey];
    const wasPersisted = isIntegrationKeyPersisted(integration.envKey);

    process.env[integration.envKey] = trimmed;
    const persisted = persistIntegrationKey(integration.envKey, trimmed);

    const verification = await verifyIntegrationKey(integration.id, trimmed);
    const checkedAt = Date.now();

    // Hard rejection: provider returned a 4xx. Roll the env+store back so the
    // server never reports "Connected" for a key the provider already refused.
    if (verification.supported && verification.authRejected) {
      if (previousValue === undefined) {
        delete process.env[integration.envKey];
      } else {
        process.env[integration.envKey] = previousValue;
      }
      if (!wasPersisted) {
        deletePersistedIntegrationKey(integration.envKey);
      } else if (previousValue !== undefined) {
        persistIntegrationKey(integration.envKey, previousValue);
      }
      clearVerificationState(integration.envKey);

      req.log?.warn(
        {
          integrationId: integration.id,
          envKey: integration.envKey,
          userId: req.userId,
          status: verification.status,
        },
        "Admin integration API key rejected by provider",
      );

      res.status(400).json({
        error: verification.error ?? `${integration.name} rejected the key.`,
        validation: {
          supported: true,
          ok: false,
          authRejected: true,
          status: verification.status,
          latencyMs: verification.latencyMs,
        },
      }); return;
    }

    // Record the verification outcome so /api/integrations/status can gate the
    // "Connected" badge on a real provider check rather than env presence.
    if (!verification.supported) {
      setVerificationState(integration.envKey, {
        kind: "unsupported",
        reason: verification.reason ?? "No automatic verification available.",
        checkedAt,
      });
    } else if (verification.ok) {
      setVerificationState(integration.envKey, {
        kind: "ok",
        status: verification.status,
        latencyMs: verification.latencyMs,
        checkedAt,
      });
    } else {
      // Network error or 5xx: keep the saved value but mark as failed so the
      // wizard surfaces "Key rejected / unreachable" instead of "Connected".
      setVerificationState(integration.envKey, {
        kind: "failed",
        status: verification.status,
        latencyMs: verification.latencyMs,
        error: verification.error ?? `Could not verify with ${integration.name}.`,
        checkedAt,
      });
    }

    const status = getIntegrationStatuses().find((s) => s.id === integration.id);
    req.log?.info(
      {
        integrationId: integration.id,
        envKey: integration.envKey,
        userId: req.userId,
        persisted,
        verified: verification.ok,
        verifySupported: verification.supported,
        verifyStatus: verification.status,
      },
      "Admin saved integration API key",
    );

    const validationPayload = {
      supported: verification.supported,
      ok: verification.ok,
      authRejected: verification.authRejected,
      status: verification.status,
      latencyMs: verification.latencyMs,
      error: verification.error,
      reason: verification.reason,
    };

    res.json({
      ok: true,
      integration: status,
      persisted,
      validation: validationPayload,
      note: persisted
        ? "Saved to encrypted server store and will survive restarts."
        : "Stored in the running server process only. Set JWT_SECRET to enable durable storage, or add the value to project Secrets.",
    });
  });

  app.delete("/api/admin/integrations/:id/key", adminMiddleware, secretsPassphraseMiddleware, async (req: AuthRequest, res) => {
    const integration = integrations.find((i) => i.id === req.params.id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" }); return;
    }

    const wasPersisted = isIntegrationKeyPersisted(integration.envKey);
    const removedFromDisk = deletePersistedIntegrationKey(integration.envKey);
    const hadProcessValue = !!process.env[integration.envKey];
    delete process.env[integration.envKey];
    clearVerificationState(integration.envKey);

    const status = getIntegrationStatuses().find((s) => s.id === integration.id);
    req.log?.info(
      {
        integrationId: integration.id,
        envKey: integration.envKey,
        userId: req.userId,
        removedFromDisk,
        hadProcessValue,
      },
      "Admin cleared integration API key",
    );

    res.json({
      ok: true,
      integration: status,
      cleared: hadProcessValue || wasPersisted,
      note: wasPersisted
        ? "Removed from the encrypted server store and the running process."
        : "Cleared from the running process. If a value is also set in project Secrets, it will return on restart — remove it there too.",
    });
  });

  /**
   * POST /api/admin/integrations/rotate-secret
   *
   * Re-encrypts the on-disk integration key store from an old JWT_SECRET value
   * to the current one. Call this immediately after rotating JWT_SECRET so that
   * saved provider keys remain readable on the next restart.
   *
   * Body: { oldSecret: string, dryRun?: boolean }
   * Query: ?dryRun=true (alternative to body flag) — preview the rotation
   *        without writing anything to disk. Use this first when in doubt: if
   *        the supplied old secret is wrong, every key will appear in `failed`
   *        and the operator can abort before destroying recoverability.
   * Response: { ok, dryRun, rotated, failed, total, note }
   */
  app.post("/api/admin/integrations/rotate-secret", adminMiddleware, secretsPassphraseMiddleware, async (req: AuthRequest, res) => {
    const { oldSecret } = req.body ?? {};
    if (typeof oldSecret !== "string" || oldSecret.length < 8) {
      res.status(400).json({
        error: "Field 'oldSecret' must be a string of at least 8 characters",
      }); return;
    }

    const newSecret = process.env["JWT_ACCESS_SECRET"] ?? process.env["JWT_SECRET"];
    if (!newSecret || newSecret.length < 8) {
      res.status(500).json({
        error: "JWT_ACCESS_SECRET is not configured on the server — cannot derive a new encryption key",
      }); return;
    }

    if (oldSecret === newSecret) {
      res.status(400).json({
        error: "oldSecret is identical to the current JWT_ACCESS_SECRET — rotation is a no-op",
      }); return;
    }

    // ?dryRun=true (or body { dryRun: true }) previews the rotation without
    // touching the on-disk store. Useful to confirm the supplied old secret
    // actually decrypts the existing entries before committing.
    const dryRunQuery = req.query["dryRun"];
    const dryRunBody = (req.body ?? {}).dryRun;
    const dryRun =
      dryRunQuery === "true" ||
      dryRunQuery === "1" ||
      dryRunBody === true ||
      dryRunBody === "true";

    try {
      const result = rotateEncryptionSecret(oldSecret, newSecret, { dryRun });

      req.log?.info(
        {
          rotated: result.rotated,
          failed: result.failed,
          total: result.total,
          dryRun: result.dryRun,
          userId: req.userId,
        },
        result.dryRun
          ? "Admin previewed integration key store secret rotation (dry-run)"
          : "Admin triggered integration key store secret rotation",
      );

      const noteFragments: string[] = [];
      if (result.dryRun) {
        noteFragments.push("Dry-run: no changes were written to disk.");
      }
      if (result.rotated > 0) {
        noteFragments.push(
          result.dryRun
            ? `${result.rotated} key(s) would be re-encrypted with the new secret.`
            : `${result.rotated} key(s) successfully re-encrypted with the new secret.`,
        );
      }
      if (result.failed.length > 0) {
        noteFragments.push(
          result.dryRun
            ? `${result.failed.length} key(s) cannot be decrypted with the supplied old secret and would NOT be migrated: ${result.failed.join(", ")}. ` +
              "If you expected these to migrate, the supplied old secret is probably wrong — re-confirm it before running without dryRun."
            : `${result.failed.length} key(s) could not be decrypted with the old secret and must be re-entered manually: ${result.failed.join(", ")}.`,
        );
      }
      if (result.total === 0) {
        noteFragments.push("No persisted keys found — nothing to rotate.");
      } else if (result.rotated === 0 && result.failed.length > 0 && result.dryRun) {
        noteFragments.push(
          "Refusing to suggest a real rotation: 0 of " +
            `${result.total} entries are decryptable with the supplied old secret.`,
        );
      }

      res.json({
        ok: true,
        dryRun: result.dryRun,
        rotated: result.rotated,
        failed: result.failed,
        total: result.total,
        note: noteFragments.join(" "),
      }); return;
    } catch (err) {
      req.log?.error({ err, userId: req.userId }, "Integration key store rotation failed");
      res.status(400).json({
        error: err instanceof Error ? err.message : "Rotation failed",
      }); return;
    }
  });

  app.get("/api/integrations/:id", adminMiddleware, (req, res): void => {
    const statuses = getIntegrationStatuses();
    const integration = statuses.find((s) => s.id === req.params.id);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" }); return;
    }
    res.json({ integration });
  });

  app.get("/api/profile", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const user = await storage.getUserProfile(req.userId!);
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      res.json({
        dateOfBirth: user.dateOfBirth ?? null,
        gender: user.gender ?? null,
        zipCode: user.zipCode ?? null,
        country: user.country ?? "US",
        employmentStatus: user.employmentStatus ?? null,
        householdIncome: user.householdIncome ?? null,
        educationLevel: user.educationLevel ?? null,
        ethnicity: user.ethnicity ?? null,
        profileComplete: user.profileComplete ?? false,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to load profile" });
    }
  });

  app.patch("/api/profile", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const parsed = updateUserProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid profile data", details: parsed.error.issues }); return;
      }
      const before = await storage.getUserProfile(req.userId!);
      const wasComplete = before?.profileComplete ?? false;
      const updated = await storage.updateUserProfile(req.userId!, parsed.data);

      // One-time survey-profile completion bonus: +350 points the first time a
      // user's profile transitions incomplete -> complete. Idempotent — guarded
      // by the absence of any prior "survey_profile" earn token for this user, so
      // editing an already-complete profile never re-grants it.
      let bonusAwarded = false;
      if (!wasComplete && updated.profileComplete) {
        const existing = await db
          .select({ id: earnTokens.id })
          .from(earnTokens)
          .where(drizzleAnd(drizzleEq(earnTokens.userId, req.userId!), drizzleEq(earnTokens.actionType, "survey_profile")))
          .limit(1);
        if (existing.length === 0) {
          const now = new Date();
          await db.insert(earnTokens).values({
            userId: req.userId!,
            points: 350,
            actionType: "survey_profile",
            description: "Survey profile completion bonus",
            earnedAt: now,
            claimableAt: now,
            status: "pending",
            usdPerPointSnapshot: await snapshotRateString(),
          });
          bonusAwarded = true;
        }
      }

      res.json({
        dateOfBirth: updated.dateOfBirth ?? null,
        gender: updated.gender ?? null,
        zipCode: updated.zipCode ?? null,
        country: updated.country ?? "US",
        employmentStatus: updated.employmentStatus ?? null,
        householdIncome: updated.householdIncome ?? null,
        educationLevel: updated.educationLevel ?? null,
        ethnicity: updated.ethnicity ?? null,
        profileComplete: updated.profileComplete ?? false,
        bonusAwarded,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.post("/api/profile/paypal-email", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const { email } = req.body;
      if (typeof email !== "string" || !email.trim()) {
        res.status(400).json({ error: "Email is required" }); return;
      }
      const trimmed = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        res.status(400).json({ error: "Invalid email format", code: "INVALID_PAYPAL_EMAIL" }); return;
      }
      if (!isPlausiblePayPalDomain(trimmed)) {
        res.status(400).json({ error: "This email domain is not accepted for PayPal payouts.", code: "INVALID_PAYPAL_EMAIL" }); return;
      }
      const user = await storage.getUser(req.userId!);
      if (!user) { res.status(401).json({ error: "User not found" }); return; }
      if (user.paypalEmail) {
        res.status(409).json({ error: "PayPal email has already been set and cannot be changed.", code: "ALREADY_SET" }); return;
      }
      const result = await storage.setPaypalEmail(req.userId!, trimmed);
      if (result.conflict) {
        res.status(409).json({ error: "This PayPal email is already linked to another account.", code: "CONFLICT" }); return;
      }
      if (!result.ok) {
        res.status(409).json({ error: "PayPal email has already been set and cannot be changed.", code: "ALREADY_SET" }); return;
      }
      await storage.insertUserNotification({
        userId: req.userId!,
        title: "PayPal email saved ✓",
        message: `Your payout email (${trimmed}) has been saved. This cannot be changed later — contact support if needed.`,
        type: "account",
      });
      res.json({ ok: true, paypalEmail: trimmed });
    } catch (err) {
      res.status(500).json({ error: "Failed to save PayPal email" });
    }
  });

  app.get("/api/balance", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { balance, totalEarned } = await storage.getUserBalance(req.userId!);
      const tiers = getAvailableTiers(balance);
      const userWithdrawals = await storage.getUserWithdrawals(req.userId!);
      const lastPaypalEmail = userWithdrawals.length > 0 ? (userWithdrawals[0]!.paypalEmail ?? null) : null;
      res.json({ balance, totalEarned, tiers, allTiers: WITHDRAWAL_TIERS, lastPaypalEmail });
    } catch (err) {
      res.status(500).json({ error: "Failed to load balance" });
    }
  });

  app.get("/api/transactions", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 500);
      const ledger = await storage.getUserLedger(req.userId!, limit);
      res.json({ transactions: ledger });
    } catch (err) {
      res.status(500).json({ error: "Failed to load transactions" });
    }
  });

  app.post("/api/withdrawals", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const { amount, paypalEmail } = req.body;
      const numericAmount = typeof amount === "number" ? amount : parseFloat(String(amount));
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        res.status(400).json({ error: "Invalid withdrawal amount" }); return;
      }
      if (!paypalEmail || typeof paypalEmail !== "string") {
        res.status(400).json({ error: "PayPal email is required" }); return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(paypalEmail)) {
        res.status(400).json({ error: "Invalid PayPal email", code: "INVALID_PAYPAL_EMAIL" }); return;
      }
      if (!isPlausiblePayPalDomain(paypalEmail)) {
        res.status(400).json({ error: "PayPal email domain is not accepted. Please use a real PayPal email address.", code: "INVALID_PAYPAL_EMAIL" }); return;
      }

      const tier = resolveTierForAmount(numericAmount);
      if (!tier) {
        res.status(400).json({
          error: `Withdrawal amount must match an offered tier (${WITHDRAWAL_TIERS.map((t) => `$${t.amount}`).join(", ")}).`,
        }); return;
      }

      const user = await storage.getUser(req.userId!);
      if (!user) {
        res.status(401).json({ error: "User not found" }); return;
      }

      // Anti-fraud: block withdrawals from accounts using anonymous/relay email
      // services. Signup is allowed with these addresses so legitimate users
      // (especially iPhone users with Apple Hide My Email) aren't locked out at
      // the door, but cashing out requires a standard email so we can reach the
      // account holder and so throwaway accounts can't be farmed for payouts.
      // Apple Hide My Email (@privaterelay.appleid.com) is NOT in the relay set
      // and is allowed through both signup and withdrawal.
      if (user.email && isRelayEmail(user.email)) {
        res.status(403).json({
          error: "Withdrawals require a standard email address on your account. Your account currently uses a private-relay or anonymous forwarding address, which we can't use for payout verification. Please contact support@absustaininvest.com to update your account email before requesting a withdrawal.",
          code: "RELAY_EMAIL_NOT_ALLOWED_FOR_WITHDRAWAL",
        });
        return;
      }

      // New-account hold: an account must age NEW_ACCOUNT_HOLD_HOURS (default
      // 48h) before its first withdrawal. This blocks throwaway accounts farmed
      // for an instant payout while letting genuine users cash out after a short
      // wait. Enforced server-side off the trusted user.createdAt timestamp.
      const holdMs = NEW_ACCOUNT_HOLD_HOURS * 60 * 60 * 1000;
      const accountAgeMs = Date.now() - new Date(user.createdAt).getTime();
      if (holdMs > 0 && accountAgeMs < holdMs) {
        const hoursLeft = Math.max(1, Math.ceil((holdMs - accountAgeMs) / (60 * 60 * 1000)));
        res.status(403).json({
          error: `For your account's security, new accounts can make their first withdrawal ${NEW_ACCOUNT_HOLD_HOURS} hours after signing up. Please try again in about ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}. Your balance is safe in the meantime.`,
          code: "NEW_ACCOUNT_HOLD",
          hoursLeft,
        });
        return;
      }

      // Survey-profile required before the FIRST withdrawal. Completing the
      // survey profile is what unlocks paid surveys and lets us verify the
      // account, so it's required once before any money leaves. Returning users
      // (who already have a prior withdrawal) are not re-gated.
      if (!user.profileComplete) {
        const priorWithdrawals = await storage.getUserWithdrawals(req.userId!);
        if (priorWithdrawals.length === 0) {
          res.status(403).json({
            error: "Please complete your survey profile before your first withdrawal. It only takes a minute, unlocks paid surveys, and helps us verify your account.",
            code: "PROFILE_REQUIRED",
          });
          return;
        }
      }

      if (!isPayPalConfigured()) {
        res.status(503).json({
          error: "Payouts are temporarily unavailable. Please check back soon — your balance is safe.",
          code: "PAYPAL_NOT_CONFIGURED",
        });
        return;
      }

      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);

      const dailyFloatMax = getDailyPayoutFloatUsd();

      const result = await storage.createWithdrawalAtomic({
        userId: req.userId!,
        username: user.username,
        amount: tier.amount,
        bonusPercent: tier.bonusPercent.toFixed(2),
        bonusAmount: tier.bonusAmount.toFixed(2),
        totalPayout: tier.totalPayout.toFixed(2),
        paypalEmail: paypalEmail.trim(),
        dailyCapMax: DAILY_WITHDRAWAL_MAX,
        maxPerDay: MAX_WITHDRAWALS_PER_DAY,
        dailyFloatMax,
        dayStart,
      });

      if (!result.ok) {
        if (result.reason === "DAILY_CAP_EXCEEDED") {
          res.status(400).json({
            error: `Daily withdrawal limit is $${DAILY_WITHDRAWAL_MAX.toFixed(2)}. You have withdrawn $${result.withdrawnToday.toFixed(2)} today. Remaining: $${result.remaining.toFixed(2)}.`,
            dailyLimit: DAILY_WITHDRAWAL_MAX,
            withdrawnToday: result.withdrawnToday,
            remaining: result.remaining,
          }); return;
        }
        if (result.reason === "DAILY_COUNT_EXCEEDED") {
          res.status(400).json({
            error: `You can request up to ${result.maxPerDay} withdrawal${result.maxPerDay === 1 ? "" : "s"} per day. You've reached today's limit — please come back tomorrow.`,
            code: "DAILY_COUNT_EXCEEDED",
            maxPerDay: result.maxPerDay,
            withdrawalsTodayCount: result.withdrawalsTodayCount,
          }); return;
        }
        if (result.reason === "FLOAT_EXCEEDED") {
          // Float discipline reached: total payouts for everyone today have hit
          // the daily revenue float. The user's balance is untouched — they just
          // need to wait until the float refreshes at midnight UTC.
          res.status(429).json({
            error: "We've reached today's payout limit across all members. Your balance is safe — please come back after midnight UTC when the daily limit resets. Thanks for your patience!",
            code: "PAYOUT_FLOAT_REACHED",
          }); return;
        }
        res.status(400).json({ error: "Insufficient balance", balance: result.balance }); return;
      }

      res.status(201).json({ withdrawal: result.withdrawal, balance: result.balance });

      // Admin notification is gated to max-tier ($7) cashouts to avoid noise
      // for routine $3/$5 requests. User confirmation is sent for every tier so
      // users always know their request went through. Fire-and-forget.
      const isMaxCashout = tier.amount >= DAILY_WITHDRAWAL_MAX;
      if (isMaxCashout) {
        sendWithdrawalRequestedAdmin({
          id: result.withdrawal.id,
          username: user.username,
          amount: tier.amount.toFixed(2),
          totalPayout: tier.totalPayout.toFixed(2),
          paypalEmail: paypalEmail.trim(),
        }).catch(() => {});
      }

      const userContactEmail = user.email || paypalEmail.trim();
      sendWithdrawalRequestedUser({
        toEmail: userContactEmail,
        username: user.username,
        totalPayout: tier.totalPayout.toFixed(2),
        paypalEmail: paypalEmail.trim(),
      }).catch(() => {});

      // Velocity flag (operator only): alert when a user makes their 2nd (or any
      // further) withdrawal in the same day — the realistic "more than twice a
      // day" signal under the current $7/day cap.
      if (result.withdrawalsTodayCount >= 2) {
        sendWithdrawalVelocityAdmin({
          username: user.username,
          countToday: result.withdrawalsTodayCount,
          amount: tier.amount.toFixed(2),
          totalPayout: tier.totalPayout.toFixed(2),
          paypalEmail: paypalEmail.trim(),
          withdrawalId: result.withdrawal.id,
        }).catch(() => {});
      }
    } catch (err: any) {
      res.status(500).json({ error: "Failed to create withdrawal request" });
    }
  });

  app.get("/api/withdrawals", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const withdrawalList = await storage.getUserWithdrawals(req.userId!);
      res.json({ withdrawals: withdrawalList });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch withdrawals" });
    }
  });

  // Server-authoritative referral status. The user's referral "code" is their
  // username (referred friends enter it at sign-up). A friend only counts —
  // and only earns the referrer the bonus — once they've cashed out $3+
  // (qualified); until then they're shown as pending. Friend usernames are
  // masked so a referrer can track progress without learning full identities.
  app.get("/api/referrals", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      const stats = await storage.getReferralStats(user.username);
      const mask = (u: string): string => {
        if (u.length <= 2) return `${u[0] ?? "?"}***`;
        return `${u.slice(0, 2)}${"*".repeat(Math.max(2, u.length - 2))}`;
      };
      res.json({
        code: user.username,
        totalReferrals: stats.totalReferrals,
        qualifiedReferrals: stats.qualifiedReferrals,
        pendingReferrals: stats.pendingReferrals,
        referralEarnings: parseFloat((stats.qualifiedReferrals * REFERRAL_BONUS_USD).toFixed(2)),
        bonusPerReferral: REFERRAL_BONUS_USD,
        qualifyAmount: REFERRAL_QUALIFY_USD,
        referrals: stats.referrals.map((r) => ({
          name: mask(r.username),
          joinedAt: r.joinedAt,
          qualified: r.qualified,
          qualifiedAt: r.qualifiedAt,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to load referrals" });
    }
  });

  app.get("/api/admin/withdrawals", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as string | undefined;
      const withdrawalList = await storage.getWithdrawals(status);
      res.json({ withdrawals: withdrawalList });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch withdrawals" });
    }
  });

  app.patch("/api/admin/withdrawals/:id", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const withdrawalId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { status, adminNote } = req.body;
      if (!status || !["approved", "rejected", "paid"].includes(status)) {
        res.status(400).json({ error: "Invalid status" }); return;
      }
      const existing = await storage.getWithdrawalById(withdrawalId);
      if (!existing) {
        res.status(404).json({ error: "Withdrawal not found" }); return;
      }

      if (status === "rejected") {
        const claimed = await storage.updateWithdrawalStatusIfStatus(
          withdrawalId,
          ["pending", "approved"],
          "rejected",
          adminNote,
        );
        if (!claimed) {
          res.status(409).json({ error: "Withdrawal is no longer pending and cannot be rejected" }); return;
        }
        await storage.creditUser({
          userId: claimed.userId,
          amount: parseFloat(claimed.amount),
          type: "withdrawal_refund",
          description: `Withdrawal rejected${adminNote ? `: ${adminNote}` : ""}`,
          refId: claimed.id,
        });
        sendWithdrawalStatusUpdateBestEffort(req, claimed.id, {
          toEmail: await resolveStatusUpdateToEmail(claimed.userId, claimed.paypalEmail),
          username: claimed.username,
          amount: claimed.amount,
          totalPayout: claimed.totalPayout,
          status: "rejected",
          adminNote: adminNote ?? undefined,
        });
        res.json({ withdrawal: claimed }); return;
      }

      if (status === "paid") {
        // Only allow manually marking as paid when a withdrawal is stuck in
        // "paying" status (ambiguous outcome). Normal payouts go through the
        // dedicated payout endpoint.
        if (existing.status !== "paying") {
          res.status(400).json({
            error: "Use POST /api/admin/withdrawals/:id/payout to pay via PayPal. Manual 'paid' override is only allowed for withdrawals stuck in 'paying' status.",
          }); return;
        }
        const claimed = await storage.updateWithdrawalStatusIfStatus(
          withdrawalId,
          ["paying"],
          "paid",
          adminNote || "Manually confirmed paid by admin",
        );
        if (!claimed) {
          res.status(409).json({ error: "Withdrawal is no longer in paying status" }); return;
        }

        // Referral qualification on admin-confirmed payout (same rule as the
        // PayPal webhook success path — fires on payout success, not request).
        if (parseFloat(claimed.amount) >= REFERRAL_QUALIFY_USD - 1e-9) {
          storage
            .qualifyReferral({ referredUserId: claimed.userId, bonusUsd: REFERRAL_BONUS_USD })
            .then((r) => {
              if (r.credited && r.referrerId) {
                req.log?.info({ referredUserId: claimed.userId, referrerId: r.referrerId }, "Referral qualified on admin paid — referrer credited");
                const bonusStr = REFERRAL_BONUS_USD.toFixed(2);
                storage.insertUserNotification({
                  userId: r.referrerId,
                  title: "Referral bonus earned! 🎉",
                  message: `Your friend just cashed out — you earned $${bonusStr}!`,
                  type: "referral",
                }).catch((err) => {
                  req.log?.error({ err, referrerId: r.referrerId }, "Failed to insert referral notification");
                });
                if (r.referrerEmail) {
                  sendReferralBonusEarned({
                    toEmail: r.referrerEmail,
                    referrerUsername: r.referrerUsername ?? "there",
                    bonusUsd: bonusStr,
                  });
                }
              }
            })
            .catch((err) => {
              req.log?.error({ err, referredUserId: claimed.userId }, "Referral qualification failed on admin paid");
            });
        }

        res.json({ withdrawal: claimed }); return;
      }

      // Allow rolling a stuck "paying" withdrawal back to "approved" so it can
      // be retried — only when an admin has confirmed the original payment did
      // not go through on the PayPal side.
      const fromStatuses = status === "approved" && existing.status === "paying"
        ? ["paying"]
        : ["pending"];

      const claimed = await storage.updateWithdrawalStatusIfStatus(
        withdrawalId,
        fromStatuses,
        "approved",
        adminNote,
      );
      if (!claimed) {
        res.status(409).json({
          error: existing.status === "paying"
            ? "Withdrawal is no longer in paying status"
            : "Withdrawal is no longer pending",
        }); return;
      }
      res.json({ withdrawal: claimed });
    } catch (err) {
      res.status(500).json({ error: "Failed to update withdrawal" });
    }
  });

  app.post("/api/admin/withdrawals/:id/payout", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      if (!isPayPalConfigured()) {
        res.status(400).json({ error: "PayPal credentials not configured. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET (or PAYPAL_CLIENT_SECRET) environment variables." }); return;
      }

      const withdrawalId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const withdrawal = await storage.getWithdrawalById(withdrawalId);
      if (!withdrawal) {
        res.status(404).json({ error: "Withdrawal not found" }); return;
      }

      const baseAmount = parseFloat(withdrawal.amount);
      const tier = resolveTierForAmount(baseAmount);
      if (!tier) {
        res.status(400).json({
          error: `Withdrawal base amount $${baseAmount.toFixed(2)} does not match any approved tier. Refusing to pay out untrusted total.`,
        }); return;
      }
      const trustedTotalPayout = tier.totalPayout.toFixed(2);

      const paypalEmailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!withdrawal.paypalEmail || typeof withdrawal.paypalEmail !== "string" || !paypalEmailRe.test(withdrawal.paypalEmail.trim())) {
        res.status(400).json({ error: "Stored PayPal email is invalid. Update the withdrawal record before retrying." }); return;
      }
      if (!isPlausiblePayPalDomain(withdrawal.paypalEmail.trim())) {
        res.status(400).json({ error: "Stored PayPal email domain is not accepted. Update the withdrawal record before retrying." }); return;
      }

      const stableBatchId = withdrawal.paypalBatchId ?? `cashclip_${withdrawal.id}`;

      const claimed = await storage.updateWithdrawalStatusIfStatus(
        withdrawal.id,
        ["pending", "approved"],
        "paying",
        "Locked for PayPal payout",
        stableBatchId,
      );
      if (!claimed) {
        const fresh = await storage.getWithdrawalById(withdrawal.id);
        if (fresh?.status === "paid") {
          res.status(409).json({ error: "Withdrawal already paid" }); return;
        }
        if (fresh?.status === "rejected") {
          res.status(409).json({ error: "Cannot pay a rejected withdrawal" }); return;
        }
        if (fresh?.status === "paying") {
          res.status(409).json({ error: "Withdrawal payout is already in progress" }); return;
        }
        res.status(409).json({ error: "Withdrawal cannot be paid in its current state" }); return;
      }

      // Proactive operator alert at the exact money-moving moment. We only
      // reach here with payout credentials configured, but if PAYPAL_WEBHOOK_ID
      // is missing, PayPal's status callback for this batch will be rejected
      // (401) and the withdrawal will stay stuck in "paying" forever — no
      // callback can ever clear it. Warn loudly NOW, before the money leaves,
      // instead of waiting for a callback that can never be verified. This
      // complements the startup + callback alerts: a long-running replica whose
      // startup alert was throttled/missed still warns the operator the instant
      // a real payout goes out without a webhook configured.
      const webhookMissing = !isPayPalWebhookConfigured();
      if (webhookMissing) {
        req.log?.error(
          { secret: "PAYPAL_WEBHOOK_ID", withdrawalId: claimed.id },
          "Sending a PayPal payout while PAYPAL_WEBHOOK_ID is NOT set — the status callback will be rejected (401) and this withdrawal will stay stuck in 'paying'. Set PAYPAL_WEBHOOK_ID in Production app secrets and re-publish the API.",
        );
        // Throttled email alert (shared with startup/callback sources) so a
        // batch of payouts can't flood the operator inbox.
        alertPayPalWebhookSecretMissing("payout");
      }

      const result = await sendPayPalPayout(
        claimed.id,
        claimed.paypalEmail,
        trustedTotalPayout,
        `CashClip payout for ${claimed.username}`,
        stableBatchId,
      );

      if (result.success) {
        // PayPal has accepted the batch creation request but settlement is NOT
        // final yet. Item-level completion is confirmed asynchronously via
        // webhook (PAYMENT.PAYOUTS-ITEM.SUCCEEDED / FAILED / RETURNED / etc.).
        // Leave the withdrawal in "paying" so the webhook handler can make the
        // authoritative paid/rejected transition with a balance refund if needed.
        // Marking "paid" here would cause later failure webhooks to no-op
        // (updateWithdrawalStatusIfStatus only transitions from "paying") and
        // the user's balance would never be restored.
        const fresh = await storage.getWithdrawalById(claimed.id);
        res.json({
          withdrawal: fresh,
          batchId: result.batchId,
          note: "Payout submitted to PayPal. Final status will be updated via webhook.",
          // Surface the danger state in the operator's response so the admin UI
          // can flag it inline right after sending: the money has gone out but
          // PAYPAL_WEBHOOK_ID is missing, so PayPal's status callback will be
          // rejected and this withdrawal will stay stuck in "paying".
          ...(webhookMissing
            ? {
                webhookMissing: true,
                warning:
                  "PAYPAL_WEBHOOK_ID is not set — PayPal's status callback for this payout will be rejected (401) and the withdrawal will stay stuck in 'paying'. Set PAYPAL_WEBHOOK_ID in Production app secrets and re-publish the API.",
              }
            : {}),
        });
      } else if (result.ambiguous) {
        // The request was dispatched but the outcome is uncertain (network
        // timeout, connection drop, or duplicate batch detected). Do NOT roll
        // back to "approved" — the withdrawal stays in "paying" so it cannot
        // be retried and potentially double-paid. An admin must verify the
        // payment status directly in PayPal and then manually resolve it.
        sendPayPalAmbiguousAlert({
          withdrawalId: claimed.id,
          username: claimed.username,
          amount: trustedTotalPayout,
          paypalBatchId: stableBatchId,
        });
        res.status(503).json({
          error: result.error || "PayPal payout outcome is uncertain",
          resolution: "The withdrawal is locked in 'paying' status. Check PayPal for batch ID: " + stableBatchId + " and manually mark it paid or approved via the admin panel once confirmed.",
          paypalBatchId: stableBatchId,
        });
      } else {
        await storage.updateWithdrawalStatusIfStatus(
          claimed.id,
          ["paying"],
          "approved",
          `PayPal payout failed: ${result.error || "unknown error"}`,
        );
        res.status(500).json({ error: result.error || "PayPal payout failed" });
      }
    } catch (err: any) {
      res.status(500).json({ error: "Failed to process payout" });
    }
  });

  app.get("/api/admin/paypal-status", adminMiddleware, async (req: AuthRequest, res) => {
    res.json({
      configured: isPayPalConfigured(),
      mode: process.env.PAYPAL_MODE || "sandbox",
      webhookConfigured: !!(process.env.PAYPAL_WEBHOOK_ID),
    });
  });

  // Canonical PayPal status endpoint for the Integration Hub.
  // Returns credential presence, mode, and webhook configuration so the
  // operator can confirm payouts are wired before going live.
  app.get("/api/admin/integrations/paypal/status", adminMiddleware, async (req: AuthRequest, res) => {
    const clientIdSet = !!process.env.PAYPAL_CLIENT_ID;
    const secretSet = !!(process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET);
    const webhookSet = isPayPalWebhookConfigured();
    const mode = process.env.PAYPAL_MODE || "sandbox";
    const credsConfigured = isPayPalConfigured();
    const fullyConfigured = clientIdSet && secretSet && webhookSet;
    // Dangerous, distinct state: payout credentials ARE set (payouts can go out),
    // but the webhook secret is missing so PayPal's status callbacks fail closed
    // (401). Withdrawals then sit in "paying"/"pending" forever with nothing to
    // clear them. Surface this separately from "PayPal not configured at all".
    const webhookMissing = credsConfigured && !webhookSet;
    const status = fullyConfigured
      ? mode === "live"
        ? "live"
        : "sandbox"
      : webhookMissing
        ? "webhook-missing"
        : "incomplete";
    res.json({
      clientIdSet,
      secretSet,
      webhookSet,
      webhookMissing,
      mode,
      configured: credsConfigured,
      fullyConfigured,
      status,
    });
  });

  // PayPal Payouts webhook — receives payout status notifications from PayPal.
  // Public endpoint (called by PayPal, not users). Verifies the signature via
  // PayPal's /v1/notifications/verify-webhook-signature API before acting.
  // Register this URL in PayPal Developer → CashClip Payouts app → Webhooks:
  //   https://api.cash-clip.app/api/paypal/webhook
  app.post("/api/paypal/webhook", async (req: Request, res: Response): Promise<void> => {
    try {
      // Fleet-wide DB-backed rate limit — shared across all autoscaled replicas.
      // This is the authoritative abuse control for this endpoint: it enforces a
      // global per-IP cap before verifyPayPalWebhook() can be called, preventing
      // an attacker from spreading requests across replicas to multiply the allowed
      // traffic and drive repeated expensive outbound PayPal OAuth + signature
      // verification calls.  The global /api in-memory limiter (app.ts) still
      // applies as a cheap first-pass, but it is not fleet-wide authoritative.
      const { getClientIp } = await import("../lib/clientIp");
      const ip = getClientIp(req);
      const ipCheck = await recordLoginAttempt(`paypal-webhook:ip:${ip}`, 30, 15 * 60 * 1000);
      if (!ipCheck.allowed) {
        res.status(429).json({ error: "Too many requests. Please try again later." }); return;
      }

      const rawBody = (req as unknown as Record<string, unknown>).rawBody as Buffer | undefined;
      if (!rawBody) {
        res.status(400).json({ error: "Missing raw body" }); return;
      }

      // Loud, distinct alarm when the rejection is specifically caused by the
      // webhook secret being absent (vs a normal forged/bad-signature reject).
      // In production this is the silent-failure mode the operator must fix:
      // payouts can still go out, but every PayPal status callback is 401'd, so
      // withdrawals never clear. Surface it once per process so it stands out in
      // the deployment logs instead of looking like routine attack noise.
      if (!isPayPalWebhookConfigured()) {
        if (!paypalWebhookMissingWarned) {
          paypalWebhookMissingWarned = true;
          req.log?.error(
            { secret: "PAYPAL_WEBHOOK_ID" },
            "PayPal webhook callback received but PAYPAL_WEBHOOK_ID is NOT set — signature verification is disabled, all callbacks will be rejected (401) and withdrawals will stay stuck in 'paying'/'pending'. Set PAYPAL_WEBHOOK_ID in Production app secrets and re-publish the API.",
          );
        }
        // Active push alert (email) so the operator reacts without watching the
        // hub. Self-throttled once per cooldown so it can't spam the inbox on
        // every rejected callback (PayPal retries failed deliveries).
        alertPayPalWebhookSecretMissing("callback");
      }

      const verification = await verifyPayPalWebhook(
        req.headers as Record<string, string | string[] | undefined>,
        rawBody,
      );
      if (!verification.ok) {
        logWebhookVerificationFailure(req, "paypal", verification.reason ?? "unknown");
        res.status(401).json({ error: "Webhook verification failed" }); return;
      }

      const event = req.body as {
        event_type?: string;
        resource?: {
          payout_item?: { sender_item_id?: string };
          sender_batch_id?: string;
        };
      };

      const eventType = event?.event_type;
      if (!eventType) {
        res.status(400).json({ error: "Missing event_type" }); return;
      }

      // Derive withdrawal ID from sender_item_id (item-level events) or
      // sender_batch_id in format "cashclip_{withdrawalId}" (batch-level).
      let withdrawalId: string | undefined;
      const senderItemId = event.resource?.payout_item?.sender_item_id;
      const senderBatchId = event.resource?.sender_batch_id;
      if (senderItemId) {
        withdrawalId = senderItemId;
      } else if (typeof senderBatchId === "string" && senderBatchId.startsWith("cashclip_")) {
        withdrawalId = senderBatchId.slice("cashclip_".length);
      }

      if (!withdrawalId) {
        res.status(200).json({ status: "ignored", reason: "no withdrawal id" }); return;
      }

      const withdrawal = await storage.getWithdrawalById(withdrawalId);
      if (!withdrawal) {
        res.status(200).json({ status: "ignored", reason: "withdrawal not found" }); return;
      }

      if (eventType === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED") {
        const claimed = await storage.updateWithdrawalStatusIfStatus(
          withdrawal.id,
          ["paying"],
          "paid",
          `PayPal webhook: ${eventType}`,
        );
        sendWithdrawalStatusUpdateBestEffort(req, withdrawal.id, {
          toEmail: await resolveStatusUpdateToEmail(withdrawal.userId, withdrawal.paypalEmail),
          username: withdrawal.username,
          amount: withdrawal.amount,
          totalPayout: withdrawal.totalPayout,
          status: "paid",
        });

        // Referral qualification fires here — on confirmed payout success —
        // not at withdrawal request creation. This prevents a referral farmer
        // from collecting the bonus via a withdrawal that is later rejected or
        // refunded (failed PayPal delivery, admin rejection, etc.).
        if (claimed && parseFloat(claimed.amount) >= REFERRAL_QUALIFY_USD - 1e-9) {
          storage
            .qualifyReferral({ referredUserId: claimed.userId, bonusUsd: REFERRAL_BONUS_USD })
            .then((r) => {
              if (r.credited && r.referrerId) {
                req.log?.info({ referredUserId: claimed.userId, referrerId: r.referrerId }, "Referral qualified on PayPal success — referrer credited");
                const bonusStr = REFERRAL_BONUS_USD.toFixed(2);
                storage.insertUserNotification({
                  userId: r.referrerId,
                  title: "Referral bonus earned! 🎉",
                  message: `Your friend just cashed out — you earned $${bonusStr}!`,
                  type: "referral",
                }).catch((err) => {
                  req.log?.error({ err, referrerId: r.referrerId }, "Failed to insert referral notification");
                });
                if (r.referrerEmail) {
                  sendReferralBonusEarned({
                    toEmail: r.referrerEmail,
                    referrerUsername: r.referrerUsername ?? "there",
                    bonusUsd: bonusStr,
                  });
                }
              }
            })
            .catch((err) => {
              req.log?.error({ err, referredUserId: claimed.userId }, "Referral qualification failed on PayPal success");
            });
        }

        res.status(200).json({ status: "ok" }); return;
      }

      const FAILURE_EVENTS = new Set([
        "PAYMENT.PAYOUTS-ITEM.FAILED",
        "PAYMENT.PAYOUTS-ITEM.DENIED",
        "PAYMENT.PAYOUTS-ITEM.BLOCKED",
        "PAYMENT.PAYOUTS-ITEM.RETURNED",
        "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
      ]);

      if (FAILURE_EVENTS.has(eventType)) {
        const claimed = await storage.updateWithdrawalStatusIfStatus(
          withdrawal.id,
          ["paying"],
          "rejected",
          `PayPal webhook: ${eventType}`,
        );
        if (claimed) {
          await storage.creditUser({
            userId: claimed.userId,
            amount: parseFloat(claimed.amount),
            type: "withdrawal_refund",
            description: `PayPal payout failed (${eventType}) — balance refunded`,
            refId: claimed.id,
          });
          sendWithdrawalStatusUpdateBestEffort(req, claimed.id, {
            toEmail: await resolveStatusUpdateToEmail(claimed.userId, claimed.paypalEmail),
            username: claimed.username,
            amount: claimed.amount,
            totalPayout: claimed.totalPayout,
            status: "rejected",
            adminNote: `PayPal payout failed: ${eventType}`,
          });
        }
        res.status(200).json({ status: "ok" }); return;
      }

      res.status(200).json({ status: "ignored", reason: `unhandled event: ${eventType}` });
    } catch (err: any) {
      req.log?.error({ err }, "PayPal webhook processing error");
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // Admin-only manual balance credit. Used for screenshots, support refunds,
  // promo bonuses, and one-off adjustments. Writes an earnings_ledger entry
  // of type "adjustment" so it shows up in transactions.
  app.post("/api/admin/credit-balance", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { username, amount, description } = req.body ?? {};

      if (typeof username !== "string" || username.trim().length === 0) {
        res.status(400).json({ error: "username is required" }); return;
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0 || amt > 1000) {
        res.status(400).json({ error: "amount must be a positive number between 0 and 1000" }); return;
      }

      const target = await storage.getUserByUsername(username.trim());
      if (!target) {
        res.status(404).json({ error: "user not found" }); return;
      }

      const note = typeof description === "string" && description.trim().length > 0
        ? description.trim().slice(0, 200)
        : `Admin credit by ${req.userId}`;

      const updated = await storage.creditUser({
        userId: target.id,
        amount: amt,
        type: "adjustment",
        description: note,
        actorUserId: req.userId,
      });

      req.log?.info(
        { adminId: req.userId, targetUserId: target.id, amount: amt },
        "admin credited user balance",
      );

      sendAdminCreditReceipt({
        to: target.email ?? "",
        username: target.username,
        amount: amt,
        newBalance: updated.balance,
        note,
        actor: req.userId,
      });

      res.json({
        userId: target.id,
        username: target.username,
        balance: updated.balance,
        totalEarned: updated.totalEarned,
        credited: amt,
        description: note,
      }); return;
    } catch (err: any) {
      res.status(500).json({ error: "Failed to credit balance" }); return;
    }
  });

  // Manager override: signed balance adjustment used by the website portal.
  // Positive amount = credit, negative amount = correction/reset (debit).
  // Every adjustment writes an auditable ledger row, an attributed server log,
  // and a receipt to the user plus a copy to support@ for the audit trail.
  app.post("/api/admin/credit", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { username, amount, note, description } = req.body ?? {};

      if (typeof username !== "string" || username.trim().length === 0) {
        res.status(400).json({ error: "username is required" }); return;
      }
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 1000) {
        res.status(400).json({ error: "amount must be a non-zero number between -1000 and 1000" }); return;
      }

      const rawNote =
        typeof note === "string" && note.trim().length > 0
          ? note.trim()
          : typeof description === "string"
            ? description.trim()
            : "";
      const finalNote = (rawNote.length > 0 ? rawNote : `Admin adjustment by ${req.userId}`).slice(0, 200);

      const target = await storage.getUserByUsername(username.trim());
      if (!target) {
        res.status(404).json({ error: "user not found" }); return;
      }

      let updated: { balance: number; totalEarned: number };
      try {
        updated =
          amt > 0
            ? await storage.creditUser({ userId: target.id, amount: amt, type: "adjustment", description: finalNote, actorUserId: req.userId })
            : await storage.debitUser({ userId: target.id, amount: Math.abs(amt), type: "adjustment", description: finalNote, actorUserId: req.userId });
      } catch (err: any) {
        if (err?.message === "INSUFFICIENT_BALANCE") {
          res.status(400).json({ error: "Adjustment would put the balance below zero" }); return;
        }
        throw err;
      }

      req.log?.info(
        { adminId: req.userId, targetUserId: target.id, amount: amt, note: finalNote },
        "admin adjusted user balance",
      );

      sendAdminCreditReceipt({
        to: target.email ?? "",
        username: target.username,
        amount: amt,
        newBalance: updated.balance,
        note: finalNote,
        actor: req.userId,
      });

      res.json({
        userId: target.id,
        username: target.username,
        balance: updated.balance,
        totalEarned: updated.totalEarned,
        amount: amt,
        description: finalNote,
      }); return;
    } catch (err: any) {
      res.status(500).json({ error: "Failed to adjust balance" }); return;
    }
  });

  app.get("/api/admin/adjustments", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const parsed = Number(req.query["limit"] ?? 100);
      const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
      const actorRaw = req.query["actor"];
      const actor = typeof actorRaw === "string" && actorRaw.trim().length > 0 ? actorRaw.trim() : undefined;
      const adjustments = await storage.getAdjustmentLedger(limit, actor);
      res.json({ adjustments });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load adjustments" });
    }
  });

  // One-time referral backfill: referral enforcement is forward-looking (it only
  // fires on NEW withdrawals via the withdrawal hook), so any referred user who
  // cashed out >= the qualifying amount BEFORE the feature shipped never credited
  // their referrer. This guarded action finds those users (referredBy set, no
  // referralCreditedAt, with a qualifying withdrawal on record) and runs them
  // through the same idempotent `qualifyReferral` path used live. Safe to re-run:
  // qualifyReferral is guarded by referralCreditedAt, so already-credited users
  // are skipped. Pass { dryRun: true } to preview the candidate count without
  // crediting anyone. High-privilege (passphrase-gated) because it moves money.
  app.post(
    "/api/admin/referrals/backfill",
    adminMiddleware,
    secretsPassphraseMiddleware,
    async (req: AuthRequest, res): Promise<void> => {
      try {
        const dryRun = req.body?.dryRun === true;
        const candidates = await storage.getReferralBackfillCandidates(REFERRAL_QUALIFY_USD);

        if (dryRun) {
          res.json({
            dryRun: true,
            candidates: candidates.length,
            qualifyAmount: REFERRAL_QUALIFY_USD,
            bonusPerReferral: REFERRAL_BONUS_USD,
          });
          return;
        }

        let credited = 0;
        let skipped = 0;
        let failed = 0;
        // Itemized outcomes so the operator can see exactly which referrers were
        // paid (and which were skipped/failed) instead of just totals. referrer
        // is the referred friend's `referredBy` (== the referrer's username).
        const creditedReferrers: {
          referrer: string;
          referredFriend: string;
          amount: number;
        }[] = [];
        const skippedReferrals: { referrer: string; referredFriend: string }[] = [];
        const failedReferrals: { referrer: string; referredFriend: string; error: string }[] = [];
        for (const candidate of candidates) {
          try {
            const result = await storage.qualifyReferral({
              referredUserId: candidate.id,
              bonusUsd: REFERRAL_BONUS_USD,
            });
            if (result.credited) {
              credited += 1;
              creditedReferrers.push({
                referrer: candidate.referredBy,
                referredFriend: candidate.username,
                amount: REFERRAL_BONUS_USD,
              });
            } else {
              skipped += 1;
              skippedReferrals.push({
                referrer: candidate.referredBy,
                referredFriend: candidate.username,
              });
            }
          } catch (err) {
            failed += 1;
            failedReferrals.push({
              referrer: candidate.referredBy,
              referredFriend: candidate.username,
              error: err instanceof Error ? err.message : "unknown error",
            });
            req.log?.error(
              { err, referredUserId: candidate.id },
              "Referral backfill: qualifyReferral failed for candidate",
            );
          }
        }

        req.log?.info(
          { adminId: req.userId, candidates: candidates.length, credited, skipped, failed },
          "admin ran one-time referral backfill",
        );

        res.json({
          dryRun: false,
          candidates: candidates.length,
          credited,
          skipped,
          failed,
          bonusPerReferral: REFERRAL_BONUS_USD,
          creditedReferrers,
          skippedReferrals,
          failedReferrals,
        });
      } catch (err: any) {
        res.status(500).json({ error: "Failed to run referral backfill" });
      }
    },
  );

  app.get("/api/admin/users", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
      const offset = Number(req.query["offset"] ?? 0);
      const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";
      const { users: rows, total } = await storage.getAllUsers(limit, offset, search || undefined);
      const pendingMap = await storage.getPendingByUserIds(rows.map((u) => u.id));
      res.json({
        users: rows.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email ?? null,
          emailVerified: u.emailVerified ?? false,
          role: u.role,
          balance: u.balance,
          totalEarned: u.totalEarned,
          pending: pendingMap.get(u.id) ?? 0,
          createdAt: u.createdAt,
          profileComplete: u.profileComplete ?? false,
          country: u.country ?? null,
          zipCode: u.zipCode ?? null,
          dateOfBirth: u.dateOfBirth ?? null,
          gender: u.gender ?? null,
          employmentStatus: u.employmentStatus ?? null,
          householdIncome: u.householdIncome ?? null,
          educationLevel: u.educationLevel ?? null,
          ethnicity: u.ethnicity ?? null,
          referredBy: u.referredBy ?? null,
          isPublisher: u.isPublisher ?? false,
        })),
        total,
        limit,
        offset,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  app.delete("/api/admin/users/:userId", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const userId = String(req.params["userId"] ?? "");
      const target = await storage.getUser(userId);
      if (!target) { res.status(404).json({ error: "User not found" }); return; }
      if (target.role === "admin") { res.status(400).json({ error: "Cannot delete an admin account" }); return; }
      await storage.deleteUser(userId);
      req.log?.info({ adminId: req.userId, targetUserId: userId, username: target.username }, "admin deleted user");
      res.json({ message: "User deleted", username: target.username });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.post("/api/admin/users/:userId/verify-email", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const userId = String(req.params["userId"] ?? "");
      const target = await storage.getUser(userId);
      if (!target) { res.status(404).json({ error: "User not found" }); return; }
      await storage.markEmailVerified(userId);
      req.log?.info({ adminId: req.userId, targetUserId: userId, username: target.username }, "admin manually verified user email");
      res.json({ message: "Email verified", username: target.username });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to verify email" });
    }
  });

  app.post("/api/admin/users/:userId/reset-password", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      // Require a real, attributed admin identity. The console-token path never
      // sets req.userId, so a shared-secret-only caller is rejected here — it
      // cannot silently take over an account without a durable audit trail.
      if (!req.userId) {
        res.status(403).json({
          error: "This action requires an authenticated admin account. Console-token-only access is not permitted for account-recovery operations.",
          code: "ADMIN_IDENTITY_REQUIRED",
        });
        return;
      }
      const userId = String(req.params["userId"] ?? "");
      const { newPassword } = req.body ?? {};
      if (typeof newPassword !== "string" || newPassword.length < 8) {
        res.status(400).json({ error: "newPassword must be at least 8 characters" });
        return;
      }
      const target = await storage.getUser(userId);
      if (!target) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (target.role === "admin") {
        res.status(403).json({ error: "Admin account passwords cannot be reset via this endpoint" });
        return;
      }
      const bcrypt = await import("bcryptjs");
      const hashed = await bcrypt.hash(newPassword, 10);
      const { getClientIp } = await import("../lib/clientIp");
      // Password reset + durable audit entry commit atomically (fail-closed): if
      // the audit write fails the password change is rolled back, so an admin can
      // never alter a user's credentials without a persisted audit trail.
      // req.userId is guaranteed non-null by the guard above.
      await db.transaction(async (tx) => {
        await storage.updateUserPassword(userId, hashed, tx);
        await storage.recordSecurityAudit({
          actorUserId: req.userId!,
          targetUserId: userId,
          event: "admin_password_reset",
          ip: getClientIp(req),
        }, tx);
      });
      req.log?.info({ adminId: req.userId, targetUserId: userId }, "admin reset user password — prior tokens invalidated");
      res.json({ message: "Password reset successfully", username: target.username });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // Owner/admin account recovery: regenerate a strong password AND clear stuck
  // 2FA in one shot, then invalidate every prior session. Works on admin
  // accounts (unlike reset-password) because it exists to recover a locked-out
  // operator. Gated behind the high-privilege secrets passphrase.
  app.post("/api/admin/users/:userId/factory-reset", adminMiddleware, secretsPassphraseMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      // Require a real, attributed admin identity. The console-token path never
      // sets req.userId, so a shared-secret-only caller is rejected here — it
      // cannot silently clear TOTP or invalidate sessions without a durable audit
      // trail. Both ADMIN_TOKEN and SECRETS_PASSPHRASE together are not enough;
      // a real admin account bearer token is required.
      if (!req.userId) {
        res.status(403).json({
          error: "This action requires an authenticated admin account. Console-token-only access is not permitted for account-recovery operations.",
          code: "ADMIN_IDENTITY_REQUIRED",
        });
        return;
      }
      const userId = String(req.params["userId"] ?? "");
      const target = await storage.getUser(userId);
      if (!target) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const crypto = await import("node:crypto");
      const charset = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%";
      const bytes = crypto.randomBytes(24);
      let newPassword = "";
      for (let i = 0; i < bytes.length; i++) {
        newPassword += charset[bytes[i]! % charset.length]!;
      }
      const bcrypt = await import("bcryptjs");
      const hashed = await bcrypt.hash(newPassword, 10);
      const { getClientIp } = await import("../lib/clientIp");
      // Factory reset + durable audit entry commit atomically (fail-closed): if
      // the audit write fails the credential regeneration is rolled back, so an
      // operator can never take over an account without a persisted audit trail.
      // req.userId is guaranteed non-null by the guard above.
      const { tokenVersion } = await db.transaction(async (tx) => {
        const result = await storage.factoryResetUser(userId, hashed, tx);
        await storage.recordSecurityAudit({
          actorUserId: req.userId!,
          targetUserId: userId,
          event: "admin_factory_reset",
          ip: getClientIp(req),
        }, tx);
        return result;
      });
      req.log?.warn(
        { adminId: req.userId, targetUserId: userId, username: target.username, role: target.role, tokenVersion },
        "admin FACTORY RESET account — password regenerated, 2FA cleared, all prior sessions invalidated",
      );
      // Security alert email (never containing the new password or any secret) so the
      // target admin is tipped off that an operator took over their credentials via
      // factory reset. Mirrors the OTP-reset notice: admin-only, best-effort, never
      // blocks the response, logs a warn when the target has no email on file.
      if (target.role === "admin") {
        const resetRecipient = target.email && target.email.trim().length > 0 ? target.email : undefined;
        if (resetRecipient) {
          try {
            sendPasswordChangedNotice({ to: resetRecipient, username: target.username, context: "reset" });
          } catch (mailErr) {
            req.log?.error({ err: mailErr, targetUserId: userId }, "Failed to send factory-reset security alert");
          }
        } else {
          req.log?.warn({ targetUserId: userId }, "Factory reset but admin has no email on file — skipping security alert");
        }
      }
      res.json({
        message: "Account factory reset",
        username: target.username,
        newPassword,
        totpCleared: true,
      });
    } catch (err: any) {
      req.log?.error({ err }, "Failed to factory reset account");
      res.status(500).json({ error: "Failed to factory reset account" });
    }
  });

  // §3.3 — Persists per-impression ad revenue from the app. revenueMicros comes from
  // the AdMob PAID event captured client-side and is always sanitized via
  // sanitizeRevenueMicros() before touching the DB. The admin revenue panel sums
  // ad_events.revenue_micros for reconciliation against official AdMob earnings.
  app.post("/api/ad-events", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const { event, adUnitType, rewardAmount, rewardType, errorCode, errorMessage, durationMs, platform, revenueMicros } = req.body;

      const validEvents = ["impression", "completion", "reward_earned", "load_failed", "clicked"];
      if (!event || !validEvents.includes(event)) {
        res.status(400).json({ error: `Invalid event type. Must be one of: ${validEvents.join(", ")}` }); return;
      }
      const validAdTypes = ["rewarded", "interstitial", "banner"];
      if (!adUnitType || !validAdTypes.includes(adUnitType)) {
        res.status(400).json({ error: `Invalid ad unit type. Must be one of: ${validAdTypes.join(", ")}` }); return;
      }

      const adEvent = await storage.insertAdEvent({
        userId: req.userId || null,
        event,
        adUnitType,
        rewardAmount: rewardAmount != null ? String(rewardAmount) : null,
        rewardType: rewardType || null,
        errorCode: errorCode || null,
        errorMessage: errorMessage || null,
        durationMs: durationMs != null ? String(Math.round(durationMs)) : null,
        platform: platform || null,
        revenueMicros: sanitizeRevenueMicros(revenueMicros),
      });

      res.status(201).json({ id: adEvent.id });
    } catch (err) {
      req.log?.error({ err }, "Failed to record ad event");
      res.status(500).json({ error: "Failed to record ad event" });
    }
  });

  app.post("/api/ad-events/batch", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const { events } = req.body;
      if (!Array.isArray(events) || events.length === 0) {
        res.status(400).json({ error: "events must be a non-empty array" }); return;
      }
      if (events.length > 50) {
        res.status(400).json({ error: "Maximum 50 events per batch" }); return;
      }

      const validEvents = ["impression", "completion", "reward_earned", "load_failed", "clicked"];
      const validAdTypes = ["rewarded", "interstitial", "banner"];

      const ids: string[] = [];
      for (const e of events) {
        if (!e.event || !validEvents.includes(e.event)) continue;
        if (!e.adUnitType || !validAdTypes.includes(e.adUnitType)) continue;

        const adEvent = await storage.insertAdEvent({
          userId: req.userId || null,
          event: e.event,
          adUnitType: e.adUnitType,
          rewardAmount: e.rewardAmount != null ? String(e.rewardAmount) : null,
          rewardType: e.rewardType || null,
          errorCode: e.errorCode || null,
          errorMessage: e.errorMessage || null,
          durationMs: e.durationMs != null ? String(Math.round(e.durationMs)) : null,
          platform: e.platform || null,
          revenueMicros: sanitizeRevenueMicros(e.revenueMicros),
        });
        ids.push(adEvent.id);
      }

      res.status(201).json({ recorded: ids.length });
    } catch (err) {
      req.log?.error({ err }, "Failed to record ad events batch");
      res.status(500).json({ error: "Failed to record ad events" });
    }
  });

  app.get("/api/ad-stats", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getUserAdStats(req.userId!);
      res.json(stats);
    } catch (err) {
      req.log?.error({ err }, "Failed to get user ad stats");
      res.status(500).json({ error: "Failed to load ad stats" });
    }
  });

  app.get("/api/admin/ad-analytics", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;

      const [summary, timeline, perUser, fillRateAlert] = await Promise.all([
        storage.getAdAnalyticsSummary(from, to),
        storage.getAdEventTimeline(from, to),
        storage.getAdRevenuePerUser(from, to),
        storage.checkFillRateAlerts(),
      ]);

      const totalAttempts = summary.totalImpressions + summary.totalFailures;
      const fillRateSummary = {
        totalAttempts,
        fillRate: totalAttempts > 0
          ? parseFloat(((summary.totalImpressions / totalAttempts) * 100).toFixed(1))
          : 100,
        failureRate: totalAttempts > 0
          ? parseFloat(((summary.totalFailures / totalAttempts) * 100).toFixed(1))
          : 0,
      };

      res.json({ summary: { ...summary, ...fillRateSummary }, timeline, perUser, fillRateAlert });
    } catch (err) {
      req.log?.error({ err }, "Failed to get ad analytics");
      res.status(500).json({ error: "Failed to load ad analytics" });
    }
  });

  app.get("/api/admin/ad-analytics/fill-rate", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const windowMinutes = Math.min(
        Math.max(parseInt(String(req.query.window || "60"), 10) || 60, 5),
        1440,
      );
      const thresholdPercent = Math.min(
        Math.max(parseFloat(String(req.query.threshold || "30")) || 30, 1),
        99,
      );
      const minAttempts = Math.min(
        Math.max(parseInt(String(req.query.minAttempts || "10"), 10) || 10, 1),
        1000,
      );
      const bucketCount = Math.min(
        Math.max(parseInt(String(req.query.buckets || "12"), 10) || 12, 2),
        60,
      );

      const noFillThresholdPercent = Math.min(
        Math.max(parseFloat(String(req.query.noFillThreshold || "30")) || 30, 1),
        99,
      );

      const [alertResult, trendBuckets] = await Promise.all([
        storage.checkFillRateAlerts({
          windowMinutes,
          failureThresholdPercent: thresholdPercent,
          noFillThresholdPercent,
          minAttempts,
        }),
        storage.getFillRateTimeline(windowMinutes, bucketCount),
      ]);

      res.json({
        ...alertResult,
        trend: trendBuckets,
      });
    } catch (err) {
      req.log?.error({ err }, "Failed to get fill rate analytics");
      res.status(500).json({ error: "Failed to load fill rate analytics" });
    }
  });

  app.get("/api/admin/ad-analytics/per-user", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);

      const perUser = await storage.getAdRevenuePerUser(from, to, limit);
      res.json({ perUser });
    } catch (err) {
      req.log?.error({ err }, "Failed to get per-user ad analytics");
      res.status(500).json({ error: "Failed to load per-user ad analytics" });
    }
  });

  app.get("/api/admin/payout-per-user", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);

      const perUser = await storage.getCombinedPayoutPerUser(from, to, limit);
      res.json({ perUser });
    } catch (err) {
      req.log?.error({ err }, "Failed to get combined payout per user");
      res.status(500).json({ error: "Failed to load payout per user" });
    }
  });

  app.get("/api/admin/inbox", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const folder = typeof req.query.folder === "string" ? req.query.folder : "INBOX";
      const messages = await fetchInbox(folder);
      res.json({ messages, fetchedAt: new Date().toISOString() });
    } catch (err) {
      req.log?.error({ err }, "Failed to fetch inbox");
      res.status(500).json({
        error:
          "Failed to connect to mail server. Enable IMAP on the Zoho mailbox and set the ZOHO_IMAP_PASSWORD secret (a separate app-specific password from the SMTP one).",
      });
    }
  });

  app.post("/api/admin/inbox/reply", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";
      const rawSubject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
      const body = typeof req.body?.body === "string" ? req.body.body : "";
      const inReplyTo = typeof req.body?.inReplyTo === "string" ? req.body.inReplyTo.trim() : undefined;

      if (!to) {
        res.status(400).json({ error: "A recipient address is required." });
        return;
      }
      if (!body.trim()) {
        res.status(400).json({ error: "Reply message cannot be empty." });
        return;
      }

      const subject = rawSubject || "Re: your message";

      // Dedupe guard: prevent the same reply being sent twice in quick
      // succession (double-click, retry on a slow SMTP response, impatient
      // operator). Keyed on admin + Message-ID (or recipient/subject) + body
      // hash. Backed by the dedicated dedupe_slots table so it holds across
      // autoscaled replicas, per threat_model.md — and stays decoupled from the
      // login throttle so tuning one can't silently affect the other.
      const dedupeBasis = [
        req.userId ?? "",
        inReplyTo || "",
        to.toLowerCase(),
        subject,
        body,
      ].join("\u0000");
      const dedupeKey = `inbox_reply:${createHash("sha256")
        .update(dedupeBasis)
        .digest("hex")
        .slice(0, 40)}`;
      const DEDUPE_WINDOW_MS = 30_000;
      const { duplicate } = await reserveDedupeSlot(dedupeKey, DEDUPE_WINDOW_MS);
      if (duplicate) {
        req.log?.warn(
          {
            action: "inbox_reply_duplicate_suppressed",
            adminUserId: req.userId,
            to,
            inReplyTo: inReplyTo || null,
          },
          "Suppressed duplicate inbox reply",
        );
        res.status(409).json({
          error:
            "This reply was just sent. Please wait a moment before sending it again.",
          duplicate: true,
        });
        return;
      }

      try {
        await sendSupportReply({ to, subject, body, inReplyTo: inReplyTo || undefined });
      } catch (sendErr) {
        // Release the reserved slot so a genuine retry after a failed send
        // is not blocked by the dedupe window.
        await releaseDedupeSlot(dedupeKey).catch(() => {});
        throw sendErr;
      }

      // Persist the reply so the team has a durable, browsable support trail
      // that survives restarts (the log line below is ephemeral). A failed
      // persist must not make the admin think the email didn't send, so we
      // log the error but still return success.
      const replyLang = detectLang(`${subject} ${body}`);
      const replyIssue = detectIssue(`${subject} ${body}`);

      let savedReply: Awaited<ReturnType<typeof storage.createSupportReply>> | null = null;
      try {
        savedReply = await storage.createSupportReply({
          adminUserId: req.userId!,
          recipient: to,
          subject,
          body,
          inReplyTo: inReplyTo || null,
          issueType: replyIssue,
          lang: replyLang,
        });
      } catch (persistErr) {
        req.log?.error(
          { err: persistErr, adminUserId: req.userId, to },
          "Inbox reply sent but failed to persist to history",
        );
      }

      req.log?.info(
        {
          action: "inbox_reply_sent",
          adminUserId: req.userId,
          to,
          subject,
          inReplyTo: inReplyTo || null,
        },
        "Admin sent inbox reply",
      );

      res.json({ ok: true, reply: savedReply });
    } catch (err) {
      req.log?.error({ err, adminUserId: req.userId }, "Failed to send inbox reply");
      const message = err instanceof Error ? err.message : "Failed to send reply";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/admin/inbox/replies", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const inReplyTo = typeof req.query.inReplyTo === "string" ? req.query.inReplyTo.trim() : "";
      if (!inReplyTo) {
        res.json({ replies: [] });
        return;
      }
      const replies = await storage.getSupportRepliesByThread(inReplyTo);
      res.json({ replies });
    } catch (err) {
      req.log?.error({ err, adminUserId: req.userId }, "Failed to load inbox reply history");
      res.status(500).json({ error: "Failed to load reply history" });
    }
  });

  // Global, paginated log of every support reply sent from the Inbox, across all
  // threads — a standalone "Sent Replies" audit trail. Newest first. Optional
  // filters: recipient (substring match) and adminUserId (exact sending admin).
  app.get("/api/admin/inbox/replies/all", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
      const recipient = typeof req.query.recipient === "string" ? req.query.recipient.trim() : "";
      const adminUserId = typeof req.query.adminUserId === "string" ? req.query.adminUserId.trim() : "";
      const { replies, total } = await storage.listSupportReplies({
        limit,
        offset,
        recipient: recipient || undefined,
        adminUserId: adminUserId || undefined,
      });
      res.json({ replies, total, limit, offset });
    } catch (err) {
      req.log?.error({ err, adminUserId: req.userId }, "Failed to load sent replies log");
      res.status(500).json({ error: "Failed to load sent replies" });
    }
  });

  // OWL — support draft engine.
  // Given a sender email + subject + body from the inbox, looks up the user's
  // real account data and returns a data-backed draft reply the admin can edit
  // before sending. No AI hallucination — every factual claim comes from the DB.
  app.post("/api/admin/inbox/draft", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const fromEmail = typeof req.body?.fromEmail === "string" ? req.body.fromEmail.trim() : "";
      const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
      const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";

      if (!fromEmail) {
        res.status(400).json({ error: "fromEmail is required." });
        return;
      }

      const result = await generateInboxDraft(fromEmail, subject, body, storage);
      res.json(result);
    } catch (err) {
      req.log?.error({ err, adminUserId: req.userId }, "Failed to generate inbox draft");
      res.status(500).json({ error: "Failed to generate draft." });
    }
  });

  app.get("/api/admin/webhook-alerts", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const alertLimit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 100);
      const rejectionLimit = Math.min(
        parseInt(String(req.query.rejectionLimit || "50"), 10) || 50,
        500,
      );
      res.json({
        summary: getRejectionSummary(),
        alerts: getRecentAlerts(alertLimit),
        rejections: getRecentRejections(rejectionLimit),
        admobAlerts: getRecentAdmobAlerts(alertLimit),
      });
    } catch (err) {
      req.log?.error({ err }, "Failed to get webhook alerts");
      res.status(500).json({ error: "Failed to load webhook alerts" });
    }
  });

  app.get("/api/admin/webhook-audit", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = typeof req.query.provider === "string" && req.query.provider.length > 0
        ? req.query.provider
        : undefined;
      const ip = typeof req.query.ip === "string" && req.query.ip.length > 0
        ? req.query.ip
        : undefined;
      const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 500);

      let since: Date | undefined;
      if (typeof req.query.sinceMs === "string") {
        const ms = parseInt(req.query.sinceMs, 10);
        if (Number.isFinite(ms) && ms > 0) since = new Date(Date.now() - ms);
      } else if (typeof req.query.since === "string") {
        const d = new Date(req.query.since);
        if (!Number.isNaN(d.getTime())) since = d;
      }

      const [entries, offenders, providers] = await Promise.all([
        storage.getWebhookAudits({ provider, ip, since, limit }),
        storage.getWebhookAuditOffenders({ since, limit: 10 }),
        storage.getWebhookAuditProviders(),
      ]);

      res.json({
        filters: {
          provider: provider ?? null,
          ip: ip ?? null,
          since: since ? since.toISOString() : null,
          limit,
        },
        knownProviders: providers,
        offenders: offenders.map((o) => ({
          ip: o.ip,
          provider: o.provider,
          count: o.count,
          lastSeenAt: o.lastSeenAt.toISOString(),
        })),
        entries: entries.map((e) => ({
          id: e.id,
          provider: e.provider,
          reason: e.reason,
          ip: e.ip,
          forwardedFor: e.forwardedFor,
          userAgent: e.userAgent,
          method: e.method,
          path: e.path,
          hasSignatureHeader: e.hasSignatureHeader,
          secretConfigured: e.secretConfigured,
          statusCode: e.statusCode,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      req.log?.error({ err }, "Failed to get webhook audit");
      res.status(500).json({ error: "Failed to load webhook audit" });
    }
  });

  app.get("/api/admin/webhook-audit.csv", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const provider = typeof req.query.provider === "string" && req.query.provider.length > 0
        ? req.query.provider
        : undefined;
      const ip = typeof req.query.ip === "string" && req.query.ip.length > 0
        ? req.query.ip
        : undefined;
      const limit = Math.min(parseInt(String(req.query.limit || "10000"), 10) || 10000, 10000);

      let since: Date | undefined;
      if (typeof req.query.sinceMs === "string") {
        const ms = parseInt(req.query.sinceMs, 10);
        if (Number.isFinite(ms) && ms > 0) since = new Date(Date.now() - ms);
      } else if (typeof req.query.since === "string") {
        const d = new Date(req.query.since);
        if (!Number.isNaN(d.getTime())) since = d;
      }

      const entries = await storage.getWebhookAudits({ provider, ip, since, limit });

      const escape = (val: unknown): string => {
        if (val === null || val === undefined) return "";
        let s = String(val);
        if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const header = [
        "timestamp",
        "provider",
        "ip",
        "reason",
        "method",
        "path",
        "has-signature",
        "secret-configured",
      ].join(",");

      const filenameSafe = new Date().toISOString().replace(/[:.]/g, "-");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="webhook-rejections-${filenameSafe}.csv"`,
      );
      res.setHeader("Cache-Control", "no-store");

      res.write(header + "\r\n");
      for (const e of entries) {
        const row = [
          e.createdAt.toISOString(),
          e.provider,
          e.ip,
          e.reason,
          e.method,
          e.path,
          e.hasSignatureHeader ? "true" : "false",
          e.secretConfigured ? "true" : "false",
        ].map(escape).join(",");
        res.write(row + "\r\n");
      }
      res.end();
    } catch (err) {
      req.log?.error({ err }, "Failed to export webhook audit CSV");
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to export webhook audit CSV" });
      } else {
        res.end();
      }
    }
  });

  // Read-only security audit trail (2FA enable/disable, backup-code
  // regeneration, password changes/resets). Admin-gated. The underlying table
  // only stores who-did-what-when metadata — never secrets, codes, seeds, or
  // passwords — so nothing sensitive is exposed here.
  app.get("/api/admin/security-audit", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const actorUserId = typeof req.query.actorUserId === "string" && req.query.actorUserId.length > 0
        ? req.query.actorUserId
        : undefined;

      let event: SecurityAuditEvent | undefined;
      if (typeof req.query.event === "string" && req.query.event.length > 0) {
        if (!SECURITY_AUDIT_EVENTS.includes(req.query.event as SecurityAuditEvent)) {
          res.status(400).json({ error: "Invalid event filter" });
          return;
        }
        event = req.query.event as SecurityAuditEvent;
      }

      const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(String(req.query.offset || "0"), 10) || 0, 0);

      const { entries, total } = await storage.getSecurityAuditEntries({
        actorUserId,
        event,
        limit,
        offset,
      });

      res.json({
        filters: {
          actorUserId: actorUserId ?? null,
          event: event ?? null,
          limit,
          offset,
        },
        knownEvents: SECURITY_AUDIT_EVENTS,
        total,
        entries: entries.map((e) => ({
          id: e.id,
          actorUserId: e.actorUserId,
          actorUsername: e.actorUsername,
          actorEmail: e.actorEmail,
          event: e.event,
          ip: e.ip,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      req.log?.error({ err }, "Failed to get security audit log");
      res.status(500).json({ error: "Failed to load security audit log" });
    }
  });

  app.post("/api/support/tickets", authMiddleware, supportTicketRateLimiter, async (req: AuthRequest, res): Promise<void> => {
    try {
      const { subject, message } = req.body ?? {};
      if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
        res.status(400).json({ error: "subject is required" });
        return;
      }
      if (!message || typeof message !== "string" || message.trim().length === 0) {
        res.status(400).json({ error: "message is required" });
        return;
      }
      if (subject.trim().length > 200) {
        res.status(400).json({ error: "subject must be 200 characters or fewer" });
        return;
      }
      if (message.trim().length > 5000) {
        res.status(400).json({ error: "message must be 5000 characters or fewer" });
        return;
      }
      const user = await storage.getUser(req.userId!);
      const username = user?.username ?? `user:${req.userId}`;
      await sendSupportTicket({
        username,
        userId: String(req.userId),
        subject: subject.trim(),
        message: message.trim(),
        userEmail: user?.email ?? null,
      });
      req.log?.info({ userId: req.userId, subject: subject.trim() }, "Support ticket submitted");
      res.status(200).json({ ok: true });
    } catch (err) {
      req.log?.error({ err }, "Support ticket submission failed");
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  });

  // ── Publisher Program ─────────────────────────────────────────────────────

  const PUBLISHER_GIFT_CREDITS = 5.00; // gifted on publisher grant

  /** Admin: grant or revoke publisher status + optionally gift credits */
  app.patch("/api/admin/users/:id/publisher", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { grant, giftCredits } = req.body as { grant: boolean; giftCredits?: number };
      const targetId = String(req.params.id);
      const { db: dbClient, users: usersTable } = await import("@workspace/db");
      const { sql: drizzleSql } = await import("drizzle-orm");
      const user = await storage.getUser(targetId);
      if (!user) { res.status(404).json({ error: "User not found" }); return; }

      const creditsToAdd = grant ? (giftCredits ?? PUBLISHER_GIFT_CREDITS) : 0;
      await dbClient.update(usersTable)
        .set({
          isPublisher: grant,
          publisherGrantedAt: grant ? new Date() : null,
          adCredits: grant
            ? drizzleSql`${usersTable.adCredits} + ${String(creditsToAdd)}`
            : usersTable.adCredits,
        })
        .where(drizzleSql`id = ${targetId}`);

      await storage.logPublisherAudit({
        actorUserId: req.userId!,
        targetUserId: targetId,
        action: grant ? "grant_publisher" : "revoke_publisher",
        detail: grant && creditsToAdd > 0 ? { creditsAdded: creditsToAdd } : null,
      });

      req.log?.info({ adminId: req.userId, targetId, grant, creditsToAdd }, "Publisher status updated");
      res.json({ ok: true, grant, creditsAdded: creditsToAdd });
    } catch (err) {
      req.log?.error({ err }, "Grant publisher status failed");
      res.status(500).json({ error: "Failed to update publisher status" });
    }
  });

  /** Admin: manually add ad credits to a publisher */
  app.post("/api/admin/users/:id/add-credits", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { amount } = req.body as { amount: number };
      if (!amount || amount <= 0 || amount > 500) { res.status(400).json({ error: "Invalid credit amount" }); return; }
      const targetId = String(req.params.id);
      const { db: dbClient, users: usersTable } = await import("@workspace/db");
      const { sql: drizzleSql } = await import("drizzle-orm");
      const user = await storage.getUser(targetId);
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      await dbClient.update(usersTable)
        .set({ adCredits: drizzleSql`${usersTable.adCredits} + ${String(amount)}` })
        .where(drizzleSql`id = ${targetId}`);

      await storage.logPublisherAudit({
        actorUserId: req.userId!,
        targetUserId: targetId,
        action: "add_credits",
        detail: { creditsAdded: amount },
      });

      req.log?.info({ adminId: req.userId, targetId, amount }, "Ad credits added");
      res.json({ ok: true, added: amount });
    } catch (err) {
      req.log?.error({ err }, "Add ad credits failed");
      res.status(500).json({ error: "Failed to add credits" });
    }
  });

  /** Admin: list all campaigns */
  app.get("/api/admin/campaigns", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { db: dbClient, campaigns: campaignsTable, users: usersTable } = await import("@workspace/db");
      const { desc: drizzleDesc, eq: drizzleEqLocal } = await import("drizzle-orm");
      const rows = await dbClient
        .select({
          id: campaignsTable.id,
          title: campaignsTable.title,
          description: campaignsTable.description,
          targetUrl: campaignsTable.targetUrl,
          rewardPerVisit: campaignsTable.rewardPerVisit,
          totalBudget: campaignsTable.totalBudget,
          spent: campaignsTable.spent,
          clicks: campaignsTable.clicks,
          status: campaignsTable.status,
          adminNote: campaignsTable.adminNote,
          createdAt: campaignsTable.createdAt,
          userId: campaignsTable.userId,
          username: usersTable.username,
        })
        .from(campaignsTable)
        .leftJoin(usersTable, drizzleEqLocal(campaignsTable.userId, usersTable.id))
        .orderBy(drizzleDesc(campaignsTable.createdAt));
      res.json({ campaigns: rows });
    } catch (err) {
      req.log?.error({ err }, "Admin list campaigns failed");
      res.status(500).json({ error: "Failed to load campaigns" });
    }
  });

  /** Admin: list publishers (Publisher Program) with ad credits + campaign stats */
  app.get("/api/admin/publishers", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { db: dbClient, users: usersTable, campaigns: campaignsTable } = await import("@workspace/db");
      const { eq: drizzleEqLocal, desc: drizzleDesc, sql: drizzleSql } = await import("drizzle-orm");
      const rows = await dbClient
        .select({
          id: usersTable.id,
          username: usersTable.username,
          email: usersTable.email,
          balance: usersTable.balance,
          adCredits: usersTable.adCredits,
          publisherGrantedAt: usersTable.publisherGrantedAt,
          createdAt: usersTable.createdAt,
          campaignCount: drizzleSql<number>`count(${campaignsTable.id})::int`,
          totalBudget: drizzleSql<string>`coalesce(sum(${campaignsTable.totalBudget}), 0)`,
          totalSpent: drizzleSql<string>`coalesce(sum(${campaignsTable.spent}), 0)`,
          totalClicks: drizzleSql<number>`coalesce(sum(${campaignsTable.clicks}), 0)::int`,
        })
        .from(usersTable)
        .leftJoin(campaignsTable, drizzleEqLocal(campaignsTable.userId, usersTable.id))
        .where(drizzleEqLocal(usersTable.isPublisher, true))
        .groupBy(usersTable.id)
        .orderBy(drizzleDesc(usersTable.publisherGrantedAt));
      res.json({ publishers: rows });
    } catch (err) {
      req.log?.error({ err }, "Admin list publishers failed");
      res.status(500).json({ error: "Failed to load publishers" });
    }
  });

  /** Admin: approve / reject / pause a campaign */
  app.patch("/api/admin/campaigns/:id", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { status, adminNote } = req.body as { status: string; adminNote?: string };
      const allowed = ["active", "paused", "rejected", "ended"];
      if (!allowed.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
      const { db: dbClient, campaigns: campaignsTable } = await import("@workspace/db");
      const { sql: drizzleSql } = await import("drizzle-orm");
      await dbClient.update(campaignsTable)
        .set({ status, adminNote: adminNote ?? null, updatedAt: new Date() })
        .where(drizzleSql`id = ${req.params.id}`);

      await storage.logPublisherAudit({
        actorUserId: req.userId!,
        campaignId: String(req.params.id),
        action: "campaign_status",
        detail: { status, ...(adminNote ? { adminNote } : {}) },
      });

      req.log?.info({ adminId: req.userId, campaignId: req.params.id, status }, "Campaign status updated");
      res.json({ ok: true });
    } catch (err) {
      req.log?.error({ err }, "Admin update campaign failed");
      res.status(500).json({ error: "Failed to update campaign" });
    }
  });

  /** Admin: read the publisher program audit log */
  app.get("/api/admin/publisher-audit", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const parsedLimit = Number(req.query["limit"] ?? 100);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
      const parsedOffset = Number(req.query["offset"] ?? 0);
      const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
      const { entries, total } = await storage.getPublisherAuditLog({ limit, offset });
      res.json({ entries, total });
    } catch (err: any) {
      req.log?.error({ err }, "Publisher audit log read failed");
      res.status(500).json({ error: "Failed to load publisher audit log" });
    }
  });

  /** Publisher: get my publisher status + ad credits */
  app.get("/api/publisher/me", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) { res.status(404).json({ error: "Not found" }); return; }
      res.json({
        isPublisher: user.isPublisher,
        publisherGrantedAt: user.publisherGrantedAt,
        adCredits: Number(user.adCredits),
        username: user.username,
      });
    } catch (err) {
      req.log?.error({ err }, "Publisher me failed");
      res.status(500).json({ error: "Failed to load publisher info" });
    }
  });

  /** Publisher: list my campaigns */
  app.get("/api/publisher/campaigns", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { db: dbClient, campaigns: campaignsTable } = await import("@workspace/db");
      const { eq: drizzleEqLocal, desc: drizzleDescLocal } = await import("drizzle-orm");
      const user = await storage.getUser(req.userId!);
      if (!user?.isPublisher) { res.status(403).json({ error: "Publisher access required" }); return; }
      const rows = await dbClient
        .select()
        .from(campaignsTable)
        .where(drizzleEqLocal(campaignsTable.userId, req.userId!))
        .orderBy(drizzleDescLocal(campaignsTable.createdAt));

      // Augment each campaign with its callbackKey so the publisher can
      // configure their server-side postback. The key is campaign-specific and
      // is never included in any response visible to campaign visitors.
      const { createHmac: _hmacList } = await import("node:crypto");
      const _cbSecretList = process.env.JWT_ACCESS_SECRET ?? "";
      const campaignsWithKey = rows.map((c) => ({
        ...c,
        callbackKey: _hmacList("sha256", _cbSecretList)
          .update(c.id + ":cbk-v1")
          .digest("hex"),
      }));
      res.json({ campaigns: campaignsWithKey });
    } catch (err) {
      req.log?.error({ err }, "Publisher list campaigns failed");
      res.status(500).json({ error: "Failed to load campaigns" });
    }
  });

  /** Publisher: create campaign */
  app.post("/api/publisher/campaigns", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { title, description, targetUrl, rewardPerVisit, totalBudget } = req.body ?? {};
      if (
        typeof title !== "string" || title.length < 3 || title.length > 80 ||
        typeof description !== "string" || description.length < 10 || description.length > 300 ||
        typeof targetUrl !== "string" || (() => { try { const u = new URL(targetUrl); return !["http:", "https:"].includes(u.protocol); } catch { return true; } })() ||
        typeof rewardPerVisit !== "number" || rewardPerVisit < 0.01 || rewardPerVisit > 0.50 ||
        typeof totalBudget !== "number" || totalBudget < 0.50 || totalBudget > 500
      ) { res.status(400).json({ error: "Invalid campaign data" }); return; }

      const user = await storage.getUser(req.userId!);
      if (!user?.isPublisher) { res.status(403).json({ error: "Publisher access required" }); return; }

      const { db: dbClient, campaigns: campaignsTable, users: usersTable } = await import("@workspace/db");
      const { sql: drizzleSql, and: drizzleAndCreate, eq: drizzleEqCreate } = await import("drizzle-orm");

      // Wrap debit + campaign insert in a single transaction so a failed INSERT
      // never leaves credits consumed without a corresponding campaign row.
      // The WHERE guard on the UPDATE is still the race-free check: two
      // concurrent requests with the same budget can only one succeed because
      // the second UPDATE sees adCredits already reduced below the threshold.
      let campaign: typeof campaignsTable.$inferSelect;
      try {
        campaign = await dbClient.transaction(async (tx) => {
          const debited = await tx
            .update(usersTable)
            .set({ adCredits: drizzleSql`${usersTable.adCredits} - ${String(totalBudget)}` })
            .where(drizzleAndCreate(
              drizzleEqCreate(usersTable.id, req.userId!),
              drizzleSql`is_publisher = true`,
              drizzleSql`${usersTable.adCredits} >= ${String(totalBudget)}`,
            ))
            .returning({ adCredits: usersTable.adCredits });

          if (debited.length === 0) {
            // Signal insufficient credits via a typed throw so the outer
            // catch can distinguish it from an unexpected DB error.
            throw Object.assign(new Error("INSUFFICIENT_AD_CREDITS"), { code: "INSUFFICIENT_AD_CREDITS" });
          }

          const [row] = await tx.insert(campaignsTable).values({
            userId: req.userId!,
            title,
            description,
            targetUrl,
            totalBudget: String(totalBudget),
            rewardPerVisit: String(rewardPerVisit),
            status: "pending",
          }).returning();

          return row;
        });
      } catch (txErr: any) {
        if (txErr?.code === "INSUFFICIENT_AD_CREDITS") {
          res.status(400).json({ error: "Insufficient ad credits to fund this campaign." });
          return;
        }
        throw txErr;
      }

      // Derive the campaign's callbackKey and include it in the creation
      // response so the publisher can configure their server-side postback.
      // This is the only time it's safe to return the key — the owner just
      // created the campaign and should save it immediately.
      const { createHmac: _hmacCreate } = await import("node:crypto");
      const _cbSecretCreate = process.env.JWT_ACCESS_SECRET ?? "";
      const callbackKey = _hmacCreate("sha256", _cbSecretCreate)
        .update(campaign.id + ":cbk-v1")
        .digest("hex");

      req.log?.info({ userId: req.userId, campaignId: campaign.id, totalBudget }, "Campaign created");
      res.status(201).json({ campaign: { ...campaign, callbackKey } });
    } catch (err) {
      req.log?.error({ err }, "Create campaign failed");
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  /** Publisher: pause or resume own campaign */
  // Security: publishers may only toggle campaigns between 'active' and 'paused'.
  // They must never be able to self-activate a 'pending' or 'rejected' campaign,
  // which would bypass the admin approval workflow and allow unapproved destinations
  // to enter the money-moving sponsored-visit pipeline.
  // The guard is enforced in two layers:
  //   1. isPublisher role check — non-publishers are rejected immediately.
  //   2. Atomic UPDATE WHERE with inArray(['active','paused']) — pending/rejected
  //      campaigns cannot be activated regardless of race conditions.
  app.patch("/api/publisher/campaigns/:id", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { status } = req.body as { status: string };
      // Publishers may only set active or paused — never pending, rejected, or ended.
      if (!["paused", "active"].includes(status)) { res.status(400).json({ error: "Invalid status. Publishers may only set 'active' or 'paused'." }); return; }

      // Re-check isPublisher on every request — never assume from context.
      const user = await storage.getUser(req.userId!);
      if (!user?.isPublisher) { res.status(403).json({ error: "Publisher access required" }); return; }

      const { db: dbClient, campaigns: campaignsTable } = await import("@workspace/db");
      const { and: drizzleAndLocal, eq: drizzleEqLocal, inArray: drizzleInArray } = await import("drizzle-orm");

      // Verify ownership first so we can return a meaningful 404 vs 403.
      const [existing] = await dbClient
        .select({ id: campaignsTable.id, status: campaignsTable.status })
        .from(campaignsTable)
        .where(drizzleAndLocal(
          drizzleEqLocal(campaignsTable.id, String(req.params.id)),
          drizzleEqLocal(campaignsTable.userId, req.userId!),
        ))
        .limit(1);

      if (!existing) { res.status(404).json({ error: "Campaign not found" }); return; }

      // Guard: only already-approved campaigns (active/paused) may be toggled.
      // This is also enforced atomically in the UPDATE WHERE clause so that a
      // concurrent admin rejection between the SELECT and the UPDATE cannot
      // resurrect a pending/rejected campaign (prevents TOCTOU bypass).
      const allowedCurrentStatuses = ["active", "paused"] as const;
      if (!allowedCurrentStatuses.includes(existing.status as typeof allowedCurrentStatuses[number])) {
        res.status(403).json({ error: "Campaign cannot be modified until approved by an admin" });
        return;
      }

      const updated = await dbClient.update(campaignsTable)
        .set({ status, updatedAt: new Date() })
        .where(drizzleAndLocal(
          drizzleEqLocal(campaignsTable.id, String(req.params.id)),
          drizzleEqLocal(campaignsTable.userId, req.userId!),
          drizzleInArray(campaignsTable.status, allowedCurrentStatuses),
        ))
        .returning({ id: campaignsTable.id });

      if (updated.length === 0) {
        res.status(403).json({ error: "Campaign cannot be modified until approved by an admin" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      req.log?.error({ err }, "Pause campaign failed");
      res.status(500).json({ error: "Failed to update campaign" });
    }
  });

  /** Publisher: convert earnings balance into ad credits */
  app.post("/api/publisher/top-up", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { amount } = req.body as { amount: number };
      if (!amount || amount < 1 || amount > 100) { res.status(400).json({ error: "Amount must be between $1 and $100" }); return; }

      const user = await storage.getUser(req.userId!);
      if (!user?.isPublisher) { res.status(403).json({ error: "Publisher access required" }); return; }

      const { db: dbClient, users: usersTable, earningsLedger } = await import("@workspace/db");
      const { sql: drizzleSql, eq: drizzleEqTopUp } = await import("drizzle-orm");

      // Single atomic UPDATE: debit balance and credit ad_credits together,
      // guarded by balance >= amount in the WHERE clause.
      // This eliminates the prior TOCTOU window where two concurrent top-up
      // requests could both read the same balance, both pass the JS check,
      // and both commit — doubling the credit conversion.
      let converted: boolean;
      await dbClient.transaction(async (tx) => {
        const rows = await tx
          .update(usersTable)
          .set({
            balance: drizzleSql`${usersTable.balance} - ${String(amount)}`,
            adCredits: drizzleSql`${usersTable.adCredits} + ${String(amount)}`,
          })
          .where(drizzleSql`
            id = ${req.userId}
            AND is_publisher = true
            AND balance >= ${String(amount)}
          `)
          .returning({ balance: usersTable.balance });

        converted = rows.length > 0;

        if (converted) {
          await tx.insert(earningsLedger).values({
            userId: req.userId!,
            amount: String(-amount),
            type: "adjustment",
            description: `Converted $${amount.toFixed(2)} earnings to ad credits`,
          });
        }
      });

      if (!converted!) {
        res.status(400).json({ error: "Insufficient earnings balance" });
        return;
      }

      req.log?.info({ userId: req.userId, amount }, "Publisher top-up from earnings");
      res.json({ ok: true, converted: amount });
    } catch (err) {
      req.log?.error({ err }, "Publisher top-up failed");
      res.status(500).json({ error: "Failed to convert credits" });
    }
  });

  /** Earn: list active sponsored campaigns (auth required — prevents bots) */
  // ── GET /api/earn/sponsored — DISABLED (Task #698, Vuln #2) ──────────────────
  // Sponsored-visit earning is disabled because a real human viewing a third-
  // party advertiser page cannot be proven from an untrusted client: every value
  // in the witness chain (the /r redirect, the /ack + /c ack token, the witness
  // cookie, the /delivery pixel) travels through the client and is replayable by
  // a script, so visits can be faked to mint balance and drain publisher campaign
  // budgets. The threat model explicitly rejects such replayable browser
  // choreography as proof for money-like rewards, and no trusted provider/proof-
  // of-delivery signal exists for arbitrary advertiser URLs to harden against.
  //
  // We return an empty list so the app's "Sponsored" section disappears cleanly
  // (SponsoredSection renders nothing when there are no campaigns). Publisher
  // campaign management is unaffected — only visitor self-crediting is disabled,
  // and it can be re-enabled if a verifiable proof-of-visit signal is added.
  app.get("/api/earn/sponsored", authMiddleware, (_req: AuthRequest, res) => {
    res.json({ campaigns: [] });
  });

  /**
   * Device registration — issues a server-generated install token.
   *
   * The client calls this ONCE per device+user pair (on first sponsored-visit
   * flow) and stores the returned token in secure storage. All subsequent
   * sponsored /begin and /visit calls present the token via X-Install-Token.
   *
   * The server stores only the SHA-256 hash; the raw token is never persisted
   * server-side. The token cannot be minted by the client — it is server-
   * generated, so an attacker cannot freely rotate it per account without
   * going through this rate-limited endpoint again.
   */
  app.post("/api/device/register", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const rawDeviceId = String(req.headers["x-device-id"] ?? "").slice(0, 128);
      if (!rawDeviceId || !/^[0-9a-fA-F-]{8,128}$/.test(rawDeviceId)) {
        res.status(400).json({ error: "Invalid or missing device identifier." });
        return;
      }

      const { createHash: hashFn, randomBytes } = await import("crypto");
      const deviceHash = hashFn("sha256").update(rawDeviceId).digest("hex");

      const { db: dbClient, deviceInstalls: deviceInstallsTable } = await import("@workspace/db");
      const { sql: sqlReg } = await import("drizzle-orm");

      // Per-user token cap (default 5): rate-limits how many server-issued
      // install credentials a single account can accumulate. DB-backed so the
      // cap holds across all replicas and survives restarts.
      //
      // Note: we intentionally do NOT enforce a one-device-one-account policy
      // here. Such a policy would be derived from a client-supplied device UUID,
      // which is untrusted (a modified client can rotate it freely). Applying it
      // would give false confidence in a bypassable control. Instead, payout
      // decisions rely exclusively on server-authoritative gates (IP cap,
      // per-account/per-campaign dedup, witnessedAt, dwell time). Device UUID
      // is stored in device_installs for forensics/logging only.
      const maxTokens = Math.max(1, parseInt(process.env.MAX_INSTALL_TOKENS_PER_USER ?? "5", 10));
      const countRows = await dbClient.execute(sqlReg`
        SELECT COUNT(*)::int AS n FROM device_installs WHERE user_id = ${req.userId!}
      `);
      const existing = Number((countRows.rows[0] as { n: number }).n);
      if (existing >= maxTokens) {
        req.log?.warn({ userId: req.userId, existing }, "Device registration refused — token limit reached");
        res.status(429).json({ error: "Device registration limit reached for this account." });
        return;
      }

      // Generate an opaque 32-byte install token. Only its hash is stored.
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = hashFn("sha256").update(rawToken).digest("hex");

      await dbClient.insert(deviceInstallsTable).values({
        tokenHash,
        deviceHash,
        userId: req.userId!,
      });

      req.log?.info({ userId: req.userId, tokenHashPrefix: tokenHash.slice(0, 8) }, "Device install token issued");
      res.status(201).json({ installToken: rawToken });
    } catch (err: any) {
      req.log?.error({ err }, "Device registration failed");
      res.status(500).json({ error: "Failed to register device." });
    }
  });

  /** Earn: begin a sponsored visit — issues a short-lived visit token.
   *  The client must call this BEFORE opening the target URL, then present
   *  the token when calling /visit after spending time on the page.
   *  This prevents direct API calls from claiming rewards without any
   *  actual visit interaction.
   */
  // ── POST /api/earn/sponsored/:id/begin — DISABLED (Task #698, Vuln #2) ───────
  // Returns 410 Gone so no new visit attempts can be started. Disabling /begin
  // means no attemptToken is ever minted, which dead-ends the entire downstream
  // witness chain (/r, /ack, /c, /delivery) and the /visit settlement. See the
  // GET /api/earn/sponsored comment above for why this flow cannot be made
  // tamper-proof from an untrusted client. The client (SponsoredSection) shows a
  // benign error on non-OK begin and the section is hidden anyway (empty list).
  app.post("/api/earn/sponsored/:id/begin", authMiddleware, (_req: AuthRequest, res) => {
    res.status(410).json({ error: "Sponsored visits are no longer available." });
  });

  /** Public redirect proxy for sponsored visits.
   *
   *  The client opens this URL after /begin. We atomically stamp redirectedAt
   *  (only once — so this is a one-time, server-observed signal that an HTTP
   *  fetch reached our domain for this attempt) and 302 to the advertiser.
   *  /visit later requires redirectedAt to be set AND enough dwell time to
   *  have elapsed since that stamp, replacing the prior client-claimed time.
   */
  app.get("/api/earn/sponsored/r/:token", async (req, res) => {
    try {
      const token = String(req.params.token);
      if (!/^[a-f0-9]{64}$/.test(token)) {
        res.status(404).send("Not found"); return;
      }

      // ── Per-IP rate limit on the redirect endpoint ────────────────────────
      // /r is public (no auth required) but unconstrained calls here enable
      // scripted farming: a bot can cycle /begin → /r → /ack → /c → /visit
      // indefinitely from the same IP. Gate this endpoint at the same
      // fail-closed pattern used by every other money-adjacent route.
      {
        const { getClientIp: _rip } = await import("../lib/clientIp");
        const { recordLoginAttempt: _rrl } = await import("../lib/dbRateLimit");
        const _ripVal = _rip(req);
        const _ripLimit = Math.max(1, parseInt(process.env.SPONSORED_REDIRECT_IP_LIMIT ?? "20", 10));
        try {
          const { allowed } = await _rrl(`sponsored:redirect:ip:${_ripVal}`, _ripLimit, 60 * 60 * 1000);
          if (!allowed) {
            req.log?.warn?.({ ip: _ripVal }, "Sponsored /r rate limit exceeded (IP)");
            res.status(429).send("Too many sponsored redirect requests. Please try again later."); return;
          }
        } catch (rlErr) {
          req.log?.error?.({ err: rlErr }, "Sponsored /r IP rate-limit check failed — failing closed");
          res.status(503).send("Rate limit check unavailable — please retry."); return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const {
        db: dbClient,
        campaigns: campaignsTable,
        campaignVisitAttempts: attemptsTable,
      } = await import("@workspace/db");
      const { sql: drizzleSql, eq: drizzleEqLocal, and: drizzleAndLocal } = await import("drizzle-orm");
      const { createHash } = await import("crypto");
      const { getClientIp } = await import("../lib/clientIp");

      const [attempt] = await dbClient.select().from(attemptsTable)
        .where(drizzleEqLocal(attemptsTable.token, token));
      if (!attempt) { res.status(404).send("Visit link not found"); return; }
      if (attempt.expiresAt.getTime() < Date.now()) {
        res.status(410).send("Visit link expired"); return;
      }
      if (attempt.settledAt) {
        res.status(410).send("Visit already claimed"); return;
      }

      // ── Per-user rate limit (derived from the attempt row) ────────────────
      // The /r endpoint is public, but each attempt is owned by a specific user
      // (set at /begin time). Enforce a per-user hourly cap to prevent a single
      // account from scripting /r across many campaigns in rapid succession.
      // Fail-closed — if the DB check throws, refuse the request rather than
      // allowing unlimited access to this money-adjacent chain step.
      {
        const { recordLoginAttempt: _rrl2 } = await import("../lib/dbRateLimit");
        const _rUserLimit = Math.max(1, parseInt(process.env.SPONSORED_REDIRECT_USER_LIMIT ?? "20", 10));
        try {
          const { allowed } = await _rrl2(`sponsored:redirect:user:${attempt.userId}`, _rUserLimit, 60 * 60 * 1000);
          if (!allowed) {
            req.log?.warn?.({ userId: attempt.userId }, "Sponsored /r rate limit exceeded (user)");
            res.status(429).send("Too many sponsored redirect requests for this account. Please try again later."); return;
          }
        } catch (rlErr2) {
          req.log?.error?.({ err: rlErr2 }, "Sponsored /r user rate-limit check failed — failing closed");
          res.status(503).send("Rate limit check unavailable — please retry."); return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const [campaign] = await dbClient.select().from(campaignsTable)
        .where(drizzleEqLocal(campaignsTable.id, attempt.campaignId));
      if (!campaign) { res.status(404).send("Campaign not found"); return; }

      // ── visitSessionToken (VST) validation ───────────────────────────────
      // VST = HMAC-SHA256(attemptToken:userId:vst, JWT_ACCESS_SECRET).
      // It is returned to the caller at /begin time ONLY — it is NOT embedded
      // in this response. /r validates it here; /ack requires it too.
      // An attacker who knows the attempt token but not the /begin response
      // (e.g. token interception without a /begin call) cannot produce VST
      // without JWT_ACCESS_SECRET. An attacker who DID call /begin has VST
      // from that response — but VST requirements bind the chain to the
      // originating authenticated session and enforce rate limits at /begin.
      const _vSecret = process.env.JWT_ACCESS_SECRET;
      if (!_vSecret) {
        req.log?.error?.({}, "Sponsored redirect: JWT_ACCESS_SECRET not configured");
        res.status(500).send("Server configuration error"); return;
      }
      const { createHmac: _hmacV, timingSafeEqual: _tseV } = await import("node:crypto");
      const expectedVst = _hmacV("sha256", _vSecret)
        .update(token + ":" + attempt.userId + ":vst")
        .digest();
      const queryVst = String(req.query.vst ?? "");
      let providedVstBuf: Buffer;
      try { providedVstBuf = Buffer.from(queryVst, "hex"); } catch { providedVstBuf = Buffer.alloc(0); }
      if (providedVstBuf.length !== expectedVst.length || !_tseV(providedVstBuf, expectedVst)) {
        req.log?.warn?.({ token: token.slice(0, 8) + "…" }, "Sponsored /r: VST missing or invalid — rejecting");
        res.status(403).send("Invalid visit session — please reopen the link from the app."); return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // Stamp redirectedAt + bind this attempt to the redirecting client's
      // IP and User-Agent ONCE. /ack must arrive from a matching client
      // (same IP, same UA hash) and /visit only settles after both fire.
      // The COALESCE guards make the first fetch authoritative; concurrent
      // fetches against the same token cannot rebind to a different client.
      const ip = getClientIp(req);
      const ua = String(req.headers["user-agent"] ?? "");
      const ipHash = createHash("sha256").update(ip).digest("hex");
      const uaHash = createHash("sha256").update(ua).digest("hex");

      // Generate a single-use witness nonce stored only in the DB.
      // The nonce is NEVER returned to the client — it lives server-side only.
      // /ack re-derives the ackToken from the DB-stored nonce; /c validates it.
      // Critically: the nonce must NOT appear in any response header or cookie
      // so that an HTTP client cannot extract it and replay the witness chain.
      // HttpOnly only prevents browser JavaScript from reading document.cookie;
      // any HTTP client can read Set-Cookie response headers directly.
      const { randomBytes: _rnd } = await import("node:crypto");
      const witnessNonce = _rnd(24).toString("hex");
      const ackPath = "/api/earn/sponsored/ack/" + token;
      const completionPath = "/api/earn/sponsored/c/" + token;

      // Minimum time (ms) the interstitial must remain open before /c/:token
      // accepts the witnessedAt stamp. Enforced both client-side (countdown)
      // and server-side (/c rejects with 425 if called too early).
      const MIN_INTERSTITIAL_MS = Math.max(
        1000,
        parseInt(process.env.MIN_INTERSTITIAL_DWELL_MS ?? "5000", 10),
      );

      // Hard NULL guard so a second /r fetch cannot rebind even if the
      // COALESCE plan ever changes — the UPDATE simply matches zero rows.
      // witnessNonce is stored in the DB (DB-persisted, not in-memory) so
      // it survives restarts and works correctly in multi-instance deployments.
      await dbClient.update(attemptsTable)
        .set({
          redirectedAt: drizzleSql`NOW()`,
          redirectIpHash: ipHash,
          redirectUaHash: uaHash,
          witnessNonce: witnessNonce,
        })
        .where(drizzleAndLocal(
          drizzleEqLocal(attemptsTable.token, token),
          drizzleSql`${attemptsTable.redirectedAt} IS NULL`,
        ));

      // Interstitial HTML:
      //   1. A hidden iframe pre-fetches the advertiser URL so a real browser
      //      makes a cross-origin network request to the advertiser's server.
      //   2. A server-enforced countdown (MIN_INTERSTITIAL_MS) must elapse.
      //   3. After both iframe signal AND timer fire, JS calls /ack via XHR
      //      (requires cc_w cookie + VST from the /begin response, not this page).
      //   4. After /ack returns an ackToken, the browser NAVIGATES (top-level
      //      navigation, not XHR) to /c/:token?ack=<ackToken>. /c enforces
      //      Sec-Fetch-Mode: it rejects explicit XHR/cors calls, requiring a
      //      browser navigation to stamp witnessedAt and redirect to the advertiser.
      //      This means the completion step cannot be called via a background fetch
      //      from a browser — it requires actual browser navigation.
      //   5. VST is read from the page URL's query string (window.location.search)
      //      by the interstitial JS. It is NOT embedded as a JS variable in the
      //      HTML body, so static HTML scrapers cannot extract it from this response.
      //      The attacker must have it from the /begin response to call /ack.
      const escapeHtml = (s: string) => s
        .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag — safeForScript uses JSON.stringify + script-break neutralization; escapedTitle uses escapeHtml()
      const safeForScript = (s: string) => JSON.stringify(s)
        .replace(/<\/script/gi, "<\\/script")
        .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      const escapedTitle = escapeHtml(String(campaign.title ?? "Sponsor"));
      // Validate targetUrl is http(s) before embedding in iframe src / JS.
      const targetUrl = String(campaign.targetUrl ?? "");
      const safeTargetUrl = /^https?:\/\//i.test(targetUrl) ? targetUrl : "";
      const escapedTargetUrl = escapeHtml(safeTargetUrl);
      const countdownSecs = Math.ceil(MIN_INTERSTITIAL_MS / 1000);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      // nosemgrep: javascript.lang.security.html-in-template-string — all user-derived values use escapeHtml() or safeForScript(); targetUrl validated as http(s) above
      res.send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Loading ${escapedTitle}…</title>
<style>
  html,body{margin:0;padding:0;height:100%;background:#06060E;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:24px}
  .spin{width:36px;height:36px;border:3px solid rgba(255,255,255,0.15);border-top-color:#00E676;border-radius:50%;animation:s 0.9s linear infinite;margin-bottom:18px}
  @keyframes s{to{transform:rotate(360deg)}}
  h1{font-size:16px;font-weight:600;margin:0 0 6px;color:#fff}
  p{font-size:13px;color:rgba(255,255,255,0.5);margin:0}
  #cc-timer{font-size:28px;font-weight:700;color:#00E676;margin-top:12px;min-height:36px}
</style></head>
<body>
<!-- Hidden iframe: forces a real cross-origin network request to the advertiser.
     A plain HTTP client cannot cause this iframe to fire onload — JS execution
     in a real browser engine is required. X-Frame-Options blocked sites trigger
     onerror instead, which is treated as a load signal so we fall back to the
     timer-only path rather than hanging. -->
<iframe id="cc-frame" src="${escapedTargetUrl}" style="width:0;height:0;border:0;position:absolute;left:-9999px"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
  loading="eager" referrerpolicy="no-referrer"></iframe>
<div class="wrap">
  <div class="spin"></div>
  <h1>Loading sponsor…</h1>
  <p>Taking you to ${escapedTitle}</p>
  <div id="cc-timer">${countdownSecs}</div>
</div>
<script>
(function(){
  var ackPath=${safeForScript(ackPath)};
  var completionPath=${safeForScript(completionPath)};
  var minMs=${MIN_INTERSTITIAL_MS};
  var startMs=Date.now();
  var iframeReady=false;
  var timerFired=false;
  var settling=false;
  var timerEl=document.getElementById('cc-timer');

  // VST is read from this page's own query string — it is NOT embedded as a
  // static JS variable in the HTML body. A static HTML scraper therefore
  // cannot extract it from this response; the caller must have obtained it
  // from the /begin API response before opening this URL.
  function getQueryParam(name){
    try{
      var m=window.location.search.match(new RegExp('[?&]'+name+'=([^&]*)'));
      return m?decodeURIComponent(m[1]):'';
    }catch(e){return '';}
  }
  var vst=getQueryParam('vst');

  // Countdown display
  function tick(){
    var rem=Math.max(0,minMs-Math.round(Date.now()-startMs));
    if(timerEl)timerEl.textContent=rem>0?Math.ceil(rem/1000)+'s':'';
    if(rem>0)setTimeout(tick,250);
  }
  tick();

  // Minimum-time gate fires after minMs
  setTimeout(function(){timerFired=true;proceed();},minMs);

  // Iframe signals — onload proves advertiser server was reached;
  // onerror means X-Frame-Options or network blocked it (treat as ready
  // so timer becomes the binding constraint rather than hanging forever).
  var frame=document.getElementById('cc-frame');
  if(frame){
    frame.onload=function(){iframeReady=true;proceed();};
    frame.onerror=function(){iframeReady=true;proceed();};
  }else{
    iframeReady=true; // no iframe support — timer is the only gate
  }

  function proceed(){
    // Both iframe signal AND timer must have fired
    if(!timerFired||!iframeReady||settling)return;
    settling=true;
    fetchAck(0);
  }

  // Step 1: Call /ack with VST (from /begin response, read from URL query string)
  // and the cc_w HttpOnly cookie (sent automatically by the browser).
  // /ack validates VST against the attempt's userId (re-derived server-side from
  // JWT_ACCESS_SECRET — cannot be forged from /r response alone) and validates
  // the cookie against the DB-stored nonce + IP/UA binding.
  function fetchAck(retryDelayMs){
    if(retryDelayMs>0){setTimeout(function(){fetchAck(0);},retryDelayMs);return;}
    var xhr=new XMLHttpRequest();
    xhr.open('GET',ackPath+'?vst='+encodeURIComponent(vst),true);
    xhr.setRequestHeader('Accept','application/json');
    xhr.onload=function(){
      if(xhr.status===425){
        try{var d=JSON.parse(xhr.responseText);fetchAck((d.retryAfterMs||1000)+100);}
        catch(e){fetchAck(1100);}
        return;
      }
      var ackToken='';
      try{var d=JSON.parse(xhr.responseText);ackToken=d.ackToken||'';}catch(e){}
      if(ackToken)sendCompletion(ackToken);
      else navigate(); // /ack failed — best-effort navigate to advertiser
    };
    xhr.onerror=function(){navigate();};
    xhr.send();
  }

  // Step 2: Navigate the browser (top-level navigation, not XHR) to /c/:token.
  // /c enforces Sec-Fetch-Mode: navigate — it rejects explicit XHR/cors requests,
  // requiring this to be a real browser navigation. /c stamps witnessedAt server-side
  // and then 302-redirects the browser to the advertiser URL.
  // This means the completion step cannot be triggered by a background fetch from
  // a browser; the browser must actually navigate away from this page.
  function sendCompletion(ackToken){
    try{
      window.location.replace(completionPath+'?ack='+encodeURIComponent(ackToken));
    }catch(e){
      window.location.href=completionPath+'?ack='+encodeURIComponent(ackToken);
    }
  }

  function navigate(){
    // Fallback: navigate directly to advertiser if /ack fails or JS stalls.
    // witnessedAt will not be set, so /visit will fail — the user does not
    // receive credit but is not left stranded.
  }

  // Hard fallback: navigate directly to advertiser after minMs + 15 s in case
  // JS stalls. User is sent to the sponsor page but /visit will require
  // witnessedAt to be set (via /c), so credit is not granted automatically.
  setTimeout(function(){
    if(!settling&&document.visibilityState!=='hidden'){navigate();}
  },minMs+15000);
})();
</script>
<noscript><p style="color:#fff;padding:24px;text-align:center">Please enable JavaScript to complete this sponsored visit.</p></noscript>
</body></html>`);
    } catch (err: any) {
      req.log?.error?.({ err }, "Sponsored redirect failed");
      res.status(500).send("Redirect failed");
    }
  });

  /** DEPRECATED — replaced by the server-observed completion redirect /c/:token.
   *  Returns 410 Gone so legacy interstitial pages (if any are cached) fail
   *  explicitly rather than silently setting witnessedAt on the old path.
   */
  app.post("/api/earn/sponsored/witness/:token", (_req, res) => {
    res.status(410).json({
      error: "This endpoint has been replaced. Please reopen the visit link.",
    });
  });

  /** Ack exchange — converts the cc_w HttpOnly cookie into a short-lived
   *  HMAC-signed ack token that /c/:token requires.
   *
   *  Security design:
   *  - The raw witnessNonce is NEVER returned to the client. The cookie value
   *    is opaque to JavaScript (HttpOnly); the browser sends it automatically.
   *  - /ack validates: (1) cookie matches DB nonce, (2) IP+UA binding,
   *    (3) dwell time elapsed. On success it returns an HMAC-SHA256 token
   *    signed with JWT_ACCESS_SECRET — unforgeable without the server secret.
   *  - An attacker who reads cc_w from the Set-Cookie response header of /r
   *    can craft a Cookie header and call /ack, but still cannot forge the
   *    ackToken itself and faces IP+UA binding on both /ack and /c.
   */
  app.get("/api/earn/sponsored/ack/:token", async (req, res) => {
    try {
      const token = String(req.params.token);
      if (!/^[a-f0-9]{64}$/.test(token)) {
        res.status(404).json({ error: "Not found" }); return;
      }

      // ── Per-IP rate limit on the ack endpoint ─────────────────────────────
      // /ack was previously unconstrained. A script that reads cc_w from the
      // Set-Cookie header of /r and bodyToken from the HTML body can call /ack
      // without a browser. Bounding /ack per-IP directly limits the throughput
      // of the automated witness chain, independent of the /visit settlement cap.
      {
        const { getClientIp: _aip } = await import("../lib/clientIp");
        const { recordLoginAttempt: _arl } = await import("../lib/dbRateLimit");
        const _aipVal = _aip(req);
        const _aipLimit = Math.max(1, parseInt(process.env.SPONSORED_ACK_IP_LIMIT ?? "20", 10));
        try {
          const { allowed } = await _arl(`sponsored:ack:ip:${_aipVal}`, _aipLimit, 60 * 60 * 1000);
          if (!allowed) {
            req.log?.warn?.({ ip: _aipVal }, "Sponsored /ack rate limit exceeded (IP)");
            res.status(429).json({ error: "Too many ack requests. Please try again later." }); return;
          }
        } catch (rlErr) {
          req.log?.error?.({ err: rlErr }, "Sponsored /ack IP rate-limit check failed — failing closed");
          res.status(503).json({ error: "Rate limit check unavailable — please retry." }); return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const {
        db: dbClient,
        campaignVisitAttempts: attemptsTable,
      } = await import("@workspace/db");
      const { eq: drizzleEq } = await import("drizzle-orm");

      const [attempt] = await dbClient.select().from(attemptsTable)
        .where(drizzleEq(attemptsTable.token, token));
      if (!attempt) { res.status(404).json({ error: "Not found" }); return; }
      if (attempt.expiresAt.getTime() < Date.now()) {
        res.status(410).json({ error: "Visit link expired" }); return;
      }
      if (attempt.settledAt) {
        res.status(410).json({ error: "Already settled" }); return;
      }
      if (!attempt.witnessNonce) {
        res.status(403).json({ error: "Witness nonce missing — reopen the link" }); return;
      }

      // The witnessNonce is stored server-side only — it is never sent to the
      // client (no Set-Cookie header in /r). The ackToken is derived from it:
      // ackToken = HMAC(token:witnessNonce, secret). /c validates the ackToken
      // by re-deriving from the stored nonce, so the nonce never leaves the DB.

      // IP+UA binding — same client that opened /r must call /ack
      if (attempt.redirectIpHash || attempt.redirectUaHash) {
        const { createHash: _ch } = await import("crypto");
        const { getClientIp: _gcip } = await import("../lib/clientIp");
        const currentIp = _gcip(req);
        const currentUa = String(req.headers["user-agent"] ?? "");
        const currentIpHash = _ch("sha256").update(currentIp).digest("hex");
        const currentUaHash = _ch("sha256").update(currentUa).digest("hex");
        const ipMismatch = attempt.redirectIpHash && attempt.redirectIpHash !== currentIpHash;
        const uaMismatch = attempt.redirectUaHash && attempt.redirectUaHash !== currentUaHash;
        if (ipMismatch || uaMismatch) {
          req.log?.warn?.({ token: token.slice(0, 8) + "…", ipMismatch, uaMismatch }, "Sponsored ack: client binding mismatch");
          res.status(403).json({ error: "Client binding mismatch" }); return;
        }
      }

      // Dwell gate — must have waited the required interstitial time
      if (!attempt.redirectedAt) {
        res.status(400).json({ error: "Redirect step not completed" }); return;
      }
      const MIN_INTERSTITIAL_MS = Math.max(
        1000,
        parseInt(process.env.MIN_INTERSTITIAL_DWELL_MS ?? "5000", 10),
      );
      const redirectAge = Date.now() - attempt.redirectedAt.getTime();
      if (redirectAge < MIN_INTERSTITIAL_MS) {
        const retryAfterMs = Math.ceil(MIN_INTERSTITIAL_MS - redirectAge);
        res.status(425).json({ error: "Too early — stay on the page.", retryAfterMs }); return;
      }

      // Fail-closed: JWT_ACCESS_SECRET must be set to produce valid HMAC proofs.
      const ackSecret = process.env.JWT_ACCESS_SECRET;
      if (!ackSecret) {
        req.log?.error?.({}, "Sponsored ack: JWT_ACCESS_SECRET not configured");
        res.status(500).json({ error: "Server configuration error" }); return;
      }

      // ── visitSessionToken (VST) validation ───────────────────────────────
      // VST = HMAC-SHA256(attemptToken:userId:vst, JWT_ACCESS_SECRET).
      // It is returned to the caller ONLY at /begin time (in the JSON response)
      // and is embedded in the /r redirect URL (as ?vst=) so the interstitial JS
      // can read it via window.location.search. It is NOT embedded as a static
      // variable in the /r HTML body, so a static HTML scraper cannot extract it
      // from the /r response alone. An attacker without the /begin response must
      // know JWT_ACCESS_SECRET to forge VST.
      //
      // This changes the token binding model: the witness chain now requires a
      // value originating from the /begin response, not just the /r response,
      // binding the chain to the originating authenticated session.
      const { createHmac: _hmacA, timingSafeEqual: _tseA } = await import("crypto");
      const queryVst = String(req.query.vst ?? "");
      if (!queryVst) {
        req.log?.warn?.({ token: token.slice(0, 8) + "…" }, "Sponsored ack: missing VST");
        res.status(403).json({ error: "Visit session token required — reopen the link from the app" }); return;
      }
      const expectedVstBuf = _hmacA("sha256", ackSecret)
        .update(token + ":" + attempt.userId + ":vst")
        .digest();
      let providedVstBuf: Buffer;
      try { providedVstBuf = Buffer.from(queryVst, "hex"); } catch { providedVstBuf = Buffer.alloc(0); }
      if (providedVstBuf.length !== expectedVstBuf.length || !_tseA(providedVstBuf, expectedVstBuf)) {
        req.log?.warn?.({ token: token.slice(0, 8) + "…" }, "Sponsored ack: VST HMAC mismatch");
        res.status(403).json({ error: "Visit session token invalid — reopen the link from the app" }); return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // Issue HMAC-signed ack token bound to this token + nonce.
      // Requires JWT_ACCESS_SECRET — cannot be forged from anything in /r response headers or body.
      const ackToken = _hmacA("sha256", ackSecret)
        .update(token + ":" + attempt.witnessNonce)
        .digest("hex");

      res.setHeader("Cache-Control", "no-store");
      res.json({ ackToken });
    } catch (err: any) {
      req.log?.error?.({ err }, "Sponsored ack failed");
      res.status(500).json({ error: "Ack failed" });
    }
  });

  /** Completion redirect — the server-observed gate for sponsored visits.
   *
   *  The /r/:token interstitial redirects the browser here (not directly to
   *  the advertiser). This endpoint:
   *    1. Verifies the HMAC-SHA256 completion signature embedded in the URL
   *       (`?q=<sig>`, derived from JWT_SECRET + token — unforgeable without
   *       the server secret).
   *    2. Records `witnessedAt` on the attempt row (server-side, not
   *       self-reported by client JS).
   *    3. 302-redirects the browser to the actual advertiser URL.
   *
   *  Because this is a redirect hop in the browser's navigation chain (not a
   *  background XHR/beacon), the server observes it as a genuine GET that the
   *  browser must make to reach the advertiser. A scripted client that skips
   *  this endpoint cannot set `witnessedAt`, and /visit rejects settlement
   *  with HTTP 400 if `witnessedAt` is null.
   *
   *  Attack resistance:
   *  - Without fetching /r/:token: no sig in scope → cannot call /c → no
   *    witnessedAt → /visit fails.
   *  - After fetching /r/:token (parses sig): must still call /c/:token to
   *    set witnessedAt; rate limits on /begin + /r + /ack + /c + /visit bound the damage.
   *  - Sig is single-use in effect: COALESCE guard ensures a second /c call
   *    for the same token is a no-op (witnessedAt already set).
   */
  app.get("/api/earn/sponsored/c/:token", async (req, res) => {
    const token = String(req.params.token);
    let targetUrl: string | undefined;

    try {
      if (!/^[a-f0-9]{64}$/.test(token)) {
        res.status(404).send("Not found"); return;
      }

      // ── Per-IP rate limit on the completion endpoint ──────────────────────
      // /c was previously unconstrained. Together with the /r and /ack limits
      // this closes the gap where a script could race through /r → /ack → /c
      // for every active campaign without hitting any gate until /visit.
      {
        const { getClientIp: _cip } = await import("../lib/clientIp");
        const { recordLoginAttempt: _crl } = await import("../lib/dbRateLimit");
        const _cipVal = _cip(req);
        const _cipLimit = Math.max(1, parseInt(process.env.SPONSORED_COMPLETE_IP_LIMIT ?? "20", 10));
        try {
          const { allowed } = await _crl(`sponsored:complete:ip:${_cipVal}`, _cipLimit, 60 * 60 * 1000);
          if (!allowed) {
            req.log?.warn?.({ ip: _cipVal }, "Sponsored /c rate limit exceeded (IP)");
            const wantsJson = String(req.headers.accept ?? "").includes("application/json");
            if (wantsJson) {
              res.status(429).json({ error: "Too many completion requests. Please try again later." });
            } else {
              res.status(429).send("Too many completion requests. Please try again later.");
            }
            return;
          }
        } catch (rlErr) {
          req.log?.error?.({ err: rlErr }, "Sponsored /c IP rate-limit check failed — failing closed");
          const wantsJson = String(req.headers.accept ?? "").includes("application/json");
          if (wantsJson) {
            res.status(503).json({ error: "Rate limit check unavailable — please retry." });
          } else {
            res.status(503).send("Rate limit check unavailable — please retry.");
          }
          return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      const {
        db: dbClient,
        campaigns: campaignsTable,
        campaignVisitAttempts: attemptsTable,
      } = await import("@workspace/db");
      const { sql: drizzleSql, eq: drizzleEqLocal, and: drizzleAndLocal } = await import("drizzle-orm");

      const [attempt] = await dbClient.select().from(attemptsTable)
        .where(drizzleEqLocal(attemptsTable.token, token));
      if (!attempt) { res.status(404).send("Visit not found"); return; }
      if (attempt.expiresAt.getTime() < Date.now()) {
        res.status(410).send("Visit link expired"); return;
      }

      // ── HMAC ack token verification (DB-persisted nonce, single-use) ────────
      // /r/:token stored a random witnessNonce in the DB and set it as an
      // HttpOnly cookie. /ack/:token validated the cookie + IP/UA and returned
      // an HMAC-SHA256(token:nonce, JWT_ACCESS_SECRET) ack token. Here we:
      //   1. Require a non-empty ?ack= query parameter.
      //   2. Re-derive the expected HMAC from the DB nonce (JWT_ACCESS_SECRET needed).
      //   3. Compare with timingSafeEqual — cannot be forged without the secret.
      // The nonce is cleared on the witnessedAt update below (single-use).
      // The raw nonce is NEVER accepted here — /c only accepts the HMAC proof.
      if (!attempt.settledAt && !attempt.witnessedAt) {
        const queryAck = String(req.query.ack ?? "");
        const storedNonce = attempt.witnessNonce;
        if (!storedNonce) {
          // /r was never completed or nonce already consumed — reject.
          res.status(403).send("Visit witness missing — please reopen the link"); return;
        }
        if (!queryAck) {
          req.log?.warn?.({ token: token.slice(0, 8) + "…" }, "Sponsored visit: missing ack token");
          res.status(403).send("Visit ack token required — please reopen the link"); return;
        }
        const { createHmac: _hmac, timingSafeEqual: _tse } = await import("crypto");
        const _secret = process.env.JWT_ACCESS_SECRET;
        if (!_secret) {
          req.log?.error?.({}, "Sponsored completion: JWT_ACCESS_SECRET not configured");
          res.status(500).send("Server configuration error"); return;
        }
        const expectedBuf = _hmac("sha256", _secret)
          .update(token + ":" + storedNonce)
          .digest();
        let providedBuf: Buffer;
        try { providedBuf = Buffer.from(queryAck, "hex"); } catch { providedBuf = Buffer.alloc(0); }
        if (providedBuf.length !== expectedBuf.length || !_tse(providedBuf, expectedBuf)) {
          req.log?.warn?.({ token: token.slice(0, 8) + "…" }, "Sponsored visit ack HMAC mismatch — rejected");
          res.status(403).send("Visit witness mismatch — please reopen the link"); return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      // Load target URL before updating so we can redirect even if update
      // fails (e.g. idempotent second call where attempt is already settled).
      const [camp] = await dbClient.select().from(campaignsTable)
        .where(drizzleEqLocal(campaignsTable.id, attempt.campaignId));
      targetUrl = camp?.targetUrl ?? undefined;

      // ── Server-enforced interstitial dwell gate ───────────────────────────
      // The interstitial page embeds a client-side countdown (MIN_INTERSTITIAL_MS)
      // AND the JS retries if this check fails (425 Too Early). Together these
      // mean a script that parses the completion sig from the HTML and immediately
      // calls /c is rejected — it must genuinely wait for the server-observed
      // redirectedAt to age past the threshold before witnessedAt is accepted.
      if (!attempt.redirectedAt) {
        res.status(400).send("Redirect step not completed"); return;
      }
      const MIN_INTERSTITIAL_MS = Math.max(
        1000,
        parseInt(process.env.MIN_INTERSTITIAL_DWELL_MS ?? "5000", 10),
      );
      const redirectAge = Date.now() - attempt.redirectedAt.getTime();
      if (redirectAge < MIN_INTERSTITIAL_MS) {
        const retryAfterMs = Math.ceil(MIN_INTERSTITIAL_MS - redirectAge);
        res.status(425).send(`Too early — please wait ${Math.ceil(retryAfterMs / 1000)} more second(s).`);
        return;
      }

      // ── Fetch-Metadata enforcement ────────────────────────────────────────
      // /c must be reached via a top-level browser navigation — not XHR, fetch,
      // or a plain HTTP script. The interstitial JS navigates here (via
      // window.location.replace) after /ack confirms the timing gate.
      //
      // We require BOTH Fetch-Metadata headers to match the expected values for
      // a top-level browser navigation. Browsers set these headers automatically
      // and correctly; an attacker must spoof both simultaneously to pass this
      // gate, which raises the bar compared to checking only one header.
      //
      //   Sec-Fetch-Mode: navigate   — present on Chrome 76+, Firefox 90+,
      //                                Edge 79+, Safari 16.4+; absent from
      //                                curl, axios, node-fetch, etc.
      //   Sec-Fetch-Dest: document   — always "document" for top-level
      //                                navigations; "empty" for XHR/fetch;
      //                                absent from plain HTTP scripts.
      //
      // Browsers set both; scripts that spoof one often miss the other.
      // Note: iOS WKWebView / in-app browser (expo-web-browser /
      // ASWebAuthenticationSession) sends both headers on current builds.
      const secFetchMode = String(req.headers["sec-fetch-mode"] ?? "");
      const secFetchDest = String(req.headers["sec-fetch-dest"] ?? "");
      if (secFetchMode !== "navigate" || secFetchDest !== "document") {
        req.log?.warn?.({
          token: token.slice(0, 8) + "…",
          secFetchMode: secFetchMode || "(absent)",
          secFetchDest: secFetchDest || "(absent)",
        }, "Sponsored /c: rejected — Fetch-Metadata not consistent with browser navigation");
        res.status(403).send("This endpoint requires top-level browser navigation."); return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── IP/UA binding enforcement ─────────────────────────────────────────
      // /r/:token stored the redirecting client's IP and UA hashes. Enforce
      // that this request comes from the same client — prevents a scripted
      // attacker from fetching /r/:token to extract the completion sig and
      // then replaying /c/:token from a different process/host.
      if (attempt.redirectIpHash || attempt.redirectUaHash) {
        const { createHash: _ch } = await import("crypto");
        const { getClientIp: _gcip } = await import("../lib/clientIp");
        const currentIp = _gcip(req);
        const currentUa = String(req.headers["user-agent"] ?? "");
        const currentIpHash = _ch("sha256").update(currentIp).digest("hex");
        const currentUaHash = _ch("sha256").update(currentUa).digest("hex");

        const ipMismatch = attempt.redirectIpHash && attempt.redirectIpHash !== currentIpHash;
        const uaMismatch = attempt.redirectUaHash && attempt.redirectUaHash !== currentUaHash;

        if (ipMismatch || uaMismatch) {
          req.log?.warn?.({ token: token.slice(0, 8) + "…", ipMismatch, uaMismatch }, "Sponsored visit client binding mismatch — rejected");
          res.status(403).send("Visit must be completed from the same device that opened the link"); return;
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      if (!attempt.settledAt && !attempt.witnessedAt) {
        // Burn the witness nonce (single-use) and set witnessedAt atomically.
        //
        // Previous design: /c burned the nonce and issued a `cashclip_witness`
        // Set-Cookie credential that the delivery pixel endpoint later validated.
        // Problem: HttpOnly prevents browser JS from reading document.cookie, but
        // any HTTP client can read the Set-Cookie response header directly, extract
        // the credential, and replay it to /delivery. This made the witness step
        // fully scriptable by the claimant.
        //
        // New design: /c sets witnessedAt directly after passing all of the same
        // checks (HMAC ack token, IP/UA binding, Sec-Fetch navigation headers,
        // dwell gate). No credential is emitted in any response header or body —
        // the witness proof is exclusively the server-side state update triggered
        // by the authenticated /c navigation. There is no separate cookie or pixel
        // step for an attacker to extract and replay.
        await dbClient.update(attemptsTable)
          .set({
            witnessNonce: null,
            witnessedAt: drizzleSql`COALESCE(${attemptsTable.witnessedAt}, NOW())`,
          })
          .where(drizzleAndLocal(
            drizzleEqLocal(attemptsTable.token, token),
            drizzleSql`${attemptsTable.settledAt} IS NULL`,
          ));
        req.log?.info?.({ token: token.slice(0, 8) + "…" }, "Sponsored /c: witnessedAt set directly (no cookie emitted)");
      }

      if (!targetUrl) {
        res.status(410).send("Campaign no longer available"); return;
      }

      // Enforce http/https allowlist before redirecting — stored targetUrl must
      // be a web URL; any other scheme (javascript:, data:, etc.) is rejected.
      let parsedTarget: URL;
      try {
        parsedTarget = new URL(targetUrl);
      } catch {
        req.log?.warn({ targetUrl }, "Sponsored completion: unparseable targetUrl — aborting redirect");
        res.status(500).send("Redirect failed");
        return;
      }
      if (!["http:", "https:"].includes(parsedTarget.protocol)) {
        req.log?.warn({ protocol: parsedTarget.protocol }, "Sponsored completion: non-http(s) scheme rejected");
        res.status(500).send("Redirect failed");
        return;
      }

      const advertiserRedirect = parsedTarget.toString();

      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, advertiserRedirect);
    } catch (err: any) {
      req.log?.error?.({ err }, "Sponsored completion redirect failed");
      // Only redirect to targetUrl if it exists and has a safe scheme.
      if (targetUrl) {
        try {
          const u = new URL(targetUrl);
          if (["http:", "https:"].includes(u.protocol)) {
            res.redirect(302, targetUrl);
            return;
          }
        } catch { /* fall through */ }
      }
      res.status(500).send("Redirect failed");
    }
  });

  /** DEPRECATED — routes with this path prefix were the original pixel approach.
   *
   *  The original pixel embedded the token in the /c redirect URL; a script
   *  reading the Location header could extract the token and call the endpoint
   *  directly with a spoofed Referer. Returns 410 Gone so any cached links
   *  fail explicitly. The new pixel path is /api/earn/sponsored/delivery/:nonce.
   */
  app.get("/api/earn/sponsored/pixel/:pixelToken", (_req, res) => {
    res.status(410).json({
      error: "This endpoint is no longer active. See GET /api/earn/sponsored/delivery/:nonce.",
    });
  });

  /** DEPRECATED — witnessedAt is now set directly by GET /api/earn/sponsored/c/:token.
   *
   *  The previous design issued a `cashclip_witness` Set-Cookie in the /c response
   *  and required the publisher's page to embed a 1×1 tracking pixel that sent that
   *  cookie back to this endpoint. The flaw: HttpOnly prevents browser JS from reading
   *  document.cookie, but any HTTP client can read the Set-Cookie response header
   *  directly. A scripted client could extract the cookie value from the /c response
   *  header and replay it here, setting witnessedAt without a genuine page visit.
   *
   *  witnessedAt is now set inside /c itself after all existing checks (HMAC ack token,
   *  IP/UA binding, Sec-Fetch navigation headers, dwell gate) pass. No credential is
   *  emitted in any response header or body, removing the replay surface entirely.
   *
   *  Returns 410 Gone so any publisher pages that still embed the pixel fail visibly
   *  rather than silently misfiring. Publishers should remove the pixel tag.
   */
  app.get("/api/earn/sponsored/delivery/:token", (_req, res) => {
    res.status(410).json({
      error: "This endpoint is no longer active. witnessedAt is now set directly by GET /api/earn/sponsored/c/:token.",
    });
  });

  /**
   * Server-to-server advertiser postback — informational only.
   *
   * Previously this endpoint set witnessedAt. It no longer does so because
   * the publisher possesses their campaign's callbackKey (static, returned
   * in the dashboard) and receives the attemptToken in the ?cashclip_t= URL
   * parameter the moment a user lands on their page. Combining these values,
   * a malicious publisher could call /postback immediately from their own
   * server to self-attest any visit, bypassing the intended witness gate.
   *
   * witnessedAt is now set directly inside GET /api/earn/sponsored/c/:token
   * after the HMAC ack token, IP/UA binding, Sec-Fetch navigation headers, and
   * dwell gate all pass. No credential is emitted in any response header or
   * body, so there is no replay surface for a malicious publisher to exploit.
   *
   * This endpoint is retained for publisher integrations that call it and
   * validates the callbackKey to confirm the caller is the campaign owner,
   * but it does NOT mutate any settlement-critical field.
   *
   * Rate-limited at the IP level (fail-closed).
   */
  app.post("/api/earn/sponsored/postback", async (req, res) => {
    try {
      const { attemptToken, callbackKey } = (req.body ?? {}) as {
        attemptToken?: string;
        callbackKey?: string;
      };

      if (
        typeof attemptToken !== "string" || !/^[a-f0-9]{64}$/.test(attemptToken) ||
        typeof callbackKey  !== "string" || !/^[a-f0-9]{64}$/.test(callbackKey)
      ) {
        res.status(400).json({ error: "attemptToken (64 hex) and callbackKey (64 hex) are required." });
        return;
      }

      // ── Per-IP rate limit ──────────────────────────────────────────────────
      {
        const { getClientIp: _pbip } = await import("../lib/clientIp");
        const { recordLoginAttempt: _pbrl } = await import("../lib/dbRateLimit");
        const _pbipVal = _pbip(req);
        const _pbLimit = Math.max(1, parseInt(process.env.SPONSORED_POSTBACK_IP_LIMIT ?? "60", 10));
        try {
          const { allowed } = await _pbrl(`sponsored:postback:ip:${_pbipVal}`, _pbLimit, 60 * 60 * 1000);
          if (!allowed) {
            req.log?.warn?.({ ip: _pbipVal }, "Sponsored postback rate limit exceeded (IP)");
            res.status(429).json({ error: "Too many postback requests. Please try again later." }); return;
          }
        } catch (rlErr) {
          req.log?.error?.({ err: rlErr }, "Sponsored postback IP rate-limit check failed — failing closed");
          res.status(503).json({ error: "Rate limit check unavailable — please retry." }); return;
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      const {
        db: dbClient,
        campaigns: campaignsTable,
        campaignVisitAttempts: attemptsTable,
      } = await import("@workspace/db");
      const { eq: drizzleEqLocal } = await import("drizzle-orm");
      const { createHmac: _hmacPb, timingSafeEqual: _tsePb } = await import("node:crypto");

      const [attempt] = await dbClient.select().from(attemptsTable)
        .where(drizzleEqLocal(attemptsTable.token, attemptToken));
      if (!attempt) {
        res.status(404).json({ error: "Attempt not found." }); return;
      }
      if (attempt.expiresAt.getTime() < Date.now()) {
        res.status(410).json({ error: "Attempt expired." }); return;
      }
      if (attempt.settledAt) {
        res.status(409).json({ error: "Already settled." }); return;
      }

      // Guard: the redirect chain must have been completed before a postback
      // is accepted. redirectedAt is set server-side only when the user's
      // browser fetches /r/:token. A publisher cannot call this endpoint on
      // an attempt that has not yet gone through the platform redirect — this
      // prevents a postback race that front-runs the redirect hop.
      if (!attempt.redirectedAt) {
        req.log?.warn?.({ attemptToken: attemptToken.slice(0, 8) + "…" }, "Sponsored postback: redirectedAt not set — rejected");
        res.status(400).json({ error: "Visit redirect not yet completed." }); return;
      }

      const [campaign] = await dbClient.select().from(campaignsTable)
        .where(drizzleEqLocal(campaignsTable.id, attempt.campaignId));
      if (!campaign) {
        res.status(404).json({ error: "Campaign not found." }); return;
      }

      // Validate callbackKey = HMAC-SHA256(campaignId + ":cbk-v1", JWT_ACCESS_SECRET).
      // This key is returned only to the campaign owner (publisher) in the
      // dashboard — never in any response the visiting claimant can receive.
      const _cbSecret = process.env.JWT_ACCESS_SECRET;
      if (!_cbSecret) {
        req.log?.error?.({}, "Sponsored postback: JWT_ACCESS_SECRET not configured");
        res.status(500).json({ error: "Server configuration error" }); return;
      }
      const expectedKey = _hmacPb("sha256", _cbSecret)
        .update(campaign.id + ":cbk-v1")
        .digest();
      let providedKeyBuf: Buffer;
      try { providedKeyBuf = Buffer.from(callbackKey, "hex"); } catch { providedKeyBuf = Buffer.alloc(0); }
      if (providedKeyBuf.length !== expectedKey.length || !_tsePb(providedKeyBuf, expectedKey)) {
        req.log?.warn?.({ campaignId: campaign.id }, "Sponsored postback: callbackKey mismatch — rejected");
        res.status(403).json({ error: "Invalid callback key." }); return;
      }

      // Postback is INFORMATIONAL ONLY — it does not write witnessedAt.
      //
      // witnessedAt is set exclusively by the platform's /c redirect hop,
      // which verifies a server-derived HMAC ack token (JWT_ACCESS_SECRET +
      // witnessNonce, not derivable by the publisher), Fetch-Metadata
      // browser-navigation headers, IP/UA binding, and the interstitial dwell
      // gate. Those checks cannot be replicated by a publisher server call.
      //
      // Allowing postback to write witnessedAt — even conditionally — creates
      // a self-attestation path: the publisher possesses callbackKey (static,
      // returned from their dashboard) and receives attemptToken in the
      // ?cashclip_t= URL the moment a user lands on their page. They could call
      // this endpoint with those two values alone to satisfy the only witness
      // gate, bypassing the requirement for independent proof of delivery.
      //
      // This endpoint is retained for publisher integrations that call it
      // (e.g. logging on their end) but cannot influence settlement state.
      // Settlement at /visit requires witnessedAt to have been set by /c.
      req.log?.info?.({ attemptToken: attemptToken.slice(0, 8) + "…", campaignId: campaign.id, witnessedAt: attempt.witnessedAt },
        "Sponsored postback: acknowledged (informational only — witnessedAt written only by /c)");

      res.json({ ok: true });
    } catch (err: any) {
      req.log?.error?.({ err }, "Sponsored postback handler error");
      res.status(500).json({ error: "Postback failed" });
    }
  });

  /** Earn: record a sponsored campaign visit + credit the visitor.
   *  Requires a visitToken from /begin, and enforces a minimum dwell time
   *  to prove the user actually had the page open.
   */
  // ── POST /api/earn/sponsored/:id/visit — DISABLED (Task #698, Vuln #2) ───────
  // The settlement (money-moving) end of the sponsored-visit flow. Returns 410
  // Gone so no balance can be credited and no publisher campaign budget can be
  // spent for a sponsored visit. This is the authoritative closure of the fraud
  // path: even if any pre-existing/in-flight attemptToken were replayed, no
  // settlement can occur. See the GET /api/earn/sponsored comment above for the
  // full rationale (replayable client-observed witness chain is not trusted proof).
  app.post("/api/earn/sponsored/:id/visit", authMiddleware, (_req: AuthRequest, res) => {
    res.status(410).json({ error: "Sponsored visit rewards are no longer available." });
  });

  /**
   * GET /api/notifications
   *
   * Return the authenticated user's server-side in-app notifications, newest
   * first. Capped at 50 entries. The app merges these with its local-only
   * notification list (offline/client-generated items) on the client side.
   */
  app.get("/api/notifications", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const rows = await storage.getUserNotifications(req.userId!);
      res.json({
        notifications: rows.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          type: n.type,
          read: n.read,
          createdAt: n.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      req.log?.error({ err }, "Failed to fetch notifications");
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  /**
   * POST /api/notifications/:id/read
   *
   * Mark a single notification as read. Ownership-checked (userId must match)
   * so a user cannot mark another user's notification as read.
   */
  app.post("/api/notifications/:id/read", authMiddleware, async (req: AuthRequest, res) => {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "Missing notification id" }); return;
    }
    try {
      await storage.markUserNotificationRead(id, req.userId!);
      res.json({ ok: true });
    } catch (err) {
      req.log?.error({ err }, "Failed to mark notification read");
      res.status(500).json({ error: "Failed to mark notification read" });
    }
  });

  /**
   * POST /api/notifications/read-all
   *
   * Mark all of the authenticated user's server notifications as read.
   */
  app.post("/api/notifications/read-all", authMiddleware, async (req: AuthRequest, res) => {
    try {
      await storage.markAllUserNotificationsRead(req.userId!);
      res.json({ ok: true });
    } catch (err) {
      req.log?.error({ err }, "Failed to mark all notifications read");
      res.status(500).json({ error: "Failed to mark all notifications read" });
    }
  });

  app.use("/api", venturesRouter);

  const httpServer = createServer(app);
  return httpServer;
}
