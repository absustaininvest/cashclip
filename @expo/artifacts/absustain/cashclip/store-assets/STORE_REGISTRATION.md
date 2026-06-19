# Store Registration Checklist — `app.replit.cashclip`

Bundle/package identifier: `app.replit.cashclip`

## Apple Developer Portal + App Store Connect

- [ ] **Register App ID**: Go to [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) → Identifiers → "+" → App IDs → App
  - Description: `CashClip`
  - Bundle ID (Explicit): `app.replit.cashclip`
  - Enable capabilities as needed (e.g., Push Notifications)
  - Click Continue → Register

- [ ] **Create App in App Store Connect**: Go to [App Store Connect](https://appstoreconnect.apple.com) → My Apps → "+" → New App
  - Platform: iOS
  - Name: `CashClip`
  - Primary Language: English (U.S.)
  - Bundle ID: select `app.replit.cashclip` (registered above)
  - SKU: `cashclip`
  - User Access: Full Access

- [ ] **Create App Store Connect API Key** (for `eas submit`):
  Go to [Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
  - Click "+" → Name: `EAS Submit` → Role: Developer
  - Download the `.p8` key file → save to `credentials/asc-api-key.p8`
  - Note the **Key ID** and **Issuer ID** → update `eas.json` submit config or set as EAS Secrets

## Google Play Console

- [ ] **Create App**: Go to [Google Play Console](https://play.google.com/console) → All apps → Create app
  - App name: `CashClip`
  - Default language: English (United States)
  - App or game: App
  - Free or paid: Free
  - Accept declarations → Create app

- [ ] **Complete App Content Declarations** (required before first upload):
  - Privacy policy URL
  - App access (whether all functionality is available without credentials)
  - Ads declaration (app contains ads — uses AdMob)
  - Content rating questionnaire
  - Target audience and content
  - News app / COVID-19 app declarations
  - Data safety section

- [ ] **Set Up Google Play Service Account** (for `eas submit`):
  - Go to [Google Cloud Console](https://console.cloud.google.com) → create or select project
  - Enable the Google Play Android Developer API
  - Create a Service Account with Editor role
  - In Google Play Console → Users and permissions → invite the service account email with Release Manager permissions
  - Download the JSON key → save to `credentials/google-service-account.json`

- [ ] **Upload First AAB**: The package name `app.replit.cashclip` is permanently locked on first binary upload. Build with:
  ```bash
  eas build --profile production --platform android
  eas submit -p android --profile production
  ```

## Verification

After completing the steps above, confirm:

- [ ] Apple: `app.replit.cashclip` appears under Identifiers in the Apple Developer portal
- [ ] Apple: The app appears in App Store Connect with status "Prepare for Submission"
- [ ] Google: The app appears in Google Play Console dashboard
- [ ] Google: The service account JSON key is saved at `credentials/google-service-account.json`
- [ ] Apple: The ASC API key `.p8` is saved at `credentials/asc-api-key.p8`
- [ ] Both credential files are git-ignored (already configured in `.gitignore`)
