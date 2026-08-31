#!/usr/bin/env python3
"""Aggregate charts — session-liquidity **BoS pass**.

Writes viz/01..07_*.png. Worked-example panels live in examples.py /
gallery.py (the gallery is the audit surface; these are the aggregate views).

  01  THE DEFECT — corrected vs phase-1 BoS: rate, which level was tested,
      re-anchoring count, delay/stop/R
  02  the anchor itself — age, distance from the take-out wick, and the
      distance's consequence (break rate vs anchor distance)
  03  confirmation rate — level_session x sweep_block, corrected BoS beside
      iFVG-v4
  04  METHOD COMPARISON — agreement matrix, relative timing, geometry on the
      take-outs both methods confirm
  05  SELECTION — the circular lift picture next to the non-circular one
  06  window length as the primary axis + monthly stability
  07  clock, derived: BoS rate by hour, window-length-stratified

Usage: .venv/bin/python research/session-liquidity-bos/charts.py
"""
from __future__ import annotations

import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import common as C
import tables as T

SESS_ORD = T.SESS_ORD
BLOCK_ORD = T.BLOCK_ORD
REM_LBL = T.REM_LBL
CS = {"Asia": "#e08b3a", "London": "#3f7fbf", "NY": "#7b5ea7", "Late": "#9aa0a6"}
BOS, P1, IFVG, BARE = "#2e8b57", "#c0392b", "#3f7fbf", "#9aa0a6"


def _save(fig, name):
    pth = os.path.join(C.VIZ, name)
    fig.savefig(pth, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print("wrote", pth)


def _bars(ax, labels, vals, colors, fmt="{:.1f}", width=.62):
    b = ax.bar(labels, vals, color=colors, width=width)
    for r, v in zip(b, vals):
        if np.isfinite(v):
            ax.text(r.get_x() + r.get_width() / 2, r.get_height(), fmt.format(v),
                    ha="center", va="bottom", fontsize=9)
    return b


# --------------------------------------------------------------------------
def ch01(p):
    """The re-anchoring defect, in one figure."""
    fig, axes = plt.subplots(1, 4, figsize=(19.5, 4.9))

    ax = axes[0]
    _bars(ax, ["corrected\n(pinned anchor)", "phase 1\n(re-anchoring)"],
          [100 * p.bos_confirmed.mean(), 100 * p.p1bos_confirmed.mean()],
          [BOS, P1])
    ax.set_title("Confirmation rate on the SAME take-outs\n"
                 "(primary sample, block-scoped window)", fontsize=10)
    ax.set_ylabel("% of take-outs")
    ax.grid(axis="y", alpha=.3)

    ax = axes[1]
    _bars(ax, ["same level\nAT the take-out", "same level\nWHEN it fires"],
          [100 * p.p1bos_agrees_at_t0.mean(),
           100 * p[p.p1bos_confirmed].p1bos_same_level_as_corrected.mean()],
          ["#8a8f94", P1])
    ax.set_title("Which level was phase 1 testing?\n"
                 "identical rule at t0, different level by the break", fontsize=10)
    ax.set_ylabel("% of take-outs")
    ax.set_ylim(0, 105)
    ax.grid(axis="y", alpha=.3)

    ax = axes[2]
    r = p[p.p1bos_confirmed].p1bos_reanchors.clip(0, 10)
    ax.hist(r, bins=np.arange(-.5, 11.5), color=P1, alpha=.85)
    ax.set_title("Pivots that overwrote phase 1's level\n"
                 "between the take-out and its break", fontsize=10)
    ax.set_xlabel("re-anchorings (clipped at 10)")
    ax.set_ylabel("events")
    ax.grid(axis="y", alpha=.3)

    ax = axes[3]
    x = np.arange(3)
    w = .38
    cb = p[p.bos_confirmed]; c1 = p[p.p1bos_confirmed]
    v_c = [cb.bos_delay_bars.median(), cb.bos_stop_atr.median(), cb.bos_R.median()]
    v_1 = [c1.p1bos_delay_bars.median(), c1.p1bos_stop_atr.median(), c1.p1bos_R.median()]
    ax.bar(x - w / 2, v_c, w, color=BOS, label="corrected")
    ax.bar(x + w / 2, v_1, w, color=P1, label="phase 1")
    for xi, (a_, b_) in enumerate(zip(v_c, v_1)):
        ax.text(xi - w / 2, a_, f"{a_:.2f}", ha="center", va="bottom", fontsize=8.5)
        ax.text(xi + w / 2, b_, f"{b_:.2f}", ha="center", va="bottom", fontsize=8.5)
    ax.set_xticks(x)
    ax.set_xticklabels(["delay (bars)", "stop (ATR)", "R proxy"])
    ax.set_title("Medians on each arm's own confirmed set\n"
                 "the correction makes BoS RARER and WIDER, not later", fontsize=10)
    ax.legend(fontsize=8)
    ax.grid(axis="y", alpha=.3)

    fig.suptitle("01 — the re-anchoring defect: phase-1 BoS was testing a level "
                 "that moved. Same take-outs, same horizon, same k=3 pivots.",
                 fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .93))
    _save(fig, "01_the_defect.png")


def ch02(p):
    """Where the anchor lands, and what that costs."""
    fig, axes = plt.subplots(1, 3, figsize=(16.5, 4.9))

    ax = axes[0]
    ax.hist(p.bos_anchor_age_bars.dropna().clip(0, 40),
            bins=np.arange(-.5, 41), color="#7b5ea7", alpha=.85)
    ax.axvline(C.PIVOT_K, color="#111", ls="--", lw=1.4,
               label=f"k = {C.PIVOT_K} (the freshest possible anchor)")
    ax.set_title("Anchor age: bars from the anchor pivot\nto the take-out bar",
                 fontsize=10)
    ax.set_xlabel("bars"); ax.set_ylabel("events")
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    ax = axes[1]
    ax.hist(p.bos_anchor_dist_atr.dropna().clip(0, 12), bins=48,
            color="#7b5ea7", alpha=.85)
    ax.axvline(p.bos_anchor_dist_atr.median(), color="#111", ls="--", lw=1.4,
               label=f"median {p.bos_anchor_dist_atr.median():.2f} ATR")
    ax.set_title("How far the pinned ray sits from the take-out wick\n"
                 "(this is the distance a break must travel)", fontsize=10)
    ax.set_xlabel("ATR(14, 5m)"); ax.set_ylabel("events")
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    ax = axes[2]
    q = pd.qcut(p.bos_anchor_dist_atr, 10, duplicates="drop")
    g = p.groupby(q, observed=True).agg(rate=("bos_confirmed", "mean"),
                                        mid=("bos_anchor_dist_atr", "median"))
    ax.plot(g.mid, 100 * g.rate, "o-", color=BOS, lw=2)
    ax.set_title("Break rate falls off with anchor distance\n"
                 "(deciles of anchor distance)", fontsize=10)
    ax.set_xlabel("anchor distance, ATR (decile median)")
    ax.set_ylabel("% broken before block end")
    ax.grid(alpha=.3)

    fig.suptitle("02 — the anchor: always fresh in time (median "
                 f"{p.bos_anchor_age_bars.median():.0f} bars), never close in price "
                 f"(median {p.bos_anchor_dist_atr.median():.2f} ATR)", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .92))
    _save(fig, "02_the_anchor.png")


def ch03(p):
    """Rate grid, corrected BoS beside iFVG."""
    fig, axes = plt.subplots(1, 3, figsize=(17.5, 4.6))
    grids = [("corrected BoS", "bos_confirmed"), ("iFVG v4", "ifvg_confirmed"),
             ("phase-1 BoS", "p1bos_confirmed")]
    for ax, (lbl, col) in zip(axes, grids):
        t = (p.pivot_table(index="level_session", columns="sweep_block",
                           values=col, aggfunc="mean")
              .reindex(index=SESS_ORD, columns=BLOCK_ORD) * 100)
        im = ax.imshow(t.values, cmap="viridis", vmin=0, vmax=95)
        ax.set_xticks(range(len(BLOCK_ORD))); ax.set_xticklabels(BLOCK_ORD)
        ax.set_yticks(range(len(SESS_ORD))); ax.set_yticklabels(SESS_ORD)
        for i in range(t.shape[0]):
            for j in range(t.shape[1]):
                v = t.values[i, j]
                if np.isfinite(v):
                    ax.text(j, i, f"{v:.0f}", ha="center", va="center",
                            color="w" if v < 60 else "k", fontsize=9.5)
        ax.set_title(f"{lbl}\nconfirmation rate %", fontsize=10)
        ax.set_xlabel("sweep_block"); ax.set_ylabel("level_session")
        fig.colorbar(im, ax=ax, fraction=.046)
    fig.suptitle("03 — confirmation rate, whose level (rows) x which block the "
                 "take-out happened in (columns)", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .90))
    _save(fig, "03_rate_grid.png")


def ch04(p):
    """Method comparison: agreement, timing, geometry on a fixed event set."""
    fig, axes = plt.subplots(1, 3, figsize=(17.5, 4.9))

    ax = axes[0]
    both = 100 * (p.bos_confirmed & p.ifvg_confirmed).mean()
    b_o = 100 * (p.bos_confirmed & ~p.ifvg_confirmed).mean()
    i_o = 100 * (~p.bos_confirmed & p.ifvg_confirmed).mean()
    nei = 100 * (~p.bos_confirmed & ~p.ifvg_confirmed).mean()
    _bars(ax, ["both", "BoS only", "iFVG only", "neither"],
          [both, b_o, i_o, nei], ["#7b5ea7", BOS, IFVG, BARE])
    ax.set_title("Agreement on the same 21k take-outs\n"
                 "(both methods correctly implemented, first time)", fontsize=10)
    ax.set_ylabel("% of primary take-outs")
    ax.grid(axis="y", alpha=.3)

    ax = axes[1]
    bi = p[p.both_confirmed]
    ax.hist(bi.bos_minus_ifvg_bars.dropna().clip(-72, 72), bins=48,
            color="#7b5ea7", alpha=.85)
    ax.axvline(0, color="#111", lw=1.4)
    ax.axvline(bi.bos_minus_ifvg_bars.median(), color=BOS, ls="--", lw=1.6,
               label=f"median +{bi.bos_minus_ifvg_bars.median():.0f} bars")
    ax.set_title("When both fire: BoS delay minus iFVG delay\n"
                 f"BoS is first on only {100*bi.bos_first.mean():.0f}% of them",
                 fontsize=10)
    ax.set_xlabel("bars (positive = BoS later)"); ax.set_ylabel("events")
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    ax = axes[2]
    x = np.arange(4); w = .38
    v_b = [bi.bos_mfe_atr.median(), bi.bos_mae_atr.median(),
           bi.bos_stop_atr.median(), bi.bos_R.median()]
    v_i = [bi.ifvg_mfe_atr.median(), bi.ifvg_mae_atr.median(),
           bi.ifvg_stop_atr.median(), bi.ifvg_R.median()]
    ax.bar(x - w / 2, v_b, w, color=BOS, label="corrected BoS")
    ax.bar(x + w / 2, v_i, w, color=IFVG, label="iFVG v4")
    for xi, (a_, b_) in enumerate(zip(v_b, v_i)):
        ax.text(xi - w / 2, a_, f"{a_:.2f}", ha="center", va="bottom", fontsize=8.5)
        ax.text(xi + w / 2, b_, f"{b_:.2f}", ha="center", va="bottom", fontsize=8.5)
    ax.set_xticks(x); ax.set_xticklabels(["MFE (ATR)", "MAE (ATR)",
                                          "stop (ATR)", "R proxy"])
    ax.set_title(f"Geometry on the {len(bi):,} take-outs BOTH confirm\n"
                 "event set held fixed — this is the entry-reference cost",
                 fontsize=10)
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    fig.suptitle("04 — corrected BoS vs iFVG-v4: two different signals, not two "
                 "readings of one", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .91))
    _save(fig, "04_method_comparison.png")


def ch05(p, up):
    """Selection: the circular picture and the non-circular one."""
    fig, axes = plt.subplots(1, 3, figsize=(17.5, 4.9))

    ax = axes[0]
    cb = p[p.bos_confirmed]
    ax.scatter(cb.bos_anchor_dist_atr.clip(0, 12), cb.rev_atr.clip(0, 25),
               s=3, alpha=.10, color=BOS)
    lim = np.linspace(0, 12, 50)
    ax.plot(lim, lim, color="#111", ls="--", lw=1.6,
            label="rev_atr = anchor distance (the hard floor)")
    ax.set_xlabel("anchor distance (ATR)")
    ax.set_ylabel("wick-anchored reversal rev_atr (ATR)")
    ax.set_title("THE CIRCULARITY: a BoS break cannot happen\n"
                 "unless rev_atr already exceeds the anchor distance",
                 fontsize=10)
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    ax = axes[1]
    m4 = pd.read_csv(os.path.join(C.RESULTS, "m4_lift_vs_unconditional.csv"))
    x = np.arange(len(m4)); w = .27
    ax.bar(x - w, m4.lift_bare_takeout, w, color=BARE, label="bare take-out")
    ax.bar(x, m4.lift_bos, w, color=BOS, label="BoS-confirmed")
    ax.bar(x + w, m4.lift_ifvg, w, color=IFVG, label="iFVG-confirmed")
    ax.axhline(1.0, color="#111", lw=1.2)
    ax.set_xticks(x)
    ax.set_xticklabels([f"{r.sweep_block}\n{r.direction[:2]}"
                        for r in m4.itertuples()], fontsize=7.5)
    ax.set_ylabel("lift vs the block's unconditional median")
    ax.set_title("Wick-anchored lift — CONTAMINATED for BoS\n"
                 "(the bar it clears is the bar being measured)", fontsize=10)
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    ax = axes[2]
    m4e = pd.read_csv(os.path.join(C.RESULTS, "m4e_forward_lift.csv"))
    cols = {"BoS — CORRECTED (pinned anchor, no re-anchoring)": BOS,
            "iFVG — v4 (§5.1, the comparison method)": IFVG,
            "BoS — PHASE 1 (re-anchoring, the defect)": P1}
    labs = ["corrected\nBoS", "iFVG\nv4", "phase-1\nBoS"]
    order = list(cols)
    vals = [m4e.set_index("method").forward_lift_median.get(k, np.nan) for k in order]
    _bars(ax, labs, vals, [cols[k] for k in order], fmt="{:.2f}")
    ax.axhline(1.0, color="#111", lw=1.4,
               label="1.0 = the confirmation told you nothing")
    ax.set_ylabel("median forward MFE / matched unconditional")
    ax.set_title("The NON-CIRCULAR test: move measured only\n"
                 "AFTER the confirmation bar, window-matched", fontsize=10)
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    fig.suptitle("05 — does confirmation SELECT? The left panel is why the "
                 "middle one cannot answer it, and the right one can.",
                 fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .91))
    _save(fig, "05_selection.png")


def ch06(e, p):
    """Window length as the primary axis, plus monthly stability."""
    fig, axes = plt.subplots(1, 3, figsize=(17.5, 4.9))

    ax = axes[0]
    w1 = pd.read_csv(os.path.join(C.RESULTS, "w1_by_window_bucket.csv"))
    x = np.arange(len(w1)); wd = .27
    ax.bar(x - wd, w1.bos_rate, wd, color=BOS, label="corrected BoS")
    ax.bar(x, w1.ifvg_rate, wd, color=IFVG, label="iFVG v4")
    ax.bar(x + wd, w1.p1bos_rate, wd, color=P1, label="phase-1 BoS")
    ax.set_xticks(x); ax.set_xticklabels(w1.bars_remaining, fontsize=8)
    ax.set_xlabel("bars remaining in the block at take-out")
    ax.set_ylabel("confirmation rate %")
    ax.set_title("Window length dominates every method", fontsize=10)
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    ax = axes[1]
    w2 = pd.read_csv(os.path.join(C.RESULTS, "w2_geometry_by_window.csv"))
    ax.plot(w2.bars_remaining, w2.R_median, "o-", color=BOS, lw=2, label="R median")
    ax2 = ax.twinx()
    ax2.plot(w2.bars_remaining, w2.stop_atr_median, "s--", color="#8a6d1f",
             lw=1.6, label="stop (ATR)")
    ax.set_ylabel("R proxy median", color=BOS)
    ax2.set_ylabel("stop proxy median (ATR)", color="#8a6d1f")
    ax.set_title("From-break geometry by window bucket", fontsize=10)
    ax.tick_params(axis="x", labelsize=8)
    ax.grid(alpha=.3)

    ax = axes[2]
    m = pd.read_csv(os.path.join(C.RESULTS, "t12_monthly.csv"))
    ax.plot(range(len(m)), m.bos_rate, color=BOS, lw=1.6, label="corrected BoS")
    ax.plot(range(len(m)), m.ifvg_rate, color=IFVG, lw=1.3, label="iFVG v4")
    ax.plot(range(len(m)), m.p1bos_rate, color=P1, lw=1.3, label="phase-1 BoS")
    step = max(1, len(m) // 8)
    ax.set_xticks(range(0, len(m), step))
    ax.set_xticklabels(m.month[::step], rotation=45, fontsize=7.5)
    ax.set_ylabel("confirmation rate %")
    ax.set_title("Monthly stability", fontsize=10)
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    fig.suptitle("06 — window length is the primary axis; the clock is derived "
                 "from it (chart 07)", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .91))
    _save(fig, "06_window_and_stability.png")


def ch07(e):
    """The clock, stratified."""
    h1 = pd.read_csv(os.path.join(C.RESULTS, "h1_bos_rate_by_hour_stratified.csv"))
    fig, axes = plt.subplots(1, 2, figsize=(15.5, 4.9))

    ax = axes[0]
    ax.bar(h1.hour, h1.bos_rate_ALL, color=BOS, alpha=.85, label="corrected BoS")
    ax.plot(h1.hour, h1.ifvg_rate_ALL, "o-", color=IFVG, lw=1.6, label="iFVG v4")
    for h0, h1_, nm in ((0, 8, "Asia"), (8, 13, "London"), (13, 21, "NY"),
                        (21, 24, "Late")):
        ax.axvspan(h0 - .5, h1_ - .5, color=CS[nm], alpha=.07)
        ax.text((h0 + h1_) / 2 - .5, 2, nm, ha="center", fontsize=8,
                color=CS[nm])
    ax.set_xlabel("take-out hour (UTC)"); ax.set_ylabel("confirmation rate %")
    ax.set_title("UNSTRATIFIED — this chart mostly shows the clock,\n"
                 "i.e. how much block is left at each hour", fontsize=10)
    ax.legend(fontsize=8); ax.grid(axis="y", alpha=.3)

    ax = axes[1]
    for lbl, col in zip(REM_LBL[1:], ["#c0392b", "#e08b3a", "#3f7fbf", "#2e8b57"]):
        c = f"bos_{lbl}"
        if c in h1.columns:
            ax.plot(h1.hour, h1[c], "o-", lw=1.6, color=col, label=f"{lbl} bars left")
    ax.set_xlabel("take-out hour (UTC)"); ax.set_ylabel("BoS rate % within stratum")
    ax.set_title("WINDOW-STRATIFIED — inside a bars-remaining bucket\n"
                 "the hourly pattern largely flattens", fontsize=10)
    ax.legend(fontsize=8); ax.grid(alpha=.3)

    fig.suptitle("07 — the clock is derived: 'no best hour, only a best "
                 "remaining window' (§6.1) holds for BoS too", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, .90))
    _save(fig, "07_hour_of_day.png")


def main():
    e = T.load_events()
    up = T.load_uncond()
    p = e[e.primary].copy()
    ch01(p); ch02(p); ch03(p); ch04(p); ch05(p, up); ch06(e, p); ch07(e)


if __name__ == "__main__":
    main()
