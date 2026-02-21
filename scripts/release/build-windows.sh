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
OUTPUT_DIR="${KORBIT_BUILD_OUTPUT_DIR:-${ROOT_DIR}/uploads/releases}"
APP_URL="${KORBIT_APP_URL:-${KORBIT_PUBLIC_WEB_URL:-http://localhost:3000}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_PATH="${OUTPUT_DIR}/korbit-windows-${STAMP}.exe"
RUNTIME_URL_PATH="${ROOT_DIR}/apps/korbit-desktop/src/runtime-url.txt"

mkdir -p "${OUTPUT_DIR}"

if [[ ! -f "${ROOT_DIR}/pnpm-workspace.yaml" ]]; then
  echo "Workspace root is invalid: ${ROOT_DIR}. Set KORBIT_BUILD_ROOT to mounted repository path." >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/apps/korbit-desktop/package.json" ]]; then
  echo "Desktop app sources are missing at ${ROOT_DIR}/apps/korbit-desktop" >&2
  exit 1
fi

printf '%s\n' "${APP_URL}" > "${RUNTIME_URL_PATH}"

if command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -e CI=1 \
    -e "KORBIT_APP_URL=${APP_URL}" \
    -v "${ROOT_DIR}:/project" \
    -w /project \
    electronuserland/builder:wine \
    /bin/bash -lc "corepack enable && corepack pnpm install --prod=false --no-frozen-lockfile --config.confirmModulesPurge=false && corepack pnpm --filter @korbit/korbit-desktop run build:win"
else
  export CI=1
  export KORBIT_APP_URL="${APP_URL}"
  cd "${ROOT_DIR}"
  corepack pnpm install --prod=false --no-frozen-lockfile --config.confirmModulesPurge=false
  corepack pnpm --filter @korbit/korbit-desktop run build:win
fi

SOURCE_EXE="$(ls -1t "${ROOT_DIR}"/apps/korbit-desktop/dist/*.exe | head -n 1 || true)"
if [[ -z "${SOURCE_EXE}" || ! -f "${SOURCE_EXE}" ]]; then
  echo "Failed to find built EXE artifact" >&2
  exit 1
fi

cp "${SOURCE_EXE}" "${TARGET_PATH}"
echo "ARTIFACT_PATH=${TARGET_PATH}"
