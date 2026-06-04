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
  claimMissionReward,
  recordGamePlay,
  getUserStats,
  getDailyMissions,
} from "./storage";
import { displayPointsToDollars } from "./points";

const BALANCE_KEY = "cashclip_balance";
const GAME_EARNINGS_KEY = "cashclip_game_earnings";
const MISSIONS_KEY = "cashclip_missions";
const MISSIONS_DATE_KEY = "cashclip_missions_date";

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
describe("mission reward stored in display points credits the right local dollars", () => {
  it("credits a claimed daily mission's display-point reward as its dollar-equivalent", async () => {
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

    const returnedPoints = await claimMissionReward("daily_checkin", false);

    // claimMissionReward returns the DISPLAY points figure...
    expect(returnedPoints).toBe(1000);
    // ...but the local cash balance moves by the dollar-equivalent (1000 / 10000 = $0.10).
    expect(await getBalance()).toBeCloseTo(displayPointsToDollars(1000), 10);
    expect(await getBalance()).toBeCloseTo(0.1, 10);
  });

  it("does not credit a mission that is not completed", async () => {
    const today = new Date().toDateString();
    const missions = await getDailyMissions();
    const target = missions.find((m) => m.id === "daily_checkin")!;
    target.reward = 1000;
    target.completed = false;
    target.claimed = false;
    store.set(MISSIONS_DATE_KEY, today);
    store.set(MISSIONS_KEY, JSON.stringify(missions));

    const returnedPoints = await claimMissionReward("daily_checkin", false);
    expect(returnedPoints).toBe(0);
    expect(await getBalance()).toBe(0);
  });

  it("is idempotent — claiming twice only credits once", async () => {
    const today = new Date().toDateString();
    const missions = await getDailyMissions();
    const target = missions.find((m) => m.id === "watch_ads")!;
    target.reward = 1500;
    target.completed = true;
    target.claimed = false;
    store.set(MISSIONS_DATE_KEY, today);
    store.set(MISSIONS_KEY, JSON.stringify(missions));

    const first = await claimMissionReward("watch_ads", false);
    const second = await claimMissionReward("watch_ads", false);

    expect(first).toBe(1500);
    expect(second).toBe(0);
    expect(await getBalance()).toBeCloseTo(displayPointsToDollars(1500), 10);
    expect(await getBalance()).toBeCloseTo(0.15, 10);
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
