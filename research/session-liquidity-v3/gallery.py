#!/usr/bin/env python3
"""The worked-example gallery — session-liquidity **v3**. FIRST-CLASS DELIVERABLE.

This format caught the phase-1 methodology problems AND the v2 iFVG bug, so it
is the user's audit surface, not decoration. v3 changes what a panel has to
prove: not "did a gap invert" but "**did the state machine transition
correctly**". Every panel therefore draws the invalidation line, every
candidate gap in formation order, and each candidate's fate — see
`examples.draw_event`.

Seven strata, four panels each (28 panels), chosen to span the transitions the
machine can make rather than the outcomes that look good:

  conf1     CONFIRMED with a single candidate, never invalidated — the clean case
  confrep   CONFIRMED after a REPLACEMENT (pin 1: the displaced gap is out for good)
  confinv   CONFIRMED after one or more INVALIDATIONS
  above     CONFIRMED / attempted through a gap lying BEYOND the take-out extreme —
            the pin-3 tie geometry; the header line shows what B and C did with
            the same event (Architect's requested audit stratum)
  uncinv    UNCONFIRMED — invalidated out (the dominant failure mode)
  unclive   UNCONFIRMED — a candidate was still live when the block ended
  uncnone   UNCONFIRMED — no qualifying gap ever formed

Selection is **stratified then seeded**, never hand-curated: round-robin across
(symbol x direction x level_session x sweep_block) with a fixed seed, so each
group spans assets, directions, whose-level and which-block. Re-running
reproduces exactly these panels. Group sizes here say nothing about how common
each outcome is — S2 in `results/TABLES.md` does.

Writes viz/{conf1,confrep,confinv,above,uncinv,unclive,uncnone}*.png and
results/GALLERY.md.

Usage: .venv/bin/python research/session-liquidity-v3/gallery.py
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


def _v(ev, pref):
    if not ev[f"{pref}_confirmed"]:
        return f"unconf ({ev[f'{pref}_unconf_cause'].replace('_', ' ')})"
    r = ev[f"{pref}_R"]
    return f"+{int(ev[f'{pref}_delay_bars'])}b" + (f", R {r:.2f}" if np.isfinite(r) else "")


def manifest_row(prefix: str, i: int, ev: pd.Series, name: str) -> str:
    R = "" if pd.isna(ev.ifvg_R) else f"{ev.ifvg_R:.2f}"
    dly = "" if pd.isna(ev.ifvg_delay_bars) else f"{int(ev.ifvg_delay_bars)}"
    return (f"| {prefix}{i:02d} | {ev.symbol} | {ev.ts:%Y-%m-%d %H:%M} | "
            f"{'high' if ev.direction == 'high_sweep' else 'low'} | "
            f"{ev.level_session} | {ev.sweep_block} | {int(ev.bars_remaining)} | "
            f"{int(ev.n_candidates)} | {int(ev.n_replacements)} | "
            f"{int(ev.n_invalidations)} | {int(ev.n_ties)} | {dly} | "
            f"{ev.rev_atr:.2f} | {R} | {_v(ev, 'B')} | {_v(ev, 'C')} | `{name}` |")


GROUPS = [
    ("conf1", "CONFIRMED, a single candidate, never invalidated — the clean case",
     lambda p: p[p.ifvg_confirmed & (p.n_candidates == 1) & (p.n_invalidations == 0)]),
    ("confrep", "CONFIRMED after a REPLACEMENT — a later gap displaced the live "
                "candidate, and the displaced one is permanently out (pin 1)",
     lambda p: p[p.ifvg_confirmed & (p.n_replacements >= 1)]),
    ("confinv", "CONFIRMED after one or more INVALIDATIONS — earlier candidates "
                "died against the take-out extreme first",
     lambda p: p[p.ifvg_confirmed & (p.n_invalidations >= 1)]),
    ("above", "THE PIN-3 TIE — a bar that both inverted the active gap and closed "
              "beyond the take-out extreme. Under A (drawn) it invalidates; the "
              "header shows what B and C did with the same event",
     lambda p: p[(p.n_ties >= 1) & p.v2_ifvg_confirmed]),
    ("uncinv", "UNCONFIRMED — invalidated out; the dominant failure mode of the "
               "corrected rule",
     lambda p: p[p.unconf_cause == "invalidated_out"]),
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
    out = ["# Worked-example gallery — session-liquidity v3 (corrected iFVG "
           "state machine)\n",
           f"{len(GROUPS) * N_PER_GROUP} real take-outs, drawn by "
           "`examples.draw_event`. Selection is stratified across "
           "(symbol x direction x level_session x sweep_block) with seed "
           f"{SEED} and is **not** hand-curated — re-running `gallery.py` "
           "reproduces exactly these panels. Every group gets the same "
           "renderer and the same four slots, so the group sizes here say "
           "nothing about how common each outcome is (S2 in `TABLES.md` does: "
           "21% confirmed, 45% invalidated out, 30% no candidate, 4% live at "
           "block end).\n",
           "**What to check on a panel** — this is the audit:\n",
           "1. the **red line** is the take-out bar's own extreme; a candidate "
           "dies the moment a bar CLOSES beyond it (red `x`);\n"
           "2. numbered zones are the qualifying gaps in **formation order**; "
           "green = the one that confirmed, red = invalidated, grey = replaced "
           "by a later gap and permanently out, orange = still live at block end;\n"
           "3. only the **latest** live gap can confirm — a close through an "
           "older grey zone is not an event;\n"
           "4. after an invalidation, only gaps forming on a **later** bar are "
           "eligible;\n"
           "5. the header's `B` / `C` line says what the two sensitivity "
           "variants did with the same take-out.\n",
           "`cand`/`repl`/`inval`/`tie` are the state-machine counters; `rev` is "
           "the wick-anchored reversal, `R` the from-confirmation R proxy, both "
           "in ATR(14, 5m) at the take-out bar; `left` = bars of block remaining "
           "after the take-out.\n"]

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
                   "cand | repl | inval | tie | delay | rev | R | B | C | file |")
        out.append("|" + "---|" * 17)
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
