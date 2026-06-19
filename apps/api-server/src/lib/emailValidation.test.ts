/**
 * Unit tests for isPlausiblePayPalDomain (artifacts/api-server/src/lib/emailValidation.ts)
 *
 * Covers:
 *  - Disposable / throwaway email provider domains → blocked
 *  - Short-SLD (≤ 3 chars) on untrusted TLDs → blocked
 *  - Short-SLD on SHORT_SLD_TRUSTED_TLDS (com/net/org/io/…) → allowed
 *  - Multi-label country-code domains like ox.ac.uk → allowed
 *  - Single-label or single-char labels → blocked
 *  - Missing @ sign → blocked
 *  - Whitespace trimming and case-insensitivity
 *  - Standard everyday email domains → allowed
 */

import { describe, it, expect } from "vitest";
import { isPlausiblePayPalDomain } from "./emailValidation";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Shorthand: assert a list of emails all return false (blocked). */
function expectBlocked(emails: string[]) {
  for (const email of emails) {
    expect(isPlausiblePayPalDomain(email), `expected ${email} to be BLOCKED`).toBe(false);
  }
}

/** Shorthand: assert a list of emails all return true (allowed). */
function expectAllowed(emails: string[]) {
  for (const email of emails) {
    expect(isPlausiblePayPalDomain(email), `expected ${email} to be ALLOWED`).toBe(true);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("isPlausiblePayPalDomain — disposable / throwaway domains", () => {
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

describe("isPlausiblePayPalDomain — short-SLD rejection (≤ 3 chars) on untrusted TLDs", () => {
  it("blocks a 3-char SLD on .co (not in trusted list)", () => {
    expectBlocked(["user@aaa.co"]);
  });

  it("blocks a 2-char SLD on .cc", () => {
    expectBlocked(["user@ab.cc"]);
  });

  it("blocks a 3-char SLD on .biz", () => {
    expectBlocked(["user@xyz.biz"]);
  });

  it("blocks a 1-char SLD (also fails the ≥ 2 char per-label rule)", () => {
    expectBlocked(["user@a.co"]);
  });

  it("blocks a 3-char SLD on .uk (not in trusted list)", () => {
    expectBlocked(["user@abc.uk"]);
  });
});

describe("isPlausiblePayPalDomain — short-SLD on trusted TLDs (carve-outs)", () => {
  it("allows aol.com (3-char SLD on .com)", () => {
    expectAllowed(["user@aol.com"]);
  });

  it("allows qq.com (2-char SLD on .com)", () => {
    expectAllowed(["user@qq.com"]);
  });

  it("allows msn.com (3-char SLD on .com)", () => {
    expectAllowed(["user@msn.com"]);
  });

  it("allows sky.com (3-char SLD on .com)", () => {
    expectAllowed(["user@sky.com"]);
  });

  it("allows 3-char SLD on .net", () => {
    expectAllowed(["user@abc.net"]);
  });

  it("allows 3-char SLD on .org", () => {
    expectAllowed(["user@abc.org"]);
  });

  it("allows 3-char SLD on .io", () => {
    expectAllowed(["user@abc.io"]);
  });

  it("allows 3-char SLD on .app", () => {
    expectAllowed(["user@abc.app"]);
  });

  it("allows 3-char SLD on .dev", () => {
    expectAllowed(["user@abc.dev"]);
  });

  it("allows 3-char SLD on .gov", () => {
    expectAllowed(["user@irs.gov"]);
  });

  it("allows 3-char SLD on .edu", () => {
    expectAllowed(["user@mit.edu"]);
  });
});

describe("isPlausiblePayPalDomain — multi-label domains", () => {
  it("allows ox.ac.uk (2-char labels, 3 labels, classic .ac.uk academic)", () => {
    expectAllowed(["user@ox.ac.uk"]);
  });

  it("allows co.uk when the full address has a long enough host label", () => {
    expectAllowed(["user@amazon.co.uk"]);
  });

  it("allows mail.google.com (3 labels, all long)", () => {
    expectAllowed(["user@mail.google.com"]);
  });

  it("allows sub.domain.example.io (4-label domain)", () => {
    expectAllowed(["user@sub.domain.example.io"]);
  });

  it("allows me.com (2-char SLD on .com — carve-out)", () => {
    expectAllowed(["user@me.com"]);
  });
});

describe("isPlausiblePayPalDomain — structural rejects", () => {
  it("blocks an email with no @ sign", () => {
    expectBlocked(["notanemail", "nodomain"]);
  });

  it("blocks an email with an empty domain", () => {
    expectBlocked(["user@"]);
  });

  it("blocks a domain with only one label (no TLD)", () => {
    expectBlocked(["user@localhost", "user@hostname"]);
  });

  it("blocks a domain with a single-character label anywhere", () => {
    expectBlocked([
      "user@a.com",
      "user@good.a.com",
    ]);
  });

  it("blocks a domain label that is a single char as the TLD", () => {
    expectBlocked(["user@domain.x"]);
  });
});

describe("isPlausiblePayPalDomain — whitespace trimming and case-insensitivity", () => {
  it("trims leading and trailing whitespace from the email", () => {
    expectAllowed(["  user@gmail.com  "]);
  });

  it("treats uppercase domains as equivalent to lowercase", () => {
    expectAllowed(["USER@GMAIL.COM", "user@GMAIL.COM"]);
  });

  it("still blocks a disposable domain in mixed case", () => {
    expectBlocked(["user@Mailinator.COM", "user@MAILINATOR.COM"]);
  });
});

describe("isPlausiblePayPalDomain — common real PayPal account domains (allowed)", () => {
  it("allows standard providers commonly linked to PayPal accounts", () => {
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
