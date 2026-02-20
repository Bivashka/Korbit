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

If you only have an IP and no domain:

```bash
curl -fsSL https://raw.githubusercontent.com/Bivashka/Korbit/main/scripts/vps/one-click.sh | \
env KORBIT_ENABLE_SSL=true bash
```

In this mode the script automatically uses `<PUBLIC_IP>.sslip.io` for Let's Encrypt.

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
