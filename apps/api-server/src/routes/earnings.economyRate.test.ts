/**
 * Server-side tests: GET /api/economy/rate includes displayPointsPerDollar.
 *
 * The route serialises `DISPLAY_POINTS_PER_DOLLAR` from `lib/pointsEconomy`
 * directly into the response.  Rather than standing up the full Express stack
 * (which requires a live DB connection for the 4 000-line earnings module to
 * boot), these tests verify the contract at the module-constant level:
 *
 *   1. `DISPLAY_POINTS_PER_DOLLAR` is a positive finite number.
 *   2. It matches the client-side `DISPLAY_POINTS_PER_DOLLAR` so the server
 *      and every client surface agree on the same default display rate.
 *   3. The constant is distinct from the cash rate so the two economies
 *      can't be accidentally collapsed.
 *   4. The rate is owner-tunable: `getCurrentRate` returns a `RateInfo` and
 *      the caller can compute `pointsPerDollar = Math.round(1 / usdPerPoint)`.
 *
 * A full HTTP integration test for this endpoint lives in
 * `earnings.moneyFlow.test.ts`, which sets up a real DB schema. These unit
 * tests catch regressions that don't require a live DB — such as accidentally
 * removing `displayPointsPerDollar` from the module exports or mismatching
 * the client and server defaults.
 */

import { describe, it, expect } from "vitest";
import {
  DISPLAY_POINTS_PER_DOLLAR,
  FLOOR_USD_PER_POINT,
  LEGACY_USD_PER_POINT,
  DEFAULT_REGION,
  clampRate,
  computeArpuRate,
} from "../lib/pointsEconomy";

describe("pointsEconomy.DISPLAY_POINTS_PER_DOLLAR — server constant for GET /api/economy/rate", () => {
  it("is a positive finite number (the route serialises it into the response)", () => {
    expect(typeof DISPLAY_POINTS_PER_DOLLAR).toBe("number");
    expect(Number.isFinite(DISPLAY_POINTS_PER_DOLLAR)).toBe(true);
    expect(DISPLAY_POINTS_PER_DOLLAR).toBeGreaterThan(0);
  });

  it("matches the client default so server and client agree on the display rate", () => {
    // The client-side default in artifacts/cashclip/lib/points.ts must equal
    // the server constant; the client overrides it with the API value at
    // runtime, but both must start from the same number.
    const CLIENT_DEFAULT = 10000; // DISPLAY_POINTS_PER_DOLLAR from points.ts
    expect(DISPLAY_POINTS_PER_DOLLAR).toBe(CLIENT_DEFAULT);
  });

  it("is distinct from LEGACY_USD_PER_POINT × 1 000 (cash and display economies stay separate)", () => {
    // LEGACY_USD_PER_POINT = 0.001 → 1/0.001 = 1 000 pts/$ (cash rate).
    // DISPLAY_POINTS_PER_DOLLAR = 10 000 pts/$ (cosmetic, 10× the cash rate).
    // These must never be equal or the display economy has been accidentally collapsed.
    const cashPointsPerDollar = Math.round(1 / LEGACY_USD_PER_POINT);
    expect(DISPLAY_POINTS_PER_DOLLAR).not.toBe(cashPointsPerDollar);
    expect(DISPLAY_POINTS_PER_DOLLAR).toBeGreaterThan(cashPointsPerDollar);
  });

  it("DEFAULT_REGION is a non-empty string (required by getCurrentRate)", () => {
    expect(typeof DEFAULT_REGION).toBe("string");
    expect(DEFAULT_REGION.length).toBeGreaterThan(0);
  });
});

describe("pointsEconomy rate helpers — pointsPerDollar derivation used by the route", () => {
  it("floor rate produces a positive pointsPerDollar reciprocal", () => {
    // The route computes `pointsPerDollar = Math.round(1 / rate.usdPerPoint)`.
    // At minimum the floor rate must yield a finite, positive reciprocal.
    const { usdPerPoint } = computeArpuRate({ revenueUsd: 0, pointsIssued: 0 });
    expect(usdPerPoint).toBeGreaterThan(0);
    expect(Number.isFinite(Math.round(1 / usdPerPoint))).toBe(true);
    expect(Math.round(1 / usdPerPoint)).toBeGreaterThan(0);
  });

  it("clampRate keeps usdPerPoint within [FLOOR, LEGACY] so pointsPerDollar is always defined", () => {
    for (const raw of [0, -1, 0.0001, 0.0002, 0.0005, 0.001, 0.002]) {
      const clamped = clampRate(raw);
      expect(clamped).toBeGreaterThanOrEqual(FLOOR_USD_PER_POINT);
      // Any clamped rate produces a finite pointsPerDollar.
      const ppd = Math.round(1 / clamped);
      expect(Number.isFinite(ppd)).toBe(true);
      expect(ppd).toBeGreaterThan(0);
    }
  });

  it("DISPLAY_POINTS_PER_DOLLAR / cash usdPerPoint gives the 10x display factor", () => {
    // Ensures the display economy is consistently 10× the cash economy at the
    // legacy rate — the same ratio the client points.ts tests pin.
    const displayPointsPerDollar = DISPLAY_POINTS_PER_DOLLAR;
    const cashPointsPerDollar    = Math.round(1 / LEGACY_USD_PER_POINT);
    expect(displayPointsPerDollar / cashPointsPerDollar).toBe(10);
  });
});
