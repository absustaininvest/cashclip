import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, apiRequestSafe } from "./query-client";
import { POINTS_PER_DOLLAR, pointsToUsd, formatPoints, setDisplayPointsPerDollar } from "./points";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
// The cash rate (POINTS_PER_DOLLAR) and the points↔cash/format helpers live in
// "./points" (the single source of truth) and are re-exported below so existing
// importers of "@/lib/earn-client" keep working unchanged.
export { POINTS_PER_DOLLAR, pointsToUsd, formatPoints };
export const SPIN_INTERVAL_MS  = 2 * 60 * 60 * 1000; // 2-hour spin window

const PENDING_TOKENS_KEY = "cashclip_earn_tokens_v2";
const LAST_SPIN_TS_KEY   = "cashclip_last_spin_ts_v2";
// Last server-provided display rate, persisted so a cold/offline start shows the
// same on-screen numbers as the last online session before any network returns.
const DISPLAY_RATE_KEY   = "cashclip_display_points_per_dollar";

// ── TYPES ─────────────────────────────────────────────────────────────────────
export interface EarnToken {
  id:          string;
  points:      number;
  actionType:  string;
  description: string;
  earnedAt:    number; // unix ms
  claimableAt: number; // unix ms
  estimatedUsd?: number; // server estimate at this token's snapshot rate
}

export interface PendingState {
  pending:         EarnToken[];
  claimable:       EarnToken[];
  pendingPoints:   number;
  claimablePoints: number;
  // Server-estimated cash value (points × each token's snapshot rate). Cash
  // value floats with ad revenue, so these come from the server, not points/1000.
  pendingUsd:      number;
  claimableUsd:    number;
  // Rate that NEWLY earned points lock in at (display only); may be null offline.
  usdPerPoint?:      number;
  floorUsdPerPoint?: number;
  pointsPerDollar?:  number;
}

export interface ConversionRate {
  usdPerPoint:       number;
  floorUsdPerPoint:  number;
  legacyUsdPerPoint: number;
  pointsPerDollar:   number | null;
  // Cosmetic display rate (e.g. 10,000 pts = $1) the client uses for on-screen
  // point figures. Null when the server didn't supply it (older API).
  displayPointsPerDollar: number | null;
  method:            string;
  region:            string;
}

// ── RECORD AN EARN ACTION ─────────────────────────────────────────────────────
// Calls the server — server sets the point amount.
// Returns the issued token on success, null on failure (offline/cap reached).
export async function recordEarnAction(
  actionType: string,
  description: string,
): Promise<EarnToken | null> {
  try {
    const res = await apiRequest("POST", "/api/earnings/record", { actionType, description });
    if (!res.ok) return null;
    const data = await res.json();
    const token: EarnToken = {
      id:          data.tokenId,
      points:      data.points,
      actionType,
      description,
      earnedAt:    Date.now(),
      claimableAt: new Date(data.claimableAt).getTime(),
    };
    await storeTokenLocally(token);
    return token;
  } catch {
    return null;
  }
}

// ── CLAIM A DAILY / WEEKLY MISSION (server-verified) ──────────────────────────
// The server recomputes mission completion from trusted records and issues the
// earn token (server sets the amount). On success the token is stored locally so
// it shows up in the pending wallet, exactly like every other earn action. The
// client no longer credits mission rewards on its own.
//   ok=true,  token        → a new server-issued token (real, pending credit)
//   ok=true,  alreadyClaimed→ already claimed this period (idempotent, no token)
//   ok=false, verifiable=false → mission has no server-verifiable signal
//   ok=false                → not completed yet / capped / offline
export interface ClaimMissionResult {
  ok: boolean;
  token?: EarnToken;
  alreadyClaimed?: boolean;
  verifiable?: boolean;
  error?: string;
}

export async function claimMission(missionId: string): Promise<ClaimMissionResult> {
  try {
    const res = await apiRequest("POST", "/api/missions/claim", { missionId });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      return { ok: false, verifiable: data?.verifiable, error: data?.error };
    }
    if (data.alreadyClaimed) {
      return { ok: true, alreadyClaimed: true };
    }
    const token: EarnToken = {
      id:          data.tokenId,
      points:      data.points,
      actionType:  data.actionType ?? "mission",
      description: `Mission: ${missionId}`,
      earnedAt:    Date.now(),
      claimableAt: new Date(data.claimableAt).getTime(),
    };
    await storeTokenLocally(token);
    return { ok: true, token };
  } catch {
    return { ok: false };
  }
}

// ── DAILY CHECK-IN (server-authoritative streak) ─────────────────────────────
// The check-in streak and its scaled reward live entirely on the server. The
// client records the check-in and reads the resulting streak/ladder back so the
// Earn screen shows the REAL awarded amounts rather than display-only numbers.
export interface CheckinStatus {
  checkinStreak:   number;   // effective live streak (0 if lapsed)
  checkedInToday:  boolean;
  ladder:          number[]; // base points per streak day (rung values)
  milestoneEvery:  number;   // milestone bonus paid every Nth day
  milestoneBonus:  number;   // extra points on a milestone day
  nextReward:      number;   // points the next check-in will grant
  nextIsMilestone: boolean;
}

export async function fetchCheckinStatus(): Promise<CheckinStatus | null> {
  try {
    const res = await apiRequest("GET", "/api/earnings/checkin-status");
    if (!res.ok) return null;
    const data = await res.json();
    return {
      checkinStreak:   Number(data.checkinStreak) || 0,
      checkedInToday:  !!data.checkedInToday,
      ladder:          Array.isArray(data.ladder) ? data.ladder.map((n: any) => Number(n) || 0) : [],
      milestoneEvery:  Number(data.milestoneEvery) || 0,
      milestoneBonus:  Number(data.milestoneBonus) || 0,
      nextReward:      Number(data.nextReward) || 0,
      nextIsMilestone: !!data.nextIsMilestone,
    };
  } catch {
    return null;
  }
}

// Records today's check-in. The server advances the streak and returns the
// scaled points + new streak. Returns null when offline / already checked in.
export async function recordCheckin(): Promise<{
  points: number;
  checkinStreak: number;
  milestoneBonus: number;
} | null> {
  try {
    const res = await apiRequest("POST", "/api/earnings/record", {
      actionType: "checkin",
      description: "Daily check-in",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token: EarnToken = {
      id:          data.tokenId,
      points:      data.points,
      actionType:  "checkin",
      description: "Daily check-in",
      earnedAt:    Date.now(),
      claimableAt: new Date(data.claimableAt).getTime(),
    };
    await storeTokenLocally(token);
    return {
      points:         Number(data.points) || 0,
      checkinStreak:  Number(data.checkinStreak) || 0,
      milestoneBonus: Number(data.milestoneBonus) || 0,
    };
  } catch {
    return null;
  }
}

// ── SPIN CHALLENGE / COMPLETE ─────────────────────────────────────────────────
// Two-step spin flow: /begin issues a server challenge, /complete consumes it.
// The server rejects /complete without a valid challenge from /begin, ensuring
// the client went through a server-observed initiation step before earning.

// When the database is briefly unavailable the server replies 503 with
// { retryable: true } (see api-server earnings routes). We quietly retry a
// couple of times with a short backoff so a momentary blip is invisible to the
// user spinning the wheel, and only surface a gentle "try again" state if every
// attempt fails.
const SPIN_MAX_ATTEMPTS  = 3;
const SPIN_RETRY_BASE_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function isRetryable503(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  try {
    const data = await res.clone().json() as { retryable?: boolean };
    return data?.retryable === true;
  } catch {
    return false;
  }
}

export type SpinBeginResult =
  | { ok: true;  challengeToken: string }
  | { ok: false; retryable: boolean };

export async function beginSpin(): Promise<SpinBeginResult> {
  for (let attempt = 1; attempt <= SPIN_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await apiRequestSafe("POST", "/api/earn/spin/begin", {});
      if (res.ok) {
        const data = await res.json() as { challengeToken?: string };
        return data.challengeToken
          ? { ok: true, challengeToken: data.challengeToken }
          : { ok: false, retryable: false };
      }
      const retryable = await isRetryable503(res);
      if (retryable && attempt < SPIN_MAX_ATTEMPTS) {
        await sleep(SPIN_RETRY_BASE_MS * attempt);
        continue;
      }
      return { ok: false, retryable };
    } catch {
      return { ok: false, retryable: false };
    }
  }
  return { ok: false, retryable: true };
}

export type SpinCompleteResult =
  | { ok: true;  token: EarnToken }
  | { ok: false; retryable: boolean };

export async function completeSpin(challengeToken: string): Promise<SpinCompleteResult> {
  // The server leaves the challenge intact when the consume query throws, so
  // retrying with the same token after a transient failure can still succeed.
  for (let attempt = 1; attempt <= SPIN_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await apiRequestSafe("POST", "/api/earn/spin/complete", { challengeToken });
      if (res.ok) {
        const data = await res.json() as { tokenId: string; points: number; claimableAt: string };
        const token: EarnToken = {
          id:          data.tokenId,
          points:      data.points,
          actionType:  "spin",
          description: "Spin wheel",
          earnedAt:    Date.now(),
          claimableAt: new Date(data.claimableAt).getTime(),
        };
        await storeTokenLocally(token);
        return { ok: true, token };
      }
      const retryable = await isRetryable503(res);
      if (retryable && attempt < SPIN_MAX_ATTEMPTS) {
        await sleep(SPIN_RETRY_BASE_MS * attempt);
        continue;
      }
      return { ok: false, retryable };
    } catch {
      return { ok: false, retryable: false };
    }
  }
  return { ok: false, retryable: true };
}

// ── CLAIM ALL READY TOKENS ────────────────────────────────────────────────────
// Calls server — only tokens past the 3-hour window are credited.
export async function claimAllReady(): Promise<{
  creditedUsd: number;
  newBalance:  number;
  claimed:     number;
} | null> {
  try {
    const res = await apiRequest("POST", "/api/earnings/claim", {});
    if (!res.ok) return null;
    const data = await res.json();
    if (data.claimed > 0) {
      await purgeClaimedLocally();
    }
    return {
      creditedUsd: data.creditedUsd ?? 0,
      newBalance:  data.newBalance  ?? 0,
      claimed:     data.claimed     ?? 0,
    };
  } catch {
    return null;
  }
}

// ── FETCH PENDING STATE FROM SERVER ──────────────────────────────────────────
export async function refreshPendingFromServer(): Promise<PendingState | null> {
  try {
    const res = await apiRequest("GET", "/api/earnings/pending");
    if (!res.ok) return null;
    const data = await res.json();

    const mapToken = (t: any): EarnToken => ({
      id:          t.id,
      points:      t.points,
      actionType:  t.actionType,
      description: t.description,
      earnedAt:    new Date(t.earnedAt).getTime(),
      claimableAt: new Date(t.claimableAt).getTime(),
      estimatedUsd: typeof t.estimatedUsd === "number" ? t.estimatedUsd : undefined,
    });

    return {
      pending:         (data.pending   ?? []).map(mapToken),
      claimable:       (data.claimable ?? []).map(mapToken),
      pendingPoints:   data.pendingPoints   ?? 0,
      claimablePoints: data.claimablePoints ?? 0,
      pendingUsd:      Number(data.pendingUsd)   || 0,
      claimableUsd:    Number(data.claimableUsd) || 0,
      usdPerPoint:      typeof data.usdPerPoint === "number" ? data.usdPerPoint : undefined,
      floorUsdPerPoint: typeof data.floorUsdPerPoint === "number" ? data.floorUsdPerPoint : undefined,
      pointsPerDollar:  typeof data.pointsPerDollar === "number" ? data.pointsPerDollar : undefined,
    };
  } catch {
    return null;
  }
}

// ── FETCH CURRENT CONVERSION RATE ────────────────────────────────────────────
// The server-authoritative points→cash rate (read-only; clients never set it).
export async function fetchConversionRate(): Promise<ConversionRate | null> {
  try {
    const res = await apiRequest("GET", "/api/economy/rate");
    if (!res.ok) return null;
    const data = await res.json();
    const displayPointsPerDollar =
      typeof data.displayPointsPerDollar === "number" ? data.displayPointsPerDollar : null;
    // Apply the server display rate to every surface and remember it for the
    // next cold/offline start. Invalid values are ignored by setDisplayPointsPerDollar.
    if (displayPointsPerDollar && displayPointsPerDollar > 0) {
      setDisplayPointsPerDollar(displayPointsPerDollar);
      AsyncStorage.setItem(DISPLAY_RATE_KEY, String(displayPointsPerDollar)).catch(() => {});
    }
    return {
      usdPerPoint:       Number(data.usdPerPoint)       || 0,
      floorUsdPerPoint:  Number(data.floorUsdPerPoint)  || 0,
      legacyUsdPerPoint: Number(data.legacyUsdPerPoint) || 0,
      pointsPerDollar:   typeof data.pointsPerDollar === "number" ? data.pointsPerDollar : null,
      displayPointsPerDollar,
      method:            String(data.method ?? ""),
      region:            String(data.region ?? "GLOBAL"),
    };
  } catch {
    return null;
  }
}

// ── HYDRATE DISPLAY RATE (cold/offline start) ────────────────────────────────
// Apply the last server-provided display rate from local storage so on-screen
// point figures match the previous online session even before any network call
// returns. If nothing is stored (or storage fails) the hardcoded default in
// "./points" stays in effect. Call once at app start; fetchConversionRate then
// refreshes it from the server.
export async function hydrateDisplayRate(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DISPLAY_RATE_KEY);
    if (raw != null) setDisplayPointsPerDollar(Number(raw));
  } catch {
    // Keep the default — display falls back gracefully.
  }
}

// ── SERVER BALANCE (single source of truth) ──────────────────────────────────
// The user's authoritative spendable balance lives only on the server (the
// `users.balance` column, exposed at GET /api/balance). Every surface that shows
// the wallet balance must read it from here so Home and Wallet can never diverge.
// Uses apiRequest so the auth token (and 401 refresh) is handled consistently.
export async function fetchServerBalance(): Promise<{ balance: number; totalEarned: number } | null> {
  try {
    const res = await apiRequest("GET", "/api/balance");
    if (!res.ok) return null;
    const data = await res.json();
    return { balance: Number(data.balance) || 0, totalEarned: Number(data.totalEarned) || 0 };
  } catch {
    return null;
  }
}

// ── REFERRAL STATUS (server-authoritative) ───────────────────────────────────
// The referral relationship is set at sign-up (a friend enters your username as
// the code). A friend only counts — and only earns you the bonus — once they
// cash out the qualifying amount ($3). Until then they show as "pending".
export interface ReferralFriend {
  name: string;        // masked username, e.g. "jo****"
  joinedAt: number;    // unix ms
  qualified: boolean;  // true once they cashed out $3+
  qualifiedAt: number | null;
}

export interface ReferralStats {
  code: string;              // your referral code (== your username)
  totalReferrals: number;    // friends who signed up with your code
  qualifiedReferrals: number;// friends who cashed out $3+
  pendingReferrals: number;  // signed up but not yet cashed out $3
  referralEarnings: number;  // qualified × bonus
  bonusPerReferral: number;
  qualifyAmount: number;     // $ a friend must cash out to qualify
  referrals: ReferralFriend[];
}

export async function fetchReferralStats(): Promise<ReferralStats | null> {
  try {
    const res = await apiRequest("GET", "/api/referrals");
    if (!res.ok) return null;
    const data = await res.json();
    return {
      code: String(data.code ?? ""),
      totalReferrals: Number(data.totalReferrals) || 0,
      qualifiedReferrals: Number(data.qualifiedReferrals) || 0,
      pendingReferrals: Number(data.pendingReferrals) || 0,
      referralEarnings: Number(data.referralEarnings) || 0,
      bonusPerReferral: Number(data.bonusPerReferral) || 0,
      qualifyAmount: Number(data.qualifyAmount) || 3,
      referrals: (data.referrals ?? []).map((r: any): ReferralFriend => ({
        name: String(r.name ?? ""),
        joinedAt: r.joinedAt ? new Date(r.joinedAt).getTime() : Date.now(),
        qualified: !!r.qualified,
        qualifiedAt: r.qualifiedAt ? new Date(r.qualifiedAt).getTime() : null,
      })),
    };
  } catch {
    return null;
  }
}

// ── SURVEY PROFILE COMPLETENESS ──────────────────────────────────────────────
// Whether the user has finished their survey demographic profile (required to
// withdraw and to unlock higher-paying surveys). Returns null when offline/unknown
// so callers can avoid nagging users when we can't actually tell.
export async function fetchProfileComplete(): Promise<boolean | null> {
  try {
    const res = await apiRequest("GET", "/api/profile");
    if (!res.ok) return null;
    const data = await res.json();
    return !!data.profileComplete;
  } catch {
    return null;
  }
}

// ── LOCAL TOKEN CACHE (optimistic UI) ────────────────────────────────────────
async function storeTokenLocally(token: EarnToken): Promise<void> {
  const existing = await getLocalTokens();
  const updated  = [token, ...existing].slice(0, 200);
  await AsyncStorage.setItem(PENDING_TOKENS_KEY, JSON.stringify(updated));
}

async function getLocalTokens(): Promise<EarnToken[]> {
  const raw = await AsyncStorage.getItem(PENDING_TOKENS_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function purgeClaimedLocally(): Promise<void> {
  const now    = Date.now();
  const tokens = await getLocalTokens();
  // Keep only tokens still in the pending window (not yet claimable)
  const stillPending = tokens.filter(t => t.claimableAt > now);
  await AsyncStorage.setItem(PENDING_TOKENS_KEY, JSON.stringify(stillPending));
}

export async function getLocalPendingState(): Promise<PendingState> {
  const now    = Date.now();
  const all    = await getLocalTokens();
  const pending   = all.filter(t => t.claimableAt > now);
  const claimable = all.filter(t => t.claimableAt <= now);
  return {
    pending,
    claimable,
    pendingPoints:   pending.reduce((s, t) => s + t.points, 0),
    claimablePoints: claimable.reduce((s, t) => s + t.points, 0),
    // Offline cache can't know the live rate; leave cash estimates at 0 and let
    // the next server refresh fill them in. Display falls back to points only.
    pendingUsd:      0,
    claimableUsd:    0,
  };
}

// ── SPIN TIMER (2-HOUR WINDOW) ────────────────────────────────────────────────
export async function canSpinNow(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LAST_SPIN_TS_KEY);
  if (!raw) return true;
  return Date.now() - parseInt(raw, 10) >= SPIN_INTERVAL_MS;
}

export async function recordSpinTimestamp(): Promise<void> {
  await AsyncStorage.setItem(LAST_SPIN_TS_KEY, Date.now().toString());
}

export async function getNextSpinTime(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_SPIN_TS_KEY);
  if (!raw) return null;
  const next = parseInt(raw, 10) + SPIN_INTERVAL_MS;
  return next > Date.now() ? next : null;
}

// ── FORMATTING HELPERS ────────────────────────────────────────────────────────
// pointsToUsd and formatPoints are re-exported from "./points" (see top of file).
export function formatCountdown(claimableAt: number): string {
  const remaining = claimableAt - Date.now();
  if (remaining <= 0) return "Ready!";
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1_000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
