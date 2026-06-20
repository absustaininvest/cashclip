#!/usr/bin/env bash
set -euo pipefail

# ── Safety guard ─────────────────────────────────────────────────────────────
# Require EAS_OTA_CONFIRMED=1 to prevent accidental fires when Replit
# auto-restarts this workflow. Set it in the workflow command to run.
if [ "${EAS_OTA_CONFIRMED:-0}" != "1" ]; then
  echo "================================================"
  echo "  EAS OTA Update — WAITING FOR CONFIRMATION"
  echo "================================================"
  echo ""
  echo "  This workflow requires EAS_OTA_CONFIRMED=1 to run."
  echo "  Set it in the workflow command to proceed:"
  echo "    EAS_OTA_CONFIRMED=1 EAS_OTA_MESSAGE='your message' bash scripts/eas-ota-update.sh"
  echo ""
  echo "  Sleeping indefinitely to prevent accidental publishes..."
  sleep infinity
fi

if [ -z "${EXPO_TOKEN:-}" ]; then
  echo "ERROR: EXPO_TOKEN is not set."
  exit 1
fi

MESSAGE="${EAS_OTA_MESSAGE:-OTA update}"
CHANNEL="${EAS_OTA_CHANNEL:-production}"
TARGET_RUNTIME="${EAS_OTA_TARGET_RUNTIME:-1.0.0}"
TARGET_VERSION="${EAS_OTA_TARGET_VERSION:-29}"
ROLLOUT_PHASE="${EAS_OTA_ROLLOUT_PHASE:-full}"
SUCCESS_THRESHOLD="${EAS_OTA_SUCCESS_THRESHOLD:-95}"

notify_rollout_monitor() {
  if [ -z "${EAS_OTA_MONITOR_URL:-}" ]; then
    return 0
  fi

  local stage="$1"
  local status="$2"

  echo "→ Reporting rollout stage '$stage' ($status) to monitor endpoint"
  python3 - <<'PY'
import json
import os
import sys
from urllib import request
from urllib.error import HTTPError

url = os.environ["EAS_OTA_MONITOR_URL"]
payload = {
  "service": "cashclip-ota",
  "stage": os.environ["MONITOR_STAGE"],
  "status": os.environ["MONITOR_STATUS"],
  "targetRuntime": os.environ["EAS_OTA_TARGET_RUNTIME"],
  "targetVersion": int(os.environ["EAS_OTA_TARGET_VERSION"]),
  "rolloutPhase": os.environ["EAS_OTA_ROLLOUT_PHASE"],
  "successThreshold": int(os.environ["EAS_OTA_SUCCESS_THRESHOLD"]),
}
req = request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
try:
  with request.urlopen(req, timeout=15) as resp:
    body = resp.read().decode("utf-8", "replace")
except HTTPError as err:
  body = err.read().decode("utf-8", "replace")
  print(f"Monitor endpoint returned HTTP {err.code}: {body}")
  sys.exit(1)
except Exception as err:  # noqa: BLE001
  print(f"Failed to reach monitor endpoint: {err}")
  sys.exit(1)

if body.strip():
  try:
    data = json.loads(body)
  except json.JSONDecodeError:
    data = None
  if isinstance(data, dict) and data.get("updatedPercent") is not None:
    updated = float(data["updatedPercent"])
    threshold = float(os.environ["EAS_OTA_SUCCESS_THRESHOLD"])
    if updated < threshold:
      print(f"Rollout below threshold: {updated}% < {threshold}%")
      sys.exit(1)
print("Monitor endpoint accepted rollout status")
PY
}

restart_stuck_agents() {
  if [ -z "${EAS_OTA_AGENT_RESTART_URL:-}" ]; then
    echo "→ No EAS_OTA_AGENT_RESTART_URL configured; skipping remote agent restart"
    return 0
  fi

  echo "→ Triggering stuck-agent fallback via restart endpoint"
  python3 - <<'PY'
import json
import os
import sys
from urllib import request
from urllib.error import HTTPError

url = os.environ["EAS_OTA_AGENT_RESTART_URL"]
payload = {
  "action": "restart-agent",
  "reason": "ota-strangled-fig-remediation",
  "targetRuntime": os.environ["EAS_OTA_TARGET_RUNTIME"],
  "targetVersion": int(os.environ["EAS_OTA_TARGET_VERSION"]),
}
req = request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
try:
  with request.urlopen(req, timeout=20) as resp:
    print(f"Fallback restart endpoint responded with HTTP {resp.status}")
except HTTPError as err:
  detail = err.read().decode("utf-8", "replace")
  print(f"Fallback restart endpoint failed with HTTP {err.code}: {detail}")
  sys.exit(1)
except Exception as err:  # noqa: BLE001
  print(f"Failed to call fallback restart endpoint: {err}")
  sys.exit(1)
PY
}

export EAS_OTA_TARGET_RUNTIME="$TARGET_RUNTIME"
export EAS_OTA_TARGET_VERSION="$TARGET_VERSION"
export EAS_OTA_ROLLOUT_PHASE="$ROLLOUT_PHASE"
export EAS_OTA_SUCCESS_THRESHOLD="$SUCCESS_THRESHOLD"

echo "================================================"
echo "  CashClip EAS OTA Update — $(date)"
echo "  Channel: $CHANNEL"
echo "  Message: $MESSAGE"
echo "  Rollout phase: $ROLLOUT_PHASE"
echo "  Target filter: runtime=$TARGET_RUNTIME, version=$TARGET_VERSION"
echo "================================================"

MONITOR_STAGE="preflight" MONITOR_STATUS="starting" notify_rollout_monitor "preflight" "starting"

cd artifacts/cashclip
EXPO_TOKEN="$EXPO_TOKEN" eas update \
  --channel "$CHANNEL" \
  --message "$MESSAGE | target runtime=$TARGET_RUNTIME version=$TARGET_VERSION | phase=$ROLLOUT_PHASE" \
  --non-interactive

cd ../..
MONITOR_STAGE="post-publish" MONITOR_STATUS="published" notify_rollout_monitor "post-publish" "published"

if [ "${EAS_OTA_FORCE_AGENT_RESTART:-0}" = "1" ]; then
  restart_stuck_agents
  MONITOR_STAGE="fallback" MONITOR_STATUS="agent-restarted" notify_rollout_monitor "fallback" "agent-restarted"
fi

echo ""
echo "================================================"
echo "  OTA update published successfully!"
echo "  Rollback plan (manual): re-publish last known good commit on channel '$CHANNEL'"
echo "================================================"
