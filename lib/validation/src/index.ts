/**
 * Shared validation helpers used by both the API server and the CashClip
 * client. Keeping a single source of truth here prevents the PayPal domain
 * lists from silently diverging between client and server.
 */

/**
 * Known disposable/throwaway email providers whose addresses are commonly
 * used to create fake PayPal accounts for fraudulent payouts.
 */
export const PAYPAL_DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamail.biz",
  "guerrillamail.de",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "grr.la",
  "sharklasers.com",
  "spam4.me",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "tempmail.com",
  "temp-mail.org",
  "throwaway.email",
  "getnada.com",
  "mailnull.com",
  "spamgourmet.com",
  "trashmail.at",
  "trashmail.io",
  "trashmail.me",
  "trashmail.net",
  "trashmail.xyz",
  "wegwerfmail.de",
  "wegwerfmail.net",
  "wegwerfmail.org",
  "10minutemail.com",
  "10minutemail.net",
  "mailnesia.com",
  "discard.email",
  "filzmail.com",
  "boun.cr",
  "trbvm.com",
  "yopmail.com",
  "throwam.com",
]);

/**
 * TLDs where a short SLD (≤ 3 chars) is plausible for a real PayPal account.
 * Established brands like aol.com, qq.com, msn.com, sky.com all fall here.
 * Country-code or speculative TLDs like .co, .cc, .biz are excluded — a
 * 3-char label on one of those is a strong fake-address signal (e.g. aaa.co).
 */
export const SHORT_SLD_TRUSTED_TLDS = new Set([
  "com", "net", "org", "gov", "edu", "mil", "int",
  "io", "app", "dev",
]);

/**
 * Returns true if the PayPal email has a plausible domain suitable for
 * a real PayPal account.
 *
 * Rejects:
 *  - Any domain label shorter than 2 characters (`user@a.co`, `user@x.y`,
 *    `user@domain.x`) — implausibly short.
 *  - 2-label domains (SLD.TLD) where the SLD is ≤ 3 characters AND the TLD
 *    is not in SHORT_SLD_TRUSTED_TLDS. This blocks `user@aaa.co`,
 *    `user@ab.cc`, etc. while keeping `user@aol.com`, `user@qq.com`.
 *  - Domains on the known-disposable / throwaway provider list.
 *
 * Legitimate multi-label domains like `user@ox.ac.uk` pass because the
 * per-label ≥ 2 char check is satisfied and the 2-label rule does not apply.
 */
export function isPlausiblePayPalDomain(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex < 0) return false;
  const domain = normalized.slice(atIndex + 1);
  if (!domain) return false;

  const labels = domain.split(".");
  if (labels.length < 2) return false;

  if (labels.some((l) => l.length < 2)) return false;

  if (labels.length === 2) {
    const sld = labels[0]!;
    const tld = labels[1]!;
    if (sld.length <= 3 && !SHORT_SLD_TRUSTED_TLDS.has(tld)) {
      return false;
    }
  }

  if (PAYPAL_DISPOSABLE_DOMAINS.has(domain)) return false;

  return true;
}
