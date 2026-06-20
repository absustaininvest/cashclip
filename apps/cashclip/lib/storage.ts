import AsyncStorage from "@react-native-async-storage/async-storage";
import { secureGet, secureSet, secureDelete } from "./secure-store";
import {
  DISPLAY_POINTS_PER_DOLLAR,
  dollarsToPoints,
  displayPointsToDollars,
  formatPoints,
} from "./points";
import { apiRequest } from "./query-client";

// Re-export the shared display helpers so existing importers of "@/lib/storage"
// keep working while the single source of truth lives in "./points".
export { DISPLAY_POINTS_PER_DOLLAR, dollarsToPoints, formatPoints };

// Locally cached PayPal payout email. Lets the Profile input and withdrawal
// modal pre-fill a previously typed address even before it's saved to the
// server. Server-provided email always takes precedence over this cache.
export const PAYPAL_EMAIL_CACHE_KEY = "cashclip_paypal_email_v1";

const KEYS = {
  BALANCE: "cashclip_balance",
  TOTAL_EARNED: "cashclip_total_earned",
  VIDEOS_WATCHED: "cashclip_videos_watched",
  ADS_WATCHED: "cashclip_ads_watched",
  STREAK: "cashclip_streak",
  LAST_WATCH_DATE: "cashclip_last_watch_date",
  TRANSACTIONS: "cashclip_transactions",
  DAILY_ADS: "cashclip_daily_ads",
  DAILY_AD_DATE: "cashclip_daily_ad_date",
  LIKED_VIDEOS: "cashclip_liked_videos",
  REFERRAL_CODE: "cashclip_referral_code",
  REFERRALS: "cashclip_referrals",
  REFERRAL_EARNINGS: "cashclip_referral_earnings",
  DAILY_CHECKIN_DATE: "cashclip_daily_checkin_date",
  CHECKIN_STREAK: "cashclip_checkin_streak",
  LAST_SPIN_DATE: "cashclip_last_spin_date",
  MISSIONS: "cashclip_missions",
  MISSIONS_DATE: "cashclip_missions_date",
  NOTIFICATIONS: "cashclip_notifications",
  WEEKLY_MISSIONS: "cashclip_weekly_missions",
  WEEKLY_MISSIONS_WEEK: "cashclip_weekly_missions_week",
  TOTAL_REFERRALS: "cashclip_total_referrals",
  QUALIFIED_REFERRALS: "cashclip_qualified_referrals",
  SURVEYS_COMPLETED: "cashclip_surveys_completed",
  SURVEY_EARNINGS: "cashclip_survey_earnings",
  COMPLETED_SURVEY_IDS: "cashclip_completed_survey_ids",
  LAST_SCRATCH_DATE: "cashclip_last_scratch_date",
  LAST_MEMORY_DATE: "cashclip_last_memory_date",
  LAST_TRIVIA_DATE: "cashclip_last_trivia_date",
  LAST_COIN_CATCHER_DATE: "cashclip_last_coin_catcher_date",
  LAST_TAP_FRENZY_DATE: "cashclip_last_tap_frenzy_date",
  LAST_SOLITAIRE_DATE: "cashclip_last_solitaire_date",
  LAST_DOMINOES_DATE: "cashclip_last_dominoes_date",
  LAST_TETRIS_DATE: "cashclip_last_tetris_date",
  LAST_BLOCK_BLITZ_DATE: "cashclip_last_block_blitz_date",
  GAMES_PLAYED: "cashclip_games_played",
  GAMES_SINCE_INTERSTITIAL: "cashclip_games_since_interstitial",
  GAME_EARNINGS: "cashclip_game_earnings",
  SPONSOR_BRANDS: "cashclip_sponsor_brands",
  ACCOUNT_CREATED: "cashclip_account_created",
  DAILY_EARNINGS: "cashclip_daily_earnings",
  DAILY_EARNINGS_DATE: "cashclip_daily_earnings_date",

  WITHDRAWAL_COUNT: "cashclip_withdrawal_count",
  LAST_WITHDRAWAL_DATE: "cashclip_last_withdrawal_date",
  APP_PIN: "cashclip_app_pin",
  PIN_ENABLED: "cashclip_pin_enabled",
  BIOMETRIC_ENABLED: "cashclip_biometric_enabled",
};

export interface Transaction {
  id: string;
  type: "earned" | "withdrawn" | "bonus" | "referral" | "checkin" | "spin" | "mission" | "survey" | "game" | "adjustment" | "refund";
  amount: number;
  description: string;
  timestamp: number;
}

export interface UserStats {
  balance: number;
  totalEarned: number;
  videosWatched: number;
  adsWatched: number;
  streak: number;
  dailyAdsWatched: number;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: "reward" | "referral" | "milestone" | "reminder" | "promo";
  read: boolean;
  timestamp: number;
}

export interface DailyMission {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward: number;
  completed: boolean;
  claimed: boolean;
  icon: string;
}

export interface WeeklyMission {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward: number;
  completed: boolean;
  claimed: boolean;
  icon: string;
}

async function getNumber(key: string, fallback: number): Promise<number> {
  const val = await AsyncStorage.getItem(key);
  return val ? parseFloat(val) : fallback;
}

async function setNumber(key: string, value: number): Promise<void> {
  await AsyncStorage.setItem(key, value.toString());
}

export async function getUserStats(): Promise<UserStats> {
  const today = new Date().toDateString();
  const adDate = await AsyncStorage.getItem(KEYS.DAILY_AD_DATE);
  let dailyAds = await getNumber(KEYS.DAILY_ADS, 0);
  if (adDate !== today) {
    dailyAds = 0;
    await AsyncStorage.setItem(KEYS.DAILY_AD_DATE, today);
    await setNumber(KEYS.DAILY_ADS, 0);
  }

  return {
    balance: await getNumber(KEYS.BALANCE, 0),
    totalEarned: await getNumber(KEYS.TOTAL_EARNED, 0),
    videosWatched: await getNumber(KEYS.VIDEOS_WATCHED, 0),
    adsWatched: await getNumber(KEYS.ADS_WATCHED, 0),
    streak: await getNumber(KEYS.STREAK, 0),
    dailyAdsWatched: dailyAds,
  };
}

export async function addEarnings(amount: number, description: string, type: Transaction["type"] = "earned"): Promise<void> {
  await ensureAccountCreated();

  // The client NEVER mints balance. Real money is granted ONLY by the server
  // (earn tokens via /api/earnings/*, provider webhooks, AdMob SSV). Writing a
  // local "balance" here was the phantom number users saw ("where is my $10?")
  // that the server never recorded. Spendable balance and lifetime earnings are
  // now read exclusively from the server (GET /api/balance) on Home, Wallet and
  // Profile. We keep a local transaction entry only as a UI activity note; it
  // does not move any balance.
  const tx: Transaction = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    type,
    amount,
    description,
    timestamp: Date.now(),
  };
  await addTransaction(tx);
}

export async function recordAdWatch(): Promise<number> {
  const adsWatched = await getNumber(KEYS.ADS_WATCHED, 0);
  const dailyAds = await getNumber(KEYS.DAILY_ADS, 0);
  await setNumber(KEYS.ADS_WATCHED, adsWatched + 1);
  await setNumber(KEYS.DAILY_ADS, dailyAds + 1);

  const today = new Date().toDateString();
  const lastDate = await AsyncStorage.getItem(KEYS.LAST_WATCH_DATE);
  let streak = await getNumber(KEYS.STREAK, 0);

  if (lastDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastDate === yesterday.toDateString()) {
      streak += 1;
    } else if (lastDate !== today) {
      streak = 1;
    }
    await setNumber(KEYS.STREAK, streak);
    await AsyncStorage.setItem(KEYS.LAST_WATCH_DATE, today);
  }

  // Ad rewards are credited server-side ONLY — real AdMob views pay via Google's
  // verified SSV callback, and in-app fallback views pay via the secure
  // begin→complete flow (sharing the rewarded_ad daily cap). The client must
  // never mint balance locally, so we only track counts/streak/missions here.
  await updateMissionProgress("watch_ads", 1);
  await updateWeeklyMissionProgress("weekly_ads", 1);

  return 0;
}

export async function recordVideoWatch(): Promise<void> {
  const count = await getNumber(KEYS.VIDEOS_WATCHED, 0);
  await setNumber(KEYS.VIDEOS_WATCHED, count + 1);
  await updateMissionProgress("watch_videos", 1);
  await updateWeeklyMissionProgress("weekly_videos", 1);
}

export interface WithdrawalTier {
  amount: number;
  bonusPercent: number;
  bonusAmount: number;
  totalPayout: number;
  label: string;
  tag: string;
}

export function getWithdrawalTiers(balance: number): WithdrawalTier[] {
  const tiers = [
    { amount: 3, bonusPercent: 0, label: "$3.00", tag: "Minimum" },
    { amount: 5, bonusPercent: 0, label: "$5.00", tag: "Popular" },
    { amount: 7, bonusPercent: 0, label: "$7.00", tag: "Best Value" },
  ];
  return tiers
    .filter((t) => t.amount <= balance)
    .map((t) => ({
      ...t,
      bonusAmount: parseFloat(((t.amount * t.bonusPercent) / 100).toFixed(2)),
      totalPayout: parseFloat((t.amount + (t.amount * t.bonusPercent) / 100).toFixed(2)),
    }));
}

export async function withdraw(amount: number, bonusPercent: number = 0): Promise<boolean> {
  const balance = await getNumber(KEYS.BALANCE, 0);
  if (amount > balance || amount < 3) return false;
  const bonusAmount = parseFloat(((amount * bonusPercent) / 100).toFixed(2));
  const totalPayout = parseFloat((amount + bonusAmount).toFixed(2));
  await setNumber(KEYS.BALANCE, parseFloat((balance - amount).toFixed(2)));
  const tx: Transaction = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    type: "withdrawn",
    amount: -amount,
    description: `Withdrawal $${amount.toFixed(2)}`,
    timestamp: Date.now(),
  };
  await addTransaction(tx);
  if (bonusAmount > 0) {
    const bonusTx: Transaction = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6) + "b",
      type: "bonus",
      amount: bonusAmount,
      description: `Cashout bonus (+${bonusPercent}%)`,
      timestamp: Date.now() + 1,
    };
    await addTransaction(bonusTx);
  }
  return true;
}

async function addTransaction(tx: Transaction): Promise<void> {
  const raw = await AsyncStorage.getItem(KEYS.TRANSACTIONS);
  const list: Transaction[] = raw ? JSON.parse(raw) : [];
  list.unshift(tx);
  if (list.length > 100) list.pop();
  await AsyncStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify(list));
}

export async function getTransactions(): Promise<Transaction[]> {
  const raw = await AsyncStorage.getItem(KEYS.TRANSACTIONS);
  return raw ? JSON.parse(raw) : [];
}

export async function getLikedVideos(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(KEYS.LIKED_VIDEOS);
  return raw ? new Set(JSON.parse(raw)) : new Set();
}

export async function toggleLikeVideo(videoId: string): Promise<boolean> {
  const liked = await getLikedVideos();
  const isLiked = liked.has(videoId);
  if (isLiked) {
    liked.delete(videoId);
  } else {
    liked.add(videoId);
  }
  await AsyncStorage.setItem(KEYS.LIKED_VIDEOS, JSON.stringify([...liked]));
  return !isLiked;
}

// Referral totals shown on the Profile screen. These are read-only caches of
// server-authoritative numbers (see cacheReferralStats), NOT a local economy —
// the only place a referral bonus is ever granted is the server, once a referred
// friend cashes out $3+. We deliberately no longer mint anything client-side.
export async function getTotalReferrals(): Promise<number> {
  return getNumber(KEYS.TOTAL_REFERRALS, 0);
}

export async function getReferralEarnings(): Promise<number> {
  return getNumber(KEYS.REFERRAL_EARNINGS, 0);
}

// Cache the server's referral numbers so screens that don't fetch live data
// (e.g. Profile) still reflect reality. Never credits the balance.
export async function cacheReferralStats(totalJoined: number, earnings: number): Promise<void> {
  await setNumber(KEYS.TOTAL_REFERRALS, Math.max(0, Math.round(totalJoined)));
  await setNumber(KEYS.REFERRAL_EARNINGS, Math.max(0, earnings));
}

// Track the last-seen qualified referral count so the referral screen can
// detect newly qualified friends and show a celebration overlay.
export async function getSeenQualifiedReferrals(): Promise<number> {
  return getNumber(KEYS.QUALIFIED_REFERRALS, 0);
}

export async function setSeenQualifiedReferrals(count: number): Promise<void> {
  await setNumber(KEYS.QUALIFIED_REFERRALS, Math.max(0, Math.round(count)));
}

// ── DISPLAY / RESET HELPERS ───────────────────────────────────────────────────
// The owner's display model (10,000 pts = $1) and the dollars↔points adapters
// live in "./points" (the single source of truth) and are imported/re-exported
// at the top of this file. Mission rewards are stored in DISPLAY points; we
// convert them back into the local dollar-based mock balance with
// displayPointsToDollars so the optimistic local balance stays numerically
// consistent. The authoritative point→cash conversion is server-side.

// Returns the calendar day in US Eastern time (midnight EST/EDT boundary) so the
// daily check-in resets at 00:00 Eastern regardless of the device's timezone.
function estDay(d: Date = new Date()): string {
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

export async function getDailyCheckinInfo(): Promise<{ checkedInToday: boolean; checkinStreak: number }> {
  const today = estDay();
  const lastCheckin = await AsyncStorage.getItem(KEYS.DAILY_CHECKIN_DATE);
  const streak = await getNumber(KEYS.CHECKIN_STREAK, 0);
  return {
    checkedInToday: lastCheckin === today,
    checkinStreak: streak,
  };
}

export async function performDailyCheckin(): Promise<{ reward: number; streak: number }> {
  const today = estDay();
  const lastCheckin = await AsyncStorage.getItem(KEYS.DAILY_CHECKIN_DATE);

  if (lastCheckin === today) {
    const streak = await getNumber(KEYS.CHECKIN_STREAK, 0);
    return { reward: 0, streak };
  }

  let streak = await getNumber(KEYS.CHECKIN_STREAK, 0);
  if (lastCheckin) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastCheckin === estDay(yesterday)) {
      streak += 1;
    } else {
      streak = 1;
    }
  } else {
    streak = 1;
  }

  await setNumber(KEYS.CHECKIN_STREAK, streak);
  await AsyncStorage.setItem(KEYS.DAILY_CHECKIN_DATE, today);

  const baseReward = 0.10;
  const streakBonus = Math.min(streak, 7) * 0.02;
  const reward = parseFloat((baseReward + streakBonus).toFixed(2));

  await addEarnings(reward, `Day ${streak} check-in reward`, "checkin");

  await updateMissionProgress("daily_checkin", 1);

  if (streak === 7) {
    await addEarnings(0.50, "7-day check-in streak bonus!", "bonus");
    await addNotification({
      title: "Streak Milestone!",
      message: "You maintained a 7-day check-in streak! Enjoy your $0.50 bonus!",
      type: "milestone",
    });
  }

  return { reward, streak };
}

export async function canSpinToday(): Promise<boolean> {
  const today = new Date().toDateString();
  const lastSpin = await AsyncStorage.getItem(KEYS.LAST_SPIN_DATE);
  return lastSpin !== today;
}

export async function recordSpin(reward: number): Promise<void> {
  const today = new Date().toDateString();
  await AsyncStorage.setItem(KEYS.LAST_SPIN_DATE, today);
  await addEarnings(reward, `Spin the wheel reward`, "spin");
  await updateMissionProgress("daily_spin", 1);
}

function getWeekNumber(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 604800000;
  return `${now.getFullYear()}-W${Math.ceil(diff / oneWeek)}`;
}

export async function getDailyMissions(): Promise<DailyMission[]> {
  const today = new Date().toDateString();
  const storedDate = await AsyncStorage.getItem(KEYS.MISSIONS_DATE);

  if (storedDate === today) {
    const raw = await AsyncStorage.getItem(KEYS.MISSIONS);
    if (raw) return JSON.parse(raw);
  }

  const missions: DailyMission[] = [
    {
      id: "daily_checkin",
      title: "Daily Check-in",
      description: "Open the app and check in",
      target: 1,
      progress: 0,
      reward: 1000,
      completed: false,
      claimed: false,
      icon: "log-in",
    },
    {
      id: "watch_ads",
      title: "Watch 5 Ads",
      description: "Watch 5 ad videos today",
      target: 5,
      progress: 0,
      reward: 1500,
      completed: false,
      claimed: false,
      icon: "eye",
    },
    {
      id: "watch_videos",
      title: "Browse 10 Videos",
      description: "View 10 videos in the feed",
      target: 10,
      progress: 0,
      reward: 1000,
      completed: false,
      claimed: false,
      icon: "play-circle",
    },
    {
      id: "refer_friends",
      title: "Invite a Friend",
      description: "Share your referral code",
      target: 1,
      progress: 0,
      reward: 2500,
      completed: false,
      claimed: false,
      icon: "user-plus",
    },
    {
      id: "daily_spin",
      title: "Spin the Wheel",
      description: "Use your daily spin",
      target: 1,
      progress: 0,
      reward: 500,
      completed: false,
      claimed: false,
      icon: "refresh-cw",
    },
  ];

  await AsyncStorage.setItem(KEYS.MISSIONS_DATE, today);
  await AsyncStorage.setItem(KEYS.MISSIONS, JSON.stringify(missions));
  return missions;
}

export async function getWeeklyMissions(): Promise<WeeklyMission[]> {
  const currentWeek = getWeekNumber();
  const storedWeek = await AsyncStorage.getItem(KEYS.WEEKLY_MISSIONS_WEEK);

  if (storedWeek === currentWeek) {
    const raw = await AsyncStorage.getItem(KEYS.WEEKLY_MISSIONS);
    if (raw) return JSON.parse(raw);
  }

  const missions: WeeklyMission[] = [
    {
      id: "weekly_ads",
      title: "Ad Enthusiast",
      description: "Watch 50 ads this week",
      target: 50,
      progress: 0,
      reward: 10000,
      completed: false,
      claimed: false,
      icon: "tv",
    },
    {
      id: "weekly_videos",
      title: "Content Explorer",
      description: "Browse 50 videos this week",
      target: 50,
      progress: 0,
      reward: 7500,
      completed: false,
      claimed: false,
      icon: "film",
    },
    {
      id: "weekly_referrals",
      title: "Social Butterfly",
      description: "Invite 3 friends who cash out $3",
      target: 3,
      progress: 0,
      reward: 20000,
      completed: false,
      claimed: false,
      icon: "users",
    },
    {
      id: "weekly_streak",
      title: "Consistency King",
      description: "Check in 7 days this week",
      target: 7,
      progress: 0,
      reward: 12000,
      completed: false,
      claimed: false,
      icon: "calendar",
    },
  ];

  await AsyncStorage.setItem(KEYS.WEEKLY_MISSIONS_WEEK, currentWeek);
  await AsyncStorage.setItem(KEYS.WEEKLY_MISSIONS, JSON.stringify(missions));
  return missions;
}

async function updateMissionProgress(missionId: string, increment: number): Promise<void> {
  const missions = await getDailyMissions();
  const mission = missions.find((m) => m.id === missionId);
  if (mission && !mission.completed) {
    mission.progress = Math.min(mission.progress + increment, mission.target);
    if (mission.progress >= mission.target) {
      mission.completed = true;
      await addNotification({
        title: "Mission Complete!",
        message: `You completed "${mission.title}". Claim your reward!`,
        type: "reward",
      });
    }
    await AsyncStorage.setItem(KEYS.MISSIONS, JSON.stringify(missions));
  }
}

async function updateWeeklyMissionProgress(missionId: string, increment: number): Promise<void> {
  const missions = await getWeeklyMissions();
  const mission = missions.find((m) => m.id === missionId);
  if (mission && !mission.completed) {
    mission.progress = Math.min(mission.progress + increment, mission.target);
    if (mission.progress >= mission.target) {
      mission.completed = true;
      await addNotification({
        title: "Weekly Mission Complete!",
        message: `You completed "${mission.title}". Claim your ${mission.reward.toLocaleString()} pts reward!`,
        type: "reward",
      });
    }
    await AsyncStorage.setItem(KEYS.WEEKLY_MISSIONS, JSON.stringify(missions));
  }
}

// Start (unix ms) of the current week, using the SAME week boundary as
// getWeekNumber() (calendar-year weeks, Sunday-agnostic 7-day buckets from Jan 1)
// so weekly-mission progress and qualified-referral counting stay aligned.
export function getCurrentWeekStartMs(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1).getTime();
  const oneWeek = 604800000;
  const weekIndex = Math.ceil((now.getTime() - start) / oneWeek);
  return start + Math.max(0, weekIndex - 1) * oneWeek;
}

// Set a weekly mission's progress to an absolute, server-derived value (vs the
// increment-based updateWeeklyMissionProgress). Used for "weekly_referrals"
// (Social Butterfly): progress mirrors how many referred friends cashed out $3+
// this week, as reported by the server — never a local guess. Only ever moves
// progress forward so a transient offline read can't undo it.
export async function setWeeklyMissionProgress(missionId: string, value: number): Promise<void> {
  const missions = await getWeeklyMissions();
  const mission = missions.find((m) => m.id === missionId);
  if (!mission) return;
  const clamped = Math.min(Math.max(Math.round(value), 0), mission.target);
  if (clamped <= mission.progress) return;
  mission.progress = clamped;
  if (mission.progress >= mission.target && !mission.completed) {
    mission.completed = true;
    await addNotification({
      title: "Weekly Mission Complete!",
      message: `You completed "${mission.title}". Claim your ${mission.reward.toLocaleString()} pts reward!`,
      type: "reward",
    });
  }
  await AsyncStorage.setItem(KEYS.WEEKLY_MISSIONS, JSON.stringify(missions));
}

// Marks a completed mission as claimed in LOCAL UI state only (flips the card to
// "claimed"). It deliberately does NOT credit the balance: mission rewards are
// now issued server-side via POST /api/missions/claim (earn-client.claimMission),
// which verifies completion from trusted records and adds a real pending token.
// Returns the mission's display-point reward figure (for UI), or 0 if there was
// nothing to claim (already claimed / not completed / not found) — keeping the
// idempotent "claim once" contract.
export async function markMissionClaimed(missionId: string, isWeekly: boolean = false): Promise<number> {
  if (isWeekly) {
    const missions = await getWeeklyMissions();
    const mission = missions.find((m) => m.id === missionId);
    if (mission && mission.completed && !mission.claimed) {
      mission.claimed = true;
      await AsyncStorage.setItem(KEYS.WEEKLY_MISSIONS, JSON.stringify(missions));
      return mission.reward;
    }
  } else {
    const missions = await getDailyMissions();
    const mission = missions.find((m) => m.id === missionId);
    if (mission && mission.completed && !mission.claimed) {
      mission.claimed = true;
      await AsyncStorage.setItem(KEYS.MISSIONS, JSON.stringify(missions));
      return mission.reward;
    }
  }
  return 0;
}

export async function addNotification(notif: Omit<AppNotification, "id" | "read" | "timestamp">): Promise<void> {
  const raw = await AsyncStorage.getItem(KEYS.NOTIFICATIONS);
  const list: AppNotification[] = raw ? JSON.parse(raw) : [];
  list.unshift({
    ...notif,
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    read: false,
    timestamp: Date.now(),
  });
  if (list.length > 50) list.pop();
  await AsyncStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(list));
}

// Merge server notifications (from GET /api/notifications) with locally stored
// ones. Server items are identified by their UUID-shaped ids; local items use
// timestamp-based ids and are generated client-side (e.g. missions, promos).
// The merged list is sorted newest-first. Fails silently — if the server is
// unreachable the function still returns the local-only list.
async function fetchAndMergeServerNotifications(local: AppNotification[]): Promise<AppNotification[]> {
  try {
    const res = await apiRequest("GET", "/api/notifications");
    const data = await res.json();
    const serverItems: AppNotification[] = (data.notifications ?? []).map((n: any) => ({
      id: n.id as string,
      title: n.title as string,
      message: n.message as string,
      type: (n.type ?? "reward") as AppNotification["type"],
      read: !!n.read,
      timestamp: new Date(n.createdAt).getTime(),
    }));
    // Deduplicate: server wins for ids that appear in both lists.
    const serverIds = new Set(serverItems.map((n) => n.id));
    const localOnly = local.filter((n) => !serverIds.has(n.id));
    const merged = [...serverItems, ...localOnly].sort((a, b) => b.timestamp - a.timestamp);
    return merged.slice(0, 100);
  } catch {
    return local;
  }
}

export async function getNotifications(): Promise<AppNotification[]> {
  const raw = await AsyncStorage.getItem(KEYS.NOTIFICATIONS);
  const local: AppNotification[] = raw ? JSON.parse(raw) : [];
  return fetchAndMergeServerNotifications(local);
}

export async function getUnreadNotificationCount(): Promise<number> {
  const notifications = await getNotifications();
  return notifications.filter((n) => !n.read).length;
}

// UUID detection: server notification ids are gen_random_uuid() UUIDs
// (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). Local ids are numeric timestamps
// concatenated with a random suffix. This is the cheapest split without
// storing a separate flag.
function isServerNotificationId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export async function markAllNotificationsRead(): Promise<void> {
  const raw = await AsyncStorage.getItem(KEYS.NOTIFICATIONS);
  const notifications: AppNotification[] = raw ? JSON.parse(raw) : [];
  notifications.forEach((n) => (n.read = true));
  await AsyncStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(notifications));
  apiRequest("POST", "/api/notifications/read-all").catch(() => {});
}

export async function markNotificationRead(id: string): Promise<void> {
  const raw = await AsyncStorage.getItem(KEYS.NOTIFICATIONS);
  const notifications: AppNotification[] = raw ? JSON.parse(raw) : [];
  const notif = notifications.find((n) => n.id === id);
  if (notif) {
    notif.read = true;
    await AsyncStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(notifications));
  }
  if (isServerNotificationId(id)) {
    apiRequest("POST", `/api/notifications/${id}/read`).catch(() => {});
  }
}

export interface Survey {
  id: string;
  title: string;
  provider: string;
  description: string;
  reward: number;
  estimatedMinutes: number;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  questions: SurveyQuestion[];
}

export interface SurveyQuestion {
  id: string;
  text: string;
  type: "multiple_choice" | "rating" | "yes_no";
  options?: string[];
}

export function getAvailableSurveys(): Survey[] {
  return [];
}

export async function getCompletedSurveyIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(KEYS.COMPLETED_SURVEY_IDS);
  return new Set(raw ? JSON.parse(raw) : []);
}

export async function completeSurvey(surveyId: string, title: string): Promise<void> {
  const completedIds = await getCompletedSurveyIds();
  if (completedIds.has(surveyId)) return;
  completedIds.add(surveyId);
  await AsyncStorage.setItem(KEYS.COMPLETED_SURVEY_IDS, JSON.stringify([...completedIds]));

  const surveysCompleted = await getNumber(KEYS.SURVEYS_COMPLETED, 0);
  await setNumber(KEYS.SURVEYS_COMPLETED, surveysCompleted + 1);

  await addNotification({
    title: "Practice Survey Complete",
    message: `You finished "${title}". Complete surveys to earn real cash.`,
    type: "milestone",
  });
}

export async function getSurveyStats(): Promise<{ completed: number; earnings: number }> {
  return {
    completed: await getNumber(KEYS.SURVEYS_COMPLETED, 0),
    earnings: await getNumber(KEYS.SURVEY_EARNINGS, 0),
  };
}

export interface SponsorBrand {
  id: string;
  name: string;
  type: "ads" | "surveys" | "games";
  color: string;
  createdAt: number;
}

const BRAND_COLORS = [
  "#4285F4", "#EA4335", "#FBBC05", "#34A853", "#FF6D00",
  "#AB47BC", "#00ACC1", "#E91E63", "#3F51B5", "#009688",
];

export async function getSponsorBrands(): Promise<SponsorBrand[]> {
  return [];
}

export async function addSponsorBrand(name: string, type: "ads" | "surveys" | "games"): Promise<SponsorBrand> {
  const brand: SponsorBrand = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
    name,
    type,
    color: BRAND_COLORS[0],
    createdAt: Date.now(),
  };
  return brand;
}

export async function removeSponsorBrand(id: string): Promise<void> {
  return;
}

export async function getSponsorBrandsByType(type: "ads" | "surveys" | "games"): Promise<SponsorBrand[]> {
  return [];
}


const GAME_COOLDOWN_KEYS: Record<string, string> = {
  "scratch-card": KEYS.LAST_SCRATCH_DATE,
  "memory-match": KEYS.LAST_MEMORY_DATE,
  "trivia": KEYS.LAST_TRIVIA_DATE,
  "coin-catcher": KEYS.LAST_COIN_CATCHER_DATE,
  "tap-frenzy": KEYS.LAST_TAP_FRENZY_DATE,
  "solitaire": KEYS.LAST_SOLITAIRE_DATE,
  "dominoes": KEYS.LAST_DOMINOES_DATE,
  "tetris": KEYS.LAST_TETRIS_DATE,
  "block-blitz": KEYS.LAST_BLOCK_BLITZ_DATE,
};

// Show an interstitial once every Nth finished game (kept in the 2–3 range so
// it lands roughly every couple of games without nagging on every round).
const GAMES_PER_INTERSTITIAL = 2;

export async function recordGamePlay(
  gameId: string,
  points: number,
  description: string,
  opts: { creditLocally?: boolean } = {},
): Promise<void> {
  // creditLocally defaults to true for legacy local-only games. Server-backed
  // games (e.g. scratch card via /api/earn/game/complete) pass false: the reward
  // is already issued into the server pending wallet, so adding a local optimistic
  // balance here would double-count and show cash the server doesn't know about.
  const { creditLocally = true } = opts;

  const today = new Date().toDateString();
  const cooldownKey = GAME_COOLDOWN_KEYS[gameId];
  if (cooldownKey) {
    await AsyncStorage.setItem(cooldownKey, today);
  }

  const gamesPlayed = await getNumber(KEYS.GAMES_PLAYED, 0);
  await setNumber(KEYS.GAMES_PLAYED, gamesPlayed + 1);

  if (creditLocally) {
    // Games award POINTS (display currency, 10,000 pts = $1), not direct dollars.
    // Mirror the mission pattern: convert points to their dollar-equivalent for
    // the optimistic local balance. The authoritative economy is server-side.
    const dollars = displayPointsToDollars(points);

    const gameEarnings = await getNumber(KEYS.GAME_EARNINGS, 0);
    await setNumber(KEYS.GAME_EARNINGS, gameEarnings + dollars);

    await addEarnings(dollars, description, "game");
  }

  // Interstitials fire at a natural transition (finishing a game) but only once
  // every Nth finished game so they stay non-annoying — not after every single
  // round. maybeShowInterstitial still enforces its own ~4-min frequency cap as
  // a hard floor. Fire-and-forget and lazily imported so it never blocks the
  // reward flow. No-op on web / when AdMob isn't ready.
  const sinceAd = (await getNumber(KEYS.GAMES_SINCE_INTERSTITIAL, 0)) + 1;
  if (sinceAd >= GAMES_PER_INTERSTITIAL) {
    await setNumber(KEYS.GAMES_SINCE_INTERSTITIAL, 0);
    import("./admob")
      .then((m) => m.maybeShowInterstitial())
      .catch(() => {});
  } else {
    await setNumber(KEYS.GAMES_SINCE_INTERSTITIAL, sinceAd);
  }
}

export async function canPlayGame(gameId: string): Promise<boolean> {
  const today = new Date().toDateString();
  const cooldownKey = GAME_COOLDOWN_KEYS[gameId];
  if (!cooldownKey) return true;
  const lastPlayed = await AsyncStorage.getItem(cooldownKey);
  return lastPlayed !== today;
}

export async function getGamesPlayedToday(): Promise<number> {
  const today = new Date().toDateString();
  let count = 0;
  for (const key of Object.values(GAME_COOLDOWN_KEYS)) {
    const lastPlayed = await AsyncStorage.getItem(key);
    if (lastPlayed === today) {
      count++;
    }
  }
  return count;
}

const DAILY_EARNING_CAP = 7.00;

// Client-side UX hint values — these mirror the server's defaults so the
// local pre-checks are consistent with what the server will enforce.
// The authoritative enforcement lives on the server (POST /api/withdrawals):
//   hold  → user.createdAt from DB vs NEW_ACCOUNT_HOLD_HOURS (default 48 h)
//   cap   → DB count of today's withdrawals vs MAX_WITHDRAWALS_PER_DAY (default 2)
// Clearing local storage or reinstalling bypasses these hints; it does NOT
// bypass the server. Keep these in sync with server defaults when they change.
const WITHDRAWAL_HOLD_DAYS = 2;       // matches NEW_ACCOUNT_HOLD_HOURS = 48 h
const MAX_DAILY_WITHDRAWALS = 2;      // matches MAX_WITHDRAWALS_PER_DAY = 2
const SUSPICIOUS_EARNING_RATE = 5.00;

export async function ensureAccountCreated(): Promise<void> {
  const created = await AsyncStorage.getItem(KEYS.ACCOUNT_CREATED);
  if (!created) {
    await AsyncStorage.setItem(KEYS.ACCOUNT_CREATED, Date.now().toString());
  }
}

export async function getAccountAge(): Promise<number> {
  const created = await AsyncStorage.getItem(KEYS.ACCOUNT_CREATED);
  if (!created) {
    await ensureAccountCreated();
    return 0;
  }
  return Math.floor((Date.now() - parseInt(created)) / (1000 * 60 * 60 * 24));
}

export async function getDailyEarnings(): Promise<number> {
  const today = new Date().toDateString();
  const savedDate = await AsyncStorage.getItem(KEYS.DAILY_EARNINGS_DATE);
  if (savedDate !== today) {
    await AsyncStorage.setItem(KEYS.DAILY_EARNINGS_DATE, today);
    await setNumber(KEYS.DAILY_EARNINGS, 0);
    return 0;
  }
  return getNumber(KEYS.DAILY_EARNINGS, 0);
}

export async function trackDailyEarning(amount: number): Promise<void> {
  const today = new Date().toDateString();
  const savedDate = await AsyncStorage.getItem(KEYS.DAILY_EARNINGS_DATE);
  if (savedDate !== today) {
    await AsyncStorage.setItem(KEYS.DAILY_EARNINGS_DATE, today);
    await setNumber(KEYS.DAILY_EARNINGS, amount);
  } else {
    const current = await getNumber(KEYS.DAILY_EARNINGS, 0);
    await setNumber(KEYS.DAILY_EARNINGS, current + amount);
  }
}

export async function canEarnMore(): Promise<{ allowed: boolean; reason?: string }> {
  const dailyEarnings = await getDailyEarnings();
  if (dailyEarnings >= DAILY_EARNING_CAP) {
    return { allowed: false, reason: "daily_cap" };
  }
  return { allowed: true };
}

// Client-side UX pre-check for withdrawal eligibility. Used as a fast local
// hint to surface hold/cap messages before the request even reaches the server.
// IMPORTANT: this is NOT the security enforcement — the server re-checks both
// rules authoritatively on every POST /api/withdrawals request.
//
// Limitations of the local check:
//   • Hold check: ACCOUNT_CREATED in AsyncStorage is set the first time the
//     user earns something (via ensureAccountCreated), NOT the actual DB
//     registration time. Reinstalling the app resets it, so a long-time user
//     who reinstalls may be shown a false "hold" warning that the server won't
//     enforce. Treat this branch as advisory only.
//   • Daily cap: more reliable — recordWithdrawalAttempt() is called after
//     every successful withdrawal, so the local count stays in sync unless the
//     app is reinstalled.
export async function canWithdraw(): Promise<{ allowed: boolean; reason?: string }> {
  const accountAge = await getAccountAge();
  if (accountAge < WITHDRAWAL_HOLD_DAYS) {
    const daysLeft = WITHDRAWAL_HOLD_DAYS - accountAge;
    return { allowed: false, reason: `hold_period:${daysLeft}` };
  }

  const today = new Date().toDateString();
  const lastWithdrawalDate = await AsyncStorage.getItem(KEYS.LAST_WITHDRAWAL_DATE);
  if (lastWithdrawalDate === today) {
    const withdrawalCount = await getNumber(KEYS.WITHDRAWAL_COUNT, 0);
    if (withdrawalCount >= MAX_DAILY_WITHDRAWALS) {
      return { allowed: false, reason: "daily_limit" };
    }
  }

  return { allowed: true };
}

export async function recordWithdrawalAttempt(): Promise<void> {
  const today = new Date().toDateString();
  const lastDate = await AsyncStorage.getItem(KEYS.LAST_WITHDRAWAL_DATE);
  if (lastDate !== today) {
    await AsyncStorage.setItem(KEYS.LAST_WITHDRAWAL_DATE, today);
    await setNumber(KEYS.WITHDRAWAL_COUNT, 1);
  } else {
    const count = await getNumber(KEYS.WITHDRAWAL_COUNT, 0);
    await setNumber(KEYS.WITHDRAWAL_COUNT, count + 1);
  }
}

export interface FraudFlag {
  id: string;
  type: "rapid_earning" | "excessive_ads" | "suspicious_pattern";
  description: string;
  timestamp: number;
}

export async function getFraudFlags(): Promise<FraudFlag[]> {
  return [];
}

export async function addFraudFlag(_type: FraudFlag["type"], _description: string): Promise<void> {
}

export async function checkForSuspiciousActivity(): Promise<boolean> {
  return false;
}

async function getHoursActiveToday(): Promise<number> {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(1, (Date.now() - startOfDay.getTime()) / (1000 * 60 * 60));
}

export async function getSecuritySettings(): Promise<{ pinEnabled: boolean; biometricEnabled: boolean; hasPin: boolean }> {
  const pinEnabled = (await secureGet(KEYS.PIN_ENABLED)) === "true";
  const biometricEnabled = (await secureGet(KEYS.BIOMETRIC_ENABLED)) === "true";
  const hasPin = !!(await secureGet(KEYS.APP_PIN));
  return { pinEnabled, biometricEnabled, hasPin };
}

export async function setAppPin(pin: string): Promise<void> {
  await secureSet(KEYS.APP_PIN, pin);
  await secureSet(KEYS.PIN_ENABLED, "true");
}

export async function verifyPin(pin: string): Promise<boolean> {
  const savedPin = await secureGet(KEYS.APP_PIN);
  return savedPin === pin;
}

export async function removeAppPin(): Promise<void> {
  await secureDelete(KEYS.APP_PIN);
  await secureSet(KEYS.PIN_ENABLED, "false");
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await secureSet(KEYS.BIOMETRIC_ENABLED, enabled ? "true" : "false");
}

export function getFraudProtectionConfig() {
  return {
    dailyEarningCap: DAILY_EARNING_CAP,
    withdrawalHoldDays: WITHDRAWAL_HOLD_DAYS,
    maxDailyWithdrawals: MAX_DAILY_WITHDRAWALS,
    suspiciousEarningRate: SUSPICIOUS_EARNING_RATE,
  };
}
