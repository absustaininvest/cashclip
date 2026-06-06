---
name: Home balance pill vs server balance
description: Why users report "Home shows more money than Wallet" — Home pill is a local optimistic balance, Wallet is the real server balance
---

- On LIVE build 29 (JS base `9c71ec40`), the Home header green "$" pill reads the LOCAL optimistic balance: `getUserStats().balance` = `cashclip_balance` in AsyncStorage, credited client-side by `recordAdWatch → addEarnings` ($0.05/ad), check-in, spin, missions (`artifacts/cashclip/lib/storage.ts`). The Wallet "Total Balance / Verified withdrawable" reads the REAL server balance via `fetchServerBalance()`. They diverge → user reports like "Home shows $1.82 but Wallet only $0.10; my ad-watch proof isn't counted."
- The Transaction History list of "Ad watch reward +$0.05" entries is also that LOCAL log (`storage.ts` addTransaction/getTransactions), not real server credits.
- The real, withdrawable money is ALWAYS the server (Wallet) number. The local pill/log is a leftover mock counter that inflates perceived earnings — misleading on a money app (and bad given the Apple fraud-defense history).
- HEAD already fixes the headline: Home shows a balance CARD fed by `fetchServerBalance()` (no local pill). Fix to ship = isolated JS-only OTA from the live base that points the Home balance at the server (same source as Wallet) so both always agree.

**Why:** client-side ad crediting can never match the server — the server credits ads ONLY via AdMob SSV or the begin/complete challenge path; the client must never mint balance (see `cashclip-ad-payout-paths.md`).

**How to apply:** for any "displayed balance is wrong / too high" report, first check whether the surface reads `getUserStats().balance` (local, fake) vs `fetchServerBalance().balance` (real). Make every money surface read the server. Ship as a small isolated OTA from the live base, never from HEAD (HEAD carries the on-hold economy rebalance + native voice).
