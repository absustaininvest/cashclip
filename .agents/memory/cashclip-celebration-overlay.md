---
name: CashClip celebration overlay
description: How/when Chipley celebration animations fire, and the genuine-win + OTA-safe constraints behind them
---

# CashClip celebration overlay

App-wide celebration: at a genuine win, mascot Chipley sprints across the screen
with confetti (`nice` tier) or confetti + fireworks (`epic` tier). Fired via
`useCelebration().celebrate({tier,label,title})` (provider mounted once at root,
wrapping the navigator inside `OtaUpdateGate`). Overlay is `pointerEvents="none"`
and remounts per `runId`.

**Rule — celebrate ONLY on genuine, server-confirmed wins.**
**Why:** spin/convert/withdraw/mission flows have local-fallback display paths.
The spin in particular can fall back to a local `WHEEL_SEGMENTS` display value when
the server call fails (network/DB blip) — that is NOT a real credited win, so it
must not trigger a celebration. Gated by `spinWasGenuine` (true only when the
server returned a token). Apply the same discipline to any new trigger: derive the
celebration from the trusted server result, never the optimistic display value.

**Rule — keep it pure JS/Reanimated, no native module.**
**Why:** celebrations must ride an OTA update onto the live build (runtime 1.0.0,
channel production). Adding a native confetti/particle lib would require a new App
Store build. The overlay uses only Reanimated primitives already in the bundle.
**How to apply:** a Chipley *voice* clip (expo-audio) was added once, then removed —
expo-audio is a native module that can't ride OTA, AND the owner judged the voice
version "cheapo" / off-brand and prefers the silent visual-only celebration. Keep
the celebration silent; do not re-add audio/voice to it.

**Modal/Alert timing:** RN Modal/Alert render above the app tree, so for spin and
streak (Modals) and Alert-based wins (claim-all, convert, withdraw) fire
`celebrate` from the modal close handler / Alert OK `onPress`, not while open.
In-tree successes (mission claims, scratch-card) celebrate immediately.

**Build-29 (live base) trigger set differs from HEAD.** The live base JS lacks the
`spinWasGenuine` gate, the `MilestoneRewardModal`, and server-confirmed scratch-card
(base-29 scratch credits LOCALLY via `recordGamePlay`, no `completeGame` token).
So when grafting the overlay onto a build-29 OTA, wire celebrate ONLY into the
genuinely server-confirmed wins that exist there: rewarded-ad complete
(`handleComplete`), claim-all (`handleClaimAll`), wallet convert (`handleConvertNow`),
wallet withdraw (`handleWithdraw`). SKIP spin/scratch/missions on base-29 — they
have no genuine-win signal and would celebrate fake/local wins. Also: base-29 root
has NO `OtaUpdateGate`; mount `CelebrationProvider` inside `TrackingConsentGate`
wrapping `RootLayoutNav` instead.

**Incident (Jun 5 2026):** the first build-29 celebration OTA accidentally wired the
spin `celebrate()` (modal onClose), violating the SKIP-spin rule above — it shipped
LIVE and celebrated fallback/non-credited spins (wheel lands on a random segment,
credits the server amount, but still partied). Owner approved a corrective OTA that
removed the spin `celebrate()`; live-correct trigger set on base-29 is now wallet
convert + withdraw + earn claim-all only. **Before publishing any build-29
celebration OTA, `grep celebrate(` and confirm NO spin/scratch/mission call site.**
