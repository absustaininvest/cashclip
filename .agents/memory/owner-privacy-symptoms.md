---
name: Owner privacy setup → false security flags
description: Why the owner's accounts/app/editor "act up" — it's privacy tooling on his side, not a breach. Confirm state before any account recovery.
---

# Privacy tooling causes self-inflicted "flags" (not breaches)

The owner runs strong privacy protections on his devices: iCloud Private Relay
("Limit IP address tracking" = ON), private/incognito browsing, and at times a VPN.
Effect: his public IP/location **rotates** between requests.

This single root cause explains a cluster of symptoms — treat them as expected, not incidents:
- **Location "flagging"** by CashClip anti-fraud and the website admin security.
- The **Replit editor refreshing every ~2 min** (live connection drops/reconnects as the IP changes).
- **CashClip ad-attribution / tracking "acting up"** (inconsistent IP/device signals; he can trip his own fraud holds while testing).
- A flood of **security-alert emails** triggered by **his own** sensitive actions (his own resets/logins), not by an attacker.

**Workaround to give him:** for admin login or app testing, temporarily turn OFF "Limit IP
address tracking" and use a normal (non-private) window, then turn protection back ON for daily use.
Rule of thumb for alert emails: a flag he doesn't recognize = act on it; a flag he caused = ignore.

**Network-environment factor:** a secondary network he sometimes uses has a **firewall** that can
block/slow connections (admin portal, CashClip app, or Replit may glitch or fail to load there).
If something won't work, rule out the network first: try cellular / a personal hotspot — if it then
works, it was the network, not an app bug.

# Confirm account state BEFORE planning any recovery

The owner is capable and self-resolves. In a past incident, significant time went into planning a
factory-reset for his CashClip admin account when he had already reset it himself and could log in fine.

**Rule:** before diagnosing/planning an account recovery, first ask the owner the *current* state
("are you able to log in right now? what's on screen?"). Don't assume a lockout persists.

**2FA inventory (owner-attested):** authenticators are set up for the CashClip admin account, the
website admin mailbox, and the Expo account (signs app builds). Backup codes are stored physically,
offline. (Never store any codes here.)

**Why:** assuming the worst wasted real time on a non-problem. A 10-second state check first
saves a long recovery detour.
