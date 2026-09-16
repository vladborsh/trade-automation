"""Shared plumbing for the ORB **exit-construction** family
(`orb-ny-open-exit`).

Canonical spec: `research/orb-ny-open/ARCHITECT-NOTE-EXIT-CONSTRUCTION.md`
(commit `89365fd`, 2026-09-16) and its mechanical restatement `DESIGN.md` in
this package. Where this file and `DESIGN.md` disagree, `DESIGN.md` is the
pre-registration and this file is the bug.

Forked from `research/orb-ny-open-short/common.py` per the exit note §9:
**parametrise, do not rewrite.** The short package is a finished record and is
not edited. The one substantive change is that the axis is no longer the
opening-range WIDTH but the EXIT CONSTRUCTION: one width (5 minutes), three
constructions (E0 / E1 / E2), two instruments.

The trigger, the fills, the cost model, the calendar, the nulls, the bootstrap
and the verdict ladder are **verbatim** from the short pass. Only `ALPHA`
changes (cumulative over 20 arms, note §6.1), and that change is a
tightening.

Nothing here is tuned. Every constant below was fixed by the Architect's exit
note before any R existed on any arm of this family.

Data: the cached, audited 1-minute tapes of the sibling package
`research/cmc-bot-vwap/data/` (Capital.com mids via `prep_data.py`), copied
from the main checkout and never re-pulled. This package **reads** them and
never rewrites them.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC_DATA = os.path.join(REPO, "research", "cmc-bot-vwap", "data")
CLOSED = os.path.join(REPO, "research", "orb-ny-open")       # quoted, never re-run
CLOSED_RESULTS = os.path.join(CLOSED, "results")
# The SHORT pass — the direct parent. Its `US100-OR5` / `US500-OR5` table is
# the trade list this family must reproduce exactly (note §9.3 check 2), and
# its committed fit numbers are the quoted +1R corner of the grid (§5.2).
SHORT = os.path.join(REPO, "research", "orb-ny-open-short")
SHORT_RESULTS = os.path.join(SHORT, "results")
DATA = os.path.join(HERE, "data")
RESULTS = os.path.join(HERE, "results")
os.makedirs(DATA, exist_ok=True)
os.makedirs(RESULTS, exist_ok=True)

MIN_MS = 60_000
DAY_MS = 86_400_000
SESSION_TZ = "America/New_York"

# ---------------------------------------------------------------- §4 mechanic
OR_START = (9, 30)                 # opening range start, NY wall clock
TRIG_END_BASE = (12, 0)            # cutoff, exclusive — unchanged, note §4.4
FLAT = (16, 0)                     # forced flat, NY wall clock

TF = 5                             # the only trigger timeframe, note §4.3
TFS = (TF,)
INSTRUMENTS = ("US100", "US500")   # indices only — crypto is OUT, note §3.1
VENUE = {"US100": "cc", "US500": "cc"}

# The width axis is CLOSED (Запись 24). One width — the 5-minute range — is
# the only one in this family, chosen for the reasons in note §3 (highest
# forward lift on both instruments, the width of both Zarattini papers, the
# earliest trigger, and the only width whose no-target cell has never been
# read on the holdout).
OR_WIDTHS = (5,)
OR_MIN = 5                         # the single width, spelled out

# ---------------------------------------------------------------- §5.2 arms
# The axis of THIS family: the exit construction.
#
#   E0  range stop, NO target, flat 16:00 NY      -> the CAP hypothesis
#       (the literal Zarattini-Aziz 2023 base shape on this project's trigger;
#        identical to the closed passes' "template 2" on the OR5 trigger)
#   E1  range stop, NO target, 1R RATCHET, flat   -> the GIVE-BACK hypothesis
#       (nests E0: E1 == E0 + ratchet, so the pair attributes)
#   E2  stop at 0.10 x dATR14, NO target, flat    -> the STOP-WIDTH hypothesis
#       (the Zarattini-Barbon-Aziz 2024 exit verbatim)
#
# No arm has a target. `+1R` is the already-killed corner of the grid; it is
# QUOTED from the short pass on the fit period only and its holdout is never
# computed (§5.2).
CONSTRUCTIONS = ("E0", "E1", "E2")

CONSTRUCTION_DESC = {
    "E0": "range stop, no target, flat 16:00 NY",
    "E1": "range stop, no target, 1R ratchet, flat 16:00 NY",
    "E2": "stop at 0.10 x dATR14, no target, flat 16:00 NY",
}

# Which stop each construction sizes its R from, and which walker it uses.
CONSTRUCTION_STOP = {"E0": "range", "E1": "range", "E2": "datr"}
CONSTRUCTION_TRAIL = {"E0": False, "E1": True, "E2": False}

DATR_FRAC = 0.10                   # E2's stop, note §5.3 — the 2024 paper's
                                   # number, not tuned here
TRAIL_R = 1.0                      # E1's trail distance, in units of R.
                                   # 1R by construction => NO free parameter

# The six pre-registered arms, in reporting order. `(symbol, construction)`.
ARM_SPECS = [(s, k) for s in INSTRUMENTS for k in CONSTRUCTIONS]


def arm_name(symbol: str, construction: str) -> str:
    return f"{symbol}-{construction}"


ARMS = [arm_name(s, k) for s, k in ARM_SPECS]


def parse_arm(arm: str) -> tuple[str, str]:
    sym, k = arm.rsplit("-", 1)
    return sym, k


def trig_start(or_minutes: int = OR_MIN) -> tuple[int, int]:
    """First eligible trigger bar opens at the range's END — 09:35 NY for the
    5-minute range. Verbatim from the short pass, which is where this stopped
    being a hardcoded 10:00."""
    m = OR_START[0] * 60 + OR_START[1] + or_minutes
    return m // 60, m % 60


TRIG_STARTS = {w: trig_start(w) for w in OR_WIDTHS}     # {5: (9,35)}
TRIG_START = trig_start(OR_MIN)                         # (9, 35)

# ------------------------------------------------- §5.2 the quoted +1R corner
# The fourth cell of each instrument's exit grid is the SHORT pass's own
# `US100-OR5` / `US500-OR5` template 1: range stop, +1R target. It is a KILLED
# arm. It is quoted from `research/orb-ny-open-short/results/fit_describe.csv`
# on the FIT PERIOD ONLY, never recomputed and never re-judged, and **its
# holdout column stays blank — the blank is the point** (note §5.2).
QUOTED_CORNER = {s: f"{s}-OR{OR_MIN}" for s in INSTRUMENTS}
QUOTED_CORNER_LABEL = "+1R (quoted, killed)"

# The closed 30-minute pass is no longer a cell of anything here; the pointer
# is kept because `analysis.py` reads nothing from it and `report.py` cites it.
CLOSED_WIDTH = 30
CLOSED_ARM = {"US100": "US100-5m", "US500": "US500-5m"}

# ---------------------------------------------------------------- §4.1 split
# Identical calendar to the closed pass. The holdout is the SAME YEAR, read a
# second time — declared in REPORT.md's first paragraph (note §5.1).
FIT_START, FIT_END = "2024-01-01", "2025-07-31"
HOLD_START, HOLD_END = "2025-08-01", "2026-07-31"
TAIL_START, TAIL_END = "2026-08-01", "2026-09-11"

# ---------------------------------------------------------------- §5.2 ladder
# THIRD AND LAST look at the 2025-08-01 .. 2026-07-31 holdout for the ORB
# line on these two instruments (note §6.1). The correction is cumulative over
# every arm ever pre-registered against that year, and it only ever tightens.
N_ARMS_CLOSED = 8                  # `orb-ny-open`, the 30-minute pass
N_ARMS_SHORT = 6                   # `orb-ny-open-short`, the width family
N_ARMS_NEW = 6                     # the six arms of THIS family
N_ARMS_CUMULATIVE = N_ARMS_CLOSED + N_ARMS_SHORT + N_ARMS_NEW      # 20
ALPHA = 0.05 / N_ARMS_CUMULATIVE   # 0.0025 exactly — CUMULATIVE, note §6.1
MIN_TRADES = 150
KILL_MEAN = 0.05
BUILD_MEAN = 0.10
P_INCONCLUSIVE = 0.20

# ---------------------------------------------------------------- §5.3 screen
# Decided and committed BEFORE any holdout number exists. Nothing tuned:
# +0.05R is the kill bar, 0.05 is the uncorrected conventional level for a
# screen that only ever REMOVES arms.
SCREEN_MEAN = 0.05
SCREEN_P = 0.05

# ---------------------------------------------------------------- nulls
SEED = 20260916
N_PERM_A = 1000
N_PERM_B = 250
N_BOOT = 2000
BOOT_LO, BOOT_HI = 5.0, 95.0       # 90 % interval

# ------------------------------------------------- §8.2 fit-only ladders
# Descriptive, non-gating, FIT PERIOD ONLY. None of these can create, upgrade
# or downgrade a verdict, none is computed on the holdout, and **no "best
# cell" sentence exists anywhere in the deliverable** — they are shapes.
S_T_TARGETS = (2.0, 3.0, 5.0, 10.0)        # S-T fixed target in R, on E0 and E2
S_K_FRACS = (0.05, 0.10, 0.15, 0.25)       # S-K stop fraction of dATR14 (0.10 = E2)
S_C_FLATS = ((11, 0), (12, 0), (14, 0))    # S-C time exit, on E0 and E1 (16:00 = arm)
S_D_TRAILS = (0.5, 2.0)                    # S-D trail distance in R (1.0 = E1)
S_P_PARTIAL_R = 1.0                        # S-P scale-out: half off at +1R, rest per E1

# The short pass's S5 constant is kept so the calendar/clock object is
# unchanged; no ladder in THIS family moves the trigger window.
TRIG_END_S5 = (11, 0)

# ==========================================================================
# NYSE calendar — verbatim from the closed pass's `common.py`
# ==========================================================================
# The pre-ETF crypto control is gone with crypto, so the 2022/2023 rows are no
# longer read by anything; they are kept verbatim so the calendar object is
# byte-for-byte the closed pass's.
NYSE_HOLIDAYS = [
    # 2022
    "2022-01-17", "2022-02-21", "2022-04-15", "2022-05-30", "2022-06-20",
    "2022-07-04", "2022-09-05", "2022-11-24", "2022-12-26",
    # 2023
    "2023-01-02", "2023-01-16", "2023-02-20", "2023-04-07", "2023-05-29",
    "2023-06-19", "2023-07-04", "2023-09-04", "2023-11-23", "2023-12-25",
    # 2024
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
    "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    # 2025  (2025-01-09: National Day of Mourning, President Carter — NYSE closed)
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18",
    "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27",
    "2025-12-25",
    # 2026
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]

# 1:00 pm ET early closes. Excluded as full days because the 16:00 NY forced
# flat does not exist on them.
NYSE_EARLY_CLOSES = [
    "2022-11-25",
    "2023-07-03", "2023-11-24",
    "2024-07-03", "2024-11-29", "2024-12-24",
    "2025-07-03", "2025-11-28", "2025-12-24",
    "2026-11-27", "2026-12-24",
]

NYSE_EXCLUDED = set(NYSE_HOLIDAYS) | set(NYSE_EARLY_CLOSES)


def nyse_days(start: str, end: str) -> list[str]:
    """Full NYSE trading days (weekday, not a holiday, not an early close) as
    'YYYY-MM-DD' NY calendar dates."""
    d = pd.date_range(start, end, freq="D")
    d = d[d.dayofweek <= 4]
    s = d.strftime("%Y-%m-%d")
    return [x for x in s if x not in NYSE_EXCLUDED]


def ny_ms(date_str: str, hh: int, mm: int) -> int:
    """NY wall-clock hh:mm on the NY calendar date `date_str`, as epoch ms.
    DST-aware; mirrors `research/cmc-bot-vwap/common.py:ny_window_utc_ms`."""
    y, m, d = (int(x) for x in date_str.split("-"))
    return int(pd.Timestamp(year=y, month=m, day=d, hour=hh, minute=mm,
                            tz=SESSION_TZ).value // 10 ** 6)


def period_of(dates: np.ndarray) -> np.ndarray:
    """Split label by NY session date. Never re-cut."""
    d = pd.to_datetime(pd.Series(dates))
    out = np.full(len(d), "pre", dtype=object)
    out[(d >= FIT_START) & (d <= FIT_END)] = "fit"
    out[(d >= HOLD_START) & (d <= HOLD_END)] = "holdout"
    out[(d >= TAIL_START) & (d <= TAIL_END)] = "tail"
    return out


# ==========================================================================
# Tapes
# ==========================================================================
def load_1m(symbol: str) -> pd.DataFrame:
    """The sibling package's prepared 1m frame. Read-only."""
    df = pd.read_parquet(os.path.join(SRC_DATA, f"{symbol}_1m.parquet"))
    df = df.drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
    return df


def resample(df: pd.DataFrame, tf_min: int) -> pd.DataFrame:
    """Bins of `tf_min` minutes on the UTC epoch grid (identical to the
    NY-anchored grid under either DST offset), labelled by OPEN time.

      open  = first 1m open      high = max      low = min
      close = last 1m close      volume = sum
      spread_close = the bin's LAST 1m bar's spread_close

    A bin with no 1m bar is ABSENT — not forward-filled, not zero-filled.
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
    return pd.Timestamp(int(t_ms), unit="ms", tz="UTC").tz_convert(SESSION_TZ) \
        .strftime("%Y-%m-%d %H:%M %Z")


__all__ = [n for n in dir() if not n.startswith("_")]
