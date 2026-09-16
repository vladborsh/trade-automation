"""§5.4 — DESCRIPTIVE ONLY, NO VERDICT, NOT PRE-REGISTERED AS AN ARM.

(a) the backlog entry's dollar-neutral basket: long the top 5 by SIGNED TR24,
    short the bottom 5, equal notional, no per-leg stop, entry A + 30 min,
    exit A + 4 h 30 min, 0.10 % per leg;
(b) a beta-hedged row for each primary arm: every leg paired with an opposite
    side BTCUSDT leg of equal notional, same entry and exit, its own 0.10 %;
(c) the portfolio-risk description: per day the sum of leg net R, its
    distribution, worst day, worst 20-day run, mean pairwise correlation of
    same-day leg outcomes.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C

RT = C.BINANCE_RT


def _unstopped_ret(legs: pd.DataFrame) -> np.ndarray:
    """Return over the fixed horizon with NO stop — the §6.4(a) basket has no
    per-leg stop, so the exit is the close of the bar opening at
    A + 4 h 29 min whatever the path did. Re-read from the tape."""
    out = np.full(len(legs), np.nan)
    pos = {k: i for i, k in enumerate(legs.index)}
    for sym, g in legs.groupby("symbol", sort=False):
        p = os.path.join(C.DATA_1M, f"{sym}.parquet")
        tp = pd.read_parquet(p).drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
        t, c = tp.t_ms.values.astype(np.int64), tp.close.values
        end = g.anchor_ms.values.astype(np.int64) + (C.WINDOW_MIN + C.HORIZON_MIN) * C.MIN_MS
        i1 = np.searchsorted(t, end, "left") - 1
        v = np.full(len(g), np.nan)
        ok = i1 >= 0
        v[ok] = c[i1[ok]]
        out[[pos[k] for k in g.index]] = v / g.entry.values - 1.0
    return out


def dollar_neutral(legs: pd.DataFrame, k: int = C.K_SELECT,
                   min_n: int = C.N_ELIG_MIN) -> pd.DataFrame:
    """(a). One row per tradable day: basket return in bp of gross notional."""
    legs = legs.reset_index(drop=True)
    sub = legs[np.isfinite(legs.tr24.values)].copy()
    sub["hz_ret"] = _unstopped_ret(sub)
    rows = []
    for d, g in sub.groupby("date"):
        if len(g) < min_n:
            continue
        g = g.sort_values(["tr24", "v30"], ascending=[False, False])
        lo_, sh = g.head(k), g.tail(k)
        r = (lo_.hz_ret.mean() - sh.hz_ret.mean()) / 2.0 - RT
        rows.append(dict(date=d, n_elig=len(g), ret_bp=r * 1e4,
                         gross_bp=((lo_.hz_ret.mean() - sh.hz_ret.mean()) / 2.0) * 1e4))
    return pd.DataFrame(rows)


def beta_hedged(legs: pd.DataFrame, sel_idx: np.ndarray, panel_legs: pd.DataFrame,
                btc: pd.DataFrame) -> dict:
    """(b). Each selected leg paired with an opposite-side BTCUSDT leg of equal
    notional over the same minutes; the hedge carries its own 0.10 %."""
    sub = panel_legs.iloc[sel_idx]
    b = btc.set_index("date")
    hz = b.hz_ret.reindex(sub.date.values).values
    leg_ret = sub.side.values * (sub.exit_px.values / sub.entry.values - 1.0) - RT
    hedge = -sub.side.values * hz - RT
    net_price = leg_ret + hedge
    R = net_price * sub.entry.values / sub.stop_dist.values
    return dict(n=len(sub), mean_netR_unhedged=float(sub.netR.mean()),
                mean_netR_hedged=float(np.nanmean(R)),
                n_hedge_missing=int(np.isnan(hz).sum()))


def portfolio_risk(dates: np.ndarray, netR: np.ndarray) -> dict:
    """(c)."""
    df = pd.DataFrame(dict(date=dates, netR=netR))
    per = df.groupby("date").netR.sum()
    roll = per.rolling(20).sum()
    # mean pairwise correlation of same-day leg outcomes: within-day variance
    # share.  rho_hat = (var(sum)/k - var(leg)) / ((k-1) var(leg))  per k.
    g = df.groupby("date").netR
    k = g.size()
    v_leg = float(df.netR.var(ddof=1))
    kk = float(k.median())
    v_sum = float(per[k == k.median()].var(ddof=1)) if (k == k.median()).sum() > 5 else float(per.var(ddof=1))
    rho = (v_sum / kk - v_leg) / ((kk - 1) * v_leg) if kk > 1 and v_leg > 0 else np.nan
    return dict(n_days=len(per), mean_day_sumR=float(per.mean()),
                sd_day_sumR=float(per.std(ddof=1)),
                worst_day_sumR=float(per.min()), best_day_sumR=float(per.max()),
                p05_day_sumR=float(per.quantile(0.05)),
                worst_20day_sumR=float(roll.min()) if roll.notna().any() else np.nan,
                mean_pairwise_leg_corr=float(rho))
