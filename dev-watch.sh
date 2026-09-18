#!/usr/bin/env bash
# Dev watch mode for the signal server — no manual restarts.
#   ./dev-watch.sh          server only (client's `ng serve` already hot-reloads)
# Reads apps/signal-server/.env automatically (ConfigModule.forRoot picks up cwd/.env).
# Two processes on purpose: `tsc -w` only compiles, `node --watch` only restarts.
# `nest start --watch` is NOT used — its deleteOutDir wipes dist/ and races its own
# first launch (verified 2026-09-17).
set -euo pipefail
cd "$(dirname "$0")"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "[dev-watch] contracts: tsc --watch"
(cd libs/contracts && npx tsc -p tsconfig.json --watch --preserveWatchOutput) &

echo "[dev-watch] server: tsc --watch + node --watch on :3000"
(cd apps/signal-server && npx tsc -p tsconfig.json --watch --preserveWatchOutput) &

# give the first compile a moment so node --watch has something to load
until [ -f apps/signal-server/dist/main.js ]; do sleep 1; done
(cd apps/signal-server && node --watch dist/main.js) &

wait
