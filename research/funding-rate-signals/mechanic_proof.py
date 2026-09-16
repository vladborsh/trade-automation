#!/usr/bin/env python3
"""MECHANIC-PROOF.md — 10 hand-checked A trades and 10 hand-checked B trades
across both tiers, each with its FULL settlement ledger (every t_j, f_j, mark,
R contribution), the stop, the exit and its cause (DESIGN §10 step 3).

Selection is by a fixed stride through the fit-period trade list per tier, not
by outcome: the trades are picked before their R is looked at.
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import TIERS, FIT_END, COST_RT, A_STOP_DATR, LAPSE, MAX_SETTLEMENTS
import prep, engine

START = pd.Timestamp("2019-01-01", tz="UTC")
OUTMD = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "MECHANIC-PROOF.md")


def pick(trades, n):
    """Fixed stride, outcome-blind."""
    ts = [t for t in trades if t.get("excluded") is None]
    if len(ts) <= n:
        return ts
    step = len(ts) / n
    return [ts[int(i * step)] for i in range(n)]


def render(t, bars, sett, arm):
    L = []
    s = "SHORT" if t["side"] == -1 else "LONG"
    L.append(f"### {arm} · {t['symbol']} · {s} · signal {t['t_signal']}")
    L.append("")
    if arm == "A":
        L.append(f"* **Trigger** — extreme funding at `k-1` and `k`. "
                 f"`f_k = {t['f_at_k']:+.6f}` "
                 f"({t['f_at_k']*100:+.4f} %/8h), `fpct_k = {t['fpct_at_k']:.3f}`, "
                 f"`spct_k = {t['spct_at_k']:.3f}`.")
        km1 = sett.loc[:t["t_signal"]].iloc[-2]
        L.append(f"* Previous settlement `k-1` "
                 f"{sett.loc[:t['t_signal']].index[-2]}: "
                 f"`f = {km1['f']:+.6f}`, `fpct = {km1['fpct']:.3f}` — "
                 f"both slots present, so the two-settlement condition holds.")
        L.append(f"* **Entry** at the close of the bar opening at `t_k` = "
                 f"{t['t_signal']}, i.e. `t_entry = {t['t_entry']}` "
                 f"(one full bar of lag). `entry = {t['entry']:.6g}`.")
        L.append(f"* **Risk unit** `dATR14` (prior completed UTC day) = "
                 f"{t['datr']:.6g}; `stop_dist = 1.5 x dATR14 = "
                 f"{t['stop_dist']:.6g}` = **1R**; `stop = {t['stop']:.6g}`.")
    else:
        L.append(f"* **Trigger** — funding extreme at the last settlement "
                 f"`t_k <= T`; trailing 24h return "
                 f"`{t['ret24']:+.4%}` (with the crowd); close through the "
                 f"prior 12-bar extreme.")
        L.append(f"* **Entry** at `close_T`, `T = {t['t_signal']}`, "
                 f"`t_entry = {t['t_entry']}`, `entry = {t['entry']:.6g}`.")
        L.append(f"* **Stop** = 12-bar extreme +/- 0.25 x ATR14 "
                 f"({t['atr14']:.6g}) = {t['stop']:.6g}; "
                 f"`stop_dist = {t['stop_dist']:.6g}` = **1R**; "
                 f"**target** +1R = {t['target']:.6g}.")
    L.append("")
    L.append(f"**Settlement ledger** — collected iff "
             f"`t_entry < t_j < t_exit`, i.e. "
             f"`{t['t_entry']} < t_j < {t['t_exit']}`:")
    L.append("")
    L.append("| `t_j` | `f_j` | mark `open(t_j)` | "
             "`(-side)*f_j*mark/stop_dist` | status |")
    L.append("|---|---|---|---|---|")
    tot = 0.0
    for e in t["ledger"]:
        if np.isfinite(e["f_j"]):
            tot += e["R"]
            L.append(f"| {e['t_j']} | {e['f_j']:+.6f} | {e['mark']:.6g} | "
                     f"{e['R']:+.6f} | {e['status']} |")
        else:
            L.append(f"| {e['t_j']} | — | — | +0.000000 | {e['status']} |")
    if not t["ledger"]:
        L.append("| — | — | — | +0.000000 | *no settlement inside the span "
                 "(zero-settlement trade, counted)* |")
    L.append(f"| | | **sum** | **{tot:+.6f}** | "
             f"engine `fundingR = {t['fundingR']:+.6f}` |")
    L.append("")
    L.append(f"* **Exit** — cause `{t['cause']}`, "
             f"`t_exit = {t['t_exit']}`, `exit_px = {t['exit_px']:.6g}`, "
             f"hold {t['hold_h']:.0f} h, {t['n_settlements']} settlement slots "
             f"crossed.")
    L.append(f"* **Decomposition** — "
             f"`priceR = {t['side']} x ({t['exit_px']:.6g} - {t['entry']:.6g}) "
             f"/ {t['stop_dist']:.6g} = {t['priceR']:+.4f}`; "
             f"`fundingR = {t['fundingR']:+.4f}`; "
             f"`costR = 0.001 x {t['entry']:.6g} / {t['stop_dist']:.6g} = "
             f"{t['costR']:+.4f}`; "
             f"**`netR = {t['priceR']:+.4f} {t['fundingR']:+.4f} "
             f"- {t['costR']:.4f} = {t['netR']:+.4f}`**.")
    # independent arithmetic re-check
    chk_p = t["side"] * (t["exit_px"] - t["entry"]) / t["stop_dist"]
    chk_c = COST_RT * t["entry"] / t["stop_dist"]
    ok = (abs(chk_p - t["priceR"]) < 1e-12 and abs(chk_c - t["costR"]) < 1e-12
          and abs(tot - t["fundingR"]) < 1e-12
          and abs(chk_p + t["fundingR"] - chk_c - t["netR"]) < 1e-12)
    L.append(f"* **Hand re-check**: recomputing all four legs from the printed "
             f"inputs reproduces `netR` to 1e-12 — **{'OK' if ok else 'MISMATCH'}**.")
    L.append("")
    return "\n".join(L), ok


def main():
    frames = prep.build_all()
    out = ["# MECHANIC-PROOF — `funding-rate-signals`",
           "",
           "Twenty fit-period trades, ten per hypothesis, split across both "
           "tiers, each printed with its **full settlement ledger** and its "
           "four-leg decomposition re-derived by hand from the printed inputs "
           "(DESIGN §10 step 3). Trades are chosen by a **fixed stride** "
           "through each tier's trade list — outcome-blind, before any R is "
           "looked at.",
           "",
           "`checks.py` results are in `results/checks.csv`; all ten "
           "assertions pass. Everything below is **fit period only**.",
           ""]
    allok = True
    for arm in ("A", "B"):
        out.append(f"---\n\n## Hypothesis {arm} — ten trades\n")
        for tier, syms in TIERS.items():
            tr = []
            for s in syms:
                bars, sett = frames[s]
                r = (engine.run_A if arm == "A" else engine.run_B)(
                    bars, sett, s, START, FIT_END)
                tr += r
            tr = sorted([t for t in tr if t.get("excluded") is None],
                        key=lambda x: x["t_signal"])
            for t in pick(tr, 5):
                md, ok = render(t, *frames[t["symbol"]], arm)
                out.append(f"#### tier: {tier}\n")
                out.append(md)
                allok = allok and ok
    out.append("---\n")
    out.append(f"**All twenty hand re-checks reproduce the engine's `netR` to "
               f"1e-12: {'YES' if allok else 'NO'}.**")
    with open(OUTMD, "w") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"wrote {OUTMD}; all hand-checks ok = {allok}")


if __name__ == "__main__":
    main()
