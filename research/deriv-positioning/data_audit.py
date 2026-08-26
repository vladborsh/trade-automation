#!/usr/bin/env python3
"""STAGE 0 — the data audit that gates everything (DESIGN.md §1).

Per symbol, fit and holdout separately:
  * metrics coverage start / end, and per-COLUMN coverage start (the archive
    does not start every column on the same day — see §1 of the report)
  * gap map over the complete 5m grid: number of gaps, total missing rows,
    how many are single-row (forward-filled per §1.2) vs longer (bars unusable)
  * share of 1h decision bars unusable, per hypothesis, and the §1.3 verdict
    ("a symbol with > 10% unusable 1h bars in the fit window is dropped from
    THAT HYPOTHESIS's pooled statistics")

Writes results/data_audit.csv, data_audit_gaps.csv, data_audit_columns.csv and
symbols_kept.json, and prints the escalation verdict: if more than 3 of 8
symbols drop, the protocol says STOP and escalate to the Architect.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd

import common as C
import prep

GATES = {"a": "usable_a", "b1": "usable_b1", "b2": "usable_b2"}
ROWS, GAPS, COLS = [], [], []

for sym in C.SYMBOLS:
    m = C.load_metrics(sym)
    grid, long_gap = C.metrics_grid(m)
    raw_present = grid.index.isin(m.ts.to_numpy())

    for c in C.METRIC_COLS:
        v = m[c]
        COLS.append(dict(symbol=sym, column=c, n_rows=len(m), n_nan=int(v.isna().sum()),
                         first_valid=(v[v.notna()].index.map(lambda i: m.ts.iloc[i])[0]
                                      if v.notna().any() else pd.NaT)))

    runs = []
    i = 0
    while i < len(grid):
        if raw_present[i]:
            i += 1
            continue
        j = i
        while j < len(grid) and not raw_present[j]:
            j += 1
        runs.append((grid.index[i], j - i))
        i = j
    for t0, n in runs:
        GAPS.append(dict(symbol=sym, start=t0, missing_rows=n, minutes=n * 5,
                         filled=(n == 1)))

    d = prep.get(sym)
    for wname, win in (("fit", C.FIT), ("fit_b1_effective", C.FIT_B1), ("holdout", C.HOLD)):
        lo = pd.Timestamp(win[0], tz="UTC"); hi = pd.Timestamp(win[1], tz="UTC")
        w = C.window_mask(d, win)
        gm = (grid.index >= lo) & (grid.index < hi)
        n_slots = int(gm.sum())
        miss = int((~raw_present[gm]).sum())
        inwin = [(t0, n) for t0, n in runs if lo <= t0 < hi]
        single = sum(n for t0, n in inwin if n == 1)
        r = dict(symbol=sym, window=wname,
                 metrics_start=grid.index[0], metrics_end=grid.index[-1],
                 grid_slots_5m=n_slots, missing_5m=miss,
                 missing_pct=100.0 * miss / max(1, n_slots),
                 gaps=len(inwin), single_row_filled=single,
                 long_gap_rows=miss - single,
                 longest_gap_min=max([n * 5 for _, n in inwin], default=0),
                 bars_1h=int(w.sum()),
                 unusable_metrics_pct=100.0 * float((~d.metrics_ok.to_numpy()[w]).mean()))
        for k, g in GATES.items():
            r[f"unusable_{k}_pct"] = 100.0 * float((~d[g].to_numpy()[w]).mean())
        ROWS.append(r)

au = pd.DataFrame(ROWS)
au.to_csv(f"{C.OUT}/data_audit.csv", index=False)
pd.DataFrame(GAPS).to_csv(f"{C.OUT}/data_audit_gaps.csv", index=False)
pd.DataFrame(COLS).to_csv(f"{C.OUT}/data_audit_columns.csv", index=False)

pd.set_option("display.width", 260)
print("=== STAGE 0: metrics coverage + gap audit (DESIGN.md §1) ===")
show = ["symbol", "window", "grid_slots_5m", "missing_5m", "missing_pct", "gaps",
        "single_row_filled", "long_gap_rows", "longest_gap_min", "bars_1h",
        "unusable_metrics_pct", "unusable_a_pct", "unusable_b1_pct", "unusable_b2_pct"]
print(au[show].to_string(index=False, float_format=lambda x: f"{x:8.3f}"))

print("\n=== per-column coverage start (the archive starts columns on different days) ===")
cw = pd.DataFrame(COLS).pivot(index="symbol", columns="column", values="first_valid")
print(cw.to_string())

# §1.3 is evaluated on each hypothesis's EFFECTIVE fit window (§6 window
# adjustment; Architect ruling at stage 0, REPORT.md §1.4).
WIN_ROW = {"a": "fit", "b1": "fit_b1_effective", "b2": "fit"}
keep, drop = {}, {}
print("\n=== §1.3 symbol rule: > 10% unusable 1h bars in the EFFECTIVE fit window ===")
for k in GATES:
    fit = au[au.window == WIN_ROW[k]].set_index("symbol")
    col = f"unusable_{k}_pct"
    dr = fit.index[fit[col] > 10.0].tolist()
    kp = [s for s in C.SYMBOLS if s not in dr]
    keep[k], drop[k] = kp, dr
    line = "  ".join(f"{s.replace('USDT',''):>5}:{fit.loc[s, col]:5.1f}%" for s in C.SYMBOLS)
    print(f"  ({k}) window={WIN_ROW[k]}")
    print(f"       {line}")
    print(f"       dropped {dr or 'none'} ({len(dr)}/8)")

worst = max(len(v) for v in drop.values())
print("\nVERDICT:", "STOP — escalate to Architect (> 3 of 8 dropped on some hypothesis)"
      if worst > 3 else "PROCEED — breadth assumption holds on every hypothesis")

json.dump(dict(kept=keep, dropped=drop,
               rule="DESIGN.md §1.3: > 10% unusable 1h bars in the fit window, per hypothesis"),
          open(f"{C.OUT}/symbols_kept.json", "w"), indent=1)
