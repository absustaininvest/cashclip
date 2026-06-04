import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

let verifyProviderCompletion: typeof import("./surveyProviders").verifyProviderCompletion;
let fetchExternalSurveys: typeof import("./surveyProviders").fetchExternalSurveys;
let sanitizeSurveyUrl: typeof import("./surveyProviders").sanitizeSurveyUrl;

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
  fetchExternalSurveys = mod.fetchExternalSurveys;
  sanitizeSurveyUrl = mod.sanitizeSurveyUrl;
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
    json: async () => {
      if (body === undefined) return {};
      return typeof body === "string" ? JSON.parse(body) : body;
    },
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

// --- Fetch side: building the survey list shown to users -------------------
// fetchExternalSurveys only runs the per-provider fetch* helper for providers
// that are "configured". By configuring exactly one provider's env vars at a
// time we exercise each fetch* helper in isolation through the public API
// (the helpers themselves are not exported). Each test stubs global fetch with
// the raw provider JSON and asserts the mapped ExternalSurvey shape.

function surveysFor(results: Awaited<ReturnType<typeof fetchExternalSurveys>>, provider: string) {
  const entry = results.find((r) => r.provider === provider);
  return entry?.surveys ?? [];
}

describe("fetchExternalSurveys — no providers configured", () => {
  it("returns an empty array when nothing is configured (no network call)", async () => {
    const fetchSpy = stubFetchResolving(fakeResponse({ body: { surveys: [] } }));
    const results = await fetchExternalSurveys("user-1");
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchExternalSurveys — Pollfish mapping", () => {
  it("maps Pollfish JSON to ExternalSurvey cards with id prefix, reward, difficulty", async () => {
    process.env.POLLFISH_API_KEY = "pf-key";
    stubFetchResolving(
      fakeResponse({
        body: {
          surveys: [
            // easy: loi <= 5, numeric reward
            { survey_id: "111", survey_name: "Quick Poll", reward_value: 0.75, loi: 4, category: "Food" },
            // medium: loi 6..10, string reward parsed
            { id: "222", reward_value: "1.25", loi: 8 },
            // hard: loi > 10, missing reward -> default 0.50
            { survey_id: "333", loi: 20 },
          ],
        },
      }),
    );
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "pollfish");
    expect(surveys).toHaveLength(3);

    expect(surveys[0]).toMatchObject({
      id: "pollfish_111",
      provider: "pollfish",
      providerName: "Pollfish",
      title: "Quick Poll",
      reward: 0.75,
      estimatedMinutes: 4,
      category: "Food",
      difficulty: "easy",
    });
    expect(surveys[1]).toMatchObject({ id: "pollfish_222", reward: 1.25, difficulty: "medium" });
    expect(surveys[2]).toMatchObject({ id: "pollfish_333", reward: 0.5, difficulty: "hard" });
    // default survey URL points at a trusted Pollfish host and is kept.
    expect(surveys[0].surveyUrl).toContain("wss.pollfish.com");
  });

  it("returns [] when the Pollfish API responds non-OK", async () => {
    process.env.POLLFISH_API_KEY = "pf-key";
    stubFetchResolving(fakeResponse({ ok: false, status: 500 }));
    const results = await fetchExternalSurveys("user-1");
    expect(surveysFor(results, "pollfish")).toEqual([]);
  });

  it("returns [] when the Pollfish response has no surveys array", async () => {
    process.env.POLLFISH_API_KEY = "pf-key";
    stubFetchResolving(fakeResponse({ body: {} }));
    const results = await fetchExternalSurveys("user-1");
    expect(surveysFor(results, "pollfish")).toEqual([]);
  });

  it("returns [] (without throwing) when fetch rejects", async () => {
    process.env.POLLFISH_API_KEY = "pf-key";
    stubFetchRejecting();
    const results = await fetchExternalSurveys("user-1");
    expect(surveysFor(results, "pollfish")).toEqual([]);
  });
});

describe("fetchExternalSurveys — Cint mapping", () => {
  it("maps Cint JSON (items[] alias, cpi reward) to cards", async () => {
    process.env.CINT_API_KEY = "cint-key";
    stubFetchResolving(
      fakeResponse({
        body: {
          items: [
            { id: "c1", name: "Brand Study", cpi: 2.0, loi: 5, category: "Brands" },
            { surveyId: "c2", cpi: "3.50", loi: 10 },
            { id: "c3", loi: 30 },
          ],
        },
      }),
    );
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "cint");
    expect(surveys).toHaveLength(3);
    expect(surveys[0]).toMatchObject({
      id: "cint_c1",
      provider: "cint",
      title: "Brand Study",
      reward: 2.0,
      difficulty: "easy",
      category: "Brands",
    });
    expect(surveys[1]).toMatchObject({ id: "cint_c2", reward: 3.5, difficulty: "medium" });
    // missing cpi -> default 1.00, loi 30 -> hard
    expect(surveys[2]).toMatchObject({ id: "cint_c3", reward: 1.0, difficulty: "hard" });
    expect(surveys[0].surveyUrl).toContain("survey.cint.com");
  });

  it("returns [] on a non-OK Cint response", async () => {
    process.env.CINT_API_KEY = "cint-key";
    stubFetchResolving(fakeResponse({ ok: false, status: 503 }));
    const results = await fetchExternalSurveys("user-1");
    expect(surveysFor(results, "cint")).toEqual([]);
  });
});

describe("fetchExternalSurveys — Lucid mapping", () => {
  it("maps Lucid JSON (AllSurveys[], CPI/LOI/SurveyNumber) to cards", async () => {
    process.env.LUCID_API_KEY = "lucid-key";
    stubFetchResolving(
      fakeResponse({
        body: {
          AllSurveys: [
            { SurveyNumber: 900, SurveyName: "Auto Survey", CPI: 1.5, LOI: 6, SurveyGroup: "Auto" },
            { id: "901", CPI: "2.40", LOI: 12 },
            { SurveyNumber: 902, LOI: 25 },
          ],
        },
      }),
    );
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "lucid");
    expect(surveys).toHaveLength(3);
    expect(surveys[0]).toMatchObject({
      id: "lucid_900",
      provider: "lucid",
      title: "Auto Survey",
      reward: 1.5,
      difficulty: "easy",
      category: "Auto",
    });
    expect(surveys[1]).toMatchObject({ id: "lucid_901", reward: 2.4, difficulty: "medium" });
    // missing CPI -> default 1.20, LOI 25 -> hard
    expect(surveys[2]).toMatchObject({ id: "lucid_902", reward: 1.2, difficulty: "hard" });
    expect(surveys[0].surveyUrl).toContain("samplicio.us");
  });
});

describe("fetchExternalSurveys — BitLabs mapping", () => {
  it("maps BitLabs JSON (data.surveys[], value reward, category.name) to cards", async () => {
    process.env.BITLABS_API_KEY = "bl-key";
    stubFetchResolving(
      fakeResponse({
        body: {
          data: {
            surveys: [
              {
                id: "b1",
                title: "Tech Survey",
                value: 0.9,
                loi: 4,
                category: { name: "Tech" },
                link: "https://api.bitlabs.ai/v1/click?uid=user-1",
              },
              { network_id: "b2", value: "1.10", loi: 9, link: "https://bitlabs.ai/s/b2" },
            ],
          },
        },
      }),
    );
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "bitlabs");
    expect(surveys).toHaveLength(2);
    expect(surveys[0]).toMatchObject({
      id: "bitlabs_b1",
      provider: "bitlabs",
      title: "Tech Survey",
      reward: 0.9,
      estimatedMinutes: 4,
      category: "Tech",
      difficulty: "easy",
    });
    expect(surveys[1]).toMatchObject({ id: "bitlabs_b2", reward: 1.1, difficulty: "medium" });
    expect(surveys[0].surveyUrl).toContain("api.bitlabs.ai");
  });

  it("drops the surveyUrl when BitLabs returns an untrusted link host", async () => {
    process.env.BITLABS_API_KEY = "bl-key";
    stubFetchResolving(
      fakeResponse({
        body: { surveys: [{ id: "bx", value: 0.5, loi: 5, link: "https://evil.example.com/steal" }] },
      }),
    );
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "bitlabs");
    expect(surveys).toHaveLength(1);
    expect(surveys[0].surveyUrl).toBe("");
  });
});

describe("fetchExternalSurveys — CPX mapping and fallback", () => {
  function configureCpx() {
    process.env.CPX_API_KEY = "cpx-key";
    process.env.CPX_APP_ID = "app-123";
  }

  it("maps live CPX surveys to per-survey cards", async () => {
    configureCpx();
    stubFetchResolving(
      fakeResponse({
        body: {
          surveys: [
            { id: "501", href: "https://offers.cpx-research.com/go?survey=501", payout: "0.80", loi: "5", category: "Lifestyle" },
            { survey_id: "502", href: "https://offers.cpx-research.com/go?survey=502", payout: "1.50", loi: "12" },
          ],
        },
      }),
    );
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "cpx");
    expect(surveys).toHaveLength(2);
    expect(surveys[0]).toMatchObject({
      id: "cpx_501",
      provider: "cpx",
      reward: 0.8,
      estimatedMinutes: 5,
      category: "Lifestyle",
      difficulty: "easy",
    });
    expect(surveys[0].title).toContain("Lifestyle");
    expect(surveys[1]).toMatchObject({ id: "cpx_502", reward: 1.5, difficulty: "medium" });
  });

  it("skips CPX entries with a missing id or an untrusted href", async () => {
    configureCpx();
    stubFetchResolving(
      fakeResponse({
        body: {
          surveys: [
            { id: "", href: "https://offers.cpx-research.com/go?survey=1" },
            { id: "600", href: "https://evil.example.com/go" },
            { id: "601", href: "https://offers.cpx-research.com/go?survey=601", payout: "0.50", loi: "3" },
          ],
        },
      }),
    );
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "cpx");
    expect(surveys).toHaveLength(1);
    expect(surveys[0].id).toBe("cpx_601");
  });

  it("falls back to a single offerwall card when CPX returns no surveys", async () => {
    configureCpx();
    stubFetchResolving(fakeResponse({ body: { surveys: [] } }));
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "cpx");
    expect(surveys).toHaveLength(1);
    expect(surveys[0]).toMatchObject({ id: "cpx_wall", provider: "cpx", category: "Multiple Topics" });
    expect(surveys[0].surveyUrl).toContain("offers.cpx-research.com");
  });

  it("falls back to the offerwall card on a non-OK CPX response", async () => {
    configureCpx();
    stubFetchResolving(fakeResponse({ ok: false, status: 500 }));
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "cpx");
    expect(surveys).toHaveLength(1);
    expect(surveys[0].id).toBe("cpx_wall");
  });

  it("falls back to the offerwall card when fetch rejects", async () => {
    configureCpx();
    stubFetchRejecting();
    const results = await fetchExternalSurveys("user-1");
    const surveys = surveysFor(results, "cpx");
    expect(surveys).toHaveLength(1);
    expect(surveys[0].id).toBe("cpx_wall");
  });
});

describe("sanitizeSurveyUrl", () => {
  it("returns '' for empty/undefined input", () => {
    expect(sanitizeSurveyUrl("", "k", "pollfish")).toBe("");
    expect(sanitizeSurveyUrl(undefined, "k", "pollfish")).toBe("");
  });

  it("returns '' for a malformed URL", () => {
    expect(sanitizeSurveyUrl("not a url", undefined, "pollfish")).toBe("");
  });

  it("drops non-https URLs", () => {
    expect(sanitizeSurveyUrl("http://wss.pollfish.com/s/1", undefined, "pollfish")).toBe("");
  });

  it("drops URLs whose host is not on the provider allowlist", () => {
    expect(sanitizeSurveyUrl("https://evil.example.com/s/1", undefined, "pollfish")).toBe("");
  });

  it("accepts a subdomain of a trusted host", () => {
    const out = sanitizeSurveyUrl("https://wss.pollfish.com/link?survey_id=1", undefined, "pollfish");
    expect(out).toBe("https://wss.pollfish.com/link?survey_id=1");
  });

  it("treats an unknown provider as having no allowlist (drops everything)", () => {
    expect(sanitizeSurveyUrl("https://wss.pollfish.com/s/1", undefined, "nope")).toBe("");
  });

  it("skips the host check when no provider is supplied", () => {
    const out = sanitizeSurveyUrl("https://anything.example.com/s/1", undefined);
    expect(out).toBe("https://anything.example.com/s/1");
  });

  it("strips the API key when it appears as a query parameter value", () => {
    const out = sanitizeSurveyUrl(
      "https://survey.cint.com/s?api_key=SECRET123&id=9",
      "SECRET123",
      "cint",
    );
    expect(out).not.toContain("SECRET123");
    expect(out).toContain("id=9");
  });

  it("strips the API key when it appears as a path segment", () => {
    const out = sanitizeSurveyUrl(
      "https://survey.cint.com/v1/SECRET123/start",
      "SECRET123",
      "cint",
    );
    expect(out).not.toContain("SECRET123");
    expect(out).toContain("/v1/start");
  });

  it("leaves a clean trusted URL unchanged when the API key is absent from it", () => {
    const url = "https://survey.cint.com/s?id=9";
    expect(sanitizeSurveyUrl(url, "SECRET123", "cint")).toBe(url);
  });
});

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
