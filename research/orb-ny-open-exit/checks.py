#!/usr/bin/env python3
"""The stop-rule checks of `DESIGN.md` §11 (= exit note §9.3). Any failure
stops the pass and returns to the Architect. Nothing is debugged around a
failure and no number computed after one counts.

    python checks.py grid        # 1  clock points on the 5m epoch grid
    python checks.py tradelist   # 2  SAME TRADE LIST: E0 == E1 == E2 == short OR5
    python checks.py fills       # 3  1m-path fill == bar-OHLC fill, E0 and E2
    python checks.py trail       # 4  E1: numba == pure Python; unmoved == E0
    python checks.py datr        # 5  dATR14 look-ahead, 20 sampled E2 trades
    python checks.py session     # 6  no trade crosses 16:00 NY
    python checks.py all

Check 7 (screen before holdout) is not here: it is enforced structurally by
`analysis.py holdout`, which refuses to run without `results/fit_screen.csv`
and computes nothing for a screened-out arm or for the quoted +1R corner.

The look-ahead check of the closed pass stays dropped (no Study B here), but
check 5 is a NEW look-ahead check, on the one input this family added: E2's
dATR14.
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


def _trades():
    return pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))


# ==========================================================================
# 1 — the clock grid
# ==========================================================================
def check_grid() -> dict:
    """Every clock point this family reads must land on the 5-minute epoch
    grid on every session day under both DST offsets, or the NY-anchored bins
    and the UTC-aligned bins are different objects. 09:35 (the range end and
    trigger start) is the new one relative to the closed pass; the S-C ladder's
    11:00 / 12:00 / 14:00 are included because the ladder resamples nothing but
    does cut the walk there."""
    days = C.nyse_days("2024-01-01", "2026-09-11")
    bad = []
    offs = set()
    pts5 = [C.OR_START, C.TRIG_START, C.TRIG_END_BASE, C.FLAT] + \
           [tuple(x) for x in C.S_C_FLATS]
    pts15 = [C.OR_START, C.TRIG_END_BASE, C.FLAT]
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


# ==========================================================================
# 2 — THE SAME TRADE LIST (note §9.3 check 2)
# ==========================================================================
def _short_or5(sym: str) -> pd.DataFrame:
    """The short pass's own `US100-OR5` / `US500-OR5` (date, side, entry)
    triples.

    `research/orb-ny-open-short/results/trades_all.parquet` is gitignored and
    therefore absent from a fresh worktree, so the table is re-derived by
    importing the SHORT PACKAGE'S OWN UNMODIFIED `engine.py` and `common.py`
    out of its own directory and calling its own `build_arm(sym, 5, days)`.
    That is the committed record executing itself; this package's engine is not
    used and the short package is not edited. `results/short_or5_<sym>.csv`
    records what came back.
    """
    import importlib.util

    mods = {}
    for name in ("common", "engine"):
        spec = importlib.util.spec_from_file_location(
            f"short_{name}", os.path.join(C.SHORT, f"{name}.py"))
        m = importlib.util.module_from_spec(spec)
        sys.modules[f"short_{name}"] = m
        mods[name] = m
    # the short package's modules import each other by bare name; give them
    # their own directory ahead of ours for the duration of the load
    sys.path.insert(0, C.SHORT)
    try:
        for name in ("common", "engine"):
            spec = importlib.util.spec_from_file_location(
                name, os.path.join(C.SHORT, f"{name}.py"))
            m = importlib.util.module_from_spec(spec)
            sys.modules[name] = m
            spec.loader.exec_module(m)
            mods[name] = m
        SC, SE = mods["common"], mods["engine"]
        days = SC.nyse_days(SC.FIT_START, SC.TAIL_END)
        g = SE.build_arm(sym, 5, days)
    finally:
        sys.path.remove(C.SHORT)
        for name in ("common", "engine", "short_common", "short_engine"):
            sys.modules.pop(name, None)
        # restore OUR modules under their bare names
        import common as _c, engine as _e  # noqa: F401
        sys.modules["common"] = _c
        sys.modules["engine"] = _e
    out = g[["date", "side", "entry", "stop", "stop_dist"]].sort_values("date") \
        .reset_index(drop=True)
    out.to_csv(os.path.join(C.RESULTS, f"short_or5_{sym}.csv"), index=False)
    return out


def check_tradelist() -> dict:
    """The (date, side, entry) triples of E0, E1 and E2 on an instrument must
    be identical to each other AND to the short pass's `US100-OR5` /
    `US500-OR5` table. **Any difference is a §10 stop rule.**

    The one exception is pre-registered and bounded: E2 has no defined stop on
    a triggered day whose `DayBars.prior()` carries no dATR14 (the Wilder
    ATR(14) warm-up at the very start of the tape). Note §5.3 says such a day
    is "excluded and counted"; `DESIGN.md` §3.6 records the erratum and the
    Architect's ruling. So E2 is compared on the subset of days where it has a
    defined stop, and the excluded set is asserted to be EXACTLY the
    `DayBars.prior() is None` set and nothing else.
    """
    q = _trades()
    rows = []
    hard = 0
    for sym in C.INSTRUMENTS:
        ref = _short_or5(sym)
        refkey = list(zip(ref.date.astype(str), ref.side.astype(int),
                          np.round(ref.entry.values, 10)))
        db = F.DayBars.get(sym)
        expected_ex = sorted(d for d in ref.date.astype(str) if db.prior(d) is None)
        for k in C.CONSTRUCTIONS:
            g = q[q.arm == C.arm_name(sym, k)].sort_values("date")
            key = list(zip(g.date.astype(str), g.side.astype(int),
                           np.round(g.entry.values, 10)))
            if k == "E2":
                missing = sorted(set(ref.date.astype(str)) - set(g.date.astype(str)))
                exp_ok = missing == expected_ex
                sub = [t for t in refkey if t[0] not in set(expected_ex)]
                same = key == sub
                extra = sorted(set(g.date.astype(str)) - set(ref.date.astype(str)))
                ok = bool(same and exp_ok and not extra)
                rows.append(dict(arm=C.arm_name(sym, k), n=len(g), n_short_or5=len(ref),
                                 triples_identical=bool(same),
                                 n_excluded=len(missing),
                                 excluded_are_exactly_datr_warmup=bool(exp_ok),
                                 n_unexpected_extra_days=len(extra),
                                 excluded_days=";".join(missing), **{"pass": ok}))
            else:
                ok = key == refkey
                rows.append(dict(arm=C.arm_name(sym, k), n=len(g), n_short_or5=len(ref),
                                 triples_identical=bool(ok), n_excluded=0,
                                 excluded_are_exactly_datr_warmup=True,
                                 n_unexpected_extra_days=0, excluded_days="",
                                 **{"pass": bool(ok)}))
            hard += 0 if rows[-1]["pass"] else 1
        # E0 vs E1 must be identical in stop and stop_dist as well, not just
        # the triple: they are the SAME stop by construction.
        a = q[q.arm == C.arm_name(sym, "E0")].sort_values("date")
        b = q[q.arm == C.arm_name(sym, "E1")].sort_values("date")
        same_stop = bool(len(a) == len(b) and np.allclose(a.stop.values, b.stop.values)
                         and np.allclose(a.stop_dist.values, b.stop_dist.values))
        rows.append(dict(arm=f"{sym}-E0 vs E1 (stop identity)", n=len(a), n_short_or5=len(ref),
                         triples_identical=same_stop, n_excluded=0,
                         excluded_are_exactly_datr_warmup=True,
                         n_unexpected_extra_days=0, excluded_days="",
                         **{"pass": same_stop}))
        hard += 0 if same_stop else 1
    t = pd.DataFrame(rows)
    return dict(table=t.to_dict("records"), **{"pass": hard == 0})


# ==========================================================================
# 3 — fills, the FIXED-STOP arms (E0, E2)
# ==========================================================================
def check_fills() -> dict:
    """On every trade that neither gapped its stop nor touched both levels
    inside one ARM bar, the 1m-path fill and the arm-bar-OHLC fill must agree
    exactly. Verbatim from the short pass, with its §12 narrowed exclusion
    clause. E1 is excluded here and checked by `check_trail` instead: a
    ratcheting stop has no bar-OHLC analogue.

    With no target the "touched both levels" case cannot arise (there is only
    one level), so the agreement set is every non-gapping trade — a stricter
    test than the short pass's, not a looser one.
    """
    q = _trades()
    rows = []
    for arm in [C.arm_name(s, k) for s in C.INSTRUMENTS for k in ("E0", "E2")]:
        sym, k = C.parse_arm(arm)
        g = q[q.arm == arm]
        tp = E.Tape.get(sym)
        B = tp.bars[C.TF]
        side = g.side.values.astype(np.int64)
        entry, stop, dist = g.entry.values, g.stop.values, g.stop_dist.values
        tgt = np.where(side > 0, np.inf, -np.inf)
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
        same_cause = np.array([EN(c1) == c2 for c1, c2 in zip(xc, g.exit.values)])
        d = np.abs(bar_gross - g.grossR.values)
        v = agree & ((d > 1e-9) | (~same_cause))
        ex = ~agree & (b1 >= b0)
        unresolvable = ex & (both1m == 1)
        kinder = int((g.grossR.values[unresolvable] - bar_gross[unresolvable] > 1e-9).sum())
        kinder_resolved = int((g.grossR.values[ex] - bar_gross[ex] > 1e-9).sum()) - kinder
        rows.append(dict(arm=arm, n=len(g), agreement_n=int(agree.sum()),
                         max_absdiff=float(d[agree].max()) if agree.any() else 0.0,
                         violations=int(v.sum()),
                         both_touch_bar=int(both.sum()), gapped_bar=int(gapped.sum()),
                         gapped_1m=int(gapped1m.sum()), both_touch_1m=int(both1m.sum()),
                         excluded=int(ex.sum()), excluded_1m_kinder=kinder,
                         excluded_1m_kinder_resolved_on_1m=kinder_resolved))
    t = pd.DataFrame(rows)
    return dict(table=t.to_dict("records"),
                **{"pass": int(t.violations.sum()) == 0
                   and int(t.excluded_1m_kinder.sum()) == 0})


def EN(x):
    return E.EXIT_NAME[int(x)]


# ==========================================================================
# 4 — fills, E1 (note §9.3 check 4)
# ==========================================================================
def check_trail() -> dict:
    """(a) `walk1m_trail` (numba) and `walk1m_trail_ref` (pure Python) agree
    EXACTLY — exit index, exit price, cause, stop at exit, best price — on
    every E1 trade of every period.

    (b) On every trade where `stop_at_exit == stop_0`, E1's exit minute, price
    and cause equal E0's exactly. This is the structural identity of note
    §5.3: the first live minute is tested against `stop_0` and the stop only
    ever tightens, so an unmoved ratchet IS E0.

    (c) NOT asserted, and printed instead in both directions: the share of
    trades where E1 beat E0 and where it did not. A ratchet can legitimately
    exit a trade that E0 would have held to a better close, so an E1 < E0
    trade is a finding, not a bug (note §9.3 check 4(c)).
    """
    q = _trades()
    rows = []
    for sym in C.INSTRUMENTS:
        g = q[q.arm == C.arm_name(sym, "E1")].sort_values("date").reset_index(drop=True)
        e0 = q[q.arm == C.arm_name(sym, "E0")].sort_values("date").reset_index(drop=True)
        tp = E.Tape.get(sym)
        # --- (a) dual implementation ------------------------------------
        bad_ref = []
        for r in g.itertuples():
            a = E.walk1m_trail(tp.o, tp.h, tp.l, tp.c, int(r.i_entry_min) + 1,
                               int(r.i_flat), int(r.side), float(r.entry),
                               float(r.stop), float(r.stop_dist), C.TRAIL_R)
            b = E.walk1m_trail_ref(tp.o, tp.h, tp.l, tp.c, int(r.i_entry_min) + 1,
                                   int(r.i_flat), int(r.side), float(r.entry),
                                   float(r.stop), float(r.stop_dist), C.TRAIL_R)
            if not (int(a[0]) == int(b[0]) and a[1] == b[1] and int(a[2]) == int(b[2])
                    and a[3] == b[3] and a[4] == b[4]):
                bad_ref.append(dict(date=r.date, numba=list(a), pure=list(b)))
            # and the numba walker must agree with what is IN the table
            if not (int(a[0]) == int(r.i_exit) and a[1] == float(r.exit_px)
                    and EN(a[2]) == r.exit and a[3] == float(r.stop_at_exit)):
                bad_ref.append(dict(date=r.date, numba=list(a), table="mismatch"))
        # --- (b) unmoved ratchet == E0 ----------------------------------
        m = g.merge(e0[["date", "i_exit", "exit_px", "exit", "netR", "grossR"]],
                    on="date", suffixes=("", "_e0"))
        unmoved = np.isclose(m.stop_at_exit.values, m.stop.values)
        u = m[unmoved]
        bad_id = u[(u.i_exit.values != u.i_exit_e0.values)
                   | (u.exit_px.values != u.exit_px_e0.values)
                   | (u.exit.values != u.exit_e0.values)]
        # and no unmoved trade may be labelled 'trail-stop'
        bad_cause = u[u.exit.values == "trail-stop"]
        # --- (c) direction of the difference, PRINTED, never asserted ----
        diff = m.netR.values - m.netR_e0.values
        rows.append(dict(
            arm=C.arm_name(sym, "E1"), n=len(g),
            ref_disagreements=len(bad_ref),
            n_ratchet_unmoved=int(unmoved.sum()),
            n_ratchet_moved=int((~unmoved).sum()),
            unmoved_not_equal_E0=len(bad_id),
            unmoved_labelled_trail=len(bad_cause),
            pct_E1_beat_E0=float(100 * (diff > 1e-12).mean()),
            pct_E1_worse_than_E0=float(100 * (diff < -1e-12).mean()),
            pct_E1_equal_E0=float(100 * (np.abs(diff) <= 1e-12).mean()),
            mean_E1_minus_E0_R=float(diff.mean()),
            exit_causes=json.dumps({k: int(v) for k, v in g.exit.value_counts().items()}),
            examples=json.dumps(bad_ref[:3], default=str),
            **{"pass": len(bad_ref) == 0 and len(bad_id) == 0 and len(bad_cause) == 0}))
    t = pd.DataFrame(rows)
    return dict(table=t.drop(columns=["examples"]).to_dict("records"),
                examples=[r for r in t.examples if r != "[]"],
                **{"pass": bool(t["pass"].all())})


# ==========================================================================
# 5 — the dATR14 look-ahead check (note §9.3 check 5)
# ==========================================================================
def check_datr() -> dict:
    """On 20 sampled E2 trades across fit AND holdout, `dATR14` recomputed
    from a 1-minute tape **truncated at 09:30 NY of the trade day** must equal
    the value the trade used, exactly.

    A truncated tape cannot see a single minute of the trade day's session, so
    an exact match is proof the stop was knowable before the open.
    """
    q = _trades()
    rng = np.random.default_rng(C.SEED)
    rows = []
    for sym in C.INSTRUMENTS:
        g = q[(q.arm == C.arm_name(sym, "E2")) & (q.period.isin(["fit", "holdout"]))]
        take = []
        for per in ("fit", "holdout"):
            gg = g[g.period == per]
            take += list(rng.choice(gg.index.values, size=10, replace=False))
        tp = E.Tape.get(sym)
        for i in take:
            r = q.loc[i]
            cut = C.ny_ms(r.date, *C.OR_START)
            n = int(np.searchsorted(tp.t, cut, "left"))
            rec = _datr_from_truncated(tp, n, r.date)
            used = float(r.datr14)
            rows.append(dict(symbol=sym, period=r.period, date=r.date,
                             datr14_used=used, datr14_recomputed=rec,
                             absdiff=abs(rec - used) if np.isfinite(rec) else np.inf,
                             minutes_of_trade_day_visible=int(
                                 (tp.t[:n] >= C.ny_ms(r.date, 0, 0)).sum()),
                             stop_dist_used=float(r.stop_dist),
                             stop_dist_recomputed=C.DATR_FRAC * rec,
                             **{"pass": bool(np.isfinite(rec) and rec == used)}))
    t = pd.DataFrame(rows)
    return dict(table=t.to_dict("records"), n_sampled=len(t),
                max_absdiff=float(t.absdiff.max()),
                **{"pass": bool(t["pass"].all())})


def _datr_from_truncated(tp, n: int, date: str) -> float:
    """`features.DayBars.prior(date)['datr14']`, recomputed from scratch on
    `tp`'s first `n` minutes only — i.e. everything strictly before 09:30 NY
    of `date`. Independent of the `DayBars` cache."""
    t = tp.t[:n]
    o, h, l, c = tp.o[:n], tp.h[:n], tp.l[:n], tp.c[:n]
    d0 = pd.Timestamp(t[0], unit="ms", tz="UTC").tz_convert(C.SESSION_TZ)
    d1 = pd.Timestamp(t[-1], unit="ms", tz="UTC").tz_convert(C.SESSION_TZ)
    days = pd.date_range(d0.normalize(), d1.normalize(), freq="D").strftime("%Y-%m-%d")
    edges = np.array([C.ny_ms(x, 16, 0) for x in days], dtype=np.int64)
    idx = np.searchsorted(t, edges, "left")
    rows = []
    for i in range(1, len(days)):
        a, b = idx[i - 1], idx[i]
        if b <= a:
            continue
        rows.append((days[i], float(h[a:b].max()), float(l[a:b].min()), float(c[b - 1])))
    if not rows:
        return np.nan
    df = pd.DataFrame(rows, columns=["date", "high", "low", "close"])
    atr = F.atr_wilder(df.high.values, df.low.values, df.close.values, 14)
    i = int(np.searchsorted(df.date.values, date, "left")) - 1
    if i < 1 or not np.isfinite(atr[i]):
        return np.nan
    return float(atr[i])


# ==========================================================================
# 6 — the session bound
# ==========================================================================
def check_session() -> dict:
    """No trade crosses 16:00 NY, on any of the six arms."""
    q = _trades()
    bad = []
    for arm in C.ARMS:
        sym, k = C.parse_arm(arm)
        g = q[q.arm == arm]
        tp = E.Tape.get(sym)
        t_ex = tp.t[np.clip(g.i_exit.values, 0, tp.n - 1)]
        lim = np.array([C.ny_ms(d, *C.FLAT) for d in g.date.values])
        bad.append(dict(arm=arm, n=len(g), crossings=int((t_ex >= lim).sum()),
                        max_exit_ny=C.fmt(t_ex.max()) if len(g) else ""))
    t = pd.DataFrame(bad)
    return dict(table=t.to_dict("records"), **{"pass": int(t.crossings.sum()) == 0})


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    order = ["grid", "tradelist", "fills", "trail", "datr", "session"]
    todo = order if cmd == "all" else [cmd]
    fns = dict(grid=check_grid, tradelist=check_tradelist, fills=check_fills,
               trail=check_trail, datr=check_datr, session=check_session)
    out = {}
    for c in todo:
        out[c] = fns[c]()
        print(f"\n[{c}] pass={out[c]['pass']}")
        print(json.dumps({k: v for k, v in out[c].items() if k != "table"},
                         indent=2, default=str)[:2000])
        if "table" in out[c]:
            print(pd.DataFrame(out[c]["table"]).to_string(index=False))
    with open(os.path.join(C.RESULTS, "checks.json"), "w") as fh:
        json.dump(out, fh, indent=2, default=str)
    if not all(v["pass"] for v in out.values()):
        raise SystemExit("CHECK FAILED — DESIGN.md §11 stop rule. Return to Architect.")


if __name__ == "__main__":
    main()
