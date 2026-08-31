#!/usr/bin/env python3
"""PDH/PDL worked-example gallery — FIRST-CLASS DELIVERABLE of this pass.

The brief is explicit: *a new level class does not ship without its own visual
audit surface*. This is that surface — eighteen real PDH/PDL take-outs drawn on
5m candles, six each of wins, failures and unconfirmed take-outs.

The renderer is a **fork** of the **v4** package's `examples.draw_event` (parent
files are never modified). It therefore inherits the v4 panel conventions: the
swept level drawn as THE BOUNDARY (a dashed black horizontal, the only one on
the chart), and **every candidate gap the v4 state machine saw**, coloured by
its fate — confirmed / replaced-by-a-later-gap / still-live-at-block-end.

**Gallery note (user request, 2026-08-31):** the take-out-wick star marker is
**not drawn**. It was informational only and the user finds it noisy; the
boundary line is the swept level and the take-out bar is already the left edge
of the shaded block-scoped window. No measurement anchor changed — the wick is
still what `excursion_atr`, `rev_atr`/`adv_atr` and the stop proxy are measured
from, it is simply not decorated.

What the fork adds on top is the day layer the v4 panel has no concept of:

  * the **prior UTC day's range** as a shaded band, with its own 00:00-24:00
    bounds drawn — so it is visible by eye that the level was frozen before the
    sweeping day began (the lookahead audit);
  * the **PDH / PDL rays**, drawn from the prior day's close forward across the
    sweeping day, i.e. exactly the lifetime the definition gives them;
  * a marker on the bar **inside the prior day** where the extreme was printed,
    and its block — which is how the "Late set the day's extreme" diagnostic
    gets checked by eye rather than believed;
  * the `coincident_session_level` verdict in the panel title, so a reader can
    see for themselves whether the day level was standing alone or was a session
    level in disguise.

Everything else — session rectangles, the block-scoped window, the FVG zone and
its inverting close, the stop proxy, the zoom panel — is the parent's, unchanged.

Selection is stratified across (symbol x direction x sweep_block x
coincident_session_level) with a fixed seed, so the panels span assets, sides,
blocks and both halves of the coincidence split, and are reproducible. No
outcome column orders the picks inside a group.

Writes viz/pd_{win,fail,unconf}*.png and results/PD-GALLERY.md.

Usage: .venv/bin/python research/session-liquidity-v2/drilldown/dd_gallery.py
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

import dd_common as D
import dd_prep
import pd_engine as P
from dd_common import C, E
import examples as X            # the v4 renderer's candle plumbing, reused

SEED = 42
N_PER_GROUP = 6
STRATA = ["symbol", "direction", "sweep_block", "coincident_session_level"]
PRE, POST = 45, 25
DAY_COLOR = "#7b1fa2"


def stratified_sample(pool: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    """Round-robin across strata, each stratum shuffled with a fixed seed.

    Same algorithm as the parent gallery's sampler; the strata differ because
    this stream has one level session and a coincidence flag instead.
    """
    rng = np.random.default_rng(seed)
    groups = [g for _, g in pool.groupby(STRATA, sort=True, observed=True)]
    order = rng.permutation(len(groups))
    shuffled = [groups[k].sample(frac=1.0, random_state=seed) for k in order]
    picked, ptr = [], [0] * len(shuffled)
    while len(picked) < n:
        progressed = False
        for gi, g in enumerate(shuffled):
            if len(picked) >= n:
                break
            if ptr[gi] < len(g):
                picked.append(g.index[ptr[gi]]); ptr[gi] += 1; progressed = True
        if not progressed:
            break
    return pool.loc[picked]


def draw_pd_event(sym, d, sess, fv, days, ev, out, tag):
    """Fork of the v4 `examples.draw_event` with the prior-day level layer added.

    The state machine is REPLAYED here (`examples.replay`, which calls
    `engine.ifvg_confirm_v4` with trace=True) rather than read back from a
    results file, so a panel can never drift from the engine that produced the
    numbers in the tables.
    """
    r_, cands, _side = X.replay(d, fv, ev)
    i = int(ev.bar); be = int(ev.block_end_bar)
    side = "high" if ev.direction == "high_sweep" else "low"
    day = pd.Timestamp(ev.ts).floor("D")
    prev = day - pd.Timedelta(days=1)
    prow = days.set_index("day").loc[prev]

    lo_i = max(0, min(i - PRE, int(prow.first_idx)))     # always show the prior day
    hi_i = min(len(d) - 1, be + POST)
    w = d.iloc[lo_i:hi_i + 1].reset_index(drop=True)
    fig, (ax, zax) = plt.subplots(1, 2, figsize=(19, 7.8),
                                  gridspec_kw=dict(width_ratios=[2.55, 1], wspace=0.13))
    xs = X.candles(ax, w)
    x0, x1 = xs[0], xs[-1]
    j = i - lo_i; jb = be - lo_i

    # ---- session rectangles, exactly as the parent panel draws them --------
    t_take = w.ts.iloc[j]
    vis = sess[(sess.t_end >= w.ts.iloc[0]) & (sess.t_start <= w.ts.iloc[-1])]
    for _, r in vis.iterrows():
        a = max(mdates.date2num(r.t_start.to_pydatetime()), x0)
        b = min(mdates.date2num(r.t_end.to_pydatetime()), x1)
        closed = r.t_end < t_take
        ax.add_patch(Rectangle((a, r.low), b - a, r.high - r.low,
                               facecolor=X.CS[r.session], alpha=.09 if closed else .04,
                               edgecolor=X.CS[r.session], lw=1.0 if closed else 0.8,
                               ls="-" if closed else ":", zorder=1))
        ax.text(a, r.high, f" {r.session} {r.t_start:%m-%d}"
                           + ("" if closed else " (still forming at take-out)"),
                color=X.CS[r.session], fontsize=7.5, va="bottom",
                alpha=1.0 if closed else .55, zorder=6)

    # ---- THE NEW LAYER: the prior UTC day and its two levels ---------------
    pa = xs[max(int(prow.first_idx) - lo_i, 0)]
    pb = xs[min(int(prow.last_idx) - lo_i, len(w) - 1)]
    ax.add_patch(Rectangle((pa, prow.low), pb - pa, prow.high - prow.low,
                           facecolor=DAY_COLOR, alpha=.07, edgecolor=DAY_COLOR,
                           lw=1.6, ls="-", zorder=1,
                           label=f"prior UTC day {prev:%Y-%m-%d} — its full range "
                                 f"({prow.high - prow.low:.4g}) is frozen at its close"))
    ax.axvline(pb, color=DAY_COLOR, lw=1.2, ls=":", zorder=4)
    ax.text(pb, ax.get_ylim()[1], " midnight — PDH/PDL become sweepable",
            color=DAY_COLOR, fontsize=8, va="top", rotation=90, zorder=6)
    # the rays: alive for the sweeping day only
    dayrow = days.set_index("day").loc[day]
    ra = xs[max(int(dayrow.first_idx) - lo_i, 0)]
    rb = xs[min(int(dayrow.last_idx) - lo_i, len(w) - 1)]
    for px, nm in ((prow.high, "PDH"), (prow.low, "PDL")):
        is_it = (nm == "PDH") == (side == "high")
        ax.plot([pb, rb], [px, px], color=DAY_COLOR if is_it else "#b39ddb",
                lw=2.0 if is_it else 1.1, ls="-" if is_it else "--", zorder=5,
                label=(f"{nm} = {px:g} — THE SWEPT LEVEL "
                       f"(age {ev.level_age_h:.1f}h)" if is_it
                       else f"{nm} = {px:g} (the other side, not swept here)"))
        ax.text(rb, px, f" {nm}", color=DAY_COLOR if is_it else "#b39ddb",
                fontsize=9, va="center", fontweight="bold" if is_it else "normal", zorder=6)
    # where in the prior day the extreme actually printed
    seg = d.iloc[int(prow.first_idx):int(prow.last_idx) + 1]
    k_ = (seg.high.idxmax() if side == "high" else seg.low.idxmin())
    if lo_i <= k_ <= hi_i:
        ax.scatter([xs[k_ - lo_i]], [prow.high if side == "high" else prow.low],
                   marker="v" if side == "high" else "^", s=150, color=DAY_COLOR,
                   zorder=8, label=f"where the prior day's {side} printed — "
                                   f"{d.ts.iat[k_]:%H:%M} UTC, {d.block.iat[k_]} block")

    # ---- the take-out's block-scoped window, as in the parent panel --------
    ax.axvspan(xs[j], xs[jb], color="#ffe08a", alpha=.22, zorder=0,
               label=f"block-scoped window: take-out -> end of {ev.sweep_block} "
                     f"({int(ev.bars_remaining)} bars = {int(ev.window_min)}m)")
    ax.axvline(xs[jb], color="#8a6d1f", ls="-.", lw=1.4, zorder=4,
               label=f"{ev.sweep_block} block ends ({w.ts.iloc[jb]:%H:%M} UTC)")

    ref = ev.sweep_ref
    # (no take-out-wick star: user request 2026-08-31 — informational only and
    # visually noisy. The boundary ray above IS the swept level, and the shaded
    # window starts on the take-out bar, so the event is still unambiguous.)

    if ev.bars_remaining > 0:
        hz = w.iloc[j + 1:jb + 1]
        y_rev, y_adv = ((hz.low.min(), hz.high.max()) if side == "high"
                        else (hz.high.max(), hz.low.min()))
        ax.plot([xs[j], xs[jb]], [y_rev, y_rev], color="#2e8b57", lw=1.1, ls=":",
                zorder=4, label=f"reverse extreme in-block ({ev.rev_atr:.2f} ATR)")
        ax.plot([xs[j], xs[jb]], [y_adv, y_adv], color="#c0392b", lw=1.1, ls=":",
                zorder=4, label=f"continuation extreme in-block ({ev.adv_atr:.2f} ATR)")

    # ---- EVERY candidate the v4 state machine saw, coloured by its fate ----
    # This is the v4 gallery convention: the panel shows the machine's whole
    # walk, not just the winner, so "the latest qualifying gap replaces the
    # live one" is visible rather than asserted.
    seen_fates = set()
    for c in cands:
        f = c["form"] - lo_i
        seal = (c["sealed"] - lo_i) if c["sealed"] is not None else jb
        if not (0 <= f < len(w)):
            continue
        gx0 = xs[max(f - 2, 0)]
        gx1 = xs[min(len(w) - 1, max(seal, f + 1))]
        col = X.FATE[c["fate"]]
        lab = None
        if c["fate"] not in seen_fates:
            seen_fates.add(c["fate"])
            lab = {"confirmed": "candidate gap that CONFIRMED",
                   "replaced": "candidate REPLACED by a later gap (permanently out)",
                   "live": "candidate still LIVE when the block ended"}[c["fate"]]
        ax.add_patch(Rectangle((gx0, c["lo"]), gx1 - gx0, c["hi"] - c["lo"],
                               facecolor=col, alpha=.20, edgecolor=col,
                               lw=1.5, zorder=4, label=lab))
        ax.text(gx0, (c["lo"] + c["hi"]) / 2, f"#{c['order']}", color=col,
                fontsize=8.5, fontweight="bold", va="center", ha="right", zorder=7)

    if ev.ifvg_confirmed:
        u = j + int(ev.ifvg_delay_bars)
        if 0 <= u < len(w):
            c0 = w.close.iloc[u]
            ax.scatter([xs[u]], [c0], marker="o", s=140, zorder=9, facecolor="none",
                       edgecolor="#2e8b57", lw=2.8,
                       label=f"CONFIRMATION close (+{int(ev.ifvg_delay_bars)} bars) "
                             f"— the entry reference; gap height {ev.gap_atr:.2f} ATR")
            ax.axhline(c0, color="#2e8b57", lw=0.9, alpha=.55, zorder=4)
            if np.isfinite(ev.ifvg_stop_atr):
                s_ = w.iloc[j:u + 1]
                ext = s_.high.max() if side == "high" else s_.low.min()
                ax.plot([xs[j], xs[min(jb, len(w) - 1)]], [ext, ext], color="#7b1fa2",
                        lw=1.2, ls="--", zorder=5,
                        label=f"stop proxy = sweep-leg extreme ({ev.ifvg_stop_atr:.2f} ATR)")

    # ---- zoom panel: the state machine's transition region (v4 convention) --
    if cands:
        f0 = min(c["form"] for c in cands) - lo_i
        f1 = max((c["sealed"] if c["sealed"] is not None else be) for c in cands) - lo_i
    else:
        f0, f1 = j, j + 40
    z0, z1 = max(0, min(f0, j) - 8), min(len(w) - 1, max(f1, j) + 12)
    zw = w.iloc[z0:z1 + 1].reset_index(drop=True)
    zxs = X.candles(zax, zw)
    zax.axhline(ev.level_px, color=DAY_COLOR, ls="-", lw=1.8, zorder=5)
    for c in cands:
        f = c["form"] - lo_i - z0
        seal = ((c["sealed"] - lo_i) if c["sealed"] is not None else jb) - z0
        if not (0 <= f < len(zw)):
            continue
        col = X.FATE[c["fate"]]
        gx0 = zxs[max(f - 2, 0)]
        gx1 = zxs[min(len(zw) - 1, max(seal, f + 1))]
        zax.add_patch(Rectangle((gx0, c["lo"]), gx1 - gx0, c["hi"] - c["lo"],
                                facecolor=col, alpha=.28, edgecolor=col,
                                lw=1.6, zorder=4))
        zax.text(gx0, (c["lo"] + c["hi"]) / 2, f"#{c['order']}", color=col,
                 fontsize=8, fontweight="bold", va="center", ha="right", zorder=7)
    if ev.ifvg_confirmed:
        u = j + int(ev.ifvg_delay_bars)
        if 0 <= u - z0 < len(zw):
            zax.scatter([zxs[u - z0]], [zw.close.iloc[u - z0]], marker="o", s=130,
                        zorder=8, facecolor="none", edgecolor="#2e8b57", lw=2.6)
        ztitle = ("ZOOM — the PDH/PDL ray, every candidate gap the v4 machine saw\n"
                  "(numbered in formation order) and the CLOSE that confirmed (o)")
    else:
        ztitle = ("ZOOM — the PDH/PDL ray and the candidate gaps.\n"
                  f"Unconfirmed: {ev.unconf_cause.replace('_', ' ')}.")
    zax.set_title(ztitle, fontsize=8.5, pad=9)
    zax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    zax.tick_params(labelsize=7); zax.grid(alpha=.25)

    oc = X.outcome_label(ev)
    coin = ("COINCIDENT with an alive session level "
            f"({ev.coincident_dist_atr:.3f} ATR away) — not a pure day-level sweep"
            if ev.coincident_session_level else
            "PURE day-level sweep — no alive session level within 0.05 ATR")
    conf = (f"iFVG-v4 confirmed +{int(ev.ifvg_delay_bars)} bars "
            f"({int(ev.n_candidates)} candidate(s), {int(ev.n_replacements)} replaced)"
            if ev.ifvg_confirmed
            else (f"unconfirmed ({ev.unconf_cause.replace('_', ' ')}) — would have "
                  f"confirmed with 2h more"
                  if ev.ifvg_would_confirm_extended
                  else f"unconfirmed ({ev.unconf_cause.replace('_', ' ')})"))
    line2 = (f"wick view: reverse {ev.rev_atr:.2f} / continuation {ev.adv_atr:.2f} ATR, "
             f"at block close {ev.end_atr:+.2f} ATR"
             if ev.bars_remaining > 0 else "wick view: no window")
    line3 = (f"   ||   from the inversion close: MFE {ev.ifvg_mfe_atr:.2f} / "
             f"MAE {ev.ifvg_mae_atr:.2f} / stop {ev.ifvg_stop_atr:.2f} ATR -> "
             f"R {ev.ifvg_R:.2f} · signed ER {ev.er:+.2f}"
             if ev.ifvg_confirmed and np.isfinite(ev.ifvg_R) else "")
    fig.suptitle(
        f"{sym} 5m — {ev.direction.replace('_', ' ')} of the "
        f"{'PDH' if side == 'high' else 'PDL'} (prior day {prev:%Y-%m-%d}) · "
        f"{ev.ts:%Y-%m-%d %H:%M} UTC · swept in the {ev.sweep_block} block · {conf}\n"
        f"{oc}   ||   {coin}\n{line2}{line3}\n{tag}", fontsize=10.5)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
    ax.grid(alpha=.25)
    h, l = ax.get_legend_handles_labels()
    seen = dict(zip(l, h))
    ax.legend(seen.values(), seen.keys(), fontsize=7, loc="best", framealpha=.9)
    fig.subplots_adjust(left=.048, right=.985, top=.83, bottom=.075)
    fig.savefig(out, dpi=118)
    plt.close(fig)
    print("wrote", out)


class PDLoader:
    def __init__(self):
        self.cache = {}

    def get(self, sym):
        if sym not in self.cache:
            d = C.prep(C.load(sym))
            self.cache[sym] = (d, C.session_frames(d), E.fvg_arrays(d), P.day_frames(d))
        return self.cache[sym]

    def render(self, ev, name, tag):
        d, sess, fv, days = self.get(ev.symbol)
        draw_pd_event(ev.symbol, d, sess, fv, days, ev,
                      os.path.join(D.VIZ, name), tag)
        return name


GROUPS = [
    ("pd_win", "CONFIRMED, R proxy >= 1 — the iFVG fired and the reversal paid",
     lambda p: p[p.ifvg_confirmed & (p.ifvg_R >= 1)]),
    ("pd_fail", "CONFIRMED, R proxy < 1 — the iFVG fired and it did not pay",
     lambda p: p[p.ifvg_confirmed & (p.ifvg_R < 1)]),
    ("pd_unconf", "UNCONFIRMED — no in-block iFVG; the day-level take-outs the rule discards",
     lambda p: p[~p.ifvg_confirmed]),
]


def main():
    e = dd_prep.load()
    p = e[(e.stream == "pd") & e.primary]
    L = PDLoader()
    out = ["# PDH/PDL worked-example gallery — drill-down pass (post-v4)\n",
           "Eighteen real **day-level** take-outs, six each of wins, failures and "
           "unconfirmed take-outs, all under the **iFVG-v4** mechanic. The "
           "renderer is a fork of the v4 package's "
           "`examples.draw_event` with the prior-day layer added: the prior UTC "
           "day's range as a shaded band, the midnight boundary at which PDH/PDL "
           "become sweepable, both rays across their one-day lifetime, and a "
           "marker on the bar inside the prior day where the extreme actually "
           "printed (with its block — this is how the Late-sets-the-extreme "
           "diagnostic is checked by eye).\n",
           "Inherited from the v4 panel: the swept level is drawn as THE BOUNDARY "
           "and **every candidate gap the state machine saw** is drawn and "
           "numbered in formation order, coloured green (confirmed), grey "
           "(replaced by a later gap — permanently out) or orange (still live "
           "when the block ended). **The take-out-wick star marker is "
           "deliberately not drawn** (user request 2026-08-31: informational "
           "only, visually noisy); no measurement anchor changed.\n",
           f"Selection is stratified across (symbol x direction x sweep_block x "
           f"coincident_session_level) with seed {SEED} and is **not** "
           "hand-curated; re-running `dd_gallery.py` reproduces exactly these "
           "panels. The six slots per group are equal by construction and say "
           "nothing about how common each outcome is (D3 and A0 do).\n",
           "`coincident` = an alive session level sat within 0.05 ATR of the day "
           "level at the take-out, so the same excursion took both. About three "
           "quarters of day-level take-outs are coincident (D5); the gallery "
           "deliberately spans both halves.\n",
           "`rev`/`adv` are measured from the take-out wick; `mfe`/`mae`/`R`/`ER` "
           "from the iFVG inversion close. All in ATR(14, 5m) at the take-out "
           "bar.\n"]
    for prefix, blurb, sel in GROUPS:
        pool = sel(p)
        picks = stratified_sample(pool, N_PER_GROUP, SEED)
        out.append(f"\n## `{prefix}*` — {blurb}\n")
        out.append(f"_Pool: {len(pool):,} events = {100*len(pool)/len(p):.1f}% of the "
                   f"{len(p):,}-event PDH/PDL primary sample._\n")
        out.append("| # | asset | take-out (UTC) | side | block | coincident | left | "
                   "delay | cand | gap ATR | rev | adv | mfe | mae | R | ER | file |")
        out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for i, (_, ev) in enumerate(picks.iterrows(), start=1):
            name = (f"{prefix}{i:02d}_{ev.symbol}_{ev.ts:%Y%m%d_%H%M}_"
                    f"{'hi' if ev.direction == 'high_sweep' else 'lo'}.png")
            L.render(ev, name, f"PDH/PDL gallery {prefix} {i:02d}/{N_PER_GROUP} — "
                               f"stratified, seed {SEED}, not cherry-picked")
            f_ = lambda v, s="{:.2f}": "" if pd.isna(v) else s.format(v)
            out.append(
                f"| {prefix}{i:02d} | {ev.symbol} | {ev.ts:%Y-%m-%d %H:%M} | "
                f"{'PDH' if ev.direction == 'high_sweep' else 'PDL'} | {ev.sweep_block} | "
                f"{'yes' if ev.coincident_session_level else 'no'} | "
                f"{int(ev.bars_remaining)} | {f_(ev.ifvg_delay_bars, '{:.0f}')} | "
                f"{int(ev.n_candidates)} | {f_(ev.gap_atr)} | {f_(ev.rev_atr)} | {f_(ev.adv_atr)} | "
                f"{f_(ev.ifvg_mfe_atr)} | {f_(ev.ifvg_mae_atr)} | {f_(ev.ifvg_R)} | "
                f"{f_(ev.er, '{:+.2f}')} | `{name}` |")
        out.append("")
    txt = "\n".join(out)
    with open(os.path.join(D.RESULTS, "PD-GALLERY.md"), "w") as fh:
        fh.write(txt + "\n")
    print("\nwrote", os.path.join(D.RESULTS, "PD-GALLERY.md"))


if __name__ == "__main__":
    main()
