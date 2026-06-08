import { Router, type IRouter } from "express";
import { adminMiddleware, type AuthRequest } from "../auth";
import { logger } from "../lib/logger";
import {
  getTikTokConfigState,
  createOAuthState,
  buildAuthorizeUrl,
  verifyAndConsumeOAuthState,
  exchangeAuthCode,
  getTikTokConnection,
} from "../lib/tiktok";

const router: IRouter = Router();

// Where the operator lands after the OAuth round-trip (admin portal, legal domain).
const PORTAL_URL = "https://absustaininvest.com/sc-portal";

/**
 * Operator-only: begin the TikTok OAuth flow. Issues a one-time CSRF `state`
 * and returns the TikTok authorize URL for the operator to open.
 */
router.get(
  "/integrations/tiktok/start",
  adminMiddleware,
  async (_req: AuthRequest, res) => {
    const cfg = getTikTokConfigState();
    if (!cfg.configured) {
      res.status(503).json({
        ok: false,
        error: `TikTok not configured. Missing: ${cfg.missing.join(", ")}`,
      });
      return;
    }
    try {
      const state = await createOAuthState();
      res.json({ ok: true, url: buildAuthorizeUrl(state) });
    } catch (err) {
      logger.error({ err }, "TikTok start failed");
      res.status(500).json({ ok: false, error: "Failed to start TikTok authorization" });
    }
  },
);

/**
 * Operator-only: current TikTok connection status (does NOT expose the token).
 */
router.get(
  "/integrations/tiktok/status",
  adminMiddleware,
  async (_req: AuthRequest, res) => {
    const cfg = getTikTokConfigState();
    try {
      const conn = await getTikTokConnection();
      res.json({
        ok: true,
        configured: cfg.configured,
        missing: cfg.missing,
        connected: conn.connected,
        advertiserIds: conn.advertiserIds,
        connectedAt: conn.connectedAt,
      });
    } catch (err) {
      logger.error({ err }, "TikTok status failed");
      res.status(500).json({ ok: false, error: "Failed to read TikTok status" });
    }
  },
);

/**
 * Public callback — TikTok redirects the operator's browser here after they
 * authorize. The auth proof is the one-time `state` we issued in /start. On
 * success we exchange `auth_code` for an access token and persist it, then
 * redirect back to the admin portal with a status flag.
 */
router.get("/integrations/tiktok/callback", async (req, res) => {
  const authCode = String(req.query.auth_code || req.query.code || "");
  const state = String(req.query.state || "");
  const providerError = String(req.query.error || "");

  if (providerError) {
    logger.warn({ providerError }, "TikTok callback returned an error");
    res.redirect(302, `${PORTAL_URL}?tiktok=denied`);
    return;
  }

  const stateOk = await verifyAndConsumeOAuthState(state).catch(() => false);
  if (!stateOk) {
    logger.warn("TikTok callback failed state verification");
    res.redirect(302, `${PORTAL_URL}?tiktok=badstate`);
    return;
  }

  const result = await exchangeAuthCode(authCode);
  if (!result.ok) {
    res.redirect(302, `${PORTAL_URL}?tiktok=error`);
    return;
  }

  res.redirect(302, `${PORTAL_URL}?tiktok=connected`);
});

export default router;
