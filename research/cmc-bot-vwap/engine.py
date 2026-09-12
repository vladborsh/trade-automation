"""Bug-faithful Python port of `cmc-bot`'s `VWapStrategy` — Stage 0.

Reproduces, bar for bar, what `BacktestRunner.runTests` + `StrategyTemplate.processStep`
+ `VWapStrategy` + `RiskManager` + `Order` do over a static 1-minute tape:

    for every minute T:                                     backtest-runner.ts:66-79
        if not canOrdersBeAlive(T): force-close open orders on lastCandles; continue
        candles = tape[openTime in [T-12h, T]]              static-data-source.ts:44
        checkAndCloseOrders (close-only, strict <, >)       strategy-template.ts:207-245
        verifyExistingOrders (trail, both-directions rule)  vwap-strategy.ts:196-222
        if isValidTimeForNewOrders(T): processCharts -> putOrder

Every indicator is evaluated on exactly the window the bot would hand it, by
timestamp, so gaps in the Capital.com tape are handled the way the bot handles
them (a missing minute T re-evaluates the previous bar; nothing assumes a
contiguous grid). Every behaviour that looks like a bug is reproduced, not
fixed — see PARITY.md's disposition table; the `D-xx` tags below point there.

No performance number is computed here: trades carry prices and timestamps only.
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np
import pandas as pd
from numba import njit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (ATR_LEN, BUY, DAY_MS, MAX_IFVG_TO_ATR_RATIO, MAX_VWAP_ATR_RATIO,  # noqa: E402
                    MIN_MS, MIN_VWAP_ATR_RATIO, RANGE_LEN, SELL, TARGET_RR, TIMINGS,
                    WINDOW_MS, load_1m, ny_window_utc_ms)

# component vector layout (one row per evaluated bar)
COMP = ["n", "range_top", "range_bottom", "in_disc", "bull_occ", "bear_occ",
        "has_ifvg", "ifvg_low", "ifvg_high", "n_bull_ifvg", "n_bear_ifvg", "atr",
        "prev_found", "prev_high", "prev_low", "n_bias", "vwap", "vwap_top", "vwap_bottom",
        "hi6", "lo6", "err"]
_C = {k: i for i, k in enumerate(COMP)}
NCOMP = len(COMP)


@njit(cache=True, error_model="numpy")
def components(t, o, h, l, c, v, s, g, b0):
    """Everything `processCandles` + `getHighTimeFrameBias` compute for one bar.

    Main window = global [s, g] (openTime in [T-12h, T]); bias window = [b0, g]
    (openTime in [startOfDay(T)+1min, T]).
    """
    out = np.full(NCOMP, np.nan)
    n = g - s + 1
    out[0] = n
    out[21] = 0.0
    if n <= 0:
        out[21] = 1.0
        return out

    # ---- range(v, 200)  (range.indicator.ts) -----------------------------
    # The slide pushes the window's max BEFORE appending candles[barIndex], so
    # the last value covers local [n-201, n-2]: the 200 bars BEFORE the current
    # bar (D-06). No value at all unless n >= 201.
    if n >= RANGE_LEN + 1:
        top = -np.inf; bot = np.inf
        for k in range(g - RANGE_LEN, g):
            if h[k] > top: top = h[k]
            if l[k] < bot: bot = l[k]
        out[1] = top; out[2] = bot
        out[3] = 1.0 if c[g] < (top + bot) / 2 else 0.0
    else:
        out[3] = 0.0          # close < NaN -> false

    # ---- calculateFVG  (fvg.indicator.ts, fvg-element.ts) ----------------
    cap = n + 4
    bf_lo = np.empty(cap); bf_x = np.empty(cap, np.int64); bf_hi = np.empty(cap)
    sf_lo = np.empty(cap); sf_x = np.empty(cap, np.int64); sf_hi = np.empty(cap)
    bi_lo = np.empty(cap); bi_x = np.empty(cap, np.int64); bi_hi = np.empty(cap)
    si_lo = np.empty(cap); si_x = np.empty(cap, np.int64); si_hi = np.empty(cap)
    nbf = 0; nsf = 0; nbi = 0; nsi = 0
    d_bull = False; d_bear = False
    for j in range(3, n):                    # `if (i > 2)`
        gg = s + j
        # getFvgElement: current vs i-2 only; the body clause compares close[i] to open[i-2]
        if c[gg] > o[gg - 2] and l[gg] > h[gg - 2]:
            bf_lo[nbf] = h[gg - 2]; bf_hi[nbf] = l[gg]; bf_x[nbf] = j; nbf += 1
        if c[gg] < o[gg - 2] and h[gg] < l[gg - 2]:
            sf_lo[nsf] = h[gg]; sf_hi[nsf] = l[gg - 2]; sf_x[nsf] = j; nsf += 1
        op = o[gg]; cl = c[gg]
        f_bull = False; f_bear = False
        w = 0
        for k in range(nbf):                 # bullish FVG inverted through its PROXIMAL (low) edge
            if not (op > bf_lo[k] and cl < bf_lo[k]):
                bf_lo[w] = bf_lo[k]; bf_hi[w] = bf_hi[k]; bf_x[w] = bf_x[k]; w += 1
            else:
                f_bull = True
                si_lo[nsi] = bf_lo[k]; si_hi[nsi] = bf_hi[k]; si_x[nsi] = bf_x[k]; nsi += 1
        nbf = w
        w = 0
        for k in range(nsf):                 # bearish FVG inverted through its PROXIMAL (high) edge
            if not (op < sf_hi[k] and cl > sf_hi[k]):
                sf_lo[w] = sf_lo[k]; sf_hi[w] = sf_hi[k]; sf_x[w] = sf_x[k]; w += 1
            else:
                f_bear = True
                bi_lo[nbi] = sf_lo[k]; bi_hi[nbi] = sf_hi[k]; bi_x[nbi] = sf_x[k]; nbi += 1
        nsf = w
        # filterInverseFvgArrays — same predicate, applied to the iFVG lists
        w = 0
        for k in range(nbi):
            if not (op > bi_lo[k] and cl < bi_lo[k]):
                bi_lo[w] = bi_lo[k]; bi_hi[w] = bi_hi[k]; bi_x[w] = bi_x[k]; w += 1
        nbi = w
        w = 0
        for k in range(nsi):
            if not (op < si_hi[k] and cl > si_hi[k]):
                si_lo[w] = si_lo[k]; si_hi[w] = si_hi[k]; si_x[w] = si_x[k]; w += 1
        nsi = w
        if j == n - 1:                       # flags read only off the last bar
            d_bull = f_bull; d_bear = f_bear
    out[4] = 1.0 if d_bear else 0.0          # bullishIfvgOccurs = isLastCandleDiscardBearishFvg
    out[5] = 1.0 if d_bull else 0.0          # bearishIfvgOccurs = isLastCandleDiscardBullishFvg
    out[9] = nbi; out[10] = nsi
    # getLastIfvg (D-03): bullish list empty -> bearish[bullish.length-1] = bearish[-1]
    # -> undefined; bearish list empty -> bullish[bullish.length-1], a VALID element.
    if nbi == 0:
        out[6] = 0.0
    elif nsi == 0:
        out[6] = 1.0; out[7] = bi_lo[nbi - 1]; out[8] = bi_hi[nbi - 1]
    else:
        out[6] = 1.0
        if bi_x[nbi - 1] > si_x[nsi - 1]:
            out[7] = bi_lo[nbi - 1]; out[8] = bi_hi[nbi - 1]
        else:
            out[7] = si_lo[nsi - 1]; out[8] = si_hi[nsi - 1]

    # ---- ATR(v, 20)  (atr.indicator.ts): arithmetic mean of the last 20 TRs
    if n >= ATR_LEN + 1:
        acc = 0.0
        for k in range(n - ATR_LEN - 1, n - 1):      # trueRanges.slice(i-20, i), i = n-1
            gk = s + k + 1
            hl = h[gk] - l[gk]
            hc = abs(h[gk] - c[gk - 1])
            lc = abs(l[gk] - c[gk - 1])
            tr = hl
            if hc > tr: tr = hc
            if lc > tr: tr = lc
            acc = acc + tr
        out[11] = acc / ATR_LEN

    # ---- previousHourLH  (previous-hour-lh.indicator.ts) -----------------
    hs = ((t[g] - 3600000) // 3600000) * 3600000     # setMinutes(0) on (openTime - 1h)
    he = hs + 59 * 60000                             # setMinutes(59), both ends inclusive
    found = False; ph = 0.0; pl = 0.0
    for k in range(s, g):                            # i < candles.length - 1
        if t[k] >= hs and t[k] <= he:
            if not found:
                ph = h[k]; pl = l[k]; found = True
            else:
                if l[k] < pl: pl = l[k]
                if h[k] > ph: ph = h[k]
    if found:
        out[12] = 1.0; out[13] = ph; out[14] = pl
    else:
        out[12] = 0.0
    # abovePrevHourHigh / belowPrevHourLow: current bar + the 5 before it
    if n >= 6:
        hi6 = h[g]; lo6 = l[g]
        for k in range(g - 5, g):
            if h[k] > hi6: hi6 = h[k]
            if l[k] < lo6: lo6 = l[k]
        out[19] = hi6; out[20] = lo6

    # ---- VWAP over the bias window  (vwap.indicator.ts) ------------------
    nb = g - b0 + 1
    out[15] = nb
    if nb <= 0:
        out[21] = 2.0                                # VWAP(candles[0]) throws on []
        return out
    day0 = (t[b0] // 86400000) * 86400000
    cum_v = 0.0; cum_pv = 0.0
    devs = np.empty(nb)
    nd = 0
    vw = np.nan; sd = np.nan
    for k in range(b0, g + 1):
        dk = (t[k] // 86400000) * 86400000
        if dk != day0:
            day0 = dk; cum_v = 0.0; cum_pv = 0.0; nd = 0
        cum_v = cum_v + v[k]
        cum_pv = cum_pv + c[k] * v[k]
        vw = cum_pv / cum_v
        devs[nd] = c[k] - vw; nd += 1
        if k == g:                                    # only the last value is read
            dist = (t[k] - day0) // 60000             # differenceInMinutes
            st = nd - dist
            if st < 0: st = 0
            m = nd - st
            sm = 0.0
            for q in range(st, nd): sm = sm + devs[q]
            mean = sm / m
            var = 0.0
            for q in range(st, nd):
                dq = devs[q] - mean
                var = var + dq * dq
            sd = math.sqrt(var / m)
    out[16] = vw; out[17] = vw + sd; out[18] = vw - sd
    return out


class Order:
    __slots__ = ("dir", "entry", "entry_ts", "stop", "stop0", "target", "init", "closed",
                 "close_ts", "close_price", "profitable", "signal_ts", "n_trail", "why")

    def __init__(self, d, entry, entry_ts, stop, target, signal_ts):
        self.dir = d; self.entry = entry; self.entry_ts = entry_ts
        self.stop = stop; self.stop0 = stop; self.target = target
        self.init = abs(stop - entry)
        self.closed = False; self.close_ts = None; self.close_price = None
        self.profitable = False; self.signal_ts = signal_ts; self.n_trail = 0; self.why = None

    def close(self, ts, price, why):                  # order.ts:91-105, clamping included (D-10)
        self.closed = True; self.close_ts = ts; self.why = why
        if self.dir == BUY:
            self.profitable = self.entry < price
            if price < self.stop: price = self.stop
            elif price > self.target: price = self.target
        else:
            self.profitable = self.entry > price
            if price > self.stop: price = self.stop
            elif price < self.target: price = self.target
        self.close_price = price

    def trail(self, k):                               # order.ts:74-88
        if self.dir == BUY:
            ns = self.entry + k * self.init
            if ns > self.stop: self.stop = ns; return True
        else:
            ns = self.entry - k * self.init
            if ns < self.stop: self.stop = ns; return True
        return False


def prepare(symbol: str, df: pd.DataFrame | None = None) -> dict:
    df = load_1m(symbol) if df is None else df
    return dict(symbol=symbol,
                t=np.ascontiguousarray(df.t_ms.values.astype(np.int64)),
                o=np.ascontiguousarray(df.open.values.astype(np.float64)),
                h=np.ascontiguousarray(df.high.values.astype(np.float64)),
                l=np.ascontiguousarray(df.low.values.astype(np.float64)),
                c=np.ascontiguousarray(df.close.values.astype(np.float64)),
                v=np.ascontiguousarray(df.volume.values.astype(np.float64)))


def alive_minutes(symbol: str, lo_ms: int, hi_ms: int):
    """Chronological (T, is_entry) for every minute the bot is alive, Mon-Fri by UTC getDay."""
    tm = TIMINGS[symbol]
    out_t, out_e = [], []
    d = (lo_ms // DAY_MS) * DAY_MS
    while d <= hi_ms:
        wd = pd.Timestamp(d, unit="ms").dayofweek        # Mon=0
        if wd <= 4:
            a0, a1 = ny_window_utc_ms(d, *tm["alive"])
            e0, e1 = ny_window_utc_ms(d, *tm["entry"])
            for T in range(a0, a1 + 1, MIN_MS):
                if lo_ms <= T <= hi_ms:
                    out_t.append(T); out_e.append(e0 <= T <= e1)
            # the first non-alive minute, where the forced flat happens
            if lo_ms <= a1 + MIN_MS <= hi_ms:
                out_t.append(a1 + MIN_MS); out_e.append(None)
        d += DAY_MS
    return np.array(out_t, np.int64), out_e


def run(P: dict, lo_ms: int, hi_ms: int, daily_caps: bool = True, record_components: bool = True,
        live_like: bool = False):
    """The bot's bar loop over [lo_ms, hi_ms] (inclusive). Returns (trades, evals, events).

    `live_like=True` is NOT the parity target. It approximates what the deployed
    bot sees (PARITY.md L-01): at wall-clock minute T the live request
    [T-12h, T] with `max: 720` drops the newest candle, so every read ends at the
    bar that opened at T-1 while the clock gates still use T. The forming candle
    the live bias request can include is not reproducible from history and is
    not modelled.
    """
    t, o, h, l, c, v = P["t"], P["o"], P["h"], P["l"], P["c"], P["v"]
    Ts, is_entry = alive_minutes(P["symbol"], lo_ms, hi_ms)
    G = np.searchsorted(t, Ts - (MIN_MS if live_like else 0), "right") - 1
    S = np.searchsorted(t, Ts - WINDOW_MS, "left")
    B0 = np.searchsorted(t, (Ts // DAY_MS) * DAY_MS + MIN_MS, "left")

    orders: list[Order] = []
    last_g = None                     # lastCandles, as its last index (None = empty)
    evals = []
    events = []

    for i in range(len(Ts)):
        T = int(Ts[i]); ent = is_entry[i]
        if ent is None:               # !canOrdersBeAlive -> processOutOfValidTime(lastCandles)
            if last_g is not None:
                for od in orders:
                    if not od.closed:
                        od.close(int(t[last_g]), float(c[last_g]), "STRATEGY")
                        events.append(("close", od))
            continue
        g = int(G[i]); s = int(S[i])
        n = g - s + 1
        if n <= 0:                    # getCandles -> []: lastCandles = [], no signal
            last_g = None
            if ent and record_components:
                evals.append(dict(T=T, n=0, err=1.0, bias=-1, signal=-1))
            continue
        last_g = g
        cg = float(c[g])
        # ---- checkAndCloseOrders: close-only, strict (D-11) ---------------
        for od in orders:
            if od.closed:
                continue
            if od.dir == BUY:
                if cg < od.stop: od.close(int(t[g]), cg, "STOP_LOSS"); events.append(("close", od))
                elif cg > od.target: od.close(int(t[g]), cg, "TAKE_PROFIT"); events.append(("close", od))
            else:
                if cg > od.stop: od.close(int(t[g]), cg, "STOP_LOSS"); events.append(("close", od))
                elif cg < od.target: od.close(int(t[g]), cg, "TAKE_PROFIT"); events.append(("close", od))
        # ---- verifyExistingOrders ----------------------------------------
        opened = [od for od in orders if not od.closed]
        for od in opened:
            prof = (cg - od.entry) if od.dir == BUY else (od.entry - cg)
            r = prof / od.init if od.init != 0 else (math.copysign(math.inf, prof) if prof != 0 else math.nan)
            moved = False
            if r > 1 and r < 2:
                moved = od.trail(0) or moved
            if r > 2:
                moved = od.trail(1) or moved
            if moved:
                od.n_trail += 1; events.append(("trail", od))
        ob = [od for od in opened if od.dir == BUY]
        osl = [od for od in opened if od.dir == SELL]
        if ob and osl:
            lst = ob + osl
            acc = lst[0]
            for cur in lst[1:]:
                acc = acc if acc.entry_ts < cur.entry_ts else cur
            acc.close(int(t[g]), cg, "STRATEGY"); events.append(("close", acc))
        if not ent:
            continue
        # ---- processCharts ------------------------------------------------
        comp = components(t, o, h, l, c, v, s, g, int(B0[i]))
        rec = dict(T=T, g_ts=int(t[g]), s_ts=int(t[s]))
        bias = None
        err = comp[_C["err"]]
        if err == 0:
            last_open = o[g]                              # lastCandle.open, not close (D-05)
            if last_open > comp[_C["vwap_top"]]:
                bias = SELL
            elif last_open < comp[_C["vwap_bottom"]]:
                bias = BUY
        sig = None
        if bias is not None:
            atr = comp[_C["atr"]]
            ratio = (comp[_C["vwap_top"]] - comp[_C["vwap_bottom"]]) / atr if atr != 0 else \
                (math.nan if comp[_C["vwap_top"]] == comp[_C["vwap_bottom"]] else math.inf)
            if comp[_C["has_ifvg"]] == 1.0:
                sz = abs(comp[_C["ifvg_low"]] - comp[_C["ifvg_high"]])
                q = atr / sz if sz != 0 else (math.inf if atr != 0 else math.nan)
                ifvg_ok = q < MAX_IFVG_TO_ATR_RATIO
            else:
                ifvg_ok = False
            if comp[_C["prev_found"]] == 1.0:
                if n < 6:                                 # candles[negative].high throws:
                    comp[_C["err"]] = 3.0                 # processStep rejects, no signal
                    bias = None
                above = comp[_C["hi6"]] > comp[_C["prev_high"]]
                below = comp[_C["lo6"]] < comp[_C["prev_low"]]
            else:
                above = below = False
            ratio_ok = (ratio >= MIN_VWAP_ATR_RATIO) and (ratio <= MAX_VWAP_ATR_RATIO)
            if daily_caps:
                day = (int(t[g]) // DAY_MS)
                losses = sum(1 for od in orders if od.closed and od.close_ts is not None
                             and od.close_ts // DAY_MS == day and not od.profitable)
                wins = sum(1 for od in orders if od.closed and od.close_ts is not None
                           and od.close_ts // DAY_MS == day and od.profitable)
                caps_ok = losses < 2 and wins < 1
            else:
                caps_ok = True
            in_disc = comp[_C["in_disc"]] == 1.0
            sell = (comp[_C["bear_occ"]] == 1.0 and ratio_ok and not in_disc and bias == SELL
                    and ifvg_ok and above and caps_ok)
            buy = (not sell) and (comp[_C["bull_occ"]] == 1.0 and ratio_ok and in_disc and bias == BUY
                                  and ifvg_ok and below and caps_ok)
            rec.update(ratio=ratio, ifvg_ok=ifvg_ok, above=above, below=below, caps_ok=caps_ok)
            if (sell or buy) and bias is not None:
                d = SELL if sell else BUY
                sig = d
                lo_r, hi_r = comp[_C["range_bottom"]], comp[_C["range_top"]]
                stop, target = stop_target(cg, lo_r, hi_r, d)
                allowed = (len(orders) == 0) or not any((not od.closed) and od.dir == d for od in orders)
                placed = False
                if allowed and _truthy(stop) and _truthy(target):
                    entry_ts = int(t[g]) + (int(t[g]) - int(t[g - 1]))   # openTime + getInterval
                    od = Order(d, cg, entry_ts, stop, target, T)
                    orders.append(od); placed = True
                    events.append(("signal", od))
                rec.update(stop=stop, target=target, allowed=allowed, placed=placed)
        rec["bias"] = -1 if bias is None else bias
        rec["signal"] = -1 if sig is None else sig
        if record_components:
            for k, name in enumerate(COMP):
                rec[name] = comp[k]
        evals.append(rec)

    trades = pd.DataFrame([dict(signal_ts=od.signal_ts, entry_ts=od.entry_ts, dir=od.dir, entry=od.entry,
                                stop0=od.stop0, target=od.target, exit_ts=od.close_ts,
                                exit_price=od.close_price, stop=od.stop, n_trail=od.n_trail, why=od.why,
                                closed=od.closed) for od in orders])
    return trades, pd.DataFrame(evals), events


def _truthy(x) -> bool:
    return not (x == 0 or (isinstance(x, float) and math.isnan(x)))


def stop_target(entry: float, range_low: float, range_high: float, d: int) -> tuple[float, float]:
    """RiskManager.adjustStopLoss + adjustTakeProfitToTargetRiskRewardRatio."""
    anchor = range_low if d == BUY else range_high
    size = abs(anchor - entry)
    rng = abs(range_low - range_high)
    ratio = rng / size if size != 0 else (math.inf if rng != 0 else math.nan)
    k = 1.0
    if ratio < 3 and ratio >= 2.5:
        k = 0.7
    elif ratio < 2.5:
        k = 0.5
    new_size = size * k
    stop = entry - new_size if d == BUY else entry + new_size
    if d == BUY:
        target = entry + TARGET_RR * (entry - stop)
    else:
        target = entry - TARGET_RR * (stop - entry)
    return stop, target
