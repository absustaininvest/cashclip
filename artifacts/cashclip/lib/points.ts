// ── CASHCLIP POINTS ↔ DOLLAR CONVERSION (SINGLE SOURCE OF TRUTH) ──────────────
// CashClip intentionally runs TWO points-per-dollar rates. They must NEVER be
// re-declared anywhere else: every surface imports the constants and adapters
// from THIS module so the display economy and the cash economy can't silently
// diverge. Mixing the two rates on one surface misprices points, which is the
// exact footgun this module exists to prevent.
//
//   1. DISPLAY economy — what the user SEES. Mission card values, profile
//      levels / lifetime points, and game reward badges. Purely cosmetic:
//      bigger, more motivating numbers. 10,000 display pts = $1.00.
//
//   2. CASH economy — the REAL money owed. The authoritative rate is server-side
//      and floats with ad revenue (see api-server/src/lib/pointsEconomy.ts);
//      every earn token snapshots its own usd/pt at earn time. The client never
//      decides cash value — when the server returns an explicit USD figure, use
//      it. CASH_POINTS_PER_DOLLAR (1,000 pts = $1) is ONLY a display fallback
//      for formatting a server point figure that arrived without a USD value.
//
// MIGRATION NOTE: these are the EXACT values previously hardcoded in storage.ts,
// profile.tsx and earn-client.ts. Centralizing them changes no numeric value, so
// no user's real cash balance moves. Do NOT collapse the two rates into one
// without an explicit, owner-approved migration — the 10x display gap is
// deliberate (Phase 3 "feature rebalancing").

// Display rate: how many on-screen points represent $1 of perceived value.
// This is the OFFLINE FALLBACK / default. The authoritative value is served by
// the API (GET /api/economy/rate → displayPointsPerDollar). At runtime the
// client overrides this with the server value via setDisplayPointsPerDollar so
// the owner can retune the display number without shipping an app build. The two
// match today, so behaviour is unchanged until the server value diverges.
export const DISPLAY_POINTS_PER_DOLLAR = 10000;

// Runtime-active display rate. Starts at the hardcoded default and is replaced
// by the server-provided rate once it's fetched (or hydrated from the last
// known value on a cold/offline start). All DISPLAY adapters below read this so
// every surface shows ONE consistent number.
let activeDisplayPointsPerDollar = DISPLAY_POINTS_PER_DOLLAR;

// The live display rate every surface should use. Falls back to the default
// when the server value hasn't been loaded yet (e.g. first launch offline).
export function getDisplayPointsPerDollar(): number {
  return activeDisplayPointsPerDollar;
}

// Apply a server-provided display rate. Ignores anything non-positive/invalid so
// a bad payload can never zero out or corrupt the on-screen numbers; the last
// good value (or the default) stays in effect.
export function setDisplayPointsPerDollar(rate: number | null | undefined): void {
  if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
    activeDisplayPointsPerDollar = rate;
  }
}

// Cash rate: legacy/base client rate used only as a fallback when the server
// hasn't supplied an explicit USD value for a points figure.
export const CASH_POINTS_PER_DOLLAR = 1000;

// Back-compat alias — earn-client historically exported this name for the cash
// rate. Kept so existing importers and the 1,000-pts-per-$ contract stay stable.
export const POINTS_PER_DOLLAR = CASH_POINTS_PER_DOLLAR;

// ── DISPLAY adapters (cosmetic surfaces only) ─────────────────────────────────
// Convert a dollar reward into the points the user sees (10,000 pts = $1).
export function dollarsToPoints(dollars: number): number {
  return Math.round(dollars * activeDisplayPointsPerDollar);
}

// Convert display points back into their dollar-equivalent for the optimistic
// local mock balance (mirrors how rewards are stored in display points).
export function displayPointsToDollars(points: number): number {
  return points / activeDisplayPointsPerDollar;
}

// ── CASH adapter (fallback only) ──────────────────────────────────────────────
// Cash value of server-economy points at the base rate. Prefer a server-provided
// USD value whenever one is available; this is only a formatting fallback.
export function pointsToUsd(points: number): number {
  return points / CASH_POINTS_PER_DOLLAR;
}

// ── FORMATTING ────────────────────────────────────────────────────────────────
// Format a points value for display, e.g. 1500 -> "1,500 pts".
export function formatPoints(points: number): string {
  return `${Math.round(points).toLocaleString("en-US")} pts`;
}
