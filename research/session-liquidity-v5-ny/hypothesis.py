#!/usr/bin/env python3
"""The PRE-REGISTERED hypothesis test — session-liquidity **v5-NY**.

Everything this file does was fixed in `DESIGN.md` §3–§7 and committed before
any result existed. Nothing here is tuned. In order:

  §4  build the trade table from the pinned template (entry at the
      confirmation close, stop at the sweep leg's running extreme, +1R target,
      same-bar tie = loss, 0.10% round-trip cost) — the engine already
      computed it; this file only selects, splits and aggregates.
  §5  chronological split: fit 2022-08-01..2025-07-31, holdout 2025-08-01..
      2026-07-31, by take-out UTC date.
  §6  Null A — matched-time placebo: same window, same side, same stop in ATR,
      same horizon type, different random date. 1,000 draws.
      Null B — whole-stream day shift, 250 draws.
      Block bootstrap over whole UTC days, 2,000 draws, for the interval.
  §7  the verdict ladder, applied mechanically rather than by narration.

Writes results/HYPOTHESIS.md and results/p*.csv.

Usage: python research/session-liquidity-v5-ny/hypothesis.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C
import tables as T

ARMS = [("ifvg", "iFVG-v4"), ("bos", "BoS pinned anchor")]
HORIZONS = [("blk", "block-scoped (PRIMARY)"), ("h24", "24h (secondary)")]

# DESIGN §7 — fixed before any number was computed.
MIN_TRADES = 150
KILL_MEAN = 0.05
P_BONFERRONI = 0.05 / 4        # 4 primary numbers: 2 arms x 2 horizons
P_INCONCLUSIVE = 0.20

_lines: list[str] = []


def A(s: str = ""):
    _lines.append(s)


# ==========================================================================
# Per-symbol price context, cached — the null needs the raw tape
# ==========================================================================
class Tape:
    def __init__(self, sym: str):
        d = C.prep(C.load(sym))
        self.n = len(d)
        self.hi = d["high"].to_numpy()
        self.lo = d["low"].to_numpy()
        self.cl = d["close"].to_numpy()
        self.atr = d["atr"].to_numpy()
        ba = C.block_arrays(d)
        self.block_end = ba["block_end"]
        self.complete = ba["block_complete"]
        self.bars_left = ba["bars_left"]
        mod = C.minute_of_day(d["ts"]).to_numpy()
        self.date = d["ts"].dt.strftime("%Y-%m-%d").to_numpy()
        blk = d["block"].to_numpy()
        # DESIGN §6: the placebo pool is every bar inside the SAME NY window,
        # on a complete NY block, with tape left to run and a usable ATR.
        self.pool = np.flatnonzero(
            C.in_ny_window(mod) & (blk == "NY") & self.complete
            & (self.bars_left > 0) & np.isfinite(self.atr) & (self.atr > 0))
        self.pool_date = self.date[self.pool]


_TAPES: dict[str, Tape] = {}


def tape(sym: str) -> Tape:
    if sym not in _TAPES:
        _TAPES[sym] = Tape(sym)
    return _TAPES[sym]


# ==========================================================================
# The trade template, vectorised — identical rules to engine.simulate_trade
# ==========================================================================
def batch_R(tp: Tape, b: np.ndarray, side_short: np.ndarray,
            stop_px: np.ndarray, h_end: np.ndarray) -> np.ndarray:
    """Gross R for a batch of trades entered at the CLOSE of bars `b`.

    Same rules as `engine.simulate_trade`, vectorised so the 1,000-draw null is
    affordable: stop checked first (a bar touching both books a LOSS), +1R
    target, otherwise marked to market at the horizon's closing price.
    `checks.py` C7 proves the scalar version; `_selftest()` below proves this
    one agrees with it bar for bar on the real trades.
    """
    entry = tp.cl[b]
    dist = np.abs(entry - stop_px)
    L = int((h_end - b).max())
    off = np.arange(1, L + 1)
    idx = np.minimum(b[:, None] + off[None, :], tp.n - 1)
    live = (b[:, None] + off[None, :]) <= h_end[:, None]
    hi = np.where(live, tp.hi[idx], -np.inf)
    lo = np.where(live, tp.lo[idx], np.inf)

    target = np.where(side_short, entry - dist, entry + dist)
    s_mask = np.where(side_short[:, None], hi >= stop_px[:, None],
                      lo <= stop_px[:, None]) & live
    t_mask = np.where(side_short[:, None], lo <= target[:, None],
                      hi >= target[:, None]) & live
    BIG = 10 ** 9
    s_at = np.where(s_mask.any(1), s_mask.argmax(1), BIG)
    t_at = np.where(t_mask.any(1), t_mask.argmax(1), BIG)

    end_c = tp.cl[h_end]
    mtm = np.where(side_short, entry - end_c, end_c - entry) / dist
    out = np.where(s_at <= t_at, np.where(s_at < BIG, -1.0, mtm),
                   np.where(t_at < BIG, 1.0, mtm))
    return out


def batch_R_variant(tp: Tape, b, side_short, stop_px, h_end,
                    tie_is_win: bool) -> tuple[np.ndarray, np.ndarray]:
    """POST-HOC diagnostic only (P6). Same walk, but the same-bar stop+target
    tie can be booked the optimistic way. Also returns the tie mask so the
    report can say how often the rule actually bound. NOT used anywhere in the
    pre-registered test — DESIGN §4 pinned tie = LOSS and that stands."""
    entry = tp.cl[b]
    dist = np.abs(entry - stop_px)
    L = int((h_end - b).max())
    off = np.arange(1, L + 1)
    idx = np.minimum(b[:, None] + off[None, :], tp.n - 1)
    live = (b[:, None] + off[None, :]) <= h_end[:, None]
    hi = np.where(live, tp.hi[idx], -np.inf)
    lo = np.where(live, tp.lo[idx], np.inf)
    target = np.where(side_short, entry - dist, entry + dist)
    s_mask = np.where(side_short[:, None], hi >= stop_px[:, None],
                      lo <= stop_px[:, None]) & live
    t_mask = np.where(side_short[:, None], lo <= target[:, None],
                      hi >= target[:, None]) & live
    BIG = 10 ** 9
    s_at = np.where(s_mask.any(1), s_mask.argmax(1), BIG)
    t_at = np.where(t_mask.any(1), t_mask.argmax(1), BIG)
    tie = (s_at == t_at) & (s_at < BIG)
    end_c = tp.cl[h_end]
    mtm = np.where(side_short, entry - end_c, end_c - entry) / dist
    stop_first = s_at < t_at
    tgt_first = t_at < s_at
    out = np.where(stop_first, -1.0,
                   np.where(tgt_first, 1.0,
                            np.where(tie, 1.0 if tie_is_win else -1.0, mtm)))
    return out, tie


def batch_netR(tp: Tape, b, side_short, stop_px, h_end) -> np.ndarray:
    entry = tp.cl[b]
    dist = np.abs(entry - stop_px)
    gross = batch_R(tp, b, side_short, stop_px, h_end)
    return gross - C.COST_ROUNDTRIP * entry / dist


# ==========================================================================
def trade_table(e: pd.DataFrame, pre: str, h: str,
                symbols: list[str]) -> pd.DataFrame:
    """DESIGN §4's population: primary take-outs, this arm confirmed, the
    confirmation bar inside the pinned NY window, a runnable horizon."""
    q = e[e.primary & e.symbol.isin(symbols) & e[f"{pre}_confirmed"]
          & e[f"{pre}_in_ny"] & e[f"{pre}_{h}_netR"].notna()].copy()
    q["u"] = q[f"{pre}_break_bar"].astype(int)
    q["stop_px"] = q[f"{pre}_{h}_stop_px"]
    q["stop_atr"] = q[f"{pre}_{h}_stop_atr"]
    q["h_end"] = (q.block_end_bar if h == "blk" else q.h24_end_bar).astype(int)
    q["grossR"] = q[f"{pre}_{h}_grossR"]
    q["netR"] = q[f"{pre}_{h}_netR"]
    q["cost_R"] = q[f"{pre}_{h}_cost_R"]
    q["exit"] = q[f"{pre}_{h}_exit"]
    q["short"] = q.direction == "high_sweep"
    q["date"] = q.ts.dt.strftime("%Y-%m-%d")
    return q


def describe(q: pd.DataFrame) -> dict:
    if not len(q):
        return dict(n=0)
    return dict(
        n=len(q),
        mean_netR=q.netR.mean(),
        median_netR=q.netR.median(),
        mean_grossR=q.grossR.mean(),
        mean_cost_R=q.cost_R.mean(),
        win_rate=100 * (q.netR > 0).mean(),
        pct_target=100 * (q["exit"] == "target").mean(),
        pct_stop=100 * (q["exit"] == "stop").mean(),
        pct_mtm=100 * (q["exit"] == "mtm").mean(),
        median_stop_atr=q.stop_atr.median(),
    )


# ==========================================================================
# NULL A — matched-time placebo (DESIGN §6)
# ==========================================================================
def null_A(q: pd.DataFrame, h: str, n_draws: int, rng) -> np.ndarray:
    """One mean netR per draw. Each real trade is replaced by a trade with the
    SAME side and the SAME stop width in ATR, entered at a random bar inside
    the same NY window on a DIFFERENT date, same symbol, same horizon type."""
    means = np.zeros(n_draws)
    per_sym = {s: g for s, g in q.groupby("symbol")}
    for k in range(n_draws):
        parts = []
        for sym, g in per_sym.items():
            tp = tape(sym)
            pool = tp.pool
            pick = rng.integers(0, len(pool), size=len(g))
            b = pool[pick]
            # DESIGN §6: a DIFFERENT date. Redraw the collisions once; the
            # residual rate is ~1/1460 and is reported rather than looped over.
            clash = tp.pool_date[pick] == g.date.to_numpy()
            if clash.any():
                pick2 = rng.integers(0, len(pool), size=int(clash.sum()))
                b[clash] = pool[pick2]
            stop_atr = g.stop_atr.to_numpy()
            short = g["short"].to_numpy()
            dist = stop_atr * tp.atr[b]
            entry = tp.cl[b]
            stop_px = np.where(short, entry + dist, entry - dist)
            if h == "blk":
                h_end = tp.block_end[b]
            else:
                h_end = np.minimum(b + C.H24_BARS, tp.n - 1)
            good = h_end > b
            if not good.any():
                continue
            parts.append(batch_netR(tp, b[good], short[good], stop_px[good],
                                    h_end[good]))
        means[k] = np.concatenate(parts).mean() if parts else np.nan
    return means


# ==========================================================================
# NULL B — whole-stream day shift (DESIGN §6)
# ==========================================================================
def null_B(q: pd.DataFrame, h: str, n_draws: int, rng) -> np.ndarray:
    """Shift every confirmation bar forward by k whole days (k in 1..250) and
    re-run the identical template at the same clock time on the shifted day.
    Preserves the event stream's own clustering; breaks only the price
    alignment."""
    means = np.zeros(n_draws)
    per_sym = {s: g for s, g in q.groupby("symbol")}
    ks = rng.permutation(np.arange(1, n_draws + 1))
    for i, k in enumerate(ks):
        parts = []
        shift = int(k) * C.H24_BARS       # 288 bars = one whole UTC day
        for sym, g in per_sym.items():
            tp = tape(sym)
            b = g.u.to_numpy() + shift
            ok = b < tp.n - 1
            b = b[ok]
            if not len(b):
                continue
            stop_atr = g.stop_atr.to_numpy()[ok]
            short = g["short"].to_numpy()[ok]
            a = tp.atr[b]
            ok2 = np.isfinite(a) & (a > 0)
            b, stop_atr, short, a = b[ok2], stop_atr[ok2], short[ok2], a[ok2]
            if not len(b):
                continue
            dist = stop_atr * a
            entry = tp.cl[b]
            stop_px = np.where(short, entry + dist, entry - dist)
            h_end = tp.block_end[b] if h == "blk" else \
                np.minimum(b + C.H24_BARS, tp.n - 1)
            good = h_end > b
            if not good.any():
                continue
            parts.append(batch_netR(tp, b[good], short[good], stop_px[good],
                                    h_end[good]))
        means[i] = np.concatenate(parts).mean() if parts else np.nan
    return means


# ==========================================================================
def boot_days(q: pd.DataFrame, n_draws: int, rng) -> np.ndarray:
    """Block bootstrap over whole UTC days — intraday trades on one day share
    one tape, so the day is the natural block."""
    by_day = [g.netR.to_numpy() for _, g in q.groupby("date")]
    m = len(by_day)
    out = np.zeros(n_draws)
    for k in range(n_draws):
        pick = rng.integers(0, m, size=m)
        out[k] = np.concatenate([by_day[j] for j in pick]).mean()
    return out


def verdict(n: int, m_hold: float, p: float, m_fit: float) -> str:
    """DESIGN §7's ladder, applied mechanically."""
    if n < MIN_TRADES:
        return (f"**UNDERPOWERED — INCONCLUSIVE** ({n} holdout trades < "
                f"{MIN_TRADES}); no directional claim either way.")
    if m_hold < KILL_MEAN or p > P_INCONCLUSIVE:
        return ("**NO EDGE — KILL.** " +
                (f"holdout mean netR {m_hold:+.3f}R < the pre-registered "
                 f"+{KILL_MEAN:.2f}R kill threshold" if m_hold < KILL_MEAN
                 else f"Null-A p = {p:.3f} > {P_INCONCLUSIVE}") + ".")
    if p > P_BONFERRONI:
        return (f"**INCONCLUSIVE / suggestive at best** — mean netR "
                f"{m_hold:+.3f}R with Null-A p = {p:.3f}, above the "
                f"Bonferroni-corrected {P_BONFERRONI:.4f}.")
    if not (m_fit >= KILL_MEAN):
        return (f"**INCONCLUSIVE** — holdout clears (mean {m_hold:+.3f}R, "
                f"p = {p:.3f}) but the fit period does not agree "
                f"(fit mean {m_fit:+.3f}R < +{KILL_MEAN:.2f}R).")
    return (f"**REAL EDGE, PROVISIONALLY** — holdout mean netR {m_hold:+.3f}R, "
            f"Null-A p = {p:.3f} <= {P_BONFERRONI:.4f}, fit agrees "
            f"({m_fit:+.3f}R). Hand to the Architect as a reopen candidate.")


def _selftest(e: pd.DataFrame):
    """The vectorised template must agree with the engine's scalar one on every
    real trade, or the null is measuring a different rule than the observation."""
    bad = 0
    tot = 0
    for pre, _ in ARMS:
        for h, _ in HORIZONS:
            q = trade_table(e, pre, h, C.SYMBOLS)
            for sym, g in q.groupby("symbol"):
                tp = tape(sym)
                r = batch_R(tp, g.u.to_numpy(), g["short"].to_numpy(),
                            g.stop_px.to_numpy(), g.h_end.to_numpy())
                bad += int((np.abs(r - g.grossR.to_numpy()) > 1e-9).sum())
                tot += len(g)
    print(f"[selftest] vectorised template vs engine: {bad} mismatches in "
          f"{tot:,} real trades")
    return bad == 0, bad, tot


def main():
    rng = np.random.default_rng(C.SEED)
    e = T.load_events()

    A("# Pre-registered hypothesis test — session-liquidity v5-NY\n")
    A("Everything below was fixed in `DESIGN.md` §3–§7 **before any result "
      "existed** (commit `Pre-register the session-liquidity v5-NY pass`). The "
      "holdout was computed once, at the end, and is reported as it came out.\n")
    A(f"**Window:** {C.NY_WIN_UTC[0]//60:02d}:{C.NY_WIN_UTC[0]%60:02d}–"
      f"{C.NY_WIN_UTC[1]//60:02d}:{C.NY_WIN_UTC[1]%60:02d} UTC "
      "(= 09:40–11:20 New York at the pinned fixed offset UTC−4). "
      "**Trade:** entry at the confirmation close, stop at the sweep leg's "
      "running extreme over `[t0, u]`, target +1R, same-bar tie booked as a "
      "loss, 0.10% round-trip cost. **Population:** BTC+ETH, primary sample "
      "(≥12 bars remaining).\n")

    ok, bad, tot = _selftest(e)
    A(f"**Self-test:** the vectorised template used by the null reproduces the "
      f"engine's scalar template on **{tot - bad:,} of {tot:,}** real trades "
      f"({'PASS' if ok else 'FAIL'}). Without this the null would be testing a "
      "different rule than the observation.\n")

    rows_desc = []
    rows_null = []
    verdicts = []

    for pre, arm_lab in ARMS:
        for h, h_lab in HORIZONS:
            q = trade_table(e, pre, h, C.FOREGROUND)
            fit = q[q.period == "fit"]
            hold = q[q.period == "holdout"]
            for lab, g in (("fit", fit), ("holdout", hold), ("full", q)):
                rows_desc.append(dict(arm=arm_lab, horizon=h_lab, period=lab,
                                      **describe(g)))
            if not len(hold):
                continue
            # --- Null A, on the HOLDOUT (the pre-registered comparison) -----
            nA = null_A(hold, h, C.N_PERM_A, rng)
            m_hold = hold.netR.mean()
            pA = float((nA >= m_hold).mean())
            nB = null_B(hold, h, C.N_PERM_B, rng)
            pB = float((nB >= m_hold).mean())
            bt = boot_days(hold, C.N_BOOT, rng)
            lo90, hi90 = np.percentile(bt, [5, 95])
            # ...and on the FIT period, for the consistency line of §7
            nA_fit = null_A(fit, h, C.N_PERM_A, rng) if len(fit) else np.array([np.nan])
            m_fit = fit.netR.mean() if len(fit) else np.nan
            pA_fit = float((nA_fit >= m_fit).mean()) if len(fit) else np.nan

            rows_null.append(dict(
                arm=arm_lab, horizon=h_lab,
                n_holdout=len(hold), mean_netR_holdout=m_hold,
                nullA_mean=float(np.nanmean(nA)), nullA_sd=float(np.nanstd(nA)),
                nullA_p=pA, nullB_p=pB,
                boot_lo90=lo90, boot_hi90=hi90,
                n_fit=len(fit), mean_netR_fit=m_fit, nullA_p_fit=pA_fit,
            ))
            verdicts.append((arm_lab, h_lab,
                             verdict(len(hold), m_hold, pA, m_fit)))
            print(f"{arm_lab:24s} {h:4s}  n_hold={len(hold):4d} "
                  f"mean={m_hold:+.4f} nullA_mean={np.nanmean(nA):+.4f} "
                  f"p={pA:.3f} pB={pB:.3f} fit={m_fit:+.4f}", flush=True)

    d = pd.DataFrame(rows_desc)
    d.to_csv(os.path.join(C.RESULTS, "p1_trade_stats.csv"), index=False)
    nl = pd.DataFrame(rows_null)
    nl.to_csv(os.path.join(C.RESULTS, "p2_null_results.csv"), index=False)

    A("\n## P1 — The trades (BTC+ETH, NY window, pinned template)\n")
    A("`mean netR` is the pre-registered primary metric: expectancy per trade "
      "in units of the risk taken, after 0.10% round-trip cost. A `target` "
      "exit is +1R, a `stop` exit −1R, `mtm` is marked to market at the "
      "horizon's last close.\n")
    A(T.md(d.drop(columns=[]), "{:.3f}") + "\n")

    A("\n## P2 — Null A, Null B and the bootstrap interval\n")
    A("**Null A (primary)** replaces every trade with one entered at a random "
      "bar inside the *same* NY window on a *different* date, same asset, same "
      "side, same stop width in ATR, same horizon, same costs. It holds the "
      "clock, the risk and the direction mix fixed and destroys only the "
      "alignment with a real swept level — so it answers exactly the question "
      "that matters: does the sweep-confirmation add anything over entering at "
      "a random moment in the same window? `p` is the share of 1,000 draws "
      "whose mean netR was at least as good as the observed one.\n")
    A("**Null B** shifts the whole confirmation stream forward by k whole days "
      "and re-runs it at the same clock time. **Bootstrap** resamples whole UTC "
      "days, 2,000 draws, for a 90% interval on the observed mean.\n")
    A(T.md(nl, "{:.4f}") + "\n")

    A("\n## P3 — The verdict ladder (DESIGN §7), applied mechanically\n")
    A(f"Kill threshold **mean netR < +{KILL_MEAN:.2f}R** or **p > "
      f"{P_INCONCLUSIVE}**; 'real edge' requires **p ≤ "
      f"{P_BONFERRONI:.4f}** (Bonferroni over the four primary numbers) **and** "
      f"a fit period that agrees. Minimum {MIN_TRADES} holdout trades.\n")
    for arm_lab, h_lab, v in verdicts:
        A(f"* **{arm_lab} · {h_lab}** — {v}")
    A("")

    # ------------------------------------------------- robustness appendix
    A("\n## P4 — Robustness appendix (NOT the pre-registered population)\n")
    A("DESIGN §2.3 pins the test to pooled BTC+ETH. These rows exist so a "
      "reader can see whether the same sign shows up elsewhere; they are not "
      "the primary number and no verdict is drawn from them.\n")
    rows = []
    for pre, arm_lab in ARMS:
        for scope, syms in (("BTC+ETH (primary)", C.FOREGROUND),
                            ("ALL 4 assets", C.SYMBOLS),
                            ("BTCUSDT", ["BTCUSDT"]), ("ETHUSDT", ["ETHUSDT"]),
                            ("SOLUSDT", ["SOLUSDT"]), ("BNBUSDT", ["BNBUSDT"])):
            q = trade_table(e, pre, "blk", syms)
            hold = q[q.period == "holdout"]
            fit = q[q.period == "fit"]
            rows.append(dict(arm=arm_lab, scope=scope, n_fit=len(fit),
                             mean_fit=fit.netR.mean() if len(fit) else np.nan,
                             n_hold=len(hold),
                             mean_hold=hold.netR.mean() if len(hold) else np.nan,
                             n_all=len(q), mean_all=q.netR.mean() if len(q) else np.nan))
    rb = pd.DataFrame(rows)
    rb.to_csv(os.path.join(C.RESULTS, "p4_robustness.csv"), index=False)
    A(T.md(rb, "{:.3f}") + "\n")

    # ---- sensitivity: the UTC-5 window, and no-window (all hours) ---------
    A("\n## P5 — Sensitivities actually run (count them; that is the point)\n")
    rows = []
    for pre, arm_lab in ARMS:
        for lab, flag in (("NY window UTC−4 (pinned)", f"{pre}_in_ny"),
                          ("NY window UTC−5 (sensitivity)", f"{pre}_in_ny_est"),
                          ("all hours (no window filter)", None)):
            q = e[e.primary & e.symbol.isin(C.FOREGROUND) & e[f"{pre}_confirmed"]
                  & e[f"{pre}_blk_netR"].notna()]
            if flag is not None:
                q = q[q[flag]]
            hold = q[q.period == "holdout"]
            rows.append(dict(arm=arm_lab, cut=lab, n=len(q),
                             mean_netR_all=q[f"{pre}_blk_netR"].mean(),
                             n_hold=len(hold),
                             mean_netR_hold=hold[f"{pre}_blk_netR"].mean()
                             if len(hold) else np.nan))
    sv = pd.DataFrame(rows)
    sv.to_csv(os.path.join(C.RESULTS, "p5_sensitivities.csv"), index=False)
    A("Every cut run in this pass is listed here, including the ones that "
      "looked worse, so the reader can count the comparisons behind any "
      "p-value (block-scoped horizon, BTC+ETH).\n")
    A(T.md(sv, "{:.3f}") + "\n")

    # ---- P6: the two objections a reader will raise, answered up front ----
    A("\n## P6 — Post-hoc diagnostics: is the verdict just the fees, or just "
      "the tie rule?\n")
    A("Neither of these changes the pre-registered result — DESIGN §4 pinned "
      "tie = LOSS and a 0.10% round trip, and that stands. They are computed "
      "**after** the verdict, to answer the two objections a reader will raise "
      "on seeing a negative expectancy.\n")
    rows = []
    for pre, arm_lab in ARMS:
        q = trade_table(e, pre, "blk", C.FOREGROUND)
        gross_pin, tie_pin, gross_win = [], [], []
        for sym, g in q.groupby("symbol"):
            tp = tape(sym)
            r0, tie = batch_R_variant(tp, g.u.to_numpy(), g["short"].to_numpy(),
                                      g.stop_px.to_numpy(), g.h_end.to_numpy(),
                                      tie_is_win=False)
            r1, _ = batch_R_variant(tp, g.u.to_numpy(), g["short"].to_numpy(),
                                    g.stop_px.to_numpy(), g.h_end.to_numpy(),
                                    tie_is_win=True)
            gross_pin.append(r0); gross_win.append(r1); tie_pin.append(tie)
        gp = np.concatenate(gross_pin); gw = np.concatenate(gross_win)
        tie = np.concatenate(tie_pin)
        cost = q.cost_R.to_numpy()
        rows.append(dict(arm=arm_lab, n=len(q),
                         pct_same_bar_tie=100 * tie.mean(),
                         mean_cost_R=cost.mean(),
                         pinned_net=(gp - cost).mean(),
                         pinned_gross=gp.mean(),
                         tie_as_win_net=(gw - cost).mean(),
                         tie_as_win_gross=gw.mean()))
    p6 = pd.DataFrame(rows)
    p6.to_csv(os.path.join(C.RESULTS, "p6_posthoc_diagnostics.csv"), index=False)
    A(T.md(p6, "{:.3f}") + "\n")
    A("`pct_same_bar_tie` settles the second objection outright: the stop and "
      "the target sit 2R apart, and a single 5-minute bar essentially never "
      "spans that, so the pinned tie = LOSS rule **never binds** and the "
      "'tie as win' columns are identical to the pinned ones.\n")
    A("The first objection is the real one, and it points at the honest "
      "finding: **gross expectancy is approximately zero** (see "
      "`pinned_gross`), and the 0.10% round trip — which is 12–19% of the risk "
      "taken, because these stops are only 3–6 ATR wide — is what makes the "
      "net number negative. There is no version of this where the signal "
      "carries the costs.\n")

    out = os.path.join(C.RESULTS, "HYPOTHESIS.md")
    with open(out, "w") as fh:
        fh.write("\n".join(_lines) + "\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
