---
name: CashClip wallet withdrawal email (write-once + warning banner)
description: How the withdrawal modal's PayPal email is locked, where it's validated, and why not to re-add an editable field.
---

# Wallet withdrawal PayPal email

The withdrawal modal's PayPal email is **write-once and locked** (display only),
set once on the Profile screen. `openWithdrawModal` early-returns to Profile if
`user.paypalEmail` is unset, so in the modal the email is always present and
non-editable.

## Suspicious-email warning banner
`openWithdrawModal` runs the locked email through `isPlausiblePayPalDomain`
(`@workspace/validation`). A disposable/implausible saved domain sets
`savedEmailWarning` (renders the amber banner containing "...may not be
accepted...") AND sets `paypalEmailError`, which disables the `withdraw-confirm`
button. A plausible email shows no banner and leaves confirm usable.

**Why:** the write-once feature (commit that added profile paypalEmail) dropped
the banner JSX + the editable inline-validation input, leaving the styles
(`savedEmailWarningBanner`) orphaned and the wallet tests red. Restored the
banner as the remaining anti-fraud surface.

## Don't re-add an editable email field in the modal
The server validates the **submitted** email independently at `/api/withdrawals`
(regex + `isPlausiblePayPalDomain`) and enforces write-once at
`/api/profile/paypal-email`. The locked display is the only thing stopping a
user from withdrawing to a *different* (still server-valid) email, so making it
editable would weaken the one-PayPal-per-account intent. Keep it locked;
validate the saved value, not free-text typing.

## Tests
`app/(tabs)/wallet.bonus.test.tsx` mounts WalletScreen in the node env. It needs
`(global as any).IS_REACT_ACT_ENVIRONMENT = true` and a mutable
`authPaypalEmail` lever on the `useAuth` mock so the modal opens and different
saved emails can be exercised. The tier Pressables are found by "$" text nodes.
