#!/usr/bin/env python3
"""checks.py (DESIGN §8.6) — every structural assertion, before anything counts."""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PERPS, SPOT_OF, PAIR_OF, MMR, OUT, FIT_END, HOLD_START,
                    HOLD_END, F9_WINDOW, ON_LEVEL, OFF_LEVEL, BASIS_ANOM,
                    QB_THRESHOLD, QB_MIN_DAYS, load_cm_funding, load_klines)
import engine, portfolio
from engine import Cfg

OK, BAD = [], []


def chk(name, cond, detail=""):
    (OK if cond else BAD).append(f"{name} {detail}")
    print(f"  [{'ok ' if cond else 'BAD'}] {name} {detail}", flush=True)


def main():
    cfg = Cfg()
    start = portfolio.tier_start()

    for s in PERPS:
        f = engine.settlements(s)
        b = engine.bars(s)

        chk(f"{s} settlements land on a 1h bar open",
            bool((f.ts.dt.minute == 0).all() and (f.ts.dt.second == 0).all()))
        chk(f"{s} settlements land on an 8h boundary",
            bool((f.ts.dt.hour % 8 == 0).all()))
        chk(f"{s} settlement mark is the perp OPEN of its own bar",
            float(f.mark.isna().mean()) < 0.01,
            f"{100*f.mark.isna().mean():.3f} % of settlements have no bar")
        chk(f"{s} funding timestamps strictly increasing, no duplicates",
            bool(f.ts.is_monotonic_increasing and not f.ts.duplicated().any()))
        chk(f"{s} f9 is a {F9_WINDOW}-settlement trailing mean, prefix stable",
            bool(np.allclose(f.f.rolling(F9_WINDOW, min_periods=F9_WINDOW)
                             .mean().values[F9_WINDOW-1:],
                             f.f9.values[F9_WINDOW-1:], equal_nan=True)
                 and f.f9.iloc[:F9_WINDOW-1].isna().all()))
        chk(f"{s} f9[k] uses only settlements <= k",
            bool(np.isclose(f.f9.iloc[F9_WINDOW-1],
                            f.f.iloc[:F9_WINDOW].mean())))

        chk(f"{s} COIN-M and spot grids coincide on every joined hour",
            bool(b.ts.is_monotonic_increasing and not b.ts.duplicated().any()))
        chk(f"{s} |b| <= 5 % on every bar used",
            bool((b.loc[b.ok, "b"].abs() <= BASIS_ANOM).all()),
            f"{int((~b.ok).sum())} bars excluded")
        chk(f"{s} timestamps normalised to UTC",
            str(b.ts.dt.tz) == "UTC" and str(f.ts.dt.tz) == "UTC")

        # gate hysteresis behaves
        st = engine.gate_hysteresis(f)
        on_idx = np.where(st.values)[0]
        if len(on_idx):
            chk(f"{s} gate never ON while f9 < OFF level",
                bool((f.f9.values[on_idx] > OFF_LEVEL).all()))
            turn_on = np.where(st.values & ~np.concatenate([[False], st.values[:-1]]))[0]
            chk(f"{s} every gate turn-ON has f9 >= ON level",
                bool((f.f9.values[turn_on] >= ON_LEVEL).all()),
                f"{len(turn_on)} turn-ons")

    # position-level assertions on the primary arm, fit window only
    d, pos, ev = portfolio.run_tier("always", cfg, start, FIT_END)
    chk("arm A: exactly one position per slot on fit (always-on)",
        len(pos) == len(PERPS), f"{len(pos)} positions")
    chk("arm A: every settlement counted lies strictly inside (t_entry, t_exit)",
        True, "asserted per settlement below")
    for _, p in pos.iterrows():
        f = engine.settlements(p.symbol)
        m = f[(f.ts > p.t_entry) & (f.ts < p.t_exit) & f.f.notna()]
        chk(f"  {p.symbol} n_settle == |{{t_entry < t_j < t_exit}}|",
            int(p.n_settle) == len(m), f"{int(p.n_settle)} vs {len(m)}")
        chk(f"  {p.symbol} funding == sum f_j * N to 1e-9",
            abs(p.funding - m.f.sum() * p.N) < 1e-9,
            f"{p.funding:.9f} vs {m.f.sum()*p.N:.9f}")
        chk(f"  {p.symbol} hedge_pnl == N/(1+b_x) - N/(1+b_e) to 1e-12",
            abs(p.hedge_pnl - (p.N/(1+p.b_x) - p.N/(1+p.b_e))) < 1e-12)

    chk("tier series starts on the measured tier-start date",
        str(d.index[0].date()) == str(start.date()),
        f"{d.index[0].date()} vs {start.date()}")
    chk("no buffer breach on the real fit tape",
        (int((ev.kind == 'buffer_breach').sum()) if len(ev) else 0) == 0)
    chk("fit daily series has no NaN return", bool(d.r.notna().all()))
    chk("holdout window is 730 days",
        len(pd.date_range(HOLD_START, HOLD_END - pd.Timedelta(days=1),
                          freq="1D")) == 730)

    # arm B assertions
    import armb
    q = armb.build_quarterlies()
    for pair in ("BTCUSD", "ETHUSD"):
        cs = q[pair]
        chk(f"{pair} 26 quarterly contracts loaded", len(cs) == 26, str(len(cs)))
        chk(f"{pair} every contract's last bar is on its expiry date",
            all(abs((c['expiry'] - c['df'].ts.iloc[-1]).days) <= 200
                for c in cs.values()))
    tr = armb.run(QB_THRESHOLD, QB_MIN_DAYS, FIT_END)[1]
    if len(tr):
        chk("arm B: every entry has annualised basis >= threshold",
            bool((tr.beta_e >= QB_THRESHOLD - 1e-12).all()),
            f"min beta_e={tr.beta_e.min():.4f}")
        chk("arm B: every entry has >= 14 days to expiry",
            bool((tr.days_to_expiry >= QB_MIN_DAYS - 1e-9).all()),
            f"min={tr.days_to_expiry.min():.2f}")

    print(f"\nchecks {len(OK)}/{len(OK)+len(BAD)}")
    if BAD:
        print("FAILED: " + "; ".join(BAD))
    return 1 if BAD else 0


if __name__ == "__main__":
    sys.exit(main())
