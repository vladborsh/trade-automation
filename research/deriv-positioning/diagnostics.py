#!/usr/bin/env python3
"""The standard diagnostic block (DESIGN.md §6) plus two redundancy diagnostics.

§6 asks every priced variant to report: breaker-bind frequency, skipped signals,
hold times, cost_R off realised stops, long/short split, realised R distribution.
Those are produced here from the engine's own trade log plus a re-run that counts
what the engine declined to take and why.

The two extra diagnostics are not gates — they exist because §0's central
question ("is this price in disguise?") deserves a direct measurement as well as
the §5.3 pass/fail, and because the b1 shadow turns out to fire far less often
than the rule it shadows (see the report §5.3), so the shadow comparison alone is
under-powered:

  * rank correlation of each positioning percentile with its price shadow;
  * the same correlation against contemporaneous and trailing returns.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from scipy import stats

import common as C
import prep
import signals as S


# ------------------------------------------------------ engine-side accounting
def engine_accounting(d: pd.DataFrame, sig: pd.DataFrame, win, time_stop: int) -> dict:
    """Re-walk the engine's own admission logic to count what it skipped.

    Mirrors backtest.run's entry block exactly (position busy / halted / signal
    invalid at the fill price) without changing the engine itself.
    """
    w = C.window_mask(d, win)
    dd = d.loc[w].reset_index(drop=True)
    ss = sig.loc[w, ["sig", "stop", "target"]].reset_index(drop=True)
    res = C.bt.run(dd, ss, time_stop)
    tr = res["trades"]

    raw = int((ss.sig != 0).sum())
    taken = len(tr)
    eq = res["equity"]
    day = dd.ts.dt.floor("D")
    day_open = eq.groupby(day.to_numpy()).transform("first")
    bind = float((eq.to_numpy() <= day_open.to_numpy() * (1 - C.bt.DAILY_STOP_PCT)).mean())
    days_binding = float(pd.Series(
        eq.to_numpy() <= day_open.to_numpy() * (1 - C.bt.DAILY_STOP_PCT)
    ).groupby(day.to_numpy()).max().mean())
    return dict(raw_signals=raw, trades_taken=taken,
                skipped=raw - taken, skipped_pct=100.0 * (raw - taken) / max(1, raw),
                breaker_bar_pct=100.0 * bind, breaker_day_pct=100.0 * days_binding)


# --------------------------------------------------------- redundancy diagnostics
def redundancy_table(symbols) -> pd.DataFrame:
    rows = []
    for sym in symbols:
        d = prep.get(sym)
        base = d.usable.to_numpy()
        fwd1 = d.close.shift(-1) / d.close - 1.0
        pairs = [("dOI_4h_pct", "ret4h_pct", "usable_a"),
                 ("crowd", "ret24h_pct", "usable_b1"),
                 ("taker", "vol_pct", "usable_b2")]
        for real, shadow, gate in pairs:
            m = d[gate].to_numpy() & d[real].notna().to_numpy() & d[shadow].notna().to_numpy()
            a, b = d[real].to_numpy()[m], d[shadow].to_numpy()[m]
            r_sh = stats.spearmanr(a, b).statistic
            r_tr = stats.spearmanr(a, d.ret24h.to_numpy()[m]).statistic
            r_now = stats.spearmanr(a, (d.close / d.open - 1.0).to_numpy()[m]).statistic
            rows.append(dict(symbol=sym, series=real, shadow=shadow, n=int(m.sum()),
                             rho_vs_shadow=r_sh, rho_vs_ret24h=r_tr,
                             rho_vs_same_bar_ret=r_now))
    return pd.DataFrame(rows)


def main():
    keep = json.load(open(f"{C.OUT}/symbols_kept.json"))["kept"]
    pd.set_option("display.width", 220)

    rt = redundancy_table(keep["a"])
    rt.to_csv(f"{C.OUT}/redundancy_correlations.csv", index=False)
    print("=== §0 redundancy diagnostic — Spearman rho of each positioning percentile ===")
    print(rt.groupby(["series", "shadow"])[
        ["rho_vs_shadow", "rho_vs_ret24h", "rho_vs_same_bar_ret"]
    ].mean().to_string(float_format=lambda x: f"{x:8.3f}"))

    rows = []
    for sym in keep["a"]:
        d = prep.get(sym)
        sig = S.momentum_breakout(d)
        gate = d.usable_a.to_numpy()
        base = sig.copy()
        base.loc[~gate, ["sig", "stop", "target"]] = [0, np.nan, np.nan]
        terc = S.tercile(d.dOI_4h_pct.to_numpy())
        for tag, sg in (("unconditioned", base),
                        ("top_tercile", base.mask(pd.Series(terc != 2, index=base.index),
                                                  other=np.nan)[["sig", "stop", "target"]])):
            sg = sg.copy()
            sg["sig"] = sg.sig.fillna(0)
            # FIT ONLY: nothing survived stage 2, so the holdout is never read
            for wname, win in (("fit", C.FIT),):
                r = engine_accounting(d, sg, win, C.P["time_stop"])
                r.update(symbol=sym, variant=tag, window=wname)
                rows.append(r)
    for name in ("b1_crowd", "b2_taker"):
        syms = keep["b1" if name.startswith("b1") else "b2"]
        for sym in syms:
            d = prep.get(sym)
            sig = S.build_event(d, name)
            for wname, win in (("fit", C.fit_win(name)),):
                r = engine_accounting(d, sig, win, C.EVENT_TIME_STOP)
                r.update(symbol=sym, variant=name, window=wname)
                rows.append(r)
    ea = pd.DataFrame(rows)
    ea.to_csv(f"{C.OUT}/engine_accounting.csv", index=False)
    print("\n=== §6 engine accounting (breaker binding, skipped signals) ===")
    print(ea.groupby(["variant", "window"])[
        ["raw_signals", "trades_taken", "skipped", "skipped_pct",
         "breaker_bar_pct", "breaker_day_pct"]
    ].agg({"raw_signals": "sum", "trades_taken": "sum", "skipped": "sum",
           "skipped_pct": "mean", "breaker_bar_pct": "mean",
           "breaker_day_pct": "mean"}).to_string(float_format=lambda x: f"{x:9.2f}"))


if __name__ == "__main__":
    main()
