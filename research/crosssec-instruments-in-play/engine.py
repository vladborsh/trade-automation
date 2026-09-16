"""§8.2.4 — the leg engine.

Evaluates the §4 reader + §5 stop/exit for EVERY eligible (symbol, anchor day)
in the panel, once. The selection (§8.2.3) then only indexes into this table,
which is what makes the 1,000-draw random-k null, the bottom-5 null, the
deciles and every sensitivity an index lookup rather than a re-run.

Fill convention verbatim from `research/orb-ny-open/engine.py:walk1m` with
target = +-inf (§5.3): the stop is checked first, a stop the minute gapped
through fills at that minute's open, no exit by the horizon fills at the last
path bar's close. Missing minutes inside the path are skipped, not filled.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
from numba import njit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

X_STOP, X_TIME, X_NONE = 1, 2, 3
EXIT_NAME = {X_STOP: "stop", X_TIME: "time-exit", X_NONE: "no-path"}


@njit(cache=True, error_model="numpy")
def walk_many(o, h, l, c, b0, b1, side, entry, stop):
    """orb-ny-open/engine.py:walk1m, target removed (never hit)."""
    n = len(b0)
    xi = np.empty(n, np.int64)
    xp = np.empty(n, np.float64)
    xc = np.empty(n, np.int8)
    for i in range(n):
        a, b = b0[i], b1[i]
        if b < a:
            xi[i] = a - 1
            xp[i] = entry[i]
            xc[i] = 3
            continue
        done = False
        for k in range(a, b + 1):
            if side[i] > 0:
                hit = l[k] <= stop[i]
                gap = o[k] <= stop[i]
            else:
                hit = h[k] >= stop[i]
                gap = o[k] >= stop[i]
            if hit:
                xi[i] = k
                xp[i] = o[k] if gap else stop[i]
                xc[i] = 1
                done = True
                break
        if not done:
            xi[i] = b
            xp[i] = c[b]
            xc[i] = 2
    return xi, xp, xc


def legs_for_symbol(sym: str, pan: pd.DataFrame, stop_mult: float = C.STOP_GATE,
                    rt: float = C.BINANCE_RT, window_min: int = C.WINDOW_MIN,
                    horizon_min: int = C.HORIZON_MIN,
                    side_override: np.ndarray | None = None) -> pd.DataFrame:
    """One row per eligible (symbol, day). `pan` must be this symbol's panel
    slice, already restricted to eligible rows with r30 != 0.

    `horizon_min` / `side_override` exist only for the §11 fit-only
    sensitivities (the +2 h and 16:00 NY horizons, the signed-TR24 direction);
    the gating cell uses the defaults."""
    p = os.path.join(C.DATA_1M, f"{sym}.parquet")
    tp = pd.read_parquet(p).drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
    o, h, l, c = (tp.open.values, tp.high.values, tp.low.values, tp.close.values)
    t = tp.t_ms.values.astype(np.int64)

    side = (np.where(pan.r30.values > 0, 1, -1) if side_override is None
            else np.where(np.asarray(side_override) > 0, 1, -1)).astype(np.int64)
    entry = pan.entry.values.astype(float)
    dist = stop_mult * pan.datr14.values.astype(float)
    stop = entry - side * dist
    # the path window is recomputed from the tape so that a non-default
    # horizon needs no second panel build
    a = pan.anchor_ms.values.astype(np.int64) + window_min * C.MIN_MS
    b0 = np.searchsorted(t, a, "left").astype(np.int64)
    b1 = (np.searchsorted(t, a + horizon_min * C.MIN_MS, "left") - 1).astype(np.int64)

    xi, xp, xc = walk_many(o, h, l, c, b0, b1, side, entry, stop)
    grossR = side * (xp - entry) / dist
    cR = C.cost_R(entry, dist, rt)
    out = pd.DataFrame(dict(
        symbol=sym, date=pan.date.values, anchor_ms=pan.anchor_ms.values,
        side=side, entry=entry, stop=stop, stop_dist=dist,
        exit_px=xp, exit_ms=t[np.clip(xi, 0, len(t) - 1)],
        exit_cause=xc, grossR=grossR, cost_R=cR, netR=grossR - cR,
        datr14=pan.datr14.values, r30=pan.r30.values,
        rvol=pan.rvol.values, tr24=pan.tr24.values,
        v30=pan.v30.values, liq_med=pan.liq_med.values,
        path_missing=horizon_min - np.maximum(b1 - b0 + 1, 0),
        delist_days_after=pan.delist_days_after.values,
    ))
    out["exit_min"] = (out.exit_ms - out.anchor_ms) / C.MIN_MS
    return out
