import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";

let verifyProviderCompletion: typeof import("./surveyProviders").verifyProviderCompletion;
let buildCpxWallUrl: typeof import("./surveyProviders").buildCpxWallUrl;
let parseProviderReward: typeof import("./surveyProviders").parseProviderReward;

beforeAll(async () => {
  const mod = await import("./surveyProviders");
  verifyProviderCompletion = mod.verifyProviderCompletion;
  buildCpxWallUrl = mod.buildCpxWallUrl;
  parseProviderReward = mod.parseProviderReward;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verifyProviderCompletion — guard clauses", () => {
  it("rejects an empty transactionId immediately without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await verifyProviderCompletion({
      surveyId: "cpx_123",
      provider: "cpx",
      userId: "u1",
      transactionId: "",
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/transactionId is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only transactionId", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await verifyProviderCompletion({
      surveyId: "cpx_123",
      provider: "cpx",
      userId: "u1",
      transactionId: "   ",
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/transactionId is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns not-configured error when the provider has no API key set", async () => {
    vi.unstubAllEnvs();
    const result = await verifyProviderCompletion({
      surveyId: "pollfish_abc",
      provider: "pollfish",
      userId: "u1",
      transactionId: "txn-001",
    });
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });
});

describe("verifyProviderCompletion — reward propagation", () => {
  it("propagates the reward field from the upstream provider response body (CPX)", async () => {
    vi.stubEnv("CPX_API_KEY", "key-reward-contract");
    vi.stubEnv("CPX_APP_ID", "app-reward-contract");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "txn-reward-contract",
            user_id: "u-reward-contract",
            reward: 9.99,
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cpx_reward-contract",
      provider: "cpx",
      userId: "u-reward-contract",
      transactionId: "txn-reward-contract",
    });

    expect(result.verified).toBe(true);
    expect(result.reward).toBe(9.99);
  });

  it("returns reward=0 when the upstream body has no reward field (CPX)", async () => {
    vi.stubEnv("CPX_API_KEY", "key-reward-zero");
    vi.stubEnv("CPX_APP_ID", "app-reward-zero");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "txn-reward-zero",
            user_id: "u-reward-zero",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cpx_reward-zero",
      provider: "cpx",
      userId: "u-reward-zero",
      transactionId: "txn-reward-zero",
    });

    expect(result.verified).toBe(true);
    expect(result.reward).toBe(0);
  });

  it("propagates a payout field from Pollfish when upstream returns one", async () => {
    vi.stubEnv("POLLFISH_API_KEY", "test-pollfish-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "poll-reward-txn",
            user_id: "poll-reward-user",
            payout: 1.25,
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "pollfish_s1",
      provider: "pollfish",
      userId: "poll-reward-user",
      transactionId: "poll-reward-txn",
    });

    expect(result.verified).toBe(true);
    expect(result.reward).toBe(1.25);
  });

  it("propagates a reward field from BitLabs when upstream returns one", async () => {
    vi.stubEnv("BITLABS_API_KEY", "test-bitlabs-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "bl-reward-txn",
            user_id: "bl-reward-user",
            reward: 0.75,
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "bitlabs_s1",
      provider: "bitlabs",
      userId: "bl-reward-user",
      transactionId: "bl-reward-txn",
    });

    expect(result.verified).toBe(true);
    expect(result.reward).toBe(0.75);
  });

  it("propagates a reward field from Cint when upstream returns one", async () => {
    vi.stubEnv("CINT_API_KEY", "test-cint-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "cint-reward-txn",
            respondent_id: "cint-reward-user",
            reward: 2.00,
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cint_s1",
      provider: "cint",
      userId: "cint-reward-user",
      transactionId: "cint-reward-txn",
    });

    expect(result.verified).toBe(true);
    expect(result.reward).toBe(2.00);
  });

  it("propagates a reward field from Lucid when upstream returns one", async () => {
    vi.stubEnv("LUCID_API_KEY", "test-lucid-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "lucid-reward-txn",
            respondent_id: "lucid-reward-user",
            reward: 1.50,
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "lucid_s1",
      provider: "lucid",
      userId: "lucid-reward-user",
      transactionId: "lucid-reward-txn",
    });

    expect(result.verified).toBe(true);
    expect(result.reward).toBe(1.50);
  });

  it("returns reward=0 when the upstream body is empty (network/parse error path)", async () => {
    vi.stubEnv("POLLFISH_API_KEY", "test-pollfish-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "pollfish_s1",
      provider: "pollfish",
      userId: "u1",
      transactionId: "txn-empty",
    });

    expect(result.verified).toBe(false);
    expect(result.reward).toBe(0);
  });

  it("falls back to 0 when the upstream reward field is a non-positive number", async () => {
    vi.stubEnv("CPX_API_KEY", "key-reward-neg");
    vi.stubEnv("CPX_APP_ID", "app-reward-neg");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "txn-reward-neg",
            user_id: "u-reward-neg",
            reward: -5,
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cpx_reward-neg",
      provider: "cpx",
      userId: "u-reward-neg",
      transactionId: "txn-reward-neg",
    });

    expect(result.verified).toBe(true);
    expect(result.reward).toBe(0);
  });
});

describe("verifyProviderCompletion — token-based path (Bearer / X-Api-Key)", () => {
  it("returns verified=true for pollfish when upstream responds with completed status", async () => {
    vi.stubEnv("POLLFISH_API_KEY", "test-pollfish-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "txn-poll-1",
            user_id: "u99",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "pollfish_survey-abc",
      provider: "pollfish",
      userId: "u99",
      transactionId: "txn-poll-1",
    });

    expect(result.verified).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns verified=false for pollfish when upstream responds with non-ok HTTP status", async () => {
    vi.stubEnv("POLLFISH_API_KEY", "test-pollfish-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "pollfish_survey-abc",
      provider: "pollfish",
      userId: "u99",
      transactionId: "txn-poll-2",
    });

    expect(result.verified).toBe(false);
  });

  it("returns verified=true for bitlabs when upstream confirms with transactionId + userId", async () => {
    vi.stubEnv("BITLABS_API_KEY", "test-bitlabs-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "txn-bl-7",
            user_id: "user-42",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "bitlabs_s1",
      provider: "bitlabs",
      userId: "user-42",
      transactionId: "txn-bl-7",
    });

    expect(result.verified).toBe(true);
  });

  it("returns verified=false when upstream returns a mismatched transactionId", async () => {
    vi.stubEnv("BITLABS_API_KEY", "test-bitlabs-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "DIFFERENT-TXN",
            user_id: "user-42",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "bitlabs_s1",
      provider: "bitlabs",
      userId: "user-42",
      transactionId: "txn-bl-7",
    });

    expect(result.verified).toBe(false);
  });

  it("returns verified=false when upstream returns a mismatched userId", async () => {
    vi.stubEnv("BITLABS_API_KEY", "test-bitlabs-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "txn-bl-7",
            user_id: "ATTACKER-ID",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "bitlabs_s1",
      provider: "bitlabs",
      userId: "user-42",
      transactionId: "txn-bl-7",
    });

    expect(result.verified).toBe(false);
  });

  it("returns verified=false when fetch throws (network error)", async () => {
    vi.stubEnv("POLLFISH_API_KEY", "test-pollfish-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unavailable"))
    );

    const result = await verifyProviderCompletion({
      surveyId: "pollfish_survey-abc",
      provider: "pollfish",
      userId: "u99",
      transactionId: "txn-net-fail",
    });

    expect(result.verified).toBe(false);
  });
});

describe("verifyProviderCompletion — CPX HMAC path", () => {
  it("returns verified=true for cpx when upstream confirms with matching ids", async () => {
    vi.stubEnv("CPX_API_KEY", "secret-cpx-key");
    vi.stubEnv("CPX_APP_ID", "app-999");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "cpx-txn-5",
            user_id: "cpx-user-1",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cpx_survey-5",
      provider: "cpx",
      userId: "cpx-user-1",
      transactionId: "cpx-txn-5",
    });

    expect(result.verified).toBe(true);
  });

  it("returns verified=false for cpx when CPX_APP_ID is missing", async () => {
    vi.stubEnv("CPX_API_KEY", "secret-cpx-key");
    vi.stubEnv("CPX_APP_ID", "");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: "completed", transaction_id: "cpx-txn-5", user_id: "cpx-user-1" }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cpx_survey-5",
      provider: "cpx",
      userId: "cpx-user-1",
      transactionId: "cpx-txn-5",
    });

    expect(result.verified).toBe(false);
  });

  it("includes the MD5 secure_hash in the CPX verification request URL", async () => {
    vi.stubEnv("CPX_API_KEY", "myapikey");
    vi.stubEnv("CPX_APP_ID", "app-1");

    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              status: "completed",
              transaction_id: "txn-hash-check",
              user_id: "uid-hash-check",
            }),
        };
      })
    );

    await verifyProviderCompletion({
      surveyId: "cpx_s1",
      provider: "cpx",
      userId: "uid-hash-check",
      transactionId: "txn-hash-check",
    });

    expect(capturedUrl).toContain("secure_hash=");
    expect(capturedUrl).toContain("ext_user_id=uid-hash-check");
    expect(capturedUrl).toContain("trans_id=txn-hash-check");
  });
});

describe("verifyProviderCompletion — Cint path", () => {
  it("returns verified=true when Cint upstream confirms completion with matching transactionId", async () => {
    vi.stubEnv("CINT_API_KEY", "test-cint-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "cint-txn-1",
            respondent_id: "user-cint-1",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cint_survey-1",
      provider: "cint",
      userId: "user-cint-1",
      transactionId: "cint-txn-1",
    });

    expect(result.verified).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns verified=false when Cint upstream returns HTTP 4xx", async () => {
    vi.stubEnv("CINT_API_KEY", "test-cint-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cint_survey-1",
      provider: "cint",
      userId: "user-cint-1",
      transactionId: "cint-txn-1",
    });

    expect(result.verified).toBe(false);
  });

  it("returns verified=false when Cint upstream returns a mismatched transactionId", async () => {
    vi.stubEnv("CINT_API_KEY", "test-cint-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "WRONG-TXN",
            respondent_id: "user-cint-1",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "cint_survey-1",
      provider: "cint",
      userId: "user-cint-1",
      transactionId: "cint-txn-1",
    });

    expect(result.verified).toBe(false);
  });

  it("returns verified=false when fetch throws a network error for Cint", async () => {
    vi.stubEnv("CINT_API_KEY", "test-cint-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unavailable"))
    );

    const result = await verifyProviderCompletion({
      surveyId: "cint_survey-1",
      provider: "cint",
      userId: "user-cint-1",
      transactionId: "cint-txn-1",
    });

    expect(result.verified).toBe(false);
  });
});

describe("verifyProviderCompletion — Lucid path", () => {
  it("returns verified=true when Lucid upstream confirms completion with matching transactionId", async () => {
    vi.stubEnv("LUCID_API_KEY", "test-lucid-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "lucid-txn-1",
            respondent_id: "user-lucid-1",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "lucid_survey-1",
      provider: "lucid",
      userId: "user-lucid-1",
      transactionId: "lucid-txn-1",
    });

    expect(result.verified).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns verified=false when Lucid upstream returns HTTP 4xx", async () => {
    vi.stubEnv("LUCID_API_KEY", "test-lucid-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "",
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "lucid_survey-1",
      provider: "lucid",
      userId: "user-lucid-1",
      transactionId: "lucid-txn-1",
    });

    expect(result.verified).toBe(false);
  });

  it("returns verified=false when Lucid upstream returns a mismatched transactionId", async () => {
    vi.stubEnv("LUCID_API_KEY", "test-lucid-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            status: "completed",
            transaction_id: "WRONG-TXN",
            respondent_id: "user-lucid-1",
          }),
      })
    );

    const result = await verifyProviderCompletion({
      surveyId: "lucid_survey-1",
      provider: "lucid",
      userId: "user-lucid-1",
      transactionId: "lucid-txn-1",
    });

    expect(result.verified).toBe(false);
  });

  it("returns verified=false when fetch throws a network error for Lucid", async () => {
    vi.stubEnv("LUCID_API_KEY", "test-lucid-key");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unavailable"))
    );

    const result = await verifyProviderCompletion({
      surveyId: "lucid_survey-1",
      provider: "lucid",
      userId: "user-lucid-1",
      transactionId: "lucid-txn-1",
    });

    expect(result.verified).toBe(false);
  });
});

describe("verifyProviderCompletion — Cint URL and header shape", () => {
  it("sends the request to the Cint API domain containing the survey ID", async () => {
    vi.stubEnv("CINT_API_KEY", "test-cint-key");

    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              status: "completed",
              transaction_id: "cint-url-txn",
              respondent_id: "cint-url-user",
            }),
        };
      })
    );

    await verifyProviderCompletion({
      surveyId: "cint_survey-cint-url",
      provider: "cint",
      userId: "cint-url-user",
      transactionId: "cint-url-txn",
    });

    expect(capturedUrl).toContain("api.cint.com");
    expect(capturedUrl).toContain("survey-cint-url");
  });

  it("sends the CINT_API_KEY as the X-Api-Key header value", async () => {
    vi.stubEnv("CINT_API_KEY", "test-cint-key");

    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          Object.entries((init?.headers as Record<string, string>) ?? {})
        );
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              status: "completed",
              transaction_id: "cint-hdr-txn",
              respondent_id: "cint-hdr-user",
            }),
        };
      })
    );

    await verifyProviderCompletion({
      surveyId: "cint_survey-cint-hdr",
      provider: "cint",
      userId: "cint-hdr-user",
      transactionId: "cint-hdr-txn",
    });

    expect(capturedHeaders["X-Api-Key"]).toBe("test-cint-key");
  });
});

describe("verifyProviderCompletion — Lucid URL and header shape", () => {
  it("sends the request to the Lucid (samplicio.us) API domain containing the survey ID", async () => {
    vi.stubEnv("LUCID_API_KEY", "test-lucid-key");

    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              status: "completed",
              transaction_id: "lucid-url-txn",
              respondent_id: "lucid-url-user",
            }),
        };
      })
    );

    await verifyProviderCompletion({
      surveyId: "lucid_survey-lucid-url",
      provider: "lucid",
      userId: "lucid-url-user",
      transactionId: "lucid-url-txn",
    });

    expect(capturedUrl).toContain("api.samplicio.us");
    expect(capturedUrl).toContain("survey-lucid-url");
  });

  it("sends the LUCID_API_KEY as the Authorization header value", async () => {
    vi.stubEnv("LUCID_API_KEY", "test-lucid-key");

    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          Object.entries((init?.headers as Record<string, string>) ?? {})
        );
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              status: "completed",
              transaction_id: "lucid-hdr-txn",
              respondent_id: "lucid-hdr-user",
            }),
        };
      })
    );

    await verifyProviderCompletion({
      surveyId: "lucid_survey-lucid-hdr",
      provider: "lucid",
      userId: "lucid-hdr-user",
      transactionId: "lucid-hdr-txn",
    });

    expect(capturedHeaders["Authorization"]).toBe("test-lucid-key");
  });
});

describe("verifyProviderCompletion — Pollfish Authorization header shape", () => {
  it("sends the POLLFISH_API_KEY as a Bearer token in the Authorization header", async () => {
    vi.stubEnv("POLLFISH_API_KEY", "test-pollfish-key");

    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          Object.entries((init?.headers as Record<string, string>) ?? {})
        );
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              status: "completed",
              transaction_id: "poll-hdr-txn",
              user_id: "poll-hdr-user",
            }),
        };
      })
    );

    await verifyProviderCompletion({
      surveyId: "pollfish_survey-poll-hdr",
      provider: "pollfish",
      userId: "poll-hdr-user",
      transactionId: "poll-hdr-txn",
    });

    expect(capturedHeaders["Authorization"]).toBe("Bearer test-pollfish-key");
  });
});

describe("verifyProviderCompletion — BitLabs X-Api-Token header", () => {
  it("sends the BITLABS_API_KEY as the X-Api-Token header value", async () => {
    vi.stubEnv("BITLABS_API_KEY", "secret-bitlabs-key-abc");

    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          Object.entries((init?.headers as Record<string, string>) ?? {})
        );
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              status: "completed",
              transaction_id: "bl-header-txn",
              user_id: "bl-header-user",
            }),
        };
      })
    );

    await verifyProviderCompletion({
      surveyId: "bitlabs_s99",
      provider: "bitlabs",
      userId: "bl-header-user",
      transactionId: "bl-header-txn",
    });

    expect(capturedHeaders["X-Api-Token"]).toBe("secret-bitlabs-key-abc");
  });
});

describe("buildCpxWallUrl — HMAC signature in wall URL", () => {
  it("embeds app_id, ext_user_id, and secure_hash in the wall URL", () => {
    const url = buildCpxWallUrl("user-1", "app-99", "mykey");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("app_id")).toBe("app-99");
    expect(parsed.searchParams.get("ext_user_id")).toBe("user-1");
    expect(parsed.searchParams.get("secure_hash")).toBeTruthy();
  });

  it("produces a deterministic MD5 hash for the same inputs", () => {
    const url1 = buildCpxWallUrl("u1", "app1", "key1");
    const url2 = buildCpxWallUrl("u1", "app1", "key1");
    const hash1 = new URL(url1).searchParams.get("secure_hash");
    const hash2 = new URL(url2).searchParams.get("secure_hash");
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces a different hash when userId changes", () => {
    const url1 = buildCpxWallUrl("userA", "app1", "key1");
    const url2 = buildCpxWallUrl("userB", "app1", "key1");
    const hash1 = new URL(url1).searchParams.get("secure_hash");
    const hash2 = new URL(url2).searchParams.get("secure_hash");
    expect(hash1).not.toBe(hash2);
  });

  it("includes optional username and email when provided", () => {
    const url = buildCpxWallUrl("u1", "app1", "key1", "alice", "alice@example.com");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("username")).toBe("alice");
    expect(parsed.searchParams.get("email")).toBe("alice@example.com");
  });

  it("omits username/email params when not provided", () => {
    const url = buildCpxWallUrl("u1", "app1", "key1");
    const parsed = new URL(url);
    expect(parsed.searchParams.has("username")).toBe(false);
    expect(parsed.searchParams.has("email")).toBe(false);
  });
});

describe("parseProviderReward", () => {
  it("returns a positive number as-is", () => {
    expect(parseProviderReward(1.5)).toBe(1.5);
  });

  it("returns a positive integer as-is", () => {
    expect(parseProviderReward(10)).toBe(10);
  });

  it("parses a positive numeric string", () => {
    expect(parseProviderReward("2.75")).toBe(2.75);
  });

  it("parses a positive integer string", () => {
    expect(parseProviderReward("5")).toBe(5);
  });

  it("returns undefined for zero (number)", () => {
    expect(parseProviderReward(0)).toBeUndefined();
  });

  it("returns undefined for a negative number", () => {
    expect(parseProviderReward(-1)).toBeUndefined();
  });

  it("returns undefined for NaN", () => {
    expect(parseProviderReward(NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(parseProviderReward(Infinity)).toBeUndefined();
  });

  it("returns undefined for -Infinity", () => {
    expect(parseProviderReward(-Infinity)).toBeUndefined();
  });

  it("returns undefined for string \"Infinity\"", () => {
    expect(parseProviderReward("Infinity")).toBeUndefined();
  });

  it("returns undefined for a negative numeric string", () => {
    expect(parseProviderReward("-5.00")).toBeUndefined();
  });

  it("returns undefined for string \"0\"", () => {
    expect(parseProviderReward("0")).toBeUndefined();
  });

  it("returns undefined for a non-numeric string", () => {
    expect(parseProviderReward("abc")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(parseProviderReward(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(parseProviderReward(undefined)).toBeUndefined();
  });

  it("returns undefined for a boolean true", () => {
    expect(parseProviderReward(true)).toBeUndefined();
  });

  it("returns undefined for a boolean false", () => {
    expect(parseProviderReward(false)).toBeUndefined();
  });

  it("returns undefined for a plain object", () => {
    expect(parseProviderReward({ amount: 1.5 })).toBeUndefined();
  });

  it("returns undefined for an array", () => {
    expect(parseProviderReward([1.5])).toBeUndefined();
  });
});
