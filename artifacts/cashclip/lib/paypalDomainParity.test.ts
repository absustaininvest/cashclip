/**
 * Parity test: client-side isPlausiblePayPalDomain (wallet.tsx) vs server copy.
 *
 * The function is defined inline in app/(tabs)/wallet.tsx and is not exported,
 * so we reproduce it verbatim here (including the companion constants) to run
 * identical test cases against both copies in CI.
 *
 * If the server copy (artifacts/api-server/src/lib/emailValidation.ts) is
 * updated, the corresponding constants and logic in wallet.tsx — and this file —
 * must be updated to match.  A diff between this file and
 * emailValidation.test.ts is the authoritative parity check.
 */

import { describe, it, expect } from "vitest";

// ─── Reproduced verbatim from app/(tabs)/wallet.tsx ──────────────────────────

const PAYPAL_DISPOSABLE_DOMAINS = new Set([
  "mailinator.com","guerrillamail.com","guerrillamail.info","guerrillamail.biz",
  "guerrillamail.de","guerrillamail.net","guerrillamail.org","guerrillamailblock.com",
  "grr.la","sharklasers.com","spam4.me","maildrop.cc","dispostable.com",
  "fakeinbox.com","tempmail.com","temp-mail.org","throwaway.email","getnada.com",
  "mailnull.com","spamgourmet.com","trashmail.at","trashmail.io","trashmail.me",
  "trashmail.net","trashmail.xyz","wegwerfmail.de","wegwerfmail.net","wegwerfmail.org",
  "10minutemail.com","10minutemail.net","mailnesia.com","discard.email","filzmail.com",
  "boun.cr","trbvm.com","yopmail.com","throwam.com",
]);

const SHORT_SLD_TRUSTED_TLDS = new Set([
  "com","net","org","gov","edu","mil","int","io","app","dev",
]);

function isPlausiblePayPalDomain(email: string): boolean {
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
    if (sld.length <= 3 && !SHORT_SLD_TRUSTED_TLDS.has(tld)) return false;
  }
  if (PAYPAL_DISPOSABLE_DOMAINS.has(domain)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

function expectBlocked(emails: string[]) {
  for (const email of emails) {
    expect(isPlausiblePayPalDomain(email), `expected ${email} to be BLOCKED`).toBe(false);
  }
}

function expectAllowed(emails: string[]) {
  for (const email of emails) {
    expect(isPlausiblePayPalDomain(email), `expected ${email} to be ALLOWED`).toBe(true);
  }
}

// ─── Tests (identical cases to emailValidation.test.ts) ──────────────────────

describe("[client parity] isPlausiblePayPalDomain — disposable domains", () => {
  it("blocks mailinator.com", () => {
    expectBlocked(["user@mailinator.com"]);
  });

  it("blocks guerrillamail family", () => {
    expectBlocked([
      "x@guerrillamail.com",
      "x@guerrillamail.info",
      "x@guerrillamail.biz",
      "x@guerrillamail.de",
      "x@guerrillamail.net",
      "x@guerrillamail.org",
      "x@guerrillamailblock.com",
    ]);
  });

  it("blocks other known disposable providers", () => {
    expectBlocked([
      "x@grr.la",
      "x@sharklasers.com",
      "x@spam4.me",
      "x@maildrop.cc",
      "x@dispostable.com",
      "x@fakeinbox.com",
      "x@tempmail.com",
      "x@temp-mail.org",
      "x@throwaway.email",
      "x@getnada.com",
      "x@mailnull.com",
      "x@spamgourmet.com",
      "x@trashmail.at",
      "x@trashmail.io",
      "x@trashmail.me",
      "x@trashmail.net",
      "x@trashmail.xyz",
      "x@wegwerfmail.de",
      "x@wegwerfmail.net",
      "x@wegwerfmail.org",
      "x@10minutemail.com",
      "x@10minutemail.net",
      "x@mailnesia.com",
      "x@discard.email",
      "x@filzmail.com",
      "x@boun.cr",
      "x@trbvm.com",
      "x@yopmail.com",
      "x@throwam.com",
    ]);
  });
});

describe("[client parity] isPlausiblePayPalDomain — short-SLD rejection on untrusted TLDs", () => {
  it("blocks a 3-char SLD on .co", () => {
    expectBlocked(["user@aaa.co"]);
  });

  it("blocks a 2-char SLD on .cc", () => {
    expectBlocked(["user@ab.cc"]);
  });

  it("blocks a 3-char SLD on .biz", () => {
    expectBlocked(["user@xyz.biz"]);
  });

  it("blocks a 1-char SLD (also fails per-label ≥ 2 char rule)", () => {
    expectBlocked(["user@a.co"]);
  });

  it("blocks a 3-char SLD on .uk", () => {
    expectBlocked(["user@abc.uk"]);
  });
});

describe("[client parity] isPlausiblePayPalDomain — short-SLD carve-outs (trusted TLDs)", () => {
  it("allows aol.com (3-char SLD on .com)", () => {
    expectAllowed(["user@aol.com"]);
  });

  it("allows qq.com (2-char SLD on .com)", () => {
    expectAllowed(["user@qq.com"]);
  });

  it("allows msn.com, sky.com", () => {
    expectAllowed(["user@msn.com", "user@sky.com"]);
  });

  it("allows 3-char SLD on .net / .org / .io / .app / .dev / .gov / .edu", () => {
    expectAllowed([
      "user@abc.net",
      "user@abc.org",
      "user@abc.io",
      "user@abc.app",
      "user@abc.dev",
      "user@irs.gov",
      "user@mit.edu",
    ]);
  });
});

describe("[client parity] isPlausiblePayPalDomain — multi-label domains", () => {
  it("allows ox.ac.uk", () => {
    expectAllowed(["user@ox.ac.uk"]);
  });

  it("allows amazon.co.uk", () => {
    expectAllowed(["user@amazon.co.uk"]);
  });

  it("allows mail.google.com", () => {
    expectAllowed(["user@mail.google.com"]);
  });

  it("allows me.com (2-char SLD carve-out on .com)", () => {
    expectAllowed(["user@me.com"]);
  });
});

describe("[client parity] isPlausiblePayPalDomain — structural rejects", () => {
  it("blocks an email with no @ sign", () => {
    expectBlocked(["notanemail"]);
  });

  it("blocks empty domain after @", () => {
    expectBlocked(["user@"]);
  });

  it("blocks single-label domain (no TLD)", () => {
    expectBlocked(["user@localhost", "user@hostname"]);
  });

  it("blocks single-char label anywhere in domain", () => {
    expectBlocked(["user@a.com", "user@good.a.com"]);
  });

  it("blocks single-char TLD", () => {
    expectBlocked(["user@domain.x"]);
  });
});

describe("[client parity] isPlausiblePayPalDomain — trimming and case", () => {
  it("trims surrounding whitespace", () => {
    expectAllowed(["  user@gmail.com  "]);
  });

  it("treats uppercase as lowercase", () => {
    expectAllowed(["USER@GMAIL.COM"]);
  });

  it("still blocks disposable domain in mixed case", () => {
    expectBlocked(["user@Mailinator.COM"]);
  });
});

describe("[client parity] isPlausiblePayPalDomain — real PayPal account domains allowed", () => {
  it("allows common providers linked to real PayPal accounts", () => {
    expectAllowed([
      "user@gmail.com",
      "user@yahoo.com",
      "user@hotmail.com",
      "user@outlook.com",
      "user@icloud.com",
      "user@paypal.com",
      "user@live.com",
      "user@protonmail.com",
      "user@zoho.com",
    ]);
  });
});
