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

All groups on branch `production`, runtime `1.0.0`.

| Date | Update Group ID | Message | Notes |
|------|----------------|---------|-------|
| Jun 13, 2026 | `b92510af-7537-4f55-acde-b9e2e25de401` | OTA update | **LIVE** — AdMob banner restored, CTA "Learn More" |
| Jun 13, 2026 | `aab4a553-53ed-48d3-a63b-ed59456c533c` | OTA update | Pts labels + pts badges restored |
| Jun 13, 2026 | `9bdc4700-556d-4471-9247-711f381d7fcb` | Reconcile: 306729c9 | Full reconcile republish |
| Jun 13, 2026 | `3ac6ac1f-083a-4c11-a730-ffd04ef831d2` | Reconcile: 17aaf3a7 | Consent gate fix republish |
| Jun 13, 2026 | `19affa37-b6a7-4306-a656-ce913d333f63` | Reconcile: 875823df | Native iOS ad card badge fix republish |
| Jun 13, 2026 | `0321fbf8-4b24-4d7f-94dd-de3ad080f6ee` | Reconcile: 3a354561 | All cleanup republish |
| Jun 13, 2026 | `a6e372f6-2874-44f5-9ffe-3dfc982ba197` | Reconcile: f1cf0886 | Remove pts badges republish |
| Jun 13, 2026 | `306729c9-b506-4a26-8e17-c86a0997b340` | OTA update | Full reconcile (original publish) |
| Jun 13, 2026 | `17aaf3a7-0c0e-48ac-a731-bd987d2fed32` | OTA: consent gate fix + auto-apply on launch | |
| Jun 12, 2026 | `875823df-0384-48fc-b65f-5d56a9124987` | Fix native iOS ad card badge | |
| Jun 12, 2026 | `3a354561-31d9-4581-a5c2-61fcdce9edb5` | All cleanup — no pts in games, spin, video, ad badges | |
| Jun 12, 2026 | `f1cf0886-ab6a-41d3-9f5d-14ff00f50ae3` | Remove pts badges from all cards | |

> Jun 3 gold source groups (`26fa0d4c`, `991eb089`) were on Project B — no longer accessible for republish.

---

## Emergency Rollback

`app.json` runtimeVersion is permanently `1.0.0` — **no app.json change needed**.

Roll back to any checkpoint by republishing its group:

```bash
cd artifacts/cashclip
PATH=/tmp/fake-bin:$PATH EXPO_TOKEN=$EXPO_TOKLAST pnpm exec eas update:republish \
  --group <GROUP_ID> \
  --message "ROLLBACK to <GROUP_ID>" \
  --non-interactive
```

To roll back to the pre-reconcile state (Jun 12 cleanup):

```bash
PATH=/tmp/fake-bin:$PATH EXPO_TOKEN=$EXPO_TOKLAST pnpm exec eas update:republish \
  --group 875823df-0384-48fc-b65f-5d56a9124987 \
  --message "ROLLBACK: Jun-12 cleanup" \
  --non-interactive
```

---

## Rules

- **Never lower** `runtimeVersion` — `1.0.0` is permanent for all current live builds.
- **Never reuse** a versionCode on Android (Play rejects it).
- **OTA only covers JS/assets** — any native change needs a new App Store/Play Store build.
- After any rollback, verify on-device: delete app → reinstall → open twice.
- **EAS OTA Publish workflow is one-shot** — restarting it fires a live publish immediately.
