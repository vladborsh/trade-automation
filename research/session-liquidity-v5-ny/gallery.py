#!/usr/bin/env python3
"""The NY-window worked-example gallery — session-liquidity **v5-NY**.
FIRST-CLASS DELIVERABLE.

This format caught the phase-1 methodology problems, the v2 iFVG bug and the
fabricated v3 invalidation rule; the BoS pass added the requirement that every
panel draw the level being watched, because the omission of that ray is what
hid phase 1's re-anchoring defect for a whole pass. Both requirements carry
over, and this gallery adds one more: **every panel here is an event whose
confirmation landed inside the pinned NY window**, so the reader is looking at
the exact population the hypothesis test was run on — not a flattering subset
of the whole stream.

Eight strata, three panels each, spanning both mechanics and all three trade
outcomes, chosen to span what happens rather than what looks good:

  ifvg_target / ifvg_stop / ifvg_mtm   iFVG confirmed in-window, and the pinned
                                       trade reached +1R / −1R / neither
  bos_target  / bos_stop  / bos_mtm    the same three for the BoS arm
  both                                 both mechanics confirmed in-window —
                                       the two entries and two stops side by side
  bos_only                             BoS confirmed in-window and the iFVG
                                       never confirmed at all

Selection is **stratified then seeded**, never hand-curated: round-robin across
(symbol × direction × level_session) with a fixed seed, so each group spans
assets, directions and whose liquidity was taken. Re-running reproduces exactly
these panels. Group sizes here say nothing about how common each outcome is —
`results/HYPOTHESIS.md` P1 does.

BTC and ETH only, per DESIGN §2.3.

Writes results/gallery_ny/*.png and results/gallery_ny/GALLERY.md.

Usage: python research/session-liquidity-v5-ny/gallery.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C
import tables as T
from examples import Loader

SEED = 42
N_PER_GROUP = 3
STRATA = ["symbol", "direction", "level_session"]


def group_seed(prefix: str) -> int:
    """A per-stratum seed derived deterministically from the stratum's name.

    With one shared seed the round-robin visits the same (symbol, direction,
    level_session) groups first in every stratum, and a 3-panel gallery ends up
    all one direction. Deriving the seed from the stratum name keeps the
    selection fully reproducible while letting different strata start from
    different corners of the grid.
    """
    return SEED + (sum(ord(ch) * (i + 1) for i, ch in enumerate(prefix)) % 997)


def stratified_sample(pool: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    """Round-robin across strata, each stratum shuffled with the fixed seed.

    No outcome column ever orders the picks — that is what keeps the gallery
    honest. (The strata *define* an outcome, but within a stratum the choice is
    blind.)
    """
    rng = np.random.default_rng(seed)
    groups = [g for _, g in pool.groupby(STRATA, sort=True, observed=True)]
    if not groups:
        return pool.iloc[:0]
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
            break
    return pool.loc[picked]


def GROUPS(p):
    iw_i = p.ifvg_confirmed & p.ifvg_in_ny & p.ifvg_blk_netR.notna()
    iw_b = p.bos_confirmed & p.bos_in_ny & p.bos_blk_netR.notna()
    g = []
    for pre, lab in (("ifvg", "iFVG-v4"), ("bos", "BoS pinned anchor")):
        base = iw_i if pre == "ifvg" else iw_b
        for ex, exlab in (("target", "the pinned trade reached +1R"),
                          ("stop", "the pinned trade was stopped out (−1R)"),
                          ("mtm", "neither barrier was reached — marked to "
                                  "market at the block's last close")):
            g.append((f"{pre}_{ex}", pre,
                      f"**{lab}**, confirmed inside the NY window, and {exlab}.",
                      p[base & (p[f"{pre}_blk_exit"] == ex)]))
    g.append(("both", "bos",
              "**Both mechanics confirmed inside the window on the same "
              "take-out.** The panel shows the two entries and the two stops "
              "together; the BoS one is later and several ATR wider, which is "
              "the whole difference between the arms' net numbers.",
              p[iw_i & iw_b]))
    g.append(("bos_only", "bos",
              "**BoS confirmed inside the window and the iFVG never confirmed "
              "at all** — no qualifying gap ever inverted before the block "
              "ended. These are the take-outs where BoS is the only "
              "confirmation available.",
              p[iw_b & ~p.ifvg_confirmed]))
    return g


def manifest_row(prefix: str, i: int, arm: str, ev: pd.Series, name: str) -> str:
    def f(x, fmt="{:.2f}"):
        return "" if pd.isna(x) else fmt.format(x)
    return (f"| {prefix}{i:02d} | {ev.symbol} | {ev.ts:%Y-%m-%d %H:%M} | "
            f"{'high' if ev.direction == 'high_sweep' else 'low'} | "
            f"{ev.level_session} | {int(ev.bars_remaining)} | "
            f"{f(ev.bos_anchor_age_bars, '{:.0f}')} | "
            f"{f(ev.bos_anchor_dist_atr)} | "
            f"{int(ev.n_candidates)}/{int(ev.n_replacements)} | "
            f"{f(ev[f'{arm}_delay_bars'], '{:.0f}')} | "
            f"{f(ev[f'{arm}_blk_stop_atr'])} | "
            f"{ev[f'{arm}_blk_exit']} | {f(ev[f'{arm}_blk_netR'], '{:+.2f}')} | "
            f"{f(ev[f'{arm}_h24_netR'], '{:+.2f}')} | `{name}` |")


def main():
    e = T.load_events()
    p = e[e.primary & e.symbol.isin(C.FOREGROUND)]
    L = Loader(outdir=C.GALLERY_NY)
    groups = GROUPS(p)

    out = ["# NY-window worked-example gallery — session-liquidity v5-NY\n",
           f"Up to {len(groups) * N_PER_GROUP} real take-outs, drawn by "
           "`examples.draw_event`. **Every panel is an event whose confirmation "
           "landed inside the pinned NY window (13:40–15:20 UTC = 09:40–11:20 "
           "New York at UTC−4)** — the exact population the pre-registered test "
           "ran on. BTC and ETH only (DESIGN §2.3).\n",
           f"Selection is stratified across (symbol × direction × "
           f"level_session) with seed {SEED} and is **not** hand-curated — "
           "re-running `gallery.py` reproduces exactly these panels. Every "
           "group gets the same renderer and the same three slots, so the group "
           "sizes here say nothing about how common each outcome is "
           "(`results/HYPOTHESIS.md` P1 does).\n",
           "## What to check on a panel — this is the audit\n",
           "1. the **green ray** starts on its own pivot bar, that bar is "
           "**before** the dotted `t0` line, and the thin green dotted vertical "
           "(the bar the pivot was confirmed on) is also at or before `t0`;\n"
           "2. the green ray is **flat all the way across — it never steps**. "
           "That is the entire BoS correction: the anchor is chosen once, at "
           "`t0`, and is fixed for the event's life;\n"
           "3. the **red step-line** is what a re-anchoring implementation "
           "would have tested over the same window. Every step is a pivot that "
           "confirmed *after* the take-out. It is drawn purely as the contrast — "
           "no number in this pass uses it;\n"
           "4. the **grey boxes** are qualifying iFVG gaps the state machine "
           "held and then discarded when a newer one formed, numbered in "
           "formation order; the **blue box** is the one that was active when "
           "price closed through it. A grey box that would have 'worked better' "
           "proves nothing — it was not the active candidate at that moment, and "
           "that is the point;\n"
           "5. the confirmation is a full **close** through the ray or the gap "
           "edge, inside the shaded block window — a wick through it is not an "
           "event;\n"
           "6. the **orange band** is the NY window. The confirmation marker "
           "must sit inside it on every panel in this gallery;\n"
           "7. the black / red / green horizontal brackets are the pinned "
           "trade: entry at the confirmation close, stop at the sweep leg's "
           "running extreme, target one stop-width away;\n"
           "8. there is deliberately **no star on the take-out wick** (user "
           "preference); the take-out is the dotted vertical `t0` line.\n",
           "`left` = bars of block remaining at the take-out; `age` = bars from "
           "the BoS anchor pivot to `t0`; `dist` = |take-out wick − anchor| in "
           "ATR; `gaps` = qualifying iFVG candidates seen / displaced; `delay` = "
           "bars from `t0` to the confirmation; `stop` = the pinned stop proxy "
           "in ATR; `netR` = the pinned trade's result after 0.10% round-trip "
           "cost, block horizon; `netR 24h` = the same trade on the long "
           "horizon.\n"]

    for prefix, arm, blurb, pool in groups:
        picks = stratified_sample(pool, N_PER_GROUP, group_seed(prefix))
        print("=" * 90)
        print(f"{prefix}: pool = {len(pool):,} events")
        out.append(f"\n## `{prefix}*` — {blurb}\n")
        out.append(f"_Pool: {len(pool):,} events. Subject mechanic drawn: "
                   f"**{'BoS pinned anchor' if arm == 'bos' else 'iFVG-v4'}**._\n")
        if not len(pool):
            out.append("**This pool is EMPTY** — reported rather than deleted, "
                       "so a re-run elsewhere has a stated zero to compare "
                       "against.\n")
            continue
        out.append("| # | asset | take-out (UTC) | side | level | left | age | "
                   "dist | gaps | delay | stop | exit | netR | netR 24h | file |")
        out.append("|" + "---|" * 15)
        for i, (_, ev) in enumerate(picks.iterrows(), start=1):
            name = (f"{prefix}{i:02d}_{ev.symbol}_{ev.ts:%Y%m%d_%H%M}_"
                    f"{'hi' if ev.direction == 'high_sweep' else 'lo'}.png")
            L.render(ev, arm, name,
                     f"NY gallery {prefix} {i:02d}/{N_PER_GROUP} — stratified, "
                     f"seed {SEED}, not cherry-picked")
            out.append(manifest_row(prefix, i, arm, ev, name))
        out.append("")

    pth = os.path.join(C.GALLERY_NY, "GALLERY.md")
    with open(pth, "w") as fh:
        fh.write("\n".join(out) + "\n")
    print("\nwrote", pth)


if __name__ == "__main__":
    main()
