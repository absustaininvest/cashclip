# V29 — Fixes Currently Shipped to the Live Version

**Live App Store build:** 29 (v1.0.0) — the version in distribution.
**How these reached it:** over-the-air (OTA) JS/content updates, branch `production`, runtimeVersion `1.0.0`.
**Purpose of this file:** a locked record of everything we shipped onto V29, so build **39 carries every one of them** and nothing regresses.

> Honesty note: V29's live OTA is pulled from **Project B** (`10994af8…`, owner `absustainabilityinvestmentsllc`), while our everyday code points at **Project A** (`aac2a3d9…`). The latest items may not have reached every live device through that split — which is exactly why **building 39 carries all of this natively, with no OTA dance.**

---

## A. Fixes that ride OTA (JS/content — these are on V29 now)

### Money / earnings honesty (most recent)
- **One real balance only** — Home shows the real server balance; removed the fake "+$" celebratory pop.
- **Points, not dollars** — ad cards and video cards now show **points** (no dollar amounts on rewards).
- **Display rate from server** — points-to-dollars rate (10,000 pts = $1 display) served by the server so display and real cash can't drift.
- **Secure video credit** — real-ad watches pay through a secure begin/complete flow; prevents lost earnings.
- **Closed exploitable earn paths** — disabled the abusable game/ad reward begin/complete shortcuts.
- **Server-authoritative rewards** — scratch-cards and mini-games pay the real server balance; daily/weekly missions are server-verified.

### Wallet
- Balance **refreshes on tab focus**.
- **Live 3-hour hold countdown** display.
- Improved wallet **timer / readiness** logic.

### Chipley mascot + celebrations
- Chipley coin mascot across the app (Home greeting wave).
- Celebration overlay fires **only on genuine, server-confirmed wins** (real ad path, all users).
- **Bigger running Chipley** (harder to miss).
- **Sad Chipley** on error / failed-action states.
- (Audio was tried then **removed** — celebrations are silent.)

### Navigation / UX
- **Home taps:** balance chip → Wallet, "Today's Earn" strip → Earn.
- **Spin fix:** celebrate only on confirmed wins; auto-retry the spin on a momentary 503 instead of erroring.
- **Memory Match** game scrolls to the bottom.
- Games hub **banner** + adjusted interstitial ad frequency.
- **Check-in streaks:** rewards for longer streaks, 7-day milestone celebration, friendly warning before a streak breaks, button locks after check-in.

### Referrals
- Referrals are a **shareable link** (`cash-clip.app/r/<username>`).

---

## B. NOT on V29 — native changes that only land with build 39

These can't ride OTA; they need the new native build:
- **Splash-freeze fix** (the bug that froze the 1.1.0/38 generation) — splash now hides on fonts-ready, consent screen shows after.
- **Ad revenue adapters:** Unity + ironSource + Pangle (wired into the 39 config) — turns on real ad money.
- **Crash/analytics:** Sentry crash reporting, Vexo analytics, LogRocket session replay.
- **Runtime bump** to `1.1.0`.

---

## C. Backend / Admin tools — live on the production API + `/sc-portal`

These run on the **server**, so they're already live no matter which build (29 or 39) is on phones.

### 📬 The "Mail Lady" — unified support Inbox
- Pulls every email to **support@absustaininvest.com** into the admin portal (`/sc-portal`) via Zoho IMAP.
- **Auto-sorts** each message into buckets: corporate / app / support / other.
- **Reply right from the portal** — no more bouncing between Zoho tabs.
- **Double-send protection** (won't fire the same reply twice) + a **durable, browsable history** of every reply sent.
- **Honest status:** today she *centralizes and organizes* everything in one place — **you still type the reply.** The part that **fully releases you** (auto-drafted / auto-sent replies) is the **vision upgrade** we build on top of her. The plumbing — read, sort, reply, log — is already done and live.

---

*Compiled from git history of `artifacts/cashclip/`, the Expo `production` update groups, and the live api-server code, June 9 2026.*
