#!/usr/bin/env python3
"""THREAD 1 -- does an hour-of-day / day-of-week entry filter rescue anything?

Protocol (fixed before any holdout number was looked at):

  fit     2022-08-01 .. 2025-04-01   (32 months)
  holdout 2025-04-01 .. 2026-08-01   (16 months)

For each candidate x interval we run the engine over the FIT period only, pool
the resulting trades across BTC/ETH/SOL (pooling so no single symbol's lucky
hour can carry a filter), and rank UTC hours / weekdays by mean R. Six
pre-registered allow-list rules are then derived from the fit ranking. Each is
re-run through the engine on the HOLDOUT period, fresh equity, same 1%/2% risk
rules.

Multiple-comparisons control: every filter tried is counted and reported, and
the selected filter's holdout profit factor is placed inside a permutation null
of N random allow-lists of identical size, evaluated on the same holdout. If
the chosen filter is not out in the tail of that null, the "improvement" is
selectivity, not timing.
"""
from __future__ import annotations
import argparse, os
import numpy as np
import pandas as pd

import common as C

FIT = ("2022-08-01", "2025-04-01")
HOLD = ("2025-04-01", "2026-08-01")
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
RNG = np.random.default_rng(20260826)
_CACHE = {}


def prepared(sym, iv, cand):
    key = (sym, iv, cand)
    if key not in _CACHE:
        d = C.load(sym, iv)
        sig, p = C.signals(d, cand)
        _CACHE[key] = (d, sig, p)
    return _CACHE[key]


def run_window(sym, iv, cand, window, hours=None, days=None):
    """Signals prepared on the full series (causal); engine run on the window
    only, so equity and the daily circuit-breaker start fresh there."""
    d, sig, p = prepared(sym, iv, cand)
    if hours is not None or days is not None:
        sig = C.mask_signals(sig, d, hours, days)
    m = (d.ts >= pd.Timestamp(window[0], tz="UTC")) & (d.ts < pd.Timestamp(window[1], tz="UTC"))
    bars = d.loc[m].reset_index(drop=True)
    s = sig.loc[m].reset_index(drop=True)
    return C.run(bars, s, p)


def pooled(sym_results):
    parts = [r["trades"] for r in sym_results if len(r["trades"])]
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def portfolio_stats(sym_results, iv):
    """Each symbol trades its own independent account (as in v1): trade stats
    pooled, risk stats averaged across the three accounts."""
    out = C.summarise(pooled(sym_results))
    live = [C.stats(r, iv) for r in sym_results if len(r["trades"])]
    for k in ("sharpe", "sortino", "max_dd"):
        vals = [m.get(k, np.nan) for m in live]
        out[k] = float(np.nanmean(vals)) if vals else np.nan
    return out


def fit_profile(cand, iv):
    res = [run_window(s, iv, cand, FIT) for s in SYMBOLS]
    tr = pooled(res)
    if not len(tr):
        return None, None, None
    tr = tr.copy()
    tr["hour"] = pd.to_datetime(tr.entry_ts, utc=True).dt.hour
    tr["dow"] = pd.to_datetime(tr.entry_ts, utc=True).dt.dayofweek
    agg = dict(n=("r", "size"), meanR=("r", "mean"), win=("pnl", lambda x: (x > 0).mean()))
    return (tr.groupby("hour").agg(**agg), tr.groupby("dow").agg(**agg),
            portfolio_stats(res, iv))


def derive_filters(hprof, dprof):
    """Pre-registered allow-list rules, all read off the FIT ranking only."""
    h_rank = hprof.sort_values("meanR", ascending=False)
    h_pos = sorted(hprof.index[hprof.meanR > 0].tolist())
    d_pos = sorted(dprof.index[dprof.meanR > 0].tolist())
    f = {
        "H_pos": (h_pos, None),
        "H_top12": (sorted(h_rank.index[:12].tolist()), None),
        "H_top6": (sorted(h_rank.index[:6].tolist()), None),
        "D_pos": (None, d_pos),
        "D_weekday": (None, [0, 1, 2, 3, 4]),
        "H_pos_x_D_pos": (h_pos, d_pos),
    }
    return {k: v for k, v in f.items()
            if not (v[0] is not None and len(v[0]) == 0)
            and not (v[1] is not None and len(v[1]) == 0)}


def permutation_null(cand, iv, k, n_perm):
    pfs = []
    for _ in range(n_perm):
        hrs = sorted(int(x) for x in RNG.choice(24, size=k, replace=False))
        st = portfolio_stats([run_window(s, iv, cand, HOLD, hours=hrs) for s in SYMBOLS], iv)
        if st["trades"] >= 20 and np.isfinite(st["profit_factor"]):
            pfs.append(st["profit_factor"])
    return np.array(pfs, dtype=float)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default="mean_reversion,smc,hybrid,momentum,momentum_breakout")
    ap.add_argument("--intervals", default="1h,15m")
    ap.add_argument("--perm", type=int, default=200)
    a = ap.parse_args()

    rows, prof_rows, perm_rows = [], [], []
    n_filters_tried = 0
    for cand in a.candidates.split(","):
        for iv in a.intervals.split(","):
            hprof, dprof, fit_base = fit_profile(cand, iv)
            if hprof is None:
                print(f"skip {cand} {iv}: no fit trades"); continue
            for kind, prof in (("hour", hprof), ("dow", dprof)):
                for b, r in prof.iterrows():
                    prof_rows.append(dict(candidate=cand, interval=iv, kind=kind,
                                          bucket=int(b), n=int(r.n), meanR=r.meanR, win=r.win))

            base_hold = portfolio_stats([run_window(s, iv, cand, HOLD) for s in SYMBOLS], iv)
            rows.append(dict(candidate=cand, interval=iv, filter="NONE", period="fit",
                             n_hours=24, n_days=7, **fit_base))
            rows.append(dict(candidate=cand, interval=iv, filter="NONE", period="holdout",
                             n_hours=24, n_days=7, **base_hold))
            print(f"{cand:>18} {iv:>3} {'NONE':<15} fit pf={fit_base['profit_factor']:.2f} "
                  f"n={fit_base['trades']:<5} | hold pf={base_hold['profit_factor']:.2f} "
                  f"n={base_hold['trades']}", flush=True)

            for name, (hrs, dys) in derive_filters(hprof, dprof).items():
                n_filters_tried += 1
                fit_st = portfolio_stats(
                    [run_window(s, iv, cand, FIT, hours=hrs, days=dys) for s in SYMBOLS], iv)
                hold_st = portfolio_stats(
                    [run_window(s, iv, cand, HOLD, hours=hrs, days=dys) for s in SYMBOLS], iv)
                meta = dict(candidate=cand, interval=iv, filter=name,
                            n_hours=len(hrs) if hrs else 24, n_days=len(dys) if dys else 7)
                rows.append(dict(period="fit", **meta, **fit_st))
                rows.append(dict(period="holdout", **meta, **hold_st))
                wr = hold_st["win_rate"] if hold_st["trades"] else float("nan")
                print(f"{cand:>18} {iv:>3} {name:<15} fit pf={fit_st['profit_factor']:.2f} "
                      f"n={fit_st['trades']:<5} | hold pf={hold_st['profit_factor']:.2f} "
                      f"wr={wr:.1%} n={hold_st['trades']}", flush=True)

            if a.perm:
                sel_rows = [r for r in rows if r["candidate"] == cand and r["interval"] == iv
                            and r["filter"] == "H_pos" and r["period"] == "holdout"]
                if sel_rows:
                    k = sel_rows[0]["n_hours"]
                    sel = sel_rows[0]["profit_factor"]
                    null = permutation_null(cand, iv, k, a.perm)
                    pct = float((null < sel).mean()) if len(null) else np.nan
                    perm_rows.append(dict(candidate=cand, interval=iv, k_hours=k, n_perm=len(null),
                                          selected_holdout_pf=sel,
                                          null_median=float(np.median(null)) if len(null) else np.nan,
                                          null_p90=float(np.percentile(null, 90)) if len(null) else np.nan,
                                          percentile_of_selected=pct))
                    print(f"   -> perm null k={k}: selected pf {sel:.2f} at percentile {pct:.0%} "
                          f"(null median {np.median(null):.2f})", flush=True)

    pd.DataFrame(rows).to_csv(os.path.join(C.OUT, "tod_dow.csv"), index=False)
    pd.DataFrame(prof_rows).to_csv(os.path.join(C.OUT, "tod_profile.csv"), index=False)
    pd.DataFrame(perm_rows).to_csv(os.path.join(C.OUT, "tod_permutation.csv"), index=False)
    print(f"\nfilters evaluated on holdout: {n_filters_tried} "
          f"(+ {a.perm} random allow-lists per candidate x interval as the null)")


if __name__ == "__main__":
    main()
