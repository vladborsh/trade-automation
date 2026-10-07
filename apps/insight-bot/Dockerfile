# Multi-stage, Node 22, non-root, buildable for linux/arm64 — the production box is an EC2
# t4g.small (architecture/insight-bot-system-design.md §7):
#   docker buildx build --platform linux/arm64 -f apps/insight-bot/Dockerfile -t insight-bot .
# Secrets are NEVER baked in as build args — SSM Parameter Store renders a root-only .env on the
# host and docker compose injects it at runtime (§7).

FROM node:22-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json* ./
COPY apps/insight-bot/package.json apps/insight-bot/package.json
RUN npm install --workspace=@trade-automation/insight-bot --include-workspace-root

COPY tsconfig.base.json ./
COPY apps/insight-bot apps/insight-bot

RUN npm run build --workspace=@trade-automation/insight-bot

# IB-030 (design §3 "Angular build: never on the box") — the dashboard is built HERE, on the
# runner, because `ng build` peaks around 1.5 GB and the production box is a **t4g.micro with
# 1 GB** (the cost plan chose the micro over D14's t4g.small to stay inside the user's 20 USD
# cap). The build would not merely be slow there, it would not fit. The image carries only the
# ~1-2 MB of hashed static files it produces, and the box only ever pulls from GHCR.
FROM node:22-slim AS dashboard
WORKDIR /workspace

COPY package.json package-lock.json* ./
COPY apps/chart-client/package.json apps/chart-client/package.json
RUN npm install --workspace=@trade-automation/chart-client --include-workspace-root

COPY tsconfig.base.json ./
COPY libs libs
COPY apps/chart-client apps/chart-client
RUN npm run build --workspace=@trade-automation/contracts \
 && cd apps/chart-client && npx ng build insight-dashboard

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace

RUN groupadd --gid 1001 insightbot && useradd --uid 1001 --gid insightbot --shell /bin/false insightbot

COPY package.json package-lock.json* ./
COPY apps/insight-bot/package.json apps/insight-bot/package.json
RUN npm install --omit=dev --workspace=@trade-automation/insight-bot --include-workspace-root

COPY --from=build /workspace/apps/insight-bot/dist apps/insight-bot/dist
# universe.yaml and the migrations are read at runtime (§2.3, §3.2), so they ship in the image —
# public reference data, not secrets.
# the dashboard bundle: ServeStaticModule serves it from apps/insight-bot/public (§3)
COPY --from=dashboard /workspace/apps/chart-client/dist/insight-dashboard/browser apps/insight-bot/public
COPY apps/insight-bot/config apps/insight-bot/config
COPY apps/insight-bot/migrations apps/insight-bot/migrations

WORKDIR /workspace/apps/insight-bot
RUN chown -R insightbot:insightbot /workspace

USER insightbot
EXPOSE 3005
CMD ["node", "dist/main.js"]
