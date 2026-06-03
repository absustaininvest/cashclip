# Threat Model

## Project Overview

This monorepo contains two production-facing products: the CashClip rewards platform (Expo client in `artifacts/cashclip`, including mobile builds and a browser-served web build, Express + TypeScript API in `artifacts/api-server`, PostgreSQL via `@workspace/db`) and the AB Sustainability Investments marketing website (`artifacts/absustain`, React + Vite). The production deployment is public on the internet, so public HTTP endpoints must be treated as internet-reachable. Both the mobile client and the CashClip web client are untrusted clients; all security decisions must be enforced on the API.

## Assets

- **User accounts and sessions** — usernames, emails, hashed passwords, access JWTs, long-lived refresh tokens, optional session/refresh cookies, TOTP enrollment state, and admin sessions. Compromise allows account takeover or admin impersonation.
- **CashClip balances and earnings state** — wallet balances, ledger entries, reward sessions, withdrawal requests, and ad/survey/offer completion records. Tampering here directly creates financial loss.
- **Admin capabilities and operator secrets** — `JWT_ACCESS_SECRET`, optional `JWT_ACCESS_SECRET_PREV` during key rotation, optional `JWT_EDDSA_KEY`, `ADMIN_TOKEN`, `SEED_ADMIN_PASSWORD`, `SECRETS_PASSPHRASE`, and integration key material. Compromise enables full administrative control and third-party account abuse.
- **Third-party integration credentials and webhook trust** — PayPal, CPX, BitLabs, and other survey/offerwall provider credentials and webhook secrets. Misuse can produce fraudulent payouts, fake reward credits, or data leakage.
- **User PII and support/business data** — profile data, support tickets, lead submissions, venture files, publisher and campaign records, payout addresses, and operational analytics.

## Trust Boundaries

- **Mobile/Web client to API** — all client input is attacker-controlled. The server must authenticate, authorize, validate, and enforce business rules independently of frontend behavior.
- **CashClip web app/admin browser surface** — `artifacts/cashclip` also ships a browser-served web build with operator pages such as admin and setup flows. Browser-only attacks like clickjacking, token theft via same-origin script execution, and UI redressing matter here independently of the API's Helmet protections, because the Expo static server is a separate trust boundary from the Express API.
- **Public CashClip product pages vs operator setup hints** — browser-served reward pages such as surveys and offerwalls are part of the public client surface. Any fallback UI that embeds provider lists, secret names, dashboard URLs, or setup guidance in shipped frontend code must be treated as public operator-metadata disclosure even if the backing API route is admin-gated.
- **Public to authenticated to admin API surfaces** — routes in `artifacts/api-server/src` cross distinct trust levels; admin functionality must never rely on hidden UI routes alone.
- **Autoscaled replicas vs shared abuse controls** — production runs on an autoscaled fleet, so any abuse-control state kept only in process memory or the default in-memory Express rate-limit store is replica-local and must not be treated as a global guard for auth or money-moving routes.
- **API to PostgreSQL** — the API has direct authority to mutate balances, sessions, users, and operational data. Any injection or authorization flaw here can fully compromise application integrity.
- **API to external survey/offer/payments providers** — provider APIs and webhooks are outside the trust boundary and must be strongly authenticated before rewarding users or triggering payouts.
- **Public website to admin portal boundary** — `artifacts/absustain` is mostly public marketing content but also serves a same-origin admin UI route (`/sc-portal`), so same-origin script injection or browser UI-redressing/frame-embedding issues would endanger admin tokens and privileged actions initiated from the browser. Because the admin SPA is bundled into the public website build, any hardcoded operator metadata embedded in frontend code is effectively public even if the route itself is login-gated.
- **Public operator-metadata endpoints** — read-only routes that reveal live integration, health, or setup state sit at a public/admin trust boundary because they expose internal providers, secret presence, and operational readiness to unauthenticated users.
- **Production vs dev-only code** — mock/demo artifacts and test-only paths are out of scope unless production reachability is demonstrated. Assume `NODE_ENV=production` in deployed environments.

## Scan Anchors

- **Primary production entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/auth.ts`, `artifacts/api-server/src/routes/cashclip.ts`, `artifacts/api-server/src/surveys.ts`, `artifacts/api-server/src/offerwalls.ts`, `artifacts/api-server/src/routes/earnings.ts`.
- **Highest-risk areas:** auth/session handling, JWT key-rotation fallback logic, account-recovery/password-reset flows, resend-verification abuse controls, admin middleware and secret-management routes, reward-crediting and withdrawal flows, sponsored earning routes, webhook verification, PayPal payout logic, public integration-status/operator metadata routes, the same-origin admin portal under `artifacts/absustain/src/pages/Admin.tsx`, and browser-served CashClip admin/setup routes under `artifacts/cashclip/app`.
- **Production abuse-control anchor:** prioritize DB-backed or otherwise shared enforcement on login/TOTP, password reset, sponsored visits, withdrawals, and webhook-related throttles; memory-only counters do not hold across replicas.
- **Public vs authenticated vs admin:** public marketing/lead routes, integration-status reads, and webhook endpoints are internet-reachable; most CashClip balance/reward routes are authenticated; `/api/admin/*`, venture file routes, and integration management are admin-only.
- **Usually out of scope:** test files, mockup sandboxes, build scripts, and purely local/development tooling unless a production route or deployment path exposes them.

## Threat Categories

### Spoofing

CashClip relies on bearer JWTs plus optional cookies, and it accepts third-party webhook traffic from survey/offerwall providers. The system must verify every protected request with a valid server-issued token, harden account-recovery proofs so reset codes cannot be guessed online at account scale, strictly sunset any previous JWT signing key used for rotation, and authenticate webhooks with provider-specific secrets or signatures before treating them as proof of a completed earning event.

### Tampering

The highest tampering risk is reward and payout manipulation. Clients must not be able to mint balances, complete reward sessions, alter withdrawal states, rotate integration secrets, or modify campaigns through client-controlled values alone. Reward amounts, completion state, payout eligibility, and sponsored-visit completion must be derived from trusted server-side records and verified provider callbacks or reliable proof of delivery, not from optimistic client claims, spoofable browser headers, replayable cookies, or replayable browser choreography alone.

### Repudiation

Administrative actions such as balance credits, withdrawal approval/payout, user deletion, password resets, and key rotation need attributable logs because they can directly affect funds and account access. Reward completion and payout flows also need durable records tying actions to the user, provider transaction, and time of execution.

### Information Disclosure

The API stores PII, payout addresses, operational analytics, and integration health information. Responses and logs must not expose secrets, provider credentials, sensitive admin data, or cross-user records. The public website must not introduce same-origin script injection that can steal admin tokens from browser storage, and admin setup flows must not disclose long-lived TOTP seeds to third-party services or browser-visible cross-origin requests. Operator-only business metadata that is hardcoded into the admin SPA or into public CashClip pages should be treated as public if it ships in the website bundle.

### Denial of Service

Public endpoints such as login, password reset, resend-verification, webhooks, lead capture, and any expensive provider-backed routes can be abused to exhaust application or third-party resources. The system must bound unauthenticated request rates with shared enforcement where production is autoscaled, reject malformed requests early, and avoid fail-open behavior when upstream providers are unavailable.

### Elevation of Privilege

The main privilege-escalation risks are broken access control on admin and cross-user API routes, weak account-recovery flows that let attackers reset another user's credentials, secret-based bypasses that overexpose operator powers, and business-logic flaws that let normal users turn authenticated access into monetary gain. All admin, payout, secret-management, account-recovery, and cross-account operations must enforce server-side role checks, object ownership checks, and recovery abuse controls on every request.