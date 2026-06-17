---
name: iOS Install-pods failure from dead vendor CocoaPods source
description: EAS iOS build aborting at Install pods because a custom ad-SDK spec-repo source URL is unreachable; fix is trunk CDN.
---

# iOS "Install pods" abort from a dead vendor CocoaPods source

**Rule:** Do NOT add a custom CocoaPods `source` line / pod-source config plugin for an ad SDK that already publishes to the CocoaPods **trunk CDN**. A single unreachable `source` URL aborts the **entire** `pod install` (with `[!] Unable to add a source with url ... named ...`) *before any pod resolves* — so every other adapter looks innocent even though they're fine.

**What bit us:** EAS iOS build 47 (first build carrying the AdMob mediation adapter pods) failed twice at Install pods. Root cause was the `withChartboostPodSource` Expo config plugin injecting Chartboost's retired JFrog spec repo `https://cboost.jfrog.io/artifactory/chartboost-cocoapods/` into the Podfile. That URL now 404s. CocoaPods tried to clone it first and died — Unity/ironSource/Pangle never even got evaluated. The Chartboost **adapter pod** (`GoogleMobileAdsMediationChartboost`) in `extraPods` was never the problem.

**Why the fix is safe:** `ChartboostSDK` and `GoogleMobileAdsMediationChartboost` are both on the standard trunk CDN now (verified via `trunk.cocoapods.org/api/v1/pods/<Pod>` → 200; ChartboostSDK up to 9.9.x). The trunk CDN is the same place the other three adapters come from, so removing the custom source loses nothing — Chartboost still ships and still mediates.

**How to apply / diagnose:**
- Symptom: EAS iOS build errors with the generic "See logs of the Install pods build phase"; the real line is `[!] Unable to add a source with url ...`.
- Check for custom `source 'https://...'` lines or `with*PodSource` config plugins pointing at vendor spec repos. Verify each pod is on trunk via `curl -s -o /dev/null -w '%{http_code}' https://trunk.cocoapods.org/api/v1/pods/<PodName>` and curl the vendor source URL (404 = dead). Prefer trunk CDN; delete the dead source.

## Fetching EAS build logs programmatically (non-obvious)
`eas build:view <id> --json` returns `logFiles[]` (short-lived signed GCS URLs, ~15 min). The log body is gzip'd JSONL. **Fetch with `curl --compressed <url>`** to get plain JSONL — a plain `curl` yields raw gzip, and `python gzip.decompress` only decodes the *first* member so you get garbage/partial. Each line is `{"phase","msg",...}`; filter `phase` for `INSTALL_PODS` etc.
