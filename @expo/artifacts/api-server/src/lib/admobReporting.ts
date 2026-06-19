/**
 * Google AdMob Reporting API client.
 *
 * Pulls REAL earnings/impression data from AdMob using an OAuth2 refresh token
 * (offline access, scope https://www.googleapis.com/auth/admob.readonly).
 *
 * Credentials (one secret per credential, set in Replit Secrets / Publishing):
 *   - ADMOB_OAUTH_CLIENT_ID
 *   - ADMOB_OAUTH_CLIENT_SECRET
 *   - ADMOB_OAUTH_REFRESH_TOKEN
 *   - ADMOB_PUBLISHER_ID  (e.g. pub-8679658921848348)
 *
 * Design rules:
 *   - NEVER fabricate numbers. On any failure we return { ok: false, error }.
 *   - Fail gracefully: missing config => configured:false (not an error throw).
 *   - Read-only: only token refresh + networkReport:generate are called.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADMOB_BASE = "https://admob.googleapis.com/v1";
const TIMEOUT_MS = 15000;

export interface AdMobConfigState {
  configured: boolean;
  missing: string[];
}

export interface AdMobMetricRow {
  date: string; // YYYY-MM-DD
  earnings: number; // USD (or account currency)
  impressions: number;
  clicks: number;
  adRequests: number;
  matchedRequests: number;
  ctr: number; // impression CTR (0..1)
  ecpm: number; // impression RPM (per 1000 impressions, currency)
  matchRate: number; // 0..1
  showRate: number; // 0..1
}

export interface AdMobReport {
  ok: boolean;
  configured: boolean;
  error?: string;
  publisherId?: string;
  currency?: string;
  range?: { startDate: string; endDate: string; days: number };
  totals?: {
    earnings: number;
    impressions: number;
    clicks: number;
    adRequests: number;
    matchedRequests: number;
    ctr: number;
    ecpm: number;
    matchRate: number;
    showRate: number;
  };
  daily?: AdMobMetricRow[];
  fetchedAt?: string;
}

const REQUIRED_ENV = [
  "ADMOB_OAUTH_CLIENT_ID",
  "ADMOB_OAUTH_CLIENT_SECRET",
  "ADMOB_OAUTH_REFRESH_TOKEN",
  "ADMOB_PUBLISHER_ID",
] as const;

export function getAdMobConfigState(): AdMobConfigState {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  return { configured: missing.length === 0, missing };
}

/** AdMob account names look like "accounts/pub-XXXXXXXXXXXXXXXX". */
function publisherAccountId(): string {
  const raw = (process.env.ADMOB_PUBLISHER_ID || "").trim();
  return raw.startsWith("pub-") ? raw : `pub-${raw}`;
}

// In-memory access-token cache (per replica). Tokens last ~1h; refresh early.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return { ok: true, token: cachedToken.token };
  }
  const body = new URLSearchParams({
    client_id: process.env.ADMOB_OAUTH_CLIENT_ID || "",
    client_secret: process.env.ADMOB_OAUTH_CLIENT_SECRET || "",
    refresh_token: process.env.ADMOB_OAUTH_REFRESH_TOKEN || "",
    grant_type: "refresh_token",
  });
  try {
    const res = await timed((signal) =>
      fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      }),
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      const detail = json.error_description || json.error || `HTTP ${res.status}`;
      return { ok: false, error: `AdMob OAuth token refresh failed: ${detail}` };
    }
    const ttlSec = Number(json.expires_in) || 3600;
    cachedToken = { token: json.access_token, expiresAt: Date.now() + ttlSec * 1000 };
    return { ok: true, token: json.access_token };
  } catch (err) {
    return { ok: false, error: `AdMob OAuth token refresh error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function ymd(d: Date): { year: number; month: number; day: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function iso(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function metricNum(mv: any): number {
  if (!mv) return 0;
  if (mv.microsValue != null) return Number(mv.microsValue) / 1_000_000;
  if (mv.integerValue != null) return Number(mv.integerValue);
  if (mv.doubleValue != null) return Number(mv.doubleValue);
  return 0;
}

/**
 * Pull a daily network report for the last `days` days (default 30).
 * Returns parsed daily rows + computed totals, or { ok:false } on failure.
 */
export async function fetchAdMobReport(days = 30): Promise<AdMobReport> {
  const cfg = getAdMobConfigState();
  if (!cfg.configured) {
    return {
      ok: false,
      configured: false,
      error: `AdMob not configured. Missing: ${cfg.missing.join(", ")}`,
    };
  }

  const auth = await getAccessToken();
  if (!auth.ok) return { ok: false, configured: true, error: auth.error };

  const safeDays = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
  const end = new Date();
  const start = new Date(end.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000);
  const startDate = ymd(start);
  const endDate = ymd(end);

  const reportSpec = {
    dateRange: { startDate, endDate },
    dimensions: ["DATE"],
    metrics: [
      "ESTIMATED_EARNINGS",
      "IMPRESSIONS",
      "CLICKS",
      "AD_REQUESTS",
      "MATCHED_REQUESTS",
      "IMPRESSION_CTR",
      "IMPRESSION_RPM",
      "MATCH_RATE",
      "SHOW_RATE",
    ],
    sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
  };

  const account = publisherAccountId();
  let payload: any;
  try {
    const res = await timed((signal) =>
      fetch(`${ADMOB_BASE}/accounts/${encodeURIComponent(account)}/networkReport:generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reportSpec }),
        signal,
      }),
    );
    const text = await res.text();
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        detail = j?.error?.message || detail;
      } catch {
        /* keep HTTP status */
      }
      return { ok: false, configured: true, error: `AdMob report failed: ${detail}` };
    }
    payload = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: `AdMob report error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // The streaming endpoint returns a JSON array of objects, each one of:
  //   { header: {...} } | { row: {...} } | { footer: {...} }
  const chunks: any[] = Array.isArray(payload) ? payload : [payload];

  let currency = "USD";
  const header = chunks.find((c) => c && c.header)?.header;
  if (header?.localizationSettings?.currencyCode) {
    currency = header.localizationSettings.currencyCode;
  }

  const daily: AdMobMetricRow[] = [];
  for (const chunk of chunks) {
    const row = chunk?.row;
    if (!row) continue;
    const dim = row.dimensionValues || {};
    const m = row.metricValues || {};
    const dateVal = dim.DATE?.value; // "YYYYMMDD"
    const date = dateVal
      ? `${dateVal.slice(0, 4)}-${dateVal.slice(4, 6)}-${dateVal.slice(6, 8)}`
      : "";
    daily.push({
      date,
      earnings: metricNum(m.ESTIMATED_EARNINGS),
      impressions: metricNum(m.IMPRESSIONS),
      clicks: metricNum(m.CLICKS),
      adRequests: metricNum(m.AD_REQUESTS),
      matchedRequests: metricNum(m.MATCHED_REQUESTS),
      ctr: metricNum(m.IMPRESSION_CTR),
      ecpm: metricNum(m.IMPRESSION_RPM),
      matchRate: metricNum(m.MATCH_RATE),
      showRate: metricNum(m.SHOW_RATE),
    });
  }

  // Totals: sum additive metrics; recompute rates from the aggregates so they
  // stay correct (averaging daily rates would be wrong).
  const sum = (sel: (r: AdMobMetricRow) => number) => daily.reduce((a, r) => a + sel(r), 0);
  const totEarnings = sum((r) => r.earnings);
  const totImpr = sum((r) => r.impressions);
  const totClicks = sum((r) => r.clicks);
  const totReq = sum((r) => r.adRequests);
  const totMatched = sum((r) => r.matchedRequests);

  const totals = {
    earnings: Number(totEarnings.toFixed(2)),
    impressions: totImpr,
    clicks: totClicks,
    adRequests: totReq,
    matchedRequests: totMatched,
    ctr: totImpr > 0 ? totClicks / totImpr : 0,
    ecpm: totImpr > 0 ? (totEarnings / totImpr) * 1000 : 0,
    matchRate: totReq > 0 ? totMatched / totReq : 0,
    showRate: totMatched > 0 ? totImpr / totMatched : 0,
  };

  return {
    ok: true,
    configured: true,
    publisherId: account,
    currency,
    range: { startDate: iso(startDate), endDate: iso(endDate), days: safeDays },
    totals,
    daily,
    fetchedAt: new Date().toISOString(),
  };
}

export interface AdMobFormatRow {
  date: string; // YYYY-MM-DD
  adFormat: string; // REWARDED, BANNER, INTERSTITIAL, … (FORMAT dimension value)
  earnings: number;
  impressions: number;
  clicks: number;
  ecpm: number;
}

export interface AdMobFormatReport {
  ok: boolean;
  configured: boolean;
  error?: string;
  currency?: string;
  rows?: AdMobFormatRow[];
  fetchedAt?: string;
}

/**
 * Pull a daily network report broken down by ad FORMAT (rewarded / banner /
 * interstitial / …) for the last `days` days. Used by the persistence sync so
 * snapshots are stored per (date, format). Same fail-soft contract as
 * fetchAdMobReport — returns { ok:false } on any failure, never throws/fabricates.
 */
export async function fetchAdMobReportByFormat(days = 30): Promise<AdMobFormatReport> {
  const cfg = getAdMobConfigState();
  if (!cfg.configured) {
    return { ok: false, configured: false, error: `AdMob not configured. Missing: ${cfg.missing.join(", ")}` };
  }

  const auth = await getAccessToken();
  if (!auth.ok) return { ok: false, configured: true, error: auth.error };

  const safeDays = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
  const end = new Date();
  const start = new Date(end.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000);

  const reportSpec = {
    dateRange: { startDate: ymd(start), endDate: ymd(end) },
    dimensions: ["DATE", "FORMAT"],
    metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "CLICKS", "IMPRESSION_RPM"],
    sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
  };

  const account = publisherAccountId();
  let payload: any;
  try {
    const res = await timed((signal) =>
      fetch(`${ADMOB_BASE}/accounts/${encodeURIComponent(account)}/networkReport:generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reportSpec }),
        signal,
      }),
    );
    const text = await res.text();
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = JSON.parse(text)?.error?.message || detail;
      } catch {
        /* keep HTTP status */
      }
      return { ok: false, configured: true, error: `AdMob report failed: ${detail}` };
    }
    payload = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: `AdMob report error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const chunks: any[] = Array.isArray(payload) ? payload : [payload];
  let currency = "USD";
  const header = chunks.find((c) => c && c.header)?.header;
  if (header?.localizationSettings?.currencyCode) currency = header.localizationSettings.currencyCode;

  const rows: AdMobFormatRow[] = [];
  for (const chunk of chunks) {
    const row = chunk?.row;
    if (!row) continue;
    const dim = row.dimensionValues || {};
    const m = row.metricValues || {};
    const dateVal = dim.DATE?.value;
    const date = dateVal ? `${dateVal.slice(0, 4)}-${dateVal.slice(4, 6)}-${dateVal.slice(6, 8)}` : "";
    if (!date) continue;
    const adFormat = (dim.FORMAT?.value || "UNKNOWN").toString().toUpperCase();
    rows.push({
      date,
      adFormat,
      earnings: metricNum(m.ESTIMATED_EARNINGS),
      impressions: metricNum(m.IMPRESSIONS),
      clicks: metricNum(m.CLICKS),
      ecpm: metricNum(m.IMPRESSION_RPM),
    });
  }

  return { ok: true, configured: true, currency, rows, fetchedAt: new Date().toISOString() };
}

/**
 * Pull the per-format daily report from AdMob and idempotently upsert it into
 * the persistent snapshot store (the single source of truth shared by the phone
 * admin and the website hub). Safe to call repeatedly and on a schedule.
 *
 * Fail-soft: if AdMob is unconfigured or unreachable, prior persisted data is
 * left intact and we return { ok:false } — never throws, never fabricates.
 */
export async function syncAdMobSnapshots(
  lookbackDays = 30,
): Promise<{ ok: boolean; configured: boolean; written?: number; error?: string }> {
  const report = await fetchAdMobReportByFormat(lookbackDays);
  if (!report.ok || !report.rows) {
    return { ok: false, configured: report.configured, error: report.error };
  }
  try {
    const { storage } = await import("../storage");
    const written = await storage.upsertAdmobSnapshots(
      report.rows.map((r) => ({ ...r, currency: report.currency })),
    );
    return { ok: true, configured: true, written };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: `AdMob snapshot persist failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
