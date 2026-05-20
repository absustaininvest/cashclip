/**
 * Lightweight VPN/proxy/Tor detection using proxycheck.io.
 *
 * - Fail-open: if the API key is missing or the request times out, the check
 *   passes so legitimate users are never blocked by an upstream outage.
 * - In-memory LRU cache (capped at 2,000 entries, 30-minute TTL) keeps costs
 *   low and latency near-zero for repeat IPs. In multi-replica production this
 *   means each pod carries its own warm cache — acceptable because the check
 *   fails open anyway.
 *
 * Usage:
 *   const result = await checkProxy(ip);
 *   if (result.isProxy) { ... }
 */

import { logger } from "./logger";

interface ProxyResult {
  isProxy: boolean;
  type?: string;  // "VPN" | "TOR" | "PROXY" | etc.
  risk?: number;  // 0-100 risk score from proxycheck.io
  cached: boolean;
}

interface CacheEntry {
  result: ProxyResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_ENTRIES = 2_000;
const REQUEST_TIMEOUT_MS = 3_000;

const cache = new Map<string, CacheEntry>();

function evictIfFull(): void {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  // Evict the oldest 10% of entries
  const now = Date.now();
  const toDelete: string[] = [];
  for (const [ip, entry] of cache) {
    if (entry.expiresAt <= now) toDelete.push(ip);
    if (toDelete.length >= MAX_CACHE_ENTRIES * 0.1) break;
  }
  if (toDelete.length === 0) {
    // Nothing expired yet — drop the first 200 entries
    let n = 0;
    for (const ip of cache.keys()) {
      toDelete.push(ip);
      if (++n >= 200) break;
    }
  }
  toDelete.forEach((ip) => cache.delete(ip));
}

function passThrough(cached: boolean = false): ProxyResult {
  return { isProxy: false, cached };
}

export async function checkProxy(ip: string): Promise<ProxyResult> {
  if (!ip || ip === "unknown" || ip === "127.0.0.1" || ip.startsWith("::")) {
    return passThrough();
  }

  const apiKey = process.env["PROXYCHECK_API_KEY"];
  if (!apiKey) {
    // Not configured — fail open silently
    return passThrough();
  }

  // Check cache
  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.result, cached: true };
  }

  try {
    const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${apiKey}&vpn=1&risk=1&asn=0`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      logger.warn({ ip, status: resp.status }, "proxycheck.io returned non-OK status");
      return passThrough();
    }

    const json = (await resp.json()) as Record<string, unknown>;
    const ipData = json[ip] as Record<string, unknown> | undefined;

    if (!ipData) {
      return passThrough();
    }

    const isProxy =
      ipData["proxy"] === "yes" ||
      ipData["type"] === "VPN" ||
      ipData["type"] === "TOR";

    const result: ProxyResult = {
      isProxy,
      type: typeof ipData["type"] === "string" ? ipData["type"] : undefined,
      risk:
        typeof ipData["risk"] === "number"
          ? ipData["risk"]
          : typeof ipData["risk"] === "string"
            ? parseInt(ipData["risk"], 10)
            : undefined,
      cached: false,
    };

    evictIfFull();
    cache.set(ip, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    return result;
  } catch (err: any) {
    if (err?.name !== "AbortError") {
      logger.warn({ err, ip }, "proxycheck.io request failed — failing open");
    }
    return passThrough();
  }
}
