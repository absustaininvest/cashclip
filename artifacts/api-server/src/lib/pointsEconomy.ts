import { db, conversionRates, earnTokens, adEvents } from "@workspace/db";
import { desc, eq, gte, sql } from "drizzle-orm";
import { logger } from "./logger";

// ── POINTS ECONOMY ────────────────────────────────────────────────────────────
// Points are the unit shown to users; their cash value is decided here by the
// server. The value floats with ad ARPU but is clamped to a PUBLISHED FLOOR it
// never drops below, and each point locks in its rate at earn time so a later
// change can never retroactively devalue points already earned.
//
// NOTE ON KNOBS: these are intentionally code constants with NO admin/DB write
// path. The conversion_rates table is written only by the server (the recompute
// job) and read by the API — there is no endpoint that lets a request set the
// rate or floor, so there is nothing for a compromised account to flip.

// Published floor for NEWLY earned points (owner-set, Jun 2026): 5,000 pts = $1.
export const FLOOR_USD_PER_POINT = 0.0002;
// Value applied to points earned before variable rates existed (snapshot NULL):
// the original 1,000 pts = $1. Lowering the floor must never devalue these.
export const LEGACY_USD_PER_POINT = 0.001;
// Hard ceiling so a revenue spike can't blow up payouts — a point can float
// back up to its old worth at most, never beyond.
export const CEILING_USD_PER_POINT = 0.001;
// Share of ad revenue earmarked for user payouts.
export const PAYOUT_SHARE = 0.55;
// Rolling window the ARPU rate is computed over.
export const ARPU_WINDOW_DAYS = 7;
// Gross ad revenue attributed per verified rewarded ad. This is a PROXY used
// until real per-impression revenue from LevelPlay ARM (IronSource
// ImpressionData.revenue) is captured on ad_events — see computeRevenueUsd().
export const AD_REVENUE_PER_REWARD_USD = 0.012;

// ── DISPLAY ECONOMY (cosmetic, owner-tunable) ─────────────────────────────────
// How many on-screen "points" represent $1 of perceived value. PURELY COSMETIC:
// this never touches real cash owed (that is usdPerPoint above). It exists only
// so every client surface shows ONE consistent display number, and so the owner
// can retune that number server-side via GET /api/economy/rate WITHOUT shipping
// a new app build. The client keeps a hardcoded default of the same value as an
// offline fallback; this is the authoritative source.
export const DISPLAY_POINTS_PER_DOLLAR = 10000;

export const DEFAULT_REGION = "GLOBAL";

export interface RateInfo {
  region: string;
  usdPerPoint: number;
  floorUsdPerPoint: number;
  method: string;
  computedAt: Date | null;
}

// Clamp a raw ARPU figure into the published [floor, ceiling] band.
export function clampRate(raw: number): number {
  if (!Number.isFinite(raw)) return FLOOR_USD_PER_POINT;
  return Math.min(CEILING_USD_PER_POINT, Math.max(FLOOR_USD_PER_POINT, raw));
}

// Pure ARPU math, kept side-effect-free so it is unit-testable without a DB.
// usdPerPoint = clamp( (revenue × payoutShare) / pointsIssued ). When no points
// were issued in the window the rate defaults to the floor.
export function computeArpuRate(input: {
  revenueUsd: number;
  pointsIssued: number;
}): { usdPerPoint: number; method: "arpu" | "floor" } {
  const raw =
    input.pointsIssued > 0
      ? (input.revenueUsd * PAYOUT_SHARE) / input.pointsIssued
      : FLOOR_USD_PER_POINT;
  const usdPerPoint = clampRate(raw);
  const method = usdPerPoint > FLOOR_USD_PER_POINT ? "arpu" : "floor";
  return { usdPerPoint, method };
}

// Cash value of a token's points using its locked-in snapshot rate, or the
// legacy floor when the snapshot is NULL (token earned before variable rates).
export function tokenUsd(
  points: number,
  snapshot: string | number | null | undefined,
): number {
  const rate =
    snapshot === null || snapshot === undefined
      ? LEGACY_USD_PER_POINT
      : Number(snapshot);
  return points * (Number.isFinite(rate) ? rate : LEGACY_USD_PER_POINT);
}

// SQL fragment that totals the USD value of a set of earn-token rows using each
// token's own snapshot (falling back to the legacy floor for NULLs). Used so the
// daily cap and credited amount are computed entirely server-side in one query.
export function tokenUsdSumSql() {
  return sql<string>`COALESCE(SUM(${earnTokens.points} * COALESCE(${earnTokens.usdPerPointSnapshot}, ${LEGACY_USD_PER_POINT}::numeric)), 0)`;
}

// ── CURRENT RATE (short-lived cache) ──────────────────────────────────────────
// The rate is read on every token issue, so cache the latest row briefly to
// avoid a DB round-trip per earn. The cache only affects which snapshot a new
// token gets (always >= floor); it never affects crediting correctness.
const rateCache = new Map<string, { info: RateInfo; expires: number }>();
const RATE_CACHE_TTL_MS = 60_000;

async function latestRow(region: string) {
  const [row] = await db
    .select()
    .from(conversionRates)
    .where(eq(conversionRates.region, region))
    .orderBy(desc(conversionRates.createdAt))
    .limit(1);
  return row;
}

export async function getCurrentRate(region = DEFAULT_REGION): Promise<RateInfo> {
  const cached = rateCache.get(region);
  if (cached && cached.expires > Date.now()) return cached.info;

  let row = await latestRow(region);
  // Geo-ready: a region with no rate of its own inherits GLOBAL.
  if (!row && region !== DEFAULT_REGION) row = await latestRow(DEFAULT_REGION);

  const info: RateInfo = row
    ? {
        region,
        usdPerPoint: Number(row.usdPerPoint),
        floorUsdPerPoint: Number(row.floorUsdPerPoint),
        method: row.method,
        computedAt: row.createdAt,
      }
    : {
        region,
        usdPerPoint: FLOOR_USD_PER_POINT,
        floorUsdPerPoint: FLOOR_USD_PER_POINT,
        method: "floor",
        computedAt: null,
      };

  rateCache.set(region, { info, expires: Date.now() + RATE_CACHE_TTL_MS });
  return info;
}

export function invalidateRateCache(region?: string): void {
  if (region) rateCache.delete(region);
  else rateCache.clear();
}

// Rate value (as a fixed-precision string) to stamp onto a newly issued token.
export async function snapshotRateString(region = DEFAULT_REGION): Promise<string> {
  const { usdPerPoint } = await getCurrentRate(region);
  return usdPerPoint.toFixed(8);
}

// ── REVENUE MEASURE ───────────────────────────────────────────────────────────
// Gross ad revenue over the window, computed from REAL money when available.
// LevelPlay ARM (Ad Revenue Measurement) fires an ImpressionDataListener
// callback per impression carrying revenue in dollars. The client converts this
// to micros (1,000,000 micros = $1) and reports it on ad_events.revenue_micros.
// ARM SDK Postbacks must be enabled in the IronSource dashboard
// (Reporting → ARM → SDK Postbacks) for ImpressionData.revenue to be non-null.
//
// Transitional fallback: until a native build with LevelPlay ARM active ships
// and data flows in, NO ad_events row carries real revenue, so there is nothing
// to SUM. Returning 0 then would collapse the rate to the floor for everyone.
// So the proxy is used ONLY while not a single row in the window has real
// revenue recorded (revenueRows = 0). The moment real revenue starts flowing
// we switch to the SUM and never use the proxy again — even a genuinely
// low/zero SUM over real impressions is honored (we gate on "any real rows
// present", NOT sum>0, so a valid low-value window can't wrongly inflate
// revenue via the proxy).
export async function computeRevenueUsd(since: Date): Promise<number> {
  const [{ realMicros, revenueRows, rewardCount }] = await db
    .select({
      realMicros: sql<string>`COALESCE(SUM(${adEvents.revenueMicros}), 0)`,
      revenueRows: sql<string>`COUNT(*) FILTER (WHERE ${adEvents.revenueMicros} IS NOT NULL)`,
      rewardCount: sql<string>`COUNT(*) FILTER (WHERE ${adEvents.event} = 'reward_earned')`,
    })
    .from(adEvents)
    .where(gte(adEvents.createdAt, since));

  // Real revenue has started flowing — use it exclusively (the proxy is dead).
  if (Number(revenueRows ?? 0) > 0) return Number(realMicros ?? 0) / 1_000_000;

  // No real per-impression revenue captured yet — estimate from the proxy.
  return Number(rewardCount ?? 0) * AD_REVENUE_PER_REWARD_USD;
}

// Total points issued in the window (across every earn action).
export async function computePointsIssued(since: Date): Promise<number> {
  const [{ pts }] = await db
    .select({ pts: sql<string>`COALESCE(SUM(${earnTokens.points}), 0)` })
    .from(earnTokens)
    .where(gte(earnTokens.earnedAt, since));
  return Number(pts ?? 0);
}

// Recompute the ARPU rate for a region and append a new history row. Idempotent
// in effect: it only appends; the latest row wins. Returns the new rate.
export async function computeAndStoreRate(region = DEFAULT_REGION): Promise<RateInfo> {
  const since = new Date(Date.now() - ARPU_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const revenueUsd = await computeRevenueUsd(since);
  const pointsIssued = await computePointsIssued(since);

  const { usdPerPoint, method } = computeArpuRate({ revenueUsd, pointsIssued });

  await db.insert(conversionRates).values({
    region,
    usdPerPoint: usdPerPoint.toFixed(8),
    floorUsdPerPoint: FLOOR_USD_PER_POINT.toFixed(8),
    method,
    windowDays: ARPU_WINDOW_DAYS,
    revenueUsd: revenueUsd.toFixed(4),
    pointsIssued: String(pointsIssued),
  });
  invalidateRateCache(region);

  logger.info(
    { region, usdPerPoint, method, revenueUsd, pointsIssued },
    "conversion rate recomputed",
  );
  return {
    region,
    usdPerPoint,
    floorUsdPerPoint: FLOOR_USD_PER_POINT,
    method,
    computedAt: new Date(),
  };
}

// Ensure a region has at least one rate row (seeded at the floor) so the very
// first token issue and the first /api/economy/rate read have something to use.
export async function seedRateIfMissing(region = DEFAULT_REGION): Promise<void> {
  const existing = await latestRow(region);
  if (existing) return;
  await db.insert(conversionRates).values({
    region,
    usdPerPoint: FLOOR_USD_PER_POINT.toFixed(8),
    floorUsdPerPoint: FLOOR_USD_PER_POINT.toFixed(8),
    method: "seed",
    windowDays: ARPU_WINDOW_DAYS,
  });
  invalidateRateCache(region);
  logger.info({ region }, "seeded initial conversion rate at floor");
}
