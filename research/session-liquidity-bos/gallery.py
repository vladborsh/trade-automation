#!/usr/bin/env python3
"""The worked-example gallery — session-liquidity **BoS pass**. FIRST-CLASS
DELIVERABLE.

This format caught the phase-1 methodology problems, the v2 iFVG bug and the
fabricated v3 invalidation rule. It did NOT catch phase 1's BoS re-anchoring
defect, for one reason: the panel never drew the level being watched. So the
non-negotiable requirement of this gallery is that **every panel renders the
pinned anchor ray, from its pivot to its break (or to the window end)**, beside
**phase 1's level as it actually moved**. See `examples.draw_event`.

Seven strata, four panels each, chosen to span the mechanic's outcomes and the
comparisons the report makes, rather than the outcomes that look good:

  broke     BROKE — a close through the pinned ray, the clean case
  sketch    THE USER'S SKETCH SHAPE — a real leg into the sweep, an aged
            anchor a long way off, and the break on the reversal
  nobreak   NO BREAK — the ray was never reached before the block ended
  defect    the RE-ANCHORING DEFECT visible on one chart: phase 1 fired
            >= 20 bars earlier, on a level it had re-anchored to
  p1only    phase 1 fired and the corrected mechanic never did — the pure
            false positive, and the single largest cell of the D3 matrix
  bosonly   BoS confirmed where iFVG-v4 did not
  ifvgonly  iFVG-v4 confirmed where BoS did not
  unanch    UNANCHORABLE (DESIGN §1 pin 4) — reported even when the pool is
            EMPTY, which is what the data says

Selection is **stratified then seeded**, never hand-curated: round-robin across
(symbol x direction x level_session x sweep_block) with a fixed seed, so each
group spans assets, directions, whose-level and which-block. Re-running
reproduces exactly these panels. Group sizes here say nothing about how common
each outcome is — B2/D3/M1 in `results/TABLES.md` do.

Writes viz/{broke,sketch,nobreak,defect,p1only,bosonly,ifvgonly}*.png and
results/GALLERY.md.

Usage: .venv/bin/python research/session-liquidity-bos/gallery.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C
import tables as T
from examples import Loader

SEED = 42
N_PER_GROUP = 4
STRATA = ["symbol", "direction", "level_session", "sweep_block"]


def stratified_sample(pool: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    """Round-robin across strata, each stratum shuffled with the fixed seed.

    No outcome column is ever used to order the picks — that is what keeps the
    gallery honest.
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


def manifest_row(prefix: str, i: int, ev: pd.Series, name: str) -> str:
    R = "" if pd.isna(ev.bos_R) else f"{ev.bos_R:.2f}"
    dly = "" if pd.isna(ev.bos_delay_bars) else f"{int(ev.bos_delay_bars)}"
    age = "" if pd.isna(ev.bos_anchor_age_bars) else f"{int(ev.bos_anchor_age_bars)}"
    dist = "" if pd.isna(ev.bos_anchor_dist_atr) else f"{ev.bos_anchor_dist_atr:.2f}"
    p1 = ("same level" if ev.p1bos_same_level_as_corrected else
          (f"+{int(ev.p1bos_delay_bars)}b RE-ANCHORED" if ev.p1bos_confirmed
           else "never fired"))
    ifv = (f"+{int(ev.ifvg_delay_bars)}b" if ev.ifvg_confirmed else "no")
    return (f"| {prefix}{i:02d} | {ev.symbol} | {ev.ts:%Y-%m-%d %H:%M} | "
            f"{'high' if ev.direction == 'high_sweep' else 'low'} | "
            f"{ev.level_session} | {ev.sweep_block} | {int(ev.bars_remaining)} | "
            f"{age} | {dist} | {dly} | {int(ev.p1bos_reanchors)} | "
            f"{ev.rev_atr:.2f} | {R} | {p1} | {ifv} | `{name}` |")


def GROUPS(p):
    med = p.bos_anchor_dist_atr.median()
    return [
        ("broke", "BROKE — a full close through the pinned ray inside the "
                  "block-scoped window",
         p[p.bos_confirmed]),
        ("sketch", "THE USER'S SKETCH SHAPE — an aged anchor (>= 8 bars before "
                   "the take-out) sitting further than the median distance "
                   "away, broken >= 15 bars after the sweep: a real leg into "
                   "the extreme, the ray drawn forward from the last opposing "
                   "pivot before it, and the break on the reversal",
         p[p.bos_confirmed & (p.bos_anchor_age_bars >= 8)
           & (p.bos_anchor_dist_atr > med) & (p.bos_delay_bars >= 15)]),
        ("nobreak", "NO BREAK — the ray was never reached before the sweep "
                    "block ended (66% of primary take-outs)",
         p[p.bos_anchorable & ~p.bos_confirmed]),
        ("defect", "THE RE-ANCHORING DEFECT, on one chart — phase 1 fired at "
                   "least 20 bars earlier than the corrected mechanic, on a "
                   "level it had re-anchored to at least twice",
         p[p.bos_confirmed & p.p1bos_confirmed & (p.p1bos_reanchors >= 2)
           & ((p.bos_delay_bars - p.p1bos_delay_bars) >= 20)]),
        ("p1only", "PHASE-1 FALSE POSITIVE — phase 1 called a BoS, the pinned "
                   "ray was never touched. This is 48.8% of the primary "
                   "sample and it is what the phase-1 BoS tables were counting",
         p[~p.bos_confirmed & p.p1bos_confirmed]),
        ("bosonly", "BoS ONLY — the corrected mechanic confirmed where "
                    "iFVG-v4 did not",
         p[p.bos_confirmed & ~p.ifvg_confirmed]),
        ("ifvgonly", "iFVG ONLY — iFVG-v4 confirmed where the corrected "
                     "mechanic never reached its ray",
         p[~p.bos_confirmed & p.ifvg_confirmed]),
        ("unanch", "UNANCHORABLE (DESIGN §1 pin 4) — no opposing k=3 pivot was "
                   "confirmed anywhere before the take-out bar",
         p[~p.bos_anchorable]),
    ]


def main():
    e = T.load_events()
    p = e[e.primary]
    L = Loader()
    groups = GROUPS(p)
    out = ["# Worked-example gallery — session-liquidity BoS pass "
           "(corrected, pinned-anchor mechanic)\n",
           f"Up to {len(groups) * N_PER_GROUP} real take-outs, drawn by "
           "`examples.draw_event`. Selection is stratified across "
           "(symbol x direction x level_session x sweep_block) with seed "
           f"{SEED} and is **not** hand-curated — re-running `gallery.py` "
           "reproduces exactly these panels. Every group gets the same "
           "renderer and the same four slots, so the group sizes here say "
           "nothing about how common each outcome is (B2, D3 and M1 in "
           "`TABLES.md` do).\n",
           "**What to check on a panel** — this is the audit, and it is the "
           "audit that phase 1 never had:\n",
           "1. the **green ray** starts on its own pivot bar, that bar is "
           "**before** the dotted `t0` line, and the pivot was **confirmed** "
           "by `t0` (the thin green dotted vertical marks the confirmation "
           "bar, always >= 3 bars after the pivot);\n"
           "2. the green ray is **flat all the way across** — it never steps. "
           "That is the whole correction: the anchor is chosen once, at `t0`, "
           "and is fixed for the event's life;\n"
           "3. the **red step-line** is phase 1's tested level over the same "
           "window. Every step is a newly confirmed pivot overwriting the "
           "test. Where the red sits far from the green, phase 1 was testing "
           "something nobody was watching at the take-out;\n"
           "4. the BoS break is a full **close** through the ray (circle), "
           "inside the shaded block window — a wick through it is not an "
           "event;\n"
           "5. the anchor is on the **near** side of the dashed boundary in "
           "essentially every panel, so a break means price closed back "
           "**inside** the swept range. That is why the stop proxy is wide;\n"
           "6. there is deliberately **no star on the take-out wick** (user "
           "preference); the take-out is the dotted vertical `t0` line.\n",
           "`age` = bars from the anchor pivot to `t0`; `dist` = |take-out "
           "wick - anchor| in ATR(14, 5m); `delay` = bars from `t0` to the "
           "break; `re-anch` = pivots that overwrote phase 1's level inside "
           "the window; `rev` is the wick-anchored reversal and `R` the "
           "from-break R proxy, both in ATR; `left` = bars of block remaining "
           "after the take-out.\n"]

    for prefix, blurb, pool in groups:
        picks = stratified_sample(pool, N_PER_GROUP, SEED)
        print("=" * 96)
        print(f"{prefix}: pool = {len(pool):,} events "
              f"({100*len(pool)/len(p):.1f}% of the primary sample)")
        out.append(f"\n## `{prefix}*` — {blurb}\n")
        out.append(f"_Pool: {len(pool):,} events = {100*len(pool)/len(p):.2f}% "
                   f"of the {len(p):,}-event primary sample._\n")
        if not len(pool):
            out.append("**This pool is EMPTY.** The category is part of the "
                       "pinned mechanic and part of the schema, and the data "
                       "contains no instance of it — see B1 in `TABLES.md`. "
                       "It is reported rather than deleted so that a later "
                       "re-run on other assets or a coarser pivot k can be "
                       "compared against a stated zero.\n")
            continue
        out.append("| # | asset | take-out (UTC) | side | level | block | left | "
                   "age | dist | delay | re-anch | rev | R | phase-1 BoS | iFVG | file |")
        out.append("|" + "---|" * 16)
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
