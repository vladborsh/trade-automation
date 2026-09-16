"""The ORB signal engine — `DESIGN.md` §3 (mechanic) and §4 (fills, costs).

Forked from `research/orb-ny-open/engine.py`. The logic of the mechanic is
**unchanged**; the only structural difference is that the session anchor is a
**parameter** rather than the hardcoded 09:30 NY constant, so that the three
fit-only placebo-anchor rows of `DESIGN.md` §8.3 run through the same code
path as the registered 00:00 UTC arms and cannot silently differ from them.

One trade per arm per eligible session day, at most. Signals on the arm's own
resampled bars; the exit path is walked on the **1-minute** tape (§4.1).

No threshold, split or verdict constant lives here — those are in `common.py`
and all of them come from `ARCHITECT-NOTE-CRYPTO-INVESTIGATION.md`.
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

OR_MINUTES_DEFAULT = 30
TRIG_MINUTES = 120                 # the 2-hour trigger window, §3.2
HOLD_MINUTES = 7 * 60 + 55         # anchor -> forced flat, §3.4


# ==========================================================================
# Clock helpers — DESIGN §3.4. The anchor is a parameter; everything else is
# derived from it, so a placebo row cannot accidentally get a different rule.
# ==========================================================================
def anchor_ms(date: str, anchor=C.ANCHOR) -> int:
    return C.utc_ms(date, *anchor)


def flat_ms(date: str, anchor=C.ANCHOR) -> int:
    """Forced flat = anchor + 7 h 55 m, capped at five minutes before the next
    Binance 8-hour funding settlement (00:00 / 08:00 / 16:00 UTC).

    For all four anchors used in this package (00, 04, 08, 16 UTC) the two
    clauses coincide or the funding clause binds, and **no position is ever
    open at a funding timestamp** — `checks.py:check_funding` asserts it.
    """
    a = anchor_ms(date, anchor)
    cap = a + HOLD_MINUTES * C.MIN_MS
    for hh, mm in C.FUNDING_UTC:
        for shift in (0, C.DAY_MS):
            t = C.utc_ms(date, hh, mm) + shift
            if t > a:
                cap = min(cap, t - 5 * C.MIN_MS)
                break
    return cap


# ==========================================================================
# The 1-minute path walk — DESIGN §4.1, the one fill convention. VERBATIM
# from the closed pass.
# ==========================================================================
@njit(cache=True, error_model="numpy")
def walk1m(o, h, l, c, b0, b1, side, entry, stop, target):
    """One trade over 1m tape indices [b0, b1] (b0 = the minute AFTER the
    entry minute; b1 = the last minute ending <= the forced-flat time).

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
    """The same convention on the ARM's bars, for the DESIGN §12 stop rule: on
    a trade that neither gaps nor touches both levels inside one bar, the
    1m-path fill and the bar-OHLC fill must agree exactly."""
    return walk1m_many(o, h, l, c, b0, b1, side, entry, stop, target)


@njit(cache=True, error_model="numpy")
def path_flags(o, h, l, c, b0, b1, side, stop, target):
    """Per-trade diagnostics for the §12 agreement rule, on the ARM's bars:
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
    """The 1m tape plus its resamplings. One per instrument."""

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
def opening_range(tp: Tape, date: str, or_minutes: int = OR_MINUTES_DEFAULT,
                  anchor=C.ANCHOR) -> dict | None:
    """OR = min low / max high of the 1m bars with open time in
    [anchor, anchor+or_minutes) UTC. Returns None when the day is not
    eligible: fewer than `or_minutes/5` of the five-minute bins carry a 1m bar
    (§3.1 completeness rule, scaled with the width for the §8.4 sensitivity).

    This is the ONLY thing that removes a calendar day from an arm — there is
    no holiday calendar and no weekday filter (§3.1)."""
    t0 = anchor_ms(date, anchor)
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


def trig_bounds(date: str, anchor=C.ANCHOR, or_minutes: int = OR_MINUTES_DEFAULT):
    """[first eligible trigger-bar open, cutoff) in epoch ms. The window opens
    at the end of the range and lasts `TRIG_MINUTES`; at the registered width
    that is exactly [00:30, 02:30) UTC (§3.2)."""
    t0 = anchor_ms(date, anchor) + or_minutes * C.MIN_MS
    return t0, t0 + TRIG_MINUTES * C.MIN_MS


def find_trigger(tp: Tape, tf: int, date: str, orr: dict, anchor=C.ANCHOR,
                 or_minutes: int = OR_MINUTES_DEFAULT) -> dict | None:
    """First arm bar OPENING in the trigger window whose CLOSE is strictly
    beyond the range (§3.2). Close-beyond, never touch. One per day."""
    B = tp.bars[tf]
    t0, t1 = trig_bounds(date, anchor, or_minutes)
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


def flat_index(tp: Tape, date: str, anchor=C.ANCHOR) -> int:
    """Tape index of the last 1m bar ENDING <= the forced-flat time, i.e. the
    last bar with open time < that time (§3.4)."""
    return int(np.searchsorted(tp.t, flat_ms(date, anchor), "left") - 1)


# ==========================================================================
# Costs — DESIGN §5. Binance only in this package.
# ==========================================================================
COST_RT = {"base": C.BINANCE_RT, "maker": C.BINANCE_RT_MAKER, "x2": C.BINANCE_RT_2X}


def cost_R(venue: str, tp: Tape, i_in, i_out, entry, dist, mode="base"):
    """Binance: a flat round-trip fee on notional, over `stop_dist`.
    `cost_R = rt * entry / stop_dist`. Slippage is not modelled anywhere —
    see `REPORT.md` §0 for what that means in this window."""
    return COST_RT[mode] * entry / dist


# ==========================================================================
# The per-arm trade table
# ==========================================================================
def build_arm(symbol: str, tf: int, days: list[str], anchor=C.ANCHOR,
              or_minutes: int = OR_MINUTES_DEFAULT, stop_mode: str = "range",
              max_trades_per_day: int = 1) -> pd.DataFrame:
    """One row per TRIGGERED day. Days that were eligible but produced no
    trigger are counted by `eligibility()`, not represented here.

    anchor             (0,0) pre-registered | the §8.3 placebo anchors
    or_minutes         30 pre-registered | 15/60 (§8.4 sensitivity)
    stop_mode          'range' (pre-registered) — 'mid' kept for parity only
    max_trades_per_day 1 (pre-registered)
    """
    tp = Tape.get(symbol)
    B = tp.bars[tf]
    rows = []
    for date in days:
        orr = opening_range(tp, date, or_minutes, anchor)
        if orr is None:
            continue
        i_flat = flat_index(tp, date, anchor)
        if i_flat <= orr["i_or1"]:
            continue
        t_from, t_to = trig_bounds(date, anchor, or_minutes)
        j_from = np.searchsorted(B["t"], t_from, "left")
        j_to = np.searchsorted(B["t"], t_to, "left")
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
                date=date, symbol=symbol, tf=tf, j=int(j), side=side,
                t_sig=int(B["t"][j]), entry=entry, stop=float(stop),
                stop_dist=float(dist), i_entry_min=i_ent, i_flat=int(i_flat),
                or_high=orr["or_high"], or_low=orr["or_low"],
                i_or0=orr["i_or0"], i_or1=orr["i_or1"], or_vol=orr["or_vol"],
                or_open=orr["or_open"], or_close=orr["or_close"],
                seq=taken,
            ))
            taken += 1
            break
    if not rows:
        return pd.DataFrame()
    q = pd.DataFrame(rows)
    return _evaluate(tp, q)


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
    # §5 cost sensitivities (non-gating), template 1 only
    ix1 = np.clip(q.i_exit_1.values, 0, tp.n - 1)
    for mode, col in (("maker", "netR_1_maker"), ("x2", "netR_1_2x")):
        q[col] = q.grossR_1 - cost_R(tp.venue, tp, q.i_entry_min.values, ix1,
                                     entry, dist, mode)
    q["hold_min"] = (tp.t[ix1] - tp.t[q.i_entry_min.values]) / C.MIN_MS
    q["period"] = C.period_of(q.date.values)
    q["weekend"] = C.is_weekend(q.date.values)
    q["dow"] = pd.to_datetime(pd.Series(q.date.values)).dt.dayofweek.values
    era = C.era_of(q.date.values)
    q["era_break"] = era.era_break.values
    q["era_etf"] = era.era_etf.values
    q["arm"] = q.symbol + "-" + q.tf.astype(str) + "m"
    return q


def eligibility(symbol: str, tf: int, days: list[str], anchor=C.ANCHOR,
                or_minutes: int = OR_MINUTES_DEFAULT) -> pd.DataFrame:
    """One row per calendar day in `days`, with the reason it did or did not
    produce a trade. The exclusions row of the REPORT is built from this."""
    tp = Tape.get(symbol)
    out = []
    for date in days:
        orr = opening_range(tp, date, or_minutes, anchor)
        if orr is None:
            out.append(dict(date=date, eligible=False, reason="incomplete opening range",
                            triggered=False))
            continue
        i_flat = flat_index(tp, date, anchor)
        if i_flat <= orr["i_or1"]:
            out.append(dict(date=date, eligible=False, reason="no session after the range",
                            triggered=False))
            continue
        tr = find_trigger(tp, tf, date, orr, anchor, or_minutes)
        out.append(dict(date=date, eligible=True, reason="",
                        triggered=tr is not None,
                        side=(tr["side"] if tr else 0),
                        or_width=orr["or_high"] - orr["or_low"]))
    return pd.DataFrame(out)
