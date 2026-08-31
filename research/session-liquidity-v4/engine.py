#!/usr/bin/env python3
"""Sweep-detection + measurement engine — session-liquidity **v4**, iFVG only.

Spec: `knowledge/session-liquidity.md` §5.1 (V9, **v4**) — the sequential iFVG
state machine with the invalidation clause REMOVED. Brief: `DESIGN.md` §1.
Forked from `research/session-liquidity-v3/engine.py`; v2 and v3 files are
never modified.

WHAT CHANGED vs v3 — exactly one thing, a DELETION:

    v3 carried an extra rule: "give up on the active candidate if a bar closes
    beyond the take-out bar's own extreme". That rule was **fabricated during
    grilling** — the user never asked for it and it does not match how they
    think about a sweep (confirmed against a hand-drawn diagram, 2026-08-31:
    price crosses London's high, prints two further local highs inside NY,
    then reverses through a gap near the top — none of those intermediate
    highs invalidate anything; the boundary is London's high, fixed, full
    stop). v4 deletes it, and with it the whole A/B/C tie question — there is
    no second rule left to tie against.

    What survives from v3 is the part that was right: ONE active candidate at
    a time, the LATEST qualifying gap wins, replacement is final, and only the
    active candidate can confirm. That alone fixes the v2 bug — a stale
    candidate is superseded the moment a fresher one forms, so nothing is
    picked retroactively.

    Mechanically the deletion removes three state variables (`last_inval_bar`,
    the frozen invalidation reference, the tie counter) and one of the four
    outcome causes. `unconf_cause` is now `confirmed | no_candidate |
    live_at_block_end` — `invalidated_out` cannot happen.

EVERYTHING ELSE IS BIT-IDENTICAL TO v2/v3 by design: take-out detection, the
level pool (V1/V2/V7/V8), sessions and blocks, the block-scoped horizon (V4),
ATR units, the wick-anchored magnitude block, and the from-confirmation
geometry formulas. `checks.py` asserts the take-out stream reproduces v2's
committed `results/events_*.csv` exactly — that is the proof that only the
confirmation layer moved, for the second pass running.

BOTH earlier algorithms are kept here verbatim and run on the SAME event rows,
so the three-way delta table is computed on identical events rather than by
joining three studies:

  * `ifvg_confirm_v2`  — v2's retroactive best-pick (the original bug)
  * `ifvg_confirm_v3a` — v3 variant A (sequential + the fabricated
                         invalidation, tie resolving as invalidation), the
                         primary of the previous pass
  * `ifvg_confirm_v4`  — this pass's mechanic

Descriptive pass (§8): no permutation null, no kill rule, no gate.

Writes results/events_<SYM>.csv (one row per take-out, all three algorithms),
results/transitions_<SYM>.csv.gz (the per-event v4 transition trace) and
results/uncond_<SYM>.csv.gz (the block-scoped unconditional yardstick).

Usage:  .venv/bin/python research/session-liquidity-v4/engine.py
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

import common as C

# Pivot half-width for the "how many local extremes did price print beyond the
# take-out bar before it reversed" diagnostic (§3 of REPORT.md). Diagnostic
# only — it is NOT part of any definition and never gates an event.
PIVOT_K = 2


# --------------------------------------------------------------------------
# FVG geometry (3-candle, standard) — unchanged from v2 / v3 / phase 1
# --------------------------------------------------------------------------
def fvg_arrays(d: pd.DataFrame) -> dict[str, np.ndarray]:
    """Per-bar FVG formation. A gap is attributed to its 3rd (forming) bar."""
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy()
    n = len(d)
    bull = np.zeros(n, dtype=bool); bear = np.zeros(n, dtype=bool)
    b_lo = np.full(n, np.nan); b_hi = np.full(n, np.nan)
    s_lo = np.full(n, np.nan); s_hi = np.full(n, np.nan)
    # bullish gap: low[t] > high[t-2]  -> unfilled band [high[t-2], low[t]]
    m = np.zeros(n, dtype=bool); m[2:] = lo[2:] > hi[:-2]
    bull |= m
    idx = np.flatnonzero(m)
    b_lo[idx] = hi[idx - 2]; b_hi[idx] = lo[idx]
    # bearish gap: high[t] < low[t-2] -> unfilled band [high[t], low[t-2]]
    m2 = np.zeros(n, dtype=bool); m2[2:] = hi[2:] < lo[:-2]
    bear |= m2
    idx2 = np.flatnonzero(m2)
    s_lo[idx2] = hi[idx2]; s_hi[idx2] = lo[idx2 - 2]
    return dict(bull=bull, bull_lo=b_lo, bull_hi=b_hi,
                bear=bear, bear_lo=s_lo, bear_hi=s_hi)


def pivot_arrays(d: pd.DataFrame, k: int = PIVOT_K) -> dict[str, np.ndarray]:
    """k-bar local highs / lows — a DIAGNOSTIC for the multi-local-extremes
    shape the user's diagram shows (price pushes past the boundary, prints
    several further local highs, and only then reverses). Confirmed at bar
    `t+k`, but recorded on the pivot bar itself: this array never feeds the
    state machine, so its non-causality cannot leak into any measurement."""
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy()
    n = len(d)
    ph = np.zeros(n, dtype=bool); pl = np.zeros(n, dtype=bool)
    for t in range(k, n - k):
        h = hi[t]; l = lo[t]
        if h > hi[t - k:t].max() and h >= hi[t + 1:t + k + 1].max():
            ph[t] = True
        if l < lo[t - k:t].min() and l <= lo[t + 1:t + k + 1].min():
            pl[t] = True
    return dict(ph=ph, pl=pl)


def _side_arrays(fv, side):
    """The gap family a sweep of `side` needs, and the location test.

    side='high' (a swept session HIGH) needs a BEARISH inversion: a BULLISH FVG
    that reaches above the swept level and is later fully CLOSED through its
    LOWER edge. Mirrored for side='low'.
    """
    if side == "high":
        return fv["bull"], fv["bull_lo"], fv["bull_hi"]
    return fv["bear"], fv["bear_lo"], fv["bear_hi"]


def _location_ok(side, g_lo, g_hi, level, strict):
    """V5: relaxed = the gap merely REACHES beyond the level; strict = the whole
    gap sits beyond it (phase-1 reading, sensitivity column only)."""
    if side == "high":
        return (g_lo >= level) if strict else (g_hi > level)
    return (g_hi <= level) if strict else (g_lo < level)


# --------------------------------------------------------------------------
# v2's algorithm, kept VERBATIM for the delta table (never used for v4 numbers)
# --------------------------------------------------------------------------
def ifvg_confirm_v2(fv, close, t0, t_end, level, side, strict=False):
    """THE ORIGINAL BUG, preserved on purpose. Retroactive best-pick: every
    qualifying gap in `[t0, t_end]` is inverted independently and the EARLIEST
    inversion across the whole set wins. Reproduced byte-for-byte from
    `research/session-liquidity-v2/engine.py`.

    Returns (confirm_idx, form_idx) or (-1, -1).
    """
    form, g_lo_a, g_hi_a = _side_arrays(fv, side)
    best = -1; best_form = -1
    for t in range(t0, t_end + 1):
        if not form[t]:
            continue
        lo_e, hi_e = g_lo_a[t], g_hi_a[t]
        if not _location_ok(side, lo_e, hi_e, level, strict):
            continue
        seg = close[t + 1:t_end + 1]
        if seg.size == 0:
            continue
        hit = (seg < lo_e) if side == "high" else (seg > hi_e)
        w = np.flatnonzero(hit)
        if w.size:
            u = t + 1 + w[0]
            if best < 0 or u < best:
                best, best_form = u, t
    return best, best_form


# --------------------------------------------------------------------------
# v3 variant A, kept VERBATIM for the three-way delta (never used for v4)
# --------------------------------------------------------------------------
def ifvg_confirm_v3a(fv, close, high, low, t0, t_end, level, side, strict=False):
    """v3's PRIMARY variant, reproduced from `../session-liquidity-v3/engine.py`
    with `tie="invalidation"`, `inval_mode="takeout"` (its A settings) inlined.

    Kept only so this package can print a v2 / v3-A / v4 comparison on the same
    event rows. **The invalidation logic in here is the fabricated rule v4
    deletes** — it is history, not spec. Do not read it as a definition.

    Returns (confirm_idx, form_idx, n_invalidations).
    """
    form, g_lo_a, g_hi_a = _side_arrays(fv, side)
    inval_ref = high[t0] if side == "high" else low[t0]
    act_form = -1; act_lo = np.nan; act_hi = np.nan
    n_inval = 0
    last_inval_bar = -1

    def _beyond(c):
        return (c > inval_ref) if side == "high" else (c < inval_ref)

    for t in range(t0, t_end + 1):
        c = close[t]
        if act_form >= 0:
            hit_inval = _beyond(c)
            hit_conf = (c < act_lo) if side == "high" else (c > act_hi)
            if hit_inval:                      # A: invalidation wins the tie
                n_inval += 1
                last_inval_bar = t
                act_form = -1; act_lo = np.nan; act_hi = np.nan
            elif hit_conf:
                return t, act_form, n_inval
        if form[t] and t > last_inval_bar:
            lo_e, hi_e = g_lo_a[t], g_hi_a[t]
            if _location_ok(side, lo_e, hi_e, level, strict):
                act_form = t; act_lo = lo_e; act_hi = hi_e
    return -1, -1, n_inval


# --------------------------------------------------------------------------
# v4: the sequential state machine, NO invalidation (§5.1 / V9)
# --------------------------------------------------------------------------
def ifvg_confirm_v4(fv, close, t0, t_end, level, side, strict=False,
                    trace=False):
    """The iFVG confirmation mechanic as the idea actually defines it (§5.1 v4).

    Walks `[t0, t_end]` once, forward, holding **at most one active candidate**.
    Per-bar order of operations (DESIGN.md §1 pin 3 — a gap cannot form and
    confirm on the same bar, so a bar's close is resolved against the gap that
    was already active *before* that bar):

      1. if a candidate is active (it formed on an earlier bar): **confirmation**
         = `close[t]` through the far edge of that ACTIVE candidate (below
         `gap_lo` for a high sweep). Pin 2: a close through a non-active gap's
         edge is not an event. Confirmation is final and ends the walk.
      2. **formation**: a qualifying gap whose 3rd bar is `t` becomes the active
         candidate at the close of `t`, REPLACING a live candidate. Pin 1: the
         replaced gap is permanently out — its later inversion is not an event
         and it never returns.

    That is the whole machine. There is **no invalidation branch**: nothing
    price does above the swept level (any number of further local highs, any
    distance) discards the candidate. Only a fresher qualifying gap replaces
    it, and only the block's end stops the walk.

    The swept `level` is FIXED — it is the boundary from §3 and it never moves.
    It is used in exactly one place, the V5 location filter on a forming gap.

    Returns a dict:
      confirm_idx, form_idx   -1 / -1 when the take-out goes unconfirmed
      gap_lo, gap_hi          the ACTIVE candidate's edges at confirmation
      n_candidates            qualifying gaps seen during the window
      n_replacements          how many of them displaced a live predecessor
      cause                   'confirmed' | 'no_candidate' | 'live_at_block_end'
      log                     (trace=True) the ordered transition list the
                              gallery draws
    """
    form, g_lo_a, g_hi_a = _side_arrays(fv, side)
    act_form = -1; act_lo = np.nan; act_hi = np.nan
    n_cand = 0; n_repl = 0
    log = [] if trace else None

    def _rec(kind, **kw):
        if trace:
            log.append(dict(kind=kind, **kw))

    for t in range(t0, t_end + 1):
        c = close[t]
        # ---- 1. resolve this bar's close against the ALREADY-active candidate
        if act_form >= 0:
            if (c < act_lo) if side == "high" else (c > act_hi):
                _rec("confirmed", bar=t, form=act_form,
                     gap_lo=act_lo, gap_hi=act_hi)
                return dict(confirm_idx=t, form_idx=act_form,
                            gap_lo=act_lo, gap_hi=act_hi,
                            n_candidates=n_cand, n_replacements=n_repl,
                            cause="confirmed", log=log)

        # ---- 2. formation: the latest qualifying gap becomes the candidate
        if form[t]:
            lo_e, hi_e = g_lo_a[t], g_hi_a[t]
            if _location_ok(side, lo_e, hi_e, level, strict):
                n_cand += 1
                if act_form >= 0:
                    n_repl += 1
                    _rec("replaced", bar=t, form=act_form,
                         gap_lo=act_lo, gap_hi=act_hi)
                _rec("candidate", bar=t, form=t, gap_lo=lo_e, gap_hi=hi_e,
                     order=n_cand)
                act_form = t; act_lo = lo_e; act_hi = hi_e

    if act_form >= 0:
        _rec("live_at_block_end", bar=t_end, form=act_form,
             gap_lo=act_lo, gap_hi=act_hi)
        cause = "live_at_block_end"
    else:
        cause = "no_candidate"
    return dict(confirm_idx=-1, form_idx=-1, gap_lo=np.nan, gap_hi=np.nan,
                n_candidates=n_cand, n_replacements=n_repl,
                cause=cause, log=log)


# --------------------------------------------------------------------------
def _from_confirmation(hi, lo, cl, a, i, u, be, side) -> dict:
    """Geometry measured FROM a confirmation close `u`, to the block end `be`.

    Identical formulas to v2's/v3's magnitude-B block — only the `u` handed in
    differs. Kept as a function so the v2 / v3-A / v4 columns cannot drift.
    """
    c0 = cl[u]
    w_lo = lo[u + 1:be + 1].min()
    w_hi = hi[u + 1:be + 1].max()
    end_c = cl[be]
    if side == "high":
        mfe = c0 - w_lo; mae = w_hi - c0; c_end = c0 - end_c
        ext = hi[i:u + 1].max(); stop = ext - c0
        ext_rev = ext - w_lo
    else:
        mfe = w_hi - c0; mae = c0 - w_lo; c_end = end_c - c0
        ext = lo[i:u + 1].min(); stop = c0 - ext
        ext_rev = w_hi - ext
    mfe = max(mfe, 0.0); mae = max(mae, 0.0)   # excursions floor at 0
    return dict(conf_close=c0, conf_bars_remaining=be - u,
                mfe_atr=mfe / a, mae_atr=mae / a,
                mfe_pct=mfe / c0 * 100, mae_pct=mae / c0 * 100,
                end_atr=c_end / a, end_pct=c_end / c0 * 100,
                stop_atr=stop / a, ext_rev_atr=ext_rev / a,
                R=(mfe / stop) if stop > 0 else np.nan)


CONF_COLS = ["conf_close", "conf_bars_remaining", "mfe_atr", "mae_atr",
             "mfe_pct", "mae_pct", "end_atr", "end_pct", "stop_atr",
             "ext_rev_atr", "R"]


def run_symbol(sym: str, trace: bool = True):
    d = C.prep(C.load(sym))
    n = len(d)
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy(); cl = d["close"].to_numpy()
    atrv = d["atr"].to_numpy()
    ts = d["ts"].to_numpy()
    blk = d["block"].to_numpy()
    ba = C.block_arrays(d)
    block_end = ba["block_end"]; bars_left = ba["bars_left"]
    complete = ba["block_complete"]

    fv = fvg_arrays(d)
    pv = pivot_arrays(d)
    sess = C.session_frames(d)
    lookback_bars = int(C.LOOKBACK_HOURS * 60 / C.BAR_MIN)

    pool = {"high": [], "low": []}
    ptr = 0
    sess_rows = sess.to_dict("records")
    events = []
    trans = []

    for i in range(n):
        # (1) V1: admit levels whose session window has closed by this bar
        while ptr < len(sess_rows) and sess_rows[ptr]["known_from"] <= i:
            r = sess_rows[ptr]
            pool["high"].append(dict(px=r["high"], session=r["session"],
                                     end_idx=r["end_idx"], t_end=r["t_end"]))
            pool["low"].append(dict(px=r["low"], session=r["session"],
                                    end_idx=r["end_idx"], t_end=r["t_end"]))
            ptr += 1
        # (2) V8: expire levels older than the 48h reference scope
        for side in ("high", "low"):
            pool[side] = [L for L in pool[side] if i - L["end_idx"] <= lookback_bars]

        # (3) take-outs on this bar (a wick beyond the level is sufficient)
        for side in ("high", "low"):
            if not pool[side]:
                continue
            if side == "high":
                taken = [L for L in pool[side] if hi[i] > L["px"]]
            else:
                taken = [L for L in pool[side] if lo[i] < L["px"]]
            if not taken:
                continue
            drop = {id(L) for L in taken}
            pool[side] = [L for L in pool[side] if id(L) not in drop]  # V7
            # V2 attribution: the level that required the largest excursion to
            # reach; ties -> the most recently closed session.
            if side == "high":
                lead = max(taken, key=lambda L: (L["px"], L["end_idx"]))
            else:
                lead = min(taken, key=lambda L: (L["px"], -L["end_idx"]))

            # V4: the horizon is this bar's block, and only if that block is
            # fully present in the data.
            if not complete[i]:
                continue
            be = int(block_end[i])
            left = int(bars_left[i])
            a = atrv[i]
            if not np.isfinite(a) or a <= 0:
                continue

            ref = hi[i] if side == "high" else lo[i]
            ev = dict(
                symbol=sym, ts=pd.Timestamp(ts[i]), bar=i,
                month=d["month"].iat[i],
                direction="high_sweep" if side == "high" else "low_sweep",
                level_session=lead["session"],
                sweep_block=blk[i],
                level_px=lead["px"], n_levels_taken=len(taken),
                level_age_h=(i - lead["end_idx"]) * C.BAR_MIN / 60.0,
                sweep_ref=ref, atr=a,
                block_end_bar=be, bars_remaining=left,
                window_min=left * C.BAR_MIN,
                excursion_pct=abs(ref - lead["px"]) / lead["px"] * 100,
                excursion_atr=abs(ref - lead["px"]) / a,
                hour=int(pd.Timestamp(ts[i]).hour),
            )

            # ---- magnitude A: from the sweep's own WICK EXTREME (v2, unchanged)
            if left > 0:
                fw_lo = lo[i + 1:be + 1].min()
                fw_hi = hi[i + 1:be + 1].max()
                end_c = cl[be]
                if side == "high":
                    rev_raw = ref - fw_lo; adv_raw = fw_hi - ref; end_abs = ref - end_c
                else:
                    rev_raw = fw_hi - ref; adv_raw = ref - fw_lo; end_abs = end_c - ref
                rev_abs = max(rev_raw, 0.0); adv_abs = max(adv_raw, 0.0)
                ev.update(rev_pct=rev_abs / ref * 100, rev_atr=rev_abs / a,
                          adv_pct=adv_abs / ref * 100, adv_atr=adv_abs / a,
                          end_pct=end_abs / ref * 100, end_atr=end_abs / a,
                          no_continuation=adv_raw <= 0, no_reversal=rev_raw <= 0)
            else:
                ev.update(rev_pct=np.nan, rev_atr=np.nan, adv_pct=np.nan,
                          adv_atr=np.nan, end_pct=np.nan, end_atr=np.nan,
                          no_continuation=np.nan, no_reversal=np.nan)

            # ---- iFVG confirmation — v4 STATE MACHINE (§5.1), the default ----
            r4 = ifvg_confirm_v4(fv, cl, i, be, lead["px"], side,
                                 strict=False, trace=trace)
            u4 = r4["confirm_idx"]
            gap_sz = (r4["gap_hi"] - r4["gap_lo"]) if u4 >= 0 else np.nan
            far4 = (r4["gap_lo"] if side == "high" else r4["gap_hi"]) \
                if u4 >= 0 else np.nan
            ev.update(
                ifvg_confirmed=u4 >= 0,
                ifvg_delay_bars=(u4 - i) if u4 >= 0 else np.nan,
                ifvg_form_bar=r4["form_idx"] if u4 >= 0 else np.nan,
                ifvg_form_delay_bars=(r4["form_idx"] - i) if u4 >= 0 else np.nan,
                ifvg_gap_atr=gap_sz / a if u4 >= 0 else np.nan,
                ifvg_gap_pct=(gap_sz / ref * 100) if u4 >= 0 else np.nan,
                n_candidates=r4["n_candidates"],
                n_replacements=r4["n_replacements"],
                unconf_cause=r4["cause"],
                # descriptive geometry only: did the confirming gap's far edge
                # lie beyond the take-out bar's own extreme? Under v3 this was
                # the geometry that produced the tie; under v4 it is just a
                # shape statistic with no rule attached.
                gap_above_extreme=bool((far4 > ref) if side == "high"
                                       else (far4 < ref)) if u4 >= 0 else False,
            )
            if trace and r4["log"]:
                for k, rec in enumerate(r4["log"]):
                    trans.append(dict(symbol=sym, event_bar=i,
                                      direction=ev["direction"], seq=k, **rec))

            # ---- the same machine under the STRICT location filter (V5 sens.)
            rs = ifvg_confirm_v4(fv, cl, i, be, lead["px"], side,
                                 strict=True, trace=False)
            ev.update(ifvg_strict_confirmed=rs["confirm_idx"] >= 0,
                      ifvg_strict_delay_bars=(rs["confirm_idx"] - i)
                      if rs["confirm_idx"] >= 0 else np.nan)

            # ---- v3 variant A on the SAME event, for the 3-way delta ---------
            u3, f3, ninv3 = ifvg_confirm_v3a(fv, cl, hi, lo, i, be,
                                             lead["px"], side, strict=False)
            g3 = ((fv["bull_hi"][f3] - fv["bull_lo"][f3]) if side == "high"
                  else (fv["bear_hi"][f3] - fv["bear_lo"][f3])) if u3 >= 0 else np.nan
            ev.update(
                v3a_confirmed=u3 >= 0,
                v3a_delay_bars=(u3 - i) if u3 >= 0 else np.nan,
                v3a_form_bar=f3 if u3 >= 0 else np.nan,
                v3a_gap_atr=g3 / a if u3 >= 0 else np.nan,
                v3a_n_invalidations=ninv3,
            )

            # ---- v2's algorithm on the SAME event, for the delta table -------
            u2, f2 = ifvg_confirm_v2(fv, cl, i, be, lead["px"], side, strict=False)
            if u2 >= 0:
                g2 = ((fv["bull_hi"][f2] - fv["bull_lo"][f2]) if side == "high"
                      else (fv["bear_hi"][f2] - fv["bear_lo"][f2]))
            else:
                g2 = np.nan
            ev.update(
                v2_ifvg_confirmed=u2 >= 0,
                v2_ifvg_delay_bars=(u2 - i) if u2 >= 0 else np.nan,
                v2_ifvg_form_bar=f2 if u2 >= 0 else np.nan,
                v2_ifvg_form_delay_bars=(f2 - i) if u2 >= 0 else np.nan,
                v2_ifvg_gap_atr=g2 / a if u2 >= 0 else np.nan,
                v2_ifvg_gap_pct=(g2 / ref * 100) if u2 >= 0 else np.nan,
                same_gap_selected=(u2 >= 0 and u4 >= 0 and f2 == r4["form_idx"]),
                same_gap_v3a=(u3 >= 0 and u4 >= 0 and f3 == r4["form_idx"]),
            )

            # ---- the "how far past the boundary did it run" diagnostics ------
            # These are what the deleted v3 invalidation rule was reacting to.
            # Outcome-free (measured over the whole block window) so they can
            # stratify without circularity; the *_pre_conf pair is the same
            # count truncated at the confirmation bar.
            seg = slice(i + 1, be + 1)
            if side == "high":
                beyond_close = int((cl[seg] > ref).sum())
                piv_all = int((pv["ph"][seg] & (hi[seg] > ref)).sum())
            else:
                beyond_close = int((cl[seg] < ref).sum())
                piv_all = int((pv["pl"][seg] & (lo[seg] < ref)).sum())
            if u4 >= 0:
                seg2 = slice(i + 1, u4 + 1)
                if side == "high":
                    piv_pre = int((pv["ph"][seg2] & (hi[seg2] > ref)).sum())
                else:
                    piv_pre = int((pv["pl"][seg2] & (lo[seg2] < ref)).sum())
            else:
                piv_pre = piv_all
            ev.update(n_closes_beyond_extreme=beyond_close,
                      n_local_extremes_beyond=piv_all,
                      n_local_extremes_pre_conf=piv_pre)

            # ---- block-truncation diagnostic (NOT a definition) -------------
            # Would this take-out have confirmed had the block run 2h longer?
            if u4 < 0:
                probe_end = min(be + C.TRUNCATION_PROBE_BARS, n - 1)
                rp = ifvg_confirm_v4(fv, cl, i, probe_end, lead["px"],
                                     side, strict=False, trace=False)
                ev["ifvg_would_confirm_extended"] = rp["confirm_idx"] >= 0
                ev["ifvg_extended_delay_bars"] = (rp["confirm_idx"] - i) \
                    if rp["confirm_idx"] >= 0 else np.nan
            else:
                ev["ifvg_would_confirm_extended"] = False
                ev["ifvg_extended_delay_bars"] = np.nan

            # ---- magnitude B: from the CONFIRMATION CLOSE, v4 / v3-A / v2 ----
            if u4 >= 0 and u4 < be:
                g = _from_confirmation(hi, lo, cl, a, i, u4, be, side)
                ev.update({("ifvg_" + k if k not in ("conf_close", "conf_bars_remaining")
                            else k): v for k, v in g.items()})
            else:
                for c_ in CONF_COLS:
                    ev[c_ if c_ in ("conf_close", "conf_bars_remaining")
                       else "ifvg_" + c_] = np.nan
            if u3 >= 0 and u3 < be:
                g = _from_confirmation(hi, lo, cl, a, i, u3, be, side)
                for c_ in ("mfe_atr", "mae_atr", "stop_atr", "R", "end_atr"):
                    ev["v3a_" + c_] = g[c_]
            else:
                for c_ in ("mfe_atr", "mae_atr", "stop_atr", "R", "end_atr"):
                    ev["v3a_" + c_] = np.nan
            if u2 >= 0 and u2 < be:
                g = _from_confirmation(hi, lo, cl, a, i, u2, be, side)
                ev.update({"v2_ifvg_" + k: v for k, v in g.items()})
            else:
                for c_ in CONF_COLS:
                    ev["v2_ifvg_" + c_] = np.nan
            events.append(ev)

    ev_df = pd.DataFrame(events)
    tr_df = pd.DataFrame(trans) if trans else pd.DataFrame(
        columns=["symbol", "event_bar", "direction", "seq", "kind"])
    return ev_df, tr_df


def unconditional(sym: str) -> pd.DataFrame:
    """Block-scoped move distribution from EVERY bar — the yardstick.

    Unchanged from v2/v3 (it never touched the confirmation layer); reproduced
    so the v4 package runs standalone.
    """
    d = C.prep(C.load(sym))
    ba = C.block_arrays(d)
    left = ba["bars_left"]; complete = ba["block_complete"]
    n = len(d)
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy(); a = d["atr"].to_numpy()

    fw_lo = np.full(n, np.nan); fw_hi = np.full(n, np.nan)
    run_lo = np.inf; run_hi = -np.inf
    for i in range(n - 1, -1, -1):
        if left[i] == 0:            # block's last bar: nothing after it
            run_lo, run_hi = np.inf, -np.inf
        else:
            fw_lo[i] = run_lo; fw_hi[i] = run_hi
        run_lo = min(run_lo, lo[i]); run_hi = max(run_hi, hi[i])

    ok = complete & (left > 0) & np.isfinite(a) & (a > 0)
    out = pd.DataFrame({
        "ts": d["ts"], "month": d["month"], "symbol": sym,
        "sweep_block": d["block"], "bars_remaining": left,
        "hour": d["ts"].dt.hour,
        "down_pct": (hi - fw_lo) / hi * 100, "down_atr": (hi - fw_lo) / a,
        "up_pct": (fw_hi - lo) / lo * 100, "up_atr": (fw_hi - lo) / a,
    })[ok]
    return out.dropna()


def fvg_hourly(sym: str) -> pd.DataFrame:
    """Raw FVG formation counts per UTC clock hour — the denominator half of
    the §5.1-required hour-of-day chart (gap FREQUENCY by hour, independent of
    whether any level was swept)."""
    d = C.prep(C.load(sym))
    fv = fvg_arrays(d)
    h = d["ts"].dt.hour.to_numpy()
    out = []
    for hh in range(24):
        m = h == hh
        out.append(dict(symbol=sym, hour=hh, bars=int(m.sum()),
                        bull=int(fv["bull"][m].sum()),
                        bear=int(fv["bear"][m].sum())))
    return pd.DataFrame(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(C.SYMBOLS))
    a = ap.parse_args()
    hourly = []
    for sym in a.symbols.split(","):
        ev, tr = run_symbol(sym)
        ev.to_csv(os.path.join(C.RESULTS, f"events_{sym}.csv"), index=False)
        tr.to_csv(os.path.join(C.RESULTS, f"transitions_{sym}.csv.gz"), index=False)
        un = unconditional(sym)
        un.to_csv(os.path.join(C.RESULTS, f"uncond_{sym}.csv.gz"), index=False)
        hourly.append(fvg_hourly(sym))
        prim = ev[ev.bars_remaining >= C.MIN_BARS_REMAINING]
        print(f"{sym}: {len(ev):>6} take-outs ({len(prim):>6} primary)  |  "
              f"iFVG v4 {ev.ifvg_confirmed.mean():.1%} "
              f"(primary {prim.ifvg_confirmed.mean():.1%})  |  "
              f"v3-A {ev.v3a_confirmed.mean():.1%}  |  "
              f"v2 {ev.v2_ifvg_confirmed.mean():.1%}  |  "
              f"transitions {len(tr):,}  | uncond bars {len(un):,}", flush=True)
    pd.concat(hourly, ignore_index=True).to_csv(
        os.path.join(C.RESULTS, "fvg_hourly.csv"), index=False)


if __name__ == "__main__":
    main()
