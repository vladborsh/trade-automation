#!/usr/bin/env python3
"""Stage-0 signal inventory and eligibility funnel — counts only, no R.

Runs the parity-proven port (`engine.run`) over each instrument's whole
Capital.com history and writes:

  results/signals_<SYM>.parquet   every order the as-deployed bot opens
                                  (signal bar, direction, entry/stop/target, exit
                                  bar and cause are kept for Stage 1 but are NOT
                                  summarised here)
  results/evals_<SYM>.parquet     every evaluated bar with every component
  results/INVENTORY.md            counts per instrument / year / month / direction,
                                  the funnel, and the sample-size projection

    python inventory.py [SYMBOLS...]
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import BUY, SELL, RESULTS, SYMBOLS, TIMINGS, load_1m, ms  # noqa: E402
import engine  # noqa: E402


def funnel(ev: pd.DataFrame) -> list[tuple[str, int, int]]:
    """Sequential gates in processCharts order, per direction. (label, sell, buy)."""
    rows = []
    d = ev
    rows.append(("entry-window minutes evaluated", len(d), len(d)))
    d = d[d.n > 0]
    rows.append(("  ... with a non-empty 12h window (market open)", len(d), len(d)))
    s = d[d.bias == SELL]; b = d[d.bias == BUY]
    rows.append(("VWAP bias set (open above upper band = sell / below lower = buy)", len(s), len(b)))
    s = s[(s.ratio >= 2.5) & (s.ratio <= 11.5)]; b = b[(b.ratio >= 2.5) & (b.ratio <= 11.5)]
    rows.append(("band width / ATR(20) in [2.5, 11.5]", len(s), len(b)))
    s = s[s.bear_occ == 1]; b = b[b.bull_occ == 1]
    rows.append(("iFVG in the bias direction on this bar", len(s), len(b)))
    s = s[s.in_disc == 0]; b = b[b.in_disc == 1]
    rows.append(("premium (sell) / discount (buy) vs 200-bar midpoint", len(s), len(b)))
    s = s[s.ifvg_ok == True]; b = b[b.ifvg_ok == True]  # noqa: E712
    rows.append(("ATR(20) / lastIFVG size < 8 (and lastIFVG defined)", len(s), len(b)))
    s = s[s.above == True]; b = b[b.below == True]  # noqa: E712
    rows.append(("prior-hour high swept (sell) / low swept (buy), last 6 bars", len(s), len(b)))
    s = s[s.caps_ok == True]; b = b[b.caps_ok == True]  # noqa: E712
    rows.append(("daily caps not hit (2 losses / 1 win) = processCharts signal", len(s), len(b)))
    s = s[s.allowed == True]; b = b[b.allowed == True]  # noqa: E712
    rows.append(("no open order in the same direction", len(s), len(b)))
    s = s[s.placed == True]; b = b[b.placed == True]  # noqa: E712
    rows.append(("order placed (stop and target truthy)", len(s), len(b)))
    return rows


def main() -> None:
    syms = sys.argv[1:] or SYMBOLS
    md = ["# INVENTORY — Stage 0 signal inventory (counts only; no R, no win rate)", "",
          "Produced by `inventory.py` from the parity-proven port over each instrument's whole "
          "Capital.com 1-minute history. **As-deployed** = the bot exactly as coded, daily 2-loss/1-win "
          "caps on. **Caps off** = same stream with the daily caps removed (the ≤1-open-per-direction "
          "rule kept), the population a Stage 1 pass would most likely use as primary, as in the "
          "smart-money ruling.", ""]
    summary = []
    for sym in syms:
        df = load_1m(sym)
        P = engine.prepare(sym, df)
        lo = ms(df.ts.iloc[0].normalize() + pd.Timedelta("1D"))       # first full UTC day
        hi = ms(df.ts.iloc[-1])                                        # last bar pulled
        trades, ev, _ = engine.run(P, lo, hi, daily_caps=True)
        tr_nc, ev_nc, _ = engine.run(P, lo, hi, daily_caps=False, record_components=False)
        tr_live, _, _ = engine.run(P, lo, hi, daily_caps=True, record_components=False, live_like=True)
        assert (ev.err < 3).all(), "an unexpected TypeScript exception path fired"
        assert trades.closed.all() and tr_nc.closed.all()
        trades.to_parquet(os.path.join(RESULTS, f"signals_{sym}.parquet"), index=False)
        tr_nc.to_parquet(os.path.join(RESULTS, f"signals_nocaps_{sym}.parquet"), index=False)
        ev.to_parquet(os.path.join(RESULTS, f"evals_{sym}.parquet"), index=False)

        months = (hi - lo) / (30.4375 * 86_400_000)
        days_eval = ev[ev.n > 0]["T"].floordiv(86_400_000).nunique()
        tr = trades.assign(ts=pd.to_datetime(trades.signal_ts, unit="ms", utc=True))
        tn = tr_nc.assign(ts=pd.to_datetime(tr_nc.signal_ts, unit="ms", utc=True))
        per_12m = len(trades) / months * 12
        per_12m_nc = len(tr_nc) / months * 12
        # D-03: signals whose lastIFVG exists only because of the asymmetric branch
        sig_ev = ev.merge(trades[["signal_ts"]], left_on="T", right_on="signal_ts")
        d03 = int(((sig_ev.n_bear_ifvg == 0) & (sig_ev.n_bull_ifvg > 0)).sum())
        live_match = len(set(zip(trades.signal_ts, trades.dir)) & set(zip(tr_live.signal_ts - 60_000, tr_live.dir)))
        summary.append(dict(symbol=sym, first=df.ts.iloc[0], last=df.ts.iloc[-1], months=months,
                            trading_days=days_eval, orders=len(trades), sells=int((trades.dir == SELL).sum()),
                            buys=int((trades.dir == BUY).sum()), orders_nocaps=len(tr_nc),
                            per12m=per_12m, per12m_nocaps=per_12m_nc, d03=d03,
                            live_orders=len(tr_live), live_same=live_match))

        # ---- mechanical facts referenced by PARITY.md (counts, no outcomes) ----
        evd = ev[ev.n > 0]
        tsig = trades.merge(ev, left_on="signal_ts", right_on="T")
        beyond = int((((tsig.dir == BUY) & (tsig.entry < tsig.range_bottom)) |
                      ((tsig.dir == SELL) & (tsig.entry > tsig.range_top))).sum())
        facts = dict(
            evals_n_lt_721=int((evd.n < 721).sum()), evals=len(evd),
            evals_n_lt_201=int((evd.n < 201).sum()),
            evals_vwap_empty_throw=int((ev.err == 2).sum()),
            evals_stale_bar=int((evd.g_ts != evd["T"]).sum()),
            evals_asym_branch=int(((evd.n_bull_ifvg > 0) & (evd.n_bear_ifvg == 0)).sum()),
            evals_bull_list_empty=int((evd.n_bull_ifvg == 0).sum()),
            orders_stale_bar=int((tsig.g_ts != tsig.signal_ts).sum()),
            orders_entry_beyond_anchor=beyond,
            orders_zero_stop=int((trades.stop0 == trades.entry).sum()),
            orders_gap_entry=int((trades.entry_ts - trades.signal_ts != 60_000).sum()),
        )
        pd.Series(facts).to_csv(os.path.join(RESULTS, f"facts_{sym}.csv"))
        md_facts = [f"- Mechanical facts (for PARITY.md): evaluated bars {facts['evals']:,}; 12h window short of 721 bars "
                    f"(missing minutes) on {facts['evals_n_lt_721']:,}; fewer than 201 bars (no 200-bar range) on "
                    f"{facts['evals_n_lt_201']:,}; bar at T missing so the previous bar is re-read on "
                    f"{facts['evals_stale_bar']:,}; VWAP([]) throws (no bar since UTC midnight, D-18) on "
                    f"{facts['evals_vwap_empty_throw']:,}; bullish-iFVG list empty (lastIFVG undefined, gate blocked) on "
                    f"{facts['evals_bull_list_empty']:,}; asymmetric D-03 branch live on {facts['evals_asym_branch']:,}. "
                    f"Orders: entry already beyond its stop anchor (close broke the 200-bar extreme that excludes the "
                    f"current bar) {facts['orders_entry_beyond_anchor']}; zero-size stop {facts['orders_zero_stop']}; "
                    f"entry time ≠ signal bar + 1 min {facts['orders_gap_entry']}; signal on a re-read stale bar "
                    f"{facts['orders_stale_bar']}.", ""]

        tm = TIMINGS[sym]
        md += [f"## {sym}", "",
               f"- Span evaluated: {pd.Timestamp(lo, unit='ms'):%Y-%m-%d} .. {pd.Timestamp(hi, unit='ms'):%Y-%m-%d} "
               f"({months:.1f} months, {days_eval} weekdays with data in the entry window).",
               f"- Entry window {tm['entry'][0]:02d}:{tm['entry'][1]:02d}–{tm['entry'][2]:02d}:{tm['entry'][3]:02d} NY, "
               f"alive {tm['alive'][0]:02d}:{tm['alive'][1]:02d}–{tm['alive'][2]:02d}:{tm['alive'][3]:02d} NY.",
               f"- **Orders, as-deployed: {len(trades)}** ({int((trades.dir == SELL).sum())} sell / "
               f"{int((trades.dir == BUY).sum())} buy) ≈ **{per_12m:.0f} per 12 months**.",
               f"- **Orders, caps off: {len(tr_nc)}** ({int((tr_nc.dir == SELL).sum())} sell / "
               f"{int((tr_nc.dir == BUY).sum())} buy) ≈ **{per_12m_nc:.0f} per 12 months**.",
               f"- Orders whose `lastIFVG` exists only through `getLastIfvg`'s asymmetric branch "
               f"(bearish iFVG list empty, bullish non-empty — D-03): {d03} of {len(trades)}.",
               f"- Live-like read (PARITY.md L-01, bar T−1 at gate T): {len(tr_live)} orders; "
               f"{live_match} of them are the same (bar, direction) as an as-deployed order one bar earlier.", ""] + md_facts
        by = pd.DataFrame({"as-deployed": tr.groupby(tr.ts.dt.year).size(),
                           "caps off": tn.groupby(tn.ts.dt.year).size()}).fillna(0).astype(int)
        md += ["| year | as-deployed | caps off |", "|---|---|---|"] + \
              [f"| {y} | {r['as-deployed']} | {r['caps off']} |" for y, r in by.iterrows()] + [""]
        bm = tr.groupby(tr.ts.dt.strftime("%Y-%m")).size()
        md += ["Orders per month (as-deployed): " + ", ".join(f"{k} {v}" for k, v in bm.items()), ""]
        md += ["Eligibility funnel over every evaluated bar (as-deployed; each row conditional on the ones above):", "",
               "| gate | sell side | buy side |", "|---|---|---|"] + \
              [f"| {a} | {s:,} | {b:,} |" for a, s, b in funnel(ev)] + [""]
        print(sym, "orders", len(trades), "nocaps", len(tr_nc), "live", len(tr_live), flush=True)

    sm = pd.DataFrame(summary)
    head = ["## Summary", "",
            "| symbol | history | orders as-deployed | per 12 mo | orders caps off | per 12 mo |",
            "|---|---|---|---|---|---|"] + \
           [f"| {r.symbol} | {r.first:%Y-%m-%d} .. {r.last:%Y-%m-%d} ({r.months:.1f} mo) | {r.orders} | "
            f"{r.per12m:.0f} | {r.orders_nocaps} | {r.per12m_nocaps:.0f} |" for r in sm.itertuples()] + [""]
    path = os.path.join(RESULTS, "INVENTORY.md")
    if len(syms) == len(SYMBOLS):
        md = md[:4] + head + md[4:]
    with open(path, "w") as fh:
        fh.write("\n".join(md) + "\n")
    sm.to_csv(os.path.join(RESULTS, "inventory_summary.csv"), index=False)


if __name__ == "__main__":
    main()
