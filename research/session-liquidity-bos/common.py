"""Shared plumbing for the session-liquidity **BoS** pass.

Canonical spec: `knowledge/session-liquidity.md` — authoritative for every
definition. This pass implements §5.2's *corrected* BoS mechanic (pinned in
`DESIGN.md` §1, derived from
`research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md`) and measures
it under the v4-era conventions (§1/§3/§4/§6/§8).

This file is a FORK of `research/session-liquidity-v4/common.py` and is
**behaviourally identical to it** — sessions, blocks, the block-scoped horizon
geometry, level admission and ATR units are unchanged, because only the
*confirmation layer* differs between passes. It is forked rather than imported
so this package stands on its own and an edit here can never reach back into
v2/v3/v4.

The one addition over v4's copy is the **k=3 fractal pivot layer** (`pivots`):
the corrected BoS mechanic anchors on a confirmed opposing pivot, and that
primitive comes from `research/intraday-mr-smc/indicators.py` verbatim —
never re-implemented here.

Data: the already-cached Binance USD-M perp 5m klines pulled by
`research/intraday-mtf-smc/fetch_mtf.py`, reached through the `data/` symlink.
No new data pull.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
V1 = os.path.join(REPO, "research", "intraday-mr-smc")
if V1 not in sys.path:
    sys.path.insert(0, V1)

from indicators import atr, fractals  # noqa: E402  the real, un-reimplemented primitives

DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")
VIZ = os.path.join(HERE, "viz")
os.makedirs(RESULTS, exist_ok=True)
os.makedirs(VIZ, exist_ok=True)

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]

# knowledge/session-liquidity.md §1: four contiguous, NON-OVERLAPPING UTC
# blocks partitioning the day. (start_hour, end_hour), end exclusive. "Late" is
# a residual block: sweeps are measured in it, but it defines no levels.
BLOCKS = {
    "Asia":   (0, 8),
    "London": (8, 13),
    "NY":     (13, 21),
    "Late":   (21, 24),
}
BLOCK_ORDER = ["Asia", "London", "NY", "Late"]
LEVEL_SESSIONS = ["Asia", "London", "NY"]

BAR_MIN = 5
LOOKBACK_HOURS = 48      # V8: level lifetime, 48h from session close
ATR_N = 14

# V4: primary tables use events with at least this many bars left in the block.
MIN_BARS_REMAINING = 12  # 12 * 5m = 1h

# Diagnostic only (NOT part of any definition): how far past the block end we
# peek to answer "would this take-out have confirmed if the block had not
# ended?". Used exclusively for the block-truncation share.
TRUNCATION_PROBE_BARS = 24

# DESIGN.md §1: the pivot half-width the BoS anchor is selected from. This is
# the SPEC value (phase 1 used the same k=3), not a tunable.
PIVOT_K = 3

# Diagnostic only: a "stale anchor" sensitivity bound, in bars. The pinned
# mechanic searches back without limit (DESIGN.md §1 pin 4 defines
# unanchorable as "no qualifying confirmed pivot exists", full stop); this
# constant only labels how old the chosen anchor is, it never rejects one.
STALE_ANCHOR_BARS = int(LOOKBACK_HOURS * 60 / BAR_MIN)   # 576 bars = 48h


def load(sym: str, iv: str = "5m") -> pd.DataFrame:
    f = os.path.join(DATA, f"{sym}-{iv}.csv.gz")
    if not os.path.exists(f):
        raise SystemExit(f"missing {f} (data/ symlink -> intraday-mtf-smc/data)")
    d = pd.read_csv(f)
    d["ts"] = pd.to_datetime(d["ts"], utc=True)
    return d.sort_values("ts").reset_index(drop=True)


def prep(d: pd.DataFrame) -> pd.DataFrame:
    """Attach the causal columns every downstream step needs.

    ATR(14) is read AS OF the bar it is attached to — never over the forward
    window — which is what keeps the unit causal.
    """
    d = d.copy()
    d["atr"] = atr(d, ATR_N)
    d["month"] = d["ts"].dt.strftime("%Y-%m")
    d["block"] = block_label_series(d["ts"])
    return d


def pivots(d: pd.DataFrame, k: int = PIVOT_K) -> dict[str, np.ndarray]:
    """k=3 fractal pivots, in the two forms the BoS anchor needs.

    `fractals(d, k)` returns flags ALREADY SHIFTED by k, i.e. the flag on bar
    `j` says "the pivot at bar `j - k` is now confirmed". That shift is what
    makes the primitive causal, and this pass depends on it: DESIGN.md §1
    pin 1 selects "the most recent pivot confirmed AS OF `t0`", which is
    exactly "the latest `j <= t0` carrying a flag".

    Returns, per bar `j`:
      hi_conf / lo_conf   a pivot high / low is CONFIRMED on bar j
      hi_px   / lo_px     that pivot's price (the extreme of bar j - k)
      hi_bar  / lo_bar    that pivot's own bar index (j - k), -1 where no flag

    Note the arithmetic consequence, recorded here because DESIGN.md §1 pin 1
    lists it as a second condition: confirmation bar `j <= t0` forces pivot bar
    `j - k <= t0 - k < t0`, so "pivot bar strictly before t0" is IMPLIED by
    "confirmed as of t0" for any k >= 1. The condition is still asserted
    explicitly in `checks.py` rather than assumed away.
    """
    sh, sl = fractals(d, k)
    hi_conf = sh.fillna(False).to_numpy()
    lo_conf = sl.fillna(False).to_numpy()
    hi_px = d["high"].shift(k).where(pd.Series(hi_conf, index=d.index)).to_numpy()
    lo_px = d["low"].shift(k).where(pd.Series(lo_conf, index=d.index)).to_numpy()
    n = len(d)
    idx = np.arange(n)
    hi_bar = np.where(hi_conf, idx - k, -1)
    lo_bar = np.where(lo_conf, idx - k, -1)
    return dict(hi_conf=hi_conf, lo_conf=lo_conf, hi_px=hi_px, lo_px=lo_px,
                hi_bar=hi_bar, lo_bar=lo_bar)


def block_label_series(ts: pd.Series) -> pd.Series:
    """Vectorised block label for a timestamp column. The partition is total:
    every bar belongs to exactly one block."""
    h = ts.dt.hour
    out = pd.Series("Late", index=ts.index, dtype=object)
    out[h < 21] = "NY"
    out[h < 13] = "London"
    out[h < 8] = "Asia"
    return out


def block_arrays(d: pd.DataFrame) -> dict[str, np.ndarray]:
    """Per-bar block geometry — the backbone of the block-scoped horizon.

    Returns, for every bar i:
      block_id[i]     integer id of the contiguous (date, block) run i sits in
      block_end[i]    index of the LAST bar of that run
      bars_left[i]    block_end[i] - i  (0 on the block's final bar)
      block_complete[i]  False for the run that the data file cuts off, so the
                      engine can drop events whose horizon is truncated by the
                      end of the dataset rather than by the clock.
    """
    blk = d["block"].to_numpy()
    day = d["ts"].dt.floor("D").to_numpy()
    n = len(d)
    new = np.ones(n, dtype=bool)
    new[1:] = (blk[1:] != blk[:-1]) | (day[1:] != day[:-1])
    block_id = np.cumsum(new) - 1
    last_of_run = np.zeros(block_id[-1] + 1, dtype=np.int64)
    idx = np.arange(n)
    np.maximum.at(last_of_run, block_id, idx)
    block_end = last_of_run[block_id]
    bars_left = block_end - idx
    complete = block_id < block_id[-1]
    return dict(block_id=block_id, block_end=block_end,
                bars_left=bars_left, block_complete=complete)


def session_frames(d: pd.DataFrame) -> pd.DataFrame:
    """One row per (UTC date, level-producing session): high/low reached and
    the window bounds.

    A session's level only becomes usable once its window has closed (V1) —
    `known_from` is the first bar strictly after the session's last bar, which
    is what keeps the study free of lookahead. "Late" is skipped: it produces
    no levels.
    """
    hours = d["ts"].dt.hour.to_numpy()
    day = d["ts"].dt.floor("D")
    rows = []
    for name in LEVEL_SESSIONS:
        h0, h1 = BLOCKS[name]
        m = (hours >= h0) & (hours < h1)
        sub = d.loc[m, ["ts", "high", "low"]].copy()
        sub["day"] = day[m]
        g = sub.groupby("day", sort=True)
        agg = g.agg(high=("high", "max"), low=("low", "min"),
                    t_start=("ts", "min"), t_end=("ts", "max")).reset_index()
        agg["session"] = name
        rows.append(agg)
    s = pd.concat(rows, ignore_index=True)
    idx_of_ts = pd.Series(np.arange(len(d)), index=d["ts"])
    s["end_idx"] = s["t_end"].map(idx_of_ts).astype("int64")
    s["known_from"] = s["end_idx"] + 1
    s = s.sort_values(["t_end", "session"]).reset_index(drop=True)
    return s
