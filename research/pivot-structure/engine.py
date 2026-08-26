"""Engine with the one mandated extension: the opposite-flip exit (DESIGN.md §4).

`backtest.py` (v1) is frozen and must not be modified, so `run_flip` is a
verbatim copy of `backtest.run` plus ~4 lines: an open position is closed at the
NEXT bar's open when a flip against it fires. `smoke_engine.py` asserts that with
an all-zero flip column `run_flip` reproduces `backtest.run` trade-for-trade.

Risk rules are unchanged: 1% of equity per trade sized off the stop, 2%-of-
UTC-day circuit breaker, 5 bp/side taker, next-bar-open fills, stop checked
before target on ambiguous bars.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

from common import bt


def run_flip(bars: pd.DataFrame, sig: pd.DataFrame, time_stop: int,
             flip: np.ndarray | None = None) -> dict:
    ts = bars.ts.to_numpy()
    o = bars.open.to_numpy(); h = bars.high.to_numpy()
    l = bars.low.to_numpy(); c = bars.close.to_numpy()
    s = sig.sig.to_numpy(); sp = sig.stop.to_numpy(); tg = sig.target.to_numpy()
    day = bars.ts.dt.floor("D").to_numpy()
    fl = np.zeros(len(bars), dtype=np.int8) if flip is None else np.asarray(flip)

    equity = bt.START_EQUITY
    day_open_eq = bt.START_EQUITY
    cur_day = day[0]
    halted = False

    pos = 0; entry = qty = stop = target = 0.0; bar_in = 0
    trades = []
    eq_curve = np.empty(len(bars)); eq_curve[:] = np.nan
    fee = bt.FEE_BPS / 10_000.0

    def close_trade(i, px, reason):
        nonlocal equity, pos
        gross = (px - entry) * qty * pos
        cost = (entry + px) * qty * fee
        pnl = gross - cost
        equity += pnl
        trades.append(dict(entry_ts=ts[bar_in], exit_ts=ts[i], side=pos,
                           entry=entry, exit=px, qty=qty, pnl=pnl,
                           r=pnl / (bt.RISK_PCT * day_open_eq) if day_open_eq else 0.0,
                           bars=i - bar_in, risk_px=abs(entry - stop),
                           reason=reason, equity=equity))
        pos = 0

    for i in range(len(bars)):
        if day[i] != cur_day:
            cur_day = day[i]; day_open_eq = equity; halted = False

        # ---- OPPOSITE-FLIP EXIT (the one extension): a flip against the open
        #      position on bar i-1 closes it at bar i's open, before anything else.
        if pos != 0 and i > 0 and fl[i - 1] != 0 and int(fl[i - 1]) != pos:
            close_trade(i, o[i], "flip")

        if pos != 0:
            if pos == 1:
                if l[i] <= stop:
                    close_trade(i, stop, "stop")
                elif h[i] >= target:
                    close_trade(i, target, "target")
            else:
                if h[i] >= stop:
                    close_trade(i, stop, "stop")
                elif l[i] <= target:
                    close_trade(i, target, "target")
            if pos != 0 and i - bar_in >= time_stop:
                close_trade(i, c[i], "time")

        open_pnl = (c[i] - entry) * qty * pos if pos != 0 else 0.0
        if (equity + open_pnl) <= day_open_eq * (1 - bt.DAILY_STOP_PCT):
            halted = True
        eq_curve[i] = equity + open_pnl

        if pos == 0 and not halted and i > 0 and s[i - 1] != 0:
            side = int(s[i - 1]); px = o[i]
            st_px, tp = sp[i - 1], tg[i - 1]
            risk_px = abs(px - st_px)
            ok = (risk_px > 1e-9
                  and ((side == 1 and st_px < px < tp) or (side == -1 and tp < px < st_px)))
            if ok:
                q = (bt.RISK_PCT * equity) / risk_px
                q = min(q, bt.MAX_LEVERAGE * equity / px)
                if q * px > 10:
                    pos, entry, qty, stop, target, bar_in = side, px, q, st_px, tp, i

    if pos != 0:
        close_trade(len(bars) - 1, c[-1], "eod")

    return dict(trades=pd.DataFrame(trades),
                equity=pd.Series(eq_curve, index=bars.ts))


def breaker_bind(bars: pd.DataFrame, res: dict) -> float:
    """Share of UTC days on which the 2% circuit breaker halted new entries."""
    eq = res["equity"].dropna()
    if eq.empty:
        return float("nan")
    day = eq.index.floor("D")
    g = eq.groupby(day)
    hit = (g.min() <= g.first() * (1 - bt.DAILY_STOP_PCT))
    return float(hit.mean())
