#!/usr/bin/env python3
"""The worked-example gallery — session-liquidity **v4**. FIRST-CLASS DELIVERABLE.

This format caught the phase-1 methodology problems, the v2 iFVG bug AND the
fabricated v3 invalidation rule, so it is the user's audit surface, not
decoration. What a v4 panel has to prove is narrower than v3's — the machine
has only two transitions left (a gap becomes the candidate; a newer gap
replaces it) and one terminal event (a close through the active gap's far
edge) — so the panel is correspondingly simpler: **one horizontal line, the
swept boundary**, and the candidate zones in formation order. See
`examples.draw_event`.

Six strata, four panels each (24 panels), chosen to span the transitions the
machine can make rather than the outcomes that look good:

  conf1     CONFIRMED with a single candidate — the clean case
  confrep   CONFIRMED after a REPLACEMENT (pin 1: the displaced gap is out for good)
  multiext  CONFIRMED after price printed >= 2 further local extremes BEYOND the
            take-out bar before reversing, on take-outs the deleted v3 rule
            REJECTED — the user's hand-drawn diagram, as it occurs in the data
  diffgap   CONFIRMED where v2's retroactive best-pick names a DIFFERENT gap
            than v4 does (same confirming bar, different gap identity)
  unclive   UNCONFIRMED — a candidate was still live when the block ended
  uncnone   UNCONFIRMED — no qualifying gap ever formed

Selection is **stratified then seeded**, never hand-curated: round-robin across
(symbol x direction x level_session x sweep_block) with a fixed seed, so each
group spans assets, directions, whose-level and which-block. Re-running
reproduces exactly these panels. Group sizes here say nothing about how common
each outcome is — S2 in `results/TABLES.md` does.

Writes viz/{conf1,confrep,multiext,diffgap,unclive,uncnone}*.png and
results/GALLERY.md.

Usage: .venv/bin/python research/session-liquidity-v4/gallery.py
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
            break                      # every stratum exhausted
    return pool.loc[picked]


def manifest_row(prefix: str, i: int, ev: pd.Series, name: str) -> str:
    R = "" if pd.isna(ev.ifvg_R) else f"{ev.ifvg_R:.2f}"
    dly = "" if pd.isna(ev.ifvg_delay_bars) else f"{int(ev.ifvg_delay_bars)}"
    v3 = ("confirmed" if ev.v3a_confirmed
          else f"gave up ({int(ev.v3a_n_invalidations)} inval)")
    v2 = ("same gap" if ev.same_gap_selected else
          ("DIFFERENT gap" if ev.v2_ifvg_confirmed else "unconfirmed"))
    return (f"| {prefix}{i:02d} | {ev.symbol} | {ev.ts:%Y-%m-%d %H:%M} | "
            f"{'high' if ev.direction == 'high_sweep' else 'low'} | "
            f"{ev.level_session} | {ev.sweep_block} | {int(ev.bars_remaining)} | "
            f"{int(ev.n_candidates)} | {int(ev.n_replacements)} | "
            f"{int(ev.n_local_extremes_pre_conf)} | {dly} | "
            f"{ev.rev_atr:.2f} | {R} | {v3} | {v2} | `{name}` |")


GROUPS = [
    ("conf1", "CONFIRMED with a single candidate — the clean case",
     lambda p: p[p.ifvg_confirmed & (p.n_candidates == 1)]),
    ("confrep", "CONFIRMED after a REPLACEMENT — a later gap displaced the live "
                "candidate, and the displaced one is permanently out (pin 1)",
     lambda p: p[p.ifvg_confirmed & (p.n_replacements >= 1)]),
    ("multiext", "THE USER'S DIAGRAM — price crossed the boundary, printed >= 2 "
                 "further local extremes beyond the take-out bar, and only THEN "
                 "reversed. Restricted to take-outs the deleted v3 invalidation "
                 "rule rejected, so every panel here is a signal v3 threw away",
     lambda p: p[p.ifvg_confirmed & ~p.v3a_confirmed
                 & (p.n_local_extremes_pre_conf >= 2)]),
    ("diffgap", "CONFIRMED through a DIFFERENT gap than v2's retroactive best-pick "
                "names — same confirming bar, different gap identity",
     lambda p: p[p.ifvg_confirmed & p.v2_ifvg_confirmed & ~p.same_gap_selected]),
    ("unclive", "UNCONFIRMED — a candidate was still live, un-inverted, when the "
                "block ended",
     lambda p: p[p.unconf_cause == "live_at_block_end"]),
    ("uncnone", "UNCONFIRMED — no qualifying gap ever formed inside the window",
     lambda p: p[p.unconf_cause == "no_candidate"]),
]


def main():
    e = T.load_events()
    p = e[e.primary]
    L = Loader()
    n_conf = 100 * p.ifvg_confirmed.mean()
    n_none = 100 * (p.unconf_cause == "no_candidate").mean()
    n_live = 100 * (p.unconf_cause == "live_at_block_end").mean()
    out = ["# Worked-example gallery — session-liquidity v4 (iFVG, no invalidation)\n",
           f"{len(GROUPS) * N_PER_GROUP} real take-outs, drawn by "
           "`examples.draw_event`. Selection is stratified across "
           "(symbol x direction x level_session x sweep_block) with seed "
           f"{SEED} and is **not** hand-curated — re-running `gallery.py` "
           "reproduces exactly these panels. Every group gets the same "
           "renderer and the same four slots, so the group sizes here say "
           "nothing about how common each outcome is (S2 in `TABLES.md` does: "
           f"{n_conf:.0f}% confirmed, {n_none:.0f}% no candidate, "
           f"{n_live:.0f}% live at block end).\n",
           "**What to check on a panel** — this is the audit:\n",
           "1. there is exactly **one horizontal line**: the swept level. It is "
           "the boundary, it is fixed, and nothing else is tracked — no "
           "invalidation line, no running extreme, no BoS level;\n"
           "2. numbered zones are the qualifying gaps in **formation order**; "
           "green = the one that confirmed, grey = replaced by a later gap and "
           "permanently out, orange = still live at block end;\n"
           "3. only the **latest** live gap can confirm — a close through an "
           "older grey zone is not an event;\n"
           "4. the confirmation is a full **close** through the active gap's far "
           "edge (a partial poke never counts), and it must land inside the "
           "shaded block window;\n"
           "5. however far price ran past the boundary first, and however many "
           "local highs/lows it printed there, **nothing is discarded** — the "
           "header counts both, for reference against what the deleted v3 rule "
           "would have done.\n",
           "`cand`/`repl` are the state-machine counters; `ext` = local extremes "
           "printed beyond the take-out bar before the confirmation; `rev` is "
           "the wick-anchored reversal and `R` the from-confirmation R proxy, "
           "both in ATR(14, 5m) at the take-out bar; `left` = bars of block "
           "remaining after the take-out; `v3-A` / `v2` say what the two "
           "superseded algorithms did with the same take-out.\n"]

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
                   "cand | repl | ext | delay | rev | R | v3-A | v2 | file |")
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
