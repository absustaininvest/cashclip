/**
 * Shared validation helpers used by both the API server and the CashClip
 * client. Keeping a single source of truth here prevents the PayPal domain
 * lists from silently diverging between client and server.
 */
/**
 * Known disposable/throwaway email providers whose addresses are commonly
 * used to create fake PayPal accounts for fraudulent payouts.
 */
export declare const PAYPAL_DISPOSABLE_DOMAINS: Set<string>;
/**
 * TLDs where a short SLD (≤ 3 chars) is plausible for a real PayPal account.
 * Established brands like aol.com, qq.com, msn.com, sky.com all fall here.
 * Country-code or speculative TLDs like .co, .cc, .biz are excluded — a
 * 3-char label on one of those is a strong fake-address signal (e.g. aaa.co).
 */
export declare const SHORT_SLD_TRUSTED_TLDS: Set<string>;
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
export declare function isPlausiblePayPalDomain(email: string): boolean;
//# sourceMappingURL=index.d.ts.map