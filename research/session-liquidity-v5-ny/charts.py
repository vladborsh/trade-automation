#!/usr/bin/env python3
"""Aggregate charts — session-liquidity **v5-NY**. Writes viz/01..06_*.png.

  01  the funnel and the clock — where confirmations actually land, with the
      pinned NY window shaded, and how many take-outs survive to it
  02  THE PRE-REGISTERED RESULT — the observed holdout mean netR against the
      matched-time permutation null, one panel per arm x horizon
  03  the clock, derived — confirmation rate by hour, raw and stratified by
      window length (the standing "no best hour, only a best window" null)
  04  the trades themselves — the netR distribution and the running sum, fit
      vs holdout, both arms
  05  the non-circular forward lift, all hours vs the NY window
  06  block-scoped vs the 24h horizon, side by side

BTC and ETH are foregrounded per DESIGN §2.3; SOL/BNB appear only where a
per-asset panel is the point, and are labelled as the robustness check.

Usage: python research/session-liquidity-v5-ny/charts.py
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

IFVG, BOS, NULLC, WINC = "#3f7fbf", "#2e8b57", "#9aa0a6", "#ffd27f"
NEG, POS = "#c0392b", "#2e8b57"


def _save(fig, name):
    pth = os.path.join(C.VIZ, name)
    fig.savefig(pth, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print("wrote", pth)


def _win_span(ax, win=None):
    win = win or C.NY_WIN_UTC
    ax.axvspan(win[0] / 60, win[1] / 60, color=WINC, alpha=.55, zorder=0,
               label="pinned NY window 13:40–15:20 UTC\n(= 09:40–11:20 New York at UTC−4)")


# --------------------------------------------------------------------------
def ch01(e):
    p = e[e.primary & e.foreground]
    fig, axes = plt.subplots(1, 3, figsize=(19.5, 5.2))

    ax = axes[0]
    steps = ["take-outs", "primary\n(≥12 bars left)", "in NY block",
             "t0 could still\nreach the window", "iFVG conf.\nIN window",
             "BoS conf.\nIN window"]
    vals = [len(e[e.foreground]), len(p), int((p.sweep_block == "NY").sum()),
            int(p.t0_window_eligible.sum()), int(p.ifvg_in_ny.sum()),
            int(p.bos_in_ny.sum())]
    cols = ["#c8c8c8", "#c8c8c8", "#b0b0b0", "#9aa0a6", IFVG, BOS]
    b = ax.bar(range(len(vals)), vals, color=cols)
    for r, v in zip(b, vals):
        ax.text(r.get_x() + r.get_width() / 2, r.get_height(), f"{v:,}",
                ha="center", va="bottom", fontsize=9)
    ax.set_xticks(range(len(steps)))
    ax.set_xticklabels(steps, fontsize=7.6)
    ax.set_title("The eligibility funnel (BTC+ETH)\nthe window is a narrow slice, "
                 "and that is structural, not a choice", fontsize=10)
    ax.set_ylabel("take-outs")
    ax.grid(alpha=.25, axis="y")

    for ax, pre, lab, col in ((axes[1], "ifvg", "iFVG-v4", IFVG),
                              (axes[2], "bos", "BoS pinned anchor", BOS)):
        cc = p[p[f"{pre}_confirmed"]]
        h = cc[f"{pre}_conf_min_utc"] / 60.0
        _win_span(ax)
        ax.hist(h, bins=np.arange(0, 24.25, 0.25), color=col, alpha=.85)
        ax.set_xlim(0, 24)
        ax.set_xlabel("confirmation bar, hour of day (UTC)")
        ax.set_ylabel("confirmations")
        ax.set_title(f"Where {lab} confirmations land on the clock\n"
                     f"{int(cc[f'{pre}_in_ny'].sum()):,} of {len(cc):,} "
                     f"({100*cc[f'{pre}_in_ny'].mean():.1f}%) fall in the window",
                     fontsize=10)
        ax.legend(fontsize=7.5, loc="upper left")
        ax.grid(alpha=.25)
    fig.suptitle("01 — How many sweeps can even reach the 09:40–11:20 New York "
                 "window, and when confirmations actually happen", fontsize=12.5)
    fig.tight_layout(rect=(0, 0, 1, .93))
    _save(fig, "01_funnel_and_clock.png")


# --------------------------------------------------------------------------
def ch02(e):
    """THE headline chart: observed vs the matched-time permutation null.

    The null draws are LOADED from `results/null_draws.npz`, written by
    `hypothesis.py` — never recomputed here, so the p-value on the chart is
    exactly the p-value in the report rather than a fresh draw.
    """
    nz = np.load(os.path.join(C.RESULTS, "null_draws.npz"))
    fig, axes = plt.subplots(2, 2, figsize=(15.5, 9.2))
    combos = [("ifvg", "blk", "iFVG-v4 · block-scoped (PRIMARY)"),
              ("ifvg", "h24", "iFVG-v4 · 24h horizon"),
              ("bos", "blk", "BoS pinned anchor · block-scoped (PRIMARY)"),
              ("bos", "h24", "BoS pinned anchor · 24h horizon")]
    for ax, (pre, h, lab) in zip(axes.ravel(), combos):
        nA = nz[f"{pre}_{h}_nullA"]
        m, pv, n_hold = nz[f"{pre}_{h}_obs"]
        n_hold = int(n_hold)
        ax.hist(nA, bins=45, color=NULLC, alpha=.9,
                label=f"1,000 matched-time placebo runs\n(same window, same side, "
                      f"same stop in ATR,\nrandom date) — mean {np.nanmean(nA):+.3f}R")
        ax.axvline(m, color=NEG if m < 0 else POS, lw=2.8,
                   label=f"OBSERVED holdout mean = {m:+.3f}R  (n={n_hold})")
        ax.axvline(0, color="#111", ls=":", lw=1.4, label="break-even (0R)")
        ax.axvline(0.05, color="#8a6d1f", ls="--", lw=1.6,
                   label="pre-registered kill threshold +0.05R")
        ax.set_title(f"{lab}\np = {pv:.3f} — the placebo beat the real signal in "
                     f"{100*pv:.1f}% of runs", fontsize=10)
        ax.set_xlabel("mean net R per trade (after 0.10% round trip)")
        ax.set_ylabel("permutation runs")
        ax.legend(fontsize=7.0, loc="upper left")
        ax.grid(alpha=.25)
    fig.suptitle("02 — THE PRE-REGISTERED RESULT: every arm sits left of the "
                 "+0.05R kill line, and iFVG sits left of its own placebo",
                 fontsize=12.5)
    fig.tight_layout(rect=(0, 0, 1, .94))
    _save(fig, "02_result_vs_null.png")


# --------------------------------------------------------------------------
def ch03(e):
    p = e[e.primary & e.foreground]
    fig, axes = plt.subplots(1, 2, figsize=(16, 5.2))
    hours = np.arange(24)
    for pre, lab, col in (("ifvg", "iFVG-v4", IFVG), ("bos", "BoS", BOS)):
        r = p.groupby(p.ts.dt.hour)[f"{pre}_confirmed"].mean() * 100
        axes[0].plot(hours, r.reindex(hours).to_numpy(), "-o", ms=4,
                     color=col, label=lab)
    _win_span(axes[0])
    axes[0].set_title("Raw: confirmation rate by take-out hour (UTC)\n"
                      "looks like a clock effect", fontsize=10)
    axes[0].set_xlabel("take-out hour (UTC)"); axes[0].set_ylabel("confirmed, %")
    axes[0].legend(fontsize=7.5); axes[0].grid(alpha=.25)

    long_ = p[p.bars_remaining >= 72]
    for pre, lab, col in (("ifvg", "iFVG-v4", IFVG), ("bos", "BoS", BOS)):
        r = long_.groupby(long_.ts.dt.hour)[f"{pre}_confirmed"].mean() * 100
        axes[1].plot(r.index.to_numpy(), r.to_numpy(), "-o", ms=4, color=col,
                     label=lab)
    _win_span(axes[1])
    axes[1].set_title("Stratified: same rate, only take-outs with ≥72 bars of "
                      "block left\nmost of the shape collapses — it was window "
                      "length, not the clock", fontsize=10)
    axes[1].set_xlabel("take-out hour (UTC)"); axes[1].set_ylabel("confirmed, %")
    axes[1].legend(fontsize=7.5); axes[1].grid(alpha=.25)
    fig.suptitle("03 — The clock is derived: v4's and the BoS pass's "
                 "'no best hour, only a best remaining window' null still holds",
                 fontsize=12.5)
    fig.tight_layout(rect=(0, 0, 1, .92))
    _save(fig, "03_hour_and_window.png")


# --------------------------------------------------------------------------
def ch04(e):
    import hypothesis as H
    fig, axes = plt.subplots(1, 3, figsize=(19.5, 5.2))
    for pre, lab, col in (("ifvg", "iFVG-v4", IFVG), ("bos", "BoS", BOS)):
        q = H.trade_table(e, pre, "blk", C.FOREGROUND).sort_values("ts")
        axes[0].hist(q.netR, bins=np.arange(-2.2, 3.2, 0.12), alpha=.55,
                     color=col, label=f"{lab} (n={len(q)}, mean {q.netR.mean():+.3f}R)")
        axes[1].plot(q.ts.to_numpy(), q.netR.cumsum().to_numpy(), color=col, lw=1.8,
                     label=f"{lab}: {q.netR.sum():+.1f}R over {len(q)} trades")
    axes[0].axvline(0, color="#111", ls=":", lw=1.2)
    axes[0].set_title("Per-trade net R (BTC+ETH, NY window, block horizon)",
                      fontsize=10)
    axes[0].set_xlabel("net R"); axes[0].set_ylabel("trades")
    axes[0].legend(fontsize=7.5); axes[0].grid(alpha=.25)

    axes[1].axvline(pd.Timestamp(C.HOLDOUT_START), color="#111", ls="--", lw=1.6)
    axes[1].text(pd.Timestamp(C.HOLDOUT_START), 0, "  holdout starts\n  2025-08-01",
                 fontsize=8, va="bottom")
    axes[1].axhline(0, color="#111", ls=":", lw=1.2)
    axes[1].set_title("Running sum of net R — no equity curve to speak of",
                      fontsize=10)
    axes[1].set_ylabel("cumulative net R"); axes[1].legend(fontsize=7.5)
    axes[1].grid(alpha=.25)

    rows = []
    for pre, lab in (("ifvg", "iFVG-v4"), ("bos", "BoS")):
        for per in ("fit", "holdout"):
            q = H.trade_table(e, pre, "blk", C.FOREGROUND)
            g = q[q.period == per]
            rows.append((f"{lab}\n{per}", g.grossR.mean(), -g.cost_R.mean()))
    x = np.arange(len(rows))
    w = .27
    axes[2].bar(x - w, [r[1] for r in rows], w, color="#9aa0a6",
                label="gross R, before fees")
    axes[2].bar(x, [r[2] for r in rows], w, color=NEG,
                label="0.10% round-trip cost")
    axes[2].bar(x + w, [r[1] + r[2] for r in rows], w, color="#4a4a4a",
                label="net R (the pre-registered metric)")
    for i, r in enumerate(rows):
        for dx, v in ((-w, r[1]), (0, r[2]), (w, r[1] + r[2])):
            axes[2].text(i + dx, v, f"{v:+.3f}", ha="center", rotation=90,
                         va="top" if v < 0 else "bottom", fontsize=7.5)
    axes[2].set_xticks(x); axes[2].set_xticklabels([r[0] for r in rows], fontsize=8)
    axes[2].axhline(0, color="#111", lw=1.1)
    axes[2].axhline(0.05, color="#8a6d1f", ls="--", lw=1.4,
                    label="kill threshold +0.05R")
    axes[2].set_title("Gross is ~0; the fee is the whole negative", fontsize=10)
    axes[2].set_ylabel("mean R per trade"); axes[2].legend(fontsize=7.5)
    axes[2].grid(alpha=.25, axis="y")
    fig.suptitle("04 — The trades: a flat distribution around zero, a flat "
                 "running sum, and a cost the signal never covers", fontsize=12.5)
    fig.tight_layout(rect=(0, 0, 1, .93))
    _save(fig, "04_trades.png")


# --------------------------------------------------------------------------
def ch05(e, u):
    l1 = pd.read_csv(os.path.join(C.RESULTS, "l1_forward_lift.csv"))
    fig, ax = plt.subplots(figsize=(9.2, 5.4))
    labs, vals, cols = [], [], []
    for _, r in l1.iterrows():
        labs.append(f"{r['arm'].split()[0]}\n{r['scope']}")
        vals.append(r["lift_median"])
        cols.append(IFVG if r["arm"].startswith("iFVG") else BOS)
    b = ax.bar(labs, vals, color=cols, width=.6)
    for rr, v in zip(b, vals):
        ax.text(rr.get_x() + rr.get_width() / 2, rr.get_height(), f"{v:.2f}",
                ha="center", va="bottom", fontsize=10)
    ax.axhline(1.0, color="#111", ls="--", lw=1.8)
    ax.text(len(vals) - .4, 1.005, "1.00 = no better than a random\ncomparable "
            "stretch of the same tape", fontsize=8.5, ha="right", va="bottom")
    ax.set_ylim(0, 1.25)
    ax.set_ylabel("median forward lift (post-confirmation MFE ÷ matched unconditional)")
    ax.set_title("05 — The non-circular forward lift: the NY window lifts it "
                 "from 0.84/0.89 to 0.95/1.00\nbut 1.00 is PAR, not an edge",
                 fontsize=11)
    ax.grid(alpha=.25, axis="y")
    fig.tight_layout()
    _save(fig, "05_forward_lift.png")


# --------------------------------------------------------------------------
def ch06(e):
    p = e[e.primary & e.foreground]
    fig, axes = plt.subplots(1, 3, figsize=(19.5, 5.0))
    for ax, (pre, lab, col) in zip(axes[:2],
                                   (("ifvg", "iFVG-v4", IFVG),
                                    ("bos", "BoS pinned anchor", BOS))):
        cc = p[p[f"{pre}_confirmed"] & p[f"{pre}_in_ny"]]
        xs = ["MFE", "MAE", "end value"]
        blk = [cc[f"{pre}_blk_mfe_atr"].median(), cc[f"{pre}_blk_mae_atr"].median(),
               cc[f"{pre}_blk_end_atr"].median()]
        h24 = [cc[f"{pre}_h24_mfe_atr"].median(), cc[f"{pre}_h24_mae_atr"].median(),
               cc[f"{pre}_h24_end_atr"].median()]
        w = .36
        x = np.arange(3)
        ax.bar(x - w / 2, blk, w, color=col, alpha=.9, label="block-scoped (primary)")
        ax.bar(x + w / 2, h24, w, color=col, alpha=.45, label="24h (appendix)")
        for xi, (a_, b_) in enumerate(zip(blk, h24)):
            ax.text(xi - w / 2, a_, f"{a_:.2f}", ha="center", va="bottom", fontsize=8.5)
            ax.text(xi + w / 2, b_, f"{b_:.2f}", ha="center", va="bottom", fontsize=8.5)
        ax.set_xticks(x); ax.set_xticklabels(xs)
        ax.axhline(0, color="#111", lw=1)
        ax.set_ylabel("ATR(14, 5m), median")
        ax.set_title(f"{lab} — NY window only\nboth excursions grow together; "
                     "the end value barely moves", fontsize=10)
        ax.legend(fontsize=8); ax.grid(alpha=.25, axis="y")

    import hypothesis as H
    ax = axes[2]
    rows = []
    for pre, lab in (("ifvg", "iFVG-v4"), ("bos", "BoS")):
        for h, hl in (("blk", "block"), ("h24", "24h")):
            q = H.trade_table(e, pre, h, C.FOREGROUND)
            hold = q[q.period == "holdout"]
            rows.append((f"{lab}\n{hl}", hold.netR.mean()))
    b = ax.bar([r[0] for r in rows], [r[1] for r in rows],
               color=[NEG if r[1] < 0 else POS for r in rows], width=.6)
    for rr, (_, v) in zip(b, rows):
        ax.text(rr.get_x() + rr.get_width() / 2, v, f"{v:+.3f}", ha="center",
                va="top" if v < 0 else "bottom", fontsize=9)
    ax.axhline(0, color="#111", lw=1.1)
    ax.axhline(0.05, color="#8a6d1f", ls="--", lw=1.5, label="kill threshold +0.05R")
    ax.set_ylabel("holdout mean net R per trade")
    ax.set_title("Letting the trade run 24h does not rescue it", fontsize=10)
    ax.legend(fontsize=8); ax.grid(alpha=.25, axis="y")
    fig.suptitle("06 — The long horizon, side by side with the block-scoped "
                 "primary", fontsize=12.5)
    fig.tight_layout(rect=(0, 0, 1, .93))
    _save(fig, "06_horizons.png")


def main():
    e = T.load_events()
    u = T.load_uncond()
    ch01(e)
    ch02(e)
    ch03(e)
    ch04(e)
    ch05(e, u)
    ch06(e)


if __name__ == "__main__":
    main()
