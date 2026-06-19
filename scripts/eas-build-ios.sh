#!/usr/bin/env bash
set -euo pipefail

# ── Safety guard ─────────────────────────────────────────────────────────────
# Require EAS_BUILD_CONFIRMED=1 to prevent accidental re-runs when Replit
# auto-restarts this workflow. Set this in the workflow command or env to run.
if [ "${EAS_BUILD_CONFIRMED:-0}" != "1" ]; then
  echo "================================================"
  echo "  EAS iOS Build — WAITING FOR CONFIRMATION"
  echo "================================================"
  echo ""
  echo "  This workflow requires EAS_BUILD_CONFIRMED=1 to run."
  echo "  Set it in the workflow command to proceed:"
  echo "    EAS_BUILD_CONFIRMED=1 bash scripts/eas-build-ios.sh"
  echo ""
  echo "  Sleeping indefinitely to prevent duplicate builds..."
  sleep infinity
fi

echo "================================================"
echo "  CashClip EAS iOS Build — $(date)"
echo "================================================"

# ── SSL-pin pre-flight ────────────────────────────────────────────────────────
# Verify the live cash-clip.app SPKI hash still matches the PRIMARY pin baked
# into plugins/withSslPinning.js.  A mismatch means the server key rotated and
# shipping this build would lock all users out of the API.
#
# Exit-code semantics from verify-spki-hash.sh:
#   0  — Pin matches (or network failure with --allow-network-failure)
#   1  — Hash MISMATCH — hard fail, build blocked, cannot be skipped
#   2  — Network unreachable — soft fail unless --allow-network-failure is set
#   3  — Configuration error (missing plugin file, unparseable pin, etc.)
#
# To allow a build in a sandboxed CI environment where cash-clip.app is
# intentionally unreachable, set SSL_ALLOW_NETWORK_FAILURE=1 in the build
# environment (Replit secret or EAS env var).  This forwards --allow-network-failure
# to the check script, which exits 0 with a WARNING instead of blocking.
# A confirmed hash mismatch (exit 1) is ALWAYS a hard failure — the flag
# cannot bypass it.
echo ""
echo "── SSL pin pre-flight ──"
SPKI_FLAGS=()
if [ "${SSL_ALLOW_NETWORK_FAILURE:-0}" = "1" ]; then
  SPKI_FLAGS+=("--allow-network-failure")
  echo "  SSL_ALLOW_NETWORK_FAILURE=1 — network failures will warn but not block."
fi
SPKI_EXIT=0
bash "$(dirname "$0")/verify-spki-hash.sh" "${SPKI_FLAGS[@]}" || SPKI_EXIT=$?
if [ "$SPKI_EXIT" = "0" ]; then
  echo "  SSL pin OK — continuing build."
elif [ "$SPKI_EXIT" = "1" ]; then
  echo ""
  echo "  ✗ SSL pin MISMATCH. Update plugins/withSslPinning.js before building."
  echo "    This failure cannot be bypassed."
  exit 1
elif [ "$SPKI_EXIT" = "2" ]; then
  echo ""
  echo "  ✗ SSL pin check could not reach cash-clip.app (network failure)."
  echo "    Set SSL_ALLOW_NETWORK_FAILURE=1 to skip in sandboxed CI environments."
  echo "    A real hash mismatch would still block the build even with that flag."
  exit 1
else
  echo ""
  echo "  ✗ SSL pin check failed (configuration error, exit $SPKI_EXIT)."
  echo "    Check that plugins/withSslPinning.js exists and contains a PRIMARY pin."
  exit 1
fi

EXPO_TOKEN="${EXPO_TOKEN:-${EXPO_TOKLAST:-}}"
if [ -z "$EXPO_TOKEN" ]; then
  echo "WARNING: EXPO_TOKEN/EXPO_TOKLAST not found in shell environment — EAS CLI will attempt its own auth."
fi

WORKSPACE="$(cd "$(dirname "$0")/.." && pwd)"
CASHCLIP_SRC="$WORKSPACE/artifacts/cashclip"
MINI="$HOME/cashclip-mini"

echo ""
echo "→ Workspace:    $WORKSPACE"
echo "→ Mini-repo:    $MINI"
echo "→ Build number: $(python3 -c "import json; print(json.load(open('$CASHCLIP_SRC/app.json'))['expo']['ios']['buildNumber'])")"
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

# Symlink both node_modules levels so EAS CLI can resolve plugins locally:
#   1. workspace root → covers shared/hoisted packages and .pnpm virtual store
#   2. cashclip-level → covers app-specific deps (expo-tracking-transparency, etc.)
ln -sf "$WORKSPACE/node_modules" "$MINI/node_modules"
ln -sf "$WORKSPACE/artifacts/cashclip/node_modules" "$MINI/artifacts/cashclip/node_modules"
echo "  Symlinked workspace + cashclip node_modules for plugin resolution"

# ── Step 3: Git commit ───────────────────────────────────────────────────────
echo ""
echo "── Step 3: Init git in mini-repo ──"

# Disable pager for ALL git operations in this script
export GIT_PAGER=cat
# Pass safe.directory — avoids writing to .gitconfig (quota)
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="safe.directory"
export GIT_CONFIG_VALUE_0="*"

cd "$MINI"
git init
git config user.email "support@absustaininvest.com"
git config user.name "AB Sustainability Investments"
git add -A
BUILD_NUM="$(python3 -c "import json; print(json.load(open('artifacts/cashclip/app.json'))['expo']['ios']['buildNumber'])")"
git --no-pager commit --quiet -m "eas build $BUILD_NUM"
echo "  committed $(git rev-list --count HEAD) commit(s), $(git ls-files | wc -l) files"

# ── Step 4: EAS Build ────────────────────────────────────────────────────────
echo ""
echo "── Step 4: EAS Build (iOS production) ──"

NODE_DIR="$(dirname "$(which node 2>/dev/null || echo "/usr/bin/node")")"
export PATH="$NODE_DIR:$PATH"
echo "  node: $(which node) ($(node --version))"

cd "$MINI/artifacts/cashclip"
EAS_BIN="$(which eas 2>/dev/null || echo "$HOME/.config/npm/node_global/bin/eas")"
echo "  Using EAS CLI: $EAS_BIN ($($EAS_BIN --version 2>/dev/null | head -1))"
# EAS_SKIP_AUTO_FINGERPRINT=1 works around a crash in eas-cli@18.11.0 where
# brace-expansion v5.0.5 is called as a function. Remove once eas-cli is
# upgraded past the fix (tracked in brace-expansion@5.0.6 / eas-cli@18.13+).
EXPO_TOKEN="${EXPO_TOKEN:-}" EAS_SKIP_AUTO_FINGERPRINT=1 "$EAS_BIN" build \
  --platform ios \
  --profile production \
  --non-interactive \
  --clear-cache \
  2>&1

echo ""
echo "── Step 5: Submit to App Store ──"

if [ -z "${EXPO_APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
  echo "  WARNING: EXPO_APPLE_APP_SPECIFIC_PASSWORD not set — skipping auto-submit."
  echo "  Set the secret and re-run to enable automatic App Store submission."
else
  echo "  Submitting latest iOS build to App Store Connect..."
  EXPO_TOKEN="${EXPO_TOKEN:-${EXPO_TOKLAST:-}}" \
  EXPO_APPLE_APP_SPECIFIC_PASSWORD="${EXPO_APPLE_APP_SPECIFIC_PASSWORD:-}" \
  "$EAS_BIN" submit \
    --platform ios \
    --profile production \
    --latest \
    --non-interactive \
    2>&1
  echo ""
  echo "================================================"
  echo "  iOS build submitted to App Store Connect!"
  echo "  Check status: App Store Connect → CashClip → TestFlight / Releases"
  echo "================================================"
fi
