"""Trade template, accounting, arms, nulls (DESIGN §3-§6).

Every valid 4 h close is simulated once per side ("the outcome table"); an arm
is a label selection over that table plus the one-position-per-symbol rule.
Because the template depends only on the close (entry, ATR), the matched-time
placebo is a draw from the same table.
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd
from numba import njit

from common import (Tape, build_4h, window_of, BAR_MIN, STOP_K, HOLD_MIN,
                    COST_RT, FIT_END, CACHE, SYMBOLS, TIER_OF,
                    L_SPOT, L_PERP, L_ABS)

CAUSES = np.array(["stop", "target", "time", "boundary"])


@njit(cache=True)
def _path(op, hi, lo, cl, i0, side, stop, target, i_end, i_bound):
    """Walk perp minutes i0 .. i_end-1.  Returns (i_exit_minute, exit_px,
    cause, t_exit_minute).  cause 0 stop, 1 target, 2 time, 3 boundary.
    t_exit is an exclusive minute index: fill minute + 1 for stop/target."""
    last_close, last_i = np.nan, -1
    for i in range(i0, i_end):
        if i == i_bound:
            # boundary exit at this minute's open (or last close if missing)
            px = op[i] if op[i] == op[i] else last_close
            return i, px, 3, i
        o = op[i]
        if o != o:
            continue
        h, l = hi[i], lo[i]
        if side > 0:
            if l <= stop:
                return i, min(o, stop), 0, i + 1
            if h >= target:
                return i, target, 1, i + 1
        else:
            if h >= stop:
                return i, max(o, stop), 0, i + 1
            if l <= target:
                return i, target, 1, i + 1
        last_close, last_i = cl[i], i
    return last_i, last_close, 2, i_end


def outcome_table(t: Tape, bars: pd.DataFrame, windows=("fit",)) -> pd.DataFrame:
    """Simulate long and short at every valid close of the given windows.
    One row per (bar, side).  The holdout is simulated only when stage 2 asks
    for it (DESIGN §6.1: no holdout R before the screen commit)."""
    op, hi, lo, cl = (t.p[k] for k in ("open", "high", "low", "close"))
    mj, rate, px, miss = t.funding_arrays()
    fp = np.where(np.isfinite(px), px, np.nan)
    i_bound = int(t.idx_of([FIT_END])[0])
    v = bars[bars.valid].copy()
    v["window"] = window_of(v.t_close)
    v = v[v.window.isin(list(windows))]
    out = []
    for side in (1, -1):
        rec = np.empty((len(v), 4))
        ent = v.close.to_numpy()
        sd = STOP_K * v.atr.to_numpy()
        i0s = ((v.bar.to_numpy() + 1) * BAR_MIN).astype(np.int64)
        win = v.window.to_numpy()
        for r in range(len(v)):
            i0 = i0s[r]
            e, d = ent[r], sd[r]
            stop, tgt = (e - d, e + d) if side > 0 else (e + d, e - d)
            i_end = min(i0 + HOLD_MIN, t.n)
            ib = i_bound if (win[r] == "fit" and i_bound < i_end) else -1
            rec[r] = _path(op, hi, lo, cl, i0, side, stop, tgt, i_end, ib)
        o = pd.DataFrame({
            "symbol": t.symbol, "tier": TIER_OF.get(t.symbol, ""),
            "bar": v.bar.to_numpy(), "t_entry": v.t_close.to_numpy(),
            "window": win, "label": v.label.to_numpy(),
            "label_sh": v.label_sh.to_numpy(), "dir": v.dir.to_numpy(),
            "side": side, "entry": ent, "stop_dist": sd, "atr": v.atr.to_numpy(),
            "i0": i0s, "i_exit": rec[:, 0].astype(np.int64),
            "exit_px": rec[:, 1], "cause": CAUSES[rec[:, 2].astype(int)],
            "t_exit_i": rec[:, 3].astype(np.int64),
        })
        # §4 funding: settlements with i0 <= m_j (t_j > t_k) and m_j < t_exit_i
        hi_j = np.searchsorted(mj, o.t_exit_i.to_numpy(), side="left")
        # t_k itself is minute i0's start; t_j > t_k  <=> m_j >= i0 + 1
        lo_j = np.searchsorted(mj, o.i0.to_numpy() + 1, side="left")
        fprice = np.where(np.isfinite(fp), fp, np.nan)
        contrib = rate * fprice
        csum = np.concatenate([[0.0], np.nancumsum(contrib)])
        cnan = np.concatenate([[0], np.cumsum(~np.isfinite(fprice))])
        cmiss = np.concatenate([[0], np.cumsum(miss)])
        S = csum[hi_j] - csum[lo_j]
        # a settlement minute with missing perp price: use entry price
        nan_n = cnan[hi_j] - cnan[lo_j]
        if nan_n.any():
            for r in np.where(nan_n > 0)[0]:
                js = np.arange(lo_j[r], hi_j[r])
                bad = js[~np.isfinite(fprice[js])]
                S[r] += (rate[bad] * o.entry.iat[r]).sum()
        o["n_settle"] = hi_j - lo_j
        # missing slots touching the hold: gaps closed by rows lo_j .. hi_j
        # (the first gap may straddle the entry, the last the exit -> an
        # over-count, i.e. conservative)
        o["n_missing"] = (cmiss[np.minimum(hi_j + 1, len(mj))]
                          - cmiss[np.minimum(lo_j, len(mj))])
        o["priceR"] = side * (o.exit_px - o.entry) / o.stop_dist
        o["fundingR"] = -side * S / o.stop_dist
        o["costR"] = COST_RT * o.entry / o.stop_dist
        o["netR"] = o.priceR + o.fundingR - o.costR
        o["grossR"] = o.priceR + o.fundingR
        o["hold_h"] = (o.t_exit_i - o.i0) / 60.0
        o["excluded"] = o.n_missing > 1
        out.append(o)
    res = pd.concat(out, ignore_index=True)
    res["t_exit"] = t.ts_of(res.t_exit_i)
    res["day"] = pd.DatetimeIndex(res.t_entry).floor("D")
    return res


def load_all(force=False, windows=("fit",)):
    """Outcome tables for all symbols, cached as parquet; plus 4h bars."""
    p_out = os.path.join(CACHE, f"outcomes_{'_'.join(windows)}.parquet")
    p_bar = os.path.join(CACHE, "bars4h.parquet")
    if os.path.exists(p_out) and os.path.exists(p_bar) and not force:
        return pd.read_parquet(p_out), pd.read_parquet(p_bar)
    outs, bars = [], []
    for s in SYMBOLS:
        t = Tape(s)
        b = build_4h(t)
        b["symbol"] = s
        bars.append(b)
        outs.append(outcome_table(t, b, windows))
        print(f"outcomes {s}: {len(outs[-1])}", flush=True)
    O, B = pd.concat(outs, ignore_index=True), pd.concat(bars, ignore_index=True)
    O.to_parquet(p_out, index=False)
    B.to_parquet(p_bar, index=False)
    return O, B


# ---- arms --------------------------------------------------------------------

def non_overlap(cand: pd.DataFrame) -> pd.DataFrame:
    """§3 one position per (arm, symbol): greedy in time, skip while open."""
    keep = []
    for _, g in cand.sort_values(["symbol", "i0"]).groupby("symbol", sort=False):
        i0 = g.i0.to_numpy()
        te = g.t_exit_i.to_numpy()
        free, idx = -1, g.index.to_numpy()
        for r in range(len(g)):
            if i0[r] >= free:
                keep.append(idx[r])
                free = te[r]
    return cand.loc[keep]


def select(O, window, side, mask_fn):
    c = O[(O.window == window) & (O.side == side)]
    c = c[mask_fn(c)]
    tr = non_overlap(c)
    return tr[~tr.excluded], int(tr.excluded.sum())


ARMS = {
    # name: (side, real mask, shadow mask)
    "L1": (1, lambda d: d.label == L_SPOT, lambda d: d.label_sh == L_SPOT),
    "L1c": (1, lambda d: d.label == L_PERP, lambda d: d.label_sh == L_PERP),
    "L2": (-1, lambda d: d.label == L_PERP, lambda d: d.label_sh == L_PERP),
    "L3": (1, lambda d: d.label == L_ABS, lambda d: d.label_sh == L_ABS),
    "L4B": (1, lambda d: d.dir == 1, lambda d: d.dir == 1),
    "L4F": (1, lambda d: d.label == L_SPOT, lambda d: d.label_sh == L_SPOT),
}


def arm_trades(O, arm, window, shadow=False):
    side, m, msh = ARMS[arm]
    return select(O, window, side, msh if shadow else m)


# ---- statistics ----------------------------------------------------------------

def summary(tr: pd.DataFrame) -> dict:
    n = len(tr)
    if n == 0:
        return dict(n=0)
    c = tr.cause.value_counts(normalize=True)
    return dict(n=n, netR=tr.netR.mean(), priceR=tr.priceR.mean(),
                fundingR=tr.fundingR.mean(), costR=tr.costR.mean(),
                grossR=tr.grossR.mean(), win=(tr.netR > 0).mean(),
                hold_h=tr.hold_h.mean(),
                stop=c.get("stop", 0), target=c.get("target", 0),
                time=c.get("time", 0), boundary=c.get("boundary", 0),
                days=tr.day.nunique())


def _day_groups(tr):
    days, inv = np.unique(tr.day.to_numpy(), return_inverse=True)
    sums = np.bincount(inv, weights=tr.netR.to_numpy(), minlength=len(days))
    cnts = np.bincount(inv, minlength=len(days)).astype(float)
    return days, sums, cnts


def boot_mean(tr, draws=2000, seed=20260928):
    """90 % day-block bootstrap interval of mean netR (whole entry days)."""
    _, s, c = _day_groups(tr)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(s), size=(draws, len(s)))
    m = s[idx].sum(1) / c[idx].sum(1)
    return tuple(np.percentile(m, [5, 95]))


def boot_diff(a, b, draws=2000, seed=20260928):
    """Two-sample, independent day resampling in each set (§5.1 (ii))."""
    _, sa, ca = _day_groups(a)
    _, sb, cb = _day_groups(b)
    rng = np.random.default_rng(seed)
    ia = rng.integers(0, len(sa), size=(draws, len(sa)))
    ib = rng.integers(0, len(sb), size=(draws, len(sb)))
    d = sa[ia].sum(1) / ca[ia].sum(1) - sb[ib].sum(1) / cb[ib].sum(1)
    return tuple(np.percentile(d, [5, 95]))


def boot_paired(f, b, draws=2000, seed=20260928):
    """L4: days resampled jointly for F and B (§6.2)."""
    days = np.union1d(f.day.to_numpy(), b.day.to_numpy())
    def agg(tr):
        pos = np.searchsorted(days, tr.day.to_numpy())
        return (np.bincount(pos, weights=tr.netR.to_numpy(), minlength=len(days)),
                np.bincount(pos, minlength=len(days)).astype(float))
    sf, cf = agg(f)
    sb, cb = agg(b)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(days), size=(draws, len(days)))
    with np.errstate(all="ignore"):
        d = sf[idx].sum(1) / cf[idx].sum(1) - sb[idx].sum(1) / cb[idx].sum(1)
    d = d[np.isfinite(d)]
    return tuple(np.percentile(d, [5, 95]))


def placebo(O, tr, pool_mask_fn, draws=1000, seed=20260928):
    """§5.2 matched-time placebo: each trade -> random close of the same
    symbol / window / side from the pool, on a different UTC date."""
    rng = np.random.default_rng(seed)
    if len(tr) == 0:
        return np.nan, np.array([])
    total = np.zeros(draws)
    for (s, w, side), g in tr.groupby(["symbol", "window", "side"]):
        pool = O[(O.symbol == s) & (O.window == w) & (O.side == side) & ~O.excluded]
        pool = pool[pool_mask_fn(pool)]
        pr = pool.netR.to_numpy()
        pdays = pool.day.to_numpy()
        tdays = g.day.to_numpy()
        k = rng.integers(0, len(pool), size=(draws, len(g)))
        bad = pdays[k] == tdays[None, :]
        while bad.any():
            k[bad] = rng.integers(0, len(pool), size=int(bad.sum()))
            bad = pdays[k] == tdays[None, :]
        total += pr[k].sum(1)
    means = total / len(tr)
    p = float((means >= tr.netR.mean()).mean())
    return p, means
