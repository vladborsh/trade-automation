"""The ORB signal engine — `DESIGN.md` §3 (mechanic) and §4 (fills, costs).

Forked from `research/orb-ny-open-short/engine.py` and **parametrised** per the
exit note §9. `walk1m`, the fill conventions, `cost_R`, the trigger and the
calendar are **verbatim**; the short package itself is not edited.

What this fork adds, and nothing else:

  * `walk1m_trail` (numba) — E1's parameter-free **1R ratchet**, exactly the
    pseudocode of exit note §5.3. Minute k is tested against the stop as of
    the END OF MINUTE k-1, and only then may minute k move the stop, which is
    what makes the trail free of intrabar look-ahead.
  * `walk1m_trail_ref` — a pure-Python reference implementation of the same
    rule, written independently of the numba one. §9.3 check 4(a) requires the
    two to agree EXACTLY on every trade of every period. A disagreement is a
    §10 stop rule, not a debugging session.
  * `stop_mode="datr"` — E2's stop at `entry -/+ 0.10 x dATR14`, where dATR14
    is `features.DayBars.prior(date)["datr14"]`: Wilder ATR(14) over session-day
    bars as of the PRIOR trading day's 16:00 NY close. Fixed before the session
    opens, look-ahead-free, and the project's existing feature.

No arm in this family has a target. `target = +/-inf` is passed to `walk1m`
for E0 and E2, which is the closed passes' template 2 exactly.

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

X_TARGET, X_STOP, X_TIME, X_NONE, X_TRAIL = 0, 1, 2, 3, 4
EXIT_NAME = {X_TARGET: "target", X_STOP: "stop", X_TIME: "time-exit",
             X_NONE: "no-exit", X_TRAIL: "trail-stop"}


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


# ==========================================================================
# E1 — the 1R ratchet. Exit note §5.3, transcribed rule for rule.
# ==========================================================================
@njit(cache=True, error_model="numpy")
def walk1m_trail(o, h, l, c, b0, b1, side, entry, stop0, R, trail_r):
    """One E1 trade over 1m tape indices [b0, b1]. No target, ever.

    The loop is the note's pseudocode:

        for k in b0..b1:
            (i)  test minute k against the stop AS OF THE END OF MINUTE k-1
            (ii) THEN let minute k move the ratchet, for minute k+1 onward

    so the stop that minute k is tested against can never have been moved by
    minute k's own high — that is the whole look-ahead argument. The stop only
    ever tightens, so the first live minute is tested against `stop0` and E1
    can never exit earlier or worse than E0 on the same minute. On a trade
    where the ratchet never moved, the fill IS E0's fill (checked).

    Gap convention verbatim from `walk1m`: a minute that OPENS through the
    stop fills at that minute's open.

    Returns (exit index, exit price, cause, stop at exit, best price).
    `cause` is X_STOP when the stop at exit is still `stop0`, X_TRAIL when the
    ratchet had moved it, X_TIME at the forced flat.
    """
    d = trail_r * R
    best = entry
    stop = stop0
    for k in range(b0, b1 + 1):
        # (i) minute k against the stop as of the end of minute k-1
        if side > 0:
            gap = o[k] <= stop
            hit = l[k] <= stop
        else:
            gap = o[k] >= stop
            hit = h[k] >= stop
        if hit:
            cause = X_STOP if stop == stop0 else X_TRAIL
            return k, (o[k] if gap else stop), cause, stop, best
        # (ii) now minute k may move the ratchet, for minute k+1 onward
        if side > 0:
            if h[k] > best:
                best = h[k]
            if best - d > stop:
                stop = best - d
        else:
            if l[k] < best:
                best = l[k]
            if best + d < stop:
                stop = best + d
    if b1 < b0:
        return b0 - 1, entry, X_NONE, stop, best
    return b1, c[b1], X_TIME, stop, best


@njit(cache=True, error_model="numpy")
def walk1m_trail_many(o, h, l, c, b0, b1, side, entry, stop0, R, trail_r):
    n = len(b0)
    xi = np.empty(n, np.int64)
    xp = np.empty(n, np.float64)
    xc = np.empty(n, np.int8)
    xs = np.empty(n, np.float64)
    xb = np.empty(n, np.float64)
    for i in range(n):
        a, b, d, s, g = walk1m_trail(o, h, l, c, b0[i], b1[i], side[i], entry[i],
                                     stop0[i], R[i], trail_r)
        xi[i] = a
        xp[i] = b
        xc[i] = d
        xs[i] = s
        xb[i] = g
    return xi, xp, xc, xs, xb


def walk1m_trail_ref(o, h, l, c, b0, b1, side, entry, stop0, R, trail_r=1.0):
    """**Independent pure-Python reference** for `walk1m_trail` — §9.3 check
    4(a). Deliberately written in a different style (explicit price list, no
    fused conditionals, the long and short branches fully separate) so that a
    shared typo is unlikely. Same signature, same return tuple.

    This is not a fast path and is never used to produce a reported number; it
    exists only to be compared against the numba walker on every trade.
    """
    dist = float(trail_r) * float(R)
    best = float(entry)
    stop = float(stop0)
    b0, b1 = int(b0), int(b1)
    if b1 < b0:
        return b0 - 1, float(entry), X_NONE, stop, best
    for k in range(b0, b1 + 1):
        op, hi, lo = float(o[k]), float(h[k]), float(l[k])
        if side > 0:
            touched = lo <= stop
            opened_through = op <= stop
        else:
            touched = hi >= stop
            opened_through = op >= stop
        if touched:
            px = op if opened_through else stop
            cause = X_STOP if stop == float(stop0) else X_TRAIL
            return k, float(px), cause, stop, best
        if side > 0:
            best = hi if hi > best else best
            cand = best - dist
            stop = cand if cand > stop else stop
        else:
            best = lo if lo < best else best
            cand = best + dist
            stop = cand if cand < stop else stop
    return b1, float(c[b1]), X_TIME, stop, best


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


def flat_index(tp: Tape, date: str, flat=None) -> int:
    """Tape index of the last 1m bar ENDING <= the flat clock, i.e. the last
    bar with open time < it (§3.4 forced flat). `flat` is 16:00 NY for every
    pre-registered arm and is only ever else for the S-C fit-only ladder."""
    tf = C.ny_ms(date, *(flat or C.FLAT))
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
def build_arm(symbol: str, construction: str, days: list[str], tf: int = C.TF,
              or_minutes: int = C.OR_MIN, trig_end=C.TRIG_END_BASE,
              stop_mode: str | None = None, trail_r: float | None = None,
              datr_frac: float | None = None, target_r: float | None = None,
              flat_at=None) -> pd.DataFrame:
    """One row per TRIGGERED day, for ONE exit construction.

    The trigger is **identical for every construction** — first 5m bar opening
    in [09:35, 12:00) NY whose close is strictly beyond the 5-minute range —
    so the (date, side, entry) triples of E0, E1 and E2 are the same list, and
    the same list as the short pass's `US100-OR5` / `US500-OR5`. §9.3 check 2
    asserts exactly that, and a difference is a §10 stop rule.

    `construction`  'E0' | 'E1' | 'E2'  (pre-registered)
    The remaining arguments exist ONLY for the §8.2 fit-only ladders and each
    defaults to the arm's own pre-registered value:

    stop_mode   'range' (E0/E1) | 'datr' (E2)
    trail_r     None / 0 = no ratchet (E0, E2); 1.0 = E1. S-D prints 0.5, 2.0
    datr_frac   0.10 for E2. S-K prints 0.05, 0.15, 0.25
    target_r    None = no target (every registered arm). S-T prints 2/3/5/10
    flat_at     None = 16:00 NY (every registered arm). S-C prints 11/12/14

    A day on which `DayBars.prior()` has no dATR14 has no defined stop for a
    'datr' arm. Such a day is EXCLUDED and COUNTED, per note §5.3; see
    `datr_exclusions()` and `DESIGN.md` §3.6 for the erratum this concerns.
    """
    if stop_mode is None:
        stop_mode = C.CONSTRUCTION_STOP[construction]
    if trail_r is None:
        trail_r = C.TRAIL_R if C.CONSTRUCTION_TRAIL[construction] else 0.0
    if datr_frac is None:
        datr_frac = C.DATR_FRAC
    flat = flat_at or C.FLAT
    tp = Tape.get(symbol)
    B = tp.bars[tf]
    t_start = C.trig_start(or_minutes)
    # dATR14 is E2's stop SOURCE; for every other arm it is only the §8.1
    # common-scale DENOMINATOR, so it is read for all of them but can never
    # exclude a day on an arm whose stop does not depend on it.
    db = _daybars(symbol)
    rows = []
    for date in days:
        orr = opening_range(tp, date, or_minutes)
        if orr is None:
            continue
        i_flat = flat_index(tp, date, flat)
        if i_flat <= orr["i_or1"]:
            continue
        t_trig1 = C.ny_ms(date, *trig_end)
        j_from = np.searchsorted(B["t"], C.ny_ms(date, *t_start), "left")
        j_to = np.searchsorted(B["t"], t_trig1, "left")
        d = db.prior(date)
        if d is None and stop_mode == "datr":
            continue                          # excluded and counted, note §5.3
        datr = d["datr14"] if d is not None else np.nan
        j = j_from
        while j < j_to:
            cl = B["c"][j]
            if cl > orr["or_high"]:
                side = 1
            elif cl < orr["or_low"]:
                side = -1
            else:
                j += 1
                continue
            entry = float(cl)
            if stop_mode == "datr":
                dist = float(datr_frac) * float(datr)
                stop = entry - side * dist
            else:
                stop = orr["or_low"] if side > 0 else orr["or_high"]
                dist = abs(entry - stop)
            i_ent = int(B["i_last"][j])
            if dist <= 0 or i_ent >= i_flat:
                j += 1
                continue
            rows.append(dict(
                date=date, symbol=symbol, tf=tf, or_min=or_minutes,
                construction=construction,
                j=int(j), side=side,
                t_sig=int(B["t"][j]), entry=entry, stop=float(stop),
                stop_dist=float(dist), i_entry_min=i_ent, i_flat=int(i_flat),
                or_high=orr["or_high"], or_low=orr["or_low"],
                i_or0=orr["i_or0"], i_or1=orr["i_or1"], or_vol=orr["or_vol"],
                or_open=orr["or_open"], or_close=orr["or_close"],
                datr14=float(datr), seq=0,
            ))
            break                             # one trade per day, no re-entry
    if not rows:
        return pd.DataFrame()
    q = pd.DataFrame(rows)
    return _evaluate(tp, q, trail_r=float(trail_r), target_r=target_r)


def _daybars(symbol):
    """`features.DayBars` — imported lazily so that `engine` has no import-time
    dependency on `features` (which imports `engine`)."""
    import features as F
    return F.DayBars.get(symbol)


def datr_exclusions(symbol: str, days: list[str], or_minutes: int = C.OR_MIN,
                    tf: int = C.TF, trig_end=C.TRIG_END_BASE) -> pd.DataFrame:
    """The days a 'datr' arm loses and an E0/E1 arm keeps: a TRIGGERED day on
    which `DayBars.prior()` returns no dATR14. Counted, not silently dropped
    (note §5.3, and `DESIGN.md` §3.6). One row per such day."""
    db = _daybars(symbol)
    base = build_arm(symbol, "E0", days, tf=tf, or_minutes=or_minutes,
                     trig_end=trig_end)
    if not len(base):
        return pd.DataFrame()
    out = [dict(symbol=symbol, date=d, side=int(s), reason="dATR14 undefined "
                "(Wilder ATR(14) warm-up at the start of the tape)")
           for d, s in zip(base.date.values, base.side.values)
           if db.prior(d) is None]
    return pd.DataFrame(out)


def _evaluate(tp: Tape, q: pd.DataFrame, trail_r: float = 0.0,
              target_r=None) -> pd.DataFrame:
    """Walk the construction's own exit on the 1m path, apply costs, label the
    split. One exit per row — this family's arms ARE constructions, so there is
    no template 1 / template 2 pair any more.

    `trail_r > 0`  -> `walk1m_trail` (E1 and the S-D ladder)
    `trail_r == 0` -> `walk1m` with the target below (E0, E2 and the S-T ladder)
    """
    side = q.side.values.astype(np.int64)
    entry = q.entry.values
    stop = q.stop.values
    dist = q.stop_dist.values
    b0 = (q.i_entry_min.values + 1).astype(np.int64)
    b1 = q.i_flat.values.astype(np.int64)
    if trail_r > 0:
        if target_r is not None:
            raise ValueError("no registered or laddered cell pairs a ratchet "
                             "with a target (note §4.2 item 4)")
        xi, xp, xc, xs, xb = E1_walk(tp, b0, b1, side, entry, stop, dist, trail_r)
        q["stop_at_exit"] = xs
        q["best_px"] = xb
        q["best_R"] = side * (xb - entry) / dist
    else:
        tgt = (entry + side * float(target_r) * dist if target_r is not None
               else np.where(side > 0, np.inf, -np.inf))
        xi, xp, xc = walk1m_many(tp.o, tp.h, tp.l, tp.c, b0, b1, side, entry, stop, tgt)
        q["stop_at_exit"] = stop
        q["best_px"] = np.nan
        q["best_R"] = np.nan
    q["i_exit"] = xi
    q["exit_px"] = xp
    q["exit"] = [EXIT_NAME[int(x)] for x in xc]
    q["grossR"] = side * (xp - entry) / dist
    ix = np.clip(xi, 0, tp.n - 1)
    q["cost_R"] = cost_R(tp.venue, tp, q.i_entry_min.values, ix, entry, dist)
    q["netR"] = q.grossR - q.cost_R
    # cost sensitivity (non-gating), note §5.4
    q["netR_2x"] = q.grossR - cost_R(tp.venue, tp, q.i_entry_min.values, ix,
                                     entry, dist, "double")
    q["hold_min"] = (tp.t[ix] - tp.t[q.i_entry_min.values]) / C.MIN_MS
    # §8.1 harvest ratio: how much of the excursion the construction kept.
    # MFE over the trade's OWN horizon, entry -> 16:00 NY, in R. Descriptive.
    q["mfe_R"] = mfe_R(tp, b0, b1, side, entry, dist)
    q["harvest"] = q.netR / q.mfe_R.replace(0.0, np.nan)
    q["period"] = C.period_of(q.date.values)
    q["arm"] = [C.arm_name(s, k) for s, k in zip(q.symbol, q.construction)]
    return q


def E1_walk(tp: Tape, b0, b1, side, entry, stop, dist, trail_r: float):
    """`walk1m_trail_many` on a trade table's columns."""
    return walk1m_trail_many(tp.o, tp.h, tp.l, tp.c, b0, b1, side, entry,
                             stop, dist, float(trail_r))


def mfe_R(tp: Tape, b0, b1, side, entry, dist) -> np.ndarray:
    """Maximum favourable excursion over [b0, b1] in R, measured from the
    entry price. Same horizon as the trade (entry -> the 16:00 NY minute), so
    the harvest ratio's denominator is the excursion the trade could have
    reached. Descriptive only — no verdict reads it."""
    out = np.full(len(b0), np.nan)
    for i in range(len(b0)):
        a, b = int(b0[i]), int(b1[i])
        if b < a:
            continue
        ext = tp.h[a:b + 1].max() if side[i] > 0 else tp.l[a:b + 1].min()
        out[i] = side[i] * (ext - entry[i]) / dist[i]
    return out


def eligibility(symbol: str, days: list[str], or_minutes: int = C.OR_MIN,
               tf: int = C.TF,
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
