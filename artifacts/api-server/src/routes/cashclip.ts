import type { Express } from "express";
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
import { storage } from "../storage";
import { updateUserProfileSchema } from "@workspace/db";
import { buildDemographicEntryUrl } from "../lib/demographicUrl";
import venturesRouter from "./ventures";
import { sendPayPalPayout, isPayPalConfigured } from "../paypal";
import { registerSurveyRoutes } from "../surveys";
import { registerOfferwallRoutes } from "../offerwalls";
import { resolveTierForAmount, getAvailableTiers, WITHDRAWAL_TIERS, DAILY_WITHDRAWAL_MAX } from "../withdrawalTiers";
import { sendWithdrawalRequestedAdmin, sendWithdrawalStatusUpdate, sendSupportTicket } from "../lib/email";
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

  app.get("/api/integrations/status", (_req, res) => {
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

    const newSecret = process.env["JWT_TRIDENTE"] ?? process.env["JWT_SECRET"];
    if (!newSecret || newSecret.length < 8) {
      res.status(500).json({
        error: "JWT_TRIDENTE is not configured on the server — cannot derive a new encryption key",
      }); return;
    }

    if (oldSecret === newSecret) {
      res.status(400).json({
        error: "oldSecret is identical to the current JWT_TRIDENTE — rotation is a no-op",
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

  app.get("/api/integrations/:id", (req, res): void => {
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
        const updated = await storage.updateWithdrawalStatus(
          claimed.id,
          "paid",
          `PayPal batch: ${result.batchId}`
        );
        res.json({ withdrawal: updated, batchId: result.batchId });
        sendWithdrawalStatusUpdate({
          toEmail: claimed.paypalEmail,
          username: claimed.username,
          amount: claimed.amount,
          totalPayout: claimed.totalPayout,
          status: "paid",
        }).catch(() => {});
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
    });
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
      res.json({
        users: rows.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email ?? null,
          emailVerified: u.emailVerified ?? false,
          role: u.role,
          balance: u.balance,
          totalEarned: u.totalEarned,
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
      const bcrypt = await import("bcryptjs");
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUserPassword(userId, hashed);
      req.log?.info({ adminId: req.userId, targetUserId: userId }, "admin reset user password — prior tokens invalidated");
      res.json({ message: "Password reset successfully", username: target.username });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to reset password" });
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
      const { z } = await import("zod/v4");
      const schema = z.object({
        title: z.string().min(3).max(80),
        description: z.string().min(10).max(300),
        targetUrl: z.url(),
        rewardPerVisit: z.number().min(0.01).max(0.50),
        totalBudget: z.number().min(0.50).max(500),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid campaign data" }); return; }

      const user = await storage.getUser(req.userId!);
      if (!user?.isPublisher) { res.status(403).json({ error: "Publisher access required" }); return; }

      const { totalBudget } = parsed.data;

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
            ...parsed.data,
            totalBudget: String(totalBudget),
            rewardPerVisit: String(parsed.data.rewardPerVisit),
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
      const { randomBytes } = await import("crypto");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await dbClient.insert(attemptsTable).values({
        token,
        campaignId,
        userId: req.userId!,
        rewardSnapshot: String(campaign.rewardPerVisit),
        expiresAt,
      });

      // Build the redirect URL on our own domain. The mobile/web client opens
      // THIS url, which means the server gets a real HTTP fetch it can stamp
      // before 302'ing to the advertiser. /visit will require redirectedAt to
      // be set, so a script that never hits the redirect URL cannot settle.
      const base = process.env.PUBLIC_BASE_URL
        ?? (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : `${req.protocol}://${req.get("host")}`);
      const redirectUrl = `${base.replace(/\/+$/, "")}/api/earn/sponsored/r/${token}`;

      res.json({ attemptToken: token, redirectUrl });
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

      const [campaign] = await dbClient.select().from(campaignsTable)
        .where(drizzleEqLocal(campaignsTable.id, attempt.campaignId));
      if (!campaign) { res.status(404).send("Campaign not found"); return; }

      // Stamp redirectedAt + bind this attempt to the redirecting client's
      // IP and User-Agent ONCE. /witness must arrive from a matching client
      // (same IP, same UA hash) and /visit only settles after both fire.
      // The COALESCE guards make the first fetch authoritative; concurrent
      // fetches against the same token cannot rebind to a different client.
      const ip = getClientIp(req);
      const ua = String(req.headers["user-agent"] ?? "");
      const ipHash = createHash("sha256").update(ip).digest("hex");
      const uaHash = createHash("sha256").update(ua).digest("hex");

      // Completion sig: HMAC-SHA256(JWT_SECRET, "completion:" + token).
      // Used by /c/:token to verify the request originated from this
      // interstitial flow. The sig alone is not sufficient to claim a reward —
      // /c/:token also enforces a server-side minimum dwell time (elapsed since
      // redirectedAt), so a script that parses the sig from the HTML and
      // immediately calls /c will be rejected with 425 Too Early.
      const { createHmac } = await import("crypto");
      const completionSig = createHmac("sha256", (process.env.JWT_TRIDENTE ?? process.env.JWT_SECRET)!)
        .update("completion:" + token)
        .digest("hex");
      const completionPath = "/api/earn/sponsored/c/" + token + "?q=" + completionSig;

      // Minimum time (ms) the interstitial must remain open before /c/:token
      // accepts the witnessedAt stamp. Enforced both client-side (countdown)
      // and server-side (/c rejects with 425 if called too early).
      const MIN_INTERSTITIAL_MS = Math.max(
        1000,
        parseInt(process.env.MIN_INTERSTITIAL_DWELL_MS ?? "5000", 10),
      );

      // Hard NULL guard so a second /r fetch cannot rebind even if the
      // COALESCE plan ever changes — the UPDATE simply matches zero rows.
      await dbClient.update(attemptsTable)
        .set({
          redirectedAt: drizzleSql`NOW()`,
          redirectIpHash: ipHash,
          redirectUaHash: uaHash,
        })
        .where(drizzleAndLocal(
          drizzleEqLocal(attemptsTable.token, token),
          drizzleSql`${attemptsTable.redirectedAt} IS NULL`,
        ));

      // Interstitial HTML:
      //   1. A hidden iframe pre-fetches the advertiser URL, requiring a real
      //      browser to make a cross-origin network request to the advertiser's
      //      server. A plain HTTP script (curl/fetch without a JS engine) cannot
      //      cause an iframe to fire onload — raising the bar for automation.
      //   2. A server-enforced countdown (MIN_INTERSTITIAL_MS) must elapse before
      //      the JS calls /c/:token. /c rejects early calls with 425 Too Early,
      //      so even a headless browser that parses the sig from the HTML must
      //      genuinely wait.
      //   3. After both iframe signal AND timer fire, JS sends the completion
      //      request as an XHR (not navigation) then navigates to the advertiser.
      const escapeHtml = (s: string) => s
        .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag — safeForScript uses JSON.stringify + script-break neutralization; escapedTitle/escapedCompletionPath use escapeHtml()
      const safeForScript = (s: string) => JSON.stringify(s)
        .replace(/<\/script/gi, "<\\/script")
        .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      const escapedCompletionPath = escapeHtml(completionPath);
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
  var completionPath=${safeForScript(completionPath)};
  var advertiserUrl=${safeForScript(safeTargetUrl)};
  var minMs=${MIN_INTERSTITIAL_MS};
  var startMs=Date.now();
  var iframeReady=false;
  var timerFired=false;
  var settling=false;
  var timerEl=document.getElementById('cc-timer');

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
    sendCompletion(0);
  }

  function sendCompletion(retryDelayMs){
    if(retryDelayMs>0){setTimeout(function(){sendCompletion(0);},retryDelayMs);return;}
    var xhr=new XMLHttpRequest();
    xhr.open('GET',completionPath,true);
    xhr.setRequestHeader('Accept','application/json');
    xhr.onload=function(){
      if(xhr.status===425){
        // Server says too early — honour its retryAfterMs then retry once
        try{var d=JSON.parse(xhr.responseText);sendCompletion((d.retryAfterMs||1000)+100);}
        catch(e){sendCompletion(1100);}
        return;
      }
      navigate();
    };
    xhr.onerror=function(){navigate();};
    xhr.send();
  }

  function navigate(){
    if(advertiserUrl){
      try{window.location.replace(advertiserUrl);}catch(e){window.location.href=advertiserUrl;}
    }
  }

  // Hard fallback: navigate after minMs + 10 s in case JS stalls
  setTimeout(navigate,minMs+10000);
})();
</script>
<noscript><meta http-equiv="refresh" content="${countdownSecs};url=${escapedCompletionPath}"></noscript>
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
   *    set witnessedAt; rate limits on /begin + /visit bound the damage.
   *  - Sig is single-use in effect: COALESCE guard ensures a second /c call
   *    for the same token is a no-op (witnessedAt already set).
   */
  app.get("/api/earn/sponsored/c/:token", async (req, res) => {
    const token = String(req.params.token);
    const qSig = String(req.query.q ?? "");
    let targetUrl: string | undefined;

    try {
      if (!/^[a-f0-9]{64}$/.test(token)) {
        res.status(404).send("Not found"); return;
      }

      // ── Signature verification (before any DB access) ─────────────────────
      if (!qSig) {
        res.status(403).send("Missing completion signature"); return;
      }
      const { createHmac, timingSafeEqual } = await import("crypto");
      const expectedSig = createHmac("sha256", (process.env.JWT_TRIDENTE ?? process.env.JWT_SECRET)!)
        .update("completion:" + token)
        .digest("hex");
      const sigOk = qSig.length === expectedSig.length &&
        timingSafeEqual(Buffer.from(qSig), Buffer.from(expectedSig));
      if (!sigOk) {
        res.status(403).send("Invalid completion signature"); return;
      }
      // ──────────────────────────────────────────────────────────────────────

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
        const wantsJson = String(req.headers.accept ?? "").includes("application/json");
        if (wantsJson) {
          res.status(425).json({ error: "Too early — stay on the page.", retryAfterMs });
        } else {
          res.status(425).send(`Too early — please wait ${Math.ceil(retryAfterMs / 1000)} more second(s).`);
        }
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      if (!attempt.settledAt && !attempt.witnessedAt) {
        // Server-observed completion: record witnessedAt atomically.
        // COALESCE guard ensures concurrent /c calls for the same token
        // are idempotent — only the first one sets the timestamp.
        await dbClient.update(attemptsTable)
          .set({ witnessedAt: drizzleSql`COALESCE(${attemptsTable.witnessedAt}, NOW())` })
          .where(drizzleAndLocal(
            drizzleEqLocal(attemptsTable.token, token),
            drizzleSql`${attemptsTable.witnessedAt} IS NULL`,
          ));
        req.log?.info?.({ token: token.slice(0, 8) + "…" }, "Sponsored completion redirect recorded");
      }

      // When called as XHR from the interstitial JS (Accept: application/json),
      // return JSON so the JS can confirm success without following the redirect.
      // When called as a navigation (e.g. noscript fallback), redirect as before.
      const wantsJsonResp = String(req.headers.accept ?? "").includes("application/json");
      if (!targetUrl) {
        if (wantsJsonResp) {
          res.status(410).json({ error: "Campaign no longer available" }); return;
        }
        res.status(410).send("Campaign no longer available"); return;
      }
      if (wantsJsonResp) {
        res.json({ ok: true });
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.redirect(302, targetUrl);
    } catch (err: any) {
      req.log?.error?.({ err }, "Sponsored completion redirect failed");
      // Best-effort: redirect to target even on error so the user is not
      // stuck on a dead page — the settlement check in /visit will catch
      // the missing witnessedAt if the DB write failed.
      if (targetUrl) {
        res.redirect(302, targetUrl);
      } else {
        res.status(500).send("Redirect failed");
      }
    }
  });

  /** Earn: record a sponsored campaign visit + credit the visitor.
   *  Requires a visitToken from /begin, and enforces a minimum dwell time
   *  to prove the user actually had the page open.
   */
  app.post("/api/earn/sponsored/:id/visit", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const campaignId = String(req.params.id);

      // Per-install Sybil cap — the mobile client mints a persistent UUID in
      // AsyncStorage on first launch and sends it as X-Device-Id. If the
      // same install has already credited more than N distinct user accounts
      // in the last 24h we refuse — this is the strongest signal we have
      // that someone is farming throwaway accounts on one physical device.
      // Default 2 distinct accounts/day per device; override via env.
      const rawDeviceId = String(req.headers["x-device-id"] ?? "").slice(0, 128);
      let deviceHash: string | null = null;
      if (rawDeviceId && /^[0-9a-fA-F-]{8,128}$/.test(rawDeviceId)) {
        const { createHash: hashFn } = await import("crypto");
        deviceHash = hashFn("sha256").update(rawDeviceId).digest("hex");
        const deviceAccountCap = Math.max(
          1,
          parseInt(process.env.SPONSORED_VISIT_DEVICE_ACCOUNT_CAP ?? "2", 10),
        );
        try {
          const { db: dbCheck } = await import("@workspace/db");
          const { sql: sqlCheck } = await import("drizzle-orm");
          const rows = await dbCheck.execute(sqlCheck`
            SELECT COUNT(DISTINCT visitor_user_id)::int AS n
            FROM campaign_clicks
            WHERE visitor_device_hash = ${deviceHash}
              AND created_at >= NOW() - INTERVAL '24 hours'
          `);
          const distinct = Number((rows.rows[0] as { n: number }).n);
          // Allow this user if they already appear in the set; otherwise the
          // (existing + 1) projection must stay within the cap.
          const { db: dbExists } = await import("@workspace/db");
          const existsRows = await dbExists.execute(sqlCheck`
            SELECT 1 FROM campaign_clicks
            WHERE visitor_device_hash = ${deviceHash}
              AND visitor_user_id = ${req.userId!}
              AND created_at >= NOW() - INTERVAL '24 hours'
            LIMIT 1
          `);
          const alreadyCounted = existsRows.rows.length > 0;
          if (!alreadyCounted && distinct + 1 > deviceAccountCap) {
            req.log.warn(
              { userId: req.userId, deviceHashPrefix: deviceHash.slice(0, 8), distinct },
              "Sponsored visit refused — too many accounts on one device install",
            );
            res.status(429).json({
              error: "Too many accounts active on this device. Try again tomorrow.",
            });
            return;
          }
        } catch (devErr: any) {
          req.log.error({ err: devErr }, "Device-ID Sybil check failed");
          res.status(503).json({ error: "Abuse check unavailable — please retry." });
          return;
        }
      }

      // Per-IP daily settle cap — the most important damage limiter. Even if
      // an attacker bypasses the witness gate with a headless browser, this
      // bounds how much money any single source IP can drain in 24h across
      // any number of Sybil accounts. Default 8/day; override via env.
      //
      // IMPORTANT: only peek here (checkLoginAttempts). The counter is
      // incremented (recordLoginAttempt) AFTER a successful settlement so
      // legitimate users whose request 4xxs out (budget exhausted, already
      // visited, dwell-time too short, …) are not soft-banned for the day.
      // Two concurrent requests racing past the peek is acceptable for a
      // daily cap at this magnitude.
      const { getClientIp: getIp } = await import("../lib/clientIp");
      const { checkLoginAttempts: peek } = await import("../lib/dbRateLimit");
      const visitIpLimit = Math.max(1, parseInt(process.env.SPONSORED_VISIT_IP_LIMIT ?? "8", 10));
      const ipKey = `sponsored:visit:ip:${getIp(req)}`;
      try {
        const ipCheck = await peek(ipKey, visitIpLimit);
        if (!ipCheck.allowed) {
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
      // Backwards-compat: accept either `attemptToken` (new flow) or
      // `visitToken` (older clients) — the value is the same shape (hex token).
      const body = (req.body ?? {}) as { attemptToken?: string; visitToken?: string };
      const attemptToken = body.attemptToken ?? body.visitToken;

      if (!attemptToken || typeof attemptToken !== "string" || !/^[a-f0-9]{64}$/.test(attemptToken)) {
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
        res.status(400).json({ error: "Invalid or expired visit token." }); return;
      }
      if (attempt.userId !== req.userId || attempt.campaignId !== campaignId) {
        res.status(400).json({ error: "Visit token does not match this campaign." }); return;
      }
      if (attempt.expiresAt.getTime() < Date.now()) {
        res.status(400).json({ error: "Visit token expired — please try again." }); return;
      }
      if (attempt.settledAt) {
        res.status(409).json({ error: "Visit already claimed", alreadyVisited: true }); return;
      }
      if (!attempt.redirectedAt) {
        res.status(400).json({ error: "Open the visit link before claiming the reward." }); return;
      }
      // Witness beacon must have fired — proves a real browser executed the
      // interstitial JS, not just a scripted GET of /r/:token. Without this
      // gate /visit could be claimed by `curl /begin; curl /r/:token; sleep
      // 5; curl /visit` against every active campaign.
      if (!attempt.witnessedAt) {
        res.status(400).json({
          error: "Visit not confirmed — please reopen the link in your browser and stay on the page.",
        });
        return;
      }

      // Dwell time is measured from witnessedAt (the server-observed timestamp
      // set by /c/:token after the interstitial dwell gate passed), not from
      // redirectedAt. This means:
      //   • The interstitial minimum dwell (MIN_INTERSTITIAL_DWELL_MS, default 5 s)
      //     elapses between /r and /c.
      //   • This additional dwell (MIN_SPONSORED_VISIT_MS, default 10 s) elapses
      //     between /c and /visit.
      //   • Total minimum time: ~15 s per claim, fully server-enforced.
      const MIN_VISIT_MS = parseInt(process.env.MIN_SPONSORED_VISIT_MS ?? "10000", 10);
      const elapsed = Date.now() - attempt.witnessedAt!.getTime();
      if (elapsed < MIN_VISIT_MS) {
        res.status(400).json({
          error: "Visit recorded too quickly — please spend a moment on the page.",
          retryAfterMs: Math.ceil(MIN_VISIT_MS - elapsed),
        });
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // Pre-flight: load campaign just to validate target and self-visit.
      // The authoritative budget/active checks happen inside the transaction
      // below via a conditional UPDATE so the result is race-free.
      const [campaign] = await dbClient.select().from(campaignsTable).where(drizzleEqLocal(campaignsTable.id, campaignId));
      if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
      if (campaign.userId === req.userId) { res.status(400).json({ error: "You cannot visit your own campaign" }); return; }

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
      type SettlementError = "BUDGET_EXHAUSTED" | "ALREADY_VISITED" | "USER_MISSING" | "DAILY_CAP";

      // Per-user daily sponsored-earnings cap (default $1/day).
      // Enforced inside the transaction so concurrent /visit calls cannot
      // both squeeze past the boundary. Set SPONSORED_DAILY_CAP=0 to disable.
      const dailyCapRaw = process.env.SPONSORED_DAILY_CAP;
      const dailyCap = dailyCapRaw === undefined ? 1.0 : parseFloat(dailyCapRaw);
      const dailyCapEnabled = Number.isFinite(dailyCap) && dailyCap > 0;

      try {
        await dbClient.transaction(async (tx) => {
          // 0a. Per-user advisory lock so concurrent /visit settlements by
          // the same user serialize through the cap check below. Without
          // this, two parallel requests against different campaigns can
          // both read the same pre-cap SUM and both squeeze past the cap.
          // hashtext() of the userId UUID gives a stable int4 we cast to
          // bigint for the xact-scoped lock (released at COMMIT/ROLLBACK).
          await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(hashtext(${req.userId!})::bigint)`);

          // 0b. Daily cap check (defense against Sybil-style automation).
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
            .returning({ id: usersTable.id });

          if (credited.length === 0) {
            const err = new Error("USER_MISSING") as Error & { settlement?: SettlementError };
            err.settlement = "USER_MISSING";
            throw err;
          }

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
          res.status(400).json({ error: "Campaign budget exhausted" }); return;
        }
        if (settlement === "DAILY_CAP") {
          res.status(429).json({
            error: "Daily sponsored-visit earnings cap reached. Try again tomorrow.",
            dailyCap,
          });
          return;
        }
        if (settlement === "USER_MISSING") {
          res.status(404).json({ error: "User not found" }); return;
        }
        // Unique constraint violation = already visited.
        if (txErr?.code === "23505" || txErr?.cause?.code === "23505") {
          res.status(409).json({ error: "Already visited this campaign", alreadyVisited: true }); return;
        }
        throw txErr;
      }

      // Only consume an IP-cap slot AFTER the settlement actually credited.
      // Best-effort: a failed counter write must not undo the credit.
      try {
        const { recordLoginAttempt: rec } = await import("../lib/dbRateLimit");
        await rec(ipKey, visitIpLimit, 24 * 60 * 60 * 1000);
      } catch (incErr) {
        req.log.warn({ err: incErr }, "Sponsored /visit IP cap increment failed (settlement already credited)");
      }

      req.log.info({ userId: req.userId, campaignId, reward }, "Sponsored visit recorded");
      res.json({ ok: true, reward, message: `You earned $${reward.toFixed(2)}!` });
    } catch (err: any) {
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
