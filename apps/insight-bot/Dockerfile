# Multi-stage, Node 22, non-root, for linux/arm64 — the production box is an EC2 t4g
# (architecture/insight-bot-system-design.md §7). Context = the repo root:
#   docker buildx build --platform linux/arm64 -f apps/insight-bot/Dockerfile -t insight-bot .
# Secrets are NEVER baked in as build args — SSM Parameter Store renders a root-only .env on the
# host and docker compose injects it at runtime (§7). Dockerfile.dockerignore keeps a developer's
# node_modules and .env files out of the context.
#
# The bot consumes the workspace libs as built packages (dist/), like signal-server's image:
# contracts, binance-client, calendar-core and market-data-core (its package.json dependencies).

# The build stage runs on the BUILDER's platform (native, not under QEMU): it emits only
# platform-independent JS and static files. Only the runtime stage, which installs the production
# node_modules, is built for the target platform.
FROM --platform=$BUILDPLATFORM node:22-slim AS build
WORKDIR /workspace

# Every lib's manifest: chart-client depends on indicators and replay-core, and a workspace whose
# folder is missing would be fetched from the npm registry (where it does not exist).
COPY package.json package-lock.json* ./
COPY libs/contracts/package.json libs/contracts/package.json
COPY libs/indicators/package.json libs/indicators/package.json
COPY libs/replay-core/package.json libs/replay-core/package.json
COPY libs/binance-client/package.json libs/binance-client/package.json
COPY libs/calendar-core/package.json libs/calendar-core/package.json
COPY libs/market-data-core/package.json libs/market-data-core/package.json
COPY apps/insight-bot/package.json apps/insight-bot/package.json
COPY apps/chart-client/package.json apps/chart-client/package.json
RUN npm install

COPY tsconfig.base.json ./
COPY libs libs
COPY apps/insight-bot apps/insight-bot
COPY apps/chart-client apps/chart-client

# Libs first, in dependency order (contracts is everyone's dependency). indicators and replay-core
# are for the dashboard only: it compiles chart-client feature code through a path alias.
RUN npm run build --workspace=@trade-automation/contracts \
 && npm run build --workspace=@trade-automation/indicators \
 && npm run build --workspace=@trade-automation/replay-core \
 && npm run build --workspace=@trade-automation/calendar-core \
 && npm run build --workspace=@trade-automation/binance-client \
 && npm run build --workspace=@trade-automation/market-data-core \
 && npm run build --workspace=@trade-automation/insight-bot

# IB-030 (design §3 "Angular build: never on the box") — the dashboard is built HERE, because
# `ng build` peaks around 1.5 GB and the production box has 1 GB. The image carries only the
# hashed static files it produces.
RUN cd apps/chart-client && npx ng build insight-dashboard

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace

RUN groupadd --gid 1001 insightbot && useradd --uid 1001 --gid insightbot --shell /bin/false insightbot

COPY package.json package-lock.json* ./
COPY libs/contracts/package.json libs/contracts/package.json
COPY libs/binance-client/package.json libs/binance-client/package.json
COPY libs/calendar-core/package.json libs/calendar-core/package.json
COPY libs/market-data-core/package.json libs/market-data-core/package.json
COPY apps/insight-bot/package.json apps/insight-bot/package.json
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /workspace/libs/contracts/dist libs/contracts/dist
COPY --from=build /workspace/libs/binance-client/dist libs/binance-client/dist
COPY --from=build /workspace/libs/calendar-core/dist libs/calendar-core/dist
COPY --from=build /workspace/libs/market-data-core/dist libs/market-data-core/dist
COPY --from=build /workspace/apps/insight-bot/dist apps/insight-bot/dist
# the dashboard bundle: ServeStaticModule serves it from apps/insight-bot/public (§3)
COPY --from=build /workspace/apps/chart-client/dist/insight-dashboard/browser apps/insight-bot/public
# universe.yaml and the migrations are read at runtime (§2.3, §3.2), so they ship in the image —
# public reference data, not secrets.
COPY apps/insight-bot/config apps/insight-bot/config
COPY apps/insight-bot/migrations apps/insight-bot/migrations

WORKDIR /workspace/apps/insight-bot
RUN chown -R insightbot:insightbot /workspace

# IB-115 (design V27): the commit this image was built from, 12 hex, stamped on every OI research row.
# push-image.sh and the CI workflow pass --build-arg BUILD_SHA=<commit 12>. Without the arg it is
# empty, and the bot refuses to boot in production (env.schema.ts) rather than write rows with no build.
# Declared last, so a new commit does not invalidate the npm install layers above.
ARG BUILD_SHA=
ENV BUILD_SHA=${BUILD_SHA}

USER insightbot
EXPOSE 3005
# IB-096: an explicit V8 heap cap sized for the 1 GB box — the arithmetic is in
# src/ops/memory-budget.ts, and test/ops/memory-budget.spec.ts fails if these flags drift from it.
CMD ["node", "--max-old-space-size=128", "--max-semi-space-size=8", "dist/main.js"]
