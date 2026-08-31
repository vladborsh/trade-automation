"""Shared plumbing for the session-liquidity **v2** descriptive study.

Canonical spec: `knowledge/session-liquidity.md` (v2 reissue) — authoritative
for every definition. This package is a FORK of `research/session-liquidity/`
(phase 1); phase-1 files are never modified and their numbers/definitions are
provisionally invalidated (RESEARCH-LOG.md Запись 11).

What changed here vs the phase-1 `common.py`:
  * SESSIONS are non-overlapping (Asia 00-08, London 08-13, NY 13-21) and a
    fourth residual BLOCK "Late" 21-24 exists that produces no levels;
  * the fixed 2h horizon constants (HORIZON_BARS / CONFIRM_BARS) are GONE —
    every window is block-scoped, see `block_arrays()`;
  * pivots are not computed at all (BoS is out of scope for v2).

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

from indicators import atr  # noqa: E402  the real, un-reimplemented primitive

DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")
VIZ = os.path.join(HERE, "viz")
os.makedirs(RESULTS, exist_ok=True)
os.makedirs(VIZ, exist_ok=True)

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]

# knowledge/session-liquidity.md §Sessions (v2): four contiguous,
# NON-OVERLAPPING UTC blocks partitioning the day. (start_hour, end_hour),
# end exclusive.  "Late" is a residual block: sweeps are measured in it, but it
# defines no levels of its own.
BLOCKS = {
    "Asia":   (0, 8),
    "London": (8, 13),
    "NY":     (13, 21),
    "Late":   (21, 24),
}
BLOCK_ORDER = ["Asia", "London", "NY", "Late"]
# Only these blocks produce session liquidity levels.
LEVEL_SESSIONS = ["Asia", "London", "NY"]

BAR_MIN = 5
LOOKBACK_HOURS = 48      # V8: level lifetime, 48h from session close
ATR_N = 14

# V4: primary tables use events with at least this many bars left in the block.
MIN_BARS_REMAINING = 12  # 12 * 5m = 1h

# Diagnostic only (NOT part of any pinned definition): how far past the block
# end we peek to answer "would this take-out have confirmed if the block had
# not ended?".  Used exclusively for the block-truncation share.
TRUNCATION_PROBE_BARS = 24


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
    """Per-bar block geometry — the backbone of the v2 block-scoped horizon.

    Returns, for every bar i:
      block_id[i]     integer id of the contiguous (date, block) run i sits in
      block_end[i]    index of the LAST bar of that run
      bars_left[i]    block_end[i] - i  (0 on the block's final bar)
      block_complete[i]  False for the run that the data file cuts off, so the
                      engine can drop events whose horizon is truncated by the
                      end of the dataset rather than by the clock.

    "Contiguous run" rather than "hour range" matters: a data gap inside a
    block splits nothing (the run is defined on the bars that exist), but a
    missing block boundary can never leak a horizon into the next day.
    """
    blk = d["block"].to_numpy()
    day = d["ts"].dt.floor("D").to_numpy()
    n = len(d)
    # a new run starts wherever the (day, block) pair changes
    new = np.ones(n, dtype=bool)
    new[1:] = (blk[1:] != blk[:-1]) | (day[1:] != day[:-1])
    block_id = np.cumsum(new) - 1
    # last index of each run
    last_of_run = np.zeros(block_id[-1] + 1, dtype=np.int64)
    idx = np.arange(n)
    np.maximum.at(last_of_run, block_id, idx)
    block_end = last_of_run[block_id]
    bars_left = block_end - idx
    # the final run in the file is assumed truncated by the data, not the clock
    complete = block_id < block_id[-1]
    return dict(block_id=block_id, block_end=block_end,
                bars_left=bars_left, block_complete=complete)


def session_frames(d: pd.DataFrame) -> pd.DataFrame:
    """One row per (UTC date, level-producing session): high/low reached and
    the window bounds.

    A session's level only becomes usable once its window has closed (V1) —
    `known_from` is the first bar strictly after the session's last bar, which
    is what keeps the study free of lookahead. "Late" is skipped: it produces
    no levels (v2 spec).
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
