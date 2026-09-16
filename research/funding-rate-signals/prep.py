"""Per-symbol frames: 1h bars, the settlement grid, fpct / spct, dATR (DESIGN §1, §5).

Nothing here computes an R.  It builds the two aligned objects the engine
consumes:

  bars         DatetimeIndex of 1h OPEN times -> open/high/low/close/atr14/datr
  settlements  DatetimeIndex of the 8h GRID (present AND missing slots) ->
               f, present, fpct, spct, extreme flags, shadow flags
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd

from common import (DATA, CACHE, SYMBOLS, PCT_WINDOW, PCT_MINP, PCT_HI, PCT_LO,
                    FLOOR, RET_BARS, B_LOOKBACK, WARMUP_DAYS,
                    load_funding, load_klines, settlement_grid,
                    wilder_atr, daily_atr, rolling_pct_rank)

# Architect ruling of 2026-09-16 (DESIGN §5.6): SOLUSDT ran on a 4h then 2h
# funding interval during the FTX week.  The span is an interval-anomaly
# blackout; it is filled in from the ruling, never guessed.
BLACKOUT = {}          # symbol -> (start, end) inclusive, set by ruling


def build_symbol(sym: str, shadow_ret_bars: int = RET_BARS):
    kl = load_klines(sym).set_index("ts")
    fu = load_funding(sym)

    # ---- bars -------------------------------------------------------------
    bars = kl[["open", "high", "low", "close"]].copy()
    bars["atr14"] = wilder_atr(bars["high"], bars["low"], bars["close"], 14)
    d = daily_atr(kl.reset_index(), 14)
    bars["datr"] = pd.Series(bars.index.date, index=bars.index).map(d).astype(float)
    # B geometry, all strictly prior-bar (labelled by open time T)
    bars["low12_prior"] = bars["low"].rolling(B_LOOKBACK).min().shift(1)
    bars["high12_prior"] = bars["high"].rolling(B_LOOKBACK).max().shift(1)
    bars["high12_incl"] = bars["high"].rolling(B_LOOKBACK + 1).max()
    bars["low12_incl"] = bars["low"].rolling(B_LOOKBACK + 1).min()
    bars["ret24_bar"] = bars["close"] / bars["close"].shift(RET_BARS) - 1.0
    # a bar is usable only if the whole lookback it needs is contiguous
    full = pd.date_range(bars.index[0], bars.index[-1], freq="1h", tz="UTC")
    present = pd.Series(True, index=bars.index).reindex(full, fill_value=False)
    bars = bars.reindex(full)
    bars["present"] = present
    bars["contig25"] = present.rolling(RET_BARS + 1).min().astype(float) == 1.0

    # ---- settlement grid --------------------------------------------------
    iv = int(fu["funding_interval_hours"].mode().iloc[0])
    grid = settlement_grid(fu["ts"].iloc[0], fu["ts"].iloc[-1], iv)
    s = pd.DataFrame(index=grid)
    fs = fu.set_index("ts")["last_funding_rate"]
    fs = fs[~fs.index.duplicated(keep="last")]
    s["f"] = fs.reindex(grid)                      # missing slot -> NaN
    s["present"] = s["f"].notna()
    s["interval"] = fu.set_index("ts")["funding_interval_hours"].reindex(grid)

    # price AT the settlement instant = close of the bar ENDING at t_k, i.e.
    # the bar opening at t_k - 1h.  Strictly known at t_k, exactly like f_k.
    close_at = bars["close"].reindex(grid - pd.Timedelta(hours=1)).values
    close_at_lag = bars["close"].reindex(
        grid - pd.Timedelta(hours=1 + shadow_ret_bars)).values
    s["px_at"] = close_at
    s["ret_shadow"] = close_at / close_at_lag - 1.0
    # funding notional mark: OPEN of the 1h bar opening at t_j (DESIGN §4.1)
    s["mark"] = bars["open"].reindex(grid).values

    s["fpct"] = rolling_pct_rank(s["f"], PCT_WINDOW, PCT_MINP)
    s["spct"] = rolling_pct_rank(s["ret_shadow"], PCT_WINDOW, PCT_MINP)

    s["ext_pos"] = (s["fpct"] >= PCT_HI) & (s["f"] >= FLOOR)
    s["ext_neg"] = (s["fpct"] <= PCT_LO) & (s["f"] <= -FLOOR)
    s["sh_pos"] = (s["spct"] >= PCT_HI) & (s["ret_shadow"] > 0)
    s["sh_neg"] = (s["spct"] <= PCT_LO) & (s["ret_shadow"] < 0)

    # coverage start = max(first funding row, first 1h bar); warm-up 15 days
    cov = max(fu["ts"].iloc[0], bars.index[0])
    s["warm"] = s.index >= cov + pd.Timedelta(days=WARMUP_DAYS)

    # interval-anomaly blackout (Architect ruling, DESIGN §5.6)
    s["blackout"] = False
    if sym in BLACKOUT:
        a, b = BLACKOUT[sym]
        s.loc[(s.index >= a) & (s.index <= b), "blackout"] = True

    s.attrs["symbol"] = sym
    bars.attrs["symbol"] = sym
    return bars, s


def build_all(symbols=SYMBOLS, shadow_ret_bars: int = RET_BARS):
    return {s: build_symbol(s, shadow_ret_bars) for s in symbols}
