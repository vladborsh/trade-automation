#!/usr/bin/env python3
"""Sweep-detection + measurement engine for the session-liquidity study.

Descriptive pass only (per the user's explicit protocol call): no permutation
nulls, no kill rule, no fit/holdout split. Correctness hygiene is still hard
requirement:
  * pivots come from the project's `fractals(df, k=3)`, which is already shifted
    by k -- a swing is only known k bars after it printed;
  * an iFVG requires a full CLOSE through the far edge of the gap;
  * session levels only enter the pool after the session window has closed;
  * every forward measurement starts strictly after the bar it is measured from.

Writes results/events_<SYM>.csv (one row per sweep event) and
results/uncond_<SYM>.csv (the unconditional same-horizon yardstick).

Usage:  .venv/bin/python research/session-liquidity/engine.py
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

import common as C


# --------------------------------------------------------------------------
# structure: local BoS trigger built on the k=3 pivot primitive
# --------------------------------------------------------------------------
def bos_flags(d: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Bearish / bullish break-of-structure flags.

    A bearish BoS = the first CLOSE below the most recently confirmed, still
    unbroken pivot low; mirrored for bullish. Once broken, the level is retired
    until a new pivot confirms -- so each swing is broken at most once. This is
    the local one-off trigger the spec calls for, NOT the general-purpose
    bias/CHoCH engine (closed twice already, RESEARCH-LOG Записи 5/6).
    """
    n = len(d)
    close = d["close"].to_numpy()
    pl_c = d["piv_lo_conf"].to_numpy(); pl_p = d["piv_lo_px"].to_numpy()
    ph_c = d["piv_hi_conf"].to_numpy(); ph_p = d["piv_hi_px"].to_numpy()
    dn = np.zeros(n, dtype=bool); up = np.zeros(n, dtype=bool)
    act_lo = np.nan; act_hi = np.nan
    for j in range(n):
        if pl_c[j]:
            act_lo = pl_p[j]
        if ph_c[j]:
            act_hi = ph_p[j]
        if not np.isnan(act_lo) and close[j] < act_lo:
            dn[j] = True; act_lo = np.nan
        if not np.isnan(act_hi) and close[j] > act_hi:
            up[j] = True; act_hi = np.nan
    return dn, up


# --------------------------------------------------------------------------
# FVG geometry (3-candle, standard)
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


def ifvg_confirm(fv, close, t0, t_end, level, side, strict=True):
    """First bar in [t0, t_end] at which an iFVG confirms the sweep.

    side='high' (a swept session HIGH) needs a BEARISH inversion: a bullish FVG
    that forms above the swept level and is later fully closed through its lower
    edge.  strict=True  -> the whole gap must sit above the level (gap_lo >= level)
             strict=False -> the gap need only reach above it (gap_hi > level)
    Mirrored for side='low'.
    Returns (confirm_idx, form_idx) or (-1, -1).
    """
    if side == "high":
        form = fv["bull"]; g_lo = fv["bull_lo"]; g_hi = fv["bull_hi"]
    else:
        form = fv["bear"]; g_lo = fv["bear_lo"]; g_hi = fv["bear_hi"]
    best = -1; best_form = -1
    for t in range(t0, t_end + 1):
        if not form[t]:
            continue
        lo_e, hi_e = g_lo[t], g_hi[t]
        if side == "high":
            ok = (lo_e >= level) if strict else (hi_e > level)
        else:
            ok = (hi_e <= level) if strict else (lo_e < level)
        if not ok:
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
def sweep_session_label(ts) -> str:
    h = ts.hour
    if h < 8:
        return "Asia"
    if h < 13:
        return "London"
    if h < 16:
        return "London/NY overlap"
    if h < 21:
        return "NY"
    return "off-session"


def run_symbol(sym: str, strict_ifvg=True) -> pd.DataFrame:
    d = C.prep(C.load(sym))
    n = len(d)
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy(); cl = d["close"].to_numpy()
    atrv = d["atr"].to_numpy()
    ts = d["ts"].to_numpy()
    dn, up = bos_flags(d)
    fv = fvg_arrays(d)
    sess = C.session_frames(d)

    H = C.HORIZON_BARS; W = C.CONFIRM_BARS
    lookback_bars = int(C.LOOKBACK_HOURS * 60 / C.BAR_MIN)

    # active level pool: list of dicts, separately for high-side and low-side
    pool = {"high": [], "low": []}
    ptr = 0
    sess_rows = sess.to_dict("records")
    events = []

    for i in range(n):
        # (1) admit levels whose session has closed by this bar
        while ptr < len(sess_rows) and sess_rows[ptr]["known_from"] <= i:
            r = sess_rows[ptr]
            pool["high"].append(dict(px=r["high"], session=r["session"],
                                     end_idx=r["end_idx"], t_end=r["t_end"]))
            pool["low"].append(dict(px=r["low"], session=r["session"],
                                    end_idx=r["end_idx"], t_end=r["t_end"]))
            ptr += 1
        # (2) expire levels older than the 2-day reference scope
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
            pool[side] = [L for L in pool[side] if id(L) not in drop]  # swept once, retired
            # PINNED attribution: the event belongs to the level that required
            # the largest excursion to reach (highest high / lowest low);
            # ties -> the most recently closed session.
            if side == "high":
                key = lambda L: (L["px"], L["end_idx"])
                lead = max(taken, key=key)
            else:
                lead = min(taken, key=lambda L: (L["px"], -L["end_idx"]))
            if i + H >= n or i + W >= n:
                continue

            ref = hi[i] if side == "high" else lo[i]
            a = atrv[i]
            if not np.isfinite(a) or a <= 0:
                continue

            fw_lo = lo[i + 1:i + 1 + H].min()
            fw_hi = hi[i + 1:i + 1 + H].max()
            end_c = cl[i + H]
            if side == "high":
                rev_abs = ref - fw_lo
                adv_abs = fw_hi - ref
                end_abs = ref - end_c
            else:
                rev_abs = fw_hi - ref
                adv_abs = ref - fw_lo
                end_abs = end_c - ref

            # confirmations, computed independently over the same tape
            bos_arr = dn if side == "high" else up
            w = np.flatnonzero(bos_arr[i:i + W + 1])
            bos_idx = int(i + w[0]) if w.size else -1
            if_idx, if_form = ifvg_confirm(fv, cl, i, i + W, lead["px"], side,
                                           strict=strict_ifvg)
            if_lax, _ = ifvg_confirm(fv, cl, i, i + W, lead["px"], side, strict=False)

            ev = dict(
                symbol=sym, ts=pd.Timestamp(ts[i]), bar=i,
                month=d["month"].iat[i],
                direction="high_sweep" if side == "high" else "low_sweep",
                level_session=lead["session"],
                sweep_session=sweep_session_label(pd.Timestamp(ts[i])),
                level_px=lead["px"], n_levels_taken=len(taken),
                level_age_h=(i - lead["end_idx"]) * C.BAR_MIN / 60.0,
                sweep_ref=ref, atr=a,
                excursion_pct=abs(ref - lead["px"]) / lead["px"] * 100,
                excursion_atr=abs(ref - lead["px"]) / a,
                rev_pct=rev_abs / ref * 100, rev_atr=rev_abs / a,
                adv_pct=adv_abs / ref * 100, adv_atr=adv_abs / a,
                end_pct=end_abs / ref * 100, end_atr=end_abs / a,
                bos_confirmed=bos_idx >= 0,
                bos_delay_bars=(bos_idx - i) if bos_idx >= 0 else np.nan,
                ifvg_confirmed=if_idx >= 0,
                ifvg_delay_bars=(if_idx - i) if if_idx >= 0 else np.nan,
                ifvg_lax_confirmed=if_lax >= 0,
                ifvg_lax_delay_bars=(if_lax - i) if if_lax >= 0 else np.nan,
            )
            # reverse move measured from each method's confirmation close
            # (secondary -- the spec's primary reference is the sweep extreme)
            for tag, cidx in (("bos", bos_idx), ("ifvg", if_idx)):
                if cidx >= 0 and cidx + H < n:
                    c0 = cl[cidx]
                    if side == "high":
                        mfe = c0 - lo[cidx + 1:cidx + 1 + H].min()
                        mae = hi[cidx + 1:cidx + 1 + H].max() - c0
                    else:
                        mfe = hi[cidx + 1:cidx + 1 + H].max() - c0
                        mae = c0 - lo[cidx + 1:cidx + 1 + H].min()
                    ev[f"{tag}_mfe_atr"] = mfe / a
                    ev[f"{tag}_mae_atr"] = mae / a
                    # running extreme of the whole sweep leg (take-out bar ..
                    # confirmation bar). This is where a protective stop would
                    # sit, so mfe / stop_dist is a natural R proxy.
                    if side == "high":
                        ext = hi[i:cidx + 1].max()
                        stop = ext - c0
                        ext_rev = ext - lo[cidx + 1:cidx + 1 + H].min()
                    else:
                        ext = lo[i:cidx + 1].min()
                        stop = c0 - ext
                        ext_rev = hi[cidx + 1:cidx + 1 + H].max() - ext
                    ev[f"{tag}_stop_atr"] = stop / a
                    ev[f"{tag}_ext_rev_atr"] = ext_rev / a
                    ev[f"{tag}_R"] = mfe / stop if stop > 0 else np.nan
                else:
                    for c_ in ("mfe_atr", "mae_atr", "stop_atr", "ext_rev_atr", "R"):
                        ev[f"{tag}_{c_}"] = np.nan
            events.append(ev)

    return pd.DataFrame(events)


def unconditional(sym: str) -> pd.DataFrame:
    """Same-horizon move distribution from EVERY bar -- the yardstick.

    Mirrors the conditional measurement exactly: from a bar's high, how far does
    price travel down over the next 2h (the 'high-sweep-like' case), and from a
    bar's low, how far up ('low-sweep-like').
    """
    d = C.prep(C.load(sym))
    H = C.HORIZON_BARS
    lo = d["low"]; hi = d["high"]; a = d["atr"]
    fw_lo = lo.shift(-1).rolling(H).min().shift(-(H - 1))
    fw_hi = hi.shift(-1).rolling(H).max().shift(-(H - 1))
    out = pd.DataFrame({
        "ts": d["ts"], "month": d["month"], "symbol": sym,
        "sweep_session": d["ts"].map(sweep_session_label),
        "down_pct": (hi - fw_lo) / hi * 100, "down_atr": (hi - fw_lo) / a,
        "up_pct": (fw_hi - lo) / lo * 100, "up_atr": (fw_hi - lo) / a,
    })
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
        print(f"{sym}: {len(ev):>6} sweep events  |  "
              f"iFVG {ev.ifvg_confirmed.mean():.1%}  BoS {ev.bos_confirmed.mean():.1%}  "
              f"| uncond bars {len(un)}", flush=True)


if __name__ == "__main__":
    main()
