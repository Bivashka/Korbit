# Korbit VPS Install

## Fastest way (one command)

Run on your Ubuntu VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/Bivashka/Korbit/main/scripts/vps/one-click.sh | bash
```

What this does automatically:
- installs Docker, Nginx, and required packages
- clones or updates `Korbit` in `/opt/korbit`
- creates `.env.vps` with generated secrets/passwords
- builds and starts `postgres`, `redis`, `api`, `web`
- configures Nginx reverse proxy (`/` -> web, `/api` -> api)
- prints URL and admin credentials at the end

Notes:
- safe with existing Docker apps: Korbit Postgres is internal (no published DB port)
- default host is VPS public IP over HTTP

## Optional custom run

Use your own domain and automatic TLS:

```bash
curl -fsSL https://raw.githubusercontent.com/Bivashka/Korbit/main/scripts/vps/one-click.sh | \
env KORBIT_HOST=chat.example.com \
    KORBIT_ENABLE_SSL=true \
    KORBIT_LETSENCRYPT_EMAIL=admin@example.com \
    bash
```

Optional variables:
- `KORBIT_REPO_URL` (default `https://github.com/Bivashka/Korbit.git`)
- `KORBIT_INSTALL_DIR` (default `/opt/korbit`)
- `KORBIT_REGISTRATION_MODE` (default `invite`)
- `KORBIT_ADMIN_USERNAME` (default `admin`)
- `KORBIT_ADMIN_PASSWORD` (if omitted, auto-generated)
- `KORBIT_IP_SSL_DOMAIN` (default `traefik.me`, preferred zone when SSL is enabled and host is IP)
- `KORBIT_IP_SSL_DOMAIN_FALLBACKS` (default `traefik.me,nip.io,sslip.io`)
- `KORBIT_ENABLE_TUNNEL_ON_HTTP_FALLBACK` (default `true`)
- `KORBIT_BUILD_ROOT_HOST` (default `/opt/korbit`, host path for build workspace)
- `KORBIT_BUILD_ROOT_CONTAINER` (default `/opt/korbit`, same path mounted into api container)

If you only have an IP and no domain:

```bash
curl -fsSL https://raw.githubusercontent.com/Bivashka/Korbit/main/scripts/vps/one-click.sh | \
env KORBIT_ENABLE_SSL=true bash
```

In this mode the script automatically uses `<PUBLIC_IP>.traefik.me` for Let's Encrypt.
If one zone is rate-limited, script retries other zones from `KORBIT_IP_SSL_DOMAIN_FALLBACKS`.
If all zones are rate-limited, script falls back to HTTP on IP and auto-starts Cloudflare
Quick Tunnel, then prints `HTTPS Tunnel URL`.

## Check service state

```bash
cd /opt/korbit
docker compose --env-file .env.vps -f docker-compose.vps.yml ps
curl http://127.0.0.1:4000/health
```

If `api` is unhealthy:

```bash
cd /opt/korbit
docker compose --env-file .env.vps -f docker-compose.vps.yml logs --tail=200 api
docker compose --env-file .env.vps -f docker-compose.vps.yml ps
```

## Update later

```bash
curl -fsSL https://raw.githubusercontent.com/Bivashka/Korbit/main/scripts/vps/update.sh | bash
```

or:

```bash
cd /opt/korbit
bash scripts/vps/update.sh
```

## Logs

```bash
cd /opt/korbit
docker compose --env-file .env.vps -f docker-compose.vps.yml logs -f api
docker compose --env-file .env.vps -f docker-compose.vps.yml logs -f web
```

## Client Builds (admin account)

After login as admin in the web app, sidebar has a `Builds` block:
- `Build Windows`
- `Build Android`

Generated files are available for download in the same block.

Manual build (VPS shell):

```bash
cd /opt/korbit
docker compose --env-file .env.vps -f docker-compose.vps.yml exec api sh scripts/release/build-windows.sh
docker compose --env-file .env.vps -f docker-compose.vps.yml exec api sh scripts/release/build-android.sh
```

Detailed notes:
- `docs/client-builds.md`
