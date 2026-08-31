#!/usr/bin/env python3
"""10 iFVG-confirmed + 10 BoS-confirmed example charts, honestly sampled.

Reuses the existing draw_event() rendering pipeline from examples.py --
no re-implementation of the chart logic here. Selection is stratified
(round-robin across symbol x direction x session) then sampled with a
fixed random seed, so the picks are reproducible and not hand-curated
for the best-looking outcomes.

Usage: .venv/bin/python research/session-liquidity/examples_10x10.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C
import engine as E
import tables as T
from examples import draw_event

SEED = 42
N_PER_GROUP = 10


def stratified_sample(pool: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    """Round-robin across (symbol, direction, level_session) strata, each
    stratum sampled with the fixed seed, so the result spans symbols/
    directions/sessions and includes a realistic mix of outcomes rather
    than only the cleanest reversals."""
    rng = np.random.default_rng(seed)
    groups = list(pool.groupby(["symbol", "direction", "level_session"], sort=True))
    # shuffle group order deterministically so no single symbol dominates
    order = rng.permutation(len(groups))
    picked_idx = []
    gi = [0] * len(groups)  # next-row pointer within each (pre-shuffled) group
    shuffled = []
    for gidx in order:
        _, g = groups[gidx]
        g = g.sample(frac=1.0, random_state=seed)  # shuffle rows within stratum
        shuffled.append(g)

    round_i = 0
    while len(picked_idx) < n:
        progressed = False
        for gidx, g in enumerate(shuffled):
            if len(picked_idx) >= n:
                break
            if gi[gidx] < len(g):
                picked_idx.append(g.index[gi[gidx]])
                gi[gidx] += 1
                progressed = True
        round_i += 1
        if not progressed:
            break  # exhausted every stratum
    return pool.loc[picked_idx]


def pick_subset(e: pd.DataFrame, want: str) -> tuple[pd.DataFrame, str]:
    """want in {'ifvg', 'bos'}. Prefer the "only" subset (uncluttered
    chart); fall back to the general confirmed set if fewer than
    N_PER_GROUP events exist there."""
    if want == "ifvg":
        only = e[e.ifvg_confirmed & ~e.bos_confirmed]
        general = e[e.ifvg_confirmed]
        label = "iFVG-only (ifvg_confirmed & ~bos_confirmed)"
    else:
        only = e[e.bos_confirmed & ~e.ifvg_confirmed]
        general = e[e.bos_confirmed]
        label = "BoS-only (bos_confirmed & ~ifvg_confirmed)"
    if len(only) >= N_PER_GROUP:
        return only, label
    note = (f"FALLBACK: only {len(only)} events in {label}, "
            f"using the general {'ifvg_confirmed' if want == 'ifvg' else 'bos_confirmed'} set instead")
    print(note)
    return general, note


def manifest_line(prefix: str, i: int, ev: pd.Series) -> str:
    d = "hi" if ev.direction == "high_sweep" else "lo"
    return (f"{prefix}{i:02d}  {ev.symbol:9s} {ev.ts:%Y-%m-%d %H:%M} UTC  "
            f"{ev.direction:10s} sess={ev.level_session:6s} dir_tag={d}  "
            f"rev_atr={ev.rev_atr:5.2f}  adv_atr={ev.adv_atr:5.2f}  "
            f"n_levels_taken={int(ev.n_levels_taken)}")


def main():
    e = T.load_events()

    ifvg_pool, ifvg_note = pick_subset(e, "ifvg")
    bos_pool, bos_note = pick_subset(e, "bos")

    ifvg_picks = stratified_sample(ifvg_pool, N_PER_GROUP, SEED)
    bos_picks = stratified_sample(bos_pool, N_PER_GROUP, SEED + 1)

    cache = {}

    def render(prefix: str, ev: pd.Series, i: int):
        sym = ev.symbol
        if sym not in cache:
            d = C.prep(C.load(sym))
            cache[sym] = (d, C.session_frames(d), E.fvg_arrays(d), *E.bos_flags(d))
        d, sess, fv, dn, up = cache[sym]
        name = (f"{prefix}{i:02d}_{sym}_{ev.ts:%Y%m%d_%H%M}_"
                f"{'hi' if ev.direction == 'high_sweep' else 'lo'}.png")
        tag = f"{prefix} example {i:02d}/10 -- stratified, non-cherry-picked sample"
        draw_event(sym, d, sess, fv, dn, up, ev, os.path.join(C.VIZ, name), tag)
        return name

    print("=" * 100)
    print(f"iFVG subset used: {ifvg_note}")
    print(f"BoS  subset used: {bos_note}")
    print("=" * 100)

    print("\n--- iFVG-confirmed examples (ifvg01..ifvg10) ---")
    for i, (_, ev) in enumerate(ifvg_picks.iterrows(), start=1):
        name = render("ifvg", ev, i)
        print(name, "|", manifest_line("ifvg", i, ev))

    print("\n--- BoS-confirmed examples (bos01..bos10) ---")
    for i, (_, ev) in enumerate(bos_picks.iterrows(), start=1):
        name = render("bos", ev, i)
        print(name, "|", manifest_line("bos", i, ev))


if __name__ == "__main__":
    main()
