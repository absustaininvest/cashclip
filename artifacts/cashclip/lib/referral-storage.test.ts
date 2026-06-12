import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory AsyncStorage so storage helpers run under Node without React Native.
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

// storage.ts imports query-client which imports react-native (Flow syntax that
// Vite/Rollup cannot parse in node test mode). Stub the whole module out since
// none of the referral-storage helpers exercise network calls.
vi.mock("./query-client", () => ({
  apiRequest: vi.fn(async () => ({})),
  apiRequestSafe: vi.fn(async () => null),
}));

// storage.ts lazy-imports admob inside recordGamePlay; stub it so the module
// loads cleanly even though no ad functions are exercised here.
vi.mock("./admob", () => ({ maybeShowInterstitial: vi.fn(async () => {}) }));

import {
  getSeenQualifiedReferrals,
  setSeenQualifiedReferrals,
} from "./storage";

const QUALIFIED_KEY = "cashclip_qualified_referrals";

beforeEach(() => {
  store.clear();
});

describe("getSeenQualifiedReferrals", () => {
  it("returns 0 when nothing has been stored yet", async () => {
    expect(store.has(QUALIFIED_KEY)).toBe(false);
    const result = await getSeenQualifiedReferrals();
    expect(result).toBe(0);
  });

  it("returns the previously stored integer count", async () => {
    store.set(QUALIFIED_KEY, "5");
    const result = await getSeenQualifiedReferrals();
    expect(result).toBe(5);
  });

  it("returns 0 for a stored value of '0'", async () => {
    store.set(QUALIFIED_KEY, "0");
    expect(await getSeenQualifiedReferrals()).toBe(0);
  });
});

describe("setSeenQualifiedReferrals", () => {
  it("persists a positive integer and reads it back correctly", async () => {
    await setSeenQualifiedReferrals(3);
    expect(store.get(QUALIFIED_KEY)).toBe("3");
    expect(await getSeenQualifiedReferrals()).toBe(3);
  });

  it("overwrites a previous value with a new count", async () => {
    await setSeenQualifiedReferrals(2);
    await setSeenQualifiedReferrals(7);
    expect(await getSeenQualifiedReferrals()).toBe(7);
  });

  it("clamps negative inputs to 0 (no negative seen-counts)", async () => {
    await setSeenQualifiedReferrals(-3);
    expect(await getSeenQualifiedReferrals()).toBe(0);
  });

  it("rounds float inputs to the nearest integer", async () => {
    await setSeenQualifiedReferrals(2.9);
    expect(await getSeenQualifiedReferrals()).toBe(3);

    await setSeenQualifiedReferrals(4.1);
    expect(await getSeenQualifiedReferrals()).toBe(4);
  });

  it("round-trip: set then get returns the same value", async () => {
    for (const n of [0, 1, 10, 100]) {
      await setSeenQualifiedReferrals(n);
      expect(await getSeenQualifiedReferrals()).toBe(n);
    }
  });
});
