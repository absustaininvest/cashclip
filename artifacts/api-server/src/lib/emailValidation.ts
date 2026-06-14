const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URI_RESERVED_IN_LOCAL = /[?#&%]/;

/**
 * Known privacy-relay, anonymous-forwarding, and hide-my-email domains.
 * Addresses on these domains cannot receive our verification email and
 * cannot be used to contact or identify the account holder.
 */
const RELAY_DOMAINS = new Set([
  // NOTE: privaterelay.appleid.com is intentionally NOT in this list.
  // Apple's "Hide My Email" is a guaranteed-delivery forwarding service —
  // verification emails are reliably forwarded to the user's real iCloud
  // inbox. Blocking it locks out iPhone users whose email field autofills
  // with @privaterelay.appleid.com.
  "relay.firefox.com",
  "mozmail.com",
  "anonaddy.com",
  "anonaddy.me",
  "simplelogin.com",
  "simplelogin.io",
  "simplelogin.co",
  "simplelogin.fr",
  "aleeas.com",
  "hide.com",
  "hideaddress.net",
  "duck.com",
]);

const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);

const RESERVED_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "test.com",
]);

export function validateRegistrationEmail(email: string): { valid: boolean; reason?: string } {
  const normalized = email.trim().toLowerCase();

  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, reason: "Invalid email address" };
  }

  const atIndex = normalized.indexOf("@");
  const localPart = atIndex >= 0 ? normalized.slice(0, atIndex) : normalized;
  if (URI_RESERVED_IN_LOCAL.test(localPart)) {
    return { valid: false, reason: "Invalid email address" };
  }
  const domain = atIndex >= 0 ? normalized.slice(atIndex + 1) : "";

  if (RELAY_DOMAINS.has(domain)) {
    return {
      valid: false,
      reason:
        "Private relay and anonymous email addresses are not accepted. Please use a real email address.",
    };
  }

  const labels = domain.split(".");
  const tld = labels[labels.length - 1] ?? "";
  const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) {
    return { valid: false, reason: "Please enter a real email domain." };
  }
  if (!/^[a-z]{2,}$/.test(tld)) {
    return { valid: false, reason: "Please enter a real email domain." };
  }

  const isReservedDomain =
    RESERVED_DOMAINS.has(domain) ||
    [...RESERVED_DOMAINS].some((d) => domain.endsWith(`.${d}`));
  if (RESERVED_TLDS.has(tld) || isReservedDomain) {
    return {
      valid: false,
      reason: "Please use a real, deliverable email address.",
    };
  }

  return { valid: true };
}

/**
 * Known disposable/throwaway email providers whose addresses are commonly
 * used to create fake PayPal accounts for fraudulent payouts.
 */
const DISPOSABLE_DOMAINS = new Set([
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
const SHORT_SLD_TRUSTED_TLDS = new Set([
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

  if (DISPOSABLE_DOMAINS.has(domain)) return false;

  return true;
}

export function isRelayEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  const domain = atIndex >= 0 ? normalized.slice(atIndex + 1) : "";
  return RELAY_DOMAINS.has(domain);
}
