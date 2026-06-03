/**
 * Unit tests for pingPayPal() in paypal.ts.
 *
 * These tests exercise the function directly — not the HTTP route — so that the
 * `mode` field derivation from `process.env.PAYPAL_MODE` is covered
 * independently of the route-level mock used in cashclip.paypalPing.test.ts.
 *
 * `getAccessToken` is not exported, so we stub the global `fetch` to return a
 * fake token response. This avoids any real PayPal I/O.
 *
 * Cases covered:
 *   - PAYPAL_MODE=live  → mode is "live"
 *   - PAYPAL_MODE unset → mode is "sandbox"
 *   - PAYPAL_MODE=sandbox → mode is "sandbox"
 *   - getAccessToken throws (bad credentials) → ok:false with correct mode preserved
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pingPayPal } from "./paypal";

const FAKE_TOKEN_RESPONSE = {
  access_token: "fake-access-token",
  expires_in: 32400,
};

function makeFetchStub(ok: boolean, body: unknown = FAKE_TOKEN_RESPONSE) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 401,
    text: vi.fn().mockResolvedValue(ok ? "" : "Unauthorized"),
    json: vi.fn().mockResolvedValue(body),
  });
}

describe("pingPayPal() — mode derivation from PAYPAL_MODE", () => {
  const origClientId = process.env["PAYPAL_CLIENT_ID"];
  const origSecret   = process.env["PAYPAL_SECRET"];
  const origMode     = process.env["PAYPAL_MODE"];

  beforeEach(() => {
    process.env["PAYPAL_CLIENT_ID"] = "test-client-id";
    process.env["PAYPAL_SECRET"]    = "test-secret";
  });

  afterEach(() => {
    if (origClientId === undefined) delete process.env["PAYPAL_CLIENT_ID"];
    else process.env["PAYPAL_CLIENT_ID"] = origClientId;

    if (origSecret === undefined) delete process.env["PAYPAL_SECRET"];
    else process.env["PAYPAL_SECRET"] = origSecret;

    if (origMode === undefined) delete process.env["PAYPAL_MODE"];
    else process.env["PAYPAL_MODE"] = origMode;

    vi.unstubAllGlobals();
  });

  it('resolves mode="live" when PAYPAL_MODE=live and credentials are valid', async () => {
    process.env["PAYPAL_MODE"] = "live";
    vi.stubGlobal("fetch", makeFetchStub(true));

    const result = await pingPayPal();

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("live");
    expect(result.error).toBeUndefined();
  });

  it('resolves mode="sandbox" when PAYPAL_MODE is unset and credentials are valid', async () => {
    delete process.env["PAYPAL_MODE"];
    vi.stubGlobal("fetch", makeFetchStub(true));

    const result = await pingPayPal();

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("sandbox");
    expect(result.error).toBeUndefined();
  });

  it('resolves mode="sandbox" when PAYPAL_MODE=sandbox and credentials are valid', async () => {
    process.env["PAYPAL_MODE"] = "sandbox";
    vi.stubGlobal("fetch", makeFetchStub(true));

    const result = await pingPayPal();

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("sandbox");
    expect(result.error).toBeUndefined();
  });

  it('returns ok:false with mode="live" preserved when getAccessToken fails in live mode', async () => {
    process.env["PAYPAL_MODE"] = "live";
    vi.stubGlobal("fetch", makeFetchStub(false));

    const result = await pingPayPal();

    expect(result.ok).toBe(false);
    expect(result.mode).toBe("live");
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('returns ok:false with mode="sandbox" preserved when getAccessToken fails in sandbox mode', async () => {
    delete process.env["PAYPAL_MODE"];
    vi.stubGlobal("fetch", makeFetchStub(false));

    const result = await pingPayPal();

    expect(result.ok).toBe(false);
    expect(result.mode).toBe("sandbox");
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it('returns ok:false with correct mode when PAYPAL credentials are not configured', async () => {
    process.env["PAYPAL_MODE"] = "live";
    delete process.env["PAYPAL_CLIENT_ID"];
    delete process.env["PAYPAL_SECRET"];
    vi.stubGlobal("fetch", makeFetchStub(true));

    const result = await pingPayPal();

    expect(result.ok).toBe(false);
    expect(result.mode).toBe("live");
    expect(typeof result.error).toBe("string");
  });
});
