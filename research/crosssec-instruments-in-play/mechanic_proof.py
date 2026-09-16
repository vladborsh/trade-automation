#!/usr/bin/env python3
"""§8.1 / §11.3 — MECHANIC-PROOF.md: ten hand-checked anchor days per arm.

Each day shows: the eligible count, the top-10 and bottom-10 of that day's
ranking with the ranking inputs (`V30` / 14-day median / `RVOL`, or
`P(A)` / `P(A-24h)` / `TR24`), and for each of the five selected legs the
reader `r30`, side, entry, `dATR14`, stop, exit minute, exit cause, `cost_R`
and `netR`. Fit period only.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import engine as E  # noqa: E402
from xselect import Panel  # noqa: E402

ARMS = {"RVOL-top5-s0.5": "RVOL", "TR24-top5-s0.5": "TR24"}
N_DAYS = 10


def main() -> None:
    legs = pd.read_parquet(os.path.join(C.RESULTS, "instrument_days.parquet"))
    pan_all = pd.read_parquet(os.path.join(C.RESULTS, "panel.parquet"))
    fit = legs[legs.period == "fit"].reset_index(drop=True)
    rng = np.random.default_rng(C.SEED)
    out = ["# MECHANIC-PROOF — cross-sectional instruments in play",
           "",
           "Hand-checkable arithmetic for ten anchor days per arm, fit period only.",
           "Every quantity below is computed from bars with open time `< A + 30 min`",
           "except the exit path, which runs from `A + 30 min` to `A + 4 h 30 min`.",
           "`DESIGN.md` is the pre-registration; this file only shows it working.",
           ""]
    for arm, selector in ARMS.items():
        sub = fit if selector == "RVOL" else fit[np.isfinite(fit.tr24.values)].reset_index(drop=True)
        P = Panel(sub, selector)
        days = [d for d, n in zip(P.days, P.n_elig) if n >= C.N_ELIG_MIN]
        pick = sorted(rng.choice(days, size=min(N_DAYS, len(days)), replace=False))
        out += [f"## {arm}", ""]
        for d in pick:
            j = int(np.where(P.days == d)[0][0])
            r = P.ranked[j]
            L = P.legs
            A = int(L.anchor_ms.values[r[0]])
            out += [f"### {d}  (anchor A = {C.fmt(A)} = "
                    f"{pd.Timestamp(A, unit='ms', tz='UTC').strftime('%H:%M UTC')}), "
                    f"N_elig = {len(r)}", ""]
            if selector == "RVOL":
                pa = pan_all[(pan_all.date == d)].set_index("symbol")
                hdr = "| rank | symbol | V30 (USDT) | 14-day median V30 | RVOL = V30/median |"
                sep = "|---|---|---|---|---|"
                def line(i, pos):
                    s = L.symbol.values[i]
                    v = L.v30.values[i]; rv = L.rvol.values[i]
                    return (f"| {pos} | {s} | {v:,.0f} | {v/rv:,.0f} | **{rv:.3f}** |")
            else:
                hdr = "| rank | symbol | P(A) | P(A-24h) | TR24 | \\|TR24\\| |"
                sep = "|---|---|---|---|---|---|"
                def line(i, pos):
                    s = L.symbol.values[i]
                    t24 = L.tr24.values[i]
                    pA = L.entry.values[i] / (1 + L.r30.values[i])  # = open(A) bar
                    return (f"| {pos} | {s} | — | — | {t24:+.4f} | **{abs(t24):.4f}** |")
            out += ["**Ranking — top 10**", "", hdr, sep]
            out += [line(i, p + 1) for p, i in enumerate(r[:10])]
            out += ["", "**Ranking — bottom 10**", "", hdr, sep]
            out += [line(i, len(r) - 9 + p) for p, i in enumerate(r[-10:])]
            out += ["", "**The five selected legs**", "",
                    "| symbol | r30 | side | entry | dATR14 | stop_dist = 0.5xdATR14 | stop | "
                    "exit min | exit cause | exit px | grossR | cost_R | netR |",
                    "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
            for i in r[:C.K_SELECT]:
                x = L.iloc[i]
                out.append(f"| {x.symbol} | {x.r30:+.5f} | {'long' if x.side>0 else 'short'} "
                           f"| {x.entry:.6g} | {x.datr14:.6g} | {x.stop_dist:.6g} "
                           f"| {x.stop:.6g} | {x.exit_min:.0f} | {E.EXIT_NAME[x.exit_cause]} "
                           f"| {x.exit_px:.6g} | {x.grossR:+.4f} | {x.cost_R:.4f} "
                           f"| **{x.netR:+.4f}** |")
            mean = float(L.netR.values[r[:C.K_SELECT]].mean())
            out += ["", f"Day mean net R over the 5 legs: **{mean:+.4f}**",
                    f"(check: `grossR = side x (exit_px - entry) / stop_dist`, "
                    f"`cost_R = 0.001 x entry / stop_dist`, `netR = grossR - cost_R`)", ""]
    with open(os.path.join(HERE, "MECHANIC-PROOF.md"), "w") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"wrote MECHANIC-PROOF.md ({len(out)} lines)")


if __name__ == "__main__":
    main()
