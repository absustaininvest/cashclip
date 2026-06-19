#!/usr/bin/env bash
set -euo pipefail

# ── Safety guard ─────────────────────────────────────────────────────────────
# Require EAS_ANDROID_CONFIRMED=1 to prevent accidental re-runs when Replit
# auto-restarts this workflow. Set it in the workflow command to run.
if [ "${EAS_ANDROID_CONFIRMED:-0}" != "1" ]; then
  echo "================================================"
  echo "  EAS Android Build — WAITING FOR CONFIRMATION"
  echo "================================================"
  echo ""
  echo "  This workflow requires EAS_ANDROID_CONFIRMED=1 to run."
  echo "  Set it in the workflow command to proceed:"
  echo "    EAS_ANDROID_CONFIRMED=1 bash scripts/eas-build-android.sh"
  echo ""
  echo "  Sleeping indefinitely to prevent duplicate builds..."
  sleep infinity
fi

echo "================================================"
echo "  CashClip EAS Android Build — $(date)"
echo "================================================"

# ── SSL-pin pre-flight ────────────────────────────────────────────────────────
# Verify the live cash-clip.app SPKI hash still matches the PRIMARY pin baked
# into plugins/withSslPinning.js.  A mismatch means the server key rotated and
# shipping this build would lock all users out of the API.
echo ""
echo "── SSL pin pre-flight ──"
if bash "$(dirname "$0")/verify-spki-hash.sh"; then
  echo "  SSL pin OK — continuing build."
else
  echo ""
  echo "  ✗ SSL pin check failed. Update plugins/withSslPinning.js before building."
  exit 1
fi

if [ -z "${EXPO_TOKEN:-}" ]; then
  echo "ERROR: EXPO_TOKEN is not set. Add it as a Replit secret."
  exit 1
fi

WORKSPACE="$(cd "$(dirname "$0")/.." && pwd)"
CASHCLIP_SRC="$WORKSPACE/artifacts/cashclip"
MINI="$HOME/cashclip-mini-android"

echo ""
echo "→ Workspace:    $WORKSPACE"
echo "→ Mini-repo:    $MINI"
echo "→ Build number: $(python3 -c "import json; print(json.load(open('$CASHCLIP_SRC/app.json'))['expo']['android']['versionCode'] if 'android' in json.load(open('$CASHCLIP_SRC/app.json'))['expo'] and 'versionCode' in json.load(open('$CASHCLIP_SRC/app.json'))['expo']['android'] else 'not set')")"
echo ""

# ── Step 1: Clean stale files ─────────────────────────────────────────────────
echo "── Step 1: Clean stale files ──"
find /tmp -maxdepth 1 \( -name 'cashclip*' -o -name 'runner' \) -exec rm -rf {} + 2>/dev/null || true
echo "  done"

# ── Step 2: Build minimal source-only repo ────────────────────────────────────
echo ""
echo "── Step 2: Build minimal git repo (no node_modules) ──"
rm -rf "$MINI"
mkdir -p "$MINI"

python3 << PYEOF
import shutil, os

src = '$WORKSPACE'
dst = '$MINI'
skip = {'node_modules', '.git', '__pycache__', 'dist', 'build', '.expo',
        'credentials', 'attached_assets', 'eas-tmp'}

def copy_dir(s, d):
    os.makedirs(d, exist_ok=True)
    for item in os.listdir(s):
        if item in skip:
            continue
        sp, dp = os.path.join(s, item), os.path.join(d, item)
        if os.path.isdir(sp):
            copy_dir(sp, dp)
        else:
            shutil.copy2(sp, dp)

for subdir in ['artifacts/cashclip', 'lib']:
    copy_dir(os.path.join(src, subdir), os.path.join(dst, subdir))

for f in ['pnpm-workspace.yaml', 'package.json', 'tsconfig.base.json',
          'tsconfig.json', 'pnpm-lock.yaml', '.gitignore']:
    fp = os.path.join(src, f)
    if os.path.exists(fp):
        shutil.copy2(fp, os.path.join(dst, f))

# Rewrite pnpm-workspace.yaml so it only lists packages that exist in the
# mini-repo. The full workspace lists artifacts/* and scripts which are absent
# here and cause "pnpm install --no-frozen-lockfile" to exit with code 1.
import re
ws_path = os.path.join(dst, 'pnpm-workspace.yaml')
with open(ws_path, 'r') as fh:
    ws_text = fh.read()
ws_text = re.sub(
    r'^packages:.*?(?=\n\S|\Z)',
    'packages:\n  - artifacts/cashclip\n  - lib/*\n  - lib/integrations/*',
    ws_text,
    flags=re.DOTALL | re.MULTILINE,
)
with open(ws_path, 'w') as fh:
    fh.write(ws_text)
print("  Trimmed pnpm-workspace.yaml to mini-repo packages")

total = sum(len(fs) for _, _, fs in os.walk(dst))
print(f"  Copied {total} files")
PYEOF

ln -sf "$WORKSPACE/node_modules" "$MINI/node_modules"
ln -sf "$WORKSPACE/artifacts/cashclip/node_modules" "$MINI/artifacts/cashclip/node_modules"
echo "  Symlinked workspace + cashclip node_modules"

# ── Step 3: Git commit ────────────────────────────────────────────────────────
echo ""
echo "── Step 3: Init git in mini-repo ──"
export GIT_PAGER=cat
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="safe.directory"
export GIT_CONFIG_VALUE_0="*"

cd "$MINI"
git init
git config user.email "andyballen0814@icloud.com"
git config user.name "Andy Ballen"
git add -A
git --no-pager commit --quiet -m "eas android build"
echo "  committed 1 commit, $(git ls-files | wc -l) files"

# ── Step 4: EAS Build ─────────────────────────────────────────────────────────
echo ""
echo "── Step 4: EAS Build (Android production) ──"

NODE_DIR="$(dirname "$(which node 2>/dev/null || echo "/usr/bin/node")")"
export PATH="$NODE_DIR:$PATH"
echo "  node: $(which node) ($(node --version))"

cd "$MINI/artifacts/cashclip"
EAS_BIN="$(which eas 2>/dev/null || echo "$HOME/.config/npm/node_global/bin/eas")"
echo "  Using EAS CLI: $EAS_BIN ($($EAS_BIN --version 2>/dev/null | head -1))"
# EAS_SKIP_AUTO_FINGERPRINT=1 works around a crash in eas-cli@18.11.0 where
# brace-expansion v5.0.5 is called as a function. Remove once eas-cli is
# upgraded past the fix (tracked in brace-expansion@5.0.6 / eas-cli@18.13+).
EXPO_TOKEN="$EXPO_TOKEN" EAS_SKIP_AUTO_FINGERPRINT=1 "$EAS_BIN" build \
  --platform android \
  --profile production \
  --non-interactive \
  --clear-cache \
  2>&1

echo ""
echo "================================================"
echo "  Android build complete! AAB ready for Play Store."
echo "  To submit: eas submit --platform android --latest"
echo "================================================"
