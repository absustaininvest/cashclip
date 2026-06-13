# CashClip OTA Manifest — Emergency Restore Reference

Channel: `production` · Project A: `aac2a3d9-56b6-49ab-b254-9b80e98bab2f`
**Single project** — covers ALL builds including build 29 (Project B gone Jun 13 2026)

---

## Live App Store Build

| Build | Version | runtimeVersion | Platform |
|-------|---------|----------------|----------|
| **29** | 1.0.0 | `1.0.0` | iOS (App Store live) |
| **38** | 1.1.0 | `1.0.0` | Android (Play Store internal) |

---

## OTA Checkpoint History (newest → oldest)

### ✅ CURRENT — All builds, runtimeVersion 1.0.0

| Date | Update Group ID | Message |
|------|----------------|---------|
| Jun 13, 2026 | `306729c9-b506-4a26-8e17-c86a0997b340` | **CURRENT** — Full reconcile, all users |
| Jun 13, 2026 | `17aaf3a7` | OTA update (consent gate fix + auto-apply on launch) |
| Jun 12, 2026 | `875823df-0384-48fc-b65f-5d56a9124987` | Fix native iOS ad card badge (NativeAdCard.native.tsx) |
| Jun 12, 2026 | `3a354561-31d9-4581-a5c2-61fcdce9edb5` | All cleanup — no pts in games, spin, video cards, ad badges |
| Jun 12, 2026 | `f1cf0886-ab6a-41d3-9f5d-14ff00f50ae3` | Remove pts badges from all cards |

### 🔒 KNOWN-GOOD BASELINE — Build 29 (Jun 3, 2026)

| Date | Update Group ID | Notes |
|------|----------------|-------|
| Jun 3, 2026 | `991eb089-dd3a-4a72-a049-949743e5b6ea` | Republished stable build-29 OTA (good consent flow) |
| Jun 1, 2026 | `26fa0d4c-44c7-49ca-9e7c-35a7cf835f86` | **GOLD SOURCE** — 36h stable, correct ATT consent, no re-ask |

> Full restore instructions: `snapshots/original-29/RESTORE.md`

---

## Emergency Rollback — All builds (runtimeVersion 1.0.0)

`app.json` runtimeVersion is permanently `1.0.0` — **no app.json change needed** for any rollback.

To roll back to the Jun 3 gold source:

```bash
cd artifacts/cashclip
EXPO_TOKEN="$EXPO_TOKLAST" pnpm exec eas update:republish \
  --group 26fa0d4c-44c7-49ca-9e7c-35a7cf835f86 \
  --message "EMERGENCY: Restore Jun-3 known-good" --non-interactive
```

To roll back to the Jun 3 republish (slightly newer than gold):

```bash
EXPO_TOKEN="$EXPO_TOKLAST" pnpm exec eas update:republish \
  --group 991eb089-dd3a-4a72-a049-949743e5b6ea \
  --message "EMERGENCY: Restore Jun-3 republish" --non-interactive
```

---

## Rules

- **Never lower** `runtimeVersion` — `1.0.0` is permanent for all current live builds.
- **Never reuse** a versionCode on Android (Play rejects it).
- **OTA only covers JS/assets** — any native change (new SDK, new plugin, new permission) needs a new App Store/Play Store build.
- After any emergency republish, verify on-device: delete app → reinstall → open twice.
- **EAS OTA Publish workflow is one-shot** — restarting it fires a live publish immediately.
