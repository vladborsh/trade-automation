#!/usr/bin/env python3
"""THREAD 2 -- do the same candidates behave differently on other liquid perps?

Runs every candidate (the three v1 rule-sets plus the three v2 momentum-inversion
probes) at 1h over the same 48-month window on the original BTC/ETH/SOL plus
BNB / XRP / DOGE / ADA / LINK USD-M perpetuals. Default parameters throughout --
no per-asset tuning, because the question is whether the absent-edge finding is
asset-specific, not whether a knob can be turned.

    python run_assets.py                    # net of costs
    python run_assets.py --fee-bps 0 --tag nofee
    python run_assets.py --engine-check     # v1 engine vs gap-aware engine_v2
"""
from __future__ import annotations
import argparse, os
import numpy as np
import pandas as pd

import common as C
import engine_v2 as e2

V1_SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
NEW_SYMS = ["BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]
CANDS = ["mean_reversion", "smc", "hybrid", "momentum", "momentum_breakout", "momentum_smc"]


def one(sym, iv, cand, fee_bps, gap_engine=False):
    d = C.load(sym, iv)
    sig, p = C.signals(d, cand)
    res = (e2.run(d, sig, p["time_stop"], fee_bps=fee_bps if fee_bps is not None else 5.0)
           if gap_engine else C.run(d, sig, p, fee_bps=fee_bps))
    m = C.stats(res, iv)
    m.update(symbol=sym, interval=iv, candidate=cand,
             group="v1" if sym in V1_SYMS else "new")
    return m, res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(V1_SYMS + NEW_SYMS))
    ap.add_argument("--intervals", default="1h")
    ap.add_argument("--candidates", default=",".join(CANDS))
    ap.add_argument("--fee-bps", type=float, default=None)
    ap.add_argument("--tag", default="assets")
    ap.add_argument("--engine-check", action="store_true")
    a = ap.parse_args()

    if a.engine_check:
        rows = []
        for cand in ("mean_reversion", "hybrid", "momentum_breakout"):
            for sym in ("BTCUSDT", "XRPUSDT"):
                for gap in (False, True):
                    m, _ = one(sym, "1h", cand, a.fee_bps, gap_engine=gap)
                    rows.append(dict(engine="gap_aware" if gap else "v1", **m))
                    print(f"{cand:>18} {sym:<9} {'gap' if gap else 'v1 ':>3} "
                          f"n={m.get('trades',0):>5} wr={m.get('win_rate',0):.1%} "
                          f"pf={m.get('profit_factor',0):.3f}", flush=True)
        pd.DataFrame(rows).to_csv(os.path.join(C.OUT, "engine_check.csv"), index=False)
        return

    rows = []
    for cand in a.candidates.split(","):
        for iv in a.intervals.split(","):
            for sym in a.symbols.split(","):
                m, _ = one(sym, iv, cand, a.fee_bps)
                rows.append(m)
                print(f"{cand:>18} {iv:>3} {sym:<9} n={m.get('trades',0):>5} "
                      f"wr={m.get('win_rate',0):.1%} pf={m.get('profit_factor',0):.2f} "
                      f"sharpe={m.get('sharpe',0):.2f} dd={m.get('max_dd',0):.1%} "
                      f"expR={m.get('expectancy_R',0):+.3f}", flush=True)
    cols = ["candidate", "interval", "symbol", "group", "trades", "win_rate", "profit_factor",
            "expectancy_R", "sharpe", "sortino", "max_dd", "calmar", "cagr", "long_share",
            "stop_share", "time_share", "avg_bars"]
    df = pd.DataFrame(rows)
    df.reindex(columns=[c for c in cols if c in df.columns]).to_csv(
        os.path.join(C.OUT, f"summary_{a.tag}.csv"), index=False)
    print(f"\nwrote results/summary_{a.tag}.csv")


if __name__ == "__main__":
    main()
