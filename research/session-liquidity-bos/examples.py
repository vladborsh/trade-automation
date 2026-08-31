#!/usr/bin/env python3
"""Worked-example chart renderer — session-liquidity **BoS pass**. AUDIT SURFACE.

Forked from `research/session-liquidity-v4/examples.py`; the candle/session
plumbing survives, what a panel shows is rebuilt around the BoS mechanic.

**The anchored ray is drawn on EVERY panel.** That is not decoration: the
correction note's own classification says the reason phase 1's re-anchoring
defect stayed invisible for a whole pass is that `draw_event()` never rendered
the level being watched, so no worked example could contradict it. Rendering
the ray *is* part of the fix, and the gallery is where the reader can check
that the anchor obeys DESIGN.md §1 bar by bar.

What a panel draws:

  * the **swept level** — the fixed boundary, dashed black;
  * the **pinned BoS anchor**, as a solid horizontal ray starting at its own
    pivot bar and extending forward to the break bar (or to the window end
    when it never breaks), with a marker on the pivot bar itself. This ray is
    chosen once, at the take-out bar, and never moves;
  * **phase 1's tested level as a stepped red line** over the same window —
    the level that *did* move. Where the red steps away from the green ray, a
    newly confirmed pivot has silently re-anchored phase 1's test;
  * the **take-out bar** as a vertical marker and the block-scoped window
    (shaded, ending at the block-end vertical). Deliberately **no star on the
    take-out wick** (user preference);
  * the **BoS break close** (circle) and, for the method comparison, the
    **iFVG confirmation close** (diamond).

Panels are rendered for broken AND unbroken take-outs alike — the failures are
the more informative pictures.

Usage: .venv/bin/python research/session-liquidity-bos/examples.py
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

CS = {"Asia": "#e08b3a", "London": "#3f7fbf", "NY": "#7b5ea7", "Late": "#9aa0a6"}
RAY = "#2e8b57"        # the pinned anchor ray (corrected mechanic)
P1C = "#c0392b"        # phase 1's moving level
IFC = "#3f7fbf"        # the iFVG comparison
PRE, POST = 55, 25     # bars of context before the take-out / after the block end


def candles(ax, d):
    xs = mdates.date2num(d["ts"].dt.tz_localize(None).to_numpy())
    w = (xs[1] - xs[0]) * 0.62
    for x, o, h, l, c in zip(xs, d.open, d.high, d.low, d.close):
        col = "#2e8b57" if c >= o else "#c0392b"
        ax.plot([x, x], [l, h], color=col, lw=0.8, zorder=2)
        ax.add_patch(Rectangle((x - w / 2, min(o, c)), w, max(abs(c - o), 1e-9),
                               facecolor=col, edgecolor=col, lw=0.4, zorder=3))
    ax.xaxis_date()
    return xs


def outcome_label(ev) -> str:
    if not ev.bos_anchorable:
        return ("UNANCHORABLE — no confirmed opposing pivot existed before the "
                "take-out (DESIGN §1 pin 4)")
    if ev.bos_confirmed:
        if pd.isna(ev.bos_R):
            return "BROKE on the block's last bar (no window left to measure)"
        return ("BROKE — R>=1" if ev.bos_R >= 1 else "BROKE — R<1 (the break "
                "did not pay for its stop)")
    return "NO BREAK — price never closed through the pinned ray before the block ended"


def _ray(ax, xs, y, j0, j1, color, lw, ls, label=None, zorder=6):
    j0 = max(0, min(j0, len(xs) - 1)); j1 = max(0, min(j1, len(xs) - 1))
    ax.plot([xs[j0], xs[j1]], [y, y], color=color, lw=lw, ls=ls, zorder=zorder,
            label=label, solid_capstyle="butt")


def draw_event(sym, d, sess, p1, ev, out, tag):
    i = int(ev.bar); be = int(ev.block_end_bar)
    side = "high" if ev.direction == "high_sweep" else "low"
    lo_i, hi_i = max(0, i - PRE), min(len(d) - 1, be + POST)
    w = d.iloc[lo_i:hi_i + 1].reset_index(drop=True)
    fig, (ax, zax) = plt.subplots(1, 2, figsize=(19, 8.2),
                                  gridspec_kw=dict(width_ratios=[2.55, 1], wspace=0.13))
    xs = candles(ax, w)
    x0, x1 = xs[0], xs[-1]
    j = i - lo_i                       # take-out bar, in window coordinates
    jb = be - lo_i                     # block end, in window coordinates

    # --- session rectangles in view (solid = closed at take-out = usable) ---
    t_take = w.ts.iloc[j]
    vis = sess[(sess.t_end >= w.ts.iloc[0]) & (sess.t_start <= w.ts.iloc[-1])]
    for _, rr in vis.iterrows():
        a = max(mdates.date2num(rr.t_start.to_pydatetime()), x0)
        b = min(mdates.date2num(rr.t_end.to_pydatetime()), x1)
        closed = rr.t_end < t_take
        ax.add_patch(Rectangle((a, rr.low), b - a, rr.high - rr.low,
                               facecolor=CS[rr.session], alpha=.10 if closed else .04,
                               edgecolor=CS[rr.session], lw=1.2 if closed else 0.9,
                               ls="-" if closed else ":", zorder=1))
        ax.text(a, rr.high, f" {rr.session} {rr.t_start:%m-%d}"
                            + ("" if closed else " (still forming at take-out)"),
                color=CS[rr.session], fontsize=8, va="bottom",
                alpha=1.0 if closed else .6, zorder=6)

    # --- the block-scoped window --------------------------------------------
    ax.axvspan(xs[j], xs[jb], color="#ffe08a", alpha=.22, zorder=0,
               label=f"block-scoped window -> end of {ev.sweep_block} "
                     f"({int(ev.bars_remaining)} bars = {int(ev.window_min)}m)")
    ax.axvline(xs[jb], color="#8a6d1f", ls="-.", lw=1.4, zorder=4,
               label=f"{ev.sweep_block} block ends ({w.ts.iloc[jb]:%H:%M} UTC)")
    # the take-out bar itself — a vertical marker, NOT a star on the wick
    ax.axvline(xs[j], color="#111", ls=":", lw=1.5, zorder=5,
               label=f"take-out bar t0 ({ev.excursion_atr:.2f} ATR beyond the "
                     f"boundary) — the anchor is chosen HERE and never again")

    # --- the swept level: the fixed boundary --------------------------------
    ax.axhline(ev.level_px, color="#111", ls="--", lw=1.7, zorder=6,
               label=f"swept {ev.level_session} {side} = {ev.level_px:g} "
                     f"(age {ev.level_age_h:.1f}h, {int(ev.n_levels_taken)} level(s) taken)")

    # --- THE PINNED ANCHOR RAY (the whole point of this pass) ---------------
    if ev.bos_anchorable:
        ab = int(ev.bos_anchor_bar) - lo_i
        acb = int(ev.bos_anchor_conf_bar) - lo_i
        end_j = (int(ev.bos_break_bar) - lo_i) if ev.bos_confirmed else jb
        _ray(ax, xs, ev.bos_anchor_px, ab, end_j, RAY, 2.6, "-",
             label=f"PINNED BoS ANCHOR — {'pivot low' if side == 'high' else 'pivot high'} "
                   f"at {ev.bos_anchor_px:g}, {int(ev.bos_anchor_age_bars)} bars before t0, "
                   f"{ev.bos_anchor_dist_atr:.2f} ATR away. Fixed for the event's life.",
             zorder=7)
        if 0 <= ab < len(w):
            ax.scatter([xs[ab]], [ev.bos_anchor_px], marker="v" if side == "low" else "^",
                       s=150, color=RAY, zorder=9)
        if 0 <= acb < len(w):
            ax.axvline(xs[acb], color=RAY, ls=":", lw=1.0, alpha=.7, zorder=4)
            ax.text(xs[acb], 0.02, " anchor confirmed", color=RAY,
                    fontsize=7.5, rotation=90, va="bottom", zorder=7,
                    transform=ax.get_xaxis_transform())
    else:
        ax.text(xs[j], w.close.iloc[j], "  UNANCHORABLE", color=P1C,
                fontsize=11, fontweight="bold", zorder=9)

    # --- phase 1's level, as it MOVED ---------------------------------------
    act = p1["act_lo_at" if side == "high" else "act_hi_at"][lo_i:hi_i + 1]
    seg = np.arange(j, jb + 1)
    ax.step(xs[seg], act[seg], where="post", color=P1C, lw=1.5, alpha=.85,
            zorder=5,
            label="phase-1's tested level — it MOVES every time a new pivot "
                  f"confirms ({int(ev.p1bos_reanchors)} time(s) in this window)")
    if ev.p1bos_confirmed:
        u1 = j + int(ev.p1bos_delay_bars)
        if 0 <= u1 < len(w):
            ax.scatter([xs[u1]], [w.close.iloc[u1]], marker="x", s=130, zorder=9,
                       color=P1C, lw=2.4,
                       label=f"phase-1 BoS fires (+{int(ev.p1bos_delay_bars)} bars)")

    # --- the corrected break, and the iFVG for comparison -------------------
    if ev.bos_confirmed:
        u = j + int(ev.bos_delay_bars)
        if 0 <= u < len(w):
            ax.scatter([xs[u]], [w.close.iloc[u]], marker="o", s=170, zorder=10,
                       facecolor="none", edgecolor=RAY, lw=3.0,
                       label=f"BoS BREAK close (+{int(ev.bos_delay_bars)} bars "
                             f"= {int(ev.bos_delay_bars)*C.BAR_MIN}m) — a full close "
                             f"through the ray")
    if ev.ifvg_confirmed:
        u2 = j + int(ev.ifvg_delay_bars)
        if 0 <= u2 < len(w):
            ax.scatter([xs[u2]], [w.close.iloc[u2]], marker="D", s=70, zorder=9,
                       facecolor="none", edgecolor=IFC, lw=2.0,
                       label=f"iFVG-v4 confirmation (+{int(ev.ifvg_delay_bars)} bars) "
                             f"— the comparison method")

    # --- zoom panel: anchor pivot .. break ----------------------------------
    if ev.bos_anchorable:
        f0 = int(ev.bos_anchor_bar) - lo_i
    else:
        f0 = j
    f1 = (int(ev.bos_break_bar) - lo_i) if ev.bos_confirmed else min(jb, j + 60)
    z0, z1 = max(0, min(f0, j) - 6), min(len(w) - 1, max(f1, j) + 10)
    zw = w.iloc[z0:z1 + 1].reset_index(drop=True)
    zxs = candles(zax, zw)
    zax.axhline(ev.level_px, color="#111", ls="--", lw=1.6, zorder=6)
    zax.axvline(zxs[max(0, min(j - z0, len(zw) - 1))], color="#111", ls=":", lw=1.4,
                zorder=5)
    if ev.bos_anchorable:
        _ray(zax, zxs, ev.bos_anchor_px, f0 - z0,
             (f1 - z0) if ev.bos_confirmed else len(zw) - 1, RAY, 2.6, "-")
        if 0 <= f0 - z0 < len(zw):
            zax.scatter([zxs[f0 - z0]], [ev.bos_anchor_px],
                        marker="v" if side == "low" else "^", s=140, color=RAY,
                        zorder=9)
    zseg = np.arange(max(0, j - z0), len(zw))
    zax.step(zxs[zseg], act[z0:z1 + 1][zseg], where="post", color=P1C, lw=1.4,
             alpha=.85, zorder=5)
    if ev.bos_confirmed and 0 <= f1 - z0 < len(zw):
        zax.scatter([zxs[f1 - z0]], [zw.close.iloc[f1 - z0]], marker="o", s=150,
                    zorder=10, facecolor="none", edgecolor=RAY, lw=2.8)
    zax.set_title("ZOOM — green ray = the PINNED anchor (never moves);\n"
                  "red step = phase 1's level (moves); dotted vertical = t0;\n"
                  "dashed horizontal = the swept boundary", fontsize=8.5, pad=6)
    zax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    zax.tick_params(labelsize=7)
    zax.grid(alpha=.25)

    # --- title ---------------------------------------------------------------
    line2 = (f"wick view: reverse {ev.rev_atr:.2f} / continuation {ev.adv_atr:.2f} ATR"
             if ev.bars_remaining > 0 else "wick view: no window")
    if ev.bos_confirmed and np.isfinite(ev.bos_R):
        line2 += (f"   ||   from the BREAK close: MFE {ev.bos_mfe_atr:.2f} / "
                  f"MAE {ev.bos_mae_atr:.2f} / stop {ev.bos_stop_atr:.2f} ATR "
                  f"-> R {ev.bos_R:.2f}")
    p1lab = (f"fired +{int(ev.p1bos_delay_bars)} bars on "
             f"{'the SAME level' if ev.p1bos_same_level_as_corrected else 'a RE-ANCHORED level'}"
             if ev.p1bos_confirmed else "never fired")
    iflab = (f"confirmed +{int(ev.ifvg_delay_bars)} bars"
             if ev.ifvg_confirmed else "unconfirmed")
    fig.suptitle(
        f"{sym} 5m — {ev.direction.replace('_', ' ')} of the {ev.level_session} {side} "
        f"· {ev.ts:%Y-%m-%d %H:%M} UTC · swept in the {ev.sweep_block} block\n"
        f"{outcome_label(ev)}   ||   {line2}\n"
        f"anchor: {'pivot low' if side == 'high' else 'pivot high'} "
        f"{int(ev.bos_anchor_age_bars) if ev.bos_anchorable else '-'} bars before t0, "
        f"{ev.bos_anchor_dist_atr:.2f} ATR from the take-out wick   |   "
        f"phase-1 BoS: {p1lab} ({int(ev.p1bos_reanchors)} re-anchoring(s))   |   "
        f"iFVG-v4: {iflab}\n{tag}", fontsize=10.0, y=.985)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
    ax.grid(alpha=.25)
    h, l = ax.get_legend_handles_labels()
    seen = dict(zip(l, h))
    seen.pop(None, None)
    ax.legend(seen.values(), seen.keys(), fontsize=7.0, loc="best", framealpha=.9)
    fig.subplots_adjust(left=.048, right=.985, top=.800, bottom=.075)
    fig.savefig(out, dpi=118)
    plt.close(fig)
    print("wrote", out)


class Loader:
    """Per-symbol cache of everything draw_event needs."""

    def __init__(self):
        self.cache = {}

    def get(self, sym):
        if sym not in self.cache:
            d = C.prep(C.load(sym))
            pv = C.pivots(d)
            self.cache[sym] = (d, C.session_frames(d), E.phase1_bos_arrays(d, pv))
        return self.cache[sym]

    def render(self, ev, name, tag):
        d, sess, p1 = self.get(ev.symbol)
        draw_event(ev.symbol, d, sess, p1, ev, os.path.join(C.VIZ, name), tag)
        return name


def main():
    """Hand-picked teaching panels — one per mechanic the report describes.
    The unbiased, stratified audit set is `gallery.py`."""
    e = T.load_events()
    p = e[e.primary]
    L = Loader()
    picks = []

    P = p[p.bos_confirmed & (p.bos_R > 2) & (p.bars_remaining > 60)
          & (p.bos_delay_bars.between(10, 40))]
    picks.append(("01", P.sort_values("bos_R", ascending=False).iloc[6],
                  "textbook: the leg into the take-out, the pinned ray under it, "
                  "and one close back through it"))
    P = p[p.bos_confirmed & (p.p1bos_reanchors >= 3) & p.p1bos_confirmed
          & ((p.bos_delay_bars - p.p1bos_delay_bars) >= 20)]
    picks.append(("02", P.sort_values("p1bos_reanchors", ascending=False).iloc[5],
                  "THE DEFECT ON ONE CHART: the red step-line walks away from the "
                  "green ray and phase 1 fires far too early, on a level nobody "
                  "was watching at the take-out"))
    P = p[p.bos_confirmed & (p.bos_anchor_age_bars >= 8)
          & (p.bos_anchor_dist_atr > p.bos_anchor_dist_atr.median())
          & (p.bos_delay_bars >= 15) & (p.bos_R > 1)]
    picks.append(("03", P.sort_values("bos_anchor_age_bars", ascending=False).iloc[10],
                  "THE USER'S SKETCH: a clear leg into the sweep, the ray drawn "
                  "forward from the last opposing pivot BEFORE the extreme, and "
                  "the break on the reversal"))
    P = p[~p.bos_confirmed & p.p1bos_confirmed & (p.p1bos_reanchors >= 2)]
    picks.append(("04", P.sort_values("rev_atr").iloc[len(P) // 2],
                  "PHASE-1 FALSE POSITIVE: phase 1 calls a BoS, the pinned ray is "
                  "never touched — 48.8% of primary take-outs look like this"))
    P = p[~p.bos_confirmed & p.ifvg_confirmed & (p.rev_atr < 2)]
    picks.append(("05", P.sort_values("ifvg_delay_bars").iloc[len(P) // 2],
                  "iFVG ONLY: the gap inverts near the boundary while the ray, "
                  "several ATR below, is never reached"))
    P = p[p.bos_confirmed & ~p.ifvg_confirmed & (p.bos_R > 1)]
    picks.append(("06", P.sort_values("rev_atr", ascending=False).iloc[8],
                  "BoS ONLY: a large, clean reversal with no qualifying gap — the "
                  "18% of take-outs where BoS is the only confirmation available"))

    for tag, ev, note in picks:
        name = (f"ex{tag}_{ev.symbol}_{ev.ts:%Y%m%d_%H%M}_"
                f"{'hi' if ev.direction == 'high_sweep' else 'lo'}.png")
        L.render(ev, name, f"teaching example {tag} — {note}")


if __name__ == "__main__":
    main()
