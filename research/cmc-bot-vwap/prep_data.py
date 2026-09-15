#!/usr/bin/env python3
"""Raw Capital.com NDJSON (`ts_harness/pull_1m.ts`) -> `data/<SYM>_1m.parquet`
+ the coverage audit `results/COVERAGE.md`.

Per row:
  t_ms       snapshotTimeUTC as epoch ms (the true bar-open instant)
  label_ms   snapshotTime parsed the way the bot parses it on a UTC host
             (`Date.parse` of an offset-less string == UTC) — kept only to
             measure the broker-local offset (PARITY.md D-01)
  open/high/low/close   (ask + bid) / 2, exactly `mapMarketDataToChartData`
  volume     lastTradedVolume
  spread_close  ask - bid at the close (not used by Stage 0; Stage 1 cost model)

    python prep_data.py            # all four
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, RAW, RESULTS, SYMBOLS, TIMINGS, MIN_MS, DAY_MS, ny_window_utc_ms  # noqa: E402


def parse(symbol: str) -> pd.DataFrame:
    rows = []
    with open(os.path.join(RAW, f"{symbol}.ndjson")) as fh:
        for line in fh:
            p = json.loads(line)
            op, hp, lp, cp = p["openPrice"], p["highPrice"], p["lowPrice"], p["closePrice"]
            rows.append((p["snapshotTimeUTC"], p["snapshotTime"],
                         (op["ask"] + op["bid"]) / 2, (hp["ask"] + hp["bid"]) / 2,
                         (lp["ask"] + lp["bid"]) / 2, (cp["ask"] + cp["bid"]) / 2,
                         p["lastTradedVolume"], cp["ask"] - cp["bid"]))
    df = pd.DataFrame(rows, columns=["utc", "label", "open", "high", "low", "close", "volume", "spread_close"])
    df["ts"] = pd.to_datetime(df.utc, utc=True)
    df["t_ms"] = df.ts.values.astype("datetime64[ms]").astype("int64")
    df["label_ms"] = pd.to_datetime(df.label, utc=True).values.astype("datetime64[ms]").astype("int64")
    df = df.drop(columns=["utc", "label"])
    return df


def main() -> None:
    out = ["# COVERAGE — Capital.com 1-minute history, as pulled", "",
           "Produced by `prep_data.py`. Source: `ts_harness/pull_1m.ts` (bot's `CapitalComSession`, "
           "request identical to `CapitalComClient.realRequest`). Earliest 1-minute bar the API serves "
           "was bisected by `ts_harness/probe_bisect.ts`: **2024-01-01 for all four instruments** "
           "(requests before that return `error.prices.not-found`).", ""]
    out += ["| symbol | bars | first bar (UTC) | last bar (UTC) | dup ts | non-monotone | zero-volume bars | "
            "label − UTC offsets seen (h) |", "|---|---|---|---|---|---|---|---|"]
    gap_md = []
    for sym in (sys.argv[1:] or SYMBOLS):
        df = parse(sym)
        n0 = len(df)
        dups = int(df.t_ms.duplicated().sum())
        nonmono = int((np.diff(df.t_ms.values) <= 0).sum())
        df = df.drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
        off = ((df.label_ms - df.t_ms) / 3_600_000).round(3).value_counts().sort_index()
        zero_v = int((df.volume == 0).sum())
        df.to_parquet(os.path.join(DATA, f"{sym}_1m.parquet"), index=False)
        out.append(f"| {sym} | {n0:,} | {df.ts.iloc[0]:%Y-%m-%d %H:%M} | {df.ts.iloc[-1]:%Y-%m-%d %H:%M} | {dups} | "
                   f"{nonmono} | {zero_v:,} | {', '.join(f'{k:+g}: {v:,}' for k, v in off.items())} |")

        # ---- coverage of the bars the strategy actually reads -------------
        # For every UTC weekday: are all minutes of the alive window present,
        # and how many minutes are missing in the 12h evaluation window before
        # the entry window's first bar?
        t = df.t_ms.values
        have = set(t.tolist())
        tm = TIMINGS[sym]
        days = pd.date_range(df.ts.iloc[0].normalize(), df.ts.iloc[-1].normalize(), freq="D")
        stats = []
        for d in days:
            if d.dayofweek >= 5:
                continue
            d_ms = int(d.value // 10**6)
            a0, a1 = ny_window_utc_ms(d_ms, *tm["alive"])
            e0, e1 = ny_window_utc_ms(d_ms, *tm["entry"])
            alive_bars = range(a0, a1 + 1, MIN_MS)
            miss_alive = sum(1 for x in alive_bars if x not in have)
            entry_bars = range(e0, e1 + 1, MIN_MS)
            miss_entry = sum(1 for x in entry_bars if x not in have)
            lo = np.searchsorted(t, e0 - 12 * 3600_000, "left")
            hi = np.searchsorted(t, e0, "right")
            stats.append((d.date(), len(alive_bars), miss_alive, len(entry_bars), miss_entry, hi - lo))
        st = pd.DataFrame(stats, columns=["day", "alive_n", "alive_miss", "entry_n", "entry_miss", "win12h_bars"])
        empty = st[st.entry_miss == st.entry_n]
        partial = st[(st.entry_miss > 0) & (st.entry_miss < st.entry_n)]
        gap_md += [f"### {sym}", "",
                   f"- UTC weekdays in span: **{len(st)}**; weekdays with **no bar at all** in the entry window "
                   f"(holiday / closed): **{len(empty)}**; with a *partial* entry window: **{len(partial)}** "
                   f"(missing entry-window minutes on those days: median {int(partial.entry_miss.median()) if len(partial) else 0}, "
                   f"max {int(partial.entry_miss.max()) if len(partial) else 0}).",
                   f"- Missing minutes inside the alive window, all weekdays with data: "
                   f"{int(st.loc[st.entry_miss < st.entry_n, 'alive_miss'].sum()):,} of "
                   f"{int(st.loc[st.entry_miss < st.entry_n, 'alive_n'].sum()):,}.",
                   f"- Bars in the 12h window ending at the first entry bar (721 = complete): "
                   f"median {int(st.win12h_bars.median())}, 5th pct {int(st.win12h_bars.quantile(.05))}, "
                   f"min {int(st.win12h_bars.min())}.",
                   f"- No-data weekdays: {', '.join(str(x) for x in empty.day.tolist()) or 'none'}", ""]
        st.to_csv(os.path.join(RESULTS, f"coverage_days_{sym}.csv"), index=False)
        print(sym, n0, "bars; dups", dups, "; empty entry days", len(empty), "; partial", len(partial))
    out += ["", "## Per-instrument coverage of the bars the strategy reads", ""] + gap_md
    with open(os.path.join(RESULTS, "COVERAGE.md"), "w") as fh:
        fh.write("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
