#!/bin/bash
# Run the bot's own TypeScript over one monthly chunk and dump its event stream.
# TZ=UTC is the pinned host assumption; any other TZ shifts every startOfDay.
#   ./run_ts.sh <SYMBOL> <YYYY-MM | YYYY-MM-DD+N> [native|win|all]
set -euo pipefail
SYM="$1"; MONTH="$2"; MODE="${3:-native}"
TAG="$SYM-$MONTH"; [ "$MODE" != native ] && TAG="$TAG-$MODE"
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$HERE/.."
BOT="$PKG/../../cmc-bot-main"
PY=${PY:-/Users/Vladyslav_Borsh/Documents/trade_automation/.venv/bin/python}
mkdir -p "$HERE/events"
read START END < <("$PY" -c "import sys; sys.path.insert(0,'$HERE'); from export_static import chunk_bounds; a,b=chunk_bounds('$MONTH'); print(a.strftime('%Y-%m-%dT%H:%M:%SZ'), b.strftime('%Y-%m-%dT%H:%M:%SZ'))")
"$PY" "$HERE/export_static.py" "$SYM" "$MONTH" > /dev/null
cd "$BOT"
TZ=UTC NODE_PATH="$PKG/ts_harness/node_modules" "$PKG/ts_harness/node_modules/.bin/ts-node" --transpile-only \
  "$HERE/dump_vwap.ts" "$START" "$END" "$SYM" "$HERE/static/$SYM-$MONTH-m1.json" "$MODE" \
  | gzip > "$HERE/events/$TAG.jsonl.gz"
rm -f "$HERE/static/$SYM-$MONTH-m1.json"
[ "$MODE" != native ] && cp "$HERE/events/$SYM-$MONTH.sha256" "$HERE/events/$TAG.sha256"
echo "$TAG done"
