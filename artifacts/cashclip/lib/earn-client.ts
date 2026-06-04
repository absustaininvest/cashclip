import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "./query-client";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
export const POINTS_PER_DOLLAR = 1000;           // 1000 pts = $1.00
export const SPIN_INTERVAL_MS  = 2 * 60 * 60 * 1000; // 2-hour spin window

const PENDING_TOKENS_KEY = "cashclip_earn_tokens_v2";
const LAST_SPIN_TS_KEY   = "cashclip_last_spin_ts_v2";

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

// ── SPIN CHALLENGE / COMPLETE ─────────────────────────────────────────────────
// Two-step spin flow: /begin issues a server challenge, /complete consumes it.
// The server rejects /complete without a valid challenge from /begin, ensuring
// the client went through a server-observed initiation step before earning.

export async function beginSpin(): Promise<string | null> {
  try {
    const res = await apiRequest("POST", "/api/earn/spin/begin", {});
    if (!res.ok) return null;
    const data = await res.json() as { challengeToken?: string };
    return data.challengeToken ?? null;
  } catch {
    return null;
  }
}

export async function completeSpin(challengeToken: string): Promise<EarnToken | null> {
  try {
    const res = await apiRequest("POST", "/api/earn/spin/complete", { challengeToken });
    if (!res.ok) return null;
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
    return token;
  } catch {
    return null;
  }
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
    return {
      usdPerPoint:       Number(data.usdPerPoint)       || 0,
      floorUsdPerPoint:  Number(data.floorUsdPerPoint)  || 0,
      legacyUsdPerPoint: Number(data.legacyUsdPerPoint) || 0,
      pointsPerDollar:   typeof data.pointsPerDollar === "number" ? data.pointsPerDollar : null,
      method:            String(data.method ?? ""),
      region:            String(data.region ?? "GLOBAL"),
    };
  } catch {
    return null;
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
export function pointsToUsd(points: number): number {
  return points / POINTS_PER_DOLLAR;
}

export function formatPoints(points: number): string {
  return points.toLocaleString() + " pts";
}

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
