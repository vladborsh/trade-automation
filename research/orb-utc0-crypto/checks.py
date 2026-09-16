#!/usr/bin/env python3
"""The stop-rule checks of `DESIGN.md` §12. Any failure stops the pass and
returns to the Architect.

    python checks.py grid        # §3.0  the clock points lie on the 5m grid
    python checks.py funding     # §3.4  NO position open at 00:00/08:00/16:00 UTC
    python checks.py fills       # §4.2  1m-path fill == bar-OHLC fill
    python checks.py session     # §3.4  no trade crosses its forced flat
    python checks.py all

The look-ahead check of the closed pass is moot without Study B and the
feature vector, and is dropped (§12).
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


def check_grid() -> dict:
    """00:00, 00:30, 02:30 and 07:55 UTC must lie on the 5-minute epoch grid on
    every calendar day in span, and the UTC offset must be zero on all of them
    — the assertion that replaces the closed pass's DST check (§3.0)."""
    days = C.all_days(C.FIT_START, C.TAIL_END)
    bad, offs = [], set()
    for d in days:
        for hh, mm in (C.OR_START, C.OR_END, C.TRIG_START, C.TRIG_END_BASE, C.FLAT):
            t = C.utc_ms(d, hh, mm)
            if t % (5 * C.MIN_MS):
                bad.append((d, hh, mm, t))
        offs.add(int((C.utc_ms(d, 0, 0) - int(pd.Timestamp(d).value // 10 ** 6))
                     / 3_600_000))
    r = dict(days=len(days), violations=len(bad),
             utc_offsets_of_anchor_seen_h=sorted(offs), examples=bad[:5])
    r["pass"] = len(bad) == 0 and offs == {0}
    return r


def check_funding() -> dict:
    """§3.4, NEW in this family — no position is EVER open at a Binance
    8-hour funding settlement (00:00 / 08:00 / 16:00 UTC), on either template.

    The entry minute is at or after 00:30 UTC (past that day's 00:00 stamp)
    and every exit minute must be strictly before that day's 08:00 stamp.
    Funding is therefore not merely unmodelled here: it is structurally zero.
    """
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    rows = []
    for sym, g in q.groupby("symbol"):
        tp = E.Tape.get(sym)
        t_in = tp.t[g.i_entry_min.values]
        stamps = []
        for hh, mm in C.FUNDING_UTC:
            stamps.append(np.array([C.utc_ms(d, hh, mm) for d in g.date.values]))
            stamps.append(stamps[-1] + C.DAY_MS)
        n_bad = 0
        for num in (1, 2):
            t_out = tp.t[np.clip(g[f"i_exit_{num}"].values, 0, tp.n - 1)]
            for s in stamps:
                # the position is live over (t_in, t_out]; a funding stamp inside
                # that half-open interval would be charged.
                n_bad += int(((s > t_in) & (s <= t_out)).sum())
        rows.append(dict(symbol=sym, n=len(g),
                         first_entry_utc=C.fmt(t_in.min()),
                         last_exit_utc=C.fmt(tp.t[np.clip(g.i_exit_2.values, 0,
                                                          tp.n - 1)].max()),
                         funding_stamps_crossed=n_bad))
    t = pd.DataFrame(rows)
    return dict(table=t.to_dict("records"),
                **{"pass": int(t.funding_stamps_crossed.sum()) == 0})


def check_fills() -> dict:
    """§4.2 — on every trade that neither gapped its stop nor touched both
    levels inside one ARM bar, the 1m-path fill and the arm-bar-OHLC fill must
    agree exactly; and on the excluded trades the 1m path must never be
    KINDER than the bar convention."""
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    rows = []
    for (sym, tf), g in q.groupby(["symbol", "tf"]):
        tp = E.Tape.get(sym)
        B = tp.bars[int(tf)]
        side = g.side.values.astype(np.int64)
        entry, stop, dist = g.entry.values, g.stop.values, g.stop_dist.values
        tgt = entry + side * dist
        b0 = (g.j.values + 1).astype(np.int64)
        b1 = np.searchsorted(B["i_last"], g.i_flat.values, "right") - 1
        b1 = np.maximum(b1, b0 - 1).astype(np.int64)
        both, gapped = E.path_flags(B["o"], B["h"], B["l"], B["c"], b0, b1, side, stop, tgt)
        xi, xp, xc = E.walk_bar_many(B["o"], B["h"], B["l"], B["c"], b0, b1, side,
                                     entry, stop, tgt)
        bar_gross = side * (xp - entry) / dist
        m0 = (g.i_entry_min.values + 1).astype(np.int64)
        m1 = g.i_flat.values.astype(np.int64)
        both1m, gapped1m = E.path_flags(tp.o, tp.h, tp.l, tp.c, m0, m1, side, stop, tgt)
        agree = (both == 0) & (gapped == 0) & (gapped1m == 0) & (both1m == 0) & (b1 >= b0)
        same_cause = np.array([E.EXIT_NAME[int(c1)] == c2
                               for c1, c2 in zip(xc, g.exit_1.values)])
        d = np.abs(bar_gross - g.grossR_1.values)
        v = agree & ((d > 1e-9) | (~same_cause))
        ex = ~agree & (b1 >= b0)
        kinder = int((g.grossR_1.values[ex] - bar_gross[ex] > 1e-9).sum())
        rows.append(dict(arm=f"{sym}-{tf}m", n=len(g), agreement_n=int(agree.sum()),
                         max_absdiff=float(d[agree].max()) if agree.any() else 0.0,
                         violations=int(v.sum()),
                         both_touch_bar=int(both.sum()), gapped_bar=int(gapped.sum()),
                         gapped_1m=int(gapped1m.sum()), both_touch_1m=int(both1m.sum()),
                         excluded=int(ex.sum()), excluded_1m_kinder=kinder))
    t = pd.DataFrame(rows)
    return dict(table=t.to_dict("records"),
                **{"pass": int(t.violations.sum()) == 0
                   and int(t.excluded_1m_kinder.sum()) == 0})


def check_session() -> dict:
    """§3.4 — no trade crosses its own forced flat, and no trade crosses a UTC
    session boundary (midnight): entry >= 00:30 and exit <= 07:55 the same
    UTC date, on both templates."""
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    bad = []
    for sym, g in q.groupby("symbol"):
        tp = E.Tape.get(sym)
        t_ex = tp.t[np.clip(g.i_exit_1.values, 0, tp.n - 1)]
        t_ex2 = tp.t[np.clip(g.i_exit_2.values, 0, tp.n - 1)]
        lim = np.array([E.flat_ms(d) for d in g.date.values])
        day0 = np.array([C.utc_ms(d, 0, 0) for d in g.date.values])
        t_in = tp.t[g.i_entry_min.values]
        bad.append(dict(symbol=sym, n=len(g),
                        past_flat=int(((t_ex > lim) | (t_ex2 > lim)).sum()),
                        crossed_midnight=int(((t_ex >= day0 + C.DAY_MS)
                                              | (t_ex2 >= day0 + C.DAY_MS)
                                              | (t_in < day0)).sum())))
    t = pd.DataFrame(bad)
    return dict(table=t.to_dict("records"),
                **{"pass": int(t.past_flat.sum()) == 0
                   and int(t.crossed_midnight.sum()) == 0})


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    todo = ["grid", "funding", "fills", "session"] if cmd == "all" else [cmd]
    out = {}
    for c in todo:
        out[c] = dict(grid=check_grid, funding=check_funding,
                      fills=check_fills, session=check_session)[c]()
        print(f"[{c}] pass={out[c]['pass']}")
        print(json.dumps({k: v for k, v in out[c].items() if k != "table"},
                         indent=2, default=str)[:1500])
        if "table" in out[c]:
            print(pd.DataFrame(out[c]["table"]).to_string(index=False))
    with open(os.path.join(C.RESULTS, "checks.json"), "w") as fh:
        json.dump(out, fh, indent=2, default=str)
    if not all(v["pass"] for v in out.values()):
        raise SystemExit("CHECK FAILED — DESIGN.md §12 stop rule. Return to Architect.")


if __name__ == "__main__":
    main()
