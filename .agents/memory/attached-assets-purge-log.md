---
name: Attached Assets Purge Log
description: Running log of attached_assets/ purges. Images deleted on request; .txt/.pdf kept.
---

# Attached Assets — Purge Record (June 3, 2026 — second purge)

4 app screenshots deleted (IMG_0176, IMG_0177, IMG_0661, IMG_0662): wallet/home balance inconsistency + withdrawal modal screenshots from two user accounts. Purge command run directly in bash (script vaulted, not written to disk).

---

# Attached Assets — Purge Record (June 3, 2026)

Owner (Jorge Ballen) requested full purge of all screenshots/images/binaries.
104 image/binary files deleted. 10 text/PDF files retained.

## What Was There (by category)

### Credential/Secrets Screenshots (SENSITIVE — now deleted)
JPEG screenshots of the Replit Secrets panel showing:
- `EXPO_TOKLAST` value visible
- `SECRETS_PASSPHRASE` value visible
- `SEED_PASSWORD_CASHCLIP` value visible (×2)
- `UNITY_ADS_GAME_ID_ANDROID` value visible
- Apple ASC Key ID (`NO_GAPE_ASC_KELIO` filename variant) visible
- Secrets checklist JPEG

**Why:** Owner shared these to set up credentials during earlier sessions.
All secrets have since been properly stored in Replit Secrets tab.
These images are no longer needed and were a privacy risk.

### CashClip App UI Screenshots
- ATT tracking permission prompt
- Balance/wallet screen ($0.00, Today's Earnings)
- Available Ads screens (×2)
- Survey partner screen, "Choose a survey" screen
- Offerwall "Earn More with Offers" screen
- Brand Awareness Study survey screen
- Various app state screenshots across multiple sessions (Jun 1–2 2026)

### App Store / Play Store / Expo Credentials
- Android developer verification (×2 — showing Play Console verification badge)
- CashClip app icon/listing screenshots (multiple)
- Expo/EAS account screenshots

### Integration / Dashboard Screenshots
- Tapjoy "Welcome to Tapjoy" onboarding screenshot
- CPX Research offerwall (offers.cpx-research.com)
- ironSource/LevelPlay dashboard screenshots (during integration setup)
- Simele verification required screen

### Admin / Config Screenshots
- Replit "Automatically join this network" WiFi prompt
- API server / admin portal screenshots
- Various build/deployment config screenshots (Jun 1–2 2026, 20+ screenshots)
- absustaininvest.com website screenshot (in screenshots/ subfolder)

### Binary
- `application-*.ipa` — iOS app binary archive (uploaded during EAS/IPA work)

## Files Retained (not deleted)
- `app-ads_*.txt` — AdMob/ads.txt partner list content
- `CashClip_AppStore_Defense_Record_*.pdf` — Apple review defense package (keep)
- `Pasted-scam-*.txt` — App Store review scam text (reference for defense)
- `Pasted-ABSustainabilityInvestments-*.txt` — Expo account info text
- `Pasted-adagio-io-*.txt` — Ad partner/RESELLER list (ads.txt content)
- `Pasted-import-React-useState-*.txt` (×2) — Code snippets pasted during dev
- `Pasted-Parallel-sponsored-visit-*.txt` — Security report: race condition finding
- `Pasted-Sponsored-visit-rewards-*.txt` — Security report: farming vulnerability
- `Pasted-User-facing-offerwall-*.txt` — Security report: metadata disclosure
