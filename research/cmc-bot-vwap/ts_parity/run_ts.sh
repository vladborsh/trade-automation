#!/bin/bash
# Run the bot's own TypeScript over one monthly chunk and dump its event stream.
# TZ=UTC is the pinned host assumption; any other TZ shifts every startOfDay.
#   ./run_ts.sh <SYMBOL> <YYYY-MM>
set -euo pipefail
SYM="$1"; MONTH="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$HERE/.."
BOT="$PKG/../../cmc-bot-main"
PY=${PY:-/Users/Vladyslav_Borsh/Documents/trade_automation/.venv/bin/python}
mkdir -p "$HERE/events"
START="${MONTH}-01T00:00:00Z"
END=$("$PY" -c "import pandas as pd,sys; a=pd.Timestamp('${MONTH}-01',tz='UTC'); print((a+pd.offsets.MonthBegin(1)-pd.Timedelta('1min')).strftime('%Y-%m-%dT%H:%M:%SZ'))")
"$PY" "$HERE/export_static.py" "$SYM" "$MONTH" > /dev/null
cd "$BOT"
TZ=UTC NODE_PATH="$PKG/ts_harness/node_modules" "$PKG/ts_harness/node_modules/.bin/ts-node" --transpile-only \
  "$HERE/dump_vwap.ts" "$START" "$END" "$SYM" "$HERE/static/$SYM-$MONTH-m1.json" \
  | gzip > "$HERE/events/$SYM-$MONTH.jsonl.gz"
rm -f "$HERE/static/$SYM-$MONTH-m1.json"
echo "$SYM $MONTH done"
