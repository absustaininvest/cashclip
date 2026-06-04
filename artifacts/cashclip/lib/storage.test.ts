import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory AsyncStorage stand-in so storage.ts (and the secure-store wrapper it
// pulls in) can run under Node without React Native. Mocked before importing
// storage so every consumer resolves to this single backing store.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
    multiRemove: async (keys: string[]) => {
      keys.forEach((k) => store.delete(k));
    },
  },
}));

// recordGamePlay fires a frequency-capped interstitial via a lazy import("./admob").
// Stub it so the test never reaches real AdMob native code.
vi.mock("./admob", () => ({ maybeShowInterstitial: vi.fn(async () => {}) }));

import {
  markMissionClaimed,
  recordGamePlay,
  getUserStats,
  getDailyMissions,
  getWithdrawalTiers,
  withdraw,
  getTransactions,
  canWithdraw,
  recordWithdrawalAttempt,
  getFraudProtectionConfig,
} from "./storage";
import { displayPointsToDollars } from "./points";

const BALANCE_KEY = "cashclip_balance";
const GAME_EARNINGS_KEY = "cashclip_game_earnings";
const MISSIONS_KEY = "cashclip_missions";
const MISSIONS_DATE_KEY = "cashclip_missions_date";
const TRANSACTIONS_KEY = "cashclip_transactions";

async function setBalance(dollars: number): Promise<void> {
  store.set(BALANCE_KEY, dollars.toString());
}

async function getBalance(): Promise<number> {
  return (await getUserStats()).balance;
}

beforeEach(() => {
  store.clear();
});

// These tests document the load-bearing contract between the two economies:
// mission and game rewards are authored and stored in DISPLAY points (10,000/$),
// but the optimistic local dollar balance must be credited via displayPointsToDollars
// — NOT the cash adapter. If someone swaps the adapter, the dollar amounts below
// move by 10x and these tests fail.
describe("marking a mission claimed flips local UI state without crediting the balance", () => {
  it("flips a completed daily mission to claimed but never moves the local balance", async () => {
    // Seed today's missions with a completed-but-unclaimed mission worth 1000 display pts.
    const today = new Date().toDateString();
    const missions = await getDailyMissions();
    const target = missions.find((m) => m.id === "daily_checkin")!;
    target.reward = 1000;
    target.completed = true;
    target.claimed = false;
    store.set(MISSIONS_DATE_KEY, today);
    store.set(MISSIONS_KEY, JSON.stringify(missions));

    expect(await getBalance()).toBe(0);

    const returnedPoints = await markMissionClaimed("daily_checkin", false);

    // It returns the DISPLAY points figure for the UI...
    expect(returnedPoints).toBe(1000);
    // ...but the balance is server-authoritative now, so the local mark must NOT
    // move it. Real credit arrives via POST /api/missions/claim (a pending token).
    expect(await getBalance()).toBe(0);
    // The card is flipped to claimed in local storage.
    const after = await getDailyMissions();
    expect(after.find((m) => m.id === "daily_checkin")!.claimed).toBe(true);
  });

  it("does not flip a mission that is not completed", async () => {
    const today = new Date().toDateString();
    const missions = await getDailyMissions();
    const target = missions.find((m) => m.id === "daily_checkin")!;
    target.reward = 1000;
    target.completed = false;
    target.claimed = false;
    store.set(MISSIONS_DATE_KEY, today);
    store.set(MISSIONS_KEY, JSON.stringify(missions));

    const returnedPoints = await markMissionClaimed("daily_checkin", false);
    expect(returnedPoints).toBe(0);
    expect(await getBalance()).toBe(0);
    const after = await getDailyMissions();
    expect(after.find((m) => m.id === "daily_checkin")!.claimed).toBe(false);
  });

  it("is idempotent — marking twice flips once and never credits", async () => {
    const today = new Date().toDateString();
    const missions = await getDailyMissions();
    const target = missions.find((m) => m.id === "watch_ads")!;
    target.reward = 1500;
    target.completed = true;
    target.claimed = false;
    store.set(MISSIONS_DATE_KEY, today);
    store.set(MISSIONS_KEY, JSON.stringify(missions));

    const first = await markMissionClaimed("watch_ads", false);
    const second = await markMissionClaimed("watch_ads", false);

    expect(first).toBe(1500);
    expect(second).toBe(0);
    // No local crediting in either call.
    expect(await getBalance()).toBe(0);
  });
});

describe("game reward stored in display points credits the right local dollars", () => {
  it("credits a game's display-point reward as its dollar-equivalent in balance and game earnings", async () => {
    await recordGamePlay("trivia", 5000, "Trivia reward");

    const expectedDollars = displayPointsToDollars(5000); // 5000 / 10000 = $0.50
    expect(expectedDollars).toBeCloseTo(0.5, 10);
    expect(await getBalance()).toBeCloseTo(expectedDollars, 10);

    const gameEarnings = parseFloat(store.get(GAME_EARNINGS_KEY)!);
    expect(gameEarnings).toBeCloseTo(expectedDollars, 10);
  });

  it("accumulates across multiple game plays", async () => {
    await recordGamePlay("trivia", 5000, "Trivia reward");
    await recordGamePlay("memory", 2500, "Memory reward");

    const expectedDollars = displayPointsToDollars(5000) + displayPointsToDollars(2500);
    expect(expectedDollars).toBeCloseTo(0.75, 10);
    expect(await getBalance()).toBeCloseTo(expectedDollars, 10);
    expect(parseFloat(store.get(GAME_EARNINGS_KEY)!)).toBeCloseTo(expectedDollars, 10);
  });
});

// getWithdrawalTiers gates which cash-out amounts the user is offered. A balance
// must fully cover a tier's amount for it to appear, and the bonus/total math
// must be exact — these are the numbers the payout screen shows and acts on.
describe("getWithdrawalTiers only offers affordable tiers and computes payout math", () => {
  it("offers no tiers when the balance is below the $3 minimum", () => {
    expect(getWithdrawalTiers(0)).toEqual([]);
    expect(getWithdrawalTiers(2.99)).toEqual([]);
  });

  it("offers only the $3 tier at exactly the minimum balance", () => {
    const tiers = getWithdrawalTiers(3);
    expect(tiers.map((t) => t.amount)).toEqual([3]);
  });

  it("offers tiers up to but not beyond what the balance can afford", () => {
    expect(getWithdrawalTiers(4.99).map((t) => t.amount)).toEqual([3]);
    expect(getWithdrawalTiers(5).map((t) => t.amount)).toEqual([3, 5]);
    expect(getWithdrawalTiers(6.5).map((t) => t.amount)).toEqual([3, 5]);
    expect(getWithdrawalTiers(7).map((t) => t.amount)).toEqual([3, 5, 7]);
    expect(getWithdrawalTiers(100).map((t) => t.amount)).toEqual([3, 5, 7]);
  });

  it("computes a zero bonus and a total equal to the amount when bonusPercent is 0", () => {
    for (const tier of getWithdrawalTiers(100)) {
      expect(tier.bonusPercent).toBe(0);
      expect(tier.bonusAmount).toBe(0);
      expect(tier.totalPayout).toBe(tier.amount);
    }
  });
});

// withdraw moves a real-dollar balance, so the floor ($3), ceiling (balance),
// deduction, and recorded transactions all have to be exactly right.
describe("withdraw enforces limits, deducts the balance, and records transactions", () => {
  it("rejects an amount below the $3 minimum without touching the balance", async () => {
    await setBalance(10);
    expect(await withdraw(2.99)).toBe(false);
    expect(await getBalance()).toBe(10);
    expect(await getTransactions()).toEqual([]);
  });

  it("rejects an amount greater than the balance without touching the balance", async () => {
    await setBalance(5);
    expect(await withdraw(7)).toBe(false);
    expect(await getBalance()).toBe(5);
    expect(await getTransactions()).toEqual([]);
  });

  it("allows withdrawing exactly the $3 minimum", async () => {
    await setBalance(3);
    expect(await withdraw(3)).toBe(true);
    expect(await getBalance()).toBe(0);
  });

  it("allows withdrawing the entire balance", async () => {
    await setBalance(7);
    expect(await withdraw(7)).toBe(true);
    expect(await getBalance()).toBe(0);
  });

  it("deducts the withdrawn amount and records a negative 'withdrawn' transaction", async () => {
    await setBalance(10);
    expect(await withdraw(7)).toBe(true);
    expect(await getBalance()).toBeCloseTo(3, 10);

    const txns = await getTransactions();
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe("withdrawn");
    expect(txns[0].amount).toBe(-7);
    expect(txns[0].description).toBe("Withdrawal $7.00");
  });

  it("records a separate 'bonus' transaction when a bonus percent applies, without crediting it to the deducted balance", async () => {
    await setBalance(10);
    expect(await withdraw(5, 10)).toBe(true);
    // Only the withdrawn amount leaves the balance; the bonus is a payout-side
    // figure, not a credit back to the local balance.
    expect(await getBalance()).toBeCloseTo(5, 10);

    const txns = await getTransactions();
    expect(txns).toHaveLength(2);
    const withdrawnTx = txns.find((t) => t.type === "withdrawn")!;
    const bonusTx = txns.find((t) => t.type === "bonus")!;
    expect(withdrawnTx.amount).toBe(-5);
    expect(bonusTx.amount).toBeCloseTo(0.5, 10);
    expect(bonusTx.description).toBe("Cashout bonus (+10%)");
  });

  it("does not record a bonus transaction when the bonus rounds to zero", async () => {
    await setBalance(10);
    expect(await withdraw(3, 0)).toBe(true);
    const txns = await getTransactions();
    expect(txns).toHaveLength(1);
    expect(txns.some((t) => t.type === "bonus")).toBe(false);
  });
});

// These are the anti-abuse guards that decide whether a cash-out is even allowed
// to start: a multi-day new-account hold and a per-day withdrawal-count cap. They
// are enforced by canWithdraw() reading the account-creation timestamp and the
// per-day withdrawal counter that recordWithdrawalAttempt() maintains. A silent
// break here lets an abusive account cash out before the hold ends or more often
// than the daily cap allows, so each branch is pinned below.
const ACCOUNT_CREATED_KEY = "cashclip_account_created";
const WITHDRAWAL_COUNT_KEY = "cashclip_withdrawal_count";
const LAST_WITHDRAWAL_DATE_KEY = "cashclip_last_withdrawal_date";

const DAY_MS = 1000 * 60 * 60 * 24;

// Pin the account's creation timestamp so getAccountAge() returns exactly
// `ageDays` whole days. We back-date by a few extra hours so floor() can't land
// a hair short of the intended day boundary.
function setAccountAgeDays(ageDays: number): void {
  store.set(ACCOUNT_CREATED_KEY, (Date.now() - ageDays * DAY_MS - 60 * 60 * 1000).toString());
}

const { withdrawalHoldDays: HOLD_DAYS, maxDailyWithdrawals: MAX_DAILY } = getFraudProtectionConfig();

describe("canWithdraw enforces the new-account hold period", () => {
  it("denies a brand-new account (age 0) until the hold elapses", async () => {
    setAccountAgeDays(0);
    const result = await canWithdraw();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(`hold_period:${HOLD_DAYS}`);
  });

  it("denies an account one day short of the hold and reports the days left", async () => {
    setAccountAgeDays(HOLD_DAYS - 1);
    const result = await canWithdraw();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("hold_period:1");
  });

  it("allows an account exactly at the hold boundary", async () => {
    setAccountAgeDays(HOLD_DAYS);
    const result = await canWithdraw();
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("allows an account well past the hold", async () => {
    setAccountAgeDays(HOLD_DAYS + 30);
    expect((await canWithdraw()).allowed).toBe(true);
  });
});

describe("canWithdraw enforces the daily withdrawal-count cap", () => {
  it("allows a withdrawal when no withdrawals have happened today", async () => {
    setAccountAgeDays(HOLD_DAYS + 1);
    expect((await canWithdraw()).allowed).toBe(true);
  });

  it("denies once today's withdrawal count has reached the cap", async () => {
    setAccountAgeDays(HOLD_DAYS + 1);
    store.set(LAST_WITHDRAWAL_DATE_KEY, new Date().toDateString());
    store.set(WITHDRAWAL_COUNT_KEY, MAX_DAILY.toString());

    const result = await canWithdraw();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily_limit");
  });

  it("resets the cap on a new day even if yesterday hit the limit", async () => {
    setAccountAgeDays(HOLD_DAYS + 1);
    const yesterday = new Date(Date.now() - DAY_MS).toDateString();
    store.set(LAST_WITHDRAWAL_DATE_KEY, yesterday);
    store.set(WITHDRAWAL_COUNT_KEY, MAX_DAILY.toString());

    expect((await canWithdraw()).allowed).toBe(true);
  });

  it("denies only after recordWithdrawalAttempt pushes today's count to the cap", async () => {
    setAccountAgeDays(HOLD_DAYS + 1);

    // Before any attempt today, withdrawal is allowed.
    expect((await canWithdraw()).allowed).toBe(true);

    // Record attempts up to the cap; the last one should flip eligibility off.
    for (let i = 0; i < MAX_DAILY; i++) {
      await recordWithdrawalAttempt();
    }

    expect(store.get(WITHDRAWAL_COUNT_KEY)).toBe(MAX_DAILY.toString());
    expect(store.get(LAST_WITHDRAWAL_DATE_KEY)).toBe(new Date().toDateString());

    const result = await canWithdraw();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily_limit");
  });

  it("the hold check takes precedence over the daily cap for a new account", async () => {
    // Even with no withdrawals today, a too-new account is held first.
    setAccountAgeDays(0);
    store.set(LAST_WITHDRAWAL_DATE_KEY, new Date().toDateString());
    store.set(WITHDRAWAL_COUNT_KEY, MAX_DAILY.toString());

    const result = await canWithdraw();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(`hold_period:${HOLD_DAYS}`);
  });
});

describe("recordWithdrawalAttempt maintains the per-day counter", () => {
  it("starts the count at 1 on the first attempt of a day", async () => {
    await recordWithdrawalAttempt();
    expect(store.get(WITHDRAWAL_COUNT_KEY)).toBe("1");
    expect(store.get(LAST_WITHDRAWAL_DATE_KEY)).toBe(new Date().toDateString());
  });

  it("increments the count on repeated same-day attempts", async () => {
    await recordWithdrawalAttempt();
    await recordWithdrawalAttempt();
    expect(store.get(WITHDRAWAL_COUNT_KEY)).toBe("2");
  });

  it("resets the count to 1 when the day rolls over", async () => {
    const yesterday = new Date(Date.now() - DAY_MS).toDateString();
    store.set(LAST_WITHDRAWAL_DATE_KEY, yesterday);
    store.set(WITHDRAWAL_COUNT_KEY, "5");

    await recordWithdrawalAttempt();

    expect(store.get(WITHDRAWAL_COUNT_KEY)).toBe("1");
    expect(store.get(LAST_WITHDRAWAL_DATE_KEY)).toBe(new Date().toDateString());
  });
});
