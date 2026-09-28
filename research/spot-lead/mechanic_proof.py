#!/usr/bin/env python3
"""MECHANIC-PROOF.md: ten fit trades across arms/tiers/exit causes, each with
its 4h observables, label, path exit and settlement ledger (DESIGN §8 step 3)."""
import numpy as np, pandas as pd
from common import Tape, LABELS, BAR_MIN, SYMBOLS, FIT_END
from engine import load_all, arm_trades

O, B = load_all()
picks = []
spec = [("L1", "BTCUSDT", "target"), ("L1", "SOLUSDT", "stop"), ("L1", "ETHUSDT", "time"),
        ("L1c", "XRPUSDT", "target"), ("L2", "ETHUSDT", "stop"), ("L2", "DOGEUSDT", "target"),
        ("L3", "BNBUSDT", "target"), ("L3", "ADAUSDT", "stop"), ("L4B", "LINKUSDT", "stop"),
        ("L1", "BTCUSDT", "boundary")]
lines = ["# MECHANIC-PROOF — spot-lead (fit period)", "",
         "Ten trades picked mechanically (first trade of the arm/symbol/exit-cause "
         "after 2023-01-01; `boundary` from whichever symbol has one), printed "
         "independently of the engine where it matters: the 4h CVD sums are re-summed "
         "from the minute arrays (checks.py §2 re-sums them from the raw parquet rows), "
         "the exit minute is re-found by a plain loop, and every settlement's R "
         "contribution is listed from the funding archive.", ""]
tapes = {}
for arm, sym, cause in spec:
    tr, _ = arm_trades(O, arm, "fit")
    g = tr[(tr.symbol == sym) & (tr.cause == cause)]
    if not len(g):                      # boundary exits are rare: any symbol
        g = tr[tr.cause == cause]
        sym = g.symbol.iloc[0]
    g2 = g[pd.DatetimeIndex(g.t_entry) >= pd.Timestamp("2023-01-01", tz="UTC")]
    r = (g2 if len(g2) else g).iloc[0]
    t = tapes.setdefault(sym, Tape(sym))
    b = B[(B.symbol == sym) & (B.bar == r.bar)].iloc[0]
    a, z = int(r.bar) * BAR_MIN, (int(r.bar) + 1) * BAR_MIN
    cs = np.nansum(2 * t.s["taker_buy_volume"][a:z] - t.s["volume"][a:z])
    cp = np.nansum(2 * t.p["taker_buy_volume"][a:z] - t.p["volume"][a:z])
    side = int(r.side)
    stop = r.entry - side * r.stop_dist
    tgt = r.entry + side * r.stop_dist
    # plain re-walk
    i = int(r.i0); found = None
    i_end = min(int(r.i0) + 7200, t.n, int(t.idx_of([FIT_END])[0]))
    while i < i_end:
        o, h, l = t.p["open"][i], t.p["high"][i], t.p["low"][i]
        if np.isfinite(o):
            if side > 0 and l <= stop: found = (i, "stop"); break
            if side < 0 and h >= stop: found = (i, "stop"); break
            if side > 0 and h >= tgt: found = (i, "target"); break
            if side < 0 and l <= tgt: found = (i, "target"); break
        i += 1
    f = t.funding_df
    led = f[(f.ts > r.t_entry) & (f.ts < r.t_exit)]
    lines += [f"## {arm} · {sym} · side {'long' if side > 0 else 'short'} · exit `{r.cause}`", "",
              f"- 4h bar {b['T']} → close **{b.t_close}**; perp close {b.close:.6g}, prev close "
              f"{b.close / (1 + b.ret):.6g}, ret_4h {b.ret:+.5f}, ATR {b.atr:.6g}, thr {b.thr:.5f}",
              f"- cvd_spot {b.cvd_spot:,.2f} (recomputed {cs:,.2f}), cvd_perp {b.cvd_perp:,.2f} "
              f"(recomputed {cp:,.2f}) → label **{LABELS[b.label]}**, shadow **{LABELS[b.label_sh] if b.label_sh >= 0 else '-'}**",
              f"- entry {r.entry:.6g}, 1R = 1.5·ATR = {r.stop_dist:.6g}, stop {stop:.6g}, target {tgt:.6g}",
              f"- engine exit: minute {t.ts_of([r.i_exit])[0]} @ {r.exit_px:.6g}; plain re-walk: "
              f"{(t.ts_of([found[0]])[0], found[1]) if found else 'no touch before 5 d / the fit boundary'}",
              f"- settlements in (entry, exit): {len(led)} (engine n_settle {r.n_settle})"]
    for _, fr in led.iterrows():
        j = int(t.idx_of([fr.ts])[0])
        px = t.p["open"][j]
        lines.append(f"  - {fr.ts} rate {fr.last_funding_rate:+.6f} × P {px:.6g} → "
                     f"{-side * fr.last_funding_rate * px / r.stop_dist:+.5f} R")
    lines += [f"- priceR {r.priceR:+.4f}, fundingR {r.fundingR:+.4f}, costR {r.costR:.4f} "
              f"(0.001×{r.entry:.6g}/{r.stop_dist:.6g}), **netR {r.netR:+.4f}**, hold {r.hold_h:.1f} h", ""]
open("MECHANIC-PROOF.md", "w").write("\n".join(lines))
print("\n".join(lines))
