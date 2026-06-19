import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// beginSpin/completeSpin call apiRequestSafe (the non-throwing variant) so they
// can branch on the raw status. Mock that module to feed scripted responses and
// to count how many times the spin endpoints are hit.
const apiRequestSafe = vi.fn();
vi.mock("./query-client", () => ({
  apiRequest: vi.fn(),
  apiRequestSafe: (...args: any[]) => apiRequestSafe(...args),
}));

// completeSpin's success path persists the issued token via AsyncStorage. Back it
// with an in-memory store so the happy path runs under Node without React Native.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

import { beginSpin, completeSpin } from "./earn-client";

// ── Mock Response builders ────────────────────────────────────────────────────
// isRetryable503 inspects a 503 by reading res.clone().json().retryable, so the
// retryable builder must supply a clone() whose json() returns { retryable: true }.
function okRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    clone() {
      return this;
    },
  } as unknown as Response;
}

function retryable503(): Response {
  return {
    ok: false,
    status: 503,
    json: async () => ({ retryable: true }),
    clone() {
      return { json: async () => ({ retryable: true }) };
    },
  } as unknown as Response;
}

function nonRetryable(status: number): Response {
  // Either a non-503 status, or a 503 whose body does not flag retryable.
  const body = status === 503 ? { retryable: false } : { error: "nope" };
  return {
    ok: false,
    status,
    json: async () => body,
    clone() {
      return { json: async () => body };
    },
  } as unknown as Response;
}

// Queue scripted responses; each call to apiRequestSafe shifts the next one.
function scriptResponses(responses: Response[]): void {
  let i = 0;
  apiRequestSafe.mockImplementation(async () => {
    const res = responses[i] ?? responses[responses.length - 1];
    i += 1;
    return res;
  });
}

beforeEach(() => {
  store.clear();
  apiRequestSafe.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Drive a retrying call to completion under fake timers: kick it off, flush all
// scheduled backoff timers (and the microtasks between them), then await.
async function runWithTimers<T>(start: () => Promise<T>): Promise<T> {
  const p = start();
  await vi.runAllTimersAsync();
  return p;
}

const SPIN_CHALLENGE = "chal-123";

describe("beginSpin quietly retries a retryable 503", () => {
  it("retries after a retryable 503 and succeeds when a later attempt returns 2xx", async () => {
    scriptResponses([
      retryable503(),
      okRes({ challengeToken: SPIN_CHALLENGE, points: 10 }),
    ]);

    const result = await runWithTimers(() => beginSpin());

    expect(result).toEqual({ ok: true, challengeToken: SPIN_CHALLENGE, points: 10 });
    expect(apiRequestSafe).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the third attempt after two retryable 503s", async () => {
    scriptResponses([
      retryable503(),
      retryable503(),
      okRes({ challengeToken: SPIN_CHALLENGE, points: 10 }),
    ]);

    const result = await runWithTimers(() => beginSpin());

    expect(result).toEqual({ ok: true, challengeToken: SPIN_CHALLENGE, points: 10 });
    expect(apiRequestSafe).toHaveBeenCalledTimes(3);
  });

  it("stops after the max attempts and returns { ok: false, retryable: true }", async () => {
    scriptResponses([retryable503(), retryable503(), retryable503()]);

    const result = await runWithTimers(() => beginSpin());

    expect(result).toEqual({ ok: false, retryable: true });
    // Exactly 3 attempts — no fourth call.
    expect(apiRequestSafe).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable 403 and reports retryable: false", async () => {
    scriptResponses([nonRetryable(403)]);

    const result = await runWithTimers(() => beginSpin());

    expect(result).toEqual({ ok: false, retryable: false });
    expect(apiRequestSafe).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 429 rate-limit and reports retryable: false", async () => {
    scriptResponses([nonRetryable(429)]);

    const result = await runWithTimers(() => beginSpin());

    expect(result).toEqual({ ok: false, retryable: false });
    expect(apiRequestSafe).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 503 whose body is not flagged retryable", async () => {
    scriptResponses([nonRetryable(503)]);

    const result = await runWithTimers(() => beginSpin());

    expect(result).toEqual({ ok: false, retryable: false });
    expect(apiRequestSafe).toHaveBeenCalledTimes(1);
  });

  it("treats a 2xx response without a challengeToken as a non-retryable failure", async () => {
    scriptResponses([okRes({})]);

    const result = await runWithTimers(() => beginSpin());

    expect(result).toEqual({ ok: false, retryable: false });
    expect(apiRequestSafe).toHaveBeenCalledTimes(1);
  });
});

describe("completeSpin quietly retries a retryable 503", () => {
  const claimableAt = new Date("2026-06-04T12:00:00.000Z").toISOString();

  it("retries after a retryable 503 and returns the issued token on a later 2xx", async () => {
    scriptResponses([
      retryable503(),
      okRes({ tokenId: "tok-1", points: 50, claimableAt }),
    ]);

    const result = await runWithTimers(() => completeSpin(SPIN_CHALLENGE));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.id).toBe("tok-1");
      expect(result.token.points).toBe(50);
      expect(result.token.actionType).toBe("spin");
    }
    expect(apiRequestSafe).toHaveBeenCalledTimes(2);
  });

  it("retries with the SAME challenge token across attempts", async () => {
    scriptResponses([
      retryable503(),
      okRes({ tokenId: "tok-2", points: 25, claimableAt }),
    ]);

    await runWithTimers(() => completeSpin(SPIN_CHALLENGE));

    // The transient failure leaves the challenge intact server-side, so every
    // retry must replay the original token rather than dropping it.
    for (const call of apiRequestSafe.mock.calls) {
      expect(call[0]).toBe("POST");
      expect(call[1]).toBe("/api/earn/spin/complete");
      expect(call[2]).toEqual({ challengeToken: SPIN_CHALLENGE });
    }
  });

  it("stops after the max attempts and returns { ok: false, retryable: true }", async () => {
    scriptResponses([retryable503(), retryable503(), retryable503()]);

    const result = await runWithTimers(() => completeSpin(SPIN_CHALLENGE));

    expect(result).toEqual({ ok: false, retryable: true });
    expect(apiRequestSafe).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable 403 and reports retryable: false", async () => {
    scriptResponses([nonRetryable(403)]);

    const result = await runWithTimers(() => completeSpin(SPIN_CHALLENGE));

    expect(result).toEqual({ ok: false, retryable: false });
    expect(apiRequestSafe).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 429 rate-limit and reports retryable: false", async () => {
    scriptResponses([nonRetryable(429)]);

    const result = await runWithTimers(() => completeSpin(SPIN_CHALLENGE));

    expect(result).toEqual({ ok: false, retryable: false });
    expect(apiRequestSafe).toHaveBeenCalledTimes(1);
  });
});
