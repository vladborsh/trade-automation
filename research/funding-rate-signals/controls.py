"""Nulls, bootstraps and the gating redundancy margin (DESIGN §6).

The placebo engines are deliberately a SEPARATE, vectorised implementation of
the same template: if the two disagree on the real trades the wiring is wrong,
and `checks.py`-style agreement is asserted in stage1.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

from common import COST_RT, MAX_SETTLEMENTS, B_TIME_BARS, B_TARGET_R

HOUR = pd.Timedelta(hours=1)
MIN1 = pd.Timedelta(minutes=1)


class Tape:
    """Numpy view of one symbol, aligned once, queried a million times."""

    def __init__(self, bars, sett):
        self.idx = bars.index
        self.o = bars["open"].values.astype(float)
        self.h = bars["high"].values.astype(float)
        self.l = bars["low"].values.astype(float)
        self.c = bars["close"].values.astype(float)
        self.atr = bars["atr14"].values.astype(float)
        self.datr = bars["datr"].values.astype(float)
        self.present = bars["present"].values.astype(bool)
        self.pos = {t: i for i, t in enumerate(self.idx)}
        self.sidx = sett.index
        self.f = sett["f"].values.astype(float)
        self.mark = sett["mark"].values.astype(float)
        self.spres = sett["present"].values.astype(bool)
        # map each settlement slot to its bar index (-1 if the bar is absent)
        self.sbar = np.array([self.pos.get(t, -1) for t in self.sidx])
        # for each bar index, the number of settlement slots at or before it
        self.scount = np.searchsorted(self.sidx.values, self.idx.values,
                                      side="right")

    def funding_R(self, i_entry_bar, i_exit_bar, side, stop_dist,
                  exit_is_close: bool):
        """SUM over slots strictly inside (t_entry, t_exit).

        t_entry = open(i_entry_bar); t_exit = open(i_exit_bar) + 1min (stop) or
        + 1h (close exits).  Both conventions reduce to: slots with bar index
        in (i_entry_bar, i_exit_bar].
        """
        lo = np.searchsorted(self.sbar, i_entry_bar, side="right")
        hi = np.searchsorted(self.sbar, i_exit_bar, side="right")
        if hi <= lo:
            return 0.0, 0
        f = self.f[lo:hi]
        m = self.mark[lo:hi]
        ok = np.isfinite(f) & np.isfinite(m)
        return float((-side) * np.nansum(f[ok] * m[ok]) / stop_dist), int(hi - lo)


def placebo_A(tape, i0, side, stop_dist, n_slots, cost_rt=COST_RT):
    """Entry at close(bar i0) -> t_entry = open(i0)+1h = open(i0+1).
    Price stop 1R; time stop after `n_slots` settlement slots."""
    n = len(tape.c)
    entry = tape.c[i0]
    if not np.isfinite(entry) or stop_dist <= 0:
        return np.nan
    stop = entry + stop_dist if side == -1 else entry - stop_dist
    # bar index of the n_slots-th settlement slot strictly after entry
    k = np.searchsorted(tape.sbar, i0 + 1, side="left") + max(n_slots - 1, 0)
    i_time = tape.sbar[k] if 0 <= k < len(tape.sbar) and tape.sbar[k] >= 0 \
        else min(i0 + 1 + MAX_SETTLEMENTS * 8, n - 1)
    i_time = max(i_time, i0 + 1)
    hi = min(i_time, n - 1)
    seg = slice(i0 + 1, hi + 1)
    if hi <= i0:
        return np.nan
    if side == -1:
        gap = tape.o[seg] >= stop
        touch = tape.h[seg] >= stop
    else:
        gap = tape.o[seg] <= stop
        touch = tape.l[seg] <= stop
    hit = gap | touch
    if hit.any():
        j = int(np.argmax(hit)) + i0 + 1
        exit_px = tape.o[j] if (tape.o[j] >= stop if side == -1
                                else tape.o[j] <= stop) else stop
        i_exit = j
    else:
        i_exit = hi
        exit_px = tape.c[hi]
    if not np.isfinite(exit_px):
        return np.nan
    fR, _ = tape.funding_R(i0 + 1, i_exit, side, stop_dist, True)
    priceR = side * (exit_px - entry) / stop_dist
    return priceR + fR - cost_rt * entry / stop_dist


def placebo_B(tape, i0, side, stop_dist, cost_rt=COST_RT,
              target_R=B_TARGET_R, horizon=B_TIME_BARS):
    n = len(tape.c)
    entry = tape.c[i0]
    if not np.isfinite(entry) or stop_dist <= 0:
        return np.nan
    stop = entry + stop_dist if side == -1 else entry - stop_dist
    tgt = entry - target_R * stop_dist if side == -1 else entry + target_R * stop_dist
    hi = min(i0 + horizon, n - 1)
    if hi <= i0:
        return np.nan
    seg = slice(i0 + 1, hi + 1)
    if side == -1:
        sh = (tape.o[seg] >= stop) | (tape.h[seg] >= stop)
        th = tape.l[seg] <= tgt
    else:
        sh = (tape.o[seg] <= stop) | (tape.l[seg] <= stop)
        th = tape.h[seg] >= tgt
    is_ = int(np.argmax(sh)) if sh.any() else 10 ** 9
    it_ = int(np.argmax(th)) if th.any() else 10 ** 9
    if is_ <= it_ and is_ < 10 ** 9:                 # stop first (ties = loss)
        j = i0 + 1 + is_
        gapped = (tape.o[j] >= stop) if side == -1 else (tape.o[j] <= stop)
        exit_px, i_exit = (tape.o[j] if gapped else stop), j
    elif it_ < 10 ** 9:
        j = i0 + 1 + it_
        exit_px, i_exit = tgt, j
    else:
        i_exit, exit_px = hi, tape.c[hi]
    if not np.isfinite(exit_px):
        return np.nan
    fR, _ = tape.funding_R(i0 + 1, i_exit, side, stop_dist, True)
    priceR = side * (exit_px - entry) / stop_dist
    return priceR + fR - cost_rt * entry / stop_dist


def null_A(trades, tapes, arm, win_start, win_end, draws=1000, seed=20260916):
    """DESIGN §6.1.  One-sided p = share of draws with mean netR >= observed."""
    rng = np.random.default_rng(seed)
    if not len(trades):
        return np.nan, np.array([])
    obs = float(np.nanmean([t["netR"] for t in trades]))
    # eligible entry indices per symbol, restricted to the same window
    elig = {}
    for s, tp in tapes.items():
        if arm == "A":
            cand = tp.sbar[(tp.sbar >= 0)]
        else:
            cand = np.arange(len(tp.idx))
        ts = tp.idx.values[cand]
        m = (ts >= np.datetime64(win_start.tz_localize(None))) & \
            (ts < np.datetime64(win_end.tz_localize(None)))
        cand = cand[m]
        cand = cand[tp.present[cand] & np.isfinite(tp.c[cand])
                    & np.isfinite(tp.datr[cand] if arm == "A" else tp.atr[cand])]
        elig[s] = cand
    means = np.empty(draws)
    for d in range(draws):
        vals = []
        for t in trades:
            tp = tapes[t["symbol"]]
            cand = elig[t["symbol"]]
            if not len(cand):
                continue
            real_date = t["t_entry"].date()
            for _ in range(8):
                i0 = int(cand[rng.integers(len(cand))])
                if tp.idx[i0].date() != real_date:
                    break
            if arm == "A":
                mult = t["stop_dist"] / t["datr"]
                sd = mult * tp.datr[i0]
                v = placebo_A(tp, i0, t["side"], sd, int(t["n_settlements"]))
            else:
                mult = t["stop_dist"] / t["atr14"]
                sd = mult * tp.atr[i0]
                v = placebo_B(tp, i0, t["side"], sd)
            if np.isfinite(v):
                vals.append(v)
        means[d] = np.mean(vals) if vals else np.nan
    p = float(np.nanmean(means >= obs))
    return p, means


def null_B_dayshift(trades, tapes, arm, draws=250, seed=20260917):
    """DESIGN §6.2 — whole-stream shift by k ~ U{1..250} days."""
    rng = np.random.default_rng(seed)
    if not len(trades):
        return np.nan, np.array([])
    obs = float(np.nanmean([t["netR"] for t in trades]))
    means = np.full(draws, np.nan)
    for d in range(draws):
        k = int(rng.integers(1, 251))
        vals = []
        for t in trades:
            tp = tapes[t["symbol"]]
            tgt = t["t_signal"] + pd.Timedelta(days=k)
            i0 = tp.pos.get(tgt)
            if i0 is None or not tp.present[i0]:
                continue
            if arm == "A":
                sd = (t["stop_dist"] / t["datr"]) * tp.datr[i0]
                v = placebo_A(tp, i0, t["side"], sd, int(t["n_settlements"]))
            else:
                sd = (t["stop_dist"] / t["atr14"]) * tp.atr[i0]
                v = placebo_B(tp, i0, t["side"], sd)
            if np.isfinite(v):
                vals.append(v)
        if vals:
            means[d] = np.mean(vals)
    return float(np.nanmean(means >= obs)), means


# --------------------------------------------------------------------------
# day-block bootstraps
# --------------------------------------------------------------------------
def _day_groups(df):
    days = pd.to_datetime(df["t_entry"]).dt.date.values
    u, inv = np.unique(days, return_inverse=True)
    buckets = [np.where(inv == i)[0] for i in range(len(u))]
    return buckets


def boot_mean_ci(df, draws=2000, lo=5, hi=95, seed=20260918):
    """90 % day-block bootstrap interval of the mean netR (DESIGN §9.1)."""
    if not len(df):
        return (np.nan, np.nan)
    rng = np.random.default_rng(seed)
    b = _day_groups(df)
    v = df["netR"].values
    m = np.empty(draws)
    for d in range(draws):
        pick = rng.integers(0, len(b), len(b))
        idx = np.concatenate([b[i] for i in pick])
        m[d] = v[idx].mean()
    return float(np.percentile(m, lo)), float(np.percentile(m, hi))


def boot_diff_ci(real, shadow, draws=2000, lo=5, hi=95, seed=20260919):
    """90 % two-sample day-block bootstrap of mean(real) - mean(shadow),
    whole UTC days resampled INDEPENDENTLY in each trade set (DESIGN §6.3)."""
    if not len(real) or not len(shadow):
        return (np.nan, np.nan)
    rng = np.random.default_rng(seed)
    br, bs = _day_groups(real), _day_groups(shadow)
    vr, vs = real["netR"].values, shadow["netR"].values
    d = np.empty(draws)
    for i in range(draws):
        ir = np.concatenate([br[j] for j in rng.integers(0, len(br), len(br))])
        is_ = np.concatenate([bs[j] for j in rng.integers(0, len(bs), len(bs))])
        d[i] = vr[ir].mean() - vs[is_].mean()
    return float(np.percentile(d, lo)), float(np.percentile(d, hi))
