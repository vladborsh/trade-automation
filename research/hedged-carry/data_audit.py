#!/usr/bin/env python3
"""STAGE 0 — data audit (ARCHITECT-NOTE §3.1-§3.3, §9 point 1).

NO RETURN IS COMPUTED HERE.  Nothing in this file touches a P&L, a position or
a gate state.  It answers:

  1. does the funding + perp pull REPRODUCE the funding family's audit exactly?
     (§6.7.1 audit identity)
  2. is the SPOT series complete, per symbol and per month, on the same terms?
     (§3.1) -> results/data_audit_spot.csv, _spot_months.csv
  3. what does the basis distribution look like, and how many bars exceed
     |b| > 5 %?  (§3.2) -> results/basis_audit.csv
  4. do the spot and perp 1h grids coincide on every present hour?  (§3.1)
  5. per-symbol coverage start and fit start under §3.3 rule 5.

Stop-and-escalate conditions (§9 point 1) are evaluated and printed.
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, OUT, DATA, FIT_END, HOLD_START, HOLD_END,
                    TAIL_END, WARMUP_DAYS, BASIS_ANOM, load_funding,
                    load_klines, settlement_grid, blackout_mask)

REF = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "funding-rate-signals", "results")

rows, spot_rows, month_rows, basis_rows, start_rows, anom_rows = [], [], [], [], [], []

for sym in SYMBOLS:
    f = load_funding(sym)
    perp = load_klines(sym, "perp1h")
    spot = load_klines(sym, "spot1h")

    iv = f["funding_interval_hours"]
    iv_counts = iv.value_counts().to_dict()
    iv_mode = int(iv.mode().iloc[0])

    first, last = f["ts"].iloc[0], f["ts"].iloc[-1]
    grid = settlement_grid(first, last, iv_mode)
    have = pd.DatetimeIndex(f["ts"])
    missing = grid.difference(have)
    off_grid = have.difference(grid)

    rows.append(dict(
        symbol=sym, first_settlement=first, last_settlement=last,
        n_rows=len(f), n_duplicate_rows=f.attrs["n_dup_rows"],
        slots_expected=len(grid), slots_present=len(have),
        slots_missing=len(missing), off_grid_rows=len(off_grid),
        interval_mode=iv_mode, interval_values=str(iv_counts),
        share_interval_ne_8=round(float((iv != 8).mean()), 6),
        perp_first=perp.ts.iloc[0], perp_last=perp.ts.iloc[-1],
        perp_bars=len(perp),
        rate_min=float(f.last_funding_rate.min()),
        rate_max=float(f.last_funding_rate.max()),
    ))

    # ---- spot audit, same terms as the perp audit --------------------------
    sgrid = pd.date_range(spot.ts.iloc[0], spot.ts.iloc[-1], freq="1h", tz="UTC")
    smiss = sgrid.difference(pd.DatetimeIndex(spot.ts))
    # coverage start = max(first funding, first perp bar, first spot bar) §3.3 r5
    cov = max(first, perp.ts.iloc[0], spot.ts.iloc[0])
    fit_start = (cov + pd.Timedelta(days=WARMUP_DAYS)).normalize()
    # fit-window missing share on the spot leg (§3.3 rule 6)
    fw = (sgrid >= fit_start) & (sgrid < FIT_END)
    fmiss = smiss[(smiss >= fit_start) & (smiss < FIT_END)]
    hw = (sgrid >= HOLD_START) & (sgrid < HOLD_END)
    hmiss = smiss[(smiss >= HOLD_START) & (smiss < HOLD_END)]
    spot_rows.append(dict(
        symbol=sym, first_bar=spot.ts.iloc[0], last_bar=spot.ts.iloc[-1],
        bars_expected=len(sgrid), bars_present=len(spot),
        bars_missing=len(smiss),
        pct_missing=round(100 * len(smiss) / len(sgrid), 4),
        fit_bars=int(fw.sum()), fit_missing=len(fmiss),
        fit_missing_pct=round(100 * len(fmiss) / max(fw.sum(), 1), 4),
        hold_bars=int(hw.sum()), hold_missing=len(hmiss),
        hold_missing_pct=round(100 * len(hmiss) / max(hw.sum(), 1), 4),
        duplicates=int(pd.Series(spot.ts).duplicated().sum()),
        on_the_hour=bool((spot.ts.dt.minute == 0).all()
                         and (spot.ts.dt.second == 0).all()),
    ))
    start_rows.append(dict(symbol=sym, first_funding=first,
                           first_perp_bar=perp.ts.iloc[0],
                           first_spot_bar=spot.ts.iloc[0],
                           coverage_start=cov, fit_start=fit_start.date()))

    for t in smiss:
        anom_rows.append(dict(symbol=sym, kind="spot_bar_missing", ts=t))

    # ---- per-month spot explanation ---------------------------------------
    exp = pd.Series(1, index=sgrid).resample("MS").size()
    pres = pd.Series(1, index=pd.DatetimeIndex(spot.ts)).resample("MS").size()
    for m in exp.index:
        e, p = int(exp.loc[m]), int(pres.get(m, 0))
        first_m = (m.to_period("M") == spot.ts.iloc[0].to_period("M"))
        last_m = (m.to_period("M") == spot.ts.iloc[-1].to_period("M"))
        month_rows.append(dict(symbol=sym, month=m.strftime("%Y-%m"),
                               expected=e, present=p, missing=e - p,
                               partial_reason=("first archived month" if first_m
                                               else "last archived month" if last_m
                                               else ""),
                               explained=bool(e - p == 0)))

    # ---- basis (§3.2) ------------------------------------------------------
    j = perp[["ts", "close"]].rename(columns={"close": "P"}).merge(
        spot[["ts", "close"]].rename(columns={"close": "S"}), on="ts", how="inner")
    j["b"] = j.P / j.S - 1.0
    jf = j[(j.ts >= fit_start) & (j.ts < FIT_END)]
    over = j[j.b.abs() > BASIS_ANOM]
    for t, b in zip(over.ts, over.b):
        anom_rows.append(dict(symbol=sym, kind="basis_gt_5pct", ts=t, value=b))
    basis_rows.append(dict(
        symbol=sym, bars_both_legs=len(j),
        perp_only=int((~pd.DatetimeIndex(perp.ts).isin(pd.DatetimeIndex(spot.ts))).sum()),
        spot_only=int((~pd.DatetimeIndex(spot.ts).isin(pd.DatetimeIndex(perp.ts))
                       & (pd.DatetimeIndex(spot.ts) >= perp.ts.iloc[0])).sum()),
        mean=float(j.b.mean()), sd=float(j.b.std()),
        p1=float(j.b.quantile(0.01)), p99=float(j.b.quantile(0.99)),
        max_abs=float(j.b.abs().max()),
        n_abs_gt_5pct=int((j.b.abs() > BASIS_ANOM).sum()),
        pct_abs_gt_5pct=round(100 * float((j.b.abs() > BASIS_ANOM).mean()), 5),
        fit_mean=float(jf.b.mean()), fit_sd=float(jf.b.std()),
    ))

a = pd.DataFrame(rows)
sp = pd.DataFrame(spot_rows)
bs = pd.DataFrame(basis_rows)
st = pd.DataFrame(start_rows)
a.to_csv(os.path.join(OUT, "data_audit.csv"), index=False)
sp.to_csv(os.path.join(OUT, "data_audit_spot.csv"), index=False)
pd.DataFrame(month_rows).to_csv(os.path.join(OUT, "data_audit_spot_months.csv"), index=False)
bs.to_csv(os.path.join(OUT, "basis_audit.csv"), index=False)
st.to_csv(os.path.join(OUT, "fit_starts.csv"), index=False)
pd.DataFrame(anom_rows).to_csv(os.path.join(OUT, "data_audit_anomalies.csv"), index=False)

pd.set_option("display.width", 220, "display.max_columns", 60)
print("=== funding + perp coverage ===")
print(a[["symbol", "first_settlement", "last_settlement", "n_rows",
         "slots_missing", "off_grid_rows", "interval_mode",
         "share_interval_ne_8", "perp_bars"]].to_string(index=False))
print("\n=== spot coverage (NEW) ===")
print(sp.to_string(index=False))
print("\n=== coverage / fit starts (§3.3 rule 5) ===")
print(st.to_string(index=False))
print("\n=== basis (§3.2) ===")
print(bs.to_string(index=False))

# ---- §6.7.1 audit identity against the funding family --------------------
print("\n=== §6.7.1 AUDIT IDENTITY vs research/funding-rate-signals ===")
ref = pd.read_csv(os.path.join(REF, "data_audit.csv"))
refk = pd.read_csv(os.path.join(REF, "data_audit_klines.csv"))
ok = True
for _, r in ref.iterrows():
    m = a[a.symbol == r.symbol].iloc[0]
    k = refk[refk.symbol == r.symbol].iloc[0]
    tests = {
        "funding_rows": (int(m.n_rows), int(r.n_rows_raw)),
        "first_settlement": (str(m.first_settlement), str(r.first_settlement)),
        "last_settlement": (str(m.last_settlement), str(r.last_settlement)),
        "slots_missing": (int(m.slots_missing), int(r.slots_missing)),
        "off_grid_rows": (int(m.off_grid_rows), int(r.off_grid_rows)),
        "interval_values": (str(m.interval_values), str(r.interval_values)),
        # the funding family's klines audit was written BEFORE its 120-bar
        # daily-prefix backfill (SOL, XRP); its bars_expected is the grid, which
        # this pull must match exactly AFTER the same authorised backfill.
        "perp_bars": (int(m.perp_bars), int(k.bars_expected)),
        "perp_backfilled": (int(k.bars_expected) - int(k.bars_present),
                            {"SOLUSDT": 120, "XRPUSDT": 120}.get(r.symbol, 0)),
        "perp_first": (str(m.perp_first), str(k.first_bar)),
        "perp_last": (str(m.perp_last), str(k.last_bar)),
    }
    bad = {kk: v for kk, v in tests.items() if v[0] != v[1]}
    if bad:
        ok = False
        print(f"  {r.symbol}: MISMATCH {bad}")
    else:
        print(f"  {r.symbol}: identical ({int(m.n_rows)} funding rows, "
              f"{int(m.perp_bars)} perp bars)")
print(f"AUDIT IDENTITY: {'PASS' if ok else 'FAIL'}")

print("\n=== STOP-RULE CHECKS (§9 point 1) ===")
print(f"undeterminable timestamp unit      : 0 (fetch would have raised)")
new_iv = a[(a.share_interval_ne_8 > 0) & (a.symbol != "SOLUSDT")]
print(f"NEW non-8h funding episode         : {len(new_iv)} symbols {list(new_iv.symbol)}")
bad_f = a[a.slots_missing > 0]
print(f"funding slots missing              : {len(bad_f)} symbols {list(bad_f.symbol)}")
bad_s = sp[sp.fit_missing_pct > 1.0]
print(f"spot >1% missing in fit (§3.3 r6)  : {len(bad_s)} symbols {list(bad_s.symbol)}")
bad_b = bs[bs.pct_abs_gt_5pct > 0.1]
print(f"basis |b|>5% on >0.1% of bars      : {len(bad_b)} symbols {list(bad_b.symbol)}")
print(f"spot bars all on the hour          : {bool(sp.on_the_hour.all())}")
print(f"spot duplicate timestamps          : {int(sp.duplicates.sum())}")
