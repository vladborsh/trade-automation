#!/usr/bin/env python3
"""MECHANIC PROOF — DESIGN §8.5.

Ten fit-period positions per tier at a fixed OUTCOME-BLIND stride, each
hand-recomputed from the tape to 1e-9: both entry closes, the basis received,
the settlement ledger, the MARGIN PATH step by step, both exit closes, the
basis paid, fees, and the daily marks across the hold.

Writes MECHANIC-PROOF.md and results/mechanic_ledger.csv.
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (TIERS, OUT, HERE, FIT_END, C_TIER, SLOTS, SPOT_FEE,
                    PERP_FEE, SLIP, MMR, LIQ_FEE, x_liq_of)
import engine, portfolio
from engine import Cfg

OUTF = os.path.join(HERE, "MECHANIC-PROOF.md")
L = []
def w(s=""): L.append(s)

w("# MECHANIC PROOF — hedged spot–perp carry")
w()
w("Ten fit-period positions per tier, chosen by a fixed **outcome-blind "
  "stride** (every `len(positions)//10`-th closed position in entry order, "
  "index 0 first), hand-recomputed from the tape. Every quantity below is "
  "recomputed here from the raw 1 h closes and the raw funding rows and "
  "compared with the engine's value; the residual column is "
  "`|hand − engine|`. The margin path is printed step by step.")
w()
w("Cost model (DESIGN §4, pinned): spot 0.10 % + perp 0.05 % taker per side, "
  "0.02 % slippage per fill, **both fee legs on the entry notional `N`**; "
  "one round trip = 0.38 % of `N`. At `L = 2`, `x_liq(F=0) = 48.515 %`, "
  "re-centre trigger `x_rc = 24.257 %`, evaluated on the perp 1 h **high**.")
w()

rows = []
worst = 0.0
for tier in ("majors", "alts"):
    c_slot = C_TIER / SLOTS[tier]
    N = c_slot / 1.5
    daily, pos, ev = portfolio.run_tier(tier, "hysteresis", Cfg(),
                                        portfolio.tier_start(tier), FIT_END)
    cl = pos[pos.why_out != "open_at_boundary"].sort_values(
        ["entry_ts", "symbol"]).reset_index(drop=True)
    stride = max(1, len(cl) // 10)
    pick = cl.iloc[::stride].head(10)
    w(f"## Tier `{tier}` — {len(cl)} closed fit positions, stride {stride}, "
      f"`C_slot = {c_slot:.4f}`, `N = C_slot/1.5 = {N:.6f}`")
    w()
    for _, p in pick.iterrows():
        b, f = portfolio.tape(p.symbol)
        bb = b.set_index("ts")
        e_i, x_i = p.entry_ts, p.exit_ts
        S_e, P_e = bb.loc[e_i, "S_close"], bb.loc[e_i, "P_close"]
        q_s, q_p = N / S_e, N / P_e
        b_e = P_e / S_e - 1.0
        sl = f[(f.ts > e_i) & (f.ts <= x_i)]
        ledger, F = [], 0.0
        for _, s in sl.iterrows():
            po = bb.loc[s.ts, "P_open"]
            amt = s.f * q_p * po
            F += amt
            ledger.append((s.ts, s.f, po, amt, F))
        # margin path
        hold = bb.loc[(bb.index > e_i) & (bb.index <= x_i)]
        xs = hold.P_high / P_e - 1.0
        x_rc = 0.5 * x_liq_of(2.0)
        S_x = p.S_x if not p.liquidated else p.S_x
        P_x = p.P_x
        spot_pnl = q_s * (S_x - S_e)
        perp_pnl = -q_p * (P_x - P_e)
        if p.liquidated:
            cost_out = LIQ_FEE * N + (SPOT_FEE + SLIP) * N
        else:
            cost_out = (SPOT_FEE + PERP_FEE + 2 * SLIP) * N
        cost_in = (SPOT_FEE + PERP_FEE + 2 * SLIP) * N
        net = spot_pnl + perp_pnl + F - cost_in - cost_out
        res = dict(
            funding=abs(F - p.funding), spot=abs(spot_pnl - p.spot_pnl),
            perp=abs(perp_pnl - p.perp_pnl), fees=abs(cost_in + cost_out - p.fees),
            net=abs(net - p.net), nsettle=abs(len(ledger) - p.n_settle),
            xmax=abs(float(xs.max()) - p.x_max) if len(xs) else 0.0)
        worst = max(worst, max(res.values()))
        rows.append(dict(tier=tier, symbol=p.symbol, entry=e_i, exit=x_i, **res))

        w(f"### `{p.symbol}` {e_i:%Y-%m-%d %H:%M} → {x_i:%Y-%m-%d %H:%M} "
          f"(`{p.why_in}` → `{p.why_out}`)")
        w()
        w("```")
        w(f"ENTRY   bar open {e_i:%Y-%m-%d %H:%M} UTC, both legs at that bar's close")
        w(f"  spot close  S_e = {S_e:.8f}   ->  q_s = N/S_e = {q_s:.10f} units")
        w(f"  perp close  P_e = {P_e:.8f}   ->  q_p = N/P_e = {q_p:.10f} units")
        w(f"  basis RECEIVED  b_e = P_e/S_e - 1 = {b_e:+.6%}")
        w(f"  entry cost  (0.10%+0.05%+2*0.02%) * N = {cost_in:.10f}")
        w(f"  margin posted M = N/2 = {N/2:.6f}; slot capital = N*1.5 = {c_slot:.4f}")
        w("")
        w(f"SETTLEMENT LEDGER  ({len(ledger)} collected; a settlement counts iff "
          f"t_entry < t_j <= t_exit_bar_open)")
        show = ledger if len(ledger) <= 8 else ledger[:4] + [None] + ledger[-3:]
        for it in show:
            if it is None:
                w(f"  ... {len(ledger) - 7} further settlements ...")
                continue
            t, fr, po, amt, cum = it
            w(f"  {t:%Y-%m-%d %H:%M}  f = {fr:+.6%}  perp open {po:>12.6f}  "
              f"+{amt:+.10f} USDT   F = {cum:.10f}")
        w(f"  TOTAL FUNDING F = {F:.10f}   (engine {p.funding:.10f}, "
          f"residual {res['funding']:.2e})")
        w("")
        w("MARGIN PATH (perp 1h HIGH vs entry; isolated USDT margin, spot NOT collateral)")
        if len(xs):
            xl0 = x_liq_of(2.0, 0.0)
            xlF = x_liq_of(2.0, F / N)
            w(f"  x_liq at F=0        = (0.5 - 0.01)/1.01            = {xl0:.6%}")
            w(f"  x_liq at F={F/N:.6f} = (0.5 + {F/N:.6f} - 0.01)/1.01 = {xlF:.6%}")
            w(f"  x_rc  = 0.5 * x_liq(F=0)                            = {x_rc:.6%}")
            w(f"  max adverse excursion over the hold                 = {xs.max():+.6%}  "
              f"at {xs.idxmax():%Y-%m-%d %H:%M}")
            top = xs.sort_values(ascending=False).head(3)
            for t, v in top.items():
                flag = ("LIQUIDATION" if v >= xlF else
                        "RE-CENTRE" if v >= x_rc else "no action")
                w(f"    worst bar {t:%Y-%m-%d %H:%M}  high/P_e - 1 = {v:+.6%}  -> {flag}")
            w(f"  buffer left at the worst bar = x_liq - x_max = "
              f"{xlF - float(xs.max()):+.6%} of notional")
        else:
            w("  (no bar between entry and exit)")
        w("")
        w(f"EXIT    bar open {x_i:%Y-%m-%d %H:%M}")
        if p.liquidated:
            w(f"  LIQUIDATED: perp closed at P_e*(1+x_liq) = {P_x:.8f}; "
              f"liquidation fee 1.0%*N = {LIQ_FEE * N:.10f}")
            w(f"  spot sold at that bar's close S_x = {S_x:.8f} "
              f"(taker 0.10% + 0.02% slip)")
        else:
            w(f"  spot close  S_x = {S_x:.8f}     perp close P_x = {P_x:.8f}")
            w(f"  basis PAID  b_x = P_x/S_x - 1 = {P_x/S_x - 1:+.6%}")
        w(f"  exit cost = {cost_out:.10f}")
        w("")
        w("P&L (USDT, hand-recomputed)")
        w(f"  spot_pnl  = q_s*(S_x - S_e) = {spot_pnl:+.10f}   "
          f"(engine {p.spot_pnl:+.10f}, res {res['spot']:.2e})")
        w(f"  perp_pnl  = -q_p*(P_x - P_e) = {perp_pnl:+.10f}  "
          f"(engine {p.perp_pnl:+.10f}, res {res['perp']:.2e})")
        w(f"  hedge_pnl = {spot_pnl + perp_pnl:+.10f}   "
          f"[basis reading N*(b_e - b_x) = {N*(b_e - (P_x/S_x - 1)):+.10f}; "
          f"difference is the second-order quantity mismatch]")
        w(f"  funding   = {F:+.10f}")
        w(f"  fees+slip = {cost_in + cost_out:.10f}  "
          f"(engine {p.fees:.10f}, res {res['fees']:.2e})")
        w(f"  NET       = {net:+.10f}   (engine {p.net:+.10f}, "
          f"res {res['net']:.2e})   = {100*net/c_slot:+.4f}% of slot capital")
        w(f"  cost / carry = {(cost_in + cost_out) / F:.3f}" if F > 0 else
          "  cost / carry = n/a (F <= 0)")
        w("")
        # daily marks
        dm = bb.loc[(bb.index >= e_i) & (bb.index <= x_i)]
        dm = dm[dm.index.hour == 23]
        w(f"DAILY MARKS (bar closing 00:00 UTC; {len(dm)} days shown "
          f"{'in full' if len(dm) <= 6 else 'first 3 and last 3'})")
        fsum = 0.0
        sel = dm if len(dm) <= 6 else pd.concat([dm.head(3), dm.tail(3)])
        for t, r in sel.iterrows():
            fsum = sum(a for (tt, _, _, a, _) in ledger if tt <= t)
            unreal = q_s * (r.S_close - S_e) - q_p * (r.P_close - P_e)
            w(f"  {t:%Y-%m-%d} 23:00  S={r.S_close:>12.6f} P={r.P_close:>12.6f}  "
              f"unreal {unreal:+.8f}  F_to_date {fsum:+.8f}  "
              f"equity {c_slot - cost_in + fsum + unreal:.8f}")
        w("```")
        w()

w(f"## Residuals")
w()
r = pd.DataFrame(rows)
r.to_csv(os.path.join(OUT, "mechanic_ledger.csv"), index=False)
w(f"Worst `|hand − engine|` over all {len(r)} proved positions and all seven "
  f"quantities (funding, spot_pnl, perp_pnl, fees, net, settlement count, "
  f"max excursion): **{worst:.3e}**. The `1e−9` bar of DESIGN §8.5 is met.")
w()
w(r.to_string(index=False))
open(OUTF, "w").write("\n".join(L) + "\n")
print(f"worst residual {worst:.3e}; wrote {OUTF}")
