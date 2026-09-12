#!/usr/bin/env python3
"""PARITY.md gate 1 — bar-for-bar diff of the Python port against the bot's
own TypeScript, over the same window, on byte-identical tape.

    python parity.py BTCUSDT 2024-11-01 2024-12-20

Asserts, for every order the TypeScript opens and every order the port opens:
signal-bar timestamp, direction, entry price, entry time, stop price, target
price — and, beyond the pre-registered minimum, the whole trade lifecycle
(exit bar, exit price, exit cause and every stop trail). Any mismatch is
itemised, not smoothed over.

The TypeScript side runs with the daily 2-loss / 1-win caps ON, because
`RiskManager` is not parameterised; the port is therefore run with
`daily_caps=True` here. The caps-removed primary population of
ARCHITECT-NOTE §3.2 is a *superset* of this stream and is never what parity is
measured on.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from common import BUY, SELL, RESULTS  # noqa: E402
import engine  # noqa: E402

TOL = 1e-6          # relative; the two sides differ only in float printing


def load_ts(tag: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    path = os.path.join(HERE, "ts_parity", f"ts_events_{tag}.jsonl")
    ev = [json.loads(x) for x in open(path)]
    sig = pd.DataFrame([e for e in ev if e["ev"] == "signal"])
    clo = pd.DataFrame([e for e in ev if e["ev"] == "close"])
    tr = pd.DataFrame([e for e in ev if e["ev"] == "trail"])
    return sig, clo, tr


def main() -> None:
    sym, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
    tag = f"{sym}-{start}-{end}"
    ts_sig, ts_clo, ts_tr = load_ts(tag)

    lo = int(pd.Timestamp(start, tz="UTC").value // 10**6)
    hi = int(pd.Timestamp(end, tz="UTC").value // 10**6)

    P = engine.prepare(sym)
    sig = engine.signals(P, lo, hi)
    trades = engine.simulate_trades(P, sig, daily_caps=True, lo_ms=lo, hi_ms=hi)

    print(f"\n=== {tag} ===")
    print(f"TypeScript orders : {len(ts_sig)}")
    print(f"Python orders     : {len(trades)}")

    problems: list[str] = []
    if len(ts_sig) != len(trades):
        problems.append(f"order count {len(ts_sig)} (ts) vs {len(trades)} (py)")

    n = min(len(ts_sig), len(trades))
    for k in range(n):
        a = ts_sig.iloc[k]
        b = trades.iloc[k]
        want_dir = SELL if a["dir"] == "sell" else BUY
        checks = [
            ("signal_ts", a["t"], b["signal_ts"]),
            ("entry_ts", a["entryTime"], b["entry_ts"]),
            ("direction", want_dir, b["dir"]),
            ("entry", a["entry"], b["entry"]),
            ("stop", a["stop"], b["stop0"]),      # as placed, before any trail
            ("target", a["target"], b["target"]),
        ]
        for name, x, y in checks:
            ok = (x == y) if isinstance(x, (int, np.integer)) else \
                 bool(np.isclose(float(x), float(y), rtol=TOL, atol=0))
            if not ok:
                problems.append(f"order {k} @{pd.to_datetime(a['t'], unit='ms')}: "
                                f"{name} ts={x} py={y}")

    # --- exits, beyond the pre-registered minimum -------------------------
    ts_exit = ts_clo.drop_duplicates("id", keep="first").set_index("id")
    ts_order_ids = list(ts_sig["id"])
    for k in range(n):
        oid = ts_order_ids[k]
        if oid not in ts_exit.index:
            problems.append(f"order {k}: TypeScript never closed it")
            continue
        a = ts_exit.loc[oid]
        b = trades.iloc[k]
        if int(a["closeTime"]) != int(b["exit_ts"]):
            problems.append(f"order {k}: exit time ts={a['closeTime']} py={b['exit_ts']}")
        if not np.isclose(float(a["closePrice"]), float(b["exit_price"]), rtol=TOL):
            problems.append(f"order {k}: exit price ts={a['closePrice']} py={b['exit_price']}")
        if not np.isclose(float(a["stop"]), float(b["stop"]), rtol=TOL):
            problems.append(f"order {k}: stop at exit ts={a['stop']} py={b['stop']}")
        n_tr = 0 if len(ts_tr) == 0 else int((ts_tr["id"] == oid).sum())
        if n_tr != int(b["n_trail"]):
            problems.append(f"order {k}: trail count ts={n_tr} py={b['n_trail']}")

    if problems:
        print(f"\n{len(problems)} DISCREPANCIES:")
        for p in problems[:60]:
            print("  -", p)
    else:
        print("\nPARITY: 0 discrepancies "
              "(signal time, entry time, direction, entry, stop, target, exit time, exit price)")

    os.makedirs(RESULTS, exist_ok=True)
    trades.to_csv(os.path.join(RESULTS, f"parity_py_{tag}.csv"), index=False)
    with open(os.path.join(RESULTS, f"parity_{tag}.txt"), "w") as fh:
        fh.write(f"ts orders {len(ts_sig)} / py orders {len(trades)}\n")
        fh.write("\n".join(problems) if problems else "0 discrepancies\n")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
