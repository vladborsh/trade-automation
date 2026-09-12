#!/bin/bash
# The full Stage-0 parity battery: four windows, four symbols, both US DST
# transitions covered (2023-03-12 spring-forward, 2024-11-03 fall-back),
# each window >= 30 trading days as ARCHITECT-NOTE §4 requires.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY=/Users/Vladyslav_Borsh/Documents/trade_automation/.venv/bin/python

run() {
  "$PY" "$HERE/export_static.py" "$1" "$2" "$3"
  "$HERE/run_ts.sh" "$1" "$2" "$3"
  "$PY" "$HERE/../parity.py" "$1" "$2" "$3"
}

run BTCUSDT 2024-11-01 2024-12-20   # fall-back, EDT -> EST
run ETHUSDT 2024-11-01 2024-12-20
run SOLUSDT 2023-02-20 2023-04-10   # spring-forward, EST -> EDT
run BNBUSDT 2025-09-01 2025-10-20   # holdout-period sample
