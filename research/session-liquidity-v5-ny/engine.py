#!/usr/bin/env python3
"""Detection + measurement engine — session-liquidity **v5-NY** pass.

Spec: this package's `DESIGN.md` (the PRE-REGISTRATION, committed before any
result existed) on top of `knowledge/session-liquidity.md`, which stays
authoritative for every inherited definition.

WHAT IS INHERITED, UNCHANGED AND BIT-FOR-BIT
--------------------------------------------
Take-out detection, the level pool (V1/V2/V7/V8), sessions and blocks, the
block-scoped horizon (V4), ATR units, the wick-anchored magnitude block, the
from-confirmation geometry formulas, **iFVG v4** (§5.1) and the **corrected
BoS pinned-anchor mechanic** (§5.2) are copied from
`research/session-liquidity-bos/engine.py` without a semantic change.
`checks.py` asserts the reproduction against BOTH v4's and the BoS pass's
committed `results/events_*.csv`. If it ever fails, this pass is invalid.

WHAT THIS PASS ADDS (DESIGN §2 / §4)
-------------------------------------
1. **The NY window flag** — the confirmation bar's UTC minute-of-day, and
   whether it falls inside 13:40-15:20 UTC (09:40-11:20 New York at the pinned
   fixed offset UTC-4). A second flag carries the UTC-5 sensitivity. Both are
   pure functions of the clock and can never look forward.
2. **The h24 horizon** — the same MFE / MAE / end-of-window geometry, measured
   to `min(t0 + 288 bars, last bar)` instead of to the block end. Detection is
   NOT changed: a confirmation still has to happen inside the block-scoped
   window to exist at all. Only the measurement horizon is extended.
3. **The pinned trade template** — entry at the confirmation close, stop at the
   sweep leg's running extreme over `[t0, u]` (the project's existing stop
   convention, reused not invented), target +1R, same-bar ties resolved as a
   LOSS, 0.10% round-trip cost, evaluated on both horizons. `grossR`, `netR`,
   the exit reason and the bars held are recorded per arm per horizon.

Phase 1's re-anchoring `bos_flags()` is retained ONLY as a rendering contrast
(`phase1_bos_arrays`, used by `examples.py` to draw what a broken
implementation would have watched). It contributes no measured column here —
the BoS pass already retired those numbers in full.

Writes results/events_<SYM>.csv and results/uncond_<SYM>.csv.gz.

Usage:  python research/session-liquidity-v5-ny/engine.py
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

import common as C

DIAG_PIVOT_K = 2   # diagnostic shape statistic only; NOT the BoS anchor k


# --------------------------------------------------------------------------
# FVG geometry (3-candle, standard) — copied verbatim from v4 / BoS
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
    """k-bar local highs / lows — a DIAGNOSTIC only; never feeds a state
    machine, so its non-causality cannot leak into a measurement."""
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
# THE CORRECTED BoS MECHANIC (knowledge §5.2) — copied verbatim from the BoS pass
# ==========================================================================
def anchor_index_arrays(pv: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """For every bar j, the CONFIRMATION-bar index of the most recent pivot
    confirmed at or before j."""
    n = len(pv["lo_conf"])
    idx = np.arange(n)
    last_lo = np.maximum.accumulate(np.where(pv["lo_conf"], idx, -1))
    last_hi = np.maximum.accumulate(np.where(pv["hi_conf"], idx, -1))
    return dict(last_lo=last_lo, last_hi=last_hi)


def bos_anchor(pv, ai, t0: int, side: str) -> dict:
    """Pick the FIXED BoS anchor for a take-out at `t0` (knowledge §5.2 pin 1).

    A high sweep is broken by a close BELOW an opposing pivot LOW; a low sweep
    by a close ABOVE an opposing pivot HIGH. `anchorable=False` (pin 4) when no
    qualifying pivot exists anywhere before `t0` — a REPORTED category, never a
    dropped row.
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

    One break maximum; the anchor never moves, so this is a single scan holding
    NO state at all. That absence of state IS the correction.
    """
    seg = close[t0:t_end + 1]
    hit = np.flatnonzero(seg < anchor_px) if side == "high" else \
        np.flatnonzero(seg > anchor_px)
    return int(t0 + hit[0]) if hit.size else -1


# ==========================================================================
# PHASE 1's DEFECTIVE MECHANIC — kept ONLY to render the contrast on a chart
# ==========================================================================
def phase1_bos_arrays(d: pd.DataFrame, pv: dict[str, np.ndarray]) -> dict:
    """`research/session-liquidity/engine.py:bos_flags()`, reproduced exactly.

    Not measured in this pass — the BoS pass retired its numbers in full. It
    exists here so `examples.py` can draw the level a re-anchoring
    implementation WOULD have tested, as a red step-line beside the pinned ray.
    Seeing the two on one chart is the clearest available proof that this
    engine's ray does not move.
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
# iFVG v4 (knowledge §5.1) — copied verbatim
# ==========================================================================
def ifvg_confirm_v4(fv, close, t0, t_end, level, side, strict=False,
                    trace=False):
    """Walks `[t0, t_end]` once, forward, holding at most ONE active candidate:
    a bar's close is resolved against the gap that was already active before
    that bar; then a qualifying gap forming on that bar becomes the (new)
    active candidate, permanently displacing its predecessor. No invalidation.

    `trace=True` returns the full candidate/replacement log — that log is what
    `MECHANIC-PROOF.md` renders to show the gap was picked live and not
    retroactively.
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
# GEOMETRY — copied verbatim from v4/BoS, then parameterised by horizon end
# --------------------------------------------------------------------------
def _from_confirmation(hi, lo, cl, a, i, u, h_end, side) -> dict:
    """Geometry measured FROM a confirmation close `u`, to the horizon end.

    With `h_end = block_end` this is byte-for-byte v4's / the BoS pass's
    function — that identity is what makes the cross-package checks possible.
    DESIGN §2.1 reuses it unchanged with `h_end = min(t0 + 288, last bar)` for
    the long-horizon column, so the two horizons differ ONLY in where they stop.

    The stop proxy is the project's pinned convention: the distance from the
    confirming close back to the SWEEP LEG'S RUNNING EXTREME over `[i, u]`. It
    depends only on `[i, u]`, so it is IDENTICAL across the two horizons — by
    construction, and asserted in `checks.py`.
    """
    c0 = cl[u]
    w_lo = lo[u + 1:h_end + 1].min()
    w_hi = hi[u + 1:h_end + 1].max()
    end_c = cl[h_end]
    if side == "high":
        mfe = c0 - w_lo; mae = w_hi - c0; c_end = c0 - end_c
        ext = hi[i:u + 1].max(); stop = ext - c0
        ext_rev = ext - w_lo
    else:
        mfe = w_hi - c0; mae = c0 - w_lo; c_end = end_c - c0
        ext = lo[i:u + 1].min(); stop = c0 - ext
        ext_rev = w_hi - ext
    mfe = max(mfe, 0.0); mae = max(mae, 0.0)   # excursions floor at 0
    return dict(conf_close=c0, conf_bars_remaining=h_end - u,
                mfe_atr=mfe / a, mae_atr=mae / a,
                mfe_pct=mfe / c0 * 100, mae_pct=mae / c0 * 100,
                end_atr=c_end / a, end_pct=c_end / c0 * 100,
                stop_atr=stop / a, stop_px=ext, ext_rev_atr=ext_rev / a,
                R=(mfe / stop) if stop > 0 else np.nan)


# ==========================================================================
# THE PINNED TRADE TEMPLATE (DESIGN §4) — the only place an R is decided
# ==========================================================================
def simulate_trade(hi, lo, cl, u: int, h_end: int, entry: float,
                   stop_px: float, side: str) -> dict:
    """Entry at the confirmation close `u`; stop at the sweep leg's running
    extreme; target +1R; walk `[u+1, h_end]`.

    Rules, all pinned by DESIGN §4 BEFORE any R existed:
      * the stop is checked FIRST, so a bar that touches both stop and target
        is booked as a **LOSS** (-1.00R) — the conservative reading;
      * a trade that reaches neither is **marked to market** at the horizon's
        closing price, signed, in R;
      * `stop_dist <= 0` or a horizon with no bars in it -> excluded, and the
        caller records the exclusion rather than dropping the row.

    Returns gross R only. The cost of DESIGN §4 is applied by the caller so the
    gross/net split stays visible in the CSV.
    """
    dist = abs(entry - stop_px)
    if not np.isfinite(dist) or dist <= 0 or h_end <= u:
        return dict(grossR=np.nan, exit="excluded", bars_held=np.nan,
                    stop_dist=dist if np.isfinite(dist) else np.nan)
    seg_hi = hi[u + 1:h_end + 1]
    seg_lo = lo[u + 1:h_end + 1]
    if side == "high":                      # short
        target = entry - dist
        s_hits = np.flatnonzero(seg_hi >= stop_px)
        t_hits = np.flatnonzero(seg_lo <= target)
    else:                                   # long
        target = entry + dist
        s_hits = np.flatnonzero(seg_lo <= stop_px)
        t_hits = np.flatnonzero(seg_hi >= target)
    s_at = int(s_hits[0]) if s_hits.size else 10 ** 9
    t_at = int(t_hits[0]) if t_hits.size else 10 ** 9
    if s_at <= t_at and s_at < 10 ** 9:     # ties -> loss (pinned)
        return dict(grossR=-1.0, exit="stop", bars_held=s_at + 1,
                    stop_dist=dist)
    if t_at < 10 ** 9:
        return dict(grossR=1.0, exit="target", bars_held=t_at + 1,
                    stop_dist=dist)
    end_c = cl[h_end]
    mtm = (entry - end_c) if side == "high" else (end_c - entry)
    return dict(grossR=mtm / dist, exit="mtm", bars_held=h_end - u,
                stop_dist=dist)


def trade_columns(hi, lo, cl, i, u, h_end, side, prefix, geo) -> dict:
    """Run the template and attach `grossR` / `cost_R` / `netR` under a
    per-arm, per-horizon column prefix."""
    entry = cl[u]
    stop_px = geo["stop_px"]
    tr = simulate_trade(hi, lo, cl, u, h_end, entry, stop_px, side)
    dist = tr["stop_dist"]
    cost = (C.COST_ROUNDTRIP * entry / dist) if (np.isfinite(dist) and dist > 0) \
        else np.nan
    net = tr["grossR"] - cost if np.isfinite(tr["grossR"]) else np.nan
    return {prefix + "grossR": tr["grossR"], prefix + "cost_R": cost,
            prefix + "netR": net, prefix + "exit": tr["exit"],
            prefix + "bars_held": tr["bars_held"]}


GEO_COLS = ["mfe_atr", "mae_atr", "mfe_pct", "mae_pct", "end_atr", "end_pct",
            "stop_atr", "stop_px", "ext_rev_atr", "R", "conf_close",
            "conf_bars_remaining"]
TRADE_COLS = ["grossR", "cost_R", "netR", "exit", "bars_held"]
ARMS = ("bos", "ifvg")
HORIZONS = ("blk", "h24")


def _blank_arm(ev, pre):
    for h in HORIZONS:
        for c_ in GEO_COLS:
            ev[f"{pre}_{h}_{c_}"] = np.nan
        for c_ in TRADE_COLS:
            ev[f"{pre}_{h}_{c_}"] = np.nan
    ev[f"{pre}_conf_min_utc"] = np.nan
    ev[f"{pre}_in_ny"] = False
    ev[f"{pre}_in_ny_est"] = False


def run_symbol(sym: str):
    d = C.prep(C.load(sym))
    n = len(d)
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy(); cl = d["close"].to_numpy()
    atrv = d["atr"].to_numpy()
    ts = d["ts"].to_numpy()
    blk = d["block"].to_numpy()
    mod = C.minute_of_day(d["ts"]).to_numpy()      # UTC minute-of-day per bar
    ba = C.block_arrays(d)
    block_end = ba["block_end"]; bars_left = ba["bars_left"]
    complete = ba["block_complete"]

    fv = fvg_arrays(d)
    pv = C.pivots(d)
    ai = anchor_index_arrays(pv)
    dg = diag_pivot_arrays(d)
    sess = C.session_frames(d)
    lookback_bars = int(C.LOOKBACK_HOURS * 60 / C.BAR_MIN)

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

            # DESIGN §2.1: the long horizon — 24h from the TAKE-OUT bar, or the
            # end of the data, whichever comes first. It is allowed to cross
            # block and day boundaries; that is the point of the column.
            h24_end = min(i + C.H24_BARS, n - 1)

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
                h24_end_bar=h24_end, h24_bars_remaining=h24_end - i,
                h24_truncated=bool(i + C.H24_BARS > n - 1),
                window_min=left * C.BAR_MIN,
                excursion_pct=abs(ref - lead["px"]) / lead["px"] * 100,
                excursion_atr=abs(ref - lead["px"]) / a,
                hour=int(pd.Timestamp(ts[i]).hour),
                t0_min_utc=int(mod[i]),
                # eligibility diagnostic (DESIGN §2.2): could a confirmation of
                # THIS take-out land inside the window at all? It can only if
                # t0 itself is at or before the window's last bar and in the NY
                # block, because confirmation is block-scoped and u >= t0.
                t0_window_eligible=bool(blk[i] == "NY" and mod[i] < C.NY_WIN_UTC[1]),
                t0_in_ny_window=bool(C.in_ny_window(np.array([mod[i]]))[0]),
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
            # ARM 1 — the corrected BoS (knowledge §5.2)
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
                    bos_anchor_dist_atr=abs(ref - an["px"]) / a,
                    bos_anchor_beyond_level=bool((an["px"] > lead["px"]) if side == "high"
                                                 else (an["px"] < lead["px"])),
                    bos_confirmed=ub >= 0,
                    bos_delay_bars=(ub - i) if ub >= 0 else np.nan,
                    bos_break_bar=ub,
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
                    bos_break_bar=-1, bos_cause="unanchorable",
                )

            # ================================================================
            # ARM 2 — iFVG v4 (knowledge §5.1)
            # ================================================================
            r4 = ifvg_confirm_v4(fv, cl, i, be, lead["px"], side, strict=False)
            u4 = r4["confirm_idx"]
            gap_sz = (r4["gap_hi"] - r4["gap_lo"]) if u4 >= 0 else np.nan
            ev.update(
                ifvg_confirmed=u4 >= 0,
                ifvg_delay_bars=(u4 - i) if u4 >= 0 else np.nan,
                ifvg_form_bar=r4["form_idx"] if u4 >= 0 else np.nan,
                ifvg_form_delay_bars=(r4["form_idx"] - i) if u4 >= 0 else np.nan,
                ifvg_gap_lo=r4["gap_lo"], ifvg_gap_hi=r4["gap_hi"],
                ifvg_gap_atr=gap_sz / a if u4 >= 0 else np.nan,
                ifvg_break_bar=u4,
                n_candidates=r4["n_candidates"],
                n_replacements=r4["n_replacements"],
                unconf_cause=r4["cause"],
            )

            # ============ GEOMETRY + TRADE, both arms, BOTH horizons =========
            for pre, u_ in (("bos", ub), ("ifvg", u4)):
                _blank_arm(ev, pre)
                if u_ < 0:
                    continue
                ev[f"{pre}_conf_min_utc"] = int(mod[u_])
                ev[f"{pre}_in_ny"] = bool(C.in_ny_window(np.array([mod[u_]]))[0])
                ev[f"{pre}_in_ny_est"] = bool(
                    C.in_ny_window(np.array([mod[u_]]), C.NY_WIN_UTC_EST)[0])
                for h, h_end in (("blk", be), ("h24", h24_end)):
                    if u_ >= h_end:
                        continue     # no bars left to measure in this horizon
                    g = _from_confirmation(hi, lo, cl, a, i, u_, h_end, side)
                    ev.update({f"{pre}_{h}_{k}": v for k, v in g.items()})
                    ev.update(trade_columns(hi, lo, cl, i, u_, h_end, side,
                                            f"{pre}_{h}_", g))

            # ---- relative timing when BOTH methods fire ---------------------
            ev["both_confirmed"] = bool(ev["bos_confirmed"] and ev["ifvg_confirmed"])
            ev["bos_minus_ifvg_bars"] = (ub - u4) if (ub >= 0 and u4 >= 0) else np.nan

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
    """Block-scoped move distribution from EVERY bar — the descriptive
    yardstick behind the non-circular forward lift. Copied verbatim from v4."""
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
    print(f"NY window (pinned, UTC{C.NY_OFFSET_PRIMARY:+d}) = "
          f"{C.NY_WIN_UTC[0]//60:02d}:{C.NY_WIN_UTC[0]%60:02d}-"
          f"{C.NY_WIN_UTC[1]//60:02d}:{C.NY_WIN_UTC[1]%60:02d} UTC "
          f"({C.NY_WIN_BARS} bars)", flush=True)
    for sym in a.symbols.split(","):
        ev = run_symbol(sym)
        ev.to_csv(os.path.join(C.RESULTS, f"events_{sym}.csv"), index=False)
        un = unconditional(sym)
        un.to_csv(os.path.join(C.RESULTS, f"uncond_{sym}.csv.gz"), index=False)
        prim = ev[ev.bars_remaining >= C.MIN_BARS_REMAINING]
        print(f"{sym}: {len(ev):>6} take-outs ({len(prim):>6} primary)  |  "
              f"BoS {ev.bos_confirmed.mean():.1%}  iFVG {ev.ifvg_confirmed.mean():.1%}"
              f"  |  in NY window: BoS {int(ev.bos_in_ny.sum()):>4} "
              f"iFVG {int(ev.ifvg_in_ny.sum()):>4}  |  uncond bars {len(un):,}",
              flush=True)


if __name__ == "__main__":
    main()
