"""Indicator + Smart-Money-Concept primitives used by the exploratory strategies.

Everything here is causal: a value at bar i uses only bars <= i. Signals produced
from these columns are acted on at the OPEN of bar i+1 in the engine, so there is
no same-bar look-ahead.
"""
from __future__ import annotations
import numpy as np
import pandas as pd


# ---------------------------------------------------------------- classic TA
def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    pc = df.close.shift(1)
    tr = pd.concat([df.high - df.low, (df.high - pc).abs(), (df.low - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def rsi(s: pd.Series, n: int = 14) -> pd.Series:
    d = s.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def session_vwap(df: pd.DataFrame):
    """UTC-day-anchored VWAP and the running stdev of price around it."""
    day = df.ts.dt.floor("D")
    tp = (df.high + df.low + df.close) / 3
    pv = (tp * df.volume).groupby(day).cumsum()
    vv = df.volume.groupby(day).cumsum().replace(0, np.nan)
    vwap = pv / vv
    dev2 = ((tp - vwap) ** 2 * df.volume).groupby(day).cumsum() / vv
    return vwap, np.sqrt(dev2)


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Trend-strength gauge; used for regime tagging in the report."""
    up = df.high.diff()
    dn = -df.low.diff()
    plus = np.where((up > dn) & (up > 0), up, 0.0)
    minus = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = atr(df, n)
    pdi = 100 * pd.Series(plus, index=df.index).ewm(alpha=1 / n, adjust=False).mean() / a
    mdi = 100 * pd.Series(minus, index=df.index).ewm(alpha=1 / n, adjust=False).mean() / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False).mean()


# ------------------------------------------------------------------ SMC core
def fractals(df: pd.DataFrame, k: int = 2):
    """Confirmed swing points. A swing at bar i is only KNOWN at bar i+k, so the
    returned flags are shifted by k to stay causal."""
    hi, lo = df.high, df.low
    sh = (hi == hi.rolling(2 * k + 1, center=True).max()) & hi.notna()
    sl = (lo == lo.rolling(2 * k + 1, center=True).min()) & lo.notna()
    return (sh.shift(k) == True), (sl.shift(k) == True)


def structure(df: pd.DataFrame, k: int = 2) -> pd.DataFrame:
    """Market-structure state machine.

    Columns returned:
      swing_high / swing_low : last CONFIRMED, still-unbroken swing levels
      bias                   : +1 bullish structure, -1 bearish, 0 undecided
      bos                    : +1/-1 break of structure on this bar
      choch                  : +1/-1 when that BOS flipped the prevailing bias
      ob_low/ob_high/ob_dir  : active order block (last opposite candle before the
                               impulse that produced the most recent BOS)
      fvg_low/fvg_high/fvg_dir : most recent unmitigated fair value gap
      sweep                  : +1 low-side liquidity sweep, -1 high-side sweep
    """
    n = len(df)
    hi = df.high.to_numpy(); lo = df.low.to_numpy()
    op = df.open.to_numpy(); cl = df.close.to_numpy()
    sh_f, sl_f = fractals(df, k)
    sh_f = sh_f.to_numpy(); sl_f = sl_f.to_numpy()

    swing_h = np.full(n, np.nan); swing_l = np.full(n, np.nan)
    bias = np.zeros(n, dtype=np.int8)
    bos = np.zeros(n, dtype=np.int8); choch = np.zeros(n, dtype=np.int8)
    ob_lo = np.full(n, np.nan); ob_hi = np.full(n, np.nan); ob_dir = np.zeros(n, dtype=np.int8)
    fvg_lo = np.full(n, np.nan); fvg_hi = np.full(n, np.nan); fvg_dir = np.zeros(n, dtype=np.int8)
    sweep = np.zeros(n, dtype=np.int8)

    cur_h = np.nan; cur_l = np.nan
    b = 0
    o_lo = o_hi = np.nan; o_d = 0
    f_lo = f_hi = np.nan; f_d = 0

    for i in range(n):
        if sh_f[i]:
            cur_h = hi[i - k] if i - k >= 0 else hi[i]
        if sl_f[i]:
            cur_l = lo[i - k] if i - k >= 0 else lo[i]

        # liquidity sweep: wick through the swing, body closes back inside
        if not np.isnan(cur_l) and lo[i] < cur_l and cl[i] > cur_l:
            sweep[i] = 1
        if not np.isnan(cur_h) and hi[i] > cur_h and cl[i] < cur_h:
            sweep[i] = -1

        # break of structure requires a CLOSE beyond the confirmed swing
        if not np.isnan(cur_h) and cl[i] > cur_h:
            bos[i] = 1
            if b <= 0:
                choch[i] = 1
            b = 1
            j = i
            while j > max(-1, i - 30) and cl[j] >= op[j]:
                j -= 1
            if j >= 0 and cl[j] < op[j]:
                o_lo, o_hi, o_d = lo[j], hi[j], 1
            cur_h = np.nan
        elif not np.isnan(cur_l) and cl[i] < cur_l:
            bos[i] = -1
            if b >= 0:
                choch[i] = -1
            b = -1
            j = i
            while j > max(-1, i - 30) and cl[j] <= op[j]:
                j -= 1
            if j >= 0 and cl[j] > op[j]:
                o_lo, o_hi, o_d = lo[j], hi[j], -1
            cur_l = np.nan

        # fair value gap (3-bar imbalance), tracked until mitigated
        if i >= 2:
            if lo[i] > hi[i - 2]:
                f_lo, f_hi, f_d = hi[i - 2], lo[i], 1
            elif hi[i] < lo[i - 2]:
                f_lo, f_hi, f_d = hi[i], lo[i - 2], -1
        if f_d == 1 and lo[i] < f_lo:
            f_d = 0; f_lo = f_hi = np.nan
        elif f_d == -1 and hi[i] > f_hi:
            f_d = 0; f_lo = f_hi = np.nan
        if o_d == 1 and cl[i] < o_lo:
            o_d = 0; o_lo = o_hi = np.nan
        elif o_d == -1 and cl[i] > o_hi:
            o_d = 0; o_lo = o_hi = np.nan

        swing_h[i] = cur_h; swing_l[i] = cur_l
        bias[i] = b
        ob_lo[i], ob_hi[i], ob_dir[i] = o_lo, o_hi, o_d
        fvg_lo[i], fvg_hi[i], fvg_dir[i] = f_lo, f_hi, f_d

    return pd.DataFrame({
        "swing_high": swing_h, "swing_low": swing_l,
        "bias": bias, "bos": bos, "choch": choch,
        "ob_low": ob_lo, "ob_high": ob_hi, "ob_dir": ob_dir,
        "fvg_low": fvg_lo, "fvg_high": fvg_hi, "fvg_dir": fvg_dir,
        "sweep": sweep,
    }, index=df.index)
