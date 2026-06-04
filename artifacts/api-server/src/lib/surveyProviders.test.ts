import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

let verifyProviderCompletion: typeof import("./surveyProviders").verifyProviderCompletion;

// Provider API-key env vars that mark a provider as "configured". We clear them
// up front so the deterministic, no-network tests below exercise the
// missing-transactionId / unconfigured-provider branches of
// verifyProviderCompletion without ever issuing an outbound HTTP call. The
// per-provider tests further down set the specific keys they need (and clear
// them again in afterEach) so each provider is exercised in isolation.
const PROVIDER_ENV_VARS = [
  "POLLFISH_API_KEY",
  "CINT_API_KEY",
  "LUCID_API_KEY",
  "CPX_API_KEY",
  "CPX_APP_ID",
  "BITLABS_API_KEY",
];

function clearProviderEnv() {
  for (const key of PROVIDER_ENV_VARS) {
    delete process.env[key];
  }
}

beforeAll(async () => {
  clearProviderEnv();
  const mod = await import("./surveyProviders");
  verifyProviderCompletion = mod.verifyProviderCompletion;
});

afterEach(() => {
  clearProviderEnv();
  vi.unstubAllGlobals();
});

// Build a minimal stand-in for a fetch Response. The verifiers only ever read
// `res.ok`, `res.status`, and `res.text()`, so we only need those.
function fakeResponse(opts: { ok?: boolean; status?: number; body?: unknown }): Response {
  const { ok = true, status = ok ? 200 : 500, body } = opts;
  const text =
    body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => text,
  } as unknown as Response;
}

// Stub global fetch to always resolve with `response`, returning the spy so
// tests can assert it was (or was not) called and inspect the requested URL.
function stubFetchResolving(response: Response) {
  const spy = vi.fn(async () => response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

// Stub global fetch to reject, simulating a network/DNS failure.
function stubFetchRejecting(err: Error = new Error("network down")) {
  const spy = vi.fn(async () => {
    throw err;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("verifyProviderCompletion — guard branches (no network)", () => {
  it("rejects when transactionId is empty (before any provider call)", async () => {
    const fetchSpy = stubFetchResolving(fakeResponse({ body: { status: "completed" } }));
    const res = await verifyProviderCompletion({
      surveyId: "s1",
      provider: "pollfish",
      userId: "u1",
      transactionId: "",
    });
    expect(res.verified).toBe(false);
    expect(res.reward).toBe(0);
    expect(res.error).toMatch(/transactionId is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects when transactionId is only whitespace", async () => {
    const fetchSpy = stubFetchResolving(fakeResponse({ body: { status: "completed" } }));
    const res = await verifyProviderCompletion({
      surveyId: "s1",
      provider: "cint",
      userId: "u1",
      transactionId: "   ",
    });
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/transactionId is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects when the provider is not configured", async () => {
    const fetchSpy = stubFetchResolving(fakeResponse({ body: { status: "completed" } }));
    const res = await verifyProviderCompletion({
      surveyId: "s1",
      provider: "pollfish",
      userId: "u1",
      transactionId: "tx-123",
    });
    expect(res.verified).toBe(false);
    expect(res.reward).toBe(0);
    expect(res.error).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
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

// Providers whose verifier accepts a confirmation that carries a matching status
// even when the provider omits the transaction/user echo back (lenient match).
const LENIENT_PROVIDERS: { provider: "pollfish" | "cint" | "lucid"; envKey: string }[] = [
  { provider: "pollfish", envKey: "POLLFISH_API_KEY" },
  { provider: "cint", envKey: "CINT_API_KEY" },
  { provider: "lucid", envKey: "LUCID_API_KEY" },
];

describe.each(LENIENT_PROVIDERS)(
  "verifyProviderCompletion — $provider (configured, mocked fetch)",
  ({ provider, envKey }) => {
    const surveyId = `${provider}_abc`;
    const transactionId = "tx-success-1";
    const userId = "user-42";

    function configure() {
      process.env[envKey] = "test-key";
    }

    it("verifies when the provider confirms a completed status", async () => {
      configure();
      const fetchSpy = stubFetchResolving(
        fakeResponse({
          body: { status: "completed", transaction_id: transactionId, user_id: userId },
        }),
      );
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(true);
      expect(res.error).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("verifies on a bare matching status even without txn/user echo", async () => {
      configure();
      stubFetchResolving(fakeResponse({ body: { status: "success" } }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(true);
    });

    it("verifies when completed:true is returned without a status string", async () => {
      configure();
      stubFetchResolving(fakeResponse({ body: { completed: true } }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(true);
    });

    it("denies when the provider reports a non-complete status", async () => {
      configure();
      stubFetchResolving(fakeResponse({ body: { status: "pending" } }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
      expect(res.error).toMatch(/did not confirm/i);
    });

    it("denies when the returned transaction_id does not match", async () => {
      configure();
      stubFetchResolving(
        fakeResponse({ body: { status: "completed", transaction_id: "someone-elses-txn" } }),
      );
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies when the returned user does not match", async () => {
      configure();
      stubFetchResolving(
        fakeResponse({ body: { status: "completed", user_id: "another-user" } }),
      );
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies on a non-OK HTTP response", async () => {
      configure();
      stubFetchResolving(fakeResponse({ ok: false, status: 500 }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies on a 404 (transaction not found)", async () => {
      configure();
      stubFetchResolving(fakeResponse({ ok: false, status: 404 }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies when the response body is empty", async () => {
      configure();
      stubFetchResolving(fakeResponse({ ok: true, body: undefined }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies when the response body is not valid JSON", async () => {
      configure();
      stubFetchResolving(fakeResponse({ ok: true, body: "<html>not json</html>" }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies (without throwing) when fetch rejects", async () => {
      configure();
      stubFetchRejecting();
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
      expect(res.error).toMatch(/did not confirm/i);
    });
  },
);

// Providers whose verifier requires the provider to echo back BOTH the exact
// transaction id and the exact user id (strict match) before rewarding.
const STRICT_PROVIDERS: { provider: "cpx" | "bitlabs"; envKey: string; needsAppId?: boolean }[] = [
  { provider: "cpx", envKey: "CPX_API_KEY", needsAppId: true },
  { provider: "bitlabs", envKey: "BITLABS_API_KEY" },
];

describe.each(STRICT_PROVIDERS)(
  "verifyProviderCompletion — $provider (strict, mocked fetch)",
  ({ provider, envKey, needsAppId }) => {
    const surveyId = `${provider}_xyz`;
    const transactionId = "tx-strict-1";
    const userId = "user-99";

    function configure() {
      process.env[envKey] = "test-key";
      if (needsAppId) process.env.CPX_APP_ID = "app-123";
    }

    it("verifies only when txn and user are both echoed back with a complete status", async () => {
      configure();
      const fetchSpy = stubFetchResolving(
        fakeResponse({
          body: { status: "completed", transaction_id: transactionId, user_id: userId },
        }),
      );
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(true);
      expect(res.error).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("accepts respondent_id as the user echo", async () => {
      configure();
      stubFetchResolving(
        fakeResponse({
          body: { verified: true, transactionId: transactionId, respondent_id: userId },
        }),
      );
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(true);
    });

    it("denies a bare matching status with no txn/user echo (strict)", async () => {
      configure();
      stubFetchResolving(fakeResponse({ body: { status: "completed" } }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies when only the transaction id is echoed (user missing)", async () => {
      configure();
      stubFetchResolving(
        fakeResponse({ body: { status: "completed", transaction_id: transactionId } }),
      );
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies when only the user is echoed (txn missing)", async () => {
      configure();
      stubFetchResolving(fakeResponse({ body: { status: "completed", user_id: userId } }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies when the echoed transaction id is for a different transaction", async () => {
      configure();
      stubFetchResolving(
        fakeResponse({
          body: { status: "completed", transaction_id: "other-txn", user_id: userId },
        }),
      );
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies when the echoed user is a different user", async () => {
      configure();
      stubFetchResolving(
        fakeResponse({
          body: { status: "completed", transaction_id: transactionId, user_id: "other-user" },
        }),
      );
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies on a non-OK HTTP response", async () => {
      configure();
      stubFetchResolving(fakeResponse({ ok: false, status: 500 }));
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });

    it("denies (without throwing) when fetch rejects", async () => {
      configure();
      stubFetchRejecting();
      const res = await verifyProviderCompletion({ surveyId, provider, userId, transactionId });
      expect(res.verified).toBe(false);
    });
  },
);

describe("verifyProviderCompletion — CPX configuration edge case", () => {
  it("treats CPX as not configured when CPX_APP_ID is missing (no network call)", async () => {
    process.env.CPX_API_KEY = "test-key";
    delete process.env.CPX_APP_ID;
    const fetchSpy = stubFetchResolving(
      fakeResponse({
        body: { status: "completed", transaction_id: "tx-1", user_id: "u1" },
      }),
    );
    const res = await verifyProviderCompletion({
      surveyId: "cpx_1",
      provider: "cpx",
      userId: "u1",
      transactionId: "tx-1",
    });
    expect(res.verified).toBe(false);
    expect(res.error).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
