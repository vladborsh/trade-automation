#!/usr/bin/env python3
"""Arm B — COIN-M quarterly basis, majors (DESIGN §2; note §2.3).

Same 1:1 coin-collateralised inverse structure, on XUSD_yymmdd:
    q = N / F_e coins, short N USD of the dated contract at F_e, 1x.
A dated contract pays NO funding; the payoff is the convergence of F to the
settlement index at expiry, i.e. the basis locked at entry.

    hedge_pnl = N/(1+b_x) - N/(1+b_e),   b_t = F_t/S_t - 1
and at expiry b_x = 0 by construction, so hedge_pnl = N*b_e/(1+b_e).

Entry: the front or next quarterly, whichever annualises higher, when its
annualised basis beta = (F/S - 1) * 365/d >= threshold and d >= 14 days.
Hold to expiry settlement (08:00 UTC).  Roll only if the new front also clears.
One slot per coin.
"""
from __future__ import annotations
import os, re, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (QDATA, OUT, C_TIER, SLOTS, BUFFER_FRAC, SPOT_FEE, CM_FEE,
                    SLIP, QB_THRESHOLD, QB_MIN_DAYS, FIT_END, HOLD_START,
                    HOLD_END, ann_mean, max_drawdown, sharpe, lag1_autocorr,
                    block_bootstrap_p, load_klines)
import engine

PAIRS = {"BTCUSD": "BTCUSDT", "ETHUSD": "ETHUSDT"}
_Q = None


def build_quarterlies():
    """{pair: {symbol: {'expiry': ts, 'df': 1h frame joined to spot}}}"""
    global _Q
    if _Q is not None:
        return _Q
    out = {}
    for pair, spot in PAIRS.items():
        sk = load_klines(spot, "spot1h")[["ts", "close"]].rename(
            columns={"close": "close_s"})
        cs = {}
        for fn in sorted(os.listdir(QDATA)):
            m = re.match(rf"^{pair}_(\d{{6}})-1h\.csv\.gz$", fn)
            if not m:
                continue
            sym = f"{pair}_{m.group(1)}"
            exp = pd.Timestamp("20" + m.group(1), tz="UTC") + pd.Timedelta(hours=8)
            # Binance delivers at 08:00 UTC.  Both the 08:00 bar AND the
            # 07:00 bar (which CLOSES at 08:00) carry a stale last-traded
            # price while spot moves on -- measured 1-4 % dislocations on
            # several contracts, against ~0.1 % on every earlier hour.  The
            # last bar whose CLOSE is strictly before delivery is the one
            # opening 06:00.  DESIGN §2 / Stage-0 ruling Q1: the unwind is
            # priced there and pays the FULL round trip, which is
            # conservative against a fee-free delivery settlement.
            exp_trade = exp - pd.Timedelta(hours=2)
            df = load_klines(sym, "q1h")[["ts", "close"]].rename(
                columns={"close": "close_f"})
            df = df[df.ts <= exp_trade]
            df = df.merge(sk, on="ts", how="inner")
            df["b"] = df.close_f / df.close_s - 1.0
            df["dte"] = (exp - df.ts).dt.total_seconds() / 86400.0
            df["beta"] = np.where(df.dte > 0, df.b * 365.0 / df.dte, np.nan)
            cs[sym] = dict(expiry=exp, expiry_trade=exp_trade,
                           df=df.reset_index(drop=True))
        out[pair] = cs
    _Q = out
    return out


def _slot(pair, threshold, min_days, start, end, always_hold=False):
    """One coin's arm-B slot.  Returns (per-bar equity frame, trades)."""
    C = C_TIER / SLOTS
    N = C / (1.0 + BUFFER_FRAC)
    rt_side = N * (SPOT_FEE + SLIP) + N * (CM_FEE + SLIP)   # 0.0019 * N
    cs = build_quarterlies()[pair]
    # a single hourly clock across all contracts of the pair
    grid = sorted(set().union(*[set(c["df"].ts) for c in cs.values()]))
    grid = pd.DatetimeIndex([t for t in grid if start <= t < end])
    tab = {}
    for sym, c in cs.items():
        d = c["df"].set_index("ts")
        tab[sym] = d

    realised, eq, openf = 0.0, [], []
    cur, trades = None, []
    for t in grid:
        # candidates: contracts trading at t with dte > 0
        cands = []
        for sym, d in tab.items():
            if t in d.index:
                r = d.loc[t]
                if r.dte > 0:
                    cands.append((sym, float(r.beta), float(r.b),
                                  float(r.dte), float(r.close_f),
                                  float(r.close_s)))
        cands.sort(key=lambda x: x[3])           # by days to expiry
        front_two = cands[:2]

        if cur is not None:
            d = tab[cur["sym"]]
            if t in d.index:
                r = d.loc[t]
                cur["b_x"] = float(r.b)
                cur["last_t"] = t
            if t >= cur["expiry_trade"]:
                bx = cur.get("b_x", 0.0)
                hedge = N / (1.0 + bx) - N / (1.0 + cur["b_e"])
                pnl = hedge - 2 * rt_side
                realised += pnl
                trades.append(dict(
                    pair=pair, symbol=cur["sym"], t_entry=cur["t_e"],
                    t_exit=t, N=N, F_e=cur["F_e"], S_e=cur["S_e"],
                    b_e=cur["b_e"], b_x=bx, beta_e=cur["beta_e"],
                    days_to_expiry=cur["dte_e"],
                    hold_days=(t - cur["t_e"]).total_seconds() / 86400.0,
                    hedge_pnl=hedge, fees=2 * rt_side, net=pnl))
                cur = None

        if cur is None and front_two:
            pick = max(front_two, key=lambda x: x[1])
            sym, beta, b_e, dte, F_e, S_e = pick
            ok = (dte >= min_days) and (always_hold or beta >= threshold)
            if ok:
                cur = dict(sym=sym, t_e=t, F_e=F_e, S_e=S_e, b_e=b_e,
                           beta_e=beta, dte_e=dte,
                           expiry=cs[sym]["expiry"],
                           expiry_trade=cs[sym]["expiry_trade"],
                           b_x=b_e, last_t=t)

        if cur is not None:
            eq.append(realised + C
                      + N / (1.0 + cur.get("b_x", cur["b_e"]))
                      - N / (1.0 + cur["b_e"]) - rt_side)
            openf.append(1.0)
        else:
            eq.append(realised + C)
            openf.append(0.0)

    e = pd.DataFrame(dict(ts=grid, eq=eq, open=openf))
    return e, pd.DataFrame(trades)


def run(threshold=QB_THRESHOLD, min_days=QB_MIN_DAYS, end=FIT_END,
        start=None, always_hold=False):
    """Returns (daily tier frame, trades)."""
    if start is None:
        start = pd.Timestamp("2020-09-25 08:00", tz="UTC")
    eqs, alltr = [], []
    for pair in PAIRS:
        e, tr = _slot(pair, threshold, min_days, start, end, always_hold)
        d = e.set_index("ts")["eq"].resample("1D").last().to_frame(pair)
        d[pair + "_on"] = e.set_index("ts")["open"].resample("1D").mean()
        eqs.append(d)
        if len(tr):
            alltr.append(tr)
    E = pd.concat(eqs, axis=1)
    idx = pd.date_range(start.normalize(), (end - pd.Timedelta(hours=1)).normalize(),
                        freq="1D", tz="UTC")
    E = E.reindex(idx).ffill()
    cols = list(PAIRS)
    E[cols] = E[cols].fillna(C_TIER / SLOTS)
    E[[c + "_on" for c in cols]] = E[[c + "_on" for c in cols]].fillna(0.0)
    tot = E[cols].sum(axis=1)
    out = pd.DataFrame(index=E.index)
    out["equity"] = tot
    out["r"] = (tot - tot.shift(1).fillna(C_TIER)) / C_TIER
    out["on_slots"] = E[[c + "_on" for c in cols]].sum(axis=1)
    tr = pd.concat(alltr, ignore_index=True) if alltr else pd.DataFrame()
    return out, tr


def stats(daily, tr, label):
    r = daily.r.dropna().values
    n = len(r)
    years = n / 365.0
    p, lo, hi, se = block_bootstrap_p(r) if n > 30 else (np.nan,) * 4
    d = dict(label=label, days=n, years=round(years, 3),
             net_pa=round(100 * ann_mean(r), 4),
             sharpe=round(sharpe(r), 3),
             sd_daily_pct=round(100 * r.std(ddof=1), 5),
             rho1=round(lag1_autocorr(r), 4),
             maxdd_pct=round(100 * max_drawdown(r), 3),
             utilisation=round(float(daily.on_slots.mean() / SLOTS), 4),
             on_slot_days=int(round(daily.on_slots.sum())),
             trade_days=int((daily.on_slots > 0).sum()),
             n_trades=len(tr),
             p_boot=round(p, 4) if p == p else np.nan,
             ci90_lo=round(100 * lo, 3) if lo == lo else np.nan,
             ci90_hi=round(100 * hi, 3) if hi == hi else np.nan,
             boot_se_pa=round(100 * se, 4) if se == se else np.nan)
    if len(tr):
        d.update(hedge_pa=round(100 * tr.hedge_pnl.sum() / C_TIER / years, 4),
                 fee_pa=round(100 * tr.fees.sum() / C_TIER / years, 4),
                 mean_beta_e=round(float(tr.beta_e.mean()), 4),
                 median_hold_days=round(float(tr.hold_days.median()), 2),
                 cost_carry_ratio=round(float(tr.fees.sum() /
                                              tr.hedge_pnl.sum()), 4)
                 if tr.hedge_pnl.sum() else np.nan)
    return d
