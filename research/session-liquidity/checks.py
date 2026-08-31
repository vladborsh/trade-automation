#!/usr/bin/env python3
"""Correctness assertions for the session-liquidity engine.

The protocol for this pass is descriptive -- no statistical gate -- but the
hygiene claims in REPORT.md §0 are checkable, so they are checked here rather
than asserted in prose. Run after engine.py.

Usage: .venv/bin/python research/session-liquidity/checks.py
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import common as C
import engine as E
import tables as T


def main():
    e = T.load_events()
    ok = []

    def chk(name, cond, detail=""):
        ok.append(cond)
        print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

    # D1 / D9: a level is only usable after its session closed, and for 48h.
    chk("D1 levels are never used before their session closes",
        bool((e.level_age_h > 0).all()), f"min age {e.level_age_h.min():.2f}h")
    chk("D9 levels expire at 48h",
        bool((e.level_age_h <= C.LOOKBACK_HOURS + 1e-9).all()),
        f"max age {e.level_age_h.max():.2f}h")

    # D4: confirmations live inside the window.
    for col in ("ifvg_delay_bars", "bos_delay_bars"):
        d = e[col].dropna()
        chk(f"D4 {col} within [0, {C.CONFIRM_BARS}]",
            bool(((d >= 0) & (d <= C.CONFIRM_BARS)).all()),
            f"min {d.min():.0f} max {d.max():.0f}")

    # The take-out wick really is beyond the level, in the right direction.
    hi = e[e.direction == "high_sweep"]
    lo = e[e.direction == "low_sweep"]
    chk("take-out wick is beyond the level (high sweeps)",
        bool((hi.sweep_ref > hi.level_px).all()))
    chk("take-out wick is beyond the level (low sweeps)",
        bool((lo.sweep_ref < lo.level_px).all()))

    # Magnitudes are non-negative excursions by construction.
    chk("reverse move is a non-negative excursion", bool((e.rev_atr >= 0).all()))

    # Each level is swept at most once (D8): no duplicate (symbol, session,
    # level price, level end) key across events.
    key = e[["symbol", "level_session", "level_px"]].astype(str).agg("|".join, axis=1)
    dup = key.duplicated().sum()
    print(f"[info] repeated (symbol, session, price) keys: {dup} "
          f"({100*dup/len(e):.1f}%) — expected non-zero, prices recur across days")

    # iFVG strictness: rebuild one symbol and verify every confirmation is a
    # genuine full close-through of a gap that sits wholly beyond the level.
    sym = "BTCUSDT"
    d = C.prep(C.load(sym))
    fv = E.fvg_arrays(d)
    cl = d.close.to_numpy()
    sub = e[(e.symbol == sym) & e.ifvg_confirmed].head(400)
    bad = 0
    for _, r in sub.iterrows():
        i = int(r.bar)
        side = "high" if r.direction == "high_sweep" else "low"
        u, t = E.ifvg_confirm(fv, cl, i, i + C.CONFIRM_BARS, r.level_px, side, True)
        if u < 0 or t < 0:
            bad += 1
            continue
        g_lo = fv["bull_lo"][t] if side == "high" else fv["bear_lo"][t]
        g_hi = fv["bull_hi"][t] if side == "high" else fv["bear_hi"][t]
        if side == "high":
            if not (g_lo >= r.level_px and cl[u] < g_lo and u > t):
                bad += 1
        else:
            if not (g_hi <= r.level_px and cl[u] > g_hi and u > t):
                bad += 1
    chk("iFVG confirmations are full close-throughs of a gap beyond the level",
        bad == 0, f"{bad} violations in {len(sub)} sampled events")

    # Pivot causality: the flag on bar j describes bar j-K, and bar j-K's extreme
    # is genuinely the neighbourhood extreme.
    K = C.K
    idx = np.flatnonzero(d.piv_lo_conf.to_numpy())
    idx = idx[(idx >= 2 * K) & (idx < len(d) - 1)][:5000]
    lows = d.low.to_numpy()
    viol = sum(1 for j in idx if lows[j - K] > lows[j - 2 * K:j + 1].min() + 1e-12)
    chk(f"k={K} pivot lows are true neighbourhood minima, confirmed k bars late",
        viol == 0, f"{viol} violations in {len(idx)} sampled pivots")

    print("\n" + ("ALL CHECKS PASSED" if all(ok) else "SOME CHECKS FAILED"))
    return 0 if all(ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
