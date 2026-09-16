#!/usr/bin/env python3
"""§8.2.7 / §10 — statistics, nulls, the fit screen and the holdout gate.

    python analysis.py fit        # every fit-period row and sensitivity
    python analysis.py screen     # prints the screen decision to paste into DESIGN.md
    python analysis.py holdout    # refuses to run until DESIGN.md carries the
                                  # committed screen decision (§10.1)
    python analysis.py forward    # refuses to run before 2026-11-01 (§7.3)

Day-block bootstrap: the resampling unit is the ANCHOR DAY — all legs of a day
travel together (§10.2), carried from orb-utc0-crypto/analysis.py.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
from xselect import Panel  # noqa: E402  # §8.2.3 "select.py"; renamed because `select` is a stdlib module

ARMS = {"RVOL-top5-s0.5": "RVOL", "TR24-top5-s0.5": "TR24"}


# ============================================================ resampling core
def day_blocks(dates: np.ndarray, vals: np.ndarray):
    """Group values by day; returns (unique days, list of per-day arrays)."""
    o = np.argsort(dates, kind="stable")
    d, v = dates[o], vals[o]
    starts = np.concatenate([[0], np.where(d[1:] != d[:-1])[0] + 1])
    ends = np.concatenate([starts[1:], [len(d)]])
    return d[starts], [v[a:b] for a, b in zip(starts, ends)]


def boot_mean(dates, vals, n=C.N_BOOT, seed=C.SEED) -> tuple[float, float]:
    """90 % day-block bootstrap interval on the mean (§10.2)."""
    days, groups = day_blocks(np.asarray(dates), np.asarray(vals, float))
    sums = np.array([g.sum() for g in groups])
    cnts = np.array([len(g) for g in groups])
    rng = np.random.default_rng(seed)
    m = len(days)
    draws = rng.integers(0, m, size=(n, m))
    s = sums[draws].sum(1)
    c = cnts[draws].sum(1)
    b = s / c
    return float(np.percentile(b, C.BOOT_LO)), float(np.percentile(b, C.BOOT_HI))


def boot_diff(dates_a, vals_a, dates_b, vals_b, n=C.N_BOOT, seed=C.SEED + 7):
    """90 % interval on mean(a) - mean(b) with days resampled JOINTLY, so the
    top-5 and bottom-5 (or arm A and arm B) of the same day travel together."""
    da, ga = day_blocks(np.asarray(dates_a), np.asarray(vals_a, float))
    db, gb = day_blocks(np.asarray(dates_b), np.asarray(vals_b, float))
    days = np.array(sorted(set(da) & set(db)))
    ia = {d: i for i, d in enumerate(da)}
    ib = {d: i for i, d in enumerate(db)}
    sa = np.array([ga[ia[d]].sum() for d in days]); ca = np.array([len(ga[ia[d]]) for d in days])
    sb = np.array([gb[ib[d]].sum() for d in days]); cb = np.array([len(gb[ib[d]]) for d in days])
    rng = np.random.default_rng(seed)
    m = len(days)
    dr = rng.integers(0, m, size=(n, m))
    b = sa[dr].sum(1) / ca[dr].sum(1) - sb[dr].sum(1) / cb[dr].sum(1)
    point = sa.sum() / ca.sum() - sb.sum() / cb.sum()
    return float(point), float(np.percentile(b, C.BOOT_LO)), float(np.percentile(b, C.BOOT_HI))


def stats(legs: pd.DataFrame, idx: np.ndarray, label: str,
          stop_mult: float = C.STOP_GATE, netcol: str = "netR") -> dict:
    sub = legs.iloc[idx]
    net = sub[netcol].values.astype(float)
    if not len(net):
        return dict(row=label, n_legs=0, n_days=0)
    lo, hi = boot_mean(sub.date.values, net)
    return dict(row=label, n_legs=len(sub), n_days=int(sub.date.nunique()),
                mean_netR=float(net.mean()), mean_grossR=float(sub.grossR.mean()),
                mean_costR=float(sub.cost_R.mean()),
                mean_dATR=float(net.mean() * stop_mult),
                sd_netR=float(net.std(ddof=1)), hit=float((net > 0).mean()),
                boot_lo=lo, boot_hi=hi,
                stop_share=float((sub.exit_cause == 1).mean()))


# ================================================================== the rows
def arm_rows(legs: pd.DataFrame, selector: str, period: str, arm: str,
             with_nulls: bool = True) -> tuple[list[dict], dict]:
    """The primary row, its two nulls, bottom/middle, and Delta_tb."""
    sub = legs[legs.period == period]
    if selector == "TR24":
        sub = sub[np.isfinite(sub.tr24.values)]
    P = Panel(sub, selector)
    rows, extra = [], {}
    ti, _ = P.top()
    bi, _ = P.bottom()
    mi, _ = P.middle()
    rows.append({**stats(P.legs, ti, f"{arm} — PRIMARY"), "arm": arm, "period": period})
    rows.append({**stats(P.legs, bi, f"{arm} — bottom-5 null"), "arm": arm, "period": period})
    rows.append({**stats(P.legs, mi, f"{arm} — middle-5 (descriptive)"), "arm": arm,
                 "period": period})
    if with_nulls and len(ti):
        m = P.legs.netR.values[ti].mean()
        rk = P.random_k()
        p = float((rk >= m).mean())
        extra["random5_p"] = p
        extra["random5_mean"] = float(rk.mean())
        extra["random5_sd"] = float(rk.std(ddof=1))
        extra["random5_q95"] = float(np.percentile(rk, 95))
        ds = P.day_shift()
        extra["dayshift_mean"] = float(np.nanmean(ds))
        extra["dayshift_p"] = float(np.nanmean(ds >= m))
        d, lo, hi = boot_diff(P.legs.date.values[ti], P.legs.netR.values[ti],
                              P.legs.date.values[bi], P.legs.netR.values[bi])
        extra["delta_tb"] = d
        extra["delta_tb_lo"], extra["delta_tb_hi"] = lo, hi
        extra["n_elig_median"] = float(np.median(P.n_elig))
    extra["panel"] = P
    return rows, extra


def ladder(mean_net, p, n_legs, n_days, m_fit, boot_lo, boot_hi, gross,
           d_tb_lo=None, d_tb_hi=None, funding=None, delist=None) -> str:
    if n_legs < C.MIN_LEGS or n_days < C.MIN_TRADE_DAYS:
        return "UNDERPOWERED — inconclusive"
    if mean_net < C.KILL_MEAN or p > C.P_INCONCLUSIVE:
        return "NO EDGE — kill"
    build = (mean_net >= C.BUILD_MEAN and p <= C.ALPHA
             and m_fit is not None and np.sign(m_fit) == np.sign(mean_net)
             and m_fit >= C.SCREEN_MEAN
             and (boot_lo > 0 or boot_hi < 0) and gross > 0
             and d_tb_lo is not None and (d_tb_lo > 0 or d_tb_hi < 0)
             and funding is not None and funding >= C.KILL_MEAN
             and np.sign(funding) == np.sign(mean_net)
             and delist is not None and delist >= C.KILL_MEAN
             and np.sign(delist) == np.sign(mean_net))
    if build:
        return "REAL EDGE — routes to the §7.3 forward confirmation"
    if mean_net >= C.KILL_MEAN and p <= C.P_INCONCLUSIVE:
        return "INCONCLUSIVE"
    return "NO EDGE — kill"


def _design_has_screen() -> bool:
    """§10.1 / §8.2.7: the holdout refuses to run until the fit-screen decision
    is committed in DESIGN.md."""
    p = os.path.join(HERE, "DESIGN.md")
    if not os.path.exists(p):
        return False
    txt = open(p).read()
    if "FIT SCREEN DECISION — COMMITTED" not in txt:
        return False
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%H", "--", p],
                             cwd=HERE, capture_output=True, text=True, check=True)
        sha = out.stdout.strip()
        dirty = subprocess.run(["git", "diff", "--name-only", "--", p],
                               cwd=HERE, capture_output=True, text=True, check=True)
        return bool(sha) and not dirty.stdout.strip()
    except Exception:  # noqa: BLE001
        return False


# ==========================================================================
# The rows
# ==========================================================================
def _load(tag: str = "base") -> pd.DataFrame:
    import funding as FD
    p = os.path.join(C.RESULTS, "instrument_days.parquet" if tag == "base"
                     else f"legs_{tag}.parquet")
    legs = pd.read_parquet(p)
    if tag == "base":
        fp = os.path.join(C.RESULTS, "instrument_days_funded.parquet")
        if os.path.exists(fp):
            legs = pd.read_parquet(fp)
        else:
            legs = FD.attach(legs)
            legs.to_parquet(fp, index=False, compression="zstd")
    return legs


def block(legs: pd.DataFrame, selector: str, arm: str, period: str,
          stop_mult: float = C.STOP_GATE, nulls: bool = True) -> dict:
    """Everything §10 needs for one arm in one period, plus the §9 veto rows
    and the §2.4 dose response."""
    sub = legs[legs.period == period].reset_index(drop=True)
    if selector.startswith("TR"):
        col = {"TR24": "tr24", "TR12": "tr12", "TR48": "tr48"}[selector]
        sub = sub[np.isfinite(sub[col].values)].reset_index(drop=True)
    P = Panel(sub, selector)
    L = P.legs
    ti, _ = P.top(); bi, _ = P.bottom(); mi, _ = P.middle()
    out = dict(arm=arm, selector=selector, period=period, stop=stop_mult,
               n_elig_median=float(np.median(P.n_elig)) if len(P.n_elig) else 0.0,
               n_tradable_days=int(P.tradable().sum()))
    out["primary"] = stats(L, ti, f"{arm} — PRIMARY", stop_mult)
    out["bottom5"] = stats(L, bi, f"{arm} — bottom-5 null", stop_mult)
    out["middle5"] = stats(L, mi, f"{arm} — middle-5 (descriptive)", stop_mult)
    if not len(ti):
        return out
    m = float(L.netR.values[ti].mean())

    # ---- Null A (supplies p), Null B, Delta_tb
    if nulls:
        rk = P.random_k()
        out["random5"] = dict(p=float((rk >= m).mean()), mean=float(rk.mean()),
                              sd=float(rk.std(ddof=1)),
                              q95=float(np.percentile(rk, 95)),
                              n_draws=C.N_RANDOM_K)
        ds = P.day_shift()
        out["dayshift"] = dict(mean=float(np.nanmean(ds)),
                               p=float(np.nanmean(ds >= m)), n_draws=C.N_DAYSHIFT)
        d, lo, hi = boot_diff(L.date.values[ti], L.netR.values[ti],
                              L.date.values[bi], L.netR.values[bi])
        out["delta_tb"] = dict(point=d, lo=lo, hi=hi, excludes_zero=bool(lo > 0 or hi < 0))

    # ---- §6.2 funding veto row
    if "netR_fund" in L.columns:
        s = L.iloc[ti]
        lo, hi = boot_mean(s.date.values, s.netR_fund.values)
        out["funding_row"] = dict(row=f"{arm} — funding applied (VETO)",
                                  n_legs=len(s), mean_netR=float(s.netR_fund.mean()),
                                  mean_funding_R=float(s.funding_R.mean()),
                                  share_missing_rate=float(s.funding_missing.mean()),
                                  mean_settlements=float(s.n_settlements.mean()),
                                  boot_lo=lo, boot_hi=hi)

    # ---- §9 delisting-exclusion veto row (NOT in the primary)
    keep = ti[L.delist_days_after.values[ti] >= 30]
    out["delist_row"] = {**stats(L, keep, f"{arm} — delisted-within-30d excluded (VETO)",
                                 stop_mult),
                         "n_removed": int(len(ti) - len(keep)),
                         "share_removed": float(1 - len(keep) / len(ti))}
    out["delist_desc"] = dict(
        share_legs_delist_30d=float((L.delist_days_after.values[ti] < 30).mean()),
        share_legs_delist_90d=float((L.delist_days_after.values[ti] < 90).mean()))

    # ---- §10 BTC/ETH concentration flag
    s = L.iloc[ti]
    be = s.symbol.isin(["BTCUSDT", "ETHUSDT"])
    out["btc_eth"] = dict(share_legs=float(be.mean()),
                          share_of_total_netR=float(s.netR[be].sum() / s.netR.sum())
                          if s.netR.sum() != 0 else np.nan,
                          mean_netR_btc_eth=float(s.netR[be].mean()) if be.any() else np.nan,
                          mean_netR_rest=float(s.netR[~be].mean()))

    # ---- §9 descriptive: RVOL>=10, liquidity quintiles
    if selector == "RVOL":
        hi_ = s.rvol >= 10
        out["rvol_ge10"] = dict(n=int(hi_.sum()),
                                mean_netR=float(s.netR[hi_].mean()) if hi_.any() else np.nan,
                                mean_netR_rest=float(s.netR[~hi_].mean()))
    q = pd.qcut(s.liq_med, 5, labels=False, duplicates="drop")
    out["liq_quintile"] = {int(k): dict(n=int(v.size), mean_netR=float(v.mean()))
                           for k, v in s.netR.groupby(q)}

    # ---- §2.4 dose response, deciles cut per day over ALL eligible days
    dec = P.deciles()
    g = dec.groupby("decile").netR.agg(["size", "mean"])
    out["deciles"] = {int(k): dict(n=int(r["size"]), mean_netR=float(r["mean"]))
                      for k, r in g.iterrows()}
    out["_sel_idx"] = ti.tolist()
    out["_panel_days"] = P.days.tolist()
    return out


def compare_AB(legs: pd.DataFrame, period: str) -> dict:
    """§2.5 / DESIGN §3.4 — DESCRIPTIVE, NO VERDICT."""
    sub = legs[legs.period == period].reset_index(drop=True)
    PA = Panel(sub, "RVOL")
    PB = Panel(sub[np.isfinite(sub.tr24.values)].reset_index(drop=True), "TR24")
    ta, _ = PA.top(); tb, _ = PB.top()
    A = PA.legs.iloc[ta][["date", "symbol", "netR"]]
    B = PB.legs.iloc[tb][["date", "symbol", "netR"]]
    d, lo, hi = boot_diff(A.date.values, A.netR.values, B.date.values, B.netR.values)
    ka = A.groupby("date").symbol.apply(set)
    kb = B.groupby("date").symbol.apply(set)
    common = ka.index.intersection(kb.index)
    jac = [len(ka[d_] & kb[d_]) / len(ka[d_] | kb[d_]) for d_ in common]
    keyA = set(zip(A.date, A.symbol)); keyB = set(zip(B.date, B.symbol))
    both = keyA & keyB
    a_only = keyA - keyB
    b_only = keyB - keyA
    def mn(df, keys):
        k = set(keys)
        m = [r.netR for r in df.itertuples() if (r.date, r.symbol) in k]
        return float(np.mean(m)) if m else np.nan
    # Spearman rank correlation of RVOL and |TR24| across eligible symbols, per day
    rhos = []
    s2 = sub[np.isfinite(sub.tr24.values) & np.isfinite(sub.rvol.values)]
    for d_, g in s2.groupby("date"):
        if len(g) < C.N_ELIG_MIN:
            continue
        x = pd.Series(g.rvol.values).rank().values
        y = pd.Series(np.abs(g.tr24.values)).rank().values
        if x.std() > 0 and y.std() > 0:
            rhos.append(float(np.corrcoef(x, y)[0, 1]))
    if d > 0 and lo > 0:
        wording = "selector A dominates B"
    elif d < 0 and hi < 0:
        wording = "selector B dominates A"
    else:
        wording = "indistinguishable"
    return dict(period=period, delta_AB=d, lo=lo, hi=hi, wording=wording,
                mean_jaccard=float(np.mean(jac)) if jac else np.nan,
                share_legs_in_both_A=float(len(both) / len(keyA)) if keyA else np.nan,
                mean_netR_A_only=mn(A, a_only), mean_netR_B_only=mn(B, b_only),
                mean_netR_both_A=mn(A, both), mean_netR_both_B=mn(B, both),
                mean_spearman_rvol_tr24=float(np.mean(rhos)) if rhos else np.nan)


# ==========================================================================
# §11 fit-only sensitivities
# ==========================================================================
SENS_LEGS = {          # tag -> (label, build.py args)  — all fit-only
    "s0.25":  ("stop 0.25 x dATR14", dict(stop=0.25)),
    "s1.0":   ("stop 1.0 x dATR14", dict(stop=1.0)),
    "s0.10":  ("stop 0.10 x dATR14 (the paper's)", dict(stop=0.10)),
    "h120":   ("horizon +2 h", dict(horizon=120)),
    "h360":   ("horizon 16:00 NY (+6 h)", dict(horizon=360)),
    "rt0.04": ("cost 0.04 % (maker)", dict(rt=0.0004)),
    "rt0.20": ("cost 0.20 % (thin book + slippage)", dict(rt=0.0020)),
    "sidetr": ("direction = sign(TR24)", dict(side="tr24")),
    "w5":     ("5-minute reader and 5-minute RVOL", dict(panel="w5", window=5)),
    "utc0":   ("placebo anchor 00:00 UTC", dict(panel="utc0")),
    "utc4":   ("placebo anchor 04:00 UTC", dict(panel="utc4")),
}


def sens_rows(period: str = "fit") -> list[dict]:
    """Every fit-only sensitivity that is an index lookup on the gating leg
    table, plus every one that has its own re-walked leg table."""
    legs = _load("base")
    rows = []

    # -- index-lookup sensitivities on the gating table
    for selector, arm in ARMS.items():
        pass
    for arm, selector in ARMS.items():
        sub = legs[legs.period == period].reset_index(drop=True)
        if selector == "TR24":
            sub = sub[np.isfinite(sub.tr24.values)].reset_index(drop=True)
        P = Panel(sub, selector)
        for k in C.K_SENS:
            i, _ = P.top(k=k)
            rows.append({**stats(P.legs, i, f"{arm} — k = {k} (fit-only)"), "arm": arm})
        if selector == "RVOL":
            i, _ = P.threshold(3.0, cap=10)
            rows.append({**stats(P.legs, i, f"{arm} — RVOL >= 3, capped at 10 legs (fit-only)"),
                         "arm": arm})
        # minimum-move filter
        i, _ = P.top()
        keep = i[np.abs(P.legs.r30.values[i]) >= 0.10 * P.legs.datr14.values[i]
                 / P.legs.entry.values[i]]
        rows.append({**stats(P.legs, keep,
                             f"{arm} — min-move |r30| >= 0.10 x dATR14 (fit-only)"), "arm": arm})
        # 50 M liquidity floor
        sub2 = sub[sub.liq_med >= C.LIQ_FLOOR_SENS].reset_index(drop=True)
        P2 = Panel(sub2, selector)
        i2, _ = P2.top()
        rows.append({**stats(P2.legs, i2, f"{arm} — liquidity floor 50 M USDT (fit-only)"),
                     "arm": arm})

    # -- selector B at 12 h and 48 h
    sub = legs[legs.period == period].reset_index(drop=True)
    for selname, col in (("TR12", "tr12"), ("TR48", "tr48")):
        s = sub[np.isfinite(sub[col].values)].reset_index(drop=True)
        P = Panel(s, selname)
        i, _ = P.top()
        rows.append({**stats(P.legs, i, f"{selname}-top5-s0.5 (fit-only sensitivity)"),
                     "arm": "TR24-top5-s0.5"})

    # -- rank-sum combined selector
    s = sub[np.isfinite(sub.tr24.values) & np.isfinite(sub.rvol.values)].reset_index(drop=True)
    idx = []
    for d, g in s.groupby("date"):
        if len(g) < C.N_ELIG_MIN:
            continue
        ra = g.rvol.rank(ascending=False)
        rb = np.abs(g.tr24).rank(ascending=False)
        idx += list(g.index[(ra + rb).values.argsort()[:C.K_SELECT]])
    rows.append({**stats(s, np.array(idx, int),
                         "rank-sum combined selector (fit-only sensitivity)"),
                 "arm": "comparison"})

    # -- re-walked leg tables
    for tag, (label, kw) in SENS_LEGS.items():
        p = os.path.join(C.RESULTS, f"legs_{tag}.parquet")
        if not os.path.exists(p):
            rows.append(dict(row=f"[not built] {label}", n_legs=0, arm="sens", tag=tag))
            continue
        lg = pd.read_parquet(p)
        sm = kw.get("stop", C.STOP_GATE)
        for arm, selector in ARMS.items():
            sb = lg[lg.period == period].reset_index(drop=True)
            if selector == "TR24":
                sb = sb[np.isfinite(sb.tr24.values)].reset_index(drop=True)
            if not len(sb):
                continue
            P = Panel(sb, selector)
            i, _ = P.top()
            rows.append({**stats(P.legs, i, f"{arm} — {label} (fit-only)", sm),
                         "arm": arm, "tag": tag})
    return rows


# ==========================================================================
# commands
# ==========================================================================
def _write(name: str, obj) -> None:
    p = os.path.join(C.RESULTS, name)
    with open(p, "w") as fh:
        json.dump(obj, fh, indent=1, default=lambda x: None if isinstance(x, Panel) else str(x))
    print(f"wrote results/{name}")


def _show(d: dict) -> None:
    pr = d["primary"]
    print(f"\n=== {d['arm']}  [{d['period']}]  stop {d['stop']} x dATR14 ===")
    print(f"  N_elig median {d['n_elig_median']:.0f}   tradable days {d['n_tradable_days']}")
    for k in ("primary", "bottom5", "middle5"):
        r = d[k]
        if not r.get("n_legs"):
            continue
        print(f"  {r['row']:<52} n={r['n_legs']:>6} days={r['n_days']:>5} "
              f"mean netR={r['mean_netR']:+.4f}  (dATR {r['mean_dATR']:+.4f})  "
              f"gross={r['mean_grossR']:+.4f} cost={r['mean_costR']:.4f} "
              f"hit={r['hit']:.3f} 90%[{r['boot_lo']:+.4f},{r['boot_hi']:+.4f}]")
    if "random5" in d:
        r = d["random5"]
        print(f"  Null A random-5 ({r['n_draws']} draws): mean {r['mean']:+.4f} "
              f"sd {r['sd']:.4f} q95 {r['q95']:+.4f}   ->  p = {r['p']:.4f}")
        print(f"  Null B day-shift: mean {d['dayshift']['mean']:+.4f}  p = {d['dayshift']['p']:.4f}")
        t = d["delta_tb"]
        print(f"  Delta_tb (top-5 - bottom-5) = {t['point']:+.4f}  "
              f"90%[{t['lo']:+.4f},{t['hi']:+.4f}]  excludes 0: {t['excludes_zero']}")
    if "funding_row" in d:
        r = d["funding_row"]
        print(f"  VETO funding applied:   mean netR {r['mean_netR']:+.4f}  "
              f"(funding {r['mean_funding_R']:+.4f}R, missing rate share "
              f"{r['share_missing_rate']:.4f})")
    r = d["delist_row"]
    print(f"  VETO delisted-30d excluded: mean netR {r.get('mean_netR', float('nan')):+.4f} "
          f"n={r['n_legs']} (removed {r['n_removed']}, {100*r['share_removed']:.2f} %)")
    b = d["btc_eth"]
    print(f"  BTC/ETH share of legs {b['share_legs']:.4f}, of net R "
          f"{b['share_of_total_netR']:+.4f}")
    print("  deciles (9 = top):", "  ".join(
        f"{k}:{v['mean_netR']:+.4f}" for k, v in sorted(d["deciles"].items())))


def cmd_fit() -> None:
    legs = _load("base")
    out = {}
    for arm, selector in ARMS.items():
        d = block(legs, selector, arm, "fit")
        d.pop("_sel_idx", None); d.pop("_panel_days", None)
        out[arm] = d
        _show(d)
    out["compare_AB_fit"] = compare_AB(legs, "fit")
    print("\n--- A vs B, fit (descriptive) ---")
    print(json.dumps(out["compare_AB_fit"], indent=1, default=str))
    _write("fit.json", out)
    print("\n=== FIT SCREEN (mean net R >= +0.05R and random-5 p <= 0.05) ===")
    for arm in ARMS:
        m = out[arm]["primary"]["mean_netR"]
        p = out[arm].get("random5", {}).get("p", 1.0)
        ok = (m >= C.SCREEN_MEAN) and (p <= C.SCREEN_P)
        print(f"  {arm}: mean net R {m:+.4f}, random-5 p {p:.4f}  ->  "
              f"{'SCREENED IN' if ok else 'SCREENED OUT — NO EDGE — KILL (fit screen)'}")


def cmd_sens() -> None:
    rows = sens_rows("fit")
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(C.RESULTS, "sensitivities_fit.csv"), index=False)
    cols = [c for c in ("row", "n_legs", "n_days", "mean_netR", "mean_dATR",
                        "mean_grossR", "hit", "boot_lo", "boot_hi") if c in df.columns]
    with pd.option_context("display.width", 200, "display.max_rows", 200,
                           "display.max_colwidth", 60):
        print(df[cols].to_string(index=False))


def cmd_holdout() -> None:
    if not _design_has_screen():
        raise SystemExit("§10.1 GATE: DESIGN.md does not carry a committed "
                         "'FIT SCREEN DECISION — COMMITTED' section (or it has "
                         "uncommitted edits). The holdout is not computed.")
    scr = json.load(open(os.path.join(C.RESULTS, "screen.json")))
    legs = _load("base")
    fit = json.load(open(os.path.join(C.RESULTS, "fit.json")))
    out = {}
    for arm, selector in ARMS.items():
        if not scr[arm]["screened_in"]:
            out[arm] = dict(verdict="NO EDGE — KILL (fit screen)", period="holdout",
                            holdout_read=False)
            print(f"\n=== {arm}: screened out — holdout column stays blank ===")
            continue
        d = block(legs, selector, arm, "holdout")
        d.pop("_sel_idx", None); d.pop("_panel_days", None)
        _show(d)
        pr = d["primary"]
        d["verdict"] = ladder(
            pr["mean_netR"], d["random5"]["p"], pr["n_legs"], pr["n_days"],
            fit[arm]["primary"]["mean_netR"], pr["boot_lo"], pr["boot_hi"],
            pr["mean_grossR"], d["delta_tb"]["lo"], d["delta_tb"]["hi"],
            d.get("funding_row", {}).get("mean_netR"),
            d["delist_row"].get("mean_netR"))
        d["holdout_read"] = True
        print(f"  VERDICT: {d['verdict']}")
        out[arm] = d
    if any(v.get("holdout_read") for v in out.values()):
        out["compare_AB_holdout"] = compare_AB(legs, "holdout")
        print("\n--- A vs B, holdout (descriptive) ---")
        print(json.dumps(out["compare_AB_holdout"], indent=1, default=str))
    _write("holdout.json", out)


def cmd_screen() -> None:
    fit = json.load(open(os.path.join(C.RESULTS, "fit.json")))
    out = {}
    for arm in ARMS:
        m = fit[arm]["primary"]["mean_netR"]
        p = fit[arm].get("random5", {}).get("p", 1.0)
        out[arm] = dict(fit_mean_netR=m, fit_random5_p=p,
                        screened_in=bool(m >= C.SCREEN_MEAN and p <= C.SCREEN_P))
    _write("screen.json", out)
    print(json.dumps(out, indent=1))


def cmd_forward() -> None:
    if pd.Timestamp.utcnow().tz_localize(None) < pd.Timestamp("2026-11-01"):
        raise SystemExit("§7.3 GATE: the forward window 2026-08-01 .. 2026-10-31 "
                         "is not read before 2026-11-01. Nothing computed.")
    raise SystemExit("§7.3: run only for an arm that reached REAL EDGE, from the "
                     "frozen script at the holdout commit.")


if __name__ == "__main__":
    {"fit": cmd_fit, "screen": cmd_screen, "holdout": cmd_holdout,
     "sens": cmd_sens, "forward": cmd_forward}[sys.argv[1]]()
