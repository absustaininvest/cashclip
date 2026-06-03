import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import jwt from "jsonwebtoken";
import { getIntegrationStatuses, getIntegrationSummary, integrations } from "../integrations";
import {
  persistIntegrationKey,
  deletePersistedIntegrationKey,
  isIntegrationKeyPersisted,
  rotateEncryptionSecret,
  getIntegrationKeyHealth,
} from "../lib/integrationKeyStore";
import { verifyIntegrationKey } from "../lib/integrationVerify";
import { secretsPassphraseMiddleware } from "../lib/secretsPassphrase";
import { sponsoredBeginRateLimiter } from "../lib/sponsoredVisitRateLimit";
import {
  setVerificationState,
  clearVerificationState,
} from "../lib/integrationVerificationState";
import { registerAuthRoutes, authMiddleware, adminMiddleware, type AuthRequest } from "../auth";
import { storage, SECURITY_AUDIT_EVENTS, type SecurityAuditEvent } from "../storage";
import { db, updateUserProfileSchema } from "@workspace/db";
import { AD_CATEGORIES, adCategorySchema } from "@workspace/api-zod";
import { buildDemographicEntryUrl } from "../lib/demographicUrl";
import venturesRouter from "./ventures";
import { sendPayPalPayout, isPayPalConfigured, verifyPayPalWebhook, verifyWebhookRegistration } from "../paypal";
import { isRelayEmail } from "../lib/emailValidation";
import { logWebhookVerificationFailure } from "../lib/webhookAuth";
import { recordLoginAttempt } from "../lib/dbRateLimit";
import { registerSurveyRoutes } from "../surveys";
import { registerOfferwallRoutes } from "../offerwalls";
import { registerEarningsRoutes } from "./earnings";
import { maybeSendThresholdPush } from "../lib/push";
import { resolveTierForAmount, getAvailableTiers, WITHDRAWAL_TIERS, DAILY_WITHDRAWAL_MAX } from "../withdrawalTiers";
import { sendWithdrawalRequestedAdmin, sendWithdrawalStatusUpdate, sendSupportTicket, sendPasswordChangedNotice } from "../lib/email";
import { publicLeadRateLimiter } from "../lib/publicLeadRateLimit";
import {
  getRecentRejections,
  getRecentAlerts,
  getRejectionSummary,
} from "../lib/webhookAlerts";
import { fetchInbox } from "../lib/inbox";
import { count as drizzleCount, eq as drizzleEq, and as drizzleAnd, ne as drizzleNe } from "drizzle-orm";

interface RevenueSource {
  id: string;
  name: string;
  type: string;
  description: string;
  icon: string;
  allocationPercent: number;
  active: boolean;
  monthlyEstimate: number;
}


interface RevenueAllocation {
  userPayouts: number;
  operations: number;
  growth: number;
  reserve: number;
}

interface FundingMetrics {
  totalRevenueSources: number;
  activePartners: number;
  monthlyProjected: number;
  userPayoutRate: number;
  selfSufficiencyScore: number;
}

function getHealthCheckUrl(integrationId: string): string | null {
  const urls: Record<string, string> = {
    paypal: process.env.PAYPAL_MODE === "live"
      ? "https://api-m.paypal.com/v1/oauth2/token"
      : "https://api-m.sandbox.paypal.com/v1/oauth2/token",
    pollfish: "https://api.pollfish.com/v2",
    cint: "https://api.cint.com/v1",
    lucid: "https://api.samplicio.us/supply/v1",
    tapjoy: "https://app.tapjoy.com/publisher/v1",
    adgate: "https://wall.adgaterewards.com/api/v1",
    offertoro: "https://www.offertoro.com/api/v1",
  };
  return urls[integrationId] ?? null;
}

export async function registerRoutes(app: Express): Promise<Server> {
  registerAuthRoutes(app);
  registerSurveyRoutes(app);
  registerOfferwallRoutes(app);
  registerEarningsRoutes(app);

  // ── Startup migration: backfill postback_secret for all campaigns ────────
  // All new campaigns receive a postbackSecret auto-generated at creation.
  // This migration assigns one to any pre-existing row that was created
  // before this deploy (postback_secret IS NULL). It runs synchronously and
  // is awaited before any route serves requests. If it fails, /begin rejects
  // new attempts on any campaign still missing a postbackSecret (see the
  // guard in /api/earn/sponsored/:id/begin below) so null-secret campaigns
  // cannot enter the visit flow at all — not just be refused at settlement.
  try {
    const { db: _mDb } = await import("@workspace/db");
    const { sql: _mSql } = await import("drizzle-orm");
    const migResult = await _mDb.execute(
      _mSql`UPDATE campaigns
            SET postback_secret = replace(gen_random_uuid()::text, '-', '')
                               || replace(gen_random_uuid()::text, '-', '')
            WHERE postback_secret IS NULL`
    );
    const migCount = (migResult as any).rowCount ?? 0;
    if (migCount > 0) {
      console.info(`[startup] postback_secret migration: assigned secret to ${migCount} campaign(s).`);
    }
  } catch (migErr) {
    console.error("[startup] postback_secret migration failed — /begin will reject attempts on null-secret campaigns:", migErr);
  }

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

  const revenueSources: RevenueSource[] = [
    {
      id: "video_ads",
      name: "Video Advertisements",
      type: "ads",
      description: "Revenue from in-app video ad placements via Google AdMob, Unity Ads, and IronSource mediation",
      icon: "play-circle",
      allocationPercent: 30,
      active: true,
      monthlyEstimate: 8500,
    },
    {
      id: "survey_partners",
      name: "Partner Surveys",
      type: "surveys",
      description: "Pollfish, Cint, and Lucid survey integrations providing paid research opportunities",
      icon: "clipboard",
      allocationPercent: 22,
      active: true,
      monthlyEstimate: 6200,
    },
    {
      id: "affiliate",
      name: "Affiliate Programs",
      type: "affiliate",
      description: "CPA and CPI affiliate networks including Tapjoy, AdGate, and OfferToro",
      icon: "link",
      allocationPercent: 16,
      active: true,
      monthlyEstimate: 4500,
    },
    {
      id: "data_insights",
      name: "Anonymized Data Insights",
      type: "data",
      description: "Aggregated, anonymized user trend analytics sold to market research firms",
      icon: "bar-chart-2",
      allocationPercent: 14,
      active: true,
      monthlyEstimate: 3900,
    },
  ];

  const allocation: RevenueAllocation = {
    userPayouts: 55,
    operations: 20,
    growth: 15,
    reserve: 10,
  };

  app.get("/api/revenue/sources", (_req, res) => {
    res.json({ sources: revenueSources });
  });

  app.get("/api/revenue/allocation", (_req, res) => {
    res.json({ allocation });
  });

  app.get("/api/revenue/metrics", (_req, res) => {
    const totalMonthly = revenueSources.reduce((sum, s) => sum + s.monthlyEstimate, 0);
    const metrics: FundingMetrics = {
      totalRevenueSources: revenueSources.length,
      activePartners: revenueSources.filter((s) => s.active).length,
      monthlyProjected: totalMonthly,
      userPayoutRate: allocation.userPayouts,
      selfSufficiencyScore: 92,
    };
    res.json({ metrics });
  });

  app.get("/api/revenue/transparency", (_req, res) => {
    const totalMonthly = revenueSources.reduce((sum, s) => sum + s.monthlyEstimate, 0);
    res.json({
      model: "Multi-stream passive revenue",
      totalMonthlyRevenue: totalMonthly,
      userPayoutPool: Math.round(totalMonthly * allocation.userPayouts / 100),
      operationsCost: Math.round(totalMonthly * allocation.operations / 100),
      growthFund: Math.round(totalMonthly * allocation.growth / 100),
      reserveFund: Math.round(totalMonthly * allocation.reserve / 100),
      sources: revenueSources.map((s) => ({
        name: s.name,
        type: s.type,
        share: `${s.allocationPercent}%`,
        monthly: s.monthlyEstimate,
        status: s.active ? "Active" : "Inactive",
      })),
      withdrawalTiers: [
        { amount: 5, bonus: "0%", tier: "Minimum" },
        { amount: 10, bonus: "+3%", tier: "Smart" },
        { amount: 25, bonus: "+5%", tier: "Popular" },
        { amount: 50, bonus: "+8%", tier: "Best Value" },
        { amount: 100, bonus: "+12%", tier: "VIP" },
        { amount: 250, bonus: "+15%", tier: "Elite" },
      ],
    });
  });

  app.get("/api/revenue/margin", (_req, res) => {
    const grossRevenue = revenueSources.reduce((sum, s) => sum + s.monthlyEstimate, 0);

    const revenueBreakdown = revenueSources.map((s) => ({
      source: s.name,
      monthly: s.monthlyEstimate,
      share: `${s.allocationPercent}%`,
    }));

    const userPayouts = Math.round(grossRevenue * 0.55);
    const avgBonusCost = Math.round(userPayouts * 0.04);
    const totalUserCost = userPayouts + avgBonusCost;

    const serverInfra = 1200;
    const paymentProcessing = Math.round(userPayouts * 0.029 + 200);
    const adNetworkFees = Math.round(revenueSources[0].monthlyEstimate * 0.15);
    const surveyPlatformFees = Math.round(revenueSources[1].monthlyEstimate * 0.10);
    const supportAdmin = 850;
    const totalOperatingCosts = serverInfra + paymentProcessing + adNetworkFees + surveyPlatformFees + supportAdmin;

    const marketingAcquisition = 1800;
    const referralPayouts = 600;
    const totalGrowthSpend = marketingAcquisition + referralPayouts;

    const reserveContribution = Math.round(grossRevenue * 0.04);

    const totalExpenses = totalUserCost + totalOperatingCosts + totalGrowthSpend + reserveContribution;
    const netProfit = grossRevenue - totalExpenses;
    const netMargin = parseFloat(((netProfit / grossRevenue) * 100).toFixed(1));

    res.json({
      summary: {
        grossRevenue,
        totalExpenses,
        netProfit,
        netMarginPercent: netMargin,
        profitable: netProfit > 0,
        selfSufficient: netMargin > 5,
        monthlyBreakeven: Math.round(totalExpenses / 30),
      },
      revenueStreams: {
        label: "Gross Monthly Revenue",
        total: grossRevenue,
        breakdown: revenueBreakdown,
      },
      expenses: {
        userPayouts: {
          label: "User Payouts (55% of revenue)",
          basePayout: userPayouts,
          avgTierBonusCost: avgBonusCost,
          subtotal: totalUserCost,
          note: "Tier bonuses average ~4% on top of base payouts based on withdrawal distribution",
        },
        operations: {
          label: "Operating Costs",
          serverInfrastructure: serverInfra,
          paymentProcessingFees: paymentProcessing,
          adNetworkFees,
          surveyPlatformFees,
          supportAndAdmin: supportAdmin,
          subtotal: totalOperatingCosts,
        },
        growth: {
          label: "Growth & Acquisition",
          marketingAndUA: marketingAcquisition,
          referralBonuses: referralPayouts,
          subtotal: totalGrowthSpend,
        },
        reserve: {
          label: "Reserve Fund Contribution",
          monthly: reserveContribution,
          note: "4% set aside for payout insurance and seasonal revenue dips",
        },
        totalExpenses,
      },
      profitability: {
        netProfit,
        netMarginPercent: netMargin,
        annualizedProfit: netProfit * 12,
        dailyBreakeven: Math.round(totalExpenses / 30),
        runwayMonths: "Indefinite (self-sustaining)",
        revenuePerUser: parseFloat((grossRevenue / 12400).toFixed(2)),
        costPerUser: parseFloat((totalExpenses / 12400).toFixed(2)),
        profitPerUser: parseFloat((netProfit / 12400).toFixed(2)),
      },
      scalingNotes: [
        "User payouts scale linearly with revenue - margin stays stable as user base grows",
        "Server costs grow sub-linearly - infrastructure handles 5x current load",
        "Ad eCPMs increase with larger audience, improving per-user revenue at scale",
        "Survey partner payouts improve with volume commitments above 10K monthly completions",
        "Payment processing fees decrease with volume tier upgrades at $25K+ monthly",
      ],
    });
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

  interface HealthCheckResult {
    id: string;
    name: string;
    category: string;
    reachable: boolean;
    httpStatus: number | undefined;
    latencyMs: number;
    error: string | undefined;
  }

  app.get("/api/integrations/health", adminMiddleware, async (_req, res) => {
    const statuses = getIntegrationStatuses();
    const configured = statuses.filter((s) => s.connected);

    if (configured.length === 0) {
      res.json({
        message: "No integrations configured yet. Add API keys to enable provider connectivity checks.",
        results: [],
      }); return;
    }

    const checks = await Promise.allSettled(
      configured.map(async (integration): Promise<HealthCheckResult> => {
        const start = Date.now();
        let reachable = false;
        let error: string | undefined;
        let httpStatus: number | undefined;

        try {
          const testUrl = getHealthCheckUrl(integration.id);
          if (testUrl) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const resp = await fetch(testUrl, {
              method: "HEAD",
              signal: controller.signal,
            }).catch(() => null);
            clearTimeout(timeout);
            if (resp) {
              httpStatus = resp.status;
              reachable = resp.status < 500;
            }
          } else {
            reachable = true;
          }
        } catch (err: unknown) {
          error = err instanceof Error ? err.message : "Connection failed";
        }

        return {
          id: integration.id,
          name: integration.name,
          category: integration.category,
          reachable,
          httpStatus,
          latencyMs: Date.now() - start,
          error,
        };
      }),
    );

    const results: HealthCheckResult[] = checks
      .filter((r): r is PromiseFulfilledResult<HealthCheckResult> => r.status === "fulfilled")
      .map((r) => r.value);

    res.json({
      checkedAt: new Date().toISOString(),
      total: results.length,
      reachable: results.filter((r) => r.reachable).length,
      unreachable: results.filter((r) => !r.reachable).length,
      results,
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

      req.log.warn(
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
    req.log.info(
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

    if (integration.envKey === "PAYPAL_WEBHOOK_ID") {
      verifyWebhookRegistration()
        .then((result) => {
          if (result.ok) {
            req.log.info(
              { webhookId: result.webhookId },
              "PayPal webhook registration re-checked after key update: OK",
            );
          } else {
            req.log.warn(
              { webhookId: result.webhookId, warnings: result.warnings, error: result.error },
              "PayPal webhook registration re-checked after key update: issues found",
            );
          }
        })
        .catch((err: unknown) => {
          req.log.error({ err }, "PayPal webhook re-check failed after PAYPAL_WEBHOOK_ID update");
        });
    }
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
    req.log.info(
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

    if (integration.envKey === "PAYPAL_WEBHOOK_ID") {
      verifyWebhookRegistration()
        .then((result) => {
          req.log.info(
            { webhookId: result.webhookId, ok: result.ok },
            "PayPal webhook registration re-checked after PAYPAL_WEBHOOK_ID deletion",
          );
        })
        .catch((err: unknown) => {
          req.log.error({ err }, "PayPal webhook re-check failed after PAYPAL_WEBHOOK_ID deletion");
        });
    }
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

      req.log.info(
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
      req.log.error({ err, userId: req.userId }, "Integration key store rotation failed");
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
      const updated = await storage.updateUserProfile(req.userId!, parsed.data);
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
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.get("/api/balance", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { balance, totalEarned } = await storage.getUserBalance(req.userId!);
      const tiers = getAvailableTiers(balance);
      res.json({ balance, totalEarned, tiers, allTiers: WITHDRAWAL_TIERS });
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
        res.status(400).json({ error: "Invalid PayPal email" }); return;
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

      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);

      const result = await storage.createWithdrawalAtomic({
        userId: req.userId!,
        username: user.username,
        amount: tier.amount,
        bonusPercent: tier.bonusPercent.toFixed(2),
        bonusAmount: tier.bonusAmount.toFixed(2),
        totalPayout: tier.totalPayout.toFixed(2),
        paypalEmail: paypalEmail.trim(),
        dailyCapMax: DAILY_WITHDRAWAL_MAX,
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
        res.status(400).json({ error: "Insufficient balance", balance: result.balance }); return;
      }

      res.status(201).json({ withdrawal: result.withdrawal, balance: result.balance });
      sendWithdrawalRequestedAdmin({
        id: result.withdrawal.id,
        username: user.username,
        amount: tier.amount.toFixed(2),
        totalPayout: tier.totalPayout.toFixed(2),
        paypalEmail: paypalEmail.trim(),
      }).catch(() => {});
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
        sendWithdrawalStatusUpdate({
          toEmail: claimed.paypalEmail,
          username: claimed.username,
          amount: claimed.amount,
          totalPayout: claimed.totalPayout,
          status: "rejected",
          adminNote: adminNote ?? undefined,
        }).catch(() => {});
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
        });
      } else if (result.ambiguous) {
        // The request was dispatched but the outcome is uncertain (network
        // timeout, connection drop, or duplicate batch detected). Do NOT roll
        // back to "approved" — the withdrawal stays in "paying" so it cannot
        // be retried and potentially double-paid. An admin must verify the
        // payment status directly in PayPal and then manually resolve it.
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

  /**
   * GET /api/admin/paypal/webhook-health
   *
   * Returns the most-recent result of the startup PayPal webhook registration
   * check (ID validity, URL match, required event subscriptions). The check
   * runs once at startup; this endpoint surfaces the cached result so the
   * admin dashboard can display it without re-calling PayPal. Call
   * POST /api/admin/paypal/webhook-health/refresh to force a live re-check.
   */
  app.get("/api/admin/paypal/webhook-health", adminMiddleware, async (_req: AuthRequest, res) => {
    const { getCachedWebhookRegistrationResult } = await import("../paypal");
    const cached = getCachedWebhookRegistrationResult();
    if (!cached) {
      res.json({ checked: false, message: "Startup check has not run yet or PayPal is not configured" });
      return;
    }
    res.json({ checked: true, ...cached });
  });

  app.post("/api/admin/paypal/webhook-health/refresh", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { verifyWebhookRegistration } = await import("../paypal");
      const result = await verifyWebhookRegistration();
      if (!result.ok) {
        req.log.warn({ warnings: result.warnings, error: result.error }, "PayPal webhook registration re-check: issues found");
      } else {
        req.log.info({ webhookId: result.webhookId }, "PayPal webhook registration re-check: OK");
      }
      res.json({ checked: true, ...result });
    } catch (err: any) {
      req.log.error({ err }, "Failed to re-check PayPal webhook registration");
      res.status(500).json({ error: "Failed to re-check PayPal webhook registration" });
    }
  });

  app.post("/api/admin/paypal-ping", adminMiddleware, async (req: AuthRequest, res) => {
    const { pingPayPal } = await import("../paypal");
    const result = await pingPayPal();
    res.status(result.ok ? 200 : 502).json(result);
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

      const verification = await verifyPayPalWebhook(
        req.headers as Record<string, string | string[] | undefined>,
        rawBody,
      );
      if (!verification.ok) {
        logWebhookVerificationFailure(req, "paypal", verification.reason ?? "unknown");
        res.status(400).json({ error: "Webhook verification failed" }); return;
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

      const SUCCESS_EVENTS = new Set([
        "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        "PAYMENT.PAYOUTSBATCH.SUCCESS",
      ]);

      if (SUCCESS_EVENTS.has(eventType)) {
        await storage.updateWithdrawalStatusIfStatus(
          withdrawal.id,
          ["paying"],
          "paid",
          `PayPal webhook: ${eventType}`,
        );
        sendWithdrawalStatusUpdate({
          toEmail: withdrawal.paypalEmail,
          username: withdrawal.username,
          amount: withdrawal.amount,
          totalPayout: withdrawal.totalPayout,
          status: "paid",
        }).catch(() => {});
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
          sendWithdrawalStatusUpdate({
            toEmail: claimed.paypalEmail,
            username: claimed.username,
            amount: claimed.amount,
            totalPayout: claimed.totalPayout,
            status: "rejected",
            adminNote: `PayPal payout failed: ${eventType}`,
          }).catch(() => {});
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
      });

      req.log?.info(
        { adminId: req.userId, targetUserId: target.id, amount: amt },
        "admin credited user balance",
      );

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
      await db.transaction(async (tx) => {
        await storage.updateUserPassword(userId, hashed, tx);
        if (req.userId) {
          await storage.recordSecurityAudit({
            actorUserId: req.userId,
            targetUserId: userId,
            event: "admin_password_reset",
            ip: getClientIp(req),
          }, tx);
        }
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
      const { tokenVersion } = await db.transaction(async (tx) => {
        const result = await storage.factoryResetUser(userId, hashed, tx);
        if (req.userId) {
          await storage.recordSecurityAudit({
            actorUserId: req.userId,
            targetUserId: userId,
            event: "admin_factory_reset",
            ip: getClientIp(req),
          }, tx);
        }
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

  app.post("/api/ad-events", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const { event, adUnitType, rewardAmount, rewardType, errorCode, errorMessage, durationMs, platform } = req.body;

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
      });

      res.status(201).json({ id: adEvent.id });
    } catch (err) {
      req.log.error({ err }, "Failed to record ad event");
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
        });
        ids.push(adEvent.id);
      }

      res.status(201).json({ recorded: ids.length });
    } catch (err) {
      req.log.error({ err }, "Failed to record ad events batch");
      res.status(500).json({ error: "Failed to record ad events" });
    }
  });

  app.get("/api/ad-stats", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const stats = await storage.getUserAdStats(req.userId!);
      res.json(stats);
    } catch (err) {
      req.log.error({ err }, "Failed to get user ad stats");
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
      req.log.error({ err }, "Failed to get ad analytics");
      res.status(500).json({ error: "Failed to load ad analytics" });
    }
  });

  /** Admin: sponsored-visit settlement health check.
   *  Returns success/failure counts drawn from campaign_clicks and
   *  campaign_visit_attempts so the owner can spot settlement regressions
   *  without reading raw logs.
   */
  app.get("/api/admin/health/sponsored-visits", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const { db: dbClient } = await import("@workspace/db");
      const { sql: rawSql } = await import("drizzle-orm");

      const [stats24h, stats7d, activeCampaigns, recentSettlements, expiredAttempts] = await Promise.all([
        dbClient.execute(rawSql`
          SELECT
            COUNT(*)::int AS success_count,
            COALESCE(SUM(reward_granted), 0)::text AS total_reward
          FROM campaign_clicks
          WHERE created_at >= NOW() - INTERVAL '24 hours'
        `),
        dbClient.execute(rawSql`
          SELECT
            COUNT(*)::int AS success_count,
            COALESCE(SUM(reward_granted), 0)::text AS total_reward
          FROM campaign_clicks
          WHERE created_at >= NOW() - INTERVAL '7 days'
        `),
        dbClient.execute(rawSql`
          SELECT COUNT(*)::int AS active_count FROM campaigns WHERE status = 'active'
        `),
        dbClient.execute(rawSql`
          SELECT
            cc.id,
            cc.campaign_id,
            c.title AS campaign_title,
            cc.reward_granted::text,
            cc.created_at
          FROM campaign_clicks cc
          LEFT JOIN campaigns c ON c.id = cc.campaign_id
          ORDER BY cc.created_at DESC
          LIMIT 20
        `),
        dbClient.execute(rawSql`
          SELECT
            COUNT(*)::int AS total_expired,
            COUNT(*) FILTER (WHERE redirected_at IS NULL)::int AS not_redirected,
            COUNT(*) FILTER (WHERE redirected_at IS NOT NULL AND witnessed_at IS NULL)::int AS redirected_not_witnessed,
            COUNT(*) FILTER (WHERE witnessed_at IS NOT NULL AND settled_at IS NULL)::int AS witnessed_not_settled
          FROM campaign_visit_attempts
          WHERE expires_at < NOW()
            AND settled_at IS NULL
            AND created_at >= NOW() - INTERVAL '24 hours'
        `),
      ]);

      const s24 = stats24h.rows[0] as { success_count: number; total_reward: string };
      const s7  = stats7d.rows[0]  as { success_count: number; total_reward: string };
      const actC = activeCampaigns.rows[0] as { active_count: number };
      const exp  = expiredAttempts.rows[0] as {
        total_expired: number;
        not_redirected: number;
        redirected_not_witnessed: number;
        witnessed_not_settled: number;
      };

      const { readSponsoredVisitAlertLastSent } = await import("../lib/sponsoredVisitMonitor");
      const alertLastSent = await readSponsoredVisitAlertLastSent();

      res.json({
        generatedAt: new Date().toISOString(),
        alertLastSent: alertLastSent ? alertLastSent.toISOString() : null,
        window24h: {
          successCount: s24.success_count,
          totalRewardUsd: parseFloat(s24.total_reward).toFixed(2),
        },
        window7d: {
          successCount: s7.success_count,
          totalRewardUsd: parseFloat(s7.total_reward).toFixed(2),
        },
        activeCampaigns: actC.active_count,
        expiredAttempts24h: {
          total: exp.total_expired,
          notRedirected: exp.not_redirected,
          redirectedNotWitnessed: exp.redirected_not_witnessed,
          witnessedNotSettled: exp.witnessed_not_settled,
        },
        recentSettlements: recentSettlements.rows.map((r: any) => ({
          id: r.id as string,
          campaignId: r.campaign_id as string,
          campaignTitle: (r.campaign_title as string | null) ?? "Unknown",
          rewardGranted: r.reward_granted as string,
          createdAt: r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
        })),
      });
    } catch (err) {
      req.log.error({ err }, "Failed to get sponsored visit health");
      res.status(500).json({ error: "Failed to load health data" });
    }
  });

  app.post("/api/admin/health/sponsored-visits/reset-alert", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    try {
      const { clearSponsoredVisitAlertDebounce } = await import("../lib/sponsoredVisitMonitor");
      await clearSponsoredVisitAlertDebounce();
      req.log.info({ adminId: req.userId }, "Sponsored-visit alert debounce cleared by admin");
      if (req.userId) {
        const { getClientIp } = await import("../lib/clientIp");
        storage.recordSecurityAudit({
          actorUserId: req.userId,
          event: "sponsored_visit_alert_reset",
          ip: getClientIp(req),
        }).catch((auditErr) => {
          req.log.error({ err: auditErr }, "Failed to write audit log for sponsored-visit alert reset");
        });
      }
      res.json({ cleared: true });
    } catch (err) {
      req.log.error({ err }, "Failed to clear sponsored-visit alert debounce");
      res.status(500).json({ error: "Failed to clear alert debounce" });
    }
  });

  app.post("/api/admin/monitor/sponsored-visit", adminMiddleware, async (req: AuthRequest, res): Promise<void> => {
    const { action } = req.body as { action?: string };
    if (action !== "start" && action !== "stop") {
      res.status(400).json({ error: 'action must be "start" or "stop"' });
      return;
    }
    const {
      startSponsoredVisitAlertMonitor,
      stopSponsoredVisitAlertMonitor,
      isSponsoredVisitAlertMonitorRunning,
    } = await import("../lib/sponsoredVisitMonitor");
    if (action === "stop") {
      stopSponsoredVisitAlertMonitor();
      req.log.info({ adminId: req.userId }, "Sponsored-visit alert monitor stopped by admin");
      res.json({ running: false });
    } else {
      await startSponsoredVisitAlertMonitor();
      req.log.info({ adminId: req.userId }, "Sponsored-visit alert monitor started by admin");
      res.json({ running: isSponsoredVisitAlertMonitorRunning() });
    }
  });

  app.get("/api/admin/monitor/sponsored-visit", adminMiddleware, async (_req: AuthRequest, res): Promise<void> => {
    const { isSponsoredVisitAlertMonitorRunning } = await import("../lib/sponsoredVisitMonitor");
    res.json({ running: isSponsoredVisitAlertMonitorRunning() });
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

      const [alertResult, trendBuckets] = await Promise.all([
        storage.checkFillRateAlerts({
          windowMinutes,
          failureThresholdPercent: thresholdPercent,
          minAttempts,
        }),
        storage.getFillRateTimeline(windowMinutes, bucketCount),
      ]);

      res.json({
        ...alertResult,
        trend: trendBuckets,
      });
    } catch (err) {
      req.log.error({ err }, "Failed to get fill rate analytics");
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
      req.log.error({ err }, "Failed to get per-user ad analytics");
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
      req.log.error({ err }, "Failed to get combined payout per user");
      res.status(500).json({ error: "Failed to load payout per user" });
    }
  });

  app.get("/api/admin/inbox", adminMiddleware, async (req: AuthRequest, res) => {
    try {
      const folder = typeof req.query.folder === "string" ? req.query.folder : "INBOX";
      const messages = await fetchInbox(folder);
      res.json({ messages, fetchedAt: new Date().toISOString() });
    } catch (err) {
      req.log.error({ err }, "Failed to fetch inbox");
      res.status(500).json({ error: "Failed to connect to mail server. Check ZOHO_SMTP_PASSWORD." });
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
      });
    } catch (err) {
      req.log.error({ err }, "Failed to get webhook alerts");
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
      req.log.error({ err }, "Failed to get webhook audit");
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
      req.log.error({ err }, "Failed to export webhook audit CSV");
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
      req.log.error({ err }, "Failed to get security audit log");
      res.status(500).json({ error: "Failed to load security audit log" });
    }
  });

  app.post("/api/support/tickets", authMiddleware, async (req: AuthRequest, res): Promise<void> => {
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
      });
      req.log.info({ userId: req.userId, subject: subject.trim() }, "Support ticket submitted");
      res.status(200).json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "Support ticket submission failed");
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

      req.log.info({ adminId: req.userId, targetId, grant, creditsToAdd }, "Publisher status updated");
      res.json({ ok: true, grant, creditsAdded: creditsToAdd });
    } catch (err) {
      req.log.error({ err }, "Grant publisher status failed");
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
      req.log.info({ adminId: req.userId, targetId, amount }, "Ad credits added");
      res.json({ ok: true, added: amount });
    } catch (err) {
      req.log.error({ err }, "Add ad credits failed");
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
      req.log.error({ err }, "Admin list campaigns failed");
      res.status(500).json({ error: "Failed to load campaigns" });
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
      req.log.info({ adminId: req.userId, campaignId: req.params.id, status }, "Campaign status updated");
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "Admin update campaign failed");
      res.status(500).json({ error: "Failed to update campaign" });
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
      req.log.error({ err }, "Publisher me failed");
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
      res.json({ campaigns: rows });
    } catch (err) {
      req.log.error({ err }, "Publisher list campaigns failed");
      res.status(500).json({ error: "Failed to load campaigns" });
    }
  });

  /** Publisher: create campaign */
  app.post("/api/publisher/campaigns", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { title, description, targetUrl, rewardPerVisit, totalBudget, category } = req.body ?? {};
      if (
        typeof title !== "string" || title.length < 3 || title.length > 80 ||
        typeof description !== "string" || description.length < 10 || description.length > 300 ||
        typeof targetUrl !== "string" || (() => { try { new URL(targetUrl); return false; } catch { return true; } })() ||
        typeof rewardPerVisit !== "number" || rewardPerVisit < 0.01 || rewardPerVisit > 0.50 ||
        typeof totalBudget !== "number" || totalBudget < 0.50 || totalBudget > 500
      ) { res.status(400).json({ error: "Invalid campaign data" }); return; }

      if (category !== undefined) {
        const categoryParse = adCategorySchema.safeParse(category);
        if (!categoryParse.success) {
          res.status(400).json({ error: `Invalid category. Must be one of: ${AD_CATEGORIES.join(", ")}` });
          return;
        }
      }

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

          const { randomBytes: _cmpRnd } = await import("node:crypto");
          const newPostbackSecret = _cmpRnd(32).toString("hex");

          const [row] = await tx.insert(campaignsTable).values({
            userId: req.userId!,
            title,
            description,
            targetUrl,
            totalBudget: String(totalBudget),
            rewardPerVisit: String(rewardPerVisit),
            status: "pending",
            postbackSecret: newPostbackSecret,
            ...(category !== undefined ? { category: category as string } : {}),
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

      req.log.info({ userId: req.userId, campaignId: campaign.id, totalBudget }, "Campaign created");
      res.status(201).json({ campaign });
    } catch (err) {
      req.log.error({ err }, "Create campaign failed");
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
      req.log.error({ err }, "Pause campaign failed");
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

      req.log.info({ userId: req.userId, amount }, "Publisher top-up from earnings");
      res.json({ ok: true, converted: amount });
    } catch (err) {
      req.log.error({ err }, "Publisher top-up failed");
      res.status(500).json({ error: "Failed to convert credits" });
    }
  });

  /** Earn: list active sponsored campaigns (auth required — prevents bots) */
  app.get("/api/earn/sponsored", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const { db: dbClient, campaigns: campaignsTable, campaignClicks: clicksTable, users: usersTable } = await import("@workspace/db");
      const { eq: drizzleEqLocal, and: drizzleAndLocal, sql: drizzleSql, desc: drizzleDescLocal } = await import("drizzle-orm");

      // Get active campaigns with enough remaining budget
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
          category: campaignsTable.category,
          publisherName: usersTable.username,
        })
        .from(campaignsTable)
        .leftJoin(usersTable, drizzleEqLocal(campaignsTable.userId, usersTable.id))
        .where(drizzleSql`${campaignsTable.status} = 'active' AND ${campaignsTable.spent} < ${campaignsTable.totalBudget}`)
        .orderBy(drizzleDescLocal(campaignsTable.createdAt));

      // Check which ones this user has already visited
      const campaignIds = rows.map(r => r.id);
      let visitedIds: string[] = [];
      if (campaignIds.length > 0) {
        const visited = await dbClient
          .select({ campaignId: clicksTable.campaignId })
          .from(clicksTable)
          .where(drizzleEqLocal(clicksTable.visitorUserId, req.userId!));
        visitedIds = visited.map(v => v.campaignId);
      }

      const result = rows.map(r => ({
        ...r,
        rewardPerVisit: Number(r.rewardPerVisit),
        totalBudget: Number(r.totalBudget),
        spent: Number(r.spent),
        alreadyVisited: visitedIds.includes(r.id),
      }));

      res.json({ campaigns: result });
    } catch (err) {
      req.log.error({ err }, "Earn sponsored failed");
      res.status(500).json({ error: "Failed to load sponsored offers" });
    }
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
        req.log.warn({ userId: req.userId, existing }, "Device registration refused — token limit reached");
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

      req.log.info({ userId: req.userId, tokenHashPrefix: tokenHash.slice(0, 8) }, "Device install token issued");
      res.status(201).json({ installToken: rawToken });
    } catch (err: any) {
      req.log.error({ err }, "Device registration failed");
      res.status(500).json({ error: "Failed to register device." });
    }
  });

  /** Earn: begin a sponsored visit — issues a short-lived visit token.
   *  The client must call this BEFORE opening the target URL, then present
   *  the token when calling /visit after spending time on the page.
   *  This prevents direct API calls from claiming rewards without any
   *  actual visit interaction.
   */
  app.post("/api/earn/sponsored/:id/begin", authMiddleware, sponsoredBeginRateLimiter, async (req: AuthRequest, res) => {
    try {
      const campaignId = String(req.params.id);
      const {
        db: dbClient,
        campaigns: campaignsTable,
        campaignClicks: clicksTable,
        campaignVisitAttempts: attemptsTable,
      } = await import("@workspace/db");
      const { eq: drizzleEqLocal, and: drizzleAndLocal } = await import("drizzle-orm");

      const [campaign] = await dbClient.select().from(campaignsTable)
        .where(drizzleEqLocal(campaignsTable.id, campaignId));
      if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
      if (campaign.status !== "active") { res.status(400).json({ error: "Campaign is not active" }); return; }
      if (campaign.userId === req.userId) { res.status(400).json({ error: "You cannot visit your own campaign" }); return; }

      // ── SECURITY: reject attempts for campaigns missing postbackSecret ────
      // All campaigns should have postbackSecret assigned — either at creation
      // (new campaigns) or via the startup migration in registerRoutes (existing
      // campaigns). Gating here (before creating the attempt row) ensures no
      // visit attempt can enter the flow for a null-secret campaign. This
      // prevents the pixel/witness bypass: without an attempt row, /visit cannot
      // settle, so there is nothing to farm. If the startup migration failed for
      // any reason, this guard is the backstop. Resolution: republish the API
      // (re-runs migration) or manually backfill via admin.
      if (!campaign.postbackSecret) {
        req.log?.error?.({ campaignId }, "/begin rejected — campaign missing postbackSecret (startup migration may have failed)");
        res.status(503).json({ error: "This campaign is not fully configured — contact support." });
        return;
      }

      const remaining = Number(campaign.totalBudget) - Number(campaign.spent);
      if (remaining < Number(campaign.rewardPerVisit)) {
        res.status(400).json({ error: "Campaign budget exhausted" }); return;
      }

      const [already] = await dbClient.select({ id: clicksTable.campaignId })
        .from(clicksTable)
        .where(drizzleAndLocal(
          drizzleEqLocal(clicksTable.campaignId, campaignId),
          drizzleEqLocal(clicksTable.visitorUserId, req.userId!),
        ));
      if (already) { res.status(409).json({ error: "Already visited this campaign", alreadyVisited: true }); return; }

      // Stateful attempt: 32 random bytes (64 hex chars) — unguessable single-use
      // token bound to (user, campaign). The token is the public handle for both
      // the /r/:token redirect endpoint and the /visit settle call.
      const { randomBytes, createHmac: _hmacBegin, createHash: _hashBegin } = await import("crypto");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      // Validate the server-issued install token.
      // The token is minted by /api/device/register (auth-required, per-user
      // rate-limited, DB-backed). It is an access gate: it proves the client
      // went through a server-mediated credential issuance step and is not
      // freely rotatable on a per-request basis.
      //
      // We store SHA-256(installToken) in the attempt row. /visit verifies this
      // hash matches so the same credential must be presented end-to-end — a
      // pure token-identity consistency check with no device-hash involvement.
      //
      // FAIL-CLOSED: missing, malformed, unknown, or cross-user tokens → 400/403.
      const beginRawInstallToken = String(req.headers["x-install-token"] ?? "").slice(0, 64);
      if (!beginRawInstallToken || !/^[a-f0-9]{64}$/.test(beginRawInstallToken)) {
        res.status(400).json({ error: "Invalid or missing install token — call /api/device/register first." });
        return;
      }
      const beginInstallTokenHash = _hashBegin("sha256").update(beginRawInstallToken).digest("hex");
      const { deviceInstalls: deviceInstallsTable } = await import("@workspace/db");
      const { eq: _eqInstall } = await import("drizzle-orm");
      const [installRecord] = await dbClient.select().from(deviceInstallsTable)
        .where(_eqInstall(deviceInstallsTable.tokenHash, beginInstallTokenHash));
      if (!installRecord) {
        res.status(403).json({ error: "Unrecognised install token — call /api/device/register first." });
        return;
      }
      if (installRecord.userId !== req.userId) {
        res.status(403).json({ error: "Install token does not belong to this account." });
        return;
      }

      // Store the install token hash (not deviceHash) so /visit can confirm
      // the same server-issued credential is presented end-to-end.
      await dbClient.insert(attemptsTable).values({
        token,
        campaignId,
        userId: req.userId!,
        rewardSnapshot: String(campaign.rewardPerVisit),
        expiresAt,
        deviceHash: beginInstallTokenHash,
      });

      // Build the redirect URL on our own domain. The mobile/web client opens
      // THIS url, which means the server gets a real HTTP fetch it can stamp
      // before 302'ing to the advertiser. /visit will require redirectedAt to
      // be set, so a script that never hits the redirect URL cannot settle.
      const base = process.env.PUBLIC_BASE_URL
        ?? (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : `${req.protocol}://${req.get("host")}`);

      // visitSessionToken (VST): HMAC-SHA256(attemptToken:userId:vst, JWT_ACCESS_SECRET).
      // Returned to the authenticated caller at /begin time ONLY — not derivable from
      // the /r/:token response. /r validates VST, /ack requires it. This ensures the
      // witness chain requires a value that appears in the /begin response (not just
      // the /r response), binding the chain to the originating authenticated session.
      // The server re-derives VST on demand from the stored attempt row (no extra column).
      const _vBeginSecret = process.env.JWT_ACCESS_SECRET ?? "";
      const visitSessionToken = _hmacBegin("sha256", _vBeginSecret)
        .update(token + ":" + req.userId! + ":vst")
        .digest("hex");

      const redirectUrl = `${base.replace(/\/+$/, "")}/api/earn/sponsored/r/${token}?vst=${visitSessionToken}`;

      res.json({ attemptToken: token, redirectUrl, visitSessionToken });
    } catch (err: any) {
      req.log.error({ err }, "Sponsored visit begin failed");
      res.status(500).json({ error: "Failed to begin visit" });
    }
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

      // Generate a single-use witness nonce, stored in the DB.
      // The nonce is embedded as a JavaScript variable inside the interstitial
      // HTML body — it is NOT sent in any response header (no Set-Cookie).
      // This requires an attacker to parse the HTML body to extract the nonce;
      // reading response headers alone is insufficient. /ack accepts it via the
      // ?w= query parameter (sent by the interstitial JS) and validates it
      // against the DB-stored value with a timing-safe comparison.
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
      //      (requires ?w=witnessNonce from this page + VST from /begin response).
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

  // Witness nonce: a per-request server-generated value embedded here in the
  // HTML body (not in any response header). /ack requires it as ?w= to bind
  // the ack call to this specific /r invocation. Reading it requires parsing
  // this HTML — it cannot be extracted from response headers alone.
  var witnessToken=${safeForScript(witnessNonce)};

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
  // and the witness nonce embedded in this page (?w=). /ack validates VST against
  // the attempt's userId (re-derived server-side from JWT_ACCESS_SECRET — cannot
  // be forged from /r response alone) and validates ?w= against the DB-stored
  // nonce + IP/UA binding.
  function fetchAck(retryDelayMs){
    if(retryDelayMs>0){setTimeout(function(){fetchAck(0);},retryDelayMs);return;}
    var xhr=new XMLHttpRequest();
    xhr.open('GET',ackPath+'?vst='+encodeURIComponent(vst)+'&w='+encodeURIComponent(witnessToken),true);
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

  /** Ack exchange — converts the body-embedded witness nonce into a short-lived
   *  HMAC-signed ack token that /c/:token requires.
   *
   *  Security design:
   *  - The witnessNonce is embedded as a JS variable in the interstitial HTML
   *    body (NOT in any response header). Reading it requires parsing the HTML;
   *    simply reading Set-Cookie or other response headers is insufficient.
   *  - /ack validates: (1) ?w= param matches DB nonce (timing-safe), (2) IP+UA
   *    binding, (3) dwell time elapsed. On success it returns an HMAC-SHA256
   *    token signed with JWT_ACCESS_SECRET — unforgeable without the server
   *    secret.
   *  - An attacker must parse the /r HTML body to obtain the nonce, then pass
   *    IP+UA binding checks on both /ack and /c.
   */
  app.get("/api/earn/sponsored/ack/:token", async (req, res) => {
    try {
      const token = String(req.params.token);
      if (!/^[a-f0-9]{64}$/.test(token)) {
        res.status(404).json({ error: "Not found" }); return;
      }

      // ── Per-IP rate limit on the ack endpoint ─────────────────────────────
      // Bounding /ack per-IP directly limits the throughput of the automated
      // witness chain, independent of the /visit settlement cap.
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

      // Validate the ?w= query param against the DB-stored nonce.
      // The nonce is embedded as a JS variable in the /r interstitial HTML body
      // (never in a response header), so the caller must have loaded and parsed
      // the HTML to obtain it. Comparison uses timingSafeEqual to prevent
      // timing-based nonce enumeration.
      const submittedNonce = String(req.query.w ?? "");
      if (!submittedNonce || !attempt.witnessNonce) {
        req.log?.warn?.({ token: token.slice(0, 8) + "…" }, "Sponsored ack: missing witness nonce");
        res.status(403).json({ error: "Witness validation failed" }); return;
      }
      {
        const { timingSafeEqual: _tseNonce } = await import("node:crypto");
        const expectedNonceBuf = Buffer.from(attempt.witnessNonce, "utf8");
        const submittedNonceBuf = Buffer.from(submittedNonce, "utf8");
        const nonceMatch = expectedNonceBuf.length === submittedNonceBuf.length &&
          _tseNonce(expectedNonceBuf, submittedNonceBuf);
        if (!nonceMatch) {
          req.log?.warn?.({ token: token.slice(0, 8) + "…" }, "Sponsored ack: witness nonce mismatch");
          res.status(403).json({ error: "Witness validation failed" }); return;
        }
      }

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

  /** Completion redirect — the penultimate gate in the sponsored-visit chain.
   *
   *  The /r/:token interstitial navigates the browser here. This endpoint:
   *    1. Verifies the HMAC-SHA256 ack token (?ack=) returned by /ack, which
   *       is bound to the DB-stored witnessNonce — unforgeable without
   *       JWT_ACCESS_SECRET.
   *    2. Consumes the witnessNonce (sets it to NULL) to make the ackToken
   *       single-use — a second /c call for the same token is rejected.
   *    3. 302-redirects the browser to the actual advertiser URL.
   *
   *  Because this is a redirect hop in the browser's navigation chain (not a
   *  background XHR/beacon), the server observes it as a genuine GET.
   *
   *  IMPORTANT: /c does NOT set `witnessedAt`. After redirecting to the
   *  advertiser, the advertiser's page must render the pixel image
   *  (`?cashclip_cb=<pixelUrl>`) to trigger the /pixel callback. /pixel
   *  validates HMAC + Referer origin + IP binding and is the ONLY path
   *  that sets `witnessedAt`. /visit rejects settlement if `witnessedAt`
   *  is null. This means calling /c alone is not sufficient to unlock
   *  settlement — a sponsor-origin callback is also required.
   *
   *  Attack resistance:
   *  - Without /r: no nonce → no ackToken → /c rejects.
   *  - Without /ack: no ackToken → /c rejects.
   *  - Without /pixel firing from sponsor's origin: witnessedAt stays null
   *    → /visit rejects.
   *  - ackToken is single-use: /c clears witnessNonce; a second /c call for
   *    the same token finds nonce = null → rejected.
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

      // ── Sec-Fetch-Mode enforcement ─────────────────────────────────────────
      // /c must be reached via a top-level browser navigation — not XHR, fetch,
      // or a plain HTTP script. The interstitial JS navigates here (via
      // window.location.replace) after /ack confirms the timing gate.
      // Browsers on Chrome 76+, Firefox 90+, Edge 79+, and Safari 16.4+
      // send Sec-Fetch-Mode: "navigate" for top-level navigations.
      // We require the header to be present AND equal to "navigate":
      //   - missing → plain HTTP clients (curl, axios, node-fetch) → rejected
      //   - cors / same-origin / no-cors → browser AJAX/fetch call → rejected
      // Note: iOS WKWebView / older iOS Safari <16.4 may also be rejected by
      // this gate. Those sessions use in-app browser tabs (expo-web-browser /
      // ASWebAuthenticationSession) which send Sec-Fetch-Mode on current builds.
      const secFetchMode = String(req.headers["sec-fetch-mode"] ?? "");
      if (secFetchMode !== "navigate") {
        req.log?.warn?.({ token: token.slice(0, 8) + "…", secFetchMode: secFetchMode || "(absent)" }, "Sponsored /c: rejected — Sec-Fetch-Mode not 'navigate'");
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
        // /c does NOT set witnessedAt. witnessedAt is set exclusively by the
        // /pixel endpoint after the browser fires the tracking pixel (see below).
        //
        // What /c does here: ROTATE witnessNonce to a fresh random pixelNonce.
        // The old witnessNonce was used to derive ackToken; rotating it here
        // invalidates ackToken for replay (any repeat /c call finds the nonce
        // has changed and the HMAC check fails). The new pixelNonce is included
        // in the cashclip_cb pixel URL so /pixel can validate it. The pixelNonce
        // is NOT derived from any earlier value — it is freshly random and only
        // producible after calling /c. It is consumed atomically when the pixel
        // fires (cleared by the /pixel handler). This is non-replayable,
        // server-issued state bound to the successful completion of /c.
        const { randomBytes: _rndPn } = await import("node:crypto");
        const pixelNonce = _rndPn(24).toString("hex");
        await dbClient.update(attemptsTable)
          .set({ witnessNonce: pixelNonce })
          .where(drizzleAndLocal(
            drizzleEqLocal(attemptsTable.token, token),
            drizzleSql`${attemptsTable.witnessedAt} IS NULL`,
          ));
        req.log?.info?.({ token: token.slice(0, 8) + "…" }, "Sponsored /c: ackToken consumed, pixelNonce rotated — awaiting pixel callback");
        // Store pixelNonce in local scope so the cashclip_cb URL can include it.
        (req as any).__pixelNonce = pixelNonce;
      } else if (attempt.witnessNonce) {
        // Attempt is already witnessed — reuse the stored nonce for the pixel
        // URL in case the caller is retrying (idempotent).
        (req as any).__pixelNonce = attempt.witnessNonce;
      }

      if (!targetUrl) {
        res.status(410).send("Campaign no longer available"); return;
      }

      const { createHmac: _hmacPx } = await import("node:crypto");
      const _pxSecret = process.env.JWT_ACCESS_SECRET ?? "";
      const pixelToken = _hmacPx("sha256", _pxSecret)
        .update(token + ":" + attempt.userId + ":pixel")
        .digest("hex");
      const apiBase = process.env.PUBLIC_BASE_URL
        ?? (process.env.REPLIT_DOMAINS
          ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
          : `${req.protocol}://${req.get("host")}`);
      const _pixelNonce = (req as any).__pixelNonce as string | undefined;
      const pixelUrl = `${apiBase.replace(/\/+$/, "")}/api/earn/sponsored/pixel/${pixelToken}?t=${encodeURIComponent(token)}${_pixelNonce ? "&w=" + encodeURIComponent(_pixelNonce) : ""}`;

      // Build the postback base URL for campaigns that use server-to-server postback.
      // This URL (without &sig) is passed to the advertiser as cashclip_postback.
      // The advertiser's server appends &sig=HMAC-SHA256(attemptToken, postbackSecret)
      // and calls the URL server-side. The pixel URL is included alongside for
      // legacy corroboration; for campaigns with postbackSecret the pixel does NOT
      // set witnessedAt — only the /postback endpoint does.
      const postbackBaseUrl = camp?.postbackSecret
        ? `${apiBase.replace(/\/+$/, "")}/api/earn/sponsored/postback?t=${encodeURIComponent(token)}`
        : null;

      let advertiserRedirect: string;
      try {
        const u = new URL(targetUrl);
        u.searchParams.set("cashclip_cb", pixelUrl);
        if (postbackBaseUrl) {
          u.searchParams.set("cashclip_postback", postbackBaseUrl);
        }
        advertiserRedirect = u.toString();
      } catch {
        let suffix = (targetUrl.includes("?") ? "&" : "?") + "cashclip_cb=" + encodeURIComponent(pixelUrl);
        if (postbackBaseUrl) suffix += "&cashclip_postback=" + encodeURIComponent(postbackBaseUrl);
        advertiserRedirect = targetUrl + suffix;
      }

      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, advertiserRedirect);
    } catch (err: any) {
      req.log?.error?.({ err }, "Sponsored completion redirect failed");
      if (targetUrl) {
        res.redirect(302, targetUrl);
      } else {
        res.status(500).send("Redirect failed");
      }
    }
  });

  /**
   * Sponsored visit server-to-server postback — the authoritative path to
   * setting witnessedAt for campaigns that have a postbackSecret.
   *
   * This endpoint is called by the ADVERTISER'S SERVER (not the user's browser)
   * after a user visits their landing page. Because only the advertiser knows
   * the per-campaign postbackSecret, the HMAC signature is unforgeable by the
   * end-user/claimant. This is a server-verifiable signal the claimant cannot
   * self-generate.
   *
   * Request (GET or POST):
   *   ?t=<attemptToken>          — hex-64 attempt token (from the postback URL)
   *   &sig=<hex>                 — HMAC-SHA256(attemptToken, postbackSecret)
   *                                computed by the advertiser's server
   *
   * The advertiser receives the base postback URL (without &sig) via the
   * ?cashclip_postback= parameter appended to their campaign targetUrl at /c
   * time. They compute sig = HMAC-SHA256(attemptToken, postbackSecret) where
   * postbackSecret was shared with them at campaign setup time.
   *
   * For campaigns WITHOUT a postbackSecret (legacy), this endpoint rejects and
   * the pixel path remains the fallback.
   */
  app.get("/api/earn/sponsored/postback", async (req, res) => {
    try {
      const attemptToken = String(req.query.t ?? "");
      const submittedSig = String(req.query.sig ?? "");

      if (!/^[a-f0-9]{64}$/.test(attemptToken) || !submittedSig) {
        res.status(400).json({ error: "Invalid request" }); return;
      }

      const {
        db: dbClient,
        campaigns: campaignsTable,
        campaignVisitAttempts: attemptsTable,
      } = await import("@workspace/db");
      const { sql: drizzleSqlPb, eq: drizzleEqPb, and: drizzleAndPb } = await import("drizzle-orm");

      const [attempt] = await dbClient.select().from(attemptsTable)
        .where(drizzleEqPb(attemptsTable.token, attemptToken));
      if (!attempt) { res.status(404).json({ error: "Not found" }); return; }
      if (attempt.expiresAt.getTime() < Date.now()) {
        res.status(410).json({ error: "Attempt expired" }); return;
      }

      const [camp] = await dbClient.select().from(campaignsTable)
        .where(drizzleEqPb(campaignsTable.id, attempt.campaignId));
      if (!camp?.postbackSecret) {
        res.status(403).json({ error: "Campaign does not use server-to-server postback" }); return;
      }

      // Validate: sig must equal HMAC-SHA256(attemptToken, postbackSecret).
      // timingSafeEqual prevents timing oracle attacks.
      const { createHmac: _hmacPb, timingSafeEqual: _tsePb } = await import("node:crypto");
      const expectedSig = _hmacPb("sha256", camp.postbackSecret)
        .update(attemptToken)
        .digest("hex");
      let submittedBuf: Buffer;
      try { submittedBuf = Buffer.from(submittedSig, "hex"); } catch { submittedBuf = Buffer.alloc(0); }
      const expectedBuf = Buffer.from(expectedSig, "hex");
      if (submittedBuf.length !== expectedBuf.length || !_tsePb(submittedBuf, expectedBuf)) {
        req.log?.warn?.({ attemptToken: attemptToken.slice(0, 8) + "…" }, "Sponsored postback: HMAC mismatch — rejected");
        res.status(403).json({ error: "Invalid signature" }); return;
      }

      // All checks passed. Set witnessedAt atomically (COALESCE for idempotency).
      if (!attempt.witnessedAt) {
        await dbClient.update(attemptsTable)
          .set({
            witnessedAt: drizzleSqlPb`COALESCE(${attemptsTable.witnessedAt}, NOW())`,
            witnessNonce: null,
          })
          .where(drizzleAndPb(
            drizzleEqPb(attemptsTable.token, attemptToken),
            drizzleSqlPb`${attemptsTable.witnessedAt} IS NULL`,
          ));
        req.log?.info?.({ attemptToken: attemptToken.slice(0, 8) + "…", campaignId: camp.id }, "Sponsored postback: witnessedAt set via server-to-server postback");
      }

      res.json({ ok: true });
    } catch (err) {
      req.log?.error?.({ err }, "Sponsored postback handler error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  // POST alias for advertiser servers that prefer POST
  app.post("/api/earn/sponsored/postback", async (req, res) => {
    // Forward to GET handler by treating body fields as query overrides.
    // Merge body into query so the shared logic above works for both verbs.
    req.query = { ...req.query, ...req.body };
    // Re-dispatch — route to the GET handler via inline delegation.
    const attemptToken = String(req.query.t ?? "");
    const submittedSig = String(req.query.sig ?? "");

    try {
      if (!/^[a-f0-9]{64}$/.test(attemptToken) || !submittedSig) {
        res.status(400).json({ error: "Invalid request" }); return;
      }

      const {
        db: dbClient,
        campaigns: campaignsTable,
        campaignVisitAttempts: attemptsTable,
      } = await import("@workspace/db");
      const { sql: drizzleSqlPbP, eq: drizzleEqPbP, and: drizzleAndPbP } = await import("drizzle-orm");

      const [attempt] = await dbClient.select().from(attemptsTable)
        .where(drizzleEqPbP(attemptsTable.token, attemptToken));
      if (!attempt) { res.status(404).json({ error: "Not found" }); return; }
      if (attempt.expiresAt.getTime() < Date.now()) {
        res.status(410).json({ error: "Attempt expired" }); return;
      }

      const [camp] = await dbClient.select().from(campaignsTable)
        .where(drizzleEqPbP(campaignsTable.id, attempt.campaignId));
      if (!camp?.postbackSecret) {
        res.status(403).json({ error: "Campaign does not use server-to-server postback" }); return;
      }

      const { createHmac: _hmacPbP, timingSafeEqual: _tsePbP } = await import("node:crypto");
      const expectedSig = _hmacPbP("sha256", camp.postbackSecret)
        .update(attemptToken)
        .digest("hex");
      let submittedBuf: Buffer;
      try { submittedBuf = Buffer.from(submittedSig, "hex"); } catch { submittedBuf = Buffer.alloc(0); }
      const expectedBuf = Buffer.from(expectedSig, "hex");
      if (submittedBuf.length !== expectedBuf.length || !_tsePbP(submittedBuf, expectedBuf)) {
        req.log?.warn?.({ attemptToken: attemptToken.slice(0, 8) + "…" }, "Sponsored postback (POST): HMAC mismatch — rejected");
        res.status(403).json({ error: "Invalid signature" }); return;
      }

      if (!attempt.witnessedAt) {
        await dbClient.update(attemptsTable)
          .set({
            witnessedAt: drizzleSqlPbP`COALESCE(${attemptsTable.witnessedAt}, NOW())`,
            witnessNonce: null,
          })
          .where(drizzleAndPbP(
            drizzleEqPbP(attemptsTable.token, attemptToken),
            drizzleSqlPbP`${attemptsTable.witnessedAt} IS NULL`,
          ));
        req.log?.info?.({ attemptToken: attemptToken.slice(0, 8) + "…", campaignId: camp.id }, "Sponsored postback (POST): witnessedAt set via server-to-server postback");
      }

      res.json({ ok: true });
    } catch (err) {
      req.log?.error?.({ err }, "Sponsored postback (POST) handler error");
      res.status(500).json({ error: "Internal error" });
    }
  });

  /**
   * Sponsored visit pixel — analytics/corroboration callback.
   *
   * SECURITY: this endpoint NEVER sets witnessedAt.
   *
   * The pixel URL (`cashclip_cb`) is embedded in the 302 Location header from
   * /c and is therefore claimant-observable. A script can extract pixelNonce
   * and pixelToken from the redirect URL and call this endpoint directly from
   * the same IP without ever loading the advertiser's landing page.
   *
   * witnessedAt is set EXCLUSIVELY by the server-to-server /postback endpoint,
   * where the advertiser signs with HMAC-SHA256(attemptToken, postbackSecret).
   * postbackSecret is unknown to the end-user/claimant — the signature is
   * unforgeable.
   *
   * Pixel fires are accepted and logged for analytics (Referer, timing, nonce
   * validation) but produce no witnessedAt side-effect. /visit requires
   * witnessedAt to be non-null; for any campaign missing postbackSecret (startup
   * migration failed), /visit hard-denies settlement — so no null-secret
   * campaign can be farmed via the pixel path.
   *
   * The /c endpoint appends this pixel URL as `?cashclip_cb=<pixelUrl>` to the
   * advertiser redirect alongside `cashclip_postback=<baseUrl>` for the
   * server-to-server callback.
   *
   * Security properties of accepted pixel calls (analytics gates only):
   * - pixelToken = HMAC-SHA256(attemptToken:userId:pixel, JWT_ACCESS_SECRET) —
   *   unforgeable without the server secret; proves /c was called.
   * - pixelNonce (?w=): a fresh random value generated at /c time (rotated
   *   from the ackToken nonce), unknown before /c is called. Validated with
   *   timingSafeEqual against the DB value and consumed atomically (single-use).
   * - Referer is logged for analytics but is NOT a hard gate.
   * - IP binding: request IP must match the hash recorded at /r time.
   */
  app.get("/api/earn/sponsored/pixel/:pixelToken", async (req, res) => {
    // Return a 1×1 transparent GIF regardless of outcome so the browser does
    // not show a broken-image icon on the advertiser's page.
    const TRANSPARENT_GIF = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64",
    );
    const sendPixel = () => {
      res.setHeader("Content-Type", "image/gif");
      res.setHeader("Cache-Control", "no-store, no-cache");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(TRANSPARENT_GIF);
    };

    try {
      const pixelToken = String(req.params.pixelToken ?? "");
      const attemptToken = String(req.query.t ?? "");

      if (!/^[a-f0-9]{64}$/.test(pixelToken) || !/^[a-f0-9]{64}$/.test(attemptToken)) {
        sendPixel(); return;
      }

      const {
        db: dbClient,
        campaigns: campaignsTable,
        campaignVisitAttempts: attemptsTable,
      } = await import("@workspace/db");
      const { sql: drizzleSql, eq: drizzleEqLocal, and: drizzleAndLocal } = await import("drizzle-orm");

      // Load attempt row to get userId and validate expiry.
      const [attempt] = await dbClient.select().from(attemptsTable)
        .where(drizzleEqLocal(attemptsTable.token, attemptToken));
      if (!attempt || attempt.expiresAt.getTime() < Date.now() || attempt.settledAt) {
        sendPixel(); return;
      }

      // Validate pixelToken = HMAC(attemptToken:userId:pixel, JWT_ACCESS_SECRET).
      // This proves /c was called and the token is legitimate.
      const { createHmac: _hmacPx, timingSafeEqual: _tsePx } = await import("node:crypto");
      const _pxSecret = process.env.JWT_ACCESS_SECRET ?? "";
      const expectedToken = _hmacPx("sha256", _pxSecret)
        .update(attemptToken + ":" + attempt.userId + ":pixel")
        .digest("hex");
      const providedBuf = Buffer.from(pixelToken, "hex");
      const expectedBuf = Buffer.from(expectedToken, "hex");
      if (providedBuf.length !== expectedBuf.length || !_tsePx(providedBuf, expectedBuf)) {
        req.log?.warn?.({ attemptToken: attemptToken.slice(0, 8) + "…" }, "Sponsored pixel: HMAC mismatch");
        sendPixel(); return;
      }

      // ── pixelNonce validation (non-replayable, server-issued, consumed atomically) ──
      // At /c time the server rotated witnessNonce to a fresh random pixelNonce
      // and embedded it in this pixel URL as ?w=. The pixelNonce is NOT derived
      // from any value the claimant had before /c was called, so obtaining it
      // requires completing the full /r → /ack → /c chain successfully.
      //
      // Referer is logged as informational context but is NOT a hard gate here
      // because it is a client-supplied header and therefore non-authoritative.
      // The pixelNonce (single-use DB-backed check) is the primary guard.
      const submittedPixelNonce = String(req.query.w ?? "");
      const storedPixelNonce = attempt.witnessNonce;
      if (!submittedPixelNonce || !storedPixelNonce) {
        req.log?.warn?.({ attemptToken: attemptToken.slice(0, 8) + "…" }, "Sponsored pixel: missing pixelNonce");
        sendPixel(); return;
      }
      {
        const { timingSafeEqual: _tsePxN } = await import("node:crypto");
        const storedBuf = Buffer.from(storedPixelNonce, "utf8");
        const submittedBuf = Buffer.from(submittedPixelNonce, "utf8");
        const nonceMatch = storedBuf.length === submittedBuf.length && _tsePxN(storedBuf, submittedBuf);
        if (!nonceMatch) {
          req.log?.warn?.({ attemptToken: attemptToken.slice(0, 8) + "…" }, "Sponsored pixel: pixelNonce mismatch — rejected");
          sendPixel(); return;
        }
      }

      // Load campaign — needed for both Referer analytics and postbackSecret check.
      const [campPx] = await dbClient.select().from(campaignsTable)
        .where(drizzleEqLocal(campaignsTable.id, attempt.campaignId));

      // Informational: log Referer for analytics but do not hard-reject on mismatch.
      // Referer is non-authoritative (client-supplied).
      if (campPx?.targetUrl) {
        const referer = String(req.headers["referer"] ?? req.headers["referrer"] ?? "");
        try {
          const targetOrigin = new URL(campPx.targetUrl).origin;
          const refOrigin = referer ? new URL(referer).origin : "";
          if (!refOrigin || refOrigin !== targetOrigin) {
            req.log?.info?.({
              attemptToken: attemptToken.slice(0, 8) + "…",
              refOrigin: refOrigin || "(absent)", targetOrigin,
            }, "Sponsored pixel: Referer mismatch (informational — not a hard gate)");
          }
        } catch { /* malformed referer/targetUrl — ignore */ }
      }

      // ── IP binding ───────────────────────────────────────────────────────
      // The pixel fires from the user's browser, which visited /r from the
      // same device. Verify the pixel request IP matches the /r request IP.
      if (attempt.redirectIpHash) {
        const { createHash: _chPx } = await import("node:crypto");
        const { getClientIp: _gcipPx } = await import("../lib/clientIp");
        const currentIpHash = _chPx("sha256").update(_gcipPx(req)).digest("hex");
        if (currentIpHash !== attempt.redirectIpHash) {
          req.log?.warn?.({ attemptToken: attemptToken.slice(0, 8) + "…" }, "Sponsored pixel: IP mismatch");
          sendPixel(); return;
        }
      }

      // ── SECURITY: pixel NEVER sets witnessedAt ────────────────────────────
      // The pixel URL is embedded in the 302 Location header from /c and is
      // therefore observable to the claimant. A same-IP script can extract
      // pixelNonce + pixelToken and call /pixel directly — without loading
      // the advertiser's page — to set witnessedAt and farm rewards.
      //
      // witnessedAt is set EXCLUSIVELY by the server-to-server /postback
      // endpoint, where the advertiser's server signs with
      // HMAC-SHA256(attemptToken, postbackSecret). postbackSecret is never
      // accessible to the end-user/claimant, making the sig unforgeable.
      //
      // All campaigns receive a postbackSecret — either at creation (new
      // campaigns) or via the startup migration in registerRoutes (existing
      // campaigns). If a campaign somehow has postbackSecret IS NULL (startup
      // migration failed), /begin rejects new visit attempts for that campaign
      // so null-secret campaigns can never enter the sponsored-visit flow.
      req.log?.info?.({
        attemptToken: attemptToken.slice(0, 8) + "…",
        campaignId: campPx?.id,
        hasPostbackSecret: !!campPx?.postbackSecret,
      }, "Sponsored pixel: informational only — witnessedAt requires server-to-server /postback");
    } catch (err: any) {
      req.log?.error?.({ err }, "Sponsored pixel handler error");
    }

    // Always return the pixel (errors must not break the advertiser's page).
    sendPixel();
  });

  /** Earn: record a sponsored campaign visit + credit the visitor.
   *  Requires a visitToken from /begin, and enforces a minimum dwell time
   *  to prove the user actually had the page open.
   */
  app.post("/api/earn/sponsored/:id/visit", authMiddleware, async (req: AuthRequest, res) => {
    // Declared outside the try block so releaseIpSlot is reachable from the
    // outer catch. ipKey is set once computed inside the try.
    let ipSlotConsumed = false;
    let ipKey = "";
    let acctVisitMax = 0;
    const releaseIpSlot = async (reason: string) => {
      if (!ipSlotConsumed) return;
      ipSlotConsumed = false;
      try {
        const { decrementLoginAttempt } = await import("../lib/dbRateLimit");
        await decrementLoginAttempt(ipKey);
      } catch (decErr) {
        req.log.warn({ err: decErr, reason }, "Sponsored /visit IP cap decrement failed");
      }
    };
    try {
      const campaignId = String(req.params.id);

      // Resolve device hash from the server-issued install token.
      // The install token is server-generated (not client-minted), rate-limited
      // at issuance, and stored in device_installs. By looking up the device
      // hash here, the Sybil key is server-owned and cannot be rotated per-
      // request by changing a header value.
      //
      // FAIL-CLOSED: missing / malformed / unknown / cross-user tokens → 400/403.
      // The stored hash from the attempt row (written at /begin) is then compared
      // against the install record's hash to prevent token swapping between steps.
      const visitRawInstallToken = String(req.headers["x-install-token"] ?? "").slice(0, 64);
      if (!visitRawInstallToken || !/^[a-f0-9]{64}$/.test(visitRawInstallToken)) {
        req.log.warn({ userId: req.userId }, "Sponsored visit refused — missing or malformed X-Install-Token");
        res.status(400).json({ error: "Invalid or missing install token — call /api/device/register first." });
        return;
      }
      const { createHash: hashFn } = await import("crypto");
      const visitInstallTokenHash = hashFn("sha256").update(visitRawInstallToken).digest("hex");
      // Install record is validated against the attempt further below once the
      // attempt row is loaded. visitInstallTokenHash is available from here on.

      // Per-IP daily settle cap — the most important damage limiter. Even if
      // an attacker bypasses the witness gate with a headless browser, this
      // bounds how much money any single source IP can drain in 24h across
      // any number of Sybil accounts. Default 8/day; override via env.
      //
      // ATOMIC consume-on-check design: we increment the counter BEFORE
      // settlement so that concurrent requests each get a unique counter value
      // and cannot all race past the same pre-increment count. If the slot is
      // over the limit, or if the subsequent settlement fails for a legitimate
      // reason (budget exhausted, dwell-time too short, already visited, …),
      // we decrement the counter back so the user is not soft-banned for the
      // day. We only keep the slot consumed when a settlement actually
      // succeeds and money is moved. This eliminates the TOCTOU window that
      // previously allowed N concurrent requests to all observe count=0 and
      // all credit rewards before any increment landed.
      const { getClientIp: getIp } = await import("../lib/clientIp");
      const { recordLoginAttempt: consumeSlot } = await import("../lib/dbRateLimit");
      const visitIpLimit = Math.max(1, parseInt(process.env.SPONSORED_VISIT_IP_LIMIT ?? "8", 10));
      ipKey = `sponsored:visit:ip:${getIp(req)}`;
      try {
        const ipCheck = await consumeSlot(ipKey, visitIpLimit, 24 * 60 * 60 * 1000);
        ipSlotConsumed = true;
        if (!ipCheck.allowed) {
          // Over the daily cap — release the slot immediately so that rejected
          // requests do not erode the budget for legitimate subsequent attempts
          // from the same network (prevents cap exhaustion via unanswered probes).
          await releaseIpSlot("over-limit");
          res.status(429).json({
            error: "Daily sponsored-visit limit reached for this network. Try again tomorrow.",
          });
          return;
        }
      } catch (rateErr: any) {
        // Fail-closed: money-bearing endpoint must never fall back to
        // unlimited when the abuse-control DB lookup throws.
        req.log.error({ err: rateErr }, "Sponsored /visit IP rate-limit lookup failed");
        res.status(503).json({ error: "Rate-limit check unavailable — please retry." });
        return;
      }
      // Accept attemptToken (current) or visitToken (older clients).
      const body = (req.body ?? {}) as { attemptToken?: string; visitToken?: string };
      const attemptToken = body.attemptToken ?? body.visitToken;

      if (!attemptToken || typeof attemptToken !== "string" || !/^[a-f0-9]{64}$/.test(attemptToken)) {
        await releaseIpSlot("invalid-token-format");
        res.status(400).json({ error: "attemptToken is required — call /begin first." });
        return;
      }

      const {
        db: dbClient,
        campaigns: campaignsTable,
        campaignClicks: clicksTable,
        campaignVisitAttempts: attemptsTable,
        users: usersTable,
        earningsLedger: ledgerTable,
      } = await import("@workspace/db");
      const { sql: drizzleSql, eq: drizzleEqLocal, and: drizzleAndLocal } = await import("drizzle-orm");

      // ── Stateful attempt verification ────────────────────────────────────
      // Replaces the old JWT-only model. The attempt row carries trusted
      // server-observed state: redirectedAt is set only when our /r/:token
      // endpoint was actually fetched, so a script that never opens the
      // redirect URL cannot settle.
      const [attempt] = await dbClient.select().from(attemptsTable)
        .where(drizzleEqLocal(attemptsTable.token, attemptToken));
      if (!attempt) {
        await releaseIpSlot("invalid-attempt-token");
        res.status(400).json({ error: "Invalid or expired visit token." }); return;
      }
      if (attempt.userId !== req.userId || attempt.campaignId !== campaignId) {
        await releaseIpSlot("token-mismatch");
        res.status(400).json({ error: "Visit token does not match this campaign." }); return;
      }
      if (attempt.expiresAt.getTime() < Date.now()) {
        await releaseIpSlot("token-expired");
        res.status(400).json({ error: "Visit token expired — please try again." }); return;
      }
      if (attempt.settledAt) {
        await releaseIpSlot("already-settled");
        res.status(409).json({ error: "Visit already claimed", alreadyVisited: true }); return;
      }
      if (!attempt.redirectedAt) {
        await releaseIpSlot("not-redirected");
        res.status(400).json({ error: "Open the visit link before claiming the reward." }); return;
      }
      // witnessedAt must be set — proves /c was called (set by /c on the
      // server, not self-reported by the client). Without /c, witnessedAt
      // is null and /visit refuses. A script that skips /c cannot settle.
      if (!attempt.witnessedAt) {
        await releaseIpSlot("not-witnessed");
        res.status(400).json({
          error: "Visit not confirmed — please reopen the link in your browser and stay on the page.",
        });
        return;
      }


      // Dwell time is measured from witnessedAt (set by /c), not redirectedAt. This means:
      //   • The interstitial minimum dwell (MIN_INTERSTITIAL_DWELL_MS, default 5 s)
      //     elapses between /r and /c.
      //   • This additional dwell (MIN_SPONSORED_VISIT_MS, default 10 s) elapses
      //     between /c and /visit.
      //   • Total minimum time: ~15 s per claim, fully server-enforced.
      const MIN_VISIT_MS = parseInt(process.env.MIN_SPONSORED_VISIT_MS ?? "10000", 10);
      const elapsed = Date.now() - attempt.witnessedAt!.getTime();
      if (elapsed < MIN_VISIT_MS) {
        await releaseIpSlot("dwell-too-short");
        res.status(400).json({
          error: "Visit recorded too quickly — please spend a moment on the page.",
          retryAfterMs: Math.ceil(MIN_VISIT_MS - elapsed),
        });
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Install token: access gate + cross-step token consistency ────────
      // The install token (X-Install-Token) is a server-issued, per-user rate-
      // limited access credential.  It is NOT a Sybil detection key.  Its sole
      // role here is:
      //
      //   1. Access gate: the token must exist in device_installs (issued by
      //      /api/device/register) and must belong to this authenticated user.
      //      A client cannot mint a valid token without going through the
      //      server-mediated, rate-limited registration step.
      //   2. Cross-step consistency: if the attempt row has a stored token hash
      //      (written by /begin), we verify that the same server-issued token is
      //      being presented at /visit. This prevents token swapping between the
      //      two steps. Pre-migration attempts (null stored hash) skip this check
      //      and proceed — they are protected by the same server-authoritative
      //      payout gates listed below.
      //
      // No device-based Sybil cap is applied at payout time. Device UUID is a
      // client-supplied identifier; a modified client can rotate it freely and
      // produce unlimited synthetic device identities regardless of any server-
      // side check that trusts it. Applying such a cap would give false
      // confidence in a bypassable control. The device hash from the install
      // record is stored in campaign_clicks for telemetry/forensics only.
      //
      // Payout decisions rely exclusively on server-authoritative gates:
      //   - Per-account daily visit COUNT cap (DB-backed, enforced below)
      //   - Per-IP daily settle cap (DB-backed, enforced above)
      //   - Per-account per-campaign dedup (atomic in the transaction below)
      //   - Per-account daily earnings cap (enforced in the transaction below)
      //   - witnessedAt proof (enforced above)
      //   - Minimum dwell time (enforced above)
      //   - Campaign budget limit (atomic in the transaction below)
      let deviceHash = attempt.deviceHash ?? "";   // kept for campaign_clicks logging only
      // Declared here (outside the inner try) so it remains in scope for
      // the in-transaction visit-count recheck below.
      const acctVisitMax = Math.max(
        1,
        parseInt(process.env.SPONSORED_VISIT_ACCOUNT_DAILY_MAX ?? "10", 10),
      );
      try {
        const { db: dbInstall, deviceInstalls: diTable } = await import("@workspace/db");
        const { eq: eqInstall } = await import("drizzle-orm");
        const [visitInstall] = await dbInstall.select().from(diTable)
          .where(eqInstall(diTable.tokenHash, visitInstallTokenHash));
        if (!visitInstall) {
          req.log.warn({ userId: req.userId }, "Sponsored visit refused — unrecognised install token");
          await releaseIpSlot("unknown-install-token");
          res.status(403).json({ error: "Unrecognised install token — call /api/device/register first." });
          return;
        }
        if (visitInstall.userId !== req.userId) {
          req.log.warn({ userId: req.userId, tokenOwner: visitInstall.userId }, "Sponsored visit refused — install token cross-user");
          await releaseIpSlot("install-token-cross-user");
          res.status(403).json({ error: "Install token does not belong to this account." });
          return;
        }
        // Cross-step consistency: if /begin stored the install token hash, the
        // same token must be presented now.  null means a pre-migration attempt
        // — skip the check and proceed (other gates cover payout integrity).
        if (attempt.deviceHash !== null && visitInstallTokenHash !== attempt.deviceHash) {
          req.log.warn(
            { userId: req.userId, storedHashPrefix: attempt.deviceHash.slice(0, 8) },
            "Sponsored visit refused — install token mismatch between /begin and /visit",
          );
          await releaseIpSlot("install-token-mismatch");
          res.status(400).json({ error: "Credential mismatch — please restart the visit from the app." });
          return;
        }
        // deviceHash from the install record is stored in campaign_clicks for
        // fraud telemetry and forensics only — NOT used as a payout-deny gate.
        // The device UUID is client-supplied at registration; a modified client
        // can rotate it per account, so any settlement-time cap keyed to it
        // gives false confidence without hardware attestation (iOS DeviceCheck /
        // Android Play Integrity). Payout gating uses only server-authoritative
        // signals listed below.
        deviceHash = visitInstall.deviceHash;

        // ── Per-account daily visit count cap (server-authoritative) ─────────
        // Keyed to req.userId from the verified JWT — no client-supplied device
        // identity involved. Counts settled sponsored visits in the past 24h.
        // This is the primary server-authoritative anti-farming bound at payout
        // time. Fail-closed: 503 on DB error. Configurable via
        // SPONSORED_VISIT_ACCOUNT_DAILY_MAX (default 10).
        // Complements: per-IP cap (cross-account same-IP), per-campaign dedup
        // (atomic), per-account earnings cap, witnessedAt, dwell time, budget.
        const { sql: sqlAcct } = await import("drizzle-orm");
        const acctRows = await dbInstall.execute(sqlAcct`
          SELECT COUNT(*)::int AS n
          FROM campaign_clicks
          WHERE visitor_user_id = ${req.userId!}
            AND created_at >= NOW() - INTERVAL '24 hours'
        `);
        const acctCount = Number((acctRows.rows[0] as { n: number }).n);
        if (acctCount >= acctVisitMax) {
          req.log.warn(
            { userId: req.userId, acctCount, acctVisitMax },
            "Sponsored visit refused — per-account daily visit count cap reached",
          );
          await releaseIpSlot("account-daily-visit-cap");
          res.status(429).json({ error: "Daily sponsored-visit limit reached for this account. Try again tomorrow." });
          return;
        }
      } catch (devErr: any) {
        req.log.error({ err: devErr }, "Install token / account visit cap check failed");
        await releaseIpSlot("install-token-check-error");
        res.status(503).json({ error: "Abuse check unavailable — please retry." });
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // Pre-flight: load campaign just to validate target and self-visit.
      // The authoritative budget/active checks happen inside the transaction
      // below via a conditional UPDATE so the result is race-free.
      const [campaign] = await dbClient.select().from(campaignsTable).where(drizzleEqLocal(campaignsTable.id, campaignId));
      if (!campaign) { await releaseIpSlot("campaign-not-found"); res.status(404).json({ error: "Campaign not found" }); return; }
      if (campaign.userId === req.userId) { await releaseIpSlot("self-visit"); res.status(400).json({ error: "You cannot visit your own campaign" }); return; }

      // Use the reward amount captured at /begin time (rewardSnapshot), NOT the
      // current campaign.rewardPerVisit. This locks the payout to what was
      // promised when the user initiated the visit, protecting against any
      // campaign update that occurs between /begin and /visit settlement.
      const reward = Number(attempt.rewardSnapshot);
      const rewardStr = reward.toFixed(2);
      const campaignTitle = campaign.title;

      // Sanity guard: snapshot should never exceed rewardPerVisit by more than
      // a rounding epsilon. If it does, something is wrong with the attempt row.
      if (reward <= 0 || reward > Number(campaign.rewardPerVisit) + 0.005) {
        req.log.error(
          { campaignId, userId: req.userId, snapshot: reward, live: Number(campaign.rewardPerVisit) },
          "Reward snapshot out of range — refusing settlement",
        );
        await releaseIpSlot("reward-snapshot-invalid");
        res.status(400).json({ error: "Invalid visit token — please start a new visit." });
        return;
      }

      // ── Atomic settlement ────────────────────────────────────────────────
      // All three writes (click, campaign spend, user credit) run in one
      // PostgreSQL transaction. The conditional UPDATE on the campaign
      // refuses to spend the last budget slice once it has already been
      // consumed by a concurrent request, so multiple users hitting the
      // boundary cannot all be credited.
      //
      // Errors thrown here roll the whole transaction back, including the
      // click insert — so a budget-exhausted race never leaves a settled
      // click row without a matching credit.
      type SettlementError = "BUDGET_EXHAUSTED" | "ALREADY_VISITED" | "USER_MISSING" | "DAILY_CAP" | "VISIT_COUNT_CAP";

      // Per-user daily sponsored-earnings cap (default $1/day).
      // Enforced inside the transaction so concurrent /visit calls cannot
      // both squeeze past the boundary. Set SPONSORED_DAILY_CAP=0 to disable.
      const dailyCapRaw = process.env.SPONSORED_DAILY_CAP;
      const dailyCap = dailyCapRaw === undefined ? 1.0 : parseFloat(dailyCapRaw);
      const dailyCapEnabled = Number.isFinite(dailyCap) && dailyCap > 0;

      let settledBalance: number | undefined;

      try {
        await dbClient.transaction(async (tx: Parameters<Parameters<typeof dbClient.transaction>[0]>[0]) => {
          // ── SECURITY: parallel daily-count race fix ───────────────────────
          // VULNERABILITY PATCHED: without the advisory lock + in-transaction
          // COUNT recheck below, N concurrent /visit requests all pass the
          // pre-flight COUNT (step 0 outside this function), then race into
          // the settlement transaction where each inserts a click, bypassing
          // the per-account daily cap entirely.
          //
          // FIX — two-step serialization:
          //   0a. pg_advisory_xact_lock(hashtext(userId)): all concurrent
          //       /visit calls for the same user queue here. Only one holds
          //       the lock at a time; it is released automatically at
          //       COMMIT/ROLLBACK.
          //   0b. COUNT recheck inside the lock: by the time a request
          //       acquires the lock, earlier concurrent requests may have
          //       already committed click rows. Re-counting here (while the
          //       lock is held) is the authoritative, race-free check.
          //
          // 0a. Serialize all settlements for this user.
          await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${req.userId!})::bigint)`);

          // 0b. Per-account daily visit COUNT recheck (authoritative, inside lock).
          // The pre-flight check above is an optimization only. Any parallel
          // request that slipped past the pre-flight will be serialized here
          // and see the updated COUNT after earlier commits.
          {
            const countRows = await tx.execute(drizzleSql`
              SELECT COUNT(*)::int AS n
              FROM campaign_clicks
              WHERE visitor_user_id = ${req.userId!}
                AND created_at >= NOW() - INTERVAL '24 hours'
            `);
            const countNow = Number((countRows.rows[0] as { n: number }).n);
            if (countNow >= acctVisitMax) {
              const err = new Error("VISIT_COUNT_CAP") as Error & { settlement?: SettlementError };
              err.settlement = "VISIT_COUNT_CAP";
              throw err;
            }
          }

          // 0c. Daily cap check (defense against Sybil-style automation).
          if (dailyCapEnabled) {
            const sumRows = await tx.execute(drizzleSql`
              SELECT COALESCE(SUM(reward_granted), 0)::text AS total
              FROM campaign_clicks
              WHERE visitor_user_id = ${req.userId!}
                AND created_at >= NOW() - INTERVAL '24 hours'
            `);
            const usedToday = parseFloat(String((sumRows.rows[0] as { total: string }).total));
            if (Number.isFinite(usedToday) && usedToday + reward > dailyCap + 1e-9) {
              const err = new Error("DAILY_CAP") as Error & { settlement?: SettlementError };
              err.settlement = "DAILY_CAP";
              throw err;
            }
          }

          // 1. Insert click first. The unique (campaignId, visitorUserId)
          // index catches double-visits as a Postgres 23505 error which we
          // map to ALREADY_VISITED below.
          await tx.insert(clicksTable).values({
            campaignId,
            visitorUserId: req.userId!,
            rewardGranted: rewardStr,
            visitorDeviceHash: deviceHash,
          });

          // 2. Conditional spend. Only succeeds when the campaign is still
          // active AND has at least `reward` worth of remaining budget.
          // Auto-flips status to 'ended' when this spend would exhaust it.
          const updated = await tx.update(campaignsTable)
            .set({
              spent: drizzleSql`${campaignsTable.spent} + ${rewardStr}`,
              clicks: drizzleSql`${campaignsTable.clicks} + 1`,
              status: drizzleSql`CASE WHEN ${campaignsTable.spent} + ${rewardStr} >= ${campaignsTable.totalBudget} THEN 'ended' ELSE ${campaignsTable.status} END`,
              updatedAt: new Date(),
            })
            .where(drizzleAndLocal(
              drizzleEqLocal(campaignsTable.id, campaignId),
              drizzleSql`${campaignsTable.status} = 'active'`,
              drizzleSql`${campaignsTable.spent} + ${rewardStr} <= ${campaignsTable.totalBudget}`,
            ))
            .returning({ id: campaignsTable.id });

          if (updated.length === 0) {
            const err = new Error("BUDGET_EXHAUSTED") as Error & { settlement?: SettlementError };
            err.settlement = "BUDGET_EXHAUSTED";
            throw err;
          }

          // 3. Credit the visitor (balance + totalEarned + ledger entry).
          const credited = await tx.update(usersTable)
            .set({
              balance: drizzleSql`${usersTable.balance} + ${rewardStr}`,
              totalEarned: drizzleSql`${usersTable.totalEarned} + ${rewardStr}`,
            })
            .where(drizzleEqLocal(usersTable.id, req.userId!))
            .returning({ id: usersTable.id, balance: usersTable.balance });

          if (credited.length === 0) {
            const err = new Error("USER_MISSING") as Error & { settlement?: SettlementError };
            err.settlement = "USER_MISSING";
            throw err;
          }

          settledBalance = parseFloat(credited[0].balance);

          await tx.insert(ledgerTable).values({
            userId: req.userId!,
            amount: rewardStr,
            type: "bonus",
            description: `Sponsored visit: ${campaignTitle}`,
            refId: campaignId,
            provider: "publisher",
          });

          // 4. Mark the attempt single-use. The WHERE settled_at IS NULL
          // guard means a racing second /visit on the same attempt token
          // sees zero updates and we abort (alongside the unique-click
          // index, this is belt-and-suspenders against replay).
          const consumed = await tx.update(attemptsTable)
            .set({ settledAt: new Date() })
            .where(drizzleAndLocal(
              drizzleEqLocal(attemptsTable.token, attemptToken),
              drizzleSql`${attemptsTable.settledAt} IS NULL`,
            ))
            .returning({ id: attemptsTable.id });
          if (consumed.length === 0) {
            const err = new Error("ALREADY_CLAIMED") as Error & { settlement?: SettlementError };
            err.settlement = "ALREADY_VISITED";
            throw err;
          }
        });
      } catch (txErr: any) {
        const settlement: SettlementError | undefined = txErr?.settlement;
        if (settlement === "BUDGET_EXHAUSTED") {
          await releaseIpSlot("budget-exhausted");
          res.status(400).json({ error: "Campaign budget exhausted" }); return;
        }
        if (settlement === "DAILY_CAP") {
          await releaseIpSlot("per-user-daily-cap");
          res.status(429).json({
            error: "Daily sponsored-visit earnings cap reached. Try again tomorrow.",
            dailyCap,
          });
          return;
        }
        if (settlement === "VISIT_COUNT_CAP") {
          await releaseIpSlot("visit-count-cap");
          res.status(429).json({ error: "Daily sponsored-visit limit reached for this account. Try again tomorrow." });
          return;
        }
        if (settlement === "USER_MISSING") {
          await releaseIpSlot("user-missing");
          res.status(404).json({ error: "User not found" }); return;
        }
        // Unique constraint violation = already visited.
        if (txErr?.code === "23505" || txErr?.cause?.code === "23505") {
          await releaseIpSlot("already-visited");
          res.status(409).json({ error: "Already visited this campaign", alreadyVisited: true }); return;
        }
        throw txErr;
      }

      // Settlement succeeded — IP slot is legitimately consumed. Clear the
      // flag so the outer catch does not double-decrement on an unrelated error.
      ipSlotConsumed = false;

      // Fire-and-forget: notify the user if their balance just crossed $1
      if (settledBalance !== undefined) {
        maybeSendThresholdPush(req.userId!, settledBalance - reward, settledBalance);
      }

      req.log.info({ userId: req.userId, campaignId, reward }, "Sponsored visit recorded");
      res.json({ ok: true, reward, message: `You earned $${reward.toFixed(2)}!` });
    } catch (err: any) {
      // Release the IP slot for any unhandled error so that unexpected failures
      // do not permanently consume a user's daily allowance.
      await releaseIpSlot("unhandled-error");
      if (err?.code === "23505") {
        res.status(409).json({ error: "Already visited this campaign", alreadyVisited: true });
        return;
      }
      req.log.error({ err }, "Record sponsored visit failed");
      res.status(500).json({ error: "Failed to record visit" });
    }
  });

  app.use("/api", venturesRouter);

  const httpServer = createServer(app);
  return httpServer;
}
