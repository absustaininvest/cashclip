/**
 * Unit tests for sendSponsoredVisitSettlementAlert in email.ts.
 *
 * nodemailer is fully mocked so no SMTP connection is required.
 * Tests cover:
 *
 *   1. Exits gracefully (no throw, no sendMail call) when ZOHO_SMTP_PASSWORD is absent.
 *   2. HTML and plain-text bodies contain activeCampaigns, windowHours, and checkedAt.
 *   3. No unhandled promise rejection when transport.sendMail rejects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── nodemailer mock ────────────────────────────────────────────────────────────
// Must be declared before the module import so vi.mock hoisting picks it up.

const mockSendMail = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

// ── Module under test ─────────────────────────────────────────────────────────
// Imported after vi.mock so the mocked nodemailer is in place.

import { sendSponsoredVisitSettlementAlert } from "./email";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flush all pending microtasks so that fire-and-forget Promise chains inside
 * sendBestEffort have a chance to run before assertions execute.
 * setImmediate fires after all queued microtasks, making it a reliable drain.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

const BASE_OPTS = {
  activeCampaigns: 3,
  windowHours: 2,
  checkedAt: new Date("2026-06-01T12:00:00Z"),
} as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sendSponsoredVisitSettlementAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env["ZOHO_SMTP_PASSWORD"];
  });

  // ── 1. Graceful exit when ZOHO_SMTP_PASSWORD is absent ────────────────────
  describe("when ZOHO_SMTP_PASSWORD is absent", () => {
    beforeEach(() => {
      delete process.env["ZOHO_SMTP_PASSWORD"];
    });

    it("does not throw synchronously", () => {
      expect(() => sendSponsoredVisitSettlementAlert(BASE_OPTS)).not.toThrow();
    });

    it("does not call transport.sendMail", async () => {
      sendSponsoredVisitSettlementAlert(BASE_OPTS);
      await flushMicrotasks();
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it("does not produce an unhandled promise rejection", async () => {
      const spy = vi.fn();
      process.on("unhandledRejection", spy);
      sendSponsoredVisitSettlementAlert(BASE_OPTS);
      await flushMicrotasks();
      process.off("unhandledRejection", spy);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── 2. HTML and text content when transport is configured ─────────────────
  describe("email content", () => {
    beforeEach(() => {
      process.env["ZOHO_SMTP_PASSWORD"] = "test-smtp-password";
      mockSendMail.mockResolvedValue({ messageId: "test-msg-id" });
    });

    it("sends to the admin email address", async () => {
      sendSponsoredVisitSettlementAlert(BASE_OPTS);
      await flushMicrotasks();
      const opts = mockSendMail.mock.calls[0]![0] as Record<string, string>;
      expect(opts.to).toBe("support@absustaininvest.com");
    });

    it("subject line references the settlement alert and window hours", async () => {
      sendSponsoredVisitSettlementAlert({ ...BASE_OPTS, windowHours: 2 });
      await flushMicrotasks();
      const opts = mockSendMail.mock.calls[0]![0] as Record<string, string>;
      expect(opts.subject.toLowerCase()).toContain("settlement");
      expect(opts.subject).toContain("2");
    });

    it("HTML body contains the activeCampaigns count", async () => {
      sendSponsoredVisitSettlementAlert({ ...BASE_OPTS, activeCampaigns: 7 });
      await flushMicrotasks();
      const { html } = mockSendMail.mock.calls[0]![0] as { html: string };
      expect(html).toContain("7");
    });

    it("HTML body contains the windowHours value", async () => {
      sendSponsoredVisitSettlementAlert({ ...BASE_OPTS, windowHours: 6 });
      await flushMicrotasks();
      const { html } = mockSendMail.mock.calls[0]![0] as { html: string };
      expect(html).toContain("6");
    });

    it("HTML body contains the checkedAt timestamp", async () => {
      const checkedAt = new Date("2026-06-01T12:00:00Z");
      sendSponsoredVisitSettlementAlert({ ...BASE_OPTS, checkedAt });
      await flushMicrotasks();
      const { html } = mockSendMail.mock.calls[0]![0] as { html: string };
      expect(html).toContain(checkedAt.toUTCString());
    });

    it("plain-text body contains activeCampaigns, windowHours, and checkedAt", async () => {
      const checkedAt = new Date("2026-06-01T08:00:00Z");
      sendSponsoredVisitSettlementAlert({
        activeCampaigns: 4,
        windowHours: 3,
        checkedAt,
      });
      await flushMicrotasks();
      const { text } = mockSendMail.mock.calls[0]![0] as { text: string };
      expect(text).toContain("4");
      expect(text).toContain("3");
      expect(text).toContain(checkedAt.toUTCString());
    });

    it("HTML body uses 'campaign' (singular) when activeCampaigns is 1", async () => {
      sendSponsoredVisitSettlementAlert({ ...BASE_OPTS, activeCampaigns: 1 });
      await flushMicrotasks();
      const { html } = mockSendMail.mock.calls[0]![0] as { html: string };
      expect(html).toContain("campaign");
      expect(html).not.toMatch(/\bcampaigns\b/);
    });

    it("HTML body uses 'campaigns' (plural) when activeCampaigns is > 1", async () => {
      sendSponsoredVisitSettlementAlert({ ...BASE_OPTS, activeCampaigns: 5 });
      await flushMicrotasks();
      const { html } = mockSendMail.mock.calls[0]![0] as { html: string };
      expect(html).toContain("campaigns");
    });
  });

  // ── 3. No unhandled rejection when transport.sendMail rejects ─────────────
  describe("when transport.sendMail rejects", () => {
    beforeEach(() => {
      process.env["ZOHO_SMTP_PASSWORD"] = "test-smtp-password";
      mockSendMail.mockRejectedValue(new Error("SMTP connection refused"));
    });

    it("does not throw synchronously", () => {
      expect(() => sendSponsoredVisitSettlementAlert(BASE_OPTS)).not.toThrow();
    });

    it("does not produce an unhandled promise rejection", async () => {
      const spy = vi.fn();
      process.on("unhandledRejection", spy);
      sendSponsoredVisitSettlementAlert(BASE_OPTS);
      await flushMicrotasks();
      process.off("unhandledRejection", spy);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
