# Korbit Step 1

## ARCHITECTURE

```text
[korbit-web (Next.js)] --REST--> [korbit-api (NestJS/Fastify)] --SQL--> [PostgreSQL]
        |                                  |
        +-------- Socket.IO WS ------------+
                                           |
                                           +---- Pub/Sub adapter ----> [Redis]
```

### Data flow (Step 1)
- Login/register:
  - `korbit-web` calls `POST /auth/login` or `POST /auth/register`.
  - `korbit-api` validates credentials/invite, creates `sessions`, returns access/refresh JWT.
- Chat messaging:
  - web sends `POST /chats/:chatId/messages`.
  - API writes `messages`, updates chat timestamp, emits `new_message` to WS room.
- Typing/read/presence:
  - web sends WS `typing` and `read_receipt`.
  - API validates membership and broadcasts room events.
  - connection/disconnection emits `presence`.

## DATA MODEL

Implemented tables in Prisma migration:
- `User` (`username`, `passwordHash`, profile fields, `role`)
- `Session` (device session, hashed refresh token, IP/UA, expiry, revoke)
- `Invite` (admin-generated code, usage counters, expiry/disable flags)
- `Chat` (supports `DIRECT/GROUP/CHANNEL` enum; Step 1 uses `DIRECT`)
- `DirectChat` (unique pair mapping for 1:1 dialogs)
- `ChatMember` (membership + `lastReadMessageId`)
- `Message` (text content + sender/chat relations)

Planned for next steps:
- `Reaction`, `Attachment`, `Call` (present in roadmap but not in Step 1 schema yet)

## API CONTRACT

### REST
- Auth:
  - `POST /auth/register` `{ username, password, displayName?, inviteCode? }`
  - `POST /auth/login` `{ username, password }`
  - `POST /auth/refresh` `{ refreshToken }`
  - `POST /auth/logout` `{ refreshToken }`
  - `POST /auth/logout-all` (auth)
  - `GET /auth/session` (auth)
- Users:
  - `GET /users/me`
  - `PATCH /users/me` `{ displayName?, bio?, avatarUrl? }`
- Invites (admin):
  - `POST /invites` `{ maxUses?, expiresAt? }`
  - `GET /invites`
  - `PATCH /invites/:inviteId/disable`
- Chats:
  - `GET /chats`
  - `POST /chats/direct` `{ username }`
  - `GET /chats/:chatId/messages?cursor&limit`
  - `POST /chats/:chatId/messages` `{ content }`
  - `POST /chats/:chatId/read` `{ messageId? }`
- Infra:
  - `GET /health`

### WS (`/realtime`)
- Client -> server:
  - `typing` `{ chatId, isTyping }`
  - `read_receipt` `{ chatId, messageId? }`
- Server -> client:
  - `new_message`
  - `typing`
  - `read_receipt`
  - `presence`
  - `presence_snapshot`

## SECURITY NOTES

- Password storage: Argon2id.
- Password policy: at least 10 chars with upper/lower/digit.
- Brute-force protection:
  - attempt throttling in auth service (temporary lock after repeated failures).
- JWT model:
  - short-lived access token;
  - long-lived refresh token stored hashed in `sessions`.
- Session management:
  - refresh rotation;
  - logout single session / logout-all.
- Access control:
  - global JWT guard for protected endpoints;
  - role guard for admin routes (`invites`).
- WS security:
  - JWT auth at handshake;
  - membership validation for chat events.
- Infra:
  - CORS + Helmet enabled;
  - secrets/env-based configuration.

## ROADMAP

### MVP (2-3 weeks)
1. Step 1 (current): auth + invites + direct chats + realtime core.
2. Step 2: attachments + MinIO + upload limits + previews.
3. Step 3: LiveKit 1:1 calls + signaling UI.

### V1 (6-8 weeks)
1. Groups/channels/roles moderation.
2. Reactions/search/history optimizations.
3. Push notifications (Web/FCM/APNs).
4. Media pipeline + observability + hardening.

## TREE

```text
korbit/
  apps/
    korbit-api/
      prisma/
      src/
    korbit-web/
      app/
      lib/
    korbit-mobile/
    korbit-desktop/
  docs/
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  turbo.json
```

## FILES (key)

- `apps/korbit-api/src/auth/*`: login/register/refresh/logout, Argon2 + sessions.
- `apps/korbit-api/src/invites/*`: admin invite CRUD for private onboarding.
- `apps/korbit-api/src/chats/*`: direct chat creation, message send/list, read receipts.
- `apps/korbit-api/src/realtime/realtime.gateway.ts`: WS auth + typing/read/presence/new_message delivery.
- `apps/korbit-api/prisma/schema.prisma`: Step 1 data model.
- `apps/korbit-web/app/(auth)/*`: login + invite registration UI.
- `apps/korbit-web/app/chats/page.tsx`: realtime chat UI with Socket.IO.
- `docker-compose.yml`: local stack (`postgres`, `redis`, `api`, `web`).

## MIGRATIONS

- Prisma schema: `apps/korbit-api/prisma/schema.prisma`
- Initial SQL migration: `apps/korbit-api/prisma/migrations/20260220235000_init/migration.sql`

## INTEGRATION NOTES

### Local (without Docker)
1. Install deps: `pnpm install`
2. Copy env files:
   - `Copy-Item apps/korbit-api/.env.example apps/korbit-api/.env`
   - `Copy-Item apps/korbit-web/.env.example apps/korbit-web/.env.local`
3. Run infra: `docker compose up -d postgres redis`
4. Run migration: `pnpm --filter @korbit/korbit-api prisma:migrate`
5. Start API: `pnpm --filter @korbit/korbit-api dev`
6. Start web: `pnpm --filter @korbit/korbit-web dev`

### Full Docker stack
1. `docker compose up --build`
2. Web: `http://localhost:3000`
3. API health: `http://localhost:4000/health`

Default bootstrap admin:
- username: `admin`
- password: `Admin123456`

## TEST STEPS

1. Auth/invite:
   - login as admin;
   - create invite via `POST /invites`;
   - register new user using invite code.
2. Direct chat:
   - user A creates direct chat with user B;
   - send message from A; verify B receives `new_message` in real-time.
3. Realtime state:
   - open two browser tabs with different users;
   - type in one tab and verify `typing`;
   - mark read and verify `read_receipt`;
   - close/open tabs and verify `presence`.

