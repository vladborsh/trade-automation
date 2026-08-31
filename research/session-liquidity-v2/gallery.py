#!/usr/bin/env python3
"""The worked-example gallery — session-liquidity **v2**. FIRST-CLASS DELIVERABLE.

This is the format that caught the phase-1 problems (`RESEARCH-LOG.md` Запись
11), so it is the user's audit surface, not decoration. Three groups of ten,
each drawn with `examples.draw_event` — the same renderer, so nothing about a
panel is special-cased for how it will look:

  win<NN>    CONFIRMED, R proxy >= 1  — the iFVG fired and the reversal paid
  fail<NN>   CONFIRMED, R proxy <  1  — the iFVG fired and it did not
  unconf<NN> take-out with NO in-block iFVG — the events the rule throws away

Selection is **stratified then seeded**, never hand-curated: round-robin across
(symbol x direction x level_session x sweep_block) strata with a fixed seed, so
every group spans assets, directions, whose-level and which-block, and carries a
realistic mix rather than the prettiest charts. Re-running reproduces the same
thirty panels.

Every panel draws: the non-overlapping session rectangles (solid = already
closed at the take-out, so a legitimate level source; dotted = still forming),
the swept level, the take-out wick, the block-scoped window and its end, the
FVG zone and the close that inverted it, plus a zoom panel on the sweep ->
inversion region.

Writes viz/win*.png, viz/fail*.png, viz/unconf*.png and results/GALLERY.md.

Usage: .venv/bin/python research/session-liquidity-v2/gallery.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C
import tables as T
from examples import Loader

SEED = 42
N_PER_GROUP = 10
STRATA = ["symbol", "direction", "level_session", "sweep_block"]


def stratified_sample(pool: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    """Round-robin across strata, each stratum shuffled with the fixed seed.

    Spans symbols / directions / whose-level / which-block instead of letting
    the biggest cell dominate, and is reproducible. No outcome column is ever
    used to order the picks — that is what keeps the gallery honest.
    """
    rng = np.random.default_rng(seed)
    groups = [g for _, g in pool.groupby(STRATA, sort=True, observed=True)]
    order = rng.permutation(len(groups))
    shuffled = [groups[k].sample(frac=1.0, random_state=seed) for k in order]
    picked, ptr = [], [0] * len(shuffled)
    while len(picked) < n:
        progressed = False
        for gi, g in enumerate(shuffled):
            if len(picked) >= n:
                break
            if ptr[gi] < len(g):
                picked.append(g.index[ptr[gi]])
                ptr[gi] += 1
                progressed = True
        if not progressed:
            break                      # every stratum exhausted
    return pool.loc[picked]


def manifest_row(prefix: str, i: int, ev: pd.Series, name: str) -> str:
    R = "" if pd.isna(ev.ifvg_R) else f"{ev.ifvg_R:.2f}"
    mfe = "" if pd.isna(ev.ifvg_mfe_atr) else f"{ev.ifvg_mfe_atr:.2f}"
    mae = "" if pd.isna(ev.ifvg_mae_atr) else f"{ev.ifvg_mae_atr:.2f}"
    dly = "" if pd.isna(ev.ifvg_delay_bars) else f"{int(ev.ifvg_delay_bars)}"
    return (f"| {prefix}{i:02d} | {ev.symbol} | {ev.ts:%Y-%m-%d %H:%M} | "
            f"{'high' if ev.direction == 'high_sweep' else 'low'} | "
            f"{ev.level_session} | {ev.sweep_block} | {int(ev.bars_remaining)} | "
            f"{dly} | {ev.rev_atr:.2f} | {ev.adv_atr:.2f} | {mfe} | {mae} | {R} | "
            f"{int(ev.n_levels_taken)} | `{name}` |")


GROUPS = [
    ("win", "CONFIRMED, R proxy >= 1 — the iFVG fired and the reversal paid",
     lambda p: p[p.ifvg_confirmed & (p.ifvg_R >= 1)]),
    ("fail", "CONFIRMED, R proxy < 1 — the iFVG fired and it did not pay",
     lambda p: p[p.ifvg_confirmed & (p.ifvg_R < 1)]),
    ("unconf", "UNCONFIRMED take-out — no in-block iFVG; the events the rule discards",
     lambda p: p[~p.ifvg_confirmed]),
]


def main():
    e = T.load_events()
    p = e[e.primary]
    L = Loader()
    out = ["# Worked-example gallery — session-liquidity v2 (iFVG only)\n",
           "Thirty real take-outs, drawn by `examples.draw_event`. Selection is "
           "stratified across (symbol x direction x level_session x sweep_block) "
           f"with seed {SEED} and is **not** hand-curated — re-running "
           "`gallery.py` reproduces exactly these panels. Wins, failures and "
           "unconfirmed take-outs get the same renderer and the same ten slots, "
           "so the group sizes here say nothing about how common each outcome "
           "is (T2/T7 do — 64% of take-outs confirm, and 44% of those reach "
           "R>=1).\n",
           "`rev`/`adv` are measured from the take-out wick, `mfe`/`mae`/`R` "
           "from the iFVG inversion close. All in ATR(14, 5m) at the take-out "
           "bar. `left` = bars of block remaining after the take-out.\n"]

    for prefix, blurb, sel in GROUPS:
        pool = sel(p)
        picks = stratified_sample(pool, N_PER_GROUP, SEED)
        print("=" * 96)
        print(f"{prefix}: {blurb}  (pool = {len(pool):,} events, "
              f"{100*len(pool)/len(p):.1f}% of the primary sample)")
        out.append(f"\n## `{prefix}*` — {blurb}\n")
        out.append(f"_Pool: {len(pool):,} events = {100*len(pool)/len(p):.1f}% "
                   f"of the {len(p):,}-event primary sample._\n")
        out.append("| # | asset | take-out (UTC) | side | level | block | left | "
                   "delay | rev | adv | mfe | mae | R | lvls | file |")
        out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for i, (_, ev) in enumerate(picks.iterrows(), start=1):
            name = (f"{prefix}{i:02d}_{ev.symbol}_{ev.ts:%Y%m%d_%H%M}_"
                    f"{'hi' if ev.direction == 'high_sweep' else 'lo'}.png")
            L.render(ev, name, f"gallery {prefix} {i:02d}/{N_PER_GROUP} — "
                               f"stratified, seed {SEED}, not cherry-picked")
            out.append(manifest_row(prefix, i, ev, name))
        out.append("")

    txt = "\n".join(out)
    with open(os.path.join(C.RESULTS, "GALLERY.md"), "w") as fh:
        fh.write(txt)
    print("\nwrote", os.path.join(C.RESULTS, "GALLERY.md"))


if __name__ == "__main__":
    main()
