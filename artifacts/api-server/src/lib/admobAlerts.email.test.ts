/**
 * Tests for the operator-email side effect of the AdMob reporting alerts.
 *
 * When evaluateAdmobAlerts fires or resolves a condition, fireAlert emails the
 * operator over Zoho SMTP (the same channel as OTPs/support) so the owner reacts
 * without watching the hub. These tests mock the SMTP transport so the REAL
 * sendAdmobReportAlert is exercised without touching the network, and assert:
 *   - a firing condition sends an operator email,
 *   - a resolved condition sends a "back to normal" email,
 *   - the email inherits the cooldown de-dup (no flood while sustained),
 *   - ADMOB_ALERT_EMAIL_DISABLED suppresses just the email.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mockSendMail = vi.fn().mockResolvedValue({});

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

import {
  evaluateAdmobAlerts,
  _resetAdmobAlertsForTests,
  type AdmobReconciliationInput,
} from "./admobAlerts";

const HOUR = 60 * 60 * 1000;

function recon(overrides: Partial<AdmobReconciliationInput> = {}): AdmobReconciliationInput {
  return {
    officialEarnings: 100,
    appReportedEarnings: 100,
    differenceAbs: 0,
    differencePct: 0,
    currency: "USD",
    ...overrides,
  };
}

// Flush the fire-and-forget email promise so assertions see the call.
const flush = () => new Promise((r) => setTimeout(r, 0));

const prevSmtp = process.env["ZOHO_SMTP_PASSWORD"];

describe("admobAlerts operator email", () => {
  beforeEach(() => {
    _resetAdmobAlertsForTests();
    mockSendMail.mockClear();
    process.env.ZOHO_SMTP_PASSWORD = "test-smtp-password";
    process.env.ADMOB_ALERT_STALE_HOURS = "6";
    process.env.ADMOB_ALERT_DIVERGENCE_PCT = "25";
    process.env.ADMOB_ALERT_MIN_EARNINGS_USD = "1";
    process.env.ADMOB_ALERT_COOLDOWN_MS = String(6 * HOUR);
    delete process.env.ADMIN_ALERT_WEBHOOK_URL;
    delete process.env.ADMOB_ALERT_EMAIL_DISABLED;
    delete process.env.ADMIN_ALERT_EMAIL;
  });

  afterAll(() => {
    if (prevSmtp === undefined) delete process.env["ZOHO_SMTP_PASSWORD"];
    else process.env["ZOHO_SMTP_PASSWORD"] = prevSmtp;
  });

  it("emails the operator when a stale_sync condition fires", async () => {
    const now = Date.now();
    evaluateAdmobAlerts({
      configured: true,
      lastSyncedAt: new Date(now - 8 * HOUR),
      reconciliation: null,
      now,
    });
    await flush();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe("support@absustaininvest.com");
    expect(mail.subject).toContain("AdMob reporting stale");
    expect(mail.subject).not.toContain("Resolved");
  });

  it("emails the operator when a revenue_divergence condition fires", async () => {
    const now = Date.now();
    evaluateAdmobAlerts({
      configured: true,
      lastSyncedAt: new Date(now),
      reconciliation: recon({
        officialEarnings: 100,
        appReportedEarnings: 50,
        differenceAbs: 50,
        differencePct: 50,
      }),
      now,
    });
    await flush();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].subject).toContain("AdMob revenue divergence");
  });

  it("sends a 'back to normal' email when a condition resolves", async () => {
    const t0 = Date.now();
    evaluateAdmobAlerts({
      configured: true,
      lastSyncedAt: new Date(t0 - 8 * HOUR),
      reconciliation: null,
      now: t0,
    });
    await flush();
    mockSendMail.mockClear();

    const t1 = t0 + HOUR;
    evaluateAdmobAlerts({
      configured: true,
      lastSyncedAt: new Date(t1),
      reconciliation: null,
      now: t1,
    });
    await flush();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.subject).toContain("Resolved");
    expect(mail.subject).toContain("back to normal");
    expect(String(mail.text)).toContain("resolved");
  });

  it("does not re-email a sustained condition inside the cooldown", async () => {
    const t0 = Date.now();
    const div = recon({ officialEarnings: 100, appReportedEarnings: 50, differenceAbs: 50, differencePct: 50 });
    evaluateAdmobAlerts({ configured: true, lastSyncedAt: new Date(t0), reconciliation: div, now: t0 });
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(1);

    // 1h later, still diverged, still inside the 6h cooldown → no second email.
    evaluateAdmobAlerts({
      configured: true,
      lastSyncedAt: new Date(t0 + HOUR),
      reconciliation: div,
      now: t0 + HOUR,
    });
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("suppresses the email when ADMOB_ALERT_EMAIL_DISABLED is set", async () => {
    process.env.ADMOB_ALERT_EMAIL_DISABLED = "true";
    const now = Date.now();
    evaluateAdmobAlerts({
      configured: true,
      lastSyncedAt: new Date(now - 8 * HOUR),
      reconciliation: null,
      now,
    });
    await flush();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
