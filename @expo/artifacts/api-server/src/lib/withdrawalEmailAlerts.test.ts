/**
 * Tests for the withdrawal status-update email failure path.
 *
 * Payout outcome emails (paid / rejected) are money-critical: if they silently
 * fail to send, the user never learns their withdrawal outcome. These tests pin:
 *
 *   1. sendWithdrawalStatusUpdate now SURFACES a delivery failure (rejects with
 *      EmailNotSentError) instead of swallowing it, for every failure mode
 *      (unconfigured SMTP, invalid recipient, provider send error).
 *   2. recordWithdrawalEmailFailure always logs the failure and fires a single
 *      debounced operator alert once the rolling failure count crosses the
 *      threshold — and never spams beyond that within the cooldown.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mockSendMail = vi.fn();

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

import {
  sendWithdrawalStatusUpdate,
  sendWithdrawalEmailFailureAlert,
  EmailNotSentError,
} from "./email";
import {
  recordWithdrawalEmailFailure,
  _resetWithdrawalEmailAlertsForTests,
} from "./withdrawalEmailAlerts";

const prevSmtp = process.env["ZOHO_SMTP_PASSWORD"];
const ALERT_ENV = [
  "WITHDRAWAL_EMAIL_ALERT_THRESHOLD",
  "WITHDRAWAL_EMAIL_ALERT_WINDOW_MS",
  "WITHDRAWAL_EMAIL_ALERT_COOLDOWN_MS",
] as const;
const prevAlertEnv: Record<string, string | undefined> = {};
for (const k of ALERT_ENV) prevAlertEnv[k] = process.env[k];

function baseOptions() {
  return {
    toEmail: "user@example.com",
    username: "ashley",
    amount: "5.00",
    totalPayout: "5.00",
    status: "paid" as const,
  };
}

afterAll(() => {
  if (prevSmtp === undefined) delete process.env["ZOHO_SMTP_PASSWORD"];
  else process.env["ZOHO_SMTP_PASSWORD"] = prevSmtp;
  for (const k of ALERT_ENV) {
    if (prevAlertEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevAlertEnv[k]!;
  }
});

describe("sendWithdrawalStatusUpdate surfaces delivery failures", () => {
  beforeEach(() => {
    mockSendMail.mockReset();
    process.env.ZOHO_SMTP_PASSWORD = "test-smtp-password";
  });

  it("resolves normally when the SMTP send succeeds", async () => {
    mockSendMail.mockResolvedValue({});
    await expect(sendWithdrawalStatusUpdate(baseOptions())).resolves.toBeUndefined();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("rejects with EmailNotSentError when the SMTP provider fails", async () => {
    mockSendMail.mockRejectedValue(new Error("550 mailbox unavailable"));
    await expect(sendWithdrawalStatusUpdate(baseOptions())).rejects.toBeInstanceOf(EmailNotSentError);
  });

  it("rejects with EmailNotSentError on an invalid recipient address", async () => {
    mockSendMail.mockResolvedValue({});
    await expect(
      sendWithdrawalStatusUpdate({ ...baseOptions(), toEmail: "not-an-email" }),
    ).rejects.toBeInstanceOf(EmailNotSentError);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("rejects with EmailNotSentError when SMTP is not configured", async () => {
    delete process.env["ZOHO_SMTP_PASSWORD"];
    await expect(sendWithdrawalStatusUpdate(baseOptions())).rejects.toBeInstanceOf(EmailNotSentError);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("recordWithdrawalEmailFailure operator alerting", () => {
  beforeEach(() => {
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({});
    process.env.ZOHO_SMTP_PASSWORD = "test-smtp-password";
    process.env.WITHDRAWAL_EMAIL_ALERT_THRESHOLD = "3";
    process.env.WITHDRAWAL_EMAIL_ALERT_WINDOW_MS = "60000";
    process.env.WITHDRAWAL_EMAIL_ALERT_COOLDOWN_MS = "3600000";
    _resetWithdrawalEmailAlertsForTests();
  });

  function failure(n: number) {
    return {
      withdrawalId: `w-${n}`,
      recipient: `user${n}@example.com`,
      status: "paid",
      reason: "SMTP send failed",
    };
  }

  it("does not alert before the threshold is reached", () => {
    recordWithdrawalEmailFailure(failure(1));
    recordWithdrawalEmailFailure(failure(2));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("fires a single operator alert once the threshold is crossed", () => {
    recordWithdrawalEmailFailure(failure(1));
    recordWithdrawalEmailFailure(failure(2));
    recordWithdrawalEmailFailure(failure(3));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(String(mail.subject)).toContain("payout emails failed");
    expect(String(mail.text)).toContain("w-3");
  });

  it("does not re-alert within the cooldown after the threshold", () => {
    for (let i = 1; i <= 6; i++) recordWithdrawalEmailFailure(failure(i));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});

describe("sendWithdrawalEmailFailureAlert escapes interpolated fields", () => {
  beforeEach(() => {
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({});
    process.env.ZOHO_SMTP_PASSWORD = "test-smtp-password";
  });

  it("HTML-escapes the recipient and reason in the alert body", () => {
    sendWithdrawalEmailFailureAlert({
      failureCount: 4,
      windowMs: 1_800_000,
      sampleWithdrawalId: "w-x",
      sampleRecipient: "<script>@evil.com",
      sampleReason: "boom <b>",
    });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(String(mail.html)).not.toContain("<script>@evil.com");
    expect(String(mail.html)).toContain("&lt;script&gt;");
  });
});
