#!/usr/bin/env python3
"""Stage 1 — fit tables, then the holdout ONCE, then the ladder.

Pre-registered in `DESIGN.md` §4-§8; nothing here is tuned. Split from
`stage1.py` only so the fit pass and the holdout pass are separate commands
and the holdout cannot be run by accident while the fit tables are being
built.

    python stage1_analysis.py fit        # every leg, FIT period only
    python stage1_analysis.py holdout    # the holdout, once, + nulls + ladder
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine  # noqa: E402
import stage1 as S  # noqa: E402
import stage1_engine as SE  # noqa: E402


def load(name) -> pd.DataFrame:
    return pd.read_parquet(os.path.join(S.OUT, f"trades_{S.fn(name)}.parquet"))


def prim(q, caps=False, ll=False) -> pd.DataFrame:
    return q[(q.caps == caps) & (q.live_like == ll)]


# ==========================================================================
# FIT
# ==========================================================================
def fit_pass(names=None):
    legs = [lg for lg in S.LEGS if names is None or lg.name in names]
    desc, four, abl, lift, exits, capson = [], [], [], [], [], []
    for lg in legs:
        q = load(lg.name)
        tp = S.Tape.get(lg)
        print(f"[fit] {lg.name}", flush=True)
        for caps in (False, True):
            for ll in (False, True):
                g = prim(q, caps, ll)
                if not len(g):
                    continue
                # DESIGN §8: the FIT pass never aggregates a window that
                # contains holdout trades — not even a "full-sample" row, whose
                # value would imply the holdout mean.
                for per in ("fit", "tail"):
                    gg = g[g.period == per]
                    if not len(gg):
                        continue
                    row = dict(leg=lg.name, status=lg.status, caps_on=caps, live_like=ll,
                               period=per, **S.describe(gg, 1))
                    desc.append(row)
        g = prim(q)
        f = g[g.period == "fit"]
        for num, spec in S.NUMBERS.items():
            four.append(dict(leg=lg.name, number=num, template_fill=spec["label"],
                             **S.describe(f, num)))
        ec = f.exit_1.value_counts()
        exits.append(dict(leg=lg.name, n=len(f),
                          **{k: int(ec.get(k, 0)) for k in
                             ("target", "stop", "trailed stop", "time-exit",
                              "both-directions close")}))
        # ---- component ablation, FIT ONLY (DESIGN §5) -------------------
        lo = S._ms(lg.fit_start); hi = S._ms(S.FIT_END) + S.DAY_MS - 1
        for drop in SE.DROPS:
            tr = SE.run_ablate(tp.P, lo, hi, daily_caps=False, timing=lg.timing, drop=drop)
            r = ablate_R(lg, tp, tr)
            abl.append(dict(leg=lg.name, dropped=drop or "nothing (the bot)", **r))
            print(f"   ablate {drop}: n={r['n']}", flush=True)
        # ---- DESIGN §3: the (b) caps-ON population, a count + clock
        #      histogram only, to document the artefact. Nothing else is
        #      computed on it.
        if not lg.windowed:
            con = prim(q, True, False)
            hh = pd.to_datetime(tp.t[con.b_sig.values], unit="ms", utc=True).hour
            capson.append(dict(leg=lg.name, n_caps_on=len(con), n_caps_off=len(g),
                               **{f"h{k:02d}": int((hh == k).sum()) for k in range(24)}))

        # ---- non-circular forward lift (DESIGN §5) ----------------------
        lift.append(dict(leg=lg.name, **forward_lift(lg, tp, f)))
    for tab, nm in ((desc, "fit_describe"), (four, "fit_four_numbers"),
                    (abl, "fit_ablation"), (lift, "fit_forward_lift"),
                    (exits, "fit_exit_causes"), (capson, "b_legs_capson_clock")):
        pd.DataFrame(tab).to_csv(os.path.join(S.OUT, f"{nm}.csv"), index=False)
        print("wrote", nm)


def ablate_R(lg, tp, tr) -> dict:
    if not len(tr):
        return dict(n=0, mean_netR=np.nan, mean_grossR=np.nan)
    b_sig = np.searchsorted(tp.t, tr.signal_ts.values, "right") - 1
    b1 = S.alive_end_idx(tp, lg, tr.signal_ts.values)
    side = np.where(tr["dir"].values == S.BUY, 1, -1).astype(np.int64)
    dist = np.abs(tr.entry.values - tr.stop0.values)
    keep = (dist > 0) & (b1 > b_sig)
    if not keep.any():
        return dict(n=0, mean_netR=np.nan, mean_grossR=np.nan)
    b_sig, b1, side, dist = b_sig[keep], b1[keep], side[keep], dist[keep]
    tr = tr[keep]
    ex = np.searchsorted(tp.t, tr.exit_ts.fillna(tp.t[-1]).values, "left").clip(0, tp.n - 1)
    gross = side * (tr.exit_price.values - tr.entry.values) / dist
    cst = S.cost_R(lg, tp, b_sig, ex, tr.entry.values, dist)
    net = gross - cst
    ok = np.isfinite(net)
    # A handful of ablation orders have a shrunk stop a fraction of a tick
    # wide, so cost_R (a price-denominated cost over that stop) explodes and
    # the MEAN stops being readable. The median is reported beside it, and the
    # count of orders whose cost exceeds 5R is shown so the reader can see how
    # many drive the gap. Descriptive rows either way — DESIGN §5.
    deg = int((cst[ok] > 5.0).sum())
    return dict(n=int(ok.sum()), mean_netR=float(net[ok].mean()),
                median_netR=float(np.median(net[ok])),
                mean_grossR=float(gross[ok].mean()), n_cost_gt_5R=deg)


HZ_CAP = 290          # bars: the indices' alive window (09:40-14:30 NY) in minutes.
REF_SAMPLE = 20000    # reference-pool subsample for the lift denominator


def forward_lift(lg, tp, f) -> dict:
    """`v5-ny/tables.py:block_L`, windows substituted. Each signal's
    post-entry MFE in ATR over its own horizon, over the MEDIAN unconditional
    forward MFE for the same direction x horizon-length cell, measured from a
    random comparable stretch of the same tape. 1.00 = no better than a random
    comparable stretch.

    Two mechanical choices, both stated in REPORT.md: the horizon is capped at
    HZ_CAP bars (the 24/7 legs have no alive window, so an uncapped horizon
    would run to the end of the tape and the metric would be meaningless), and
    the unconditional reference is a seeded random subsample of REF_SAMPLE pool
    bars (a median does not need more, and the uncapped pool is millions of
    bars)."""
    if not len(f):
        return dict(n=0, lift_median=np.nan, pct_ge_1=np.nan, ref_n=0)
    rng = np.random.default_rng(S.SEED)
    pool = S.Pool(lg)
    hz = np.minimum(f.b1.values - f.b_sig.values, HZ_CAP)
    bucket = np.digitize(hz, [30, 60, 120, 180, 240])
    side = f.side.values
    b0 = f.b0.values.astype(np.int64)
    b1 = (f.b_sig.values + hz).astype(np.int64)
    mfe_atr = _mfe(tp, b0, b1, side) / tp.atr[f.b_sig.values]
    pb = pool.idx
    if len(pb) > REF_SAMPLE:
        pb = np.sort(rng.choice(pb, REF_SAMPLE, replace=False))
    phz = np.minimum(pool.end[pb] - pb, HZ_CAP)
    keep = phz > 0
    pb, phz = pb[keep], phz[keep]
    pbucket = np.digitize(phz, [30, 60, 120, 180, 240])
    ref = {}
    for sd in (1, -1):
        m = _mfe(tp, (pb + 1).astype(np.int64), (pb + phz).astype(np.int64),
                 np.full(len(pb), sd, np.int64)) / tp.atr[pb]
        for bk in np.unique(pbucket):
            v = m[(pbucket == bk) & np.isfinite(m)]
            if len(v):
                ref[(sd, int(bk))] = float(np.median(v))
    base = np.array([ref.get((int(s_), int(b_)), np.nan) for s_, b_ in zip(side, bucket)])
    L = pd.Series(mfe_atr / base).replace([np.inf, -np.inf], np.nan).dropna()
    return dict(n=int(len(L)), lift_median=float(L.median()),
                pct_ge_1=float(100 * (L >= 1).mean()), ref_n=int(len(pb)))


def _mfe(tp, b0, b1, side):
    out = np.empty(len(b0))
    for i in range(len(b0)):
        a, b = int(b0[i]), int(b1[i])
        if b < a:
            out[i] = np.nan; continue
        if side[i] > 0:
            out[i] = tp.h[a:b + 1].max() - tp.c[a - 1]
        else:
            out[i] = tp.c[a - 1] - tp.l[a:b + 1].min()
    return out


# ==========================================================================
# HOLDOUT — run ONCE
# ==========================================================================
def verdict(n, m_hold, p, m_fit, boot_lo, boot_hi, gross, m_ll):
    if n < S.MIN_TRADES:
        return "UNDERPOWERED — INCONCLUSIVE", (
            f"{n} holdout trades < {S.MIN_TRADES}; no directional claim either "
            "way. Returns to the Architect.")
    if m_hold < S.KILL_MEAN or p > S.P_INCONCLUSIVE:
        why = (f"holdout mean net R {m_hold:+.3f}R < the pre-registered "
               f"+{S.KILL_MEAN:.2f}R kill bar" if m_hold < S.KILL_MEAN
               else f"Null-A p = {p:.3f} > {S.P_INCONCLUSIVE}")
        return "NO EDGE — KILL", why + "."
    if p > S.P_BONF:
        return "INCONCLUSIVE", (
            f"mean net R {m_hold:+.3f}R clears the kill bar but Null-A "
            f"p = {p:.3f} is above the Bonferroni-corrected {S.P_BONF:.4f}. "
            "No build.")
    fails = []
    if m_hold < S.BUILD_MEAN:
        fails.append(f"mean net R {m_hold:+.3f}R < +{S.BUILD_MEAN:.2f}R")
    if not (m_fit >= S.KILL_MEAN):
        fails.append(f"fit period does not agree (fit mean {m_fit:+.3f}R < +{S.KILL_MEAN:.2f}R)")
    if not (boot_lo > 0 or boot_hi < 0):
        fails.append(f"90% day-block bootstrap [{boot_lo:+.3f}, {boot_hi:+.3f}] includes 0")
    if not (gross > 0):
        fails.append(f"gross expectancy {gross:+.3f}R is not > 0")
    if not (m_ll >= S.LIVELIKE_VETO and np.sign(m_ll) == np.sign(m_hold)):
        fails.append(f"live_like row {m_ll:+.3f}R fails the §2 veto (needs ≥ +{S.LIVELIKE_VETO:.2f}R, same sign)")
    if fails:
        return "INCONCLUSIVE", ("clears the kill bar and the Bonferroni p, but the build "
                                "criteria are not all met: " + "; ".join(fails) + ".")
    return "REAL EDGE — build for real", (
        f"holdout mean net R {m_hold:+.3f}R, Null-A p = {p:.4f} ≤ {S.P_BONF:.4f}, fit "
        f"agrees ({m_fit:+.3f}R), bootstrap [{boot_lo:+.3f}, {boot_hi:+.3f}] excludes 0, "
        f"gross {gross:+.3f}R > 0, live-like row {m_ll:+.3f}R clears the §2 veto. "
        "Routes to the Architect for a build ruling.")


def holdout_pass(names=None):
    legs = [lg for lg in S.LEGS if names is None or lg.name in names]
    rng = np.random.default_rng(S.SEED)
    rows, verd, nulls, sens = [], [], [], []
    draws = {}
    for lg in legs:
        q = load(lg.name)
        print(f"[holdout] {lg.name}", flush=True)
        for caps in (False, True):
            for ll in (False, True):
                g = prim(q, caps, ll)
                if not len(g):
                    continue
                h = g[g.period == "holdout"]
                if len(h):
                    rows.append(dict(leg=lg.name, status=lg.status, caps_on=caps,
                                     live_like=ll, period="holdout", **S.describe(h, 1)))
        g = prim(q)
        h = g[g.period == "holdout"]
        f = g[g.period == "fit"]
        for num in S.NUMBERS:
            if len(h):
                rows.append(dict(leg=lg.name, status=lg.status, caps_on=False, live_like=False,
                                 period=f"holdout_number{num}", **S.describe(h, num)))
        if not len(h):
            continue
        m_hold = float(h.netR_1.mean())
        # --- the nulls, on the holdout, template 1 -----------------------
        nA_draws = S.N_PERM_A          # DESIGN §5: 1,000 draws, every leg
        nA, clash = S.null_A(lg, h, nA_draws, rng)
        pA = float(np.nanmean(nA >= m_hold))
        nB, dropr = S.null_B(lg, h, S.N_PERM_B, rng)
        pB = float(np.nanmean(nB >= m_hold))
        bt = S.boot_days(h.netR_1.values, h.date.values, S.N_BOOT, rng)
        blo, bhi = float(np.percentile(bt, S.BOOT_LO)), float(np.percentile(bt, S.BOOT_HI))
        draws[lg.name] = dict(nullA=nA.tolist(), nullB=nB.tolist())
        nulls.append(dict(leg=lg.name, status=lg.status, n_holdout=len(h),
                          mean_netR=m_hold, nullA_draws=nA_draws,
                          nullA_mean=float(np.nanmean(nA)), p_A=pA,
                          nullA_same_date_residual=clash,
                          nullB_mean=float(np.nanmean(nB)), p_B=pB, nullB_drop_rate=dropr,
                          boot_lo=blo, boot_hi=bhi))
        hll = prim(q, False, True)
        hll = hll[hll.period == "holdout"]
        m_ll = float(hll.netR_1.mean()) if len(hll) else np.nan
        m_fit = float(f.netR_1.mean()) if len(f) else np.nan
        v, why = verdict(len(h), m_hold, pA, m_fit, blo, bhi, float(h.grossR_1.mean()), m_ll)
        verd.append(dict(leg=lg.name, status=lg.status, n_holdout=len(h), n_fit=len(f),
                         mean_netR_holdout=m_hold, mean_netR_fit=m_fit,
                         mean_grossR_holdout=float(h.grossR_1.mean()),
                         mean_netR_holdout_livelike=m_ll, p_A=pA, p_B=pB,
                         boot_lo=blo, boot_hi=bhi,
                         verdict=v if lg.status == "pre-registered" else "(descriptive — no verdict)",
                         reason=why if lg.status == "pre-registered" else ""))
        # --- cost sensitivities, non-gating ------------------------------
        s = dict(leg=lg.name, base=m_hold)
        for col, lab in (("netR_1_sens", "0.04% round trip (maker)"),
                         ("netR_1_fixed", "fixed fit-median spread"),
                         ("netR_1_2x", "2x per-bar spread")):
            if col in h.columns:
                s[lab] = float(h[col].mean())
        sens.append(s)
        print(f"   n={len(h)} mean={m_hold:+.4f} pA={pA:.4f} -> {v}", flush=True)
    pd.DataFrame(rows).to_csv(os.path.join(S.OUT, "holdout_describe.csv"), index=False)
    pd.DataFrame(nulls).to_csv(os.path.join(S.OUT, "holdout_nulls.csv"), index=False)
    pd.DataFrame(verd).to_csv(os.path.join(S.OUT, "holdout_verdicts.csv"), index=False)
    pd.DataFrame(sens).to_csv(os.path.join(S.OUT, "holdout_cost_sensitivity.csv"), index=False)
    with open(os.path.join(S.OUT, "null_draws.json"), "w") as fh:
        json.dump(draws, fh)
    print("\n=== VERDICTS ===")
    print(pd.DataFrame(verd)[["leg", "status", "n_holdout", "mean_netR_holdout", "p_A", "verdict"]]
          .to_string(index=False))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fit"
    names = sys.argv[2:] or None
    if cmd == "fit":
        fit_pass(names)
    elif cmd == "holdout":
        holdout_pass(names)
    else:
        raise SystemExit(cmd)
