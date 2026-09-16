"""The 24-feature per-trade vector — `DESIGN.md` §7, from ARCHITECT-NOTE §5.

Every feature is computed **at the entry (trigger) bar's close, on the arm's
own bars, using only bars whose close is <= the entry bar's close**. Session-
anchored quantities (the opening range, the session VWAP) use 1m bars up to
and including the entry bar's last minute. Directional features are
**side-signed** (`side x raw`) so that positive always means "aligned with the
trade"; those are marked `signed` in `SPEC`.

`checks.py` re-computes every feature for 50 random trades from a tape
truncated at the entry bar and asserts equality — the look-ahead stop rule.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from engine import Tape  # noqa: E402

# name -> (signed?, one-line description) — the model's column order.
SPEC = [
    ("ema20_d", True, "(close - EMA20) / ATR14"),
    ("ema50_d", True, "(close - EMA50) / ATR14"),
    ("ema100_d", True, "(close - EMA100) / ATR14"),
    ("ema200_d", True, "(close - EMA200) / ATR14"),
    ("ema_stack", True, "count of EMA20>50, 50>100, 100>200 agreeing with the side (0-3)"),
    ("ema200_slope", True, "(EMA200_t - EMA200_{t-10}) / ATR14"),
    ("rsi15", False, "Wilder RSI(15); for shorts stored as 100 - RSI"),
    ("rsi20", False, "Wilder RSI(20); for shorts stored as 100 - RSI"),
    ("vwap_sess_d", True, "(close - VWAP anchored 09:30 NY) / ATR14"),
    ("vwap_day_d", True, "(close - VWAP anchored 00:00 UTC) / ATR14"),
    ("tod_min", False, "minutes from 09:30 NY to the entry bar's OPEN"),
    ("dow", False, "NY weekday of the session, Mon=0..Fri=4 (categorical)"),
    ("or_width_atr", False, "(OR_high - OR_low) / ATR14"),
    ("or_width_datr", False, "(OR_high - OR_low) / dATR14"),
    ("overshoot_atr", True, "(close - broken edge) / ATR14"),
    ("or_body", True, "(OR last 1m close - OR first 1m open) / OR width"),
    ("gap_datr", True, "(09:30 open - prior session 16:00 close) / dATR14"),
    ("prev_day_ret", True, "(prior session close - the one before) / dATR14"),
    ("pd_level_d", True, "(prior session high[long]/low[short] - close) / ATR14"),
    ("range200_pos", True, "(close - mid) / (top - bottom) over the 200 bars before t"),
    ("or_rvol", False, "OR volume / median OR volume of the prior 20 eligible sessions"),
    ("bar_rvol", False, "entry-bar volume / mean volume at the same clock slot, prior 20"),
    ("atr_regime", False, "ATR14 / SMA(ATR14, 200 bars)"),
    ("datr_pct", False, "dATR14 / close * 100"),
]
FEATURES = [n for n, _, _ in SPEC]
SIGNED = {n for n, s, _ in SPEC if s}
CATEGORICAL = ["dow"]
assert len(FEATURES) == 24


# ==========================================================================
# Indicator primitives — all strictly causal
# ==========================================================================
def ema(x: np.ndarray, k: int) -> np.ndarray:
    """Standard EMA, alpha = 2/(k+1), **seeded with SMA(k)** at index k-1."""
    out = np.full(len(x), np.nan)
    if len(x) < k:
        return out
    a = 2.0 / (k + 1.0)
    out[k - 1] = x[:k].mean()
    for i in range(k, len(x)):
        out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out


def wilder_rma(x: np.ndarray, k: int) -> np.ndarray:
    """Wilder's smoothed moving average (SMMA), seeded with the mean of the
    first k values at index k-1. `x` may start with a NaN (true range)."""
    out = np.full(len(x), np.nan)
    v = x[~np.isnan(x)]
    if len(v) < k:
        return out
    off = int(np.argmax(~np.isnan(x)))
    out[off + k - 1] = x[off:off + k].mean()
    for i in range(off + k, len(x)):
        out[i] = (out[i - 1] * (k - 1) + x[i]) / k
    return out


def atr_wilder(h, l, c, k=14) -> np.ndarray:
    tr = np.full(len(h), np.nan)
    tr[1:] = np.maximum(h[1:] - l[1:],
                        np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    return wilder_rma(tr, k)


def rsi_wilder(c, k) -> np.ndarray:
    d = np.full(len(c), np.nan)
    d[1:] = np.diff(c)
    up = np.where(np.isnan(d), np.nan, np.maximum(d, 0.0))
    dn = np.where(np.isnan(d), np.nan, np.maximum(-d, 0.0))
    ru, rd = wilder_rma(up, k), wilder_rma(dn, k)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = ru / rd
        out = 100.0 - 100.0 / (1.0 + rs)
    out = np.where((rd == 0) & (ru > 0), 100.0, out)
    out = np.where((rd == 0) & (ru == 0), 50.0, out)
    return out


def sma(x: np.ndarray, k: int) -> np.ndarray:
    s = pd.Series(x)
    return s.rolling(k, min_periods=k).mean().values


def roll_max(x, k):
    return pd.Series(x).rolling(k, min_periods=k).max().values


def roll_min(x, k):
    return pd.Series(x).rolling(k, min_periods=k).min().values


# ==========================================================================
# Per-instrument indicator cache (computed once over the whole bar sequence)
# ==========================================================================
class Ind:
    """Indicators over the arm's full bar sequence. Every one is causal, so a
    value at index j depends only on bars <= j; evaluating them globally and
    then indexing at the entry bar is identical to truncating the tape there
    (asserted in `checks.py`)."""

    _cache: dict = {}

    def __init__(self, symbol: str, tf: int):
        tp = Tape.get(symbol)
        B = tp.bars[tf]
        c, h, l = B["c"], B["h"], B["l"]
        self.atr14 = atr_wilder(h, l, c, 14)
        self.emas = {k: ema(c, k) for k in (20, 50, 100, 200)}
        self.rsi = {k: rsi_wilder(c, k) for k in (14, 15, 20)}
        self.atr_sma200 = sma(self.atr14, 200)
        self.top200 = roll_max(h, 200)
        self.bot200 = roll_min(l, 200)

    @classmethod
    def get(cls, symbol, tf):
        key = (symbol, tf)
        if key not in cls._cache:
            cls._cache[key] = Ind(symbol, tf)
        return cls._cache[key]


class DayBars:
    """'Session-day' bars, 16:00 NY -> 16:00 NY (full 24 h, same definition on
    all four tapes). The bar labelled `d` spans [16:00 NY of the previous
    calendar day, 16:00 NY of `d`). `dATR14` is Wilder ATR(14) over them,
    read **as of the prior trading day's close** wherever a feature uses it."""

    _cache: dict = {}

    def __init__(self, symbol: str):
        tp = Tape.get(symbol)
        d0 = pd.Timestamp(tp.t[0], unit="ms", tz="UTC").tz_convert(C.SESSION_TZ)
        d1 = pd.Timestamp(tp.t[-1], unit="ms", tz="UTC").tz_convert(C.SESSION_TZ)
        days = pd.date_range(d0.normalize(), d1.normalize(), freq="D").strftime("%Y-%m-%d")
        edges = np.array([C.ny_ms(x, 16, 0) for x in days], dtype=np.int64)
        idx = np.searchsorted(tp.t, edges, "left")
        rows = []
        for i in range(1, len(days)):
            a, b = idx[i - 1], idx[i]
            if b <= a:
                continue
            rows.append((days[i], float(tp.o[a]), float(tp.h[a:b].max()),
                         float(tp.l[a:b].min()), float(tp.c[b - 1])))
        df = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close"])
        df["datr14"] = atr_wilder(df.high.values, df.low.values, df.close.values, 14)
        self.df = df
        self.pos = {d: i for i, d in enumerate(df.date.values)}

    def prior(self, date: str) -> dict | None:
        """The last session-day bar strictly BEFORE `date` — i.e. the one that
        closed at 16:00 NY on the previous trading day. Returns its OHLC, the
        one before it, and dATR14 as of that close. No look-ahead."""
        i = np.searchsorted(self.df.date.values, date, "left") - 1
        if i < 1:
            return None
        r = self.df.iloc[i]
        p = self.df.iloc[i - 1]
        if not np.isfinite(r.datr14) or r.datr14 <= 0:
            return None
        return dict(datr14=float(r.datr14), high=float(r.high), low=float(r.low),
                    close=float(r["close"]), prev_close=float(p["close"]))

    @classmethod
    def get(cls, symbol):
        if symbol not in cls._cache:
            cls._cache[symbol] = DayBars(symbol)
        return cls._cache[symbol]


# ==========================================================================
# The feature vector
# ==========================================================================
def build(q: pd.DataFrame) -> pd.DataFrame:
    """Append the 24 columns to a trade table produced by `engine.build_arm`.

    A trade whose features need more history than exists (warm-up, §7.1) gets
    NaN in the affected columns; `studyb.py` drops those rows from Study B and
    counts them. They stay in Test A.
    """
    if not len(q):
        return q
    out = {n: np.full(len(q), np.nan) for n in FEATURES}
    out["rsi14"] = np.full(len(q), np.nan)
    for (symbol, tf), g in q.groupby(["symbol", "tf"], sort=False):
        tp = Tape.get(symbol)
        B = tp.bars[tf]
        I = Ind.get(symbol, tf)
        D = DayBars.get(symbol)
        # rolling per-session history for or_rvol / bar_rvol
        or_hist: list[float] = []
        slot_hist: dict[int, list[float]] = {}
        seen_dates: set = set()
        rows = g.sort_values(["date", "j"])
        # the per-session OR volume of EVERY eligible session (not only the
        # triggered ones) is what §7.2 asks for; the caller passes a table of
        # triggered days, so the rolling windows are built over triggered
        # sessions and the column is documented as such in DESIGN §7.2.
        for pos, r in zip(rows.index, rows.itertuples()):
            j = r.j
            side = r.side
            atr = I.atr14[j]
            c_t = B["c"][j]
            if not np.isfinite(atr) or atr <= 0:
                continue
            # --- 1-6 EMAs -------------------------------------------------
            e = {k: I.emas[k][j] for k in (20, 50, 100, 200)}
            out["ema20_d"][pos] = side * (c_t - e[20]) / atr
            out["ema50_d"][pos] = side * (c_t - e[50]) / atr
            out["ema100_d"][pos] = side * (c_t - e[100]) / atr
            out["ema200_d"][pos] = side * (c_t - e[200]) / atr
            rel = [e[20] > e[50], e[50] > e[100], e[100] > e[200]]
            out["ema_stack"][pos] = sum(1 for x in rel if (x if side > 0 else not x))
            if j >= 10 and np.isfinite(I.emas[200][j - 10]):
                out["ema200_slope"][pos] = side * (e[200] - I.emas[200][j - 10]) / atr
            # --- 7-8 RSI --------------------------------------------------
            for k, nm in ((15, "rsi15"), (20, "rsi20"), (14, "rsi14")):
                v = I.rsi[k][j]
                out[nm][pos] = v if side > 0 else (100.0 - v)
            # --- 9-10 VWAPs -----------------------------------------------
            i_ent = r.i_entry_min
            a_sess = r.i_or0
            out["vwap_sess_d"][pos] = side * (c_t - _vwap(tp, a_sess, i_ent)) / atr
            t_utc_mid = (int(tp.t[i_ent]) // C.DAY_MS) * C.DAY_MS
            a_day = int(np.searchsorted(tp.t, t_utc_mid, "left"))
            out["vwap_day_d"][pos] = side * (c_t - _vwap(tp, a_day, i_ent)) / atr
            # --- 11-12 clock ----------------------------------------------
            out["tod_min"][pos] = (int(B["t"][j]) - C.ny_ms(r.date, *C.OR_START)) / C.MIN_MS
            out["dow"][pos] = pd.Timestamp(r.date).dayofweek
            # --- 13-14 range width ----------------------------------------
            w = r.or_high - r.or_low
            out["or_width_atr"][pos] = w / atr
            dd = D.prior(r.date)
            if dd is not None:
                out["or_width_datr"][pos] = w / dd["datr14"]
                out["gap_datr"][pos] = side * (r.or_open - dd["close"]) / dd["datr14"]
                out["prev_day_ret"][pos] = side * (dd["close"] - dd["prev_close"]) / dd["datr14"]
                lvl = dd["high"] if side > 0 else dd["low"]
                out["pd_level_d"][pos] = side * (lvl - c_t) / atr
                out["datr_pct"][pos] = dd["datr14"] / c_t * 100.0
            # --- 15-16 the breakout itself --------------------------------
            edge = r.or_high if side > 0 else r.or_low
            out["overshoot_atr"][pos] = side * (c_t - edge) / atr
            out["or_body"][pos] = side * (r.or_close - r.or_open) / w if w > 0 else np.nan
            # --- 20 premium/discount --------------------------------------
            top, bot = I.top200[j - 1] if j >= 1 else np.nan, I.bot200[j - 1] if j >= 1 else np.nan
            if np.isfinite(top) and np.isfinite(bot) and top > bot:
                out["range200_pos"][pos] = side * (c_t - (top + bot) / 2.0) / (top - bot)
            # --- 21-22 relative volume ------------------------------------
            if len(or_hist) >= 20:
                m = np.median(or_hist[-20:])
                if m > 0:
                    out["or_rvol"][pos] = r.or_vol / m
            slot = int(out["tod_min"][pos])
            hs = slot_hist.get(slot, [])
            if len(hs) >= 20:
                m = float(np.mean(hs[-20:]))
                if m > 0:
                    out["bar_rvol"][pos] = B["v"][j] / m
            # --- 23 volatility regime -------------------------------------
            s200 = I.atr_sma200[j]
            if np.isfinite(s200) and s200 > 0:
                out["atr_regime"][pos] = atr / s200
            # --- update the rolling histories AFTER using them ------------
            if r.date not in seen_dates:
                or_hist.append(r.or_vol)
                seen_dates.add(r.date)
            slot_hist.setdefault(slot, []).append(B["v"][j])
    for n, v in out.items():
        q[n] = v
    return q


def _vwap(tp: Tape, a: int, b: int) -> float:
    """VWAP over 1m bars [a, b] inclusive, typical price = (H+L+C)/3."""
    if b < a:
        return np.nan
    tpx = (tp.h[a:b + 1] + tp.l[a:b + 1] + tp.c[a:b + 1]) / 3.0
    v = tp.v[a:b + 1]
    s = v.sum()
    if s <= 0:
        return float(tpx.mean())
    return float((tpx * v).sum() / s)
