#!/usr/bin/env python3
"""STAGE 3 — economics, for survivors only (DESIGN.md §3 stage-3, §6).

Engine: `intraday-mr-smc/backtest.py:run`, UNCHANGED (1%/trade, 2%-of-day
breaker, next-bar-open fills, pessimistic intrabar resolution, 5 bp/side).

  (a) comparative bar: `momentum_breakout` restricted to top-tercile-ΔOI triggers
      vs unrestricted, same engine, same window. The conditioned version must
      beat the unconditioned one on net expectancy per trade AND total net PnL,
      with >= 300 conditioned trades pooled. The absolute PF bar does not apply
      to (a) — v2 already settled the base strategy's absolute economics.
  (b) absolute bar: >= 300 trades pooled, gross expectancy >= 3 x median cost_R,
      net PF >= 1.1 fit, gross PF > 1.0 on >= 5 usable symbols, holdout net
      PF >= 1.0 with decay <= 0.15.

Holdout is read ONCE, only for a hypothesis that has already cleared stage 1,
its permutation null and its redundancy control.
"""
from __future__ import annotations
import argparse, json
import numpy as np
import pandas as pd

import common as C
import prep
import signals as S


def run_one(d: pd.DataFrame, sig: pd.DataFrame, win, time_stop: int, tag: str):
    w = C.window_mask(d, win)
    dd = d.loc[w].reset_index(drop=True)
    ss = sig.loc[w, ["sig", "stop", "target"]].reset_index(drop=True)
    res = C.bt.run(dd, ss, time_stop)
    tr = res["trades"]
    if len(tr):
        tr = tr.assign(symbol=d.symbol.iloc[0], variant=tag)
        # stop distance as a fraction of entry -> cost in R units
        tr["stop_pct"] = np.abs(tr.entry - _entry_stop(dd, ss, tr)) / tr.entry
        tr["cost_R"] = C.COST_RT / tr.stop_pct
    return tr, res


def _entry_stop(d, sig, tr):
    """Recover the stop price the engine actually used for each trade."""
    m = {t: i for i, t in enumerate(d.ts)}
    return np.array([sig.stop.iloc[m[t] - 1] for t in tr.entry_ts])


def summarise(tr: pd.DataFrame) -> dict:
    if tr is None or len(tr) == 0:
        return dict(trades=0)
    w = tr.pnl > 0
    gl = -tr.pnl[~w].sum()
    hold_h = (tr.exit_ts - tr.entry_ts).dt.total_seconds() / 3600.0
    return dict(trades=len(tr), win_rate=float(w.mean()),
                net_pf=float(tr.pnl[w].sum() / gl) if gl > 0 else np.inf,
                net_exp_R=float(tr.r.mean()), net_pnl=float(tr.pnl.sum()),
                median_cost_R=float(tr.cost_R.median()),
                gross_exp_R=float((tr.r + tr.cost_R).mean()),
                median_hold_h=float(hold_h.median()),
                long_share=float((tr.side == 1).mean()),
                stop_share=float((tr.reason == "stop").mean()),
                target_share=float((tr.reason == "target").mean()),
                time_share=float((tr.reason == "time").mean()),
                r_p05=float(tr.r.quantile(.05)), r_p25=float(tr.r.quantile(.25)),
                r_med=float(tr.r.median()), r_p75=float(tr.r.quantile(.75)),
                r_p95=float(tr.r.quantile(.95)))


def gross_pf(tr: pd.DataFrame) -> float:
    g = tr.r + tr.cost_R
    gl = -g[g <= 0].sum()
    return float(g[g > 0].sum() / gl) if gl > 0 else np.inf


# --------------------------------------------------------------- hypothesis (a)
def run_a(symbols, win, cond="dOI_4h_pct"):
    """Unconditioned vs top-ΔOI-tercile-conditioned momentum_breakout."""
    all_tr = []
    for sym in symbols:
        d = prep.get(sym)
        sig = S.momentum_breakout(d)
        terc = S.tercile(d[cond].to_numpy())
        gate = d.usable_a.to_numpy()

        base = sig.copy()
        base.loc[~gate, ["sig", "stop", "target"]] = [0, np.nan, np.nan]
        tr, _ = run_one(d, base, win, C.P["time_stop"], "unconditioned")
        if len(tr):
            all_tr.append(tr)

        top = base.copy()
        top.loc[terc != 2, ["sig", "stop", "target"]] = [0, np.nan, np.nan]
        tr, _ = run_one(d, top, win, C.P["time_stop"], "top_tercile")
        if len(tr):
            all_tr.append(tr)

        bot = base.copy()
        bot.loc[terc != 0, ["sig", "stop", "target"]] = [0, np.nan, np.nan]
        tr, _ = run_one(d, bot, win, C.P["time_stop"], "bottom_tercile")
        if len(tr):
            all_tr.append(tr)
    return pd.concat(all_tr, ignore_index=True) if all_tr else pd.DataFrame()


# ------------------------------------------------------------ hypotheses (b1/b2)
def run_b(symbols, name, win):
    all_tr = []
    for sym in symbols:
        d = prep.get(sym)
        sig = S.build_event(d, name)
        tr, _ = run_one(d, sig, win, C.EVENT_TIME_STOP, name)
        if len(tr):
            all_tr.append(tr)
    return pd.concat(all_tr, ignore_index=True) if all_tr else pd.DataFrame()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", default="fit", choices=["fit", "holdout"])
    ap.add_argument("--events", default="", help="comma list of b* names to price")
    a = ap.parse_args()
    def win_for(h):
        return C.FIT_BY_HYP[h] if a.window == "fit" else C.HOLD_BY_HYP[h]
    win = win_for("a")
    keep = json.load(open(f"{C.OUT}/symbols_kept.json"))["kept"]
    pd.set_option("display.width", 260)

    rows = []
    tr_a = run_a(keep["a"], win)
    tr_a.to_csv(f"{C.OUT}/trades_a_{a.window}.csv", index=False)
    print(f"=== (a) momentum_breakout, ΔOI conditioning — {a.window.upper()} window ===")
    for v in ("unconditioned", "top_tercile", "bottom_tercile"):
        t = tr_a[tr_a.variant == v]
        s = summarise(t)
        s.update(variant=v, window=a.window,
                 gross_pf=gross_pf(t) if len(t) else np.nan,
                 sym_gross_pf_gt1=int(sum(gross_pf(g) > 1 for _, g in t.groupby("symbol"))))
        rows.append(s)
    da = pd.DataFrame(rows)
    print(da.to_string(index=False, float_format=lambda x: f"{x:9.4f}"))

    unc = da[da.variant == "unconditioned"].iloc[0]
    top = da[da.variant == "top_tercile"].iloc[0]
    print(f"\n§3 comparative bar (can-only-subtract): conditioned must beat "
          f"unconditioned on BOTH net expectancy/trade AND total net PnL, n >= 300")
    print(f"  net_exp_R  {top.net_exp_R:+.4f} vs {unc.net_exp_R:+.4f}  -> "
          f"{'PASS' if top.net_exp_R > unc.net_exp_R else 'FAIL'}")
    print(f"  net_pnl    {top.net_pnl:+.1f} vs {unc.net_pnl:+.1f}  -> "
          f"{'PASS' if top.net_pnl > unc.net_pnl else 'FAIL'}")
    print(f"  trades     {int(top.trades)} (floor 300) -> "
          f"{'PASS' if top.trades >= 300 else 'FAIL'}")

    if a.events:
        rows_b = []
        for name in a.events.split(","):
            t = run_b(keep[C.hyp_of(name)], name, win_for(C.hyp_of(name)))
            t.to_csv(f"{C.OUT}/trades_{name}_{a.window}.csv", index=False)
            s = summarise(t)
            s.update(variant=name, window=a.window,
                     gross_pf=gross_pf(t) if len(t) else np.nan,
                     sym_gross_pf_gt1=int(sum(gross_pf(g) > 1 for _, g in t.groupby("symbol"))) if len(t) else 0)
            rows_b.append(s)
        db = pd.DataFrame(rows_b)
        print(f"\n=== (b) standalone events — {a.window.upper()} window ===")
        print(db.to_string(index=False, float_format=lambda x: f"{x:9.4f}"))
        db.to_csv(f"{C.OUT}/stage3_b_{a.window}.csv", index=False)

    da.to_csv(f"{C.OUT}/stage3_a_{a.window}.csv", index=False)


if __name__ == "__main__":
    main()
