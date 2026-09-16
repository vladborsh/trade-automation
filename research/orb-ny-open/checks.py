#!/usr/bin/env python3
"""The stop-rule checks of `DESIGN.md` §11. Any failure stops the pass and
returns to the Architect.

    python checks.py grid        # §2.3  NY-anchored bins == UTC epoch grid
    python checks.py lookahead   # §7.1  features from a truncated tape
    python checks.py fills       # §3.5  1m-path fill == bar-OHLC fill
    python checks.py session     # §3.4  no trade crosses 16:00 NY
    python checks.py all
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
import features as F  # noqa: E402

LOG = {}


def check_grid() -> dict:
    """09:30 NY must land on the 5- and 15-minute epoch grid on every session
    day in span, under both DST offsets — otherwise the NY-anchored bins and
    the UTC-aligned bins are different objects (§2.3)."""
    days = C.nyse_days("2022-08-01", "2026-09-11")
    bad = []
    offs = set()
    for d in days:
        for hh, mm in (C.OR_START, C.OR_END, C.TRIG_START, C.TRIG_END_BASE,
                       C.TRIG_END_WIDE, C.FLAT):
            t = C.ny_ms(d, hh, mm)
            if t % (5 * C.MIN_MS) or t % (15 * C.MIN_MS):
                bad.append((d, hh, mm, t))
        offs.add(int((C.ny_ms(d, 9, 30) - int(pd.Timestamp(d).value // 10 ** 6)) / 3_600_000))
    r = dict(days=len(days), violations=len(bad),
             utc_offsets_of_0930_seen_h=sorted(offs), examples=bad[:5])
    r["pass"] = len(bad) == 0
    return r


def check_lookahead(n_sample=50, seed=C.SEED) -> dict:
    """§7.1 — recompute every feature for 50 random trades from a tape
    TRUNCATED at the entry bar and assert equality with the full-tape value.

    The truncation is done at the source: a `Tape` built from the 1m frame cut
    at the trade's entry minute, resampled and re-indicatored from scratch.
    """
    rng = np.random.default_rng(seed)
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    q = q[q.period.isin(["fit"])].reset_index(drop=True)
    # sample across all eight arms, not by luck of the draw
    pick = []
    per = max(1, -(-n_sample // q.arm.nunique()))   # ceil: at least n_sample overall
    for _, g in q.groupby("arm"):
        pick += list(rng.choice(g.index.values, size=min(per, len(g)), replace=False))
    worst = 0.0
    bad = []
    checked = 0
    cmp_cells = 0
    nan_cells = 0
    for i in pick:
        r = q.iloc[int(i)]
        full = {n: r[n] for n in F.FEATURES}
        trunc = _features_truncated(q, r)
        if trunc is None:
            bad.append(dict(arm=r["arm"], date=r["date"], feature="<harness>",
                            full=float("nan"), truncated=float("nan")))
            continue
        checked += 1
        for n in F.FEATURES:
            a, b = full[n], trunc[n]
            na, nb = pd.isna(a), pd.isna(b)
            if na and nb:
                nan_cells += 1
                continue
            cmp_cells += 1
            # a NaN on exactly one side is a VIOLATION, not a skip.
            if na != nb:
                bad.append(dict(arm=r["arm"], date=r["date"], feature=n,
                                full=float(a) if not na else None,
                                truncated=float(b) if not nb else None))
                continue
            d = abs(float(a) - float(b)) / max(1.0, abs(float(a)))
            worst = max(worst, d)
            if d > 1e-9:
                bad.append(dict(arm=r["arm"], date=r["date"], feature=n,
                                full=float(a), truncated=float(b)))
    return dict(n_checked=checked, n_cells_compared=cmp_cells,
                n_cells_nan_both=nan_cells, max_rel_diff=worst,
                n_violations=len(bad), examples=bad[:10],
                **{"pass": len(bad) == 0 and checked >= 40 and cmp_cells > 0})


def _features_truncated(q_all: pd.DataFrame, r) -> dict | None:
    """Rebuild the trade's features from a 1m tape cut at its entry minute.

    The arm's EARLIER trades are passed in alongside it so that the `or_rvol`
    and `bar_rvol` rolling histories (DESIGN §7.2) are reproduced exactly; they
    read only prior sessions, so including them tests the same thing the full
    build does. Nothing after the entry minute exists on this tape at all.
    """
    sym, tf = r["symbol"], int(r["tf"])
    src = E.Tape.get(sym)
    cut = int(r["i_entry_min"])
    df = src.df.iloc[: cut + 1].reset_index(drop=True)

    class T:                                   # a minimal stand-in Tape
        pass
    tp = T()
    tp.symbol, tp.venue = sym, src.venue
    tp.df = df
    for k in ("t_ms", "open", "high", "low", "close", "volume"):
        setattr(tp, {"t_ms": "t"}.get(k, k[0] if k != "volume" else "v"),
                df[k].values.astype(np.float64 if k != "t_ms" else np.int64))
    tp.spread = df.spread_close.values.astype(np.float64) if "spread_close" in df else None
    tp.n = len(df)
    tp.bars = {}
    b = C.resample(df, tf)
    tp.bars[tf] = dict(t=b.t_ms.values.astype(np.int64), o=b.open.values.astype(float),
                       h=b.high.values.astype(float), l=b.low.values.astype(float),
                       c=b.close.values.astype(float), v=b.volume.values.astype(float),
                       i_last=b.i_last.values.astype(np.int64),
                       i_first=b.i_first.values.astype(np.int64), n=len(b))
    # the entry bar must be the LAST bar of the truncated sequence
    if tp.bars[tf]["t"][-1] != r["t_sig"]:
        return None
    key = (sym, tf)
    save_i, save_t, save_d = F.Ind._cache.pop(key, None), E.Tape._cache.pop(sym), \
        F.DayBars._cache.pop(sym, None)
    try:
        E.Tape._cache[sym] = tp
        F.Ind._cache.pop(key, None)
        F.DayBars._cache.pop(sym, None)
        cols = ["date", "symbol", "tf", "j", "side", "t_sig", "entry", "stop",
                "stop_dist", "i_entry_min", "i_flat", "or_high", "or_low",
                "i_or0", "i_or1", "or_vol", "or_open", "or_close"]
        prior = q_all[(q_all["arm"] == r["arm"]) &
                      (q_all["i_entry_min"] <= cut)].sort_values("i_entry_min")
        row = prior[cols].reset_index(drop=True)
        # the trade under test is the last row, and its trigger bar is by
        # construction the last bar of the truncated sequence
        row.loc[row.index[-1], "j"] = len(tp.bars[tf]["t"]) - 1
        out = F.build(row.copy())
        return {n: out.iloc[-1][n] for n in F.FEATURES}
    finally:
        E.Tape._cache[sym] = save_t
        F.Ind._cache.pop(key, None)
        F.DayBars._cache.pop(sym, None)
        if save_i is not None:
            F.Ind._cache[key] = save_i
        if save_d is not None:
            F.DayBars._cache[sym] = save_d


def check_fills() -> dict:
    """§3.5 — on every trade that neither gapped its stop nor touched both
    levels inside one ARM bar, the 1m-path fill and the arm-bar-OHLC fill must
    agree exactly."""
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    rows = []
    for (sym, tf), g in q.groupby(["symbol", "tf"]):
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
    todo = ["grid", "lookahead", "fills", "session"] if cmd == "all" else [cmd]
    out = {}
    for c in todo:
        out[c] = dict(grid=check_grid, lookahead=check_lookahead,
                      fills=check_fills, session=check_session)[c]()
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
