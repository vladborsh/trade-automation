#!/usr/bin/env python3
"""Build the drill-down's working event frame: both streams + derived columns.

Reads the **v4** session-level stream
(`../../session-liquidity-v4/results/events_*.csv`, unmodified — v4 confirmation,
which is what makes C1 comparable to C2/C3) and this pass's PDH/PDL stream
(`results/pd_events_*.csv`, also v4-confirmed), attaches the
drill-down's own causal columns (hour bucket, window-length stratum, signed ER,
iFVG gap size in ATR and relative to the swept structure's range), and writes
one file every downstream script reads.

`stream` is carried explicitly ("session" / "pd") so the two are never pooled by
accident; every table below selects a combo, never "all events".

Usage: .venv/bin/python research/session-liquidity-v2/drilldown/dd_prep.py
"""
from __future__ import annotations

import os

import pandas as pd

import dd_common as D


def build() -> pd.DataFrame:
    ses = D.T.load_events()          # v4 package's loader -> v4-confirmed events
    ses["stream"] = "session"
    pdf = pd.concat([pd.read_csv(os.path.join(D.RESULTS, f"pd_events_{s}.csv"),
                                 parse_dates=["ts"]) for s in D.SYMBOLS],
                    ignore_index=True)
    pdf["stream"] = "pd"
    pdf["primary"] = pdf.bars_remaining >= D.MINB
    e = pd.concat([ses, pdf], ignore_index=True)
    e = D.attach_derived(e, D.Prices())
    return e


def load() -> pd.DataFrame:
    f = os.path.join(D.RESULTS, "dd_events.csv.gz")
    e = pd.read_csv(f, parse_dates=["ts"], low_memory=False)
    e["stratum"] = pd.Categorical(e.stratum, categories=D.STRATA_LBL, ordered=True)
    # `coincident_session_level` exists only on the PD stream, so a round-trip
    # through CSV leaves it as an object column mixing bools with NaN. Session
    # rows are not coincident with anything by definition -> False.
    for c in ("coincident_session_level", "ifvg_confirmed", "primary",
              "clean_trend", "ifvg_strict_confirmed", "ifvg_would_confirm_extended"):
        e[c] = e[c].astype(str).str.lower().eq("true")
    return e


def combo(e: pd.DataFrame, name: str) -> pd.DataFrame:
    """The primary sample of one combo: the >=12-bars-remaining rule (V4) plus
    the combo's (stream, level_session, sweep_block) filter. Nothing else."""
    c = D.COMBOS[name]
    return e[(e.stream == c["stream"]) & (e.level_session == c["level_session"])
             & (e.sweep_block == c["sweep_block"]) & e.primary].copy()


if __name__ == "__main__":
    e = build()
    out = os.path.join(D.RESULTS, "dd_events.csv.gz")
    e.to_csv(out, index=False)
    print("wrote", out, len(e), "events")
    for k in D.COMBO_ORDER:
        g = combo(e, k)
        print(f"  {k} {D.COMBOS[k]['label']:<28} {len(g):>6} primary take-outs, "
              f"{int(g.ifvg_confirmed.sum()):>6} confirmed, "
              f"{g.er.notna().sum():>6} with an ER")
