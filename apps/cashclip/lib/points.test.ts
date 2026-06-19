import { describe, it, expect, afterEach } from "vitest";
import {
  DISPLAY_POINTS_PER_DOLLAR,
  CASH_POINTS_PER_DOLLAR,
  POINTS_PER_DOLLAR,
  dollarsToPoints,
  displayPointsToDollars,
  pointsToUsd,
  formatPoints,
  getDisplayPointsPerDollar,
  setDisplayPointsPerDollar,
} from "./points";

// These tests pin the two intentionally-separate points-per-dollar rates and the
// adapters built on them. The 10x gap between the DISPLAY economy (what users see)
// and the CASH economy (real money owed) is deliberate — collapsing it, or swapping
// a display adapter for the cash adapter on a surface, reintroduces the mispricing
// footgun points.ts exists to prevent. If any of these values change, that change
// must be intentional and owner-approved.

describe("points-per-dollar constants", () => {
  it("pins the DISPLAY rate at 10,000 pts = $1", () => {
    expect(DISPLAY_POINTS_PER_DOLLAR).toBe(10000);
  });

  it("pins the CASH rate at 1,000 pts = $1", () => {
    expect(CASH_POINTS_PER_DOLLAR).toBe(1000);
  });

  it("keeps the display rate exactly 10x the cash rate", () => {
    expect(DISPLAY_POINTS_PER_DOLLAR).toBe(CASH_POINTS_PER_DOLLAR * 10);
  });

  it("keeps the POINTS_PER_DOLLAR back-compat alias bound to the cash rate", () => {
    expect(POINTS_PER_DOLLAR).toBe(CASH_POINTS_PER_DOLLAR);
  });
});

describe("server-provided display rate (getDisplayPointsPerDollar/setDisplayPointsPerDollar)", () => {
  // The display rate is now owner-tunable from the server. The adapters must
  // read the active value so every surface stays consistent, with the hardcoded
  // default as a graceful offline fallback. Reset to the default after each test
  // so the runtime override doesn't leak into the other suites in this file.
  afterEach(() => {
    setDisplayPointsPerDollar(DISPLAY_POINTS_PER_DOLLAR);
  });

  it("defaults to the hardcoded display rate before any server value loads", () => {
    expect(getDisplayPointsPerDollar()).toBe(DISPLAY_POINTS_PER_DOLLAR);
  });

  it("applies a valid server-provided rate to the display adapters", () => {
    setDisplayPointsPerDollar(20000);
    expect(getDisplayPointsPerDollar()).toBe(20000);
    expect(dollarsToPoints(1)).toBe(20000);
    expect(displayPointsToDollars(20000)).toBe(1);
  });

  it("ignores invalid rates and keeps the last good value (fail-open)", () => {
    setDisplayPointsPerDollar(15000);
    for (const bad of [0, -1, NaN, Infinity, null, undefined] as const) {
      setDisplayPointsPerDollar(bad);
      expect(getDisplayPointsPerDollar()).toBe(15000);
    }
  });
});

describe("dollarsToPoints (DISPLAY adapter)", () => {
  it("converts dollars to display points at 10,000 pts/$", () => {
    expect(dollarsToPoints(1)).toBe(10000);
    expect(dollarsToPoints(0.05)).toBe(500);
    expect(dollarsToPoints(0)).toBe(0);
  });

  it("rounds fractional point results to whole points", () => {
    expect(dollarsToPoints(0.000049)).toBe(0);
    expect(dollarsToPoints(0.000051)).toBe(1);
  });
});

describe("displayPointsToDollars (DISPLAY adapter)", () => {
  it("converts display points back to dollars at 10,000 pts/$", () => {
    expect(displayPointsToDollars(10000)).toBe(1);
    expect(displayPointsToDollars(500)).toBe(0.05);
    expect(displayPointsToDollars(0)).toBe(0);
  });

  it("round-trips dollars -> display points -> dollars", () => {
    for (const dollars of [0.05, 0.1, 0.5, 1, 2.5, 7]) {
      expect(displayPointsToDollars(dollarsToPoints(dollars))).toBeCloseTo(dollars, 10);
    }
  });
});

describe("pointsToUsd (CASH fallback adapter)", () => {
  it("converts cash-economy points to USD at 1,000 pts/$", () => {
    expect(pointsToUsd(1000)).toBe(1);
    expect(pointsToUsd(500)).toBe(0.5);
    expect(pointsToUsd(0)).toBe(0);
  });

  it("is NOT interchangeable with the display adapter — same points, different dollars", () => {
    // The same raw point count must yield a 10x-larger dollar figure under the
    // cash rate than under the display rate. This is the guard that catches a
    // surface accidentally using the wrong adapter.
    const points = 10000;
    expect(pointsToUsd(points)).toBe(10);
    expect(displayPointsToDollars(points)).toBe(1);
    expect(pointsToUsd(points)).toBe(displayPointsToDollars(points) * 10);
  });
});

describe("formatPoints", () => {
  it("formats with thousands separators and a pts suffix", () => {
    expect(formatPoints(1500)).toBe("1,500 pts");
    expect(formatPoints(0)).toBe("0 pts");
    expect(formatPoints(1000000)).toBe("1,000,000 pts");
  });

  it("rounds before formatting", () => {
    expect(formatPoints(1500.6)).toBe("1,501 pts");
  });
});
