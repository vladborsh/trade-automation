"""Shared plumbing for the two-tier pivot-structure pass (DESIGN.md).

Imports v1 (`indicators` / `strategies` / `backtest`) and reuses the MTF
package's data pull and alignment helper unchanged, so results here are
directly comparable with `research/intraday-mtf-smc/REPORT.md`. Nothing in
either package is modified -- in particular `indicators.structure()` (the
retired engine) stays frozen; this package's engine lives in `pivot.py`.
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
V1 = os.path.abspath(os.path.join(HERE, "..", "intraday-mr-smc"))
V2 = os.path.abspath(os.path.join(HERE, "..", "intraday-mr-smc-v2"))
MTF = os.path.abspath(os.path.join(HERE, "..", "intraday-mtf-smc"))
for p in (MTF, V2, V1, HERE):     # HERE last -> ends up FIRST in sys.path,
    if p in sys.path:             # so this package's modules always win over
        sys.path.remove(p)        # the same-named ones in v1/v2/mtf
    sys.path.insert(0, p)

import indicators as ind        # noqa: E402  (v1, unchanged)
import strategies as st         # noqa: E402  (v1, unchanged)
import backtest as bt           # noqa: E402  (v1, unchanged)

# the existing 5m pull -- DESIGN.md §6 mandates reuse, not a re-pull
DATA = os.path.join(MTF, "data")
OUT = os.path.join(HERE, "results")
CACHE = os.path.join(HERE, "cache")
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
           "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]

# DESIGN.md §6 windows
FIT = ("2022-08-01", "2025-04-01")
HOLD = ("2025-04-01", "2026-08-01")

COST_RT = 0.0010          # 10 bp round-trip (5 bp/side taker), §4
HTF_MULT = 12             # 12 x 5m = 1h
ATR_LEN = 14


def load5m(sym: str) -> pd.DataFrame:
    f = os.path.join(DATA, f"{sym}-5m.csv.gz")
    if not os.path.exists(f):
        raise SystemExit(f"missing {f} -- see README.md (reuses the intraday-mtf-smc pull)")
    return pd.read_csv(f, parse_dates=["ts"])


def resample_h1(d5: pd.DataFrame) -> pd.DataFrame:
    """5m -> 1h OHLCV; identical helper to intraday-mtf-smc/mtf.resample_h1."""
    rule = st._htf_rule(d5, HTF_MULT)
    return (d5.set_index("ts")
              .resample(rule)
              .agg({"open": "first", "high": "max", "low": "min",
                    "close": "last", "volume": "sum"})
              .dropna()
              .reset_index())


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
