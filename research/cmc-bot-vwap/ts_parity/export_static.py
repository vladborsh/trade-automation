#!/usr/bin/env python3
"""Write the bot's `StaticDataSource` JSON for one parity chunk.

Both sides of the parity check must see byte-identical tape, otherwise a diff
measures the data feed rather than the port: this file is written from the very
parquet `engine.py` reads (Python `repr` floats round-trip exactly through
`JSON.parse`).

Chunk = one calendar month of evaluation minutes, [month start, next month
start - 1 min]; the file carries three extra days before it (so that the leading-row trim below, needed by
StaticDataSource.init, can never reach a Monday's 12h window) so the first
evaluation sees its full 12-hour window. Monthly chunking is exact, not an
approximation: every order is force-closed at the end of its day's alive
window, so no strategy state crosses a UTC midnight (engine asserts it).

    python ts_parity/export_static.py US100 2024-02
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import load_1m  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")


def chunk_bounds(month: str) -> tuple[pd.Timestamp, pd.Timestamp]:
    a = pd.Timestamp(month + "-01", tz="UTC")
    b = a + pd.offsets.MonthBegin(1) - pd.Timedelta("1min")
    return a, b


def chunk_bytes(sym: str, month: str, df: pd.DataFrame | None = None) -> bytes:
    a, b = chunk_bounds(month)
    df = load_1m(sym) if df is None else df
    w = df[(df.ts >= a - pd.Timedelta("3D")) & (df.ts <= b)].reset_index(drop=True)
    # StaticDataSource.init infers the interval from candles[1]-candles[0]
    while len(w) > 1 and int(w.t_ms.iloc[1] - w.t_ms.iloc[0]) != 60_000:
        w = w.iloc[1:].reset_index(drop=True)
    rows = [{"openTime": int(t), "open": float(o), "high": float(h), "low": float(l),
             "close": float(c), "volume": float(v)}
            for t, o, h, l, c, v in zip(w.t_ms, w.open, w.high, w.low, w.close, w.volume)]
    return json.dumps(rows).encode()


def main() -> None:
    sym, month = sys.argv[1], sys.argv[2]
    data = chunk_bytes(sym, month)
    os.makedirs(STATIC, exist_ok=True)
    path = os.path.join(STATIC, f"{sym}-{month}-m1.json")
    with open(path, "wb") as fh:
        fh.write(data)
    # the tape's fingerprint travels with the TypeScript events, so parity.py can
    # prove the Python side is diffed against the very same bytes
    os.makedirs(os.path.join(HERE, "events"), exist_ok=True)
    with open(os.path.join(HERE, "events", f"{sym}-{month}.sha256"), "w") as fh:
        fh.write(hashlib.sha256(data).hexdigest() + "\n")
    print(f"{path}: {len(data)} bytes")


if __name__ == "__main__":
    main()
