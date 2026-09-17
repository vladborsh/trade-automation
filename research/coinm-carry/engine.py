#!/usr/bin/env python3
"""The COIN-M inverse cash-and-carry engine (DESIGN §1, §3.2, §4).

One slot = one coin.  q = N/P_e coins in the COIN-M wallet, short N USD of the
inverse perp at 1x.  Identity I1: the wallet's coin balance is N/P_t at every
price, so the coin leg marked at spot is worth N/(1+b_t) and there is NO
directional term and NO liquidation.  Identity I2: margin / maintenance margin
= 1/mmr at every price.

Funding is swept to the USD buffer at every settlement (DESIGN §1.2), so
funding in USD is exactly f_j * N and the notional never compounds.
"""
from __future__ import annotations
import os, sys
from dataclasses import dataclass, field
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PERPS, SPOT_OF, PAIR_OF, MMR, CONTRACT_SIZE,
                    F9_WINDOW, ON_LEVEL, OFF_LEVEL, BUFFER_FRAC,
                    SPOT_FEE, CM_FEE, CM_MAKER, SLIP, SWEEP_COST,
                    BASIS_ANOM, MAX_ABSENT_HOURS,
                    load_cm_funding, load_klines)

_BARS: dict = {}
_SETT: dict = {}


@dataclass
class Cfg:
    c_slot: float = 50.0
    buffer_frac: float = BUFFER_FRAC
    spot_fee: float = SPOT_FEE
    cm_fee: float = CM_FEE
    slip: float = SLIP
    sweep_cost: float = SWEEP_COST
    entry_maker: bool = False          # sensitivity (iii)
    sweep: bool = True                 # sensitivity (vi): False = unswept
    funding_add: float = 0.0           # harness §8.3 planted accrual
    funding_scale: float = 1.0


def bars(sym: str) -> pd.DataFrame:
    """1 h frame on the INNER join of the COIN-M and spot grids.

    `ok` marks a usable bar: both legs present and |b| <= 5 %.  A bar absent on
    either leg is absent on both (DESIGN §3.2).
    """
    if sym in _BARS:
        return _BARS[sym]
    cm = load_klines(sym, "cm1h")[["ts", "open", "high", "low", "close"]].rename(
        columns={"open": "open_p", "high": "high_p", "low": "low_p",
                 "close": "close_p"})
    sk = load_klines(SPOT_OF[sym], "spot1h")[["ts", "close"]].rename(
        columns={"close": "close_s"})
    j = cm.merge(sk, on="ts", how="inner")
    j["b"] = j.close_p / j.close_s - 1.0
    j["ok"] = j.b.abs() <= BASIS_ANOM
    j = j.reset_index(drop=True)
    _BARS[sym] = j
    return j


def settlements(sym: str, window: int = F9_WINDOW) -> pd.DataFrame:
    """Funding settlements with the f9 trailing mean and the perp OPEN mark."""
    key = (sym, window)
    if key in _SETT:
        return _SETT[key]
    f = load_cm_funding(sym, "merged").rename(columns={"last_funding_rate": "f"})
    b = bars(sym)[["ts", "open_p"]].rename(columns={"open_p": "mark"})
    f = f.merge(b, on="ts", how="left")
    f["f9"] = f.f.rolling(window, min_periods=window).mean()
    f = f.reset_index(drop=True)
    _SETT[key] = f
    return f


# ---------------------------------------------------------------- gates -----
def gate_always_on(f: pd.DataFrame) -> pd.Series:
    return pd.Series(True, index=f.index)


def gate_hysteresis(f: pd.DataFrame, on=ON_LEVEL, off=OFF_LEVEL) -> pd.Series:
    st = np.zeros(len(f), bool)
    cur = False
    f9 = f.f9.values
    for i in range(len(f)):
        v = f9[i]
        if np.isnan(v):
            cur = False
        elif cur:
            if v <= off:
                cur = False
        else:
            if v >= on:
                cur = True
        st[i] = cur
    return pd.Series(st, index=f.index)


def gate_price(f: pd.DataFrame, b: pd.DataFrame, on=0.03, off=0.0) -> pd.Series:
    """Trailing 3-day spot return, same hysteresis shape (DESIGN §9.2)."""
    s = b.set_index("ts")["close_s"]
    r3 = (s / s.shift(72) - 1.0).reindex(f.ts.values).values
    st = np.zeros(len(f), bool)
    cur = False
    for i in range(len(f)):
        v = r3[i]
        if np.isnan(v):
            cur = False
        elif cur:
            if v <= off:
                cur = False
        else:
            if v >= on:
                cur = True
        st[i] = cur
    return pd.Series(st, index=f.index)


# ------------------------------------------------------------- simulate -----
def simulate(sym, state, f, b, cfg: Cfg, start, end):
    """Returns (positions DataFrame, per-bar equity DataFrame, events list).

    `state[i]` is the desired ON/OFF at settlement `f.ts[i]`.  A transition
    acts at the CLOSE of the bar opening one hour after the settlement, so no
    decision uses information from inside its own settlement hour.
    """
    mmr = MMR[PAIR_OF[sym]]
    bs = b[(b.ts >= start - pd.Timedelta(hours=1)) & (b.ts < end)].reset_index(drop=True)
    if not len(bs):
        return pd.DataFrame(), pd.DataFrame(columns=["ts", "eq", "open"]), []
    ts = bs.ts.values
    tsp = pd.DatetimeIndex(bs.ts)          # tz-aware, for the record
    cl_p = bs.close_p.values
    cl_s = bs.close_s.values
    bas = bs.b.values
    ok = bs.ok.values
    idx_of = {t: i for i, t in enumerate(ts)}

    fs = f[(f.ts >= start) & (f.ts < end)].reset_index(drop=True)
    st = state.reindex(f.index).values if isinstance(state, pd.Series) else state
    st = pd.Series(st, index=f.index).loc[f.index[(f.ts >= start) & (f.ts < end)]].values
    f_ts = fs.ts.values
    f_f = fs.f.values * cfg.funding_scale
    f_mark = fs.mark.values

    # action bar for settlement k: the bar opening t_k + 1h
    act = np.full(len(fs), -1, dtype=int)
    for k, t in enumerate(f_ts):
        act[k] = idx_of.get(t + np.timedelta64(1, "h"), -1)
    # A settlement is PAID by the exchange whether or not the archive has a
    # kline for that hour, so it is attached to the first bar at or after its
    # timestamp (DESIGN §3.3 rule 1 applies to a missing SETTLEMENT, not to a
    # missing bar).  Several settlements can land on one bar across a gap.
    sett_at = {}
    for k, t in enumerate(f_ts):
        i = int(np.searchsorted(ts, t, side="left"))
        if i < len(ts):
            sett_at.setdefault(i, []).append(k)

    C = cfg.c_slot
    eq = np.full(len(ts), np.nan)
    openf = np.zeros(len(ts))
    pos_open = False
    N = q = bufr = pe = be = 0.0
    acc_coin = 0.0          # unswept variant only
    t_entry = None
    n_sett = fund_usd = sweep_usd = 0.0
    n_sett = 0
    minbuf = np.inf
    positions, events = [], []
    want_k = 0

    def entry_cost(n):
        cm_fee = CM_MAKER if cfg.entry_maker else cfg.cm_fee
        cm_slip = cfg.slip * (0.5 if cfg.entry_maker else 1.0)
        return n * (cfg.spot_fee + cfg.slip) + n * (cm_fee + cm_slip)

    def exit_cost(n):
        return n * (cfg.spot_fee + cfg.slip) + n * (cfg.cm_fee + cfg.slip)

    def close(i, why):
        nonlocal pos_open, N, q, bufr, acc_coin, t_entry, n_sett, fund_usd, sweep_usd, minbuf, realised
        ec = exit_cost(N)
        coin_usd = N / (1.0 + bas[i])
        extra = acc_coin * cl_s[i] if not cfg.sweep else 0.0
        eqv = coin_usd + bufr + extra - ec
        hedge = N / (1.0 + bas[i]) - N / (1.0 + be)
        positions.append(dict(
            symbol=sym, t_entry=pd.Timestamp(t_entry, tz='UTC'),
            t_exit=tsp[i], why_out=why,
            N=N, P_e=pe, b_e=be, P_x=cl_p[i], b_x=bas[i],
            hold_hours=(ts[i] - t_entry) / np.timedelta64(1, "h"),
            n_settle=n_sett, funding=fund_usd, hedge_pnl=hedge,
            unswept_extra=extra,
            fees=entry_cost(N) + ec, sweep=sweep_usd,
            net=eqv - C, min_buffer=minbuf,
            buffer0=C - N / (1.0 + be)))
        pos_open = False
        acc_coin = 0.0
        realised += eqv - C
        return realised + C

    realised = 0.0
    cur_eq = C
    for i in range(len(ts)):
        # 1) funding settlement at this bar's open
        if pos_open and i in sett_at:
            for k in sett_at[i]:
                if not (f_ts[k] > t_entry):           # strictly after entry
                    continue
                rate = f_f[k] + cfg.funding_add
                if np.isnan(rate):
                    continue
                amt = rate * N                         # USD, notional FIXED
                if cfg.sweep:
                    sw = cfg.sweep_cost * abs(amt)
                    bufr += amt - sw
                    sweep_usd += sw
                else:
                    mk = f_mark[k] if not np.isnan(f_mark[k]) else cl_p[i]
                    acc_coin += amt / mk
                fund_usd += amt
                n_sett += 1
                minbuf = min(minbuf, bufr)
                if bufr < 0:
                    events.append(dict(symbol=sym, ts=tsp[i],
                                       kind="buffer_breach", buffer=bufr))

        # 2) gate transition acting at this bar's close
        while want_k < len(fs) and act[want_k] <= i:
            if act[want_k] < 0:
                want_k += 1
                continue
            want = bool(st[want_k])
            if pos_open and not want and ok[i]:
                cur_eq = close(i, "gate_off")
            elif (not pos_open) and want and ok[i]:
                N = cfg.c_slot / (1.0 + cfg.buffer_frac)
                pe, be = cl_p[i], bas[i]
                q = N / pe
                bufr = C - N / (1.0 + be) - entry_cost(N)
                minbuf = bufr
                t_entry = ts[i]
                n_sett = 0
                fund_usd = sweep_usd = 0.0
                acc_coin = 0.0
                pos_open = True
            want_k += 1

        # 3) buffer breach forces an unwind at the next usable bar
        if pos_open and bufr < 0 and ok[i]:
            cur_eq = close(i, "buffer_exhausted")

        # 4) mark
        if pos_open:
            if ok[i]:
                extra = acc_coin * cl_s[i] if not cfg.sweep else 0.0
                cur_eq = realised + N / (1.0 + bas[i]) + bufr + extra
            eq[i] = cur_eq
            openf[i] = 1.0
        else:
            cur_eq = realised + C
            eq[i] = cur_eq
            openf[i] = 0.0

    if pos_open:
        i = len(ts) - 1
        hedge = N / (1.0 + bas[i]) - N / (1.0 + be)
        extra = acc_coin * cl_s[i] if not cfg.sweep else 0.0
        positions.append(dict(
            symbol=sym, t_entry=pd.Timestamp(t_entry, tz='UTC'),
            t_exit=tsp[i], why_out="open_at_boundary",
            N=N, P_e=pe, b_e=be, P_x=cl_p[i], b_x=bas[i],
            hold_hours=(ts[i] - t_entry) / np.timedelta64(1, "h"),
            n_settle=n_sett, funding=fund_usd, hedge_pnl=hedge,
            unswept_extra=extra, fees=entry_cost(N), sweep=sweep_usd,
            net=cur_eq - realised - C, min_buffer=minbuf,
            buffer0=C - N / (1.0 + be)))

    eqf = pd.DataFrame(dict(ts=pd.to_datetime(ts, utc=True),
                            eq=eq, open=openf))
    return pd.DataFrame(positions), eqf, events


def mmr_check(sym, cfg: Cfg, start, end, n_positions=20):
    """DESIGN §8.1 — identity I1/I2 asserted on real position-hours."""
    b = bars(sym)
    f = settlements(sym)
    bs = b[(b.ts >= start) & (b.ts < end) & b.ok].reset_index(drop=True)
    mmr = MMR[PAIR_OF[sym]]
    stride = max(1, len(bs) // n_positions)
    rows = []
    for k in range(n_positions):
        i0 = k * stride
        if i0 >= len(bs) - 24:
            break
        N = cfg.c_slot / (1.0 + cfg.buffer_frac)
        pe = bs.close_p.iloc[i0]
        q = N / pe
        seg = bs.iloc[i0:i0 + 24 * 30]
        pt = seg.close_p.values
        coin = q + N * (1.0 / pt - 1.0 / pe)          # I1
        i1 = np.abs(coin * pt / N - 1.0).max()
        maint = mmr * N / pt
        i2 = np.abs(coin / maint - 1.0 / mmr).max()
        rows.append(dict(symbol=sym, t0=bs.ts.iloc[i0], n_bars=len(seg),
                         P_e=pe, P_min=float(pt.min()), P_max=float(pt.max()),
                         price_ratio_max=float(pt.max() / pe),
                         I1_max_abs_dev=float(i1), I2_max_abs_dev=float(i2),
                         margin_ratio=1.0 / mmr))
    return pd.DataFrame(rows)
