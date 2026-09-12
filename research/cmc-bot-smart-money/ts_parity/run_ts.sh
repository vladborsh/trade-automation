#!/bin/bash
# Stage-0 parity: run the bot's own TypeScript over a window and dump its
# signal/close/trail stream as JSONL.  TZ=UTC is the pinned host assumption
# (knowledge/smart-money-ict.md §2); running this under any other TZ would
# shift every `startOfDay`-derived level and session boundary.
#
#   ./run_ts.sh <SYMBOL> <startDate> <endDate>
set -euo pipefail
SYM="$1"; START="$2"; END="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"
BOT="$HERE/../../../cmc-bot-main"
TAG="$SYM-$START-$END"

cd "$BOT"
export TZ=UTC
export NODE_PATH="$BOT/node_modules"
npx ts-node --transpile-only "$HERE/dump_signals.ts" \
  "${START}T00:00:00Z" "${END}T00:00:00Z" "$SYM" \
  "$HERE/$TAG-m1.json,$HERE/$TAG-h1.json" \
  > "$HERE/ts_events_$TAG.jsonl"
wc -l "$HERE/ts_events_$TAG.jsonl"
