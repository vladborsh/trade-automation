#!/usr/bin/env python3
"""Does the raw SIGNAL carry any forward edge, independent of stop/target choices?

For each candidate's trigger condition we measure the mean forward return over
several horizons, sign-adjusted for trade direction, and compare it to the
unconditional distribution with a Newey-West-free but overlap-aware t-stat
(returns are non-overlapping by construction: we sample at horizon spacing).

If the conditional mean is not reliably positive here, no amount of exit tuning
will produce a profitable rule-set -- the money management can only redistribute
an edge that already exists.
"""
from __future__ import annotations
import argparse
import numpy as np
import pandas as pd

import strategies as st
from run_sweep import load

COST_BPS = 10.0  # round-trip taker + slippage, for reference on the charts


def probe(sym, iv, cand, horizons, p):
    d = load(sym, iv)
    q = st.prepare(d, p)
    if cand == "hybrid":
        q = st.add_htf_bias(q, p)
    sig = st.CANDIDATES[cand](q, p).sig.to_numpy()
    c = d.close.to_numpy()
    out = []
    for hz in horizons:
        fwd = np.full(len(c), np.nan)
        fwd[:-hz] = c[hz:] / c[:-hz] - 1
        idx = np.where(sig != 0)[0]
        idx = idx[idx < len(c) - hz]
        if len(idx) < 30:
            continue
        # de-overlap: keep triggers at least `hz` bars apart
        keep, last = [], -10**9
        for i in idx:
            if i - last >= hz:
                keep.append(i); last = i
        keep = np.array(keep)
        r = fwd[keep] * sig[keep]
        base = fwd[~np.isnan(fwd)]
        t = r.mean() / (r.std(ddof=1) / np.sqrt(len(r))) if r.std(ddof=1) > 0 else 0.0
        out.append(dict(symbol=sym, interval=iv, candidate=cand, horizon=hz,
                        n=len(r), mean_bps=r.mean() * 1e4, t_stat=t,
                        hit_rate=float((r > 0).mean()),
                        uncond_bps=float(base.mean() * 1e4),
                        edge_after_cost_bps=r.mean() * 1e4 - COST_BPS))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--intervals", default="15m,1h")
    ap.add_argument("--symbols", default="BTCUSDT,ETHUSDT,SOLUSDT")
    a = ap.parse_args()
    p = dict(st.DEFAULTS)
    rows = []
    for cand in st.CANDIDATES:
        for iv in a.intervals.split(","):
            hz = [3, 6, 12, 24] if iv == "1h" else [4, 12, 24, 48]
            for sym in a.symbols.split(","):
                rows += probe(sym, iv, cand, hz, p)
    df = pd.DataFrame(rows)
    df.to_csv("results/edge_probe.csv", index=False)
    pd.set_option("display.width", 200)
    print(df.to_string(index=False, float_format=lambda x: f"{x:8.2f}"))
    print("\n--- pooled by candidate x interval ---")
    g = df.groupby(["candidate", "interval"]).apply(
        lambda x: pd.Series(dict(n=x.n.sum(), mean_bps=np.average(x.mean_bps, weights=x.n),
                                 median_t=x.t_stat.median(), frac_t_gt_2=(x.t_stat > 2).mean())))
    print(g.to_string(float_format=lambda x: f"{x:8.2f}"))


if __name__ == "__main__":
    main()
