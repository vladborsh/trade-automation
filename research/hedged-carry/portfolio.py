#!/usr/bin/env python3
"""Tier assembly (DESIGN §1.3, §1.4, §4) — the verdict series.

A tier's daily return series is defined only on days on which EVERY slot of the
tier is past its warm-up (Reading A, ARCHITECT-RULING-2026-09-16-tier-start),
with C_tier = 100 constant.
"""
from __future__ import annotations
import os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, TIERS, C_TIER, SLOTS, OUT, FIT_END, HOLD_START,
                    HOLD_END, TAIL_START, TAIL_END, WARMUP_DAYS,
                    ann_mean, max_drawdown, sharpe, lag1_autocorr,
                    block_bootstrap_p, load_funding, load_klines)
import engine
from engine import Cfg

_CACHE = {}


def tape(sym, window=None):
    """`window` != None returns an UNCACHED tape whose f9 uses that window
    (the §9.4 f-window sensitivity); the primary 9-settlement tape is cached."""
    if window is not None:
        return engine.bars(sym), engine.settlements(sym, window)
    if sym not in _CACHE:
        _CACHE[sym] = (engine.bars(sym), engine.settlements(sym))
    return _CACHE[sym]


def fit_start(sym) -> pd.Timestamp:
    b, f = tape(sym)
    spot_first = b.loc[b.ok, "ts"].iloc[0]
    cov = max(f.ts.iloc[0], b.ts.iloc[0], spot_first)
    return (cov + pd.Timedelta(days=WARMUP_DAYS)).normalize()


def tier_start(tier) -> pd.Timestamp:
    return max(fit_start(s) for s in TIERS[tier])


def daily_from_bars(eqf: pd.DataFrame) -> pd.DataFrame:
    """Mark at the bar CLOSING at 00:00 UTC (the bar opening 23:00); if that bar
    is absent, the last present bar's close is used (§3.2/§4)."""
    e = eqf.dropna(subset=["eq"]).set_index("ts")
    daily = e["eq"].resample("1D").last()
    opend = eqf.set_index("ts")["open"].resample("1D").mean()
    return pd.DataFrame(dict(eq=daily, open_share=opend))


def run_tier(tier: str, gate: str, cfg: Cfg, start: pd.Timestamp,
             end: pd.Timestamp, gate_kw=None, state_override=None,
             f9_window=None):
    """Returns (daily DataFrame indexed by UTC date, positions, events)."""
    gate_kw = gate_kw or {}
    syms = TIERS[tier]
    c_slot = C_TIER / SLOTS[tier]
    cfg = replace(cfg, c_slot=c_slot)
    eqs, allpos, allev = [], [], []
    for sym in syms:
        b, f = tape(sym, f9_window)
        if state_override is not None:
            st = state_override[sym]
        elif gate == "hysteresis":
            st = engine.gate_hysteresis(f, **gate_kw)
        elif gate == "always":
            st = engine.gate_always_on(f)
        elif gate == "price":
            st = engine.gate_price(f, b, **gate_kw)
        elif gate == "extreme":
            st = engine.gate_extreme(f, **gate_kw)
        else:
            raise ValueError(gate)
        s0 = max(start, fit_start(sym))
        pos, eqf, ev = engine.simulate(sym, st, f, b, cfg, s0, end)
        d = daily_from_bars(eqf).rename(columns={"eq": sym, "open_share": sym + "_on"})
        eqs.append(d)
        if len(pos):
            allpos.append(pos)
        allev += ev
    E = pd.concat(eqs, axis=1)
    idx = pd.date_range(start.normalize(), (end - pd.Timedelta(hours=1)).normalize(),
                        freq="1D", tz="UTC")
    E = E.reindex(idx).ffill()
    eqcols = [s for s in syms]
    oncols = [s + "_on" for s in syms]
    E[eqcols] = E[eqcols].fillna(c_slot)
    E[oncols] = E[oncols].fillna(0.0)
    tot = E[eqcols].sum(axis=1)
    out = pd.DataFrame(index=E.index)
    out["equity"] = tot
    # The run starts FLAT at C_tier on its first day (fit: every slot is at its
    # tier start; holdout: §3.4 starts flat), so the prior mark is C_tier and no
    # calendar day is lost.  This makes the holdout exactly 731 days.
    out["r"] = (tot - tot.shift(1).fillna(C_TIER)) / C_TIER
    out["on_slots"] = E[oncols].sum(axis=1)
    pos = pd.concat(allpos, ignore_index=True) if allpos else pd.DataFrame()
    return out, pos, pd.DataFrame(allev)


def stats(daily: pd.DataFrame, pos: pd.DataFrame, ev: pd.DataFrame,
          tier: str, label: str, boot=True) -> dict:
    r = daily.r.dropna().values
    n = len(r)
    years = n / 365.0
    closed = pos[pos.why_out != "open_at_boundary"] if len(pos) else pos
    nsym = SLOTS[tier]
    symyears = nsym * years
    d = dict(
        tier=tier, label=label, days=n, years=round(years, 3),
        net_pa=round(100 * ann_mean(r), 4),
        sharpe=round(sharpe(r), 3),
        sd_daily_pct=round(100 * r.std(ddof=1), 5),
        rho1=round(lag1_autocorr(r), 4),
        maxdd_pct=round(100 * max_drawdown(r), 3),
        utilisation=round(float(daily.on_slots.mean() / nsym), 4),
        on_slot_days=int(daily.on_slots.sum()),
        n_positions=len(pos), n_closed=len(closed),
        rt_per_symyear=round(len(closed) / symyears, 3) if symyears else np.nan,
    )
    if len(closed):
        d.update(
            funding_pa=round(100 * closed.funding.sum() / C_TIER / years, 4),
            hedge_pa=round(100 * closed.hedge_pnl.sum() / C_TIER / years, 4),
            cost_pa=round(100 * closed.fees.sum() / C_TIER / years, 4),
            mean_settle=round(closed.n_settle.mean(), 2),
            median_hold_days=round(closed.hold_hours.median() / 24.0, 2),
            zero_settle_share=round(float((closed.n_settle == 0).mean()), 4),
            cost_carry_ratio=round(float(closed.fees.sum() /
                                         closed.funding.sum()), 4)
            if closed.funding.sum() else np.nan,
            x_max_mean=round(float(closed.x_max.mean()), 4),
            x_max_p90=round(float(closed.x_max.quantile(0.90)), 4),
            x_max_p99=round(float(closed.x_max.quantile(0.99)), 4),
            x_max_max=round(float(closed.x_max.max()), 4),
        )
    d["n_recentre"] = int((ev.kind == "recentre").sum()) if len(ev) else 0
    d["n_liquidation"] = int((ev.kind == "liquidation").sum()) if len(ev) else 0
    if boot and n > 30:
        p, lo, hi = block_bootstrap_p(r)
        d.update(p_boot=round(p, 4), ci90_lo=round(100 * lo, 3),
                 ci90_hi=round(100 * hi, 3))
    return d
