/**
 * TikTok Marketing API integration (advertiser side — campaign management &
 * measurement for CashClip user acquisition).
 *
 * Credentials (one secret per credential, set in Replit Secrets / Publishing):
 *   - TIKTOK_APP_ID      (issued by TikTok once the app is approved)
 *   - TIKTOK_APP_SECRET  (issued by TikTok once the app is approved)
 *
 * OAuth flow (operator-initiated from the admin portal):
 *   1. /api/integrations/tiktok/start issues a one-time CSRF `state` and returns
 *      the TikTok authorize URL.
 *   2. The operator authorizes on TikTok; TikTok redirects the browser back to
 *      /api/integrations/tiktok/callback with `auth_code` + `state`.
 *   3. We verify `state`, exchange `auth_code` for a long-lived access token, and
 *      persist it in the `app_settings` table.
 *
 * Design rules (mirrors admobReporting.ts):
 *   - NEVER fabricate data. On any failure return { ok: false, error }.
 *   - Fail gracefully: missing config => configured:false (not a throw).
 *   - Persist via direct DB reads/writes (replica-safe; no cache staleness).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";

const TIKTOK_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const AUTHORIZE_URL = "https://business-api.tiktok.com/portal/auth";
const TIMEOUT_MS = 15000;

// Must match the Advertiser redirect URL registered in the TikTok app exactly.
export const TIKTOK_REDIRECT_URI =
  "https://api.cash-clip.app/api/integrations/tiktok/callback";

// app_settings keys (stable — persisted column values).
const STATE_KEY = "tiktok_oauth_state";
const TOKEN_KEY = "tiktok_access_token";
const ADVERTISER_IDS_KEY = "tiktok_advertiser_ids";
const CONNECTED_AT_KEY = "tiktok_connected_at";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const REQUIRED_ENV = ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"] as const;

export interface TikTokConfigState {
  configured: boolean;
  missing: string[];
}

export function getTikTokConfigState(): TikTokConfigState {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  return { configured: missing.length === 0, missing };
}

function appId(): string {
  return (process.env.TIKTOK_APP_ID || "").trim();
}

function appSecret(): string {
  return (process.env.TIKTOK_APP_SECRET || "").trim();
}

// ── app_settings persistence (direct DB, replica-safe) ──────────────────────
async function putSetting(key: string, value: string): Promise<void> {
  const { db, appSettings } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: sql`now()` },
    });
}

async function readSetting(key: string): Promise<string | null> {
  const { db, appSettings } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? null;
}

// ── OAuth CSRF state ────────────────────────────────────────────────────────
// Stored as a single record `${issuedAtMs}:${state}` so it can be consumed
// atomically with a DELETE ... RETURNING (one-time, race-safe across replicas).
export async function createOAuthState(): Promise<string> {
  const state = randomBytes(24).toString("hex");
  await putSetting(STATE_KEY, `${Date.now()}:${state}`);
  return state;
}

/**
 * One-time, atomic verification: a single `DELETE ... RETURNING` consumes the
 * stored state, so only one concurrent caller can ever get the row back. The
 * loser (or a replay) sees no row and fails closed.
 */
export async function verifyAndConsumeOAuthState(
  provided: string,
): Promise<boolean> {
  if (!provided) return false;
  const { db, appSettings } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .delete(appSettings)
    .where(eq(appSettings.key, STATE_KEY))
    .returning();
  const stored = rows[0]?.value;
  if (!stored) return false;
  const sep = stored.indexOf(":");
  if (sep < 0) return false;
  const ts = Number(stored.slice(0, sep));
  const storedState = stored.slice(sep + 1);
  if (!ts || Date.now() - ts > STATE_TTL_MS) return false;
  const a = Buffer.from(storedState);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    app_id: appId(),
    state,
    redirect_uri: TIKTOK_REDIRECT_URI,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// ── Token exchange ──────────────────────────────────────────────────────────
export interface TikTokConnectResult {
  ok: boolean;
  error?: string;
  advertiserIds?: string[];
}

export async function exchangeAuthCode(
  authCode: string,
): Promise<TikTokConnectResult> {
  const cfg = getTikTokConfigState();
  if (!cfg.configured) {
    return { ok: false, error: `Missing config: ${cfg.missing.join(", ")}` };
  }
  if (!authCode) return { ok: false, error: "Missing auth_code" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TIKTOK_BASE}/oauth2/access_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: appId(),
        secret: appSecret(),
        auth_code: authCode,
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as {
      code?: number;
      message?: string;
      data?: { access_token?: string; advertiser_ids?: string[] };
    } | null;

    if (!json || json.code !== 0 || !json.data?.access_token) {
      const msg = json?.message || `HTTP ${res.status}`;
      logger.error({ code: json?.code, msg }, "TikTok token exchange failed");
      return { ok: false, error: msg };
    }

    const accessToken = json.data.access_token;
    const advertiserIds = json.data.advertiser_ids ?? [];
    await putSetting(TOKEN_KEY, accessToken);
    await putSetting(ADVERTISER_IDS_KEY, JSON.stringify(advertiserIds));
    await putSetting(CONNECTED_AT_KEY, new Date().toISOString());
    logger.info(
      { advertiserCount: advertiserIds.length },
      "TikTok Marketing API connected",
    );
    return { ok: true, advertiserIds };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logger.error({ err }, "TikTok token exchange error");
    return { ok: false, error: aborted ? "TikTok API timeout" : "TikTok API error" };
  } finally {
    clearTimeout(timer);
  }
}

export interface TikTokConnection {
  connected: boolean;
  advertiserIds: string[];
  connectedAt: string | null;
}

export async function getTikTokConnection(): Promise<TikTokConnection> {
  const token = await readSetting(TOKEN_KEY);
  const idsRaw = await readSetting(ADVERTISER_IDS_KEY);
  const connectedAt = await readSetting(CONNECTED_AT_KEY);
  let advertiserIds: string[] = [];
  try {
    advertiserIds = idsRaw ? (JSON.parse(idsRaw) as string[]) : [];
  } catch {
    advertiserIds = [];
  }
  return { connected: Boolean(token), advertiserIds, connectedAt };
}
