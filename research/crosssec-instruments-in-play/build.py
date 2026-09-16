#!/usr/bin/env python3
"""Driver: the panel (§8.2.2) and the leg outcome of every eligible
instrument-day (§8.2.4).

    python build.py panel  [--tag ny0930|w5|utc0|utc4|weekend]
    python build.py legs   [--panel TAG] [--stop 0.5] [--horizon 240]
                           [--window 30] [--rt 0.001] [--side reader|tr24]
                           [--tag NAME] [--period all|fit]

The default `legs` call writes `results/instrument_days.parquet`: the
direction-reader outcome AND the decision-time observables for EVERY eligible
instrument-day, not only the selected ones — the addendum requested by
`research/_surveys/2026-09-lightgbm-role.md`. It is a by-product of §8.2.5's
"evaluate the whole eligible panel once, select afterwards", so it costs
nothing. Every fit-only sensitivity that needs a different stop, horizon,
window or side re-walks into its own `results/legs_<tag>.parquet`.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import features as FT  # noqa: E402
import engine as E  # noqa: E402

# tag -> (anchor hh:mm, tz, window_min, day set)
VARIANTS = {
    "ny0930":  (C.ANCHOR_NY, "ny", 30, "nyse"),
    "w5":      (C.ANCHOR_NY, "ny", 5, "nyse"),      # fit-only 5-minute reader/RVOL
    "utc0":    ((0, 0), "utc", 30, "all"),          # fit-only placebo anchor
    "utc4":    ((4, 0), "utc", 30, "all"),          # fit-only placebo anchor
    # The weekend row (§4.3) takes its RVOL denominator over the prior 14
    # CALENDAR days' same window, so the panel is built over every calendar
    # day with the NY anchor and the weekend rows are filtered out afterwards.
    "nyall": (C.ANCHOR_NY, "ny", 30, "all"),        # descriptive control
}


def panel_path(tag: str) -> str:
    return os.path.join(C.RESULTS, f"panel_{tag}.parquet" if tag != "ny0930"
                        else "panel.parquet")


def legs_path(tag: str) -> str:
    return os.path.join(C.RESULTS, "instrument_days.parquet" if tag == "base"
                        else f"legs_{tag}.parquet")


def _uni():
    return pd.read_csv(os.path.join(C.RESULTS, "universe.csv")).set_index("symbol")


def build_panel(a) -> None:
    hhmm, tz, win, dayset = VARIANTS[a.tag]
    end = C.HOLD_END if a.tag in ("ny0930", "nyall") else C.FIT_END
    if dayset == "nyse":
        dates = C.nyse_days(C.FIT_START, end)
    elif dayset == "weekend":
        dates = C.weekend_days(C.FIT_START, end)
    else:
        dates = list(pd.date_range(C.FIT_START, end, freq="D").strftime("%Y-%m-%d"))
    uni = _uni()
    flags = pd.read_parquet(os.path.join(C.RESULTS, "daily_flags.parquet"))
    need = json.load(open(os.path.join(C.RESULTS, "eligible_months.json")))
    syms = sorted(s for s in need if os.path.exists(os.path.join(C.DATA_1M, f"{s}.parquet")))
    print(f"panel[{a.tag}]: {len(syms)} symbols x {len(dates)} anchor days "
          f"(anchor {hhmm} {tz}, window {win}m)", flush=True)
    t0, parts = time.time(), []
    fg = dict(tuple(flags.groupby("symbol")))
    for i, s in enumerate(syms):
        try:
            p = FT.symbol_panel(s, dates, dict(last_bar_ms=int(uni.loc[s, "last_bar_ms"])),
                                anchor_hh_mm=hhmm, anchor_tz=tz, window_min=win,
                                daily=fg.get(s))
        except Exception as ex:  # noqa: BLE001
            print(f"  ERROR {s}: {ex}", flush=True)
            continue
        if p is not None and len(p):
            parts.append(p)
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(syms)}  {time.time()-t0:.0f}s", flush=True)
    pan = pd.concat(parts, ignore_index=True)
    pan.to_parquet(panel_path(a.tag), index=False, compression="zstd")
    print(f"{os.path.basename(panel_path(a.tag))}: {len(pan):,} rows, "
          f"{pan.elig_A.sum():,} eligible-A, {pan.elig_B.sum():,} eligible-B "
          f"({time.time()-t0:.0f}s)")

    g = pan[pan.elig_A].groupby("date").size().rename("n_elig_A")
    gb = pan[pan.elig_B].groupby("date").size().rename("n_elig_B")
    n = pd.concat([g, gb], axis=1).reindex(dates).fillna(0).astype(int)
    n.index.name = "date"
    n["tradable"] = n.n_elig_A >= C.N_ELIG_MIN
    suffix = "" if a.tag == "ny0930" else f"_{a.tag}"
    n.to_csv(os.path.join(C.RESULTS, f"n_elig{suffix}.csv"))
    tr = n[n.tradable]
    print(f"first tradable day (N_elig >= {C.N_ELIG_MIN}): {tr.index.min()}   "
          f"tradable days: {len(tr)}/{len(n)}")
    print(tr.groupby(tr.index.str[:4]).n_elig_A.agg(["count", "min", "median", "max"]))


def build_legs(a) -> None:
    pan = pd.read_parquet(panel_path(a.panel))
    suffix = "" if a.panel == "ny0930" else f"_{a.panel}"
    n = pd.read_csv(os.path.join(C.RESULTS, f"n_elig{suffix}.csv"))
    tradable = set(n[n.tradable].date)
    if a.period == "fit":
        tradable &= set(d for d in tradable if C.FIT_START <= d <= C.FIT_END)
    base = pan.elig_A & pan.date.isin(tradable)
    if a.side == "tr24":
        base &= np.isfinite(pan.tr24.values) & (pan.tr24.values != 0)
    sub = pan[base & (pan.r30 != 0)].reset_index(drop=True)
    dropped_zero = int((base & (pan.r30 == 0)).sum())
    print(f"legs[{a.tag}]: {len(sub):,} eligible instrument-days on "
          f"{len(tradable):,} tradable days; dropped r30==0: {dropped_zero}", flush=True)
    t0, parts = time.time(), []
    syms = sorted(sub.symbol.unique())
    gs = dict(tuple(sub.groupby("symbol")))
    for i, s in enumerate(syms):
        g = gs[s].reset_index(drop=True)
        so = np.sign(g.tr24.values) if a.side == "tr24" else None
        parts.append(E.legs_for_symbol(s, g, stop_mult=a.stop, rt=a.rt,
                                       window_min=a.window, horizon_min=a.horizon,
                                       side_override=so))
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(syms)}  {time.time()-t0:.0f}s", flush=True)
    legs = pd.concat(parts, ignore_index=True)
    # §5.3 — a path missing more than 30 minutes is excluded and counted
    bad = int((legs.path_missing > C.MAX_MISSING_PATH_MIN).sum())
    legs = legs[legs.path_missing <= C.MAX_MISSING_PATH_MIN].reset_index(drop=True)
    legs["period"] = C.period_of(legs.date.values)
    legs = legs.sort_values(["date", "symbol"]).reset_index(drop=True)
    legs.to_parquet(legs_path(a.tag), index=False, compression="zstd")
    with open(os.path.join(C.RESULTS, f"legs_audit_{a.tag}.json"), "w") as fh:
        json.dump(dict(tag=a.tag, panel=a.panel, stop=a.stop, horizon=a.horizon,
                       window=a.window, rt=a.rt, side=a.side,
                       n_instrument_days=len(legs),
                       n_tradable_days=int(legs.date.nunique()),
                       dropped_r30_zero=dropped_zero,
                       dropped_path_missing_gt_30=bad,
                       by_period={k: int(v) for k, v in legs.period.value_counts().items()},
                       exit_cause={E.EXIT_NAME[k]: int(v) for k, v in
                                   legs.exit_cause.value_counts().items()}), fh, indent=1)
    print(f"{os.path.basename(legs_path(a.tag))}: {len(legs):,} rows, "
          f"dropped path>30min: {bad}  ({time.time()-t0:.0f}s)")
    print(legs.groupby("period").netR.agg(["count", "mean"]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["panel", "legs"])
    ap.add_argument("--tag", default=None)
    ap.add_argument("--panel", default="ny0930")
    ap.add_argument("--stop", type=float, default=C.STOP_GATE)
    ap.add_argument("--horizon", type=int, default=C.HORIZON_MIN)
    ap.add_argument("--window", type=int, default=C.WINDOW_MIN)
    ap.add_argument("--rt", type=float, default=C.BINANCE_RT)
    ap.add_argument("--side", default="reader", choices=["reader", "tr24"])
    ap.add_argument("--period", default="all", choices=["all", "fit"])
    a = ap.parse_args()
    if a.cmd == "panel":
        a.tag = a.tag or "ny0930"
        build_panel(a)
    else:
        a.tag = a.tag or "base"
        build_legs(a)
