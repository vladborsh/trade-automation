#!/usr/bin/env python3
"""THREAD 3 -- same MR / SMC / hybrid / momentum logic on equity index products.

Adaptations forced by the instrument (all deliberate, all reported):

 1. REGULAR SESSION ONLY. Yahoo's 1h series contains only RTH bars
    (13:30-20:00 UTC under EDT, 14:30-21:00 under EST; ~7 bars/session). There
    is no 24/7 tape, so "intraday" here means the cash session.
 2. GAP-AWARE FILLS. Every session boundary is a gap, so engine_v2 is used: a
    stop or target the bar OPENS beyond fills at the open, not at the level.
    On 24/7 crypto this engine reproduces v1 to ~0.01 PF (results/engine_check.csv).
 3. DAILY CIRCUIT-BREAKER = SESSION circuit-breaker. A US cash session sits
    entirely inside one UTC day, so the engine's existing UTC-day reset is
    already the right boundary; no change was needed. On the 1d series the
    breaker is degenerate (one bar per day, so it can only ever halt the day
    after a loss) -- the 1d runs are a long-window sanity check, not an
    intraday result.
 4. HOLD HORIZON. Run twice: `time_stop=24` (the crypto default, ~3.5 sessions,
    so positions carry overnight) and `time_stop=7` (one session -- genuinely
    intraday, no overnight gap risk).
 5. COSTS. No perp funding. 2 bp/side for the ETFs (retail zero-commission plus
    ~1 bp spread/slippage on SPY/QQQ). ^GSPC / ^NDX are NOT directly tradable --
    they are included as a clean-price reference only, and flagged as such.
 6. WINDOW. 1h index history from this source is a rolling ~730 trading days
    (2023-09 -> 2026-08, ~35 months), NOT the 48 months used for crypto.
"""
from __future__ import annotations
import argparse, os
import numpy as np
import pandas as pd

import common as C
import engine_v2 as e2

TRADABLE = {"SPY", "QQQ"}
CANDS = ["mean_reversion", "smc", "hybrid", "momentum", "momentum_breakout", "momentum_smc"]


def one(sym, iv, cand, time_stop, fee_bps):
    d = C.load(sym, iv)
    sig, p = C.signals(d, cand)
    res = e2.run(d, sig, time_stop, fee_bps=fee_bps)
    m = C.stats(res, iv)
    tr = res["trades"]
    m.update(symbol=sym, interval=iv, candidate=cand, time_stop=time_stop,
             fee_bps=fee_bps, tradable=sym in TRADABLE,
             gap_exit_share=float(tr.reason.str.startswith("gap").mean()) if len(tr) else np.nan,
             bars=len(d), start=str(d.ts.iloc[0].date()), end=str(d.ts.iloc[-1].date()))
    return m, res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="SPY,QQQ,IDX_GSPC,IDX_NDX")
    ap.add_argument("--intervals", default="1h,1d")
    ap.add_argument("--candidates", default=",".join(CANDS))
    ap.add_argument("--time-stops", default="24,7")
    ap.add_argument("--fee-bps", type=float, default=2.0)
    ap.add_argument("--tag", default="index")
    a = ap.parse_args()

    rows = []
    for cand in a.candidates.split(","):
        for iv in a.intervals.split(","):
            for sym in a.symbols.split(","):
                for tsx in [int(x) for x in a.time_stops.split(",")]:
                    if iv == "1d" and tsx != 24:
                        continue      # a 1-session stop is meaningless on daily bars
                    m, _ = one(sym, iv, cand, tsx, a.fee_bps)
                    rows.append(m)
                    print(f"{cand:>18} {iv:>3} {sym:<9} ts={tsx:<3} "
                          f"n={m.get('trades',0):>5} wr={m.get('win_rate',0):.1%} "
                          f"pf={m.get('profit_factor',0):.2f} sharpe={m.get('sharpe',0):.2f} "
                          f"dd={m.get('max_dd',0):.1%} gapexit={m.get('gap_exit_share',0):.0%}",
                          flush=True)
    cols = ["candidate", "interval", "symbol", "tradable", "time_stop", "fee_bps", "trades",
            "win_rate", "profit_factor", "expectancy_R", "sharpe", "sortino", "max_dd",
            "calmar", "cagr", "gap_exit_share", "long_share", "stop_share", "time_share",
            "bars", "start", "end"]
    df = pd.DataFrame(rows)
    df.reindex(columns=[c for c in cols if c in df.columns]).to_csv(
        os.path.join(C.OUT, f"summary_{a.tag}.csv"), index=False)
    print(f"\nwrote results/summary_{a.tag}.csv")


if __name__ == "__main__":
    main()
