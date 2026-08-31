#!/usr/bin/env python3
"""Sweep-detection + measurement engine — session-liquidity **v2**, iFVG only.

Spec: `knowledge/session-liquidity.md` (v2 reissue). Forked from the phase-1
`research/session-liquidity/engine.py`; the FVG geometry (`fvg_arrays`) and the
level-pool machinery survive unchanged, everything time-scoped is rewritten.

v2 differences, all of them spec-driven:
  * sessions are non-overlapping; a fourth residual block "Late" (21-24 UTC)
    hosts sweeps but produces no levels;
  * EVERY window is block-scoped — the measurement horizon and the iFVG
    formation/inversion window both run from the take-out bar to the last bar
    of the `sweep_block` the take-out happens in (V4). The 2h constants are
    gone;
  * iFVG location is RELAXED by default (V5: the gap need only reach beyond the
    swept level); the strict phase-1 reading is carried as a sensitivity column;
  * **BoS is not computed at all** (V6, out of scope — its phase-1 mechanic is
    defective, see ../session-liquidity/corrections/BOS-CORRECTION-NOTE.md).

Descriptive pass (user's standing call): no permutation null, no kill rule, no
fit/holdout split. Correctness hygiene is still hard requirement and is asserted
mechanically in `checks.py`.

Writes results/events_<SYM>.csv (one row per take-out) and
results/uncond_<SYM>.csv.gz (the block-scoped unconditional yardstick).

Usage:  .venv/bin/python research/session-liquidity-v2/engine.py
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

import common as C


# --------------------------------------------------------------------------
# FVG geometry (3-candle, standard) — unchanged from phase 1
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


def ifvg_confirm(fv, close, t0, t_end, level, side, strict=False):
    """First bar in `[t0, t_end]` at which an iFVG confirms the sweep.

    `t_end` is the BLOCK END in v2 — the caller passes the block-scoped bound,
    so both the gap's third bar and the inversion close are contained in
    `[take-out bar, end of sweep_block]` (V4).

    side='high' (a swept session HIGH) needs a BEARISH inversion: a bullish FVG
    that forms above the swept level and is later fully CLOSED through its lower
    edge (a wick poke never counts).
        strict=False (V5 default) -> the gap need only REACH beyond the level
                                     (gap_hi > level)
        strict=True               -> the whole gap must sit beyond it
                                     (gap_lo >= level); phase-1 reading, kept as
                                     a sensitivity column only.
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
def run_symbol(sym: str) -> pd.DataFrame:
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
            pool[side] = [L for L in pool[side] if id(L) not in drop]  # V7: swept once
            # V2 attribution: the level that required the largest excursion to
            # reach; ties -> the most recently closed session.
            if side == "high":
                lead = max(taken, key=lambda L: (L["px"], L["end_idx"]))
            else:
                lead = min(taken, key=lambda L: (L["px"], -L["end_idx"]))

            # V4: the horizon is this bar's block, and only if that block is
            # fully present in the data (otherwise the file end, not the clock,
            # would set the window).
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
            )

            # ---- magnitude A: measured from the sweep's own WICK EXTREME ----
            # window = (take-out bar, block end]. `left == 0` means the take-out
            # printed on the block's last bar: no window at all, every magnitude
            # is NaN but the event is still counted as a take-out.
            if left > 0:
                fw_lo = lo[i + 1:be + 1].min()
                fw_hi = hi[i + 1:be + 1].max()
                end_c = cl[be]
                if side == "high":
                    rev_raw = ref - fw_lo; adv_raw = fw_hi - ref; end_abs = ref - end_c
                else:
                    rev_raw = fw_hi - ref; adv_raw = ref - fw_lo; end_abs = end_c - ref
                # MFE/MAE are EXCURSIONS from the reference, so they floor at 0:
                # price is at `ref` when the clock starts and the window opens at
                # i+1, so a window that never trades past `ref` has excursion 0,
                # not a negative one. `no_continuation` keeps the information the
                # floor would otherwise hide (see T4's share column).
                rev_abs = max(rev_raw, 0.0); adv_abs = max(adv_raw, 0.0)
                ev.update(rev_pct=rev_abs / ref * 100, rev_atr=rev_abs / a,
                          adv_pct=adv_abs / ref * 100, adv_atr=adv_abs / a,
                          end_pct=end_abs / ref * 100, end_atr=end_abs / a,
                          no_continuation=adv_raw <= 0, no_reversal=rev_raw <= 0)
            else:
                ev.update(rev_pct=np.nan, rev_atr=np.nan, adv_pct=np.nan,
                          adv_atr=np.nan, end_pct=np.nan, end_atr=np.nan,
                          no_continuation=np.nan, no_reversal=np.nan)

            # ---- iFVG confirmation, block-scoped (V4) + location variants ---
            if_idx, if_form = ifvg_confirm(fv, cl, i, be, lead["px"], side,
                                           strict=False)     # V5 default
            st_idx, _ = ifvg_confirm(fv, cl, i, be, lead["px"], side, strict=True)
            ev.update(
                ifvg_confirmed=if_idx >= 0,
                ifvg_delay_bars=(if_idx - i) if if_idx >= 0 else np.nan,
                ifvg_form_bar=if_form if if_form >= 0 else np.nan,
                ifvg_strict_confirmed=st_idx >= 0,
                ifvg_strict_delay_bars=(st_idx - i) if st_idx >= 0 else np.nan,
            )

            # ---- block-truncation diagnostic (NOT a definition) -------------
            # Would this take-out have confirmed had the block run 2h longer?
            # Answers "unconfirmed because the block ended" with a number
            # instead of a hunch. Only computed for unconfirmed events.
            if if_idx < 0:
                probe_end = min(be + C.TRUNCATION_PROBE_BARS, n - 1)
                p_idx, _ = ifvg_confirm(fv, cl, i, probe_end, lead["px"], side,
                                        strict=False)
                ev["ifvg_would_confirm_extended"] = p_idx >= 0
                ev["ifvg_extended_delay_bars"] = (p_idx - i) if p_idx >= 0 else np.nan
            else:
                ev["ifvg_would_confirm_extended"] = False
                ev["ifvg_extended_delay_bars"] = np.nan

            # ---- magnitude B: measured from the CONFIRMATION CLOSE ----------
            # Same block end: a trader entering on the signal has whatever is
            # left of the block, not a fresh full window. This is the
            # uncontaminated view (phase-1 T12/T13 analogue) and it is where the
            # stop / R proxies come from.
            if if_idx >= 0 and if_idx < be:
                c0 = cl[if_idx]
                w_lo = lo[if_idx + 1:be + 1].min()
                w_hi = hi[if_idx + 1:be + 1].max()
                end_c = cl[be]
                if side == "high":
                    mfe = c0 - w_lo; mae = w_hi - c0; c_end = c0 - end_c
                    ext = hi[i:if_idx + 1].max(); stop = ext - c0
                    ext_rev = ext - w_lo
                else:
                    mfe = w_hi - c0; mae = c0 - w_lo; c_end = end_c - c0
                    ext = lo[i:if_idx + 1].min(); stop = c0 - ext
                    ext_rev = w_hi - ext
                mfe = max(mfe, 0.0); mae = max(mae, 0.0)   # excursions floor at 0
                ev.update(
                    conf_close=c0,
                    conf_bars_remaining=be - if_idx,
                    ifvg_mfe_atr=mfe / a, ifvg_mae_atr=mae / a,
                    ifvg_mfe_pct=mfe / c0 * 100, ifvg_mae_pct=mae / c0 * 100,
                    ifvg_end_atr=c_end / a, ifvg_end_pct=c_end / c0 * 100,
                    ifvg_stop_atr=stop / a, ifvg_ext_rev_atr=ext_rev / a,
                    ifvg_R=(mfe / stop) if stop > 0 else np.nan,
                )
            else:
                for c_ in ("conf_close", "conf_bars_remaining", "ifvg_mfe_atr",
                           "ifvg_mae_atr", "ifvg_mfe_pct", "ifvg_mae_pct",
                           "ifvg_end_atr", "ifvg_end_pct", "ifvg_stop_atr",
                           "ifvg_ext_rev_atr", "ifvg_R"):
                    ev[c_] = np.nan
            events.append(ev)

    return pd.DataFrame(events)


def unconditional(sym: str) -> pd.DataFrame:
    """Block-scoped move distribution from EVERY bar — the yardstick.

    Mirrors the conditional measurement exactly: from a bar's high, how far does
    price travel DOWN before its block ends (the high-sweep analogue), and from
    a bar's low, how far UP. `bars_remaining` is carried so the baseline can be
    filtered / bucket-matched to the conditional sample instead of being
    compared across mismatched window lengths.
    """
    d = C.prep(C.load(sym))
    ba = C.block_arrays(d)
    be = ba["block_end"]; left = ba["bars_left"]; complete = ba["block_complete"]
    n = len(d)
    hi = d["high"].to_numpy(); lo = d["low"].to_numpy(); a = d["atr"].to_numpy()

    # Suffix-scan per block: running min-low / max-high over (i, block_end].
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
        print(f"{sym}: {len(ev):>6} take-outs ({len(prim):>6} primary, "
              f">= {C.MIN_BARS_REMAINING} bars left)  |  "
              f"iFVG {ev.ifvg_confirmed.mean():.1%} (primary {prim.ifvg_confirmed.mean():.1%})  "
              f"| uncond bars {len(un):,}", flush=True)


if __name__ == "__main__":
    main()
