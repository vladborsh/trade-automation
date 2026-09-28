#!/usr/bin/env python3
"""Stage-0 audit (DESIGN §2.4): coverage and gap COUNTS only.  No return, no
label frequency, no trade outcome is computed here.

Output: results/data_audit.csv (per symbol), results/data_audit_months.csv
(per symbol x leg x month: minutes present vs expected).
"""
import numpy as np
import pandas as pd
from common import SYMBOLS, OUT, BAR_MIN, MIN_PRESENT, WARMUP_BARS, Tape, \
    load_leg, load_funding, FIT_END, HOLD_START, HOLD_END
import os

rows, mrows = [], []
for s in SYMBOLS:
    perp, spot, fund = load_leg(s, "perp1m"), load_leg(s, "spot1m"), load_funding(s)
    t = Tape(s, perp, spot, fund)
    nb = t.n // BAR_MIN
    n_p = np.isfinite(t.p["close"][: nb * BAR_MIN].reshape(nb, BAR_MIN)).sum(1)
    n_s = np.isfinite(t.s["close"][: nb * BAR_MIN].reshape(nb, BAR_MIN)).sum(1)
    T = t.ts_of(np.arange(nb) * BAR_MIN) + pd.Timedelta(hours=4)
    ok = (n_p >= MIN_PRESENT) & (n_s >= MIN_PRESENT)
    ok[:WARMUP_BARS] = False
    fit = T < FIT_END
    hol = (T >= HOLD_START) & (T < HOLD_END)
    tb_bad = 0
    for df in (perp, spot):
        tb_bad += int(((df.taker_buy_volume < -1e-12)
                       | (df.taker_buy_volume > df.volume * (1 + 1e-9) + 1e-12)).sum())
    mj, rate, px, miss = t.funding_arrays()
    iv = fund["funding_interval_hours"]
    rows.append(dict(
        symbol=s,
        perp_first=perp.ts.iloc[0], perp_last=perp.ts.iloc[-1], perp_rows=len(perp),
        perp_dups=perp.attrs["n_dup"],
        spot_first=spot.ts.iloc[0], spot_last=spot.ts.iloc[-1], spot_rows=len(spot),
        spot_dups=spot.attrs["n_dup"],
        grid_start=t.ts_of([0])[0],
        perp_missing_min=int(np.isnan(t.p["close"]).sum()),
        spot_missing_min=int(np.isnan(t.s["close"]).sum()),
        taker_rule_violations=tb_bad,
        bars4h_fit=int(fit.sum()), bars4h_fit_invalid=int((fit & ~ok).sum()),
        bars4h_hold=int(hol.sum()), bars4h_hold_invalid=int((hol & ~ok).sum()),
        funding_rows=len(fund), funding_missing_slots=int(miss.sum()),
        funding_interval_values=";".join(f"{int(v)}h:{int(c)}" for v, c in
                                         iv.value_counts().sort_index().items()),
    ))
    for leg, df in (("perp", perp), ("spot", spot)):
        g = df.groupby(df.ts.dt.strftime("%Y-%m")).size()
        for m, c in g.items():
            exp = pd.Period(m).days_in_month * 1440
            mrows.append(dict(symbol=s, leg=leg, month=m, minutes=c,
                              expected=exp, missing=exp - c))
    print(rows[-1], flush=True)

pd.DataFrame(rows).to_csv(os.path.join(OUT, "data_audit.csv"), index=False)
mm = pd.DataFrame(mrows)
mm.to_csv(os.path.join(OUT, "data_audit_months.csv"), index=False)
print(mm[mm.missing > 0].to_string())
