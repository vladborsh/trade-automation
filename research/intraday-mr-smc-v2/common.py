"""Shared plumbing for the v2 refinement threads.

Imports the v1 modules (indicators / strategies / backtest) unchanged so the
numbers in this package are directly comparable with research/intraday-mr-smc/
REPORT.md. Nothing in v1 is modified.

Data resolution order: v2/data first (new symbols, index data), then v1/data
(the 48-month BTC/ETH/SOL pull that already exists).
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
V1 = os.path.abspath(os.path.join(HERE, "..", "intraday-mr-smc"))
if V1 not in sys.path:
    sys.path.insert(0, V1)

import strategies as st          # noqa: E402
import backtest as bt            # noqa: E402
import indicators as ind         # noqa: E402

DATA_V2 = os.path.join(HERE, "data")
DATA_V1 = os.path.join(V1, "data")
OUT = os.path.join(HERE, "results")
os.makedirs(DATA_V2, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

BARS_PER_YEAR = {"5m": 365 * 288, "15m": 365 * 96, "1h": 365 * 24, "1d": 252}


def load(sym: str, iv: str) -> pd.DataFrame:
    for root in (DATA_V2, DATA_V1):
        f = os.path.join(root, f"{sym}-{iv}.csv.gz")
        if os.path.exists(f):
            return pd.read_csv(f, parse_dates=["ts"])
    raise SystemExit(f"missing {sym}-{iv}.csv.gz in {DATA_V2} or {DATA_V1}")


def signals(d: pd.DataFrame, cand: str, params: dict | None = None) -> pd.DataFrame:
    """Candidate signal frame. Handles v1 candidates and the v2 additions."""
    p = dict(st.DEFAULTS)
    p.update(params or {})
    q = st.prepare(d, p)
    if cand in ("hybrid", "momentum_smc"):
        q = st.add_htf_bias(q, p)
    import strategies_v2 as sv
    fn = sv.CANDIDATES_V2.get(cand) or st.CANDIDATES[cand]
    return fn(q, p), p


def run(d: pd.DataFrame, sig: pd.DataFrame, p: dict, fee_bps: float | None = None) -> dict:
    old = bt.FEE_BPS
    if fee_bps is not None:
        bt.FEE_BPS = fee_bps
    try:
        return bt.run(d, sig, p["time_stop"])
    finally:
        bt.FEE_BPS = old


def stats(res: dict, iv: str) -> dict:
    return bt.metrics(res, BARS_PER_YEAR.get(iv, 365 * 24))


def mask_signals(sig: pd.DataFrame, d: pd.DataFrame, hours=None, days=None) -> pd.DataFrame:
    """Zero out entry intents whose FILL bar (next bar) falls outside the
    allow-list. The signal fires on bar i's close and fills at bar i+1's open,
    so the hour that matters for a session filter is bar i+1's."""
    out = sig.copy()
    fill_ts = d.ts.shift(-1)
    ok = pd.Series(True, index=d.index)
    if hours is not None:
        ok &= fill_ts.dt.hour.isin(list(hours)).fillna(False)
    if days is not None:
        ok &= fill_ts.dt.dayofweek.isin(list(days)).fillna(False)
    out.loc[~ok, ["sig", "stop", "target"]] = [0, np.nan, np.nan]
    return out


def slice_period(d: pd.DataFrame, start=None, end=None) -> pd.DataFrame:
    m = pd.Series(True, index=d.index)
    if start is not None:
        m &= d.ts >= pd.Timestamp(start, tz="UTC")
    if end is not None:
        m &= d.ts < pd.Timestamp(end, tz="UTC")
    return d.loc[m].reset_index(drop=True)


def summarise(tr: pd.DataFrame) -> dict:
    """Trade-level PF / win rate / expectancy, used where re-running the whole
    engine on a subset would be misleading (subset of an equity path)."""
    if tr is None or len(tr) == 0:
        return dict(trades=0, win_rate=np.nan, profit_factor=np.nan, expectancy_R=np.nan, net_pnl=0.0)
    w = tr.pnl > 0
    gl = -tr.pnl[~w].sum()
    return dict(trades=len(tr), win_rate=float(w.mean()),
                profit_factor=float(tr.pnl[w].sum() / gl) if gl > 0 else np.inf,
                expectancy_R=float(tr.r.mean()), net_pnl=float(tr.pnl.sum()))
