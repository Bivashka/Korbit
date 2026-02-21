#!/usr/bin/env bash
set -Eeuo pipefail

resolve_root_dir() {
  if [[ -n "${KORBIT_BUILD_ROOT:-}" ]]; then
    echo "${KORBIT_BUILD_ROOT}"
    return
  fi

  local script_root
  script_root="$(cd "$(dirname "$0")/../.." && pwd)"
  if [[ -f "${script_root}/pnpm-workspace.yaml" ]]; then
    echo "${script_root}"
    return
  fi

  if [[ -f "/opt/korbit/pnpm-workspace.yaml" ]]; then
    echo "/opt/korbit"
    return
  fi

  echo "${script_root}"
}

ROOT_DIR="$(resolve_root_dir)"
MOBILE_DIR="${ROOT_DIR}/apps/korbit-mobile"
OUTPUT_DIR="${KORBIT_BUILD_OUTPUT_DIR:-${ROOT_DIR}/uploads/releases}"
APP_URL="${KORBIT_APP_URL:-${KORBIT_PUBLIC_WEB_URL:-http://localhost:3000}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_PATH="${OUTPUT_DIR}/korbit-android-${STAMP}.apk"

mkdir -p "${OUTPUT_DIR}"

if [[ ! -f "${ROOT_DIR}/pnpm-workspace.yaml" ]]; then
  echo "Workspace root is invalid: ${ROOT_DIR}. Set KORBIT_BUILD_ROOT to mounted repository path." >&2
  exit 1
fi

if [[ ! -f "${MOBILE_DIR}/package.json" ]]; then
  echo "Mobile app sources are missing at ${MOBILE_DIR}" >&2
  exit 1
fi

cd "${ROOT_DIR}"
export CI=1
corepack pnpm install --prod=false --no-frozen-lockfile --config.confirmModulesPurge=false

if [[ ! -d "${MOBILE_DIR}/android" ]]; then
  KORBIT_APP_URL="${APP_URL}" corepack pnpm --filter ./apps/korbit-mobile exec cap add android
fi
KORBIT_APP_URL="${APP_URL}" corepack pnpm --filter ./apps/korbit-mobile exec cap sync android

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command is required for Android build" >&2
  exit 1
fi

docker run --rm \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace/apps/korbit-mobile/android \
  -e GRADLE_USER_HOME=/workspace/.gradle \
  mingc/android-build-box:latest \
  /bin/bash -lc "chmod +x ./gradlew || true; bash ./gradlew assembleDebug"

SOURCE_APK="${MOBILE_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "${SOURCE_APK}" ]]; then
  echo "Failed to find built APK artifact" >&2
  exit 1
fi

cp "${SOURCE_APK}" "${TARGET_PATH}"
echo "ARTIFACT_PATH=${TARGET_PATH}"
