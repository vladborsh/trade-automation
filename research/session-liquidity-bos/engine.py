#!/usr/bin/env python3
"""Sweep-detection + measurement engine — session-liquidity **BoS pass**.

Spec: `DESIGN.md` §1 (the corrected BoS mechanic), which pins what
`research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md` diagnosed.
`knowledge/session-liquidity.md` is authoritative for everything else — §1/§3/§4
(sessions, level classes, scope), §5.1 v4 (the iFVG comparison layer, reused
READ-ONLY), §6 (block-scoped horizon, ATR units), §8 (descriptive protocol).

WHAT THIS PASS MEASURES FOR THE FIRST TIME
------------------------------------------
BoS has never been measured correctly. Phase 1 kept **one active level per
side, overwritten every time any new k=3 pivot confirmed** — including pivots
that confirm *after* the take-out, during the incipient reversal. So a shallow
post-take-out pullback low would silently re-anchor the tested level away from
the higher-low that anchored the leg into the take-out, and the engine then
demanded a close through a newer, looser level. v2/v3/v4 excluded BoS entirely.

The corrected mechanic (DESIGN.md §1), high sweep; low sweep is the mirror:

  1. **Anchor**, chosen once at the take-out bar `t0`: the most recent pivot
     LOW that is confirmed as of `t0` (its confirmation bar <= `t0`) and whose
     pivot bar is strictly before `t0`. Pivots confirming after `t0` are
     ignored for this event, permanently.
  2. **Persistence**: the anchor is FIXED for the life of the event and watched
     as a forward ray. **No re-anchoring, ever** — this is the entire
     correction.
  3. **Break**: the first CLOSE beyond the anchor inside
     `[t0, end of sweep_block]`. One break maximum.
  4. **No qualifying pivot exists** -> the event is **unanchorable**, its own
     reported category, never silently dropped.
  5. No break before block end -> unconfirmed.

THREE CONFIRMATION ARMS ARE COMPUTED ON THE SAME EVENT ROWS, so every delta and
agreement table is computed on identical take-outs rather than by joining
studies:

  * `bos_*`      — the corrected mechanic above (this pass's subject)
  * `p1bos_*`    — phase 1's `bos_flags()` re-anchoring machine, reproduced
                   VERBATIM but read inside the v4-era block-scoped window, so
                   the delta isolates the ANCHORING defect and not the horizon
                   change (phase 1 also used a fixed 2h window; mixing the two
                   changes would make the delta uninterpretable)
  * `ifvg_*`     — `research/session-liquidity-v4`'s §5.1 v4 state machine,
                   copied verbatim, for the method comparison

EVERYTHING UPSTREAM OF CONFIRMATION IS BIT-IDENTICAL TO v2/v4 by design:
take-out detection, the level pool (V1/V2/V7/V8), sessions and blocks, the
block-scoped horizon (V4), ATR units, the wick-anchored magnitude block and the
from-confirmation geometry formulas. `checks.py` asserts the take-out stream
reproduces v4's committed `results/events_*.csv` exactly (which the v4 pass in
turn proved byte-identical to v2's), and that the reused iFVG arm reproduces
v4's committed confirmations bar for bar.

Descriptive pass (§8): no permutation null, no kill rule, no gate.

Writes results/events_<SYM>.csv (one row per take-out, all three arms) and
results/uncond_<SYM>.csv.gz (the block-scoped unconditional yardstick).

Usage:  .venv/bin/python research/session-liquidity-bos/engine.py
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

import common as C

# Diagnostic pivot half-width for the "how many local extremes did price print
# beyond the take-out bar before it reversed" shape statistic (NOT the BoS
# anchor, which uses C.PIVOT_K = 3 per DESIGN.md §1). Carried from v4 so the
# column means the same thing across packages.
DIAG_PIVOT_K = 2


# --------------------------------------------------------------------------
# FVG geometry (3-candle, standard) — copied verbatim from v4
# --------------------------------------------------------------------------
def fvg_arrays(d: pd.DataFrame) -> dict[str, np.ndarray]:
    """Per-bar FVG formation. A gap is attributed to its 3rd (forming) bar."""
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy()
    n = len(d)
    bull = np.zeros(n, dtype=bool); bear = np.zeros(n, dtype=bool)
    b_lo = np.full(n, np.nan); b_hi = np.full(n, np.nan)
    s_lo = np.full(n, np.nan); s_hi = np.full(n, np.nan)
    m = np.zeros(n, dtype=bool); m[2:] = lo[2:] > hi[:-2]
    bull |= m
    idx = np.flatnonzero(m)
    b_lo[idx] = hi[idx - 2]; b_hi[idx] = lo[idx]
    m2 = np.zeros(n, dtype=bool); m2[2:] = hi[2:] < lo[:-2]
    bear |= m2
    idx2 = np.flatnonzero(m2)
    s_lo[idx2] = hi[idx2]; s_hi[idx2] = lo[idx2 - 2]
    return dict(bull=bull, bull_lo=b_lo, bull_hi=b_hi,
                bear=bear, bear_lo=s_lo, bear_hi=s_hi)


def diag_pivot_arrays(d: pd.DataFrame, k: int = DIAG_PIVOT_K) -> dict[str, np.ndarray]:
    """k-bar local highs / lows — a DIAGNOSTIC for the multi-local-extremes
    shape. Recorded on the pivot bar itself; never feeds any state machine, so
    its non-causality cannot leak into a measurement."""
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
    if side == "high":
        return fv["bull"], fv["bull_lo"], fv["bull_hi"]
    return fv["bear"], fv["bear_lo"], fv["bear_hi"]


def _location_ok(side, g_lo, g_hi, level, strict):
    """V5: relaxed = the gap merely REACHES beyond the level."""
    if side == "high":
        return (g_lo >= level) if strict else (g_hi > level)
    return (g_hi <= level) if strict else (g_lo < level)


# ==========================================================================
# THE CORRECTED BoS MECHANIC (DESIGN.md §1) — what this pass exists to measure
# ==========================================================================
def anchor_index_arrays(pv: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """For every bar j, the CONFIRMATION-bar index of the most recent pivot
    confirmed at or before j — the O(1) lookup behind DESIGN.md §1 pin 1.

    `last_lo[j]` = the largest j' <= j at which a pivot LOW confirmed, or -1.
    Mirrored for highs. Because `fractals` shifts its flags by k, "confirmed at
    or before j" is exactly "flag on a bar <= j", and the underlying pivot bar
    is that bar minus k — automatically strictly before j for k >= 1.
    """
    n = len(pv["lo_conf"])
    idx = np.arange(n)
    last_lo = np.maximum.accumulate(np.where(pv["lo_conf"], idx, -1))
    last_hi = np.maximum.accumulate(np.where(pv["hi_conf"], idx, -1))
    return dict(last_lo=last_lo, last_hi=last_hi)


def bos_anchor(pv, ai, t0: int, side: str) -> dict:
    """Pick the fixed BoS anchor for a take-out at `t0` (DESIGN.md §1 pin 1).

    A high sweep is broken by a close BELOW an opposing pivot LOW; a low sweep
    by a close ABOVE an opposing pivot HIGH. Returns `anchorable=False` (pin 4)
    when no qualifying pivot exists anywhere before `t0` — that event is a
    REPORTED CATEGORY, not a dropped row.

    Note the search is unbounded backwards, exactly as pin 4 words it ("no
    qualifying confirmed pivot"). How OLD the chosen anchor is is recorded as
    `anchor_age_bars` and reported as a distribution; it never rejects one.
    """
    conf_bar = int(ai["last_lo"][t0] if side == "high" else ai["last_hi"][t0])
    if conf_bar < 0:
        return dict(anchorable=False, px=np.nan, bar=-1, conf_bar=-1)
    px = (pv["lo_px"] if side == "high" else pv["hi_px"])[conf_bar]
    bar = int((pv["lo_bar"] if side == "high" else pv["hi_bar"])[conf_bar])
    if not np.isfinite(px):
        return dict(anchorable=False, px=np.nan, bar=-1, conf_bar=-1)
    return dict(anchorable=True, px=float(px), bar=bar, conf_bar=conf_bar)


def bos_break(close: np.ndarray, t0: int, t_end: int, anchor_px: float,
              side: str) -> int:
    """First CLOSE beyond the FIXED anchor inside `[t0, t_end]` (pins 2 + 3).

    One break maximum; the anchor never moves, so this is a single scan with no
    state at all. That absence of state IS the correction — phase 1's loop had
    an `act_lo` variable that every new pivot confirmation overwrote.
    """
    seg = close[t0:t_end + 1]
    hit = np.flatnonzero(seg < anchor_px) if side == "high" else \
        np.flatnonzero(seg > anchor_px)
    return int(t0 + hit[0]) if hit.size else -1


# ==========================================================================
# PHASE 1's DEFECTIVE MECHANIC — reproduced VERBATIM for the delta table
# ==========================================================================
def phase1_bos_arrays(d: pd.DataFrame, pv: dict[str, np.ndarray]) -> dict:
    """`research/session-liquidity/engine.py:bos_flags()`, reproduced exactly,
    plus the bookkeeping the delta table needs.

    Phase 1 body, unchanged:

        for j in range(n):
            if pl_c[j]: act_lo = pl_p[j]        # <-- THE DEFECT: overwrite
            if ph_c[j]: act_hi = ph_p[j]
            if act_lo is not nan and close[j] < act_lo: dn[j] = True; act_lo = nan
            if act_hi is not nan and close[j] > act_hi: up[j] = True; act_hi = nan

    Two properties of this loop matter for the delta and are recorded per bar:
      * `act_lo_at[j]` — the level actually tested on bar j (post-overwrite,
        NaN when the level has been retired by an earlier break). This is what
        lets us say WHICH level phase 1 was watching at any point of an event.
      * the level is GLOBAL state carried across take-outs, so at a take-out
        bar it may already be retired — a second, distinct way phase 1 differs
        from the corrected mechanic, separate from re-anchoring.
    """
    n = len(d)
    close = d["close"].to_numpy()
    pl_c = pv["lo_conf"]; pl_p = pv["lo_px"]
    ph_c = pv["hi_conf"]; ph_p = pv["hi_px"]
    dn = np.zeros(n, dtype=bool); up = np.zeros(n, dtype=bool)
    act_lo_at = np.full(n, np.nan); act_hi_at = np.full(n, np.nan)
    act_lo = np.nan; act_hi = np.nan
    for j in range(n):
        if pl_c[j]:
            act_lo = pl_p[j]
        if ph_c[j]:
            act_hi = ph_p[j]
        act_lo_at[j] = act_lo
        act_hi_at[j] = act_hi
        if not np.isnan(act_lo) and close[j] < act_lo:
            dn[j] = True; act_lo = np.nan
        if not np.isnan(act_hi) and close[j] > act_hi:
            up[j] = True; act_hi = np.nan
    return dict(dn=dn, up=up, act_lo_at=act_lo_at, act_hi_at=act_hi_at)


# ==========================================================================
# THE iFVG COMPARISON LAYER — v4 §5.1, copied verbatim, READ-ONLY
# ==========================================================================
def ifvg_confirm_v4(fv, close, t0, t_end, level, side, strict=False,
                    trace=False):
    """`research/session-liquidity-v4/engine.py:ifvg_confirm_v4`, byte-for-byte.

    Walks `[t0, t_end]` once, forward, holding at most ONE active candidate:
    a bar's close is resolved against the gap that was already active before
    that bar; then a qualifying gap forming on that bar becomes the (new)
    active candidate, permanently displacing its predecessor. No invalidation.

    Reproduced here rather than imported so this package stands alone; the
    reproduction is asserted against v4's committed results in `checks.py`.
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
        if act_form >= 0:
            if (c < act_lo) if side == "high" else (c > act_hi):
                _rec("confirmed", bar=t, form=act_form,
                     gap_lo=act_lo, gap_hi=act_hi)
                return dict(confirm_idx=t, form_idx=act_form,
                            gap_lo=act_lo, gap_hi=act_hi,
                            n_candidates=n_cand, n_replacements=n_repl,
                            cause="confirmed", log=log)
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

    Copied verbatim from v4 so the BoS and iFVG columns cannot drift apart —
    that identity is what makes the method comparison legitimate. The stop
    proxy is the DESIGN.md §2 pin for BoS: the distance from the confirming
    close back to the SWEEP LEG'S RUNNING EXTREME over `[i, u]`, which is
    exactly the convention iFVG already used, so R is comparable across
    methods.
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
GEO_COLS = ["mfe_atr", "mae_atr", "mfe_pct", "mae_pct", "end_atr", "end_pct",
            "stop_atr", "ext_rev_atr", "R", "conf_close", "conf_bars_remaining"]


def run_symbol(sym: str):
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
    pv = C.pivots(d)                    # k=3 fractals — the BoS anchor source
    ai = anchor_index_arrays(pv)
    p1 = phase1_bos_arrays(d, pv)       # the defective machine, verbatim
    dg = diag_pivot_arrays(d)
    sess = C.session_frames(d)
    lookback_bars = int(C.LOOKBACK_HOURS * 60 / C.BAR_MIN)

    # cumulative count of pivot confirmations, so "how many times would phase 1
    # have re-anchored between t0 and its break" is an O(1) difference
    cum_lo = np.cumsum(pv["lo_conf"].astype(np.int64))
    cum_hi = np.cumsum(pv["hi_conf"].astype(np.int64))

    pool = {"high": [], "low": []}
    ptr = 0
    sess_rows = sess.to_dict("records")
    events = []

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
            if side == "high":
                lead = max(taken, key=lambda L: (L["px"], L["end_idx"]))
            else:
                lead = min(taken, key=lambda L: (L["px"], -L["end_idx"]))

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

            # ---- magnitude A: from the sweep's own WICK EXTREME (v2/v4) -----
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

            # ================================================================
            # ARM 1 — THE CORRECTED BoS (DESIGN.md §1)
            # ================================================================
            an = bos_anchor(pv, ai, i, side)
            if an["anchorable"]:
                ub = bos_break(cl, i, be, an["px"], side)
                ev.update(
                    bos_anchorable=True,
                    bos_anchor_px=an["px"],
                    bos_anchor_bar=an["bar"],
                    bos_anchor_conf_bar=an["conf_bar"],
                    bos_anchor_age_bars=i - an["bar"],
                    bos_anchor_conf_lag_bars=i - an["conf_bar"],
                    bos_anchor_stale=(i - an["bar"]) > C.STALE_ANCHOR_BARS,
                    # how far the ray sits from the take-out wick: the width the
                    # mechanic has to travel before it can fire at all
                    bos_anchor_dist_atr=abs(ref - an["px"]) / a,
                    bos_anchor_beyond_level=bool((an["px"] > lead["px"]) if side == "high"
                                                 else (an["px"] < lead["px"])),
                    bos_confirmed=ub >= 0,
                    bos_delay_bars=(ub - i) if ub >= 0 else np.nan,
                    bos_break_bar=ub,
                    bos_immediate=(ub == i),
                    bos_cause="confirmed" if ub >= 0 else "no_break_in_window",
                )
            else:
                ub = -1
                ev.update(
                    bos_anchorable=False, bos_anchor_px=np.nan,
                    bos_anchor_bar=-1, bos_anchor_conf_bar=-1,
                    bos_anchor_age_bars=np.nan, bos_anchor_conf_lag_bars=np.nan,
                    bos_anchor_stale=False, bos_anchor_dist_atr=np.nan,
                    bos_anchor_beyond_level=False,
                    bos_confirmed=False, bos_delay_bars=np.nan,
                    bos_break_bar=-1, bos_immediate=False,
                    bos_cause="unanchorable",
                )

            # block-truncation probe (diagnostic, NOT a definition)
            if an["anchorable"] and ub < 0:
                probe_end = min(be + C.TRUNCATION_PROBE_BARS, n - 1)
                up_ = bos_break(cl, i, probe_end, an["px"], side)
                ev["bos_would_confirm_extended"] = up_ >= 0
                ev["bos_extended_delay_bars"] = (up_ - i) if up_ >= 0 else np.nan
            else:
                ev["bos_would_confirm_extended"] = False
                ev["bos_extended_delay_bars"] = np.nan

            if ub >= 0 and ub < be:
                g = _from_confirmation(hi, lo, cl, a, i, ub, be, side)
                ev.update({"bos_" + k: v for k, v in g.items()})
            else:
                for c_ in GEO_COLS:
                    ev["bos_" + c_] = np.nan

            # ================================================================
            # ARM 2 — PHASE 1's RE-ANCHORING MACHINE, same window
            # ================================================================
            flags = p1["dn"] if side == "high" else p1["up"]
            act_at = p1["act_lo_at"] if side == "high" else p1["act_hi_at"]
            cum = cum_lo if side == "high" else cum_hi
            w = np.flatnonzero(flags[i:be + 1])
            u1 = int(i + w[0]) if w.size else -1
            lvl_t0 = act_at[i]
            ev.update(
                p1bos_confirmed=u1 >= 0,
                p1bos_delay_bars=(u1 - i) if u1 >= 0 else np.nan,
                p1bos_break_bar=u1,
                p1bos_level_at_t0=lvl_t0,
                p1bos_level_defined_at_t0=bool(np.isfinite(lvl_t0)),
                p1bos_level_at_break=act_at[u1] if u1 >= 0 else np.nan,
                # THE DEFECT, counted: pivot confirmations strictly after the
                # take-out and up to phase 1's break — every one of them
                # overwrote the level phase 1 was testing.
                p1bos_reanchors=int(cum[u1] - cum[i]) if u1 >= 0
                else int(cum[be] - cum[i]),
            )
            if u1 >= 0:
                same = (np.isfinite(act_at[u1]) and an["anchorable"]
                        and abs(act_at[u1] - an["px"]) < 1e-12)
            else:
                same = False
            ev["p1bos_same_level_as_corrected"] = bool(same)
            ev["p1bos_agrees_at_t0"] = bool(
                an["anchorable"] and np.isfinite(lvl_t0)
                and abs(lvl_t0 - an["px"]) < 1e-12)
            if u1 >= 0 and u1 < be:
                g = _from_confirmation(hi, lo, cl, a, i, u1, be, side)
                ev.update({"p1bos_" + k: v for k, v in g.items()})
            else:
                for c_ in GEO_COLS:
                    ev["p1bos_" + c_] = np.nan

            # ================================================================
            # ARM 3 — iFVG v4 (§5.1), the comparison method
            # ================================================================
            r4 = ifvg_confirm_v4(fv, cl, i, be, lead["px"], side, strict=False)
            u4 = r4["confirm_idx"]
            gap_sz = (r4["gap_hi"] - r4["gap_lo"]) if u4 >= 0 else np.nan
            ev.update(
                ifvg_confirmed=u4 >= 0,
                ifvg_delay_bars=(u4 - i) if u4 >= 0 else np.nan,
                ifvg_form_bar=r4["form_idx"] if u4 >= 0 else np.nan,
                ifvg_form_delay_bars=(r4["form_idx"] - i) if u4 >= 0 else np.nan,
                ifvg_gap_atr=gap_sz / a if u4 >= 0 else np.nan,
                ifvg_break_bar=u4,
                n_candidates=r4["n_candidates"],
                n_replacements=r4["n_replacements"],
                unconf_cause=r4["cause"],
            )
            if u4 >= 0 and u4 < be:
                g = _from_confirmation(hi, lo, cl, a, i, u4, be, side)
                ev.update({"ifvg_" + k: v for k, v in g.items()})
            else:
                for c_ in GEO_COLS:
                    ev["ifvg_" + c_] = np.nan

            # ---- relative timing when BOTH methods fire ---------------------
            ev["both_confirmed"] = bool(ev["bos_confirmed"] and ev["ifvg_confirmed"])
            ev["bos_minus_ifvg_bars"] = (ub - u4) if (ub >= 0 and u4 >= 0) else np.nan
            ev["bos_first"] = bool(ub >= 0 and u4 >= 0 and ub < u4)
            ev["same_bar"] = bool(ub >= 0 and u4 >= 0 and ub == u4)

            # ---- shape diagnostics (outcome-free) --------------------------
            seg = slice(i + 1, be + 1)
            if side == "high":
                beyond_close = int((cl[seg] > ref).sum())
                piv_all = int((dg["ph"][seg] & (hi[seg] > ref)).sum())
            else:
                beyond_close = int((cl[seg] < ref).sum())
                piv_all = int((dg["pl"][seg] & (lo[seg] < ref)).sum())
            ev.update(n_closes_beyond_extreme=beyond_close,
                      n_local_extremes_beyond=piv_all)

            events.append(ev)

    return pd.DataFrame(events)


def unconditional(sym: str) -> pd.DataFrame:
    """Block-scoped move distribution from EVERY bar — the yardstick.

    Copied verbatim from v4 (it never touched any confirmation layer) so this
    package runs standalone.
    """
    d = C.prep(C.load(sym))
    ba = C.block_arrays(d)
    left = ba["bars_left"]; complete = ba["block_complete"]
    n = len(d)
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy(); a = d["atr"].to_numpy()

    fw_lo = np.full(n, np.nan); fw_hi = np.full(n, np.nan)
    run_lo = np.inf; run_hi = -np.inf
    for i in range(n - 1, -1, -1):
        if left[i] == 0:
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(C.SYMBOLS))
    a = ap.parse_args()
    for sym in a.symbols.split(","):
        ev = run_symbol(sym)
        ev.to_csv(os.path.join(C.RESULTS, f"events_{sym}.csv"), index=False)
        un = unconditional(sym)
        un.to_csv(os.path.join(C.RESULTS, f"uncond_{sym}.csv.gz"), index=False)
        prim = ev[ev.bars_remaining >= C.MIN_BARS_REMAINING]
        print(f"{sym}: {len(ev):>6} take-outs ({len(prim):>6} primary)  |  "
              f"BoS(corrected) {ev.bos_confirmed.mean():.1%} "
              f"(primary {prim.bos_confirmed.mean():.1%})  |  "
              f"BoS(phase-1) {ev.p1bos_confirmed.mean():.1%}  |  "
              f"iFVG v4 {ev.ifvg_confirmed.mean():.1%}  |  "
              f"unanchorable {(~ev.bos_anchorable).mean():.3%}  | "
              f"uncond bars {len(un):,}", flush=True)


if __name__ == "__main__":
    main()
