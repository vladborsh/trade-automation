# Multi-stage, Node 22, non-root. Unlike cmc-bot-main's Dockerfile (architecture/
# live-signal-server.md §1, §9.1), secrets are NEVER baked in as build args — inject them as
# runtime env vars (Secrets Manager / SSM in production; a local .env for dev).

FROM node:22-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json* ./
COPY libs/contracts/package.json libs/contracts/package.json
COPY libs/indicators/package.json libs/indicators/package.json
COPY libs/replay-core/package.json libs/replay-core/package.json
COPY libs/binance-client/package.json libs/binance-client/package.json
COPY libs/calendar-core/package.json libs/calendar-core/package.json
COPY libs/market-data-core/package.json libs/market-data-core/package.json
COPY apps/signal-server/package.json apps/signal-server/package.json
RUN npm install

COPY tsconfig.base.json ./
COPY libs/contracts libs/contracts
COPY libs/indicators libs/indicators
COPY libs/replay-core libs/replay-core
COPY libs/binance-client libs/binance-client
COPY libs/calendar-core libs/calendar-core
COPY libs/market-data-core libs/market-data-core
COPY apps/signal-server apps/signal-server

# The server consumes the libs as built packages (dist/), so they build first, in dependency order.
RUN npm run build --workspace=@trade-automation/contracts
RUN npm run build --workspace=@trade-automation/indicators
RUN npm run build --workspace=@trade-automation/replay-core
RUN npm run build --workspace=@trade-automation/signal-server

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace

RUN groupadd --gid 1001 signalserver && useradd --uid 1001 --gid signalserver --shell /bin/false signalserver

COPY package.json package-lock.json* ./
COPY libs/contracts/package.json libs/contracts/package.json
COPY libs/indicators/package.json libs/indicators/package.json
COPY libs/replay-core/package.json libs/replay-core/package.json
COPY libs/binance-client/package.json libs/binance-client/package.json
COPY libs/calendar-core/package.json libs/calendar-core/package.json
COPY libs/market-data-core/package.json libs/market-data-core/package.json
COPY apps/signal-server/package.json apps/signal-server/package.json
RUN npm install --omit=dev

COPY --from=build /workspace/libs/contracts/dist libs/contracts/dist
COPY --from=build /workspace/libs/indicators/dist libs/indicators/dist
COPY --from=build /workspace/libs/replay-core/dist libs/replay-core/dist
COPY --from=build /workspace/libs/binance-client/dist libs/binance-client/dist
COPY --from=build /workspace/libs/calendar-core/dist libs/calendar-core/dist
COPY --from=build /workspace/libs/market-data-core/dist libs/market-data-core/dist
COPY --from=build /workspace/apps/signal-server/dist apps/signal-server/dist
COPY apps/signal-server/config apps/signal-server/config
# Replay fixtures ship in the image so docker-compose's dev profile (MARKET_DATA_MODE=replay)
# works without a live venue or an extra volume mount; harmless synthetic data, not a secret.
COPY apps/signal-server/test/fixtures apps/signal-server/test/fixtures

WORKDIR /workspace/apps/signal-server
RUN chown -R signalserver:signalserver /workspace

USER signalserver
EXPOSE 3000
CMD ["node", "dist/main.js"]
