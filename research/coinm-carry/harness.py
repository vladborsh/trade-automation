#!/usr/bin/env python3
"""Harness validation (DESIGN §8.1-§8.4).  Must pass before the screen.

  H1  the 1/mmr identity I1/I2, algebraic and on 20 real positions   [STOP RULE]
  H2  hedge identity: with spot == COIN-M (b == 0), hedge_pnl == 0
  H3  planted accrual (a = 1): the tier mean moves by exactly d * SUM N / C / yr
  H4  buffer identity: a planted constant negative rate breaches on exactly the
      settlement arithmetic says it must, and on no other
"""
from __future__ import annotations
import os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PERPS, PAIR_OF, MMR, C_TIER, SLOTS, OUT, FIT_END,
                    SWEEP_COST, ann_mean)
import engine, portfolio
from engine import Cfg

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {detail}", flush=True)


def main():
    cfg = Cfg()
    start = portfolio.tier_start()
    print(f"tier start {start}   fit end {FIT_END}")

    # ---- H1 the 1/mmr identity ---------------------------------------------
    print("H1  identity I1 (coin balance == N/P_t) and I2 (margin/maint == 1/mmr)")
    rows = []
    for s in PERPS:
        t = engine.mmr_check(s, cfg, start, FIT_END, n_positions=10)
        rows.append(t)
    mt = pd.concat(rows, ignore_index=True)
    mt.to_csv(os.path.join(OUT, "mmr_identity.csv"), index=False)
    check("H1 I1 max |coin*P/N - 1| <= 1e-12",
          float(mt.I1_max_abs_dev.max()) <= 1e-12,
          f"max={mt.I1_max_abs_dev.max():.3e} over {len(mt)} positions, "
          f"largest price ratio seen {mt.price_ratio_max.max():.3f}x")
    check("H1 I2 max |margin/maint - 1/mmr| <= 1e-9",
          float(mt.I2_max_abs_dev.max()) <= 1e-9,
          f"max={mt.I2_max_abs_dev.max():.3e}; 1/mmr = "
          f"{', '.join(f'{PAIR_OF[s]} {1/MMR[PAIR_OF[s]]:.0f}x' for s in PERPS)}")

    # ---- H2 hedge identity --------------------------------------------------
    print("H2  hedge identity with b == 0")
    saved = dict(engine._BARS)
    for s in PERPS:
        b = engine.bars(s).copy()
        b["close_s"] = b["close_p"]
        b["b"] = 0.0
        b["ok"] = True
        engine._BARS[s] = b
    d0, p0, e0 = portfolio.run_tier("always", cfg, start, FIT_END)
    ok = bool(len(p0)) and float(p0.hedge_pnl.abs().max()) < 1e-12
    resid = (p0.net - (p0.funding - p0.fees - p0.sweep)).abs().max() if len(p0) else np.nan
    check("H2 hedge_pnl == 0 when b == 0", ok,
          f"max|hedge_pnl|={p0.hedge_pnl.abs().max():.3e}")
    check("H2 net == funding - fees - sweep", float(resid) < 1e-9,
          f"max|residual|={resid:.3e}")
    engine._BARS.clear(); engine._BARS.update(saved)

    # ---- H3 planted accrual -------------------------------------------------
    print("H3  planted accrual, a = 1")
    base, bpos, _ = portfolio.run_tier("always", cfg, start, FIT_END)
    m0 = ann_mean(base.r.dropna().values)
    years = len(base.r.dropna()) / 365.0
    h3 = []
    for d in (-0.0002, 0.0, 0.0002, 0.0005):
        # no sweep charge on the planted component: compare at sweep_cost = 0
        c = replace(cfg, funding_add=d, sweep_cost=0.0)
        cb = replace(cfg, sweep_cost=0.0)
        dd, pp, ed = portfolio.run_tier("always", c, start, FIT_END)
        b0, pb, eb = portfolio.run_tier("always", cb, start, FIT_END)
        got = ann_mean(dd.r.dropna().values) - ann_mean(b0.r.dropna().values)
        n_sett = int(pp.n_settle.sum())
        exp = d * pp.N.iloc[0] * n_sett / C_TIER / years
        nbr = int((ed.kind == "buffer_breach").sum()) if len(ed) else 0
        h3.append(dict(d=d, expected=exp, got=got, resid=got - exp,
                       n_settle=n_sett, n_breach=nbr,
                       positions_same=int(len(pp) == len(pb))))
        # The identity is exact ONLY while the schedule is invariant, i.e.
        # while no planted deficit forces an unwind.  A d that breaches the
        # buffer changes the schedule by design; that arm of the test is the
        # MONOTONICITY check below, the pass's "liquidations non-increasing
        # in d" in this structure's units.
        if nbr == 0:
            check(f"H3 d={d:+.4f} tier mean moves by exactly d*sum(N)/C/yr",
                  abs(got - exp) < 1e-9, f"exp={exp:+.6e} got={got:+.6e} "
                  f"resid={got-exp:+.2e}")
        else:
            check(f"H3 d={d:+.4f} breaches the buffer -> schedule changes "
                  f"by design; identity not asserted", True,
                  f"breaches={nbr}, resid={got-exp:+.2e}")
    h3d = pd.DataFrame(h3)
    h3d.to_csv(os.path.join(OUT, "harness_h3.csv"), index=False)
    check("H3 buffer breaches non-increasing in d",
          bool((h3d.sort_values("d").n_breach.diff().dropna() <= 0).all()),
          str(h3d.set_index("d").n_breach.to_dict()))
    check("H3 schedule invariant in d where no breach occurs",
          all(r["positions_same"] for r in h3 if r["n_breach"] == 0), "")

    # ---- H4 buffer identity -------------------------------------------------
    print("H4  buffer identity under a planted constant negative rate")
    # buffer0 = C_slot - N/(1+b_e) - entry_cost ; each settlement costs
    # |d|*N*(1+SWEEP).  The breach must land on settlement ceil(buffer0/cost).
    d = -0.0005
    c = replace(cfg, funding_add=d, funding_scale=0.0)
    dd, pp, ee = portfolio.run_tier("always", c, start, FIT_END)
    ok = True
    detail = []
    for s in PERPS:
        ps = pp[pp.symbol == s]
        if not len(ps):
            ok = False; continue
        N = ps.N.iloc[0]
        buf0 = ps.buffer0.iloc[0] - (N * (0.0010 + 0.0002) + N * (0.0005 + 0.0002))
        per = abs(d) * N * (1 + SWEEP_COST)
        exp_k = int(np.ceil(buf0 / per))
        got_k = int(ps.n_settle.iloc[0])
        ok &= (got_k == exp_k)
        detail.append(f"{s}: expected breach at settlement {exp_k}, got {got_k}")
    check("H4 breach lands on the arithmetic settlement", ok, "; ".join(detail))
    # always-on re-enters after the forced unwind and burns the buffer again,
    # so breaches recur by construction; the FIRST per slot is the identity.
    firsts = (ee[ee.kind == "buffer_breach"].groupby("symbol").ts.min()
              if len(ee) else pd.Series(dtype=object))
    check("H4 at least one breach per slot, first one matched above",
          len(firsts) == len(PERPS), f"total breaches={len(ee)}, "
          f"first per slot={[str(t) for t in firsts]}")

    print(f"\nharness {len(PASS)}/{len(PASS)+len(FAIL)}")
    if FAIL:
        print("FAILED: " + "; ".join(FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
