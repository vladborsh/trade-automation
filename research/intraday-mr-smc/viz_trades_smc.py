#!/usr/bin/env python3
"""Ten example-trade charts for the retired `smc` candidate @ 1h (VIZ-SPEC-SMC.md).

Visualisation only. Nothing here touches the engine, the rule-set or the
parameters: it re-runs the *existing* v1 engine over the *existing* 1h pulls,
reproduces the REPORT.md §3 `smc / 1h` rows as a hard gate, then draws ten
trades picked by a fixed, seed-driven rejection loop.

    ../../.venv/bin/python viz_trades_smc.py

Outputs (all under research/intraday-mr-smc/viz/):
    trade_01..10_<sym>_<yyyymmdd>_<long|short>_<win|loss|timeout>.png
    selected_trades.csv     audit trail (VIZ-SPEC-SMC §3.9)
    CAPTIONS.md             per-chart captions + selection audit + framing numbers
"""
from __future__ import annotations
import os
import sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.abspath(os.path.join(HERE, "..", "intraday-mr-smc-v2"))
if V2 not in sys.path:
    sys.path.insert(0, V2)

import common as C          # noqa: E402  (v2 helper; wraps the v1 engine unchanged)
import strategies as st     # noqa: E402

# ------------------------------------------------------------------ §1 config
CAND = "smc"
IV = "1h"
SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
START, END = "2022-08-01", "2026-08-01"
FEE_BPS = None                 # None -> engine default, 5.0 bp per side

VIZ = os.path.join(HERE, "viz")
os.makedirs(VIZ, exist_ok=True)

# §5 sanity gate -- the REPORT.md §3 `smc / 1h` rows this run must reproduce.
GATE = {
    "BTCUSDT": dict(trades=2408, wr=0.377, pf=0.71),
    "ETHUSDT": dict(trades=2387, wr=0.380, pf=0.81),
    "SOLUSDT": dict(trades=2415, wr=0.386, pf=0.91),
}
TOL = dict(trades=0.01, wr=0.005, pf=0.02)      # ±1% / ±0.5 pt / ±0.02

# §3.4 quotas
QUOTAS = {"target": 3, "stop": 5, "time": 2}
# §4 palette
UP, DN = "#26a69a", "#ef5350"
OB_C, FVG_C = "#1565c0", "#ef6c00"
CTX_BEFORE, CTX_CAP, CTX_AFTER = 60, 120, 10
TEXTBOOK_BOS_WINDOW = 20        # §3.2


# --------------------------------------------------------------- ledger build
def build(sym: str) -> dict:
    """One engine pass over the full window for one symbol.

    `prepare()` (and therefore the `structure()` state machine) is run ONCE on
    the full window-sliced series, exactly as `common.signals` does. The plot
    window is sliced out of `prep` afterwards, never recomputed (§2 critical
    correctness rule).
    """
    d = C.slice_period(C.load(sym, IV), START, END)
    sig, p = C.signals(d, CAND)
    prep = st.prepare(d, p)                 # same call common.signals makes
    res = C.run(d, sig, p, fee_bps=FEE_BPS)
    tr = res["trades"].copy()
    if len(tr):
        tr["symbol"] = sym
        # exact stop/target recovery: the fill bar i was filled from the signal
        # row i-1, so the intent lives at i-1 (VIZ-SPEC-SMC §3, last note).
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
    g = pd.DataFrame(rows).set_index("symbol")

    print("\n--- §5 sanity gate: full-window smc, 1h, net of costs ---")
    fail = []
    for sym, exp in GATE.items():
        r = g.loc[sym]
        print(f"  {sym:<9} n={int(r.trades):>5} (report {exp['trades']})  "
              f"wr={r.win_rate:.1%} (report {exp['wr']:.1%})  "
              f"net PF={r.net_pf:.3f} (report {exp['pf']:.2f})  "
              f"exp={r.exp_R:+.4f} R")
        if abs(r.trades - exp["trades"]) > TOL["trades"] * exp["trades"]:
            fail.append(f"{sym}: trades {int(r.trades)} vs report {exp['trades']}")
        if abs(r.win_rate - exp["wr"]) > TOL["wr"]:
            fail.append(f"{sym}: win rate {r.win_rate:.3%} vs report {exp['wr']:.1%}")
        if abs(r.net_pf - exp["pf"]) > TOL["pf"]:
            fail.append(f"{sym}: net PF {r.net_pf:.3f} vs report {exp['pf']:.2f}")
    if fail:
        raise SystemExit("SANITY GATE FAILED -- not plotting:\n  " + "\n  ".join(fail))
    print("  gate PASSED\n")
    return g.reset_index()


# ------------------------------------------------- §2 structure reconstruction
def _zone_run_start(prep: pd.DataFrame, s: int, cols: tuple) -> int:
    """First bar of the contiguous run of identical zone values ending at `s`.

    Zone values only change on re-assignment or mitigation, so the
    contiguous-run test recovers the formation/activation bar exactly (§2.1).
    """
    vals = [prep[c].to_numpy() for c in cols]
    ref = [v[s] for v in vals]
    b = s
    while b - 1 >= 0 and all(
            (v[b - 1] == r) or (np.isnan(v[b - 1]) and np.isnan(r))
            for v, r in zip(vals, ref)):
        b -= 1
    return b


def enrich(book: dict) -> pd.DataFrame:
    """Attach the §2 reconstruction to EVERY ledger row of one symbol.

    Read strictly at the signal bar `i-1`, never the fill bar.
    """
    tr, prep = book["trades"], book["prep"]
    if not len(tr):
        return tr
    s = tr.i_sig.to_numpy()
    side = tr.side.to_numpy()
    g = {c: prep[c].to_numpy() for c in
         ("low", "high", "close", "ob_low", "ob_high", "ob_dir",
          "fvg_low", "fvg_high", "fvg_dir", "bias", "bos", "choch",
          "swing_high", "swing_low")}

    # --- which condition(s) fired, evaluated exactly as strategies.smc does
    ob_hit = np.where(
        side == 1,
        (g["ob_dir"][s] == 1) & (g["low"][s] <= g["ob_high"][s]) & (g["close"][s] > g["ob_low"][s]),
        (g["ob_dir"][s] == -1) & (g["high"][s] >= g["ob_low"][s]) & (g["close"][s] < g["ob_high"][s]))
    fv_hit = np.where(
        side == 1,
        (g["fvg_dir"][s] == 1) & (g["low"][s] <= g["fvg_high"][s]) & (g["close"][s] > g["fvg_low"][s]),
        (g["fvg_dir"][s] == -1) & (g["high"][s] >= g["fvg_low"][s]) & (g["close"][s] < g["fvg_high"][s]))
    trigger = np.where(ob_hit & fv_hit, "OB+FVG", np.where(ob_hit, "OB", "FVG"))

    # --- stop basis: smc() anchors to the OB whenever ob_dir matches the side,
    #     even when only the FVG condition fired (§1 precision note).
    ob_matches = np.where(side == 1, g["ob_dir"][s] == 1, g["ob_dir"][s] == -1)
    stop_basis = np.where(ob_matches, "OB", "FVG")

    # --- §2.3 BOS recovery: most recent bar b <= s with bos[b] == side.
    n = len(prep)
    idx = np.arange(n)
    bos_b, bos_lvl, choch_f = [], [], []
    for si, sd in zip(s, side):
        cand = idx[:si + 1][g["bos"][:si + 1] == sd]
        if not len(cand):
            raise SystemExit(
                f"§2.3 escalation: no bos=={sd} at or before bar {si} in "
                f"{book['sym']} — cannot recover the BOS level.")
        b = int(cand[-1])
        lvl = g["swing_high"][b - 1] if sd == 1 else g["swing_low"][b - 1]
        if b - 1 < 0 or np.isnan(lvl):
            raise SystemExit(
                f"§2.3 escalation: broken swing level missing at bar {b - 1} in "
                f"{book['sym']} (trade signal bar {si}).")
        bos_b.append(b)
        bos_lvl.append(float(lvl))
        choch_f.append(bool(g["choch"][b] != 0))

    tr = tr.copy()
    tr["zone_trigger"] = trigger
    tr["stop_basis"] = stop_basis
    tr["i_bos"] = bos_b
    tr["bos_ts"] = book["bars"].ts.to_numpy()[bos_b]
    tr["bos_level"] = bos_lvl
    tr["choch"] = choch_f
    tr["bos_age"] = tr.i_sig - tr.i_bos
    # §3.2 textbook: an OB retest of a BOS no older than 20 bars.
    tr["textbook"] = tr.zone_trigger.str.contains("OB") & (tr.bos_age <= TEXTBOOK_BOS_WINDOW)
    return tr


# --------------------------------------------------------------- §3 selection
def constraints_ok(sel: pd.DataFrame) -> list:
    bad = []
    if sel.symbol.nunique() < 3:
        bad.append("<3 distinct symbols")
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
    # §3.5 textbook sub-quotas
    nb_stop = int(sel[(sel.reason == "stop") & sel.textbook].shape[0])
    if nb_stop < 3:
        bad.append(f"only {nb_stop}/5 textbook stop trades (<3)")
    nb_tgt = int(sel[(sel.reason == "target") & sel.textbook].shape[0])
    if nb_tgt < 2:
        bad.append(f"only {nb_tgt}/3 textbook target trades (<2)")
    if (sel.zone_trigger == "FVG").sum() < 1:
        bad.append("no FVG-only trigger among the 10")
    return bad


def select(pool: pd.DataFrame, seed0: int = 42, seed_max: int = 142):
    """Deterministic rejection loop (§3.6-§3.8). No manual picking anywhere."""
    buckets = {k: pool[pool.reason == k].sort_values(["symbol", "entry_ts"])
                                        .reset_index(drop=True)
               for k in QUOTAS}
    for k, b in buckets.items():
        if len(b) < QUOTAS[k]:
            raise SystemExit(f"bucket '{k}' has {len(b)} trades, need {QUOTAS[k]}")
    for seed in range(seed0, seed_max + 1):
        rng = np.random.default_rng(seed)
        parts = [b.iloc[np.sort(rng.choice(len(b), QUOTAS[k], replace=False))]
                 for k, b in buckets.items()]
        sel = pd.concat(parts, ignore_index=True)
        bad = constraints_ok(sel)
        print(f"  seed {seed}: " + ("OK" if not bad else "reject — " + "; ".join(bad)))
        if not bad:
            return seed, sel
    raise SystemExit(
        "§3.8 escalation: no seed 42..142 satisfied every constraint. Bucket counts: "
        + str({k: len(b) for k, b in buckets.items()})
        + f"; FVG-only in pool={int((pool.zone_trigger == 'FVG').sum())}"
        + f"; textbook stop={int(pool[(pool.reason == 'stop') & pool.textbook].shape[0])}"
        + f"; textbook target={int(pool[(pool.reason == 'target') & pool.textbook].shape[0])}")


# ------------------------------------------------------------------ §4 chart
def candles(ax, w: pd.DataFrame, x, body=0.32):
    for xi, r in zip(x, w.itertuples()):
        col = UP if r.close >= r.open else DN
        ax.plot([xi, xi], [r.low, r.high], color=col, lw=0.8, zorder=2)
        lo, hgt = min(r.open, r.close), abs(r.close - r.open)
        ax.add_patch(Rectangle((xi - body, lo), 2 * body, max(hgt, 1e-12),
                               facecolor=col, edgecolor=col, lw=0.6, zorder=3))


def fmt(v: float) -> str:
    return f"{v:,.4f}" if v < 10 else (f"{v:,.3f}" if v < 100 else f"{v:,.2f}")


def draw(rank: int, t, book: dict, out_dir: str) -> tuple:
    d, prep = book["bars"], book["prep"]
    long_ = t.side == 1
    s = int(t.i_sig)

    # --- zone geometry (§2.1), read at the signal bar
    zones = []                    # (label, lo, hi, colour, alpha, formation bar)
    ob_dir_s = prep.ob_dir.to_numpy()[s]
    ob_matches = (ob_dir_s == 1) if long_ else (ob_dir_s == -1)
    if "OB" in t.zone_trigger:
        f = _zone_run_start(prep, s, ("ob_low", "ob_high", "ob_dir"))
        zones.append(("OB", prep.ob_low.iloc[s], prep.ob_high.iloc[s], OB_C, 0.15, f))
    elif ob_matches:
        # §2.1: stop anchored to an OB that did not trigger — draw it faintly.
        f = _zone_run_start(prep, s, ("ob_low", "ob_high", "ob_dir"))
        zones.append(("OB (stop basis)", prep.ob_low.iloc[s], prep.ob_high.iloc[s],
                      OB_C, 0.08, f))
    if "FVG" in t.zone_trigger:
        f = _zone_run_start(prep, s, ("fvg_low", "fvg_high", "fvg_dir"))
        zones.append(("FVG", prep.fvg_low.iloc[s], prep.fvg_high.iloc[s], FVG_C, 0.15, f))

    # --- broken swing bar (§2.3 step 4): start of the level's contiguous run
    b = int(t.i_bos)
    col = prep.swing_high.to_numpy() if long_ else prep.swing_low.to_numpy()
    j = b - 1
    while j - 1 >= 0 and col[j - 1] == t.bos_level:
        j -= 1
    i_swing = j

    # --- §4 dynamic window
    want = min([t.i_entry - CTX_BEFORE] + [z[5] - 5 for z in zones] + [i_swing - 5])
    lo = max(0, t.i_entry - CTX_CAP, want)
    truncated = lo > want
    hi = min(len(d) - 1, t.i_exit + CTX_AFTER)

    w = d.iloc[lo:hi + 1].reset_index(drop=True)
    x = np.arange(len(w))
    xs, xe, xg, xb = t.i_entry - lo, t.i_exit - lo, s - lo, b - lo
    outcome = {"target": "WIN", "stop": "LOSS", "time": "TIMEOUT"}[t.reason]

    wide = len(w) > 110
    fig, ax = plt.subplots(figsize=((16, 7) if wide else (14, 7)), dpi=150)
    fig.patch.set_facecolor("white"); ax.set_facecolor("white")

    # 2. zone rectangles: formation/activation bar -> signal bar, inclusive
    for lab, zlo, zhi, c, a, f in zones:
        x0 = max(f - lo, -0.5)
        ax.add_patch(Rectangle((x0, zlo), (xg - x0) + 0.5, max(zhi - zlo, 1e-12),
                               facecolor=c, alpha=a, edgecolor=c, lw=1.0, zorder=1))
        ax.annotate(lab, (x0, zhi), xytext=(3, 3), textcoords="offset points",
                    fontsize=8, color=c, fontweight="bold", zorder=8,
                    bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.7))

    # 3. broken swing level + BOS/CHoCH marker (§2.2)
    ax.plot([max(i_swing - lo, -0.5), xb], [t.bos_level] * 2, color="#777777",
            lw=1.2, ls=":", zorder=4,
            label=f"broken swing {fmt(t.bos_level)} ({'CHoCH' if t.choch else 'BOS'})")
    candles(ax, w, x, body=0.24 if wide else 0.32)

    pad = (w.high.max() - w.low.min()) * 0.02
    by = (w.high[xb] + pad) if long_ else (w.low[xb] - pad)
    ax.plot([xb], [by], marker="D", ms=7, color="#444444", zorder=7)
    ax.annotate("CHoCH" if t.choch else "BOS", (xb, by),
                xytext=(0, 8 if long_ else -16), textcoords="offset points",
                fontsize=8, color="#444444", ha="center", fontweight="bold", zorder=8)

    # 4. signal bar (nudged clear of the BOS diamond when they are the same bar)
    off = pad * (2.2 if xg == xb else 1.0)
    sy = (w.high[xg] + off) if long_ else (w.low[xg] - off)
    ax.plot([xg], [sy], marker="o", ms=9, mfc="none", mec="#3d4fa1", mew=1.6,
            zorder=6, label="signal bar (retest into zone)")

    # 5-8. trade geometry over the holding span
    span = [xs, xe]
    ax.axvspan(xs, xe, color="#5b6ee1", alpha=0.10, zorder=0)
    ax.plot(span, [t.entry] * 2, color="black", lw=1.6, zorder=5, label="entry")
    ax.plot(span, [t.stop_px] * 2, color="#c62828", lw=1.4, ls="--", zorder=5, label="stop")
    ax.plot(span, [t.target_px] * 2, color="#2e7d32", lw=1.4, ls="--", zorder=5,
            label=f"target ({book['p']['smc_rr']:.0f}R)")
    for y, txt, c in ((t.entry, f"entry {fmt(t.entry)}", "black"),
                      (t.stop_px, f"stop {fmt(t.stop_px)}", "#c62828"),
                      (t.target_px, f"target {fmt(t.target_px)}", "#2e7d32")):
        ax.annotate(txt, (xe, y), xytext=(16, 0), textcoords="offset points",
                    fontsize=8, color=c, va="center", fontweight="bold")
    my = (w.low[xs] - pad) if long_ else (w.high[xs] + pad)
    ax.plot([xs], [my], marker="^" if long_ else "v", ms=11, color="black", zorder=7)

    # 9. exit
    ax.plot([xe], [t.exit], marker="x", ms=13, mew=2.6, color="#111111", zorder=7,
            label=f"exit ({t.reason})")

    # 10. title + subtitle
    ax.set_title(
        f"{t.symbol} 1h — {'LONG' if long_ else 'SHORT'} — entry "
        f"{t.entry_ts:%Y-%m-%d %H:%M} UTC — {outcome} — {t.r:+.2f}R",
        fontsize=13, fontweight="bold", pad=16)
    held = int(t.i_exit - t.i_entry)
    ax.text(0.5, 1.012,
            f"entry {fmt(t.entry)} · stop {fmt(t.stop_px)} · target {fmt(t.target_px)} "
            f"· exit {fmt(t.exit)} · {held} bar{'' if held == 1 else 's'} held · bias: "
            f"{'bullish' if long_ else 'bearish'} · zone: {t.zone_trigger} · stop basis: "
            f"{t.stop_basis} · textbook: {'yes' if t.textbook else 'no'} · "
            f"{'CHoCH' if t.choch else 'BOS'} {int(t.bos_age) + 1} "
            f"bar{'' if int(t.bos_age) + 1 == 1 else 's'} before entry",
            transform=ax.transAxes, ha="center", va="bottom", fontsize=8, color="#555555")

    # y-range: candles + stop/target + zone edges + BOS level, 2% padding
    ys = [w.low.min(), w.high.max(), t.stop_px, t.target_px, t.bos_level]
    for _, zlo, zhi, _, _, _ in zones:
        ys += [zlo, zhi]
    ylo, yhi = float(np.nanmin(ys)), float(np.nanmax(ys))
    m = (yhi - ylo) * 0.02
    ylo, yhi = ylo - m, yhi + m
    # keep the BOS / signal / direction markers and their labels inside the axes
    mk = [by, sy, my]
    ylo = min([ylo] + [v - 2.2 * pad for v in mk])
    yhi = max([yhi] + [v + 2.2 * pad for v in mk])
    ax.set_ylim(ylo, yhi)

    tick = max(1, len(w) // 12)
    ax.set_xticks(x[::tick])
    ax.set_xticklabels([f"{ts:%m-%d %H:%M}" for ts in w.ts[::tick]], fontsize=8)
    ax.set_xlim(-1, len(w) + 9)
    ax.set_ylabel("price (USDT)", fontsize=9)
    ax.set_xlabel("bar close (UTC)", fontsize=9)
    ax.grid(alpha=0.15, lw=0.6)
    ax.legend(loc="upper left", fontsize=8, framealpha=0.9)
    fig.tight_layout()

    name = (f"trade_{rank:02d}_{t.symbol}_{t.entry_ts:%Y%m%d}_"
            f"{'long' if long_ else 'short'}_{outcome.lower()}.png")
    fig.savefig(os.path.join(out_dir, name), facecolor="white")
    plt.close(fig)
    return name, truncated, len(w)


# ------------------------------------------------------------------- captions
def caption(t, truncated: bool) -> str:
    long_ = t.side == 1
    dirn, updn = ("long", "up") if long_ else ("short", "down")
    brk = "CHoCH" if t.choch else "BOS"
    held = int(t.i_exit - t.i_entry)
    age = int(t.bos_age) + 1
    zone_txt = {"OB": "the order block", "FVG": "the fair value gap",
                "OB+FVG": "both the order block and the fair value gap"}[t.zone_trigger]

    s1 = (f"Structure broke {updn} through the swing at {fmt(t.bos_level)} "
          f"{age} bar{'' if age == 1 else 's'} before the fill — a {brk}"
          + (" that flipped the prevailing bias" if t.choch else "")
          + f" — leaving bias {'bullish' if long_ else 'bearish'} and marking the "
          f"{'bullish' if long_ else 'bearish'} zone the impulse left behind.")
    s2 = (f"Price then retraced into {zone_txt} and closed back "
          f"{'above' if long_ else 'below'} it, so the rule went {dirn} at the next "
          f"bar's open ({fmt(t.entry)}), stop {fmt(t.stop_px)} "
          f"(anchored to the {t.stop_basis}"
          + (", not the zone that triggered the entry" if t.stop_basis not in t.zone_trigger else "")
          + f"), target {fmt(t.target_px)} at 2R.")
    if t.reason == "target":
        s3 = (f"The continuation came: the 2R target printed at {fmt(t.exit)} after "
              f"{held} bar{'' if held == 1 else 's'}, for {t.r:+.2f}R.")
    elif t.reason == "stop":
        s3 = (f"The retest kept going instead of holding: {fmt(t.stop_px)} gave way "
              f"after {held} bar{'' if held == 1 else 's'}, for {t.r:+.2f}R.")
    else:
        s3 = (f"Neither line was reached — the 24-bar time stop closed the position at "
              f"{fmt(t.exit)}, between stop {fmt(t.stop_px)} and target "
              f"{fmt(t.target_px)}, for {t.r:+.2f}R.")
    if t.textbook and t.reason == "stop":
        s3 += (" This is the pattern exactly as the SMC playbook teaches it — a fresh "
               "break of structure, retested promptly at the order block, entered with "
               "structure — and it lost anyway.")
    if truncated:
        s3 += (" The chart's 120-bar left cap truncates the zone's formation or the "
               "broken swing's own bar: the level was retested long after it formed, "
               "and that staleness is part of the failure story.")
    return " ".join([s1, s2, s3])


def main():
    print(f"building full-window ledgers: {CAND} @ {IV}, {START} -> {END}")
    books = {s: build(s) for s in SYMS}
    g = gate(books)

    for s in SYMS:
        books[s]["trades"] = enrich(books[s])

    pool = pd.concat([b["trades"] for b in books.values()], ignore_index=True)
    pool = pool[pool.reason != "eod"].reset_index(drop=True)
    counts = pool.reason.value_counts().to_dict()
    wr = float((pool.pnl > 0).mean())
    tb = pool[pool.textbook]
    tb_wr = float((tb.pnl > 0).mean()) if len(tb) else float("nan")
    zt = pool.zone_trigger.value_counts().to_dict()
    print(f"pooled ledger (eod dropped): {len(pool)} trades  {counts}  WR={wr:.1%}")
    print(f"  zone_trigger mix: {zt}")
    print(f"  textbook subset: {len(tb)} ({len(tb)/len(pool):.1%})  WR={tb_wr:.1%}")

    print("§3 deterministic draw:")
    seed, sel = select(pool)

    order = {"target": 0, "stop": 1, "time": 2}
    sel = (sel.assign(_g=sel.reason.map(order))
              .sort_values(["_g", "entry_ts"]).reset_index(drop=True))

    rows, caps = [], []
    for rank, t in enumerate(sel.itertuples(), start=1):
        name, truncated, nbars = draw(rank, t, books[t.symbol], VIZ)
        print(f"  wrote viz/{name}  ({nbars} bars"
              + (", left cap hit" if truncated else "") + ")")
        rows.append(dict(rank=rank, trade_id=t.trade_id, symbol=t.symbol,
                         direction="long" if t.side == 1 else "short",
                         entry_ts=t.entry_ts, exit_ts=t.exit_ts,
                         entry=t.entry, exit=t.exit, stop=t.stop_px,
                         target=t.target_px, reason=t.reason, r=t.r, pnl=t.pnl,
                         bars_held=int(t.i_exit - t.i_entry),
                         zone_trigger=t.zone_trigger, stop_basis=t.stop_basis,
                         bos_ts=t.bos_ts, bos_level=t.bos_level,
                         bos_bars_before_entry=int(t.bos_age) + 1,
                         choch=bool(t.choch), textbook=bool(t.textbook),
                         window_bars=nbars, left_cap_hit=truncated,
                         seed=seed, file=name))
        caps.append((rank, name, t, truncated))
    audit = pd.DataFrame(rows)
    # §3.9: full-ledger totals recorded alongside the per-trade rows
    audit["ledger_trades"] = len(pool)
    audit["ledger_target"] = counts.get("target", 0)
    audit["ledger_stop"] = counts.get("stop", 0)
    audit["ledger_time"] = counts.get("time", 0)
    audit["ledger_win_rate"] = round(wr, 6)
    audit["ledger_textbook_n"] = len(tb)
    audit["ledger_textbook_win_rate"] = round(tb_wr, 6)
    audit.to_csv(os.path.join(VIZ, "selected_trades.csv"), index=False)

    with open(os.path.join(VIZ, "CAPTIONS.md"), "w") as f:
        f.write(
            "# Ten example trades — the retired `smc` candidate @ 1h\n\n"
            "Charts generated by `viz_trades_smc.py` per `VIZ-SPEC-SMC.md`. Every chart "
            "shows the order block and/or fair value gap the entry retested (shaded "
            "rectangle, blue OB / orange FVG, drawn from the zone's formation bar to the "
            "signal bar), the swing level the most recent break of structure took out "
            "(dotted grey, with a `BOS`/`CHoCH` diamond on the breaking bar), the signal "
            "bar that traded into the zone and closed back across it, the fill / stop / "
            "2R-target lines over the holding period, and the exit.\n\n"
            "**These charts illustrate the mechanics of a *retired* candidate "
            "(`REPORT.md` §8, `ARCHITECT-NOTE.md` §2.2), not a tradable pattern.**\n\n")
        for rank, name, t, truncated in caps:
            outcome = {"target": "WIN", "stop": "LOSS", "time": "TIMEOUT"}[t.reason]
            f.write(f"## {rank}. `{name}`\n\n"
                    f"**{t.symbol} · {'LONG' if t.side == 1 else 'SHORT'} · {outcome} · "
                    f"{t.r:+.2f}R · entry {t.entry_ts:%Y-%m-%d %H:%M} UTC · "
                    f"zone {t.zone_trigger} · stop basis {t.stop_basis} · textbook "
                    f"{'yes' if t.textbook else 'no'}**\n\n{caption(t, truncated)}\n\n")

        f.write("---\n\n## Selection audit\n\n")
        f.write(
            f"* Protocol: `VIZ-SPEC-SMC.md` §3 — fixed quotas **3 target / 5 stop / "
            f"2 time**, pre-committed textbook sub-quotas (≥3 textbook stops, ≥2 "
            f"textbook targets, ≥1 FVG-only trigger) and the §3.7 representativeness "
            f"constraints, drawn deterministically from seed 42 upward with "
            f"`numpy.random.default_rng`. First fully-satisfying seed wins. "
            f"**Winning seed: {seed}.** No trade was hand-picked, vetoed or swapped; "
            f"the rejection loop is the only selection mechanism.\n")
        f.write(
            f"* Full pooled ledger (BTC/ETH/SOL, 1h, {START} → {END}, `eod` rows "
            f"dropped): **{len(pool)} trades** — target {counts.get('target', 0)} "
            f"({counts.get('target', 0)/len(pool):.1%}), stop {counts.get('stop', 0)} "
            f"({counts.get('stop', 0)/len(pool):.1%}), time {counts.get('time', 0)} "
            f"({counts.get('time', 0)/len(pool):.1%}). True pooled win rate "
            f"**{wr:.1%}**. The 3/5/2 chart mix is weighted toward losses to echo that "
            f"win rate while still showing three full 2R payoffs.\n")
        f.write(
            f"* Trigger mix across the full ledger: "
            + ", ".join(f"{k} {v} ({v/len(pool):.1%})" for k, v in sorted(zt.items()))
            + ".\n")
        f.write(
            f"* Reproduction gate (`VIZ-SPEC-SMC.md` §5, `REPORT.md` §3): per-symbol "
            + ", ".join(f"{r.symbol} n={int(r.trades)} WR={r.win_rate:.1%} "
                        f"PF={r.net_pf:.2f}" for r in g.itertuples())
            + " — reproduces the report's `smc / 1h` rows (2408/37.7%/0.71, "
              "2387/38.0%/0.81, 2415/38.6%/0.91) before any trade was selected.\n")
        f.write(
            "* Data: the existing 1h pulls (`data.binance.vision` USD-M perpetual "
            "monthly klines), copied unchanged from the v2 research worktree per §5. "
            "Nothing was re-fetched; the engine, rule-set and parameters "
            "(`smc_k=2`, `smc_rr=2.0`, `atr_len=14`, `time_stop=24`, 5 bp/side, "
            "1% risk) are untouched.\n\n")

        f.write("## The framing numbers\n\n")
        f.write(
            f"* **{len(tb)} of {len(pool)} trades ({len(tb)/len(pool):.1%}) are "
            f"`textbook`** — an order-block retest of a break of structure no more than "
            f"{TEXTBOOK_BOS_WINDOW} bars old. Their win rate is **{tb_wr:.1%}**, against "
            f"a full-ledger **{wr:.1%}** and a 2R break-even line of **33.3%**.\n")
        f.write(
            "* `edge_probe.py` measured **−0.03 bp** of direction-adjusted forward "
            "return over **46,045** non-overlapping `smc` 1h triggers, median t-stat "
            "+0.22, zero cells with t > 2 (`REPORT.md` §4).\n\n")
        f.write(
            "The pattern is not rare and the entries are not obviously wrong: the "
            "textbook setups look exactly like the playbook and resolve barely above "
            "the coin-flip their own 2R geometry demands. That is the failure — a "
            "clean, legible rule with no forward edge to trade. These ten charts show "
            "how that rule behaves bar by bar; they are not a performance claim, and "
            "the candidate stays retired.\n")

    print(f"\nwrote viz/selected_trades.csv and viz/CAPTIONS.md (seed {seed})")
    print(audit[["rank", "trade_id", "direction", "reason", "r",
                 "zone_trigger", "stop_basis", "textbook"]].to_string(index=False))


if __name__ == "__main__":
    main()
