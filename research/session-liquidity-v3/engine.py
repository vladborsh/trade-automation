#!/usr/bin/env python3
"""Sweep-detection + measurement engine — session-liquidity **v3**, iFVG only.

Spec: `knowledge/session-liquidity.md` §5.1 (V9) — the corrected **sequential
iFVG confirmation state machine**. Brief: `DESIGN.md` §1 (the edge-case pins).
Forked from `research/session-liquidity-v2/engine.py`; v2 files are never
modified.

WHAT CHANGED vs v2 — exactly one layer:

    v2's `ifvg_confirm` scanned EVERY qualifying gap in the whole block window,
    computed each one's inversion bar independently, and retroactively kept
    whichever inverted earliest across the entire set. That is not what a
    trader watching the tape can do, and it is structurally biased toward
    small gaps sitting close to price (they invert fastest), which flattens
    the measured geometry and contaminates any gap-size analysis.

    v3 replaces it with `ifvg_confirm_v3`: one active candidate at a time,
    latest qualifying formation wins, replacement is final, close-based
    invalidation against the take-out bar's own extreme, confirmation only
    from the active candidate.

EVERYTHING ELSE IS BIT-IDENTICAL TO v2 by design: take-out detection, the
level pool (V1/V2/V7/V8), sessions and blocks, the block-scoped horizon (V4),
ATR units, the wick-anchored magnitude block, and the from-confirmation
geometry formulas. `checks.py` asserts the take-out stream reproduces v2's
committed `results/events_*.csv` exactly — that is the proof that only the
confirmation layer moved.

v2's algorithm is kept here verbatim as `ifvg_confirm_v2` and run alongside,
so REPORT.md's v2-vs-v3 delta table is computed on the *same event rows*
rather than by joining two studies.

Descriptive pass (§8): no permutation null, no kill rule, no gate.

Writes results/events_<SYM>.csv (one row per take-out, both algorithms),
results/transitions_<SYM>.csv.gz (the per-event state-machine trace) and
results/uncond_<SYM>.csv.gz (the block-scoped unconditional yardstick).

Usage:  .venv/bin/python research/session-liquidity-v3/engine.py
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

import common as C


# --------------------------------------------------------------------------
# FVG geometry (3-candle, standard) — unchanged from v2 / phase 1
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
# v2's algorithm, kept VERBATIM for the delta table (never used for v3 numbers)
# --------------------------------------------------------------------------
def ifvg_confirm_v2(fv, close, t0, t_end, level, side, strict=False):
    """THE BUG, preserved on purpose. Retroactive best-pick: every qualifying
    gap in `[t0, t_end]` is inverted independently and the EARLIEST inversion
    across the whole set wins. Reproduced here byte-for-byte from
    `research/session-liquidity-v2/engine.py` so the v2-vs-v3 delta is computed
    on identical event rows instead of by joining two separate studies.

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
# v3: the sequential state machine (§5.1 / V9)
# --------------------------------------------------------------------------
def ifvg_confirm_v3(fv, close, high, low, t0, t_end, level, side,
                    strict=False, trace=False, tie="invalidation",
                    inval_mode="takeout"):
    """The corrected, causal iFVG confirmation mechanic (§5.1 / V9).

    Walks `[t0, t_end]` once, forward, holding **at most one active candidate**.
    Per-bar order of operations (DESIGN.md §1 pin 4 — a gap cannot form and
    confirm on the same bar, so a bar's close is resolved against the gap that
    was already active *before* that bar):

      1. if a candidate is active (it formed on an earlier bar):
         a. **invalidation** — `close[t]` beyond the invalidation reference
            (see `inval_mode`). Not the swept level: the take-out already broke
            that, by definition.
         b. **confirmation** — `close[t]` through the far edge of the ACTIVE
            candidate (below `gap_lo` for a high sweep). Pin 2: a close through
            a non-active gap's edge is not an event.
         c. pin 3 / `tie` — what to do with a bar that does both.
      2. **formation** — a qualifying gap whose 3rd bar is `t` becomes the
         active candidate at the close of `t`, REPLACING a live candidate
         (pin 1: the replaced gap is permanently out; its later inversion is
         not an event and it never returns). Post-invalidation eligibility is
         forming-strictly-after the invalidation bar (`t > last_inval_bar`), so
         a gap whose 3rd bar IS the invalidation bar is not eligible.

    THE THREE VARIANTS actually measured in this pass (REPORT.md §2 — pin 3's
    "near-impossible" assumption turned out to be geometrically false, so the
    alternatives are measured rather than argued):

      A `tie="invalidation"`, `inval_mode="takeout"` — **PRIMARY**. Pin 3
        exactly as written: reference is the take-out bar's own extreme, fixed
        at take-out time; a bar that does both invalidates.
      B `tie="confirmation"`, `inval_mode="takeout"` — sensitivity. Same
        reference; a bar that does both confirms.
      C `inval_mode="running_at_activation"` — sensitivity. The reference is
        the running extreme from the take-out bar through the bar on which the
        candidate ACTIVATES, frozen there (mirror for low sweeps). Identical to
        A whenever nothing exceeded the take-out extreme before activation;
        for a gap that formed above the take-out extreme it means invalidation
        only fires when price closes back beyond the whole sweep impulse.

    Why the tie is common and not "contradictory in direction": for a high
    sweep the bullish candidate usually forms ABOVE the take-out bar's high, so
    `gap_lo > inval_ref`, and EVERY close in `(inval_ref, gap_lo)` satisfies
    both tests at once — the gap inverts while price is still above the sweep
    wick. Under A those all resolve as invalidations.

    Invalidation is defined on the *active candidate* (§5.1 point 3 discards
    "the active candidate"), so a close beyond the reference while nothing is
    active is not an invalidation event. That is a real interpretive choice, so
    it is not left silent: `orphan_breaches` counts those bars (always against
    the take-out extreme, so the number is comparable across variants) and
    `conf_after_orphan_breach` flags confirmations that happened after one.

    Returns a dict:
      confirm_idx, form_idx   -1 / -1 when the take-out goes unconfirmed
      gap_lo, gap_hi          the ACTIVE candidate's edges at confirmation
      gap_above_extreme       True when that gap's far edge lay beyond the
                              take-out extreme (the geometry that creates ties)
      n_candidates, n_replacements, n_invalidations, n_ties, orphan_breaches
      conf_after_orphan_breach
      cause                   'confirmed' | 'no_candidate' | 'invalidated_out'
                              | 'live_at_block_end'
      inval_ref               the take-out bar's extreme (the line the gallery
                              draws); `inval_ref_used` is the frozen reference
                              that actually governed the confirming candidate
      log                     (trace=True) the ordered transition list the
                              gallery draws
    """
    form, g_lo_a, g_hi_a = _side_arrays(fv, side)
    inval_ref = high[t0] if side == "high" else low[t0]
    running = inval_ref            # running extreme since the take-out bar

    act_form = -1; act_lo = np.nan; act_hi = np.nan; act_ref = inval_ref
    n_cand = 0; n_repl = 0; n_inval = 0; n_ties = 0
    orphan = 0; conf_after_orphan = False
    last_inval_bar = -1
    log = [] if trace else None

    def _rec(kind, **kw):
        if trace:
            log.append(dict(kind=kind, **kw))

    def _beyond(c, ref):
        return (c > ref) if side == "high" else (c < ref)

    for t in range(t0, t_end + 1):
        c = close[t]
        # ---- 1. resolve this bar's close against the ALREADY-active candidate
        if act_form >= 0:
            hit_inval = _beyond(c, act_ref)
            hit_conf = (c < act_lo) if side == "high" else (c > act_hi)
            if hit_inval and hit_conf:
                n_ties += 1
                _rec("tie", bar=t)
                if tie == "confirmation":          # variant B
                    hit_inval = False
            if hit_inval:                      # pin 3 (variant A): inval wins
                n_inval += 1
                last_inval_bar = t
                _rec("invalidated", bar=t, form=act_form,
                     gap_lo=act_lo, gap_hi=act_hi, ref=act_ref)
                act_form = -1; act_lo = np.nan; act_hi = np.nan
            elif hit_conf:
                far = act_lo if side == "high" else act_hi
                _rec("confirmed", bar=t, form=act_form,
                     gap_lo=act_lo, gap_hi=act_hi, ref=act_ref)
                return dict(confirm_idx=t, form_idx=act_form,
                            gap_lo=act_lo, gap_hi=act_hi,
                            gap_above_extreme=bool(_beyond(far, inval_ref)),
                            n_candidates=n_cand, n_replacements=n_repl,
                            n_invalidations=n_inval, n_ties=n_ties,
                            orphan_breaches=orphan,
                            conf_after_orphan_breach=conf_after_orphan,
                            cause="confirmed", inval_ref=inval_ref,
                            inval_ref_used=act_ref, log=log)
        else:
            if _beyond(c, inval_ref):
                orphan += 1
                conf_after_orphan = True
                _rec("orphan_breach", bar=t)

        # keep the running extreme current BEFORE a gap can activate on this bar
        running = max(running, high[t]) if side == "high" else min(running, low[t])

        # ---- 2. formation: the latest qualifying gap becomes the candidate
        if form[t] and t > last_inval_bar:
            lo_e, hi_e = g_lo_a[t], g_hi_a[t]
            if _location_ok(side, lo_e, hi_e, level, strict):
                n_cand += 1
                if act_form >= 0:
                    n_repl += 1
                    _rec("replaced", bar=t, form=act_form,
                         gap_lo=act_lo, gap_hi=act_hi)
                act_ref = running if inval_mode == "running_at_activation" \
                    else inval_ref
                _rec("candidate", bar=t, form=t, gap_lo=lo_e, gap_hi=hi_e,
                     order=n_cand, ref=act_ref)
                act_form = t; act_lo = lo_e; act_hi = hi_e

    if act_form >= 0:
        _rec("live_at_block_end", bar=t_end, form=act_form,
             gap_lo=act_lo, gap_hi=act_hi, ref=act_ref)
        cause = "live_at_block_end"
    elif n_cand == 0:
        cause = "no_candidate"
    else:
        cause = "invalidated_out"
    return dict(confirm_idx=-1, form_idx=-1, gap_lo=np.nan, gap_hi=np.nan,
                gap_above_extreme=False,
                n_candidates=n_cand, n_replacements=n_repl,
                n_invalidations=n_inval, n_ties=n_ties, orphan_breaches=orphan,
                conf_after_orphan_breach=conf_after_orphan,
                cause=cause, inval_ref=inval_ref, inval_ref_used=np.nan,
                log=log)


# --------------------------------------------------------------------------
def _from_confirmation(hi, lo, cl, a, i, u, be, side) -> dict:
    """Geometry measured FROM a confirmation close `u`, to the block end `be`.

    Identical formulas to v2's magnitude-B block — only the `u` handed in is
    different (v3's active-candidate inversion instead of v2's retroactive
    best pick). Kept as a function so the v2 and v3 columns cannot drift.
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

            # ---- iFVG confirmation — v3 STATE MACHINE (§5.1), the default ----
            r3 = ifvg_confirm_v3(fv, cl, hi, lo, i, be, lead["px"], side,
                                 strict=False, trace=trace)
            u3 = r3["confirm_idx"]
            gap_sz = (r3["gap_hi"] - r3["gap_lo"]) if u3 >= 0 else np.nan
            ev.update(
                ifvg_confirmed=u3 >= 0,
                ifvg_delay_bars=(u3 - i) if u3 >= 0 else np.nan,
                ifvg_form_bar=r3["form_idx"] if u3 >= 0 else np.nan,
                ifvg_form_delay_bars=(r3["form_idx"] - i) if u3 >= 0 else np.nan,
                ifvg_gap_atr=gap_sz / a if u3 >= 0 else np.nan,
                ifvg_gap_pct=(gap_sz / ref * 100) if u3 >= 0 else np.nan,
                inval_ref=r3["inval_ref"],
                n_candidates=r3["n_candidates"],
                n_replacements=r3["n_replacements"],
                n_invalidations=r3["n_invalidations"],
                n_ties=r3["n_ties"],
                orphan_breaches=r3["orphan_breaches"],
                conf_after_orphan_breach=bool(r3["conf_after_orphan_breach"]) if u3 >= 0 else False,
                unconf_cause=r3["cause"],
                gap_above_extreme=bool(r3["gap_above_extreme"]),
                inval_ref_used=r3["inval_ref_used"],
            )
            if trace and r3["log"]:
                for k, rec in enumerate(r3["log"]):
                    trans.append(dict(symbol=sym, event_bar=i,
                                      direction=ev["direction"], seq=k, **rec))

            # ---- the same machine under the STRICT location filter (V5 sens.)
            rs = ifvg_confirm_v3(fv, cl, hi, lo, i, be, lead["px"], side,
                                 strict=True, trace=False)
            ev.update(ifvg_strict_confirmed=rs["confirm_idx"] >= 0,
                      ifvg_strict_delay_bars=(rs["confirm_idx"] - i)
                      if rs["confirm_idx"] >= 0 else np.nan)

            # ---- variants B and C (Architect ruling, REPORT.md §2) ----------
            # B: same invalidation reference, but a bar that both inverts the
            #    active gap and closes beyond the take-out extreme CONFIRMS.
            # C: invalidation reference = the running extreme from the take-out
            #    bar through the candidate's activation bar, frozen there.
            # Both are sensitivity columns; the primary numbers are A above.
            for tag, kw in (("B", dict(tie="confirmation")),
                            ("C", dict(inval_mode="running_at_activation"))):
                rv = ifvg_confirm_v3(fv, cl, hi, lo, i, be, lead["px"], side,
                                     strict=False, trace=False, **kw)
                uv = rv["confirm_idx"]
                gv = (rv["gap_hi"] - rv["gap_lo"]) if uv >= 0 else np.nan
                ev[f"{tag}_confirmed"] = uv >= 0
                ev[f"{tag}_delay_bars"] = (uv - i) if uv >= 0 else np.nan
                ev[f"{tag}_form_bar"] = rv["form_idx"] if uv >= 0 else np.nan
                ev[f"{tag}_gap_atr"] = gv / a if uv >= 0 else np.nan
                ev[f"{tag}_unconf_cause"] = rv["cause"]
                ev[f"{tag}_n_invalidations"] = rv["n_invalidations"]
                ev[f"{tag}_gap_above_extreme"] = bool(rv["gap_above_extreme"])
                if uv >= 0 and uv < be:
                    g = _from_confirmation(hi, lo, cl, a, i, uv, be, side)
                    ev[f"{tag}_mfe_atr"] = g["mfe_atr"]
                    ev[f"{tag}_mae_atr"] = g["mae_atr"]
                    ev[f"{tag}_stop_atr"] = g["stop_atr"]
                    ev[f"{tag}_R"] = g["R"]
                else:
                    for c_ in ("mfe_atr", "mae_atr", "stop_atr", "R"):
                        ev[f"{tag}_{c_}"] = np.nan

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
                same_gap_selected=(u2 >= 0 and u3 >= 0 and f2 == r3["form_idx"]),
            )

            # ---- block-truncation diagnostic (NOT a definition) -------------
            # Would this take-out have confirmed had the block run 2h longer?
            # Same state machine, same start, only `t_end` extended — the
            # trajectory up to the block end is unchanged, so this is a clean
            # extension rather than a different mechanic.
            if u3 < 0:
                probe_end = min(be + C.TRUNCATION_PROBE_BARS, n - 1)
                rp = ifvg_confirm_v3(fv, cl, hi, lo, i, probe_end, lead["px"],
                                     side, strict=False, trace=False)
                ev["ifvg_would_confirm_extended"] = rp["confirm_idx"] >= 0
                ev["ifvg_extended_delay_bars"] = (rp["confirm_idx"] - i) \
                    if rp["confirm_idx"] >= 0 else np.nan
            else:
                ev["ifvg_would_confirm_extended"] = False
                ev["ifvg_extended_delay_bars"] = np.nan

            # ---- magnitude B: from the CONFIRMATION CLOSE, v3 and v2 --------
            if u3 >= 0 and u3 < be:
                g = _from_confirmation(hi, lo, cl, a, i, u3, be, side)
                ev.update({("ifvg_" + k if k not in ("conf_close", "conf_bars_remaining")
                            else k): v for k, v in g.items()})
            else:
                for c_ in CONF_COLS:
                    ev[c_ if c_ in ("conf_close", "conf_bars_remaining")
                       else "ifvg_" + c_] = np.nan
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

    Unchanged from v2 (it never touched the confirmation layer); reproduced so
    the v3 package runs standalone.
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
              f"iFVG v3 {ev.ifvg_confirmed.mean():.1%} "
              f"(primary {prim.ifvg_confirmed.mean():.1%})  |  "
              f"v2 {ev.v2_ifvg_confirmed.mean():.1%}  |  "
              f"transitions {len(tr):,}  | uncond bars {len(un):,}", flush=True)
    pd.concat(hourly, ignore_index=True).to_csv(
        os.path.join(C.RESULTS, "fvg_hourly.csv"), index=False)


if __name__ == "__main__":
    main()
