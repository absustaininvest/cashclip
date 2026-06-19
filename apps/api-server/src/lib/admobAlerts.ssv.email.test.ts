/**
 * Tests for the operator-email side effect of the SSV credit-health alerts.
 *
 * When evaluateSsvAlerts fires or resolves the ssv_credit_stale condition, the
 * operator is emailed over Zoho SMTP so the owner is notified without watching
 * the hub. These tests mock the SMTP transport so sendSsvCreditAlert is
 * exercised without touching the network, and assert:
 *   - a firing ssv_credit_stale condition sends an operator email,
 *   - a resolved condition sends a "flowing again" email,
 *   - the email inherits the cooldown de-dup (no flood while sustained),
 *   - the alert does NOT fire when AD_ADMOB_NATIVE is unset (staging gate).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockSendMail = vi.fn().mockResolvedValue({});

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

import {
  evaluateSsvAlerts,
  _resetSsvAlertsForTests,
} from "./admobAlerts";

const HOUR = 60 * 60 * 1000;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("evaluateSsvAlerts operator email", () => {
  beforeEach(() => {
    _resetSsvAlertsForTests();
    mockSendMail.mockClear();
    process.env.ZOHO_SMTP_PASSWORD = "test-smtp-password";
    process.env.AD_ADMOB_NATIVE = "true";
    process.env.SSV_ALERT_COOLDOWN_MS = String(6 * HOUR);
    delete process.env.ADMIN_ALERT_EMAIL;
  });

  afterEach(() => {
    delete process.env.ZOHO_SMTP_PASSWORD;
    delete process.env.AD_ADMOB_NATIVE;
    delete process.env.SSV_ALERT_COOLDOWN_MS;
  });

  it("emails the operator when ssv_credit_stale fires", async () => {
    const now = Date.now();
    evaluateSsvAlerts({ staleAlert: true, totalToday: 5, lastSsvAt: new Date(now - 7 * HOUR).toISOString(), now });
    await flush();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe("support@absustaininvest.com");
    expect(mail.subject).toContain("SSV credits have stopped");
    expect(mail.subject).not.toContain("Resolved");
  });

  it("sends a 'flowing again' email when ssv_credit_stale resolves", async () => {
    const t0 = Date.now();
    evaluateSsvAlerts({ staleAlert: true, totalToday: 3, lastSsvAt: new Date(t0 - 7 * HOUR).toISOString(), now: t0 });
    await flush();
    mockSendMail.mockClear();

    const t1 = t0 + HOUR;
    evaluateSsvAlerts({ staleAlert: false, totalToday: 4, lastSsvAt: new Date(t1).toISOString(), now: t1 });
    await flush();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.subject).toContain("Resolved");
    expect(mail.subject).toContain("flowing again");
    expect(String(mail.text)).toContain("resolved");
  });

  it("does not re-email a sustained condition inside the cooldown window", async () => {
    const t0 = Date.now();
    evaluateSsvAlerts({ staleAlert: true, totalToday: 2, lastSsvAt: null, now: t0 });
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(1);

    evaluateSsvAlerts({ staleAlert: true, totalToday: 3, lastSsvAt: null, now: t0 + HOUR });
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("re-emails after the cooldown window expires", async () => {
    const t0 = Date.now();
    evaluateSsvAlerts({ staleAlert: true, totalToday: 2, lastSsvAt: null, now: t0 });
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(1);

    evaluateSsvAlerts({ staleAlert: true, totalToday: 5, lastSsvAt: null, now: t0 + 7 * HOUR });
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it("does not fire when AD_ADMOB_NATIVE is not set", async () => {
    delete process.env.AD_ADMOB_NATIVE;
    const now = Date.now();
    evaluateSsvAlerts({ staleAlert: true, totalToday: 5, lastSsvAt: null, now });
    await flush();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("does not fire when AD_ADMOB_NATIVE=false", async () => {
    process.env.AD_ADMOB_NATIVE = "false";
    const now = Date.now();
    evaluateSsvAlerts({ staleAlert: true, totalToday: 5, lastSsvAt: null, now });
    await flush();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("does not fire when staleAlert is false", async () => {
    const now = Date.now();
    evaluateSsvAlerts({ staleAlert: false, totalToday: 0, lastSsvAt: null, now });
    await flush();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("uses ADMIN_ALERT_EMAIL override when set", async () => {
    process.env.ADMIN_ALERT_EMAIL = "ops@example.com";
    const now = Date.now();
    evaluateSsvAlerts({ staleAlert: true, totalToday: 1, lastSsvAt: null, now });
    await flush();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("ops@example.com");
    delete process.env.ADMIN_ALERT_EMAIL;
  });
});
