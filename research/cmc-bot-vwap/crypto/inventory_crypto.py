#!/usr/bin/env python3
"""Crypto extension — signal/order logs and counts under both entry-window conditions.

Counts only: no R, no win rate, no PnL. The order logs carry exit prices so
Stage 1 (if ever routed) has them, but nothing here summarises them.

Conditions (see crypto/README.md):
  win  the US100/US500 windows verbatim (entry 09:40-11:40 NY, alive
       09:40-14:30 NY, Mon-Fri by UTC weekday, forced flat after 14:30 NY)
  all  no clock restriction: every minute of every day is entry-valid and
       nothing is ever force-closed

Writes, per symbol x condition:
  results/crypto/signals_<SYM>_<cond>.parquet        as-deployed (daily caps on)
  results/crypto/signals_nocaps_<SYM>_<cond>.parquet daily caps removed
  results/crypto/INVENTORY_CRYPTO.md, inventory_crypto_summary.csv

    python crypto/inventory_crypto.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
sys.path.insert(0, PKG)
from common import BUY, CRYPTO, CRYPTO_WINDOW, DAY_MS, RESULTS, SELL, load_1m, ms  # noqa: E402
import engine  # noqa: E402
from inventory import funnel  # noqa: E402

OUT = os.path.join(RESULTS, "crypto")
os.makedirs(OUT, exist_ok=True)
CONDS = {"win": CRYPTO_WINDOW, "all": engine.ALWAYS}
LABEL = {"win": "(a) NY window — entry 09:40–11:40 NY, alive 09:40–14:30 NY, Mon–Fri",
         "all": "(b) unrestricted — every minute, 24/7, never force-closed"}


def main() -> None:
    md = ["# INVENTORY — crypto extension (BTCUSDT, ETHUSDT USD-M perps): counts only", "",
          "Produced by `crypto/inventory_crypto.py` from the same `engine.py` that is bit-exact against the "
          "bot's TypeScript on Capital.com and on this Binance tape (`results/crypto/PARITY_CRYPTO.md`). "
          "**No R, no win rate, no PnL.** Every mechanic parameter is the bot's own (VWAP/ATR band "
          "[2.5, 11.5], iFVG ATR cap 8, stop-shrink table, 3R target, BE/+1R trail, 2-loss/1-win daily caps). "
          "**As-deployed** = caps on; **caps off** = daily caps removed, one-open-order-per-direction kept.", ""]
    summary = []
    sections = []
    for sym in CRYPTO:
        df = load_1m(sym)
        P = engine.prepare(sym, df)
        lo = ms(df.ts.iloc[0]); hi = ms(df.ts.iloc[-1])
        months = (hi - lo) / (30.4375 * DAY_MS)
        for cond, timing in CONDS.items():
            tr, ev, _ = engine.run(P, lo, hi, timing=timing, record_components=True)
            tn, _, _ = engine.run(P, lo, hi, timing=timing, record_components=False, daily_caps=False)
            assert (ev.err < 3).all()
            tr.to_parquet(os.path.join(OUT, f"signals_{sym}_{cond}.parquet"), index=False)
            tn.to_parquet(os.path.join(OUT, f"signals_nocaps_{sym}_{cond}.parquet"), index=False)
            ts = pd.to_datetime(tr.signal_ts, unit="ms", utc=True)
            tsn = pd.to_datetime(tn.signal_ts, unit="ms", utc=True)
            n_open = int((~tr.closed.astype(bool)).sum())
            vwap_throw = int((ev.err == 2).sum())
            # how hard do the daily caps bind: days on which a cap was hit before the day ended
            # caps are INSIDE processCharts' signal expression, so read the blocking off the funnel:
            # row 7 = every other gate passed, row 8 = caps also passed (= signal), row 9 = order allowed
            fun = funnel(ev)
            sig_bars = ev[ev.signal != -1]
            capped = (fun[7][1] + fun[7][2]) - (fun[8][1] + fun[8][2])
            same_dir = (fun[8][1] + fun[8][2]) - (fun[9][1] + fun[9][2])
            weekend = int((ts.dt.dayofweek >= 5).sum())
            hours = ts.dt.tz_convert("America/New_York").dt.hour.value_counts().sort_index()
            summary.append(dict(symbol=sym, condition=cond, months=round(months, 1), orders=len(tr),
                                sells=int((tr.dir == SELL).sum()), buys=int((tr.dir == BUY).sum()),
                                per12m=round(len(tr) / months * 12), orders_nocaps=len(tn),
                                per12m_nocaps=round(len(tn) / months * 12),
                                signal_bars=len(sig_bars), blocked_by_caps=capped, blocked_same_dir=same_dir,
                                weekend_orders=weekend, open_at_end=n_open, vwap_empty_throw_bars=vwap_throw))
            by = pd.DataFrame({"as-deployed": ts.groupby(ts.dt.year).size(),
                               "caps off": tsn.groupby(tsn.dt.year).size()}).fillna(0).astype(int)
            s = [f"### {sym} — {LABEL[cond]}", "",
                 f"- **Orders, as-deployed: {len(tr):,}** ({int((tr.dir == SELL).sum()):,} sell / "
                 f"{int((tr.dir == BUY).sum()):,} buy) ≈ **{len(tr) / months * 12:,.0f} per 12 months**.",
                 f"- **Orders, caps off: {len(tn):,}** ≈ **{len(tn) / months * 12:,.0f} per 12 months**.",
                 f"- Bars passing every mechanic gate: {capped + len(sig_bars):,}; of those, suppressed by the daily "
                 f"2-loss/1-win caps {capped:,}; signal but blocked by an open same-direction order {same_dir:,}.",
                 f"- Orders on a Saturday/Sunday (UTC): {weekend:,}. Orders still open at the last bar: {n_open}. "
                 f"Bars where `VWAP([])` throws (the 00:00 UTC bar — the bias window starts at 00:01): {vwap_throw:,}.",
                 "", "| year | as-deployed | caps off |", "|---|---|---|"] + \
                [f"| {y} | {r['as-deployed']:,} | {r['caps off']:,} |" for y, r in by.iterrows()] + [""]
            if cond == "all":
                s += ["Signal-bar hour, New York time (as-deployed): " +
                      ", ".join(f"{h:02d}h {c}" for h, c in hours.items()), ""]
            s += ["Eligibility funnel (as-deployed; each row conditional on the rows above):", "",
                  "| gate | sell side | buy side |", "|---|---|---|"] + \
                 [f"| {a} | {x:,} | {y:,} |" for a, x, y in fun] + [""]
            sections += s
            print(sym, cond, "orders", len(tr), "nocaps", len(tn), flush=True)
    sm = pd.DataFrame(summary)
    sm.to_csv(os.path.join(OUT, "inventory_crypto_summary.csv"), index=False)
    md += ["## Summary", "", "| symbol | condition | orders as-deployed | per 12 mo | orders caps off | per 12 mo | "
           "gate-passing bars suppressed by caps | signals blocked by open same-dir order |", "|---|---|---|---|---|---|---|---|"] + \
          [f"| {r.symbol} | {r.condition} | {r.orders:,} | {r.per12m:,} | {r.orders_nocaps:,} | {r.per12m_nocaps:,} | "
           f"{r.blocked_by_caps:,} | {r.blocked_same_dir:,} |" for r in sm.itertuples()] + \
          ["", f"Span: {load_1m(CRYPTO[0]).ts.iloc[0]:%Y-%m-%d} .. {load_1m(CRYPTO[0]).ts.iloc[-1]:%Y-%m-%d %H:%M} UTC "
           f"({sm.months.iloc[0]} months).", ""] + sections
    with open(os.path.join(OUT, "INVENTORY_CRYPTO.md"), "w") as fh:
        fh.write("\n".join(md) + "\n")


if __name__ == "__main__":
    main()
