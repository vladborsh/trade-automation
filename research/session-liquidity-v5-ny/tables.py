#!/usr/bin/env python3
"""Descriptive tables for the session-liquidity **v5-NY** pass.

The pre-registered hypothesis test lives in `hypothesis.py`. THIS file is the
house-style descriptive layer that every prior pass produced — kept because
DESIGN §0 says the rigour is added *on top of* the descriptive metrics, not
instead of them. Blocks:

  E  eligibility funnel — how many take-outs can even reach the NY window
  N  confirmation rates, in-window vs out
  G  from-confirmation geometry, BLOCK vs H24 horizon, side by side
  L  the non-circular forward lift (the metric the shelving ruling turned on)
  W  window-length stratification (the standing "no best hour" null)
  A  appendix: SOL/BNB robustness, offset sensitivity, exclusions

BTC and ETH are foregrounded per DESIGN §2.3; SOL and BNB appear in the A
block, explicitly labelled as the robustness check.

Usage: python research/session-liquidity-v5-ny/tables.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C

MINB = C.MIN_BARS_REMAINING
REM_EDGES = [0, 12, 24, 48, 72, 10 ** 9]
REM_LBL = ["<12 (short)", "12-24", "24-48", "48-72", "72+"]

_lines: list[str] = []


def A(s: str = ""):
    _lines.append(s)


def load_events() -> pd.DataFrame:
    e = pd.concat([pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"))
                   for s in C.SYMBOLS], ignore_index=True)
    e["ts"] = pd.to_datetime(e["ts"], utc=True)
    e["primary"] = e.bars_remaining >= MINB
    e["rem_bucket"] = pd.cut(e.bars_remaining, REM_EDGES, right=False,
                             labels=REM_LBL)
    e["period"] = np.where(e.ts <= C.FIT_END, "fit", "holdout")
    e["foreground"] = e.symbol.isin(C.FOREGROUND)
    return e


def load_uncond() -> pd.DataFrame:
    u = pd.concat([pd.read_csv(os.path.join(C.RESULTS, f"uncond_{s}.csv.gz"))
                   for s in C.SYMBOLS], ignore_index=True)
    u["rem_bucket"] = pd.cut(u.bars_remaining, REM_EDGES, right=False,
                             labels=REM_LBL)
    return u


def md(df: pd.DataFrame, floatfmt="{:.2f}") -> str:
    d = df.copy()
    for c in d.columns:
        if d[c].dtype.kind == "f":
            d[c] = d[c].map(lambda v: "" if pd.isna(v) else floatfmt.format(v))
    head = "| " + " | ".join(str(c) for c in d.columns) + " |"
    sep = "|" + "---|" * len(d.columns)
    rows = ["| " + " | ".join(str(v) for v in r) + " |"
            for r in d.itertuples(index=False)]
    return "\n".join([head, sep] + rows)


def save(df: pd.DataFrame, name: str) -> pd.DataFrame:
    df.to_csv(os.path.join(C.RESULTS, name), index=False)
    return df


# ==========================================================================
def block_E(e: pd.DataFrame):
    A("## E — Eligibility funnel: how many take-outs can reach the NY window\n")
    A(f"The window is **{C.NY_WIN_UTC[0]//60:02d}:{C.NY_WIN_UTC[0]%60:02d}–"
      f"{C.NY_WIN_UTC[1]//60:02d}:{C.NY_WIN_UTC[1]%60:02d} UTC** "
      f"(09:40–11:20 New York at the pinned fixed offset UTC−4), "
      f"{C.NY_WIN_BARS} five-minute bars, and it sits **fully inside** the NY "
      "block (13:00–21:00 UTC).\n")
    A("Because confirmation is block-scoped and the confirmation bar is at or "
      "after the take-out bar, an in-window confirmation forces the take-out "
      "itself into **13:00–15:15 UTC**. The eligible population is therefore a "
      "narrow slice of the stream, and that is a property of the definition, "
      "not a choice made here.\n")
    rows = []
    for sym in C.SYMBOLS + ["BTC+ETH (foreground)", "ALL 4"]:
        if sym == "ALL 4":
            g = e
        elif sym.startswith("BTC+ETH"):
            g = e[e.foreground]
        else:
            g = e[e.symbol == sym]
        p = g[g.primary]
        rows.append(dict(
            scope=sym,
            take_outs=len(g),
            primary=len(p),
            in_NY_block=int((p.sweep_block == "NY").sum()),
            t0_window_eligible=int(p.t0_window_eligible.sum()),
            iFVG_conf_in_window=int(p.ifvg_in_ny.sum()),
            BoS_conf_in_window=int(p.bos_in_ny.sum()),
        ))
    t = save(pd.DataFrame(rows), "e1_eligibility_funnel.csv")
    A("**E1 — the funnel (primary sample, ≥12 bars remaining)**\n")
    A(md(t) + "\n")

    p = e[e.primary & e.foreground]
    el = p[p.t0_window_eligible]
    A(f"**E2 — conversion inside the eligible slice (BTC+ETH).** Of the "
      f"**{len(el):,}** primary take-outs whose `t0` could still produce an "
      f"in-window confirmation, **{int(el.ifvg_in_ny.sum()):,}** "
      f"({100*el.ifvg_in_ny.mean():.1f}%) actually confirm by iFVG inside the "
      f"window and **{int(el.bos_in_ny.sum()):,}** "
      f"({100*el.bos_in_ny.mean():.1f}%) by BoS. The rest either never confirm, "
      "or confirm after 15:20 UTC.\n")

    rows = []
    for pre, lab in (("ifvg", "iFVG-v4"), ("bos", "BoS pinned anchor")):
        cc = p[p[f"{pre}_confirmed"]]
        rows.append(dict(arm=lab, confirmed=len(cc),
                         in_window_UTC4=int(cc[f"{pre}_in_ny"].sum()),
                         share_UTC4=100 * cc[f"{pre}_in_ny"].mean(),
                         in_window_UTC5=int(cc[f"{pre}_in_ny_est"].sum()),
                         share_UTC5=100 * cc[f"{pre}_in_ny_est"].mean()))
    t = save(pd.DataFrame(rows), "e3_offset_sensitivity.csv")
    A("**E3 — offset sensitivity (BTC+ETH primary).** UTC−4 is the pinned "
      "window; UTC−5 is the same 100 New York minutes read under the winter "
      "offset. Both sit fully inside the NY block.\n")
    A(md(t) + "\n")
    A("> **DST caveat, verbatim from DESIGN §2.2:** a fixed UTC−4 window is "
      "*not* 09:40–11:20 New York wall clock all year. During EST months it is "
      "really **08:40–10:20** New York. These are fixed UTC minutes, not "
      "wall-clock precision around the 09:30 NYSE open.\n")


def _geo_row(g: pd.DataFrame, pre: str, h: str, label: str) -> dict:
    R = g[f"{pre}_{h}_R"].dropna()
    return dict(
        scope=label, n=len(g),
        MFE=g[f"{pre}_{h}_mfe_atr"].median(),
        MAE=g[f"{pre}_{h}_mae_atr"].median(),
        MFE_over_MAE=(g[f"{pre}_{h}_mfe_atr"].median()
                      / g[f"{pre}_{h}_mae_atr"].median()
                      if g[f"{pre}_{h}_mae_atr"].median() else np.nan),
        end_value=g[f"{pre}_{h}_end_atr"].median(),
        pct_end_favourable=100 * (g[f"{pre}_{h}_end_atr"] > 0).mean(),
        stop=g[f"{pre}_{h}_stop_atr"].median(),
        R_proxy=R.median(),
        pct_R_ge_1=100 * (R >= 1).mean() if len(R) else np.nan,
    )


def block_G(e: pd.DataFrame):
    A("\n## G — From-confirmation geometry: block-scoped vs the 24h horizon\n")
    A("All in ATR(14, 5m) multiples, medians. `MFE`/`MAE` are the best and "
      "worst excursions after the confirmation close; `end value` is the "
      "signed move at the horizon's last bar; `stop` is the pinned proxy "
      "(confirmation close back to the sweep leg's running extreme) and "
      "`R proxy` is MFE/stop — a **best-case** exit nobody hits systematically, "
      "kept only because every prior pass reported it.\n")
    p = e[e.primary & e.foreground]
    for pre, lab in (("ifvg", "iFVG-v4"), ("bos", "BoS pinned anchor")):
        rows = []
        cc = p[p[f"{pre}_confirmed"]]
        inw = cc[cc[f"{pre}_in_ny"]]
        for h, hl in (("blk", "block-scoped (PRIMARY)"), ("h24", "24h (appendix)")):
            sub = cc[cc[f"{pre}_{h}_mfe_atr"].notna()]
            rows.append(_geo_row(sub, pre, h, f"all confirmations · {hl}"))
            sub2 = inw[inw[f"{pre}_{h}_mfe_atr"].notna()]
            rows.append(_geo_row(sub2, pre, h, f"NY window only · {hl}"))
        t = save(pd.DataFrame(rows), f"g1_geometry_{pre}.csv")
        A(f"**G1[{lab}] — BTC+ETH, primary sample**\n")
        A(md(t) + "\n")


def block_L(e: pd.DataFrame, u: pd.DataFrame):
    A("\n## L — The non-circular forward lift (the metric the shelving turned on)\n")
    A("Every naive 'confirmed sweeps move N× more' number in this family is an "
      "artifact: the confirmation criterion mechanically requires the move "
      "already reported to have happened. The non-circular version throws away "
      "everything before the confirmation bar and compares each event's "
      "**post-confirmation MFE** against the unconditional forward move for "
      "the same `block × bars-remaining-at-confirmation × direction` cell. "
      "**1.0 = no better than a random comparable stretch of tape.** The "
      "shelved verdict rests on 0.83 (iFVG) and 0.87 (BoS) all-hours.\n")
    u = u.copy()
    u["rb"] = pd.cut(u.bars_remaining, [0, 12, 24, 48, 72, 96, 10 ** 9],
                     right=False,
                     labels=["<12", "12-24", "24-48", "48-72", "72-96", "96+"])
    ref = {}
    for dirn, col in (("high_sweep", "down_atr"), ("low_sweep", "up_atr")):
        g = u.groupby(["sweep_block", "rb"], observed=True)[col].median()
        ref[dirn] = g

    rows = []
    p = e[e.primary & e.foreground]
    for pre, lab in (("ifvg", "iFVG-v4"), ("bos", "BoS pinned anchor")):
        cc = p[p[f"{pre}_confirmed"] & p[f"{pre}_blk_mfe_atr"].notna()].copy()
        cc["rb"] = pd.cut(cc[f"{pre}_blk_conf_bars_remaining"],
                          [0, 12, 24, 48, 72, 96, 10 ** 9], right=False,
                          labels=["<12", "12-24", "24-48", "48-72", "72-96", "96+"])
        base = np.array([ref[d_].get((b_, r_), np.nan) for d_, b_, r_
                         in zip(cc.direction, cc.sweep_block, cc.rb)])
        cc["lift"] = cc[f"{pre}_blk_mfe_atr"].to_numpy() / base
        for scope, sub in (("all confirmations", cc),
                           ("NY window only", cc[cc[f"{pre}_in_ny"]])):
            L = sub["lift"].replace([np.inf, -np.inf], np.nan).dropna()
            rows.append(dict(arm=lab, scope=scope, n=len(L),
                             lift_median=L.median(),
                             pct_ge_1=100 * (L >= 1).mean() if len(L) else np.nan))
    t = save(pd.DataFrame(rows), "l1_forward_lift.csv")
    A("**L1 — forward lift, BTC+ETH primary, block-scoped horizon**\n")
    A(md(t) + "\n")


def block_W(e: pd.DataFrame):
    A("\n## W — Window length, the axis that dominated every prior pass\n")
    p = e[e.primary & e.foreground]
    rows = []
    for lbl, g in p.groupby("rem_bucket", observed=True):
        if not len(g):
            continue
        rows.append(dict(bars_left_at_t0=lbl, n=len(g),
                         share=100 * len(g) / len(p),
                         iFVG_rate=100 * g.ifvg_confirmed.mean(),
                         BoS_rate=100 * g.bos_confirmed.mean(),
                         iFVG_in_window=int(g.ifvg_in_ny.sum()),
                         BoS_in_window=int(g.bos_in_ny.sum())))
    t = save(pd.DataFrame(rows), "w1_by_window_bucket.csv")
    A("**W1 — BTC+ETH primary.** Note the in-window columns concentrate in the "
      "long buckets by construction: a take-out at 13:00–15:15 UTC always has "
      "most of the 96-bar NY block ahead of it.\n")
    A(md(t) + "\n")

    rows = []
    for pre, lab in (("ifvg", "iFVG-v4"), ("bos", "BoS pinned anchor")):
        for h in (0, 1):
            hour_col = p.groupby(p.ts.dt.hour, observed=True)[f"{pre}_confirmed"].mean()
            break
        for hh, v in hour_col.items():
            rows.append(dict(arm=lab, hour_utc=int(hh), confirm_rate=100 * v))
    t = save(pd.DataFrame(rows), "w2_rate_by_hour.csv")
    A("**W2 — confirmation rate by take-out hour (UTC), BTC+ETH primary.** "
      "Written to `w2_rate_by_hour.csv`; the standing null from v4/BoS is that "
      "this is window length in disguise, and chart `03_hour_and_window.png` "
      "shows the stratified version beside it.\n")


def block_A(e: pd.DataFrame):
    A("\n## A — Appendix\n")
    A("### A1 — SOL / BNB robustness check (NOT foregrounded)\n")
    A("Computed identically to BTC/ETH. Present so a cross-asset check exists, "
      "per DESIGN §2.3; they are not part of the pre-registered test "
      "population.\n")
    rows = []
    for sym in C.SYMBOLS:
        g = e[(e.symbol == sym) & e.primary]
        for pre, lab in (("ifvg", "iFVG"), ("bos", "BoS")):
            cc = g[g[f"{pre}_confirmed"]]
            inw = cc[cc[f"{pre}_in_ny"]]
            rows.append(dict(symbol=sym, arm=lab,
                             confirmed=len(cc), in_window=len(inw),
                             MFE_blk=inw[f"{pre}_blk_mfe_atr"].median(),
                             MAE_blk=inw[f"{pre}_blk_mae_atr"].median(),
                             stop=inw[f"{pre}_blk_stop_atr"].median(),
                             R_proxy=inw[f"{pre}_blk_R"].median()))
    t = save(pd.DataFrame(rows), "a1_per_asset.csv")
    A(md(t) + "\n")

    A("### A2 — Exclusions (DESIGN §4: counted, never silently dropped)\n")
    rows = []
    p = e[e.primary]
    for pre in ("ifvg", "bos"):
        for h in ("blk", "h24"):
            cc = p[p[f"{pre}_confirmed"]]
            rows.append(dict(arm=pre, horizon=h, confirmed=len(cc),
                             tradeable=int(cc[f"{pre}_{h}_netR"].notna().sum()),
                             excluded=int(cc[f"{pre}_{h}_netR"].isna().sum())))
    t = save(pd.DataFrame(rows), "a2_exclusions.csv")
    A("A trade is excluded when the confirmation lands on the horizon's last "
      "bar (no forward bars to run the template on) or the stop distance is "
      "zero. All four assets, primary sample.\n")
    A(md(t) + "\n")


def main():
    e = load_events()
    u = load_uncond()
    A("# Tables — session-liquidity v5-NY (descriptive layer)\n")
    A("Pre-registration: `DESIGN.md`. Pre-registered hypothesis test and null: "
      "`results/HYPOTHESIS.md` (written by `hypothesis.py`). This file is the "
      "house-style descriptive layer, reported alongside, per DESIGN §0.\n")
    A(f"Sample: {len(e):,} take-outs, {int(e.primary.sum()):,} primary, "
      f"BTC/ETH/SOL/BNB 5m, {e.ts.min():%Y-%m-%d} .. {e.ts.max():%Y-%m-%d}. "
      "BTC+ETH foregrounded (DESIGN §2.3).\n")
    block_E(e)
    block_G(e)
    block_L(e, u)
    block_W(e)
    block_A(e)
    out = os.path.join(C.RESULTS, "TABLES.md")
    with open(out, "w") as fh:
        fh.write("\n".join(_lines) + "\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
