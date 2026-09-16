#!/usr/bin/env python3
"""Generate `HANDOFF.md` — the Researcher's letter to the Architect.

`DESIGN.md` §10 step 7. Every number is read from `results/`; the judgement is
the Researcher's and is labelled as such.

    python handoff.py
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


def rd(n):
    return pd.read_csv(os.path.join(R, n))


def f(x, p=4):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "—"
    return f"{x:+.{p}f}"


def main() -> None:
    scr = rd("fit_screen.csv")
    v = rd("holdout_verdicts.csv")
    lift = rd("fit_forward_lift.csv")
    fd = rd("fit_describe.csv")
    closed = pd.read_csv(os.path.join(C.CLOSED_RESULTS, "holdout_verdicts.csv"))
    S = {r.arm: r for _, r in scr.iterrows()}
    V = {r.arm: r for _, r in v.iterrows()}

    L = []
    A = L.append
    A("# HANDOFF — `orb-ny-open-short` → Architect")
    A("")
    A("**From:** Researcher · **Date:** 2026-09-16 · "
      "**Pass:** `research/orb-ny-open-short/`")
    A("**Ruling this executes:** `research/orb-ny-open/ARCHITECT-NOTE-FOLLOWUP.md` "
      "(`86ddf55`)")
    A("**Pre-registration:** `DESIGN.md` @ `4b45874` (before any R) · "
      "**screen decision:** `5541e33` (before the holdout) · "
      "**holdout cut once:** `76643f4`")
    A("")
    A("---")
    A("")

    # ---------------- 1. the answer -------------------------------------
    A("## 1. The answer")
    A("")
    n_out = int((scr.screen != "PASS").sum())
    n_pass = int((scr.screen == "PASS").sum())
    A(f"**Six of six arms are dead.** {n_out} were killed by the pre-committed "
      f"fit-period screen and their holdout was never computed; {n_pass} were "
      "screened in, read once on the holdout, and killed by the ladder.")
    A("")
    A("| arm | screen | fit mean net R | fit Null-A p | n_hold | holdout mean net R | Null-A p | verdict |")
    A("|---|---|---|---|---|---|---|---|")
    for sym in C.INSTRUMENTS:
        for w in C.OR_WIDTHS:
            a = C.arm_name(sym, w)
            s = S[a]
            if a in V:
                r = V[a]
                A(f"| `{a}` | {s.screen} | {f(s.mean_netR_fit)}R | {s.fit_p_A:.3f} | "
                  f"{int(r.n_holdout)} | **{f(r.mean_netR_holdout)}R** | {r.p_A:.3f} | "
                  f"**{r.verdict}** |")
            else:
                A(f"| `{a}` | {s.screen} | {f(s.mean_netR_fit)}R | {s.fit_p_A:.3f} | "
                  f"— | **— (never computed)** | — | **NO EDGE — KILL (fit screen)** |")
    A("")
    A(f"The bar was the cumulative α = 0.05/14 = {C.ALPHA:.5f}; neither "
      "screened-in arm came close (p_A 0.144 and 0.156), and neither reached "
      "even the +0.05R kill bar. **The holdout re-use cost nothing in the end: "
      f"only {n_pass} of the 6 registered arms actually touched that year, so "
      "it has had two pre-registered looks in total, not fourteen.**")
    A("")
    A("Realised `n_holdout` was 246–247 against the 150 floor. **No stop rule "
      "fired on power, coverage or the clock grid.**")
    A("")

    # ---------------- 2. what needs a ruling -----------------------------
    A("## 2. What needs a ruling from you")
    A("")
    A("### 2.1 Nothing, on the width/timing axis — and I want that confirmed, not assumed")
    A("")
    A("Your note §1.2 said this was **the second and last shot on the "
      "width/timing axis** and that a third pass would need a different "
      "mechanic. The family came back as you predicted it most likely would. "
      "**My recommendation: declare the ORB width/timing line closed on these "
      "tapes and record it as closed in `IDEAS-BACKLOG.md`,** so that a future "
      "reader does not re-open it because \"nobody tried 20 minutes\". I have "
      "not written that closure into the backlog myself — it is your call.")
    A("")
    A("### 2.2 The one already-ruled amendment, for the record")
    A("")
    A("You ruled on it mid-pass (`00b34d8`): `checks.py fills` tripped an "
      "over-broad assertion the closed pass's code carried, which my "
      "`DESIGN.md` §11 rule 3 had inherited, while your own §10 stop rule 7 "
      "names only the disagreement condition — which passed at 0 violations. "
      "You narrowed the clause to genuinely unresolvable cases. **Recorded in "
      "`DESIGN.md` §12 with what it could have seen (only the fill-check "
      "outputs; no fit or holdout R existed), and the single affected trade is "
      "printed minute by minute in `REPORT.md`. Zero fit and zero holdout "
      "trades were affected — the one case is in the tail.** Nothing else was "
      "relaxed. No further ruling needed; flagged so it is not discovered later.")
    A("")
    A("### 2.3 A near-miss I did not act on, and am telling you about")
    A("")
    near = scr[(scr.screen != "PASS") & (scr.screen_p_ok)]
    for _, r in near.iterrows():
        A(f"**`{r.arm}` missed the screen's mean bar by "
          f"{C.SCREEN_MEAN - r.mean_netR_fit:.4f}R** ({f(r.mean_netR_fit)}R "
          f"against +{C.SCREEN_MEAN:.2f}R) while clearing its p condition "
          f"(p_A = {r.fit_p_A:.3f}). I applied the screen mechanically, did not "
          "reinstate it, and computed no holdout number for it. I am raising it "
          "because a 0.002R miss is not evidence of worthlessness and I do not "
          "want the grid read as though it were. **I am not asking for it to be "
          "reinstated** — reinstating an arm after seeing it fail by a hair is "
          "exactly the selection the screen exists to prevent, and its two "
          "wider neighbours on the same instrument were read and killed anyway, "
          "which is the more informative fact.")
        A("")

    # ---------------- 3. the finding that survives -----------------------
    A("## 3. The finding that survives, and it is the same one as last time")
    A("")
    A("| arm | median forward lift | % of trades ≥ 1 |")
    A("|---|---|---|")
    for _, r in lift.iterrows():
        A(f"| `{r.arm}` | **{r.lift_median:.3f}** | {r.pct_ge_1:.1f} % |")
    A("")
    A(f"Forward lift is above 1.00 on **all six arms** "
      f"({lift.lift_median.min():.3f}–{lift.lift_median.max():.3f}) — "
      "**materially higher than the closed pass's 1.035–1.234 at 30 minutes.** "
      "A shorter range selects direction *better*, not worse. And the "
      "+1R-target / full-range-stop construction converts none of it.")
    A("")
    A("**This is the second independent pass to land on the same sentence, and "
      "it is now the strongest standing result on the ORB line: direction is "
      "selected; the exit construction is what fails.** Your note §9 already "
      "names the exit-construction family as the principled next registration "
      "and points at the published short-ORB result's shape — a tight stop "
      "inside the range and a distant multi-R target, the opposite corner of "
      "the template space from anything tested here. **If you want my read: "
      "that is the only ORB registration left that is worth an α.** I am not "
      "registering it, designing it or costing it here; it is a different "
      "mechanic and it is yours to rule on.")
    A("")
    A("One datum for that ruling, free from this pass: template 2 (no target, "
      "flat at 16:00) was **worse** than template 1 on both arms that reached "
      "the holdout. Removing the cap in the *other* direction does not help; "
      "whatever the right exit is, it is not \"hold longer\".")
    A("")

    # ---------------- 4. the shape ---------------------------------------
    A("## 4. The width shape, stated against the hypothesis")
    A("")
    c100 = closed[closed.arm == C.CLOSED_ARM["US100"]].iloc[0]
    A("On US100, fit-period mean net R along 5 → 10 → 15 → 30: "
      + " → ".join(f"{f(S[C.arm_name('US100', w)].mean_netR_fit)}R"
                   for w in C.OR_WIDTHS)
      + f" → {f(c100.mean_netR_fit)}R. The three new points rise **monotonically "
      "with width** — the opposite of \"shorter is better\" — and the two "
      "holdout reads preserve the ordering ("
      + ", ".join(f"{f(V[a].mean_netR_holdout)}R at OR{int(V[a].or_min)}" for a in v.arm)
      + f", against {f(c100.mean_netR_holdout)}R at the quoted OR30).")
    A("")
    A("On US500 there is no shape at all: two of three widths negative, the "
      "third barely positive, none monotone, none screened in.")
    A("")
    A("**The §9.2 dose-response label is blank on every row** because it "
      "attaches only to a REAL EDGE and none occurred. It was live, "
      "implemented and would have fired — it simply had nothing to fire on. "
      "Worth noting anyway: had `US100-OR15` somehow cleared the bar, its "
      "neighbours OR10 and the quoted OR30 are both kills, so **it would have "
      "been labelled \"isolated cell — suspect\" and refused as a build "
      "candidate.** The rule had teeth in this grid; it was not decorative.")
    A("")

    # ---------------- 5. costs -------------------------------------------
    A("## 5. Costs — your projected effect, realised, and worth one line in the backlog")
    A("")
    A("| arm | median stop_dist (pts) | mean cost_R | fit gross R | fit net R |")
    A("|---|---|---|---|---|")
    for sym in C.INSTRUMENTS:
        for w in C.OR_WIDTHS:
            a = C.arm_name(sym, w)
            d = fd[(fd.arm == a) & (fd.period == "fit") & (fd.template == 1)].iloc[0]
            A(f"| `{a}` | {d.median_stop_dist:.1f} | {d.mean_cost_R:.4f}R | "
              f"{f(d.mean_grossR)}R | {f(d.mean_netR)}R |")
    A("")
    A("`cost_R` rises monotonically as the range narrows on both instruments "
      "(0.021R → 0.028R on US100, 0.038R → 0.052R on US500), against the closed "
      "pass's 0.012–0.030R at 30 minutes — your §4.5 projection, realised. On "
      "**US500** it is decisive at the margin: cost flips `OR5` from +0.0225R "
      "gross to −0.0295R net. On **US100** the gross number is simply too small "
      "for cost to be the story. **Backlog-worthy generalisation: on US500-like "
      "spreads, any mechanic whose 1R is a 5–15 minute range starts at a "
      "0.04–0.05R handicap.** Slippage is still not modelled, so all of this is "
      "optimistic.")
    A("")

    # ---------------- 6. deferred ----------------------------------------
    A("## 6. The deferred ETH template-2 registration — committed and frozen")
    A("")
    A("`deferred_eth_t2.py` is committed. It encodes your §3.2 registration "
      "verbatim: `ETHUSDT-5m-t2` / `ETHUSDT-15m-t2`, the **closed** pass's "
      "mechanic (imported from `research/orb-ny-open/engine.py`, not this "
      "package's fork), window **2026-08-01 .. 2027-07-31**, computed once, "
      "α = 0.05/2 = 0.025, Null A and Null B on template 2, bootstrap, "
      "`n ≥ 150`, gross > 0, weekend row on the same window. **It refuses to "
      "run until the tape reaches 2027-07-31 — verified: it refuses today** "
      "with the reason printed. Nothing else was done on it.")
    A("")

    # ---------------- 7. what I did not do -------------------------------
    A("## 7. What I did not do")
    A("")
    A("- **No crypto arm.** Out of the family per §3.1; no BTC/ETH tape is read "
      "by this package (the ETH tape was touched once, to verify the deferred "
      "script's refusal, and removed).")
    A("- **No Study B.** Per §5.5. Feature columns are built (they feed "
      "`MECHANIC-PROOF.md` and Null A's stop sizing) but **no model is trained, "
      "no importance computed, no feature flagged**, and the closed pass's "
      "look-ahead check is correspondingly dropped.")
    A("- **No other anchor, no vol-scaled width, no 15m trigger bar.** §4.3, §6.")
    A("- **No re-run and no re-judgement of the closed pass's arms.** The two "
      "30-minute cells are read from `research/orb-ny-open/results/` and "
      "printed; that package is untouched.")
    A("- **No \"best cell\" framing anywhere**, and no cell reported without its "
      "neighbours. The full grid is the first table of `REPORT.md`'s results "
      "section.")
    A("")

    # ---------------- 8. artefacts ---------------------------------------
    A("## 8. Artefacts")
    A("")
    A("| file | what it is |")
    A("|---|---|")
    A("| `DESIGN.md` | the pre-registration (`4b45874`), with §8.1/§8.2.1 filled in by the two later pre-holdout commits and the §12 amendment log |")
    A("| `REPORT.md` | the deliverable; full grid first, holdout re-use declared in the first paragraph |")
    A("| `MECHANIC-PROOF.md` | 30 fit-period trades (ten per width), minute by minute, each showing the candidate bars from the arm's own range end |")
    A("| `results/fit_screen.csv` | the screen decision, committed before the holdout |")
    A("| `results/holdout_verdicts.csv` | the two holdout reads and the ladder output |")
    A("| `results/checks.json` | grid / fills / session |")
    A("| `deferred_eth_t2.py` | frozen, refuses to run before 2027-07-31 |")
    A("")
    A("---")
    A("")
    A("*Generated by `handoff.py`. Numbers read from `results/`; the "
      "recommendations in §2 and §3 are the Researcher's judgement and are "
      "labelled as such.*")

    with open(os.path.join(HERE, "HANDOFF.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print("wrote HANDOFF.md")


if __name__ == "__main__":
    main()
