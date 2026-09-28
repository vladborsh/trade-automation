#!/usr/bin/env python3
"""Holdout + tail for arms that passed the fit screen ONLY (DESIGN §8).

Reads results/screen.json written by run_fit.py; an arm marked false is never
simulated on the holdout. Applies the verdict ladder mechanically.
"""
from __future__ import annotations
import json, os
import numpy as np
import pandas as pd

from common import (OUT, SYMBOLS, TIERS, ARMS, FIT_END, HOLD_START, HOLD_END,
                    TAIL_START, TAIL_END, ALPHA, N_HOLD_MIN, BUILD_MEAN,
                    SCREEN_MEAN, SCREEN_MARGIN, day_block_boot, diff_boot)
from prep import build_symbol
from engine import armed_mask, simulate, placebo, Trig
from run_fit import summarise, windows_for


def run(Ss, trigs, side, syms, variant, lo, hi):
    rows = []
    for s in syms:
        d = Ss[s]["dec"]
        a = armed_mask(d, side, variant) & (d.index >= lo - pd.Timedelta(hours=32)) & (d.index < hi)
        rows += simulate(Ss[s], side, a, (lo, hi), "T1R", trig=trigs[s])
    return pd.DataFrame(rows)


def main():
    screen = json.load(open(os.path.join(OUT, "screen.json")))
    fit = pd.read_csv(os.path.join(OUT, "fit_arms.csv")).set_index("arm")
    passed = [a for a in ARMS if screen.get(a)]
    if not passed:
        print("no arm passed the fit screen; holdout not read.")
        return
    Ss = {s: build_symbol(s) for s in SYMBOLS}
    trigs = {s: Trig(Ss[s]) for s in SYMBOLS}
    out = []
    for arm in passed:
        side = -1 if arm.startswith("P1") else 1
        syms = TIERS[arm[-1]]
        real = run(Ss, trigs, side, syms, "R4", HOLD_START, HOLD_END)
        sh = run(Ss, trigs, side, syms, "SHADOW", HOLD_START, HOLD_END)
        tail = run(Ss, trigs, side, syms, "R4", TAIL_START, TAIL_END)
        s = summarise(real)
        n, m = s.get("n", 0), s.get("netR", np.nan)
        p = np.nan
        if n:
            wins = {x: (HOLD_START, HOLD_END) for x in syms}
            p = float(np.nanmean(placebo(Ss, real, wins) >= m))
        msh = sh.netR.mean() if len(sh) else np.nan
        margin = m - msh
        mlo, mhi = (diff_boot(real.netR, real.t_entry.dt.floor("D"), sh.netR, sh.t_entry.dt.floor("D"))
                    if n and len(sh) else (np.nan, np.nan))
        m_fit = fit.at[arm, "mean_netR"]; marg_fit = fit.at[arm, "margin"]
        six = (m >= BUILD_MEAN and p <= ALPHA and m_fit >= SCREEN_MEAN and n >= N_HOLD_MIN
               and s.get("ci90_lo", np.nan) > 0 and s.get("grossR", np.nan) > 0)
        marg_ok = margin >= SCREEN_MARGIN and mlo > 0 and marg_fit > 0
        if n < N_HOLD_MIN:
            v = "UNDERPOWERED — inconclusive"
        elif m < SCREEN_MEAN or p > 0.20:
            v = "NO EDGE — kill"
        elif six and marg_ok:
            v = "REAL EDGE — build ruling"
        elif six:
            v = "DOMINATED — price in disguise"
        else:
            v = "INCONCLUSIVE"
        out.append(dict(arm=arm, **s, placebo_p=p, shadow_n=len(sh), shadow_mean=msh,
                        margin=margin, margin_ci90_lo=mlo, margin_ci90_hi=mhi,
                        tail_n=len(tail), tail_netR=(tail.netR.mean() if len(tail) else np.nan),
                        verdict=v))
        print(out[-1], flush=True)
    pd.DataFrame(out).to_csv(os.path.join(OUT, "holdout_arms.csv"), index=False, float_format="%.4f")


if __name__ == "__main__":
    main()
