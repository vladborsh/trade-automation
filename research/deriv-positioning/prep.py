#!/usr/bin/env python3
"""Build and cache the per-symbol 1h decision frame (DESIGN.md §1.4 + §2).

One row per 1h decision bar. Carries:

  * OHLCV + the v1/v2 indicator block (`strategies.prepare`), so
    `momentum_breakout` runs on exactly the frame v2 ran it on;
  * the **lagged** positioning snapshot (§1.4 alignment rule);
  * the derived, causal series of §2 (`dOI_4h`, `dOI_1h`, `crowd`, `taker`) as
    rolling 30-day percentiles;
  * the price-derived **shadows** of §5.3 (`ret4h`, `ret24h`, `vol` percentiles),
    built by the identical code path so the redundancy control differs from the
    real test in exactly one input;
  * `usable` / `usable_a` / `usable_b1` / `usable_b2` — the §1.2/§1.3 bar-level
    gate, per hypothesis (§1.3 scopes the drop rule to "that hypothesis").

Alignment rule (§1.4), stated precisely as implemented: a 1h bar labelled T
closes at T+1h, and may use a metrics row with `create_time` c only when
`T + 1h >= c + 5min`, i.e. `c <= T + 55min`. The bar takes the LAST such row.
That is one full metrics period of lag, mirroring the one-completed-bar HTF
discipline.

Usability (§1.2/§1.3): a bar is unusable if any of the twelve 5m metrics slots
covering [T, T+55min] is missing after the single-row forward fill, or belongs
to a gap longer than 5 minutes, or falls outside the symbol's metrics coverage.
Derived series additionally require their own lookback to be satisfied
(`dOI_4h` needs bar T-4 usable; percentiles need min_periods = 15 days).
"""
from __future__ import annotations
import os, sys, time
import numpy as np
import pandas as pd

import common as C


def _slots_ok(bar_ts: pd.Series, grid: pd.DataFrame, long_gap: np.ndarray) -> np.ndarray:
    """True where all 12 5m metrics slots of the 1h bar are present and clean."""
    ok_slot = grid[C.METRIC_COLS[0]].notna().to_numpy() & ~long_gap
    ser = pd.Series(ok_slot.astype(np.int8), index=grid.index)
    # count of good slots per left-labelled hour
    per_hour = ser.resample("1h").sum()
    m = pd.Series(bar_ts.dt.floor("h").to_numpy()).map(per_hour)
    return (m.fillna(0).to_numpy() >= 12)


def build(sym: str) -> pd.DataFrame:
    d5 = C.load_5m(sym)
    h = C.resample_h1(d5)
    d = C.st.prepare(h, C.P)                     # atr / z / rsi / structure block

    m = C.load_metrics(sym)
    grid, long_gap = C.metrics_grid(m)

    # ---- §1.4 alignment: last metrics row with create_time <= T + 55min
    src = grid.reset_index()
    merged = pd.merge_asof(
        d[["ts"]].assign(key=d.ts + pd.Timedelta(minutes=55)).sort_values("key"),
        src.rename(columns={"ts": "key"}).sort_values("key"),
        on="key", direction="backward")
    merged = merged.sort_values("ts").reset_index(drop=True)
    for c in C.METRIC_COLS:
        d[c] = merged[c].to_numpy()

    # ---- §1.2/§1.3 usability of the bar's own metrics window
    base_ok = _slots_ok(d.ts, grid, long_gap)
    cov = (d.ts >= grid.index[0]) & (d.ts + pd.Timedelta(hours=1) <= grid.index[-1] + pd.Timedelta(minutes=5))
    base_ok = base_ok & cov.to_numpy() & d[C.METRIC_COLS[0]].notna().to_numpy()
    d["metrics_ok"] = base_ok

    # ---- §2 derived series (all causal, all on the lagged snapshot)
    oi = d.sum_open_interest.where(base_ok)
    d["dOI_4h"] = oi / oi.shift(4) - 1.0
    d["dOI_1h"] = oi / oi.shift(1) - 1.0
    d.loc[~pd.Series(base_ok).shift(4, fill_value=False).to_numpy(), "dOI_4h"] = np.nan
    d.loc[~pd.Series(base_ok).shift(1, fill_value=False).to_numpy(), "dOI_1h"] = np.nan

    d["dOI_4h_pct"] = C.rolling_pct(d.dOI_4h)
    d["dOI_1h_pct"] = C.rolling_pct(d.dOI_1h)
    d["crowd"] = C.rolling_pct(d.sum_toptrader_long_short_ratio.where(base_ok))
    d["taker"] = C.rolling_pct(d.sum_taker_long_short_vol_ratio.where(base_ok))
    # diagnostics only (§2): the other two ratios, recorded, never swept
    d["crowd_acct"] = C.rolling_pct(d.count_toptrader_long_short_ratio.where(base_ok))
    d["crowd_global"] = C.rolling_pct(d.count_long_short_ratio.where(base_ok))

    # ---- §5.3 price-derived shadows, identical code path, price inputs
    d["ret4h"] = d.close / d.close.shift(4) - 1.0
    d["ret24h"] = d.close / d.close.shift(24) - 1.0
    d["ret4h_pct"] = C.rolling_pct(d.ret4h)
    d["ret24h_pct"] = C.rolling_pct(d.ret24h)
    d["vol_pct"] = C.rolling_pct(d.volume)

    # ---- bar gates. §1.3 speaks of bars unusable "for that hypothesis", so the
    # gate is PER HYPOTHESIS: the top-trader ratio columns start later than OI in
    # the archive (see results/data_audit_columns.csv), and there is no reason for
    # a column hypothesis (a) never touches to cost hypothesis (a) any sample.
    base = (d.metrics_ok & d.atr.notna() & d.z.notna()).to_numpy()
    d["usable"] = base                                   # shared/base gate
    d["usable_a"] = base & d.dOI_4h_pct.notna().to_numpy()
    d["usable_a1"] = base & d.dOI_1h_pct.notna().to_numpy()
    d["usable_b1"] = base & d.crowd.notna().to_numpy()
    d["usable_b2"] = base & d.taker.notna().to_numpy()
    # the §5.3 shadows are evaluated on the SAME bar set as the rule they shadow,
    # so a price series that happens to be available earlier cannot buy sample.
    d["symbol"] = sym
    return d


def path(sym: str) -> str:
    return os.path.join(C.CACHE, f"{sym}-h1.pkl")


def get(sym: str) -> pd.DataFrame:
    f = path(sym)
    if os.path.exists(f):
        return pd.read_pickle(f)
    d = build(sym)
    d.to_pickle(f)
    return d


if __name__ == "__main__":
    syms = sys.argv[1].split(",") if len(sys.argv) > 1 else C.SYMBOLS
    for s in syms:
        t = time.time()
        d = get(s)
        print(f"{s}: {len(d)} 1h bars {d.ts.iloc[0].date()}..{d.ts.iloc[-1].date()}  "
              f"metrics_ok {d.metrics_ok.mean():.1%}  usable a/b1/b2 "
              f"{d.usable_a.mean():.1%}/{d.usable_b1.mean():.1%}/{d.usable_b2.mean():.1%}  "
              f"{time.time()-t:.1f}s", flush=True)
