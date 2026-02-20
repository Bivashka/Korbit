#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_NAME="korbit-one-click"
REPO_URL="${KORBIT_REPO_URL:-https://github.com/Bivashka/Korbit.git}"
INSTALL_DIR="${KORBIT_INSTALL_DIR:-/opt/korbit}"
REGISTRATION_MODE="${KORBIT_REGISTRATION_MODE:-invite}"
HOST="${KORBIT_HOST:-}"
ENABLE_SSL="${KORBIT_ENABLE_SSL:-false}"
LETSENCRYPT_EMAIL="${KORBIT_LETSENCRYPT_EMAIL:-}"
ADMIN_USERNAME="${KORBIT_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${KORBIT_ADMIN_PASSWORD:-}"

log() {
  printf '[%s] %s\n' "${SCRIPT_NAME}" "$*"
}

warn() {
  printf '[%s][warn] %s\n' "${SCRIPT_NAME}" "$*" >&2
}

die() {
  printf '[%s][error] %s\n' "${SCRIPT_NAME}" "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  SUDO=""
else
  if ! command_exists sudo; then
    die "sudo is required when running as non-root user"
  fi
  SUDO="sudo"
fi

run_root() {
  if [[ -n "${SUDO}" ]]; then
    "${SUDO}" "$@"
  else
    "$@"
  fi
}

is_ipv4() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

detect_public_ip() {
  local ip
  for endpoint in "https://api.ipify.org" "https://ifconfig.me/ip"; do
    if ip="$(curl -fsSL --max-time 5 "${endpoint}" 2>/dev/null)"; then
      if [[ -n "${ip}" ]]; then
        echo "${ip}"
        return 0
      fi
    fi
  done

  ip="$(hostname -I | awk '{print $1}')"
  if [[ -n "${ip}" ]]; then
    echo "${ip}"
    return 0
  fi

  return 1
}

ensure_base_packages() {
  log "Installing base packages"
  run_root apt-get update -y
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl gnupg lsb-release git jq ufw nginx openssl
}

ensure_docker() {
  if ! command_exists docker; then
    log "Installing Docker"
    curl -fsSL https://get.docker.com | run_root sh
  fi

  run_root systemctl enable --now docker

  if ! docker compose version >/dev/null 2>&1; then
    run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin || true
  fi

  if ! docker compose version >/dev/null 2>&1; then
    die "docker compose plugin is not available"
  fi
}

resolve_docker_cmd() {
  if docker info >/dev/null 2>&1; then
    DOCKER_CMD=("docker")
  elif [[ -n "${SUDO}" ]]; then
    DOCKER_CMD=("sudo" "docker")
  else
    die "Docker daemon is not reachable"
  fi
}

clone_or_update_repo() {
  log "Preparing repository in ${INSTALL_DIR}"
  if [[ -d "${INSTALL_DIR}" && ! -d "${INSTALL_DIR}/.git" ]]; then
    die "${INSTALL_DIR} exists but is not a git repository"
  fi

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    git -C "${INSTALL_DIR}" fetch origin main --prune
    git -C "${INSTALL_DIR}" checkout main
    git -C "${INSTALL_DIR}" pull --ff-only origin main
    return 0
  fi

  run_root mkdir -p "$(dirname "${INSTALL_DIR}")"

  if git clone "${REPO_URL}" "${INSTALL_DIR}" >/dev/null 2>&1; then
    return 0
  fi

  run_root git clone "${REPO_URL}" "${INSTALL_DIR}"
  run_root chown -R "$(id -u):$(id -g)" "${INSTALL_DIR}" || true
}

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp

  tmp="$(mktemp)"
  awk -F= -v key="${key}" -v value="${value}" '
    BEGIN { updated=0 }
    $1 == key {
      print key "=" value
      updated=1
      next
    }
    { print $0 }
    END {
      if (!updated) print key "=" value
    }
  ' "${file}" > "${tmp}"
  mv "${tmp}" "${file}"
}

get_env_var() {
  local key="$1"
  local file="$2"
  grep -E "^${key}=" "${file}" | tail -n 1 | sed "s/^${key}=//"
}

generate_password() {
  local lower upper digits rest
  lower="$(tr -dc 'a-z' < /dev/urandom | head -c 8)"
  upper="$(tr -dc 'A-Z' < /dev/urandom | head -c 2)"
  digits="$(tr -dc '0-9' < /dev/urandom | head -c 2)"
  rest="$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 8)"
  echo "${lower}${upper}${digits}${rest}"
}

configure_env_file() {
  local env_file="${INSTALL_DIR}/.env.vps"
  local env_template="${INSTALL_DIR}/.env.vps.example"
  local scheme
  local current

  [[ -f "${env_template}" ]] || die "Missing template: ${env_template}"

  if [[ ! -f "${env_file}" ]]; then
    cp "${env_template}" "${env_file}"
  fi

  if [[ -z "${HOST}" ]]; then
    HOST="$(detect_public_ip)" || die "Cannot detect KORBIT_HOST automatically"
  fi

  if [[ "${ENABLE_SSL}" == "true" ]] && is_ipv4 "${HOST}"; then
    warn "KORBIT_ENABLE_SSL=true requires a domain. Falling back to HTTP because host is an IP."
    ENABLE_SSL="false"
  fi

  if [[ "${ENABLE_SSL}" == "true" ]]; then
    scheme="https"
  else
    scheme="http"
  fi

  set_env_var "POSTGRES_DB" "$(get_env_var POSTGRES_DB "${env_file}" || echo "korbit")" "${env_file}"
  set_env_var "POSTGRES_USER" "$(get_env_var POSTGRES_USER "${env_file}" || echo "korbit")" "${env_file}"

  current="$(get_env_var POSTGRES_PASSWORD "${env_file}" || true)"
  if [[ -z "${current}" || "${current}" == "CHANGE_ME_DB_PASSWORD" ]]; then
    set_env_var "POSTGRES_PASSWORD" "$(generate_password)" "${env_file}"
  fi

  current="$(get_env_var JWT_ACCESS_SECRET "${env_file}" || true)"
  if [[ -z "${current}" || "${current}" == "CHANGE_ME_ACCESS_SECRET" ]]; then
    set_env_var "JWT_ACCESS_SECRET" "$(openssl rand -hex 32)" "${env_file}"
  fi

  current="$(get_env_var JWT_REFRESH_SECRET "${env_file}" || true)"
  if [[ -z "${current}" || "${current}" == "CHANGE_ME_REFRESH_SECRET" ]]; then
    set_env_var "JWT_REFRESH_SECRET" "$(openssl rand -hex 32)" "${env_file}"
  fi

  set_env_var "JWT_ACCESS_TTL" "$(get_env_var JWT_ACCESS_TTL "${env_file}" || echo "900")" "${env_file}"
  set_env_var "JWT_REFRESH_TTL" "$(get_env_var JWT_REFRESH_TTL "${env_file}" || echo "2592000")" "${env_file}"
  set_env_var "REGISTRATION_MODE" "${REGISTRATION_MODE}" "${env_file}"
  set_env_var "ADMIN_BOOTSTRAP_ENABLED" "$(get_env_var ADMIN_BOOTSTRAP_ENABLED "${env_file}" || echo "true")" "${env_file}"
  set_env_var "ADMIN_USERNAME" "${ADMIN_USERNAME}" "${env_file}"

  current="$(get_env_var ADMIN_PASSWORD "${env_file}" || true)"
  if [[ -n "${ADMIN_PASSWORD}" ]]; then
    set_env_var "ADMIN_PASSWORD" "${ADMIN_PASSWORD}" "${env_file}"
  elif [[ -z "${current}" || "${current}" == "CHANGE_ME_ADMIN_PASSWORD" ]]; then
    set_env_var "ADMIN_PASSWORD" "$(generate_password)" "${env_file}"
  fi

  set_env_var "CORS_ORIGIN" "${scheme}://${HOST}" "${env_file}"
  set_env_var "NEXT_PUBLIC_API_URL" "${scheme}://${HOST}/api" "${env_file}"
  set_env_var "NEXT_PUBLIC_REGISTRATION_MODE" "${REGISTRATION_MODE}" "${env_file}"
}

setup_firewall() {
  if ! command_exists ufw; then
    return 0
  fi

  run_root ufw allow OpenSSH >/dev/null 2>&1 || true
  run_root ufw allow 80/tcp >/dev/null 2>&1 || true
  run_root ufw allow 443/tcp >/dev/null 2>&1 || true
}

deploy_stack() {
  local env_file="${INSTALL_DIR}/.env.vps"
  local compose_file="${INSTALL_DIR}/docker-compose.vps.yml"

  [[ -f "${compose_file}" ]] || die "Missing compose file: ${compose_file}"
  [[ -f "${env_file}" ]] || die "Missing env file: ${env_file}"

  log "Building and starting Korbit containers"
  "${DOCKER_CMD[@]}" compose --env-file "${env_file}" -f "${compose_file}" up -d --build
}

configure_nginx() {
  local nginx_file="/etc/nginx/sites-available/korbit"
  local server_name

  if is_ipv4 "${HOST}"; then
    server_name="${HOST} _"
  else
    server_name="${HOST}"
  fi

  log "Configuring Nginx reverse proxy"
  run_root tee "${nginx_file}" >/dev/null <<EOF
server {
    listen 80;
    server_name ${server_name};

    client_max_body_size 32m;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

  run_root ln -sf "${nginx_file}" /etc/nginx/sites-enabled/korbit
  run_root rm -f /etc/nginx/sites-enabled/default
  run_root nginx -t
  run_root systemctl enable --now nginx
  run_root systemctl reload nginx
}

enable_ssl_if_needed() {
  if [[ "${ENABLE_SSL}" != "true" ]]; then
    return 0
  fi

  if is_ipv4 "${HOST}"; then
    warn "Skipping SSL because host is an IP address"
    return 0
  fi

  if [[ -z "${LETSENCRYPT_EMAIL}" ]]; then
    LETSENCRYPT_EMAIL="admin@${HOST}"
  fi

  log "Installing Certbot and issuing TLS certificate for ${HOST}"
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx

  run_root certbot --nginx --non-interactive --agree-tos \
    --redirect -m "${LETSENCRYPT_EMAIL}" -d "${HOST}"
}

print_summary() {
  local env_file="${INSTALL_DIR}/.env.vps"
  local scheme
  local admin_user
  local admin_pass

  if [[ "${ENABLE_SSL}" == "true" ]] && ! is_ipv4 "${HOST}"; then
    scheme="https"
  else
    scheme="http"
  fi

  admin_user="$(get_env_var ADMIN_USERNAME "${env_file}")"
  admin_pass="$(get_env_var ADMIN_PASSWORD "${env_file}")"

  log "Health checks"
  curl -fsS http://127.0.0.1:4000/health >/dev/null
  curl -fsSI http://127.0.0.1/ >/dev/null

  printf '\n'
  printf 'Korbit deployed successfully.\n'
  printf 'Web URL: %s://%s\n' "${scheme}" "${HOST}"
  printf 'API URL: %s://%s/api\n' "${scheme}" "${HOST}"
  printf 'Admin username: %s\n' "${admin_user}"
  printf 'Admin password: %s\n' "${admin_pass}"
  printf '\n'
  printf 'Compose status command:\n'
  printf '  %s compose --env-file %s -f %s ps\n' "${DOCKER_CMD[*]}" "${INSTALL_DIR}/.env.vps" "${INSTALL_DIR}/docker-compose.vps.yml"
  printf '\n'
}

main() {
  [[ "$(uname -s)" == "Linux" ]] || die "This script supports Linux VPS only"
  command_exists apt-get || die "Only apt-based distributions are supported"

  ensure_base_packages
  ensure_docker
  resolve_docker_cmd
  clone_or_update_repo
  configure_env_file
  deploy_stack
  setup_firewall
  configure_nginx
  enable_ssl_if_needed
  print_summary
}

main "$@"
