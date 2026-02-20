# Korbit

Private cross-platform messenger monorepo.

Step 1 implementation includes:
- NestJS/Fastify API with username/password auth, invites, direct chats, WS realtime
- Next.js web client with login/register/chat realtime UI
- Mobile/Desktop scaffolds
- Docker compose for postgres/redis/api/web

See full architecture, API contract, data model and runbook:
- `docs/step1-architecture.md`
- `docs/vps-install.md`

## One-Click VPS Deploy

On Ubuntu VPS you can deploy everything automatically with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/Bivashka/Korbit/main/scripts/vps/one-click.sh | bash
```

Optional env overrides:

```bash
curl -fsSL https://raw.githubusercontent.com/Bivashka/Korbit/main/scripts/vps/one-click.sh | \
env KORBIT_HOST=chat.example.com \
    KORBIT_ENABLE_SSL=true \
    KORBIT_LETSENCRYPT_EMAIL=admin@example.com \
    bash
```

No domain yet? Run with only SSL flag and script will auto-use `<YOUR_PUBLIC_IP>.sslip.io`:

```bash
curl -fsSL https://raw.githubusercontent.com/Bivashka/Korbit/main/scripts/vps/one-click.sh | \
env KORBIT_ENABLE_SSL=true bash
```
