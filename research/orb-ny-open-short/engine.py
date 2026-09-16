"""The ORB signal engine — `DESIGN.md` §3 (mechanic) and §4 (fills, costs).

Forked from `research/orb-ny-open/engine.py` and **parametrised** per the
follow-up note §7. The one substantive change, and the reason the fork exists:

    the first eligible trigger bar is the 5m bar opening at the RANGE'S END,
    not a hardcoded 10:00 NY.

The closed pass read `C.TRIG_START` (= 10:00) inside `find_trigger` and
`build_arm` regardless of the opening-range width, which is why its own
"15-minute width sensitivity" was a 15-minute range with a 15-minute dead zone
after it rather than a 15-minute ORB. `trig_start` is now an explicit argument
derived from the arm's `or_minutes` and nothing in this file knows a clock
constant other than the ones `common.py` holds.

`walk1m`, the fill conventions, `cost_R`, the stop and the templates are
**verbatim** from the closed pass.

One trade per arm per eligible session day, at most. Signals on the arm's own
resampled 5m bars; the exit path is walked on the **1-minute** tape.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
from numba import njit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

X_TARGET, X_STOP, X_TIME, X_NONE = 0, 1, 2, 3
EXIT_NAME = {X_TARGET: "target", X_STOP: "stop", X_TIME: "time-exit", X_NONE: "no-exit"}


# ==========================================================================
# The 1-minute path walk — DESIGN §4.1, the one fill convention (VERBATIM)
# ==========================================================================
@njit(cache=True, error_model="numpy")
def walk1m(o, h, l, c, b0, b1, side, entry, stop, target):
    """One trade over 1m tape indices [b0, b1] (b0 = the minute AFTER the
    entry minute; b1 = the last minute ending <= 16:00 NY).

      * the stop is checked FIRST on a minute touching both levels;
      * a target fills at its level;
      * a stop the minute GAPPED through fills at that minute's OPEN;
      * no exit by b1 -> forced flat at b1's close (X_TIME).

    `target = +inf` (long) / `-inf` (short) gives template 2, the pure ORB.
    """
    for k in range(b0, b1 + 1):
        if side > 0:
            hit_s = l[k] <= stop
            hit_t = h[k] >= target
            gap = o[k] <= stop
        else:
            hit_s = h[k] >= stop
            hit_t = l[k] <= target
            gap = o[k] >= stop
        if hit_s:
            return k, (o[k] if gap else stop), X_STOP
        if hit_t:
            return k, target, X_TARGET
    if b1 < b0:
        return b0 - 1, entry, X_NONE
    return b1, c[b1], X_TIME


@njit(cache=True, error_model="numpy")
def walk1m_many(o, h, l, c, b0, b1, side, entry, stop, target):
    n = len(b0)
    xi = np.empty(n, np.int64)
    xp = np.empty(n, np.float64)
    xc = np.empty(n, np.int8)
    for i in range(n):
        a, b, d = walk1m(o, h, l, c, b0[i], b1[i], side[i], entry[i], stop[i], target[i])
        xi[i] = a
        xp[i] = b
        xc[i] = d
    return xi, xp, xc


@njit(cache=True, error_model="numpy")
def walk_bar_many(o, h, l, c, b0, b1, side, entry, stop, target):
    """The same convention on the ARM's bars, for the DESIGN §9 stop rule: on
    a trade that neither gaps nor touches both levels inside one bar, the
    1m-path fill and the bar-OHLC fill must agree exactly."""
    return walk1m_many(o, h, l, c, b0, b1, side, entry, stop, target)


@njit(cache=True, error_model="numpy")
def path_flags(o, h, l, c, b0, b1, side, stop, target):
    """Per-trade diagnostics for the §9 agreement rule, on the ARM's bars:
    did any live bar touch BOTH levels, and did the exit bar gap the stop?"""
    n = len(b0)
    both = np.zeros(n, np.int8)
    gapped = np.zeros(n, np.int8)
    for i in range(n):
        for k in range(b0[i], b1[i] + 1):
            if side[i] > 0:
                hs = l[k] <= stop[i]
                ht = h[k] >= target[i]
                gp = o[k] <= stop[i]
            else:
                hs = h[k] >= stop[i]
                ht = l[k] <= target[i]
                gp = o[k] >= stop[i]
            if hs and ht:
                both[i] = 1
            if hs:
                if gp:
                    gapped[i] = 1
                break
            if ht:
                break
    return both, gapped


# ==========================================================================
# Tape container
# ==========================================================================
class Tape:
    """The 1m tape plus its 5m resampling. One per instrument."""

    _cache: dict = {}

    def __init__(self, symbol: str):
        self.symbol = symbol
        self.venue = C.VENUE[symbol]
        df = C.load_1m(symbol)
        self.df = df
        self.t = df.t_ms.values.astype(np.int64)
        self.o = df.open.values.astype(np.float64)
        self.h = df.high.values.astype(np.float64)
        self.l = df.low.values.astype(np.float64)
        self.c = df.close.values.astype(np.float64)
        self.v = df.volume.values.astype(np.float64)
        self.spread = (df.spread_close.values.astype(np.float64)
                       if "spread_close" in df.columns else None)
        self.n = len(df)
        self.bars = {}
        for tf in C.TFS:
            b = C.resample(df, tf)
            self.bars[tf] = dict(
                t=b.t_ms.values.astype(np.int64),
                o=b.open.values.astype(np.float64),
                h=b.high.values.astype(np.float64),
                l=b.low.values.astype(np.float64),
                c=b.close.values.astype(np.float64),
                v=b.volume.values.astype(np.float64),
                i_last=b.i_last.values.astype(np.int64),
                i_first=b.i_first.values.astype(np.int64),
                n=len(b),
            )

    @classmethod
    def get(cls, symbol: str) -> "Tape":
        if symbol not in cls._cache:
            cls._cache[symbol] = Tape(symbol)
        return cls._cache[symbol]


# ==========================================================================
# Opening range and trigger — DESIGN §3
# ==========================================================================
def opening_range(tp: Tape, date: str, or_minutes: int) -> dict | None:
    """OR = min low / max high of the 1m bars with open time in
    [09:30, 09:30+or_minutes) NY. Returns None when the day is not eligible:
    one of the `or_minutes/5` five-minute bins inside the range carries no 1m
    bar (§3.1 completeness rule, which scales with the width — 1, 2 or 3 bins
    for OR5 / OR10 / OR15)."""
    t0 = C.ny_ms(date, *C.OR_START)
    t1 = t0 + or_minutes * C.MIN_MS
    a = np.searchsorted(tp.t, t0, "left")
    b = np.searchsorted(tp.t, t1, "left")
    if b <= a:
        return None
    seg = tp.t[a:b]
    nbins = or_minutes // 5
    occupied = np.unique((seg - t0) // (5 * C.MIN_MS))
    if len(occupied) < nbins:
        return None
    return dict(
        or_high=float(tp.h[a:b].max()),
        or_low=float(tp.l[a:b].min()),
        i_or0=int(a), i_or1=int(b - 1),
        t_or0=int(t0), t_or1=int(t1),
        or_vol=float(tp.v[a:b].sum()),
        or_open=float(tp.o[a]), or_close=float(tp.c[b - 1]),
    )


def find_trigger(tp: Tape, tf: int, date: str, orr: dict, trig_start,
                 trig_end=C.TRIG_END_BASE) -> dict | None:
    """First arm bar OPENING in [trig_start, trig_end) NY whose CLOSE is
    strictly beyond the range (§3.2). `trig_start` is the arm's RANGE END —
    09:35 / 09:40 / 09:45. Close-beyond, never touch. One per day."""
    B = tp.bars[tf]
    t0 = C.ny_ms(date, *trig_start)
    t1 = C.ny_ms(date, *trig_end)
    a = np.searchsorted(B["t"], t0, "left")
    b = np.searchsorted(B["t"], t1, "left")
    for j in range(a, b):
        cl = B["c"][j]
        if cl > orr["or_high"]:
            side = 1
        elif cl < orr["or_low"]:
            side = -1
        else:
            continue
        return dict(j=int(j), side=side, entry=float(cl),
                    t_sig=int(B["t"][j]),
                    i_entry_min=int(B["i_last"][j]))
    return None


def flat_index(tp: Tape, date: str) -> int:
    """Tape index of the last 1m bar ENDING <= 16:00 NY, i.e. the last bar with
    open time < 16:00 NY (§3.4 forced flat)."""
    tf = C.ny_ms(date, *C.FLAT)
    return int(np.searchsorted(tp.t, tf, "left") - 1)


# ==========================================================================
# Costs — DESIGN §5 (VERBATIM)
# ==========================================================================
def cost_R(venue: str, tp: Tape, i_in, i_out, entry, dist, mode="base",
           fixed_spread=None):
    """Capital.com: half the ENTRY minute's `spread_close` + half the EXIT
    minute's, in price, over `stop_dist`. Slippage is not modelled anywhere.

    With the stop at the far side of a 5-, 10- or 15-minute range, `stop_dist`
    is several times smaller than in the closed pass, so `cost_R` is several
    times larger (note §4.5). That is a property of the mechanic, not of the
    cost model, which is unchanged.
    """
    sp_in = tp.spread[i_in]
    sp_out = tp.spread[i_out]
    if mode == "fixed":
        sp_in = sp_out = np.full(len(np.atleast_1d(i_in)), float(fixed_spread))
    px = (sp_in + sp_out) / 2.0
    if mode == "double":
        px = px * 2.0
    return px / dist


# ==========================================================================
# The per-arm trade table
# ==========================================================================
def build_arm(symbol: str, or_minutes: int, days: list[str], tf: int = C.TF,
              trig_end=C.TRIG_END_BASE, stop_mode: str = "range",
              max_trades_per_day: int = 1) -> pd.DataFrame:
    """One row per TRIGGERED day. Days that were eligible but produced no
    trigger are counted by `eligibility()`, not represented here.

    The trigger window opens at the arm's own range end — `C.trig_start(
    or_minutes)` — and closes at `trig_end`.

    stop_mode          'range' (pre-registered) | 'mid' (S3' sensitivity)
    max_trades_per_day 1 (pre-registered) | 2 (S4' re-entry sensitivity)
    """
    tp = Tape.get(symbol)
    B = tp.bars[tf]
    t_start = C.trig_start(or_minutes)
    rows = []
    for date in days:
        orr = opening_range(tp, date, or_minutes)
        if orr is None:
            continue
        i_flat = flat_index(tp, date)
        if i_flat <= orr["i_or1"]:
            continue
        t_trig1 = C.ny_ms(date, *trig_end)
        j_from = np.searchsorted(B["t"], C.ny_ms(date, *t_start), "left")
        j_to = np.searchsorted(B["t"], t_trig1, "left")
        taken = 0
        j = j_from
        while j < j_to and taken < max_trades_per_day:
            cl = B["c"][j]
            if cl > orr["or_high"]:
                side = 1
            elif cl < orr["or_low"]:
                side = -1
            else:
                j += 1
                continue
            entry = float(cl)
            if stop_mode == "mid":
                stop = (orr["or_high"] + orr["or_low"]) / 2.0
            else:
                stop = orr["or_low"] if side > 0 else orr["or_high"]
            dist = abs(entry - stop)
            i_ent = int(B["i_last"][j])
            if dist <= 0 or i_ent >= i_flat:
                j += 1
                continue
            rows.append(dict(
                date=date, symbol=symbol, tf=tf, or_min=or_minutes,
                j=int(j), side=side,
                t_sig=int(B["t"][j]), entry=entry, stop=float(stop),
                stop_dist=float(dist), i_entry_min=i_ent, i_flat=int(i_flat),
                or_high=orr["or_high"], or_low=orr["or_low"],
                i_or0=orr["i_or0"], i_or1=orr["i_or1"], or_vol=orr["or_vol"],
                or_open=orr["or_open"], or_close=orr["or_close"],
                seq=taken,
            ))
            taken += 1
            if taken >= max_trades_per_day:
                break
            # re-entry sensitivity only: resume after this trade's exit bar
            j = _next_bar_after_exit(tp, B, rows[-1], j_to)
        # (loop ends)
    if not rows:
        return pd.DataFrame()
    q = pd.DataFrame(rows)
    return _evaluate(tp, q)


def _next_bar_after_exit(tp: Tape, B, row, j_to) -> int:
    """Used only by the S4' re-entry sensitivity: the first arm bar opening
    strictly after the previous trade's exit minute."""
    side = row["side"]
    tgt = row["entry"] + side * row["stop_dist"]
    xi, _, _ = walk1m(tp.o, tp.h, tp.l, tp.c, row["i_entry_min"] + 1, row["i_flat"],
                      side, row["entry"], row["stop"], tgt)
    return int(np.searchsorted(B["t"], tp.t[xi], "right"))


def _evaluate(tp: Tape, q: pd.DataFrame) -> pd.DataFrame:
    """Walk both templates on the 1m path, apply costs, label the split."""
    side = q.side.values.astype(np.int64)
    entry = q.entry.values
    stop = q.stop.values
    dist = q.stop_dist.values
    b0 = (q.i_entry_min.values + 1).astype(np.int64)
    b1 = q.i_flat.values.astype(np.int64)
    inf = np.where(side > 0, np.inf, -np.inf)
    for num, tgt in ((1, entry + side * dist), (2, inf)):
        xi, xp, xc = walk1m_many(tp.o, tp.h, tp.l, tp.c, b0, b1, side, entry, stop, tgt)
        q[f"i_exit_{num}"] = xi
        q[f"exit_px_{num}"] = xp
        q[f"exit_{num}"] = [EXIT_NAME[int(x)] for x in xc]
        q[f"grossR_{num}"] = side * (xp - entry) / dist
        ix = np.clip(xi, 0, tp.n - 1)
        q[f"cost_R_{num}"] = cost_R(tp.venue, tp, q.i_entry_min.values, ix, entry, dist)
        q[f"netR_{num}"] = q[f"grossR_{num}"] - q[f"cost_R_{num}"]
    # cost sensitivity (non-gating), template 1 only
    ix1 = np.clip(q.i_exit_1.values, 0, tp.n - 1)
    q["netR_1_2x"] = q.grossR_1 - cost_R(tp.venue, tp, q.i_entry_min.values, ix1,
                                         entry, dist, "double")
    q["hold_min"] = (tp.t[ix1] - tp.t[q.i_entry_min.values]) / C.MIN_MS
    q["period"] = C.period_of(q.date.values)
    q["arm"] = [C.arm_name(s, w) for s, w in zip(q.symbol, q.or_min)]
    return q


def eligibility(symbol: str, or_minutes: int, days: list[str], tf: int = C.TF,
                trig_end=C.TRIG_END_BASE) -> pd.DataFrame:
    """One row per calendar day in `days`, with the reason it did or did not
    produce a trade. The exclusions row of the REPORT is built from this."""
    tp = Tape.get(symbol)
    t_start = C.trig_start(or_minutes)
    out = []
    for date in days:
        orr = opening_range(tp, date, or_minutes)
        if orr is None:
            out.append(dict(date=date, eligible=False, reason="incomplete opening range",
                            triggered=False))
            continue
        i_flat = flat_index(tp, date)
        if i_flat <= orr["i_or1"]:
            out.append(dict(date=date, eligible=False, reason="no session after the range",
                            triggered=False))
            continue
        tr = find_trigger(tp, tf, date, orr, t_start, trig_end)
        out.append(dict(date=date, eligible=True, reason="",
                        triggered=tr is not None,
                        side=(tr["side"] if tr else 0),
                        or_width=orr["or_high"] - orr["or_low"],
                        tod_min=((tr["t_sig"] - C.ny_ms(date, *C.OR_START)) / C.MIN_MS
                                 if tr else np.nan)))
    return pd.DataFrame(out)
