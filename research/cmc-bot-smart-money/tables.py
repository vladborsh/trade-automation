#!/usr/bin/env python3
"""Stage-0 deliverable 3+4 — the signal inventory, the eligibility funnel and
the projected holdout trade count.

Counts only. No R, no win rate, no expectancy, no MFE/MAE — ARCHITECT-NOTE §4
forbids every one of those before the Architect has reviewed this output.

    python tables.py            # all four symbols, 2022-08-01 .. 2026-07-31

Writes `results/signals.parquet`, `results/trades_primary.parquet`,
`results/trades_capped.parquet` and `results/INVENTORY.md`.
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from common import BUY, FIT_END, HOLDOUT_START, RESULTS, SELL, SYMBOLS  # noqa: E402
import engine  # noqa: E402

# ARCHITECT-NOTE §4's funnel, with the M1 trigger made an explicit stage. The
# note lists "both iFVG lists non-empty -> bias agrees -> zone filters agree ->
# ATR gate"; the trigger (`bullishIfvgOccurs` / `bearishIfvgOccurs`) is what
# actually turns a bar into a candidate, so it is shown rather than folded into
# "bias agrees". The stages are nested, each a subset of the one above.
FUNNEL = [
    ("S0 in-window M1 bars", None),
    ("S1 + an M1 iFVG fired on this bar", "trigger"),
    ("S2 + both iFVG lists non-empty (lastIFVG defined)", "has_ifvg"),
    ("S3 + H1 bias agrees with the trigger", "bias_ok"),
    ("S4 + zone filters agree (true-open side AND premium/discount)", "zone_ok"),
    ("S5 + ATR(20) gate passes  =  SIGNAL", "atr_ok"),
]


def annotate(sig: pd.DataFrame) -> pd.DataFrame:
    """Nested funnel flags. A bar can fire a bullish and a bearish trigger on
    the same bar; the branch is disambiguated by `aboveNYamTrueOpen`, which the
    two entry conditions read with opposite polarity, so the two branches are
    mutually exclusive by construction (asserted in checks.py C10)."""
    sell_br = sig.bear_occ & sig.above_nyam
    buy_br = sig.bull_occ & ~sig.above_nyam
    sig = sig.copy()
    sig["trigger"] = sig.bear_occ | sig.bull_occ
    sig["bias_ok"] = sig.trigger & (((sig.bias == SELL) & sig.bear_occ) |
                                    ((sig.bias == BUY) & sig.bull_occ))
    sig["zone_ok"] = sig.bias_ok & (((sig.bias == SELL) & sell_br & ~sig.in_disc) |
                                    ((sig.bias == BUY) & buy_br & sig.in_disc))
    # nest the stages so each column implies the one above it
    sig["has_ifvg_n"] = sig.trigger & sig.has_ifvg
    sig["bias_ok"] = sig.bias_ok & sig.has_ifvg_n
    sig["zone_ok"] = sig.zone_ok & sig.bias_ok
    sig["atr_ok_n"] = sig.zone_ok & sig.atr_ok
    return sig


def funnel_table(sig: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    cols = {"S0 in-window M1 bars": np.ones(len(sig), bool),
            "S1 + an M1 iFVG fired on this bar": sig.trigger.to_numpy(),
            "S2 + both iFVG lists non-empty (lastIFVG defined)": sig.has_ifvg_n.to_numpy(),
            "S3 + H1 bias agrees with the trigger": sig.bias_ok.to_numpy(),
            "S4 + zone filters agree (true-open side AND premium/discount)": sig.zone_ok.to_numpy(),
            "S5 + ATR(20) gate passes  =  SIGNAL": sig.atr_ok_n.to_numpy()}
    d = sig[by].copy()
    for k, v in cols.items():
        d[k] = v
    return d.groupby(by, observed=True).sum().astype(int)


def md_table(df: pd.DataFrame) -> str:
    df = df.reset_index()
    head = "| " + " | ".join(str(c) for c in df.columns) + " |"
    rule = "|" + "|".join("---" for _ in df.columns) + "|"
    body = ["| " + " | ".join(f"{v:,}" if isinstance(v, (int, np.integer)) else str(v)
                              for v in row) + " |" for row in df.itertuples(index=False)]
    return "\n".join([head, rule] + body)


def main() -> None:
    all_sig, all_pri, all_cap = [], [], []
    for sym in SYMBOLS:
        t0 = time.time()
        P = engine.prepare(sym)
        sig = engine.signals(P)
        pri = engine.simulate_trades(P, sig, daily_caps=False)
        cap = engine.simulate_trades(P, sig, daily_caps=True)
        print(f"{sym}: {len(sig):,} in-window bars, {int(sig.signal.sum()):,} signals, "
              f"{len(pri):,} trades (caps off) / {len(cap):,} (caps on)  "
              f"[{time.time()-t0:.0f}s]", flush=True)
        all_sig.append(annotate(sig)); all_pri.append(pri); all_cap.append(cap)

    sig = pd.concat(all_sig, ignore_index=True)
    pri = pd.concat(all_pri, ignore_index=True)
    cap = pd.concat(all_cap, ignore_index=True)
    sig["year"] = pd.DatetimeIndex(sig.ts).year
    for d in (pri, cap):
        d["ts"] = pd.to_datetime(d.signal_ts, unit="ms", utc=True)
        d["year"] = pd.DatetimeIndex(d.ts).year
        d["split"] = np.where(pd.DatetimeIndex(d.ts) < HOLDOUT_START, "fit", "holdout")

    sig.to_parquet(os.path.join(RESULTS, "signals.parquet"), index=False)
    pri.to_parquet(os.path.join(RESULTS, "trades_primary.parquet"), index=False)
    cap.to_parquet(os.path.join(RESULTS, "trades_capped.parquet"), index=False)

    n_hold = int((pri.split == "holdout").sum())
    gate = "CLEAR (>= 150)" if n_hold >= 150 else "STOP — UNDERPOWERED (< 150)"

    dir_name = {BUY: "buy", SELL: "sell"}
    out = [
        "# Stage-0 signal inventory and eligibility funnel",
        "",
        "**Counts only.** ARCHITECT-NOTE §4 forbids any performance number at this",
        "stage — there is no R, no win rate and no expectancy anywhere in this file,",
        "and none has been computed. Generated by `tables.py`.",
        "",
        f"Period 2022-08-01 .. 2026-07-31 · symbols {', '.join(SYMBOLS)} · Binance USD-M perp 1m.",
        "",
        "## 0. The projected holdout trade count — the Stage-0 gate",
        "",
        "| population | fit (2022-08..2025-07) | holdout (2025-08..2026-07) | total |",
        "|---|---|---|---|",
        f"| **primary** — daily caps REMOVED (ARCHITECT-NOTE §3.2) | "
        f"{int((pri.split=='fit').sum()):,} | **{n_hold:,}** | {len(pri):,} |",
        f"| secondary — as deployed, 2-loss / 1-win caps ON | "
        f"{int((cap.split=='fit').sum()):,} | {int((cap.split=='holdout').sum()):,} | {len(cap):,} |",
        "",
        f"**Gate (`n_holdout >= 150`): {gate}.**",
        "",
        "A *signal* is an M1 bar on which every entry condition fires. A *trade* is a",
        "signal that actually opened an order — the one-open-order-per-direction rule",
        "(`isNewOrdersAllowed`) suppresses the rest. Both counts are below.",
        "",
        f"Signals: {int(sig.signal.sum()):,} · trades (caps off): {len(pri):,} ·",
        f"suppressed by the concurrency rule: {int(sig.signal.sum()) - len(pri):,}.",
        "",
        "## 1. Eligibility funnel, per asset",
        "",
        md_table(funnel_table(sig, ["symbol"])),
        "",
        "## 2. Eligibility funnel, per year",
        "",
        md_table(funnel_table(sig, ["year"])),
        "",
        "## 3. Eligibility funnel, per asset x year",
        "",
        md_table(funnel_table(sig, ["symbol", "year"])),
        "",
        "## 4. Signals and trades per asset, per year, per direction",
        "",
        md_table(pd.crosstab([pri.symbol, pri.year], pri["dir"].map(dir_name))),
        "",
        "## 5. Direction mix",
        "",
        f"Signals: sell {int((sig.direction == SELL).sum()):,} / "
        f"buy {int((sig.direction == BUY).sum()):,}.",
        f"Trades (caps off): sell {int((pri['dir'] == SELL).sum()):,} / "
        f"buy {int((pri['dir'] == BUY).sum()):,}.",
        "",
        "The sell lean is expected, not an artifact of this port: `getLastIfvgDirection`",
        "returns **sell** as its default when the bullish iFVG list is empty",
        "(`PARITY.md` D-02), so the H1 bias is structurally sell-leaning in quiet tape.",
        "",
        "## 6. Exit-cause mix of the primary trade stream (a count, not a result)",
        "",
        md_table(pd.crosstab(pri.symbol, pri.exit_why)),
        "",
        "`TIME_1110` is the forced flat at 11:10 New York, `OPPOSITE` is the",
        "both-directions-open rule. Reported here because ARCHITECT-NOTE §1.2 predicts",
        "the time exit will dominate the mix and that prediction is checkable without",
        "computing a single return.",
        "",
    ]
    with open(os.path.join(RESULTS, "INVENTORY.md"), "w") as fh:
        fh.write("\n".join(out) + "\n")
    print("\n".join(out[:24]))
    print(f"\nwrote {os.path.join(RESULTS, 'INVENTORY.md')}")


if __name__ == "__main__":
    main()
