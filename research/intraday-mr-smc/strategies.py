"""The three candidate rule-sets, expressed as intent columns on the bar frame.

Each generator returns a frame with, per bar:
    sig    : +1 long / -1 short / 0 nothing (act on NEXT bar's open)
    stop   : protective stop price for that intent
    target : profit target price for that intent

The engine (backtest.py) is responsible for sizing, fees, the daily
circuit-breaker and the actual fill mechanics. Keeping the rule-sets free of any
money management makes the three candidates directly comparable.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import indicators as ind

# Deliberately few free parameters per candidate: this is feasibility work, and
# every extra knob is another degree of freedom to overfit with.
DEFAULTS = dict(
    mr_len=50,        # mean/band lookback
    mr_z=2.0,         # overextension threshold in sigmas
    atr_len=14,
    stop_atr=1.5,     # protective stop distance
    time_stop=24,     # bars before an unresolved trade is abandoned
    smc_k=2,          # fractal half-width for swing detection
    smc_rr=2.0,       # SMC reward:risk target
    sweep_lookback=6, # bars a hybrid sweep stays "fresh"
    htf_mult=4,       # higher-timeframe multiple for hybrid regime filter
    tp_frac=1.0,      # fraction of the distance back to the mean taken as target
)


def prepare(df: pd.DataFrame, p: dict) -> pd.DataFrame:
    d = df.copy()
    d["atr"] = ind.atr(d, p["atr_len"])
    d["mean"] = d.close.rolling(p["mr_len"]).mean()
    d["sd"] = d.close.rolling(p["mr_len"]).std()
    d["z"] = (d.close - d["mean"]) / d["sd"].replace(0, np.nan)
    d["rsi"] = ind.rsi(d.close, 14)
    d["vwap"], d["vwsd"] = ind.session_vwap(d)
    d["adx"] = ind.adx(d, 14)
    return pd.concat([d, ind.structure(d, p["smc_k"])], axis=1)


# ---------------------------------------------------------------- candidate 1
def mean_reversion(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Fade a statistical overextension once it stops extending.

    Long  : close was <= -Z sigma from the rolling mean on the previous bar and
            this bar closes back above that band (the turn), with RSI confirming
            the stretch. Short is the mirror.
    Stop  : stop_atr * ATR beyond the entry bar's extreme.
    Target: the rolling mean itself (the thing we claim price reverts to).
    """
    z, zp = d.z, d.z.shift(1)
    long_ = (zp <= -p["mr_z"]) & (z > -p["mr_z"]) & (d.rsi < 40)
    short = (zp >= p["mr_z"]) & (z < p["mr_z"]) & (d.rsi > 60)
    sig = np.where(long_, 1, np.where(short, -1, 0))
    stop = np.where(sig == 1, d.low - p["stop_atr"] * d.atr,
                    np.where(sig == -1, d.high + p["stop_atr"] * d.atr, np.nan))
    target = np.where(sig != 0, d.close + p["tp_frac"] * (d["mean"] - d.close), np.nan)
    return _pack(d, sig, stop, target)


# ---------------------------------------------------------------- candidate 2
def smc(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Trade with structure: after a break of structure establishes direction,
    buy the retracement into the order block / fair value gap that produced it.

    Long  : bullish structure bias, an active bullish order block, and this bar
            trades down into that block (or into a bullish FVG) while closing
            back above it.
    Stop  : just under the order block low. Target: smc_rr multiples of that risk.
    """
    in_ob_l = (d.ob_dir == 1) & (d.low <= d.ob_high) & (d.close > d.ob_low)
    in_fv_l = (d.fvg_dir == 1) & (d.low <= d.fvg_high) & (d.close > d.fvg_low)
    long_ = (d.bias == 1) & (in_ob_l | in_fv_l)

    in_ob_s = (d.ob_dir == -1) & (d.high >= d.ob_low) & (d.close < d.ob_high)
    in_fv_s = (d.fvg_dir == -1) & (d.high >= d.fvg_low) & (d.close < d.fvg_high)
    short = (d.bias == -1) & (in_ob_s | in_fv_s)

    sig = np.where(long_ & ~short, 1, np.where(short & ~long_, -1, 0))
    base_lo = np.where(d.ob_dir == 1, d.ob_low, d.fvg_low)
    base_hi = np.where(d.ob_dir == -1, d.ob_high, d.fvg_high)
    buf = 0.25 * d.atr
    stop = np.where(sig == 1, np.minimum(base_lo, d.low) - buf,
                    np.where(sig == -1, np.maximum(base_hi, d.high) + buf, np.nan))
    risk = np.abs(d.close - stop)
    target = np.where(sig == 1, d.close + p["smc_rr"] * risk,
                      np.where(sig == -1, d.close - p["smc_rr"] * risk, np.nan))
    return _pack(d, sig, stop, target)


# ---------------------------------------------------------------- candidate 3
def hybrid(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Mean-reversion entries, but only where SMC says the fade is the
    higher-probability side.

    Gate 1 (regime)      : higher-timeframe structure bias must not oppose the trade.
    Gate 2 (exhaustion)  : a liquidity sweep in the trade's direction within the
                           last `sweep_lookback` bars -- i.e. the overextension
                           just ran stops and failed.
    Entry mechanics      : identical z-score turn used by candidate 1.
    Stop                 : beyond the swept extreme (structural), floored at
                           stop_atr * ATR so it is never absurdly tight.
    Target               : the rolling mean.
    """
    lb = p["sweep_lookback"]
    sweep_up = (d.sweep == 1).rolling(lb, min_periods=1).max().astype(bool)
    sweep_dn = (d.sweep == -1).rolling(lb, min_periods=1).max().astype(bool)
    sweep_lo = d.low.rolling(lb, min_periods=1).min()
    sweep_hi = d.high.rolling(lb, min_periods=1).max()

    z, zp = d.z, d.z.shift(1)
    long_ = (zp <= -p["mr_z"]) & (z > -p["mr_z"]) & sweep_up & (d.htf_bias >= 0)
    short = (zp >= p["mr_z"]) & (z < p["mr_z"]) & sweep_dn & (d.htf_bias <= 0)

    sig = np.where(long_, 1, np.where(short, -1, 0))
    stop = np.where(sig == 1, np.minimum(sweep_lo, d.low - p["stop_atr"] * d.atr),
                    np.where(sig == -1, np.maximum(sweep_hi, d.high + p["stop_atr"] * d.atr), np.nan))
    target = np.where(sig != 0, d.close + p["tp_frac"] * (d["mean"] - d.close), np.nan)
    return _pack(d, sig, stop, target)


def _pack(d, sig, stop, target) -> pd.DataFrame:
    out = pd.DataFrame({"sig": sig, "stop": stop, "target": target}, index=d.index)
    bad = out.stop.isna() | out.target.isna() | (out.stop <= 0)
    out.loc[bad, ["sig", "stop", "target"]] = [0, np.nan, np.nan]
    return out


def add_htf_bias(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Structure bias computed on a resampled higher timeframe, forward-filled
    back onto the trading timeframe with a one-bar lag (HTF bar must be closed)."""
    mult = p["htf_mult"]
    h = (d.set_index("ts")
           .resample(_htf_rule(d, mult))
           .agg({"open": "first", "high": "max", "low": "min",
                 "close": "last", "volume": "sum"})
           .dropna()
           .reset_index())
    st = ind.structure(h, p["smc_k"])
    h = h.assign(htf_bias=st.bias.shift(1).fillna(0).to_numpy())
    m = pd.merge_asof(d[["ts"]], h[["ts", "htf_bias"]], on="ts", direction="backward")
    d = d.copy()
    d["htf_bias"] = m.htf_bias.fillna(0).to_numpy()
    return d


def _htf_rule(d: pd.DataFrame, mult: int) -> str:
    minutes = int(round((d.ts.iloc[1] - d.ts.iloc[0]).total_seconds() / 60)) * mult
    return f"{minutes}min"


CANDIDATES = {"mean_reversion": mean_reversion, "smc": smc, "hybrid": hybrid}
