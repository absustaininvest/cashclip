/**
 * Integration tests: fetchConversionRate and hydrateDisplayRate
 *
 * These tests verify that a server-provided displayPointsPerDollar rate flows
 * through the full fetch→persist→hydrate path and that every display surface
 * (dollarsToPoints, displayPointsToDollars, and profile lifetime points) reads
 * the active rate — not the hardcoded default — after a rate change.
 *
 * The network layer and AsyncStorage are mocked so the tests run offline in
 * any environment. The runtime display-rate variable (module-level state in
 * points.ts) is reset after each test to prevent bleed between cases.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

// ── Mock AsyncStorage before importing the module under test ──────────────────
// Keeps an in-memory map that behaves like real AsyncStorage. Declared here so
// tests can inspect its contents via `mockStorage` directly.
const mockStorage: Record<string, string> = {};

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem:    vi.fn(async (key: string) => mockStorage[key] ?? null),
    setItem:    vi.fn(async (key: string, value: string) => { mockStorage[key] = value; }),
    removeItem: vi.fn(async (key: string) => { delete mockStorage[key]; }),
  },
}));

// ── Mock the network layer so no real HTTP calls are made ─────────────────────
const mockApiRequest = vi.fn();
vi.mock("./query-client", () => ({
  apiRequest:     (...args: unknown[]) => mockApiRequest(...args),
  apiRequestSafe: (...args: unknown[]) => mockApiRequest(...args),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchConversionRate, hydrateDisplayRate } from "./earn-client";
import {
  DISPLAY_POINTS_PER_DOLLAR,
  getDisplayPointsPerDollar,
  setDisplayPointsPerDollar,
  dollarsToPoints,
  displayPointsToDollars,
} from "./points";

// Reset module-level state and mocks after every test.
afterEach(() => {
  setDisplayPointsPerDollar(DISPLAY_POINTS_PER_DOLLAR);
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  mockApiRequest.mockReset();
  vi.mocked(AsyncStorage.getItem).mockRestore?.();
  vi.mocked(AsyncStorage.getItem).mockImplementation(
    async (key: string) => mockStorage[key] ?? null,
  );
});

// Helper: build a fake successful /api/economy/rate response.
function rateResponse(displayPointsPerDollar: number | null, usdPerPoint = 0.0001) {
  return {
    ok: true,
    json: async () => ({
      usdPerPoint,
      floorUsdPerPoint: 0.0002,
      legacyUsdPerPoint: 0.001,
      pointsPerDollar: usdPerPoint > 0 ? Math.round(1 / usdPerPoint) : null,
      displayPointsPerDollar,
      method: "arpu",
      region: "GLOBAL",
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchConversionRate — server rate propagates to all display surfaces
// ─────────────────────────────────────────────────────────────────────────────
describe("fetchConversionRate — server rate propagates to all display surfaces", () => {
  it("applies a non-default displayPointsPerDollar to the runtime rate", async () => {
    const serverRate = 20000;
    mockApiRequest.mockResolvedValueOnce(rateResponse(serverRate));

    const result = await fetchConversionRate();

    expect(result).not.toBeNull();
    expect(result!.displayPointsPerDollar).toBe(serverRate);
    expect(getDisplayPointsPerDollar()).toBe(serverRate);
  });

  it("dollarsToPoints reflects the server rate after fetch", async () => {
    const serverRate = 20000;
    mockApiRequest.mockResolvedValueOnce(rateResponse(serverRate));
    await fetchConversionRate();

    expect(dollarsToPoints(1)).toBe(serverRate);
    expect(dollarsToPoints(0.5)).toBe(serverRate / 2);
    expect(dollarsToPoints(0.1)).toBe(serverRate / 10);
  });

  it("displayPointsToDollars reflects the server rate after fetch", async () => {
    const serverRate = 20000;
    mockApiRequest.mockResolvedValueOnce(rateResponse(serverRate));
    await fetchConversionRate();

    expect(displayPointsToDollars(serverRate)).toBe(1);
    expect(displayPointsToDollars(serverRate / 2)).toBe(0.5);
  });

  it("profile lifetime display points scale with the server rate", async () => {
    // The profile screen converts totalEarned (USD) → display points via
    // dollarsToPoints. At the default rate $2.50 → 25,000 pts; at a server
    // rate of 25,000 pts/$ it should become 62,500.
    const serverRate = 25000;
    mockApiRequest.mockResolvedValueOnce(rateResponse(serverRate));
    await fetchConversionRate();

    const totalEarnedUsd = 2.5;
    expect(dollarsToPoints(totalEarnedUsd)).toBe(totalEarnedUsd * serverRate);
  });

  it("persists the server rate to AsyncStorage for cold-start hydration", async () => {
    const serverRate = 15000;
    mockApiRequest.mockResolvedValueOnce(rateResponse(serverRate));
    await fetchConversionRate();

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "cashclip_display_points_per_dollar",
      String(serverRate),
    );
    expect(mockStorage["cashclip_display_points_per_dollar"]).toBe(String(serverRate));
  });

  it("ignores null displayPointsPerDollar and keeps the previously active rate", async () => {
    setDisplayPointsPerDollar(12000);
    mockApiRequest.mockResolvedValueOnce(rateResponse(null));

    const result = await fetchConversionRate();
    expect(result!.displayPointsPerDollar).toBeNull();
    // The previously active rate must NOT be clobbered.
    expect(getDisplayPointsPerDollar()).toBe(12000);
  });

  it("returns null and leaves the rate unchanged when the API responds not-ok", async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: false });
    const result = await fetchConversionRate();
    expect(result).toBeNull();
    expect(getDisplayPointsPerDollar()).toBe(DISPLAY_POINTS_PER_DOLLAR);
  });

  it("returns null and leaves the rate unchanged when the network throws", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("network error"));
    const result = await fetchConversionRate();
    expect(result).toBeNull();
    expect(getDisplayPointsPerDollar()).toBe(DISPLAY_POINTS_PER_DOLLAR);
  });

  it("round-trips: displayPointsToDollars(dollarsToPoints(x)) ≈ x at the server rate", async () => {
    const serverRate = 18000;
    mockApiRequest.mockResolvedValueOnce(rateResponse(serverRate));
    await fetchConversionRate();

    for (const dollars of [0.05, 0.1, 0.5, 1, 2.5]) {
      expect(displayPointsToDollars(dollarsToPoints(dollars))).toBeCloseTo(dollars, 10);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hydrateDisplayRate — cold-start hydration and offline fallback
// ─────────────────────────────────────────────────────────────────────────────
describe("hydrateDisplayRate — cold-start and offline fallback", () => {
  it("applies a stored rate so displays match the last online session", async () => {
    mockStorage["cashclip_display_points_per_dollar"] = "18000";
    await hydrateDisplayRate();

    expect(getDisplayPointsPerDollar()).toBe(18000);
    expect(dollarsToPoints(1)).toBe(18000);
    expect(displayPointsToDollars(18000)).toBe(1);
  });

  it("falls back to the hardcoded default when nothing is stored (first install)", async () => {
    await hydrateDisplayRate();
    expect(getDisplayPointsPerDollar()).toBe(DISPLAY_POINTS_PER_DOLLAR);
  });

  it("ignores a stored value of zero and keeps the hardcoded default", async () => {
    mockStorage["cashclip_display_points_per_dollar"] = "0";
    await hydrateDisplayRate();
    // setDisplayPointsPerDollar rejects 0 → default must stay.
    expect(getDisplayPointsPerDollar()).toBe(DISPLAY_POINTS_PER_DOLLAR);
  });

  it("ignores a stored negative value and keeps the hardcoded default", async () => {
    mockStorage["cashclip_display_points_per_dollar"] = "-5000";
    await hydrateDisplayRate();
    expect(getDisplayPointsPerDollar()).toBe(DISPLAY_POINTS_PER_DOLLAR);
  });

  it("falls back gracefully when AsyncStorage.getItem throws", async () => {
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(hydrateDisplayRate()).resolves.toBeUndefined();
    expect(getDisplayPointsPerDollar()).toBe(DISPLAY_POINTS_PER_DOLLAR);
  });

  it("hydrate then fetch: later server rate overwrites the stored rate", async () => {
    mockStorage["cashclip_display_points_per_dollar"] = "14000";
    await hydrateDisplayRate();
    expect(getDisplayPointsPerDollar()).toBe(14000);

    const serverRate = 22000;
    mockApiRequest.mockResolvedValueOnce(rateResponse(serverRate));
    await fetchConversionRate();
    expect(getDisplayPointsPerDollar()).toBe(serverRate);
    expect(dollarsToPoints(1)).toBe(serverRate);
  });
});
