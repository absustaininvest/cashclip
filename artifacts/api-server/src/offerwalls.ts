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
import { authMiddleware, adminMiddleware, type AuthRequest } from "./auth";
import { storage } from "./storage";
import { recordIssuedOffers, getIssuedOffer, generateSessionToken } from "./issuedOffers";
import { PROVIDER_REWARD_RANGES, parseProviderReward, type ProviderCompletionPayload } from "./lib/surveyProviders";

const SESSION_TTL_MS = 60 * 60 * 1000;

export function registerOfferwallRoutes(app: Express): void {
  app.get("/api/offerwalls/providers", adminMiddleware, (_req: Request, res: Response) => {
    const statuses = getOfferwallProviderStatus();
    res.json({
      providers: statuses,
      anyConfigured: statuses.some((s) => s.configured),
    });
  });

  app.get("/api/offerwalls/available", authMiddleware, async (req: AuthRequest, res: Response) => {
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
        const range = PROVIDER_REWARD_RANGES[o.provider] ?? { min: 0.10, max: 25.00 };
        const safe = Math.max(range.min, Math.min(range.max, o.reward));
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
      const sessionToken = generateSessionToken("offsess");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      await storage.createRewardSession({
        sessionToken,
        userId: req.userId!,
        source: "offerwall",
        provider,
        externalId: offerId,
        expectedReward: reward,
        expiresAt,
      });

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

  app.post("/api/offerwalls/complete", authMiddleware, async (req: AuthRequest, res: Response) => {
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

      const providerRange = PROVIDER_REWARD_RANGES[session.provider] ?? { min: 0.10, max: 25.00 };
      const rawFinal = parseProviderReward(verifyResult.reward) ?? parseFloat(session.expectedReward);
      const finalReward = Math.max(providerRange.min, Math.min(providerRange.max, rawFinal));

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
    payload: ProviderCompletionPayload | null,
  ) {
    try {
      const session = await storage.findPendingRewardSession(userId, "offerwall", offerId);
      if (!session) {
        return;
      }
      const rawReward = parseProviderReward(payload) ?? parseFloat(session.expectedReward);
      const range = PROVIDER_REWARD_RANGES[provider] ?? { min: 0.10, max: 25.00 };
      const clampedReward = Math.max(range.min, Math.min(range.max, rawReward));
      await storage.completeRewardSessionAndCredit({
        sessionToken: session.sessionToken,
        userId,
        type: "offerwall",
        description: `Offer completed via ${provider} webhook`,
        finalReward: clampedReward,
      });
    } catch (err) {
    }
  }

  app.get("/api/offerwalls/webhook/tapjoy", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("tapjoy", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "tapjoy", auth.reason ?? "unknown");
      res.status(403).send("0"); return;
    }
    // Tapjoy sends: id (offer), snuid (user), currency (virtual pts — NOT USD), verifier (HMAC)
    // No status param in Tapjoy callbacks — any authenticated request signals completion.
    // Do not pass Tapjoy's `currency` field — it is virtual currency points, not USD.
    // creditOfferViaWebhook falls back to session.expectedReward when payload has no reward.
    const offerId = req.query.id ?? req.query.offer_id;
    const userId = req.query.snuid ?? req.query.user_id;
    if (offerId && userId) {
      await creditOfferViaWebhook(
        "tapjoy",
        String(userId),
        `tapjoy_${String(offerId)}`,
        null,
      );
    }
    res.status(200).send("1");
  });

  app.post("/api/offerwalls/webhook/adgate", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("adgate", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "adgate", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { offer_id, user_id, status } = req.body;
    if (status === "completed" && offer_id && user_id) {
      await creditOfferViaWebhook(
        "adgate",
        String(user_id),
        `adgate_${offer_id}`,
        req.body as ProviderCompletionPayload,
      );
    }
    res.status(200).json({ status: "received" });
  });

  app.post("/api/offerwalls/webhook/offertoro", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("offertoro", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "offertoro", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { offer_id, user_id } = req.body;
    if (offer_id && user_id) {
      await creditOfferViaWebhook(
        "offertoro",
        String(user_id),
        `offertoro_${offer_id}`,
        req.body as ProviderCompletionPayload,
      );
    }
    res.status(200).json({ status: "1" });
  });

  app.post("/api/offerwalls/webhook/lootably", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("lootably", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "lootably", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { offer_id, user_id, status } = req.body;
    if (status === "completed" && offer_id && user_id) {
      await creditOfferViaWebhook(
        "lootably",
        String(user_id),
        `lootably_${offer_id}`,
        req.body as ProviderCompletionPayload,
      );
    }
    res.status(200).json({ status: "received" });
  });

  app.post("/api/offerwalls/webhook/adjoe", webhookRateLimiter, async (req: Request, res: Response) => {
    const auth = verifyWebhook("adjoe", req);
    if (!auth.ok) {
      logWebhookVerificationFailure(req, "adjoe", auth.reason ?? "unknown");
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const { offer_id, user_id, status } = req.body;
    if (status === "completed" && offer_id && user_id) {
      await creditOfferViaWebhook(
        "adjoe",
        String(user_id),
        `adjoe_${offer_id}`,
        req.body as ProviderCompletionPayload,
      );
    }
    res.status(200).json({ status: "received" });
  });
}
