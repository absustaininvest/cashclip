import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyIntegrationKey } from "./integrationVerify";

const realFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; bodyText?: string } | Promise<never>) {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    const r = await handler(url, init);
    return new Response(r.bodyText ?? "", { status: r.status });
  }) as any;
}

describe("verifyIntegrationKey", () => {
  beforeEach(() => {
    delete process.env.CPX_APP_ID;
    delete process.env.PAYPAL_SECRET;
    delete process.env.PAYPAL_CLIENT_SECRET;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns ok for a Pollfish 200 response", async () => {
    mockFetch(() => ({ status: 200, bodyText: "{}" }));
    const r = await verifyIntegrationKey("pollfish", "good-key");
    expect(r.supported).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.authRejected).toBe(false);
  });

  it("flags 401 from Pollfish as auth rejection with actionable message", async () => {
    mockFetch(() => ({ status: 401, bodyText: "Unauthorized" }));
    const r = await verifyIntegrationKey("pollfish", "bad-key");
    expect(r.supported).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.authRejected).toBe(true);
    expect(r.status).toBe(401);
    expect(r.error).toMatch(/Pollfish.*401/);
  });

  it("flags 403 from BitLabs as auth rejection", async () => {
    mockFetch(() => ({ status: 403, bodyText: "Forbidden" }));
    const r = await verifyIntegrationKey("bitlabs", "nope");
    expect(r.authRejected).toBe(true);
    expect(r.status).toBe(403);
  });

  it("treats other 4xx (e.g. 422) as a key/config rejection", async () => {
    mockFetch(() => ({ status: 422, bodyText: "" }));
    const r = await verifyIntegrationKey("lucid", "bad");
    expect(r.supported).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.authRejected).toBe(true);
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/Lucid.*422/);
  });

  it("treats 5xx as transient (not an auth rejection)", async () => {
    mockFetch(() => ({ status: 503, bodyText: "" }));
    const r = await verifyIntegrationKey("cint", "any");
    expect(r.supported).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.authRejected).toBe(false);
    expect(r.status).toBe(503);
  });

  it("treats network errors as transient", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENETUNREACH");
    }) as any;
    const r = await verifyIntegrationKey("tapjoy", "any");
    expect(r.ok).toBe(false);
    expect(r.authRejected).toBe(false);
    expect(r.error).toMatch(/Tapjoy/);
  });

  it("returns unsupported for SDK-only integrations like admob", async () => {
    const r = await verifyIntegrationKey("admob", "ca-app-pub-xxx");
    expect(r.supported).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("returns unsupported for unknown integration ids", async () => {
    const r = await verifyIntegrationKey("not-a-real-provider", "x");
    expect(r.supported).toBe(false);
  });

  it("CPX without CPX_APP_ID is reported as unsupported (cannot verify)", async () => {
    const r = await verifyIntegrationKey("cpx", "secure-hash");
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/CPX_APP_ID/);
  });

  it("CPX with CPX_APP_ID hits the get-surveys endpoint", async () => {
    process.env.CPX_APP_ID = "app123";
    let calledUrl = "";
    mockFetch((url) => {
      calledUrl = url;
      return { status: 200, bodyText: "{}" };
    });
    const r = await verifyIntegrationKey("cpx", "hash");
    expect(r.ok).toBe(true);
    expect(calledUrl).toContain("get-surveys.php");
    expect(calledUrl).toContain("app_id=app123");
    expect(calledUrl).toContain("secure_hash=hash");
  });

  it("PayPal without secret is unsupported", async () => {
    const r = await verifyIntegrationKey("paypal", "client-id");
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/PAYPAL_SECRET/);
  });

  it("PayPal 401 with secret is an auth rejection", async () => {
    process.env.PAYPAL_SECRET = "shh";
    mockFetch(() => ({ status: 401, bodyText: "{}" }));
    const r = await verifyIntegrationKey("paypal", "client-id");
    expect(r.authRejected).toBe(true);
    expect(r.status).toBe(401);
  });

  it("PayPal 200 with secret is success", async () => {
    process.env.PAYPAL_SECRET = "shh";
    let authHeader: string | undefined;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      authHeader = init?.headers?.Authorization;
      return new Response("{}", { status: 200 });
    }) as any;
    const r = await verifyIntegrationKey("paypal", "client-id");
    expect(r.ok).toBe(true);
    expect(authHeader).toMatch(/^Basic /);
  });
});
