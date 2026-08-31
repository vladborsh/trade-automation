#!/usr/bin/env python3
"""Worked-example chart renderer — session-liquidity **v2**.

Forked from the phase-1 `research/session-liquidity/examples.py`. The candle
plumbing survives; everything time-scoped is rewritten and **all pivot / BoS
drawing is removed** (BoS is out of scope for v2).

Each panel shows, on real 5m klines, everything the v2 definitions touch:
  * the non-overlapping session rectangles (Asia / London / NY) in view, and
    the boundaries of the take-out's own clock block;
  * the swept reference level and the take-out wick;
  * the BLOCK-SCOPED measurement window, shaded from the take-out bar to the
    block's last bar (this is the v2 horizon — there is no fixed 2h any more);
  * the FVG that inverted, as a zone, plus the bar whose CLOSE inverted it;
  * the reverse / continuation extremes from the wick, and — for confirmed
    events — the MFE/MAE and the stop proxy measured from the confirmation
    close, which is the tradable view.

Deliberately renders non-reversals and unconfirmed take-outs as well as clean
reversals: the study is descriptive and the failures are the more informative
pictures. This is the user's audit surface, not decoration.

Usage: .venv/bin/python research/session-liquidity-v2/examples.py
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
PRE, POST = 45, 25   # bars of context before the take-out / after the block end


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
    """The three buckets the gallery is built from."""
    if not ev.ifvg_confirmed:
        return "UNCONFIRMED take-out"
    if pd.isna(ev.ifvg_R):
        return "confirmed on the block's last bar (no window)"
    return "CONFIRMED — R>=1" if ev.ifvg_R >= 1 else "CONFIRMED — R<1 (failure)"


def draw_event(sym, d, sess, fv, ev, out, tag):
    i = int(ev.bar)
    be = int(ev.block_end_bar)
    side = "high" if ev.direction == "high_sweep" else "low"
    lo_i, hi_i = max(0, i - PRE), min(len(d) - 1, be + POST)
    w = d.iloc[lo_i:hi_i + 1].reset_index(drop=True)
    # Two panels: the full block on the left, a zoom on the sweep -> inversion
    # region on the right. A 5m FVG is a few pixels tall at block scale, so the
    # zoom is where the iFVG geometry is actually auditable; a dedicated panel
    # (rather than an inset) guarantees it never covers the candles.
    fig, (ax, zax) = plt.subplots(1, 2, figsize=(19, 7.8),
                                  gridspec_kw=dict(width_ratios=[2.55, 1], wspace=0.13))
    xs = candles(ax, w)
    x0, x1 = xs[0], xs[-1]
    j = i - lo_i                       # take-out bar, in window coordinates
    jb = be - lo_i                     # block end, in window coordinates

    # --- session rectangles in view (non-overlapping, v2) -------------------
    # A session drawn SOLID had already closed when the take-out printed, so its
    # high/low were in the level pool (V1). A session still forming at that
    # moment is drawn faint and dotted and is NOT a level source for this event —
    # keeping the two visually distinct is what makes the panel auditable.
    t_take = w.ts.iloc[j]
    vis = sess[(sess.t_end >= w.ts.iloc[0]) & (sess.t_start <= w.ts.iloc[-1])]
    for _, r in vis.iterrows():
        a = max(mdates.date2num(r.t_start.to_pydatetime()), x0)
        b = min(mdates.date2num(r.t_end.to_pydatetime()), x1)
        closed = r.t_end < t_take
        ax.add_patch(Rectangle((a, r.low), b - a, r.high - r.low,
                               facecolor=CS[r.session], alpha=.10 if closed else .04,
                               edgecolor=CS[r.session], lw=1.2 if closed else 0.9,
                               ls="-" if closed else ":", zorder=1))
        ax.text(a, r.high, f" {r.session} {r.t_start:%m-%d}"
                           + ("" if closed else " (still forming at take-out)"),
                color=CS[r.session], fontsize=8, va="bottom",
                alpha=1.0 if closed else .6, zorder=6)

    # --- the take-out's own clock block, and the block-scoped window --------
    ax.axvspan(xs[j], xs[jb], color="#ffe08a", alpha=.22, zorder=0,
               label=f"block-scoped window: take-out -> end of {ev.sweep_block} "
                     f"({int(ev.bars_remaining)} bars = {int(ev.window_min)}m)")
    ax.axvline(xs[jb], color="#8a6d1f", ls="-.", lw=1.4, zorder=4,
               label=f"{ev.sweep_block} block ends ({w.ts.iloc[jb]:%H:%M} UTC)")

    # --- the swept level -----------------------------------------------------
    ax.axhline(ev.level_px, color="#111", ls="--", lw=1.5, zorder=4,
               label=f"swept {ev.level_session} {side} = {ev.level_px:g} "
                     f"(age {ev.level_age_h:.1f}h, {int(ev.n_levels_taken)} level(s) taken)")

    # --- take-out wick -------------------------------------------------------
    ref = ev.sweep_ref
    ax.scatter([xs[j]], [ref], marker="*", s=340, color="#111", zorder=8,
               label=f"take-out wick ({ev.excursion_atr:.2f} ATR beyond the level)")

    # --- wick-anchored extremes over the block window ------------------------
    if ev.bars_remaining > 0:
        hz = w.iloc[j + 1:jb + 1]
        if side == "high":
            y_rev, y_adv = hz.low.min(), hz.high.max()
        else:
            y_rev, y_adv = hz.high.max(), hz.low.min()
        ax.plot([xs[j], xs[jb]], [y_rev, y_rev], color="#2e8b57", lw=1.1, ls=":",
                zorder=4, label=f"reverse extreme in-block ({ev.rev_atr:.2f} ATR)")
        ax.plot([xs[j], xs[jb]], [y_adv, y_adv], color="#c0392b", lw=1.1, ls=":",
                zorder=4, label=f"continuation extreme in-block ({ev.adv_atr:.2f} ATR)")

    # --- the iFVG: the gap zone and the close that inverted it ---------------
    if ev.ifvg_confirmed:
        u = j + int(ev.ifvg_delay_bars)
        form = int(ev.ifvg_form_bar)
        f = form - lo_i
        if side == "high":
            g_lo, g_hi = fv["bull_lo"][form], fv["bull_hi"][form]
        else:
            g_lo, g_hi = fv["bear_lo"][form], fv["bear_hi"][form]
        # the gap is drawn from its 3rd bar to the bar that closed through it
        gx0 = xs[max(f - 2, 0)]
        gx1 = xs[min(len(w) - 1, max(u, f + 1))]
        ax.add_patch(Rectangle((gx0, g_lo), gx1 - gx0, g_hi - g_lo,
                               facecolor="#c0392b", alpha=.22,
                               edgecolor="#c0392b", lw=1.4, zorder=4,
                               label=f"FVG that inverted "
                                     f"[{g_lo:g}, {g_hi:g}] — formed +{form - i} bars"))
        if 0 <= u < len(w):
            c0 = w.close.iloc[u]
            ax.scatter([xs[u]], [c0], marker="o", s=110, zorder=8,
                       facecolor="none", edgecolor="#c0392b", lw=2.4,
                       label=f"iFVG inversion CLOSE (+{int(ev.ifvg_delay_bars)} bars "
                             f"= {int(ev.ifvg_delay_bars)*C.BAR_MIN}m) — the entry reference")
            ax.axhline(c0, color="#c0392b", lw=0.9, alpha=.55, zorder=4)
            # stop proxy: the sweep leg's running extreme, take-out .. confirm
            if np.isfinite(ev.ifvg_stop_atr):
                seg = w.iloc[j:u + 1]
                ext = seg.high.max() if side == "high" else seg.low.min()
                ax.plot([xs[j], xs[min(jb, len(w) - 1)]], [ext, ext],
                        color="#7b1fa2", lw=1.2, ls="--", zorder=5,
                        label=f"stop proxy = sweep-leg extreme "
                              f"({ev.ifvg_stop_atr:.2f} ATR from the entry)")

    # --- zoom panel: the take-out -> inversion region ------------------------
    if ev.ifvg_confirmed:
        u = j + int(ev.ifvg_delay_bars)
        form_w = int(ev.ifvg_form_bar) - lo_i
        z0, z1 = max(0, min(form_w, j) - 8), min(len(w) - 1, u + 12)
    else:
        u, form_w = -1, -1
        z0, z1 = max(0, j - 8), min(len(w) - 1, j + 40)
    zw = w.iloc[z0:z1 + 1].reset_index(drop=True)
    zxs = candles(zax, zw)
    zax.axhline(ev.level_px, color="#111", ls="--", lw=1.4, zorder=5)
    if 0 <= j - z0 < len(zw):
        zax.scatter([zxs[j - z0]], [ref], marker="*", s=260, color="#111", zorder=8)
    if ev.ifvg_confirmed:
        fb = int(ev.ifvg_form_bar)
        if side == "high":
            g_lo, g_hi = fv["bull_lo"][fb], fv["bull_hi"][fb]
        else:
            g_lo, g_hi = fv["bear_lo"][fb], fv["bear_hi"][fb]
        gx0 = zxs[max(form_w - z0 - 2, 0)]
        gx1 = zxs[min(len(zw) - 1, max(u - z0, form_w - z0 + 1))]
        zax.add_patch(Rectangle((gx0, g_lo), gx1 - gx0, g_hi - g_lo,
                                facecolor="#c0392b", alpha=.30,
                                edgecolor="#c0392b", lw=1.6, zorder=4))
        if 0 <= u - z0 < len(zw):
            zax.scatter([zxs[u - z0]], [zw.close.iloc[u - z0]], marker="o", s=110,
                        zorder=8, facecolor="none", edgecolor="#c0392b", lw=2.4)
            zax.axhline(zw.close.iloc[u - z0], color="#c0392b", lw=0.9, alpha=.6, zorder=4)
        ztitle = ("ZOOM — swept level (--), take-out wick (*),\n"
                  "the FVG zone and the CLOSE that inverted it (o)")
    else:
        ztitle = ("ZOOM — swept level (--) and take-out wick (*).\n"
                  "No qualifying FVG inverted before the block ended.")
    zax.set_title(ztitle, fontsize=8.5, pad=9)
    zax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    zax.tick_params(labelsize=7)
    zax.grid(alpha=.25)

    # --- title: every number the tables aggregate, for this one event -------
    oc = outcome_label(ev)
    conf = (f"iFVG +{int(ev.ifvg_delay_bars)} bars" if ev.ifvg_confirmed
            else ("no iFVG in-block — would have confirmed with 2h more"
                  if ev.ifvg_would_confirm_extended else "no iFVG in-block"))
    line2 = (f"wick view: reverse {ev.rev_atr:.2f} ATR / continuation {ev.adv_atr:.2f} ATR "
             f"/ at block close {ev.end_atr:+.2f} ATR"
             if ev.bars_remaining > 0 else "wick view: no window (take-out on the block's last bar)")
    if ev.ifvg_confirmed and np.isfinite(ev.ifvg_R):
        line3 = (f"   ||   from the inversion close: MFE {ev.ifvg_mfe_atr:.2f} / "
                 f"MAE {ev.ifvg_mae_atr:.2f} / stop {ev.ifvg_stop_atr:.2f} ATR -> "
                 f"R {ev.ifvg_R:.2f}")
    else:
        line3 = ""
    fig.suptitle(
        f"{sym} 5m — {ev.direction.replace('_', ' ')} of the {ev.level_session} {side} "
        f"· {ev.ts:%Y-%m-%d %H:%M} UTC · swept in the {ev.sweep_block} block · {conf}\n"
        f"{oc}   ||   {line2}{line3}\n{tag}", fontsize=11)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
    ax.grid(alpha=.25)
    h, l = ax.get_legend_handles_labels()
    seen = dict(zip(l, h))
    ax.legend(seen.values(), seen.keys(), fontsize=7.5, loc="best", framealpha=.9)
    fig.subplots_adjust(left=.048, right=.985, top=.855, bottom=.075)
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
            self.cache[sym] = (d, C.session_frames(d), E.fvg_arrays(d))
        return self.cache[sym]

    def render(self, ev, name, tag):
        d, sess, fv = self.get(ev.symbol)
        draw_event(ev.symbol, d, sess, fv, ev, os.path.join(C.VIZ, name), tag)
        return name


def main():
    """A handful of hand-picked 'teaching' panels — one per phenomenon the
    tables report. The unbiased, stratified set is `gallery.py`."""
    e = T.load_events()
    p = e[e.primary]
    L = Loader()
    picks = []

    P = p[p.ifvg_confirmed & (p.ifvg_R > 3) & (p.bars_remaining > 60)]
    picks.append(("01", P.sort_values("ifvg_R", ascending=False).iloc[5],
                  "textbook: sweep, iFVG inversion, reversal runs to the block close"))
    P = p[p.ifvg_confirmed & (p.ifvg_R < 0.1) & (p.ifvg_mae_atr > 4)]
    picks.append(("02", P.sort_values("ifvg_mae_atr", ascending=False).iloc[10],
                  "CONFIRMED AND WRONG — the iFVG fired and price ran the other way"))
    P = p[~p.ifvg_confirmed & (p.rev_atr > 8)]
    picks.append(("03", P.sort_values("rev_atr", ascending=False).iloc[8],
                  "big in-block reversal the iFVG rule never confirmed"))
    P = p[~p.ifvg_confirmed & p.ifvg_would_confirm_extended]
    picks.append(("04", P.sort_values("bars_remaining").iloc[len(P) // 2],
                  "unconfirmed ONLY because the block ended — the cost of the "
                  "block-scoped rule, on one chart"))
    P = p[p.ifvg_confirmed & (p.ifvg_delay_bars > 45)]
    picks.append(("05", P.sort_values("ifvg_stop_atr", ascending=False).iloc[12],
                  "very late confirmation — the stop proxy is already huge"))
    P = p[(p.n_levels_taken >= 3) & p.ifvg_confirmed]
    ev6 = P.sort_values("rev_atr", ascending=False).iloc[3]
    picks.append(("06", ev6, f"one bar took out {int(ev6.n_levels_taken)} levels; the "
                             "drawn line is the attributed (deepest) one, V2"))
    P = p[(p.sweep_block == "Late") & p.ifvg_confirmed]
    picks.append(("07", P.sort_values("bars_remaining").iloc[len(P) // 3],
                  "the Late block: confirmation arrives with almost no block left"))
    P = e[(~e.primary) & e.ifvg_confirmed]
    picks.append(("08", P.sort_values("rev_atr", ascending=False).iloc[6],
                  "APPENDIX sample (<12 bars left) — why these are reported separately"))

    for tag, ev, note in picks:
        name = (f"ex{tag}_{ev.symbol}_{ev.ts:%Y%m%d_%H%M}_"
                f"{'hi' if ev.direction == 'high_sweep' else 'lo'}.png")
        L.render(ev, name, f"teaching example {tag} — {note}")


if __name__ == "__main__":
    main()
