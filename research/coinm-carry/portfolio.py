#!/usr/bin/env python3
"""Tier assembly (DESIGN §1.4, §4) — the verdict series.

C_tier = 100 constant, 2 slots (BTCUSD_PERP, ETHUSD_PERP), C_slot = 50.
The tier series is defined only on days on which BOTH slots are past their
warm-up.
"""
from __future__ import annotations
import os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PERPS, C_TIER, SLOTS, OUT, WARMUP_DAYS,
                    ann_mean, max_drawdown, sharpe, lag1_autocorr,
                    block_bootstrap_p)
import engine
from engine import Cfg

_START = {}


def fit_start(sym) -> pd.Timestamp:
    if sym in _START:
        return _START[sym]
    b = engine.bars(sym)
    f = engine.settlements(sym)
    cov = max(f.ts.iloc[0], b.loc[b.ok, "ts"].iloc[0])
    _START[sym] = (cov + pd.Timedelta(days=WARMUP_DAYS)).ceil("D")
    return _START[sym]


def tier_start() -> pd.Timestamp:
    return max(fit_start(s) for s in PERPS)


def daily_from_bars(eqf: pd.DataFrame) -> pd.DataFrame:
    """Mark at the bar CLOSING at 00:00 UTC (the bar opening 23:00); if absent,
    the last present bar's close is used (DESIGN §4)."""
    e = eqf.dropna(subset=["eq"]).set_index("ts")
    return pd.DataFrame(dict(eq=e["eq"].resample("1D").last(),
                             open_share=eqf.set_index("ts")["open"].resample("1D").mean()))


def run_tier(gate: str, cfg: Cfg, start, end, gate_kw=None,
             state_override=None, f9_window=None):
    gate_kw = gate_kw or {}
    cfg = replace(cfg, c_slot=C_TIER / SLOTS)
    eqs, allpos, allev = [], [], []
    for sym in PERPS:
        b = engine.bars(sym)
        f = engine.settlements(sym, f9_window) if f9_window else engine.settlements(sym)
        if state_override is not None:
            stt = state_override[sym]
        elif gate == "always":
            stt = engine.gate_always_on(f)
        elif gate == "hysteresis":
            stt = engine.gate_hysteresis(f, **gate_kw)
        elif gate == "price":
            stt = engine.gate_price(f, b, **gate_kw)
        else:
            raise ValueError(gate)
        s0 = max(start, fit_start(sym))
        pos, eqf, ev = engine.simulate(sym, stt, f, b, cfg, s0, end)
        d = daily_from_bars(eqf).rename(
            columns={"eq": sym, "open_share": sym + "_on"})
        eqs.append(d)
        if len(pos):
            allpos.append(pos)
        allev += ev
    E = pd.concat(eqs, axis=1)
    idx = pd.date_range(start.normalize(),
                        (end - pd.Timedelta(hours=1)).normalize(),
                        freq="1D", tz="UTC")
    E = E.reindex(idx).ffill()
    eqcols = list(PERPS)
    oncols = [s + "_on" for s in PERPS]
    E[eqcols] = E[eqcols].fillna(C_TIER / SLOTS)
    E[oncols] = E[oncols].fillna(0.0)
    tot = E[eqcols].sum(axis=1)
    out = pd.DataFrame(index=E.index)
    out["equity"] = tot
    out["r"] = (tot - tot.shift(1).fillna(C_TIER)) / C_TIER
    out["on_slots"] = E[oncols].sum(axis=1)
    pos = pd.concat(allpos, ignore_index=True) if allpos else pd.DataFrame()
    return out, pos, pd.DataFrame(allev)


def stats(daily: pd.DataFrame, pos: pd.DataFrame, ev: pd.DataFrame,
          label: str, boot=True) -> dict:
    r = daily.r.dropna().values
    n = len(r)
    years = n / 365.0
    closed = pos[pos.why_out != "open_at_boundary"] if len(pos) else pos
    symyears = SLOTS * years
    p, lo, hi, se = (block_bootstrap_p(r) if (boot and n > 30)
                     else (np.nan,) * 4)
    d = dict(
        label=label, days=n, years=round(years, 3),
        net_pa=round(100 * ann_mean(r), 4),
        sharpe=round(sharpe(r), 3),
        sd_daily_pct=round(100 * r.std(ddof=1), 5),
        rho1=round(lag1_autocorr(r), 4),
        maxdd_pct=round(100 * max_drawdown(r), 3),
        utilisation=round(float(daily.on_slots.mean() / SLOTS), 4),
        on_slot_days=int(round(daily.on_slots.sum())),
        trade_days=int((daily.on_slots > 0).sum()),
        n_positions=len(pos), n_closed=len(closed),
        rt_per_symyear=round(len(closed) / symyears, 3) if symyears else np.nan,
        p_boot=round(p, 4) if p == p else np.nan,
        ci90_lo=round(100 * lo, 3) if lo == lo else np.nan,
        ci90_hi=round(100 * hi, 3) if hi == hi else np.nan,
        boot_se_pa=round(100 * se, 4) if se == se else np.nan,
    )
    if len(pos):
        d.update(
            funding_pa=round(100 * pos.funding.sum() / C_TIER / years, 4),
            hedge_pa=round(100 * pos.hedge_pnl.sum() / C_TIER / years, 4),
            unswept_pa=round(100 * pos.unswept_extra.sum() / C_TIER / years, 4),
            fee_pa=round(100 * pos.fees.sum() / C_TIER / years, 4),
            sweep_pa=round(100 * pos.sweep.sum() / C_TIER / years, 4),
            cost_pa=round(100 * (pos.fees.sum() + pos.sweep.sum())
                          / C_TIER / years, 4),
            mean_settle=round(pos.n_settle.mean(), 2),
            median_hold_days=round(pos.hold_hours.median() / 24.0, 2),
            zero_settle_share=round(float((pos.n_settle == 0).mean()), 4),
            cost_carry_ratio=round(float((pos.fees.sum() + pos.sweep.sum())
                                         / pos.funding.sum()), 4)
            if pos.funding.sum() else np.nan,
            min_buffer=round(float(pos.min_buffer.min()), 5),
            min_buffer_frac=round(float((pos.min_buffer / pos.buffer0).min()), 4),
        )
    d["n_buffer_breach"] = (int((ev.kind == "buffer_breach").sum())
                            if len(ev) else 0)
    return d
