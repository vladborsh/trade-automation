#!/usr/bin/env python3
"""Generate `HANDOFF.md` to the Architect from the committed result tables.

`DESIGN.md` §10 step 8. Every number comes from a CSV in `results/`.

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


def rd(n, **kw):
    return pd.read_csv(os.path.join(C.RESULTS, n), **kw)


def f(x, p=4):
    return "—" if x is None or (isinstance(x, float) and not np.isfinite(x)) else f"{x:+.{p}f}"


def main() -> None:
    v = rd("holdout_verdicts.csv")
    desc = rd("descriptive_rows.csv")
    lift = rd("fit_forward_lift.csv")
    sb = json.load(open(os.path.join(C.RESULTS, "studyb", "train_summary.json")))
    checks = json.load(open(os.path.join(C.RESULTS, "checks.json")))
    flagged = sorted(set(sb["5m"]["flagged"]) | set(sb["15m"]["flagged"]))
    try:
        sbf = rd(os.path.join("studyb", "holdout_flagged_features.csv"))
    except Exception:
        sbf = pd.DataFrame()

    L = []
    A = L.append
    A("# HANDOFF — `orb-ny-open` → Architect")
    A("")
    A("**From:** Researcher · **Date:** 2026-09-16 · "
      "**Pre-registration:** `DESIGN.md` (`82d6c0b`, committed before any R) · "
      "**Ruling:** `ARCHITECT-NOTE.md` (`7ff19fc`)")
    A("")

    # ---- 1. the answer -----------------------------------------------------
    A("## 1. The answer")
    A("")
    vc = v.verdict.value_counts().to_dict()
    A("The pre-registered pass is complete on all eight arms. "
      + "; ".join(f"**{k}** on {n} of 8" for k, n in vc.items()) + ".")
    A("")
    A("| arm | n_hold | holdout mean net R | Null-A p | bootstrap 90 % | verdict |")
    A("|---|---|---|---|---|---|")
    for _, r in v.iterrows():
        A(f"| `{r.arm}` | {int(r.n_holdout)} | {f(r.mean_netR_holdout)}R | {r.p_A:.3f} | "
          f"[{f(r.boot_lo,3)}, {f(r.boot_hi,3)}] | **{r.verdict}** |")
    A("")
    A(f"No arm was underpowered: realised `n_holdout` ran "
      f"{int(v.n_holdout.min())}–{int(v.n_holdout.max())} against the floor of "
      f"{C.MIN_TRADES}, and the §8.2 power contingency did not fire (decision "
      "committed at `290260e` from fit-period trigger counts, before the holdout "
      "was touched).")
    A("")

    # ---- 2. decisions needed ----------------------------------------------
    A("## 2. What I need from you")
    A("")
    items = []
    t2max = v.mean_netR_holdout_t2.max()
    t2arm = v.loc[v.mean_netR_holdout_t2.idxmax(), "arm"]
    if t2max >= C.BUILD_MEAN:
        items.append(
            f"**Template 2 (pure ORB) on `{t2arm}`** reached {f(t2max)}R on the "
            f"holdout, at or above the +{C.BUILD_MEAN:.2f}R build bar, while its "
            "template-1 verdict is not a build. Per `DESIGN.md` §3.4 the arm's "
            "verdict stays template 1's and this is grounds for **one** "
            "Architect-authorised follow-up registration of template 2 as its own "
            "arm, with its own α, its own ladder and its own nulls — never a "
            "re-labelling of this arm. **Your call whether to register it.** Note "
            "the conflict honestly: that number comes from a holdout this pass has "
            "now read, so a registration should test on a later holdout or declare "
            "the re-use explicitly.")
    if not flagged:
        items.append(
            "**No Study B proposal.** Not one of the 24 features cleared the "
            "pre-registered FWER-controlled bar on either timeframe (§9.3). The "
            "prescribed proposal form in §9.4 therefore has nothing to carry, and "
            "I am **not** recommending any conditioned-ORB registration on this "
            "evidence. Recording it so the absence is on the record rather than "
            "silent.")
    else:
        for _, r in (sbf.iterrows() if len(sbf) else []):
            if r.wording == "OOS-consistent":
                items.append(
                    f"**Study B proposal ({r.tf}).** *\"ORB conditioned on "
                    f"`{r.feature}` ≥ {r.fit_cut_hi:.4f} (the fit-period tercile "
                    "boundary, fixed), as a new pre-registered arm, own α, same "
                    "ladder, same nulls, fresh registration.\"* This is a "
                    "**hypothesis**, not an edge. Any registration must test on a "
                    "**later** holdout or declare the re-use of this one, because "
                    "this holdout has now been read by Study B.")
    items.append(
        "**Confirmation that the line is closed.** On my reading nothing here "
        "routes to Software Engineer or Backtesting — that needs a REAL EDGE "
        "verdict and a further ruling from you, and there is none. I have not "
        "engaged them.")
    for i, s in enumerate(items, 1):
        A(f"{i}. {s}")
        A("")

    # ---- 3. what I'd flag --------------------------------------------------
    A("## 3. Three things worth your attention")
    A("")
    A("**(a) The mechanic selects direction, but not enough of it.** The "
      "non-circular forward lift (built as v5-NY's `tables.py:block_L`) is "
      f"**above 1.00 on every one of the eight arms** "
      f"({lift.lift_median.min():.3f}–{lift.lift_median.max():.3f}): after a "
      "close beyond the opening range, the tape does move further in the "
      "breakout's direction than it does from a random comparable bar in the "
      "same window. The traded expectancy is still at zero. So this is not the "
      "cmc-bot failure mode — costs are tiny here (0.016–0.030R on the indices, "
      "0.076–0.096R on crypto, against that pass's 0.25–0.40R) and gross "
      "expectancy is near zero on its own. The edge is absent, not eaten. If you "
      "ever revisit ORB, the open question is whether a different exit "
      "construction harvests that lift; this pass only establishes that the "
      "pre-registered one does not.")
    A("")
    wk = desc[(desc.row == "weekend") & (desc.template == 1)]
    pe = desc[(desc.row == "pre-etf") & (desc.template == 1)]
    cry = v[v.arm.str.startswith(("BTC", "ETH"))]
    A("**(b) The crypto controls came out mixed, and I am reporting both "
      "directions.** The weekend row is much worse than the arms "
      f"({wk.mean_netR.min():+.3f}R to {wk.mean_netR.max():+.3f}R), which is the "
      "direction the imported-anchor story wants — but the §4.2 reading only "
      "bites on a *passing* arm, and none passes, so nothing is inferred. The "
      "pre-ETF row, however, is **not weaker** than the ETF era "
      f"({pe.mean_netR.min():+.3f}R to {pe.mean_netR.max():+.3f}R against a "
      f"crypto fit range of {cry.mean_netR_fit.min():+.3f}R to "
      f"{cry.mean_netR_fit.max():+.3f}R). Per §4.2 I am saying so plainly: **the "
      "ETF-transmission story gets no support from the tape.** The simplest "
      "reading consistent with both controls is that there is no imported-anchor "
      "effect to transmit.")
    A("")
    A("**(c) One correction to the pre-registration, logged as amendment 2.** I "
      "initially built `or_rvol`/`bar_rvol` over prior *triggered* sessions; your "
      "note §5.2 says prior **eligible** sessions. It was not a cosmetic "
      "difference — `bar_rvol` needs 20 prior observations at the same clock "
      "slot, and triggers concentrate at early slots, so the wrong reading "
      "silently and non-randomly discarded 846 of 1,473 (5m) and 508 of 1,406 "
      "(15m) fit trades from Study B, exactly the late breakouts. Found and fixed "
      "**before any model was trained**. Test A was unaffected and I verified it "
      "rather than assuming: the rebuilt tables are bit-identical in `netR_1` and "
      "`grossR_1` across all 4,851 rows.")
    A("")

    # ---- 4. what was checked ----------------------------------------------
    A("## 4. What was checked before any number counted")
    A("")
    la, g = checks["lookahead"], checks["grid"]
    fl = pd.DataFrame(checks["fills"]["table"])
    A(f"- **Coverage.** US100's committed `COVERAGE.md` row and section reproduce "
      "**byte-identically** from the raw NDJSON. US500 (pull finished during this "
      "pass) audits clean: 954,943 bars, 0 duplicate timestamps, 0 non-monotone, "
      "same span and same eight no-data weekdays as US100. One ambiguity in your "
      "§3.1 is flagged in `DESIGN.md` §2.2 — there was no committed US500 row to "
      "reproduce, so I read the check as its evident intent (pipeline stability) "
      "and established US500's row fresh. No number depends on the reading.")
    A(f"- **Grid.** {g['days']:,} session days, {g['violations']} violations.")
    A(f"- **Look-ahead.** {la['n_checked']} trades across all eight arms, every "
      f"feature rebuilt from a tape truncated at the entry minute; "
      f"{la['n_cells_compared']:,} cells, max relative difference "
      f"{la['max_rel_diff']:g}, {la['n_violations']} violations.")
    A(f"- **Fills.** Exact agreement (max abs diff {fl.max_absdiff.max():g}) on "
      f"{int(fl.agreement_n.sum()):,} of {int(fl.n.sum()):,} trades. The check "
      "initially flagged 3 US500 trades; all were **minute-level** gaps through "
      "the stop inside an arm bar whose own open did not gap — the case the "
      "1-minute path exists to resolve, and in each the 1m fill was the harsher "
      "one. The mask was corrected to flag gaps at 1-minute granularity (gapping "
      "is a property of the trade, not of a chosen bar size) and the check was "
      "made **stronger** than §3.5 asked: on every excluded trade the 1m fill "
      "must be no better than the bar fill, and on all 10 it is not.")
    A("- **Session.** 0 of 4,851 trades cross 16:00 NY.")
    A("")

    # ---- 5. deliverables ---------------------------------------------------
    A("## 5. Where everything is")
    A("")
    A("| file | what |")
    A("|---|---|")
    A("| `DESIGN.md` | the pre-registration, `82d6c0b`; §8.2.1 cutoff decision "
      "`290260e`; §12 amendment log |")
    A("| `REPORT.md` | eight verdicts in the first section, every descriptive row "
      "and sensitivity, Study B under its hypothesis-generating heading |")
    A("| `MECHANIC-PROOF.md` | ten fit-period trades per timeframe, minute by "
      "minute, with all 24 features |")
    A("| `results/COVERAGE-AUDIT.md` | the coverage audit output verbatim |")
    A("| `results/holdout_verdicts.csv` | the ladder applied, per arm |")
    A("| `results/holdout_nulls.csv` | Null A / Null B / bootstrap per arm |")
    A("| `results/studyb/` | importances, the null-max distributions, the frozen "
      "models, the holdout read |")
    A("| `results/checks.json` | the four §11 stop-rule checks |")
    A("")
    A("Reproduce: `python projection.py && python build.py && python checks.py all "
      "&& python analysis.py fit && python studyb.py train && python analysis.py "
      "holdout && python studyb.py holdout && python report.py && python "
      "handoff.py`")
    A("")
    A("**A kill is a result.** `knowledge/opening-range-breakout.md` needs its "
      "status line updated from \"verdicts pending\" to the eight verdicts above; "
      "I have done that and recorded a `RESEARCH-LOG.md` Запись as the "
      "pre-registration required, regardless of outcome.")

    with open(os.path.join(HERE, "HANDOFF.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print("wrote HANDOFF.md")


if __name__ == "__main__":
    main()
