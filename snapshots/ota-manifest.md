# CashClip OTA Manifest — Emergency Restore Reference

Channel: `production` · Project A: `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`

---

## Live App Store Build

| Build | Version | runtimeVersion | Platform |
|-------|---------|----------------|----------|
| **29** | 1.0.0 | `1.0.0` | iOS (App Store live) |
| **38** | 1.1.0 | `1.0.0` | Android (Play Store internal) |
| **41** | 1.1.0 | `1.1.0` | iOS (pending App Store review) |

---

## OTA Checkpoint History (newest → oldest)

### ✅ CURRENT — Build 29 + Android 38 (runtimeVersion 1.0.0)

| Date | Update Group ID | Message |
|------|----------------|---------|
| Jun 12, 2026 | `875823df-0384-48fc-b65f-5d56a9124987` | Fix native iOS ad card badge (NativeAdCard.native.tsx) |
| Jun 12, 2026 | `3a354561-31d9-4581-a5c2-61fcdce9edb5` | All cleanup — no pts in games, spin, video cards, ad badges |
| Jun 12, 2026 | `f1cf0886-ab6a-41d3-9f5d-14ff00f50ae3` | Remove pts badges from all cards |

### ✅ CURRENT — Build 41 (runtimeVersion 1.1.0)

| Date | Update Group ID | Message |
|------|----------------|---------|
| Jun 12, 2026 | *(last 1.1.0 group)* | Remove hardcoded pts from home screen native ad card badges |
| Jun 12, 2026 | `aaf0fee3-*` | Earn tab video ad cards — no pts, daily goal copy |
| Jun 12, 2026 | `3b622751-*` | Spin wheel ? labels, EARN_HIGHLIGHTS cleanup |
| Jun 12, 2026 | `58f8bb5d-*` | All 9 games — Check your Wallet result screens |

### 🔒 KNOWN-GOOD BASELINE — Build 29 (Jun 3, 2026)

| Date | Update Group ID | Notes |
|------|----------------|-------|
| Jun 3, 2026 | `991eb089-dd3a-4a72-a049-949743e5b6ea` | Republished stable build-29 OTA (good consent flow) |
| Jun 1, 2026 | `26fa0d4c-44c7-49ca-9e7c-35a7cf835f86` | **GOLD SOURCE** — 36h stable, correct ATT consent, no re-ask |

> Full restore instructions: `snapshots/original-29/RESTORE.md`

---

## Emergency Rollback — Build 29 (runtimeVersion 1.0.0)

To instantly roll back build 29 users to the Jun 3 known-good state:

```bash
cd artifacts/cashclip

# 1. Temporarily set runtimeVersion to 1.0.0 in app.json

# 2. Republish the gold source group
EXPO_TOKEN="$EXPO_TOKLAST" pnpm exec eas update:republish \
  --group 26fa0d4c-44c7-49ca-9e7c-35a7cf835f86 \
  --message "EMERGENCY: Restore Jun-3 known-good" --non-interactive

# 3. Restore runtimeVersion to 1.1.0 in app.json
```

To roll back to the most recent stable (before this cleanup session):

```bash
EXPO_TOKEN="$EXPO_TOKLAST" pnpm exec eas update:republish \
  --group 991eb089-dd3a-4a72-a049-949743e5b6ea \
  --message "EMERGENCY: Restore Jun-3 republish" --non-interactive
```

---

## Emergency Rollback — Build 41 (runtimeVersion 1.1.0)

To roll back build 41 users to a specific checkpoint, republish the desired group ID
from the 1.1.0 table above (no app.json change needed — runtimeVersion is already 1.1.0).

---

## Rules

- **Never lower** `runtimeVersion` permanently — 1.0.0 → 1.1.0 is a one-way gate.
- **Never reuse** a versionCode on Android (Play rejects it).
- **OTA only covers JS/assets** — any native change (new SDK, new plugin, new permission) needs a new App Store/Play Store build.
- After any emergency republish, verify on-device: delete app → reinstall → open twice.
