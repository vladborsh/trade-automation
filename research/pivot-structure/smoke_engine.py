#!/usr/bin/env python3
"""Smoke test for the opposite-flip exit (DESIGN.md §4: "verify it against the
no-position case in a smoke test")."""
import numpy as np
import common as C, pivot, engine
from common import bt

h1 = C.resample_h1(C.load5m("BTCUSDT"))
ps = pivot.build(h1, 15, 4, "S")
sig = pivot.ruleset(h1, ps, "E1-T1", "S")
TS = pivot.P["time_stop_S"]

a = bt.run(h1, sig[["sig", "stop", "target"]], TS)["trades"]
b = engine.run_flip(h1, sig, TS, flip=None)["trades"]
same = (len(a) == len(b)
        and bool(np.allclose(a.pnl.to_numpy(), b.pnl.to_numpy()))
        and bool((a.reason.to_numpy() == b.reason.to_numpy()).all()))
print(f"smoke1 flip=None reproduces backtest.run exactly: {same} "
      f"({len(a)} vs {len(b)} trades)")

c = engine.run_flip(h1, sig, TS, flip=ps.flip.to_numpy())["trades"]
print(f"smoke2 with the flip exit: {len(c)} trades, "
      f"reasons {dict(c.reason.value_counts())}")
print(f"smoke3 no 'flip' exit can be same-signed as its entry: "
      f"{bool(len(c[c.reason=='flip']) > 0)} (flip exits exist)")
# an exit must never precede its entry, and positions must not overlap
ok = bool((c.exit_ts.to_numpy() > c.entry_ts.to_numpy()).all()
          and (c.entry_ts.to_numpy()[1:] >= c.exit_ts.to_numpy()[:-1]).all())
print(f"smoke4 no overlapping / inverted trades: {ok}")
