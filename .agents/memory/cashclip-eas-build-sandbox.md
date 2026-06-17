---
name: EAS native build inside the sandbox
description: How to queue an eas build (Android/iOS) from this sandbox without it getting reaped, and what the git-clone timeout actually is.
---

# EAS native build inside the sandbox

`eas build -p <platform> --profile production --no-wait` from a plain bash call
**times out / gets reaped (-1 or 124)** before queuing. Root cause: by default
EAS produces the upload archive with `git clone file:///home/runner/workspace`
(full history). The workspace `.git` is multi-GB, so the compress+upload phase
exceeds the bash tool's ~120s ceiling. It is NOT the git-write guard — the trace
shows credentials resolve fine and it dies during "Compressing project files".

**Fix that works in plain bash:** set `EAS_NO_VCS=1`. EAS then tars the working
directory directly (respecting `.gitignore` + the root `.easignore`, which
excludes `.git`/`exports`/`.local`/`.cache`/`attached_assets`). Upload drops to
~18 MB and the build queues in <60s with `--no-wait`. Then poll
`eas build:view <id> --json` until `status:"FINISHED"` and read
`artifacts.applicationArchiveUrl` (the `.aab`/`.ipa` download URL).

**Why not a workflow:** the proven long-CLI pattern is a managed workflow, but
the project sits at the **10/10 workflow limit** — `configureWorkflow` rejects
both a new name AND reconfiguring an existing one (counts as add). So
`EAS_NO_VCS=1` in bash is the path of least resistance for one-off builds.

Keep `PATH=/tmp/fake-bin:$PATH` git-wrapper + `EXPO_TOKEN=$EXPO_TOKLAST` exported.
`appVersionSource: local` + `autoIncrement: false` → versionCode comes straight
from `app.json` (no surprise bump).

## Android signing certs — two different certs, by design
- **Play App Signing / "deployment" cert** (subject `Google Inc., Android`): the
  key Google re-signs delivered APKs with. Confirms Play App Signing is enabled.
- **Upload key cert** (`credentials/upload_certificate.txt`, empty subject = the
  EAS keystore "Build Credentials qFmLVFCo86"): what EAS signs the `.aab` with.
  Play accepts the upload only if THIS cert's SHA-1/256 matches Play Console →
  App integrity → **Upload key certificate**. The deployment cert can't verify
  that match — need the upload cert from Play Console to compare.
