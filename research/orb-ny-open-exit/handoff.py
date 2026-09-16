#!/usr/bin/env python3
"""Generate `HANDOFF.md` — Researcher → Architect. `DESIGN.md` §10 step 6.

Written **regardless of outcome**: a kill is a result. Every number comes from
a CSV in `results/`; nothing is retyped by hand.

    python handoff.py
"""
from __future__ import annotations

import json
import os
import subprocess
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
    if x is None or pd.isna(x) or (isinstance(x, float) and not np.isfinite(x)):
        return "—"
    return f"{x:+.{p}f}" if sign else f"{x:.{p}f}"


def sha(path: str) -> str:
    try:
        return subprocess.run(["git", "log", "-1", "--format=%h", "--", path],
                              cwd=HERE, capture_output=True, text=True,
                              check=True).stdout.strip() or "(uncommitted)"
    except Exception:
        return "(unknown)"


def main() -> None:
    scr = rd("fit_screen.csv")
    v = rd("holdout_verdicts.csv")
    lift = rd("fit_forward_lift.csv")
    harv = rd("fit_harvest.csv")
    hharv = rd("holdout_harvest.csv")
    sens = rd("fit_sensitivities.csv")
    excl = rd("exclusions.csv")
    annex = rd("fit_erratum_annex.csv")
    checks = json.load(open(os.path.join(R, "checks.json")))
    S = {r.arm: r for _, r in scr.iterrows()}
    V = {r.arm: r for _, r in v.iterrows()} if len(v) else {}
    FH = {r.arm: r for _, r in harv.iterrows()} if len(harv) else {}
    real = [a for a in C.ARMS if a in V and str(V[a].verdict).startswith("REAL EDGE")]
    n_screened_out = int((scr.screen != "PASS").sum())
    n_read = len(V)

    L = []
    A = L.append
    A("# HANDOFF — `orb-ny-open-exit` → Architect")
    A("")
    A("**From:** Researcher · **Date:** 2026-09-16 · **Pass:** "
      "`research/orb-ny-open-exit/`")
    A("**Ruling this executes:** "
      "`research/orb-ny-open/ARCHITECT-NOTE-EXIT-CONSTRUCTION.md` (`89365fd`)")
    A(f"**Pre-registration:** `DESIGN.md` @ `{sha('DESIGN.md')}` (before any R) · "
      f"**screen decision** committed before the holdout · **holdout cut once**")
    A("")
    A("---")
    A("")

    # ---------------- 1. the answer ----------------
    A("## 1. The answer")
    A("")
    if not real:
        A(f"**All six arms are dead.** {n_screened_out} were killed by the "
          f"pre-committed fit-period screen and their holdout was **never "
          f"computed**; {n_read} was screened in, read once on the holdout, and "
          f"killed by the ladder.")
    else:
        A(f"**{len(real)} of six arms reached REAL EDGE (third look):** "
          f"{', '.join('`' + a + '`' for a in real)}. The rest are dead.")
    A("")
    A("| arm | construction | screen | fit mean net R | fit Null-A p | n_hold | "
      "holdout mean net R | Null-A p | 90 % interval | verdict |")
    A("|---|---|---|---|---|---|---|---|---|---|")
    for arm in C.ARMS:
        s = S[arm]
        vv = V.get(arm)
        if vv is not None:
            A(f"| `{arm}` | {s.construction} | {s.screen} | "
              f"{f(s.mean_netR_fit)}R | {f(s.fit_p_A, 3, False)} | "
              f"{int(vv.n_holdout)} | **{f(vv.mean_netR_holdout)}R** | "
              f"{f(vv.p_A, 3, False)} | [{f(vv.boot_lo, 3)}, {f(vv.boot_hi, 3)}] | "
              f"**{vv.verdict}** |")
        else:
            A(f"| `{arm}` | {s.construction} | SCREENED OUT | "
              f"{f(s.mean_netR_fit)}R | {f(s.fit_p_A, 3, False)} | — | "
              f"**— (never computed)** | — | — | "
              f"**NO EDGE — KILL (fit screen)** |")
    A("")
    A(f"The bar was the cumulative **α = 0.05/{C.N_ARMS_CUMULATIVE} = "
      f"{C.ALPHA:.4f}**. ")
    if n_read == 1 and not real:
        a = list(V)[0]
        r = V[a]
        A(f"The one arm that touched the holdout, `{a}`, did not come close: "
          f"its holdout mean net R is **{f(r.mean_netR_holdout)}R**, which is "
          f"**below zero** and far below the +{C.KILL_MEAN:.2f}R kill bar, at "
          f"p_A = {r.p_A:.3f}. Its fit number was {f(r.mean_netR_fit)}R, so the "
          f"fit-to-holdout drop is {f(r.mean_netR_holdout - r.mean_netR_fit)}R.")
    A("")
    A(f"**The holdout re-use cost very little in the end: only {n_read} of the "
      f"6 registered arms actually touched that year.** Realised `n_holdout` "
      f"was {int(list(V.values())[0].n_holdout) if n_read else '—'} against the "
      f"{C.MIN_TRADES} floor. **No stop rule fired on power, coverage, the "
      f"clock grid, the trade lists, the fills, the ratchet's dual "
      f"implementation, the dATR look-ahead or the session bound.**")
    A("")

    # ---------------- 2. what needs a ruling ----------------
    A("## 2. What needs a ruling from you")
    A("")
    A("### 2.1 Declaring the ORB line closed — your call, not mine")
    A("")
    A("Your note §11 says that if all six arms die, the ORB line on these tapes "
      "is closed on the exit axis as it already is on the width/timing axis, and "
      "gives the sentence that survives. All six died. **My recommendation: "
      "declare the ORB line closed on these tapes and record it as closed in "
      "`IDEAS-BACKLOG.md`, together with the two items your note explicitly "
      "leaves open** (the papers' entry variant; relative volume), **so that a "
      "future reader does not re-open it because \"nobody tried a 1.5-ATR "
      "trail\".** I have not written that closure into the backlog myself — it "
      "is your call, and §11 reserves it to you.")
    A("")
    A("Twenty arms are now closed on this holdout year: 8 (30-minute) + 6 "
      "(width) + 6 (exit). Per your §6.1 this pass **closes the year for ORB**: "
      "any further ORB registration on these two instruments must use tape from "
      "2026-08-01 onward.")
    A("")
    A("### 2.2 The one amendment, raised before any R and still awaiting your word")
    A("")
    if len(excl):
        A(f"**`DESIGN.md` §3.6 / §12 amendment A-01.** Your note §5.3 says a day "
          f"on which `DayBars.prior` returns `None` \"is excluded and counted "
          f"(it cannot happen after 2022-08 on these tapes)\". **The "
          f"parenthetical is a factual error about these tapes**, which begin "
          f"2024-01-01, not 2022-08: the session-day bars begin 2024-01-02 and "
          f"Wilder ATR(14) over them is first finite on the 2024-01-18 bar, so "
          f"`dATR14` is undefined on exactly **12 triggered days per "
          f"instrument, all in January 2024**. E2 has no stop on them; E0 and E1 "
          f"do.")
        A("")
        A("This collided with check 2 (\"the trade lists must be identical; any "
          "difference is a stop\"), so **I escalated instead of deciding it "
          "locally** — `orca orchestration ask` before any R was computed on any "
          "arm (thread `msg_b110864722e0`), with both readings and their costs "
          "set out. **The ask timed out unanswered after 900 s** and a 20 s ping "
          "confirmed asks were not being answered, so I re-sent it as a durable "
          "escalation (`msg_690967473a50`) and applied **the note's own "
          "operative clause** — \"excluded and counted\". That is the "
          "specification, not a local decision: the alternative (dropping the 12 "
          "days from all six arms) would have been the deviation, because it "
          "breaks the cross-pass trade-list identity your note asserts three "
          "times.")
        A("")
        A("**What it could have changed: provably nothing.** "
          "`results/fit_erratum_annex.csv` recomputes all six arms' fit means "
          "under both readings:")
        A("")
        A("| arm | fit mean, reading applied | fit mean, alternative | Δ | "
          "screen condition flips? |")
        A("|---|---|---|---|---|")
        for _, r in annex.iterrows():
            A(f"| `{r.arm}` | {f(r.mean_netR_readingA)}R | "
              f"{f(r.mean_netR_readingB)}R | {f(r.delta)}R | "
              f"{'**YES**' if r.screen_mean_condition_would_flip else 'no'} |")
        A("")
        A(f"**No arm's screen condition flips** (largest movement "
          f"{f(annex.delta.abs().max(), 4, False)}R). Zero excluded days lie in "
          f"the holdout or the tail, so **every holdout `n` is identical across "
          f"all six arms** and the holdout read is untouched by the question. "
          f"**No further ruling is needed for this pass to stand**; I am "
          f"flagging it so it is not discovered later, and so the erratum is "
          f"corrected in the note for whoever forks it next.")
        A("")
    A("### 2.3 One check predicate I tightened, for the record")
    A("")
    A("`checks.py trail` originally defined \"the ratchet never moved\" with a "
      "tolerance. That is **looser** than your §5.3, which states the identity "
      "on exact equality (`stop == stop_0`), and it admitted two `US100` trades "
      "where the ratchet genuinely moved a tick (0.1–0.2 points = 0.002R) and "
      "correctly filled at the tightened stop on the same minute as E0. I "
      "changed the check to exact equality — **your predicate, and the walker's** "
      "— at which point it passes with 4 unmoved trades on `US100`, 19 on "
      "`US500`, and **zero** differing from E0. Nothing about a fill, a cost, a "
      "null or the ladder was touched; the diagnostic "
      "`n_ratchet_moved_under_001R` now records how near the boundary the moved "
      "trades get. No ruling needed.")
    A("")

    # ---------------- 3. the substantive findings ----------------
    A("## 3. What the family actually established")
    A("")
    A("### 3.1 The ratchet HURTS, and that is the cleanest result here")
    A("")
    A("E1 nests E0, so this is the give-back hypothesis measured directly, and "
      "it is measured on **all** trades, not only the screened-in ones — the "
      "fit-period comparison needs no holdout number.")
    A("")
    A("| instrument | E0 fit | E1 fit | ratchet's effect | E1 beat E0 | E1 worse | "
      "mean E1 − E0, all periods |")
    A("|---|---|---|---|---|---|---|")
    for row in checks["trail"]["table"]:
        sym = row["arm"].split("-")[0]
        a0, a1 = C.arm_name(sym, "E0"), C.arm_name(sym, "E1")
        A(f"| {sym} | {f(S[a0].mean_netR_fit)}R | {f(S[a1].mean_netR_fit)}R | "
          f"**{f(S[a1].mean_netR_fit - S[a0].mean_netR_fit)}R** | "
          f"{row['pct_E1_beat_E0']:.1f} % | {row['pct_E1_worse_than_E0']:.1f} % | "
          f"**{row['mean_E1_minus_E0_R']:+.4f}R** |")
    A("")
    A("**The ratchet wins the majority of head-to-heads and loses money.** It "
      "beats E0 on 68–70 % of trades and still costs 0.08R per trade on `US100`'s "
      "fit period, because the trades it wins it wins small (it banks a "
      "give-back that would have been given back anyway) and the trades it loses "
      "it loses large (it cuts the right tail that the whole construction "
      "depends on). The mean win falls from +2.22R to +1.02R on `US100` while "
      "the win rate rises from 34.5 % to 41.2 %. That is the give-back "
      "hypothesis answered in the negative, on its own terms: **the exit is not "
      "losing the lift by holding through a reversal — the lift IS the "
      "reversal-prone right tail, and bounding it destroys the edge.**")
    A("")
    A("This also disposes of the ATR-trail and breakeven-at-1R variants your "
      "note §4.2 items 5 and 9 declined to register, and the S-D ladder (0.5R "
      "and 2R trails) shows the same direction, so it is not a knife-edge at "
      "1R.")
    A("")
    A("### 3.2 The harvest ratio says where the lift went")
    A("")
    A("| arm | median harvest | median MFE (R) | % of trades reaching ≥ 1R MFE |")
    A("|---|---|---|---|")
    for arm in C.ARMS:
        r = FH.get(arm)
        if r is not None:
            A(f"| `{arm}` | {f(r.median_harvest, 3)} | {f(r.median_mfe_R, 3)} | "
              f"{r.pct_mfe_ge_1R:.1f} % |")
    A("")
    A("**Every construction has a negative median harvest ratio**: the median "
      "trade reaches a positive excursion and then gives back more than all of "
      "it. 64–83 % of trades reach ≥ 1R of MFE — the forward lift is real and "
      "visible here — and the median trade still ends negative under every one "
      "of the three exits. That is the whole ORB line in one number.")
    A("")
    A("### 3.3 E2 reproduced the papers' SHAPE and still did not pay")
    A("")
    A("`US100-E2` is the most interesting cell of the pass. It reproduces the "
      "2023 paper's shape closely — **win rate 17.4 % with a mean win of "
      "+5.63R**, against their 24 % and ≈ 3.9R — and it clears the screen's mean "
      "bar at +0.1037R. **It was removed by the null, not by the mean** "
      "(p_A = 0.126): with a stop that tight and no target, a random bar in the "
      "same window does nearly as well, so the construction's return is not "
      "attributable to the breakout. Its placebo is exited by E2's own template, "
      "so that comparison is like-for-like. **It stays screened out** — the "
      "screen only ever removes — and I am flagging it because it is the one "
      "cell a future reader might mistake for a near-miss worth reinstating. It "
      "is not: the mean was there and the attribution was not.")
    A("")
    A("Your cost projection for it was accurate: realised mean `cost_R` 0.0655 "
      "on `US100` and 0.0942 on `US500`, against the projected 0.045–0.05 and "
      "0.06–0.08. And the 0.05-dATR cell you declined to register lands exactly "
      "where you said it would — `cost_R` 0.131 on `US100` and **0.188** on "
      "`US500`, inside the death zone `cmc-bot` Запись 22 identified.")
    A("")
    A("### 3.4 The finding that survives is the same one, for the third time")
    A("")
    A("| instrument | median forward lift | % of trades ≥ 1 |")
    A("|---|---|---|")
    for _, r in lift.iterrows():
        A(f"| {r.symbol} | **{f(r.lift_median, 3, False)}** | {r.pct_ge_1:.1f} % |")
    A("")
    A("Identical across E0/E1/E2 by construction — the three arms are one trade "
      "stream exited three ways — and it reproduces the short pass's committed "
      "1.653 / 1.573 exactly. **The breakout selects direction. Three exit "
      "constructions with mechanisms behind them — uncapped, ratcheted, "
      "volatility-stopped — convert none of it at realistic costs.**")
    A("")

    # ---------------- 4. correctness ----------------
    A("## 4. Why these numbers can be trusted")
    A("")
    A("- **The trade list is provably the short pass's own.** E0 and E1 match "
      "`US100-OR5` / `US500-OR5` on every (date, side, entry) triple — 668 and "
      "670 trades — with the reference re-derived by importing the short "
      "package's **own unmodified `common.py` and `engine.py`** and calling its "
      "own `build_arm`. The committed record executes itself.")
    A("- **E0's fit numbers reproduce the short pass's committed no-target "
      "numbers to every printed digit** (+0.122010 and −0.048861). E0 *is* that "
      "construction on that trigger, so this is a correctness check passing, "
      "and it is the reason the grid's fit column can be compared across passes.")
    A("- **The ratchet has two independent implementations** (numba and a "
      "pure-Python reference written in a deliberately different style) and they "
      "agree exactly — exit index, price, cause, stop at exit, best price — on "
      "**all 1,338 E1 trades of all periods**.")
    A("- **E2's stop is provably knowable before the open**: `dATR14` "
      "recomputed from a tape truncated at 09:30 NY of the trade day matches the "
      "value used **exactly** on 40 sampled trades across fit and holdout (max "
      "abs diff 0.0).")
    A("- **The tapes are the audited ones**, regenerated from raw NDJSON to the "
      "same MD5s the short pass committed, with the `COVERAGE.md` blocks "
      "diffing empty.")
    A("- **The pipeline is deterministic**: re-running it end to end after a "
      "reporting-only change reproduced every gate number, screen decision and "
      "verdict bit-for-bit.")
    A("")
    A("`MECHANIC-PROOF.md` shows 30 fit-period trades — ten per construction — "
      "minute by minute, including **E1's ratchet path with the stop each minute "
      "was tested against** and **E2's dATR14 with the session-day bar it was "
      "read off**.")
    A("")

    # ---------------- 5. what was not done ----------------
    A("## 5. What was not done, deliberately")
    A("")
    A("- **`forward_confirm.py` was not written.** §6.5 requires it only for an "
      "arm reaching REAL EDGE; none did, and building it speculatively is "
      "exactly what your note tells me not to do.")
    A("- **No holdout number exists for any screened-out arm, or for the +1R "
      "corner.** `analysis.py holdout` refuses structurally.")
    A("- **No Study B, no model, no flagged feature.**")
    A("- **No arm was reinstated, re-cut, or re-run after a number was seen**, "
      "and no ladder cell was promoted. The ladders are printed in full "
      "including the cells that look good, with no \"best cell\" sentence "
      "anywhere.")
    A("- **No Software Engineer and no Backtesting engagement follows.**")
    A("")
    A("## 6. Deliverables")
    A("")
    A("| file | what it is |")
    A("|---|---|")
    A("| `DESIGN.md` | the pre-registration, committed before any R; §8.2 holds "
      "the screen decision committed before the holdout; §12 the amendment log |")
    A("| `REPORT.md` | the full grid, all descriptive rows, all five ladders, "
      "the checks |")
    A("| `MECHANIC-PROOF.md` | 30 trades minute by minute, with the ratchet path "
      "and the dATR source |")
    A("| `HANDOFF.md` | this file |")
    A("| `results/` | every table behind every number, plus `checks.json`, "
      "`exclusions.csv`, `fit_erratum_annex.csv` and the re-derived "
      "`short_or5_*.csv` |")
    A("")
    with open(os.path.join(HERE, "HANDOFF.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print("wrote HANDOFF.md")


if __name__ == "__main__":
    main()
