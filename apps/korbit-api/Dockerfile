FROM node:20-alpine

WORKDIR /app
RUN corepack enable
RUN apk add --no-cache bash docker-cli

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/korbit-api/package.json apps/korbit-api/package.json

RUN pnpm install --filter @korbit/korbit-api... --no-frozen-lockfile

COPY . .

RUN pnpm --filter @korbit/korbit-api prisma:generate
RUN pnpm --filter @korbit/korbit-api build

EXPOSE 4000

CMD ["sh", "-c", "pnpm --filter @korbit/korbit-api prisma:migrate && pnpm --filter @korbit/korbit-api start"]
