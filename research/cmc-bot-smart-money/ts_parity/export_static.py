#!/usr/bin/env python3
"""Write the bot's `StaticDataSource` JSON for a parity window.

Both sides of the parity check must see **byte-identical tape**, otherwise a
diff measures the data feed rather than the port. So the TypeScript is fed the
same Binance USD-M archive rows this project pulled (`fetch_1m.py`), and the H1
file is the same resample `common.resample_1h` produces — never a separate H1
pull, which could disagree with the 1m frame at a boundary.

    python ts_parity/export_static.py BTCUSDT 2024-11-01 2024-12-20
"""
from __future__ import annotations

import json
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import H1_BIAS_MS, WINDOW_MS, load_1m, resample_1h  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def dump(df: pd.DataFrame, path: str) -> None:
    ms = pd.DatetimeIndex(df.ts).asi8 // 1_000_000
    rows = [{"openTime": int(t), "open": float(o), "high": float(h),
             "low": float(l), "close": float(c), "volume": float(v)}
            for t, o, h, l, c, v in zip(ms, df.open, df.high, df.low, df.close, df.volume)]
    with open(path, "w") as fh:
        json.dump(rows, fh)
    print(f"{path}: {len(rows)} bars  {df.ts.iloc[0]} .. {df.ts.iloc[-1]}")


def main() -> None:
    sym, start, end = sys.argv[1], pd.Timestamp(sys.argv[2], tz="UTC"), pd.Timestamp(sys.argv[3], tz="UTC")
    m1 = load_1m(sym)
    h1 = resample_1h(m1)
    # the bot asks for [t-12h, t] on M1 and [t-720h, t] on H1, so the files must
    # start that far before the first evaluated bar.
    m1w = m1[(m1.ts >= start - pd.Timedelta(WINDOW_MS, "ms") - pd.Timedelta("1d")) & (m1.ts <= end)]
    h1w = h1[(h1.ts >= start - pd.Timedelta(H1_BIAS_MS, "ms") - pd.Timedelta("1d")) & (h1.ts <= end)]
    tag = f"{sym}-{sys.argv[2]}-{sys.argv[3]}"
    dump(m1w, os.path.join(HERE, f"{tag}-m1.json"))
    dump(h1w, os.path.join(HERE, f"{tag}-h1.json"))


if __name__ == "__main__":
    main()
