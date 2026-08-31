#!/usr/bin/env python3
"""Worked-example chart renderer — session-liquidity **v4**. AUDIT SURFACE.

Forked from `research/session-liquidity-v3/examples.py`. The candle/session
plumbing survives; what changed is what a panel is allowed to show.

**One horizontal reference line only: the swept level.** v3's panels also drew
an invalidation line at the take-out bar's extreme, the in-block reverse and
continuation extremes, and a stop-proxy line. Under v4 the first of those
corresponds to no rule at all, and the rest are measurements rather than
mechanics — with four horizontals on the chart it was impossible to see which
line the mechanic actually watches. The panel now matches the user's own
diagram: a fixed boundary, price crossing it, gaps forming, one of them
inverting. Every number that used to be a line is still in the header text.

What a panel draws:

  * the **swept level** — the fixed boundary, dashed black, the only price
    reference on the chart;
  * the **take-out wick** (star) and the block-scoped window (shaded, ending
    at the block-end vertical);
  * **every qualifying gap** the machine saw, as a zone, numbered in FORMATION
    ORDER, coloured by its fate:
        green  = the candidate that CONFIRMED
        grey   = REPLACED by a later gap while still live (pin 1: permanently
                 out — its later inversion is not an event)
        orange = still LIVE when the block ended;
  * the confirmation close (circle).

Panels are rendered for confirmed AND unconfirmed take-outs alike — the
failures are the more informative pictures, and the whole point of the gallery
is that a human can check the mechanic bar by bar.

Usage: .venv/bin/python research/session-liquidity-v4/examples.py
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
FATE = {"confirmed": "#2e8b57", "replaced": "#8a8f94", "live": "#e08b3a"}
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


def replay(d, fv, ev):
    """Re-run the v4 state machine for one event and fold its transition log
    into one record per candidate gap: formation bar, edges, order, fate, and
    the bar that sealed that fate. Recomputed rather than read back from
    results/transitions_*.csv.gz so a panel can never drift from the engine."""
    i = int(ev.bar); be = int(ev.block_end_bar)
    side = "high" if ev.direction == "high_sweep" else "low"
    r = E.ifvg_confirm_v4(fv, d.close.to_numpy(), i, be, ev.level_px, side,
                          trace=True)
    cands = {}
    for rec in r["log"]:
        k = rec.get("form")
        if rec["kind"] == "candidate":
            cands[rec["bar"]] = dict(form=rec["bar"], lo=rec["gap_lo"],
                                     hi=rec["gap_hi"], order=rec["order"],
                                     fate="live", sealed=None)
        elif rec["kind"] in ("replaced", "confirmed") and k in cands:
            cands[k]["fate"] = rec["kind"]
            cands[k]["sealed"] = rec["bar"]
    return r, sorted(cands.values(), key=lambda c: c["order"]), side


def outcome_label(ev) -> str:
    if ev.ifvg_confirmed:
        if pd.isna(ev.ifvg_R):
            return "CONFIRMED on the block's last bar (no window left to measure)"
        return "CONFIRMED — R>=1" if ev.ifvg_R >= 1 else "CONFIRMED — R<1 (failure)"
    return {"no_candidate": "UNCONFIRMED — no qualifying gap ever formed",
            "live_at_block_end": "UNCONFIRMED — candidate still live when the block ended",
            }.get(ev.unconf_cause, "UNCONFIRMED")


def draw_event(sym, d, sess, fv, ev, out, tag):
    r, cands, side = replay(d, fv, ev)
    i = int(ev.bar); be = int(ev.block_end_bar)
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

    # --- the block-scoped window ---------------------------------------------
    ax.axvspan(xs[j], xs[jb], color="#ffe08a", alpha=.22, zorder=0,
               label=f"block-scoped window -> end of {ev.sweep_block} "
                     f"({int(ev.bars_remaining)} bars = {int(ev.window_min)}m)")
    ax.axvline(xs[jb], color="#8a6d1f", ls="-.", lw=1.4, zorder=4,
               label=f"{ev.sweep_block} block ends ({w.ts.iloc[jb]:%H:%M} UTC)")

    # --- THE BOUNDARY: the swept level. The only horizontal on this chart. ---
    ax.axhline(ev.level_px, color="#111", ls="--", lw=1.7, zorder=6,
               label=f"THE BOUNDARY — swept {ev.level_session} {side} = "
                     f"{ev.level_px:g} (age {ev.level_age_h:.1f}h, "
                     f"{int(ev.n_levels_taken)} level(s) taken). It never moves, "
                     f"and nothing else is tracked.")
    ref = ev.sweep_ref
    ax.scatter([xs[j]], [ref], marker="*", s=340, color="#111", zorder=9,
               label=f"take-out wick ({ev.excursion_atr:.2f} ATR beyond the boundary)")

    # --- every candidate gap the machine saw, in formation order ------------
    seen_fates = set()
    for c in cands:
        f = c["form"] - lo_i
        seal = (c["sealed"] - lo_i) if c["sealed"] is not None else jb
        gx0 = xs[max(f - 2, 0)]
        gx1 = xs[min(len(w) - 1, max(seal, f + 1))]
        col = FATE[c["fate"]]
        lab = None
        if c["fate"] not in seen_fates:
            seen_fates.add(c["fate"])
            lab = {"confirmed": "candidate that CONFIRMED",
                   "replaced": "candidate REPLACED by a later gap (permanently out)",
                   "live": "candidate still LIVE at block end"}[c["fate"]]
        ax.add_patch(Rectangle((gx0, c["lo"]), gx1 - gx0, c["hi"] - c["lo"],
                               facecolor=col, alpha=.20, edgecolor=col,
                               lw=1.5, zorder=4, label=lab))
        ax.text(gx0, (c["lo"] + c["hi"]) / 2, f"#{c['order']}", color=col,
                fontsize=8.5, fontweight="bold", va="center", ha="right", zorder=7)

    # --- the confirmation close ---------------------------------------------
    if ev.ifvg_confirmed:
        u = j + int(ev.ifvg_delay_bars)
        if 0 <= u < len(w):
            ax.scatter([xs[u]], [w.close.iloc[u]], marker="o", s=140, zorder=9,
                       facecolor="none", edgecolor="#2e8b57", lw=2.8,
                       label=f"CONFIRMATION close (+{int(ev.ifvg_delay_bars)} bars "
                             f"= {int(ev.ifvg_delay_bars)*C.BAR_MIN}m) — the entry "
                             f"reference")

    # --- zoom panel: the transition region ----------------------------------
    if cands:
        f0 = min(c["form"] for c in cands) - lo_i
        f1 = max((c["sealed"] if c["sealed"] is not None else be) for c in cands) - lo_i
    else:
        f0, f1 = j, j + 40
    z0, z1 = max(0, min(f0, j) - 8), min(len(w) - 1, max(f1, j) + 12)
    zw = w.iloc[z0:z1 + 1].reset_index(drop=True)
    zxs = candles(zax, zw)
    zax.axhline(ev.level_px, color="#111", ls="--", lw=1.6, zorder=6)
    if 0 <= j - z0 < len(zw):
        zax.scatter([zxs[j - z0]], [ref], marker="*", s=260, color="#111", zorder=9)
    for c in cands:
        f = c["form"] - lo_i - z0
        seal = ((c["sealed"] - lo_i) if c["sealed"] is not None else jb) - z0
        if not (0 <= f < len(zw)):
            continue
        col = FATE[c["fate"]]
        gx0 = zxs[max(f - 2, 0)]
        gx1 = zxs[min(len(zw) - 1, max(seal, f + 1))]
        zax.add_patch(Rectangle((gx0, c["lo"]), gx1 - gx0, c["hi"] - c["lo"],
                                facecolor=col, alpha=.28, edgecolor=col,
                                lw=1.6, zorder=4))
        zax.text(gx0, (c["lo"] + c["hi"]) / 2, f"#{c['order']}", color=col,
                 fontsize=8, fontweight="bold", va="center", ha="right", zorder=7)
    if ev.ifvg_confirmed:
        u = j + int(ev.ifvg_delay_bars) - z0
        if 0 <= u < len(zw):
            zax.scatter([zxs[u]], [zw.close.iloc[u]], marker="o", s=120, zorder=9,
                        facecolor="none", edgecolor="#2e8b57", lw=2.6)
    zax.set_title("ZOOM — the dashed line is the swept boundary (the ONLY reference);\n"
                  "the star is the take-out wick; numbered zones are the candidate\n"
                  "gaps in formation order", fontsize=8.5, pad=6)
    zax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    zax.tick_params(labelsize=7)
    zax.grid(alpha=.25)

    # --- title: the machine's trace, and what v3/v2 did with the same event --
    line1 = (f"state machine: {int(ev.n_candidates)} candidate(s), "
             f"{int(ev.n_replacements)} replacement(s) — no invalidation rule exists")
    line2 = (f"wick view: reverse {ev.rev_atr:.2f} / continuation {ev.adv_atr:.2f} ATR"
             if ev.bars_remaining > 0 else "wick view: no window")
    if ev.ifvg_confirmed and np.isfinite(ev.ifvg_R):
        line2 += (f"   ||   from the confirmation close: MFE {ev.ifvg_mfe_atr:.2f} / "
                  f"MAE {ev.ifvg_mae_atr:.2f} / stop {ev.ifvg_stop_atr:.2f} ATR "
                  f"-> R {ev.ifvg_R:.2f}")
    v3lab = (f"confirmed +{int(ev.v3a_delay_bars)} bars" if ev.v3a_confirmed
             else f"UNCONFIRMED (gave up after {int(ev.v3a_n_invalidations)} "
                  f"invalidation(s))")
    v2lab = (f"confirmed +{int(ev.v2_ifvg_delay_bars)} bars, "
             f"{'SAME gap' if ev.same_gap_selected else 'DIFFERENT gap'}"
             if ev.v2_ifvg_confirmed else "unconfirmed")
    fig.suptitle(
        f"{sym} 5m — {ev.direction.replace('_', ' ')} of the {ev.level_session} {side} "
        f"· {ev.ts:%Y-%m-%d %H:%M} UTC · swept in the {ev.sweep_block} block\n"
        f"{outcome_label(ev)}   ||   {line1}\n{line2}\n"
        f"price printed {int(ev.n_local_extremes_beyond)} further local "
        f"{'high' if side == 'high' else 'low'}(s) beyond the take-out bar and closed "
        f"beyond it {int(ev.n_closes_beyond_extreme)}x — for reference, the deleted v3 "
        f"rule: {v3lab}   |   v2 (best-pick): {v2lab}\n{tag}", fontsize=10.0, y=.985)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
    ax.grid(alpha=.25)
    h, l = ax.get_legend_handles_labels()
    seen = dict(zip(l, h))
    seen.pop(None, None)
    ax.legend(seen.values(), seen.keys(), fontsize=7.2, loc="best", framealpha=.9)
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
            self.cache[sym] = (d, C.session_frames(d), E.fvg_arrays(d))
        return self.cache[sym]

    def render(self, ev, name, tag):
        d, sess, fv = self.get(ev.symbol)
        draw_event(ev.symbol, d, sess, fv, ev, os.path.join(C.VIZ, name), tag)
        return name


def main():
    """Hand-picked teaching panels — one per mechanic the report describes.
    The unbiased, stratified audit set is `gallery.py`."""
    e = T.load_events()
    p = e[e.primary]
    L = Loader()
    picks = []

    P = p[p.ifvg_confirmed & (p.n_candidates == 1) & (p.ifvg_R > 2) & (p.bars_remaining > 60)]
    picks.append(("01", P.sort_values("ifvg_R", ascending=False).iloc[4],
                  "textbook: one candidate, it inverts, price runs"))
    P = p[p.ifvg_confirmed & (p.n_replacements >= 2)]
    picks.append(("02", P.sort_values("n_replacements", ascending=False).iloc[3],
                  "REPLACEMENT: later gaps displaced the live candidate one after "
                  "another — the displaced zones are grey and can never come back "
                  "(pin 1)"))
    P = p[p.ifvg_confirmed & ~p.v3a_confirmed & (p.n_local_extremes_pre_conf >= 3)
          & (p.ifvg_R > 1.5) & (p.ifvg_delay_bars >= 24)]
    picks.append(("03", P.sort_values("ifvg_R", ascending=False).iloc[6],
                  "THE USER'S DIAGRAM: price crosses the boundary, prints several "
                  "further local extremes, THEN reverses through a gap near the top. "
                  "v4 confirms it; the deleted v3 rule gave up long before"))
    P = p[p.ifvg_confirmed & p.v2_ifvg_confirmed & ~p.same_gap_selected]
    picks.append(("04", P.sort_values("ifvg_gap_atr", ascending=False).iloc[8],
                  "DIFFERENT GAP, SAME BAR: v2's retroactive pick names an older gap, "
                  "v4 the freshest one — both inverted on the same close"))
    P = p[(p.unconf_cause == "live_at_block_end")]
    picks.append(("05", P.sort_values("bars_remaining").iloc[len(P) // 2],
                  "LIVE AT BLOCK END: the candidate never inverted before the clock "
                  "ran out"))
    P = p[(p.unconf_cause == "no_candidate") & (p.rev_atr > 6)]
    picks.append(("06", P.sort_values("rev_atr", ascending=False).iloc[9],
                  "NO CANDIDATE: a large reversal with no qualifying gap anywhere in "
                  "the window — the rule simply has nothing to fire on"))

    for tag, ev, note in picks:
        name = (f"ex{tag}_{ev.symbol}_{ev.ts:%Y%m%d_%H%M}_"
                f"{'hi' if ev.direction == 'high_sweep' else 'lo'}.png")
        L.render(ev, name, f"teaching example {tag} — {note}")


if __name__ == "__main__":
    main()
