#!/usr/bin/env python3
"""`DESIGN.md` §3.6's robustness annex — **descriptive, non-gating, fit period
only**.

§3.6 records an erratum in Architect note §5.3 and applies the note's own
operative clause: E2 excludes the 12 triggered days per instrument on which
`dATR14` is undefined (the Wilder ATR(14) warm-up at the start of the tape),
while E0 and E1 keep the full list and stay byte-identical to the short pass's
own `US100-OR5` / `US500-OR5` table. That is "reading A".

The alternative the Architect was offered, "reading B", was to drop those 12
days from **all six** arms so that all six trade one identical list. Reading B
would have changed E0's and E1's fit numbers too, and could in principle have
moved a marginal fit screen — which is the only way this erratum could have
changed which arms touched the holdout.

This script computes the fit-period mean net R of all six arms under **both**
readings and reports whether the screen's mean-R condition would have flipped
for any arm. It reads **no holdout number**, no verdict reads it, and it is
produced for auditability only.

    python erratum_annex.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import features as F  # noqa: E402


def main() -> None:
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    q = q[q.period == "fit"]
    rows = []
    for sym in C.INSTRUMENTS:
        db = F.DayBars.get(sym)
        warm = {d for d in q[q.symbol == sym].date.unique() if db.prior(d) is None}
        for k in C.CONSTRUCTIONS:
            arm = C.arm_name(sym, k)
            g = q[q.arm == arm]
            b = g[~g.date.isin(warm)]
            mA, mB = float(g.netR.mean()), float(b.netR.mean())
            rows.append(dict(
                arm=arm, construction=k,
                n_readingA=len(g), mean_netR_readingA=mA,
                n_readingB=len(b), mean_netR_readingB=mB,
                delta=mB - mA,
                screen_mean_ok_readingA=bool(mA >= C.SCREEN_MEAN),
                screen_mean_ok_readingB=bool(mB >= C.SCREEN_MEAN),
                screen_mean_condition_would_flip=bool(
                    (mA >= C.SCREEN_MEAN) != (mB >= C.SCREEN_MEAN))))
    t = pd.DataFrame(rows)
    t.to_csv(os.path.join(C.RESULTS, "fit_erratum_annex.csv"), index=False)
    pd.set_option("display.width", 240)
    print("=== DESIGN §3.6 robustness annex — FIT PERIOD ONLY, non-gating ===")
    print("reading A (applied): E2 excludes the dATR warm-up days; E0/E1 keep "
          "the full list")
    print("reading B (declined): all six arms drop those days\n")
    print(t.to_string(index=False))
    n = int(t.screen_mean_condition_would_flip.sum())
    print(f"\narms whose screen mean-R condition would flip under reading B: {n}")
    if n == 0:
        print("=> the erratum's resolution CANNOT have changed which arms "
              "touched the holdout.")


if __name__ == "__main__":
    main()
