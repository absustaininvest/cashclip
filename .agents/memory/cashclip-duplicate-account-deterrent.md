---
name: CashClip duplicate-account deterrent message
description: Owner-approved email template + rules for warning a user we caught running duplicate accounts, while honoring their payout. Reuse verbatim; do NOT expose the anti-fraud model.
---

# Duplicate-account deterrent message (owner-approved, Jun 17 2026)

Used when we detect one person running multiple CashClip accounts (one account per person rule) but choose to **honor** the pending payout as goodwill (early-stage, hoping for a review). The dinesh / dinesh99 case was the first: caught manually by SQL on shared payout-PayPal + ZIP + DOB; the $3 was honored.

## Hard rules (owner-stated)
- **Never name the actual anti-fraud signals** (ZIP, DOB, device, gender, etc.) — "he will alter it." The user must not learn the playbook.
- **Lean only on vague, deniable signals**: "the network you connect from" (IP) and "the PayPal account you cash out to." PayPal is the safe one to cite because it genuinely links accounts and users expect it.
- ⚠️ If you cite "network/IP," it must be literally true — only say it if we actually logged their IP. PayPal link alone is always 100% accurate, so the PayPal line can stand on its own.
- Tone: warm, honor-in-goodwill, one-account-per-person going forward, soft ask for an App Store review. Not threatening.

## Template (fill in first name)
> **Subject: Your $3 payout — a quick note from CashClip**
>
> Hi {name},
>
> Good news first — your **$3 withdrawal is approved**. Thanks for being one of our early users; at this stage it genuinely means a lot.
>
> One thing, just so we're upfront with you: our system automatically links accounts behind the scenes — things like the **network you connect from** and the **PayPal account** you cash out to — and it looks like more than one account traces back to you. CashClip is **one account per person**. We're honoring this payout in good faith, but going forward please stick to a single account so nothing gets flagged or held up.
>
> And if you've got a minute, a quick **App Store review** — or even a couple honest lines of feedback — would help our small team more than you know.
>
> Thanks,
> The CashClip Team

## Note on automated detection
As of Jun 17 2026 there is **no automated duplicate-account detector** — tonight's catch was manual SQL. Task #692 ("block throwaway/disposable PayPal domains") is RELATED but DIFFERENT: it blocks junk email *domains*, not "same person, two accounts." A real dup detector (flag when payout email / fingerprint / device already maps to another account, badge it in /sc-portal) is still unbuilt. Don't conflate the two when talking to the owner.
