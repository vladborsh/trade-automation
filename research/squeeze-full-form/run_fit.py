#!/usr/bin/env python3
"""Fit period: four arms, their shadows, the ablation ladder, side rows,
placebo, and the screen (DESIGN §7, §8). Never touches entries >= FIT_END.

Outputs:
  results/fit_windows.csv     effective fit start per arm x symbol
  results/fit_summary.csv     every (arm, variant, template) row with decomposition
  results/fit_symbols.csv     per-symbol rows for R4 / SHADOW / R0 (T1R)
  results/fit_arms.csv        the screen: n, mean, shadow margin, placebo p, verdict
  results/screen.json         which arms may read the holdout
  results/trades_fit.csv      every fit trade
"""
from __future__ import annotations
import json, os, time
import numpy as np
import pandas as pd

from common import (OUT, SYMBOLS, TIERS, ARMS, FIT_END, FLOOR_N_FIT, SCREEN_MEAN,
                    SCREEN_MARGIN, day_block_boot, diff_boot, tstat)
from prep import build_symbol
from engine import armed_mask, evaluable_mask, simulate, placebo, Trig

VARIANTS = ["R0", "R1", "R2", "R3", "R4", "SHADOW", "R4_BINONLY", "R4_P2FLAT0", "R0_FULL"]
TEMPL_FULL = {"R4", "SHADOW", "R0"}


def summarise(df: pd.DataFrame) -> dict:
    if df is None or len(df) == 0:
        return dict(n=0)
    days = df["t_entry"].dt.floor("D").values
    lo, hi = day_block_boot(df["netR"].values, days)
    return dict(n=len(df), netR=df.netR.mean(), priceR=df.priceR.mean(),
                fundingR=df.fundingR.mean(), costR=df.costR.mean(),
                grossR=df.grossR.mean(), t=tstat(df.netR.values),
                ci90_lo=lo, ci90_hi=hi, win=(df.priceR > 0).mean(),
                sett_per_trade=df.n_sett.mean(), zero_sett=(df.n_sett == 0).mean(),
                hold_h=df.hold_h.mean(),
                stop=(df.cause == "stop").mean(), target=(df.cause == "target").mean(),
                time=(df.cause == "time").mean(),
                flag_lt3_venues=(df.n_venues < 3).mean(),
                n_days=len(np.unique(days)))


def windows_for(Ss, side, syms, variant):
    out = {}
    for s in syms:
        d = Ss[s]["dec"]
        if variant == "R0_FULL":
            ev = (d["contig"].values & np.isfinite(d["atr"].values)
                  & d["binance_present"].values)
        else:
            ev = evaluable_mask(d, side)
        idx = np.where(ev)[0]
        if len(idx) == 0:
            continue
        out[s] = (d.index[idx[0]], FIT_END)
    return out


def run_variant(Ss, trigs, side, syms, variant, template, wins):
    rows = []
    v = "R0" if variant == "R0_FULL" else variant
    for s in syms:
        if s not in wins:
            continue
        d = Ss[s]["dec"]
        a = armed_mask(d, side, v)
        a &= (d.index >= wins[s][0]) & (d.index < wins[s][1])
        rows += simulate(Ss[s], side, a, wins[s], template, trig=trigs[s])
    return pd.DataFrame(rows)


def main():
    t0 = time.time()
    Ss = {s: build_symbol(s) for s in SYMBOLS}
    trigs = {s: Trig(Ss[s]) for s in SYMBOLS}
    print(f"prep {time.time()-t0:.0f}s", flush=True)

    win_rows, summ, symrows, arms, all_tr = [], [], [], [], []
    screen = {}
    for arm in ARMS:
        side = -1 if arm.startswith("P1") else 1
        syms = TIERS[arm[-1]]
        wins = windows_for(Ss, side, syms, "R4")
        wins_full = windows_for(Ss, side, syms, "R0_FULL")
        for s in syms:
            win_rows.append(dict(arm=arm, sym=s,
                                 eff_start=wins.get(s, (None,))[0],
                                 r0_full_start=wins_full.get(s, (None,))[0],
                                 fit_end=FIT_END))
        res = {}
        for var in VARIANTS:
            for tpl in (["T1R", "T3R", "TVWAP"] if var in TEMPL_FULL else ["T1R"]):
                w = wins_full if var == "R0_FULL" else wins
                df = run_variant(Ss, trigs, side, syms, var, tpl, w)
                res[(var, tpl)] = df
                row = dict(arm=arm, variant=var, template=tpl, **summarise(df))
                summ.append(row)
                if len(df):
                    all_tr.append(df.assign(arm=arm, variant=var, template=tpl))
                if tpl == "T1R" and var in ("R4", "SHADOW", "R0") and len(df):
                    for s, g in df.groupby("sym"):
                        symrows.append(dict(arm=arm, variant=var, sym=s, **summarise(g)))
            print(f"{arm} {var}: n={len(res[(var, 'T1R')])} "
                  f"({time.time()-t0:.0f}s)", flush=True)

        real, sh = res[("R4", "T1R")], res[("SHADOW", "T1R")]
        n = len(real)
        m = real.netR.mean() if n else np.nan
        msh = sh.netR.mean() if len(sh) else np.nan
        margin = m - msh if (n and len(sh)) else np.nan
        mlo = mhi = np.nan
        if n and len(sh):
            mlo, mhi = diff_boot(real.netR.values, real.t_entry.dt.floor("D").values,
                                 sh.netR.values, sh.t_entry.dt.floor("D").values)
        p = np.nan
        if n:
            pm = placebo(Ss, real, wins)
            p = float(np.nanmean(pm >= m))
        shadow_state = ("not evaluable" if len(sh) == 0 else
                        "unreliable (<30)" if len(sh) < 30 else "ok")
        if n < FLOOR_N_FIT:
            verdict = "UNDERPOWERED (fit n < 60) — holdout not read"
        elif not (m >= SCREEN_MEAN):
            verdict = "NO EDGE — fit-period kill (mean < +0.05R)"
        elif shadow_state == "not evaluable" or not (margin >= SCREEN_MARGIN):
            verdict = "NO EDGE — fit-period kill (price in disguise / shadow margin)"
        else:
            verdict = "SCREEN PASSED — reads holdout"
        screen[arm] = verdict.startswith("SCREEN PASSED")
        arms.append(dict(arm=arm, n_fit=n, mean_netR=m, shadow_n=len(sh),
                         shadow_mean=msh, margin=margin, margin_ci90_lo=mlo,
                         margin_ci90_hi=mhi, shadow_state=shadow_state,
                         placebo_p=p, verdict=verdict))
        print(arms[-1], flush=True)

    pd.DataFrame(win_rows).to_csv(os.path.join(OUT, "fit_windows.csv"), index=False)
    pd.DataFrame(summ).to_csv(os.path.join(OUT, "fit_summary.csv"), index=False, float_format="%.4f")
    pd.DataFrame(symrows).to_csv(os.path.join(OUT, "fit_symbols.csv"), index=False, float_format="%.4f")
    pd.DataFrame(arms).to_csv(os.path.join(OUT, "fit_arms.csv"), index=False, float_format="%.4f")
    if all_tr:
        pd.concat(all_tr).to_csv(os.path.join(OUT, "trades_fit.csv"), index=False, float_format="%.6g")
    with open(os.path.join(OUT, "screen.json"), "w") as fh:
        json.dump(screen, fh, indent=1)
    print(f"done {time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
