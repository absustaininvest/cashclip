import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { getClientIp } from "./clientIp";

function mockReq(opts: {
  xff?: string | string[];
  remoteAddress?: string;
} = {}): Request {
  return {
    headers: {
      ...(opts.xff !== undefined ? { "x-forwarded-for": opts.xff } : {}),
    },
    socket: { remoteAddress: opts.remoteAddress ?? "10.0.0.1" },
  } as unknown as Request;
}

describe("getClientIp", () => {
  describe("X-Forwarded-For header present", () => {
    it("returns the single entry when XFF has one IP", () => {
      expect(getClientIp(mockReq({ xff: "203.0.113.5" }))).toBe("203.0.113.5");
    });

    it("returns the rightmost entry from a comma-separated XFF chain", () => {
      expect(getClientIp(mockReq({ xff: "1.2.3.4, 5.6.7.8, 203.0.113.5" }))).toBe("203.0.113.5");
    });

    it("trims whitespace from the rightmost entry", () => {
      expect(getClientIp(mockReq({ xff: "1.2.3.4,  203.0.113.5  " }))).toBe("203.0.113.5");
    });

    it("returns the rightmost entry when XFF header is an array (duplicate headers)", () => {
      expect(getClientIp(mockReq({ xff: ["1.2.3.4", "203.0.113.5"] }))).toBe("203.0.113.5");
    });

    it("ignores attacker-supplied leftmost entries when chain has multiple hops", () => {
      const spoofed = "192.0.2.99";
      const real    = "203.0.113.5";
      expect(getClientIp(mockReq({ xff: `${spoofed}, ${real}` }))).toBe(real);
      expect(getClientIp(mockReq({ xff: `${spoofed}, ${real}` }))).not.toBe(spoofed);
    });

    it("handles a long XFF chain by always returning the rightmost entry", () => {
      expect(
        getClientIp(mockReq({ xff: "10.0.0.1, 10.0.0.2, 10.0.0.3, 203.0.113.5" }))
      ).toBe("203.0.113.5");
    });
  });

  describe("X-Forwarded-For header absent", () => {
    it("falls back to socket.remoteAddress when XFF is missing", () => {
      expect(getClientIp(mockReq({ remoteAddress: "203.0.113.99" }))).toBe("203.0.113.99");
    });

    it("returns 'unknown' when XFF is absent and socket has no remoteAddress", () => {
      const req = { headers: {}, socket: {} } as unknown as Request;
      expect(getClientIp(req)).toBe("unknown");
    });
  });

  describe("edge cases", () => {
    it("falls back to socket.remoteAddress when XFF value is empty string", () => {
      expect(getClientIp(mockReq({ xff: "", remoteAddress: "203.0.113.1" }))).toBe("203.0.113.1");
    });

    it("falls back to socket.remoteAddress when XFF value is only whitespace", () => {
      expect(getClientIp(mockReq({ xff: "   ", remoteAddress: "203.0.113.1" }))).toBe("203.0.113.1");
    });

    it("handles IPv6 addresses in XFF chain", () => {
      expect(
        getClientIp(mockReq({ xff: "2001:db8::1, ::ffff:203.0.113.5" }))
      ).toBe("::ffff:203.0.113.5");
    });
  });
});
