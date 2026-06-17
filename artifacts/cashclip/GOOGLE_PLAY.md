# CashClip — Google Play Distribution Guide

## What's Already Done (Code Side)

- ✅ Android package: `app.replit.cashclip`
- ✅ Version code: `1` (equivalent to iOS build number)
- ✅ AdMob Android App ID configured
- ✅ Adaptive icon assets (foreground, background, monochrome)
- ✅ EAS production build set to `app-bundle` (AAB format — required by Play Store)
- ✅ EAS submit configured for `production` track with `releaseStatus: draft`

---

## Step 1 — Google Play Developer Account ($25 one-time fee)

1. Go to: https://play.google.com/console
2. Sign in with your Google account
3. Pay the $25 registration fee (credit card)
4. Accept the Developer Distribution Agreement
5. Fill in your developer profile:
   - Developer name: **AB Sustainability Investments LLC**
   - Email: your business email
   - Website: **https://absustaininvest.com** (or cash-clip.app)

---

## Step 2 — Create the App Listing on Play Console

1. In Play Console, click **"Create app"**
2. Fill in:
   - App name: **CashClip**
   - Default language: **English (United States)**
   - App type: **App** (not Game)
   - Free or paid: **Free**
3. Accept the declarations and click **Create app**
4. The package name (`app.replit.cashclip`) will be locked in on first upload

---

## Step 3 — Set Up Google Service Account (for EAS auto-submit)

This allows `eas submit` to upload directly to Play Console without manual uploads.

1. In Play Console → **Setup → API access**
2. Click **"Link to a Google Cloud project"** (create new or use existing)
3. In Google Cloud Console → **IAM & Admin → Service Accounts**
4. Click **"Create Service Account"**
   - Name: `eas-submit`
   - Role: **Service Account User**
5. Click on the created account → **Keys → Add Key → JSON**
6. Download the JSON file
7. Save it as: `artifacts/cashclip/credentials/google-service-account.json`
   (this folder is gitignored — it stays local/private)
8. Back in Play Console → **Setup → API access** → Grant this service account access
   - Role: **Release Manager** (minimum required)

---

## Step 4 — Build the Android AAB

Run this from the Replit Shell:

```bash
cd artifacts/cashclip && eas build --platform android --profile production
```

EAS will:
- Auto-generate and manage the Android keystore (stored in EAS cloud — safe)
- Build the `.aab` file on EAS servers
- Takes ~10-15 minutes

---

## Step 5 — Submit to Google Play

Once the build completes:

```bash
cd artifacts/cashclip && eas submit --platform android --profile production
```

This uploads the AAB to Play Console in **draft** mode. You still need to:
1. Complete the store listing (screenshots, description, content rating)
2. Set up pricing & distribution (countries)
3. Complete the data safety section
4. Click **"Send for review"**

---

## Step 6 — Store Listing Content Needed

### Short description (80 chars max)
> Earn real cash from surveys, ads, and games. Withdraw via PayPal.

### Full description (4000 chars max)
> CashClip turns your free time into real money. Complete surveys, watch rewarded ads, play games, and complete special offers — then withdraw your earnings directly to PayPal.
>
> **How it works:**
> - Earn cash by completing surveys from top providers
> - Watch short video ads and earn rewards
> - Play games and complete challenges for bonus cash
> - Refer friends and earn from their activity too
> - Withdraw to PayPal — no minimum hold period
>
> CashClip is built and operated by AB Sustainability Investments LLC — a verified US company with a D-U-N-S number and EIN.

### Content Rating
- Answer the questionnaire in Play Console
- Category: **Finance** or **Tools**
- No violence, no adult content, no user-generated content

### Data Safety Section (required by Google)
| Data type | Collected | Shared | Purpose |
|-----------|-----------|--------|---------|
| Email address | Yes | No | Account functionality |
| User ID | Yes | No | Analytics, app functionality |
| Device ID | Yes | Yes (AdMob) | Advertising |
| App interactions | Yes | No | Analytics |
| Financial info | Yes | No | App functionality (balance/withdrawals) |

---

## Android vs iOS Differences

| Item | iOS | Android |
|------|-----|---------|
| Build number | `buildNumber: "20"` | `versionCode: 1` |
| Bundle/Package | `app.replit.cashclip` | `app.replit.cashclip` |
| Review time | ~1-7 days | ~3-7 days (first submission) |
| Fee | $99/year | $25 one-time |
| Format | IPA | AAB (App Bundle) |
| Signing | Managed by EAS | Managed by EAS |

---

## Timeline

- Google Play Developer account: ~24 hours to activate after payment
- First app review: 3–7 business days
- Subsequent updates: typically 1–3 days

---

## Notes

- The Android keystore lives in EAS cloud under the org account
  `absustainabilityinvestments-owner` (project `@absustainabilityinvestments-owner/cashclip`,
  projectId `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`). Inspect/download a backup via:
  `eas credentials --platform android`.
- **Upload key (critical):** Google Play has a permanent UPLOAD key on file with
  certificate `SHA1: 27:E0:13:62:ED:D6:23:1D:1E:08:09:C3:65:70:DB:89:9B:78:22:6E`.
  Every production `.aab` MUST be signed with that keystore or Play rejects it with
  "App Bundle signed with the wrong key." As of Jun 2026 the only keystore stored in
  EAS is a different one (`SHA1: 85:FD:79:B7:39:C4:14:57:22:60:03:98:B0:30:B8:8F:62:89:81:8C`),
  auto-generated after the Expo personal→org transfer. The original `27:E0…` keystore
  must be imported into EAS and set as the active/default Android keystore before any
  production build. NEVER let a command auto-generate a replacement keystore — losing
  the `27:E0…` key would force a Google upload-key reset.
- Do NOT change the `package` name after first submission — Google locks it permanently
- `versionCode` must increment with every new upload (currently `45`)
