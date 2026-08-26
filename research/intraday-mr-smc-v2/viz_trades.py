#!/usr/bin/env python3
"""Ten example-trade charts for `momentum_breakout` @ 1h (VIZ-SPEC.md).

Visualisation only. Nothing here touches the engine, the rule-set or the
parameters: it re-runs the *existing* v1 engine over the *existing* 1h pulls,
reproduces the REPORT.md §2.3 per-asset table as a gate, then draws ten trades
picked by a fixed, seed-driven protocol.

    ../../.venv/bin/python viz_trades.py

Outputs (all under research/intraday-mr-smc-v2/viz/):
    trade_01..10_<sym>_<yyyymmdd>_<long|short>_<win|loss|timeout>.png
    selected_trades.csv     audit trail (VIZ-SPEC §3.7)
    CAPTIONS.md             per-chart captions + selection audit
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

import common as C
import strategies as st
import strategies_v2 as sv

# ------------------------------------------------------------------ §1 config
CAND = "momentum_breakout"
IV = "1h"
SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
        "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]
START, END = "2022-08-01", "2026-08-01"
FEE_BPS = None                 # None -> engine default, 5.0 bp per side

HERE = os.path.dirname(os.path.abspath(__file__))
VIZ = os.path.join(HERE, "viz")
os.makedirs(VIZ, exist_ok=True)

# §5 sanity gate -- the numbers this run must reproduce from REPORT.md §2.3
GATE = dict(pf_lo=0.97, pf_hi=1.11, pf_median=1.03, trades=6792, wr_median=0.448)

# §3.3 quotas and §4 colours
QUOTAS = {"target": 4, "stop": 4, "time": 2}
UP, DN = "#26a69a", "#ef5350"
CTX_BEFORE, CTX_AFTER = 40, 10


# --------------------------------------------------------------- ledger build
def build(sym: str) -> dict:
    """One engine pass over the full window for one symbol.

    `sig`/`p` come straight from common.signals, so the rolling mean, sigma and
    ATR are computed on the FULL sliced series (VIZ-SPEC §2 warm-up warning) --
    the plot window is sliced out of `prep` afterwards, never recomputed.
    """
    d = C.slice_period(C.load(sym, IV), START, END)
    sig, p = C.signals(d, CAND)
    prep = st.prepare(d, p)                 # same call common.signals makes
    res = C.run(d, sig, p, fee_bps=FEE_BPS)
    tr = res["trades"].copy()
    if len(tr):
        tr["symbol"] = sym
        # exact stop/target recovery: the fill bar i was filled from the signal
        # row i-1, so the intent lives at i-1 (VIZ-SPEC §3, last note).
        pos = pd.Series(d.index.to_numpy(), index=d.ts.to_numpy())
        tr["i_entry"] = tr.entry_ts.map(pos).astype(int)
        tr["i_exit"] = tr.exit_ts.map(pos).astype(int)
        tr["i_sig"] = tr.i_entry - 1
        tr["stop_px"] = sig.stop.to_numpy()[tr.i_sig]
        tr["target_px"] = sig.target.to_numpy()[tr.i_sig]
        tr["trade_id"] = [f"{sym}-{t:%Y%m%dT%H%M}" for t in tr.entry_ts]
    return dict(sym=sym, bars=d, sig=sig, prep=prep, p=p, res=res, trades=tr)


def gate(books: dict) -> pd.DataFrame:
    rows = []
    for sym, b in books.items():
        m = C.stats(b["res"], IV)
        rows.append(dict(symbol=sym, trades=m["trades"], win_rate=m["win_rate"],
                         net_pf=m["profit_factor"], exp_R=m["expectancy_R"]))
    g = pd.DataFrame(rows)
    print("\n--- §5 sanity gate: full-window momentum_breakout, 1h, net of costs ---")
    for r in g.itertuples():
        print(f"  {r.symbol:<9} n={r.trades:>5}  wr={r.win_rate:.1%}  "
              f"net PF={r.net_pf:.3f}  exp={r.exp_R:+.4f} R")
    tot, pf_med, wr_med = int(g.trades.sum()), g.net_pf.median(), g.win_rate.median()
    print(f"  pooled trades={tot} (report ~{GATE['trades']})  "
          f"net PF min/median/max={g.net_pf.min():.2f}/{pf_med:.2f}/{g.net_pf.max():.2f} "
          f"(report {GATE['pf_lo']}/{GATE['pf_median']}/{GATE['pf_hi']})  "
          f"median WR={wr_med:.1%} (report {GATE['wr_median']:.1%})")

    fail = []
    if not (GATE["pf_lo"] - 0.005 <= g.net_pf.min() and g.net_pf.max() <= GATE["pf_hi"] + 0.005):
        fail.append("per-asset net PF outside the 0.97-1.11 band")
    if abs(pf_med - GATE["pf_median"]) > 0.01:
        fail.append(f"median net PF {pf_med:.3f} != ~{GATE['pf_median']}")
    if abs(tot - GATE["trades"]) > 25:
        fail.append(f"pooled trades {tot} != ~{GATE['trades']}")
    if abs(wr_med - GATE["wr_median"]) > 0.005:
        fail.append(f"median WR {wr_med:.3%} != ~{GATE['wr_median']:.1%}")
    if fail:
        raise SystemExit("SANITY GATE FAILED -- not plotting:\n  " + "\n  ".join(fail))
    print("  gate PASSED\n")
    return g


# ------------------------------------------------------------- §3 selection
def constraints_ok(sel: pd.DataFrame) -> list:
    bad = []
    if sel.symbol.nunique() < 4:
        bad.append("<4 distinct symbols")
    if sel.entry_ts.dt.year.nunique() < 3:
        bad.append("<3 distinct years")
    wk = sel.entry_ts.dt.isocalendar()
    if sel.assign(k=list(zip(sel.symbol, wk.year, wk.week))).k.duplicated().any():
        bad.append("two trades, same symbol, same ISO week")
    if (sel.side == 1).sum() < 3:
        bad.append("<3 longs")
    if (sel.side == -1).sum() < 3:
        bad.append("<3 shorts")
    t = sel[sel.reason == "time"]
    if t.symbol.nunique() < len(t):
        bad.append("the two time-stop trades share a symbol")
    return bad


def select(pool: pd.DataFrame, seed0: int = 42, max_tries: int = 200):
    """Deterministic rejection loop (§3.4-§3.6). No manual picking anywhere."""
    buckets = {k: pool[pool.reason == k].sort_values(["symbol", "entry_ts"])
                                        .reset_index(drop=True)
               for k in QUOTAS}
    for seed in range(seed0, seed0 + max_tries):
        rng = np.random.default_rng(seed)
        parts = [b.iloc[np.sort(rng.choice(len(b), QUOTAS[k], replace=False))]
                 for k, b in buckets.items()]
        sel = pd.concat(parts, ignore_index=True)
        bad = constraints_ok(sel)
        print(f"  seed {seed}: " + ("OK" if not bad else "reject -- " + "; ".join(bad)))
        if not bad:
            return seed, sel
    raise SystemExit("no seed satisfied the §3.5 constraints")


# ------------------------------------------------------------------ §4 chart
def candles(ax, w: pd.DataFrame, x):
    for xi, r in zip(x, w.itertuples()):
        col = UP if r.close >= r.open else DN
        ax.plot([xi, xi], [r.low, r.high], color=col, lw=0.8, zorder=2)
        lo, hgt = min(r.open, r.close), abs(r.close - r.open)
        ax.add_patch(Rectangle((xi - 0.32, lo), 0.64, max(hgt, 1e-12),
                               facecolor=col, edgecolor=col, lw=0.6, zorder=3))


def fmt(v: float) -> str:
    return f"{v:,.4f}" if v < 10 else (f"{v:,.3f}" if v < 100 else f"{v:,.2f}")


def draw(rank: int, t, book: dict, out_dir: str) -> str:
    d, prep, p = book["bars"], book["prep"], book["p"]
    lo = max(0, t.i_entry - CTX_BEFORE)
    hi = min(len(d) - 1, t.i_exit + CTX_AFTER)
    w = d.iloc[lo:hi + 1].reset_index(drop=True)
    pw = prep.iloc[lo:hi + 1].reset_index(drop=True)     # sliced, not recomputed
    x = np.arange(len(w))
    xs, xe, xg = t.i_entry - lo, t.i_exit - lo, t.i_sig - lo
    long_ = t.side == 1
    outcome = {"target": "WIN", "stop": "LOSS", "time": "TIMEOUT"}[t.reason]

    fig, ax = plt.subplots(figsize=(14, 7), dpi=150)
    fig.patch.set_facecolor("white"); ax.set_facecolor("white")

    # 1. band + mean (§2)
    up = pw["mean"] + sv.EXTRA_DEFAULTS["brk_z"] * pw["sd"]
    dnb = pw["mean"] - sv.EXTRA_DEFAULTS["brk_z"] * pw["sd"]
    ax.fill_between(x, dnb, up, color="#5b6ee1", alpha=0.08, zorder=0)
    ax.plot(x, up, color="#5b6ee1", lw=0.9, zorder=1)
    ax.plot(x, dnb, color="#5b6ee1", lw=0.9, zorder=1)
    ax.plot(x, pw["mean"], color="#888888", lw=1.0, ls="--", zorder=1,
            label=f"rolling mean ({p['mr_len']})")
    edge, lab = (up, "+2σ") if long_ else (dnb, "−2σ")
    ax.annotate(f"trigger band ({lab})", (x[3], edge.iloc[3]),
                xytext=(0, 8 if long_ else -16), textcoords="offset points",
                fontsize=8, color="#3d4fa1", zorder=8,
                bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=0.75))

    candles(ax, w, x)

    # 2. signal bar (the close that crossed the band)
    sy = w.high[xg] if long_ else w.low[xg]
    pad = (w.high.max() - w.low.min()) * 0.02
    ax.plot([xg], [sy + pad if long_ else sy - pad], marker="o", ms=9, mfc="none",
            mec="#3d4fa1", mew=1.6, zorder=6, label="signal bar (z crosses band)")

    # 3-6. trade geometry over the holding span
    span = [xs, xe]
    ax.axvspan(xs, xe, color="#5b6ee1", alpha=0.10, zorder=0)
    ax.plot(span, [t.entry] * 2, color="black", lw=1.6, zorder=5, label="entry")
    ax.plot(span, [t.stop_px] * 2, color="#c62828", lw=1.4, ls="--", zorder=5, label="stop")
    ax.plot(span, [t.target_px] * 2, color="#2e7d32", lw=1.4, ls="--", zorder=5, label="target")
    for y, txt, col in ((t.entry, f"entry {fmt(t.entry)}", "black"),
                        (t.stop_px, f"stop {fmt(t.stop_px)}", "#c62828"),
                        (t.target_px, f"target {fmt(t.target_px)}", "#2e7d32")):
        ax.annotate(txt, (xe, y), xytext=(16, 0), textcoords="offset points",
                    fontsize=8, color=col, va="center", fontweight="bold")
    # direction marker sits below the fill bar for a long, above it for a short
    my = w.low[xs] - pad if long_ else w.high[xs] + pad
    ax.plot([xs], [my], marker="^" if long_ else "v", ms=11, color="black", zorder=7)

    # 7. exit
    ax.plot([xe], [t.exit], marker="x", ms=13, mew=2.6, color="#111111", zorder=7,
            label=f"exit ({t.reason})")

    # 8. title
    ax.set_title(
        f"{t.symbol} 1h — {'LONG' if long_ else 'SHORT'} — entry "
        f"{t.entry_ts:%Y-%m-%d %H:%M} UTC — {outcome} — {t.r:+.2f}R",
        fontsize=13, fontweight="bold", pad=16)
    held = int(t.i_exit - t.i_entry)
    ax.text(0.5, 1.012,
            f"entry {fmt(t.entry)} · stop {fmt(t.stop_px)} · target "
            f"{fmt(t.target_px)} · exit {fmt(t.exit)} · {held} bars held "
            f"· momentum_breakout brk_z=2.0, stop_atr=1.5, mom_rr=1.5, time_stop=24",
            transform=ax.transAxes, ha="center", va="bottom", fontsize=8, color="#555555")

    tick = max(1, len(w) // 12)
    ax.set_xticks(x[::tick])
    ax.set_xticklabels([f"{ts:%m-%d %H:%M}" for ts in w.ts[::tick]], fontsize=8)
    ax.set_xlim(-1, len(w) + 8)
    ax.set_ylabel("price (USDT)", fontsize=9)
    ax.set_xlabel("bar close (UTC)", fontsize=9)
    ax.grid(alpha=0.15, lw=0.6)
    ax.legend(loc="upper left", fontsize=8, framealpha=0.9)
    fig.tight_layout()

    name = (f"trade_{rank:02d}_{t.symbol}_{t.entry_ts:%Y%m%d}_"
            f"{'long' if long_ else 'short'}_{outcome.lower()}.png")
    fig.savefig(os.path.join(out_dir, name), facecolor="white")
    plt.close(fig)
    return name


# ------------------------------------------------------------------- captions
def caption(t) -> str:
    long_ = t.side == 1
    dirn = "long" if long_ else "short"
    edge = "+2σ" if long_ else "−2σ"
    held = int(t.i_exit - t.i_entry)
    lead = (f"{t.symbol} stretched {'up' if long_ else 'down'} until the close of "
            f"{t.entry_ts - pd.Timedelta(hours=1):%Y-%m-%d %H:%M} UTC pushed "
            f"{'through' if long_ else 'below'} the {edge} edge of the 50-bar band, "
            f"so the rule went {dirn} at the next bar's open ({fmt(t.entry)}).")
    if t.reason == "target":
        end = (f"Price kept extending and tagged the 1.5R target at {fmt(t.exit)} "
               f"after {held} bars, closing the trade at {t.r:+.2f}R.")
    elif t.reason == "stop":
        end = (f"The push failed instead of continuing: price came back through "
               f"{fmt(t.stop_px)} (1.5 ATR beyond the signal bar's "
               f"{'low' if long_ else 'high'}) after {held} bars, for {t.r:+.2f}R.")
    else:
        end = (f"Neither line was reached — after the 24-bar time stop the position "
               f"was closed at the bar close ({fmt(t.exit)}), between stop "
               f"{fmt(t.stop_px)} and target {fmt(t.target_px)}, for {t.r:+.2f}R.")
    return lead + " " + end


def main():
    print(f"building full-window ledgers: {CAND} @ {IV}, {START} -> {END}")
    books = {s: build(s) for s in SYMS}
    g = gate(books)

    pool = pd.concat([b["trades"] for b in books.values()], ignore_index=True)
    pool = pool[pool.reason != "eod"].reset_index(drop=True)
    counts = pool.reason.value_counts().to_dict()
    print(f"pooled ledger (eod dropped): {len(pool)} trades  {counts}")

    print("§3 deterministic draw:")
    seed, sel = select(pool)

    order = {"target": 0, "stop": 1, "time": 2}
    sel = (sel.assign(_g=sel.reason.map(order))
              .sort_values(["_g", "entry_ts"]).reset_index(drop=True))

    rows, caps = [], []
    for rank, t in enumerate(sel.itertuples(), start=1):
        name = draw(rank, t, books[t.symbol], VIZ)
        print(f"  wrote viz/{name}")
        rows.append(dict(rank=rank, trade_id=t.trade_id, symbol=t.symbol,
                         direction="long" if t.side == 1 else "short",
                         entry_ts=t.entry_ts, exit_ts=t.exit_ts,
                         entry=t.entry, exit=t.exit, stop=t.stop_px,
                         target=t.target_px, reason=t.reason, r=t.r, pnl=t.pnl,
                         bars_held=int(t.i_exit - t.i_entry), seed=seed, file=name))
        caps.append((rank, name, t))
    audit = pd.DataFrame(rows)
    audit.to_csv(os.path.join(VIZ, "selected_trades.csv"), index=False)

    wr = float((pool.pnl > 0).mean())
    with open(os.path.join(VIZ, "CAPTIONS.md"), "w") as f:
        f.write("# Ten example trades — `momentum_breakout` @ 1h\n\n"
                "Charts generated by `viz_trades.py` per `VIZ-SPEC.md`. Every chart shows "
                "the 50-bar rolling mean, the ±2σ trigger band, the signal bar "
                "whose close crossed that band, the fill/stop/target lines over the "
                "holding period, and the exit.\n\n")
        for rank, name, t in caps:
            outcome = {"target": "WIN", "stop": "LOSS", "time": "TIMEOUT"}[t.reason]
            f.write(f"## {rank}. `{name}`\n\n"
                    f"**{t.symbol} · {'LONG' if t.side == 1 else 'SHORT'} · "
                    f"{outcome} · {t.r:+.2f}R · entry "
                    f"{t.entry_ts:%Y-%m-%d %H:%M} UTC**\n\n"
                    f"{caption(t)}\n\n")
        f.write("---\n\n## Selection audit\n\n")
        f.write(f"* Protocol: `VIZ-SPEC.md` §3 — fixed quotas **4 target / 4 stop / "
                f"2 time**, deterministic draw from seed 42 upward, first seed whose draw "
                f"satisfies every §3.5 representativeness constraint wins. "
                f"**Winning seed: {seed}.** No trade was hand-picked, vetoed or swapped.\n")
        f.write(f"* Full pooled ledger (8 perps, {START} → {END}, `eod` rows dropped): "
                f"**{len(pool)} trades** — "
                f"target {counts.get('target', 0)} "
                f"({counts.get('target', 0) / len(pool):.1%}), "
                f"stop {counts.get('stop', 0)} "
                f"({counts.get('stop', 0) / len(pool):.1%}), "
                f"time {counts.get('time', 0)} "
                f"({counts.get('time', 0) / len(pool):.1%}). "
                f"True pooled win rate **{wr:.1%}**. The 40/40/20 chart mix therefore "
                f"over-represents target exits and under-represents time exits relative to "
                f"the real mix; it is chosen to show all three exit mechanics, not to "
                f"mirror their frequencies.\n")
        f.write("* Reproduction gate (`VIZ-SPEC.md` §5, `REPORT.md` §2.3): per-asset net PF "
                f"{g.net_pf.min():.2f} / {g.net_pf.median():.2f} / {g.net_pf.max():.2f} "
                f"(min/median/max), median WR {g.win_rate.median():.1%}, pooled trades "
                f"{int(g.trades.sum())} — matches the report before any trade was "
                f"selected.\n")
        f.write("* Data: the existing 1h pulls (`data.binance.vision` USD-M perpetual "
                "monthly klines), copied unchanged from the v2 research worktree. Nothing "
                "was re-fetched, and the engine and parameters are untouched.\n\n")
        f.write("**Reminder:** `momentum_breakout` nets ≈ **+0.019 R per trade** after "
                "5 bp/side costs. These ten charts illustrate the mechanics of the rule "
                "— how the trigger, the stop, the target and the time stop behave "
                "— and are **not** a performance claim. A 4-win / 4-loss / 2-timeout "
                "sample says nothing about the edge; the report's pooled numbers do.\n")
    print(f"\nwrote viz/selected_trades.csv and viz/CAPTIONS.md (seed {seed})")
    print(audit[["rank", "trade_id", "direction", "reason", "r"]].to_string(index=False))


if __name__ == "__main__":
    main()
