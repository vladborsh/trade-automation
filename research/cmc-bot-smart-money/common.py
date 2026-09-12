"""Shared plumbing for the `cmc-bot` smart-money ICT pass — **Stage 0**.

Canonical spec: `ARCHITECT-NOTE.md` (this package) and
`knowledge/smart-money-ict.md`. The TypeScript under `cmc-bot-main/src/` is the
*operational* spec: where the prose and the code disagree, the code wins and
the difference gets a row in `PARITY.md`.

Stage 0 computes **no** performance number — no R, no win rate, no expectancy.
This file therefore carries no cost model and no measurement units; those
arrive with `DESIGN.md` in Stage 1, if the Architect greenlights one.

Data (ARCHITECT-NOTE §5.3): Binance USD-M **perpetual** 1-minute klines pulled
from the public `data.binance.vision` monthly archive by `fetch_1m.py`, which
is a thin wrapper over `research/intraday-mr-smc/fetch_data.py`. The 1h frame
used by the H1 bias is **resampled from that same 1m frame** (house convention,
`research/intraday-mtf-smc/fetch_mtf.py`) — never pulled separately.

Host-timezone pin (`knowledge/smart-money-ict.md` §2, ARCHITECT-NOTE §4): every
`startOfDay`-based conversion in the bot is evaluated as if the host ran in
**UTC**. Everything here follows that pin, and `PARITY.md` D-09 records it.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")
VIZ = os.path.join(HERE, "viz")
os.makedirs(RESULTS, exist_ok=True)
os.makedirs(VIZ, exist_ok=True)

# ARCHITECT-NOTE §5.1
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]

# ARCHITECT-NOTE §3.2 — the pinned period and the chronological split.
PERIOD_START = pd.Timestamp("2022-08-01", tz="UTC")
PERIOD_END = pd.Timestamp("2026-08-01", tz="UTC")      # exclusive
FIT_END = pd.Timestamp("2025-08-01", tz="UTC")         # exclusive
HOLDOUT_START = FIT_END

# ---------------------------------------------------------------- the bot's
# constants, lifted verbatim from `cmc-bot-main/src/`.
SESSION_TZ = "America/New_York"
SESSION_START_H, SESSION_START_M = 9, 40    # smartmoney-strategy.ts:47
SESSION_END_H, SESSION_END_M = 11, 10       # smartmoney-strategy.ts:48
NYAM_H, NYAM_M = 7, 30                      # date-helpers.ts:122
WINDOW_MS = 12 * 3600 * 1000                # backtest-runner.ts:69
H1_BIAS_MS = 720 * 3600 * 1000              # smartmoney-strategy.ts:32
H_SWING_LENGTH = 60                         # main-indicator.ts:46
WARMUP = 200                                # main-indicator.ts:49 (EQ_THRESHOLD_ATR)
ATR_LEN = 20                                # smartmoney-strategy.ts:211
MAX_IFVG_TO_ATR_RATIO = 8.0                 # smartmoney-strategy.ts:33
TARGET_RR = 2.7                             # smartmoney-strategy.ts:29

BUY, SELL = 0, 1


# ---------------------------------------------------------------- data layer
def load_1m(symbol: str) -> pd.DataFrame:
    """The 1m frame for one symbol, clipped to the pinned period."""
    df = pd.read_parquet(os.path.join(DATA, f"{symbol}-1m.parquet"))
    df = df[(df.ts >= PERIOD_START) & (df.ts < PERIOD_END)]
    return df.sort_values("ts").drop_duplicates("ts").reset_index(drop=True)


def resample_1h(m1: pd.DataFrame) -> pd.DataFrame:
    """Derive the H1 frame from the 1m frame (house convention).

    Empty hours are dropped, exactly as the exchange archive would omit them:
    the bot's `getCandles` returns whatever rows exist in the file.
    """
    g = m1.set_index("ts").resample("1h")
    h1 = pd.DataFrame({
        "open": g["open"].first(),
        "high": g["high"].max(),
        "low": g["low"].min(),
        "close": g["close"].last(),
        "volume": g["volume"].sum(),
    }).dropna(subset=["open"]).reset_index()
    return h1


# ------------------------------------------------------- the wall-clock layer
def _ny_instant(dates_utc: pd.DatetimeIndex, hour: int, minute: int) -> np.ndarray:
    """`zonedTimeToUtc(startOfDay(ts) + h:m, 'America/New_York')` on a UTC host.

    `dates_utc` are the **UTC calendar dates** of the bars (that is what
    `startOfDay` yields on a UTC host). The naive wall-clock `date h:m` is then
    reinterpreted as New York local time and converted back to UTC, DST-aware —
    which is exactly what `date-fns-tz` does. Returned in epoch ms.
    """
    naive = pd.DatetimeIndex(dates_utc).tz_localize(None) + pd.Timedelta(hours=hour, minutes=minute)
    # ambiguous/nonexistent cannot occur at 07:30 / 09:40 / 11:10 New York.
    return (pd.DatetimeIndex(naive).tz_localize(SESSION_TZ)
            .tz_convert("UTC").asi8 // 1_000_000)


def session_mask(ts: pd.DatetimeIndex) -> np.ndarray:
    """`isValidTimeForNewOrders` / `canOrdersBeAlive`, bar for bar.

    09:40–11:10 New York **inclusive of both ends** (`isWithinInterval` is
    inclusive), and `getDay(timestamp)` in 1..5 — on a UTC host that is the
    **UTC** weekday, which is what is reproduced here.
    """
    ms = ts.asi8 // 1_000_000
    day = ts.normalize()
    start = _ny_instant(day, SESSION_START_H, SESSION_START_M)
    end = _ny_instant(day, SESSION_END_H, SESSION_END_M)
    dow = ts.dayofweek.values            # Mon=0 .. Sun=6
    return (ms >= start) & (ms <= end) & (dow <= 4)


def nyam_open_bar(ts: pd.DatetimeIndex) -> np.ndarray:
    """`isNewYorkAMTrueOpen(prev.openTime + 1, cur.openTime)`, bar for bar.

    True on the bar `i` whose half-open interval `(t[i-1], t[i]]` contains the
    07:30-New-York instant derived from `t[i-1] + 1ms`'s UTC date. Index 0 is
    always False — `main-indicator.ts:206` guards the whole block with `i > 0`.
    """
    ms = ts.asi8 // 1_000_000
    prev = np.empty_like(ms)
    prev[0] = 0
    prev[1:] = ms[:-1] + 1
    prev_dates = pd.to_datetime(prev, unit="ms", utc=True).normalize()
    target = _ny_instant(prev_dates, NYAM_H, NYAM_M)
    out = (prev <= ms) & (target >= prev) & (target <= ms)
    out[0] = False
    return out
