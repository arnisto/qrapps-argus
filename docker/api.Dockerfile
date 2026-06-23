# syntax=docker/dockerfile:1.7

# ---------- base ----------
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/events/package.json ./packages/events/
COPY packages/connectors/package.json ./packages/connectors/
COPY packages/investigators/package.json ./packages/investigators/
COPY packages/ai-providers/package.json ./packages/ai-providers/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile=false

# ---------- dev ----------
FROM deps AS dev
COPY . .
EXPOSE 4000
# Run migrations on every start, then tsx-watch. The migrator only
# applies new SQL files — first boot bootstraps every table in `public/`;
# subsequent boots are a no-op. Doing it in the CMD (not as a separate
# compose service) means a fresh `docker compose up` brings up a working
# stack without anyone having to remember `pnpm db:migrate`.
CMD ["sh", "-c", "pnpm --filter @argus/api db:migrate && pnpm --filter @argus/api dev"]

# ---------- build ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @argus/api... build

# ---------- runtime ----------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4000
CMD ["pnpm", "--filter", "@argus/api", "start"]
