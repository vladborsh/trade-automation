#!/usr/bin/env python3
"""TEST C — Liu-Tsyvinski-Wu (JF 2022) cross-sectional crypto momentum as the
portfolio harness's Stage 0.

`DESIGN.md` Test C. Rank a survivorship-free USDT-perp universe on trailing
k-week return, long the top quintile / short the bottom, hold one week, GROSS
of costs, 2020-01-01 .. 2025-07-31 (the cross-sectional package's FIT window).

This module is deliberately standalone — it imports no package constant — so
it can be lifted into `research/crosssec-instruments-in-play/` as that
package's Stage 0.

Data: a snapshot of that package's `data/1d/*.parquet` + `results/listing.json`
(nothing is re-pulled; see `results/testC_snapshot.txt`).

    python testc.py
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA1D = os.path.join(HERE, "data", "1d")
RESULTS = os.path.join(HERE, "results")

FIT_START, FIT_END = "2020-01-01", "2025-07-31"
KS = (1, 2, 3, 4)                 # trailing weeks, the paper's horizons
HOLD_D = 7                        # weekly hold
MIN_UNIVERSE = 50                 # the mandate's >=50-perp condition
QUINTILE = 5
DAY_MS = 86_400_000


def load_panel() -> pd.DataFrame:
    """Wide daily close panel, UTC midnight index, one column per symbol."""
    cols = {}
    for fn in sorted(os.listdir(DATA1D)):
        if not fn.endswith(".parquet"):
            continue
        s = fn[:-8]
        d = pd.read_parquet(os.path.join(DATA1D, fn), columns=["t_ms", "close"])
        d = d.drop_duplicates("t_ms").sort_values("t_ms")
        cols[s] = pd.Series(d.close.values, index=d.t_ms.values.astype(np.int64))
    px = pd.DataFrame(cols).sort_index()
    px = px[(px.index >= int(pd.Timestamp(FIT_START, tz="UTC").value // 10**6))
            & (px.index <= int(pd.Timestamp(FIT_END, tz="UTC").value // 10**6))]
    return px.where(px > 0)


def nw_t(x: np.ndarray, lag: int = 4) -> float:
    """Newey-West t on the mean of `x`."""
    x = np.asarray(x, float)
    n = len(x)
    e = x - x.mean()
    g0 = float(e @ e) / n
    s = g0
    for L in range(1, lag + 1):
        gl = float(e[L:] @ e[:-L]) / n
        s += 2.0 * (1.0 - L / (lag + 1.0)) * gl
    return float(x.mean() / np.sqrt(max(s, 1e-300) / n))


def main() -> None:
    px = load_panel()
    idx = px.index.values
    print(f"panel: {px.shape[1]} symbols, {px.shape[0]} days, "
          f"{pd.Timestamp(idx[0], unit='ms').date()} .. "
          f"{pd.Timestamp(idx[-1], unit='ms').date()}", flush=True)

    # weekly rebalance dates: Mondays 00:00 UTC present in the panel
    days = pd.to_datetime(idx, unit="ms", utc=True)
    mondays = idx[days.dayofweek == 0]
    pos = {int(t): i for i, t in enumerate(idx)}

    rows, weekly, legs = [], [], []
    for k in KS:
        lb = k * 7 * DAY_MS
        used, dropped_small, carried_tot, ls, lo, sh, nlegs = 0, 0, 0, [], [], [], []
        for T in mondays:
            T = int(T)
            t_lb, t_fw = T - lb, T + HOLD_D * DAY_MS
            if t_lb not in pos or t_fw > idx[-1]:
                continue
            a, b = pos[t_lb], pos[T]
            seg = px.iloc[a:b + 1]
            # no missing day in the lookback, positive close at both ends
            ok = seg.notna().all(axis=0).values
            c0 = px.iloc[a].values
            c1 = px.iloc[b].values
            ok &= np.isfinite(c0) & np.isfinite(c1) & (c0 > 0) & (c1 > 0)
            syms = px.columns.values[ok]
            if len(syms) < MIN_UNIVERSE:
                dropped_small += 1
                continue
            sig = c1[ok] / c0[ok] - 1.0

            # forward return; a symbol that delists inside the week is carried
            # at its last available close (DESIGN C.2), and counted.
            fw_slice = px.loc[T:t_fw, syms]
            entry = c1[ok]
            exit_px = np.empty(len(syms))
            carried = 0
            for i, s in enumerate(syms):
                col = fw_slice[s].values
                if np.isfinite(col[-1]) and fw_slice.index[-1] == t_fw:
                    exit_px[i] = col[-1]
                else:
                    fin = col[np.isfinite(col)]
                    exit_px[i] = fin[-1] if len(fin) else entry[i]
                    carried += 1
            fwd = exit_px / entry - 1.0
            carried_tot += carried

            n_leg = len(syms) // QUINTILE
            order = np.argsort(sig)                      # ascending
            bot, top = order[:n_leg], order[-n_leg:]
            r_l, r_s = float(fwd[top].mean()), float(fwd[bot].mean())
            ls.append(r_l - r_s); lo.append(r_l); sh.append(r_s)
            nlegs.append(n_leg)
            used += 1
            weekly.append(dict(k=k, date=str(pd.Timestamp(T, unit="ms").date()),
                               n_universe=len(syms), n_leg=n_leg,
                               long_pct=100 * r_l, short_pct=100 * r_s,
                               ls_pct=100 * (r_l - r_s), n_carried=carried))
        ls = np.asarray(ls)
        m, sd = float(ls.mean()), float(ls.std(ddof=1))
        t = m / (sd / np.sqrt(len(ls)))
        rows.append(dict(
            k_weeks=k, n_dates=len(ls), n_dates_dropped_small=dropped_small,
            mean_leg_size=float(np.mean(nlegs)), min_leg_size=int(np.min(nlegs)),
            mean_ls_weekly_pct=100 * m, sd_weekly_pct=100 * sd,
            t_plain=t, t_nw4=nw_t(ls, 4),
            mean_long_pct=100 * float(np.mean(lo)),
            mean_short_pct=100 * float(np.mean(sh)),
            ann_sharpe=float(m / sd * np.sqrt(52)),
            hit_rate_pct=float(100 * (ls > 0).mean()),
            n_carried_total=carried_tot,
            C3_legs_ok=bool(np.mean(np.asarray(nlegs) >= 10) >= 0.90)))
        print(f"  k={k}w: n={len(ls)} mean_LS={100*m:+.4f}%/wk t={t:+.2f} "
              f"(NW4 {nw_t(ls,4):+.2f}) leg={np.mean(nlegs):.0f} "
              f"annSharpe={m/sd*np.sqrt(52):+.2f}", flush=True)

    R = pd.DataFrame(rows)
    R["C4_dates_ok"] = R.n_dates >= 0.90 * R.n_dates.iloc[0]
    R["C1_pass"] = (R.mean_ls_weekly_pct > 0) & (R.t_plain >= 2.0)
    R.to_csv(os.path.join(RESULTS, "testC_xsmom.csv"), index=False)
    pd.DataFrame(weekly).to_csv(os.path.join(RESULTS, "testC_weekly.csv"), index=False)
    pd.set_option("display.width", 220)
    print()
    print(R.to_string(index=False))
    print(f"\nC1 (positive AND t>=2 on at least one k): "
          f"{'PASS' if R.C1_pass.any() else 'FAIL'}  "
          f"[{int(R.C1_pass.sum())}/{len(R)} horizons]")


if __name__ == "__main__":
    main()
