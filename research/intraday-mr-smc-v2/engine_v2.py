"""Gap-aware variant of the v1 trade engine, needed for THREAD 3.

v1's `backtest.run` assumes a stop or target that is inside a bar's range fills
AT the stop/target price. That is fine for a 24/7 crypto series where the next
bar opens where the last one closed. It is NOT fine for an equity index, where
every session boundary is a gap: a stop 0.4% below entry can open 1.5% below it
and the v1 engine would still book -0.4%.

This copy changes exactly one thing: if the bar's OPEN is already beyond the
stop (or the target), the fill happens at the open, not at the level. Everything
else -- next-bar-open entries, 1% risk sizing off the stop distance, the 2%
daily circuit-breaker on realised+open PnL, stop-before-target on ambiguous
bars, the fee model -- is identical to v1 so results stay comparable.

Sanity check (`run_assets.py --engine-check`): on 24/7 crypto the two engines
give near-identical numbers, which is the point -- the difference is a
session-gap effect, not an engine rewrite.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import backtest as bt

START_EQUITY = bt.START_EQUITY
RISK_PCT = bt.RISK_PCT
DAILY_STOP_PCT = bt.DAILY_STOP_PCT
MAX_LEVERAGE = bt.MAX_LEVERAGE


def run(bars: pd.DataFrame, sig: pd.DataFrame, time_stop: int, fee_bps: float = 5.0) -> dict:
    ts = bars.ts.to_numpy()
    o = bars.open.to_numpy(); h = bars.high.to_numpy()
    l = bars.low.to_numpy(); c = bars.close.to_numpy()
    s = sig.sig.to_numpy(); sp = sig.stop.to_numpy(); tg = sig.target.to_numpy()
    day = bars.ts.dt.floor("D").to_numpy()

    equity = START_EQUITY
    day_open_eq = START_EQUITY
    cur_day = day[0]
    halted = False
    pos = 0; entry = qty = stop = target = 0.0; bar_in = 0
    trades = []
    eq_curve = np.full(len(bars), np.nan)
    fee = fee_bps / 10_000.0

    def close_trade(i, px, reason):
        nonlocal equity, pos
        gross = (px - entry) * qty * pos
        cost = (entry + px) * qty * fee
        pnl = gross - cost
        equity += pnl
        trades.append(dict(entry_ts=ts[bar_in], exit_ts=ts[i], side=pos,
                           entry=entry, exit=px, qty=qty, pnl=pnl,
                           r=pnl / (RISK_PCT * day_open_eq) if day_open_eq else 0.0,
                           reason=reason, equity=equity))
        pos = 0

    for i in range(len(bars)):
        if day[i] != cur_day:
            cur_day = day[i]; day_open_eq = equity; halted = False

        if pos != 0:
            if pos == 1:
                if o[i] <= stop:                       # gapped through the stop
                    close_trade(i, o[i], "gap_stop")
                elif o[i] >= target:                   # gapped past the target
                    close_trade(i, o[i], "gap_target")
                elif l[i] <= stop:
                    close_trade(i, stop, "stop")
                elif h[i] >= target:
                    close_trade(i, target, "target")
            else:
                if o[i] >= stop:
                    close_trade(i, o[i], "gap_stop")
                elif o[i] <= target:
                    close_trade(i, o[i], "gap_target")
                elif h[i] >= stop:
                    close_trade(i, stop, "stop")
                elif l[i] <= target:
                    close_trade(i, target, "target")
            if pos != 0 and i - bar_in >= time_stop:
                close_trade(i, c[i], "time")

        open_pnl = (c[i] - entry) * qty * pos if pos != 0 else 0.0
        if (equity + open_pnl) <= day_open_eq * (1 - DAILY_STOP_PCT):
            halted = True
        eq_curve[i] = equity + open_pnl

        if pos == 0 and not halted and i > 0 and s[i - 1] != 0:
            side = int(s[i - 1]); px = o[i]
            st, tp = sp[i - 1], tg[i - 1]
            risk_px = abs(px - st)
            ok = (risk_px > 1e-9
                  and ((side == 1 and st < px < tp) or (side == -1 and tp < px < st)))
            if ok:
                q = (RISK_PCT * equity) / risk_px
                q = min(q, MAX_LEVERAGE * equity / px)
                if q * px > 10:
                    pos, entry, qty, stop, target, bar_in = side, px, q, st, tp, i

    if pos != 0:
        close_trade(len(bars) - 1, c[-1], "eod")

    return dict(trades=pd.DataFrame(trades), equity=pd.Series(eq_curve, index=bars.ts))
