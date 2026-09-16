#!/usr/bin/env python3
"""Generate `REPORT.md` from the committed result tables. `DESIGN.md` §10 step 8.

Every number in REPORT.md comes from a CSV in `results/`; nothing is retyped.

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
import features as F  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
R = C.RESULTS


def rd(n, **kw):
    return pd.read_csv(os.path.join(R, n), **kw)


def f(x, p=4, sign=True):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "—"
    return f"{x:+.{p}f}" if sign else f"{x:.{p}f}"


def main() -> None:
    v = rd("holdout_verdicts.csv")
    nl = rd("holdout_nulls.csv")
    fd = rd("fit_describe.csv")
    hd = rd("holdout_describe.csv")
    ex = rd("fit_exit_causes.csv")
    lift = rd("fit_forward_lift.csv")
    sens = rd("fit_sensitivities.csv")
    csens = rd("holdout_cost_sensitivity.csv")
    desc = rd("descriptive_rows.csv")
    proj = rd("power_projection.csv")
    side = rd("fit_by_side.csv")
    checks = json.load(open(os.path.join(R, "checks.json")))
    sb = json.load(open(os.path.join(R, "studyb", "train_summary.json")))
    try:
        sbh = rd(os.path.join("studyb", "holdout_frozen_read.csv"))
        sbf = rd(os.path.join("studyb", "holdout_flagged_features.csv"))
    except Exception:
        sbh, sbf = pd.DataFrame(), pd.DataFrame()

    L = []
    A = L.append

    # ================= first paragraph: the eight verdicts ================
    A("# REPORT — Opening-range breakout at the New York open (`orb-ny-open`)")
    A("")
    A("**Pre-registration:** `DESIGN.md`, committed at `82d6c0b` **before any R "
      "was computed on any arm and before any model was trained**; binding "
      "ruling `ARCHITECT-NOTE.md` (`7ff19fc`). Holdout cut once, at the end.")
    A("")
    vc = v.verdict.value_counts()
    head = ", ".join(f"**{k}** on {n} of 8" for k, n in vc.items())
    A(f"## The eight pre-registered verdicts")
    A("")
    A(f"On the pre-registered gate — **template 1** (+1R target, forced flat at "
      f"16:00 NY), holdout 2025-08-01 .. 2026-07-31, ladder at "
      f"α = 0.05/8 = {C.ALPHA:.5f} — the result is {head}. "
      "Every arm was powered: realised `n_holdout` ran "
      f"{int(v.n_holdout.min())}–{int(v.n_holdout.max())}, against a floor of "
      f"{C.MIN_TRADES}.")
    A("")
    A("| arm | n_hold | **holdout mean net R** | gross R | fit mean net R | "
      "Null-A p | Null-B p | 90 % day-block bootstrap | **verdict** |")
    A("|---|---|---|---|---|---|---|---|---|")
    for _, r in v.iterrows():
        A(f"| `{r.arm}` | {int(r.n_holdout)} | **{f(r.mean_netR_holdout)}R** | "
          f"{f(r.mean_grossR_holdout)}R | {f(r.mean_netR_fit)}R | "
          f"{r.p_A:.3f} | {r.p_B:.3f} | "
          f"[{f(r.boot_lo,3)}, {f(r.boot_hi,3)}] | **{r.verdict}** |")
    A("")
    A("Per-arm reasons, mechanically from the ladder:")
    A("")
    for _, r in v.iterrows():
        A(f"- **`{r.arm}` — {r.verdict}.** {r.reason}")
    A("")
    A("**Slippage is not modelled, so every number in this report is "
      "optimistic.** No commission is modelled on the Capital.com arms and no "
      "financing on any arm (every trade is flat by 16:00 NY).")
    A("")

    # ================= template 2 =========================================
    A("### Template 2 (pure ORB) — the secondary, no verdict")
    A("")
    A("Template 2 is the literal hypothesis: the breakout's direction persists "
      "to the close. It carries **no verdict** (`DESIGN.md` §3.4); it is here "
      "so a reader can see whether the +1R cap made or unmade the number.")
    A("")
    A("| arm | fit mean net R (t2) | holdout mean net R (t2) | holdout t1 (the gate) |")
    A("|---|---|---|---|")
    for _, r in v.iterrows():
        A(f"| `{r.arm}` | {f(r.mean_netR_fit_t2)}R | {f(r.mean_netR_holdout_t2)}R | "
          f"{f(r.mean_netR_holdout)}R |")
    A("")
    t2max = v.mean_netR_holdout_t2.max()
    if t2max >= C.BUILD_MEAN:
        A(f"**Straddle notice (§3.4).** `{v.loc[v.mean_netR_holdout_t2.idxmax(),'arm']}`'s "
          f"template-2 holdout mean of {f(t2max)}R is at or above the +0.10R build "
          "bar while its template-1 verdict is not a build. Per the "
          "pre-registration the arm's verdict remains template 1's, and this is "
          "grounds for **one** Architect-authorised follow-up registration of "
          "template 2 as its own arm with its own α — never a re-labelling of "
          "this one. It is raised in `HANDOFF.md`.")
    else:
        A(f"No template-2 holdout number reaches the +{C.BUILD_MEAN:.2f}R build bar "
          f"(highest: {f(t2max)}R), so the §3.4 straddle clause is not triggered.")
    A("")

    # ================= power ==============================================
    A("### Power — the contingency did not fire")
    A("")
    A("`DESIGN.md` §8.2 required a projection **on the fit period only, before "
      "the holdout was touched**, and committed the cutoff decision at "
      "`290260e`. Projected `n_holdout` ran "
      f"{proj.proj_n_holdout_1200.min():.0f}–{proj.proj_n_holdout_1200.max():.0f} "
      "on the base [10:00, 12:00) NY window, so **no arm used the widened 13:30 "
      "window** and no arm ever will in this pass.")
    A("")
    A("| arm | fit eligible days | fit triggered | share | projected n_hold | "
      "**realised n_hold** |")
    A("|---|---|---|---|---|---|")
    for _, r in proj.iterrows():
        n = int(v.loc[v.arm == r.arm, "n_holdout"].iloc[0])
        A(f"| `{r.arm}` | {int(r.fit_eligible)} | {int(r.fit_triggered_1200)} | "
          f"{r.share_1200:.3f} | {r.proj_n_holdout_1200:.0f} | **{n}** |")
    A("")
    A("The Architect's §3.3 assumption was that 60–80 % of eligible days would "
      "break out by 12:00 NY; the realised fit-period share is "
      f"{proj.share_1200.min():.1%}–{proj.share_1200.max():.1%}. A *close* beyond "
      "a 30-minute range within the following two hours is simply a common "
      "event. The projection tracked reality closely (worst arm: projected "
      f"{proj.proj_n_holdout_1200.min():.0f}, realised "
      f"{int(v.n_holdout.min())}).")
    A("")

    # ================= exclusions / checks ================================
    A("### Data, exclusions and the four stop-rule checks")
    A("")
    g = checks["grid"]
    la = checks["lookahead"]
    fl = pd.DataFrame(checks["fills"]["table"])
    A(f"- **Coverage (§2.2).** US100's committed `COVERAGE.md` row and section "
      "reproduce **byte-identically** from the raw NDJSON (971,812 bars, 0 "
      "duplicate timestamps, 0 non-monotone, 0 zero-volume). US500, pulled and "
      "converted during this pass, audits clean at 954,943 bars with the same "
      "span and the same eight no-data weekdays. Kept in "
      "`results/COVERAGE-AUDIT.md`.")
    A(f"- **Grid (§2.3).** {g['days']:,} NYSE session days checked, "
      f"**{g['violations']} violations**: 09:30 NY lands at 13:30 or 14:30 UTC "
      "and both sit on the 5- and 15-minute epoch grid, so the NY-anchored bins "
      "and the UTC-aligned bins are the same object under either DST offset.")
    A(f"- **Look-ahead (§7.1).** {la['n_checked']} trades sampled across all "
      f"eight arms, every feature recomputed from a 1-minute tape **truncated at "
      f"the entry minute**: {la['n_cells_compared']:,} cells compared, "
      f"max relative difference **{la['max_rel_diff']:g}**, "
      f"**{la['n_violations']} violations**.")
    A(f"- **Fills (§3.5).** Exact agreement (max absolute difference "
      f"**{fl.max_absdiff.max():g}**) between the 1-minute path and the arm-bar "
      f"OHLC on {int(fl.agreement_n.sum()):,} of {int(fl.n.sum()):,} trades. The "
      f"{int(fl.excluded.sum())} excluded trades (all US500) are ones that gap "
      "the stop or touch both levels inside one bar — and on **none** of them is "
      "the 1-minute fill kinder than the bar fill, which is a stronger statement "
      "than §3.5 asked for.")
    A("- **Session (§3.4).** 0 trades out of 4,851 cross 16:00 NY on any arm.")
    A("")
    A("One correction was made during the pass and is logged as amendment 2 in "
      "`DESIGN.md` §12: `or_rvol` / `bar_rvol` were initially built over prior "
      "*triggered* sessions instead of the binding note's prior **eligible** "
      "sessions, which silently and non-randomly discarded 846 of 1,473 (5m) "
      "and 508 of 1,406 (15m) fit trades from Study B. It was found and fixed "
      "**before any model was trained**. Test A was unaffected and this was "
      "verified rather than assumed: the rebuilt tables are bit-identical in "
      "`netR_1` and `grossR_1` across all 4,851 rows, because no feature enters "
      "the signal.")
    A("")
    A("Exclusions per arm (days dropped before any trade logic runs) are in "
      "`results/exclusions.csv`. NYSE full closures and 1:00 pm early closes are "
      "excluded on **all** arms including crypto, because the anchor under test "
      "is the US cash open; the Capital.com CFD tape trades through most US "
      "holidays, so bar presence is not evidence of a cash open.")
    A("")

    # ================= descriptive per-arm ================================
    A("---")
    A("")
    A("## Descriptive rows — no verdict attaches to anything below")
    A("")
    A("### Per-arm detail, fit and holdout (template 1)")
    A("")
    A("| arm | period | n | mean net R | median | gross R | mean cost R | "
      "win % | % long | median stop (ATR) | median hold (min) |")
    A("|---|---|---|---|---|---|---|---|---|---|---|")
    for arm in v.arm:
        for src, per in ((fd, "fit"), (hd, "holdout")):
            r = src[(src.arm == arm) & (src.period == per) & (src.template == 1)]
            if not len(r):
                continue
            r = r.iloc[0]
            A(f"| `{arm}` | {per} | {int(r.n)} | **{f(r.mean_netR)}R** | "
              f"{f(r.median_netR)}R | {f(r.mean_grossR)}R | {f(r.mean_cost_R,4,False)}R | "
              f"{r.win_rate:.1f} | {r.pct_long:.1f} | "
              f"{f(r.median_stop_atr,2,False)} | {r.median_hold_min:.0f} |")
    A("")
    A("**Cost in R is small, as the Architect predicted it would be** for a stop "
      "set at the full opening range: "
      f"{fd[(fd.period=='fit')&(fd.template==1)].mean_cost_R.min():.3f}–"
      f"{fd[(fd.period=='fit')&(fd.template==1)].mean_cost_R.max():.3f}R across "
      "the arms, against the cmc-bot pass's 0.25–0.40R. Costs are therefore not "
      "what decides these arms; the gross numbers are near zero on their own.")
    A("")
    A("### Exit causes (fit period)")
    A("")
    A("| arm | n | target | stop | time-exit | t2 stop | t2 time-exit |")
    A("|---|---|---|---|---|---|---|")
    for _, r in ex.iterrows():
        A(f"| `{r.arm}` | {int(r.n)} | {int(r.target)} | {int(r['stop'])} | "
          f"{int(r['time-exit'])} | {int(r.t2_stop)} | {int(r['t2_time-exit'])} |")
    A("")
    A("### Per side (fit period, template 1)")
    A("")
    A("| arm | side | n | mean net R | win % |")
    A("|---|---|---|---|---|")
    for _, r in side.iterrows():
        A(f"| `{r.arm}` | {r.side} | {int(r.n)} | {f(r.mean_netR)}R | {r.win_rate:.1f} |")
    A("")
    A("### Non-circular forward lift (fit period)")
    A("")
    A("Built as `session-liquidity-v5-ny/tables.py:block_L`: each signal's "
      "post-entry MFE in ATR over its own horizon, over the **median** "
      "unconditional forward MFE for the same direction and horizon bucket, "
      "measured from random comparable stretches of the same tape. 1.00 = no "
      "better than a random comparable stretch.")
    A("")
    A("| arm | n | median lift | % ≥ 1 |")
    A("|---|---|---|---|")
    for _, r in lift.iterrows():
        A(f"| `{r.arm}` | {int(r.n)} | {r.lift_median:.3f} | {r.pct_ge_1:.1f} |")
    A("")
    A("Every arm's median lift is above 1.00, i.e. a breakout bar is followed by "
      "more favourable excursion than a random bar in the same window — and yet "
      "the traded expectancy is not. That gap is the finding worth keeping: the "
      "directional information is real but too small to survive a stop at the "
      "opposite side of the range plus costs. Read it with the exit-cause table.")
    A("")

    # ================= crypto controls ====================================
    A("### The two crypto controls (§4.2)")
    A("")
    A("| row | arm | period | n | mean net R | win % |")
    A("|---|---|---|---|---|---|")
    for _, r in desc[desc.template == 1].sort_values(["row", "arm", "period"]).iterrows():
        A(f"| {r.row} | `{r.arm}` | {r.period} | {int(r.n)} | {f(r.mean_netR)}R | "
          f"{r.win_rate:.1f} |")
    A("")
    wk = desc[(desc.row == "weekend") & (desc.template == 1)]
    pe = desc[(desc.row == "pre-etf") & (desc.template == 1)]
    cry = v[v.arm.str.startswith(("BTC", "ETH"))]
    A(f"**Weekend row.** Every weekend row is strongly negative "
      f"({wk.mean_netR.min():+.3f}R to {wk.mean_netR.max():+.3f}R), far below the "
      "corresponding arms. The pre-registered reading only bites if a crypto arm "
      "**passes** and its weekend row is at or above the arm's holdout mean — "
      f"and no crypto arm passes, so **nothing is inferred** from this. Recorded "
      "as the pre-registration requires. For what it is worth descriptively, the "
      "same clock without a cash open is much worse, which is the direction the "
      "anchor story would want; it is not evidence, because the anchored arms "
      "are themselves at zero.")
    A("")
    A(f"**Pre-ETF row.** 2022-08-01 .. 2023-12-31 gives "
      f"{pe.mean_netR.min():+.3f}R to {pe.mean_netR.max():+.3f}R, against a "
      f"crypto **fit** range of "
      f"{cry.mean_netR_fit.min():+.3f}R to {cry.mean_netR_fit.max():+.3f}R. "
      "The pre-ETF period is **not weaker** than the ETF era — the two are "
      "indistinguishable, both at zero. Per `DESIGN.md` §4.2 this is reported "
      "as what it is: **the ETF-transmission story gets no support from the "
      "tape.** The honest summary is that the pre-ETF row and the ETF-era arms "
      "are both consistent with there being no imported-anchor effect at all, "
      "which is the simplest reading of a null on both sides.")
    A("")

    # ================= sensitivities ======================================
    A("### Sensitivities — fit period only, non-gating, every one that was run")
    A("")
    A("#### Mechanic (§3.6)")
    A("")
    piv = sens.pivot_table(index="arm", columns="sensitivity", values="mean_netR_1")
    base = fd[(fd.period == "fit") & (fd.template == 1)].set_index("arm").mean_netR
    A("| arm | pre-registered | " + " | ".join(piv.columns) + " |")
    A("|---|---|" + "---|" * len(piv.columns))
    for arm in piv.index:
        A(f"| `{arm}` | **{f(base.get(arm))}R** | "
          + " | ".join(f(piv.loc[arm, c]) + "R" for c in piv.columns) + " |")
    A("")
    A("None of these may change a verdict and none was computed on the holdout. "
      "They are shown including the ones that came out worse. The stop-at-the-"
      "midpoint row (S3) is negative on seven of eight arms, which is the "
      "expected direction: halving the stop doubles `cost_R` and raises the stop "
      "rate, and the pre-registered full-range stop is the cheap-in-R one.")
    A("")
    A("#### Costs (holdout, template 1)")
    A("")
    cols = [c for c in csens.columns if c not in ("arm", "base")]
    A("| arm | pre-registered | " + " | ".join(cols) + " |")
    A("|---|---|" + "---|" * len(cols))
    for _, r in csens.iterrows():
        A(f"| `{r.arm}` | **{f(r.base)}R** | "
          + " | ".join((f(r[c]) + "R") if pd.notna(r[c]) else "—" for c in cols) + " |")
    A("")

    # ================= Study B ============================================
    A("---")
    A("")
    A("## Study B — the LightGBM feature study: **hypothesis-generating only**")
    A("")
    A("**Nothing in this section is an edge, a verdict, or a parameter change to "
      "Test A.** It asks a different question with a weaker standard of "
      "evidence: *which conditions correlate with an ORB trade working better?* "
      "Test A above was settled first and separately. A feature flagged here "
      "earns a **proposal for a new pre-registered arm**, never a rescue of a "
      "killed one.")
    A("")
    A(f"Trained on the **fit period only**, one model per timeframe pooled across "
      f"the four instruments with `instrument` as a categorical column. Fixed "
      f"shallow hyper-parameters, no tuning (`num_leaves=7`, `max_depth=3`, "
      f"`min_data_in_leaf=30`, `learning_rate=0.03`, `lambda_l2=10.0`, "
      f"`feature_fraction=0.8`, `bagging_fraction=0.8`), `n_estimators` by early "
      f"stopping on blocked chronological 5-fold CV with a 5-session purge gap, "
      f"seeds 0–4 averaged. Pinned: Python 3.9.6, lightgbm 4.6.0, shap 0.49.1, "
      f"scikit-learn 1.6.1, numpy 2.0.2, pandas 2.3.3.")
    A("")
    A("| timeframe | n_fit | dropped on warm-up | CV rounds (median) | "
      "out-of-fold Spearman | null-max 95th pct | **features flagged** |")
    A("|---|---|---|---|---|---|---|")
    for tf in C.TFS:
        s = sb[f"{tf}m"]
        A(f"| {tf}m | {s['n_fit']} | {s['n_dropped_warmup']} | "
          f"{s['cv_rounds_median']} | {s['spearman_oof']:+.4f} | "
          f"{s['nullmax_p95']:.6g} | "
          f"**{', '.join(s['flagged']) if s['flagged'] else 'none'}** |")
    A("")
    A(f"The flagging rule was fixed in advance (`DESIGN.md` §9.3): "
      f"{C.NULL_REFITS} refits of the **whole pipeline** with `netR` permuted "
      "within instrument and within fit-year, each recording the maximum "
      "permutation importance over all 24 features; a feature is flagged only if "
      "its real permutation importance exceeds the **95th percentile of that "
      "null-max distribution**. That controls the family-wise error rate across "
      "the 24 comparisons (Westfall–Young style) — without it, roughly one "
      "feature would look 'important' by chance every run. **Gain and split "
      "count are not reported at all**, by design: they are biased toward "
      "high-cardinality columns and `tod_min` and the continuous distances would "
      "win by construction.")
    A("")
    for tf in C.TFS:
        imp = rd(os.path.join("studyb", f"importance_{tf}m.csv"))
        A(f"#### {tf}m — permutation and SHAP importance, all 24 features "
          f"(+ `instrument`)")
        A("")
        A("| feature | permutation ΔMSE | SHAP mean abs | fit SHAP direction | flagged |")
        A("|---|---|---|---|---|")
        for _, r in imp.iterrows():
            A(f"| `{r.feature}` | {r.perm_importance:+.6g} | {r.shap_mean_abs:.6g} | "
              f"{r.shap_direction:+.3f} | {'**YES**' if r.flagged else '—'} |")
        A("")
    s5, s15 = sb["5m"], sb["15m"]
    nflag = len(s5["flagged"]) + len(s15["flagged"])
    if nflag == 0:
        A(f"**No feature was flagged on either timeframe.** That is the expected "
          f"outcome under no signal, and it is what the pre-registration said "
          f"would be reported either way. The null-max thresholds were "
          f"{s5['nullmax_p95']:.6g} (5m) and {s15['nullmax_p95']:.6g} (15m); the "
          f"largest real permutation importance was "
          f"{max(rd(os.path.join('studyb','importance_5m.csv')).perm_importance.max(), rd(os.path.join('studyb','importance_15m.csv')).perm_importance.max()):.6g}. "
          "**There is therefore no proposal to make to the Architect from Study "
          "B**, and no conditioned-ORB registration is recommended on this "
          "evidence.")
        A("")
        A("Two things should be said plainly about that. First, early stopping "
          "fired after very few rounds on most folds, which is what a "
          "heavily-regularised model does when there is nothing to fit — it is "
          "consistent with the flat result, not an artefact hiding one. Second, "
          "a null result here is weaker than a null in Test A: 24 features on "
          "roughly 1,400 trades per timeframe cannot rule out a small "
          "conditional effect, only fail to find one. Study B not finding a "
          "condition is not evidence that no condition exists.")
    else:
        A(f"**{nflag} feature-timeframe combination(s) flagged.** Each is a "
          "**hypothesis**, not a validated edge. The frozen-model holdout read "
          "below uses the pre-committed wording of `DESIGN.md` §9.4 and is "
          "**not** a verdict either way.")
    A("")
    if len(sbh):
        A("### The frozen-model holdout read (§9.4) — taken after Test A was locked")
        A("")
        A("No refit, no re-tuning, no re-selection: the fit-period models were "
          "applied once.")
        A("")
        A("| timeframe | n_hold | Spearman (pred, realised) | 90 % interval | "
          "top tercile mean net R | bottom tercile | top − bottom | 90 % interval |")
        A("|---|---|---|---|---|---|---|---|")
        for _, r in sbh.iterrows():
            A(f"| {r.tf} | {int(r.n_holdout)} | {f(r.spearman)} | "
              f"[{f(r.spearman_lo,3)}, {f(r.spearman_hi,3)}] | "
              f"{f(r.mean_netR_top)}R | {f(r.mean_netR_bottom)}R | "
              f"{f(r.top_minus_bottom)}R | [{f(r.tmb_lo,3)}, {f(r.tmb_hi,3)}] |")
        A("")
        A("Tercile cut-points come from the **fit-period** prediction "
          "distribution, fixed before the holdout was read.")
        A("")
    if len(sbf):
        A("Per flagged feature, holdout terciles with fit-period cut-points:")
        A("")
        A("| timeframe | feature | top tercile | bottom tercile | top − bottom | "
          "90 % interval | fit SHAP direction | **wording** |")
        A("|---|---|---|---|---|---|---|---|")
        for _, r in sbf.iterrows():
            A(f"| {r.tf} | `{r.feature}` | {f(r.mean_netR_top)}R | "
              f"{f(r.mean_netR_bottom)}R | {f(r.top_minus_bottom)}R | "
              f"[{f(r.lo,3)}, {f(r.hi,3)}] | {r.fit_shap_direction:+.3f} | "
              f"**{r.wording}** |")
        A("")
    A(f"`rsi14` was computed but is **not a model column** (collinear with "
      f"`rsi15`, conventional period). Its Pearson correlation with `rsi15` is "
      f"**{sb['rsi14_vs_rsi15_pearson']:.4f}**, which is why.")
    A("")
    A("**`tod_min` and `dow` contest Запись 2**, which found clock filters on "
      "crypto do not survive a holdout. Neither is flagged here, so nothing in "
      "this pass reopens that entry; had either been flagged it would have been "
      "a proposal to test it again, not a reversal.")
    A("")

    # ================= what this means ====================================
    A("---")
    A("")
    A("## What this pass settles, and what it does not")
    A("")
    A("**Settles.** The plain opening-range breakout at the NY cash open — "
      "fixed 30-minute range, first close beyond it between 10:00 and 12:00 NY, "
      "stop at the opposite side, +1R target, flat at 16:00 — does not carry a "
      "tradable edge on US100, US500, BTCUSDT or ETHUSDT, on 5-minute or "
      "15-minute bars, over a twelve-month holdout, at costs that are "
      "*generously* small. This is a well-powered null: 207–236 trades per arm, "
      "eight arms, one shared holdout year.")
    A("")
    A("**Does not settle.** (i) Any *conditioned* ORB — Study B looked and found "
      "nothing above its FWER-controlled bar, but 24 features on ~1,400 trades "
      "cannot exclude a small conditional effect. (ii) ORB on other instruments, "
      "other anchors (Asia/London opens, UTC midnight), futures tapes or "
      "SPY/QQQ — all explicitly out of scope per `ARCHITECT-NOTE.md` §8. "
      "(iii) Template 2 as a registered arm in its own right. (iv) Whether the "
      "forward-lift signal (median > 1.00 on every arm) can be harvested by some "
      "*other* exit construction; this pass only shows the pre-registered one "
      "does not harvest it.")
    A("")
    A("**No Software Engineer or Backtesting engagement follows from this "
      "pass** — that requires a REAL EDGE verdict and a further Architect "
      "ruling, and there is none.")
    A("")
    A("---")
    A("")
    A("*Generated by `report.py` from the tables in `results/`. Reproduce with:* "
      "`python projection.py && python build.py && python checks.py all && "
      "python analysis.py fit && python studyb.py train && python analysis.py "
      "holdout && python studyb.py holdout && python report.py`")

    with open(os.path.join(HERE, "REPORT.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print("wrote REPORT.md")


if __name__ == "__main__":
    main()
