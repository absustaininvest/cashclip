---
name: CashClip auth-token storage backend split
description: Why some in-app screens get "not authenticated" on native while web works — token storage backend mismatch.
---

# Auth token storage: secureGet/secureSet vs raw AsyncStorage

The CashClip Expo app persists the auth JWT (key `cashclip_auth_token`) through
`secureGet`/`secureSet` in `lib/secure-store`. On **native** that resolves to
`secure-store.native.ts`, which writes to **expo-secure-store** (SecureStore) first
and only falls back to AsyncStorage. On **web** it's plain AsyncStorage.

**The trap:** any screen that reads the token directly via
`AsyncStorage.getItem("cashclip_auth_token")` gets `null` on a native device (token
lives in SecureStore, not AsyncStorage) → sends `Authorization: Bearer null` → 401
"not authenticated". The same screen works fine on web because both paths use
AsyncStorage there. Symptom seen: in-app Admin / Ad Analytics tab showed "not
authenticated" on the phone while the website `/sc-portal` worked.

**Rule:** always read/write the auth token through `secureGet`/`secureSet` from
`@/lib/secure-store` (or `./secure-store`). Never touch `cashclip_auth_token` via
raw AsyncStorage. Before shipping, grep for `getItem("cashclip_auth_token")` across
`artifacts/cashclip` — it must return nothing.

**Why:** native vs web use different storage backends; raw AsyncStorage reads are
invisible to SecureStore-stored tokens, so the bug only reproduces on real builds
(incl. live build 29), not in the web preview.
