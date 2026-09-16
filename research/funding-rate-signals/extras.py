#!/usr/bin/env python3
"""§6.5 momentum_breakout overlap and §6.7 harness validation (fit-only,
descriptive, no verdict).  Also the SOL-ruling immateriality row."""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SYMBOLS, TIERS, OUT, FIT_END
import prep, engine, harness

START = pd.Timestamp("2019-01-01", tz="UTC")
pd.set_option("display.width", 220, "display.max_columns", 40)
frames = prep.build_all()

# ---- §6.7 harness validation ---------------------------------------------
W0 = pd.Timestamp("2022-08-01", tz="UTC")
W1 = pd.Timestamp("2025-04-01", tz="UTC")
rows = []
for s in SYMBOLS:
    bars, sett = frames[s]
    a = harness.run_mb(bars, sett, s, W0, W1, with_funding=False)
    b = harness.run_mb(bars, sett, s, W0, W1, with_funding=True)
    rows.append(dict(symbol=s, n=len(a),
                     gross_PF_no_funding=harness.pf(a, "R"),
                     gross_PF_with_funding=harness.pf(b, "R"),
                     mean_R_no_funding=np.mean([r["R"] for r in a]) if a else np.nan,
                     mean_R_with_funding=np.mean([r["R"] for r in b]) if b else np.nan,
                     mean_fundingR=np.mean([r["fundingR"] for r in b]) if b else np.nan))
h = pd.DataFrame(rows)
h["PF_delta"] = h.gross_PF_with_funding - h.gross_PF_no_funding
h["edge_taken_pct"] = 100 * (1 - h.mean_R_with_funding / h.mean_R_no_funding)
h.round(4).to_csv(os.path.join(OUT, "harness_validation.csv"), index=False)
print("=== §6.7 harness validation: momentum_breakout, 2022-08 .. 2025-04 ===")
print(h.round(4).to_string(index=False))
print(f"gross PF > 1.0 without funding on "
      f"{int((h.gross_PF_no_funding > 1.0).sum())}/8 perps")
print(f"gross PF > 1.0 WITH funding accounting on "
      f"{int((h.gross_PF_with_funding > 1.0).sum())}/8 perps")

# ---- §6.5 momentum_breakout overlap --------------------------------------
ov = []
for arm, run in (("A", engine.run_A), ("B", engine.run_B)):
    for tier, syms in TIERS.items():
        tot = w = ag = 0
        for s in syms:
            bars, sett = frames[s]
            up, dn = harness.mb_event_mask(bars, 12)
            for t in run(bars, sett, s, START, FIT_END):
                if t.get("excluded") is not None:
                    continue
                T = t["t_signal"]
                if T not in up.index:
                    continue
                tot += 1
                same = up.at[T] if t["side"] == 1 else dn.at[T]
                opp = dn.at[T] if t["side"] == 1 else up.at[T]
                w += int(bool(same))
                ag += int(bool(opp))
        ov.append(dict(arm=f"{arm}_{tier}", n=tot,
                       share_mb_same_side=w / tot if tot else np.nan,
                       share_mb_opposite_side=ag / tot if tot else np.nan))
o = pd.DataFrame(ov)
o.round(4).to_csv(os.path.join(OUT, "mb_overlap.csv"), index=False)
print("\n=== §6.5 momentum_breakout overlap within the prior 12 bars ===")
print(o.round(4).to_string(index=False))

# ---- SOL ruling immateriality --------------------------------------------
print("\n=== SOL blackout: excluded-and-counted trades per arm (fit) ===")
sol = []
for arm, run in (("A", engine.run_A), ("B", engine.run_B)):
    bars, sett = frames["SOLUSDT"]
    tr = run(bars, sett, "SOLUSDT", START, FIT_END)
    sol.append(dict(arm=arm, sol_trades=len(tr),
                    excluded_blackout_span=sum(
                        1 for t in tr if t.get("excluded") == "blackout_span")))
sdf = pd.DataFrame(sol)
sdf.to_csv(os.path.join(OUT, "sol_blackout.csv"), index=False)
print(sdf.to_string(index=False))
