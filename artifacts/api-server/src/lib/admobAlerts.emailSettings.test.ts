/**
 * Tests that the operator-adjustable AdMob alert email settings (persisted via
 * runtimeSettings, surfaced in the /sc-portal Integration Hub) override the env
 * defaults at evaluation time:
 *   - a persisted recipient routes the alert email to that address,
 *   - a persisted "disabled" toggle suppresses the email even when the
 *     ADMOB_ALERT_EMAIL_DISABLED env flag is unset,
 *   - a persisted "enabled" toggle wins over ADMOB_ALERT_EMAIL_DISABLED=true,
 *   - with no persisted settings, the env fallback chain still applies.
 *
 * runtimeSettings is mocked so this never touches the DB; SMTP is mocked so
 * nothing leaves the process.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mockSendMail = vi.fn().mockResolvedValue({});

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

// In-memory stand-in for the persisted settings cache.
const settings = new Map<string, string>();
vi.mock("./runtimeSettings", () => ({
  ADMOB_ALERT_EMAIL_KEY: "admob_alert_email",
  ADMOB_ALERT_EMAIL_ENABLED_KEY: "admob_alert_email_enabled",
  getSetting: (key: string) => (settings.has(key) ? settings.get(key)! : null),
}));

import { evaluateAdmobAlerts, _resetAdmobAlertsForTests } from "./admobAlerts";

const HOUR = 60 * 60 * 1000;
const flush = () => new Promise((r) => setTimeout(r, 0));

const prevSmtp = process.env["ZOHO_SMTP_PASSWORD"];

function fireStale() {
  const now = Date.now();
  evaluateAdmobAlerts({
    configured: true,
    lastSyncedAt: new Date(now - 8 * HOUR),
    reconciliation: null,
    now,
  });
}

describe("admobAlerts email settings overrides", () => {
  beforeEach(() => {
    _resetAdmobAlertsForTests();
    settings.clear();
    mockSendMail.mockClear();
    process.env.ZOHO_SMTP_PASSWORD = "test-smtp-password";
    process.env.ADMOB_ALERT_STALE_HOURS = "6";
    process.env.ADMOB_ALERT_COOLDOWN_MS = String(6 * HOUR);
    delete process.env.ADMIN_ALERT_WEBHOOK_URL;
    delete process.env.ADMOB_ALERT_EMAIL_DISABLED;
    delete process.env.ADMIN_ALERT_EMAIL;
  });

  afterAll(() => {
    if (prevSmtp === undefined) delete process.env["ZOHO_SMTP_PASSWORD"];
    else process.env["ZOHO_SMTP_PASSWORD"] = prevSmtp;
  });

  it("routes the alert to the persisted recipient", async () => {
    settings.set("admob_alert_email", "owner@example.com");
    fireStale();
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("owner@example.com");
  });

  it("falls back to the default recipient when no setting is persisted", async () => {
    fireStale();
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("support@absustaininvest.com");
  });

  it("suppresses the email when the persisted toggle is off", async () => {
    settings.set("admob_alert_email_enabled", "false");
    fireStale();
    await flush();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("persisted enabled=true wins over ADMOB_ALERT_EMAIL_DISABLED env", async () => {
    process.env.ADMOB_ALERT_EMAIL_DISABLED = "true";
    settings.set("admob_alert_email_enabled", "true");
    fireStale();
    await flush();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
