#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${KORBIT_BUILD_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
OUTPUT_DIR="${KORBIT_BUILD_OUTPUT_DIR:-${ROOT_DIR}/uploads/releases}"
APP_URL="${KORBIT_APP_URL:-${KORBIT_PUBLIC_WEB_URL:-http://localhost:3000}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_PATH="${OUTPUT_DIR}/korbit-windows-${STAMP}.exe"

mkdir -p "${OUTPUT_DIR}"

if command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -e "KORBIT_APP_URL=${APP_URL}" \
    -v "${ROOT_DIR}:/project" \
    -w /project \
    electronuserland/builder:wine \
    /bin/bash -lc "corepack enable && corepack pnpm install --filter @korbit/korbit-desktop... --no-frozen-lockfile && corepack pnpm --filter @korbit/korbit-desktop run build:win"
else
  export KORBIT_APP_URL="${APP_URL}"
  cd "${ROOT_DIR}"
  corepack pnpm install --filter @korbit/korbit-desktop... --no-frozen-lockfile
  corepack pnpm --filter @korbit/korbit-desktop run build:win
fi

SOURCE_EXE="$(ls -1t "${ROOT_DIR}"/apps/korbit-desktop/dist/*.exe | head -n 1 || true)"
if [[ -z "${SOURCE_EXE}" || ! -f "${SOURCE_EXE}" ]]; then
  echo "Failed to find built EXE artifact" >&2
  exit 1
fi

cp "${SOURCE_EXE}" "${TARGET_PATH}"
echo "ARTIFACT_PATH=${TARGET_PATH}"
