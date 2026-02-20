#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${KORBIT_INSTALL_DIR:-/opt/korbit}"
ENV_FILE="${INSTALL_DIR}/.env.vps"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.vps.yml"

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  echo "[korbit-update][error] ${INSTALL_DIR} is not a git repository" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[korbit-update][error] Missing ${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "[korbit-update][error] Missing ${COMPOSE_FILE}" >&2
  exit 1
fi

if docker info >/dev/null 2>&1; then
  DOCKER_CMD=(docker)
elif command -v sudo >/dev/null 2>&1; then
  DOCKER_CMD=(sudo docker)
else
  echo "[korbit-update][error] Docker daemon is not reachable" >&2
  exit 1
fi

git -C "${INSTALL_DIR}" fetch origin main --prune
git -C "${INSTALL_DIR}" checkout main
git -C "${INSTALL_DIR}" pull --ff-only origin main

"${DOCKER_CMD[@]}" compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build

echo "[korbit-update] Done"

