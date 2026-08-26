#!/usr/bin/env python3
"""Parameter sensitivity scan.

Purpose is NOT to find the best setting to trade -- with this many combinations
the best cell is mostly luck. It is to answer one question per candidate:
"is there any neighbourhood of the parameter space where this rule-set makes
money net of costs, or is the whole surface under water?"

Results are aggregated across BTC/ETH/SOL so a single lucky symbol cannot carry
a configuration.

    python param_scan.py --candidate mean_reversion --intervals 15m,1h
"""
from __future__ import annotations
import argparse, itertools, os, sys
import numpy as np
import pandas as pd

import strategies as st
import backtest as bt
from run_sweep import load, OUT

_prep_cache: dict = {}


def prepped(sym, iv, p, cand):
    key = (sym, iv, p["mr_len"], p["atr_len"], p["smc_k"],
           p["htf_mult"] if cand == "hybrid" else None)
    if key not in _prep_cache:
        d = load(sym, iv)
        q = st.prepare(d, p)
        if cand == "hybrid":
            q = st.add_htf_bias(q, p)
        _prep_cache[key] = (d, q)
    return _prep_cache[key]


GRIDS = {
    "mean_reversion": dict(mr_z=[1.5, 2.0, 2.5], tp_frac=[0.5, 1.0],
                           stop_atr=[1.0, 2.0, 3.0], time_stop=[12, 48]),
    "hybrid":         dict(mr_z=[1.5, 2.0, 2.5], tp_frac=[0.5, 1.0],
                           stop_atr=[1.0, 2.0, 3.0], sweep_lookback=[6, 12]),
    "smc":            dict(smc_rr=[1.0, 1.5, 2.0, 3.0], smc_k=[2, 3, 5],
                           time_stop=[24, 96]),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", required=True, choices=list(GRIDS))
    ap.add_argument("--intervals", default="15m,1h")
    ap.add_argument("--symbols", default="BTCUSDT,ETHUSDT,SOLUSDT")
    ap.add_argument("--fee-bps", type=float, default=None)
    a = ap.parse_args()
    if a.fee_bps is not None:
        bt.FEE_BPS = a.fee_bps

    grid = GRIDS[a.candidate]
    keys = list(grid)
    rows = []
    for iv in a.intervals.split(","):
        for combo in itertools.product(*(grid[k] for k in keys)):
            p = dict(st.DEFAULTS); p.update(dict(zip(keys, combo)))
            agg = []
            for sym in a.symbols.split(","):
                d, q = prepped(sym, iv, p, a.candidate)
                sig = st.CANDIDATES[a.candidate](q, p)
                res = bt.run(d, sig, p["time_stop"])
                m = bt.metrics(res, 1)
                if m.get("trades", 0) >= 20:
                    agg.append(m)
            if not agg:
                continue
            g = pd.DataFrame(agg)
            row = dict(zip(keys, combo))
            row.update(interval=iv, symbols_ok=len(g),
                       trades=int(g.trades.sum()),
                       win_rate=float((g.win_rate * g.trades).sum() / g.trades.sum()),
                       profit_factor=float(np.average(g.profit_factor.replace(np.inf, np.nan).dropna())
                                           if g.profit_factor.replace(np.inf, np.nan).notna().any() else np.nan),
                       sharpe=float(g.sharpe.mean()), sortino=float(g.sortino.mean()),
                       max_dd=float(g.max_dd.max()), calmar=float(g.calmar.mean()),
                       worst_symbol_pf=float(g.profit_factor.min()))
            rows.append(row)
            print(f"{a.candidate} {iv} " + " ".join(f"{k}={v}" for k, v in zip(keys, combo)) +
                  f" -> n={row['trades']} wr={row['win_rate']:.1%} pf={row['profit_factor']:.2f} "
                  f"calmar={row['calmar']:.2f}", flush=True)

    df = pd.DataFrame(rows).sort_values("profit_factor", ascending=False)
    f = os.path.join(OUT, f"scan_{a.candidate}.csv")
    df.to_csv(f, index=False)
    print(f"\nwrote {f}")
    print(df.head(8).to_string(index=False))


if __name__ == "__main__":
    main()
