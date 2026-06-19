# Threat Model

## Project Overview

This monorepo contains two production-facing products: the CashClip rewards platform (Expo client in `artifacts/cashclip-next`, including mobile builds and a browser-served web build, Express + TypeScript API in `@expo/artifacts/api-server`, PostgreSQL via `@workspace/db`) and the AB Sustainability Investments marketing website (`@expo/artifacts/absustain`, React + Vite). The production deployment is public on the internet, so public HTTP endpoints must be treated as internet-reachable. Both the mobile client and the CashClip web client are untrusted clients; all security decisions must be enforced on the API.

## Assets

- **User accounts and sessions** — usernames, emails, hashed passwords, access JWTs, long-lived refresh tokens, optional session/refresh cookies, TOTP enrollment state, and admin sessions. Compromise allows account takeover or admin impersonation.
- **CashClip balances and earnings state** — wallet balances, ledger entries, reward sessions, withdrawal requests, and ad/survey/offer completion records. Tampering here directly creates financial loss.
- **Admin capabilities and operator secrets** — `JWT_ACCESS_SECRET`, optional `JWT_ACCESS_SECRET_PREV` during key rotation, optional `JWT_EDDSA_KEY`, `ADMIN_TOKEN`, `SEED_ADMIN_PASSWORD`, `SECRETS_PASSPHRASE`, and integration key material. Compromise enables full administrative control and third-party account abuse.
- **Third-party integration credentials and webhook trust** — PayPal, CPX, BitLabs, and other survey/offerwall provider credentials and webhook secrets. Misuse can produce fraudulent payouts, fake reward credits, or data leakage.
- **User PII and support/business data** — profile data, support tickets, lead submissions, venture files, publisher and campaign records, payout addresses, and operational analytics.

## Trust Boundaries

- **Mobile/Web client to API** — all client input is attacker-controlled. The server must authenticate, authorize, validate, and enforce business rules independently of frontend behavior.
- **Refresh-token rotation boundary** — a copied refresh token must become unusable after one successful refresh. Rotation logic must be atomic at the database boundary; read-then-write version checks are insufficient because concurrent replay can otherwise mint a surviving new token family.
- **CashClip web app/admin browser surface** — `artifacts/cashclip-next` also ships a browser-served web build with operator pages such as admin and setup flows. Browser-only attacks like clickjacking, token theft via same-origin script execution, and UI redressing matter here independently of the API's Helmet protections, because the Expo static server is a separate trust boundary from the Express API.
- **Public to authenticated to admin API surfaces** — routes in `@expo/artifacts/api-server/src` cross distinct trust levels; admin functionality must never rely on hidden UI routes alone.
- **Autoscaled replicas vs shared abuse controls** — production runs on an autoscaled fleet, so any abuse-control state kept only in process memory or the default in-memory Express rate-limit store is replica-local and must not be treated as a global guard for auth or money-moving routes.
- **API to PostgreSQL** — the API has direct authority to mutate balances, sessions, users, and operational data. Any injection or authorization flaw here can fully compromise application integrity.
- **API to external survey/offer/payments providers** — provider APIs and webhooks are outside the trust boundary and must be strongly authenticated before rewarding users or triggering payouts.
- **Public operator OAuth callbacks** — routes such as `/api/integrations/tiktok/callback` are internet-reachable even though they complete admin-initiated setup. Their one-time `state`/nonce values must be bound to the initiating admin flow and compared before consumption so arbitrary callers cannot invalidate or tamper with operator authorization.
- **Publisher-controlled sponsored-visit postbacks** — publisher landing pages and any server-to-server callbacks derived from publisher-controlled campaign destinations are attacker-controlled when a publisher is malicious or compromised. A publisher callback alone is not trusted proof that real third-party content was viewed.
- **Public website to admin portal boundary** — `@expo/artifacts/absustain` is mostly public marketing content but also serves a same-origin admin UI route (`/sc-portal`), so same-origin script injection or browser UI-redressing/frame-embedding issues would endanger admin tokens and privileged actions initiated from the browser. Because the admin SPA is bundled into the public website build, any hardcoded operator metadata embedded in frontend code is effectively public even if the route itself is login-gated.
- **Public operator-metadata endpoints** — read-only routes that reveal live integration, health, or setup state sit at a public/admin trust boundary because they expose internal providers, secret presence, and operational readiness to unauthenticated users.
- **Production vs dev-only code** — mock/demo artifacts and test-only paths are out of scope unless production reachability is demonstrated. Assume `NODE_ENV=production` in deployed environments.
- **Tracked release credentials in temp/export paths** — temporary- or archive-looking paths such as `.eas-tmp/`, `exports/`, or attached-asset vaults remain in scope when the repository tracks live signing keys, store API keys, provisioning profiles, or other release credentials. Location alone does not make them dev-only.

## Scan Anchors

- **Primary production entry points:** `@expo/artifacts/api-server/src/app.ts`, `@expo/artifacts/api-server/src/auth.ts`, `@expo/artifacts/api-server/src/routes/cashclip.ts`, `@expo/artifacts/api-server/src/surveys.ts`, `@expo/artifacts/api-server/src/offerwalls.ts`, `@expo/artifacts/api-server/src/routes/earnings.ts`.
- **Highest-risk areas:** auth/session handling, refresh-token rotation at `POST /api/auth/refresh`, account-recovery/password-reset flows, admin middleware and secret-management routes, reward-crediting and withdrawal flows, webhook verification, public operator OAuth callbacks such as `/api/integrations/tiktok/callback`, PayPal payout logic, authenticated support-ticket email submission at `POST /api/support/tickets`, the same-origin admin portal under `@expo/artifacts/absustain/src/pages/Admin.tsx`, and browser-served CashClip admin/setup routes under `artifacts/cashclip-next/app`.
- **Client-timed reward flows:** treat `/api/earn/ad/begin` → `/api/earn/ad/complete` and `/api/earn/game/begin` → `/api/earn/game/complete` as high-risk anchors. A same-user challenge token plus elapsed time is not trusted proof that an ad impression or game win actually occurred.
- **Sponsored-visit status:** the money-moving settlement endpoint `POST /api/earn/sponsored/:id/visit` is currently disabled in production (returns 410 and the list endpoint is empty), so retained sponsored-visit witness-chain code is lower priority unless settlement is re-enabled or production reachability changes.
- **Publisher destination handling:** publisher-managed sponsored campaign destinations are attacker-controlled once a publisher account is malicious or compromised. Any persistence or redirect/render use of `campaign.targetUrl` must enforce an `http`/`https` allowlist both when written and at the redirect/render sink.
- **Production abuse-control anchor:** prioritize DB-backed or otherwise shared enforcement on login/TOTP, password reset, sponsored visits, withdrawals, support-ticket email submission, and provider-backed survey/offerwall availability and completion routes; memory-only counters do not hold across replicas.
- **Public vs authenticated vs admin:** public marketing/lead routes and webhook endpoints are internet-reachable; most CashClip balance/reward routes are authenticated; `/api/admin/*`, venture file routes, integration management, and current operator-status/health reads are admin-only.
- **Usually out of scope:** test files, mockup sandboxes, build scripts, and purely local/development tooling unless a production route or deployment path exposes them.
- **Exception to build-artifact out-of-scope guidance:** tracked build or export artifacts that contain live Apple or Google release credentials stay in scope because repository disclosure would directly endanger the production mobile release chain.

## Threat Categories

### Spoofing

CashClip relies on bearer JWTs plus optional cookies, and it accepts third-party webhook traffic from survey/offerwall providers. The system must verify every protected request with a valid server-issued token, make refresh-token rotation single-use at the database level rather than only in request flow, harden account-recovery proofs so reset codes cannot be guessed online at account scale, strictly sunset any previous JWT signing key used for rotation, and authenticate webhooks with provider-specific secrets or signatures before treating them as proof of a completed earning event.

### Tampering

The highest tampering risk is reward and payout manipulation. Clients must not be able to mint balances, complete reward sessions, alter withdrawal states, rotate integration secrets, or modify campaigns through client-controlled values alone. Reward amounts, completion state, payout eligibility, and sponsored-visit completion must be derived from trusted server-side records and verified provider callbacks or reliable proof of delivery, not from optimistic client claims, publisher self-attestation, or replayable browser choreography alone. Client-timed begin/complete ceremonies are not sufficient proof for money-like rewards unless they are bound to a trusted provider callback or another server-verifiable signal.

### Repudiation

Administrative actions such as balance credits, withdrawal approval/payout, user deletion, password resets, and key rotation need attributable logs because they can directly affect funds and account access. Reward completion and payout flows also need durable records tying actions to the user, provider transaction, and time of execution.

### Information Disclosure

The API stores PII, payout addresses, operational analytics, and integration health information. Responses and logs must not expose secrets, provider credentials, sensitive admin data, or cross-user records. The public website must not introduce same-origin script injection that can steal admin tokens from browser storage, and admin setup flows must not disclose long-lived TOTP seeds to third-party services or browser-visible cross-origin requests. Operator-only business metadata that is hardcoded into the admin SPA should be treated as public if it ships in the website bundle.

### Denial of Service

Public endpoints such as login, password reset, webhooks, lead capture, and any expensive provider-backed routes can be abused to exhaust application or third-party resources. The system must bound unauthenticated request rates, reject malformed requests early, and avoid fail-open behavior when upstream providers are unavailable.

### Elevation of Privilege

The main privilege-escalation risks are broken access control on admin and cross-user API routes, weak account-recovery flows that let attackers reset another user's credentials, secret-based bypasses that overexpose operator powers, and business-logic flaws that let normal users turn authenticated access into monetary gain. All admin, payout, secret-management, account-recovery, and cross-account operations must enforce server-side role checks, object ownership checks, and recovery abuse controls on every request.
