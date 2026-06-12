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
  // string  → use it as Reply-To
  // omitted → default to the support address
  // null    → send NO Reply-To header at all
  replyTo?: string | null;
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
  const replyToAddr = replyTo === null ? undefined : (replyTo ?? ADMIN_EMAIL);
  try {
    await transport.sendMail({ from: FROM_MAIN, ...(replyToAddr ? { replyTo: replyToAddr } : {}), ...mailOptions });
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
  const isExhausted = remaining <= 0;

  // When the admin has run completely out of backup codes, send a distinct,
  // high-urgency email: a lost authenticator now means a full lockout, the exact
  // failure this feature exists to prevent.
  if (isExhausted) {
    const safeUsername = escapeHtml(username);
    sendBestEffort({
      to,
      subject: "URGENT: You have 0 CashClip backup codes left — regenerate now",
      text: `Hi ${username},\n\nYou just used your LAST two-factor backup code to sign in to your CashClip admin account. You now have ZERO backup codes remaining.\n\nThis is urgent: if you lose access to your authenticator app, you will be permanently locked out of your admin account.\n\nSign in now and regenerate a fresh set of backup codes immediately, then store them somewhere safe.\n\nIf this wasn't you, reset your password right away — your account may be compromised.\n\n— The CashClip Team`,
      // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
      html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:auto;background:#0A0A0F;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#E53935,#FF6F60);padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">CashClip</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#fff;opacity:0.9;text-transform:uppercase;letter-spacing:1px">Urgent Security Alert</p>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0">Hi <strong style="color:#fff">${safeUsername}</strong>,</p>
          <p style="margin:0 0 16px;font-size:15px;color:#b0b0b0;line-height:1.6">You just used your <strong style="color:#fff">last</strong> two-factor backup code to sign in to your CashClip admin account.</p>
          <div style="text-align:center;margin:24px 0">
            <div style="display:inline-block;background:#2a0a0a;border:2px solid #E53935;border-radius:16px;padding:16px 40px">
              <span style="font-size:44px;font-weight:800;color:#FF6F60">0</span>
              <span style="font-size:14px;color:#b0b0b0;display:block;margin-top:4px">backup codes remaining</span>
            </div>
          </div>
          <div style="margin:20px 0 0;background:#2a0a0a;border:1px solid #E53935;border-radius:12px;padding:16px">
            <p style="margin:0;font-size:14px;color:#ffb3ab;line-height:1.6"><strong style="color:#FF6F60">You are one lost authenticator away from a full lockout.</strong> Sign in now and regenerate a fresh set of backup codes immediately, then store them somewhere safe.</p>
          </div>
          <p style="margin:24px 0 0;font-size:12px;color:#555;text-align:center">If this wasn't you, reset your password right away — your account may be compromised.</p>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;text-align:center">
            <p style="margin:0;font-size:11px;color:#444">CashClip · support@absustaininvest.com</p>
          </div>
        </div>
      </div>`,
    });
    return;
  }

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

export function sendTwoFactorActiveNotice(options: {
  to: string;
  username: string;
  backupCodesCount: number;
  context: "enabled" | "regenerated";
}): void {
  const { to, username, backupCodesCount, context } = options;
  const safeUsername = escapeHtml(username);
  const safeCount = escapeHtml(String(backupCodesCount));
  const codeWord = backupCodesCount === 1 ? "code" : "codes";
  const isEnabled = context === "enabled";
  const headline = isEnabled ? "Two-Factor Authentication Enabled" : "Backup Codes Regenerated";
  const subject = isEnabled
    ? "Two-factor authentication is now active on your CashClip admin account"
    : "Your CashClip backup codes were just regenerated";
  const lead = isEnabled
    ? `Two-factor authentication (2FA) is now active on your CashClip admin account. You'll be asked for a code from your authenticator app each time you sign in.`
    : `A fresh set of two-factor backup codes was just generated for your CashClip admin account. Any backup codes from before this point no longer work.`;
  const text = `Hi ${username},\n\n${lead}\n\nYou currently hold ${backupCodesCount} backup ${codeWord}. Keep them somewhere safe — they're your way back in if you lose your authenticator app. You can review or regenerate them anytime from the admin portal under Security settings.\n\nThis email never contains your actual codes. If you didn't make this change, reset your password immediately and contact support.\n\n— The CashClip Team`;
  sendBestEffort({
    to,
    subject,
    text,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:auto;background:#0A0A0F;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#00C853,#00E676);padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#0A0A0F;letter-spacing:-0.5px">CashClip</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#0A0A0F;opacity:0.75">Security Update</p>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0">Hi <strong style="color:#fff">${safeUsername}</strong>,</p>
          <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#fff">${headline}</p>
          <p style="margin:0 0 20px;font-size:15px;color:#b0b0b0;line-height:1.6">${escapeHtml(lead)}</p>
          <div style="text-align:center;margin:24px 0">
            <div style="display:inline-block;background:#1a1a2e;border:2px solid #00E676;border-radius:16px;padding:16px 36px">
              <span style="font-size:36px;font-weight:800;color:#00E676">${safeCount}</span>
              <span style="font-size:14px;color:#b0b0b0;display:block;margin-top:4px">backup ${codeWord} on file</span>
            </div>
          </div>
          <p style="margin:20px 0 0;font-size:14px;color:#b0b0b0;line-height:1.6">Keep your backup codes somewhere safe — they're your way back in if you lose your authenticator app. You can review or regenerate them anytime from the admin portal under Security settings.</p>
          <p style="margin:20px 0 0;font-size:12px;color:#555;text-align:center">This email never contains your actual codes. If you didn't make this change, reset your password immediately and contact support.</p>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;text-align:center">
            <p style="margin:0;font-size:11px;color:#444">CashClip · support@absustaininvest.com</p>
          </div>
        </div>
      </div>`,
  });
}

export function sendTwoFactorDisabledNotice(options: {
  to: string;
  username: string;
}): void {
  const { to, username } = options;
  const safeUsername = escapeHtml(username);
  const subject = "Two-factor authentication was turned off on your CashClip admin account";
  const lead = `Two-factor authentication (2FA) has just been turned off on your CashClip admin account. From now on, signing in no longer requires a code from your authenticator app, and your previous backup codes have been cleared.`;
  const text = `Hi ${username},\n\n${lead}\n\nIf this was you, no action is needed. If you did NOT turn off 2FA, your account may be compromised — reset your password immediately, re-enable 2FA from the admin portal under Security settings, and contact support right away.\n\nThis email never contains any secrets or codes.\n\n— The CashClip Team`;
  sendBestEffort({
    to,
    subject,
    text,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:auto;background:#0A0A0F;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#FF5252,#FF1744);padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">CashClip</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#fff;opacity:0.85">Security Alert</p>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0">Hi <strong style="color:#fff">${safeUsername}</strong>,</p>
          <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#fff">Two-Factor Authentication Disabled</p>
          <p style="margin:0 0 20px;font-size:15px;color:#b0b0b0;line-height:1.6">${escapeHtml(lead)}</p>
          <div style="background:#1a1a2e;border:2px solid #FF1744;border-radius:16px;padding:18px 20px;margin:24px 0">
            <p style="margin:0;font-size:14px;color:#e0e0e0;line-height:1.6"><strong style="color:#FF5252">Didn't do this?</strong> Your account may be compromised. Reset your password immediately, re-enable 2FA from the admin portal under Security settings, and contact support right away.</p>
          </div>
          <p style="margin:20px 0 0;font-size:12px;color:#555;text-align:center">This email never contains any secrets or codes.</p>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;text-align:center">
            <p style="margin:0;font-size:11px;color:#444">CashClip · support@absustaininvest.com</p>
          </div>
        </div>
      </div>`,
  });
}

export function sendPasswordChangedNotice(options: {
  to: string;
  username: string;
  context: "changed" | "reset";
}): void {
  const { to, username, context } = options;
  const safeUsername = escapeHtml(username);
  const isReset = context === "reset";
  const subject = isReset
    ? "Your CashClip admin password was just reset"
    : "Your CashClip admin password was just changed";
  const lead = isReset
    ? `Your CashClip admin account password was just reset using the account-recovery flow. You'll need to sign in with your new password from now on.`
    : `The password on your CashClip admin account was just changed. You'll need to sign in with your new password from now on.`;
  const text = `Hi ${username},\n\n${lead}\n\nIf this was you, no action is needed. If you did NOT make this change, your account may be compromised — reset your password immediately${isReset ? "" : " using the account-recovery flow"}, and contact support right away.\n\nThis email never contains your password or any secrets.\n\n— The CashClip Team`;
  sendBestEffort({
    to,
    subject,
    text,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:auto;background:#0A0A0F;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#FF5252,#FF1744);padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">CashClip</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#fff;opacity:0.85">Security Alert</p>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0">Hi <strong style="color:#fff">${safeUsername}</strong>,</p>
          <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#fff">${isReset ? "Password Reset" : "Password Changed"}</p>
          <p style="margin:0 0 20px;font-size:15px;color:#b0b0b0;line-height:1.6">${escapeHtml(lead)}</p>
          <div style="background:#1a1a2e;border:2px solid #FF1744;border-radius:16px;padding:18px 20px;margin:24px 0">
            <p style="margin:0;font-size:14px;color:#e0e0e0;line-height:1.6"><strong style="color:#FF5252">Didn't do this?</strong> Your account may be compromised. Reset your password immediately${isReset ? "" : " using the account-recovery flow"}, and contact support right away.</p>
          </div>
          <p style="margin:20px 0 0;font-size:12px;color:#555;text-align:center">This email never contains your password or any secrets.</p>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;text-align:center">
            <p style="margin:0;font-size:11px;color:#444">CashClip · support@absustaininvest.com</p>
          </div>
        </div>
      </div>`,
  });
}

export function sendAdminCreditReceipt(options: {
  to: string;
  username: string;
  amount: number; // signed: positive = credit, negative = correction
  newBalance: number;
  note: string;
  actor?: string; // identity of the admin who issued the adjustment (audit trail)
}): void {
  const { to, username, amount, newBalance, note, actor } = options;
  const actorLabel = actor && actor.trim().length > 0 ? actor.trim() : "unknown admin";
  const safeActor = escapeHtml(actorLabel);
  const isCorrection = amount < 0;
  const abs = Math.abs(amount).toFixed(2);
  const balanceStr = newBalance.toFixed(2);
  const safeUsername = escapeHtml(username);
  const safeNote = escapeHtml(note);
  const safeAbs = escapeHtml(abs);
  const safeBalance = escapeHtml(balanceStr);
  const signedLabel = isCorrection ? `-$${abs}` : `+$${abs}`;
  const accent = isCorrection ? "#ffb300" : "#00E676";

  const subject = isCorrection
    ? "A balance correction was applied to your CashClip account"
    : "You received a CashClip balance credit";
  const lead = isCorrection
    ? `Our team applied a manual balance correction of -$${abs} to your CashClip account.`
    : `Our team added a manual credit of $${abs} to your CashClip account.`;

  // User-facing receipt (skipped automatically if the address is missing/invalid).
  sendBestEffort({
    to,
    subject,
    text: `Hi ${username},\n\n${lead}\n\nReason: ${note}\nNew balance: $${balanceStr}\n\nIf you have any questions about this adjustment, just reply to this email.\n\n— The CashClip Team`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:auto;background:#0A0A0F;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#00C853,#00E676);padding:32px 32px 24px;text-align:center">
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#0A0A0F;letter-spacing:-0.5px">CashClip</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#0A0A0F;opacity:0.75">${isCorrection ? "Balance Correction" : "Balance Credit"}</p>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:15px;color:#e0e0e0">Hi <strong style="color:#fff">${safeUsername}</strong>,</p>
          <p style="margin:0 0 20px;font-size:15px;color:#b0b0b0;line-height:1.6">${escapeHtml(lead)}</p>
          <div style="text-align:center;margin:24px 0">
            <div style="display:inline-block;background:#1a1a2e;border:2px solid ${accent};border-radius:16px;padding:16px 36px">
              <span style="font-size:34px;font-weight:800;color:${accent}">${isCorrection ? "-" : "+"}$${safeAbs}</span>
              <span style="font-size:13px;color:#b0b0b0;display:block;margin-top:4px">new balance: $${safeBalance}</span>
            </div>
          </div>
          <div style="margin:20px 0 0;background:#15151f;border:1px solid #1e1e2e;border-radius:12px;padding:16px">
            <p style="margin:0;font-size:13px;color:#8a8a9a;text-transform:uppercase;letter-spacing:1px">Reason</p>
            <p style="margin:6px 0 0;font-size:14px;color:#e0e0e0;line-height:1.6">${safeNote}</p>
          </div>
          <p style="margin:24px 0 0;font-size:12px;color:#555;text-align:center">Questions about this adjustment? Just reply to this email.</p>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;text-align:center">
            <p style="margin:0;font-size:11px;color:#444">CashClip · support@absustaininvest.com</p>
          </div>
        </div>
      </div>`,
  });

  // Internal copy for the audit trail — always sent so support@ has a record
  // even when the target account has no email on file.
  sendBestEffort({
    to: ADMIN_EMAIL,
    subject: `[Admin receipt] ${isCorrection ? "Correction" : "Credit"} ${signedLabel} → ${username}`,
    text: `Admin balance ${isCorrection ? "correction" : "credit"} applied.\n\nUser: ${username}${to ? ` <${to}>` : " (no email on file)"}\nAmount: ${signedLabel}\nReason: ${note}\nNew balance: $${balanceStr}\nIssued by: ${actorLabel}`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid ${accent};padding-bottom:12px">Admin Balance ${isCorrection ? "Correction" : "Credit"}</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:8px 0;font-weight:600;color:#555;width:110px">User</td><td style="padding:8px 0">${safeUsername}${to ? ` &lt;${escapeHtml(to)}&gt;` : " (no email)"}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">Amount</td><td style="padding:8px 0;font-weight:700">${signedLabel}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">New balance</td><td style="padding:8px 0">$${safeBalance}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">Issued by</td><td style="padding:8px 0">${safeActor}</td></tr>
        </table>
        <div style="margin-top:16px;background:#f7f7f7;border-left:4px solid ${accent};padding:16px;border-radius:4px">
          <p style="margin:0;white-space:pre-wrap;color:#333">${safeNote}</p>
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
  userEmail?: string | null;
}): Promise<void> {
  const safeUsername = escapeHtml(ticket.username);
  const safeUserId = escapeHtml(ticket.userId);
  const safeSubject = escapeHtml(ticket.subject);
  const safeMessage = escapeHtml(ticket.message);

  // When the account on file has a valid email, set it as Reply-To so hitting
  // "Reply" in the support mailbox goes straight to the user (not back to the
  // support address itself). Also surface it in the body so the operator can
  // see who the ticket is from at a glance.
  const userEmail = ticket.userEmail?.trim();
  const hasEmail = !!userEmail && isValidEmail(userEmail);
  const safeUserEmail = hasEmail ? escapeHtml(userEmail!) : "";
  const emailRowHtml = hasEmail
    ? `<tr><td style="padding:8px 0;font-weight:600;color:#555">Email</td><td style="padding:8px 0"><a href="mailto:${safeUserEmail}" style="color:#00A843">${safeUserEmail}</a></td></tr>`
    : `<tr><td style="padding:8px 0;font-weight:600;color:#555">Email</td><td style="padding:8px 0;color:#c0392b">none on file — ask the user to reply with their account email</td></tr>`;
  const emailTextLine = hasEmail ? `\nEmail: ${userEmail}` : "\nEmail: none on file";

  await send({
    to: ADMIN_EMAIL,
    // Valid user email → reply goes to them; otherwise send NO Reply-To so the
    // ticket doesn't misleadingly route a reply back to the support address.
    replyTo: hasEmail ? userEmail! : null,
    subject: `[CashClip Support] ${ticket.subject}`,
    text: `New support ticket from ${ticket.username} (ID: ${ticket.userId})${emailTextLine}\n\nSubject: ${ticket.subject}\n\nMessage:\n${ticket.message}`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid #00C853;padding-bottom:12px">New Support Ticket</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:8px 0;font-weight:600;color:#555;width:100px">User</td><td style="padding:8px 0">${safeUsername}</td></tr>
          ${emailRowHtml}
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

export async function sendWithdrawalRequestedUser(options: {
  toEmail: string;
  username: string;
  totalPayout: string;
  paypalEmail: string;
}): Promise<void> {
  const { toEmail, username, totalPayout, paypalEmail } = options;
  const safeUsername = escapeHtml(username);
  const safeTotalPayout = escapeHtml(totalPayout);
  const safePaypalEmail = escapeHtml(paypalEmail);
  await send({
    to: toEmail,
    subject: `Your CashClip withdrawal of $${totalPayout} is on its way`,
    text: `Hi ${username},\n\nWe received your withdrawal request for $${totalPayout}. It's on its way to your PayPal (${paypalEmail}) — you'll receive it within minutes.\n\nThank you for using CashClip.`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid #00C853;padding-bottom:12px">Withdrawal On Its Way</h2>
        <p style="color:#333">Hi ${safeUsername},</p>
        <p style="color:#333">We received your withdrawal request for <strong>$${safeTotalPayout}</strong>. It's on its way to your PayPal (<strong>${safePaypalEmail}</strong>) — you'll receive it within minutes.</p>
        <p style="color:#333">Thank you for using CashClip.<br><strong>The CashClip Team</strong></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#999">CashClip · cash-clip.app · support@absustaininvest.com</p>
      </div>`,
  });
}

export async function sendWithdrawalVelocityAdmin(alert: {
  username: string;
  countToday: number;
  amount: string;
  totalPayout: string;
  paypalEmail: string;
  withdrawalId: string;
}): Promise<void> {
  const safeUsername = escapeHtml(alert.username);
  const safeAmount = escapeHtml(alert.amount);
  const safeTotalPayout = escapeHtml(alert.totalPayout);
  const safePaypalEmail = escapeHtml(alert.paypalEmail);
  const safeId = escapeHtml(alert.withdrawalId);
  const safeCount = escapeHtml(String(alert.countToday));
  await send({
    to: ADMIN_EMAIL,
    subject: `[CashClip] Velocity alert — ${alert.username} made withdrawal #${alert.countToday} today`,
    text: `Velocity alert:\n\nUser: ${alert.username}\nWithdrawal #${alert.countToday} today\nThis withdrawal: $${alert.totalPayout}\nPayPal: ${alert.paypalEmail}\nID: ${alert.withdrawalId}`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid #FB8C00;padding-bottom:12px">Withdrawal Velocity Alert</h2>
        <p style="color:#333">A user has made <strong>${safeCount}</strong> withdrawals today.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:8px 0;font-weight:600;color:#555;width:140px">User</td><td style="padding:8px 0">${safeUsername}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">Today's count</td><td style="padding:8px 0">${safeCount}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">This withdrawal</td><td style="padding:8px 0">$${safeTotalPayout} (base $${safeAmount})</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">PayPal</td><td style="padding:8px 0">${safePaypalEmail}</td></tr>
          <tr><td style="padding:8px 0;font-weight:600;color:#555">ID</td><td style="padding:8px 0;font-size:12px;color:#999">${safeId}</td></tr>
        </table>
        <p style="margin-top:24px;font-size:12px;color:#999">CashClip Admin · cash-clip.app</p>
      </div>`,
  });
}

/**
 * Notify the operator that an AdMob reporting condition (stale sync or
 * revenue divergence) just fired or resolved. Routed through the same Zoho SMTP
 * channel used for OTPs/support so the owner reacts without watching the hub.
 *
 * Fire-and-forget and a no-op when SMTP is unconfigured. De-duplication is the
 * caller's responsibility — admobAlerts only calls this once per fired/resolved
 * transition (governed by its cooldown), so this never floods.
 *
 * Recipient resolution: an explicit `to` (the admin Integration Hub setting,
 * persisted in the DB) wins; absent that, the ADMIN_ALERT_EMAIL env var; absent
 * that, the default operator mailbox (support@absustaininvest.com).
 */
export function sendAdmobReportAlert(alert: {
  condition: "stale_sync" | "revenue_divergence";
  status: "firing" | "resolved";
  message: string;
  firedAt: string;
  detail: Record<string, unknown>;
  to?: string;
}): void {
  const to = alert.to?.trim() || process.env["ADMIN_ALERT_EMAIL"]?.trim() || ADMIN_EMAIL;
  const isResolved = alert.status === "resolved";
  const conditionLabel =
    alert.condition === "stale_sync" ? "AdMob reporting stale" : "AdMob revenue divergence";
  const accent = isResolved ? "#00C853" : "#FB8C00";
  const statusWord = isResolved ? "Resolved" : "Firing";

  const safeMessage = escapeHtml(alert.message);
  const safeCondition = escapeHtml(alert.condition);
  const safeFiredAt = escapeHtml(alert.firedAt);

  // Render the structured detail as readable key/value rows for the operator.
  const detailRows = Object.entries(alert.detail)
    .map(([k, v]) => {
      const val = v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return `<tr><td style="padding:6px 0;font-weight:600;color:#555;width:160px">${escapeHtml(k)}</td><td style="padding:6px 0;color:#333">${escapeHtml(val)}</td></tr>`;
    })
    .join("");
  const detailText = Object.entries(alert.detail)
    .map(([k, v]) => `  ${k}: ${v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("\n");

  const subject = isResolved
    ? `[CashClip] Resolved — ${conditionLabel} back to normal`
    : `[CashClip] Alert — ${conditionLabel}`;

  sendBestEffort({
    to,
    subject,
    text: `AdMob reporting operator alert\n\nCondition: ${alert.condition}\nStatus: ${alert.status}\nWhen: ${alert.firedAt}\n\n${alert.message}\n\nDetail:\n${detailText}\n\n— CashClip operations`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid ${accent};padding-bottom:12px">${conditionLabel} — ${statusWord}</h2>
        <p style="color:#333;font-size:15px;line-height:1.6">${safeMessage}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:6px 0;font-weight:600;color:#555;width:160px">Condition</td><td style="padding:6px 0;color:#333">${safeCondition}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600;color:#555">Status</td><td style="padding:6px 0;color:#333">${escapeHtml(statusWord)}</td></tr>
          <tr><td style="padding:6px 0;font-weight:600;color:#555">When</td><td style="padding:6px 0;color:#333">${safeFiredAt}</td></tr>
          ${detailRows}
        </table>
        <p style="margin-top:24px;font-size:12px;color:#999">CashClip operations · /sc-portal Integration Hub · cash-clip.app</p>
      </div>`,
  });
}

/**
 * Send an admin reply to an inbound support email.
 *
 * Unlike the notification helpers above (fire-and-forget), this throws on
 * failure so the calling admin route can report whether the reply actually
 * went out. Threading headers (In-Reply-To / References) are set from the
 * original message's Message-ID so the reply lands in the same Zoho thread.
 */
export async function sendSupportReply(options: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
}): Promise<void> {
  const { to, subject, body, inReplyTo } = options;
  const transport = createTransport();
  if (!transport) {
    throw new Error("Email not configured — ZOHO_SMTP_PASSWORD missing");
  }
  if (!isValidEmail(to)) {
    throw new Error("Invalid recipient address");
  }

  const safeBody = escapeHtml(body).replace(/\n/g, "<br>");
  const references = inReplyTo ? inReplyTo : undefined;

  await transport.sendMail({
    from: FROM_MAIN,
    to,
    replyTo: ADMIN_EMAIL,
    subject,
    text: body,
    // nosemgrep: javascript.lang.security.html-in-template-string — body is escaped via escapeHtml()
    html: `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:auto;color:#1a1a1a;font-size:15px;line-height:1.6">
        <div style="white-space:pre-wrap">${safeBody}</div>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#999">CashClip Support · cash-clip.app · support@absustaininvest.com</p>
      </div>`,
    ...(inReplyTo ? { inReplyTo, references } : {}),
  });
  logger.info({ to, subject }, "Support reply sent");
}

/**
 * Notify a referrer that one of their referred friends cashed out and they
 * earned a referral bonus. Fire-and-forget; skipped when email is unconfigured
 * or the referrer has no email address on file.
 */
export function sendReferralBonusEarned(options: {
  toEmail: string;
  referrerUsername: string;
  bonusUsd: string;
}): void {
  const { toEmail, referrerUsername, bonusUsd } = options;
  const safeUsername = escapeHtml(referrerUsername);
  const safeBonus = escapeHtml(bonusUsd);
  sendBestEffort({
    to: toEmail,
    subject: `You earned $${bonusUsd} — your friend just cashed out on CashClip!`,
    text: `Hi ${referrerUsername},\n\nGreat news! One of the friends you referred just made their first cash-out on CashClip. As a thank-you, we've added $${bonusUsd} to your balance.\n\nOpen the app to see your updated balance and keep sharing your referral link to earn more!\n\nThe CashClip Team`,
    // nosemgrep: javascript.lang.security.html-in-template-string — all interpolations use escapeHtml()
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
        <h2 style="color:#1a1a1a;border-bottom:2px solid #00E676;padding-bottom:12px">You earned a referral bonus! 🎉</h2>
        <p style="color:#333">Hi ${safeUsername},</p>
        <p style="color:#333">One of the friends you referred just made their first cash-out on CashClip. As a thank-you, we've added <strong>$${safeBonus}</strong> to your balance.</p>
        <p style="color:#333">Open the app to see your updated balance — and keep sharing your referral link to earn more bonuses!</p>
        <p style="color:#333">Thank you for spreading the word.<br><strong>The CashClip Team</strong></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:12px;color:#999">CashClip · cash-clip.app · support@absustaininvest.com</p>
      </div>`,
    replyTo: null,
  });
}
