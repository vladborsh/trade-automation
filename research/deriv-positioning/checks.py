#!/usr/bin/env python3
"""Causality + wiring checks. Run before trusting any result in this package.

Same role as `intraday-mtf-smc/checks.py` and `pivot-structure/checks.py`: the
merge of a slower, externally-timed series onto decision bars is exactly where a
package like this leaks the future, so it gets checked directly rather than
assumed.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
import prep
import signals as S

SYM = "BTCUSDT"
d = prep.get(SYM)
m = C.load_metrics(SYM).set_index("ts")

# ---------------------------------------------------------------- 1. alignment
# Every bar's carried snapshot must be a metrics row with create_time <= T+55min,
# and it must be the LAST such row. Checked against the raw file, not the grid.
rng = np.random.default_rng(0)
idx = rng.choice(np.arange(5000, len(d)), 4000, replace=False)
late = stale = 0
for i in idx:
    t = d.ts.iloc[i]
    v = d.sum_open_interest.iloc[i]
    if not np.isfinite(v):
        continue
    cut = t + pd.Timedelta(minutes=55)
    sub = m.loc[:cut, "sum_open_interest"].dropna()
    if len(sub) == 0:
        continue
    if not np.isclose(v, sub.iloc[-1]):
        # allowed only when the last raw row was inside a >5min gap and the
        # single-row forward fill supplied an older value
        stale += 1
    fut = m.loc[cut + pd.Timedelta(minutes=5):, "sum_open_interest"].dropna()
    if len(fut) and np.isclose(v, fut.iloc[0]) and not np.isclose(v, sub.iloc[-1]):
        late += 1
print(f"check1 alignment: uses a FUTURE metrics row in {late}/4000 sampled bars "
      f"(must be 0); differs from last-eligible raw row in {stale}/4000 (gap ffill)")

# 2. the carried value must not equal the concurrent-hour-end snapshot always,
#    i.e. we are genuinely one metrics period behind at the decision point.
cut_now = d.ts + pd.Timedelta(hours=1)
nxt = pd.merge_asof(pd.DataFrame({"key": cut_now}),
                    m.reset_index()[["ts", "sum_open_interest"]].rename(
                        columns={"ts": "key", "sum_open_interest": "concurrent"}),
                    on="key", direction="backward")
same = int(np.isclose(d.sum_open_interest.to_numpy(),
                      nxt.concurrent.to_numpy(), equal_nan=False).sum())
print(f"check2 equals the T+60min snapshot in {same}/{len(d)} bars "
      f"(must be well below n: OI moves every 5m, so the lag is real)")

# 3. prefix stability. Two levels:
#    (3a) the derived percentile series must be recomputable identically from a
#         truncated input — this is the real test of the rolling windows;
#    (3b) every signal frame must be identical on the prefix.
cut = 20000
sub = d.iloc[:cut].reset_index(drop=True)
for raw, pct in (("dOI_4h", "dOI_4h_pct"), ("sum_toptrader_long_short_ratio", "crowd"),
                 ("sum_taker_long_short_vol_ratio", "taker"),
                 ("ret4h", "ret4h_pct"), ("ret24h", "ret24h_pct"), ("volume", "vol_pct")):
    a = C.rolling_pct(d[raw]).to_numpy()[:cut]
    b = C.rolling_pct(sub[raw]).to_numpy()
    same = np.allclose(a, b, equal_nan=True)
    print(f"check3a {pct:12s} rolling-percentile prefix-stability: {same}")

mb_full = S.momentum_breakout(d).sig.to_numpy()[:cut]
mb_sub = S.momentum_breakout(sub).sig.to_numpy()
print(f"check3b momentum_breakout prefix-stability: {bool((mb_full == mb_sub).all())}")
for name in S.EVENTS:
    f = S.build_event(d, name).sig.to_numpy()[:cut]
    g = S.build_event(sub, name).sig.to_numpy()
    print(f"check3b {name:14s} prefix-stability: {bool((f == g).all())}")

# 4. tercile cut is a fixed cut on a trailing percentile, so it too is prefix-stable
tf = S.tercile(d.dOI_4h_pct.to_numpy())[:cut]
tg = S.tercile(sub.dOI_4h_pct.to_numpy())
print(f"check4 ΔOI tercile prefix-stability: {bool((tf == tg).all())}")

# 5. frequency + side sanity, fit window, usable bars only
yrs = (d.ts.iloc[-1] - d.ts.iloc[0]).total_seconds() / (365 * 86400)
for name in S.EVENTS:
    gate = "usable_b1" if name.startswith("b1") else "usable_b2"
    s = S.build_event(d, name).sig.to_numpy() * d[gate].to_numpy()
    n = int((s != 0).sum())
    print(f"check5 {name:14s} {n:>5} raw events ({n/yrs:6.1f}/yr) "
          f"long share {float((s == 1).sum()/max(1, n)):.2f}")

# 6. the engine agrees with the signal frame on trade count order of magnitude
sig = S.momentum_breakout(d)
r = C.bt.run(d, sig[["sig", "stop", "target"]], C.P["time_stop"])
print(f"check6 engine trades {len(r['trades'])} from {int((sig.sig!=0).sum())} raw "
      f"signals; expectancy_R {r['trades'].r.mean():+.4f} "
      f"(v2 reports momentum_breakout as the one gross-positive rule-set)")

# 7. no NaN leakage into signals on unusable bars
for name in S.EVENTS:
    gate = "usable_b1" if name.startswith("b1") else "usable_b2"
    s = S.build_event(d, name).sig.to_numpy()
    bad = int(((s != 0) & ~d[gate].to_numpy()).sum())
    print(f"check7 {name:14s} signals on UNUSABLE bars: {bad} (must be 0)")
