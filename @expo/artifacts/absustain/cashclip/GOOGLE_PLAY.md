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

- The keystore EAS generates is stored in EAS cloud under your `expodeveloper20` account.
  Download a backup via: `eas credentials --platform android`
- Do NOT change the `package` name after first submission — Google locks it permanently
- `versionCode` must increment with every new upload (1 → 2 → 3, etc.)
