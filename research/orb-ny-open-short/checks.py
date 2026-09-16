#!/usr/bin/env python3
"""The stop-rule checks of `DESIGN.md` §11. Any failure stops the pass and
returns to the Architect.

    python checks.py grid        # §2.3  NY-anchored bins == UTC epoch grid,
                                 #       now including 09:35 / 09:40 / 09:45
    python checks.py fills       # §3.5  1m-path fill == bar-OHLC fill
    python checks.py session     # §3.4  no trade crosses 16:00 NY
    python checks.py all

The look-ahead check of the closed pass is **dropped**: it existed to protect
Study B's feature matrix, and there is no Study B in this family (follow-up
note §7). No feature is read by any verdict here.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import engine as E  # noqa: E402

LOG = {}


def check_grid() -> dict:
    """09:30 NY must land on the 5- and 15-minute epoch grid on every session
    day in span, under both DST offsets — otherwise the NY-anchored bins and
    the UTC-aligned bins are different objects (§2.3)."""
    days = C.nyse_days("2024-01-01", "2026-09-11")
    bad = []
    offs = set()
    # The new clock points are the three range ends / trigger starts. They must
    # lie on the 5-minute epoch grid under either DST offset, or the arm's first
    # eligible bar is not the bar the DESIGN says it is. 09:35/09:45 do NOT lie
    # on the 15-minute grid — which is exactly why every arm here triggers on
    # 5m bars (note §4.3) — so the 15-minute assertion applies only to the
    # points the closed pass also used.
    pts5 = [C.OR_START, C.TRIG_END_BASE, C.TRIG_END_S5, C.FLAT] + \
           [C.trig_start(w) for w in C.OR_WIDTHS]
    pts15 = [C.OR_START, C.TRIG_END_BASE, C.TRIG_END_S5, C.FLAT]
    for d in days:
        for hh, mm in pts5:
            t = C.ny_ms(d, hh, mm)
            if t % (5 * C.MIN_MS):
                bad.append((d, hh, mm, t, "5m grid"))
        for hh, mm in pts15:
            t = C.ny_ms(d, hh, mm)
            if t % (15 * C.MIN_MS):
                bad.append((d, hh, mm, t, "15m grid"))
        offs.add(int((C.ny_ms(d, 9, 30) - int(pd.Timestamp(d).value // 10 ** 6)) / 3_600_000))
    r = dict(days=len(days), violations=len(bad),
             clock_points_5m=[f"{h:02d}:{m:02d}" for h, m in pts5],
             utc_offsets_of_0930_seen_h=sorted(offs), examples=bad[:5])
    r["pass"] = len(bad) == 0
    return r


def check_fills() -> dict:
    """§3.5 — on every trade that neither gapped its stop nor touched both
    levels inside one ARM bar, the 1m-path fill and the arm-bar-OHLC fill must
    agree exactly."""
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    rows = []
    for (sym, tf, orm), g in q.groupby(["symbol", "tf", "or_min"]):
        tp = E.Tape.get(sym)
        B = tp.bars[int(tf)]
        side = g.side.values.astype(np.int64)
        entry, stop, dist = g.entry.values, g.stop.values, g.stop_dist.values
        tgt = entry + side * dist
        # arm-bar indices: from the bar AFTER the trigger bar to the last bar
        # whose last minute is <= the forced-flat minute
        b0 = (g.j.values + 1).astype(np.int64)
        b1 = np.searchsorted(B["i_last"], g.i_flat.values, "right") - 1
        b1 = np.maximum(b1, b0 - 1).astype(np.int64)
        both, gapped = E.path_flags(B["o"], B["h"], B["l"], B["c"], b0, b1, side, stop, tgt)
        xi, xp, xc = E.walk_bar_many(B["o"], B["h"], B["l"], B["c"], b0, b1, side,
                                     entry, stop, tgt)
        bar_gross = side * (xp - entry) / dist
        # "gaps its stop" is a property of the trade, not of a chosen bar size:
        # a MINUTE can open through the stop inside an arm bar whose own open is
        # not through it, and that is exactly the case the 1m path exists to
        # resolve. Flag the gap at 1-minute granularity as well, and exclude
        # those trades from the agreement set (DESIGN §3.5).
        m0 = (g.i_entry_min.values + 1).astype(np.int64)
        m1 = g.i_flat.values.astype(np.int64)
        both1m, gapped1m = E.path_flags(tp.o, tp.h, tp.l, tp.c, m0, m1, side, stop, tgt)
        agree = (both == 0) & (gapped == 0) & (gapped1m == 0) & (both1m == 0) & (b1 >= b0)
        # the two conventions must also find the same CAUSE for this to be a
        # like-for-like comparison; a cause difference on a non-gapping,
        # non-both-touch trade is itself a violation and is counted.
        same_cause = np.array([EN(c1) == c2 for c1, c2 in zip(xc, g.exit_1.values)])
        d = np.abs(bar_gross - g.grossR_1.values)
        v = agree & ((d > 1e-9) | (~same_cause))
        # STRONGER than §3.5 asks: on the excluded (gapping / both-touch)
        # trades the 1m-path fill must be no BETTER than the bar-OHLC fill.
        # If the finer path were systematically kinder, the fill convention
        # would be flattering the result; it must only ever be harsher.
        ex = ~agree & (b1 >= b0)
        kinder = int((g.grossR_1.values[ex] - bar_gross[ex] > 1e-9).sum())
        rows.append(dict(arm=C.arm_name(sym, int(orm)), n=len(g), agreement_n=int(agree.sum()),
                         max_absdiff=float(d[agree].max()) if agree.any() else 0.0,
                         violations=int(v.sum()),
                         both_touch_bar=int(both.sum()), gapped_bar=int(gapped.sum()),
                         gapped_1m=int(gapped1m.sum()), both_touch_1m=int(both1m.sum()),
                         excluded=int(ex.sum()), excluded_1m_kinder=kinder))
    t = pd.DataFrame(rows)
    return dict(table=t.to_dict("records"),
                **{"pass": int(t.violations.sum()) == 0
                   and int(t.excluded_1m_kinder.sum()) == 0})


def EN(x):
    return E.EXIT_NAME[int(x)]


def check_session() -> dict:
    """§3.4 — no trade crosses 16:00 NY, on any arm."""
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    bad = []
    for sym, g in q.groupby("symbol"):
        tp = E.Tape.get(sym)
        t_ex = tp.t[np.clip(g.i_exit_1.values, 0, tp.n - 1)]
        t_ex2 = tp.t[np.clip(g.i_exit_2.values, 0, tp.n - 1)]
        lim = np.array([C.ny_ms(d, *C.FLAT) for d in g.date.values])
        n = int(((t_ex >= lim) | (t_ex2 >= lim)).sum())
        bad.append(dict(symbol=sym, n=len(g), crossings=n))
    t = pd.DataFrame(bad)
    return dict(table=t.to_dict("records"), **{"pass": int(t.crossings.sum()) == 0})


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    todo = ["grid", "fills", "session"] if cmd == "all" else [cmd]
    out = {}
    for c in todo:
        out[c] = dict(grid=check_grid, fills=check_fills,
                      session=check_session)[c]()
        print(f"[{c}] pass={out[c]['pass']}")
        print(json.dumps({k: v for k, v in out[c].items() if k != "table"},
                         indent=2, default=str)[:1500])
        if "table" in out[c]:
            print(pd.DataFrame(out[c]["table"]).to_string(index=False))
    with open(os.path.join(C.RESULTS, "checks.json"), "w") as fh:
        json.dump(out, fh, indent=2, default=str)
    if not all(v["pass"] for v in out.values()):
        raise SystemExit("CHECK FAILED — DESIGN.md §11 stop rule. Return to Architect.")


if __name__ == "__main__":
    main()
