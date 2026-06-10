# CashClip Release Reference (Build 29 + Build 39)

_Snapshot of the project as of June 10, 2026. This document is the one-page
reference for (a) the iOS build that is **currently live** in the App Store and
(b) everything needed to cut the **next** native build. It only records what is
already in the repo and project notes — it does not change any version numbers._

---

## 1. Live build 29 (v1.0.0) — what users actually have today

- **Status:** This is the **approved, in-distribution iOS build** on the App
  Store. Marketing version **v1.0**, **build 29**.
- **Important:** The `app.json` in the repo shows **1.1.0 / build 39** — that is
  the *next* build being prepped, **not** what is live. (A v1.1.0 / build 38 was
  submitted earlier and **rejected** by Apple because the app froze on the splash
  screen for an iPad reviewer; those numbers never shipped.)
- To confirm the live version with no login:
  `https://itunes.apple.com/lookup?bundleId=app.replit.cashclip&country=us` — the
  `version` field is what is live.

### The OTA (over-the-air) layer on build 29

Build 29 still receives JS/content updates over the air. **Build 29's OTAs live in
a SEPARATE Expo project from the normal one:**

| | Value |
|---|---|
| Expo project ("V29" / "Project B") | `10994af8-62e3-4a9d-9e35-7f4381965a31` |
| Expo account | `absustainabilityinvestmentsllc` |
| Channel | `production` |
| Branch | `production` |
| **runtimeVersion** | **`1.0.0`** (must match — this is the build-29 native runtime) |
| Platforms | ios + android |

**Known-good restore point (saved June 3, 2026):**

- Good source update group: **`26fa0d4c-44c7-49ca-9e7c-35a7cf835f86`**
  (June 1, 2026, commit **`9c71ec40`**) — ran stable 36h with correct
  tracking-consent handling.
- Republished live as: **`991eb089-dd3a-4a72-a049-949743e5b6ea`** (June 3, 2026).
- **Restore instructions:** `snapshots/original-29/RESTORE.md` (with the matching
  known-good `app.json` in `snapshots/original-29/app.json`). Follow that file to
  snap build 29 back to the known-good state. Update groups are permanent in Expo,
  so `26fa0d4c…` can always be republished.

> Note: Cumulative OTAs have shipped onto build 29 since that restore point
> (points-on-cards display, honest-money no-mint fix, etc.). Each OTA replaces the
> **whole** JS bundle, so always ship the **full current tree** — never a
> from-base rebuild — using the procedure in `snapshots/build29-delivery/README.md`.
> The detailed OTA history and gotchas live in
> `.agents/memory/cashclip-ota-delivery.md`.

---

## 2. Next build 39 (v1.1.0) — how to cut the next native build

### Current `app.json` values (`artifacts/cashclip/app.json`)

| Field | Value |
|---|---|
| `version` | **1.1.0** |
| `ios.buildNumber` | **39** |
| `android.versionCode` | **39** |
| `runtimeVersion` | **1.1.0** |
| `owner` | `absustainabilityinvestments-owner` |
| `extra.eas.projectId` | `aac2a3d9-56b6-49ab-b254-9b80e98bab2f` ("Project A") |
| `updates.url` | `https://u.expo.dev/aac2a3d9-56b6-49ab-b254-9b80e98bab2f` |
| `bundleIdentifier` / `android.package` | `app.replit.cashclip` |

Build 39 (unlike build 29) ships the mediation adapters (Unity, ironSource,
Pangle) and the telemetry SDKs (Sentry, Vexo, LogRocket, Firebase) — these are
**native** and only take effect in a fresh build, never over OTA.

### Build configuration

- **EAS config:** `artifacts/cashclip/eas.json`
  - `production` profile → `distribution: store`, `channel: production`,
    `autoIncrement: false`, `appVersionSource: local` (version numbers come from
    `app.json`, not auto-bumped).
  - iOS submit: Apple ID `andyballen0814@icloud.com`, `ascAppId 6759931285`,
    `appleTeamId FAX932PG78`.
  - Android submit: Play track `production`, `releaseStatus: draft`,
    service account at `./credentials/google-service-account.json`.
- **Build helper scripts:** `artifacts/cashclip/scripts/`
  (`build.js` = web/OTA static build; `extract-spki-hash.sh`,
  `generate-android-keystore.sh` = signing helpers). EAS itself is invoked via
  the EAS CLI (`pnpm exec eas build`).

### Step-by-step (native build)

1. Confirm `artifacts/cashclip/app.json` is pointed at **Project A**
   (`aac2a3d9…` / owner `absustainabilityinvestments-owner`) with
   `runtimeVersion 1.1.0`, `buildNumber 39`, `versionCode 39` — this is the
   normal/default state in the repo.
2. iOS build:
   `cd artifacts/cashclip && EXPO_TOKEN="$EXPO_TOKLAST" pnpm exec eas build --platform ios --profile production --non-interactive`
3. Android build:
   `cd artifacts/cashclip && EXPO_TOKEN="$EXPO_TOKLAST" pnpm exec eas build --platform android --profile production --non-interactive`
4. Submit when builds finish (`pnpm exec eas submit --platform ios/android --profile production`).

> EAS CLI bundling exceeds the 120s shell limit — run long builds as a managed
> workflow and poll, not as a plain backgrounded shell command (they get reaped).

### Required secrets / tokens

These are EAS env vars / Replit secrets (see `replit.md` for the full table):

- `EXPO_TOKLAST` — Expo/EAS auth token (passed as `EXPO_TOKEN`). Regenerate at
  expo.dev if auth fails (login email `support@absustainabilityinvestments.com`).
- `SENTRY_TOKEN` (build-time source-map upload) + `EXPO_PUBLIC_SENTRY_DSN`.
- `EXPO_PUBLIC_VEXO_API_KEY` (Vexo analytics).
- `APP_VISIT_PROOF_KEY` (sponsored-visit attestation — EAS secret, NOT EXPO_PUBLIC).
- Apple/ASC signing credentials are managed remotely by EAS
  (`credentialsSource: remote`); Android keystore likewise.

---

## 3. Caveats (read before shipping anything)

- **OTA = JS/content only.** Over-the-air updates can never carry native changes
  (new SDK/module, new permission, plugin or `expo-build-properties` changes,
  `newArchEnabled`). Those require a brand-new App Store / Play build.
- **Never lower or reuse Android `versionCode`.** Google Play permanently rejects
  a reused or lowered code. The next native bump must be `versionCode ≥ 39`.
- **Force-update version-gate landmine.** The app sends a hardcoded
  `X-App-Version` of `1.1.0` baked into the bundle. **Do not raise
  `MIN_APP_VERSION` above `1.1.0` while iOS build 29 is live** — the gate can't
  tell builds apart and would brick every live user. Leave it untouched.
- **An OTA replaces the entire bundle** for its runtime — it is not a patch.
  Always publish the full current tree (see the build29-delivery method), never a
  cherry-picked from-base rebuild, or you silently revert every prior OTA.

---

## 4. Pointers

- `replit.md` — project overview, full secret table, version lineage footnotes.
- `snapshots/original-29/` — known-good build-29 restore point (`RESTORE.md` + `app.json`).
- `snapshots/build29-delivery/` — persistent method for shipping current JS to build 29.
- `.agents/memory/cashclip-ota-delivery.md` — OTA delivery deep-dive + gotchas.
- `.agents/memory/appstore-live-version.md` — how to find the real live version.
- `artifacts/cashclip/app.json`, `artifacts/cashclip/eas.json` — build config.
