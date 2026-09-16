#!/usr/bin/env python3
"""STAGE 0 — data audit (ARCHITECT-NOTE §3.1-§3.3, §9 point 1).

NO R IS COMPUTED HERE.  Nothing in this file touches a return, a trade or a
percentile.  It answers exactly three questions:

  1. is the funding interval 8h on every symbol, every row?           (§3.3 r2)
  2. does any symbol exceed the 5 % missing-slot rule in the fit
     window?                                                          (§3.3 r6)
  3. is every month's row count explained by listing date + logged
     gaps?                                                            (§9 p1)

Outputs:
  results/data_audit.csv          per symbol: coverage, gaps, duplicates
  results/data_audit_months.csv   per symbol-month: expected vs present rows
  results/data_audit_gaps.csv     every missing settlement slot, listed
  results/data_audit_klines.csv   per symbol: 1h bar coverage and gaps
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, OUT, FIT_END, HOLD_START, HOLD_END, TAIL_END,
                    load_funding, load_klines, settlement_grid, WARMUP_DAYS)

rows, mrows, grows, krows = [], [], [], []

for sym in SYMBOLS:
    f = load_funding(sym)
    k = load_klines(sym)

    # ---- interval column (§3.3 rule 2) ------------------------------------
    iv = f["funding_interval_hours"]
    iv_counts = iv.value_counts().to_dict()
    iv_mode = int(iv.mode().iloc[0])
    share_non8 = float((iv != 8).mean())

    # ---- settlement grid and gaps (§3.3 rule 1) --------------------------
    first, last = f["ts"].iloc[0], f["ts"].iloc[-1]
    grid = settlement_grid(first, last, iv_mode)
    have = pd.DatetimeIndex(f["ts"])
    off_grid = have.difference(grid)
    missing = grid.difference(have)

    warm_end = first + pd.Timedelta(days=WARMUP_DAYS)
    fit_mask = (grid >= warm_end) & (grid < FIT_END)
    hold_mask = (grid >= HOLD_START) & (grid < HOLD_END)
    mfit = missing[(missing >= warm_end) & (missing < FIT_END)]
    mhold = missing[(missing >= HOLD_START) & (missing < HOLD_END)]

    for t in missing:
        win = ("warmup" if t < warm_end else
               "fit" if t < FIT_END else
               "holdout" if t < HOLD_END else "tail")
        grows.append(dict(symbol=sym, slot=t, window=win))

    # ---- klines -----------------------------------------------------------
    kgrid = pd.date_range(k["ts"].iloc[0], k["ts"].iloc[-1], freq="1h", tz="UTC")
    kmiss = kgrid.difference(pd.DatetimeIndex(k["ts"]))
    krows.append(dict(
        symbol=sym, first_bar=k["ts"].iloc[0], last_bar=k["ts"].iloc[-1],
        bars_expected=len(kgrid), bars_present=len(k), bars_missing=len(kmiss),
        pct_missing=round(100 * len(kmiss) / len(kgrid), 4),
        funding_before_first_bar=int((f["ts"] < k["ts"].iloc[0]).sum()),
    ))

    rows.append(dict(
        symbol=sym,
        first_settlement=first, last_settlement=last,
        n_rows_raw=len(f) + f.attrs["n_dup_rows"] // 2 if False else len(f),
        n_duplicate_rows=f.attrs["n_dup_rows"],
        slots_expected=len(grid), slots_present=len(have),
        slots_missing=len(missing), off_grid_rows=len(off_grid),
        interval_mode=iv_mode, interval_values=str(iv_counts),
        share_interval_ne_8=round(share_non8, 6),
        warmup_end=warm_end,
        fit_slots=int(fit_mask.sum()), fit_missing=len(mfit),
        fit_missing_pct=round(100 * len(mfit) / max(fit_mask.sum(), 1), 4),
        hold_slots=int(hold_mask.sum()), hold_missing=len(mhold),
        hold_missing_pct=round(100 * len(mhold) / max(hold_mask.sum(), 1), 4),
        rate_min=float(f["last_funding_rate"].min()),
        rate_max=float(f["last_funding_rate"].max()),
        rate_nan=int(f["last_funding_rate"].isna().sum()),
    ))

    # ---- per month explanation (§9 point 1) -------------------------------
    gm = pd.Series(1, index=grid).resample("MS").size()
    hm = pd.Series(1, index=have).resample("MS").size()
    km_exp = pd.Series(1, index=kgrid).resample("MS").size()
    km = pd.Series(1, index=pd.DatetimeIndex(k["ts"])).resample("MS").size()
    for m in gm.index:
        exp, pres = int(gm.loc[m]), int(hm.get(m, 0))
        days = pd.Period(m, freq="M").days_in_month
        first_m = (m.to_period("M") == first.to_period("M"))
        last_m = (m.to_period("M") == last.to_period("M"))
        full = days * (24 // iv_mode)
        mrows.append(dict(
            symbol=sym, month=m.strftime("%Y-%m"),
            funding_expected_on_grid=exp, funding_present=pres,
            funding_missing=exp - pres,
            full_month_slots=full,
            partial_reason=("listing month" if first_m else
                            "last archived month" if last_m else ""),
            explained=bool(exp - pres == 0 and (exp == full or first_m or last_m)),
            kline_expected=int(km_exp.get(m, 0)), kline_present=int(km.get(m, 0)),
        ))

pd.DataFrame(rows).to_csv(os.path.join(OUT, "data_audit.csv"), index=False)
pd.DataFrame(mrows).to_csv(os.path.join(OUT, "data_audit_months.csv"), index=False)
pd.DataFrame(grows).to_csv(os.path.join(OUT, "data_audit_gaps.csv"), index=False)
pd.DataFrame(krows).to_csv(os.path.join(OUT, "data_audit_klines.csv"), index=False)

a = pd.DataFrame(rows)
pd.set_option("display.width", 200, "display.max_columns", 50)
print("=== funding coverage ===")
print(a[["symbol", "first_settlement", "last_settlement", "slots_expected",
         "slots_present", "slots_missing", "off_grid_rows", "n_duplicate_rows",
         "interval_mode", "share_interval_ne_8", "fit_missing_pct",
         "hold_missing_pct", "rate_nan"]].to_string(index=False))
print("\n=== kline coverage ===")
print(pd.DataFrame(krows).to_string(index=False))
print("\n=== STOP-RULE CHECKS (§9 point 1) ===")
bad_iv = a[a.share_interval_ne_8 > 0.01]
print(f"interval != 8h on >=1% of rows : {len(bad_iv)} symbols "
      f"{list(bad_iv.symbol)}")
bad_miss = a[a.fit_missing_pct > 5.0]
print(f"fit missing > 5%               : {len(bad_miss)} symbols "
      f"{list(bad_miss.symbol)}")
mm = pd.DataFrame(mrows)
unexp = mm[~mm.explained]
print(f"months not explained by listing+gaps : {len(unexp)} of {len(mm)}")
if len(unexp):
    print(unexp.to_string(index=False))
km = pd.DataFrame(krows)
print(f"symbols with kline gaps        : {list(km[km.bars_missing>0].symbol)}")
print(f"funding rows before first bar  : "
      f"{dict(zip(km.symbol, km.funding_before_first_bar))}")
