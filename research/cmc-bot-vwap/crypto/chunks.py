#!/usr/bin/env python3
"""Chunk plan for the crypto TypeScript parity battery.

win: calendar months (exact — every order is force-closed each day).
all: the 24/7 condition never force-closes, so a chunk may only start at a UTC
     midnight where no order is open AND nothing closed earlier that day (the
     daily caps count same-day closes). Candidates come from a full Python
     24/7 run; `parity.py` then independently requires the TypeScript to end
     every chunk with the same number of open orders (0), so a boundary the
     port chose wrongly surfaces as a discrepancy instead of hiding one.

    python crypto/chunks.py BTCUSDT   -> data/chunks_<SYM>_{win,all}.txt
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
sys.path.insert(0, PKG)
from common import DAY_MS, load_1m, ms  # noqa: E402
import engine  # noqa: E402

TARGET_DAYS = 7


def main() -> None:
    sym = sys.argv[1]
    df = load_1m(sym)
    first = df.ts.iloc[0].normalize(); last = df.ts.iloc[-1].normalize() + pd.Timedelta("1D")
    months = [p.strftime("%Y-%m") for p in pd.period_range(first.tz_localize(None), (last - pd.Timedelta("1D")).tz_localize(None), freq="M")]
    P = engine.prepare(sym, df)
    tr, _, _ = engine.run(P, ms(first), ms(last) - 60_000, timing=engine.ALWAYS, record_components=False)
    days = np.arange(ms(first), ms(last) + 1, DAY_MS, dtype=np.int64)
    ok = np.ones(len(days), bool)
    for r in tr.itertuples():
        a = r.entry_ts - 60_000                                  # signal bar
        b = r.exit_ts if r.closed else ms(last)
        # an order open across midnight d blocks d; a close on day d-1... blocks nothing,
        # but a close on day d before the boundary cannot happen (boundary is 00:00)
        lo = np.searchsorted(days, a, "right"); hi = np.searchsorted(days, b, "right")
        ok[lo:hi] = False
    cuts = [0]
    while cuts[-1] < len(days) - 1:
        want = cuts[-1] + TARGET_DAYS
        if want >= len(days) - 1:
            cuts.append(len(days) - 1); break
        j = want
        while j < len(days) - 1 and not ok[j]:
            j += 1
        cuts.append(j)
    chunks = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        d = pd.Timestamp(days[a], unit="ms").strftime("%Y-%m-%d")
        chunks.append(f"{d}+{b - a}")
    with open(os.path.join(PKG, "data", f"chunks_{sym}_all.txt"), "w") as fh:
        fh.write("\n".join(f"{sym} {c} all" for c in chunks) + "\n")
    with open(os.path.join(PKG, "data", f"chunks_{sym}_win.txt"), "w") as fh:
        fh.write("\n".join(f"{sym} {m} win" for m in months) + "\n")
    lens = [int(c.split("+")[1]) for c in chunks]
    print(sym, "orders 24/7:", len(tr), "| all-chunks:", len(chunks), "days min/median/max", min(lens), int(np.median(lens)), max(lens),
          "| win months:", len(months))


if __name__ == "__main__":
    main()
