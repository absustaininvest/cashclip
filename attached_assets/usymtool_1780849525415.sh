#!/bin/bash
set -euo pipefail

# =============================================================================
# usymtool.sh - Upload Unity debug symbols (macOS Host)
#
# Supports: ios, macos, android
# For a WindowsHost , use usymtool.ps1
# =============================================================================

# █████████████████████████████████████████████████████████████████████████████
# █  USER CONFIGURATION - Set these values before running                    █
# █████████████████████████████████████████████████████████████████████████████

# Platform to upload symbols for (ios, macos, android)
PLATFORM="macos"

# Set to true if your build uses the IL2CPP scripting backend.
# Enables C# line numbers in exception reports.
USE_IL2CPP=true

# Unity project ID (from Unity Dashboard)
# Example: "12345678-abcd-1234-5678-12345678abcd"
UNITY_PROJECT_ID="<your-unity-project-id>"

# Service account auth header (from Unity Dashboard > Service Accounts)
# Example: "Basic dXNlcm5hbWU6cGFzc3dvcmQ="
UNITY_SERVICE_ACCOUNT_AUTH_HEADER="<your-service-account-auth-header>"

# Path to the Unity Editor installation
UNITY_EDITOR_PATH="/Applications/Unity/Hub/Editor/6000.3.10f1"

# Path to the Unity project
# Example: "/Users/yourname/UnityProjects/MyGame"
UNITY_PROJECT_PATH="<your-unity-project-path>"

# Path to the build output directory
# For iOS, this is the Xcode project export path.
# For macOS/Windows, this is the folder containing the built app.
# Not needed for Android (leave blank).
# Example: "/Users/yourname/UnityProjects/MyGame/Build"
BUILD_OUTPUT_PATH="<your-build-output-path>"

# Name of the build (used to locate the _BackUpThisFolder directory)
# For macOS/Windows, this is typically the product name.
# For iOS, this is the Xcode project folder name.
# Not needed for Android (leave blank).
# Example: "MyGame"
BUILD_NAME="<your-build-name>"

# [iOS only] Path to the Xcode build products directory containing .dSYM bundles
# (ignored for other platforms)
# Example: "/Users/yourname/Library/Developer/Xcode/DerivedData/Unity-iPhone-xxxxx/Build/Products/ReleaseForRunning-iphoneos/"
IOS_BUILD_PRODUCTS_PATH="<your-xcode-build-products-path>"

# █████████████████████████████████████████████████████████████████████████████
# █  ADVANCED - You should not normally need to change anything below        █
# █████████████████████████████████████████████████████████████████████████████

# Override any derived path (leave empty to use platform defaults)
USYMTOOL_PATH_OVERRIDE=""
SYMBOL_PATH_OVERRIDE=""
IL2CPP_OUTPUT_PATH_OVERRIDE=""
IL2CPP_FILE_ROOT_OVERRIDE=""
LOG_PATH_OVERRIDE=""
FILTER_OVERRIDE=""

# Service URLs
USYM_UPLOAD_AUTH_TOKEN_URL="https://services.unity.com/api/cloud-diagnostics/crash-service/v1/projects"
USYM_UPLOAD_URL_SOURCE="https://perf-events.cloud.unity3d.com/url"

# =============================================================================
# Derive platform-specific defaults
# =============================================================================
BACKUP_FOLDER="${BUILD_OUTPUT_PATH}/${BUILD_NAME}_BackUpThisFolder_ButDontShipItWithYourGame"

case "${PLATFORM}" in
  ios)
    DEFAULT_USYMTOOL_PATH="${BUILD_OUTPUT_PATH}/usymtoolarm64"
    DEFAULT_SYMBOL_PATH="${IOS_BUILD_PRODUCTS_PATH}"
    DEFAULT_IL2CPP_OUTPUT_PATH="${BUILD_OUTPUT_PATH}/Il2CppOutputProject/Source/il2cppOutput"
    DEFAULT_IL2CPP_FILE_ROOT="${BUILD_OUTPUT_PATH}/Il2CppOutputProject/Source/il2cppOutput"
    DEFAULT_LOG_PATH=""
    DEFAULT_FILTER="\.dSYM"
    ;;
  macos)
    DEFAULT_USYMTOOL_PATH="${UNITY_EDITOR_PATH}/Unity.app/Contents/Helpers/usymtoolarm64"
    DEFAULT_SYMBOL_PATH="${BACKUP_FOLDER}/GameAssembly.dSYM"
    DEFAULT_IL2CPP_OUTPUT_PATH="${BACKUP_FOLDER}/il2cppOutput/"
    DEFAULT_IL2CPP_FILE_ROOT="${UNITY_PROJECT_PATH}/Library/Bee/artifacts/MacStandalonePlayerBuildProgram/il2cppOutput/cpp"
    DEFAULT_LOG_PATH="${HOME}/Library/Logs/Unity/symbol_upload.log"
    DEFAULT_FILTER=""
    ;;
  android)
    DEFAULT_USYMTOOL_PATH="${UNITY_EDITOR_PATH}/Unity.app/Contents/Helpers/usymtoolarm64"
    DEFAULT_SYMBOL_PATH="${UNITY_PROJECT_PATH}/Library/Bee/Android/Prj/IL2CPP/Gradle/unityLibrary/symbols"
    DEFAULT_IL2CPP_OUTPUT_PATH="${UNITY_PROJECT_PATH}/Library/Bee/Android/Prj/IL2CPP/Gradle/../Il2CppBackup/il2cppOutput"
    DEFAULT_IL2CPP_FILE_ROOT="${UNITY_PROJECT_PATH}/Library/Bee/artifacts/Android/il2cppOutput/cpp"
    DEFAULT_LOG_PATH="${HOME}/Library/Logs/Unity/symbol_upload.log"
    DEFAULT_FILTER=""
    ;;
  *)
    echo "ERROR: Unknown PLATFORM '${PLATFORM}'. Must be one of: ios, macos, android" >&2
    echo "       For Windows, use usymtool.ps1" >&2
    exit 1
    ;;
esac

# Apply overrides (use override if set, otherwise use default)
USYMTOOL_PATH="${USYMTOOL_PATH_OVERRIDE:-$DEFAULT_USYMTOOL_PATH}"
SYMBOL_PATH="${SYMBOL_PATH_OVERRIDE:-$DEFAULT_SYMBOL_PATH}"
IL2CPP_OUTPUT_PATH="${IL2CPP_OUTPUT_PATH_OVERRIDE:-$DEFAULT_IL2CPP_OUTPUT_PATH}"
IL2CPP_FILE_ROOT="${IL2CPP_FILE_ROOT_OVERRIDE:-$DEFAULT_IL2CPP_FILE_ROOT}"
LOG_PATH="${LOG_PATH_OVERRIDE:-$DEFAULT_LOG_PATH}"
FILTER="${FILTER_OVERRIDE:-$DEFAULT_FILTER}"

# =============================================================================
# Validate paths
# =============================================================================
ERRORS=()
[[ ! -f "${USYMTOOL_PATH}" ]] && ERRORS+=("usymtool not found at: ${USYMTOOL_PATH}")
[[ ! -e "${SYMBOL_PATH}" ]] && ERRORS+=("Symbol path not found: ${SYMBOL_PATH}")
if [[ "${USE_IL2CPP}" == true ]]; then
  [[ ! -d "${IL2CPP_OUTPUT_PATH}" ]] && ERRORS+=("IL2CPP output path not found: ${IL2CPP_OUTPUT_PATH}")
  if [[ -n "${IL2CPP_FILE_ROOT}" && ! -d "${IL2CPP_FILE_ROOT}" ]]; then
    ERRORS+=("IL2CPP file root not found: ${IL2CPP_FILE_ROOT}")
  fi
fi

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo "ERROR: Path validation failed:" >&2
  for err in "${ERRORS[@]}"; do
    echo "  - ${err}" >&2
  done
  exit 1
fi

# =============================================================================
# Fetch auth token
# =============================================================================
echo "Fetching auth token for project ${UNITY_PROJECT_ID}..."
RESPONSE=$(curl --silent --fail --location "${USYM_UPLOAD_AUTH_TOKEN_URL}/${UNITY_PROJECT_ID}/symbols/token" \
  --header "Authorization: ${UNITY_SERVICE_ACCOUNT_AUTH_HEADER}") || {
  echo "ERROR: curl request failed. Check project ID and auth header." >&2
  exit 1
}

USYM_UPLOAD_AUTH_TOKEN=$(echo "${RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin)['AuthToken'])") || {
  echo "ERROR: Failed to extract AuthToken from response: ${RESPONSE}" >&2
  exit 1
}

echo "Auth token acquired successfully."

# =============================================================================
# Build and run usymtool command
# =============================================================================
export USYM_UPLOAD_AUTH_TOKEN
export USYM_UPLOAD_URL_SOURCE
# Unity 6.2 and earlier: usymtool shells out to an external lzma binary for compression.
# Without this, GNU lzma (from xz-utils) may shadow Unity's bundled LZMA SDK and fail.
# Unity 6.3+ uses built-in gzip compression and ignores LZMA_PATH.
export LZMA_PATH="${UNITY_EDITOR_PATH}/Unity.app/Contents/Tools/macosx/lzma"

CMD=("${USYMTOOL_PATH}" -symbolPath "${SYMBOL_PATH}")

[[ -n "${LOG_PATH}" ]] && CMD+=(-log "${LOG_PATH}")
[[ -n "${FILTER}" ]] && CMD+=(-filter "${FILTER}")
if [[ "${USE_IL2CPP}" == true ]]; then
  CMD+=(-il2cppOutputPath "${IL2CPP_OUTPUT_PATH}")
  [[ -n "${IL2CPP_FILE_ROOT}" ]] && CMD+=(-il2cppFileRoot "${IL2CPP_FILE_ROOT}")
fi

echo ""
echo "Running usymtool (${PLATFORM}):"
echo "  ${CMD[*]}"
echo ""

"${CMD[@]}"
