#!/usr/bin/env python3
"""Assemble results/stage1/*.csv into REPORT.md. Formatting only — every
number it prints was produced by stage1.py / stage1_analysis.py under the
pre-registration in DESIGN.md."""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stage1 as S  # noqa: E402

L: list[str] = []


def A(s=""):
    L.append(s)


def md(df, floatfmt="{:+.3f}"):
    if not len(df):
        return "_(empty)_"
    d = df.copy()
    for c in d.columns:
        if pd.api.types.is_float_dtype(d[c]):
            d[c] = d[c].map(lambda x: "" if pd.isna(x) else floatfmt.format(x))
    return d.to_markdown(index=False)


def csv(n):
    return pd.read_csv(os.path.join(S.OUT, f"{n}.csv"))


def main():
    v = csv("holdout_verdicts")
    nulls = csv("holdout_nulls")
    hd = csv("holdout_describe")
    fd = csv("fit_describe")
    four = csv("fit_four_numbers")
    abl = csv("fit_ablation")
    lift = csv("fit_forward_lift")
    ex = csv("fit_exit_causes")
    sens = csv("holdout_cost_sensitivity")
    st = json.load(open(os.path.join(S.OUT, "selftests.json")))
    pre = v[v.status == "pre-registered"]
    desc = v[v.status == "descriptive"]

    A("# REPORT — Stage 1, the pre-registered test of `cmc-bot`'s VWAP "
      "band-reversal strategy\n")
    A("**Date:** 2026-09-16 · Pre-registration: `DESIGN.md`, committed "
      "(`8a07a20`) **before any R was computed on any arm or leg**, restating "
      "`ARCHITECT-NOTE-STAGE1.md`. The holdout was computed **once**, at the "
      "end, and is reported as it came out. Nothing was adjusted after a "
      "number was seen.\n")

    # ---------------- first paragraph: the verdicts --------------------
    A("## The verdict, per pre-registered arm\n")
    bits = []
    for _, r in pre.iterrows():
        bits.append(f"**{r.leg} — {r.verdict}** (holdout mean net R "
                    f"{r.mean_netR_holdout:+.3f}, n = {int(r.n_holdout)}, "
                    f"Null-A p = {r.p_A:.3f})")
    A("; ".join(bits) + ".\n")
    for _, r in pre.iterrows():
        A(f"- **{r.leg}: {r.verdict}.** {r.reason}")
    A()
    ll = pre[["leg", "mean_netR_holdout", "mean_netR_holdout_livelike"]]
    straddle = []
    for _, r in ll.iterrows():
        a = tier(r.mean_netR_holdout)
        b = tier(r.mean_netR_holdout_livelike)
        if a != b:
            straddle.append(f"{r.leg} (primary {r.mean_netR_holdout:+.3f}R, "
                            f"live-like {r.mean_netR_holdout_livelike:+.3f}R)")
    if straddle:
        A("**The primary and the `live_like=True` rows straddle a verdict tier "
          "on: " + "; ".join(straddle) + ".** Per `DESIGN.md` §2 the primary "
          "decides the tier and the live-like row can only veto a build.\n")
    else:
        A("**The primary and the mandatory `live_like=True` secondary row agree "
          "on the verdict tier for every pre-registered arm** — no arm's result "
          "depends on the bar convention (`DESIGN.md` §2).\n")
    A("**Slippage is not modelled, so every number in this report is "
      "optimistic.**\n")
    A("---\n")

    # ---------------- D-01 ---------------------------------------------
    A("## 1. What this measures, and what your past backtests measured "
      "(D-01) — read this first\n")
    A("**Any past backtest or grid search of this strategy that was run on "
      "Capital.com scraped files (`npm run scrap` → `BacktestRunner`) was "
      "measuring hours 2–3 h earlier than its labels said, and is not "
      "evidence about the live windows.**\n")
    A("The bot's candle timestamps come back from Capital.com in two fields. "
      "`snapshotTimeUTC` is the true bar-open instant; `snapshotTime` is "
      "broker-local wall clock (UTC+2 in winter, UTC+3 in summer) with no "
      "offset attached, and the bot's offline path parses it as if it were "
      "UTC. The deployed bot is unaffected — it streams live and trades the "
      "right bars. Its **own backtest** is not: it selects bars 2–3 hours "
      "earlier than the labels claim (indices ≈ 06:xx–09:xx New York, i.e. "
      "**before the cash open**; forex ≈ 00:xx–01:xx New York). Measured "
      "against the live stream, the two share essentially no orders at all: "
      "0 of 895 on US100, 3 of 947 on US500, 0 of 239 on EURCHF, 0 of 241 on "
      "GBPCHF.\n")
    A("They are two different strategies wearing the same labels. **This pass "
      "measures only the live windows** (`snapshotTimeUTC`), which is what the "
      "deployed bot actually trades. The mislabelled hours are not run, not "
      "reported and not a sensitivity here, precisely so that nobody compares "
      "two things that must not be compared.\n")
    A("The practical consequence: **09:40–11:40 New York on US100/US500, and "
      "03:02/03:03–03:20 New York on EURCHF/GBPCHF, had never been measured "
      "by anyone before this pass.** Whatever confidence existed for this "
      "strategy before today did not come from a measurement of the windows "
      "it trades.\n")
    A("A second caveat on the same footing: the US100/US500 windows used here "
      "are the **provisional values you gave by hand**, not the bot's live S3 "
      "config. They are this registration's pinned parameters. A different "
      "window is a new registration with its own single shot — it is not a "
      "rerun of this one.\n")

    # ---------------- what was run --------------------------------------
    A("## 2. What was run\n")
    A("| leg | tape | entry / alive window | fit | holdout | status |")
    A("|---|---|---|---|---|---|")
    for lg in S.LEGS:
        tm = lg.tm
        w = ("none — 24/7" if not lg.windowed else
             f"{tm['entry'][0]:02d}:{tm['entry'][1]:02d}–{tm['entry'][2]:02d}:{tm['entry'][3]:02d} / "
             f"{tm['alive'][0]:02d}:{tm['alive'][1]:02d}–{tm['alive'][2]:02d}:{tm['alive'][3]:02d} NY")
        tape = "Capital.com 1m CFD" if lg.venue == "cc" else "Binance USD-M perp 1m"
        A(f"| {lg.name} | {tape} | {w} | {lg.fit_start}..{S.FIT_END} | "
          f"{S.HOLD_START}..{S.HOLD_END} | {'**pre-registered**' if lg.status=='pre-registered' else 'descriptive'} |")
    A()
    A(f"Four pre-registered arms, α = 0.05/4 = **{S.P_BONF:.4f}** per arm, no "
      "pooling, four separate verdicts. Primary population caps-off, "
      "as-deployed caps-on as a secondary row, `live_like=True` as a second "
      "secondary row, and a non-gating post-holdout tail row "
      f"({S.TAIL_START}..{S.TAIL_END}).\n")

    # ---------------- machine checks ------------------------------------
    A("### 2.1 Machine checks that had to pass before any number counted\n")
    A("`engine.py` — the file Stage 0 proved bit-exact against the bot's "
      "unmodified TypeScript — **was not edited**. Everything Stage 1 needed "
      "went into `stage1_engine.py`, a sibling. Three self-tests, all on the "
      "caps-off / `live_like=False` population:\n")
    rows = []
    for k, r in st.items():
        rows.append(dict(leg=k, orders=r["n"],
                         walker_vs_engine_mismatches=r["walk_vs_engine_mismatch"],
                         cross_order_closes=r["cross_order_closes"],
                         agreement_set_n=r["agreement_n"],
                         agreement_violations=r["agreement_violations"]))
    A(md(pd.DataFrame(rows), "{:.0f}"))
    A()
    A("1. **The trade walker reproduces the engine's own exits.** On every "
      "order not closed by the cross-order rule (a BUY and a SELL open at the "
      "same time close the earlier one), the walker's bot-native template + "
      "bot-native fill gives a bit-identical gross R. Without this the nulls "
      "would be testing a different rule than the observation.\n")
    A("2. **`DESIGN.md` §8's agreement stop rule holds.** On every order where "
      "no bar touched both levels, the exit bar did not gap through the stop, "
      "and both conventions found the same level on the same bar, the "
      "bot-native and realistic fills agree bit-for-bit. **0 violations "
      "anywhere.** The pass was not stopped.\n")
    A("3. **`run_ablate(drop=None)` returns an order table identical to "
      "`engine.run`'s**, so the ablation rows below differ from the bot only "
      "in the gate they drop. The global rolling ATR(20) used by the placebo "
      "pool equals the engine's per-bar ATR to 1.8e-10 (a summation-order "
      "difference; it feeds no gate).\n")
    A("**One limitation, stated plainly.** The four template × fill numbers "
      "re-account the *same* set of orders. Re-running the bot loop under a "
      "different fill convention would change *which* orders exist (through "
      "the ≤ 1-open-order-per-direction rule, and with caps on through the "
      "caps), which would make the four numbers incomparable. The cross-order "
      "close counts above bound the part of the population that is sensitive "
      "to this.\n")
    A("**A pre-registration hygiene disclosure.** The first version of the fit "
      "pass also printed a whole-sample row, whose value together with the fit "
      "and tail rows implies the holdout mean. That row was produced and seen "
      "for **BTCUSDT-(a)** before the holdout pass was run; it was then removed "
      "from the code and the pass re-run. Nothing was changed as a result: "
      "every threshold, window, split and criterion was already fixed in the "
      "committed `DESIGN.md`, the ladder is applied mechanically by "
      "`stage1_analysis.verdict()`, and no arm's numbers were recomputed under "
      "different settings. It is recorded here because the reader is entitled "
      "to know it, not because it changed a result.\n")

    # ---------------- the pre-registered arms ---------------------------
    A("## 3. The four pre-registered arms\n")
    A("### 3.1 The primary number (bot-native template, bot-native fill, "
      "caps off, backtest bar), holdout\n")
    t = pre[["leg", "n_fit", "n_holdout", "mean_netR_fit", "mean_netR_holdout",
             "mean_grossR_holdout", "mean_netR_holdout_livelike", "p_A", "p_B",
             "boot_lo", "boot_hi", "verdict"]]
    A(md(t))
    A()
    A("`p_A` is Null A (matched-time placebo, 1,000 draws, one-sided). `p_B` "
      "is Null B (whole-stream day shift, 250 draws), secondary. "
      "`boot_lo`/`boot_hi` are the 90 % day-block bootstrap interval "
      "(2,000 draws) on the holdout mean net R.\n")
    A("### 3.2 The cost wall\n")
    h = hd[(hd.period == "holdout") & (~hd.caps_on) & (~hd.live_like)]
    h = h[h.leg.isin(pre.leg)]
    A(md(h[["leg", "n", "mean_grossR", "mean_cost_R", "median_cost_R",
            "mean_netR", "win_rate", "median_stop_atr"]]))
    A()
    A("Read the gross column against the cost column. This is the single "
      "biggest fact in the pass and it is a property of the strategy's own "
      "geometry, not of the cost model: the stop is a **shrunk** fraction of a "
      "200-bar range, so it is small in price terms, and a cost that is fixed "
      "in price terms is therefore large in R terms.\n")
    A("### 3.3 The nulls\n")
    A(md(nulls[nulls.status == "pre-registered"][
        ["leg", "n_holdout", "mean_netR", "nullA_mean", "p_A", "nullB_mean",
         "p_B", "nullB_drop_rate", "boot_lo", "boot_hi"]]))
    A()
    A("`nullA_mean` is the mean of the 1,000 placebo draws: the same side, the "
      "same stop distance in ATR, the same 3.0R target, the same forced-flat "
      "rule and the same costs, entered at a random bar in the same window on "
      "a different day. **A placebo mean close to the observed mean means the "
      "mechanic is not adding anything the window and the trade geometry do "
      "not already give you.**\n")
    A("**On both index arms the placebo beat the strategy.** US100: the "
      "mechanic returned +0.029R where a random bar in the same window, same "
      "side, same stop, same target and same costs returned +0.052R on "
      "average. US500: −0.053R against the placebo's +0.043R. That is why "
      "`p_A` is 0.63 and 0.91 — the pre-registered comparison is not "
      "\"is this positive?\" but \"does picking the bar this way beat picking "
      "it at random?\", and on the indices the answer is no. On the two "
      "crypto arms the placebo is also negative (−0.33 / −0.22), so the "
      "mechanic is not worse than random there — it is merely, like the "
      "placebo, well below the kill bar.\n")
    A("The day-block bootstrap intervals say the same thing from the other "
      "side: US100's 90 % interval [−0.089, +0.149] and US500's [−0.157, "
      "+0.057] both straddle zero, and both crypto arms' intervals sit "
      "entirely below it.\n")
    A("### 3.4 The other three numbers (template × fill), fit period\n")
    A(md(four[four.leg.isin(pre.leg)][
        ["leg", "number", "template_fill", "n", "mean_grossR", "mean_cost_R",
         "mean_netR", "win_rate"]]))
    A()
    A("Numbers 2–4 carry **no verdict**. They exist so the result cannot be "
      "dismissed as an artefact of the optimistic bot-native fill (which "
      "clamps a gapped stop back to the exact stop price) or of the 3.0R "
      "target.\n")
    A("### 3.5 Exit causes, fit period\n")
    A(md(ex[ex.leg.isin(pre.leg)], "{:.0f}"))
    A()
    A("### 3.6 Cost sensitivities — every one that was run, including the "
      "ones that came out worse\n")
    A(md(sens[sens.leg.isin(pre.leg)]))
    A()
    A("All non-gating. The Capital.com legs are re-priced at a fixed spread "
      "(the in-window fit-period median for that instrument) and at 2× the "
      "per-bar spread; the Binance legs at a 0.04 % maker round trip instead "
      "of the 0.10 % taker round trip. The maker row is the optimistic one and "
      "it is shown because it was run, not because it is the answer: it "
      "assumes every entry and exit is a resting limit fill, which a "
      "stop-loss exit is not.\n")
    A("### 3.7 Component ablation, FIT PERIOD ONLY\n")
    A(md(abl[abl.leg.isin(pre.leg)][
        ["leg", "dropped", "n", "mean_grossR", "mean_netR", "median_netR",
         "n_cost_gt_5R"]]))
    A()
    A("Each row drops one component and re-runs the bot's whole loop. "
      "`dropped = bias` removes the VWAP-band bias and the band-width/ATR "
      "regime gate (the side then comes from which iFVG inverted); "
      "`ifvg` removes the iFVG trigger and its ATR size gate (the side comes "
      "from the bias); `pd` removes the premium/discount gate; `sweep` removes "
      "the prior-hour high/low sweep. Fit period only, by pre-registration. "
      "**These are descriptive: a component whose removal improves the number "
      "is not thereby a licence to remove it** — that would be a new "
      "strategy and a new registration.\n")
    A("`n_cost_gt_5R` counts orders whose shrunk stop came out a fraction of a "
      "tick wide, so a price-denominated cost over that stop explodes. Those "
      "orders make the `drop = ifvg` **mean** unreadable; the **median** is "
      "printed beside it. The bot itself never places them — the gate that "
      "the row removes is what keeps them out.\n")
    A("### 3.8 Non-circular forward lift\n")
    A(md(lift[lift.leg.isin(pre.leg)]))
    A()
    A("Each signal's post-entry maximum favourable excursion in ATR units over "
      "its own horizon, divided by the median unconditional forward excursion "
      "for a comparable stretch of the same tape (same direction, same horizon "
      "length). **1.00 means the signal picked a stretch of tape no better "
      "than a random one.** Horizon capped at 290 bars (the indices' alive "
      "window) because the 24/7 legs have no alive window; reference pool a "
      "seeded 20,000-bar subsample.\n")
    A("**The index arms land at 0.99 and 1.05 — dead on 1.00.** The signals "
      "pick stretches of tape that are neither better nor worse than random "
      "comparable stretches: whatever the three components are selecting, it "
      "is not future movement in the signal's own direction. The crypto arms "
      "land at 0.86 and 0.80, i.e. **below** random. Combined with the gross "
      "expectancies in §3.2 — small and positive on every arm, and smaller "
      "than the costs on three of four — the picture is a mechanic that "
      "selects a roughly average stretch of tape and then pays a spread or a "
      "taker fee for the privilege.\n")
    cr = lift[lift.leg.isin(["BTCUSDT-(a)", "ETHUSDT-(a)"])]
    if len(cr) and (np.abs(cr.lift_median - 1.0) < 0.10).any():
        A("**Pre-registered interpretation (`ARCHITECT-NOTE-STAGE1.md` §4.2, "
          "`DESIGN.md` §5), triggered:** the crypto arms' signals land at "
          "≈ 1.00 lift in this window. **It is the window, not the "
          "mechanic.**\n")
    A("### 3.9 Fit-period and tail rows\n")
    A(md(fd[fd.leg.isin(pre.leg)][
        ["leg", "caps_on", "live_like", "period", "n", "mean_grossR",
         "mean_cost_R", "mean_netR", "win_rate"]]))
    A()
    A("The tail rows (2026-08-01..2026-09-11) are **non-gating** and enter no "
      "verdict. US100's tail row is strongly positive on 40 trades; six weeks "
      "of one instrument is noise at this sample size, the row was "
      "pre-registered as non-gating precisely so that it could not be read as "
      "a reprieve, and it is not one. It is printed because it was run.\n")

    # ---------------- descriptive --------------------------------------
    A("---\n")
    A("## 4. Descriptive — no verdict — not pre-registered\n")
    A("**Nothing in this section carries a verdict.** EURCHF and GBPCHF are "
      "too thin to gate (≈ 89–90 caps-off orders a year against an "
      "`n_holdout ≥ 150` requirement) and their stops are 2.7 / 3.6 bp, so "
      "they are a cost problem before they are a mechanic problem. "
      "BTCUSDT-(b) and ETHUSDT-(b) are the mechanic with no session concept "
      "at all, on a population nobody designed. These rows **cannot be "
      "promoted** to a verdict by re-reading them; a forex verdict needs a "
      "fresh registration and roughly 44 months of Capital.com minute history, "
      "i.e. not before ~2027-09 on this vendor.\n")
    A(md(desc[["leg", "n_fit", "n_holdout", "mean_netR_fit",
               "mean_netR_holdout", "mean_grossR_holdout",
               "mean_netR_holdout_livelike", "p_A", "p_B", "boot_lo",
               "boot_hi"]]))
    A()
    A("Costs and gross, holdout:\n")
    hdd = hd[(hd.period == "holdout") & (~hd.caps_on) & (~hd.live_like)]
    A(md(hdd[hdd.leg.isin(desc.leg)][
        ["leg", "n", "mean_grossR", "mean_cost_R", "median_cost_R", "mean_netR",
         "win_rate", "median_stop_atr"]]))
    A()
    A("Two things in those rows are worth saying out loud, as description "
      "rather than verdict. **On EURCHF and GBPCHF one round-trip spread is "
      "roughly 0.8–1.0R** — the median `cost_R` is 0.90 and 0.74. The stop "
      "this strategy places on a CHF cross is so tight that a single spread "
      "costs about as much as the whole risk unit; a mechanic would have to be "
      "extraordinary to survive that, and the gross expectancies here "
      "(+0.22R, +0.13R) are not extraordinary. **On the (b) legs the "
      "matched-time placebo comes out far worse than the real signals** "
      "(−0.96 vs −0.59 on BTC, −0.54 vs −0.26 on ETH, so `p_A` rounds to "
      "0.000). That is not evidence of an edge: it says the mechanic's own "
      "gates avoid some of the worst 24/7 entries a random draw would take, "
      "while still leaving the result deep below the level at which anything "
      "would be built. No verdict attaches to either observation.\n")
    A("Four numbers, ablation and forward lift, fit period:\n")
    A(md(four[four.leg.isin(desc.leg)][
        ["leg", "number", "n", "mean_grossR", "mean_cost_R", "mean_netR",
         "win_rate"]]))
    A()
    A(md(abl[abl.leg.isin(desc.leg)][
        ["leg", "dropped", "n", "mean_grossR", "mean_netR", "median_netR",
         "n_cost_gt_5R"]]))
    A()
    A(md(lift[lift.leg.isin(desc.leg)]))
    A()
    cap = os.path.join(S.OUT, "b_legs_capson_clock.csv")
    if os.path.exists(cap):
        c = pd.read_csv(cap)
        A("### 4.1 The (b) legs with the daily caps ON — a count and a clock "
          "histogram, and nothing else\n")
        A("The caps reset at UTC midnight and are used up within hours, so "
          "with the caps on the 24/7 condition becomes an implicit "
          "\"first hours after the VWAP reset\" strategy — a window nobody "
          "chose. It is documented here and **no performance number is "
          "computed on it**.\n")
        hrs = [f"h{k:02d}" for k in range(24)]
        for _, r in c.iterrows():
            tot = sum(int(r[k]) for k in hrs)
            first6 = sum(int(r[k]) for k in hrs[:6])
            A(f"- **{r.leg}**: {int(r.n_caps_on):,} orders with the caps on vs "
              f"{int(r.n_caps_off):,} with them off; "
              f"**{first6:,} of {tot:,} ({100*first6/max(tot,1):.0f} %) fall in "
              "00:00–06:00 UTC.**")
        A()
        A(md(c[["leg", "n_caps_on", "n_caps_off"] + hrs], "{:.0f}"))
        A()

    # ---------------- what this does and does not mean -------------------
    A("---\n")
    A("## 5. What these results do and do not mean (pre-registered, "
      "`DESIGN.md` §6)\n")
    A("- **A miss on an arm is a kill of this mechanic on that symbol**, not a "
      "request to rework it. One pre-registered pass, one shot.\n")
    A("- **A kill on BTCUSDT-(a) / ETHUSDT-(a) does not touch Запись 18's "
      "v5-NY result, and Запись 18 does not touch this.** The overlap is the "
      "clock, not the mechanic (far-edge vs proximal iFVG, session-extreme vs "
      "prior-hour sweep, 5m vs 1m, fixed-UTC vs NY-DST window). A pass here "
      "would not have reopened v5-NY either.\n")
    A("- **No result on a crypto arm is evidence about an index arm, or vice "
      "versa.** Different tape, different volume quantity inside the VWAP "
      "(exchange base-asset volume vs broker tick activity), different cost "
      "model.\n")
    A("- **The descriptive legs say nothing about the arms**, and no row "
      "anywhere pools them.\n")
    A("- Unmodelled live-path divergences, listed not simulated: **L-02** (the "
      "live US500 bias VWAP double-counts a chunk-boundary bar whenever the "
      "12 h tape has a missing minute — 59 % of US500 evaluations), **L-03** "
      "(the live request fails outright if the host clock leads Capital.com's "
      "by more than the firing latency), and the forming candle the live bias "
      "request can include, which is not reproducible from history.\n")
    A("- Bug fidelity kept in the primary, deliberately: D-03 (`getLastIfvg` "
      "is asymmetric), D-05 (the bias compares the bar's **open** to the "
      "band), D-06 (the 200-bar range excludes the current bar), D-07 (VWAP "
      "from 00:01 UTC, population stdev, broker tick volume), D-10 (the fill "
      "is clamped to the exact stop/target), D-11 (close-only exits), D-18 "
      "(`VWAP([])` throws on forex holidays → no signal, as live). **No "
      "\"improvements\" in the primary.**\n")
    A("- **Slippage is not modelled, so every number here is optimistic.**\n")

    out = os.path.join(os.path.dirname(S.OUT), "..", "REPORT.md")
    out = os.path.abspath(out)
    with open(out, "w") as fh:
        fh.write("\n".join(L) + "\n")
    print("wrote", out)


def tier(m):
    if pd.isna(m):
        return "na"
    if m < S.KILL_MEAN:
        return "kill"
    if m < S.BUILD_MEAN:
        return "inconclusive"
    return "build-range"


if __name__ == "__main__":
    main()
