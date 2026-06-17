# CashClip — Server-Side Manuscript (AUTHORITATIVE)

**Last updated:** June 17, 2026
**Owner:** Jorge Ballen ("papi")
**Status of all server-side work below:** DONE and LIVE in production.

> **Precedence rule.** This document is the source of truth for the server-side
> state of CashClip. Where older, scattered build-caution notes conflict with
> what is written here (especially the "standing delivery policy" and the
> "revenue-mirror truth"), **follow this manuscript.** Do not re-litigate
> decisions already recorded here. (This does NOT override `threat_model.md`
> security guarantees or the user preferences in `replit.md`.)

---

## 0. TL;DR — the one thing that ends the circles

1. **Every server-side change is shipped and live.** Nothing server-side is
   pending.
2. **Surveys (CPX/BitLabs) webhook security is fixed and live** — surveys can
   credit again.
3. **The admin `/sc-portal` revenue panel was relabeled** so it stops the false
   "Diverging / +100%" alarm.
4. **The app's per-impression revenue-capture code is written and OTA'd** to the
   ~428 live users.
5. **The admin's app-reported ad revenue is still $0 — and that is EXPECTED.**
   We already **SENT** the OTA that carries the capture code (group `d41ff6f9`,
   it is live on phones); it still reads $0 because the missing piece is
   **native**, not JavaScript. An OTA updates only JS, so no further OTA or
   server push can change it — only a new **native build** (build 46+) becoming
   the live build will. See §1.

If a future session is tempted to "push another server fix to make revenue show
up" — STOP. That is the circle. The remaining work is a native build, not a
server push.

---

## 1. Where the source of truth lives + the revenue-mirror truth

### 1.0 Where is the source of truth? (the question that keeps coming up)
There are **two** different "truths," and mixing them up is what causes the
circles:

- **Your app's own data — users, balances, survey credits, withdrawals.**
  Source of truth = **the server / database.** This is where it begins; the
  server decides who gets credited and how much. *This part is correct — the
  main server IS the origin for app data.*
- **Ad REVENUE — the money AdMob / Unity actually pay you.**
  Source of truth = **the ad networks' own dashboards (AdMob, Unity), NOT the
  server.** The networks run the auction, count impressions, and pay the money.
  The server only knows what the *app* reports; the app only knows what the
  *native ad SDK on the phone* hands it. For ad revenue the server is a
  downstream **mirror**, not the origin.

So "the main server is where it all begins" is true for app data, but ad money
**begins outside us, at the networks.** That is why the admin can honestly show
$0 while the Unity/AdMob dashboards show real earnings — same reality, two
ledgers, and the bridge between them is the native build.

### 1.1 Why the OTA we sent did NOT make the mirror non-zero
We **did** transmit an OTA (group `d41ff6f9`, build-46 codebase → live build-29
users, runtime `1.0.0`). It carried the JavaScript that listens for each ad's
payout and reports it. That JS is live on phones. But an OTA can update **only
JavaScript**, and the broken link is **native**: build 29's ad SDK never hands
the `PAID` payout event up to the JS layer, so our listener waits for an event
that never arrives. The OTA was the correct thing to try; it *proved* the limit.
That is exactly why **no further OTA or server push will help** — only a native
build (46+) becoming live will.

### 1.2 The revenue-mirror facts (read before touching revenue)

- **Unity and AdMob ARE earning real money.** This is visible in the official
  Unity and AdMob provider dashboards. **Never tell the owner "Unity earns $0."**
  That statement is wrong and is the root of the circular arguments.
- **What is $0 is the APP'S OWN self-reported revenue mirror** inside the admin
  Integration Hub. The app tries to read each ad's payout (`AdEventType.PAID`)
  and report it to our server, so the admin can show a live in-app number next
  to the official dashboard number.
- **Why the mirror is $0:** the live build on phones is **build 29**. Its native
  ad SDK does not deliver `PAID` events up to the JavaScript layer, so the OTA'd
  capture code never receives a value to report.
  - **Verified in PRODUCTION (read-only query, Jun 17 2026):** of **16,554**
    lifetime `ad_events`, **ZERO** carry `revenue_micros` — across every event
    type and both iOS and Android, including all completion events.
  - The JS listener code itself is correct and wired right (confirmed by code
    review). This is a native-delivery limitation, **not a code defect.**
- **The only fix:** a fresh EAS **native build** (build 46+, which carries the
  listener natively) must become the live build. This is a build + App Store
  step — **NOT a server push and NOT an OTA.**
- The admin panel now shows a neutral **"Official only"** badge for this state
  (official money present; app-mirror not active yet) instead of a false
  "Diverging" alarm.

---

## 2. Standing delivery policy

- **Server-side changes go to PRODUCTION FIRST, then the OTA — in that order.**
- **One deployment serves all domains.** Publishing once updates
  `cash-clip.app`, `api.cash-clip.app`, and `absustaininvest.com` together.
  You do NOT publish them separately.
- **Standing OTA target:** runtime `1.0.0` / channel `production`
  (build-46 codebase → live build-29 users) until a new native build replaces
  build 29.
- **Do not block or delay the normal server→OTA flow** by citing old
  build-failure caution notes. JS-only changes OTA normally.
- **Native-only changes still require a fresh EAS build** (irreducible). Native
  examples: anything in `app.json` / `app.config.js` / `eas.json`, native SDKs,
  mediation adapters, and the on-phone PAID-event delivery in §1.

---

## 3. What shipped, in order (all LIVE in production)

### 3.1 CPX / BitLabs survey webhook security + crediting — API
- Webhook **secret validation + replay protection** and **survey-completion
  signature verification** are live on `api.cash-clip.app`.
- Production secrets confirmed present in Publishing → Production:
  `CPX_API_KEY` / `CPX_APP_ID` / `CPX_WEBHOOK_SECRET`,
  `BITLABS_API_KEY` / `BITLABS_WEBHOOK_SECRET`, plus the PayPal and JWT/admin
  secrets the API needs.
- **Effect:** survey postbacks that were being rejected can now be verified and
  credit users.
- **How to confirm it truly worked (money path — verify, don't assume):** watch
  pending CPX/BitLabs survey sessions convert to **paid** in production. Until a
  real pending session converts, treat crediting as "deployed, awaiting live
  confirmation," not "proven."

### 3.2 Admin `/sc-portal` revenue panel relabel — website
- When official revenue > $0 but the app-reported mirror is $0, the panel now
  shows a neutral **"Official only"** badge with honest copy ("ships with next
  app build"), instead of a false **"Diverging / +100%"** alarm.
- The old LevelPlay widget was removed.

### 3.3 AdMob per-impression revenue capture — app (OTA)
- `lib/admob.ts`: captures the AdMob `PAID` event → micros for **rewarded** and
  **interstitial** ads and reports it on ad completion. Android banner ad unit
  ID added.
- `lib/ad-analytics.ts`: `trackAdCompletion` forwards `revenueMicros`.
- Server `/api/ad-events` (+ `/batch`) persists the sanitized `revenue_micros`;
  the recon panel sums it.
- **OTA group `d41ff6f9-bfe7-4e67-9492-dc9473746da1`** (iOS + Android,
  runtime `1.0.0`, channel `production`). Rollback target: previous group
  `3ea695f3-4078-49ee-a447-7c530d59adb4`. Applies on the user's **second** cold
  launch.
- **No reward/payout logic was changed.** Banner revenue is NOT yet captured.

### 3.4 Production verification of the revenue mirror — read-only prod
- See §1: confirmed $0 app-reported revenue because build 29 doesn't emit PAID
  events. This closed the question: the JS-only OTA cannot finish the job; a
  native build can.

---

## 4. What is NOT done (and is NOT a server task)

- **New native iOS build (build 46+) becoming the LIVE build.** This is what
  makes the in-app revenue mirror real AND ensures mediation adapters
  (Unity/ironSource/Pangle/Chartboost) are compiled into the binary on phones.
- **Blocker:** a fresh **Admin-role Apple App Store Connect (ASC) key** is
  needed. The old key `DGVBV8VV95` is invalid/exposed and every submission fails
  on it. (Tracked by Tasks #706 / #711.)
- **Banner ad revenue capture** (Task #710).
- **Stop the "Official only" badge from masking a future real drop to $0** once
  the native build is live (Tasks #708 / #709) — at that point a $0 mirror would
  be a real regression, so it should alert, not stay neutral.

---

## 5. Environment / deployment facts

- **One Replit deployment** serves all three domains; one Publish ships them all.
- Publishing the **app on phones** is a SEPARATE EAS build + App Store path — the
  Publish button does NOT touch the phone app.
- **How the owner publishes server-side himself:** open the project on
  replit.com (desktop), top-right **Publish**, then **Republish**, wait for
  **"Published"** (~1–3 min).
- **Benign noise to ignore:** graceful-shutdown exits, SSL/cold-start log lines,
  and intentional `REGISTRATION_PAUSED` 503s on `/api/auth/register` are NOT
  crashes. Failed dev workflows for `absustain: web` / `api-server` / `EAS-46`
  are duplicate/port-conflict noise — the live workflows are `Start Backend`,
  `Start application`, and `cashclip: expo`.
- **Known dev-DB prompt:** post-merge schema push pauses on a
  `users_paypal_email_unique` constraint prompt; the correct answer is **"No,
  add the constraint without truncating the table."** (Dev DB only.)

---

## 6. Verification checklist (for the next session)

- [ ] Live health: `curl https://api.cash-clip.app/api/app/version` returns JSON
      (`maintenance:false`); `absustaininvest.com` and `cash-clip.app` return
      200.
- [ ] Surveys: a pending CPX/BitLabs session converts to **paid** in prod.
- [ ] Revenue mirror: only expect non-zero `revenue_micros` AFTER a native
      build (46+) is the live build — not before.
- [ ] Always label every data point **dev** vs **production**.
