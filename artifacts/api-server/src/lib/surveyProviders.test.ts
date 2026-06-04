import { describe, it, expect, beforeAll } from "vitest";

let verifyProviderCompletion: typeof import("./surveyProviders").verifyProviderCompletion;

// Provider API-key env vars that mark a provider as "configured". We clear them
// so the tests below exercise the deterministic, no-network branches of
// verifyProviderCompletion (missing transactionId, unconfigured provider)
// without ever issuing an outbound HTTP call to a real survey provider.
const PROVIDER_ENV_VARS = [
  "POLLFISH_API_KEY",
  "CINT_API_KEY",
  "LUCID_API_KEY",
  "CPX_API_KEY",
  "CPX_APP_ID",
  "BITLABS_API_KEY",
];

beforeAll(async () => {
  for (const key of PROVIDER_ENV_VARS) {
    delete process.env[key];
  }
  const mod = await import("./surveyProviders");
  verifyProviderCompletion = mod.verifyProviderCompletion;
});

describe("verifyProviderCompletion", () => {
  it("rejects when transactionId is empty (before any provider call)", async () => {
    const res = await verifyProviderCompletion({
      surveyId: "s1",
      provider: "pollfish",
      userId: "u1",
      transactionId: "",
    });
    expect(res.verified).toBe(false);
    expect(res.reward).toBe(0);
    expect(res.error).toMatch(/transactionId is required/i);
  });

  it("rejects when transactionId is only whitespace", async () => {
    const res = await verifyProviderCompletion({
      surveyId: "s1",
      provider: "cint",
      userId: "u1",
      transactionId: "   ",
    });
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/transactionId is required/i);
  });

  it("rejects when the provider is not configured", async () => {
    const res = await verifyProviderCompletion({
      surveyId: "s1",
      provider: "pollfish",
      userId: "u1",
      transactionId: "tx-123",
    });
    expect(res.verified).toBe(false);
    expect(res.reward).toBe(0);
    expect(res.error).toMatch(/not configured/i);
  });

  it("rejects an unknown/internal provider with no verifier as not configured", async () => {
    const res = await verifyProviderCompletion({
      surveyId: "s1",
      provider: "internal",
      userId: "u1",
      transactionId: "tx-123",
    });
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/not configured/i);
  });
});
