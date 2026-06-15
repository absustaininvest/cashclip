---
name: IPA repack on Linux
description: What breaks when running @expo/repack-app on Replit (Linux) and how to work around it.
---

@expo/repack-app requires `unzip`, `plutil`, and `codesign` — all macOS-native tools. On Linux (Replit):

- `unzip`: can be replaced with a Python zipfile wrapper in /tmp/fake-bin
- `plutil`: can be replaced with a Python plistlib wrapper in /tmp/fake-bin
- `codesign`: NO Linux equivalent; the app cannot be re-signed on Replit

**Why:** These are Apple/macOS-only binaries. The repack tool spawns them as child processes; PATH must include wrappers before running npx.

**How to apply:** For a runtimeVersion-only patch (no JS bundle swap), use Python directly: extract IPA with zipfile, load/modify/write Expo.plist with plistlib (FMT_BINARY), re-zip. Output is a valid zip but has an INVALID code signature — user must re-sign on Mac with codesign or Xcode Organizer before submitting to Apple.
