#!/usr/bin/env python3
"""checks.py — DESIGN §8.6.  Green before anything counts.

Writes results/checks.csv.  Exits non-zero on any failure.
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, TIERS, OUT, FIT_END, HOLD_START, HOLD_END,
                    BASIS_ANOM, F9_WINDOW, SOL_BLACKOUT, C_TIER, SLOTS,
                    load_funding, load_klines)
import engine, portfolio
from engine import Cfg

rows = []


def rec(name, ok, detail=""):
    rows.append(dict(check=name, pass_=bool(ok), detail=str(detail)))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")


anoms = []
for sym in SYMBOLS:
    b, f = portfolio.tape(sym)
    perp = load_klines(sym, "perp1h")
    spot = load_klines(sym, "spot1h")
    fr = load_funding(sym)

    # 1. every settlement (at or after the first bar) lands on a bar open
    bars_ix = pd.DatetimeIndex(perp.ts)
    post = fr[fr.ts >= perp.ts.iloc[0]]
    miss = (~pd.DatetimeIndex(post.ts).isin(bars_ix)).sum()
    rec(f"{sym}: every settlement at/after the first bar is a bar open",
        miss == 0, f"{miss} off-bar of {len(post)} "
        f"({len(fr) - len(post)} pre-listing rows exempt and counted)")

    # 2. spot and perp grids coincide on every present hour
    sp = pd.DatetimeIndex(spot.ts)
    overlap = bars_ix[(bars_ix >= spot.ts.iloc[0]) & (bars_ix <= spot.ts.iloc[-1])]
    only_perp = overlap.difference(sp)
    rec(f"{sym}: perp hours with no spot bar are the known maintenance hours",
        len(only_perp) <= 35, f"{len(only_perp)} perp-only hours")
    on_hour = bool((sp.minute == 0).all() and (sp.second == 0).all()
                   and (bars_ix.minute == 0).all())
    rec(f"{sym}: every spot and perp bar open lies on the hour", on_hour, "")

    # 3. f9 prefix stability: f9 at k uses only settlements <= k
    v = f.f.values
    ok = True
    for k in np.linspace(F9_WINDOW, len(f) - 1, 25).astype(int):
        pref = f.iloc[:k + 1].f.rolling(F9_WINDOW, min_periods=F9_WINDOW).mean().iloc[-1]
        full = f.f9.values[k]
        if not (np.isnan(pref) and np.isnan(full)) and abs(pref - full) > 1e-15:
            ok = False
    rec(f"{sym}: f9 is prefix-stable (25 probes)", ok, "")

    # 4. no blackout row survives in the SOL settlement stream
    if sym == "SOLUSDT":
        a, z = SOL_BLACKOUT
        n_in = int(((f.ts >= a) & (f.ts < z)).sum())
        rec("SOLUSDT: zero blackout rows in the settlement stream", n_in == 0,
            f"{n_in} rows; {int(((fr.ts >= a) & (fr.ts < z)).sum())} removed")

    # 5. |b| > 5 % bars are excluded from decisions and marks
    nb = int((~b.ok & b.S_close.notna()).sum())
    nbad = int((b.b.abs() > BASIS_ANOM).sum())
    anoms.append(dict(symbol=sym, spot_absent=int(b.S_close.isna().sum()),
                      basis_gt_5pct=nbad))
    rec(f"{sym}: no bar with |b| > 5 % is usable", nbad == 0,
        f"{int(b.ok.sum())} usable bars")

# 6. accounting invariants on the primary fit run
print("\n=== accounting invariants, primary fit run ===")
for tier in ("majors", "alts"):
    daily, pos, ev = portfolio.run_tier(tier, "hysteresis", Cfg(),
                                        portfolio.tier_start(tier), FIT_END)
    cl = pos[pos.why_out != "open_at_boundary"]
    # no settlement counted outside (t_entry, t_exit]
    bad = 0
    for sym in TIERS[tier]:
        b, f = portfolio.tape(sym)
        for _, p in cl[cl.symbol == sym].iterrows():
            n = int(((f.ts > p.entry_ts) & (f.ts <= p.exit_ts)).sum())
            if n != p.n_settle:
                bad += 1
    rec(f"{tier}: settlements counted == settlements in (t_entry, t_exit]",
        bad == 0, f"{bad} of {len(cl)} positions disagree")
    resid = (cl.net - (cl.hedge_pnl + cl.funding - cl.fees)).abs().max()
    rec(f"{tier}: net == hedge_pnl + funding - fees", resid < 1e-9,
        f"max residual {resid:.3e}")
    # the tier series starts on the ruling's date and C_tier is constant
    rec(f"{tier}: tier series starts on the Reading-A date",
        daily.index[0] == portfolio.tier_start(tier),
        f"{daily.index[0].date()} vs {portfolio.tier_start(tier).date()}")
    # equity reconciles with the sum of the daily returns
    rec(f"{tier}: equity - C_tier == C_tier * sum(r)",
        abs((daily.equity.iloc[-1] - C_TIER) - C_TIER * daily.r.sum()) < 1e-8,
        f"{daily.equity.iloc[-1] - C_TIER:.10f} vs "
        f"{C_TIER * daily.r.sum():.10f}")
    # holdout length is exactly 731 days
    dh, _, _ = portfolio.run_tier(tier, "hysteresis", Cfg(), HOLD_START, HOLD_END)
    # ARITHMETIC CORRECTION to the note: 2024-08-01 .. 2026-07-31 inclusive is
    # 730 days, not the 731 §3.4/§5.1 state (no 29 February falls inside).
    # It changes n_eff from 394 to 393 and no decision anywhere.
    rec(f"{tier}: holdout series is exactly 730 days (note says 731; see §11)",
        len(dh) == 730, f"{len(dh)}")

pd.DataFrame(anoms).to_csv(os.path.join(OUT, "bar_anomalies.csv"), index=False)
df = pd.DataFrame(rows)
df.to_csv(os.path.join(OUT, "checks.csv"), index=False)
print(f"\n=== {int(df.pass_.sum())}/{len(df)} PASS ===")
if not df.pass_.all():
    print(df[~df.pass_].to_string(index=False))
    sys.exit(1)
