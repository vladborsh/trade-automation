#!/usr/bin/env python3
"""Split-sample stability for the single best configuration found by param_scan.

Splits the 48 months into four consecutive 12-month blocks and reruns. A rule
whose profitability lives in one block is a curve fit, not an edge.
"""
from __future__ import annotations
import argparse
import numpy as np
import pandas as pd

import strategies as st
import backtest as bt
from run_sweep import load

BEST = {
    "hybrid": dict(mr_z=2.0, tp_frac=1.0, stop_atr=3.0, sweep_lookback=6),
    "mean_reversion": dict(mr_z=2.0, tp_frac=1.0, stop_atr=3.0, time_stop=48),
    "smc": dict(smc_rr=2.0, smc_k=2, time_stop=96),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", default="1h")
    ap.add_argument("--symbols", default="BTCUSDT,ETHUSDT,SOLUSDT")
    a = ap.parse_args()
    rows = []
    for cand, over in BEST.items():
        p = dict(st.DEFAULTS); p.update(over)
        for sym in a.symbols.split(","):
            d = load(sym, a.interval)
            q = st.prepare(d, p)
            if cand == "hybrid":
                q = st.add_htf_bias(q, p)
            sig = st.CANDIDATES[cand](q, p)
            years = d.ts.dt.year * 100 + d.ts.dt.month
            edges = np.array_split(np.arange(len(d)), 4)
            for bi, ix in enumerate(edges, 1):
                sub = d.iloc[ix].reset_index(drop=True)
                ssub = sig.iloc[ix].reset_index(drop=True)
                res = bt.run(sub, ssub, p["time_stop"])
                m = bt.metrics(res, 1)
                rows.append(dict(candidate=cand, symbol=sym, block=bi,
                                 span=f"{sub.ts.iloc[0].date()}..{sub.ts.iloc[-1].date()}",
                                 **{k: m.get(k) for k in
                                    ("trades", "win_rate", "profit_factor", "sharpe",
                                     "max_dd", "calmar", "total_return")}))
    df = pd.DataFrame(rows)
    df.to_csv("results/stability.csv", index=False)
    pd.set_option("display.width", 220)
    print(df.to_string(index=False, float_format=lambda x: f"{x:7.2f}"))
    print("\n--- per candidate: fraction of (symbol x block) cells with PF>1 ---")
    print(df.groupby("candidate").apply(
        lambda x: pd.Series(dict(cells=len(x), pf_gt_1=(x.profit_factor > 1).mean(),
                                 pf_gt_1_2=(x.profit_factor > 1.2).mean(),
                                 median_pf=x.profit_factor.median()))
    ).to_string(float_format=lambda x: f"{x:7.2f}"))


if __name__ == "__main__":
    main()
