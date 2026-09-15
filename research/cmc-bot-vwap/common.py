"""Shared plumbing for the `cmc-bot` VWAP band-reversal pass — **Stage 0**.

Canonical spec: `ARCHITECT-NOTE.md` (this package) and
`knowledge/vwap-band-reversal-ict.md`. The TypeScript under `cmc-bot-main/src/`
is the *operational* spec: where the prose and the code disagree, the code
wins and the difference gets a row in `PARITY.md`.

Stage 0 computes **no** performance number — no R, no win rate, no
expectancy. There is deliberately no cost model and no R arithmetic here.

Data: Capital.com 1-minute bars pulled through the bot's own
`CapitalComSession` by `ts_harness/pull_1m.ts`, converted by `prep_data.py`.
Prices are the bot's own mid, `(ask + bid) / 2` per OHLC field
(`capital-com.helpers.ts:mapMarketDataToChartData`). Timestamps are
**`snapshotTimeUTC`** — see PARITY.md D-01 for why not the bot's
`snapshotTime`.

Host-timezone pin: every `startOfDay` / `getDay` / `setMinutes` in the bot is
evaluated as if the host ran in **UTC** (same pin as the smart-money pass).
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "data")
RAW = os.path.join(DATA, "raw")
RESULTS = os.path.join(HERE, "results")
os.makedirs(RESULTS, exist_ok=True)

SYMBOLS = ["US100", "US500", "EURCHF", "GBPCHF"]

MIN_MS = 60_000
DAY_MS = 86_400_000
WINDOW_MS = 12 * 3600 * 1000          # backtest-runner.ts:69 / strategy-runner.ts:57

# ---------------------------------------------------------------- the bot's
# constants, lifted verbatim from `cmc-bot-main/src/`.
TARGET_RR = 3.0                        # vwap-strategy.ts:28
RANGE_LEN = 200                        # vwap-strategy.ts:312
ATR_LEN = 20                           # vwap-strategy.ts:320, :239
MIN_VWAP_ATR_RATIO = 2.5               # strategy-provider.ts (all four)
MAX_VWAP_ATR_RATIO = 11.5
MAX_IFVG_TO_ATR_RATIO = 8.0
SESSION_TZ = "America/New_York"        # vwap-strategy.ts:43,61

# Timing windows, (start h, start m, end h, end m), New York wall clock,
# both ends inclusive (date-fns isWithinInterval).
#  - US100/US500: user-specified provisional values (ARCHITECT-NOTE §4), in
#    production read from the S3 dynamic config, which this pass does not read.
#  - EURCHF/GBPCHF: hardcoded, strategy-provider.ts:51-62 / :74-85.
TIMINGS = {
    "US100": dict(entry=(9, 40, 11, 40), alive=(9, 40, 14, 30)),
    "US500": dict(entry=(9, 40, 11, 40), alive=(9, 40, 14, 30)),
    "EURCHF": dict(entry=(3, 2, 3, 20), alive=(3, 0, 4, 0)),
    "GBPCHF": dict(entry=(3, 3, 3, 20), alive=(3, 0, 5, 0)),
}

# ---- crypto extension (not a configuration the bot ever shipped) -----------
# BTC/ETH USD-M perps from data.binance.vision (crypto/fetch_binance_1m.py).
# "win": the US100/US500 windows applied verbatim; "all": every minute, 24/7.
CRYPTO = ["BTCUSDT", "ETHUSDT"]
CRYPTO_WINDOW = TIMINGS["US100"]

BUY, SELL = 0, 1


def load_1m(symbol: str) -> pd.DataFrame:
    """The prepared 1m frame: ts (UTC, tz-aware), t_ms, open/high/low/close (mid), volume."""
    df = pd.read_parquet(os.path.join(DATA, f"{symbol}_1m.parquet"))
    return df


def ny_window_utc_ms(day_utc_midnight_ms: int, h0: int, m0: int, h1: int, m1: int) -> tuple[int, int]:
    """`zonedTimeToUtc(addMinutes(addHours(startOfDay(t), h), m), 'America/New_York')`
    on a UTC host: the NY wall-clock time h:m **on the UTC calendar date** of t."""
    d = pd.Timestamp(day_utc_midnight_ms, unit="ms").date()
    a = pd.Timestamp(year=d.year, month=d.month, day=d.day, hour=h0, minute=m0, tz=SESSION_TZ)
    b = pd.Timestamp(year=d.year, month=d.month, day=d.day, hour=h1, minute=m1, tz=SESSION_TZ)
    return int(a.value // 10**6), int(b.value // 10**6)


def ms(ts) -> int:
    return int(pd.Timestamp(ts).value // 10**6)


def fmt(t_ms) -> str:
    return pd.Timestamp(int(t_ms), unit="ms", tz="UTC").strftime("%Y-%m-%d %H:%M")


__all__ = [n for n in dir() if not n.startswith("_")] + ["np", "pd"]
