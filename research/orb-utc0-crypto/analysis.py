#!/usr/bin/env python3
"""Fit tables, then the §7.3 SCREEN, then the holdout ONCE, then the ladder.

Pre-registered in `DESIGN.md` §3-§9; nothing here is tuned. Three commands so
that the screen decision is committed before the holdout can be cut:

    python analysis.py fit        # every fit-period table and control row
    python analysis.py screen     # §7.3 fit-period screen, FIT PERIOD ONLY
    python analysis.py holdout    # the holdout, once, SCREENED-IN arms only

`holdout` refuses to run at all unless `results/fit_screen.csv` exists, and it
computes nothing for an arm the screen removed — a screened-out arm's holdout
is never read.
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
from indicators import Ind  # noqa: E402

TF = C.TFS[0]
ARMS = [f"{s}-{TF}m" for s in C.INSTRUMENTS]
SCREEN_CSV = os.path.join(C.RESULTS, "fit_screen.csv")


def sym_of(arm: str) -> str:
    return arm.rsplit("-", 1)[0]


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
    Null A sizes its placebo stops with it (DESIGN §6.1)."""
    q = q.reset_index(drop=True)
    v = np.full(len(q), np.nan)
    for (sym, tf), g in q.groupby(["symbol", "tf"], sort=False):
        I = Ind.get(sym, int(tf))
        v[g.index.values] = g.stop_dist.values / I.atr14[g.j.values]
    q["stop_atr"] = v
    return q


# ==========================================================================
# Null A — matched-time placebo (DESIGN §6.1)
# ==========================================================================
class Pool:
    """Every arm bar OPENING in the [00:30, 02:30) UTC trigger window on an
    eligible day, with a finite ATR14 and a live session after it. The placebo
    draws from here. The population is **seven-day**: weekends are eligible
    days of this family, so a weekend trade's placebo may land on a weekday
    and vice versa — that is the registered Null A (§6.1), not an oversight."""

    _cache: dict = {}

    def __init__(self, sym: str, tf: int):
        tp = E.Tape.get(sym)
        B = tp.bars[tf]
        I = Ind.get(sym, tf)
        days = C.all_days(C.FIT_START, C.TAIL_END)
        j, ient, iflat, dates = [], [], [], []
        for d in days:
            if E.opening_range(tp, d) is None:
                continue
            fl = E.flat_index(tp, d)
            t0, t1 = E.trig_bounds(d)
            a = np.searchsorted(B["t"], t0, "left")
            b = np.searchsorted(B["t"], t1, "left")
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
    if n == 0:
        return means, 0.0
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
    B = E.Tape.get(sym).bars[int(tf)]
    slot = {}
    for i in range(len(pool.j)):
        d = pool.date[i]
        s = int(B["t"][pool.j[i]] - C.utc_ms(d, *C.ANCHOR))
        slot[(d, s)] = i
    base_slot = [(d, int(t - C.utc_ms(d, *C.ANCHOR)))
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
# Forward lift — v5-ny `tables.py:block_L`, windows substituted (DESIGN §6.3)
# ==========================================================================
HZ_CAP = 475                # minutes: 00:00 -> 07:55 UTC
REF_SAMPLE = 20000
_REF_CACHE: dict = {}


def _ref_table(sym, tf, rng):
    key = (sym, int(tf))
    if key in _REF_CACHE:
        return _REF_CACHE[key]
    tp = E.Tape.get(sym)
    pool = Pool.get(sym, tf)
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
    _REF_CACHE[key] = (ref, len(pb))
    return _REF_CACHE[key]


def forward_lift(sym, tf, g: pd.DataFrame, rng) -> dict:
    """Median non-circular forward lift: the trade's MFE over the same
    horizon, in ATR, divided by the median MFE of a random comparable bar in
    the same horizon bucket and on the same side. The reference table is built
    once per instrument from the whole pool, so cutting `g` (weekday/weekend,
    era) compares each half against the SAME reference."""
    if not len(g):
        return dict(n=0, lift_median=np.nan, pct_ge_1=np.nan, ref_n=0)
    tp = E.Tape.get(sym)
    I = Ind.get(sym, int(tf))
    atr = I.atr14[g.j.values]
    hz = np.minimum(g.i_flat.values - g.i_entry_min.values, HZ_CAP)
    b0 = g.i_entry_min.values + 1
    b1 = g.i_entry_min.values + hz
    mfe = _mfe(tp, b0, b1, g.side.values) / atr
    bucket = np.digitize(hz, [60, 120, 180, 240, 300])
    ref, ref_n = _ref_table(sym, tf, rng)
    base = np.array([ref.get((int(s), int(b)), np.nan)
                     for s, b in zip(g.side.values, bucket)])
    L = pd.Series(mfe / base).replace([np.inf, -np.inf], np.nan).dropna()
    return dict(n=int(len(L)), lift_median=float(L.median()),
                pct_ge_1=float(100 * (L >= 1).mean()), ref_n=int(ref_n))


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
# FIT — every table of §8, fit period only
# ==========================================================================
def fit_pass() -> None:
    q = add_stop_atr(load())
    rng = np.random.default_rng(C.SEED)
    desc, exits, lift, sides, splits, eras, tokyo = [], [], [], [], [], [], []
    for arm in ARMS:
        sym = sym_of(arm)
        g = q[q.arm == arm]
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
            sides.append(dict(arm=arm, side=lab, **describe(f[f.side == sd], 1)))
        lift.append(dict(arm=arm, half="all", **forward_lift(sym, TF, f, rng)))

        # ---- §8.1 weekday / weekend halves, FIT side ---------------------
        for lab, sub in (("weekday Mon-Fri UTC", f[~f.weekend]),
                         ("weekend Sat-Sun UTC", f[f.weekend])):
            for num in (1, 2):
                splits.append(dict(arm=arm, period="fit", half=lab, template=num,
                                   **describe(sub, num)))
            lift.append(dict(arm=arm, half=lab, **forward_lift(sym, TF, sub, rng)))

        # ---- §8.2 Tokyo-holiday row, fit+holdout pooled, DESCRIPTIVE -----
        # a pooled descriptive count, per §8.2; it carries no verdict and is
        # not part of the screen or the ladder.
        th = set(C.tokyo_holiday_days(C.FIT_START, C.HOLD_END))
        sub = g[(g.period.isin(["fit", "holdout"])) & (g.date.isin(th))]
        tokyo.append(dict(arm=arm, row="Tokyo holiday (JPX closed, UTC weekday)",
                          **describe(sub, 1)))
        sub2 = g[(g.period.isin(["fit", "holdout"])) & (~g.weekend) & (~g.date.isin(th))]
        tokyo.append(dict(arm=arm, row="Tokyo open (JPX trading, UTC weekday)",
                          **describe(sub2, 1)))

        # ---- §7.4 era rows, FIT side, DESCRIPTIVE ------------------------
        for col in ("era_break", "era_etf"):
            for v, sub in f.groupby(col):
                eras.append(dict(arm=arm, cut=col, era=v, **describe(sub, 1)))

        print(f"  [fit] {arm}: n={len(f)} mean_netR_1={f.netR_1.mean():+.4f} "
              f"mean_netR_2={f.netR_2.mean():+.4f}", flush=True)

    pd.DataFrame(desc).to_csv(os.path.join(C.RESULTS, "fit_describe.csv"), index=False)
    pd.DataFrame(exits).to_csv(os.path.join(C.RESULTS, "fit_exit_causes.csv"), index=False)
    pd.DataFrame(sides).to_csv(os.path.join(C.RESULTS, "fit_by_side.csv"), index=False)
    pd.DataFrame(lift).to_csv(os.path.join(C.RESULTS, "fit_forward_lift.csv"), index=False)
    pd.DataFrame(splits).to_csv(os.path.join(C.RESULTS, "weekday_weekend.csv"), index=False)
    pd.DataFrame(eras).to_csv(os.path.join(C.RESULTS, "era_rows.csv"), index=False)
    pd.DataFrame(tokyo).to_csv(os.path.join(C.RESULTS, "tokyo_holiday.csv"), index=False)

    # ---- §8.3 placebo anchors, FIT ONLY -------------------------------
    p = os.path.join(C.RESULTS, "trades_placebo.parquet")
    rows = []
    if os.path.exists(p):
        w = add_stop_atr(pd.read_parquet(p))
        for (anchor, arm), gg in w.groupby(["anchor", "arm"]):
            for num in (1, 2):
                rows.append(dict(anchor=anchor,
                                 anchor_label=gg.anchor_label.iloc[0], arm=arm,
                                 period="fit", template=num, **describe(gg, num)))
    pd.DataFrame(rows).to_csv(os.path.join(C.RESULTS, "placebo_anchors.csv"), index=False)

    # ---- §5 cost sensitivities on the FIT period ------------------------
    cs = []
    for arm in ARMS:
        f = q[(q.arm == arm) & (q.period == "fit")]
        cs.append(dict(arm=arm, period="fit", n=len(f),
                       base_0_10pct=float(f.netR_1.mean()),
                       maker_0_04pct=float(f.netR_1_maker.mean()),
                       double_0_20pct=float(f.netR_1_2x.mean()),
                       gross=float(f.grossR_1.mean()),
                       mean_cost_R=float(f.cost_R_1.mean())))
    pd.DataFrame(cs).to_csv(os.path.join(C.RESULTS, "fit_cost_sensitivity.csv"), index=False)
    print("\n[fit] wrote fit_describe / fit_exit_causes / fit_by_side / "
          "fit_forward_lift / weekday_weekend / era_rows / tokyo_holiday / "
          "placebo_anchors / fit_cost_sensitivity")


# ==========================================================================
# THE SCREEN — §7.3. FIT PERIOD ONLY. Committed before the holdout exists.
# ==========================================================================
def screen_pass() -> None:
    """An arm touches the holdout iff, on the FIT PERIOD ALONE:

        mean net R (template 1) >= +0.05R   AND   fit-period Null-A p <= 0.05

    An arm that fails is verdicted "NO EDGE — KILL (fit screen)" and its
    holdout is NEVER computed. Nothing here reads the holdout.
    """
    q = add_stop_atr(load())
    rng = np.random.default_rng(C.SEED)
    rows = []
    for arm in ARMS:
        sym = sym_of(arm)
        f = q[(q.arm == arm) & (q.period == "fit")]
        m_fit = float(f.netR_1.mean()) if len(f) else np.nan
        nA, clash = null_A(sym, TF, f, C.N_PERM_A, rng)
        pA = float(np.nanmean(nA >= m_fit))
        ok_mean = bool(np.isfinite(m_fit) and m_fit >= C.SCREEN_MEAN)
        ok_p = bool(pA <= C.SCREEN_P)
        passed = ok_mean and ok_p
        why = []
        if not ok_mean:
            why.append(f"fit mean net R {m_fit:+.4f}R < +{C.SCREEN_MEAN:.2f}R")
        if not ok_p:
            why.append(f"fit-period Null-A p = {pA:.3f} > {C.SCREEN_P:.2f}")
        rows.append(dict(arm=arm, symbol=sym, n_fit=len(f), mean_netR_fit=m_fit,
                         mean_grossR_fit=float(f.grossR_1.mean()) if len(f) else np.nan,
                         mean_cost_R_fit=float(f.cost_R_1.mean()) if len(f) else np.nan,
                         fit_nullA_mean=float(np.nanmean(nA)), fit_p_A=pA,
                         fit_nullA_same_date_residual=clash,
                         screen_mean_ok=ok_mean, screen_p_ok=ok_p,
                         screen="PASS" if passed else "SCREENED OUT",
                         reason="" if passed else "; ".join(why)))
        print(f"  [screen] {arm}: n_fit={len(f)} mean={m_fit:+.4f} pA={pA:.3f} "
              f"-> {'PASS' if passed else 'SCREENED OUT'}", flush=True)
    t = pd.DataFrame(rows)
    t.to_csv(SCREEN_CSV, index=False)
    print("\n=== §7.3 FIT-PERIOD SCREEN (no holdout number exists yet) ===")
    print(t[["arm", "n_fit", "mean_netR_fit", "fit_p_A", "screen", "reason"]]
          .to_string(index=False))
    print(f"\nscreened in: {list(t[t.screen == 'PASS'].arm) or '(none)'}")


# ==========================================================================
# HOLDOUT — run ONCE, screened-in arms only
# ==========================================================================
def verdict(n, m_hold, p, m_fit, blo, bhi, gross) -> tuple[str, str]:
    if n < C.MIN_TRADES:
        return "UNDERPOWERED — INCONCLUSIVE", (
            f"{n} holdout trades < {C.MIN_TRADES}; no directional claim either way. "
            "Returns to the Architect (DESIGN §12 stop rule).")
    if m_hold < C.KILL_MEAN or p > C.P_INCONCLUSIVE:
        why = (f"holdout mean net R {m_hold:+.3f}R < the pre-registered "
               f"+{C.KILL_MEAN:.2f}R kill bar" if m_hold < C.KILL_MEAN
               else f"Null-A p = {p:.3f} > {C.P_INCONCLUSIVE}")
        return "NO EDGE — KILL", why + "."
    if p > C.ALPHA:
        return "INCONCLUSIVE", (
            f"mean net R {m_hold:+.3f}R clears the kill bar but Null-A p = {p:.4f} is "
            f"above the cumulative Bonferroni {C.ALPHA:.6f}. No build.")
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
        f"holdout mean net R {m_hold:+.3f}R, Null-A p = {p:.6f} <= {C.ALPHA:.6f}, fit agrees "
        f"({m_fit:+.3f}R), bootstrap [{blo:+.3f}, {bhi:+.3f}] excludes 0, gross "
        f"{gross:+.3f}R > 0. Routes to the Architect for a build ruling — subject to the "
        "§8.1 weekend reading.")


def weekend_label(v: str, m_we, m_wd) -> tuple[str, str]:
    """§8.1, the pre-committed reading, applied mechanically. It can only
    DOWNGRADE a REAL EDGE; it never rescues anything."""
    if not v.startswith("REAL EDGE"):
        return v, ""
    if np.isfinite(m_we) and m_we < C.WEEKEND_MEAN and np.isfinite(m_wd) \
            and m_wd >= C.WEEKEND_MEAN:
        return ("REAL EDGE — story falsified — suspect",
                "the Tokyo open, not the reset — an imported anchor again")
    return v, "crypto-native reading stands: the weekend half is at or above the bar"


def holdout_pass() -> None:
    if not os.path.exists(SCREEN_CSV):
        raise SystemExit("results/fit_screen.csv does not exist. The §7.3 screen must be "
                         "run and committed before the holdout is touched.")
    scr = pd.read_csv(SCREEN_CSV)
    keep = list(scr[scr.screen == "PASS"].arm)
    print(f"[holdout] screened in: {keep or '(none)'}")
    print(f"[holdout] screened out, holdout NEVER computed: "
          f"{list(scr[scr.screen != 'PASS'].arm)}")
    if not keep:
        pd.DataFrame([dict(arm=a, verdict="NO EDGE — KILL (fit screen)",
                           reason=scr[scr.arm == a].reason.iloc[0],
                           n_holdout=np.nan, mean_netR_holdout=np.nan)
                      for a in ARMS]).to_csv(
            os.path.join(C.RESULTS, "holdout_verdicts.csv"), index=False)
        print("\nno arm was screened in; the holdout was not read for this family.")
        return

    q = add_stop_atr(load())
    rng = np.random.default_rng(C.SEED)
    rows, verd, nulls, sens, splits, draws = [], [], [], [], [], {}
    for arm in keep:
        sym = sym_of(arm)
        g = q[q.arm == arm]
        h = g[g.period == "holdout"]
        f = g[g.period == "fit"]
        for num in (1, 2):
            rows.append(dict(arm=arm, period="holdout", template=num, **describe(h, num)))
        if not len(h):
            continue
        m_hold = float(h.netR_1.mean())
        nA, clash = null_A(sym, TF, h, C.N_PERM_A, rng)
        pA = float(np.nanmean(nA >= m_hold))
        nB, dropr = null_B(sym, TF, h, C.N_PERM_B, rng)
        pB = float(np.nanmean(nB >= m_hold))
        bt = boot_days(h.netR_1.values, h.date.values, C.N_BOOT, rng)
        blo, bhi = float(np.percentile(bt, C.BOOT_LO)), float(np.percentile(bt, C.BOOT_HI))
        draws[arm] = dict(nullA=nA.tolist(), nullB=nB.tolist())
        nulls.append(dict(arm=arm, n_holdout=len(h), mean_netR=m_hold,
                          nullA_mean=float(np.nanmean(nA)), p_A=pA,
                          nullA_same_date_residual=clash,
                          nullB_mean=float(np.nanmean(nB)), p_B=pB, nullB_drop_rate=dropr,
                          boot_lo=blo, boot_hi=bhi))
        # §8.1 holdout halves
        hw, hk = h[h.weekend], h[~h.weekend]
        for lab, sub in (("weekday Mon-Fri UTC", hk), ("weekend Sat-Sun UTC", hw)):
            for num in (1, 2):
                splits.append(dict(arm=arm, period="holdout", half=lab, template=num,
                                   **describe(sub, num)))
            splits.append(dict(arm=arm, period="holdout", half=lab, template="lift",
                               **forward_lift(sym, TF, sub, rng)))
        m_we = float(hw.netR_1.mean()) if len(hw) else np.nan
        m_wd = float(hk.netR_1.mean()) if len(hk) else np.nan
        m_fit = float(f.netR_1.mean()) if len(f) else np.nan
        v, why = verdict(len(h), m_hold, pA, m_fit, blo, bhi, float(h.grossR_1.mean()))
        v, wlab = weekend_label(v, m_we, m_wd)
        verd.append(dict(arm=arm, n_holdout=len(h), n_fit=len(f),
                         mean_netR_holdout=m_hold, mean_netR_fit=m_fit,
                         mean_grossR_holdout=float(h.grossR_1.mean()),
                         mean_netR_holdout_t2=float(h.netR_2.mean()),
                         mean_netR_fit_t2=float(f.netR_2.mean()) if len(f) else np.nan,
                         holdout_weekday_netR=m_wd, n_weekday=len(hk),
                         holdout_weekend_netR=m_we, n_weekend=len(hw),
                         p_A=pA, p_B=pB, boot_lo=blo, boot_hi=bhi,
                         verdict=v, reason=why, weekend_reading=wlab))
        sens.append(dict(arm=arm, base_0_10pct=m_hold,
                         maker_0_04pct=float(h.netR_1_maker.mean()),
                         double_0_20pct=float(h.netR_1_2x.mean()),
                         gross=float(h.grossR_1.mean())))
        print(f"  [holdout] {arm}: n={len(h)} mean={m_hold:+.4f} pA={pA:.4f} "
              f"| weekday {m_wd:+.4f} (n={len(hk)}) weekend {m_we:+.4f} (n={len(hw)}) "
              f"-> {v}", flush=True)
        if len(h) < C.MIN_TRADES:
            print("\n*** STOP RULE (DESIGN §12): n_holdout < 150 on a screened-in arm: "
                  f"{arm} n={len(h)}. Return to the Architect. ***", flush=True)

    # screened-out arms carry their screen verdict into the same table
    for a in ARMS:
        if a not in keep:
            verd.append(dict(arm=a, verdict="NO EDGE — KILL (fit screen)",
                             reason=scr[scr.arm == a].reason.iloc[0],
                             n_fit=int(scr[scr.arm == a].n_fit.iloc[0]),
                             mean_netR_fit=float(scr[scr.arm == a].mean_netR_fit.iloc[0])))
    pd.DataFrame(rows).to_csv(os.path.join(C.RESULTS, "holdout_describe.csv"), index=False)
    pd.DataFrame(nulls).to_csv(os.path.join(C.RESULTS, "holdout_nulls.csv"), index=False)
    pd.DataFrame(verd).to_csv(os.path.join(C.RESULTS, "holdout_verdicts.csv"), index=False)
    pd.DataFrame(sens).to_csv(os.path.join(C.RESULTS, "holdout_cost_sensitivity.csv"),
                              index=False)
    if splits:
        old = os.path.join(C.RESULTS, "weekday_weekend.csv")
        prev = pd.read_csv(old) if os.path.exists(old) else pd.DataFrame()
        pd.concat([prev, pd.DataFrame(splits)], ignore_index=True).to_csv(old, index=False)
    with open(os.path.join(C.RESULTS, "null_draws.json"), "w") as fh:
        json.dump(draws, fh)
    print("\n=== VERDICTS (template 1, the gate) ===")
    print(pd.DataFrame(verd)[["arm", "n_holdout", "mean_netR_holdout", "p_A", "verdict"]]
          .to_string(index=False))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fit"
    {"fit": fit_pass, "screen": screen_pass, "holdout": holdout_pass}[cmd]()
