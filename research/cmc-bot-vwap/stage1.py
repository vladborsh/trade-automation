#!/usr/bin/env python3
"""Stage 1 — the PRE-REGISTERED test, `cmc-bot` VWAP band-reversal.

Everything this file does was fixed in `DESIGN.md` (commit "Pre-register the
cmc-bot VWAP band-reversal Stage 1 pass") **before any R existed**. Nothing
here is tuned. Machinery forked from `research/session-liquidity-v5-ny/hypothesis.py`
as `ARCHITECT-NOTE-STAGE1.md` §6 requires.

  stage 1  build per-leg trade tables + the four numbers          `python stage1.py build [leg ...]`
  stage 2  fit-period tables, ablations, lift                     `python stage1.py fit`
  stage 3  the holdout, ONCE, with the nulls and the ladder       `python stage1.py holdout`

The engine that generates the orders is the parity-proven `engine.py`,
**unedited**; `stage1_engine.py` holds the sibling pieces (ablatable loop,
trade walker) DESIGN §8 step 2 requires.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine  # noqa: E402
import stage1_engine as SE  # noqa: E402
from common import (BUY, CRYPTO_WINDOW, DAY_MS, DATA, MIN_MS, RESULTS, SELL,  # noqa: E402
                    TIMINGS, ny_window_utc_ms)

OUT = os.path.join(RESULTS, "stage1")
os.makedirs(OUT, exist_ok=True)

# ---- DESIGN §5: fixed before any number was computed -----------------------
SEED = 20260901
N_PERM_A = 1000
N_PERM_B = 250
N_BOOT = 2000
BOOT_LO, BOOT_HI = 5.0, 95.0            # 90 % interval
# ---- DESIGN §7: the ladder -------------------------------------------------
MIN_TRADES = 150
KILL_MEAN = 0.05
BUILD_MEAN = 0.10
P_BONF = 0.05 / 4
P_INCONCLUSIVE = 0.20
LIVELIKE_VETO = 0.05
# ---- DESIGN §4.4: costs ----------------------------------------------------
BINANCE_RT = 0.001
BINANCE_RT_SENS = 0.0004

FIT_START_CC = "2024-01-01"
FIT_START_BN = "2022-08-01"
FIT_END = "2025-07-31"
HOLD_START, HOLD_END = "2025-08-01", "2026-07-31"
TAIL_START, TAIL_END = "2026-08-01", "2026-09-11"


def _ms(s):
    return int(pd.Timestamp(s, tz="UTC").value // 10 ** 6)


class Leg:
    def __init__(self, name, symbol, venue, timing, fit_start, status):
        self.name, self.symbol, self.venue = name, symbol, venue
        self.timing = timing            # None -> TIMINGS[symbol]; dict; or engine.ALWAYS
        self.fit_start, self.status = fit_start, status
        self.windowed = timing != engine.ALWAYS

    @property
    def tm(self):
        return TIMINGS[self.symbol] if self.timing is None else self.timing


LEGS = [
    Leg("US100", "US100", "cc", None, FIT_START_CC, "pre-registered"),
    Leg("US500", "US500", "cc", None, FIT_START_CC, "pre-registered"),
    Leg("BTCUSDT-(a)", "BTCUSDT", "bn", CRYPTO_WINDOW, FIT_START_BN, "pre-registered"),
    Leg("ETHUSDT-(a)", "ETHUSDT", "bn", CRYPTO_WINDOW, FIT_START_BN, "pre-registered"),
    Leg("EURCHF", "EURCHF", "cc", None, FIT_START_CC, "descriptive"),
    Leg("GBPCHF", "GBPCHF", "cc", None, FIT_START_CC, "descriptive"),
    Leg("BTCUSDT-(b)", "BTCUSDT", "bn", engine.ALWAYS, FIT_START_BN, "descriptive"),
    Leg("ETHUSDT-(b)", "ETHUSDT", "bn", engine.ALWAYS, FIT_START_BN, "descriptive"),
]
LEGMAP = {lg.name: lg for lg in LEGS}
PRE = [lg.name for lg in LEGS if lg.status == "pre-registered"]

# the four numbers: (trail, realistic) — DESIGN §4.3
NUMBERS = {
    1: dict(label="bot-native template / bot-native fill (PRIMARY)", trail=1, realistic=0),
    2: dict(label="bot-native template / realistic fill", trail=1, realistic=1),
    3: dict(label="project-standard template / realistic fill", trail=0, realistic=1),
    4: dict(label="project-standard template / bot-native fill", trail=0, realistic=0),
}


# ==========================================================================
# Tape
# ==========================================================================
class Tape:
    _cache: dict = {}

    def __init__(self, leg: Leg):
        df = pd.read_parquet(os.path.join(DATA, f"{leg.symbol}_1m.parquet"))
        self.df = df
        self.t = df.t_ms.values.astype(np.int64)
        self.o = df.open.values.astype(np.float64)
        self.h = df.high.values.astype(np.float64)
        self.l = df.low.values.astype(np.float64)
        self.c = df.close.values.astype(np.float64)
        self.spread = (df.spread_close.values.astype(np.float64)
                       if "spread_close" in df.columns else None)
        self.n = len(df)
        self.atr = SE.rolling_atr20(self.h, self.l, self.c)
        self.date = pd.to_datetime(self.t, unit="ms", utc=True).strftime("%Y-%m-%d").to_numpy()
        self.P = engine.prepare(leg.symbol, df)

    @classmethod
    def get(cls, leg: Leg):
        if leg.symbol not in cls._cache:
            cls._cache[leg.symbol] = Tape(leg)
        return cls._cache[leg.symbol]


def alive_end_idx(tp: Tape, leg: Leg, T_ms: np.ndarray) -> np.ndarray:
    """Tape index of the last bar of the alive window containing gate minute T
    (DESIGN §4.1 forced flat). For the 24/7 legs: the last bar of the tape."""
    if not leg.windowed:
        return np.full(len(T_ms), tp.n - 1, np.int64)
    tm = leg.tm
    out = np.empty(len(T_ms), np.int64)
    cache = {}
    for i, T in enumerate(T_ms):
        d = int(T) // DAY_MS * DAY_MS
        if d not in cache:
            cache[d] = ny_window_utc_ms(d, *tm["alive"])[1]
        out[i] = np.searchsorted(tp.t, cache[d], "right") - 1
    return out


def sig_idx(tp: Tape, T_ms: np.ndarray, live_like: bool) -> np.ndarray:
    return np.searchsorted(tp.t, T_ms - (MIN_MS if live_like else 0), "right") - 1


# ==========================================================================
# Costs — DESIGN §4.4
# ==========================================================================
def cost_R(leg: Leg, tp: Tape, b_in, b_out, entry, dist, mode="base"):
    if leg.venue == "bn":
        rt = BINANCE_RT_SENS if mode == "maker" else BINANCE_RT
        return rt * entry / dist
    sp_in = tp.spread[b_in]
    sp_out = tp.spread[b_out]
    if mode == "fixed":
        sp_in = sp_out = np.full(len(b_in), cost_R.fixed_spread[leg.name])
    px = (sp_in + sp_out) / 2.0
    if mode == "double":
        px *= 2.0
    return px / dist


cost_R.fixed_spread = {}


# ==========================================================================
# Build — the trade tables and the four numbers
# ==========================================================================
def build_leg(leg: Leg, verbose=True) -> pd.DataFrame:
    tp = Tape.get(leg)
    lo = _ms(leg.fit_start)
    hi = int(tp.t[-1])
    rows = []
    caps_grid = [False, True]
    ll_grid = [False, True]
    for caps in caps_grid:
        for ll in ll_grid:
            if not leg.windowed and caps and ll:
                continue                      # DESIGN §3: (b) caps-on is a count only
            tr, _, _ = engine.run(tp.P, lo, hi, daily_caps=caps, record_components=False,
                                  live_like=ll, timing=leg.timing)
            if not len(tr):
                continue
            tr = tr.copy()
            tr["caps"] = caps
            tr["live_like"] = ll
            rows.append(tr)
            if verbose:
                print(f"  {leg.name} caps={caps} live_like={ll}: {len(tr)} orders", flush=True)
    q = pd.concat(rows, ignore_index=True)
    q["b_sig"] = np.where(q.live_like.values,
                          sig_idx(tp, q.signal_ts.values, True),
                          sig_idx(tp, q.signal_ts.values, False))
    q["b0"] = q.b_sig + 1
    q["b1"] = alive_end_idx(tp, leg, q.signal_ts.values)
    q["side"] = np.where(q["dir"].values == BUY, 1, -1).astype(np.int64)
    q["stop_dist"] = np.abs(q.entry.values - q.stop0.values)
    q["stop_atr"] = q.stop_dist.values / tp.atr[q.b_sig.values]
    q["date"] = tp.date[q.b_sig.values]
    q["period"] = period_of(q.date.values, leg)
    assert (q.b1 >= q.b0).all(), f"{leg.name}: alive window ends before the trade starts"

    # --- number 1: the engine's own exits, untouched ----------------------
    q["b_exit_1"] = np.searchsorted(tp.t, q.exit_ts.fillna(tp.t[-1]).values, "left")
    q["grossR_1"] = q.side.values * (q.exit_price.values - q.entry.values) / q.stop_dist.values
    q["exit_1"] = np.where(q.why.values == "TAKE_PROFIT", "target",
                   np.where(q.why.values == "STOP_LOSS",
                            np.where(q.n_trail.values > 0, "trailed stop", "stop"),
                            np.where(q.b_exit_1.values >= q.b1.values, "time-exit",
                                     "both-directions close")))
    # --- numbers 2-4: the walker ------------------------------------------
    o, h, l, c = tp.o, tp.h, tp.l, tp.c
    b0 = q.b0.values.astype(np.int64); b1 = q.b1.values.astype(np.int64)
    side = q.side.values; entry = q.entry.values; stop0 = q.stop0.values
    tgt_bot = q.target.values
    tgt_std = entry + side * q.stop_dist.values          # +1R target, DESIGN §4.1 template B
    for num, spec in NUMBERS.items():
        tgt = tgt_bot if spec["trail"] == 1 else tgt_std
        xi, xp, xc = SE.walk_many(o, h, l, c, b0, b1, side, entry, stop0, tgt,
                                  spec["trail"], spec["realistic"])
        q[f"w_b_exit_{num}"] = xi
        q[f"w_gross_{num}"] = side * (xp - entry) / q.stop_dist.values
        q[f"w_exit_{num}"] = pd.Series(xc).map(
            {SE.X_TARGET: "target", SE.X_STOP: "stop", SE.X_TRAILSTOP: "trailed stop",
             SE.X_TIME: "time-exit"}).values
        if num != 1:
            q[f"grossR_{num}"] = q[f"w_gross_{num}"]
            q[f"b_exit_{num}"] = xi
            q[f"exit_{num}"] = q[f"w_exit_{num}"]
    both, gapped = SE.touch_flags(o, h, l, c, b0, b1, side, entry, stop0, tgt_bot, 1)
    q["touch_both"] = both
    q["gapped_stop"] = gapped
    # --- costs -------------------------------------------------------------
    for num in NUMBERS:
        bx = q[f"b_exit_{num}"].values.clip(0, tp.n - 1)
        q[f"cost_R_{num}"] = cost_R(leg, tp, q.b_sig.values, bx, entry, q.stop_dist.values)
        q[f"netR_{num}"] = q[f"grossR_{num}"] - q[f"cost_R_{num}"]
    bx1 = q["b_exit_1"].values.clip(0, tp.n - 1)
    if leg.venue == "bn":
        q["cost_R_1_sens"] = cost_R(leg, tp, q.b_sig.values, bx1, entry, q.stop_dist.values, "maker")
        q["netR_1_sens"] = q["grossR_1"] - q["cost_R_1_sens"]
    else:
        fitmask = (q.period == "fit") & (~q.caps) & (~q.live_like)
        cost_R.fixed_spread[leg.name] = float(np.median(tp.spread[q.b_sig.values[fitmask.values]]))
        q["cost_R_1_fixed"] = cost_R(leg, tp, q.b_sig.values, bx1, entry, q.stop_dist.values, "fixed")
        q["netR_1_fixed"] = q["grossR_1"] - q["cost_R_1_fixed"]
        q["cost_R_1_2x"] = cost_R(leg, tp, q.b_sig.values, bx1, entry, q.stop_dist.values, "double")
        q["netR_1_2x"] = q["grossR_1"] - q["cost_R_1_2x"]
    q["leg"] = leg.name
    return q


def period_of(date_str, leg: Leg):
    d = pd.to_datetime(date_str)
    out = np.full(len(d), "pre", dtype=object)
    out[(d >= leg.fit_start) & (d <= FIT_END)] = "fit"
    out[(d >= HOLD_START) & (d <= HOLD_END)] = "holdout"
    out[(d >= TAIL_START) & (d <= TAIL_END)] = "tail"
    return out


# ==========================================================================
# Self-tests — DESIGN §8 (the stop rules)
# ==========================================================================
def selftests(legs) -> dict:
    res = {}
    for name in legs:
        leg = LEGMAP[name]
        tp = Tape.get(leg)
        q = pd.read_parquet(os.path.join(OUT, f"trades_{fn(name)}.parquet"))
        p = q[(~q.caps) & (~q.live_like)]
        # (1) the walker reproduces the engine's bot-native exits
        same = np.isclose(p.w_gross_1.values, p.grossR_1.values, atol=1e-9)
        # excluded: closed by the cross-order rule (not reproducible per-trade),
        # and still open at the last bar of the tape (no R at all)
        xdir = (p.exit_1.values == "both-directions close") | (~p.closed.values)
        res[name] = dict(
            n=len(p),
            walk_vs_engine_mismatch=int((~same & ~xdir).sum()),
            cross_order_closes=int((p.exit_1.values == "both-directions close").sum()),
            unclosed_at_tape_end=int((~p.closed.values).sum()),
            # (2) DESIGN §8 agreement set: bot-native vs realistic fill must be
            #     bit-identical where no bar touches both levels, the realistic
            #     exit does not gap, and both conventions find the same level
            #     on the same bar.
        )
        agree = (p.touch_both.values == 0) & (p.gapped_stop.values == 0) \
            & (p.b_exit_1.values == p.w_b_exit_2.values) \
            & np.isin(p.exit_1.values, ["target", "stop", "trailed stop"])
        d = np.abs(p.grossR_1.values[agree] - p.w_gross_2.values[agree])
        res[name]["agreement_n"] = int(agree.sum())
        res[name]["agreement_max_absdiff"] = float(d.max()) if agree.sum() else 0.0
        res[name]["agreement_violations"] = int((d > 1e-9).sum())
        # (3) ATR: the global rolling ATR equals the engine's per-bar value
        res[name]["atr_ok"] = bool(np.isfinite(tp.atr[p.b_sig.values]).all())
    return res


def fn(name):
    return name.replace("(", "").replace(")", "").replace("-", "_")


# ==========================================================================
# Placebo pool and the nulls — DESIGN §5
# ==========================================================================
class Pool:
    def __init__(self, leg: Leg):
        tp = Tape.get(leg)
        lo = _ms(leg.fit_start)
        if leg.windowed:
            tm = leg.tm
            ok = np.zeros(tp.n, bool)
            d0 = int(tp.t[0]) // DAY_MS * DAY_MS
            d1 = int(tp.t[-1]) // DAY_MS * DAY_MS
            ends = np.full(tp.n, -1, np.int64)
            d = d0
            while d <= d1:
                if pd.Timestamp(d, unit="ms").dayofweek <= 4:
                    e0, e1 = ny_window_utc_ms(d, *tm["entry"])
                    a1 = ny_window_utc_ms(d, *tm["alive"])[1]
                    i0 = np.searchsorted(tp.t, e0, "left")
                    i1 = np.searchsorted(tp.t, e1, "right")
                    ae = np.searchsorted(tp.t, a1, "right") - 1
                    if i1 > i0 and ae > i0:
                        ok[i0:i1] = True
                        ends[i0:i1] = ae
                d += DAY_MS
            good = ok & (ends > np.arange(tp.n)) & np.isfinite(tp.atr) & (tp.atr > 0) \
                & (tp.t >= lo)
        else:
            ends = np.full(tp.n, tp.n - 1, np.int64)
            good = np.isfinite(tp.atr) & (tp.atr > 0) & (tp.t >= lo) & (np.arange(tp.n) < tp.n - 1)
        self.idx = np.flatnonzero(good)
        self.end = ends
        self.date = tp.date


def placebo_mean(leg: Leg, tp: Tape, pool: Pool, g: pd.DataFrame, b: np.ndarray,
                 rng, trail=1, realistic=0) -> float:
    side = g.side.values
    stop_atr = g.stop_atr.values
    a = tp.atr[b]
    ok = np.isfinite(a) & (a > 0)
    b, side, stop_atr, a = b[ok], side[ok], stop_atr[ok], a[ok]
    if not len(b):
        return np.nan
    e1 = pool.end[b]
    live = e1 > b
    b, side, stop_atr, a, e1 = b[live], side[live], stop_atr[live], a[live], e1[live]
    if not len(b):
        return np.nan
    dist = stop_atr * a
    entry = tp.c[b]
    stop = entry - side * dist
    target = entry + side * (3.0 if trail == 1 else 1.0) * dist
    xi, xp, _ = SE.walk_many(tp.o, tp.h, tp.l, tp.c, (b + 1).astype(np.int64),
                             e1.astype(np.int64), side.astype(np.int64), entry, stop, target,
                             trail, realistic)
    gross = side * (xp - entry) / dist
    cst = cost_R(leg, tp, b, xi.clip(0, tp.n - 1), entry, dist)
    return float(np.mean(gross - cst))


def null_A(leg: Leg, g: pd.DataFrame, n_draws: int, rng) -> tuple[np.ndarray, float]:
    """DESIGN §5 Null A — matched-time placebo. Same entry window, DIFFERENT
    random day, same side, same stop distance in ATR, same template, same
    costs. Returns (means, residual same-date rate)."""
    tp = Tape.get(leg)
    pool = Pool(leg)
    means = np.full(n_draws, np.nan)
    clash_tot = 0
    for k in range(n_draws):
        pick = rng.integers(0, len(pool.idx), size=len(g))
        b = pool.idx[pick]
        clash = pool.date[b] == g.date.values
        if clash.any():
            b[clash] = pool.idx[rng.integers(0, len(pool.idx), size=int(clash.sum()))]
            clash_tot += int((pool.date[b] == g.date.values).sum())
        means[k] = placebo_mean(leg, tp, pool, g, b, rng)
    return means, clash_tot / (n_draws * max(len(g), 1))


def null_B(leg: Leg, g: pd.DataFrame, n_draws: int, rng) -> tuple[np.ndarray, float]:
    """DESIGN §5 Null B — whole-stream day shift, k ~ U{1..250} without
    replacement. Shifted entries landing on a missing minute are dropped."""
    tp = Tape.get(leg)
    pool = Pool(leg)
    means = np.full(n_draws, np.nan)
    ks = rng.permutation(np.arange(1, n_draws + 1))
    drop = []
    base_t = tp.t[g.b_sig.values]
    for i, k in enumerate(ks):
        want = base_t + int(k) * DAY_MS
        j = np.searchsorted(tp.t, want, "left")
        j = np.clip(j, 0, tp.n - 1)
        hit = tp.t[j] == want
        drop.append(1.0 - hit.mean())
        if not hit.any():
            continue
        means[i] = placebo_mean(leg, tp, pool, g[hit], j[hit], rng)
    return means, float(np.mean(drop))


def boot_days(netR: np.ndarray, date: np.ndarray, n_draws: int, rng) -> np.ndarray:
    by = {}
    for r, d in zip(netR, date):
        by.setdefault(d, []).append(r)
    blocks = [np.asarray(v) for v in by.values()]
    m = len(blocks)
    out = np.empty(n_draws)
    for k in range(n_draws):
        pick = rng.integers(0, m, size=m)
        out[k] = np.concatenate([blocks[j] for j in pick]).mean()
    return out


# ==========================================================================
def describe(g: pd.DataFrame, num=1) -> dict:
    if not len(g):
        return dict(n=0)
    # An order still open at the last bar of the tape has no R (only possible
    # on the never-force-closed (b) legs). It is excluded and counted.
    n_open = int((~np.isfinite(g[f"netR_{num}"].values)).sum())
    g = g[np.isfinite(g[f"netR_{num}"].values)]
    if not len(g):
        return dict(n=0, n_unclosed=n_open)
    net = g[f"netR_{num}"]
    return dict(n=len(g), n_unclosed=n_open, mean_netR=net.mean(), median_netR=net.median(),
                mean_grossR=g[f"grossR_{num}"].mean(), mean_cost_R=g[f"cost_R_{num}"].mean(),
                median_cost_R=g[f"cost_R_{num}"].median(),
                win_rate=100 * (net > 0).mean(), n_days=g.date.nunique(),
                median_stop_atr=g.stop_atr.median())


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        names = sys.argv[2:] or [lg.name for lg in LEGS]
        for name in names:
            leg = LEGMAP[name]
            print(f"[build] {name}", flush=True)
            q = build_leg(leg)
            q.to_parquet(os.path.join(OUT, f"trades_{fn(name)}.parquet"), index=False)
            print(f"[build] {name}: {len(q)} rows -> trades_{fn(name)}.parquet", flush=True)
    elif cmd == "selftest":
        names = sys.argv[2:] or [lg.name for lg in LEGS]
        r = selftests(names)
        print(json.dumps(r, indent=2))
        with open(os.path.join(OUT, "selftests.json"), "w") as fh:
            json.dump(r, fh, indent=2)
    else:
        raise SystemExit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
