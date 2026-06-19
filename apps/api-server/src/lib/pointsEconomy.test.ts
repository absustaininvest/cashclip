import { describe, it, expect } from "vitest";
import {
  clampRate,
  computeArpuRate,
  tokenUsd,
  FLOOR_USD_PER_POINT,
  LEGACY_USD_PER_POINT,
  CEILING_USD_PER_POINT,
  PAYOUT_SHARE,
} from "./pointsEconomy";

describe("clampRate", () => {
  it("never goes below the published floor", () => {
    expect(clampRate(0)).toBe(FLOOR_USD_PER_POINT);
    expect(clampRate(-1)).toBe(FLOOR_USD_PER_POINT);
    expect(clampRate(FLOOR_USD_PER_POINT / 2)).toBe(FLOOR_USD_PER_POINT);
  });

  it("never exceeds the ceiling", () => {
    expect(clampRate(1)).toBe(CEILING_USD_PER_POINT);
    expect(clampRate(CEILING_USD_PER_POINT * 10)).toBe(CEILING_USD_PER_POINT);
  });

  it("passes through values inside the band", () => {
    const mid = (FLOOR_USD_PER_POINT + CEILING_USD_PER_POINT) / 2;
    expect(clampRate(mid)).toBe(mid);
  });

  it("falls back to the floor for non-finite input", () => {
    expect(clampRate(NaN)).toBe(FLOOR_USD_PER_POINT);
    expect(clampRate(Infinity)).toBe(FLOOR_USD_PER_POINT);
  });
});

describe("computeArpuRate", () => {
  it("returns the floor when no points were issued", () => {
    const r = computeArpuRate({ revenueUsd: 1000, pointsIssued: 0 });
    expect(r.usdPerPoint).toBe(FLOOR_USD_PER_POINT);
    expect(r.method).toBe("floor");
  });

  it("clamps a low ARPU up to the floor (method floor)", () => {
    // Tiny revenue over many points → raw far below floor.
    const r = computeArpuRate({ revenueUsd: 1, pointsIssued: 1_000_000 });
    expect(r.usdPerPoint).toBe(FLOOR_USD_PER_POINT);
    expect(r.method).toBe("floor");
  });

  it("floats above the floor when revenue supports it (method arpu)", () => {
    // Choose revenue/points so raw sits strictly between floor and ceiling.
    const pointsIssued = 100_000;
    const target = (FLOOR_USD_PER_POINT + CEILING_USD_PER_POINT) / 2;
    const revenueUsd = (target * pointsIssued) / PAYOUT_SHARE;
    const r = computeArpuRate({ revenueUsd, pointsIssued });
    expect(r.usdPerPoint).toBeCloseTo(target, 8);
    expect(r.method).toBe("arpu");
  });

  it("clamps a revenue spike down to the ceiling", () => {
    const r = computeArpuRate({ revenueUsd: 10_000_000, pointsIssued: 1 });
    expect(r.usdPerPoint).toBe(CEILING_USD_PER_POINT);
    expect(r.method).toBe("arpu");
  });
});

describe("tokenUsd", () => {
  it("uses the legacy rate when the snapshot is null/undefined", () => {
    expect(tokenUsd(1000, null)).toBeCloseTo(1000 * LEGACY_USD_PER_POINT, 8);
    expect(tokenUsd(1000, undefined)).toBeCloseTo(1000 * LEGACY_USD_PER_POINT, 8);
  });

  it("uses the snapshot rate when present (numeric strings from pg)", () => {
    expect(tokenUsd(5000, "0.00020000")).toBeCloseTo(1, 8);
    expect(tokenUsd(5000, 0.0002)).toBeCloseTo(1, 8);
  });

  it("falls back to the legacy rate for an unparseable snapshot", () => {
    expect(tokenUsd(1000, "not-a-number")).toBeCloseTo(1000 * LEGACY_USD_PER_POINT, 8);
  });
});
