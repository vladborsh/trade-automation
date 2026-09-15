#!/bin/bash
# Full-period parity battery for one symbol: every calendar month with data,
# TypeScript side then Python diff.  ./run_all.sh US100 2024-01 2026-09
set -uo pipefail
SYM="$1"; FROM="$2"; TO="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"
PY=${PY:-/Users/Vladyslav_Borsh/Documents/trade_automation/.venv/bin/python}
MONTHS=$("$PY" -c "import pandas as pd; print(' '.join(p.strftime('%Y-%m') for p in pd.period_range('$FROM','$TO',freq='M')))")
for M in $MONTHS; do
  [ -f "$HERE/events/$SYM-$M.jsonl.gz" ] || "$HERE/run_ts.sh" "$SYM" "$M"
done
"$PY" "$HERE/../parity.py" "$SYM" $MONTHS
