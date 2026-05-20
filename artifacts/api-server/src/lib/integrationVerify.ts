export interface VerifyResult {
  supported: boolean;
  ok: boolean;
  /**
   * True when the provider returned a client-error response (any 4xx). For
   * key validation we treat all 4xx as a configuration/auth failure — the
   * exact code is reflected in `status` and `error` so the wizard can show
   * an actionable message ("Pollfish rejected the key: HTTP 401" etc.).
   */
  authRejected: boolean;
  status?: number;
  error?: string;
  latencyMs: number;
  reason?: string;
}

const TIMEOUT_MS = 6000;

interface FetchOutcome {
  status?: number;
  latencyMs: number;
  networkError: boolean;
  error?: string;
}

async function timedFetch(url: string, init: RequestInit): Promise<FetchOutcome> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { status: res.status, latencyMs: Date.now() - start, networkError: false };
  } catch (err) {
    return {
      latencyMs: Date.now() - start,
      networkError: true,
      error: err instanceof Error ? err.message : "Network error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function unsupported(reason: string): VerifyResult {
  return { supported: false, ok: false, authRejected: false, latencyMs: 0, reason };
}

function classify(name: string, outcome: FetchOutcome): VerifyResult {
  if (outcome.networkError) {
    return {
      supported: true,
      ok: false,
      authRejected: false,
      latencyMs: outcome.latencyMs,
      error: `Could not reach ${name}: ${outcome.error ?? "network error"}`,
    };
  }
  const status = outcome.status ?? 0;
  if (status >= 200 && status < 300) {
    return {
      supported: true,
      ok: true,
      authRejected: false,
      status,
      latencyMs: outcome.latencyMs,
    };
  }
  if (status >= 400 && status < 500) {
    // Treat every 4xx as a key/config rejection. 401/403 are the obvious
    // auth failures, but 400/404/422/etc almost always mean the key is
    // wrong, the account isn't provisioned, or the request shape isn't
    // accepted with these credentials — the wizard should surface them
    // and refuse to mark the provider as connected.
    return {
      supported: true,
      ok: false,
      authRejected: true,
      status,
      latencyMs: outcome.latencyMs,
      error: `${name} rejected the key: HTTP ${status}`,
    };
  }
  return {
    supported: true,
    ok: false,
    authRejected: false,
    status,
    latencyMs: outcome.latencyMs,
    error: `${name} returned HTTP ${status} (will retry on next health check)`,
  };
}

async function verifyBearer(name: string, url: string, key: string): Promise<VerifyResult> {
  return classify(name, await timedFetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  }));
}

async function verifyHeaderKey(
  name: string,
  url: string,
  header: string,
  key: string,
): Promise<VerifyResult> {
  return classify(name, await timedFetch(url, {
    method: "GET",
    headers: { [header]: key },
  }));
}

async function verifyPaypal(clientId: string): Promise<VerifyResult> {
  const secret = process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET;
  if (!secret) {
    return unsupported("Saved. Add PAYPAL_SECRET to verify the credentials against PayPal.");
  }
  const base = process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  return classify("PayPal", await timedFetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  }));
}

async function verifyCpx(secureHash: string): Promise<VerifyResult> {
  const appId = process.env.CPX_APP_ID;
  if (!appId) {
    return unsupported("Saved. Set CPX_APP_ID to verify the secure hash against CPX Research.");
  }
  const url = `https://api.cpx-research.com/api/get-surveys.php?app_id=${encodeURIComponent(appId)}&secure_hash=${encodeURIComponent(secureHash)}&output_method=json`;
  return classify("CPX Research", await timedFetch(url, { method: "GET" }));
}

export async function verifyIntegrationKey(
  integrationId: string,
  value: string,
): Promise<VerifyResult> {
  switch (integrationId) {
    case "pollfish":
      return verifyBearer("Pollfish", "https://api.pollfish.com/v2/surveys/available", value);
    case "cint":
      return verifyHeaderKey("Cint", "https://api.cint.com/v1/surveys/available", "X-Api-Key", value);
    case "lucid":
      return verifyHeaderKey("Lucid", "https://api.samplicio.us/supply/v1/surveys/available", "Authorization", value);
    case "bitlabs":
      return verifyHeaderKey("BitLabs", "https://api.bitlabs.ai/v1/client/surveys", "X-Api-Token", value);
    case "cpx":
      return verifyCpx(value);
    case "tapjoy":
      return verifyHeaderKey("Tapjoy", "https://app.tapjoy.com/publisher/v1/offers", "X-Api-Key", value);
    case "adgate":
      return verifyHeaderKey("AdGate", "https://wall.adgaterewards.com/api/v1/offers", "X-Api-Key", value);
    case "offertoro":
      return verifyHeaderKey("OfferToro", "https://www.offertoro.com/api/v1/offers", "X-Api-Key", value);
    case "paypal":
      return verifyPaypal(value);
    case "unity_ads": {
      const statsKey = process.env.UNITY_MONETIZATION_API_KEY;
      if (!statsKey) return unsupported("Saved. Add UNITY_MONETIZATION_API_KEY to verify credentials against Unity.");
      const orgId = "2475979924671";
      return classify("Unity Ads", await timedFetch(
        `https://services.api.unity.com/monetize/v1/organizations/${orgId}/reports/revenue`,
        { method: "GET", headers: { Authorization: `Basic ${statsKey}` } }
      ));
    }
    case "admob":
    case "ironsource":
      return unsupported("Saved. This is a client SDK identifier — it can only be validated by the mobile app at runtime.");
    default:
      return unsupported("Saved. No automatic verification is available for this provider.");
  }
}
