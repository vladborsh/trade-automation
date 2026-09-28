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
COPY apps/insight-bot/config apps/insight-bot/config
COPY apps/insight-bot/migrations apps/insight-bot/migrations

WORKDIR /workspace/apps/insight-bot
RUN chown -R insightbot:insightbot /workspace

USER insightbot
EXPOSE 3005
CMD ["node", "dist/main.js"]
