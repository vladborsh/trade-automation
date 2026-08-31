#!/usr/bin/env python3
"""Worked example charts: real sweep events drawn candle by candle.

Each panel shows, on real 5m klines:
  * the session rectangles (high/low/time bounds) of every session in view;
  * the swept reference level and the take-out bar;
  * k=3 pivot markers (the BoS primitive) and the pivot that BoS broke;
  * the FVG that inverted (iFVG), shaded, with the close-through bar marked;
  * the 2h measurement horizon and the reverse-move / continuation extremes.

Deliberately includes non-reversals as well as clean reversals -- the study is
descriptive, and the failures are the more informative pictures.

Usage: .venv/bin/python research/session-liquidity/examples.py
"""
from __future__ import annotations

import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import Rectangle

import common as C
import engine as E
import tables as T

CS = {"Asia": "#e08b3a", "London": "#3f7fbf", "NY": "#7b5ea7"}
PRE, POST = 60, 40   # bars of context around the event window


def candles(ax, d):
    xs = mdates.date2num(d["ts"].dt.to_pydatetime())
    w = (xs[1] - xs[0]) * 0.62
    for x, o, h, l, c in zip(xs, d.open, d.high, d.low, d.close):
        col = "#2e8b57" if c >= o else "#c0392b"
        ax.plot([x, x], [l, h], color=col, lw=0.8, zorder=2)
        ax.add_patch(Rectangle((x - w / 2, min(o, c)), w, max(abs(c - o), 1e-9),
                               facecolor=col, edgecolor=col, lw=0.4, zorder=3))
    ax.xaxis_date()
    return xs


def draw_event(sym, d, sess, fv, dn, up, ev, out, tag):
    i = int(ev.bar)
    side = "high" if ev.direction == "high_sweep" else "low"
    lo_i, hi_i = max(0, i - PRE), min(len(d) - 1, i + C.HORIZON_BARS + POST)
    w = d.iloc[lo_i:hi_i + 1].reset_index(drop=True)
    fig, ax = plt.subplots(figsize=(16, 7.5))
    xs = candles(ax, w)
    x0 = mdates.date2num(w.ts.iloc[0].to_pydatetime())
    x1 = mdates.date2num(w.ts.iloc[-1].to_pydatetime())

    # --- session rectangles in view -----------------------------------------
    vis = sess[(sess.t_end >= w.ts.iloc[0]) & (sess.t_start <= w.ts.iloc[-1])]
    for _, r in vis.iterrows():
        a = max(mdates.date2num(r.t_start.to_pydatetime()), x0)
        b = min(mdates.date2num(r.t_end.to_pydatetime()), x1)
        ax.add_patch(Rectangle((a, r.low), b - a, r.high - r.low, facecolor=CS[r.session],
                               alpha=.10, edgecolor=CS[r.session], lw=1.2, zorder=1))
        ax.text(a, r.high, f" {r.session} {r.t_start:%m-%d}", color=CS[r.session],
                fontsize=8, va="bottom", zorder=6)

    # --- the swept level -----------------------------------------------------
    ax.axhline(ev.level_px, color="#111", ls="--", lw=1.5, zorder=4,
               label=f"swept {ev.level_session} {side} = {ev.level_px:g} "
                     f"(age {ev.level_age_h:.1f}h)")

    # --- pivots (k=3) --------------------------------------------------------
    ph = w.index[w.piv_hi_conf.fillna(False)]
    pl = w.index[w.piv_lo_conf.fillna(False)]
    ax.scatter(xs[ph - C.K], w.high.iloc[ph - C.K], marker="v", s=42,
               color="#d62728", zorder=5, label="pivot high (k=3, plotted at the bar it marks)")
    ax.scatter(xs[pl - C.K], w.low.iloc[pl - C.K], marker="^", s=42,
               color="#1f77b4", zorder=5, label="pivot low (k=3)")

    # --- take-out bar and horizon -------------------------------------------
    j = i - lo_i
    ref = ev.sweep_ref
    ax.scatter([xs[j]], [ref], marker="*", s=320, color="#111", zorder=7,
               label=f"take-out wick ({ev.excursion_atr:.2f} ATR beyond the level)")
    ax.axvspan(xs[j], xs[min(j + C.HORIZON_BARS, len(w) - 1)], color="#ffe08a",
               alpha=.22, zorder=0, label="2h measurement horizon")

    hz = w.iloc[j + 1:j + 1 + C.HORIZON_BARS]
    if side == "high":
        y_rev, y_adv = hz.low.min(), hz.high.max()
    else:
        y_rev, y_adv = hz.high.max(), hz.low.min()
    ax.axhline(y_rev, color="#2e8b57", lw=1.1, ls=":", zorder=4,
               label=f"2h reverse extreme  ({ev.rev_atr:.2f} ATR)")
    ax.axhline(y_adv, color="#c0392b", lw=1.1, ls=":", zorder=4,
               label=f"2h continuation extreme ({ev.adv_atr:.2f} ATR)")

    # --- confirmations -------------------------------------------------------
    if ev.bos_confirmed:
        b = j + int(ev.bos_delay_bars)
        if 0 <= b < len(w):
            ax.scatter([xs[b]], [w.close.iloc[b]], marker="s", s=90, zorder=7,
                       facecolor="none", edgecolor="#2e6da4", lw=2.2,
                       label=f"BoS confirm (+{int(ev.bos_delay_bars)} bars)")
    if ev.ifvg_confirmed:
        u = j + int(ev.ifvg_delay_bars)
        cidx, form = E.ifvg_confirm(fv, d.close.to_numpy(), i, i + C.CONFIRM_BARS,
                                    ev.level_px, side, strict=True)
        if form >= 0:
            f = form - lo_i
            if side == "high":
                g_lo, g_hi = fv["bull_lo"][form], fv["bull_hi"][form]
            else:
                g_lo, g_hi = fv["bear_lo"][form], fv["bear_hi"][form]
            ax.add_patch(Rectangle((xs[max(f - 2, 0)], g_lo),
                                   xs[min(len(w) - 1, f + 12)] - xs[max(f - 2, 0)],
                                   g_hi - g_lo, facecolor="#c0392b", alpha=.25,
                                   edgecolor="#c0392b", lw=1.2, zorder=4,
                                   label="FVG that inverted"))
        if 0 <= u < len(w):
            ax.scatter([xs[u]], [w.close.iloc[u]], marker="o", s=95, zorder=7,
                       facecolor="none", edgecolor="#c0392b", lw=2.2,
                       label=f"iFVG confirm (+{int(ev.ifvg_delay_bars)} bars)")

    conf = ("iFVG+BoS" if (ev.ifvg_confirmed and ev.bos_confirmed) else
            "iFVG only" if ev.ifvg_confirmed else
            "BoS only" if ev.bos_confirmed else "NO confirmation")
    ax.set_title(
        f"{sym} 5m — {ev.direction.replace('_', ' ')} of the {ev.level_session} "
        f"{side} · {ev.ts:%Y-%m-%d %H:%M} UTC · {conf}\n"
        f"reverse {ev.rev_atr:.2f} ATR / continuation {ev.adv_atr:.2f} ATR / "
        f"close at +2h {ev.end_atr:+.2f} ATR   —   {tag}", fontsize=12)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
    ax.grid(alpha=.25)
    h, l = ax.get_legend_handles_labels()
    seen = dict(zip(l, h))
    ax.legend(seen.values(), seen.keys(), fontsize=8, loc="best", framealpha=.9)
    fig.tight_layout()
    fig.savefig(out, dpi=125)
    plt.close(fig)
    print("wrote", out)


def main():
    e = T.load_events()
    picks = []
    # (label, filter, sort key, ascending) -- deliberately a mix of wins and duds
    P = e[e.ifvg_confirmed & ~e.bos_confirmed & (e.rev_atr > 5)]
    picks.append(("01", P.sort_values("ifvg_R", ascending=False).iloc[0],
                  "textbook iFVG sweep: clean reversal"))
    P = e[e.bos_confirmed & ~e.ifvg_confirmed & (e.rev_atr > 5)]
    picks.append(("02", P.sort_values("bos_R", ascending=False).iloc[0],
                  "textbook BoS sweep: clean reversal"))
    P = e[e.both & (e.rev_atr > 4)]
    picks.append(("03", P.sort_values("offset_bars").iloc[len(P) // 2],
                  "both methods fire — note the timing gap"))
    P = e[e.ifvg_confirmed & (e.adv_atr > 3 * e.rev_atr)]
    picks.append(("04", P.sort_values("adv_atr", ascending=False).iloc[3],
                  "CONFIRMED BUT NO REVERSAL — price ran straight on"))
    P = e[e.bos_confirmed & (e.bos_R < 0.15)]
    picks.append(("05", P.sort_values("bos_stop_atr", ascending=False).iloc[5],
                  "BoS confirms very late — the stop is already huge"))
    P = e[e.neither & (e.rev_atr > 6)]
    picks.append(("06", P.sort_values("rev_atr", ascending=False).iloc[2],
                  "big reversal that NEITHER method caught"))
    P = e[e.neither & (e.adv_atr > 4)]
    picks.append(("07", P.sort_values("adv_atr", ascending=False).iloc[4],
                  "no confirmation, no reversal — the level simply broke"))
    P = e[(e.n_levels_taken >= 3) & e.both]
    ev8 = P.sort_values("rev_atr", ascending=False).iloc[1]
    picks.append(("08", ev8,
                  f"one bar took out {int(ev8.n_levels_taken)} levels at once; the drawn "
                  "line is the attributed (deepest) one"))

    cache = {}
    for tag, ev, note in picks:
        sym = ev.symbol
        if sym not in cache:
            d = C.prep(C.load(sym))
            cache[sym] = (d, C.session_frames(d), E.fvg_arrays(d), *E.bos_flags(d))
        d, sess, fv, dn, up = cache[sym]
        name = (f"ex{tag}_{sym}_{ev.ts:%Y%m%d_%H%M}_"
                f"{'hi' if ev.direction=='high_sweep' else 'lo'}.png")
        draw_event(sym, d, sess, fv, dn, up, ev, os.path.join(C.VIZ, name), note)


if __name__ == "__main__":
    main()
