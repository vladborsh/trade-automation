"""Shared plumbing for the `orb-utc0-crypto` pass.

Canonical spec: `ARCHITECT-NOTE-CRYPTO-INVESTIGATION.md`
(`research/orb-ny-open/`, 2026-09-16, commit `eaacce2`) and its mechanical
restatement `DESIGN.md` in this package. Where this file and `DESIGN.md`
disagree, `DESIGN.md` is the pre-registration and this file is the bug.

This package is a **fork** of `research/orb-ny-open/` with exactly one thing
changed: the clock. The NY session anchor (09:30–10:00 NY, 16:00 NY flat,
NYSE calendar, DST) is replaced by the crypto-native UTC-midnight anchor
(00:00–00:30 UTC, 07:55 UTC flat, every calendar day, no DST). Nothing about
fills, costs, nulls, bootstrap or the ladder's structure is rewritten.

Nothing here is tuned. Every constant below was fixed by the Architect's note
before any R existed on either arm.

Data: the audited Binance USD-M 1-minute tapes of the sibling package
`research/cmc-bot-vwap/data/`, extended back to the first month
`data.binance.vision` publishes (`prep/extend_history.py`). This package
**reads** them and never rewrites the audited 2022-08+ file.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC_DATA = os.path.join(REPO, "research", "cmc-bot-vwap", "data")
DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")
os.makedirs(DATA, exist_ok=True)
os.makedirs(RESULTS, exist_ok=True)

MIN_MS = 60_000
DAY_MS = 86_400_000
SESSION_TZ = "UTC"                 # ARCHITECT-NOTE-CRYPTO §4.2 — no DST anywhere

# ---------------------------------------------------------------- §4.1 mechanic
ANCHOR = (0, 0)                    # the registered anchor: 00:00 UTC
OR_START = (0, 0)                  # opening range start, UTC
OR_END = (0, 30)                   # opening range end, exclusive
OR_BINS = 6                        # six 5-minute bins must each hold >=1 1m bar
TRIG_START = (0, 30)               # first eligible trigger bar opens here
TRIG_END_BASE = (2, 30)            # cutoff, exclusive. NO contingency (§4.11)
FLAT = (7, 55)                     # forced flat, UTC — before the 08:00 funding stamp

TFS = (5,)                         # 5m only (§4.1): 5m == 15m was already shown
INSTRUMENTS = ("BTCUSDT", "ETHUSDT")
VENUE = {"BTCUSDT": "bn", "ETHUSDT": "bn"}

# non-gating, fit-only OR-width sensitivities (§4.8d)
OR_WIDTH_SENS = (15, 60)

# §4.8(c) fit-only placebo anchors. 08:00 = funding + Deribit settlement +
# London open; 16:00 = funding only; 04:00 = nothing at all (the placebo).
PLACEBO_ANCHORS = ((8, 0), (16, 0), (4, 0))
PLACEBO_LABEL = {(8, 0): "08:00 UTC (funding + Deribit + London)",
                 (16, 0): "16:00 UTC (funding only)",
                 (4, 0): "04:00 UTC (no story — placebo)"}

# Funding settlement timestamps on the Binance 8-hour USD-M perps. `checks.py`
# asserts no position is ever open at one of them (§4.2).
FUNDING_UTC = ((0, 0), (8, 0), (16, 0))

# ---------------------------------------------------------------- §4.5 split
# FIT_START is set by `prep/extend_history.py`'s audit (the first month the
# archive actually publishes) and recorded in DESIGN.md §5.2 before any R.
FIT_START, FIT_END = "2020-01-01", "2025-07-31"
HOLD_START, HOLD_END = "2025-08-01", "2026-07-31"
TAIL_START, TAIL_END = "2026-08-01", "2026-09-11"

# §4.5 descriptive era boundaries — fit-side, no verdict
ERA_BREAK = "2021-11-01"           # the periodicity paper's structural break
ERA_ETF = "2024-01-11"             # US spot ETF launch

# ---------------------------------------------------------------- §4.7 ladder
# Cumulative over EVERY pre-registered arm judged on the 2025-08 .. 2026-07
# holdout: 8 (orb-ny-open) + 6 (orb-ny-open-short) + 2 (this family) = 16.
N_ARMS_CUMULATIVE = 16
ALPHA = 0.05 / N_ARMS_CUMULATIVE   # 0.003125
MIN_TRADES = 150
KILL_MEAN = 0.05
BUILD_MEAN = 0.10
P_INCONCLUSIVE = 0.20

# §4.7 fit-period screen — decided before any holdout number exists
SCREEN_MEAN = 0.05
SCREEN_P = 0.05

# §4.8(a) the weekend falsification reading fires below this bar
WEEKEND_MEAN = 0.05

# ---------------------------------------------------------------- §4.6 nulls
SEED = 20260916
N_PERM_A = 1000
N_PERM_B = 250
N_BOOT = 2000
BOOT_LO, BOOT_HI = 5.0, 95.0       # 90 % interval

# ---------------------------------------------------------------- §4.4 costs
BINANCE_RT = 0.0010                # 0.10 % round trip (2 x 5 bp taker) — gates
BINANCE_RT_MAKER = 0.0004          # 0.04 % maker, non-gating sensitivity
BINANCE_RT_2X = 0.0020             # 0.20 %, non-gating — the thin-book sensitivity

# ==========================================================================
# Calendars
# ==========================================================================
# There is NO exchange-holiday calendar on the eligibility path: the anchor is
# the venue's own boundary and the venue never closes (§4.2). The only calendar
# object in this package is the JPX one, and it feeds the §4.8(b) DESCRIPTIVE
# Tokyo-holiday row only — it never removes a day from any arm.
#
# Tokyo Stock Exchange full-day closures, verbatim from the JPX published
# calendar, 2020-2026. (JPX also closes 12-31..01-03 every year — the
# year-end/new-year holidays — which are listed explicitly.)
JPX_HOLIDAYS = [
    # 2020
    "2020-01-01", "2020-01-02", "2020-01-03", "2020-01-13", "2020-02-11",
    "2020-02-24", "2020-03-20", "2020-04-29", "2020-05-04", "2020-05-05",
    "2020-05-06", "2020-07-23", "2020-07-24", "2020-08-10", "2020-09-21",
    "2020-09-22", "2020-11-03", "2020-11-23", "2020-12-31",
    # 2021
    "2021-01-01", "2021-01-02", "2021-01-03", "2021-01-11", "2021-02-11",
    "2021-02-23", "2021-03-20", "2021-04-29", "2021-05-03", "2021-05-04",
    "2021-05-05", "2021-07-22", "2021-07-23", "2021-08-09", "2021-09-20",
    "2021-09-23", "2021-11-03", "2021-11-23", "2021-12-31",
    # 2022
    "2022-01-01", "2022-01-02", "2022-01-03", "2022-01-10", "2022-02-11",
    "2022-02-23", "2022-03-21", "2022-04-29", "2022-05-03", "2022-05-04",
    "2022-05-05", "2022-07-18", "2022-08-11", "2022-09-19", "2022-09-23",
    "2022-10-10", "2022-11-03", "2022-11-23", "2022-12-31",
    # 2023
    "2023-01-01", "2023-01-02", "2023-01-03", "2023-01-09", "2023-02-11",
    "2023-02-23", "2023-03-21", "2023-04-29", "2023-05-03", "2023-05-04",
    "2023-05-05", "2023-07-17", "2023-08-11", "2023-09-18", "2023-09-23",
    "2023-10-09", "2023-11-03", "2023-11-23", "2023-12-31",
    # 2024
    "2024-01-01", "2024-01-02", "2024-01-03", "2024-01-08", "2024-02-11",
    "2024-02-12", "2024-02-23", "2024-03-20", "2024-04-29", "2024-05-03",
    "2024-05-04", "2024-05-05", "2024-05-06", "2024-07-15", "2024-08-11",
    "2024-08-12", "2024-09-16", "2024-09-22", "2024-09-23", "2024-10-14",
    "2024-11-03", "2024-11-04", "2024-11-23", "2024-12-31",
    # 2025
    "2025-01-01", "2025-01-02", "2025-01-03", "2025-01-13", "2025-02-11",
    "2025-02-23", "2025-02-24", "2025-03-20", "2025-04-29", "2025-05-03",
    "2025-05-04", "2025-05-05", "2025-05-06", "2025-07-21", "2025-08-11",
    "2025-09-15", "2025-09-23", "2025-10-13", "2025-11-03", "2025-11-23",
    "2025-11-24", "2025-12-31",
    # 2026
    "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-12", "2026-02-11",
    "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04",
    "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11", "2026-09-21",
    "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
    "2026-12-31",
]
JPX_CLOSED = set(JPX_HOLIDAYS)


def all_days(start: str, end: str) -> list[str]:
    """**Every** UTC calendar date in span — the eligibility rule of §4.2.
    No weekday filter, no holiday filter. The completeness rule in
    `engine.opening_range` is the only thing that removes a day."""
    return list(pd.date_range(start, end, freq="D").strftime("%Y-%m-%d"))


def weekday_days(start: str, end: str) -> list[str]:
    """Mon-Fri UTC — the §4.8(a) weekday half. Descriptive split only."""
    d = pd.date_range(start, end, freq="D")
    return list(d[d.dayofweek <= 4].strftime("%Y-%m-%d"))


def weekend_days(start: str, end: str) -> list[str]:
    """Sat/Sun UTC — the §4.8(a) weekend half, the crypto-native test."""
    d = pd.date_range(start, end, freq="D")
    return list(d[d.dayofweek >= 5].strftime("%Y-%m-%d"))


def tokyo_holiday_days(start: str, end: str) -> list[str]:
    """§4.8(b): UTC weekdays on which the Tokyo Stock Exchange is closed.
    Descriptive corroboration of (a); never gates anything."""
    return [d for d in weekday_days(start, end) if d in JPX_CLOSED]


def is_weekend(dates) -> np.ndarray:
    return (pd.to_datetime(pd.Series(np.asarray(dates))).dt.dayofweek >= 5).values


def utc_ms(date_str: str, hh: int, mm: int) -> int:
    """UTC hh:mm on the UTC calendar date `date_str`, as epoch ms. There is no
    DST in UTC, so this is pure arithmetic — the whole point of §4.2."""
    y, m, d = (int(x) for x in date_str.split("-"))
    return int(pd.Timestamp(year=y, month=m, day=d, hour=hh, minute=mm,
                            tz="UTC").value // 10 ** 6)


# Back-compatible alias: the forked engine/analysis call the session-clock
# helper by one name. In this package the session clock IS UTC.
ny_ms = utc_ms


def period_of(dates: np.ndarray) -> np.ndarray:
    """Split label by UTC session date (§4.5). Never re-cut."""
    d = pd.to_datetime(pd.Series(dates))
    out = np.full(len(d), "pre", dtype=object)
    out[(d >= FIT_START) & (d <= FIT_END)] = "fit"
    out[(d >= HOLD_START) & (d <= HOLD_END)] = "holdout"
    out[(d >= TAIL_START) & (d <= TAIL_END)] = "tail"
    return out


def era_of(dates: np.ndarray) -> pd.DataFrame:
    """The two descriptive era cuts of §4.5, fit-side, no verdict."""
    d = pd.to_datetime(pd.Series(dates))
    return pd.DataFrame({
        "era_break": np.where(d >= ERA_BREAK, "from-2021-11", "pre-2021-11"),
        "era_etf": np.where(d >= ERA_ETF, "from-2024-01", "pre-2024-01"),
    })


# ==========================================================================
# Tapes
# ==========================================================================
TAPE_SUFFIX = "_1m_2020"           # the extended tape written by prep/


def load_1m(symbol: str) -> pd.DataFrame:
    """The extended 1m frame (§4.5). Read-only. Falls back to the audited
    2022-08+ file only if the extension does not exist, which `DESIGN.md`
    §5.2 requires to be recorded with a commit before any R."""
    p = os.path.join(SRC_DATA, f"{symbol}{TAPE_SUFFIX}.parquet")
    if not os.path.exists(p):
        p = os.path.join(SRC_DATA, f"{symbol}_1m.parquet")
    df = pd.read_parquet(p)
    df = df.drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
    return df


def resample(df: pd.DataFrame, tf_min: int) -> pd.DataFrame:
    """Bins of `tf_min` minutes on the UTC epoch grid, labelled by OPEN time.

      open  = first 1m open      high = max      low = min
      close = last 1m close      volume = sum

    A bin with no 1m bar is ABSENT — not forward-filled, not zero-filled.
    Unchanged from the closed pass; under a UTC anchor the epoch grid and the
    session-anchored grid are trivially the same object.
    """
    step = tf_min * MIN_MS
    b = (df.t_ms.values // step) * step
    g = df.groupby(b, sort=True)
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    if "spread_close" in df.columns:
        agg["spread_close"] = "last"
    out = g.agg(agg)
    out.index.name = "t_ms"
    out = out.reset_index()
    sz = g.size().values.astype(np.int64)
    out["i_last"] = np.cumsum(sz) - 1
    out["i_first"] = np.cumsum(sz) - sz
    return out


def fmt(t_ms) -> str:
    return pd.Timestamp(int(t_ms), unit="ms", tz="UTC").strftime("%Y-%m-%d %H:%M UTC")


__all__ = [n for n in dir() if not n.startswith("_")]
