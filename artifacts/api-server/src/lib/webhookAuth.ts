import crypto from "node:crypto";
import type { Request } from "express";
import { logger } from "./logger";
import { recordWebhookRejection } from "./webhookAlerts";
import { storage } from "../storage";
import { getClientIp } from "./clientIp";

interface WebhookSecretConfig {
  provider: string;
  secretEnvVar: string;
  secret: string | undefined;
}

const WEBHOOK_CONFIGS: Record<string, WebhookSecretConfig> = {
  pollfish: {
    provider: "pollfish",
    secretEnvVar: "POLLFISH_WEBHOOK_SECRET",
    secret: process.env.POLLFISH_WEBHOOK_SECRET,
  },
  cint: {
    provider: "cint",
    secretEnvVar: "CINT_WEBHOOK_SECRET",
    secret: process.env.CINT_WEBHOOK_SECRET,
  },
  lucid: {
    provider: "lucid",
    secretEnvVar: "LUCID_WEBHOOK_SECRET",
    secret: process.env.LUCID_WEBHOOK_SECRET,
  },
  tapjoy: {
    provider: "tapjoy",
    secretEnvVar: "TAPJOY_WEBHOOK_SECRET",
    secret: process.env.TAPJOY_WEBHOOK_SECRET,
  },
  adgate: {
    provider: "adgate",
    secretEnvVar: "ADGATE_WEBHOOK_SECRET",
    secret: process.env.ADGATE_WEBHOOK_SECRET,
  },
  offertoro: {
    provider: "offertoro",
    secretEnvVar: "OFFERTORO_WEBHOOK_SECRET",
    secret: process.env.OFFERTORO_WEBHOOK_SECRET,
  },
  cpx: {
    provider: "cpx",
    secretEnvVar: "CPX_WEBHOOK_SECRET",
    secret: process.env.CPX_WEBHOOK_SECRET,
  },
  bitlabs: {
    provider: "bitlabs",
    secretEnvVar: "BITLABS_WEBHOOK_SECRET",
    secret: process.env.BITLABS_WEBHOOK_SECRET,
  },
  lootably: {
    provider: "lootably",
    secretEnvVar: "LOOTABLY_WEBHOOK_SECRET",
    secret: process.env.LOOTABLY_WEBHOOK_SECRET,
  },
  adjoe: {
    provider: "adjoe",
    secretEnvVar: "ADJOE_WEBHOOK_SECRET",
    secret: process.env.ADJOE_WEBHOOK_SECRET,
  },
};

export function reloadWebhookSecrets(): void {
  for (const cfg of Object.values(WEBHOOK_CONFIGS)) {
    cfg.secret = process.env[cfg.secretEnvVar];
  }
}

function safeTimingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function computeHmac(secret: string, payload: Buffer | string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function md5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

function extractSignature(req: Request): string | undefined {
  const sig =
    req.headers["x-webhook-signature"] ??
    req.headers["x-signature"] ??
    req.headers["x-hub-signature-256"];
  if (typeof sig === "string") return sig.replace(/^sha256=/, "").trim();
  return undefined;
}

function qs(val: unknown): string {
  return typeof val === "string" ? val : String(val ?? "");
}

interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

type ProviderVerifier = (secret: string, req: Request) => boolean;

const PROVIDER_VERIFIERS: Record<string, ProviderVerifier> = {
  tapjoy(secret: string, req: Request): boolean {
    const verifier = req.query.verifier;
    if (typeof verifier !== "string" || !verifier) return false;
    const id = qs(req.query.id ?? req.query.offer_id);
    const snuid = qs(req.query.snuid ?? req.query.user_id);
    const currency = qs(req.query.currency ?? req.query.amount);
    const expected = md5(`${id}:${snuid}:${currency}:${secret}`);
    return safeTimingEqual(verifier, expected);
  },

  adgate(secret: string, req: Request): boolean {
    const hashValue = qs(req.query.hash_value ?? req.body?.hash_value);
    if (!hashValue) return false;
    const txId = qs(req.query.transaction_id ?? req.body?.transaction_id ?? req.query.offer_id ?? req.body?.offer_id);
    const userId = qs(req.query.user_id ?? req.body?.user_id);
    const payout = qs(req.query.payout ?? req.body?.payout);
    const expected = md5(`${txId}${userId}${payout}${secret}`);
    return safeTimingEqual(hashValue, expected);
  },

  offertoro(secret: string, req: Request): boolean {
    const sig = qs(req.query.ot_sig ?? req.body?.ot_sig);
    if (!sig) return false;
    const offerId = qs(req.query.offer_id ?? req.body?.offer_id);
    const userId = qs(req.query.user_id ?? req.body?.user_id);
    const payout = qs(req.query.payout ?? req.body?.payout);
    const expected = md5(`${offerId}${userId}${payout}${secret}`);
    return safeTimingEqual(sig, expected);
  },

  cpx(secret: string, req: Request): boolean {
    // Guard: if CPX_WEBHOOK_SECRET equals CPX_API_KEY, the webhook secret is
    // derivable by any authenticated user from the survey wall URL they already
    // received (which embeds secure_hash = md5(userId + "-" + CPX_API_KEY)).
    // An attacker would simply set trans_id = their userId and replay that hash
    // to pass this check, then credit arbitrary rewards. Refuse verification
    // until the operator configures a distinct CPX_WEBHOOK_SECRET.
    const cpxApiKey = process.env.CPX_API_KEY;
    if (cpxApiKey && secret === cpxApiKey) {
      logger.error(
        "CPX_WEBHOOK_SECRET must not equal CPX_API_KEY — webhook crediting disabled until they differ. Set CPX_WEBHOOK_SECRET to the separate webhook secret from the CPX Research dashboard.",
      );
      return false;
    }
    const sig = qs(req.query.secure_hash ?? req.query.hash);
    if (!sig) return false;
    const transId = qs(req.query.trans_id);
    const expected = md5(`${transId}-${secret}`);
    return safeTimingEqual(sig.toLowerCase(), expected.toLowerCase());
  },

  bitlabs(secret: string, req: Request): boolean {
    const sig = qs(req.query.hash);
    if (!sig) return false;
    // BitLabs signs the full URL including protocol + host
    const proto = (String(req.headers["x-forwarded-proto"] ?? "https")).split(",")[0].trim();
    const host = (String(req.headers["x-forwarded-host"] ?? req.headers["host"] ?? req.hostname)).split(",")[0].trim();
    const fullUrl = `${proto}://${host}${req.originalUrl}`;
    const cleanUrl = fullUrl.replace(/[?&]hash=[^&]*/g, "").replace(/[?&]$/, "");
    const expected = crypto.createHmac("sha1", secret).update(cleanUrl).digest("hex");
    return safeTimingEqual(sig.toLowerCase(), expected.toLowerCase());
  },

};

export function verifyWebhook(
  provider: string,
  req: Request,
): { ok: boolean; reason?: string } {
  const cfg = WEBHOOK_CONFIGS[provider];
  if (!cfg) {
    return { ok: false, reason: `Unknown provider: ${provider}` };
  }

  if (!cfg.secret) {
    return {
      ok: false,
      reason: `${cfg.secretEnvVar} not configured — webhook crediting disabled for ${provider}`,
    };
  }

  const providerVerifier = PROVIDER_VERIFIERS[provider];
  if (providerVerifier) {
    if (providerVerifier(cfg.secret, req)) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `Invalid provider-specific signature for ${provider}`,
    };
  }

  const token = req.query.secret ?? req.query.token ?? req.query.sig;
  if (typeof token === "string" && safeTimingEqual(token, cfg.secret)) {
    return { ok: true };
  }

  const signature = extractSignature(req);
  if (signature) {
    const whReq = req as WebhookRequest;
    const rawPayload = whReq.rawBody ?? Buffer.from(JSON.stringify(req.body ?? ""));
    const expected = computeHmac(cfg.secret, rawPayload);
    if (safeTimingEqual(signature, expected)) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    reason: `Invalid webhook signature/token for ${provider}`,
  };
}

export function isWebhookSecretConfigured(provider: string): boolean {
  return !!(WEBHOOK_CONFIGS[provider]?.secret);
}

export interface WebhookVerificationFailure {
  provider: string;
  reason: string;
  ip: string;
  forwardedFor?: string;
  userAgent?: string;
  method: string;
  path: string;
  hasSignatureHeader: boolean;
  secretConfigured: boolean;
  timestamp: string;
}

function headerString(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return v[0];
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-IP audit write throttle (DB-backed, shared across all replicas)
//
// The webhook endpoints are public and may be probed at high volume. Without
// a write cap, every verification failure unconditionally produces a DB INSERT
// into `webhook_audit`, creating a write-amplification DoS path: an attacker
// sending invalid requests can flood the table and crowd out legitimate
// provider callbacks that credit user rewards.
//
// Before each audit INSERT we query the count of recent rows for the same
// source IP using the existing `webhook_audit_ip_idx` index on (ip,
// created_at). This query is shared state across all autoscaled replicas
// (unlike an in-process counter) and therefore provides a fleet-wide cap.
//
// The throttle key is the rightmost X-Forwarded-For entry, extracted via
// `getClientIp(req)` (lib/clientIp.ts). With `trust proxy: 1`, `req.ip`
// resolves to the *leftmost* XFF entry, which is attacker-controlled.
// Using the rightmost entry (appended by the trusted Replit proxy) prevents
// header-rotation bypass of this DB-backed write cap.
//
// When the cap is exceeded the structured log entry and in-memory alert
// accounting still run as normal so alerting is unaffected, but the INSERT
// is skipped. On DB failure the check fails open to preserve the audit trail.
// ---------------------------------------------------------------------------

const DEFAULT_AUDIT_WRITE_LIMIT = 10;
const DEFAULT_AUDIT_WRITE_WINDOW_MS = 60_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function getAuditWriteLimit(): number {
  return parsePositiveInt(process.env.WEBHOOK_AUDIT_WRITE_LIMIT, DEFAULT_AUDIT_WRITE_LIMIT);
}

function getAuditWriteWindowMs(): number {
  return parsePositiveInt(process.env.WEBHOOK_AUDIT_WRITE_WINDOW_MS, DEFAULT_AUDIT_WRITE_WINDOW_MS);
}

/**
 * Returns true if a DB audit write is permitted for this IP.
 *
 * Queries the count of recent audit rows for the IP using the indexed
 * (ip, created_at) path so the read is fast even at scale. Fails open on DB
 * error to avoid silently dropping audit entries when the DB is degraded.
 */
async function permitAuditWrite(ip: string, log: typeof logger): Promise<boolean> {
  const limit = getAuditWriteLimit();
  const windowMs = getAuditWriteWindowMs();
  const since = new Date(Date.now() - windowMs);
  try {
    const cnt = await storage.countWebhookAuditByIp(ip, since);
    return cnt < limit;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), ip },
      "webhook_audit write-throttle DB check failed — failing open to preserve audit trail",
    );
    return true;
  }
}

/**
 * Emit a structured audit log entry for a rejected webhook request.
 *
 * Logs are emitted on the request-scoped logger (`req.log`) when available so
 * they inherit the request id, and fall back to the singleton logger
 * otherwise. The event name `webhook_verification_failed` and the
 * `audit: "webhook_verification_failed"` field are stable identifiers that
 * external log aggregators / alerting systems can match on.
 *
 * DB persistence is rate-limited per source IP using a DB-backed count of
 * recent audit rows (shared across all replicas). Both the throttle key and
 * the persisted `ip` column use `getClientIp(req)` — the rightmost
 * X-Forwarded-For entry appended by the trusted Replit proxy, which reflects
 * the actual TCP client address. With `trust proxy: 1`, `req.ip` resolves to
 * the leftmost XFF entry instead, which is attacker-controlled; using the
 * rightmost entry ensures rotating spoofed headers cannot produce fresh counter
 * keys and bypass the cap. The raw header is preserved in `forwardedFor` for
 * diagnostic purposes only.
 *
 * When the per-IP write cap is exceeded the structured log entry is still
 * emitted but the DB INSERT is skipped.
 */
export function logWebhookVerificationFailure(
  req: Request,
  provider: string,
  reason: string,
): WebhookVerificationFailure {
  // Use the rightmost X-Forwarded-For entry — the IP the trusted Replit proxy
  // observed on the TCP connection. With "trust proxy: 1", req.ip resolves to
  // the *leftmost* XFF entry instead, which is attacker-controlled: a client
  // can rotate spoofed "X-Forwarded-For" values to evade the per-IP audit-write
  // cap because each forged value produces a distinct counter key. Using the
  // rightmost entry ensures the throttle and the persisted row always share the
  // same key, making the cap unbypassable by header rotation.
  const canonicalIp = getClientIp(req);

  const event: WebhookVerificationFailure = {
    provider,
    reason,
    ip: canonicalIp,
    forwardedFor: headerString(req, "x-forwarded-for"),
    userAgent: headerString(req, "user-agent"),
    method: req.method,
    path: req.originalUrl?.split("?")[0] ?? req.path,
    hasSignatureHeader: !!extractSignature(req),
    secretConfigured: isWebhookSecretConfigured(provider),
    timestamp: new Date().toISOString(),
  };

  const log = (req as Request & { log?: typeof logger }).log ?? logger;
  log.warn(
    { audit: "webhook_verification_failed", ...event },
    `webhook_verification_failed provider=${provider} ip=${canonicalIp} reason=${reason}`,
  );

  recordWebhookRejection(event);

  // Fire-and-forget: check per-IP write cap then maybe persist.
  // Best-effort — do not let DB issues affect the request response path.
  void (async () => {
    const allowed = await permitAuditWrite(canonicalIp, log);
    if (!allowed) {
      log.debug(
        { provider, ip: canonicalIp },
        "webhook_audit DB write suppressed: per-IP write cap reached for this window",
      );
      return;
    }
    await storage
      .insertWebhookAudit({
        provider: event.provider,
        reason: event.reason,
        ip: canonicalIp,
        forwardedFor: event.forwardedFor ?? null,
        userAgent: event.userAgent ?? null,
        method: event.method,
        path: event.path,
        hasSignatureHeader: event.hasSignatureHeader,
        secretConfigured: event.secretConfigured,
        statusCode: 401,
      })
      .catch((err: unknown) => {
        log.warn(
          { err: err instanceof Error ? err.message : String(err), provider, ip: canonicalIp },
          "Failed to persist webhook audit entry",
        );
      });
  })();

  return event;
}
