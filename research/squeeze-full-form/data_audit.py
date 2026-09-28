#!/usr/bin/env python3
"""STAGE-0 audit (DESIGN §2, §9 step 1). Coverage only; computes no R.

  results/data_audit.csv       per symbol: first/last row and gaps per input
  results/condition_rates.csv  per symbol x window: share of decision instants
                               on which each ARMED item holds (frequency, not R)
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd

from common import OUT, DATA, SYMBOLS, FIT_END, HOLD_END
from prep import build_symbol
from engine import armed_mask, evaluable_mask


def main():
    rows, rates = [], []
    for s in SYMBOLS:
        S = build_symbol(s)
        d, b = S["dec"], S["b15"]
        m1 = S["m1"]["ts"]
        gaps = np.diff(m1) // 60_000_000_000 - 1
        sp = pd.read_parquet(os.path.join(DATA, f"{s}-spot15m.parquet"))
        mt = pd.read_parquet(os.path.join(DATA, f"{s}-metrics.parquet"))
        oi = mt.dropna(subset=["sum_open_interest"])
        oig = oi.ts.diff().dt.total_seconds().div(60).dropna()
        ev1 = evaluable_mask(d, -1)
        rows.append(dict(
            sym=s,
            perp1m_first=pd.Timestamp(m1[0], tz="UTC"), perp1m_rows=len(m1),
            perp1m_missing_min=int(gaps.sum()), perp1m_gaps_gt60m=int((gaps > 60).sum()),
            perp15m_missing_bars=int(b.close.isna().sum()),
            spot15m_first=sp.ts.iloc[0], spot15m_rows=len(sp),
            oi_first=oi.ts.iloc[0], oi_rows=len(oi), oi_gaps_gt15m=int((oig > 15).sum()),
            oi_longest_gap_min=float(oig.max()),
            bybit_first_present=d.index[d.bybit_present.values][0],
            okx_first_present=(d.index[d.okx_present.values][0] if d.okx_present.any() else None),
            eff_start=d.index[ev1][0],
            dec_fit=int((ev1 & (d.index < FIT_END)).sum()),
            dec_hold=int((ev1 & (d.index >= FIT_END) & (d.index < HOLD_END)).sum()),
        ))
        for wname, lo, hi in (("fit", d.index[ev1][0], FIT_END), ("holdout", FIT_END, HOLD_END)):
            w = ev1 & (d.index >= lo) & (d.index < hi)
            dd = d[w]
            r = dict(sym=s, window=wname, n_dec=int(w.sum()),
                     binance_hi=dd.binance_hi.mean(), ext_hi_ge2=(dd.ext_hi >= 2).mean(),
                     binance_lo=dd.binance_lo.mean(), ext_lo_ge2=(dd.ext_lo >= 2).mean(),
                     oi_p1=((dd.oi_d24h >= 0.05) & dd.at_7d_high).mean(),
                     oi_p2=((dd.oi_d24h >= 0.03) & (dd.ret24 >= -0.01)).mean(),
                     fh_ge2=(dd.fh >= 2).mean(), fl_ge2_comp=((dd.fl >= 2) & dd.compress).mean(),
                     cvd_p1=((dd.cvd_spot <= 0) & (dd.cvd_perp > 0)).mean(),
                     cvd_p2=(dd.cvd_spot >= 0).mean(),
                     sh_pos=dd.sh_pos.mean(), sh_neg=dd.sh_neg.mean())
            for side, nm in ((-1, "P1"), (1, "P2")):
                for v in ("R0", "R1", "R2", "R3", "R4", "SHADOW"):
                    r[f"{nm}_{v}_armed"] = int((armed_mask(d, side, v) & w).sum())
            rates.append(r)
        print(s, "done", flush=True)
    pd.DataFrame(rows).to_csv(os.path.join(OUT, "data_audit.csv"), index=False)
    pd.DataFrame(rates).to_csv(os.path.join(OUT, "condition_rates.csv"), index=False, float_format="%.4f")
    print(pd.DataFrame(rows).T.to_string())
    print(pd.DataFrame(rates).T.to_string())


if __name__ == "__main__":
    main()
