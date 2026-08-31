#!/usr/bin/env python3
"""Tables for the session-liquidity **BoS pass** — writes results/TABLES.md
plus one CSV per table.

Layout mirrors `research/session-liquidity-v4/tables.py` on purpose: the core
(T) block is the v4 format with the BoS columns swapped in, so a reader can put
the two TABLES.md side by side. Blocks:

  B  the corrected mechanic itself — can it even fire, and where is its anchor
  T  core tables, v4 format, corrected BoS
  D  corrected BoS vs PHASE-1 BoS — the re-anchoring defect, quantified
  M  corrected BoS vs iFVG-v4 — the original "which confirmation method" question
  W  window length as the primary comparative axis
  H  clock, derived and window-stratified
  A  appendix (short-window sample, full-sample rates)

Descriptive (§8): no nulls, no gates, no pass/fail.

Usage: .venv/bin/python research/session-liquidity-bos/tables.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C

SESS_ORD = ["Asia", "London", "NY"]
BLOCK_ORD = ["Asia", "London", "NY", "Late"]
MINB = C.MIN_BARS_REMAINING

REM_EDGES = [0, 12, 24, 48, 72, 10 ** 9]
REM_LBL = ["<12 (short)", "12-24", "24-48", "48-72", "72+"]

ARMS = [
    ("bos", "BoS — CORRECTED (pinned anchor, no re-anchoring)"),
    ("p1bos", "BoS — PHASE 1 (re-anchoring, the defect)"),
    ("ifvg", "iFVG — v4 (§5.1, the comparison method)"),
]

_lines: list[str] = []


def A(s: str = ""):
    _lines.append(s)


def load_events() -> pd.DataFrame:
    e = pd.concat([pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"))
                   for s in C.SYMBOLS], ignore_index=True)
    e["ts"] = pd.to_datetime(e["ts"], utc=True)
    e["primary"] = e.bars_remaining >= MINB
    e["rem_bucket"] = pd.cut(e.bars_remaining, REM_EDGES, right=False,
                             labels=REM_LBL)
    return e


def load_uncond() -> pd.DataFrame:
    u = pd.concat([pd.read_csv(os.path.join(C.RESULTS, f"uncond_{s}.csv.gz"))
                   for s in C.SYMBOLS], ignore_index=True)
    u["rem_bucket"] = pd.cut(u.bars_remaining, REM_EDGES, right=False,
                             labels=REM_LBL)
    return u


def md(df: pd.DataFrame, floatfmt="{:.2f}") -> str:
    d = df.copy()
    for c in d.columns:
        if d[c].dtype.kind == "f":
            d[c] = d[c].map(lambda v: "" if pd.isna(v) else floatfmt.format(v))
    head = "| " + " | ".join(str(c) for c in d.columns) + " |"
    sep = "|" + "---|" * len(d.columns)
    rows = ["| " + " | ".join(str(v) for v in r) + " |"
            for r in d.itertuples(index=False)]
    return "\n".join([head, sep] + rows)


def save(df: pd.DataFrame, name: str) -> pd.DataFrame:
    df.to_csv(os.path.join(C.RESULTS, name), index=False)
    return df


def arm_row(g: pd.DataFrame, pre: str, label: str, n_den: int) -> dict:
    gc = g[g[pre + "_confirmed"]]
    R = gc[pre + "_R"].dropna()
    return dict(
        algorithm=label,
        n_confirmed=len(gc),
        confirm_rate_pct=100 * len(gc) / n_den if n_den else np.nan,
        delay_median_bars=gc[pre + "_delay_bars"].median(),
        delay_p90_bars=gc[pre + "_delay_bars"].quantile(.9),
        mfe_atr_median=gc[pre + "_mfe_atr"].median(),
        mae_atr_median=gc[pre + "_mae_atr"].median(),
        stop_atr_median=gc[pre + "_stop_atr"].median(),
        R_median=R.median(),
        share_R_ge_1=100 * (R >= 1).mean() if len(R) else np.nan,
        share_R_ge_2=100 * (R >= 2).mean() if len(R) else np.nan,
        end_atr_median=gc[pre + "_end_atr"].median(),
    )


def main():
    e = load_events()
    up = load_uncond()
    p = e[e.primary].copy()
    n_all, n_p = len(e), len(p)

    A(f"_Window: {e.ts.min():%Y-%m-%d} .. {e.ts.max():%Y-%m-%d}, "
      f"{len(C.SYMBOLS)} symbols, 5m bars. **{n_all:,} take-outs** — the "
      f"unchanged v2/v4 event stream, reproduced byte-for-byte (`checks.py`) — "
      f"of which **{n_p:,} ({100*n_p/n_all:.1f}%)** are primary "
      f"(>= {MINB} bars = 1h left in the sweep block). Session levels only "
      f"(PDH/PDL out of scope). Only the CONFIRMATION layer differs from v4, "
      f"and the iFVG arm here is v4's own machine, reproduced verbatim._\n")

    # ==================================================================== B
    A("## B. The corrected mechanic — where its anchor lands, and whether it "
      "can fire at all\n")

    A("### B1. Anchor selection (DESIGN.md §1 pins 1, 2, 4)\n")
    rows = []
    for sym in ["ALL"] + C.SYMBOLS:
        g = e if sym == "ALL" else e[e.symbol == sym]
        gp = g[g.primary]
        rows.append(dict(
            symbol=sym, n_takeouts=len(g),
            unanchorable_n=int((~g.bos_anchorable).sum()),
            unanchorable_pct=100 * (~g.bos_anchorable).mean(),
            anchor_age_median_bars=gp.bos_anchor_age_bars.median(),
            anchor_age_p90_bars=gp.bos_anchor_age_bars.quantile(.9),
            anchor_age_max_bars=gp.bos_anchor_age_bars.max(),
            stale_anchor_pct=100 * gp.bos_anchor_stale.mean(),
            anchor_dist_atr_p10=gp.bos_anchor_dist_atr.quantile(.1),
            anchor_dist_atr_median=gp.bos_anchor_dist_atr.median(),
            anchor_dist_atr_p90=gp.bos_anchor_dist_atr.quantile(.9),
            anchor_beyond_level_pct=100 * gp.bos_anchor_beyond_level.mean(),
        ))
    A(md(save(pd.DataFrame(rows), "b1_anchor_selection.csv")))
    A(f"\n_`unanchorable` = DESIGN.md §1 pin 4: no k=3 pivot of the opposing "
      f"side was confirmed anywhere before the take-out bar. The design asks "
      f"for a loud flag above ~2%; the measured value is "
      f"**{100*(~e.bos_anchorable).mean():.3f}%** "
      f"({int((~e.bos_anchorable).sum())} events of {n_all:,}), so the category "
      f"exists in the schema and is empty in the data — see REPORT §2. "
      f"`anchor_age` = bars from the anchor's own pivot bar to the take-out "
      f"bar (never < k = {C.PIVOT_K}, by construction). `anchor_dist_atr` = "
      f"|take-out wick - anchor price| in ATR(14, 5m): the width the mechanic "
      f"must travel before it can fire at all. `anchor_beyond_level_pct` = "
      f"share where the anchor sits on the far side of the swept level._\n")

    A("### B2. Outcome state counts — corrected BoS (primary sample)\n")
    rows = []
    for cause, lbl in (("confirmed", "BROKE — a close through the pinned ray"),
                       ("no_break_in_window",
                        "no break before the sweep block ended"),
                       ("unanchorable", "UNANCHORABLE — no qualifying pivot existed")):
        g = p[p.bos_cause == cause]
        rows.append(dict(state=lbl, n=len(g), share_pct=100 * len(g) / n_p,
                         delay_median=g.bos_delay_bars.median(),
                         bars_remaining_median=g.bars_remaining.median(),
                         anchor_dist_atr_median=g.bos_anchor_dist_atr.median(),
                         rev_atr_median=g.rev_atr.median()))
    unc = p[~p.bos_confirmed & p.bos_anchorable]
    A(md(save(pd.DataFrame(rows), "b2_state_counts.csv")))
    A(f"\n_Of the {len(unc):,} anchorable-but-unbroken take-outs, "
      f"**{100*unc.bos_would_confirm_extended.mean():.1f}%** would have broken "
      f"had the block run "
      f"{C.TRUNCATION_PROBE_BARS*C.BAR_MIN/60:.0f}h longer — a diagnostic "
      f"probe, not part of any definition. `rev_atr` is the wick-anchored "
      f"reversal over the whole block window, so it is comparable across "
      f"states._\n")

    A("### B3. Immediate breaks and other edge shapes\n")
    A(f"* break on the take-out bar itself (`t0`): "
      f"**{int(p.bos_immediate.sum())}** events = "
      f"{100*p.bos_immediate.mean():.2f}% of the primary sample — a bar whose "
      f"wick takes the level out and whose close is already back through the "
      f"anchor.\n"
      f"* anchor age exactly k = {C.PIVOT_K} bars (the freshest an anchor can "
      f"be): {100*(p.bos_anchor_age_bars == C.PIVOT_K).mean():.1f}% of events.\n"
      f"* the anchor is on the same side of the swept level as the pre-sweep "
      f"structure in **{100*(1-p.bos_anchor_beyond_level.mean()):.1f}%** of "
      f"events, so a break is nearly always a close back INSIDE the swept "
      f"range — this single geometric fact drives most of what follows.\n")

    # ==================================================================== T
    A("## T. Core tables — corrected BoS, v4 format, primary sample\n")

    A("### T2. BoS confirmation rate — level_session x sweep_block\n")
    t2 = (p.pivot_table(index="level_session", columns="sweep_block",
                        values="bos_confirmed", aggfunc="mean")
           .reindex(index=SESS_ORD, columns=BLOCK_ORD) * 100)
    t2["ALL blocks"] = p.groupby("level_session").bos_confirmed.mean().reindex(SESS_ORD) * 100
    t2.loc["ALL levels"] = [100 * p.loc[p.sweep_block == b, "bos_confirmed"].mean()
                            for b in BLOCK_ORD] + [100 * p.bos_confirmed.mean()]
    A(md(save(t2.reset_index(), "t2_bos_rate_levelsession_x_block.csv")))
    A("\n_Rows = whose liquidity was taken; columns = the clock block the "
      "take-out happened in. The iFVG counterpart is v4's "
      "`t2_ifvg_rate_levelsession_x_block.csv`; M1 below puts the two on the "
      "same take-outs._\n")

    A("### T2b. Confirmation rate — level_session x direction x asset\n")
    rows = []
    for (s_, dr), g in p.groupby(["level_session", "direction"]):
        r = dict(level_session=s_, direction=dr, n=len(g),
                 bos_rate_ALL=100 * g.bos_confirmed.mean(),
                 p1bos_rate_ALL=100 * g.p1bos_confirmed.mean(),
                 ifvg_rate_ALL=100 * g.ifvg_confirmed.mean())
        for sym in C.SYMBOLS:
            gs = g[g.symbol == sym]
            r[sym] = 100 * gs.bos_confirmed.mean() if len(gs) else np.nan
        rows.append(r)
    t2b = pd.DataFrame(rows).set_index(["level_session", "direction"]).reindex(SESS_ORD, level=0)
    A(md(save(t2b.reset_index(), "t2b_bos_rate_by_asset.csv")))
    A("\n_The per-asset columns are the CORRECTED BoS rate._\n")

    A("### T2c. The full core cut — level_session x sweep_block x direction x asset\n")
    rows = []
    for (s_, b_, dr, sym), g in p.groupby(["level_session", "sweep_block",
                                           "direction", "symbol"]):
        if len(g) < 15:
            continue
        gc = g[g.bos_confirmed]
        rows.append(dict(level_session=s_, sweep_block=b_, direction=dr, symbol=sym,
                         n=len(g), confirm_rate_pct=100 * g.bos_confirmed.mean(),
                         delay_median=gc.bos_delay_bars.median(),
                         anchor_dist_atr_median=g.bos_anchor_dist_atr.median(),
                         mfe_atr_median=gc.bos_mfe_atr.median(),
                         mae_atr_median=gc.bos_mae_atr.median(),
                         stop_atr_median=gc.bos_stop_atr.median(),
                         R_median=gc.bos_R.median(),
                         share_R_ge_1=100 * (gc.bos_R >= 1).mean()))
    t2c = pd.DataFrame(rows)
    save(t2c, "t2c_core_full_cut.csv")
    A(f"Full table in `results/t2c_core_full_cut.csv` — {len(t2c)} cells with "
      f"n >= 15 (of "
      f"{p.groupby(['level_session','sweep_block','direction','symbol']).ngroups} "
      f"possible). Confirmation rate across cells: min "
      f"{t2c.confirm_rate_pct.min():.0f}%, median "
      f"{t2c.confirm_rate_pct.median():.0f}%, max "
      f"{t2c.confirm_rate_pct.max():.0f}%; median R proxy across cells "
      f"{t2c.R_median.min():.2f} / {t2c.R_median.median():.2f} / "
      f"{t2c.R_median.max():.2f}.\n")

    A("### T3. Take-out -> break delay, and the block-truncation share\n")
    rows = []
    for b in BLOCK_ORD + ["ALL"]:
        g = p if b == "ALL" else p[p.sweep_block == b]
        dly = g.loc[g.bos_confirmed, "bos_delay_bars"]
        unc_ = g[~g.bos_confirmed & g.bos_anchorable]
        rows.append(dict(sweep_block=b, n=len(g),
                         confirmed_pct=100 * g.bos_confirmed.mean(),
                         delay_median_bars=dly.median(),
                         delay_p25=dly.quantile(.25), delay_p75=dly.quantile(.75),
                         delay_p90=dly.quantile(.9),
                         delay_median_min=dly.median() * C.BAR_MIN,
                         unconfirmed_n=len(unc_),
                         truncated_share_pct=100 * unc_.bos_would_confirm_extended.mean()
                         if len(unc_) else np.nan))
    A(md(save(pd.DataFrame(rows), "t3_delay_and_truncation.csv")))
    A(f"\n_`truncated_share_pct` = of the anchorable take-outs that did NOT "
      f"break, the share that would have broken had the block run "
      f"{C.TRUNCATION_PROBE_BARS*C.BAR_MIN/60:.0f}h longer._\n")

    A("### T6. Magnitude from the BoS BREAK CLOSE — the tradable view\n")
    rows = []
    for s_ in ["ALL"] + SESS_ORD:
        for dr in ["ALL", "high_sweep", "low_sweep"]:
            g = p[p.bos_confirmed]
            if s_ != "ALL":
                g = g[g.level_session == s_]
            if dr != "ALL":
                g = g[g.direction == dr]
            mfe = g.bos_mfe_atr.dropna(); mae = g.bos_mae_atr.dropna()
            rows.append(dict(level_session=s_, direction=dr, n=len(mfe),
                             mfe_atr_median=mfe.median(), mfe_atr_p75=mfe.quantile(.75),
                             mfe_atr_p90=mfe.quantile(.9),
                             mae_atr_median=mae.median(), mae_atr_p90=mae.quantile(.9),
                             mfe_over_mae=mfe.median() / mae.median() if mae.median() else np.nan,
                             end_atr_median=g.bos_end_atr.median(),
                             share_end_positive=100 * (g.bos_end_atr > 0).mean(),
                             conf_bars_left_median=g.bos_conf_bars_remaining.median()))
    A(md(save(pd.DataFrame(rows), "t6_from_break.csv")))
    A("\n_MFE/MAE over what is LEFT of the block after the break bar's close, "
      "in ATR(14, 5m) at the take-out bar. `share_end_positive` = % still on "
      "the favourable side of the break close when the block ends._\n")

    A("### T7. Stop proxy and R proxy at the break bar\n")
    rows = []
    for s_ in ["ALL"] + SESS_ORD:
        for b in ["ALL"] + BLOCK_ORD:
            g = p[p.bos_confirmed]
            if s_ != "ALL":
                g = g[g.level_session == s_]
            if b != "ALL":
                g = g[g.sweep_block == b]
            st = g.bos_stop_atr.dropna(); R = g.bos_R.dropna()
            if not len(st):
                continue
            rows.append(dict(level_session=s_, sweep_block=b, n=len(st),
                             stop_atr_median=st.median(), stop_atr_p90=st.quantile(.9),
                             R_median=R.median(), R_p75=R.quantile(.75),
                             share_R_ge_1=100 * (R >= 1).mean(),
                             share_R_ge_2=100 * (R >= 2).mean()))
    A(md(save(pd.DataFrame(rows), "t7_stop_and_R.csv")))
    A("\n_DESIGN.md §2 pin: stop = distance from the BREAK CLOSE back to the "
      "sweep leg's running extreme (take-out bar .. break bar) — the SAME "
      "convention iFVG uses in v4, which is what makes R comparable across "
      "methods. `R` = block-scoped MFE / that stop. **Descriptive only** — no "
      "costs, no exit rule, and MFE is a best-case exit nobody hits "
      "systematically._\n")

    A("### T12. Monthly stability\n")
    m = p.groupby("month").agg(take_outs=("bar", "size"),
                               bos_rate=("bos_confirmed", "mean"),
                               p1bos_rate=("p1bos_confirmed", "mean"),
                               ifvg_rate=("ifvg_confirmed", "mean"),
                               rev_atr_median=("rev_atr", "median"),
                               bos_mfe_atr_median=("bos_mfe_atr", "median"),
                               bos_R_median=("bos_R", "median"))
    for c in ("bos_rate", "p1bos_rate", "ifvg_rate"):
        m[c] *= 100
    save(m.reset_index(), "t12_monthly.csv")
    A(f"Full table in `results/t12_monthly.csv` ({len(m)} months). Monthly "
      f"corrected-BoS rate ranges "
      f"**{m.bos_rate.min():.0f}-{m.bos_rate.max():.0f}%** "
      f"(median {m.bos_rate.median():.0f}%); monthly median R proxy "
      f"**{m.bos_R_median.min():.2f}-{m.bos_R_median.max():.2f}** "
      f"(median {m.bos_R_median.median():.2f}). Worst / best month by rate: "
      f"{m.bos_rate.idxmin()} / {m.bos_rate.idxmax()}. See chart 06.\n")

    # ==================================================================== D
    A("## D. Corrected BoS vs PHASE-1 BoS — the re-anchoring defect, quantified\n")

    A("### D1. Headline metrics, both arms, same take-out rows (primary sample)\n")
    d1 = pd.DataFrame([arm_row(p, "bos", ARMS[0][1], n_p),
                       arm_row(p, "p1bos", ARMS[1][1], n_p)])
    delta = {k: (d1.iloc[0][k] - d1.iloc[1][k]) if d1[k].dtype.kind == "f" or
             isinstance(d1.iloc[0][k], (int, np.integer)) else ""
             for k in d1.columns}
    delta["algorithm"] = "delta (corrected - phase 1)"
    d1 = pd.concat([d1, pd.DataFrame([delta])], ignore_index=True)
    A(md(save(d1, "d1_bos_headline_delta.csv")))
    A("\n_Same take-outs, same horizon, same geometry formulas, same k=3 "
      "pivots — the ONLY difference is whether the tested level is allowed to "
      "MOVE after the take-out. Each row is computed on its own confirmed "
      "subset, so `n_confirmed` differs by construction; that difference is "
      "the finding._\n")

    A("### D2. Which level was phase 1 actually testing?\n")
    rows = []
    for b in ["ALL"] + BLOCK_ORD:
        g = p if b == "ALL" else p[p.sweep_block == b]
        gc = g[g.p1bos_confirmed]
        rows.append(dict(
            sweep_block=b, n=len(g),
            level_defined_at_t0_pct=100 * g.p1bos_level_defined_at_t0.mean(),
            agrees_with_corrected_anchor_at_t0_pct=100 * g.p1bos_agrees_at_t0.mean(),
            reanchors_before_break_median=gc.p1bos_reanchors.median(),
            reanchors_before_break_mean=gc.p1bos_reanchors.mean(),
            still_same_level_at_break_pct=100 * gc.p1bos_same_level_as_corrected.mean(),
        ))
    A(md(save(pd.DataFrame(rows), "d2_which_level_phase1_tested.csv")))
    A(f"\n**This is the defect, in two numbers.** At the take-out bar the two "
      f"mechanics pick the *same* level on "
      f"**{100*p.p1bos_agrees_at_t0.mean():.1f}%** of take-outs — they are the "
      f"same selection rule at `t0`. By the bar phase 1 fires, it is still "
      f"testing that level on only "
      f"**{100*p[p.p1bos_confirmed].p1bos_same_level_as_corrected.mean():.1f}%** "
      f"of them, because a median of "
      f"**{p[p.p1bos_confirmed].p1bos_reanchors.median():.0f}** newly confirmed "
      f"pivots overwrote it in between. Phase-1 BoS was therefore not a break "
      f"of the structure that led into the sweep; it was a break of whatever "
      f"minor swing happened to be the most recent one at the time.\n")

    A("### D3. Outcome agreement — corrected vs phase 1 (primary sample)\n")
    rows = []
    for b in ["ALL"] + BLOCK_ORD:
        g = p if b == "ALL" else p[p.sweep_block == b]
        both = g.bos_confirmed & g.p1bos_confirmed
        rows.append(dict(sweep_block=b, n=len(g),
                         both_pct=100 * both.mean(),
                         corrected_only_pct=100 * (g.bos_confirmed & ~g.p1bos_confirmed).mean(),
                         phase1_only_pct=100 * (~g.bos_confirmed & g.p1bos_confirmed).mean(),
                         neither_pct=100 * (~g.bos_confirmed & ~g.p1bos_confirmed).mean(),
                         same_bar_pct=100 * (g.loc[both, "bos_delay_bars"] ==
                                             g.loc[both, "p1bos_delay_bars"]).mean()
                         if both.any() else np.nan))
    A(md(save(pd.DataFrame(rows), "d3_agreement_corrected_vs_phase1.csv")))
    A("\n_Neither arm's confirmed set contains the other's: the corrected "
      "mechanic can fire where phase 1's level had already been retired by an "
      "earlier break, and phase 1 fires constantly on levels the corrected "
      "mechanic never watched._\n")

    A("### D4. Where both fire — how far apart are they\n")
    both = p[p.bos_confirmed & p.p1bos_confirmed]
    rows = []
    for q, lbl in ((both.bos_delay_bars - both.p1bos_delay_bars,
                    "break delay, corrected - phase 1 (bars)"),
                   (both.bos_stop_atr - both.p1bos_stop_atr,
                    "stop proxy, corrected - phase 1 (ATR)"),
                   (both.bos_R - both.p1bos_R,
                    "R proxy, corrected - phase 1"),
                   (both.bos_mfe_atr - both.p1bos_mfe_atr,
                    "MFE from the break, corrected - phase 1 (ATR)")):
        q = q.dropna()
        rows.append(dict(quantity=lbl, n=len(q), p10=q.quantile(.1),
                         median=q.median(), mean=q.mean(), p90=q.quantile(.9),
                         share_positive_pct=100 * (q > 0).mean(),
                         share_zero_pct=100 * (q == 0).mean()))
    A(md(save(pd.DataFrame(rows), "d4_both_fire_difference.csv"), "{:.3f}"))
    A(f"\n_Restricted to the **{len(both):,}** primary take-outs both arms "
      f"confirm. A positive delay delta means the corrected mechanic fired "
      f"LATER._\n")

    A("### D5. What the phase-1 numbers meant — the cited figures, re-derived\n")
    rows = []
    for pre, lbl in (("p1bos", "phase-1 mechanic, v4-era block-scoped window"),
                     ("bos", "corrected mechanic, same window")):
        gc = p[p[pre + "_confirmed"]]
        rows.append(dict(arm=lbl, n=len(gc),
                         rate_pct=100 * len(gc) / n_p,
                         delay_median_bars=gc[pre + "_delay_bars"].median(),
                         stop_atr_median=gc[pre + "_stop_atr"].median(),
                         R_median=gc[pre + "_R"].median()))
    A(md(save(pd.DataFrame(rows), "d5_phase1_cited_figures.csv"), "{:.2f}"))
    A("\n_Phase 1 reported a BoS delay median of 14 bars and a stop width of "
      "3.76 ATR under its own 2h fixed horizon; the correction note predicted "
      "both were **inflated** by re-anchoring. Re-derived here on the same "
      "window for both arms, the prediction's DIRECTION does not hold — see "
      "REPORT §4. The row above is what phase 1's mechanic actually produces "
      "when the horizon confound is removed._\n")

    # ==================================================================== M
    A("## M. Corrected BoS vs iFVG-v4 — the original 'which confirmation "
      "method' question\n")

    A("### M1. Agreement matrix — same take-outs, both methods correctly "
      "measured\n")
    rows = []
    for b in ["ALL"] + BLOCK_ORD:
        g = p if b == "ALL" else p[p.sweep_block == b]
        rows.append(dict(sweep_block=b, n=len(g),
                         both_pct=100 * (g.bos_confirmed & g.ifvg_confirmed).mean(),
                         bos_only_pct=100 * (g.bos_confirmed & ~g.ifvg_confirmed).mean(),
                         ifvg_only_pct=100 * (~g.bos_confirmed & g.ifvg_confirmed).mean(),
                         neither_pct=100 * (~g.bos_confirmed & ~g.ifvg_confirmed).mean(),
                         bos_rate_pct=100 * g.bos_confirmed.mean(),
                         ifvg_rate_pct=100 * g.ifvg_confirmed.mean()))
    A(md(save(pd.DataFrame(rows), "m1_agreement_bos_vs_ifvg.csv")))
    A("\n_The first time these two methods have been compared with BOTH of "
      "them correctly implemented. Read the `both` column as 'how much of the "
      "one method is the other method' — the two are far from "
      "interchangeable._\n")

    A("### M2. Relative timing where BOTH fire\n")
    bi = p[p.both_confirmed]
    rows = [dict(
        scope="ALL blocks", n=len(bi),
        bos_delay_median=bi.bos_delay_bars.median(),
        ifvg_delay_median=bi.ifvg_delay_bars.median(),
        diff_median_bars=bi.bos_minus_ifvg_bars.median(),
        diff_p10=bi.bos_minus_ifvg_bars.quantile(.1),
        diff_p90=bi.bos_minus_ifvg_bars.quantile(.9),
        bos_first_pct=100 * bi.bos_first.mean(),
        same_bar_pct=100 * bi.same_bar.mean(),
        ifvg_first_pct=100 * (~bi.bos_first & ~bi.same_bar).mean())]
    for b in BLOCK_ORD:
        g = bi[bi.sweep_block == b]
        if len(g) < 50:
            continue
        rows.append(dict(scope=b, n=len(g),
                         bos_delay_median=g.bos_delay_bars.median(),
                         ifvg_delay_median=g.ifvg_delay_bars.median(),
                         diff_median_bars=g.bos_minus_ifvg_bars.median(),
                         diff_p10=g.bos_minus_ifvg_bars.quantile(.1),
                         diff_p90=g.bos_minus_ifvg_bars.quantile(.9),
                         bos_first_pct=100 * g.bos_first.mean(),
                         same_bar_pct=100 * g.same_bar.mean(),
                         ifvg_first_pct=100 * (~g.bos_first & ~g.same_bar).mean()))
    A(md(save(pd.DataFrame(rows), "m2_relative_timing.csv")))
    A("\n_Positive `diff` = BoS fired LATER than the iFVG on the same "
      "take-out._\n")

    A("### M3. Side-by-side geometry from each method's own entry reference\n")
    m3 = pd.DataFrame([arm_row(p, pre, lbl, n_p) for pre, lbl in ARMS])
    A(md(save(m3, "m3_geometry_side_by_side.csv")))
    A("\n_Identical formulas and an identical stop convention (DESIGN.md §2), "
      "so the R column is comparable across rows. Each row is computed on its "
      "OWN confirmed subset._\n")

    A("### M3b. Geometry restricted to the take-outs BOTH methods confirm\n")
    rows = []
    for pre, lbl in (("bos", ARMS[0][1]), ("ifvg", ARMS[2][1])):
        R = bi[pre + "_R"].dropna()
        rows.append(dict(method=lbl, n=len(bi),
                         delay_median=bi[pre + "_delay_bars"].median(),
                         mfe_atr_median=bi[pre + "_mfe_atr"].median(),
                         mae_atr_median=bi[pre + "_mae_atr"].median(),
                         stop_atr_median=bi[pre + "_stop_atr"].median(),
                         R_median=R.median(),
                         share_R_ge_1=100 * (R >= 1).mean(),
                         end_atr_median=bi[pre + "_end_atr"].median()))
    A(md(save(pd.DataFrame(rows), "m3b_geometry_both_confirm.csv")))
    A("\n_The event set is held FIXED here, so nothing in this table is "
      "confounded by the two methods confirming different take-outs. What is "
      "left is purely the cost of entering later and from further inside the "
      "range._\n")

    A("### M4. Does BoS SELECT? — lift over each block's own unconditional "
      "baseline\n")
    rows = []
    for b in BLOCK_ORD:
        ub = up[up.sweep_block == b]
        for dr, ucol in (("high_sweep", "down_atr"), ("low_sweep", "up_atr")):
            g = p[(p.sweep_block == b) & (p.direction == dr)]
            base = ub[ucol].median()
            rows.append(dict(sweep_block=b, direction=dr, n_takeouts=len(g),
                             takeout_rev_atr_median=g.rev_atr.median(),
                             uncond_atr_median=base,
                             lift_bare_takeout=g.rev_atr.median() / base,
                             n_bos=int(g.bos_confirmed.sum()),
                             lift_bos=g[g.bos_confirmed].rev_atr.median() / base,
                             n_ifvg=int(g.ifvg_confirmed.sum()),
                             lift_ifvg=g[g.ifvg_confirmed].rev_atr.median() / base,
                             n_p1bos=int(g.p1bos_confirmed.sum()),
                             lift_p1bos=g[g.p1bos_confirmed].rev_atr.median() / base))
    A(md(save(pd.DataFrame(rows), "m4_lift_vs_unconditional.csv"), "{:.3f}"))
    A("\n_`lift` = conditional median / same-block unconditional median, both "
      "measured from the WICK extreme so both are hindsight-flattered the same "
      "way. **The v4 standing null is that iFVG does not select** (confirmed "
      "lift 0.97-1.23x vs 1.23-1.58x for bare take-outs — confirming made the "
      "reversal SMALLER). The question here is whether BoS behaves "
      "differently._\n")

    A("### M4b. The same question, window-matched (the honest version)\n")
    rows = []
    for b in BLOCK_ORD:
        for lbl in REM_LBL[1:]:
            g = p[(p.sweep_block == b) & (p.rem_bucket == lbl)]
            ub = up[(up.sweep_block == b) & (up.rem_bucket == lbl)]
            if len(g) < 50 or not len(ub):
                continue
            gh = g[g.direction == "high_sweep"]; gl = g[g.direction == "low_sweep"]
            dh = ub.down_atr.median(); dl = ub.up_atr.median()
            rows.append(dict(
                sweep_block=b, bars_remaining=lbl, n=len(g),
                hi_lift_bare=gh.rev_atr.median() / dh,
                hi_lift_bos=gh[gh.bos_confirmed].rev_atr.median() / dh,
                hi_lift_ifvg=gh[gh.ifvg_confirmed].rev_atr.median() / dh,
                lo_lift_bare=gl.rev_atr.median() / dl,
                lo_lift_bos=gl[gl.bos_confirmed].rev_atr.median() / dl,
                lo_lift_ifvg=gl[gl.ifvg_confirmed].rev_atr.median() / dl))
    A(md(save(pd.DataFrame(rows), "m4b_lift_window_matched.csv"), "{:.3f}"))
    A("\n_Confirmation rate and reversal size are both driven by how much "
      "block is left, so an unmatched lift comparison partly measures window "
      "length. Inside a bars-remaining bucket that confound is held fixed._\n")

    A("### M4c. Selection summary — one number per method\n")
    rows = []
    for lbl, mask in (("bare take-out (no confirmation required)",
                       pd.Series(True, index=p.index)),
                      ("BoS-confirmed (corrected)", p.bos_confirmed),
                      ("iFVG-confirmed (v4)", p.ifvg_confirmed),
                      ("BoS-confirmed (phase-1 mechanic)", p.p1bos_confirmed),
                      ("both BoS and iFVG confirmed", p.both_confirmed)):
        g = p[mask]
        # pooled window-matched lift: each event against its own
        # (block x rem_bucket x direction) unconditional median
        num = []
        for (b, lbl2, dr), gg in g.groupby(["sweep_block", "rem_bucket", "direction"],
                                           observed=True):
            ub = up[(up.sweep_block == b) & (up.rem_bucket == lbl2)]
            if not len(ub):
                continue
            base = ub.down_atr.median() if dr == "high_sweep" else ub.up_atr.median()
            if base and np.isfinite(base):
                num.append(gg.rev_atr / base)
        ratio = pd.concat(num) if num else pd.Series(dtype=float)
        rows.append(dict(subset=lbl, n=len(g), share_of_primary_pct=100 * len(g) / n_p,
                         rev_atr_median=g.rev_atr.median(),
                         window_matched_lift_median=ratio.median(),
                         share_rev_ge_2atr=100 * (g.rev_atr >= 2).mean(),
                         share_rev_ge_4atr=100 * (g.rev_atr >= 4).mean()))
    A(md(save(pd.DataFrame(rows), "m4c_selection_summary.csv"), "{:.3f}"))
    A("\n_`window_matched_lift_median` = the median, over events, of that "
      "event's wick-anchored reversal divided by the unconditional median move "
      "for its own (block x remaining-window bucket x direction) cell. A value "
      "of 1.0 means 'this subset moves exactly like a random bar in the same "
      "situation'; above 1 means the filter picked bigger reversals. Because "
      "the denominator is a per-cell constant, this is a descriptive ratio, "
      "not a test._\n")

    A("### M4d. WHY M4/M4b/M4c CANNOT BE READ AS SELECTION — the circularity\n")
    cb = p[p.bos_confirmed]
    floor_share = 100 * (cb.rev_atr >= cb.bos_anchor_dist_atr).mean()
    rows = [dict(
        quantity="anchor distance |take-out wick - anchor| (ATR)",
        p10=cb.bos_anchor_dist_atr.quantile(.1),
        median=cb.bos_anchor_dist_atr.median(),
        p90=cb.bos_anchor_dist_atr.quantile(.9)),
        dict(quantity="wick-anchored reversal rev_atr, BoS-confirmed events",
             p10=cb.rev_atr.quantile(.1), median=cb.rev_atr.median(),
             p90=cb.rev_atr.quantile(.9)),
        dict(quantity="rev_atr, ALL primary take-outs (the comparison base)",
             p10=p.rev_atr.quantile(.1), median=p.rev_atr.median(),
             p90=p.rev_atr.quantile(.9))]
    A(md(save(pd.DataFrame(rows), "m4d_circularity.csv"), "{:.2f}"))
    A(f"\n**A BoS break is a close through a ray that sits a median of "
      f"{cb.bos_anchor_dist_atr.median():.2f} ATR away from the take-out wick, "
      f"and the ray is always on the near side of the swept level (B1). So a "
      f"BoS confirmation MECHANICALLY IMPLIES `rev_atr > anchor_dist_atr` — "
      f"measured share: {floor_share:.1f}%.** The lift columns in M4/M4b/M4c "
      f"apply a threshold to the very quantity they then report, so a BoS lift "
      f"of ~2-3x is a floor effect, not evidence that BoS picks better "
      f"sweeps. iFVG has no such floor (a gap can invert anywhere), which is "
      f"why the v4 lift table was interpretable and this one is not. The "
      f"non-circular version is M4e.\n")

    A("### M4e. The non-circular selection test — forward move measured FROM "
      "the confirmation bar\n")
    A("Everything before the confirmation bar is discarded, and each confirmed "
      "event is compared against the unconditional forward move for bars with "
      "the SAME number of bars remaining **at the confirmation bar** — so the "
      "confirmation criterion can no longer feed the numerator.\n")
    urem = up.copy()
    urem["cbucket"] = pd.cut(urem.bars_remaining, REM_EDGES, right=False,
                             labels=REM_LBL)
    base_tab = {}
    for (b, lbl2), g in urem.groupby(["sweep_block", "cbucket"], observed=True):
        base_tab[(b, lbl2, "high_sweep")] = g.down_atr.median()
        base_tab[(b, lbl2, "low_sweep")] = g.up_atr.median()
    rows = []
    for pre, lbl in (("bos", ARMS[0][1]), ("ifvg", ARMS[2][1]),
                     ("p1bos", ARMS[1][1])):
        g = p[p[pre + "_confirmed"] & p[pre + "_mfe_atr"].notna()].copy()
        g["cbucket"] = pd.cut(g[pre + "_conf_bars_remaining"], REM_EDGES,
                              right=False, labels=REM_LBL)
        key = list(zip(g.sweep_block, g.cbucket, g.direction))
        base = pd.Series([base_tab.get(k, np.nan) for k in key], index=g.index)
        ratio = (g[pre + "_mfe_atr"] / base).replace([np.inf, -np.inf], np.nan).dropna()
        rows.append(dict(method=lbl, n=len(ratio),
                         mfe_atr_median=g[pre + "_mfe_atr"].median(),
                         matched_uncond_median=base.median(),
                         forward_lift_median=ratio.median(),
                         forward_lift_mean=ratio.mean(),
                         share_lift_ge_1=100 * (ratio >= 1).mean()))
    A(md(save(pd.DataFrame(rows), "m4e_forward_lift.csv"), "{:.3f}"))
    A("\n_`forward_lift` = the event's post-confirmation MFE divided by the "
      "unconditional median forward move for its (block x bars-remaining-at-"
      "confirmation x direction) cell. The denominator is measured from a "
      "bar's high/low while the numerator starts at a close, which biases the "
      "denominator slightly UP — so these numbers are, if anything, "
      "conservative against the methods. A value near 1.0 means the "
      "confirmation told you nothing about what comes next; this is the "
      "column the v4 'iFVG does not select' null actually lives in, and it is "
      "where BoS has to be judged too._\n")

    # ==================================================================== W
    A("## W. Window length — the primary comparative axis (§6.1)\n")
    A("### W1. Confirmation rate by remaining-window bucket, all three arms\n")
    rows = []
    for lbl in REM_LBL:
        g = e[e.rem_bucket == lbl]
        if not len(g):
            continue
        rows.append(dict(bars_remaining=lbl, n=len(g),
                         share_pct=100 * len(g) / len(e),
                         bos_rate=100 * g.bos_confirmed.mean(),
                         p1bos_rate=100 * g.p1bos_confirmed.mean(),
                         ifvg_rate=100 * g.ifvg_confirmed.mean(),
                         bos_delay_median=g.bos_delay_bars.median(),
                         ifvg_delay_median=g.ifvg_delay_bars.median(),
                         anchor_dist_atr_median=g.bos_anchor_dist_atr.median()))
    A(md(save(pd.DataFrame(rows), "w1_by_window_bucket.csv")))
    A("\n_Window length dominates BoS exactly as it dominates iFVG: the "
      "mechanic needs enough bars left for price to travel back through a ray "
      "that sits a median of several ATR away. Note the anchor DISTANCE is "
      "essentially flat across buckets — the rate difference is time, not "
      "geometry._\n")

    A("### W2. From-break geometry by remaining-window bucket (corrected BoS)\n")
    rows = []
    for lbl in REM_LBL:
        g = p[(p.rem_bucket == lbl) & p.bos_confirmed]
        if len(g) < 30:
            continue
        rows.append(dict(bars_remaining=lbl, n=len(g),
                         delay_median=g.bos_delay_bars.median(),
                         conf_bars_left_median=g.bos_conf_bars_remaining.median(),
                         mfe_atr_median=g.bos_mfe_atr.median(),
                         mae_atr_median=g.bos_mae_atr.median(),
                         stop_atr_median=g.bos_stop_atr.median(),
                         R_median=g.bos_R.median(),
                         share_R_ge_1=100 * (g.bos_R >= 1).mean()))
    A(md(save(pd.DataFrame(rows), "w2_geometry_by_window.csv")))
    A("")

    # ==================================================================== H
    A("## H. Clock — derived, and only meaningful window-stratified\n")
    A("### H1. BoS rate by take-out hour (UTC), window-length-stratified\n")
    HOUR_LBL = REM_LBL[1:]
    rows = []
    for hh in range(24):
        g = e[(e.hour == hh) & (e.bars_remaining >= MINB)]
        r = dict(hour=hh, n=len(g),
                 bos_rate_ALL=100 * g.bos_confirmed.mean() if len(g) else np.nan,
                 ifvg_rate_ALL=100 * g.ifvg_confirmed.mean() if len(g) else np.nan)
        for lbl in HOUR_LBL:
            gs = g[g.rem_bucket == lbl]
            r[f"bos_{lbl}"] = 100 * gs.bos_confirmed.mean() if len(gs) >= 20 else np.nan
            r[f"n_{lbl}"] = len(gs)
        rows.append(r)
    A(md(save(pd.DataFrame(rows), "h1_bos_rate_by_hour_stratified.csv")))
    A("\n_§6.1 warns that an unstratified hourly cut just rediscovers the "
      "clock, because a take-out's hour and its remaining window length are "
      "the same fact seen twice. The `bos_<bucket>` columns hold the window "
      "length fixed; blank cells have < 20 events._\n")

    # ==================================================================== A
    A("## A. Appendix\n")
    A("### A1. Primary vs short-window sample\n")
    q = e[~e.primary]
    rows = []
    for lbl, g in (("primary (>= 12 bars left)", p),
                   ("short window (< 12 bars left)", q),
                   ("FULL sample (both)", e)):
        rows.append(dict(sample=lbl, n=len(g), share_pct=100 * len(g) / len(e),
                         rem_median=g.bars_remaining.median(),
                         bos_rate=100 * g.bos_confirmed.mean(),
                         p1bos_rate=100 * g.p1bos_confirmed.mean(),
                         ifvg_rate=100 * g.ifvg_confirmed.mean(),
                         unanchorable_pct=100 * (~g.bos_anchorable).mean(),
                         rev_atr_median=g.rev_atr.median(),
                         bos_R_median=g.bos_R.median()))
    A(md(save(pd.DataFrame(rows), "a1_primary_vs_short_window.csv")))
    A("")

    A("### A2. Full-sample BoS rate (no window filter)\n")
    a2 = (e.pivot_table(index="level_session", columns="sweep_block",
                        values="bos_confirmed", aggfunc="mean")
           .reindex(index=SESS_ORD, columns=BLOCK_ORD) * 100)
    a2["ALL blocks"] = e.groupby("level_session").bos_confirmed.mean().reindex(SESS_ORD) * 100
    a2.loc["ALL levels"] = [100 * e.loc[e.sweep_block == b, "bos_confirmed"].mean()
                            for b in BLOCK_ORD] + [100 * e.bos_confirmed.mean()]
    A(md(save(a2.reset_index(), "a2_bos_rate_full_sample.csv")))
    A("")

    out = os.path.join(C.RESULTS, "TABLES.md")
    with open(out, "w") as fh:
        fh.write("# Tables — session-liquidity BoS pass (corrected mechanic)\n\n")
        fh.write("\n".join(_lines) + "\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
