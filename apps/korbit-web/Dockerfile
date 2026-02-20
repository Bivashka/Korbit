FROM node:20-alpine

WORKDIR /app
RUN corepack enable

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_REGISTRATION_MODE=invite
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_REGISTRATION_MODE=$NEXT_PUBLIC_REGISTRATION_MODE

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/korbit-web/package.json apps/korbit-web/package.json

RUN pnpm install --filter @korbit/korbit-web... --no-frozen-lockfile

COPY . .

RUN pnpm --filter @korbit/korbit-web build

EXPOSE 3000

CMD ["pnpm", "--filter", "@korbit/korbit-web", "start"]

