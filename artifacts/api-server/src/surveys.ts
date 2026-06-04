import type { Express, Request, Response } from "express";
import {
  fetchExternalSurveys,
  verifyProviderCompletion,
  getProviderStatus,
  buildCpxWallUrl,
  type SurveyProviderKey,
  type ExternalSurvey,
  type CompletionVerifyResponse,
} from "./lib/surveyProviders";
import { verifyWebhook, logWebhookVerificationFailure } from "./lib/webhookAuth";
import { webhookRateLimiter } from "./lib/webhookRateLimit";
import { authMiddleware, adminMiddleware, type AuthRequest } from "./auth";
import { storage } from "./storage";
import { recordIssuedOffers, getIssuedOffer, generateSessionToken } from "./issuedOffers";
import { buildDemographicEntryUrl } from "./lib/demographicUrl";
import { getClientIp, getEndUserPublicIp } from "./lib/clientIp";

const SESSION_TTL_MS = 60 * 60 * 1000;

const PROVIDER_REWARD_RANGES: Record<SurveyProviderKey | string, { min: number; max: number }> = {
  pollfish: { min: 0.30, max: 1.50 },
  cint: { min: 1.00, max: 5.00 },
  lucid: { min: 0.80, max: 4.00 },
  cpx: { min: 0.20, max: 3.00 },
  bitlabs: { min: 0.20, max: 2.50 },
  internal: { min: 0.15, max: 0.75 },
};

export function registerSurveyRoutes(app: Express): void {
  app.get("/api/surveys/providers", adminMiddleware, (_req: Request, res: Response) => {
    const statuses = getProviderStatus();
    res.json({
      providers: statuses,
      anyConfigured: statuses.some((s) => s.configured),
    });
  });

  app.get("/api/surveys/available", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const providerStatuses = getProviderStatus();
      const configuredProviders = providerStatuses.filter((p) => p.configured);

      if (configuredProviders.length === 0) {
        res.json({
          surveys: [],
          providers: providerStatuses,
          message: "No survey providers configured yet. Add POLLFISH_API_KEY, CINT_API_KEY, or LUCID_API_KEY to enable external surveys.",
        }); return;
      }

      // Geo-targeting providers (CPX) need the real end-user PUBLIC IP, not the
      // rightmost proxy hop getClientIp returns for abuse control. A private/
      // missing IP makes CPX return 0 surveys → the list collapses to one card.
      const endUserIp = getEndUserPublicIp(req);
      console.log(`[Surveys] available: cpx geo ip_user resolved=${endUserIp ? "yes" : "none"} user=${req.userId}`);
      const results = await fetchExternalSurveys(String(req.userId!), {
        ipUser: endUserIp,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      });
      const allSurveys: ExternalSurvey[] = results.flatMap((r) => r.surveys);

      const clamped = allSurveys.map((s) => {
        const range = PROVIDER_REWARD_RANGES[s.provider] || { min: 0.10, max: 5.00 };
        const safeReward = Math.max(range.min, Math.min(range.max, s.reward));
        return { ...s, reward: parseFloat(safeReward.toFixed(2)) };
      });

      recordIssuedOffers(
        req.userId!,
        "survey",
        clamped.map((s) => ({ id: s.id, provider: s.provider, reward: s.reward, surveyUrl: s.surveyUrl }))
      );

      res.json({
        surveys: clamped,
        providers: providerStatuses,
        count: clamped.length,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch surveys" });
    }
  });

  app.post("/api/surveys/start", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId, provider } = req.body;
      if (!surveyId || !provider) {
        res.status(400).json({ error: "surveyId and provider are required" }); return;
      }

      const issued = getIssuedOffer(req.userId!, surveyId, "survey");
      if (!issued) {
        res.status(403).json({
          error: "Survey is not available for this user. Refresh the survey list and try again.",
        }); return;
      }
      if (issued.provider !== provider) {
        res.status(400).json({ error: "Provider mismatch for this survey" }); return;
      }

      const surveyUrl: string | undefined = issued.surveyUrl;

      const alreadyClaimed = await storage.findCompletedRewardSession(req.userId!, "survey", surveyId);
      if (alreadyClaimed) {
        res.status(409).json({ error: "Reward for this survey has already been claimed" }); return;
      }

      const reward = issued.expectedReward;
      const sessionToken = generateSessionToken("svsess");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await storage.createRewardSession({
        sessionToken,
        userId: req.userId!,
        source: "survey",
        provider,
        externalId: surveyId,
        expectedReward: reward,
        expiresAt,
      });

      // Build demographic-enriched entry URL for the provider
      let surveyEntryUrl: string | undefined;
      if (provider === "cpx") {
        // Individual CPX survey: open its per-user signed deep link directly.
        // CPX's `href` already embeds ext_user_id + survey_id + a signed token,
        // so it launches that exact survey. Only accept cpx-research.com links
        // and only for non-wall ids; otherwise fall back to the full offerwall.
        const isCpxLink = (() => {
          if (surveyId === "cpx_wall" || !surveyUrl || typeof surveyUrl !== "string") return false;
          try {
            const u = new URL(surveyUrl);
            if (u.protocol !== "https:") return false;
            const h = u.hostname.toLowerCase();
            return h === "cpx-research.com" || h.endsWith(".cpx-research.com");
          } catch { return false; }
        })();
        if (isCpxLink) {
          surveyEntryUrl = surveyUrl;
        } else {
          const appId = process.env.CPX_APP_ID;
          const apiKey = process.env.CPX_API_KEY;
          if (appId && apiKey) {
            let cpxUsername: string | undefined;
            let cpxEmail: string | undefined;
            try {
              const cpxUser = await storage.getUser(req.userId!);
              if (cpxUser) {
                cpxUsername = cpxUser.username;
                cpxEmail = cpxUser.email ?? undefined;
              }
            } catch { /* non-fatal — proceed without enrichment */ }
            surveyEntryUrl = buildCpxWallUrl(req.userId!, appId, apiKey, cpxUsername, cpxEmail);
          }
        }
      } else if (surveyUrl && typeof surveyUrl === "string") {
        try {
          const userProfile = await storage.getUserProfile(req.userId!);
          surveyEntryUrl = buildDemographicEntryUrl(surveyUrl, provider, req.userId!, {
            dateOfBirth: userProfile?.dateOfBirth ?? undefined,
            gender: userProfile?.gender ?? undefined,
            zipCode: userProfile?.zipCode ?? undefined,
            country: userProfile?.country ?? "US",
            employmentStatus: userProfile?.employmentStatus ?? undefined,
            householdIncome: userProfile?.householdIncome ?? undefined,
            educationLevel: userProfile?.educationLevel ?? undefined,
            ethnicity: userProfile?.ethnicity ?? undefined,
          });
        } catch {
          surveyEntryUrl = surveyUrl;
        }
      }

      const startMessage = "Survey session started. Complete the survey and call /api/surveys/complete with this sessionToken to claim your reward.";

      res.json({
        sessionToken,
        surveyId,
        provider,
        estimatedReward: reward,
        expiresAt: expiresAt.toISOString(),
        surveyEntryUrl,
        message: startMessage,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to start survey session" });
    }
  });

  app.post("/api/surveys/complete", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { sessionToken, transactionId: rawTransactionId } = req.body;
      const transactionId = typeof rawTransactionId === "string" ? rawTransactionId.trim() : rawTransactionId;
      if (!sessionToken || typeof sessionToken !== "string") {
        res.status(400).json({ error: "sessionToken is required" }); return;
      }

      const session = await storage.getRewardSession(sessionToken);
      if (!session || session.userId !== req.userId || session.source !== "survey") {
        res.status(404).json({ error: "Survey session not found" }); return;
      }
      if (session.status === "completed") {
        res.status(409).json({ error: "Survey already completed and reward claimed" }); return;
      }
      if (new Date(session.expiresAt).getTime() < Date.now()) {
        res.status(410).json({ error: "Survey session expired" }); return;
      }

      if (typeof transactionId !== "string" || transactionId.length === 0) {
        res.status(400).json({
          error: "Provider transactionId is required to verify survey completion.",
        }); return;
      }

      const alreadyGloballyUsed = await storage.findCompletedSessionByProviderTransactionId(
        "survey",
        session.provider,
        transactionId,
      );
      if (alreadyGloballyUsed) {
        res.status(409).json({
          error: "This provider transaction ID has already been used to claim a reward.",
        }); return;
      }

      let verifyResult: CompletionVerifyResponse;
      let providerVerified = true;
      try {
        verifyResult = await verifyProviderCompletion({
          surveyId: session.externalId,
          provider: session.provider as SurveyProviderKey,
          userId: req.userId!,
          transactionId,
        });
        if (!verifyResult.verified) {
          providerVerified = false;
          // Do not fail-open: if the configured provider rejected the transaction
          // ID the survey was not actually completed. Crediting anyway would let
          // attackers mint survey payouts with arbitrary transaction IDs.
          res.status(402).json({
            error: "Survey completion could not be verified with the provider. Complete the survey fully before claiming.",
            providerVerified: false,
          }); return;
        }
      } catch (e) {
        providerVerified = false;
        // Transient provider error — fail closed rather than crediting
        // an unverified completion. The user can retry once the provider
        // is reachable again.
        res.status(503).json({
          error: "Could not reach the survey provider to verify completion. Please try again in a moment.",
          providerVerified: false,
        }); return;
      }

      const providerBounds = PROVIDER_REWARD_RANGES[session.provider] ?? { min: 0.10, max: 5.00 };
      const rawFinal =
        Number.isFinite(verifyResult.reward) && verifyResult.reward > 0
          ? verifyResult.reward
          : parseFloat(session.expectedReward);
      const finalReward = Math.max(providerBounds.min, Math.min(providerBounds.max, rawFinal));

      await storage.completeRewardSessionAndCredit({
        sessionToken,
        userId: req.userId!,
        type: "survey",
        description: `Survey completed (${session.provider})`,
        providerTransactionId: transactionId,
        finalReward,
      });

      res.json({ verified: true, reward: finalReward, surveyId: session.externalId, provider: session.provider, providerVerified });
    } catch (err) {
      res.status(500).json({ error: "Failed to claim survey reward" });
    }
  });

  async function creditSurveyViaWebhook(
    provider: SurveyProviderKey,
    userId: string,
    surveyId: string,
    rewardValue: number | undefined,
    logPrefix: string,
  ): Promise<boolean> {
    try {
      const session = await storage.findPendingRewardSession(userId, "survey", surveyId);
      if (!session) {
        return false;
      }
      const rawReward = rewardValue ?? parseFloat(session.expectedReward);
      const range = PROVIDER_REWARD_RANGES[provider] || { min: 0.10, max: 5.00 };
      const clampedReward = Math.max(range.min, Math.min(range.max, rawReward));
      const result = await storage.completeRewardSessionAndCredit({
        sessionToken: session.sessionToken,
        userId,
        type: "survey",
        description: `Survey completed via ${provider} webhook`,
        finalReward: clampedReward,
      });
      if ("conflict" in result) {
        // duplicate = this provider txn was already credited → settled.
        // not_claimable = the pending session vanished between our find and the
        // credit update. Usually a racing webhook already credited it, but it
        // can also be a just-expired session that was never credited. Return
        // not-settled so the guarded recorder runs hasCreditedCompletion: the
        // racing case is suppressed, the genuine expiry case is recorded.
        return result.conflict === "duplicate";
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  // Record a verified-but-uncredited survey completion for reconciliation —
  // unless it was already credited (webhook retry / provider resend), which
  // would otherwise create a false-positive unsettled row that risks a double
  // payout during reconciliation.
  async function recordUnsettledSurvey(
    provider: string,
    userId: string,
    externalId: string,
    providerTransactionId: string | null,
    rewardValue: number | null | undefined,
  ): Promise<void> {
    if (await storage.hasCreditedCompletion("survey", userId, externalId, providerTransactionId)) return;
    await storage.recordUnsettledCompletion({
      source: "survey",
      provider,
      userId,
      externalId,
      providerTransactionId,
      rewardValue: rewardValue ?? null,
      reason: "no_pending_session",
    });
  }

  app.get("/api/surveys/webhook/pollfish", webhookRateLimiter, async (req: Request, res: Response): Promise<void> => {
    const auth = verifyWebhook("pollfish", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "pollfish", auth.reason ?? "unknown");
      res.status(403).send("Forbidden"); return;
    }
    const { survey_id, user_id, reward_value, status } = req.query;
    if (status === "completed" && survey_id && user_id) {
      const reward = typeof reward_value === "string" ? parseFloat(reward_value) : undefined;
      const credited = await creditSurveyViaWebhook(
        "pollfish",
        String(user_id),
        `pollfish_${survey_id}`,
        Number.isFinite(reward) ? reward : undefined,
        "[Pollfish Webhook]",
      );
      if (!credited) {
        await recordUnsettledSurvey("pollfish", String(user_id), `pollfish_${survey_id}`, null, Number.isFinite(reward) ? reward : null);
      }
    }
    res.status(200).send("OK");
  });

  app.post("/api/surveys/webhook/cint", webhookRateLimiter, async (req: Request, res: Response): Promise<void> => {
    const auth = verifyWebhook("cint", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "cint", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { survey_id, respondent_id, status, cpi } = req.body;
    if (status === "completed" && survey_id && respondent_id) {
      const reward = typeof cpi === "number" ? cpi : typeof cpi === "string" ? parseFloat(cpi) : undefined;
      const credited = await creditSurveyViaWebhook(
        "cint",
        String(respondent_id),
        `cint_${survey_id}`,
        Number.isFinite(reward) ? reward : undefined,
        "[Cint Webhook]",
      );
      if (!credited) {
        await recordUnsettledSurvey("cint", String(respondent_id), `cint_${survey_id}`, null, Number.isFinite(reward) ? reward : null);
      }
    }
    res.status(200).json({ status: "received" });
  });

  app.get("/api/surveys/webhook/cpx", webhookRateLimiter, async (req: Request, res: Response): Promise<void> => {
    const auth = verifyWebhook("cpx", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "cpx", auth.reason ?? "unknown");
      res.status(403).send("Forbidden"); return;
    }
    const { trans_id, survey_id, ext_user_id, status } = req.query;
    if ((status === "1" || status === "completed") && trans_id && survey_id && ext_user_id) {
      // Do not trust amount_local from the webhook request — it is attacker-controlled
      // and unsigned. Use the server-committed expectedReward from the reward session
      // instead (creditSurveyViaWebhook falls back to session.expectedReward when
      // rewardValue is undefined, and clamps to PROVIDER_REWARD_RANGES in any case).
      const credited = await creditSurveyViaWebhook(
        "cpx",
        String(ext_user_id),
        `cpx_${survey_id}`,
        undefined,
        "[CPX Webhook]",
      );
      // Fallback: if the user launched the whole offerwall (cpx_wall session)
      // rather than an individual survey card, the pending session is keyed
      // "cpx_wall" and won't match the per-survey id above. Credit that session.
      let wallCredited = false;
      if (!credited) {
        wallCredited = await creditSurveyViaWebhook(
          "cpx",
          String(ext_user_id),
          "cpx_wall",
          undefined,
          "[CPX Webhook wall fallback]",
        );
      }
      if (!credited && !wallCredited) {
        await recordUnsettledSurvey(
          "cpx",
          String(ext_user_id),
          `cpx_${survey_id}`,
          typeof trans_id === "string" ? trans_id : String(trans_id),
          null,
        );
      }
    }
    res.status(200).send("OK");
  });

  // BitLabs sends a GET to {webhook_url}/no-sig when you save the postback URL in their dashboard
  // to confirm the endpoint is reachable. Return 200 immediately — no signature, no reward crediting.
  app.get("/api/surveys/webhook/bitlabs/no-sig", (_req: Request, res: Response): void => {
    res.status(200).send("OK");
  });

  app.get("/api/surveys/webhook/bitlabs", webhookRateLimiter, async (req: Request, res: Response): Promise<void> => {
    const auth = verifyWebhook("bitlabs", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "bitlabs", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const params = { ...req.query, ...req.body };
    // uid = BitLabs default param name; user_id = custom mapped name
    const { survey_id, user_id, uid, val, reason, tx, cashback_state } = params;
    const resolvedUserId = (user_id || uid) as string | undefined;
    // survey_id for surveys; tx for cashback and magic receipts
    const resolvedRefId = (survey_id || tx) as string | undefined;

    const reasonStr = typeof reason === "string" ? reason.toUpperCase() : "";
    const cashbackStateStr = typeof cashback_state === "string" ? cashback_state.toUpperCase() : "";
    const isSurveyComplete = !reasonStr || reasonStr === "COMPLETE" || reasonStr === "COMPLETED";
    // Credit cashback only on COMPLETED state — CREATED/PENDING/ADJUSTED must be ignored
    const isCashbackComplete = cashbackStateStr === "COMPLETED" ||
      reasonStr === "CASHBACK_COMPLETED" ||
      (reasonStr === "CASHBACK_ADJUSTMENT" && parseFloat(String(val)) > 0);
    const isReceiptComplete = reasonStr === "RECEIPT_COMPLETE" || cashbackStateStr === "RECEIPT_COMPLETE";

    if ((isSurveyComplete || isCashbackComplete || isReceiptComplete) && resolvedUserId && resolvedRefId) {
      const reward = typeof val === "number" ? val : typeof val === "string" ? parseFloat(val) : undefined;
      const prefix = isReceiptComplete ? "bitlabs_receipt_" : isCashbackComplete ? "bitlabs_cashback_" : "bitlabs_";
      const label = isReceiptComplete ? "[BitLabs Receipt]" : isCashbackComplete ? "[BitLabs Cashback]" : "[BitLabs Survey]";
      const credited = await creditSurveyViaWebhook(
        "bitlabs",
        String(resolvedUserId),
        `${prefix}${resolvedRefId}`,
        Number.isFinite(reward) ? reward : undefined,
        label,
      );
      if (!credited) {
        await recordUnsettledSurvey(
          "bitlabs",
          String(resolvedUserId),
          `${prefix}${resolvedRefId}`,
          typeof tx === "string" ? tx : null,
          Number.isFinite(reward) ? reward : null,
        );
      }
    }
    res.status(200).json({ status: "received" });
  });

  app.post("/api/surveys/webhook/lucid", webhookRateLimiter, async (req: Request, res: Response): Promise<void> => {
    const auth = verifyWebhook("lucid", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "lucid", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { SurveyNumber, respondentId, status, CPI } = req.body;
    if (status === "complete" && SurveyNumber && respondentId) {
      const reward = typeof CPI === "number" ? CPI : typeof CPI === "string" ? parseFloat(CPI) : undefined;
      const credited = await creditSurveyViaWebhook(
        "lucid",
        String(respondentId),
        `lucid_${SurveyNumber}`,
        Number.isFinite(reward) ? reward : undefined,
        "[Lucid Webhook]",
      );
      if (!credited) {
        await recordUnsettledSurvey("lucid", String(respondentId), `lucid_${SurveyNumber}`, null, Number.isFinite(reward) ? reward : null);
      }
    }
    res.status(200).json({ status: "received" });
  });

}
