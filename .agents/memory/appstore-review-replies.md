---
name: App Store review replies + Apple defense (owner-approved)
description: Owner-approved tone & exact templates for CashClip public App Store review replies and the Apple "Report a Concern" removal note. Reuse verbatim — do NOT re-derive from scratch.
---

# CashClip App Store Defense — owner-approved reference

**Source of truth:** `attached_assets/CashClip_AppStore_Defense_Record_1780103777348.pdf` (owner-supplied). This is the APPROVED wording/tone. When asked for review replies or the Apple note, start from these — do not invent new ones.

**Approved tone:** confident, factual, FIRM — never apologetic/groveling. State the security/verification design as fact. Reassure honest users; signal to bad actors that abuse is detected by design. Always route to the support email. Never attack the individual reviewer.

**Support email used in the approved public replies:** `support@absustaininvest.com` (per the approved PDF). The newer admin/rescue mailbox `support@cash-clip.app` exists too; confirm with owner which to use before swapping.

## Approved public reply templates (from the PDF, verbatim)

- **'scam / didn't pay me':** "Every reward and withdrawal on CashClip is verified server-side and confirmed against our payment partners before payout. Payments that pass verification are always honored; activity that fails verification is automatically declined. If you believe a legitimate payout was missed, contact support@absustaininvest.com and we'll review your account directly."
- **'locked out / can't recover account':** "Account recovery requires a verified email, which is clearly presented at sign-up. Accounts created without one cannot be recovered — a security measure that protects every user from unauthorized access. Reach support@absustaininvest.com and we'll help with any account that has a verified email on file."
- **'fake surveys / didn't credit':** "Our surveys come from established research partners (CPX Research, BitLabs) and credit automatically once the partner confirms completion via signed callback. Completions that can't be verified by the partner aren't credited. Questions? support@absustaininvest.com."
- **General firm reply (use anywhere):** "CashClip uses signature-verified partner integrations, server-side reward validation, and automated fraud monitoring. Legitimate earnings are always protected and paid; attempts to manipulate balances are detected and blocked by design. Genuine concerns are always welcome at support@absustaininvest.com."

## Apple "Report a Concern" note
The full removal note is Section 1 of the PDF (subject: "Request to review fraudulent/retaliatory reviews - CashClip (Apple ID 6759931285)"). Section 3 is the supporting-evidence summary. Reuse from the PDF.

## Caveats to respect
- The "account recovery clearly disclosed at sign-up / email optional but required to recover" claim is OWNER-ATTESTED, not code-proven (the old red disclosure was in a pre-transfer codebase that was wiped). Keep it only because the owner approved it; don't present it as code-verified.
- Several real reviews (May 2026) are genuine REGISTRATION bugs, not retaliation: username field only allows `[a-zA-Z0-9_-]`, 3–30 chars, so accented/international characters (Sweden, France users) are rejected and the submit button just greys out with no clear error. The approved "firm" categories don't cover sign-up failures — for those, match the tone but write a registration-specific reply, and consider fixing signup (needs owner approval).
