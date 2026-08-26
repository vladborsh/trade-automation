"""Shared plumbing for the derivatives-positioning pass (DESIGN.md §1–§2).

Imports the v1 modules (indicators / strategies / backtest) and v2's
`strategies_v2` unchanged, so `momentum_breakout` here is byte-identical to the
one in `research/intraday-mr-smc-v2/REPORT.md` §2.3. Nothing in v1/v2/mtf is
modified by this package.

Decision timeframe is 1h, derived from the intraday-mtf-smc 5m pull by the same
resampler (`mtf.resample_h1`) — DESIGN.md §1.
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
V1 = os.path.abspath(os.path.join(HERE, "..", "intraday-mr-smc"))
V2 = os.path.abspath(os.path.join(HERE, "..", "intraday-mr-smc-v2"))
MTF = os.path.abspath(os.path.join(HERE, "..", "intraday-mtf-smc"))
# APPEND, never insert(0): intraday-mtf-smc also has `common.py`/`prep.py`, and
# this package's own modules must win the name race.
if HERE not in sys.path:
    sys.path.insert(0, HERE)
for p in (V1, V2, MTF):
    if p not in sys.path:
        sys.path.append(p)

import indicators as ind          # noqa: E402
import strategies as st           # noqa: E402
import strategies_v2 as sv        # noqa: E402
import backtest as bt             # noqa: E402

DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")
CACHE = os.path.join(HERE, "cache")
for d in (DATA, OUT, CACHE):
    os.makedirs(d, exist_ok=True)

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
           "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]

# DESIGN.md §6
FIT = ("2022-08-01", "2025-04-01")
HOLD = ("2025-04-01", "2026-08-01")

# §6 window-adjustment clause ("adjusted per-symbol to metrics coverage from
# stage 0"), applied per HYPOTHESIS. Architect ruling of 2026-08-26, made at
# stage 0 before any stage-1 number existed (see REPORT.md §1.4): both
# top-trader ratio columns are effectively empty before 2022-12-01, identically
# for all 8 symbols, so hypothesis (b1) — and ONLY (b1) — runs on an effective
# fit window that starts at coverage-start + the pre-committed 15-day
# min_periods. Holdout is unchanged for all three. Nothing else moves.
FIT_B1 = ("2022-12-16", "2025-04-01")
FIT_BY_HYP = {"a": FIT, "b1": FIT_B1, "b2": FIT}
HOLD_BY_HYP = {"a": HOLD, "b1": HOLD, "b2": HOLD}


def hyp_of(name: str) -> str:
    """Map a rule-set/event name to its hypothesis key."""
    if name.startswith("b1"):
        return "b1"
    if name.startswith("b2"):
        return "b2"
    return "a"


def fit_win(name: str):
    return FIT_BY_HYP[hyp_of(name)]

COST_RT = 0.0010          # 10 bp round-trip (5 bp/side), same as every prior pass

# DESIGN.md §3: momentum_breakout exactly as v2 defaults. NOT re-tuned.
P = dict(st.DEFAULTS)
P.update(sv.EXTRA_DEFAULTS)       # mom_rr=1.5, brk_z=2.0
P.update(htf_mult=12)             # 5m -> 1h resample multiple (mtf.P)
#   -> mr_len 50, mr_z 2.0, atr_len 14, stop_atr 1.5, time_stop 24, brk_z 2.0

# DESIGN.md §2 — percentile windows. FIXED, no sweep.
PCT_WIN = 720             # 30 days of 1h bars
PCT_MIN = 360             # min_periods = 15 days

# DESIGN.md §4 — event thresholds. FIXED, no sweep.
EXTREME = 95              # percentile threshold for crowd / taker
EXTREME_SENS = 90         # pre-registered sensitivity row, never promoted
BREAK_N = 12              # bars in the adverse-break / continuation lookback
STOP_BUF = 0.25           # x ATR buffer on the structural stop
EVENT_RR = 3.0            # fixed 3R target
EVENT_TIME_STOP = 48      # 1h bars

METRIC_COLS = ["sum_open_interest", "sum_open_interest_value",
               "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio",
               "count_long_short_ratio", "sum_taker_long_short_vol_ratio"]


# ------------------------------------------------------------------ loading
def load_5m(sym: str) -> pd.DataFrame:
    f = os.path.join(DATA, f"{sym}-5m.csv.gz")
    if not os.path.exists(f):
        raise SystemExit(f"missing {f} -- symlink the intraday-mtf-smc 5m pull")
    return pd.read_csv(f, parse_dates=["ts"])


def load_metrics(sym: str) -> pd.DataFrame:
    f = os.path.join(DATA, f"{sym}-metrics.csv.gz")
    if not os.path.exists(f):
        raise SystemExit(f"missing {f} -- run fetch_metrics.py")
    m = pd.read_csv(f, parse_dates=["ts"])
    return m.sort_values("ts").reset_index(drop=True)


def resample_h1(d5: pd.DataFrame) -> pd.DataFrame:
    """5m -> 1h OHLCV, left-labelled, via the mtf resampler's exact rule."""
    rule = st._htf_rule(d5, P["htf_mult"])
    return (d5.set_index("ts").resample(rule)
              .agg({"open": "first", "high": "max", "low": "min",
                    "close": "last", "volume": "sum"})
              .dropna().reset_index())


def slice_period(d: pd.DataFrame, start=None, end=None) -> pd.DataFrame:
    m = pd.Series(True, index=d.index)
    if start is not None:
        m &= d.ts >= pd.Timestamp(start, tz="UTC")
    if end is not None:
        m &= d.ts < pd.Timestamp(end, tz="UTC")
    return d.loc[m].reset_index(drop=True)


def window_mask(d: pd.DataFrame, win) -> np.ndarray:
    lo = pd.Timestamp(win[0], tz="UTC"); hi = pd.Timestamp(win[1], tz="UTC")
    return ((d.ts >= lo) & (d.ts < hi)).to_numpy()


# ------------------------------------------------- gap handling (DESIGN §1.2)
def metrics_grid(m: pd.DataFrame):
    """Reindex metrics onto the complete 5m grid over their own coverage and
    apply the pre-committed gap rule:

      * a single missing 5m row (gap <= 5 min of absence) is forward-filled;
      * any longer run of missing rows is left NaN and flagged `long_gap`.

    No interpolation, ever. Returns (grid, long_gap_mask).
    """
    m = m.drop_duplicates(subset="ts", keep="first").set_index("ts").sort_index()
    full = pd.date_range(m.index[0], m.index[-1], freq="5min", tz="UTC")
    g = m.reindex(full)
    present = g[METRIC_COLS[0]].notna().to_numpy()

    # length of the run of consecutive absences each missing row belongs to
    long_gap = np.zeros(len(g), dtype=bool)
    i = 0
    while i < len(g):
        if present[i]:
            i += 1
            continue
        j = i
        while j < len(g) and not present[j]:
            j += 1
        if (j - i) > 1:                 # 2+ consecutive missing rows = > 5 min
            long_gap[i:j] = True
        i = j
    g = g[METRIC_COLS].ffill(limit=1)   # single-row holes only
    g.index.name = "ts"
    return g, long_gap


def rolling_pct(s: pd.Series, win: int = PCT_WIN, mp: int = PCT_MIN) -> pd.Series:
    """Trailing rolling percentile (0-100) of the current value within its own
    trailing window, current value included. Causal by construction."""
    return s.rolling(win, min_periods=mp).rank(pct=True) * 100.0
