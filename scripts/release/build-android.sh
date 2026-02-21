#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${KORBIT_BUILD_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
MOBILE_DIR="${ROOT_DIR}/apps/korbit-mobile"
OUTPUT_DIR="${KORBIT_BUILD_OUTPUT_DIR:-${ROOT_DIR}/uploads/releases}"
APP_URL="${KORBIT_APP_URL:-${KORBIT_PUBLIC_WEB_URL:-http://localhost:3000}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_PATH="${OUTPUT_DIR}/korbit-android-${STAMP}.apk"

mkdir -p "${OUTPUT_DIR}"

cd "${ROOT_DIR}"
corepack pnpm install --filter @korbit/korbit-mobile... --no-frozen-lockfile

if [[ ! -d "${MOBILE_DIR}/android" ]]; then
  KORBIT_APP_URL="${APP_URL}" corepack pnpm --filter @korbit/korbit-mobile exec cap add android
fi
KORBIT_APP_URL="${APP_URL}" corepack pnpm --filter @korbit/korbit-mobile exec cap sync android

docker run --rm \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace/apps/korbit-mobile/android \
  -e GRADLE_USER_HOME=/workspace/.gradle \
  mingc/android-build-box:latest \
  ./gradlew assembleDebug

SOURCE_APK="${MOBILE_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "${SOURCE_APK}" ]]; then
  echo "Failed to find built APK artifact" >&2
  exit 1
fi

cp "${SOURCE_APK}" "${TARGET_PATH}"
echo "ARTIFACT_PATH=${TARGET_PATH}"
