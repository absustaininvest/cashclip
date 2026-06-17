---
name: Android Chartboost SDK not on Maven Central
description: Why a Chartboost iOS fix does NOT carry to Android, and how the Android Gradle resolve fails.
---

# Android Chartboost mediation — Maven resolution trap

**Symptom:** Android EAS build fails in the `Run gradlew` phase with
`Could not resolve all dependencies for configuration ':app:releaseRuntimeClasspath'` →
`Could not find com.chartboost:chartboost-sdk:9.<x>`.

**Root cause:** The Google mediation adapter `com.google.ads.mediation:chartboost:9.8.3.0`
(on Google Maven) **transitively depends on `com.chartboost:chartboost-sdk:9.8.3`**, but
Maven Central only publishes `com.chartboost:chartboost-sdk` up to **9.2.1**. The 9.x
Chartboost SDK lives only on Chartboost's private JFrog Maven repo
(`https://cboost.jfrog.io/artifactory/chartboost-ads/`), which is NOT on the default Expo
Android build. So the adapter version resolves but its underlying SDK does not.

**Why:** iOS and Android Chartboost distribution are different channels. iOS Chartboost
(`GoogleMobileAdsMediationChartboost` pod + Chartboost SDK) IS on the CocoaPods trunk CDN
(so the old JFrog *pod* source was correctly removed for iOS). Android is the opposite:
the matching SDK version is NOT on the public Android repos. A Chartboost **iOS** fix does
not carry over to Android.

**How to apply:** If Android must include Chartboost, add the Chartboost JFrog Maven repo
to the Android build (a plugin that injects the maven repo URL into the project repos),
AND pin an adapter whose transitive SDK is actually available. Otherwise, keep Chartboost
**iOS-only**: register `GoogleMobileAdsMediationChartboost` in iOS extraPods but do NOT
register `withAndroidChartboostAdapter` in the plugins list. Owner (Jun 2026) chose
iOS-only — Chartboost was never genuinely wired for Android. The other AdMob adapters
(Unity / ironSource / Pangle) resolve fine from the default Android repos; only Chartboost
hits this.
