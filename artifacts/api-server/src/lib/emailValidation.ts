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

  return { valid: true };
}

export function isRelayEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  const domain = atIndex >= 0 ? normalized.slice(atIndex + 1) : "";
  return RELAY_DOMAINS.has(domain);
}
