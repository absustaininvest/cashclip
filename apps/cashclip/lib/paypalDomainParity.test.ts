/**
 * Shared-export test: isPlausiblePayPalDomain now lives in @workspace/validation
 * and is imported by both the API server and the CashClip client (wallet.tsx).
 *
 * Since client and server share one source of truth, there is no longer a
 * duplicated copy to drift. This test simply confirms the shared export behaves
 * correctly across the representative cases.
 */

import { describe, it, expect } from "vitest";
import { isPlausiblePayPalDomain } from "@workspace/validation";

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

describe("@workspace/validation isPlausiblePayPalDomain — disposable domains", () => {
  it("blocks known disposable providers", () => {
    expectBlocked([
      "user@mailinator.com",
      "x@guerrillamail.com",
      "x@grr.la",
      "x@sharklasers.com",
      "x@yopmail.com",
      "x@throwam.com",
    ]);
  });
});

describe("@workspace/validation isPlausiblePayPalDomain — short-SLD rules", () => {
  it("blocks short SLDs on untrusted TLDs", () => {
    expectBlocked(["user@aaa.co", "user@ab.cc", "user@xyz.biz", "user@a.co", "user@abc.uk"]);
  });

  it("allows short SLDs on trusted TLDs", () => {
    expectAllowed([
      "user@aol.com",
      "user@qq.com",
      "user@msn.com",
      "user@sky.com",
      "user@abc.net",
      "user@abc.io",
      "user@irs.gov",
      "user@mit.edu",
    ]);
  });
});

describe("@workspace/validation isPlausiblePayPalDomain — multi-label domains", () => {
  it("allows legitimate multi-label domains", () => {
    expectAllowed(["user@ox.ac.uk", "user@amazon.co.uk", "user@mail.google.com", "user@me.com"]);
  });
});

describe("@workspace/validation isPlausiblePayPalDomain — structural rejects", () => {
  it("blocks malformed and implausibly short domains", () => {
    expectBlocked([
      "notanemail",
      "user@",
      "user@localhost",
      "user@hostname",
      "user@a.com",
      "user@good.a.com",
      "user@domain.x",
    ]);
  });
});

describe("@workspace/validation isPlausiblePayPalDomain — trimming and case", () => {
  it("trims whitespace and lowercases input", () => {
    expectAllowed(["  user@gmail.com  ", "USER@GMAIL.COM"]);
    expectBlocked(["user@Mailinator.COM"]);
  });
});

describe("@workspace/validation isPlausiblePayPalDomain — real PayPal account domains", () => {
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
