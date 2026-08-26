"""Shared plumbing for the MTF-SMC pass (1h context / 5m execution).

Imports the v1 modules (indicators / strategies / backtest) unchanged so results
here are directly comparable with research/intraday-mr-smc/REPORT.md. Nothing in
v1 or v2 is modified.
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
V1 = os.path.abspath(os.path.join(HERE, "..", "intraday-mr-smc"))
if V1 not in sys.path:
    sys.path.insert(0, V1)

import indicators as ind        # noqa: E402
import strategies as st         # noqa: E402
import backtest as bt           # noqa: E402

DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")
os.makedirs(DATA, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
           "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]

# MTF-SMC-DESIGN.md §5.1
FIT = ("2022-08-01", "2025-04-01")
HOLD = ("2025-04-01", "2026-08-01")

COST_RT = 0.0010          # 10 bp round-trip (5 bp/side), §5.2


def load(sym: str, iv: str = "5m") -> pd.DataFrame:
    f = os.path.join(DATA, f"{sym}-{iv}.csv.gz")
    if not os.path.exists(f):
        raise SystemExit(f"missing {f} -- run fetch_mtf.py")
    return pd.read_csv(f, parse_dates=["ts"])


def slice_period(d: pd.DataFrame, start=None, end=None) -> pd.DataFrame:
    m = pd.Series(True, index=d.index)
    if start is not None:
        m &= d.ts >= pd.Timestamp(start, tz="UTC")
    if end is not None:
        m &= d.ts < pd.Timestamp(end, tz="UTC")
    return d.loc[m].reset_index(drop=True)


def summarise(tr: pd.DataFrame) -> dict:
    if tr is None or len(tr) == 0:
        return dict(trades=0, win_rate=np.nan, profit_factor=np.nan,
                    expectancy_R=np.nan, net_pnl=0.0)
    w = tr.pnl > 0
    gl = -tr.pnl[~w].sum()
    return dict(trades=len(tr), win_rate=float(w.mean()),
                profit_factor=float(tr.pnl[w].sum() / gl) if gl > 0 else np.inf,
                expectancy_R=float(tr.r.mean()), net_pnl=float(tr.pnl.sum()))
