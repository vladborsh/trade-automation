#!/usr/bin/env python3
"""Worked-example chart renderer — session-liquidity **v5-NY**. AUDIT SURFACE.

Forked from `research/session-liquidity-bos/examples.py`. The candle/session/
ray plumbing survives; what is new is that a panel now renders **both**
confirmation mechanics on the same chart, with the pinned NY window and the
pinned trade template drawn on it.

This file exists because the user's stated distrust of the shelving verdict is
partly a distrust of the *implementation* — a justified worry, since 3 of the
6 prior passes carried real bugs. A written claim that the mechanics are right
is worth less than a chart on which they can be checked bar by bar. So each
panel is drawn so a reader can falsify the engine:

  * the **swept level** — dashed black, the fixed boundary. It never moves;
  * the **pinned BoS anchor** — a solid green ray starting **on its own pivot
    bar** and running forward to the break (or window end), with a green dotted
    vertical on the bar the pivot was *confirmed* (always exactly 3 bars after
    the pivot). **If this ray ever steps, the implementation is wrong**;
  * **phase 1's re-anchoring level** as a red step-line over the same window —
    the level a *broken* implementation would have tested. This is the contrast
    that makes "flat" mean something;
  * **every qualifying iFVG candidate** the state machine saw, in grey, with
    its formation order — and the one that actually inverted in blue. Seeing
    the rejected candidates is what proves the winning gap was not picked with
    hindsight: the machine held the latest-formed one and each newer gap
    displaced it, live;
  * the **NY window** (13:40–15:20 UTC) as a vertical band, so the reader can
    see whether the confirmation fell inside it;
  * the **pinned trade** — entry at the confirmation close, stop at the sweep
    leg's running extreme, target +1R — and where it actually resolved.

Deliberately **no star on the take-out wick** (user preference); the take-out
is the dotted vertical `t0` line.

`main()` renders the hand-picked MECHANIC-PROOF panels. The stratified,
un-curated NY gallery is `gallery.py`.

Usage: python research/session-liquidity-v5-ny/examples.py
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
RAY = "#2e8b57"        # the pinned BoS anchor ray
P1C = "#c0392b"        # phase 1's moving level (the contrast)
IFC = "#1f5fa8"        # the iFVG gap that confirmed
CAND = "#9aa0a6"       # iFVG candidates that were displaced
WINC = "#ffd27f"       # the pinned NY window
PRE, POST = 55, 25


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


def _ray(ax, xs, y, j0, j1, color, lw, ls, label=None, zorder=6):
    j0 = max(0, min(j0, len(xs) - 1)); j1 = max(0, min(j1, len(xs) - 1))
    ax.plot([xs[j0], xs[j1]], [y, y], color=color, lw=lw, ls=ls, zorder=zorder,
            label=label, solid_capstyle="butt")


def _ny_bands(ax, w, xs):
    """Shade every NY-window stretch visible in the panel."""
    m = C.in_ny_window(C.minute_of_day(w.ts).to_numpy())
    if not m.any():
        return
    edges = np.flatnonzero(np.diff(np.r_[0, m.astype(int), 0]) != 0)
    first = True
    for a_, b_ in zip(edges[::2], edges[1::2]):
        ax.axvspan(xs[a_], xs[min(b_, len(xs) - 1)], color=WINC, alpha=.5,
                   zorder=0,
                   label="NY window 13:40–15:20 UTC (09:40–11:20 New York, UTC−4)"
                   if first else None)
        first = False


def outcome_label(ev, arm) -> str:
    if not ev[f"{arm}_confirmed"]:
        return ("NO CONFIRMATION before the block ended" if arm == "ifvg"
                else "NO BREAK — price never closed through the pinned ray")
    inw = ev[f"{arm}_in_ny"]
    tag = "INSIDE the NY window" if inw else "OUTSIDE the NY window"
    r = ev[f"{arm}_blk_netR"]
    if pd.isna(r):
        return f"confirmed {tag} — no window left to run the trade"
    ex = ev[f"{arm}_blk_exit"]
    return f"confirmed {tag} — trade exited '{ex}' at net {r:+.2f}R"


def draw_event(sym, d, sess, p1, fv, ev, arm, out, tag):
    """One panel. `arm` in {'bos','ifvg'} decides which mechanic is the subject;
    the other is still marked, because the comparison is informative."""
    i = int(ev.bar); be = int(ev.block_end_bar)
    side = "high" if ev.direction == "high_sweep" else "low"
    u = int(ev[f"{arm}_break_bar"]) if ev[f"{arm}_confirmed"] else -1
    lo_i, hi_i = max(0, i - PRE), min(len(d) - 1, be + POST)
    w = d.iloc[lo_i:hi_i + 1].reset_index(drop=True)
    fig, (ax, zax) = plt.subplots(1, 2, figsize=(19, 8.4),
                                  gridspec_kw=dict(width_ratios=[2.55, 1],
                                                   wspace=0.13))
    xs = candles(ax, w)
    x0, x1 = xs[0], xs[-1]
    j = i - lo_i
    jb = be - lo_i

    _ny_bands(ax, w, xs)

    # --- session rectangles (solid = closed at take-out = usable) -----------
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

    ax.axvline(xs[jb], color="#8a6d1f", ls="-.", lw=1.4, zorder=4,
               label=f"{ev.sweep_block} block ends ({w.ts.iloc[jb]:%H:%M} UTC) "
                     "— the block-scoped horizon stops here")
    ax.axvline(xs[j], color="#111", ls=":", lw=1.6, zorder=5,
               label=f"take-out bar t0 {ev.ts:%H:%M} UTC "
                     f"({ev.excursion_atr:.2f} ATR beyond the boundary) — "
                     "the anchor is chosen HERE and never again")
    ax.axhline(ev.level_px, color="#111", ls="--", lw=1.7, zorder=6,
               label=f"swept {ev.level_session} {side} = {ev.level_px:g} "
                     f"(age {ev.level_age_h:.1f}h) — FIXED, it never moves")

    # --- the pinned BoS anchor ray, and phase 1's moving level --------------
    if ev.bos_anchorable:
        ab = int(ev.bos_anchor_bar) - lo_i
        acb = int(ev.bos_anchor_conf_bar) - lo_i
        end_j = (int(ev.bos_break_bar) - lo_i) if ev.bos_confirmed else jb
        _ray(ax, xs, ev.bos_anchor_px, ab, end_j, RAY, 2.6, "-",
             label=f"PINNED BoS ANCHOR — {'pivot low' if side == 'high' else 'pivot high'} "
                   f"{int(ev.bos_anchor_age_bars)} bars before t0, "
                   f"{ev.bos_anchor_dist_atr:.2f} ATR away. FLAT ALL THE WAY: "
                   "chosen once, never re-anchored.", zorder=7)
        if 0 <= ab < len(w):
            ax.scatter([xs[ab]], [ev.bos_anchor_px],
                       marker="v" if side == "low" else "^", s=150, color=RAY,
                       zorder=9)
        if 0 <= acb < len(w):
            ax.axvline(xs[acb], color=RAY, ls=":", lw=1.0, alpha=.7, zorder=4)
            ax.text(xs[acb], 0.02, " pivot confirmed", color=RAY, fontsize=7,
                    rotation=90, va="bottom", zorder=7,
                    transform=ax.get_xaxis_transform())

    act = p1["act_lo_at" if side == "high" else "act_hi_at"][lo_i:hi_i + 1]
    seg = np.arange(j, jb + 1)
    ax.step(xs[seg], act[seg], where="post", color=P1C, lw=1.4, alpha=.8,
            zorder=5,
            label="for contrast: what a RE-ANCHORING implementation would have "
                  "tested (phase-1's bug). It steps; the green ray does not.")

    # --- the iFVG state machine, candidates and all ------------------------
    tr = E.ifvg_confirm_v4(fv, d.close.to_numpy(), i, be, float(ev.level_px),
                           side, strict=False, trace=True)
    cands = [r for r in (tr["log"] or []) if r["kind"] == "candidate"]
    conf = next((r for r in (tr["log"] or []) if r["kind"] == "confirmed"), None)
    conf_form = conf["form"] if conf else None
    for r in cands:
        fj = r["form"] - lo_i
        if not (0 <= fj < len(w)):
            continue
        won = (conf_form is not None and r["form"] == conf_form)
        col = IFC if won else CAND
        endj = ((int(ev.ifvg_break_bar) - lo_i) if won and ev.ifvg_confirmed
                else min(fj + 12, len(w) - 1))
        ax.add_patch(Rectangle((xs[fj], r["gap_lo"]), xs[endj] - xs[fj],
                               r["gap_hi"] - r["gap_lo"],
                               facecolor=col, alpha=.45 if won else .18,
                               edgecolor=col, lw=1.6 if won else 0.9,
                               ls="-" if won else ":", zorder=4))
        ax.text(xs[fj], r["gap_hi"], f" #{r['order']}", color=col, fontsize=7.5,
                va="bottom", zorder=7)
    if cands:
        ax.plot([], [], color=CAND, lw=6, alpha=.35,
                label=f"iFVG candidates the machine held and then DISPLACED "
                      f"({len(cands) - (1 if conf_form is not None else 0)} of "
                      f"{len(cands)}) — numbered in formation order")
        if conf_form is not None:
            ax.plot([], [], color=IFC, lw=6, alpha=.6,
                    label="the gap that actually inverted — it was the "
                          "latest-formed one at that moment, not a hindsight pick")

    # --- the confirmations -------------------------------------------------
    if ev.bos_confirmed:
        ub = j + int(ev.bos_delay_bars)
        if 0 <= ub < len(w):
            ax.scatter([xs[ub]], [w.close.iloc[ub]], marker="o", s=170, zorder=10,
                       facecolor="none", edgecolor=RAY, lw=3.0,
                       label=f"BoS BREAK close (+{int(ev.bos_delay_bars)} bars) "
                             f"at {w.ts.iloc[ub]:%H:%M} UTC")
    if ev.ifvg_confirmed:
        u2 = j + int(ev.ifvg_delay_bars)
        if 0 <= u2 < len(w):
            ax.scatter([xs[u2]], [w.close.iloc[u2]], marker="D", s=95, zorder=10,
                       facecolor="none", edgecolor=IFC, lw=2.4,
                       label=f"iFVG confirmation close (+{int(ev.ifvg_delay_bars)} "
                             f"bars) at {w.ts.iloc[u2]:%H:%M} UTC")

    # --- the pinned trade for the SUBJECT arm ------------------------------
    if u >= 0 and np.isfinite(ev[f"{arm}_blk_stop_px"]):
        uj = u - lo_i
        entry = float(ev[f"{arm}_blk_conf_close"])
        stop = float(ev[f"{arm}_blk_stop_px"])
        dist = abs(entry - stop)
        target = entry - dist if side == "high" else entry + dist
        held = ev[f"{arm}_blk_bars_held"]
        # draw at least 10 bars of the bracket so a fast exit is still legible
        endj = int(min(uj + max(held if np.isfinite(held) else 0, 10), len(w) - 1))
        _ray(ax, xs, entry, uj, endj, "#111", 1.8, "-",
             label=f"ENTRY at the confirmation close = {entry:g}", zorder=8)
        _ray(ax, xs, stop, uj, endj, "#c0392b", 1.8, "--",
             label=f"STOP = the sweep leg's running extreme "
                   f"({ev[f'{arm}_blk_stop_atr']:.2f} ATR = 1R)", zorder=8)
        _ray(ax, xs, target, uj, endj, "#2e8b57", 1.8, "--",
             label=f"TARGET +1R = {target:g} "
                   f"(exit '{ev[f'{arm}_blk_exit']}', net {ev[f'{arm}_blk_netR']:+.2f}R)",
             zorder=8)

    # --- zoom panel --------------------------------------------------------
    f0 = (int(ev.bos_anchor_bar) - lo_i) if ev.bos_anchorable else j
    f1 = (u - lo_i) if u >= 0 else min(jb, j + 60)
    z0, z1 = max(0, min(f0, j) - 6), min(len(w) - 1, max(f1, j) + 12)
    zw = w.iloc[z0:z1 + 1].reset_index(drop=True)
    zxs = candles(zax, zw)
    _ny_bands(zax, zw, zxs)
    zax.axhline(ev.level_px, color="#111", ls="--", lw=1.6, zorder=6)
    zax.axvline(zxs[max(0, min(j - z0, len(zw) - 1))], color="#111", ls=":",
                lw=1.5, zorder=5)
    if ev.bos_anchorable:
        _ray(zax, zxs, ev.bos_anchor_px, f0 - z0,
             (f1 - z0) if ev.bos_confirmed else len(zw) - 1, RAY, 2.6, "-")
    zseg = np.arange(max(0, j - z0), len(zw))
    zax.step(zxs[zseg], act[z0:z1 + 1][zseg], where="post", color=P1C, lw=1.3,
             alpha=.8, zorder=5)
    for r in cands:
        fj = r["form"] - lo_i - z0
        if not (0 <= fj < len(zw)):
            continue
        won = (conf_form is not None and r["form"] == conf_form)
        col = IFC if won else CAND
        endj = min(fj + 10, len(zw) - 1)
        zax.add_patch(Rectangle((zxs[fj], r["gap_lo"]), zxs[endj] - zxs[fj],
                                r["gap_hi"] - r["gap_lo"],
                                facecolor=col, alpha=.45 if won else .18,
                                edgecolor=col, lw=1.4 if won else 0.9,
                                ls="-" if won else ":", zorder=4))
    if u >= 0 and 0 <= u - lo_i - z0 < len(zw):
        zax.scatter([zxs[u - lo_i - z0]], [zw.close.iloc[u - lo_i - z0]],
                    marker="o" if arm == "bos" else "D", s=150, zorder=10,
                    facecolor="none", edgecolor=RAY if arm == "bos" else IFC,
                    lw=2.8)
    zax.set_title("ZOOM — green ray = the PINNED anchor (must be FLAT);\n"
                  "red step = what a re-anchoring bug would test (it moves);\n"
                  "grey boxes = displaced iFVG candidates, blue = the one that "
                  "inverted;\ndotted vertical = t0; dashed horizontal = the "
                  "swept boundary", fontsize=8.2, pad=6)
    zax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    zax.tick_params(labelsize=7)
    zax.grid(alpha=.25)

    # --- title -------------------------------------------------------------
    armlab = "BoS pinned anchor" if arm == "bos" else "iFVG-v4"
    line2 = (f"wick view: reverse {ev.rev_atr:.2f} / continuation {ev.adv_atr:.2f} ATR"
             if ev.bars_remaining > 0 else "wick view: no window")
    if u >= 0 and np.isfinite(ev[f"{arm}_blk_R"]):
        line2 += (f"   ||   from the confirmation close: MFE {ev[f'{arm}_blk_mfe_atr']:.2f} / "
                  f"MAE {ev[f'{arm}_blk_mae_atr']:.2f} / stop "
                  f"{ev[f'{arm}_blk_stop_atr']:.2f} ATR")
        if np.isfinite(ev[f"{arm}_h24_netR"]):
            line2 += (f"   ||   24h horizon: net {ev[f'{arm}_h24_netR']:+.2f}R "
                      f"(exit '{ev[f'{arm}_h24_exit']}')")
    fig.suptitle(
        f"{sym} 5m — {ev.direction.replace('_', ' ')} of the {ev.level_session} "
        f"{side} · {ev.ts:%Y-%m-%d %H:%M} UTC · swept in the {ev.sweep_block} "
        f"block · SUBJECT: {armlab}\n"
        f"{outcome_label(ev, arm)}   ||   {line2}\n"
        f"BoS anchor: {int(ev.bos_anchor_age_bars) if ev.bos_anchorable else '-'} "
        f"bars before t0, {ev.bos_anchor_dist_atr:.2f} ATR from the take-out wick  |  "
        f"iFVG: {int(ev.n_candidates)} qualifying gap(s) seen, "
        f"{int(ev.n_replacements)} displaced\n{tag}", fontsize=10.0, y=.985)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
    ax.grid(alpha=.25)
    h, l = ax.get_legend_handles_labels()
    seen = dict(zip(l, h))
    seen.pop(None, None)
    # The legend goes BELOW the axes, never over the candles: on an audit panel
    # the price action is the evidence and must not be covered.
    ax.legend(seen.values(), seen.keys(), fontsize=7.0, ncol=2,
              loc="upper left", bbox_to_anchor=(0.0, -0.085), framealpha=.95,
              borderaxespad=0.0)
    fig.subplots_adjust(left=.048, right=.985, top=.800, bottom=.300)
    fig.savefig(out, dpi=118)
    plt.close(fig)
    print("wrote", out)


class Loader:
    """Per-symbol cache of everything draw_event needs."""

    def __init__(self, outdir=None):
        self.cache = {}
        self.outdir = outdir or C.VIZ

    def get(self, sym):
        if sym not in self.cache:
            d = C.prep(C.load(sym))
            pv = C.pivots(d)
            self.cache[sym] = (d, C.session_frames(d),
                               E.phase1_bos_arrays(d, pv), E.fvg_arrays(d))
        return self.cache[sym]

    def render(self, ev, arm, name, tag):
        d, sess, p1, fv = self.get(ev.symbol)
        draw_event(ev.symbol, d, sess, p1, fv, ev, arm,
                   os.path.join(self.outdir, name), tag)
        return name


# ==========================================================================
# MECHANIC PROOF — hand-picked, one per thing that could be wrong
# ==========================================================================
def proof_picks(p):
    """Each pick targets a specific way the engine could be lying. Selection is
    by MECHANICAL property (anchor age, candidate count, delay), never by
    outcome — a panel is chosen because it is legible, not because it won."""
    picks = []
    fg = p[p.symbol.isin(C.FOREGROUND)]

    P = fg[fg.bos_confirmed & fg.bos_in_ny & (fg.bos_anchor_age_bars >= 10)
           & (fg.bos_delay_bars >= 12) & (fg.symbol == "BTCUSDT")]
    picks.append(("01", "bos", P.sort_values("bos_anchor_age_bars",
                                             ascending=False).iloc[4],
                  "THE LEVEL DID NOT MOVE — an anchor chosen 10+ bars before "
                  "the take-out, broken 12+ bars after it. The green ray is one "
                  "flat line across ~30 bars; the red step-line beside it is "
                  "what a re-anchoring bug would have tested instead."))

    P = fg[fg.bos_confirmed & fg.bos_in_ny & (fg.n_candidates >= 4)
           & (fg.symbol == "ETHUSDT")]
    picks.append(("02", "bos", P.sort_values("n_candidates",
                                             ascending=False).iloc[3],
                  "MANY PIVOTS FORM AFTER t0 AND NONE OF THEM COUNT — the red "
                  "step-line moves repeatedly inside the window while the green "
                  "ray is unchanged. Every step is a pivot that confirmed after "
                  "the take-out; the pinned mechanic ignores all of them."))

    P = fg[fg.ifvg_confirmed & fg.ifvg_in_ny & (fg.n_replacements >= 3)
           & (fg.symbol == "BTCUSDT")]
    picks.append(("03", "ifvg", P.sort_values("n_replacements",
                                              ascending=False).iloc[2],
                  "THE GAP WAS NOT CHERRY-PICKED — several qualifying gaps "
                  "formed (grey, numbered in formation order) and each newer one "
                  "displaced its predecessor live. The blue box is simply "
                  "whichever gap happened to be active when price closed through "
                  "it; no other gap in the window was ever eligible at that "
                  "moment."))

    P = fg[fg.ifvg_confirmed & fg.ifvg_in_ny & (fg.n_candidates == 1)
           & (fg.ifvg_form_delay_bars >= 3) & (fg.symbol == "ETHUSDT")]
    picks.append(("04", "ifvg", P.sort_values("ifvg_delay_bars").iloc[len(P) // 2],
                  "THE SIMPLEST CASE, FOR CALIBRATION — exactly one qualifying "
                  "gap in the whole window. It forms after the take-out, price "
                  "closes back through its far edge, and that close is the "
                  "confirmation. Nothing to choose between, so nothing to "
                  "cherry-pick."))

    P = fg[fg.ifvg_confirmed & fg.ifvg_in_ny & fg.bos_confirmed & fg.bos_in_ny
           & (fg.bos_delay_bars - fg.ifvg_delay_bars >= 10)]
    picks.append(("05", "ifvg", P.sort_values("bos_minus_ifvg_bars",
                                              ascending=False).iloc[6],
                  "BOTH MECHANICS ON ONE CHART — the iFVG fires near the "
                  "boundary, the BoS waits until price has closed back through a "
                  "ray several ATR inside the swept range. Same sweep, two very "
                  "different entries and two very different stops. This is what "
                  "'timing mechanic, not selection filter' looks like."))

    P = fg[~fg.bos_confirmed & fg.bos_anchorable & fg.ifvg_confirmed
           & fg.ifvg_in_ny & (fg.bars_remaining >= 80)]
    picks.append(("06", "bos", P.sort_values("bos_anchor_dist_atr",
                                             ascending=False).iloc[10],
                  "A FAILURE, DRAWN AS CAREFULLY AS A SUCCESS — the ray is "
                  "never reached before the block ends, so there is no BoS. "
                  "Unconfirmed events are rendered by the same code path; the "
                  "gallery is not a highlight reel."))

    P = fg[fg.ifvg_confirmed & fg.ifvg_in_ny & (fg.ifvg_blk_exit == "stop")
           & (fg.symbol == "BTCUSDT")]
    picks.append(("07", "ifvg", P.sort_values("ifvg_blk_stop_atr").iloc[len(P) // 2],
                  "THE TRADE TEMPLATE, ON A LOSER — entry at the confirmation "
                  "close, stop on the sweep leg's running extreme, target one "
                  "stop-width away. Price takes the stop. Roughly 45–49% of "
                  "in-window iFVG trades end exactly here, which is why the "
                  "expectancy is what it is."))

    P = fg[fg.bos_confirmed & fg.bos_in_ny & (fg.bos_blk_exit == "target")
           & (fg.symbol == "ETHUSDT")]
    picks.append(("08", "bos", P.sort_values("bos_blk_stop_atr",
                                             ascending=False).iloc[8],
                  "THE SAME TEMPLATE, ON A WINNER — and note how much wider the "
                  "BoS stop is than a typical iFVG one (median 5.6 ATR against "
                  "3.1). A wider stop makes the 0.10% round-trip fee a smaller "
                  "share of the risk taken, which is most of why the BoS arm's "
                  "net number is less negative than the iFVG arm's — a fee "
                  "effect, not a better direction call."))
    return picks


def main():
    e = T.load_events()
    p = e[e.primary]
    L = Loader()
    rows = []
    for tag, arm, ev, note in proof_picks(p):
        name = (f"proof{tag}_{arm}_{ev.symbol}_{ev.ts:%Y%m%d_%H%M}_"
                f"{'hi' if ev.direction == 'high_sweep' else 'lo'}.png")
        L.render(ev, arm, name, f"MECHANIC PROOF {tag} — {note[:110]}...")
        rows.append((tag, arm, ev, note, name))
    return rows


if __name__ == "__main__":
    main()
