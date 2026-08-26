#!/usr/bin/env python3
"""Run every candidate x interval x symbol combination and emit the comparison
tables.

    python run_sweep.py                    # full sweep, writes results/*.csv
    python run_sweep.py --symbols BTCUSDT --intervals 15m
    python run_sweep.py --regimes          # also split by trend / chop regime
"""
from __future__ import annotations
import argparse, os, sys
import numpy as np
import pandas as pd

import strategies as st
import backtest as bt

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data"); OUT = os.path.join(HERE, "results")
BARS_PER_YEAR = {"5m": 365 * 288, "15m": 365 * 96, "1h": 365 * 24}


def load(sym: str, iv: str) -> pd.DataFrame:
    f = os.path.join(DATA, f"{sym}-{iv}.csv.gz")
    if not os.path.exists(f):
        sys.exit(f"missing {f} -- run fetch_data.py first")
    d = pd.read_csv(f, parse_dates=["ts"])
    return d


def regime_windows(d: pd.DataFrame) -> pd.Series:
    """Tag each bar trend vs chop from a 30-day realised trendiness measure:
    |net move| / sum(|moves|) on daily closes (efficiency ratio)."""
    daily = d.set_index("ts").close.resample("1D").last().dropna()
    net = daily.diff(30).abs()
    path = daily.diff().abs().rolling(30).sum()
    er = (net / path).reindex(daily.index)
    tag = pd.Series(np.where(er > er.median(), "trend", "chop"), index=daily.index,
                    name="regime").to_frame().reset_index()
    return tag  # columns: ts, regime (one row per UTC day)


def one(sym: str, iv: str, cand: str, params: dict, regimes: bool):
    d = load(sym, iv)
    p = dict(st.DEFAULTS); p.update(params)
    prepped = st.prepare(d, p)
    if cand == "hybrid":
        prepped = st.add_htf_bias(prepped, p)
    sig = st.CANDIDATES[cand](prepped, p)
    res = bt.run(d, sig, p["time_stop"])
    m = bt.metrics(res, BARS_PER_YEAR[iv])
    m.update(symbol=sym, interval=iv, candidate=cand)
    rows = [m]
    if regimes and len(res["trades"]):
        tag = regime_windows(d)
        tr = res["trades"].copy().sort_values("entry_ts")
        tr = pd.merge_asof(tr, tag, left_on="entry_ts", right_on="ts",
                           direction="backward").drop(columns=["ts"])
        tr = tr.dropna(subset=["regime"])
        for rg, g in tr.groupby("regime"):
            w = g.pnl > 0
            rows.append(dict(symbol=sym, interval=iv, candidate=cand, regime=rg,
                             trades=len(g), win_rate=w.mean(),
                             profit_factor=(g.pnl[w].sum() / -g.pnl[~w].sum()
                                            if (~w).any() else np.inf),
                             expectancy_R=g.r.mean(), net_pnl=g.pnl.sum()))
    return rows, res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="BTCUSDT,ETHUSDT,SOLUSDT")
    ap.add_argument("--intervals", default="5m,15m,1h")
    ap.add_argument("--candidates", default="mean_reversion,smc,hybrid")
    ap.add_argument("--regimes", action="store_true")
    ap.add_argument("--tag", default="main")
    ap.add_argument("--set", default="", help="param overrides, e.g. mr_z=2.5,stop_atr=2")
    ap.add_argument("--fee-bps", type=float, default=None, help="override per-side cost")
    a = ap.parse_args()

    params = {}
    for kv in filter(None, a.set.split(",")):
        k, v = kv.split("="); params[k] = float(v) if "." in v else int(v)

    if a.fee_bps is not None:
        bt.FEE_BPS = a.fee_bps
    os.makedirs(OUT, exist_ok=True)
    summary, regime_rows = [], []
    for cand in a.candidates.split(","):
        for iv in a.intervals.split(","):
            for sym in a.symbols.split(","):
                rows, res = one(sym, iv, cand, params, a.regimes)
                summary.append(rows[0]); regime_rows += rows[1:]
                r = rows[0]
                print(f"{cand:>14} {iv:>3} {sym:<8} n={r.get('trades',0):>5} "
                      f"wr={r.get('win_rate',0):.1%} pf={r.get('profit_factor',0):.2f} "
                      f"sharpe={r.get('sharpe',0):.2f} dd={r.get('max_dd',0):.1%} "
                      f"calmar={r.get('calmar',float('nan')):.2f}", flush=True)
                if len(res["trades"]):
                    res["trades"].to_csv(
                        os.path.join(OUT, f"trades_{cand}_{iv}_{sym}_{a.tag}.csv"), index=False)

    cols = ["candidate", "interval", "symbol", "trades", "win_rate", "profit_factor",
            "expectancy_R", "sharpe", "sortino", "max_dd", "calmar", "cagr",
            "total_return", "long_share", "stop_share", "time_share", "avg_bars"]
    df = pd.DataFrame(summary)
    df = df.reindex(columns=[c for c in cols if c in df.columns])
    df.to_csv(os.path.join(OUT, f"summary_{a.tag}.csv"), index=False)
    if regime_rows:
        pd.DataFrame(regime_rows).to_csv(os.path.join(OUT, f"regimes_{a.tag}.csv"), index=False)
    print(f"\nwrote {OUT}/summary_{a.tag}.csv")


if __name__ == "__main__":
    main()
