"""Exploratory trade engine.

Deliberately simple but honest about the things that decide whether an intraday
crypto idea survives contact with reality:

  * signals are acted on at the NEXT bar's open (no same-bar fills)
  * taker fee + slippage charged on both legs
  * position size derived from the stop distance so every trade risks exactly
    RISK_PCT of CURRENT equity
  * a daily circuit-breaker that halts NEW entries once the day's realised +
    open loss reaches DAILY_STOP_PCT of the day's opening equity
  * intrabar ambiguity resolved pessimistically (stop assumed hit before target
    when a bar spans both)

This is feasibility analysis, not a production backtest -- no funding rate, no
order-book depth, no partial fills.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

START_EQUITY = 10_000.0
RISK_PCT = 0.01          # <= 1% of equity risked per trade
DAILY_STOP_PCT = 0.02    # halt new entries after -2% on the day
FEE_BPS = 5.0            # per side: Binance USD-M taker ~4bp + ~1bp slippage
MAX_LEVERAGE = 10.0      # notional cap; a very tight stop cannot buy infinite size


def run(bars: pd.DataFrame, sig: pd.DataFrame, time_stop: int) -> dict:
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
    eq_curve = np.empty(len(bars)); eq_curve[:] = np.nan
    fee = FEE_BPS / 10_000.0

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

        # ---- manage an open position on this bar (stop first: pessimistic)
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

        # ---- circuit breaker: realised + open loss vs the day's opening equity
        open_pnl = 0.0
        if pos != 0:
            open_pnl = (c[i] - entry) * qty * pos
        if (equity + open_pnl) <= day_open_eq * (1 - DAILY_STOP_PCT):
            halted = True

        eq_curve[i] = equity + open_pnl

        # ---- new entry from the PREVIOUS bar's signal, filled at this open
        if pos == 0 and not halted and i > 0 and s[i - 1] != 0:
            side = int(s[i - 1]); px = o[i]
            st, tp = sp[i - 1], tg[i - 1]
            risk_px = abs(px - st)
            # signal must still make sense at the open we actually get
            ok = (risk_px > 1e-9
                  and ((side == 1 and st < px < tp) or (side == -1 and tp < px < st)))
            if ok:
                q = (RISK_PCT * equity) / risk_px
                q = min(q, MAX_LEVERAGE * equity / px)
                if q * px > 10:  # ignore dust
                    pos, entry, qty, stop, target, bar_in = side, px, q, st, tp, i

    if pos != 0:
        close_trade(len(bars) - 1, c[-1], "eod")

    return dict(trades=pd.DataFrame(trades),
                equity=pd.Series(eq_curve, index=bars.ts))


# --------------------------------------------------------------------- stats
def metrics(res: dict, bars_per_year: float) -> dict:
    tr = res["trades"]; eq = res["equity"].dropna()
    n = len(tr)
    if n == 0 or eq.empty:
        return dict(trades=0)
    wins = tr.pnl[tr.pnl > 0]; losses = tr.pnl[tr.pnl <= 0]
    gp = wins.sum(); gl = -losses.sum()
    pf = gp / gl if gl > 0 else np.inf

    daily = eq.resample("1D").last().dropna()
    r = daily.pct_change().dropna()
    ann = 365.0
    sharpe = r.mean() / r.std() * np.sqrt(ann) if r.std() > 0 else 0.0
    dn = r[r < 0]
    sortino = r.mean() / dn.std() * np.sqrt(ann) if len(dn) > 1 and dn.std() > 0 else 0.0

    peak = eq.cummax()
    dd = (eq / peak - 1.0)
    maxdd = -dd.min()

    years = (eq.index[-1] - eq.index[0]).total_seconds() / (365 * 86400)
    total_ret = eq.iloc[-1] / START_EQUITY - 1
    cagr = (eq.iloc[-1] / START_EQUITY) ** (1 / years) - 1 if years > 0 and eq.iloc[-1] > 0 else -1.0
    calmar = cagr / maxdd if maxdd > 1e-9 else np.nan

    return dict(
        trades=n,
        win_rate=len(wins) / n,
        profit_factor=pf,
        expectancy_R=tr.r.mean(),
        total_return=total_ret,
        cagr=cagr,
        sharpe=sharpe,
        sortino=sortino,
        max_dd=maxdd,
        calmar=calmar,
        avg_bars=float((tr.exit_ts - tr.entry_ts).dt.total_seconds().mean() / 60),
        long_share=float((tr.side == 1).mean()),
        stop_share=float((tr.reason == "stop").mean()),
        time_share=float((tr.reason == "time").mean()),
    )
