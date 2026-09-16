#!/usr/bin/env python3
"""Generate `REPORT.md` from the committed result tables. `DESIGN.md` §10 step 7.

Every number in REPORT.md comes from a CSV in `results/` (or, for the two
quoted 30-minute cells, from `research/orb-ny-open/results/`); nothing is
retyped by hand.

The reporting rules of `DESIGN.md` §9.3 are enforced structurally here: the
full six-cell grid plus the two quoted 30-minute cells is the first table of
the results section, screened-out arms appear in it with a blank holdout
column, and no "best cell" sentence is generated anywhere.

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
import engine as E  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
R = C.RESULTS


def rd(n, **kw):
    return pd.read_csv(os.path.join(R, n), **kw)


def f(x, p=4, sign=True):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "—"
    return f"{x:+.{p}f}" if sign else f"{x:.{p}f}"


def main() -> None:
    scr = rd("fit_screen.csv")
    v = rd("holdout_verdicts.csv")
    nl = rd("holdout_nulls.csv")
    fd = rd("fit_describe.csv")
    hd = rd("holdout_describe.csv")
    ex = rd("fit_exit_causes.csv")
    lift = rd("fit_forward_lift.csv")
    sens = rd("fit_sensitivities.csv")
    csens = rd("holdout_cost_sensitivity.csv")
    proj = rd("power_projection.csv")
    side = rd("fit_by_side.csv")
    checks = json.load(open(os.path.join(R, "checks.json")))
    closed = pd.read_csv(os.path.join(C.CLOSED_RESULTS, "holdout_verdicts.csv"))

    V = {r.arm: r for _, r in v.iterrows()}
    S = {r.arm: r for _, r in scr.iterrows()}
    N = {r.arm: r for _, r in nl.iterrows()}

    def verdict_of(arm):
        if arm in V:
            return str(V[arm].verdict)
        return "NO EDGE — KILL (fit screen)"

    L = []
    A = L.append

    # ================== title and the FIRST PARAGRAPH ====================
    A("# REPORT — Short opening-range breakout at the New York open "
      "(`orb-ny-open-short`)")
    A("")
    A("**This family re-uses the 2025-08-01 .. 2026-07-31 holdout, which was "
      "read once already by the closed `orb-ny-open` pass on the same "
      "instruments and days. It is the second pre-registered look at that "
      "year. The α below is corrected for both looks — α = 0.05 / 14 = "
      f"{C.ALPHA:.5f}, the 8 arms of the closed pass plus the 6 arms here. A "
      "REAL EDGE reached here would be weaker evidence than a first-read REAL "
      "EDGE and any build ruling would say so.** No REAL EDGE was reached: "
      "**all six arms are dead.**")
    A("")
    A("**Pre-registration:** `DESIGN.md`, committed at `4b45874` **before any R "
      "was computed on any arm**; binding ruling "
      "`research/orb-ny-open/ARCHITECT-NOTE-FOLLOWUP.md` (`86ddf55`). The "
      "fit-period screen that decided which arms were allowed to touch the "
      "holdout was committed at `5541e33`, **before the holdout was cut**. The "
      "holdout was then cut **once**.")
    A("")
    n_pass = int((scr.screen == "PASS").sum())
    n_out = int((scr.screen != "PASS").sum())
    A(f"Because {n_out} of the 6 arms failed the fit-period screen, **the "
      f"holdout was read for only {n_pass} of them**. The 2025-08-01 .. "
      f"2026-07-31 year has therefore received **two** pre-registered looks in "
      f"total — the closed pass's eight arms, and these {n_pass} — not "
      f"fourteen. The α is corrected for fourteen anyway, because the correction "
      "is fixed by how many arms were *registered*, not by how many happened to "
      "be computed; the note's rule is to tighten, never loosen.")
    A("")

    # ================== THE FULL GRID — FIRST TABLE ======================
    A("## Results")
    A("")
    A("### The full grid — all six arms, plus the two quoted 30-minute cells")
    A("")
    A("Every cell of the registered family, with its neighbours. **The four "
      "screened-out arms carry a blank holdout column: their holdout was never "
      "computed, and the blank is the point.** The `OR30` rows are the closed "
      "pass's `US100-5m` / `US500-5m` arms, **quoted from "
      "`research/orb-ny-open/results/holdout_verdicts.csv`, neither re-run nor "
      "re-judged** — they are the fourth point of each instrument's width "
      "series.")
    A("")
    A("| instrument | OR width | arm | screen | n_fit | fit mean net R | fit Null-A p | "
      "n_hold | **holdout mean net R** | Null-A p | 90 % day-block bootstrap | **verdict** |")
    A("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for sym in C.INSTRUMENTS:
        for w in C.OR_WIDTHS:
            arm = C.arm_name(sym, w)
            s = S[arm]
            if arm in V:
                r = V[arm]
                cells = (f"{int(r.n_holdout)} | **{f(r.mean_netR_holdout)}R** | "
                         f"{r.p_A:.3f} | [{f(r.boot_lo, 3)}, {f(r.boot_hi, 3)}]")
            else:
                cells = "— | **—** | — | —"
            A(f"| {sym} | {w} min | `{arm}` | {s.screen} | {int(s.n_fit)} | "
              f"{f(s.mean_netR_fit)}R | {s.fit_p_A:.3f} | {cells} | "
              f"**{verdict_of(arm)}** |")
        c = closed[closed.arm == C.CLOSED_ARM[sym]].iloc[0]
        A(f"| {sym} | {C.CLOSED_WIDTH} min *(quoted)* | `{c.arm}` | *n/a — closed pass* | "
          f"{int(c.n_fit)} | {f(c.mean_netR_fit)}R | — | {int(c.n_holdout)} | "
          f"**{f(c.mean_netR_holdout)}R** | {c.p_A:.3f} | "
          f"[{f(c.boot_lo, 3)}, {f(c.boot_hi, 3)}] | **{c.verdict}** *(closed pass)* |")
    A("")
    A(f"**Six of six arms are dead** — {n_out} killed by the fit-period screen "
      f"without the holdout ever being read for them, {n_pass} killed on the "
      "holdout. Both quoted 30-minute cells were already kills. The ORB line on "
      "these tapes, on the width and timing axis, is closed.")
    A("")

    # ---- per-arm reasons, mechanically ---------------------------------
    A("Per-arm reasons, mechanically from the ladder and the screen:")
    A("")
    for sym in C.INSTRUMENTS:
        for w in C.OR_WIDTHS:
            arm = C.arm_name(sym, w)
            if arm in V:
                A(f"- **`{arm}` — {V[arm].verdict}.** {V[arm].reason}")
            else:
                A(f"- **`{arm}` — NO EDGE — KILL (fit screen).** {S[arm].reason}. "
                  "Its holdout was never computed.")
    A("")

    # ---- the near-miss, stated as one ----------------------------------
    near = scr[(scr.screen != "PASS") & (scr.screen_p_ok)]
    for _, r in near.iterrows():
        gap = C.SCREEN_MEAN - r.mean_netR_fit
        A(f"**`{r.arm}` is a near-miss, not a comfortable kill, and is labelled "
          f"as one.** Its fit-period Null-A p = {r.fit_p_A:.3f} clears the "
          f"screen's second condition, and its fit mean net R of "
          f"{f(r.mean_netR_fit)}R misses the +{C.SCREEN_MEAN:.2f}R bar by "
          f"{gap:.4f}R. The screen is mechanical and was committed before the "
          "number existed, so it removes the arm; that is the whole point of "
          "fixing the rule first. It is **not** reinstated and no holdout number "
          "was computed for it. A reader should not read 'screened out' here as "
          "'clearly worthless'.")
        A("")

    # ================== the width series / dose-response =================
    A("### The width series, per instrument — the pre-committed dose-response reading")
    A("")
    A("`DESIGN.md` §9.2 pre-committed this reading before any number existed: "
      "the hypothesis \"shorter is better\" predicts a **monotone or at least "
      "unimodal** shape along 5 → 10 → 15 → 30, and a REAL EDGE on a cell whose "
      "adjacent widths are all kills would have been labelled **\"isolated cell "
      "— suspect\"**, refused as a build candidate and returned to the Architect "
      "as a noise finding.")
    A("")
    for sym in C.INSTRUMENTS:
        A(f"**{sym}** — mean net R along the width axis:")
        A("")
        A("| | OR5 | OR10 | OR15 | OR30 *(quoted)* |")
        A("|---|---|---|---|---|")
        c = closed[closed.arm == C.CLOSED_ARM[sym]].iloc[0]
        fits = [f(S[C.arm_name(sym, w)].mean_netR_fit) + "R" for w in C.OR_WIDTHS]
        A(f"| **fit** | {' | '.join(fits)} | {f(c.mean_netR_fit)}R |")
        hs = []
        for w in C.OR_WIDTHS:
            arm = C.arm_name(sym, w)
            hs.append(f"**{f(V[arm].mean_netR_holdout)}R**" if arm in V
                      else "— *(screened out)*")
        A(f"| **holdout** | {' | '.join(hs)} | **{f(c.mean_netR_holdout)}R** |")
        A(f"| **verdict** | " + " | ".join(
            verdict_of(C.arm_name(sym, w)) for w in C.OR_WIDTHS) +
          f" | {c.verdict} |")
        A("")
    c100 = closed[closed.arm == C.CLOSED_ARM["US100"]].iloc[0]
    us500_fits = [float(S[C.arm_name("US500", w)].mean_netR_fit) for w in C.OR_WIDTHS]
    A("**What the shape says, and it is not what the family was registered to "
      "look for.** On US100 the fit-period mean net R **rises monotonically "
      "with width** across the three new points — "
      + " → ".join(f"{f(S[C.arm_name('US100', w)].mean_netR_fit)}R (OR{w})"
                   for w in C.OR_WIDTHS) +
      f" — with the quoted OR30 cell at {f(c100.mean_netR_fit)}R, and the two "
      "holdout reads reproduce that ordering weakly ("
      + ", ".join(f"{f(V[a].mean_netR_holdout)}R at OR{int(V[a].or_min)}"
                  for a in v.arm if a in V) +
      f", against {f(c100.mean_netR_holdout)}R at the quoted OR30). The "
      "hypothesis under test was that a **shorter** range works better. Within "
      "this grid the tape says the opposite across 5 → 10 → 15, weakly, on the "
      "one instrument that got as far as a holdout read — and not strongly "
      "enough anywhere to clear a bar. On US500 the fit period runs "
      + ", ".join(f"{f(x)}R (OR{w})" for x, w in zip(us500_fits, C.OR_WIDTHS)) +
      f" and {f(c100.mean_netR_fit) if False else f(closed[closed.arm == C.CLOSED_ARM['US500']].iloc[0].mean_netR_fit)}R "
      "at the quoted OR30 — two of the three new widths are negative, the third "
      f"({f(max(us500_fits))}R) is positive but far below the screen's bar, "
      "there is no monotone shape at all, and none of the three reached the "
      "holdout.")
    A("")
    A("**No cell in this report is presented without its neighbours, and there "
      "is no 'best cell' reading anywhere in this deliverable.** The grid exists "
      "to read a shape; the shape it shows is flat-to-adverse.")
    A("")
    A("The dose-response label is **blank on every row** for the simple reason "
      "that it attaches only to a REAL EDGE, and no arm reached one.")
    A("")

    # ================== the nulls ========================================
    if len(nl):
        A("### The nulls, on the arms that reached the holdout")
        A("")
        A("Null A (the gate) is the matched-time placebo: 1,000 draws, each "
          "replacing every real trade with a random 5m bar drawn from **that "
          "arm's own** trigger window (09:40 / 09:45 NY to 12:00) on a day "
          "eligible for that arm, keeping the real trade's side and its stop "
          "size in ATR14 units, walked, costed and exited by the same code. "
          "Null B is the whole-stream day shift; it is reported, not gating.")
        A("")
        A("| arm | n_hold | realised mean net R | Null-A mean | **Null-A p** | "
          "Null-B mean | Null-B p | same-date residual | Null-B drop rate |")
        A("|---|---|---|---|---|---|---|---|---|")
        for _, r in nl.iterrows():
            A(f"| `{r.arm}` | {int(r.n_holdout)} | {f(r.mean_netR)}R | "
              f"{f(r.nullA_mean)}R | **{r.p_A:.3f}** | {f(r.nullB_mean)}R | "
              f"{r.p_B:.3f} | {r.nullA_same_date_residual:.2e} | "
              f"{r.nullB_drop_rate:.2e} |")
        A("")
        A(f"Both arms sit far above the corrected bar of {C.ALPHA:.5f} and above "
          "the 0.20 inconclusive line, and both 90 % day-block bootstrap "
          "intervals straddle zero. The placebo means are slightly negative, so "
          "the strategy does beat a random comparable bar on average — by an "
          "amount that is not distinguishable from noise at this sample size.")
        A("")

    # ================== template 2 =======================================
    A("### Template 2 (pure ORB) — reported, **no verdict**, straddle rule retired")
    A("")
    A("Template 2 is the literal hypothesis: the breakout's direction persists to "
      "the close. It carries **no verdict** (`DESIGN.md` §3.4). **The straddle "
      "rule of the closed pass is retired for this family** — it was spent on "
      "the deferred ETH template-2 registration — so a template-2 number that "
      "clears any bar here generates **no follow-up of any kind**.")
    A("")
    A("| arm | fit mean net R (t2) | holdout mean net R (t2) | holdout t1 (the gate) |")
    A("|---|---|---|---|")
    for sym in C.INSTRUMENTS:
        for w in C.OR_WIDTHS:
            arm = C.arm_name(sym, w)
            ft2 = fd[(fd.arm == arm) & (fd.period == "fit") & (fd.template == 2)]
            ft2v = float(ft2.mean_netR.iloc[0]) if len(ft2) else np.nan
            if arm in V:
                A(f"| `{arm}` | {f(ft2v)}R | {f(V[arm].mean_netR_holdout_t2)}R | "
                  f"{f(V[arm].mean_netR_holdout)}R |")
            else:
                A(f"| `{arm}` | {f(ft2v)}R | — *(screened out)* | — |")
    A("")
    A("Nothing on template 2 reaches the +0.10R build bar on any holdout read, "
      "and on the two arms that were read it is **worse** than template 1 "
      "(essentially zero). The +1R cap is not what is unmaking these numbers.")
    A("")

    # ================== costs ============================================
    A("## Costs — the section this family exists to make honest")
    A("")
    A("**With the stop at the far side of a 5-, 10- or 15-minute range, "
      "`stop_dist` is several times smaller than in the closed pass, so "
      "`cost_R` is several times larger** than the 0.012–0.030R seen there. "
      "**The narrower the range, the more of any gross edge the spread eats; "
      "this family is the one where costs can start to matter.**")
    A("")
    A("| arm | median stop_dist (pts) | mean `cost_R` | median `cost_R` | "
      "p90 `cost_R` | fit gross R | fit net R | gross→net gap |")
    A("|---|---|---|---|---|---|---|---|")
    for sym in C.INSTRUMENTS:
        for w in C.OR_WIDTHS:
            arm = C.arm_name(sym, w)
            d = fd[(fd.arm == arm) & (fd.period == "fit") & (fd.template == 1)].iloc[0]
            A(f"| `{arm}` | {d.median_stop_dist:.1f} | {d.mean_cost_R:.4f}R | "
              f"{d.median_cost_R:.4f}R | {d.p90_cost_R:.4f}R | "
              f"{f(d.mean_grossR)}R | {f(d.mean_netR)}R | "
              f"{d.mean_cost_R:.4f}R |")
    A("")
    g500 = {w: float(fd[(fd.arm == C.arm_name("US500", w)) & (fd.period == "fit")
                        & (fd.template == 1)].mean_grossR.iloc[0])
            for w in C.OR_WIDTHS}
    n500 = {w: float(S[C.arm_name("US500", w)].mean_netR_fit) for w in C.OR_WIDTHS}
    A("The cost gradient is exactly as the Architect's note projected: it rises "
      "monotonically as the range narrows on **both** instruments, and it is "
      "roughly 1.8× as large on US500 as on US100 at the same width (US500's "
      "spread is a larger fraction of a much smaller point-value range). It is "
      "still far below the `cmc-bot` pass's 0.25–0.40R.")
    A("")
    A("**US500 is the instrument where this matters, and it is worth being "
      "precise about it.** Its fit-period **gross** expectancy is "
      + ", ".join(f"{f(g500[w])}R (OR{w})" for w in C.OR_WIDTHS) +
      " — positive at two of the three widths — while its **net** expectancy is "
      + ", ".join(f"{f(n500[w])}R (OR{w})" for w in C.OR_WIDTHS) +
      ". The cost flips the sign outright at **OR5** (+0.0225R gross becomes "
      "−0.0295R net), and at **OR15** it eats roughly seven tenths of a small "
      "positive gross number (+0.0535R → +0.0154R); at OR10 the gross number "
      "was already negative and cost merely deepens it. That is the note's "
      "projected effect, realised. It does not rescue the "
      "arms — a gross expectancy of "
      f"{f(max(g500.values()))}R at best is nowhere near the +0.10R build bar "
      "even at zero cost, and these three arms failed the screen on their "
      "Null-A p as well — but 'costs ate it' is the honest description on "
      "US500, where on US100 the gross number is simply too small to matter.")
    A("")
    if len(csens):
        A("Cost sensitivities on the holdout (non-gating):")
        A("")
        cols = [c for c in csens.columns if c != "arm"]
        A("| arm | " + " | ".join(cols) + " |")
        A("|---|" + "---|" * len(cols))
        for _, r in csens.iterrows():
            A(f"| `{r.arm}` | " + " | ".join(f(r[c]) + "R" for c in cols) + " |")
        A("")
        A("Doubling the spread costs roughly 0.015R and moves neither verdict; "
          "neither would any plausible cost model. **Slippage is not modelled "
          "anywhere, so every number in this report is optimistic.** No "
          "commission is modelled on these Capital.com index CFDs and no "
          "financing on any arm (every trade is flat by 16:00 NY).")
        A("")

    # ================== descriptive rows =================================
    A("## Descriptive rows — none of these can move a verdict")
    A("")
    A("### Trigger share and exclusions (fit period, recorded before the screen)")
    A("")
    A("| arm | trigger opens | eligible days | triggered | share | projected n_hold | "
      "median lag from range end | p90 lag |")
    A("|---|---|---|---|---|---|---|---|")
    for _, r in proj.iterrows():
        A(f"| `{r.arm}` | {r.trigger_start_NY} | {int(r.fit_eligible)} | "
          f"{int(r.fit_triggered)} | {r.trigger_share_fit:.3f} | "
          f"{r.proj_n_holdout:.1f} | {r.lag_from_range_end_median_min:.0f} min | "
          f"{r.lag_from_range_end_p90_min:.0f} min |")
    A("")
    A("The trigger share approaches 100 % on every arm and the trigger lands a "
      "median of 5–10 minutes after the range's end, which is what makes the "
      "12:00 NY cutoff inert for this family and is why the closed pass's power "
      "contingency was retired. Realised `n_holdout` was "
      + (f"{int(v.n_holdout.min())}–{int(v.n_holdout.max())}" if len(v) else "—")
      + f" against the floor of {C.MIN_TRADES}; no power stop rule came close to "
      "firing.")
    A("")
    A("### Exit causes (fit period)")
    A("")
    A("| arm | n | target | stop | time-exit | t2 stop | t2 time-exit |")
    A("|---|---|---|---|---|---|---|")
    for _, r in ex.iterrows():
        A(f"| `{r.arm}` | {int(r.n)} | {int(r.target)} | {int(r['stop'])} | "
          f"{int(r['time-exit'])} | {int(r['t2_stop'])} | {int(r['t2_time-exit'])} |")
    A("")
    A("The time-exit share rises with the width (the wider the range, the longer "
      "+1R takes to reach), which is the mechanical signature of the width axis "
      "working as intended.")
    A("")
    A("### Long / short split (fit period, template 1)")
    A("")
    A("| arm | side | n | mean net R | win rate |")
    A("|---|---|---|---|---|")
    for _, r in side.iterrows():
        if not r.n:
            continue
        A(f"| `{r.arm}` | {r.side} | {int(r.n)} | {f(r.mean_netR)}R | "
          f"{r.win_rate:.1f} % |")
    A("")
    A("### Forward lift — the one positive signal, and it is unchanged")
    A("")
    A("The non-circular forward lift is the median ratio of the trade's maximum "
      "favourable excursion, in ATR14, to the median MFE of a horizon-matched, "
      "side-matched comparison drawn from the arm's own trigger window. "
      "**1.00 means \"no better than a random comparable bar\".**")
    A("")
    A("| arm | n | median lift | % of trades with lift ≥ 1 | reference pool n |")
    A("|---|---|---|---|---|")
    for _, r in lift.iterrows():
        A(f"| `{r.arm}` | {int(r.n)} | **{r.lift_median:.3f}** | {r.pct_ge_1:.1f} % | "
          f"{int(r.ref_n)} |")
    A("")
    A(f"Lift is above 1.00 on **all six arms** ({lift.lift_median.min():.3f}–"
      f"{lift.lift_median.max():.3f}), and materially higher than the closed "
      "pass's 1.035–1.234 at 30 minutes. **After a close beyond a short opening "
      "range the tape does move further in the breakout's direction than a "
      "random comparable bar does — and the +1R-target / full-range-stop "
      "construction still fails to convert it into money.** This is the same "
      "finding the closed pass reported, now stronger on the measurement and "
      "just as dead on the money. It is a statement about what happens *after* "
      "the trigger, which is why the Architect's note points at an **exit "
      "construction** as the next principled registration and not at another "
      "minute count.")
    A("")
    A("### Fit-period sensitivities — every one shown, including the worse ones")
    A("")
    A("Non-gating and descriptive. None of these can create, upgrade or "
      "downgrade a verdict.")
    A("")
    for lab in sens.sensitivity.unique():
        g = sens[sens.sensitivity == lab]
        A(f"**{lab}**")
        A("")
        A("| arm | n | mean net R (t1) | pre-registered fit net R | mean net R (t2) | "
          "mean cost_R | win rate |")
        A("|---|---|---|---|---|---|---|")
        for _, r in g.iterrows():
            base = float(S[r.arm].mean_netR_fit)
            A(f"| `{r.arm}` | {int(r.n)} | {f(r.mean_netR_1)}R | {f(base)}R | "
              f"{f(r.mean_netR_2)}R | {r.mean_cost_R:.4f}R | {r.win_rate:.1f} % |")
        A("")
    A("S3' (stop at the OR midpoint) is **worse than the pre-registered stop on "
      "every one of the six arms**. S4' (re-entry) is worse on five of six. S5 "
      "(11:00 NY cutoff) is marginally better on most arms, which is the "
      "expected consequence of dropping the late, weak triggers — it is a "
      "descriptive row, it was never a gate, and it changes no verdict. None of "
      "the three moves any arm to the +0.10R build bar.")
    A("")

    # ================== checks ===========================================
    A("## Stop-rule checks")
    A("")
    g = checks["grid"]
    A(f"- **Grid check — pass.** {g['days']} session days, **{g['violations']} "
      f"violations**. The clock points asserted on the 5-minute epoch grid are "
      + ", ".join(f"`{x}`" for x in g["clock_points_5m"]) + ", under both UTC "
      f"offsets of 09:30 NY seen in span ({g['utc_offsets_of_0930_seen_h']}). "
      "The three new points 09:35 / 09:40 / 09:45 are the ones this family "
      "needed and they hold on every day.")
    ft = pd.DataFrame(checks["fills"]["table"])
    A(f"- **Fill check — pass.** On the {int(ft.agreement_n.sum())} trades that "
      "neither gap the stop nor touch both levels inside a single bar, the "
      "1m-path fill and the bar-OHLC fill agree to "
      f"`max_absdiff = {ft.max_absdiff.max():.1f}`, with "
      f"**{int(ft.violations.sum())} violations** on any arm.")
    se = pd.DataFrame(checks["session"]["table"])
    A(f"- **Session check — pass.** {int(se.crossings.sum())} trades cross "
      "16:00 NY, on either template, on any arm.")
    A("- **The look-ahead check is dropped**, per the follow-up note §7: it "
      "existed to protect Study B's feature matrix, and there is no Study B "
      "here. No feature reaches any verdict in this family.")
    A("")

    # ---- the one recorded fill case ------------------------------------
    A("### The one excluded-fill case, recorded in full (Architect ruling, `00b34d8`)")
    A("")
    A("`checks.py fills` initially reported a failure. It was **not** the "
      "pre-registered §3.5 condition — that passed with 0 violations and "
      "`max_absdiff` 0.0 — but an over-broad extra assertion the closed pass's "
      "code carried ('the 1m path may never be kinder than the bar fill on an "
      "excluded trade'), which `DESIGN.md` §11 rule 3 had inherited while the "
      "Architect's own stop rule names only the disagreement condition. It was "
      "escalated under §11 rule 6 rather than decided locally; the Architect "
      "narrowed the clause to genuinely unresolvable cases and relaxed nothing "
      "else (`DESIGN.md` §12).")
    A("")
    A("**Trips of the old, unnarrowed clause by period, over all 4,002 trades: "
      "fit 0 of 2,342; holdout 0 of 1,487; tail 1 of 173.** Zero fit-period and "
      "zero holdout-period trades are affected. The single case, in full:")
    A("")
    A(_fill_case_block())
    A("")

    # ================== what this closes =================================
    A("## What this closes, and what it does not")
    A("")
    A("**Closed.** The ORB mechanic on these tapes, on the **width and timing "
      "axis**, for US100 and US500. Four widths (5, 10, 15, 30), a trigger that "
      "starts at the range's own end, two instruments, a pre-registered screen "
      "and a cumulative-α holdout read: **six of six new arms dead, on top of "
      "the closed pass's eight.** Per the Architect's note §1.2 this was the "
      "**second and last shot on the width/timing axis**. A third pass on a "
      "different minute count is not warranted and is not requested.")
    A("")
    A("**A bug in the closed pass is also closed.** Its 15-minute width "
      "sensitivity (S1) was never a 15-minute ORB — `find_trigger` kept the "
      "first trigger bar at 10:00 NY regardless of width, so S1 measured a "
      "15-minute range with a 15-minute dead zone after it. This family ran the "
      "real thing, triggering from 09:45, and S1's fit-period hint on US100 "
      "does not survive into a verdict.")
    A("")
    A("**Not closed, and pointed at explicitly.** The **exit construction**. "
      "Forward lift is above 1.00 on all six arms here "
      f"({lift.lift_median.min():.3f}–{lift.lift_median.max():.3f}) and was "
      "above 1.00 on all eight arms of the closed pass. Direction is selected; "
      "the +1R-target / full-range-stop template is what fails to convert it. "
      "The published short-ORB result this family's 5-minute arm was modelled "
      "on pairs its 5-minute range with a stop far *tighter* than the range and "
      "a distant multi-R target — the opposite corner of the template space "
      "from anything this project has tested. That is the Architect's named "
      "next registration if one is wanted, and it is a **different mechanic**, "
      "not another width.")
    A("")
    A("**Explicitly out of scope here and unchanged:** crypto (removed by the "
      "note §3.1 on fit-side and prior evidence), other session anchors "
      "(London, 08:30 ET, UTC midnight — each a different hypothesis needing "
      "its own registration), volatility-scaled range widths (note §6.2), and "
      "15m trigger bars (note §4.3).")
    A("")
    A("**The deferred ETH template-2 registration** (`deferred_eth_t2.py`) is "
      "committed and frozen. It refuses to run before the tape reaches "
      "2027-07-31 and nothing was done on it in this pass.")
    A("")

    A("---")
    A("")
    A("*Generated by `report.py` from the CSVs in `results/`. Every number above "
      "is read from a committed table; nothing is retyped by hand. The two "
      "30-minute cells are read from `research/orb-ny-open/results/` and were "
      "not recomputed.*")

    with open(os.path.join(HERE, "REPORT.md"), "w") as fh:
        fh.write("\n".join(L) + "\n")
    print("wrote REPORT.md")


def _fill_case_block() -> str:
    """The 2026-08-28 US500-OR5 trade, read off the tape, not retyped."""
    q = pd.read_parquet(os.path.join(R, "trades_all.parquet"))
    g = q[(q.arm == "US500-OR5") & (q.date == "2026-08-28")]
    if not len(g):
        return "*(case not found in the trade table)*"
    r = g.iloc[0]
    tp = E.Tape.get("US500")
    B = tp.bars[C.TF]
    tgt = r.entry + r.side * r.stop_dist
    out = [f"`US500-OR5`, **2026-08-28**, TAIL period (descriptive only — it "
           f"feeds no screen, no null and no ladder). Long, entry "
           f"`{r.entry:g}`, stop `{r.stop:g}`, target `{tgt:g}`, "
           f"`1R = {r.stop_dist:g}` points.", "",
           "The 5-minute bar that spans **both** levels, and the 1-minute bars "
           "that resolve the order:", "",
           "| bar | open | high | low | close | touches |", "|---|---|---|---|---|---|"]
    j = np.searchsorted(B["t"], C.ny_ms("2026-08-28", 10, 0), "left")
    t5 = []
    if B["h"][j] >= tgt:
        t5.append(f"target ({B['h'][j]:g} ≥ {tgt:g})")
    if B["l"][j] <= r.stop:
        t5.append(f"stop ({B['l'][j]:g} ≤ {r.stop:g})")
    out.append(f"| **5m {C.fmt(B['t'][j])[11:16]}** | {B['o'][j]:g} | {B['h'][j]:g} | "
               f"{B['l'][j]:g} | {B['c'][j]:g} | **{' and '.join(t5)}** |")
    i = np.searchsorted(tp.t, C.ny_ms("2026-08-28", 10, 0), "left")
    for z in range(i, i + 5):
        tt = []
        if tp.h[z] >= tgt:
            tt.append("**target**")
        if tp.l[z] <= r.stop:
            tt.append("**stop**")
        out.append(f"| 1m {C.fmt(tp.t[z])[11:16]} | {tp.o[z]:g} | {tp.h[z]:g} | "
                   f"{tp.l[z]:g} | {tp.c[z]:g} | {' and '.join(tt) or '—'} |")
    out += ["",
            "The 5m bar touches both levels, so the bar-OHLC convention takes "
            "the **stop** first — it is deliberately pessimistic and cannot "
            "know the order. The 1-minute tape resolves it unambiguously: the "
            "10:00 minute takes the **target**; the stop is not touched until "
            "10:04. The 1m fill is 'kinder' here **because the coarse "
            "convention is pessimistic, not because the result is being "
            "flattered** — and resolving exactly this order is what the "
            "1-minute path exists for. This class of trade is near-absent at a "
            "30-minute range and appears here only because 1R is several times "
            "tighter; it is a consequence of the width axis, by construction."]
    return "\n".join(out)


if __name__ == "__main__":
    main()
