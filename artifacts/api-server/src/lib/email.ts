import nodemailer from "nodemailer";
import { logger } from "./logger";

const FROM_MAIN = "CashClip <support@absustaininvest.com>";
const ADMIN_EMAIL = "support@absustaininvest.com";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createTransport() {
  const password = process.env["ZOHO_SMTP_PASSWORD"];
  if (!password) return null;
  return nodemailer.createTransport({
    host: "smtp.zoho.com",
    port: 465,
    secure: true,
    auth: { user: "support@absustaininvest.com", pass: password },
  });
}

export function isEmailConfigured(): boolean {
  return !!process.env["ZOHO_SMTP_PASSWORD"];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

async function send(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<void> {
  const { replyTo, ...mailOptions } = options;
  const transport = createTransport();
  if (!transport) {
    logger.warn("Email not configured — ZOHO_SMTP_PASSWORD missing");
    return;
  }
  if (!isValidEmail(mailOptions.to)) {
    logger.warn({ to: mailOptions.to }, "Skipping email — invalid recipient address");
    return;
  }
  const replyToAddr = replyTo ?? ADMIN_EMAIL;
  try {
    await transport.sendMail({ from: FROM_MAIN, replyTo: replyToAddr, ...mailOptions });
    logger.info({ to: mailOptions.to, subject: mailOptions.subject }, "Email sent");
  } catch (err) {
    logger.error({ err, to: mailOptions.to, subject: mailOptions.subject }, "Failed to send email");
  }
}

/** Fire-and-forget: never throws, never blocks the caller */
function sendBestEffort(options: Parameters<typeof send>[0]): void {
  send(options).catch((err) => {
    logger.error({ err, to: options.to }, "Unhandled email send error");
  });
}

export async function sendEmailVerification(options: {
  to: string;
  username: string;
  verifyUrl: string;
}): Promise<void> {
  const { to, username, verifyUrl } = options;
  const safeUsername = escapeHtml(username);
  const safeVerifyUrl = escapeHtml(verifyUrl);
  sendBestEffort({
    to,
    subject: "Verify your CashClip email address",
    text: `Hi ${username},\n\nThanks for joining CashClip! Please verify your email address to unlock withdrawals:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create a CashClip account, you can safely ignore this email.\n\n— The CashClip Team`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:auto;background:#0A0A0F;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#00C853,#00E676);padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#0A0A0F;letter-spacing:-0.5px">CashClip</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#0A0A0F;opacity:0.75">Earn real cash — verify to unlock</p>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0">Hi <strong style="color:#fff">${safeUsername}</strong>,</p>
          <p style="margin:0 0 24px;font-size:15px;color:#b0b0b0;line-height:1.6">You're almost there! Verify your email address to unlock withdrawals and start cashing out your earnings.</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${safeVerifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#00C853,#00E676);color:#0A0A0F;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:50px">Verify Email Address</a>
          </div>
          <p style="margin:24px 0 0;font-size:12px;color:#555;text-align:center">This link expires in 24 hours. If you didn't create a CashClip account, you can safely ignore this email.</p>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;text-align:center">
            <p style="margin:0;font-size:11px;color:#444">CashClip · support@absustaininvest.com</p>
          </div>
        </div>
      </div>`,
  });
}

export function sendPasswordResetOTP(options: {
  to: string;
  username: string;
  otp: string;
}): void {
  const { to, username, otp } = options;
  const safeUsername = escapeHtml(username);
  const safeOtp = escapeHtml(otp);
  sendBestEffort({
    to,
    subject: "Your CashClip password reset code",
    text: `Hi ${username},\n\nYour password reset code is: ${otp}\n\nThis code expires in 15 minutes. If you didn't request this, you can safely ignore this email.\n\n— The CashClip Team`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:auto;background:#0A0A0F;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#00C853,#00E676);padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#0A0A0F;letter-spacing:-0.5px">CashClip</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#0A0A0F;opacity:0.75">Password Reset</p>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0">Hi <strong style="color:#fff">${safeUsername}</strong>,</p>
          <p style="margin:0 0 24px;font-size:15px;color:#b0b0b0;line-height:1.6">Use the code below to reset your CashClip password. It expires in <strong style="color:#fff">15 minutes</strong>.</p>
          <div style="text-align:center;margin:28px 0">
            <div style="display:inline-block;background:#1a1a2e;border:2px solid #00E676;border-radius:16px;padding:20px 40px">
              <span style="font-size:40px;font-weight:800;color:#00E676;letter-spacing:10px">${safeOtp}</span>
            </div>
          </div>
          <p style="margin:24px 0 0;font-size:12px;color:#555;text-align:center">If you didn't request a password reset, you can safely ignore this email. Your password won't change.</p>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;text-align:center">
            <p style="margin:0;font-size:11px;color:#444">CashClip · support@absustaininvest.com</p>
          </div>
        </div>
      </div>`,
  });
}

export function sendBackupCodeUsedAlert(options: {
  to: string;
  username: string;
  remaining: number;
  lowThreshold?: number;
}): void {
  const { to, username, remaining } = options;
  const lowThreshold = options.lowThreshold ?? 2;
  const isLow = remaining <= lowThreshold;
  const safeUsername = escapeHtml(username);
  const safeRemaining = escapeHtml(String(remaining));
  const codeWord = remaining === 1 ? "code" : "codes";
  const lowTextLine = isLow
    ? `\n\nYou're running low. We recommend signing in and regenerating a fresh set of backup codes so you don't get locked out.`
    : "";
  // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
  const lowHtmlBlock = isLow
    ? `<div style="margin:20px 0 0;background:#2a1a00;border:1px solid #ffb300;border-radius:12px;padding:16px">
            <p style="margin:0;font-size:14px;color:#ffd180;line-height:1.6"><strong style="color:#ffb300">You're running low.</strong> Sign in and regenerate a fresh set of backup codes so you don't get locked out.</p>
          </div>`
    : "";
  sendBestEffort({
    to,
    subject: isLow
      ? `Security alert: only ${remaining} CashClip backup ${codeWord} left`
      : "Security alert: a CashClip backup code was just used",
    text: `Hi ${username},\n\nA two-factor backup code was just used to sign in to your CashClip admin account. You have ${remaining} backup ${codeWord} remaining.${lowTextLine}\n\nIf this wasn't you, secure your account immediately by resetting your password and regenerating your backup codes.\n\n— The CashClip Team`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:auto;background:#0A0A0F;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#00C853,#00E676);padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#0A0A0F;letter-spacing:-0.5px">CashClip</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#0A0A0F;opacity:0.75">Security Alert</p>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0">Hi <strong style="color:#fff">${safeUsername}</strong>,</p>
          <p style="margin:0 0 16px;font-size:15px;color:#b0b0b0;line-height:1.6">A two-factor <strong style="color:#fff">backup code</strong> was just used to sign in to your CashClip admin account.</p>
          <div style="text-align:center;margin:24px 0">
            <div style="display:inline-block;background:#1a1a2e;border:2px solid #00E676;border-radius:16px;padding:16px 36px">
              <span style="font-size:36px;font-weight:800;color:#00E676">${safeRemaining}</span>
              <span style="font-size:14px;color:#b0b0b0;display:block;margin-top:4px">backup ${codeWord} remaining</span>
            </div>
          </div>
          ${lowHtmlBlock}
          <p style="margin:24px 0 0;font-size:12px;color:#555;text-align:center">If this wasn't you, reset your password and regenerate your backup codes immediately.</p>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;text-align:center">
            <p style="margin:0;font-size:11px;color:#444">CashClip · support@absustaininvest.com</p>
          </div>
        </div>
      </div>`,
  });
}

export async function sendContactNotification(lead: {
  name: string;
  email: string;
  message: string;
  type?: string;
}): Promise<void> {
  const typeLabel = lead.type === "investor" ? "Investor Inquiry" : "Contact Form";
  const safeName = escapeHtml(lead.name);
  const safeEmail = escapeHtml(lead.email);
  const safeMessage = escapeHtml(lead.message);
  await send({
    to: ADMIN_EMAIL,
    subject: `[${typeLabel}] New message from ${lead.name}`,
    text: `New ${typeLabel.toLowerCase()} submission:

Name: ${lead.name}
Email: ${lead.email}

Message:
${lead.message}`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid #00C853;padding-bottom:12px">New ${typeLabel}</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:8px 0;font-weight:600;color:#555;width:80px">Name</td><td style="padding:8px 0">${safeName}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">Email</td><td style="padding:8px 0"><a href="mailto:${encodeURIComponent(lead.email)}">${safeEmail}</a></td></tr>
        </table>
        <div style="margin-top:16px;background:#f7f7f7;border-left:4px solid #00C853;padding:16px;border-radius:4px">
          <p style="margin:0;white-space:pre-wrap;color:#333">${safeMessage}</p>
        </div>
        <p style="margin-top:24px;font-size:12px;color:#999">Submitted via absustaininvest.com</p>
      </div>`,
  });
}

export async function sendSupportTicket(ticket: {
  username: string;
  userId: string;
  subject: string;
  message: string;
}): Promise<void> {
  const safeUsername = escapeHtml(ticket.username);
  const safeUserId = escapeHtml(ticket.userId);
  const safeSubject = escapeHtml(ticket.subject);
  const safeMessage = escapeHtml(ticket.message);
  await send({
    to: ADMIN_EMAIL,
    subject: `[CashClip Support] ${ticket.subject}`,
    text: `New support ticket from ${ticket.username} (ID: ${ticket.userId})\n\nSubject: ${ticket.subject}\n\nMessage:\n${ticket.message}`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid #00C853;padding-bottom:12px">New Support Ticket</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:8px 0;font-weight:600;color:#555;width:100px">User</td><td style="padding:8px 0">${safeUsername}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">User ID</td><td style="padding:8px 0;font-size:12px;color:#999">${safeUserId}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">Subject</td><td style="padding:8px 0"><strong>${safeSubject}</strong></td></tr>
        </table>
        <div style="margin-top:16px;background:#f7f7f7;border-left:4px solid #00C853;padding:16px;border-radius:4px">
          <p style="margin:0;white-space:pre-wrap;color:#333">${safeMessage}</p>
        </div>
        <p style="margin-top:24px;font-size:12px;color:#999">CashClip Support · cash-clip.app</p>
      </div>`,
  });
}

export async function sendWithdrawalRequestedAdmin(withdrawal: {
  id: string;
  username: string;
  amount: string;
  totalPayout: string;
  paypalEmail: string;
}): Promise<void> {
  const safeUsername = escapeHtml(withdrawal.username);
  const safeAmount = escapeHtml(withdrawal.amount);
  const safeTotalPayout = escapeHtml(withdrawal.totalPayout);
  const safePaypalEmail = escapeHtml(withdrawal.paypalEmail);
  const safeId = escapeHtml(withdrawal.id);
  await send({
    to: ADMIN_EMAIL,
    subject: `[CashClip] New withdrawal request — $${withdrawal.totalPayout} from ${withdrawal.username}`,
    text: `New withdrawal request:\n\nUser: ${withdrawal.username}\nBase amount: $${withdrawal.amount}\nTotal payout: $${withdrawal.totalPayout}\nPayPal: ${withdrawal.paypalEmail}\nID: ${withdrawal.id}`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid #00C853;padding-bottom:12px">New Withdrawal Request</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:8px 0;font-weight:600;color:#555;width:120px">User</td><td style="padding:8px 0">${safeUsername}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">Base Amount</td><td style="padding:8px 0">$${safeAmount}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">Total Payout</td><td style="padding:8px 0;font-size:18px;font-weight:700;color:#00C853">$${safeTotalPayout}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">PayPal</td><td style="padding:8px 0">${safePaypalEmail}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">ID</td><td style="padding:8px 0;font-size:12px;color:#999">${safeId}</td></tr>
        </table>
        <p style="margin-top:24px;font-size:12px;color:#999">CashClip Admin · cash-clip.app</p>
      </div>`,
  });
}

export async function sendWithdrawalStatusUpdate(options: {
  toEmail: string;
  username: string;
  amount: string;
  totalPayout: string;
  status: "approved" | "rejected" | "paid";
  adminNote?: string;
}): Promise<void> {
  const { toEmail, username, amount, totalPayout, status, adminNote } = options;
  const safeUsername = escapeHtml(username);
  const safeAmount = escapeHtml(amount);
  const safeTotalPayout = escapeHtml(totalPayout);
  const safeAdminNote = adminNote ? escapeHtml(adminNote) : undefined;

  // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml(); safeAdminNote is also escaped
  const statusMessages: Record<typeof status, { subject: string; headline: string; body: string; color: string }> = {
    approved: {
      subject: `Your CashClip withdrawal of $${totalPayout} has been approved`,
      headline: "Withdrawal Approved",
      body: `Your withdrawal of <strong>$${safeTotalPayout}</strong> has been approved and will be sent to your PayPal shortly.`, // nosemgrep: javascript.lang.security.html-in-template-string — safeTotalPayout uses escapeHtml()
      color: "#00C853",
    },
    paid: {
      subject: `Your CashClip withdrawal of $${totalPayout} has been paid`,
      headline: "Payment Sent!",
      body: `Your withdrawal of <strong>$${safeTotalPayout}</strong> has been sent to your PayPal account. Please allow 3–5 business days for the funds to appear.`, // nosemgrep: javascript.lang.security.html-in-template-string — safeTotalPayout uses escapeHtml()
      color: "#00C853",
    },
    rejected: {
      subject: `Your CashClip withdrawal of $${amount} could not be processed`,
      headline: "Withdrawal Rejected",
      body: `Unfortunately your withdrawal request of <strong>$${safeAmount}</strong> could not be processed and has been refunded to your CashClip balance.${safeAdminNote ? `<br><br><strong>Reason:</strong> ${safeAdminNote}` : ""}`, // nosemgrep: javascript.lang.security.html-in-template-string — safeAmount and safeAdminNote use escapeHtml()
      color: "#E53935",
    },
  };

  const msg = statusMessages[status];
  await send({
    to: toEmail,
    subject: msg.subject,
    text: msg.body.replace(/<[^>]+>/g, ""),
    // nosemgrep: javascript.lang.security.html-in-template-string — safeUsername and msg.body use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid ${msg.color};padding-bottom:12px">${msg.headline}</h2>
        <p style="color:#333">Hi ${safeUsername},</p>
        <p style="color:#333">${msg.body}</p>
        <p style="color:#333">Thank you for using CashClip.<br><strong>The CashClip Team</strong></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#999">CashClip · cash-clip.app · support@absustaininvest.com</p>
      </div>`,
  });
}
