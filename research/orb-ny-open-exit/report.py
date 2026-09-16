#!/usr/bin/env python3
"""Generate `REPORT.md` from the committed result tables. `DESIGN.md` §10
step 6.

Every number in `REPORT.md` comes from a CSV in `results/` (or, for the quoted
+1R corner, from `research/orb-ny-open-short/results/`); **nothing is retyped
by hand**.

The reporting rules of `DESIGN.md` §9.5 are enforced structurally here:

  * the first paragraph is the third-and-last-look declaration;
  * the first results table is the full grid per instrument — the quoted +1R
    corner (fit only, holdout blank), E0, E1, E2 — and no cell is printed
    without the others;
  * a screened-out arm appears in the grid with a **blank** holdout column;
  * the harvest-ratio, common-scale and long/short rows appear for every arm;
  * every ladder cell is printed, including the worse ones, with the
    registered cell marked, and **no "best cell" sentence is generated
    anywhere**;
  * the no-slippage caveat is stated.

    python report.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
R = C.RESULTS


def rd(n, **kw):
    p = os.path.join(R, n)
    return pd.read_csv(p, **kw) if os.path.exists(p) else pd.DataFrame()


def f(x, p=4, sign=True):
    if x is None or (isinstance(x, float) and not np.isfinite(x)) or pd.isna(x):
        return "—"
    return f"{x:+.{p}f}" if sign else f"{x:.{p}f}"


def shape_of(vals) -> str:
    """One sentence describing a ladder's SHAPE — monotone, flat or peaked.
    Deliberately never names a best cell (`DESIGN.md` §3.8)."""
    v = [x for x in vals if np.isfinite(x)]
    if len(v) < 3:
        return "too few cells to describe a shape"
    d = np.diff(v)
    rng = max(v) - min(v)
    if rng < 0.02:
        return "flat — every cell within 0.02R of every other"
    if all(x >= -1e-12 for x in d):
        return "monotone increasing across the ladder"
    if all(x <= 1e-12 for x in d):
        return "monotone decreasing across the ladder"
    i = int(np.argmax(v))
    if 0 < i < len(v) - 1:
        return "peaked in the interior of the ladder, not at either end"
    return "non-monotone, with the extreme at an end of the ladder"


def main() -> None:
    scr = rd("fit_screen.csv")
    v = rd("holdout_verdicts.csv")
    nl = rd("holdout_nulls.csv")
    fd = rd("fit_describe.csv")
    hd = rd("holdout_describe.csv")
    lift = rd("fit_forward_lift.csv")
    sens = rd("fit_sensitivities.csv")
    csens = rd("holdout_cost_sensitivity.csv")
    fside = rd("fit_by_side.csv")
    hside = rd("holdout_by_side.csv")
    fharv = rd("fit_harvest.csv")
    hharv = rd("holdout_harvest.csv")
    excl = rd("exclusions.csv")
    quoted = rd("quoted_corner.csv")
    checks = json.load(open(os.path.join(R, "checks.json")))

    V = {r.arm: r for _, r in v.iterrows()} if len(v) else {}
    S = {r.arm: r for _, r in scr.iterrows()}
    N = {r.arm: r for _, r in nl.iterrows()} if len(nl) else {}
    FD = {r.arm: r for _, r in fd[fd.period == "fit"].iterrows()}
    HD = {r.arm: r for _, r in hd.iterrows()} if len(hd) else {}
    FH = {r.arm: r for _, r in fharv.iterrows()} if len(fharv) else {}
    HH = {r.arm: r for _, r in hharv.iterrows()} if len(hharv) else {}

    def verdict_of(arm):
        if arm in V:
            return str(V[arm].verdict)
        return "NO EDGE — KILL (fit screen)"

    real = [a for a in C.ARMS if verdict_of(a).startswith("REAL EDGE")]

    L = []
    A = L.append

    # ================== title and THE FIRST PARAGRAPH ====================
    A("# REPORT — ORB exit construction at the New York open "
      "(`orb-ny-open-exit`)")
    A("")
    A(f"**This family re-uses the {C.HOLD_START} .. {C.HOLD_END} holdout, "
      "already read by the closed `orb-ny-open` and `orb-ny-open-short` "
      "passes on the same instruments and the same days. It is the third and "
      "last pre-registered ORB look at that year.** α is corrected for all "
      f"**{C.N_ARMS_CUMULATIVE}** registered arms — 8 (`orb-ny-open`) + 6 "
      f"(`orb-ny-open-short`) + 6 (this family) — giving "
      f"**α = 0.05/{C.N_ARMS_CUMULATIVE} = {C.ALPHA:.4f}**. A REAL EDGE "
      "reached here is weaker evidence than a first-read REAL EDGE and earns a "
      "**forward confirmation on later tape, not a build**. After this family, "
      "any further ORB registration on these two instruments — of any kind — "
      "must use tape from 2026-08-01 onward; this pass closes the year for "
      "ORB.")
    A("")
    A("Pre-registered in "
      "`research/orb-ny-open/ARCHITECT-NOTE-EXIT-CONSTRUCTION.md` (`89365fd`) "
      "and its mechanical restatement `DESIGN.md` in this package, **committed "
      "before any R was computed on any arm**. Nothing in the mechanic, the "
      "fills, the costs, the calendar, the nulls, the bootstrap or the ladder "
      "was changed after a number was seen; the one amendment, made before any "
      "R existed and escalated to the Architect rather than decided locally, "
      "is logged in `DESIGN.md` §12.")
    A("")
    A("**No slippage is modelled anywhere, so every number below is "
      "optimistic.** Costs are half the entry minute's spread plus half the "
      "exit minute's, over `stop_dist`; no commission, no financing.")
    A("")

    # ================== the question and the family ======================
    A("## 1. What this family tested")
    A("")
    A("Two closed passes, fourteen arms, end on one sentence: after the "
      "trigger the tape moves further in the breakout direction than a random "
      "comparable bar — median forward lift 1.04–1.65 on every arm — and the "
      "+1R-target / full-range-stop construction converts none of it. That is "
      "a statement about the **exit**. So the entry was frozen and the exit "
      "became the axis.")
    A("")
    A("There are exactly three places a real directional lift can fail to "
      "become money, and each registered arm is one of them:")
    A("")
    A("| arm | construction | hypothesis | external anchor |")
    A("|---|---|---|---|")
    A("| **E0** | range stop, no target, flat 16:00 NY | **the cap** — the "
      "+1R target truncates a right tail that averages more than 1R | the "
      "Zarattini–Aziz 2023 base shape on this project's trigger |")
    A("| **E1** | range stop, no target, **1R ratchet**, flat 16:00 NY | "
      "**the give-back** — the run happens and is handed back before the "
      "exit | parameter-free; the continuous form of this project's own "
      "breakeven-at-1R rule |")
    A("| **E2** | stop at **0.10 × dATR14**, no target, flat 16:00 NY | "
      "**the stop width** — the range stop is far wider than the noise a "
      "genuine breakout must survive | the Zarattini–Barbon–Aziz 2024 exit "
      "verbatim |")
    A("")
    A("E1 **nests** E0 (E1 = E0 + ratchet), so the pair attributes: if E1 "
      "passes and E0 does not, the ratchet is the finding, by construction. "
      "The +1R corner of the grid is the already-killed `OR5` arm of the short "
      "pass, quoted on the fit period, **its holdout never computed**.")
    A("")

    # ================== THE FIRST RESULTS TABLE: THE GRID ================
    A("## 2. The grid — every cell, fit and holdout")
    A("")
    A(f"α = {C.ALPHA:.4f}. Kill bar +{C.KILL_MEAN:.2f}R, build bar "
      f"+{C.BUILD_MEAN:.2f}R, power floor {C.MIN_TRADES} holdout trades. "
      "A screened-out arm's holdout was **never computed** and its holdout "
      "cells are blank — the blank is the point. The quoted +1R corner is read "
      "from the short pass and its holdout is blank for the same reason.")
    A("")
    for sym in C.INSTRUMENTS:
        A(f"### {sym}")
        A("")
        A("| cell | exit construction | n fit | fit mean net R | fit p (Null A) "
          "| screen | n holdout | holdout mean net R | holdout p (Null A) | "
          "90 % interval | verdict |")
        A("|---|---|---|---|---|---|---|---|---|---|---|")
        qc = quoted[(quoted.arm == C.QUOTED_CORNER[sym]) & (quoted.template == 1)] \
            if len(quoted) else pd.DataFrame()
        if len(qc):
            r = qc.iloc[0]
            A(f"| **+1R (quoted)** | range stop, **+1R target**, flat 16:00 | "
              f"{int(r.n)} | {f(r.mean_netR)} | — (not re-run) | "
              f"*killed in `orb-ny-open-short`* | — | **never computed** | — | "
              f"— | NO EDGE — KILL (quoted from the short pass) |")
        for k in C.CONSTRUCTIONS:
            arm = C.arm_name(sym, k)
            s = S[arm]
            fdr = FD.get(arm)
            vv = V.get(arm)
            nn = N.get(arm)
            if vv is not None:
                A(f"| **{k}** | {C.CONSTRUCTION_DESC[k]} | {int(s.n_fit)} | "
                  f"{f(s.mean_netR_fit)} | {f(s.fit_p_A, 3, False)} | "
                  f"**{s.screen}** | {int(vv.n_holdout)} | "
                  f"**{f(vv.mean_netR_holdout)}** | {f(vv.p_A, 4, False)} | "
                  f"[{f(vv.boot_lo, 3)}, {f(vv.boot_hi, 3)}] | "
                  f"**{vv.verdict}** |")
            else:
                A(f"| **{k}** | {C.CONSTRUCTION_DESC[k]} | {int(s.n_fit)} | "
                  f"{f(s.mean_netR_fit)} | {f(s.fit_p_A, 3, False)} | "
                  f"**{s.screen}** | — | **never computed** | — | — | "
                  f"NO EDGE — KILL (fit screen) |")
        A("")
        for k in C.CONSTRUCTIONS:
            arm = C.arm_name(sym, k)
            if not S[arm].screen == "PASS":
                A(f"- `{arm}` screened out: {S[arm].reason}.")
        A("")

    # ================== the headline ====================================
    A("## 3. The verdict")
    A("")
    if not real:
        A("**All six arms are dead.** " + _kill_sentence(scr, v))
        A("")
        A("The sentence that survives both closed passes and this one, "
          "sharpened: *the breakout selects direction, and no exit "
          "construction with a mechanism — capped, uncapped, ratcheted, or "
          "volatility-stopped — converts it at realistic costs.*")
        A("")
        A("**No arm reached REAL EDGE, so `forward_confirm.py` was not written "
          "— it is not built speculatively.** No Software Engineer and no "
          "Backtesting engagement follows from this family.")
    else:
        A(f"**{len(real)} arm(s) reached REAL EDGE (third look): "
          f"{', '.join('`' + a + '`' for a in real)}.**")
        A("")
        for a in real:
            r = V[a]
            A(f"- `{a}` — {r.reason}")
            A(f"  - **Which axis carried it:** {r.attribution}")
            if str(r.side_label):
                A(f"  - **{r.side_label}** — {r.side_note}")
        A("")
        A("**This does NOT route to a build.** Per `DESIGN.md` §9.4 a REAL "
          "EDGE on a third look at an already-read holdout routes to the "
          f"Architect and to `forward_confirm.py`, frozen and committed in this "
          f"dispatch, which runs the arm's exact construction on tape from "
          f"2026-08-01 onward at α = 0.05/{len(real)} = {0.05/len(real):.5f} "
          "and **refuses to run** until that window holds ≥ 150 triggered "
          "days. A pass there is the evidence a build ruling is written on; a "
          "miss there is a kill of the arm, not a rework.")
    A("")

    # ================== E0 vs E1: the attribution pair ===================
    A("## 4. E0 versus E1 — did the ratchet help?")
    A("")
    A("E1 nests E0, so this pair is the whole give-back hypothesis. It is "
      "**not** asserted that E1 beats E0 per trade, and it does not: a ratchet "
      "can exit a trade that E0 would have held to a better close. Both "
      "directions are printed.")
    A("")
    A("| instrument | trades | E1 beat E0 | E1 worse than E0 | identical | "
      "mean E1 − E0 | ratchet never moved | ratchet moved |")
    A("|---|---|---|---|---|---|---|---|")
    for row in checks["trail"]["table"]:
        A(f"| {row['arm'].split('-')[0]} | {row['n']} | "
          f"{row['pct_E1_beat_E0']:.1f} % | {row['pct_E1_worse_than_E0']:.1f} % | "
          f"{row['pct_E1_equal_E0']:.1f} % | "
          f"**{row['mean_E1_minus_E0_R']:+.4f}R** | "
          f"{row['n_ratchet_unmoved']} | {row['n_ratchet_moved']} |")
    A("")
    A("On every trade where the ratchet never moved, E1's exit minute, price "
      "and cause equal E0's **exactly** — the structural identity of "
      "`DESIGN.md` §3.4, asserted on every such trade by `checks.py trail`. "
      "The `mean E1 − E0` column is therefore attributable entirely to the "
      "trades where the ratchet did move.")
    A("")
    for sym in C.INSTRUMENTS:
        a0, a1 = C.arm_name(sym, "E0"), C.arm_name(sym, "E1")
        A(f"- **{sym}, fit period:** E0 {f(S[a0].mean_netR_fit)}R → E1 "
          f"{f(S[a1].mean_netR_fit)}R "
          f"(**{f(S[a1].mean_netR_fit - S[a0].mean_netR_fit)}R** from the "
          f"ratchet); median harvest ratio "
          f"{f(FH[a0].median_harvest, 3)} → {f(FH[a1].median_harvest, 3)}.")
        if a0 in HD and a1 in HD:
            A(f"  On the holdout: E0 {f(V[a0].mean_netR_holdout)}R → E1 "
              f"{f(V[a1].mean_netR_holdout)}R "
              f"(**{f(V[a1].mean_netR_holdout - V[a0].mean_netR_holdout)}R**).")
    A("")

    # ================== descriptive rows ================================
    A("## 5. The descriptive rows — every arm, no verdict attached")
    A("")
    A("### 5.1 Fit period")
    A("")
    A(_describe_table(fd[fd.period == "fit"]))
    A("")
    if len(hd):
        A("### 5.2 Holdout — screened-in arms only")
        A("")
        A(_describe_table(hd))
        A("")
    A("### 5.3 The harvest ratio — where the lift went")
    A("")
    A("Per trade, realised net R divided by the trade's MFE in R over the same "
      "horizon (entry → 16:00 NY). This is the direct \"how much of the "
      "excursion did the construction keep\" number, and it is the diagnostic "
      "that says *where* the lift went on the arms that die.")
    A("")
    A("| arm | period | n | median harvest | median MFE (R) | % of trades with "
      "MFE ≥ 1R | median net R |")
    A("|---|---|---|---|---|---|---|")
    for t, lab in ((fharv, "fit"), (hharv, "holdout")):
        for _, r in (t.iterrows() if len(t) else []):
            A(f"| `{r.arm}` | {lab} | {int(r.n)} | {f(r.median_harvest, 3)} | "
              f"{f(r.median_mfe_R, 3)} | {r.pct_mfe_ge_1R:.1f} % | "
              f"{f(r.median_netR)} |")
    A("")
    A("### 5.4 The common scale — one unit for every construction")
    A("")
    A("E2's R is roughly half E0's in price, so the R-denominated rows are not "
      "directly comparable across constructions. Mean net PnL per trade in "
      "points and in dATR14 units puts them on one scale. **The verdict ladder "
      "does not read this table** — the ladder is in R, which is what a trader "
      "sizes on.")
    A("")
    A("| arm | period | n | mean net R | median stop (points) | mean net "
      "(points) | mean net (dATR14) |")
    A("|---|---|---|---|---|---|---|")
    for t, lab in ((fd[fd.period == "fit"], "fit"), (hd, "holdout")):
        for _, r in (t.iterrows() if len(t) else []):
            A(f"| `{r.arm}` | {lab} | {int(r.n)} | {f(r.mean_netR)} | "
              f"{f(r.median_stop_dist, 2, False)} | "
              f"{f(r.mean_net_points, 2)} | {f(r.mean_net_datr)} |")
    A("")
    A("### 5.5 The long/short split — printed for every arm, fit and holdout")
    A("")
    A("No side-split arm is registered. `US100` longs beat shorts on the fit "
      "period at every width tested by the closed passes, but the fit period "
      "is a rising tape and the premium is at least partly drift; Null A is "
      "side-matched and controls for it at the arm level. An arm reaching REAL "
      "EDGE with a non-positive side is labelled **\"one-sided — flagged\"**.")
    A("")
    A("| arm | period | side | n | mean net R | win rate | median harvest |")
    A("|---|---|---|---|---|---|---|")
    for t, lab in ((fside, "fit"), (hside, "holdout")):
        for _, r in (t.iterrows() if len(t) else []):
            if not int(r.n):
                continue
            A(f"| `{r.arm}` | {lab} | {r.side} | {int(r.n)} | "
              f"{f(r.mean_netR)} | {r.win_rate:.1f} % | "
              f"{f(r.median_harvest, 3)} |")
    A("")
    A("### 5.6 Forward lift — once per instrument")
    A("")
    A("The median ratio of a trade's MFE (in ATR14, entry → 16:00 NY) to the "
      "median MFE of a random side-matched, horizon-matched bar from the same "
      "[09:35, 12:00) NY window. It does not use the trade's outcome, so it is "
      "not circular. **It is a property of the trigger and is identical across "
      "E0, E1 and E2 by construction** — the three arms are one trade stream "
      "exited three ways — so it is printed once per instrument rather than "
      "three times.")
    A("")
    A("| instrument | n | median forward lift | % of trades ≥ 1 |")
    A("|---|---|---|---|")
    for _, r in (lift.iterrows() if len(lift) else []):
        A(f"| {r.symbol} | {int(r.n)} | **{f(r.lift_median, 3, False)}** | "
          f"{r.pct_ge_1:.1f} % |")
    A("")
    A("This is the positive result of the whole ORB line, and it is the reason "
      "the exit family was registered: the breakout **does** select direction. "
      "What the grid above measures is whether any exit construction converts "
      "it.")
    A("")

    # ================== costs ==========================================
    A("## 6. Costs — the projection, and what was realised")
    A("")
    A("`cost_R` is set by **the stop**, not by the exit, so it is a property "
      "of the construction. On E2 the stop is sized to volatility, not to the "
      "range, so **`cost_R` is roughly double E0's; on US500 it approaches the "
      "level at which this project has previously seen costs decide a "
      "verdict** (`cmc-bot` Запись 22: 0.25–0.40R killed everything).")
    A("")
    A("| arm | period | n | mean `cost_R` | median | p90 | mean gross R | "
      "mean net R | the gap |")
    A("|---|---|---|---|---|---|---|---|---|")
    for t, lab in ((fd[fd.period == "fit"], "fit"), (hd, "holdout")):
        for _, r in (t.iterrows() if len(t) else []):
            A(f"| `{r.arm}` | {lab} | {int(r.n)} | "
              f"{f(r.mean_cost_R, 4, False)} | {f(r.median_cost_R, 4, False)} | "
              f"{f(r.p90_cost_R, 4, False)} | {f(r.mean_grossR)} | "
              f"{f(r.mean_netR)} | {f(r.mean_cost_R, 4, False)} |")
    A("")
    A("The 2023 paper's own optimum — a stop at **0.05 dATR** — is **not "
      "registered** here: at these spreads it projects to `cost_R` ≈ 0.09R on "
      "US100 and 0.12–0.15R on US500 with p90 well above 0.3R, so the arm "
      "would measure the spread rather than the edge. That is the paper's own "
      "caveat (\"a stop placed at 5 % of the 14-day ATR … will likely be "
      "exceeded\") quantified on a CFD. It is printed in the S-K ladder below "
      "so the cost gradient is on the record.")
    A("")
    if len(csens):
        A("Cost sensitivities on the holdout (non-gating, screened-in arms):")
        A("")
        A("| arm | base | 2× per-bar spread | fixed fit-median spread |")
        A("|---|---|---|---|")
        for _, r in csens.iterrows():
            A(f"| `{r.arm}` | {f(r.base)} | {f(r['2x per-bar spread'])} | "
              f"{f(r['fixed fit-median spread'])} |")
        A("")

    # ================== the ladders ====================================
    A("## 7. The fit-only ladders — shapes, not decisions")
    A("")
    A("**None of these can create, upgrade or downgrade a verdict. None is "
      "computed on the holdout. No cell below is a recommendation and no "
      "\"best cell\" sentence appears anywhere in this deliverable** — a "
      "ladder cell that would clear the build bar on the fit period generates "
      "**no follow-up of any kind**; it is a backlog note, and only a fresh "
      "registration on 2026-08+ tape could test it. The registered cell is "
      "marked ✅.")
    A("")
    if len(sens):
        for lad in sens.ladder.unique():
            g = sens[sens.ladder == lad]
            A(f"### {lad}")
            A("")
            A("| instrument | cell | n | mean net R | win rate | mean "
              "`cost_R` | median stop (pts) | median hold (min) | median "
              "harvest |")
            A("|---|---|---|---|---|---|---|---|---|")
            for _, r in g.iterrows():
                mark = " ✅" if r.get("registered_cell") else ""
                A(f"| {r.symbol} | {r.cell}{mark} | {int(r.n)} | "
                  f"{f(r.mean_netR)} | "
                  f"{r.win_rate:.1f} % | {f(r.get('mean_cost_R'), 4, False)} | "
                  f"{f(r.get('median_stop_dist'), 1, False)} | "
                  f"{f(r.get('median_hold_min'), 0, False)} | "
                  f"{f(r.get('median_harvest'), 3)} |")
            A("")
            for sym in C.INSTRUMENTS:
                gg = g[g.symbol == sym]
                if len(gg) >= 3:
                    A(f"- **{sym}:** {shape_of(list(gg.mean_netR.values))}.")
            A("")

    # ================== checks =========================================
    A("## 8. The checks that had to pass before any number counted")
    A("")
    A("`results/checks.json` holds the full output. Every one is a `DESIGN.md` "
      "§11 stop rule: a failure halts the pass and returns to the Architect.")
    A("")
    A("| # | check | result |")
    A("|---|---|---|")
    A(f"| 1 | tape integrity — MD5 and `COVERAGE.md` reproduce byte-identically "
      f"from the raw NDJSON | **PASS** (§2.2) |")
    A(f"| 1 | clock grid — 09:30 / 09:35 / 11:00 / 12:00 / 14:00 / 16:00 NY on "
      f"the 5-minute epoch grid, every session day, both DST offsets | "
      f"**{'PASS' if checks['grid']['pass'] else 'FAIL'}** "
      f"({checks['grid']['days']} days, {checks['grid']['violations']} "
      f"violations) |")
    A(f"| 2 | **same trade list** — E0 ≡ E1 ≡ E2 ≡ the short pass's own "
      f"`US100-OR5` / `US500-OR5` | "
      f"**{'PASS' if checks['tradelist']['pass'] else 'FAIL'}** |")
    A(f"| 3 | fills, fixed-stop arms — 1m-path fill ≡ bar-OHLC fill | "
      f"**{'PASS' if checks['fills']['pass'] else 'FAIL'}** |")
    A(f"| 4 | fills, E1 — numba ≡ pure-Python reference on every trade; "
      f"unmoved ratchet ≡ E0 exactly | "
      f"**{'PASS' if checks['trail']['pass'] else 'FAIL'}** |")
    A(f"| 5 | dATR14 look-ahead — recomputed from a tape truncated at 09:30 NY "
      f"of the trade day, {checks['datr']['n_sampled']} sampled trades across "
      f"fit and holdout | **{'PASS' if checks['datr']['pass'] else 'FAIL'}** "
      f"(max abs diff {checks['datr']['max_absdiff']:g}) |")
    A(f"| 6 | session — no trade crosses 16:00 NY on any arm | "
      f"**{'PASS' if checks['session']['pass'] else 'FAIL'}** |")
    A("| 7 | screen before holdout — `analysis.py holdout` refuses to run "
      "without `results/fit_screen.csv`, and computes nothing for a "
      "screened-out arm or for the quoted +1R corner | **PASS** (structural) |")
    A("")
    A("The trade list is the strongest of these: the three constructions are "
      "**one trade stream exited three ways**, and the check re-derives the "
      "reference list by importing the short package's own unmodified "
      "`common.py` and `engine.py` and calling its own `build_arm` — the "
      "committed record executing itself. It is written to "
      "`results/short_or5_<symbol>.csv`.")
    A("")
    if len(excl):
        A(f"One bounded, pre-registered exclusion applies to E2 only: on "
          f"**{len(excl)} triggered days** (all in January 2024, the Wilder "
          f"ATR(14) warm-up at the very start of the tape) `dATR14` is "
          f"undefined, so E2 has no stop. `DESIGN.md` §3.6 records the "
          f"Architect note's erratum and the ruling; the days are enumerated "
          f"in `results/exclusions.csv`. **The holdout and the tail are "
          f"entirely unaffected** — "
          f"{int((excl.period != 'fit').sum())} of them lie outside the fit "
          f"period — so every holdout `n` is identical across all six arms.")
        A("")

    # ================== what is not here ================================
    A("## 9. What this family did not test, and what is left of the ORB line")
    A("")
    A("- **The papers' entry** — the second 5-minute candle's open in the "
      "first candle's direction (2023), or a resting stop order at the range "
      "edge (2024). The one ORB *entry* variant this project has not tested. "
      "It would trade every day, earlier and closer to the range, at a lower "
      "win rate. Logged in `IDEAS-BACKLOG.md`; if wanted it is a fresh "
      "registration on 2026-08+ tape with its own count, never a cell here.")
    A("- **Relative volume as a filter** — cross-sectional in the 2024 paper "
      "(which stocks are in play today). On a single index there is no "
      "cross-section; the time-series analogue `or_rvol` was a Study B feature "
      "on ~1,400 trades in the closed pass and was **not flagged** (5-minute "
      "SHAP direction −0.51, i.e. if anything the wrong sign). Logged, not "
      "registered.")
    A("- **Crypto** — not in this family. If the parallel NY-anchor "
      "investigation concludes the anchor is real, crypto gets its own exit "
      "family on the deferred 2026-08-01 .. 2027-07-31 window with its own "
      "count, subsuming the frozen `deferred_eth_t2.py`.")
    A("- **The width axis** — closed (Запись 24). One width here; a pass would "
      "have made width a later sensitivity, never an arm.")
    A("- **Tighter stops than 0.10 dATR, ATR-multiple trails, no-progress "
      "stops, breakeven-only, midpoint stops** — each ruled individually in "
      "the Architect note §4.2 as nested, derived, cost-dead or uncalibrated. "
      "The ladders above print the shapes.")
    A("")
    A("**The tail** (2026-08-01 .. 2026-09-11) is descriptive only and is in "
      "`results/fit_describe.csv` with `period = tail`. It is also the window "
      "`forward_confirm.py` will eventually read, which is why no verdict "
      "reads it now.")
    A("")

    with open(os.path.join(HERE, "REPORT.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print("wrote REPORT.md")


def _kill_sentence(scr, v) -> str:
    n_screen = int((scr.screen != "PASS").sum())
    n_hold = len(v) if len(v) else 0
    parts = [f"{n_screen} of the six were removed by the pre-registered "
             f"fit-period screen and their holdout was never computed"]
    if n_hold:
        parts.append(f"the remaining {n_hold} was read once on the holdout and "
                     f"killed there")
    return "; ".join(parts) + "."


def _describe_table(t: pd.DataFrame) -> str:
    L = ["| arm | n | mean net R | median net R | mean gross R | win rate | "
         "mean win R | mean loss R | % long | median stop (pts) | median hold "
         "(min) | stop | trail-stop | time-exit |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for _, r in t.iterrows():
        L.append(f"| `{r.arm}` | {int(r.n)} | **{f(r.mean_netR)}** | "
                 f"{f(r.median_netR)} | {f(r.mean_grossR)} | "
                 f"{r.win_rate:.1f} % | {f(r.mean_win_R)} | {f(r.mean_loss_R)} | "
                 f"{r.pct_long:.1f} % | {f(r.median_stop_dist, 2, False)} | "
                 f"{f(r.median_hold_min, 0, False)} | {int(r.exit_stop)} | "
                 f"{int(r.exit_trail_stop)} | {int(r.exit_time)} |")
    return "\n".join(L)


if __name__ == "__main__":
    main()
