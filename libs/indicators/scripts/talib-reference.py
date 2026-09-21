"""
Generates test/fixtures/talib-reference.json — the independent reference for the T-027 indicator
specs. Run with a Python that has TA-Lib (https://ta-lib.org, `pip install TA-Lib`):

    python3 scripts/talib-reference.py > test/fixtures/talib-reference.json

The input is a deterministic 300-bar random walk (a 32-bit LCG, so it is reproducible without
numpy's RNG). Outputs are TA-Lib's, NaN written as null. MACD is referenced through TA-Lib's own
EMA (EMA12 − EMA26, then EMA9 of that series) because TA-Lib's MACD function seeds its fast EMA
later than the standard definition; TA-Lib's MACD is included too, for the convergence check.
"""
import json
import numpy as np
import talib

state = 20260921
def rnd():
    global state
    state = (1664525 * state + 1013904223) % 2**32
    return state / 2**32

n = 300
bars = []
close = 100.0
for i in range(n):
    open_ = close
    close = round(open_ * (1 + (rnd() - 0.5) * 0.04), 4)
    high = round(max(open_, close) * (1 + rnd() * 0.01), 4)
    low = round(min(open_, close) * (1 - rnd() * 0.01), 4)
    bars.append({"openTime": 1_700_000_000_000 + i * 60_000, "open": open_, "high": high, "low": low, "close": close})

c = np.array([b["close"] for b in bars], dtype=float)
h = np.array([b["high"] for b in bars], dtype=float)
l = np.array([b["low"] for b in bars], dtype=float)
nul = lambda a: [None if np.isnan(x) else float(x) for x in a]

ema12, ema26 = talib.EMA(c, 12), talib.EMA(c, 26)
line = ema12 - ema26
first = int(np.argmax(~np.isnan(line)))
signal = np.full(n, np.nan)
signal[first:] = talib.EMA(line[first:], 9)
upper, middle, lower = talib.BBANDS(c, timeperiod=20, nbdevup=2, nbdevdn=2, matype=0)
k, d = talib.STOCH(h, l, c, fastk_period=14, slowk_period=3, slowk_matype=0, slowd_period=3, slowd_matype=0)
m_line, m_signal, m_hist = talib.MACD(c, 12, 26, 9)

flat = np.full(30, 100.0)
up = np.arange(100.0, 130.0)
print(json.dumps({
    "source": "TA-Lib " + talib.__version__ + " via scripts/talib-reference.py",
    "bars": bars,
    "sma20": nul(talib.SMA(c, 20)),
    "ema20": nul(talib.EMA(c, 20)),
    "rsi14": nul(talib.RSI(c, 14)),
    "macd": {"macd": nul(line), "signal": nul(signal), "hist": nul(line - signal)},
    "talibMacd": {"macd": nul(m_line), "signal": nul(m_signal), "hist": nul(m_hist)},
    "bbands20_2": {"upper": nul(upper), "middle": nul(middle), "lower": nul(lower)},
    "stoch14_3_3": {"k": nul(k), "d": nul(d)},
    "edge": {"rsiFlat14": nul(talib.RSI(flat, 14))[14:16], "rsiUp14": nul(talib.RSI(up, 14))[14:16]},
}, indent=None))
