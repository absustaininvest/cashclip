---
name: Prod uptime-monitor false positives
description: How to tell a real prod outage from a monitor blip on the single-instance deployment.
---

An uptime-monitor "outage / N% uptime" alert on the CashClip prod deployment is usually a single missed ping (transient network/edge between the monitor and Replit), NOT real downtime.

**How to verify:** pull deployment logs bracketing the alert timestamp (convert EDT→UTC: EDT = UTC-4). A healthy app shows:
- the SAME process pid serving continuously before/after the timestamp (no restart),
- no `Server listening`/startup line in the window (no redeploy),
- no 5xx/crash/SIGTERM/pool errors, and money-moving logs (spins credited, ad-events, surveys) still flowing.
If all that holds, there was no app outage — report it as monitor noise.

**Real** downtime would instead show a restart (new pid + startup line), 5xx bursts, crash/uncaught, or a multi-minute gap with no requests at all.

**Why:** prod runs effectively single-instance; a momentary blip when the external monitor knocks reads as e.g. "67%" (one of three pings missed) even though users were served the whole time. Confirmed Jun 5 2026 — the 10:32 EDT alert was a false positive (logs showed continuous same-pid serving, zero errors).
