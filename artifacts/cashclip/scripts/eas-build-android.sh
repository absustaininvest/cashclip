#!/usr/bin/env bash
set -euo pipefail

# ── Safety guard ─────────────────────────────────────────────────────────────
# Require EAS_BUILD_CONFIRMED=1 to prevent accidental re-runs when Replit
# auto-restarts this workflow. Set this in the workflow command or env to run.
if [ "${EAS_BUILD_CONFIRMED:-0}" != "1" ]; then
  echo "================================================"
  echo "  EAS Android Build — WAITING FOR CONFIRMATION"
  echo "================================================"
  echo ""
  echo "  This workflow requires EAS_BUILD_CONFIRMED=1 to run."
  echo "  Set it in the workflow command to proceed:"
  echo "    EAS_BUILD_CONFIRMED=1 bash artifacts/cashclip/scripts/eas-build-android.sh"
  echo ""
  echo "  Sleeping indefinitely to prevent duplicate builds..."
  sleep infinity
fi

echo "================================================"
echo "  CashClip EAS Android Build — $(date)"
echo "================================================"

EXPO_TOKEN="${EXPO_TOKEN:-${EXPO_TOKLAST:-}}"
if [ -z "$EXPO_TOKEN" ]; then
  echo "WARNING: EXPO_TOKEN/EXPO_TOKLAST not found in shell environment — EAS CLI will attempt its own auth."
fi

WORKSPACE="$(cd "$(dirname "$0")/../../.." && pwd)"
CASHCLIP_SRC="$WORKSPACE/artifacts/cashclip"
MINI="$HOME/cashclip-mini"

echo ""
echo "→ Workspace:    $WORKSPACE"
echo "→ Mini-repo:    $MINI"
echo "→ Version code: $(python3 -c "import json; print(json.load(open('$CASHCLIP_SRC/app.json'))['expo']['android']['versionCode'])")"
echo ""

# ── Step 1: Clean stale /tmp EAS files ──────────────────────────────────────
echo "── Step 1: Clean /tmp stale files ──"
find /tmp -maxdepth 1 \( -name 'cashclip*' -o -name 'runner' \) -exec rm -rf {} + 2>/dev/null || true
find /tmp -maxdepth 1 -regex '/tmp/[0-9a-f]\{32\}' -exec rm -rf {} + 2>/dev/null || true
echo "  done"

# ── Step 2: Build minimal source-only repo ───────────────────────────────────
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

# Copy only what EAS needs
for subdir in ['artifacts/cashclip', 'lib']:
    copy_dir(os.path.join(src, subdir), os.path.join(dst, subdir))

for f in ['pnpm-workspace.yaml', 'package.json', 'tsconfig.base.json',
          'tsconfig.json', 'pnpm-lock.yaml', '.gitignore']:
    fp = os.path.join(src, f)
    if os.path.exists(fp):
        shutil.copy2(fp, os.path.join(dst, f))

# Rewrite pnpm-workspace.yaml so it only lists packages that exist in the
# mini-repo.
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
echo "  Symlinked workspace + cashclip node_modules for plugin resolution"

# ── Step 3: Git commit ───────────────────────────────────────────────────────
echo ""
echo "── Step 3: Init git in mini-repo ──"

export GIT_PAGER=cat
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="safe.directory"
export GIT_CONFIG_VALUE_0="*"

cd "$MINI"
git init
git config user.email "support@absustaininvest.com"
git config user.name "AB Sustainability Investments"
git add -A
VERSION_CODE="$(python3 -c "import json; print(json.load(open('artifacts/cashclip/app.json'))['expo']['android']['versionCode'])")"
git --no-pager commit --quiet -m "eas build android vc$VERSION_CODE"
echo "  committed $(git rev-list --count HEAD) commit(s), $(git ls-files | wc -l) files"

# ── Step 4: EAS Build ────────────────────────────────────────────────────────
echo ""
echo "── Step 4: EAS Build (Android production) ──"

NODE_DIR="$(dirname "$(which node 2>/dev/null || echo "/usr/bin/node")")"
export PATH="$NODE_DIR:$PATH"
echo "  node: $(which node) ($(node --version))"

cd "$MINI/artifacts/cashclip"
EAS_BIN="$(which eas 2>/dev/null || echo "$HOME/.config/npm/node_global/bin/eas")"
echo "  Using EAS CLI: $EAS_BIN ($($EAS_BIN --version 2>/dev/null | head -1))"

EXPO_TOKEN="${EXPO_TOKEN:-}" \
EAS_SKIP_AUTO_FINGERPRINT=1 \
"$EAS_BIN" build \
  --platform android \
  --profile production \
  --non-interactive \
  --clear-cache \
  2>&1

echo ""
echo "================================================"
echo "  Android build complete!"
echo "  Download AAB from: https://expo.dev"
echo "  Submit to Play Store via: eas submit --platform android --profile production --latest"
echo "================================================"
