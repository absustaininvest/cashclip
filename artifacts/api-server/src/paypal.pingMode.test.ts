import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPayPalApiBase } from "./paypal";

/**
 * Locks in the live/sandbox switch for the PayPal API base URL.
 *
 * The base is resolved at call time from `PAYPAL_MODE` (not a module-level
 * constant), so toggling the env var must flip the resolved base WITHOUT a
 * module re-import. These tests guard against a regression where a cached
 * constant would pin payouts to the wrong PayPal environment.
 */

const LIVE_BASE = "https://api-m.paypal.com";
const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

describe("getPayPalApiBase — live/sandbox switch", () => {
  const original = process.env.PAYPAL_MODE;

  beforeEach(() => {
    delete process.env.PAYPAL_MODE;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PAYPAL_MODE;
    } else {
      process.env.PAYPAL_MODE = original;
    }
  });

  it("resolves the live base when PAYPAL_MODE=live", () => {
    process.env.PAYPAL_MODE = "live";
    expect(getPayPalApiBase()).toBe(LIVE_BASE);
  });

  it("resolves the sandbox base when PAYPAL_MODE=sandbox", () => {
    process.env.PAYPAL_MODE = "sandbox";
    expect(getPayPalApiBase()).toBe(SANDBOX_BASE);
  });

  it("defaults to the sandbox base when PAYPAL_MODE is unset", () => {
    delete process.env.PAYPAL_MODE;
    expect(getPayPalApiBase()).toBe(SANDBOX_BASE);
  });

  it("defaults to the sandbox base for any non-live value", () => {
    process.env.PAYPAL_MODE = "production"; // not the literal "live"
    expect(getPayPalApiBase()).toBe(SANDBOX_BASE);
  });

  it("flips the base when PAYPAL_MODE is toggled between calls (no re-import)", () => {
    process.env.PAYPAL_MODE = "live";
    expect(getPayPalApiBase()).toBe(LIVE_BASE);

    process.env.PAYPAL_MODE = "sandbox";
    expect(getPayPalApiBase()).toBe(SANDBOX_BASE);

    process.env.PAYPAL_MODE = "live";
    expect(getPayPalApiBase()).toBe(LIVE_BASE);
  });
});
