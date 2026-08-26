#!/usr/bin/env python3
"""Cross-thread follow-up: the momentum inversion is the only thing in this
package whose GROSS profit factor is above 1 on every symbol tested. Is there a
parameter neighbourhood where it clears the targets NET of cost -- and does that
neighbourhood survive out of sample?

Same fit/holdout protocol as tod_dow.py:
  fit     2022-08-01 .. 2025-04-01
  holdout 2025-04-01 .. 2026-08-01

The grid is scanned on the FIT period only, pooled across all eight perps
(a config has to work on the whole universe, not on one lucky symbol). The
single best fit configuration per candidate -- plus the best that also clears
win rate > 50% in fit -- is then run once on the holdout. The number of
configurations scanned is reported so the selection bias is visible.
"""
from __future__ import annotations
import argparse, itertools, os
import numpy as np
import pandas as pd

import common as C

FIT = ("2022-08-01", "2025-04-01")
HOLD = ("2025-04-01", "2026-08-01")
SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]

GRID = dict(
    z=[1.5, 2.0, 2.5],
    stop_atr=[1.0, 1.5, 2.0],
    mom_rr=[0.75, 1.0, 1.5, 2.0],
    time_stop=[12, 24],
)


def run_window(sym, cand, params, window):
    d = C.load(sym, "1h")
    sig, p = C.signals(d, cand, params)
    m = (d.ts >= pd.Timestamp(window[0], tz="UTC")) & (d.ts < pd.Timestamp(window[1], tz="UTC"))
    return C.run(d.loc[m].reset_index(drop=True), sig.loc[m].reset_index(drop=True), p)


def evaluate(cand, params, window):
    res = [run_window(s, cand, params, window) for s in SYMS]
    parts = [r["trades"] for r in res if len(r["trades"])]
    tr = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
    out = C.summarise(tr)
    live = [C.stats(r, "1h") for r in res if len(r["trades"])]
    for k in ("sharpe", "sortino", "max_dd"):
        out[k] = float(np.nanmean([m.get(k, np.nan) for m in live])) if live else np.nan
    out["symbols_pf_gt_1"] = int(sum(
        1 for r in res if len(r["trades"]) and C.summarise(r["trades"])["profit_factor"] > 1))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default="momentum_breakout,momentum")
    ap.add_argument("--min-trades", type=int, default=300)
    a = ap.parse_args()

    rows = []
    for cand in a.candidates.split(","):
        zkey = "brk_z" if cand == "momentum_breakout" else "mr_z"
        combos = list(itertools.product(GRID["z"], GRID["stop_atr"],
                                        GRID["mom_rr"], GRID["time_stop"]))
        print(f"{cand}: {len(combos)} configs x {len(SYMS)} symbols on FIT", flush=True)
        for z, sa, rr, tsx in combos:
            p = {zkey: z, "stop_atr": sa, "mom_rr": rr, "time_stop": tsx}
            st = evaluate(cand, p, FIT)
            rows.append(dict(candidate=cand, period="fit", z=z, stop_atr=sa, mom_rr=rr,
                             time_stop=tsx, **st))
            print(f"  z={z} stop={sa} rr={rr} ts={tsx}: n={st['trades']:>5} "
                  f"wr={st['win_rate']:.1%} pf={st['profit_factor']:.3f} "
                  f"({st['symbols_pf_gt_1']}/8 sym pf>1)", flush=True)

    fit = pd.DataFrame(rows)
    fit.to_csv(os.path.join(C.OUT, "mom_scan_fit.csv"), index=False)

    hold_rows = []
    for cand, g in fit.groupby("candidate"):
        ok = g[g.trades >= a.min_trades]
        picks = {}
        if len(ok):
            picks["best_fit_pf"] = ok.loc[ok.profit_factor.idxmax()]
            wr = ok[ok.win_rate > 0.50]
            if len(wr):
                picks["best_fit_pf_given_wr50"] = wr.loc[wr.profit_factor.idxmax()]
        picks["v2_default"] = g[(g.z == 2.0) & (g.stop_atr == 1.5) &
                                (g.mom_rr == 1.5) & (g.time_stop == 24)].iloc[0]
        for label, r in picks.items():
            p = {("brk_z" if cand == "momentum_breakout" else "mr_z"): r.z,
                 "stop_atr": r.stop_atr, "mom_rr": r.mom_rr, "time_stop": int(r.time_stop)}
            st = evaluate(cand, p, HOLD)
            hold_rows.append(dict(candidate=cand, pick=label, period="holdout", z=r.z,
                                  stop_atr=r.stop_atr, mom_rr=r.mom_rr,
                                  time_stop=int(r.time_stop), **st))
            hold_rows.append(dict(candidate=cand, pick=label, period="fit", z=r.z,
                                  stop_atr=r.stop_atr, mom_rr=r.mom_rr,
                                  time_stop=int(r.time_stop),
                                  **{k: r[k] for k in st if k in r}))
            print(f"\n{cand} [{label}] z={r.z} stop={r.stop_atr} rr={r.mom_rr} ts={int(r.time_stop)}"
                  f"\n   fit     pf={r.profit_factor:.3f} wr={r.win_rate:.1%} n={int(r.trades)}"
                  f"\n   holdout pf={st['profit_factor']:.3f} wr={st['win_rate']:.1%} "
                  f"n={st['trades']} ({st['symbols_pf_gt_1']}/8 sym pf>1)", flush=True)
    pd.DataFrame(hold_rows).to_csv(os.path.join(C.OUT, "mom_scan_holdout.csv"), index=False)
    print(f"\nconfigs scanned in fit: {len(fit)}; holdout evaluations: {len(hold_rows)//2}")


if __name__ == "__main__":
    main()
