CashClip Server-Side Manuscript — June 17 2026

Read before any server-side, OTA, or revenue planning.

This document is the authoritative record of every server-side, website, and app change that was shipped on or before June 17 2026. It survives rollbacks. When restoring work after a rollback, cross-check every item here first.

§1 — Context

CashClip is a live product handling real money. The production API is at https://api.cash-clip.app. The admin portal is at https://absustaininvest.com/sc-portal. The live App Store build is build 29 (runtime 1.0.0, channel production). OTA updates target runtime 1.0.0 / channel production. The standing delivery order is: server → production publish first, then OTA.

§2 — Revenue Architecture

Ad mediation (as of Jun 16 2026)

Google AdMob is the rewarded-video mediation ORCHESTRATOR (react-native-google-mobile-ads). Unity, ironSource, Pangle, and Chartboost are DEMAND SOURCES — each wired as an AdMob mediation adapter (Android Gradle dep + iOS pod). LevelPlay (ironSource RN SDK) was removed Jun 16 2026. Rewarded-ad rewards credit server-side only via AdMob SSV (GET /api/admob/ssv, Google ECDSA verified) plus the begin/complete fallback.

Per-impression revenue capture

The app captures AdEventType.PAID → revenueMicros for rewarded and interstitial ads and forwards it on ad completion. The server stores this in ad_events.revenue_micros. The admin revenue panel sums it for reconciliation against official AdMob earnings.

Revenue panel reconciliation logic

When official AdMob revenue > $0 but app-reported mirror is $0 AND mirrorExpectedActive is false (PAID-capable build not yet live): show "Official only" badge with hint "ships with next app build." This is NOT a real discrepancy.
When mirrorExpectedActive is true and app-reported is still $0: show "Diverging" — genuine regression, must be investigated.
When both figures are within 5%: show "In sync".

§3 — Changes Shipped (DONE)

§3.1 — CPX / BitLabs survey webhook security

Status: DONE

Both CPX and BitLabs webhook handlers use verifyWebhook() and logWebhookVerificationFailure() from ./lib/webhookAuth. Unsigned or tampered postbacks return 403. Replay protection is active. The CPX handler does not trust amount_local from the webhook request (attacker-controlled, unsigned) — it uses the server-committed expectedReward from the reward session.

GET /api/surveys/webhook/cpx — verifies HMAC signature via verifyWebhook("cpx", req), 403 on bad/missing sig
GET /api/surveys/webhook/bitlabs — verifies HMAC signature via verifyWebhook("bitlabs", req), 403 on bad/missing sig
GET /api/surveys/webhook/bitlabs/no-sig — 200 immediately, no reward crediting (BitLabs dashboard reachability probe)

§3.2 — Admin revenue panel relabel

Status: DONE

File: artifacts/absustain/src/pages/Admin.tsx

The reconciliation badge now shows "Official only" (neutral grey) when official revenue > $0 but app-reported is $0 and mirrorExpectedActive is false. Previously it showed a misleading "Diverging / +100%" alarm for this expected pre-cutover state.
The "ships with next app build" hint is shown on the App revenue mirror stat when the mirror is not yet active.
The old LevelPlay / ironSource-Unity rotating banner widget (Ad Adapter Status card) is removed from the IntegrationHubPanel. The mediation stack switched to AdMob; the LevelPlay-specific lpNative / unityNative env-var widget no longer reflects reality.

§3.3 — AdMob per-impression revenue capture

Status: DONE

App side

artifacts/cashclip/lib/admob.ts:

Listens for AdEventType.PAID on both showPreloadedAd and loadAndShowOnDemand flows
paidEventToMicros(event) converts the impression revenue (account currency main unit, e.g. 0.0042 = $0.0042) to micros (×1,000,000), returns undefined for missing/invalid values
revenueMicros is passed to trackAdCompletion("rewarded", durationMs, paidMicros) on AdEventType.CLOSED
Android banner ad unit ID: ca-app-pub-8679658921848348/5368280275

artifacts/cashclip/lib/ad-analytics.ts:

AdEventPayload interface includes revenueMicros?: number
trackAdCompletion(adUnitType, durationMs?, revenueMicros?) forwards revenueMicros into the queue
Queued events flush to /api/ad-events/batch every 30 seconds

API side

artifacts/api-server/src/routes/cashclip.ts:

POST /api/ad-events — accepts revenueMicros in body, sanitizes via sanitizeRevenueMicros(), persists to ad_events.revenue_micros
POST /api/ad-events/batch — same sanitization applied per event
GET /api/admin/admob/revenue — sums ad_events.revenue_micros for the reconciliation panel

§4 — Deferred / Next Tasks

Banner ad revenue capture — AdEventType.PAID on banner ads is out of scope for §3.3; separate task.
ASC key / native build — the next EAS build (build 47, buildNumber 47 / versionCode 44) ships the AdMob mediation adapter changes natively. Separate tasks #706/#711.
Android Play Store — promote existing build to Production when ready.

§5 — Key Invariants (never change without review)

Rewarded-ad rewards credit ONLY via AdMob SSV (GET /api/admob/ssv) or the server-issued begin/complete spin-style fallback. Client never credits points for ads.
Survey webhook postbacks must be HMAC-verified before any reward is credited. Never remove verifyWebhook() calls.
amount_local in CPX webhooks is attacker-controlled — always use session.expectedReward as the source of truth.
sanitizeRevenueMicros() must always gate any revenue value from the client before it touches the DB.
mirrorExpectedActive on the revenue API controls whether a $0 app-reported figure is a real alarm or an expected pre-cutover state. Never hard-code this.
