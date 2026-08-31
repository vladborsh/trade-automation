#!/usr/bin/env python3
"""Distribution / comparison charts for the session-liquidity study.

Writes viz/02..09_*.png. Example event charts live in examples.py.
Usage: .venv/bin/python research/session-liquidity/charts.py
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
SWEEP_ORD = T.SWEEP_ORD
CS = {"Asia": "#e08b3a", "London": "#3f7fbf", "NY": "#7b5ea7",
      "London/NY overlap": "#5aa08c", "off-session": "#9aa0a6"}
CM = {"iFVG": "#c0392b", "BoS": "#2e6da4", "both": "#7b5ea7", "neither": "#9aa0a6"}


def _save(fig, name):
    p = os.path.join(C.VIZ, name)
    fig.tight_layout()
    fig.savefig(p, dpi=130)
    plt.close(fig)
    print("wrote", p)


def ch02(e):
    fig, axes = plt.subplots(1, 2, figsize=(14, 5), sharey=True)
    for ax, dr in zip(axes, ["high_sweep", "low_sweep"]):
        sub = e[e.direction == dr]
        piv = sub.pivot_table(index="symbol", columns="level_session",
                              values="bar", aggfunc="size").reindex(columns=SESS_ORD)
        x = np.arange(len(piv)); w = 0.26
        for i, s in enumerate(SESS_ORD):
            ax.bar(x + (i - 1) * w, piv[s], w, label=s, color=CS[s])
        ax.set_xticks(x); ax.set_xticklabels(piv.index, rotation=0)
        ax.set_title(f"{dr}  (n={len(sub):,})")
        ax.grid(axis="y", alpha=.3)
    axes[0].set_ylabel("take-out events, 2022-08 .. 2026-07")
    axes[0].legend(title="level's session")
    fig.suptitle("Chart 02 — Sweep (take-out) frequency by asset, level session and direction",
                 fontsize=13)
    _save(fig, "02_frequency_by_session.png")


def ch03(e):
    fig, ax = plt.subplots(figsize=(11, 5.5))
    cats = ["ifvg_confirmed", "bos_confirmed", "both", "neither"]
    lbl = ["iFVG fires", "BoS fires", "both fire", "neither"]
    col = [CM["iFVG"], CM["BoS"], CM["both"], CM["neither"]]
    x = np.arange(len(SESS_ORD)); w = 0.2
    for i, (c, l, k) in enumerate(zip(cats, lbl, col)):
        v = [100 * e.loc[e.level_session == s, c].mean() for s in SESS_ORD]
        b = ax.bar(x + (i - 1.5) * w, v, w, label=l, color=k)
        ax.bar_label(b, fmt="%.0f%%", fontsize=8)
    ax.set_xticks(x); ax.set_xticklabels(SESS_ORD)
    ax.set_ylabel("% of take-outs confirmed within 2h")
    ax.set_title("Chart 03 — Confirmation rate by method and session\n"
                 "iFVG and BoS are computed independently over the same tape; "
                 "'both'/'neither' are the overlap cells")
    ax.legend(); ax.grid(axis="y", alpha=.3)
    _save(fig, "03_confirmation_rates.png")


def ch04(e, u):
    fig, axes = plt.subplots(1, 2, figsize=(14, 5.5), sharey=True)
    for ax, dr, ucol, nm in zip(axes, ["high_sweep", "low_sweep"],
                                ["down_atr", "up_atr"],
                                ["High sweeps — downward reverse move",
                                 "Low sweeps — upward reverse move"]):
        data = [e.loc[(e.direction == dr) & (e.level_session == s), "rev_atr"].values
                for s in SESS_ORD]
        bp = ax.boxplot(data, tick_labels=SESS_ORD, showfliers=False, widths=.55,
                        patch_artist=True, medianprops=dict(color="black", lw=2))
        for p, s in zip(bp["boxes"], SESS_ORD):
            p.set_facecolor(CS[s]); p.set_alpha(.7)
        base = u[ucol].median()
        ax.axhline(base, color="#c0392b", ls="--", lw=1.4,
                   label=f"unconditional median ({base:.2f} ATR)")
        ax.set_title(nm); ax.grid(axis="y", alpha=.3); ax.legend(fontsize=8)
    axes[0].set_ylabel("reverse move in ATR(14) multiples\n(from the sweep wick extreme, 2h)")
    fig.suptitle("Chart 04 — Reverse-move magnitude by session and direction "
                 "(all take-outs, whiskers = 1.5 IQR, fliers hidden)", fontsize=13)
    _save(fig, "04_rev_distributions.png")


def ch05(e):
    fig, axes = plt.subplots(1, 3, figsize=(16, 5.2))
    groups = [("ALL", pd.Series(True, index=e.index)), ("iFVG", e.ifvg_confirmed),
              ("BoS", e.bos_confirmed), ("both", e.both), ("neither", e.neither)]
    ax = axes[0]
    bp = ax.boxplot([e.loc[m, "rev_atr"].values for _, m in groups],
                    tick_labels=[g for g, _ in groups], showfliers=False,
                    patch_artist=True, medianprops=dict(color="black", lw=2))
    for p, (g, _) in zip(bp["boxes"], groups):
        p.set_facecolor(CM.get(g, "#b0b0b0")); p.set_alpha(.7)
    ax.set_title("(a) From the sweep wick extreme\n(the spec's primary reference)")
    ax.set_ylabel("ATR(14) multiples"); ax.grid(axis="y", alpha=.3)

    ax = axes[1]
    d = [e.ifvg_mfe_atr.dropna(), e.ifvg_mae_atr.dropna(),
         e.bos_mfe_atr.dropna(), e.bos_mae_atr.dropna()]
    bp = ax.boxplot(d, tick_labels=["iFVG\nMFE", "iFVG\nMAE", "BoS\nMFE", "BoS\nMAE"],
                    showfliers=False, patch_artist=True,
                    medianprops=dict(color="black", lw=2))
    for p, c in zip(bp["boxes"], [CM["iFVG"], "#e0a0a0", CM["BoS"], "#a8c4dd"]):
        p.set_facecolor(c); p.set_alpha(.8)
    ax.set_title("(b) From the confirmation close\n(what a signal-taker actually gets)")
    ax.grid(axis="y", alpha=.3)

    ax = axes[2]
    for m, c in (("ifvg", CM["iFVG"]), ("bos", CM["BoS"])):
        R = e[f"{m}_R"].dropna().clip(0, 5).sort_values()
        ax.plot(R.values, np.linspace(0, 1, len(R)), color=c, lw=2,
                label=f"{m.upper()}  median {R.median():.2f}")
    ax.axvline(1, color="#555", ls=":", lw=1)
    ax.set_xlabel("R = 2h MFE / stop distance to the sweep-leg extreme")
    ax.set_ylabel("cumulative share of confirmed events")
    ax.set_title("(c) R proxy, CDF (lower curve = better)")
    ax.legend(); ax.grid(alpha=.3)
    fig.suptitle("Chart 05 — Method comparison: iFVG vs BoS", fontsize=13)
    _save(fig, "05_method_comparison.png")


def ch06(e):
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.8))
    ax = axes[0]
    bins = np.arange(0, 26) - .5
    ax.hist(e.ifvg_delay_bars.dropna(), bins=bins, alpha=.6, color=CM["iFVG"],
            label=f"iFVG  median {e.ifvg_delay_bars.median():.0f} bars")
    ax.hist(e.bos_delay_bars.dropna(), bins=bins, alpha=.6, color=CM["BoS"],
            label=f"BoS   median {e.bos_delay_bars.median():.0f} bars")
    ax.set_xlabel("bars of 5m from take-out to confirmation")
    ax.set_ylabel("events"); ax.legend(); ax.grid(axis="y", alpha=.3)
    ax.set_title("(a) Take-out → confirmation delay\n(search window capped at 24 bars = 2h)")

    ax = axes[1]
    off = e.loc[e.both, "offset_bars"].dropna()
    ax.hist(off, bins=np.arange(-24, 25) - .5, color=CM["both"], alpha=.8)
    ax.axvline(0, color="black", lw=1)
    ax.set_xlabel("iFVG delay − BoS delay (bars; <0 = iFVG first)")
    ax.set_title(f"(b) Timing offset when BOTH fire (n={len(off):,})\n"
                 f"iFVG first {100*(off<0).mean():.0f}% · same bar "
                 f"{100*(off==0).mean():.0f}% · BoS first {100*(off>0).mean():.0f}%")
    ax.grid(axis="y", alpha=.3)
    fig.suptitle("Chart 06 — Confirmation timing", fontsize=13)
    _save(fig, "06_delay_and_offset.png")


def ch07(e):
    m = e.groupby(["month", "level_session"]).size().unstack().reindex(columns=SESS_ORD).fillna(0)
    rates = e.groupby("month")[["ifvg_confirmed", "bos_confirmed"]].mean() * 100
    fig, axes = plt.subplots(2, 1, figsize=(15, 7.5), sharex=True)
    bot = np.zeros(len(m))
    for s in SESS_ORD:
        axes[0].bar(m.index, m[s], bottom=bot, color=CS[s], label=s)
        bot += m[s].values
    axes[0].set_ylabel("take-outs / month"); axes[0].legend(ncol=3)
    axes[0].set_title("Chart 07 — Monthly stability (all 4 assets)\n(a) take-out counts by level session")
    axes[0].grid(axis="y", alpha=.3)
    axes[1].plot(rates.index, rates.ifvg_confirmed, color=CM["iFVG"], marker="o", ms=3, label="iFVG")
    axes[1].plot(rates.index, rates.bos_confirmed, color=CM["BoS"], marker="o", ms=3, label="BoS")
    axes[1].set_ylabel("confirmation rate, %"); axes[1].set_ylim(0, 70)
    axes[1].legend(); axes[1].grid(alpha=.3)
    axes[1].set_title("(b) confirmation rate by month")
    axes[1].set_xticks(m.index[::3]); axes[1].tick_params(axis="x", rotation=60)
    _save(fig, "07_monthly.png")


def ch08(e, u):
    lift = pd.read_csv(os.path.join(C.RESULTS, "t7b_lift_vs_unconditional.csv"))
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    ax = axes[0]
    x = np.arange(len(SWEEP_ORD)); w = .38
    for i, dr in enumerate(["high_sweep", "low_sweep"]):
        v = [lift[(lift.clock_session == s) & (lift.direction == dr)].cond_rev_atr_median.iloc[0]
             for s in SWEEP_ORD]
        b = ax.bar(x + (i - .5) * w, v, w, label=dr,
                   color=[CM["iFVG"], CM["BoS"]][i], alpha=.85)
        ax.bar_label(b, fmt="%.2f", fontsize=8)
    ax.set_xticks(x); ax.set_xticklabels(SWEEP_ORD, rotation=15, ha="right")
    ax.set_ylabel("median reverse move, ATR"); ax.legend(); ax.grid(axis="y", alpha=.3)
    ax.set_title("(a) Raw median reverse move by the clock session\nthe take-out happens in")

    ax = axes[1]
    for i, dr in enumerate(["high_sweep", "low_sweep"]):
        v = [lift[(lift.clock_session == s) & (lift.direction == dr)].lift.iloc[0]
             for s in SWEEP_ORD]
        b = ax.bar(x + (i - .5) * w, v, w, label=dr,
                   color=[CM["iFVG"], CM["BoS"]][i], alpha=.85)
        ax.bar_label(b, fmt="%.2f", fontsize=8)
    ax.axhline(1, color="black", lw=1, ls="--")
    ax.set_xticks(x); ax.set_xticklabels(SWEEP_ORD, rotation=15, ha="right")
    ax.set_ylim(0.9, 1.5); ax.set_ylabel("lift vs same-session unconditional median")
    ax.legend(); ax.grid(axis="y", alpha=.3)
    ax.set_title("(b) Same numbers normalised by how volatile\nthat clock session is anyway")
    fig.suptitle("Chart 08 — Testing the 'NY and Asia are the good ones' prior", fontsize=13)
    _save(fig, "08_session_prior.png")


def ch09(e, u):
    fig, ax = plt.subplots(figsize=(10, 5.5))
    for dr, ucol, c in (("high_sweep", "down_atr", CM["iFVG"]),
                        ("low_sweep", "up_atr", CM["BoS"])):
        v = e.loc[e.direction == dr, "rev_atr"].clip(0, 12)
        ax.hist(v, bins=60, density=True, histtype="step", lw=2, color=c,
                label=f"sweep {dr} (median {v.median():.2f})")
        ub = u[ucol].clip(0, 12)
        ax.hist(ub, bins=60, density=True, histtype="step", lw=1.4, ls="--",
                color=c, alpha=.6,
                label=f"unconditional {ucol} (median {ub.median():.2f})")
    ax.set_xlabel("2h favourable excursion, ATR(14) multiples")
    ax.set_ylabel("density"); ax.legend(); ax.grid(alpha=.3)
    ax.set_title("Chart 09 — Conditional vs unconditional 2h excursion\n"
                 "context only; take-out bars are themselves high-range bars, "
                 "so part of the shift is selection, not signal")
    _save(fig, "09_conditional_vs_unconditional.png")


def main():
    e = T.load_events(); u = T.load_uncond()
    ch02(e); ch03(e); ch04(e, u); ch05(e); ch06(e); ch07(e); ch08(e, u); ch09(e, u)


if __name__ == "__main__":
    main()
