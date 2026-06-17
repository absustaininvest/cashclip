import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import crypto from "node:crypto";
import type { Request } from "express";

const insertWebhookAuditMock = vi.fn(async (entry: unknown) => ({
  id: "audit-1",
  ...(entry as Record<string, unknown>),
  createdAt: new Date(),
}));

const countWebhookAuditByIpMock = vi.fn(async (_ip: string, _since: Date) => 0);

vi.mock("../storage", () => ({
  storage: {
    insertWebhookAudit: insertWebhookAuditMock,
    countWebhookAuditByIp: countWebhookAuditByIpMock,
  },
}));

const SECRETS = {
  POLLFISH_WEBHOOK_SECRET: "pollfish-secret-xyz",
  CINT_WEBHOOK_SECRET: "cint-secret-xyz",
  LUCID_WEBHOOK_SECRET: "lucid-secret-xyz",
  TAPJOY_WEBHOOK_SECRET: "tapjoy-secret-xyz",
  ADGATE_WEBHOOK_SECRET: "adgate-secret-xyz",
  OFFERTORO_WEBHOOK_SECRET: "offertoro-secret-xyz",
  CPX_API_KEY: "cpx-secure-hash-xyz",
};

beforeAll(() => {
  for (const [k, v] of Object.entries(SECRETS)) {
    process.env[k] = v;
  }
});

let verifyWebhook: typeof import("./webhookAuth").verifyWebhook;
let reloadWebhookSecrets: typeof import("./webhookAuth").reloadWebhookSecrets;
let isWebhookSecretConfigured: typeof import("./webhookAuth").isWebhookSecretConfigured;
let logWebhookVerificationFailure: typeof import("./webhookAuth").logWebhookVerificationFailure;

beforeAll(async () => {
  const mod = await import("./webhookAuth");
  verifyWebhook = mod.verifyWebhook;
  reloadWebhookSecrets = mod.reloadWebhookSecrets;
  isWebhookSecretConfigured = mod.isWebhookSecretConfigured;
  logWebhookVerificationFailure = mod.logWebhookVerificationFailure;
});

beforeEach(() => {
  for (const [k, v] of Object.entries(SECRETS)) {
    process.env[k] = v;
  }
  reloadWebhookSecrets();
  insertWebhookAuditMock.mockClear();
  countWebhookAuditByIpMock.mockClear();
  countWebhookAuditByIpMock.mockResolvedValue(0);
});

function makeReq(opts: {
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: Buffer;
  method?: string;
  ip?: string;
} = {}): Request {
  return {
    query: opts.query ?? {},
    headers: opts.headers ?? {},
    body: opts.body,
    rawBody: opts.rawBody,
    method: opts.method ?? "POST",
    path: "/webhook",
    originalUrl: "/webhook",
    ip: opts.ip ?? "127.0.0.1",
    socket: { remoteAddress: opts.ip ?? "127.0.0.1" },
  } as unknown as Request;
}

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const hmac = (secret: string, payload: Buffer | string) =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

describe("verifyWebhook — generic providers (token + HMAC-SHA256)", () => {
  for (const provider of ["pollfish", "cint", "lucid"] as const) {
    describe(provider, () => {
      const secret = SECRETS[`${provider.toUpperCase()}_WEBHOOK_SECRET` as keyof typeof SECRETS];

      it("accepts a matching ?secret= token", () => {
        const res = verifyWebhook(provider, makeReq({ query: { secret } }));
        expect(res.ok).toBe(true);
      });

      it("accepts a matching ?token= token", () => {
        const res = verifyWebhook(provider, makeReq({ query: { token: secret } }));
        expect(res.ok).toBe(true);
      });

      it("accepts a matching ?sig= token", () => {
        const res = verifyWebhook(provider, makeReq({ query: { sig: secret } }));
        expect(res.ok).toBe(true);
      });

      it("rejects an incorrect token", () => {
        const res = verifyWebhook(provider, makeReq({ query: { secret: "wrong" } }));
        expect(res.ok).toBe(false);
        expect(res.reason).toMatch(/Invalid webhook signature\/token/);
      });

      it("accepts a valid x-webhook-signature HMAC over rawBody", () => {
        const rawBody = Buffer.from(JSON.stringify({ user: "u1", amount: 1 }));
        const sig = hmac(secret, rawBody);
        const res = verifyWebhook(
          provider,
          makeReq({ headers: { "x-webhook-signature": sig }, rawBody }),
        );
        expect(res.ok).toBe(true);
      });

      it("accepts a valid x-signature HMAC", () => {
        const rawBody = Buffer.from("payload");
        const sig = hmac(secret, rawBody);
        const res = verifyWebhook(
          provider,
          makeReq({ headers: { "x-signature": sig }, rawBody }),
        );
        expect(res.ok).toBe(true);
      });

      it("accepts a valid x-hub-signature-256 with sha256= prefix", () => {
        const rawBody = Buffer.from("payload");
        const sig = hmac(secret, rawBody);
        const res = verifyWebhook(
          provider,
          makeReq({
            headers: { "x-hub-signature-256": `sha256=${sig}` },
            rawBody,
          }),
        );
        expect(res.ok).toBe(true);
      });

      it("falls back to JSON.stringify(body) when rawBody is missing", () => {
        const body = { user: "u1", amount: 5 };
        const sig = hmac(secret, Buffer.from(JSON.stringify(body)));
        const res = verifyWebhook(
          provider,
          makeReq({ headers: { "x-webhook-signature": sig }, body }),
        );
        expect(res.ok).toBe(true);
      });

      it("rejects a tampered HMAC signature", () => {
        const rawBody = Buffer.from("payload");
        const sig = hmac(secret, rawBody);
        const tampered = sig.slice(0, -2) + (sig.endsWith("a") ? "bb" : "aa");
        const res = verifyWebhook(
          provider,
          makeReq({ headers: { "x-webhook-signature": tampered }, rawBody }),
        );
        expect(res.ok).toBe(false);
      });

      it("rejects HMAC computed over a different payload", () => {
        const rawBody = Buffer.from("real-payload");
        const sig = hmac(secret, Buffer.from("other-payload"));
        const res = verifyWebhook(
          provider,
          makeReq({ headers: { "x-webhook-signature": sig }, rawBody }),
        );
        expect(res.ok).toBe(false);
      });

      it("rejects when no token and no signature header are provided", () => {
        const res = verifyWebhook(provider, makeReq({}));
        expect(res.ok).toBe(false);
      });
    });
  }
});

describe("verifyWebhook — tapjoy (MD5 verifier)", () => {
  const secret = SECRETS.TAPJOY_WEBHOOK_SECRET;

  it("accepts a valid verifier hash using id/snuid/currency", () => {
    const id = "offer-123";
    const snuid = "user-456";
    const currency = "100";
    const verifier = md5(`${id}:${snuid}:${currency}:${secret}`);
    const res = verifyWebhook(
      "tapjoy",
      makeReq({ query: { id, snuid, currency, verifier } }),
    );
    expect(res.ok).toBe(true);
  });

  it("accepts the offer_id/user_id/amount aliases", () => {
    const offer_id = "offer-9";
    const user_id = "user-9";
    const amount = "50";
    const verifier = md5(`${offer_id}:${user_id}:${amount}:${secret}`);
    const res = verifyWebhook(
      "tapjoy",
      makeReq({ query: { offer_id, user_id, amount, verifier } }),
    );
    expect(res.ok).toBe(true);
  });

  it("rejects a verifier with the wrong secret", () => {
    const verifier = md5(`a:b:c:WRONG-SECRET`);
    const res = verifyWebhook(
      "tapjoy",
      makeReq({ query: { id: "a", snuid: "b", currency: "c", verifier } }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Invalid provider-specific signature/);
  });

  it("rejects when verifier is missing", () => {
    const res = verifyWebhook(
      "tapjoy",
      makeReq({ query: { id: "a", snuid: "b", currency: "c" } }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects when query params are tampered", () => {
    const verifier = md5(`a:b:c:${secret}`);
    const res = verifyWebhook(
      "tapjoy",
      makeReq({ query: { id: "a", snuid: "b", currency: "TAMPERED", verifier } }),
    );
    expect(res.ok).toBe(false);
  });

  it("does NOT fall back to generic token/HMAC verification", () => {
    const res = verifyWebhook(
      "tapjoy",
      makeReq({ query: { secret } }),
    );
    expect(res.ok).toBe(false);
  });
});

describe("verifyWebhook — adgate (MD5 hash_value)", () => {
  const secret = SECRETS.ADGATE_WEBHOOK_SECRET;

  it("accepts a valid hash_value from query string", () => {
    const transaction_id = "tx-1";
    const user_id = "u-1";
    const payout = "0.25";
    const hash_value = md5(`${transaction_id}${user_id}${payout}${secret}`);
    const res = verifyWebhook(
      "adgate",
      makeReq({ query: { transaction_id, user_id, payout, hash_value } }),
    );
    expect(res.ok).toBe(true);
  });

  it("accepts a valid hash_value from request body", () => {
    const transaction_id = "tx-2";
    const user_id = "u-2";
    const payout = "1.00";
    const hash_value = md5(`${transaction_id}${user_id}${payout}${secret}`);
    const res = verifyWebhook(
      "adgate",
      makeReq({ body: { transaction_id, user_id, payout, hash_value } }),
    );
    expect(res.ok).toBe(true);
  });

  it("falls back to offer_id when transaction_id is missing", () => {
    const offer_id = "off-1";
    const user_id = "u-3";
    const payout = "2.00";
    const hash_value = md5(`${offer_id}${user_id}${payout}${secret}`);
    const res = verifyWebhook(
      "adgate",
      makeReq({ query: { offer_id, user_id, payout, hash_value } }),
    );
    expect(res.ok).toBe(true);
  });

  it("rejects an invalid hash_value", () => {
    const res = verifyWebhook(
      "adgate",
      makeReq({
        query: {
          transaction_id: "tx",
          user_id: "u",
          payout: "1",
          hash_value: "deadbeef",
        },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Invalid provider-specific signature/);
  });

  it("rejects when hash_value is missing", () => {
    const res = verifyWebhook(
      "adgate",
      makeReq({ query: { transaction_id: "tx", user_id: "u", payout: "1" } }),
    );
    expect(res.ok).toBe(false);
  });
});

describe("verifyWebhook — offertoro (MD5 ot_sig)", () => {
  const secret = SECRETS.OFFERTORO_WEBHOOK_SECRET;

  it("accepts a valid ot_sig from query string", () => {
    const offer_id = "of-1";
    const user_id = "u-1";
    const payout = "0.50";
    const ot_sig = md5(`${offer_id}${user_id}${payout}${secret}`);
    const res = verifyWebhook(
      "offertoro",
      makeReq({ query: { offer_id, user_id, payout, ot_sig } }),
    );
    expect(res.ok).toBe(true);
  });

  it("accepts a valid ot_sig from request body", () => {
    const offer_id = "of-2";
    const user_id = "u-2";
    const payout = "3.00";
    const ot_sig = md5(`${offer_id}${user_id}${payout}${secret}`);
    const res = verifyWebhook(
      "offertoro",
      makeReq({ body: { offer_id, user_id, payout, ot_sig } }),
    );
    expect(res.ok).toBe(true);
  });

  it("rejects an invalid ot_sig", () => {
    const res = verifyWebhook(
      "offertoro",
      makeReq({
        query: { offer_id: "x", user_id: "y", payout: "1", ot_sig: "abc123" },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Invalid provider-specific signature/);
  });

  it("rejects when ot_sig is missing", () => {
    const res = verifyWebhook(
      "offertoro",
      makeReq({ query: { offer_id: "x", user_id: "y", payout: "1" } }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects when payout is tampered", () => {
    const ot_sig = md5(`o${"u"}${"1"}${secret}`);
    const res = verifyWebhook(
      "offertoro",
      makeReq({ query: { offer_id: "o", user_id: "u", payout: "999", ot_sig } }),
    );
    expect(res.ok).toBe(false);
  });
});

describe("verifyWebhook — configuration & unknown providers", () => {
  it("rejects unknown providers", () => {
    const res = verifyWebhook("not-a-provider", makeReq({}));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Unknown provider/);
  });

  it("rejects when secret is not configured", () => {
    delete process.env.POLLFISH_WEBHOOK_SECRET;
    reloadWebhookSecrets();
    const res = verifyWebhook(
      "pollfish",
      makeReq({ query: { secret: "anything" } }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/POLLFISH_WEBHOOK_SECRET not configured/);
    expect(res.reason).toMatch(/webhook crediting disabled/);
  });

  it("rejects provider-specific verification when secret is not configured", () => {
    delete process.env.TAPJOY_WEBHOOK_SECRET;
    reloadWebhookSecrets();
    const res = verifyWebhook(
      "tapjoy",
      makeReq({ query: { id: "a", snuid: "b", currency: "c", verifier: "x" } }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/TAPJOY_WEBHOOK_SECRET not configured/);
  });

  it("isWebhookSecretConfigured reflects current env", () => {
    expect(isWebhookSecretConfigured("cint")).toBe(true);
    delete process.env.CINT_WEBHOOK_SECRET;
    reloadWebhookSecrets();
    expect(isWebhookSecretConfigured("cint")).toBe(false);
    expect(isWebhookSecretConfigured("nope")).toBe(false);
  });
});

describe("verifyWebhook — timing-safe comparison", () => {
  it("does not throw when candidate length differs from secret length", () => {
    expect(() =>
      verifyWebhook(
        "pollfish",
        makeReq({ query: { secret: "x" } }),
      ),
    ).not.toThrow();
  });

  it("does not throw when HMAC signature lengths differ", () => {
    expect(() =>
      verifyWebhook(
        "pollfish",
        makeReq({
          headers: { "x-webhook-signature": "short" },
          rawBody: Buffer.from("anything"),
        }),
      ),
    ).not.toThrow();
  });
});

// Helper to flush all pending microtasks and macrotasks so fire-and-forget
// async chains (count check → insert) resolve before assertions.
async function flushAsync(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("logWebhookVerificationFailure", () => {
  beforeEach(() => {
    insertWebhookAuditMock.mockClear();
    countWebhookAuditByIpMock.mockClear();
    insertWebhookAuditMock.mockImplementation(async (entry: unknown) => ({
      id: "audit-1",
      ...(entry as Record<string, unknown>),
      createdAt: new Date(),
    }));
    countWebhookAuditByIpMock.mockResolvedValue(0);
  });

  it("returns a structured audit record (used by 403 rejection path)", () => {
    // getClientIp() returns the rightmost XFF entry (proxy-observed address).
    // The full XFF header is stored separately in forwardedFor for diagnostics.
    // Simulated proxy model: "203.0.113.5" is attacker-supplied; "10.10.10.10"
    // is the real TCP address appended by the trusted Replit proxy.
    const req = makeReq({
      ip: "10.10.10.10",
      headers: {
        "x-forwarded-for": "203.0.113.5, 10.10.10.10",
        "user-agent": "test-agent/1.0",
        "x-webhook-signature": "sig",
      },
    });
    const event = logWebhookVerificationFailure(req, "pollfish", "Invalid webhook signature/token for pollfish");
    expect(event.provider).toBe("pollfish");
    expect(event.reason).toMatch(/Invalid webhook/);
    expect(event.ip).toBe("10.10.10.10");
    expect(event.forwardedFor).toBe("203.0.113.5, 10.10.10.10");
    expect(event.method).toBe("POST");
    expect(event.hasSignatureHeader).toBe(true);
    expect(event.secretConfigured).toBe(true);
    expect(typeof event.timestamp).toBe("string");
  });

  it("reports secretConfigured=false when env var is missing", () => {
    delete process.env.LUCID_WEBHOOK_SECRET;
    reloadWebhookSecrets();
    const event = logWebhookVerificationFailure(makeReq({}), "lucid", "missing");
    expect(event.secretConfigured).toBe(false);
  });

  it("persists a row via storage.insertWebhookAudit with the request fields", async () => {
    // req.ip is the canonical IP used for both throttling and persisted ip column.
    // The raw x-forwarded-for header is preserved in forwardedFor for diagnostics.
    const req = makeReq({
      ip: "10.0.0.5",
      method: "POST",
      headers: {
        "x-forwarded-for": "198.51.100.7, 10.0.0.5",
        "user-agent": "evil-agent/2.0",
        "x-webhook-signature": "abc",
      },
    });
    (req as unknown as { originalUrl: string }).originalUrl = "/api/surveys/webhook/cint?secret=bad";
    logWebhookVerificationFailure(req, "cint", "Invalid webhook signature/token for cint");

    // Fire-and-forget: flush the count-check + insert promise chain.
    await flushAsync();

    expect(insertWebhookAuditMock).toHaveBeenCalledTimes(1);
    const arg = insertWebhookAuditMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      provider: "cint",
      reason: "Invalid webhook signature/token for cint",
      ip: "10.0.0.5",
      forwardedFor: "198.51.100.7, 10.0.0.5",
      userAgent: "evil-agent/2.0",
      method: "POST",
      path: "/api/surveys/webhook/cint",
      hasSignatureHeader: true,
      secretConfigured: true,
      statusCode: 401,
    });
  });

  it("persisted ip matches the throttle key (rightmost XFF), not leftmost x-forwarded-for", async () => {
    // Regression: both the throttle count query and the persisted row must use
    // the same canonical IP (rightmost XFF — the proxy-observed address) to
    // prevent counter/row divergence and to ensure header rotation cannot
    // produce a fresh counter key.
    //
    // Simulated proxy model: client sends "203.0.113.99" as a spoofed XFF;
    // the trusted Replit proxy appends the real TCP address "192.0.2.55",
    // producing the full header "203.0.113.99, 192.0.2.55".
    // getClientIp() returns the rightmost entry "192.0.2.55".
    const req = makeReq({
      ip: "192.0.2.55",
      headers: { "x-forwarded-for": "203.0.113.99, 192.0.2.55" },
    });
    countWebhookAuditByIpMock.mockResolvedValue(0);
    logWebhookVerificationFailure(req, "pollfish", "bad token");
    await flushAsync();

    expect(countWebhookAuditByIpMock).toHaveBeenCalledWith("192.0.2.55", expect.any(Date));
    expect(insertWebhookAuditMock).toHaveBeenCalledTimes(1);
    const arg = insertWebhookAuditMock.mock.calls[0]![0] as Record<string, unknown>;
    // Persisted ip must equal the throttle key (rightmost XFF), not the spoofed leftmost entry
    expect(arg.ip).toBe("192.0.2.55");
    expect(arg.forwardedFor).toBe("203.0.113.99, 192.0.2.55");
  });

  it("rotating x-forwarded-for does not bypass write suppression", async () => {
    // The attacker rotates the leftmost XFF entry on each request, hoping each
    // rotation produces a fresh counter key. The trusted Replit proxy always
    // appends the real TCP address (10.0.0.99) as the rightmost entry.
    // getClientIp() returns the rightmost entry, so all requests are counted
    // against the same IP regardless of the spoofed leftmost value.
    const limit = parseInt(process.env.WEBHOOK_AUDIT_WRITE_LIMIT ?? "10", 10);
    countWebhookAuditByIpMock.mockResolvedValue(limit);

    for (const spoofedIp of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      const req = makeReq({
        ip: "10.0.0.99",
        // Proxy model: attacker-supplied leftmost, proxy-appended rightmost
        headers: { "x-forwarded-for": `${spoofedIp}, 10.0.0.99` },
      });
      logWebhookVerificationFailure(req, "pollfish", "bad");
    }
    await flushAsync();

    // All writes suppressed — rightmost XFF (10.0.0.99) is at the limit for all
    expect(insertWebhookAuditMock).not.toHaveBeenCalled();
    const countedIps = countWebhookAuditByIpMock.mock.calls.map((c) => c[0]);
    expect(countedIps).toEqual(["10.0.0.99", "10.0.0.99", "10.0.0.99"]);
  });

  it("normalizes missing optional headers to null when persisting", async () => {
    const req = makeReq({ method: "GET" });
    (req as unknown as { originalUrl: string }).originalUrl = "/api/surveys/webhook/pollfish";
    logWebhookVerificationFailure(req, "pollfish", "no token");

    await flushAsync();

    expect(insertWebhookAuditMock).toHaveBeenCalledTimes(1);
    const arg = insertWebhookAuditMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.forwardedFor).toBeNull();
    expect(arg.userAgent).toBeNull();
    expect(arg.hasSignatureHeader).toBe(false);
    expect(arg.method).toBe("GET");
    expect(arg.path).toBe("/api/surveys/webhook/pollfish");
  });

  it("does not throw when storage.insertWebhookAudit rejects (fire-and-forget)", async () => {
    insertWebhookAuditMock.mockRejectedValueOnce(new Error("db down"));
    const req = makeReq({});
    expect(() =>
      logWebhookVerificationFailure(req, "pollfish", "Invalid token"),
    ).not.toThrow();

    await flushAsync();
    expect(insertWebhookAuditMock).toHaveBeenCalled();
  });
});

describe("logWebhookVerificationFailure — write-throttle", () => {
  beforeEach(() => {
    insertWebhookAuditMock.mockClear();
    countWebhookAuditByIpMock.mockClear();
    insertWebhookAuditMock.mockImplementation(async (entry: unknown) => ({
      id: "audit-1",
      ...(entry as Record<string, unknown>),
      createdAt: new Date(),
    }));
  });

  it("calls countWebhookAuditByIp with rightmost XFF (not attacker-supplied leftmost)", async () => {
    // The trusted Replit proxy appends the real TCP address as the rightmost
    // XFF entry. getClientIp() returns that entry, not the attacker-controlled
    // leftmost value. Proves the throttle key cannot be rotated via header spoofing.
    const req = makeReq({
      ip: "10.0.0.99",
      // Proxy model: "1.2.3.4" is attacker-supplied; "10.0.0.99" is proxy-appended
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.99" },
    });
    countWebhookAuditByIpMock.mockResolvedValue(0);
    logWebhookVerificationFailure(req, "pollfish", "bad token");

    await flushAsync();

    expect(countWebhookAuditByIpMock).toHaveBeenCalledTimes(1);
    const [calledIp] = countWebhookAuditByIpMock.mock.calls[0]!;
    // Must key on rightmost XFF (proxy-observed), not attacker-controlled leftmost
    expect(calledIp).toBe("10.0.0.99");
    expect(calledIp).not.toBe("1.2.3.4");
  });

  it("persists the audit row when count is below the write limit", async () => {
    const limit = parseInt(process.env.WEBHOOK_AUDIT_WRITE_LIMIT ?? "10", 10);
    countWebhookAuditByIpMock.mockResolvedValue(limit - 1);

    logWebhookVerificationFailure(makeReq({}), "pollfish", "bad token");
    await flushAsync();

    expect(insertWebhookAuditMock).toHaveBeenCalledTimes(1);
  });

  it("suppresses the DB write when count equals the write limit", async () => {
    const limit = parseInt(process.env.WEBHOOK_AUDIT_WRITE_LIMIT ?? "10", 10);
    countWebhookAuditByIpMock.mockResolvedValue(limit);

    logWebhookVerificationFailure(makeReq({}), "pollfish", "bad token");
    await flushAsync();

    expect(insertWebhookAuditMock).not.toHaveBeenCalled();
  });

  it("suppresses the DB write when count exceeds the write limit", async () => {
    countWebhookAuditByIpMock.mockResolvedValue(9999);

    logWebhookVerificationFailure(makeReq({}), "pollfish", "bad token");
    await flushAsync();

    expect(insertWebhookAuditMock).not.toHaveBeenCalled();
  });

  it("spoofing x-forwarded-for does not bypass the throttle (rightmost XFF used as key)", async () => {
    // Both requests carry different attacker-supplied leftmost XFF values, but
    // the trusted Replit proxy always appends the real TCP address (10.0.0.99)
    // as the rightmost entry. getClientIp() returns the rightmost entry, so
    // both count checks use 10.0.0.99 — the spoofed leftmost is ignored.
    const limit = parseInt(process.env.WEBHOOK_AUDIT_WRITE_LIMIT ?? "10", 10);
    countWebhookAuditByIpMock.mockResolvedValue(limit);

    const req1 = makeReq({ ip: "10.0.0.99", headers: { "x-forwarded-for": "1.1.1.1, 10.0.0.99" } });
    const req2 = makeReq({ ip: "10.0.0.99", headers: { "x-forwarded-for": "2.2.2.2, 10.0.0.99" } });

    logWebhookVerificationFailure(req1, "pollfish", "bad");
    logWebhookVerificationFailure(req2, "pollfish", "bad");
    await flushAsync();

    // Both suppressed — rightmost XFF (10.0.0.99) is at the limit for both
    expect(insertWebhookAuditMock).not.toHaveBeenCalled();
    const calledIps = countWebhookAuditByIpMock.mock.calls.map((c) => c[0]);
    expect(calledIps).toEqual(["10.0.0.99", "10.0.0.99"]);
  });

  it("fails open and allows the DB write when countWebhookAuditByIp rejects", async () => {
    countWebhookAuditByIpMock.mockRejectedValueOnce(new Error("db error"));

    expect(() =>
      logWebhookVerificationFailure(makeReq({}), "pollfish", "bad token"),
    ).not.toThrow();

    await flushAsync();

    // Fail-open: insert should still be called to preserve audit trail
    expect(insertWebhookAuditMock).toHaveBeenCalledTimes(1);
  });
});

describe("verifyWebhook — cpx (Secure Hash, replay-protected)", () => {
  // CPX uses ONE per-app Secure Hash (stored as CPX_API_KEY) for both the survey
  // wall link and the postback signature: secure_hash = md5(trans_id + "-" + hash).
  const secureHash = SECRETS.CPX_API_KEY;

  it("accepts a genuine postback signed md5(trans_id-SecureHash)", () => {
    const transId = "tx_12345";
    const sig = md5(`${transId}-${secureHash}`);
    const res = verifyWebhook(
      "cpx",
      makeReq({
        method: "GET",
        query: { trans_id: transId, ext_user_id: "user_1", survey_id: "s1", status: "1", secure_hash: sig },
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("accepts the hash under the ?hash= alias", () => {
    const transId = "tx_alias";
    const sig = md5(`${transId}-${secureHash}`);
    const res = verifyWebhook(
      "cpx",
      makeReq({ method: "GET", query: { trans_id: transId, ext_user_id: "user_2", hash: sig } }),
    );
    expect(res.ok).toBe(true);
  });

  it("rejects when secure_hash is missing", () => {
    const res = verifyWebhook(
      "cpx",
      makeReq({ method: "GET", query: { trans_id: "tx_1", ext_user_id: "user_1" } }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Invalid provider-specific signature/);
  });

  it("rejects a forged/incorrect signature", () => {
    const res = verifyWebhook(
      "cpx",
      makeReq({ method: "GET", query: { trans_id: "tx_1", ext_user_id: "user_1", secure_hash: "deadbeef" } }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects the wall-hash replay where trans_id == ext_user_id", () => {
    // The client holds its wall hash md5(userId-SecureHash). Replaying it with
    // trans_id = userId would otherwise satisfy md5(trans_id-SecureHash).
    const userId = "user_attacker";
    const wallHash = md5(`${userId}-${secureHash}`);
    const res = verifyWebhook(
      "cpx",
      makeReq({ method: "GET", query: { trans_id: userId, ext_user_id: userId, secure_hash: wallHash } }),
    );
    expect(res.ok).toBe(false);
  });

  it("reports not-configured when CPX_API_KEY is unset", () => {
    delete process.env.CPX_API_KEY;
    reloadWebhookSecrets();
    const res = verifyWebhook(
      "cpx",
      makeReq({ method: "GET", query: { trans_id: "t", ext_user_id: "u", secure_hash: "x" } }),
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not configured/);
    // restore for any subsequent tests
    process.env.CPX_API_KEY = secureHash;
    reloadWebhookSecrets();
  });
});
