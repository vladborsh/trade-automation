#!/usr/bin/env python3
"""Random-flip permutation control (DESIGN.md §6 stage 2 (i)).

Stage 1 gated stage 2 out, so this is NOT run as a protocol step -- it is run
once on the primary config (K=15, k=4, Mode S) so that (a) the helper is proven
to work and is available to a future pass, and (b) the kill is stated against a
null rather than against zero.

Null construction, per the design: preserve the number of flips per symbol and
their strict alternation of direction, destroy their location (uniform random
bars inside the fit window). 200 draws. The real flip set would have to beat the
90th percentile of the null's pooled expectancy.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
import pivot
from stage1 import observations, tstat

DRAWS = 200
HZ = [3, 6, 12, 24, 48]
K, k, MODE = pivot.PRIMARY
LO = pd.Timestamp(C.FIT[0], tz="UTC"); HI = pd.Timestamp(C.FIT[1], tz="UTC")


def random_flips(n_ev, first_dir, lo_i, hi_i, rng):
    """`n_ev` flip bars uniform in [lo_i, hi_i), sorted, alternating direction."""
    idx = np.sort(rng.choice(np.arange(lo_i, hi_i), size=n_ev, replace=False))
    d = np.empty(n_ev, dtype=float)
    d[0::2] = first_dir; d[1::2] = -first_dir
    return idx, d


def main():
    rng = np.random.default_rng(20260826)
    frames = []
    for sym in C.SYMBOLS:
        h1 = C.resample_h1(C.load5m(sym))
        ps = pivot.build(h1, K, k, MODE)
        win = ((h1.ts >= LO) & (h1.ts < HI)).to_numpy()
        lo_i, hi_i = int(np.argmax(win)), int(len(win) - np.argmax(win[::-1]))
        fl = ps.flip.to_numpy()
        idx = np.flatnonzero(fl != 0)
        idx_fit = idx[(idx >= lo_i) & (idx < hi_i)]
        frames.append((h1, idx, fl[idx].astype(float), len(idx_fit),
                       float(fl[idx_fit][0]), lo_i, hi_i))

    rows = []
    for hz in HZ:
        real = np.concatenate([observations(h, i, d, hz, LO, HI) for h, i, d, *_ in frames])
        null = np.empty(DRAWS)
        for b in range(DRAWS):
            acc = []
            for h, _, _, n_ev, fd, lo_i, hi_i in frames:
                ri, rd = random_flips(n_ev, fd, lo_i, hi_i, rng)
                acc.append(observations(h, ri, rd, hz, LO, HI))
            null[b] = np.concatenate(acc).mean()
        p90 = float(np.percentile(null, 90))
        rows.append(dict(horizon=hz, n_real=len(real),
                         real_mean_bps=real.mean() * 1e4, real_t=tstat(real),
                         null_mean_bps=null.mean() * 1e4,
                         null_p90_bps=p90 * 1e4,
                         beats_p90=bool(real.mean() > p90),
                         pctile_of_real=float((null < real.mean()).mean() * 100)))
        print(f"  hz={hz:>3} done", flush=True)

    df = pd.DataFrame(rows)
    df.to_csv(f"{C.OUT}/stage2_permutation.csv", index=False)
    pd.set_option("display.width", 200)
    print(f"\n=== random-flip null, {DRAWS} draws, K={K} k={k} Mode {MODE}, fit ===")
    print(df.to_string(index=False, float_format=lambda x: f"{x:9.3f}"))


if __name__ == "__main__":
    main()
