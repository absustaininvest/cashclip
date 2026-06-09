/**
 * Tests for the support-ticket notification email (sendSupportTicket).
 *
 * A user submitting a ticket through the app's "Contact Support" button used to
 * generate an email FROM the support address with no user email and a Reply-To
 * defaulting to the support address — so the operator's "Reply" went back to
 * themselves instead of the user. These tests mock the SMTP transport so the
 * REAL sendSupportTicket is exercised without touching the network, and assert:
 *   - a valid account email is set as Reply-To and shown in the body,
 *   - a missing/invalid email sends NO Reply-To header and shows "none on file".
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mockSendMail = vi.fn().mockResolvedValue({});

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

import { sendSupportTicket } from "./email";

const prevSmtp = process.env["ZOHO_SMTP_PASSWORD"];

describe("sendSupportTicket Reply-To routing", () => {
  beforeEach(() => {
    mockSendMail.mockClear();
    process.env.ZOHO_SMTP_PASSWORD = "test-smtp-password";
  });

  afterAll(() => {
    if (prevSmtp === undefined) delete process.env["ZOHO_SMTP_PASSWORD"];
    else process.env["ZOHO_SMTP_PASSWORD"] = prevSmtp;
  });

  it("sets the user email as Reply-To and shows it in the body", async () => {
    await sendSupportTicket({
      username: "ashley",
      userId: "u-123",
      subject: "A problem with the profile",
      message: "Help please",
      userEmail: "ashley@example.com",
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe("support@absustaininvest.com");
    expect(mail.replyTo).toBe("ashley@example.com");
    expect(String(mail.text)).toContain("Email: ashley@example.com");
    expect(String(mail.html)).toContain("ashley@example.com");
  });

  it("omits Reply-To and shows 'none on file' when the email is missing", async () => {
    await sendSupportTicket({
      username: "noemail",
      userId: "u-456",
      subject: "Question",
      message: "Hi",
      userEmail: null,
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.replyTo).toBeUndefined();
    expect(String(mail.text)).toContain("Email: none on file");
    expect(String(mail.html)).toContain("none on file");
  });

  it("omits Reply-To when the email on file is malformed", async () => {
    await sendSupportTicket({
      username: "bad",
      userId: "u-789",
      subject: "Question",
      message: "Hi",
      userEmail: "not-an-email",
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.replyTo).toBeUndefined();
    expect(String(mail.text)).toContain("Email: none on file");
  });
});
