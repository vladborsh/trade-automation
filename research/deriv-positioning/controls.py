#!/usr/bin/env python3
"""STAGE 2 — controls (DESIGN.md §5). Gate to believing any stage-1 pass.

  1. Random-subset null for (a): 200 draws of random trigger subsets of the same
     sizes as the real terciles, drawn from the SAME trigger set; the real split
     must beat the 90th percentile of the null on the stage-1 statistic.
  2. Random-event null for (b1)/(b2): 200 draws of same-count random bar sets per
     symbol, restricted to that hypothesis's usable bars; the real events must
     beat the 90th percentile on pooled expectancy.
  3. Redundancy control (§5.3) — computed in stage1.py, summarised here: the
     positioning version must visibly beat its price-derived shadow (same sign,
     larger magnitude, and the shadow must fail where the real one passes).
     A hypothesis that does not is "price in disguise — no second signal",
     whatever its t-stat.
  4. Harness validation BOTH ways: reproduce v2's `momentum_breakout` positive
     and v1's single-timeframe `smc` zero through this package's own
     `stage1.observations` code path.

Everything is fit-window only.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd

import common as C
import prep
import signals as S
import stage1 as S1

NDRAW = 200
SEED = 20260826


# ------------------------------------------------------- 1. random-subset (a)
def null_a(symbols, cond="dOI_4h_pct", gate="usable_a", win=None) -> pd.DataFrame:
    win = win or C.FIT_BY_HYP["a"]
    rng = np.random.default_rng(SEED)
    rows = []
    for hz in S1.HORIZONS:
        allr, terc_all = [], []
        for sym in symbols:
            d = prep.get(sym)
            sig = S.momentum_breakout(d)
            s = sig.sig.to_numpy()
            terc = S.tercile(d[cond].to_numpy())
            f = S1.fwd_returns(d, hz)
            idx = S1.trigger_idx(d, sig, win, hz, gate=gate)
            idx = idx[terc[idx] >= 0]
            r = f[idx] * s[idx]
            ok = ~np.isnan(r)
            allr.append(r[ok]); terc_all.append(terc[idx][ok])
        r = np.concatenate(allr); t = np.concatenate(terc_all)
        n_top, n_bot = int((t == 2).sum()), int((t == 0).sum())
        real = r[t == 2].mean() - r[t == 0].mean()
        draws = np.empty(NDRAW)
        for k in range(NDRAW):
            p = rng.permutation(len(r))
            draws[k] = r[p[:n_top]].mean() - r[p[n_top:n_top + n_bot]].mean()
        rows.append(dict(hypothesis="a", cond=cond, horizon=hz, n=len(r),
                         n_top=n_top, n_bottom=n_bot,
                         real_diff_bps=real * 1e4,
                         null_p50_bps=np.percentile(draws, 50) * 1e4,
                         null_p90_bps=np.percentile(draws, 90) * 1e4,
                         null_max_bps=draws.max() * 1e4,
                         beats_p90=bool(real > np.percentile(draws, 90)),
                         pctile_of_real=float((draws < real).mean() * 100)))
    return pd.DataFrame(rows)


# --------------------------------------------------------- 2. random-event (b)
def null_b(symbols, name, win=None) -> pd.DataFrame:
    win = win or C.fit_win(name)
    gate = "usable_b1" if name.startswith("b1") else "usable_b2"
    rng = np.random.default_rng(SEED)
    rows = []
    for hz in S1.HORIZONS:
        real_parts, pools = [], []
        for sym in symbols:
            d = prep.get(sym)
            sig = S.build_event(d, name)
            s = sig.sig.to_numpy()
            f = S1.fwd_returns(d, hz)
            idx = S1.trigger_idx(d, sig, win, hz, gap=C.BREAK_N, gate=gate)
            r = f[idx] * s[idx]
            ok = ~np.isnan(r)
            real_parts.append(r[ok])
            # the null universe: this symbol's usable, in-window bars with a
            # defined forward return; sides drawn with the real long/short mix
            w = C.window_mask(d, win) & d[gate].to_numpy() & ~np.isnan(f)
            pools.append((np.flatnonzero(w), f, int(ok.sum()),
                          s[idx][ok]))
        real = np.concatenate(real_parts)
        if len(real) == 0:
            continue
        draws = np.empty(NDRAW)
        for k in range(NDRAW):
            acc = []
            for cand, f, n, sides in pools:
                if n == 0 or len(cand) == 0:
                    continue
                pick = rng.choice(cand, size=min(n, len(cand)), replace=False)
                sd = rng.permutation(sides)[:len(pick)]
                acc.append(f[pick] * sd)
            draws[k] = np.concatenate(acc).mean() if acc else np.nan
        rows.append(dict(hypothesis=name, horizon=hz, n=len(real),
                         real_mean_bps=real.mean() * 1e4,
                         null_p50_bps=np.nanpercentile(draws, 50) * 1e4,
                         null_p90_bps=np.nanpercentile(draws, 90) * 1e4,
                         null_max_bps=np.nanmax(draws) * 1e4,
                         beats_p90=bool(real.mean() > np.nanpercentile(draws, 90)),
                         pctile_of_real=float(np.nanmean(draws < real.mean()) * 100)))
    return pd.DataFrame(rows)


# ------------------------------------------------- 4. harness validation, both ways
def harness_validation(symbols, win=C.FIT) -> pd.DataFrame:
    """momentum_breakout must come back positive, single-TF `smc` must come back
    ~zero, through this package's own probe code path on this package's frames."""
    rows = []
    for cand in ("momentum_breakout", "smc"):
        fn = C.sv.CANDIDATES_V2.get(cand) or C.st.CANDIDATES[cand]
        pool = {h: [] for h in S1.HORIZONS}
        for sym in symbols:
            d = prep.get(sym)
            sig = fn(d, C.P)
            s = sig.sig.to_numpy()
            for hz in S1.HORIZONS:
                f = S1.fwd_returns(d, hz)
                idx = S1.trigger_idx(d, sig, win, hz, gate="usable")
                r = f[idx] * s[idx]
                r = r[~np.isnan(r)]
                if len(r):
                    pool[hz].append(r)
        for hz in S1.HORIZONS:
            r = np.concatenate(pool[hz])
            rows.append(dict(control=cand, horizon=hz, n=len(r),
                             mean_bps=r.mean() * 1e4, t_stat=S1.tstat(r)))
    return pd.DataFrame(rows)


def main():
    keep = json.load(open(f"{C.OUT}/symbols_kept.json"))["kept"]
    pd.set_option("display.width", 250)
    fmt = lambda x: f"{x:9.3f}"

    print("=== §5.4 harness validation (both ways), this package's probe path, FIT ===")
    hv = harness_validation(keep["a"])
    hv.to_csv(f"{C.OUT}/harness_validation.csv", index=False)
    print(hv.to_string(index=False, float_format=fmt))

    print("\n=== §5.1 random-subset null for (a), 200 draws ===")
    na = pd.concat([null_a(keep["a"], "dOI_4h_pct"),
                    null_a(keep["a"], "ret4h_pct")])
    na.to_csv(f"{C.OUT}/null_a.csv", index=False)
    print(na.to_string(index=False, float_format=fmt))

    print("\n=== §5.2 random-event null for (b1)/(b2), 200 draws ===")
    nb = []
    for name in S.EVENTS:
        nb.append(null_b(keep["b1" if name.startswith("b1") else "b2"], name))
    nb = pd.concat(nb)
    nb.to_csv(f"{C.OUT}/null_b.csv", index=False)
    print(nb.to_string(index=False, float_format=fmt))


if __name__ == "__main__":
    main()
