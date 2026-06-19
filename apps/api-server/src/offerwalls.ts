import type { Express, Request, Response } from "express";
import {
  fetchAllOffers,
  verifyOfferCompletion,
  getOfferwallProviderStatus,
  type OfferwallProviderKey,
  type Offer,
  type OfferCompletionVerifyResponse,
} from "./lib/offerwallProviders";
import { verifyWebhook, logWebhookVerificationFailure } from "./lib/webhookAuth";
import { webhookRateLimiter } from "./lib/webhookRateLimit";
import { providerListRateLimiter, providerCompleteRateLimiter } from "./lib/providerRateLimit";
import { authMiddleware, adminMiddleware, type AuthRequest } from "./auth";
import { storage } from "./storage";
import { recordIssuedOffers, getIssuedOffer, generateSessionToken } from "./issuedOffers";

const SESSION_TTL_MS = 60 * 60 * 1000;

const PROVIDER_REWARD_BOUNDS: Record<string, { min: number; max: number }> = {
  tapjoy:      { min: 0.10, max: 25.00 },
  adgate:      { min: 0.10, max: 20.00 },
  offertoro:   { min: 0.10, max: 20.00 },
  lootably:    { min: 0.10, max: 20.00 },
  adjoe:       { min: 0.10, max: 25.00 },
  adgem:       { min: 0.10, max: 20.00 },
  ayet:        { min: 0.10, max: 20.00 },
  notik:       { min: 0.05, max: 10.00 },
  revlum:      { min: 0.05, max: 15.00 },
  monlix:      { min: 0.05, max: 15.00 },
  paymentwall: { min: 0.10, max: 20.00 },
};

export function registerOfferwallRoutes(app: Express): void {
  app.get("/api/offerwalls/providers", adminMiddleware, (_req: Request, res: Response) => {
    const statuses = getOfferwallProviderStatus();
    res.json({
      providers: statuses,
      anyConfigured: statuses.some((s) => s.configured),
    });
  });

  app.get("/api/offerwalls/available", authMiddleware, providerListRateLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const providerStatuses = getOfferwallProviderStatus();
      const configuredProviders = providerStatuses.filter((p) => p.configured);

      if (configuredProviders.length === 0) {
        res.json({
          offers: [],
          providers: providerStatuses,
          message: "No offerwall providers configured yet. Add TAPJOY_SDK_KEY, ADGATE_API_KEY, or OFFERTORO_API_KEY to enable offers.",
        }); return;
      }

      const results = await fetchAllOffers();
      const allOffers: Offer[] = results.flatMap((r) => r.offers);

      const clamped = allOffers.map((o) => {
        const bounds = PROVIDER_REWARD_BOUNDS[o.provider] || { min: 0.10, max: 25.00 };
        const safe = Math.max(bounds.min, Math.min(bounds.max, o.reward));
        return { ...o, reward: parseFloat(safe.toFixed(2)) };
      });

      recordIssuedOffers(
        req.userId!,
        "offerwall",
        clamped.map((o) => ({ id: o.id, provider: o.provider, reward: o.reward }))
      );

      res.json({
        offers: clamped,
        providers: providerStatuses,
        count: clamped.length,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch offers" });
    }
  });

  app.post("/api/offerwalls/start", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { offerId, provider } = req.body;
      if (!offerId || !provider) {
        res.status(400).json({ error: "offerId and provider are required" }); return;
      }

      const issued = getIssuedOffer(req.userId!, offerId, "offerwall");
      if (!issued) {
        res.status(403).json({
          error: "Offer is not available for this user. Refresh the offer list and try again.",
        }); return;
      }
      if (issued.provider !== provider) {
        res.status(400).json({ error: "Provider mismatch for this offer" }); return;
      }

      const alreadyClaimed = await storage.findCompletedRewardSession(req.userId!, "offerwall", offerId);
      if (alreadyClaimed) {
        res.status(409).json({ error: "Reward for this offer has already been claimed" }); return;
      }

      const reward = issued.expectedReward;
      const newSessionToken = generateSessionToken("offsess");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      const session = await storage.upsertPendingRewardSession({
        newSessionToken,
        userId: req.userId!,
        source: "offerwall",
        provider,
        externalId: offerId,
        expectedReward: reward,
        expiresAt,
      });
      const sessionToken = session.sessionToken;

      res.json({
        sessionToken,
        offerId,
        provider,
        estimatedReward: reward,
        expiresAt: expiresAt.toISOString(),
        message: "Offer session started. Complete the offer and call /api/offerwalls/complete with this sessionToken to claim your reward.",
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to start offer session" });
    }
  });

  app.post("/api/offerwalls/complete", authMiddleware, providerCompleteRateLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const { sessionToken, transactionId: rawTransactionId } = req.body;
      const transactionId = typeof rawTransactionId === "string" ? rawTransactionId.trim() : rawTransactionId;
      if (!sessionToken || typeof sessionToken !== "string") {
        res.status(400).json({ error: "sessionToken is required" }); return;
      }

      const session = await storage.getRewardSession(sessionToken);
      if (!session || session.userId !== req.userId || session.source !== "offerwall") {
        res.status(404).json({ error: "Offer session not found" }); return;
      }
      if (session.status === "completed") {
        res.status(409).json({ error: "Offer already completed and reward claimed" }); return;
      }
      if (new Date(session.expiresAt).getTime() < Date.now()) {
        res.status(410).json({ error: "Offer session expired" }); return;
      }

      if (typeof transactionId !== "string" || transactionId.length === 0) {
        res.status(400).json({
          error: "Provider transactionId is required to verify offer completion.",
        }); return;
      }

      const alreadyGloballyUsed = await storage.findCompletedSessionByProviderTransactionId(
        "offerwall",
        session.provider,
        transactionId,
      );
      if (alreadyGloballyUsed) {
        res.status(409).json({
          error: "This provider transaction ID has already been used to claim a reward.",
        }); return;
      }

      let verifyResult: OfferCompletionVerifyResponse;
      try {
        verifyResult = await verifyOfferCompletion({
          offerId: session.externalId,
          provider: session.provider as OfferwallProviderKey,
          userId: req.userId!,
          transactionId,
        });
      } catch (e) {
        res.status(402).json({
          error: "Provider verification unavailable. Reward not credited.",
        }); return;
      }
      if (!verifyResult.verified) {
        res.status(402).json({
          error: verifyResult.error || "Provider did not confirm offer completion. Reward not credited.",
        }); return;
      }

      const providerBounds = PROVIDER_REWARD_BOUNDS[session.provider] ?? { min: 0.10, max: 25.00 };

      // Require a provider-authoritative payout. If the verifier did not return
      // one (reward <= 0), do NOT fall back to any cached amount — that would
      // trust stale server-side data and is the root of the reward-inflation
      // vulnerability. Fail closed: the user must claim via the provider's
      // signed webhook, or an admin will reconcile any verified-but-uncredited
      // completion from the unsettled queue.
      if (!Number.isFinite(verifyResult.reward) || verifyResult.reward <= 0) {
        res.status(409).json({
          error: "Offer completion verified but the provider did not return an authoritative reward amount. Your completion has been recorded; credit will be applied after reconciliation.",
          retryable: false,
        }); return;
      }
      const finalReward = Math.max(providerBounds.min, Math.min(providerBounds.max, verifyResult.reward));

      const outcome = await storage.completeRewardSessionAndCredit({
        sessionToken,
        userId: req.userId!,
        type: "offerwall",
        description: `Offer completed (${session.provider})`,
        providerTransactionId: transactionId,
        finalReward,
      });

      if ("conflict" in outcome) {
        if (outcome.conflict === "duplicate") {
          res.status(409).json({ error: "Reward for this offer has already been claimed" }); return;
        }
        res.status(409).json({ error: "Offer session is no longer claimable" }); return;
      }

      res.json({
        verified: true,
        reward: outcome.reward,
        balance: outcome.balance,
        totalEarned: outcome.totalEarned,
        offerId: session.externalId,
        provider: session.provider,
        message: `Offer completed! You earned $${outcome.reward.toFixed(2)}.`,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to claim offer reward" });
    }
  });

  async function creditOfferViaWebhook(
    provider: OfferwallProviderKey,
    userId: string,
    offerId: string,
    rewardValue: number | undefined,
    logPrefix: string,
  ): Promise<boolean> {
    try {
      const session = await storage.findPendingRewardSession(userId, "offerwall", offerId);
      if (!session) {
        return false;
      }
      // Require a provider-authoritative payout amount. If the webhook does not
      // carry one (rewardValue is undefined), do not fall back to the cached
      // session.expectedReward — that amount may be stale if the provider
      // changed the payout after the session was created. Route to unsettled
      // reconciliation instead so the completion is not silently lost.
      if (rewardValue === undefined || !Number.isFinite(rewardValue)) {
        return false;
      }
      const bounds = PROVIDER_REWARD_BOUNDS[provider] || { min: 0.10, max: 25.00 };
      const clampedReward = Math.max(bounds.min, Math.min(bounds.max, rewardValue));
      const result = await storage.completeRewardSessionAndCredit({
        sessionToken: session.sessionToken,
        userId,
        type: "offerwall",
        description: `Offer completed via ${provider} webhook`,
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

  // Persist a verified offerwall completion that could not be credited (no
  // pending session: TTL expiry, id mismatch, or user never started one) so it
  // can be reconciled instead of silently dropped with a 200 OK — unless it was
  // already credited (webhook retry / provider resend), which would create a
  // false-positive unsettled row that risks a double payout.
  async function recordUnsettledOffer(
    provider: OfferwallProviderKey,
    userId: string,
    offerId: string,
    rewardValue: number | undefined,
  ): Promise<void> {
    if (await storage.hasCreditedCompletion("offerwall", userId, offerId)) return;
    await storage.recordUnsettledCompletion({
      source: "offerwall",
      provider,
      userId,
      externalId: offerId,
      rewardValue: typeof rewardValue === "number" && Number.isFinite(rewardValue) ? rewardValue : null,
      reason: "no_pending_session",
    });
  }

  app.get("/api/offerwalls/webhook/tapjoy", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("tapjoy", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "tapjoy", auth.reason ?? "unknown");
      res.status(403).send("0"); return;
    }
    // Tapjoy sends: id (offer), snuid (user), currency (virtual pts — NOT USD), verifier (HMAC)
    // No status param in Tapjoy callbacks — any authenticated request signals completion
    const offerId = req.query.id ?? req.query.offer_id;
    const userId = req.query.snuid ?? req.query.user_id;
    if (offerId && userId) {
      // Do not use Tapjoy's `currency` field as a USD reward — it's virtual currency points.
      // Fall back to session.expectedReward (server-set USD value from offer listing).
      const credited = await creditOfferViaWebhook(
        "tapjoy",
        String(userId),
        `tapjoy_${String(offerId)}`,
        undefined,
        "[Tapjoy Webhook]",
      );
      if (!credited) {
        await recordUnsettledOffer("tapjoy", String(userId), `tapjoy_${String(offerId)}`, undefined);
      }
    }
    res.status(200).send("1");
  });

  app.post("/api/offerwalls/webhook/adgate", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("adgate", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "adgate", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { offer_id, user_id, payout, status } = req.body;
    if (status === "completed" && offer_id && user_id) {
      const reward = typeof payout === "number" ? payout : typeof payout === "string" ? parseFloat(payout) : undefined;
      const credited = await creditOfferViaWebhook(
        "adgate",
        String(user_id),
        `adgate_${offer_id}`,
        Number.isFinite(reward) ? reward : undefined,
        "[AdGate Webhook]",
      );
      if (!credited) {
        await recordUnsettledOffer("adgate", String(user_id), `adgate_${offer_id}`, Number.isFinite(reward) ? reward : undefined);
      }
    }
    res.status(200).json({ status: "received" });
  });

  app.post("/api/offerwalls/webhook/offertoro", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("offertoro", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "offertoro", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { offer_id, user_id, payout } = req.body;
    if (offer_id && user_id) {
      const reward = typeof payout === "number" ? payout : typeof payout === "string" ? parseFloat(payout) : undefined;
      const credited = await creditOfferViaWebhook(
        "offertoro",
        String(user_id),
        `offertoro_${offer_id}`,
        Number.isFinite(reward) ? reward : undefined,
        "[OfferToro Webhook]",
      );
      if (!credited) {
        await recordUnsettledOffer("offertoro", String(user_id), `offertoro_${offer_id}`, Number.isFinite(reward) ? reward : undefined);
      }
    }
    res.status(200).json({ status: "1" });
  });

  app.post("/api/offerwalls/webhook/lootably", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("lootably", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "lootably", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { transaction_id, user_id, payout } = req.body;
    if (transaction_id && user_id) {
      const reward = typeof payout === "number" ? payout : typeof payout === "string" ? parseFloat(payout) : undefined;
      const credited = await creditOfferViaWebhook(
        "lootably",
        String(user_id),
        `lootably_${transaction_id}`,
        Number.isFinite(reward) ? reward : undefined,
        "[Lootably Webhook]",
      );
      if (!credited) {
        await recordUnsettledOffer("lootably", String(user_id), `lootably_${transaction_id}`, Number.isFinite(reward) ? reward : undefined);
      }
    }
    res.status(200).json({ status: "received" });
  });

  app.post("/api/offerwalls/webhook/adjoe", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("adjoe", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "adjoe", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { transaction_id, user_id, payout } = req.body;
    if (transaction_id && user_id) {
      const reward = typeof payout === "number" ? payout : typeof payout === "string" ? parseFloat(payout) : undefined;
      const credited = await creditOfferViaWebhook(
        "adjoe",
        String(user_id),
        `adjoe_${transaction_id}`,
        Number.isFinite(reward) ? reward : undefined,
        "[Adjoe Webhook]",
      );
      if (!credited) {
        await recordUnsettledOffer("adjoe", String(user_id), `adjoe_${transaction_id}`, Number.isFinite(reward) ? reward : undefined);
      }
    }
    res.status(200).json({ status: "received" });
  });
}
