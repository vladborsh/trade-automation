#!/usr/bin/env python3
"""Fills the two computed sections of DESIGN.md (§2.3 `N_elig`, §13 the screen
decision) in place. Both are written before the corresponding R is read.

    python report.py nelig      # after `build.py panel`, before any R
    python report.py screen     # after `analysis.py fit|screen`, before the holdout
"""
from __future__ import annotations
import json, os, sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402

D = os.path.join(HERE, "DESIGN.md")


def _put(marker: str, body: str) -> None:
    s = open(D).read()
    a = s.index(f"<!-- {marker} -->")
    b = a + len(f"<!-- {marker} -->")
    end = s.index(f"<!-- /{marker} -->") + len(f"<!-- /{marker} -->") \
        if f"<!-- /{marker} -->" in s else b
    s = s[:a] + f"<!-- {marker} -->\n\n{body}\n\n<!-- /{marker} -->" + s[end:]
    open(D, "w").write(s)
    print(f"DESIGN.md §{marker} filled")


def nelig() -> None:
    n = pd.read_csv(os.path.join(C.RESULTS, "n_elig.csv"))
    tr = n[n.tradable]
    u = pd.read_csv(os.path.join(C.RESULTS, "universe.csv"))
    yr = n.assign(y=n.date.str[:4]).groupby("y").agg(
        anchor_days=("date", "size"),
        tradable_days=("tradable", "sum"),
        n_elig_min=("n_elig_A", "min"),
        n_elig_median=("n_elig_A", "median"),
        n_elig_max=("n_elig_A", "max"),
        n_elig_B_median=("n_elig_B", "median"))
    lines = [
        f"**Admitted universe: {len(u)} symbols** (§2.1), of which "
        f"**{len(json.load(open(os.path.join(C.RESULTS,'eligible_months.json'))))}** have at "
        "least one day passing the daily-data-only rules 1/4/5 and therefore have 1-minute "
        "archives pulled (§15 `prep/pull1m.py`).",
        "",
        f"**First tradable day (`N_elig ≥ {C.N_ELIG_MIN}`): `{tr.date.min()}`.** "
        f"The fit period therefore effectively starts there, not at 2020-01-01 — the USD-M "
        f"venue simply did not have 50 symbols passing the liquidity floor before then. "
        f"(Stop rule 3 of §14 asked whether `N_elig` reaches 50 before 2021-07-01: it does, "
        f"in {tr.date.min()[:7]}.)",
        "",
        f"**Tradable days: {len(tr):,} of {len(n):,} NYSE full days in "
        f"2020-01-01 .. 2026-07-31** ({len(n)-len(tr):,} days are counted in the exclusions "
        "row as `N_elig < 50`).",
        "",
        "| year | NYSE full days | tradable | `N_elig` min | median | max | `N_elig(B)` median |",
        "|---|---|---|---|---|---|---|",
    ]
    for y, r in yr.iterrows():
        lines.append(f"| {y} | {int(r.anchor_days)} | {int(r.tradable_days)} | "
                     f"{int(r.n_elig_min)} | {r.n_elig_median:.0f} | {int(r.n_elig_max)} | "
                     f"{r.n_elig_B_median:.0f} |")
    lines += ["",
              "The note projected `N_elig` above 200 from 2022 and 300–400 across the holdout. "
              "The realised series is lower than that projection (the 10 M USDT liquidity "
              "floor binds harder than the note assumed) but is far above the 50-symbol "
              "threshold throughout, so the cross-section is wide enough for a top-5 "
              "selection to mean something. Recorded here, before any R, as a fact about the "
              "universe rather than about the mechanic."]
    _put("NELIG", "\n".join(lines))


def screen() -> None:
    scr = json.load(open(os.path.join(C.RESULTS, "screen.json")))
    fit = json.load(open(os.path.join(C.RESULTS, "fit.json")))
    lines = ["### FIT SCREEN DECISION — COMMITTED", "",
             f"Fit period `{C.FIT_START} .. {C.FIT_END}` (effective start as in §2.3). "
             "Screen rule: **mean net R ≥ +0.05R and random-5 `p` ≤ 0.05.**", "",
             "| arm | fit legs | fit trade-days | fit mean net R | fit mean, dATR units | "
             "random-5 `p` | decision |",
             "|---|---|---|---|---|---|---|"]
    for arm in ("RVOL-top5-s0.5", "TR24-top5-s0.5"):
        s, f = scr[arm], fit[arm]["primary"]
        lines.append(f"| `{arm}` | {f['n_legs']:,} | {f['n_days']:,} | "
                     f"**{s['fit_mean_netR']:+.4f}R** | {f['mean_dATR']:+.4f} dATR | "
                     f"{s['fit_random5_p']:.4f} | "
                     f"**{'SCREENED IN — may read the holdout' if s['screened_in'] else 'SCREENED OUT — NO EDGE — KILL (fit screen)'}** |")
    inn = [a for a in scr if scr[a]["screened_in"]]
    lines += ["",
              ("Both arms are screened out. **Per §13, the holdout is not computed for "
               "anything and the family's ledger stays at 2 registered / 0 read.**"
               if not inn else
               f"Screened in: {', '.join('`'+a+'`' for a in inn)}. The holdout is read once, "
               "for these arms only; a screened-out arm's holdout column stays blank."),
              "",
              "This decision is committed before `analysis.py holdout` is run; "
              "`analysis.py:_design_has_screen()` refuses to compute the holdout until this "
              "section exists in a clean commit."]
    _put("SCREEN", "\n".join(lines))


if __name__ == "__main__":
    {"nelig": nelig, "screen": screen}[sys.argv[1]]()
