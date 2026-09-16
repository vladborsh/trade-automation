#!/usr/bin/env python3
"""Test A — fit tables, then the holdout ONCE, then the ladder.

Pre-registered in `DESIGN.md` §3-§8; nothing here is tuned. Split into two
commands so the holdout cannot be cut by accident while the fit tables are
being read.

    python analysis.py fit        # every arm and row, FIT period only
    python analysis.py holdout    # the holdout, once, + nulls + the ladder
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import engine as E  # noqa: E402
import features as F  # noqa: E402

ARMS = [f"{s}-{tf}m" for s in C.INSTRUMENTS for tf in C.TFS]


def load(name="trades_all") -> pd.DataFrame:
    return pd.read_parquet(os.path.join(C.RESULTS, f"{name}.parquet"))


def describe(g: pd.DataFrame, num=1) -> dict:
    """Never silently impute: a trade with no defined R is excluded and
    counted."""
    if not len(g):
        return dict(n=0)
    bad = int((~np.isfinite(g[f"netR_{num}"].values)).sum())
    g = g[np.isfinite(g[f"netR_{num}"].values)]
    if not len(g):
        return dict(n=0, n_excluded=bad)
    net = g[f"netR_{num}"]
    return dict(n=len(g), n_excluded=bad, mean_netR=float(net.mean()),
                median_netR=float(net.median()),
                mean_grossR=float(g[f"grossR_{num}"].mean()),
                mean_cost_R=float(g[f"cost_R_{num}"].mean()),
                median_cost_R=float(g[f"cost_R_{num}"].median()),
                win_rate=float(100 * (net > 0).mean()),
                n_days=int(g.date.nunique()),
                pct_long=float(100 * (g.side > 0).mean()),
                median_stop_atr=float(g.stop_atr.median()) if "stop_atr" in g else np.nan,
                median_hold_min=float(g.hold_min.median()))


def add_stop_atr(q: pd.DataFrame) -> pd.DataFrame:
    """`stop_atr = stop_dist / ATR14` on the arm's bars at the entry bar —
    Null A sizes its placebo stops with it (DESIGN §6)."""
    v = np.full(len(q), np.nan)
    for (sym, tf), g in q.groupby(["symbol", "tf"], sort=False):
        I = F.Ind.get(sym, int(tf))
        v[g.index.values] = g.stop_dist.values / I.atr14[g.j.values]
    q["stop_atr"] = v
    return q


# ==========================================================================
# Null A — matched-time placebo (DESIGN §6)
# ==========================================================================
class Pool:
    """Every arm bar OPENING in [10:00, 12:00) NY on an eligible day, with a
    finite ATR14 and a live session after it. The placebo draws from here."""

    _cache: dict = {}

    def __init__(self, sym: str, tf: int):
        tp = E.Tape.get(sym)
        B = tp.bars[tf]
        I = F.Ind.get(sym, tf)
        days = C.nyse_days(C.FIT_START, C.TAIL_END)
        j, ient, iflat, dates = [], [], [], []
        for d in days:
            if E.opening_range(tp, d) is None:
                continue
            fl = E.flat_index(tp, d)
            a = np.searchsorted(B["t"], C.ny_ms(d, *C.TRIG_START), "left")
            b = np.searchsorted(B["t"], C.ny_ms(d, *C.TRIG_END_BASE), "left")
            for k in range(a, b):
                ie = int(B["i_last"][k])
                if ie < fl and np.isfinite(I.atr14[k]) and I.atr14[k] > 0:
                    j.append(k); ient.append(ie); iflat.append(fl); dates.append(d)
        self.j = np.asarray(j, np.int64)
        self.i_entry = np.asarray(ient, np.int64)
        self.i_flat = np.asarray(iflat, np.int64)
        self.date = np.asarray(dates)
        self.atr = I.atr14[self.j]
        self.close = B["c"][self.j]

    @classmethod
    def get(cls, sym, tf):
        k = (sym, int(tf))
        if k not in cls._cache:
            cls._cache[k] = Pool(sym, int(tf))
        return cls._cache[k]


def placebo_mean(sym, tf, pool: Pool, pick: np.ndarray, side: np.ndarray,
                 stop_atr: np.ndarray) -> float:
    tp = E.Tape.get(sym)
    entry = pool.close[pick]
    dist = stop_atr * pool.atr[pick]
    ok = np.isfinite(dist) & (dist > 0)
    if not ok.any():
        return np.nan
    pick, side, entry, dist = pick[ok], side[ok], entry[ok], dist[ok]
    stop = entry - side * dist
    tgt = entry + side * dist
    b0 = pool.i_entry[pick] + 1
    b1 = pool.i_flat[pick]
    live = b1 >= b0
    if not live.any():
        return np.nan
    pick, side, entry, dist = pick[live], side[live], entry[live], dist[live]
    stop, tgt, b0, b1 = stop[live], tgt[live], b0[live], b1[live]
    xi, xp, _ = E.walk1m_many(tp.o, tp.h, tp.l, tp.c, b0.astype(np.int64),
                              b1.astype(np.int64), side.astype(np.int64), entry, stop, tgt)
    gross = side * (xp - entry) / dist
    cst = E.cost_R(tp.venue, tp, pool.i_entry[pick], np.clip(xi, 0, tp.n - 1), entry, dist)
    return float(np.mean(gross - cst))


def null_A(sym, tf, g: pd.DataFrame, n_draws: int, rng) -> tuple[np.ndarray, float]:
    pool = Pool.get(sym, tf)
    side = g.side.values.astype(np.int64)
    sa = g.stop_atr.values
    means = np.full(n_draws, np.nan)
    clash_tot = 0
    n = len(g)
    for k in range(n_draws):
        pick = rng.integers(0, len(pool.j), size=n)
        clash = pool.date[pick] == g.date.values
        if clash.any():
            pick[clash] = rng.integers(0, len(pool.j), size=int(clash.sum()))
            clash_tot += int((pool.date[pick] == g.date.values).sum())
        means[k] = placebo_mean(sym, tf, pool, pick, side, sa)
    return means, clash_tot / (n_draws * max(n, 1))


def null_B(sym, tf, g: pd.DataFrame, n_draws: int, rng) -> tuple[np.ndarray, float]:
    """Whole-stream day shift: every trade moves k eligible days forward,
    keeping its clock slot. Entries with no bar at the shifted slot drop."""
    pool = Pool.get(sym, tf)
    days = list(dict.fromkeys(pool.date.tolist()))
    dpos = {d: i for i, d in enumerate(days)}
    # index the pool by (day, tod slot)
    slot = {}
    for i in range(len(pool.j)):
        d = pool.date[i]
        s = (E.Tape.get(sym).bars[int(tf)]["t"][pool.j[i]] - C.ny_ms(d, *C.OR_START))
        slot[(d, int(s))] = i
    base_slot = [(d, int(t - C.ny_ms(d, *C.OR_START)))
                 for d, t in zip(g.date.values, g.t_sig.values)]
    side = g.side.values.astype(np.int64)
    sa = g.stop_atr.values
    means = np.full(n_draws, np.nan)
    ks = rng.permutation(np.arange(1, n_draws + 1))
    drops = []
    for i, k in enumerate(ks):
        pick, sd, st = [], [], []
        for (d, s), sg, a in zip(base_slot, side, sa):
            p = dpos[d] + int(k)
            if p >= len(days):
                p -= len(days)
            key = (days[p], s)
            if key in slot:
                pick.append(slot[key]); sd.append(sg); st.append(a)
        drops.append(1.0 - len(pick) / max(len(g), 1))
        if not pick:
            continue
        means[i] = placebo_mean(sym, tf, pool, np.asarray(pick, np.int64),
                                np.asarray(sd, np.int64), np.asarray(st))
    return means, float(np.mean(drops))


def boot_days(netR, date, n_draws, rng) -> np.ndarray:
    by = {}
    for r, d in zip(netR, date):
        by.setdefault(d, []).append(r)
    blocks = [np.asarray(v) for v in by.values()]
    m = len(blocks)
    out = np.empty(n_draws)
    for k in range(n_draws):
        out[k] = np.concatenate([blocks[j] for j in rng.integers(0, m, size=m)]).mean()
    return out


# ==========================================================================
# Forward lift — v5-ny `tables.py:block_L`, windows substituted (DESIGN §4.1)
# ==========================================================================
HZ_CAP = 390                # minutes: 09:30->16:00 NY
REF_SAMPLE = 20000


def forward_lift(sym, tf, g: pd.DataFrame, rng) -> dict:
    if not len(g):
        return dict(n=0, lift_median=np.nan, pct_ge_1=np.nan)
    tp = E.Tape.get(sym)
    pool = Pool.get(sym, tf)
    I = F.Ind.get(sym, int(tf))
    atr = I.atr14[g.j.values]
    hz = np.minimum(g.i_flat.values - g.i_entry_min.values, HZ_CAP)
    b0 = g.i_entry_min.values + 1
    b1 = g.i_entry_min.values + hz
    mfe = _mfe(tp, b0, b1, g.side.values) / atr
    bucket = np.digitize(hz, [60, 120, 180, 240, 300])
    pb = np.arange(len(pool.j))
    if len(pb) > REF_SAMPLE:
        pb = np.sort(rng.choice(pb, REF_SAMPLE, replace=False))
    phz = np.minimum(pool.i_flat[pb] - pool.i_entry[pb], HZ_CAP)
    keep = phz > 0
    pb, phz = pb[keep], phz[keep]
    pbk = np.digitize(phz, [60, 120, 180, 240, 300])
    ref = {}
    for sd in (1, -1):
        m = _mfe(tp, pool.i_entry[pb] + 1, pool.i_entry[pb] + phz,
                 np.full(len(pb), sd)) / pool.atr[pb]
        for bk in np.unique(pbk):
            v = m[(pbk == bk) & np.isfinite(m)]
            if len(v):
                ref[(sd, int(bk))] = float(np.median(v))
    base = np.array([ref.get((int(s), int(b)), np.nan) for s, b in zip(g.side.values, bucket)])
    L = pd.Series(mfe / base).replace([np.inf, -np.inf], np.nan).dropna()
    return dict(n=int(len(L)), lift_median=float(L.median()),
                pct_ge_1=float(100 * (L >= 1).mean()), ref_n=int(len(pb)))


def _mfe(tp, b0, b1, side):
    out = np.empty(len(b0))
    for i in range(len(b0)):
        a, b = int(b0[i]), int(b1[i])
        if b < a or a < 1:
            out[i] = np.nan
            continue
        out[i] = (tp.h[a:b + 1].max() - tp.c[a - 1]) if side[i] > 0 \
            else (tp.c[a - 1] - tp.l[a:b + 1].min())
    return out


# ==========================================================================
# FIT
# ==========================================================================
def fit_pass() -> None:
    q = add_stop_atr(load())
    rng = np.random.default_rng(C.SEED)
    desc, exits, lift, sides = [], [], [], []
    for arm in ARMS:
        g = q[(q.arm == arm)]
        sym, tf = arm.rsplit("-", 1)[0], int(arm.rsplit("-", 1)[1][:-1])
        f = g[g.period == "fit"]
        for num in (1, 2):
            desc.append(dict(arm=arm, status="pre-registered", period="fit",
                             template=num, **describe(f, num)))
        t = g[g.period == "tail"]
        if len(t):
            desc.append(dict(arm=arm, status="pre-registered", period="tail",
                             template=1, **describe(t, 1)))
        ec = f.exit_1.value_counts()
        exits.append(dict(arm=arm, n=len(f),
                          **{k: int(ec.get(k, 0)) for k in ("target", "stop", "time-exit")},
                          **{f"t2_{k}": int(f.exit_2.value_counts().get(k, 0))
                             for k in ("stop", "time-exit")}))
        for sd, lab in ((1, "long"), (-1, "short")):
            s = f[f.side == sd]
            sides.append(dict(arm=arm, side=lab, **describe(s, 1)))
        lift.append(dict(arm=arm, **forward_lift(sym, tf, f, rng)))
        print(f"  [fit] {arm}: n={len(f)} mean_netR_1={f.netR_1.mean():+.4f} "
              f"mean_netR_2={f.netR_2.mean():+.4f}", flush=True)
    pd.DataFrame(desc).to_csv(os.path.join(C.RESULTS, "fit_describe.csv"), index=False)
    pd.DataFrame(exits).to_csv(os.path.join(C.RESULTS, "fit_exit_causes.csv"), index=False)
    pd.DataFrame(sides).to_csv(os.path.join(C.RESULTS, "fit_by_side.csv"), index=False)
    pd.DataFrame(lift).to_csv(os.path.join(C.RESULTS, "fit_forward_lift.csv"), index=False)

    # ---- descriptive crypto rows (§4.2) ---------------------------------
    rows = []
    for nm, lab in (("trades_weekend", "weekend"), ("trades_preetf", "pre-etf")):
        p = os.path.join(C.RESULTS, f"{nm}.parquet")
        if not os.path.exists(p):
            continue
        w = pd.read_parquet(p)
        for arm, g in w.groupby("arm"):
            for per in g.period.unique():
                gg = g[g.period == per]
                for num in (1, 2):
                    rows.append(dict(row=lab, arm=arm, period=per, template=num,
                                     **describe(gg, num)))
    pd.DataFrame(rows).to_csv(os.path.join(C.RESULTS, "descriptive_rows.csv"), index=False)
    print("\n[fit] wrote fit_describe / fit_exit_causes / fit_by_side / "
          "fit_forward_lift / descriptive_rows")


# ==========================================================================
# HOLDOUT — run ONCE
# ==========================================================================
def verdict(n, m_hold, p, m_fit, blo, bhi, gross) -> tuple[str, str]:
    if n < C.MIN_TRADES:
        return "UNDERPOWERED — INCONCLUSIVE", (
            f"{n} holdout trades < {C.MIN_TRADES}; no directional claim either way. "
            "Returns to the Architect.")
    if m_hold < C.KILL_MEAN or p > C.P_INCONCLUSIVE:
        why = (f"holdout mean net R {m_hold:+.3f}R < the pre-registered "
               f"+{C.KILL_MEAN:.2f}R kill bar" if m_hold < C.KILL_MEAN
               else f"Null-A p = {p:.3f} > {C.P_INCONCLUSIVE}")
        return "NO EDGE — KILL", why + "."
    if p > C.ALPHA:
        return "INCONCLUSIVE", (
            f"mean net R {m_hold:+.3f}R clears the kill bar but Null-A p = {p:.4f} is "
            f"above the Bonferroni-corrected {C.ALPHA:.5f}. No build.")
    fails = []
    if m_hold < C.BUILD_MEAN:
        fails.append(f"mean net R {m_hold:+.3f}R < +{C.BUILD_MEAN:.2f}R")
    if not (m_fit >= C.KILL_MEAN):
        fails.append(f"fit period does not agree (fit mean {m_fit:+.3f}R < +{C.KILL_MEAN:.2f}R)")
    if not (blo > 0 or bhi < 0):
        fails.append(f"90% day-block bootstrap [{blo:+.3f}, {bhi:+.3f}] includes 0")
    if not (gross > 0):
        fails.append(f"gross expectancy {gross:+.3f}R is not > 0")
    if fails:
        return "INCONCLUSIVE", ("clears the kill bar and the Bonferroni p, but the build "
                                "criteria are not all met: " + "; ".join(fails) + ".")
    return "REAL EDGE — build for real", (
        f"holdout mean net R {m_hold:+.3f}R, Null-A p = {p:.5f} <= {C.ALPHA:.5f}, fit agrees "
        f"({m_fit:+.3f}R), bootstrap [{blo:+.3f}, {bhi:+.3f}] excludes 0, gross "
        f"{gross:+.3f}R > 0. Routes to the Architect for a build ruling.")


def holdout_pass() -> None:
    q = add_stop_atr(load())
    rng = np.random.default_rng(C.SEED)
    fixed = pd.read_csv(os.path.join(C.RESULTS, "fixed_spread.csv"), index_col=0).iloc[:, 0]
    rows, verd, nulls, sens, draws = [], [], [], [], {}
    for arm in ARMS:
        sym, tf = arm.rsplit("-", 1)[0], int(arm.rsplit("-", 1)[1][:-1])
        g = q[q.arm == arm]
        h = g[g.period == "holdout"]
        f = g[g.period == "fit"]
        for num in (1, 2):
            rows.append(dict(arm=arm, period="holdout", template=num, **describe(h, num)))
        if not len(h):
            continue
        m_hold = float(h.netR_1.mean())
        nA, clash = null_A(sym, tf, h, C.N_PERM_A, rng)
        pA = float(np.nanmean(nA >= m_hold))
        nB, dropr = null_B(sym, tf, h, C.N_PERM_B, rng)
        pB = float(np.nanmean(nB >= m_hold))
        bt = boot_days(h.netR_1.values, h.date.values, C.N_BOOT, rng)
        blo, bhi = float(np.percentile(bt, C.BOOT_LO)), float(np.percentile(bt, C.BOOT_HI))
        draws[arm] = dict(nullA=nA.tolist(), nullB=nB.tolist())
        nulls.append(dict(arm=arm, n_holdout=len(h), mean_netR=m_hold,
                          nullA_mean=float(np.nanmean(nA)), p_A=pA,
                          nullA_same_date_residual=clash,
                          nullB_mean=float(np.nanmean(nB)), p_B=pB, nullB_drop_rate=dropr,
                          boot_lo=blo, boot_hi=bhi))
        m_fit = float(f.netR_1.mean()) if len(f) else np.nan
        v, why = verdict(len(h), m_hold, pA, m_fit, blo, bhi, float(h.grossR_1.mean()))
        verd.append(dict(arm=arm, n_holdout=len(h), n_fit=len(f),
                         mean_netR_holdout=m_hold, mean_netR_fit=m_fit,
                         mean_grossR_holdout=float(h.grossR_1.mean()),
                         mean_netR_holdout_t2=float(h.netR_2.mean()),
                         mean_netR_fit_t2=float(f.netR_2.mean()) if len(f) else np.nan,
                         p_A=pA, p_B=pB, boot_lo=blo, boot_hi=bhi,
                         verdict=v, reason=why))
        s = dict(arm=arm, base=m_hold)
        tp = E.Tape.get(sym)
        ix = np.clip(h.i_exit_1.values, 0, tp.n - 1)
        if tp.venue == "bn":
            s["0.04% round trip (maker)"] = float(h.netR_1_maker.mean())
        else:
            s["2x per-bar spread"] = float(h.netR_1_2x.mean())
            s["fixed fit-median spread"] = float((h.grossR_1.values - E.cost_R(
                "cc", tp, h.i_entry_min.values, ix, h.entry.values, h.stop_dist.values,
                "fixed", fixed[sym])).mean())
        sens.append(s)
        print(f"  [holdout] {arm}: n={len(h)} mean={m_hold:+.4f} pA={pA:.4f} -> {v}", flush=True)
    pd.DataFrame(rows).to_csv(os.path.join(C.RESULTS, "holdout_describe.csv"), index=False)
    pd.DataFrame(nulls).to_csv(os.path.join(C.RESULTS, "holdout_nulls.csv"), index=False)
    pd.DataFrame(verd).to_csv(os.path.join(C.RESULTS, "holdout_verdicts.csv"), index=False)
    pd.DataFrame(sens).to_csv(os.path.join(C.RESULTS, "holdout_cost_sensitivity.csv"), index=False)
    with open(os.path.join(C.RESULTS, "null_draws.json"), "w") as fh:
        json.dump(draws, fh)
    print("\n=== TEST A VERDICTS (template 1, the gate) ===")
    print(pd.DataFrame(verd)[["arm", "n_holdout", "mean_netR_holdout", "p_A", "verdict"]]
          .to_string(index=False))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fit"
    {"fit": fit_pass, "holdout": holdout_pass}[cmd]()
