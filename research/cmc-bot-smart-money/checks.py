#!/usr/bin/env python3
"""Stage-0 machine checks — the correctness surface behind `PARITY.md`.

House pattern: `research/session-liquidity-bos/checks.py` and
`research/session-liquidity-v5-ny/checks.py`. Every check either PASSes or
fails loudly; none of them is allowed to be "mostly right".

    python checks.py            # all of them
    python checks.py C4         # one

C1  literal transcription — engine._scan vs reference.indicator_script, the
    slow line-by-line port of the TypeScript, on sampled windows
C2  ATR(20) — engine's hoisted rolling mean vs the literal transcription
C3  session window — every evaluated bar is inside 09:40-11:10 New York,
    Mon-Fri, and every in-window bar is evaluated
C4  **prefix causality, M1 path** (PARITY gate 2): re-derive >= 200 sampled
    signals from a tape truncated at the signal bar; 0 lookahead required
C5  prefix causality, whole pipeline with a CAUSAL H1 frame — measures the
    bot's own H1 lookahead (D-06). Reported, not asserted to be zero.
C6  stop / target arithmetic, brute-force re-derivation
C7  the {0.5, 0.7, 1.0} shrink table is exercised in all three branches
C8  D-01 — a signal is impossible unless BOTH iFVG lists are non-empty
C9  D-02 — direction defaults reproduce the sell-lean
C10 the sell and buy branches are mutually exclusive
C11 trade stream — at most one open order per direction, ever
C12 no position survives 11:10 New York
C13 the recorded TypeScript parity fixtures still reproduce
"""
from __future__ import annotations

import glob
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from common import (ATR_LEN, BUY, MAX_IFVG_TO_ATR_RATIO, RESULTS, SELL,  # noqa: E402
                    SESSION_TZ, SYMBOLS, TARGET_RR, WINDOW_MS, load_1m,
                    nyam_open_bar, resample_1h)
import engine  # noqa: E402
import reference  # noqa: E402

RESULT: list[tuple[str, bool, str]] = []
RNG = np.random.default_rng(20260912)


def check(name):
    def deco(fn):
        fn._check = name
        return fn
    return deco


def report(name, ok, msg=""):
    RESULT.append((name, ok, msg))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {msg}", flush=True)


# ---------------------------------------------------------------------------
@check("C1")
def c1_literal_transcription():
    """`engine._scan` vs the slow line-by-line transcription of the TS."""
    bad = []
    n_win = 0
    for sym in ("BTCUSDT", "SOLUSDT"):
        P = engine.prepare(sym)
        sig = engine.signals(P)
        rows = sig.sample(40, random_state=11)
        m1 = load_1m(sym)
        o, h, l, c = P["o"], P["h"], P["l"], P["c"]
        ny = nyam_open_bar(pd.DatetimeIndex(m1.ts))
        for r in rows.itertuples():
            g = int(r.i)
            s = int(np.searchsorted(P["ms"], P["ms"][g] - WINDOW_MS, "left"))
            ref = reference.indicator_script(o[s:g + 1], h[s:g + 1], l[s:g + 1],
                                             c[s:g + 1], ny[s:g + 1])
            n_win += 1
            for key, mine in (("priceInDiscount", bool(r.in_disc)),
                              ("rangeHigh", float(r.range_high)),
                              ("rangeLow", float(r.range_low)),
                              ("bullishIfvgOccurs", bool(r.bull_occ)),
                              ("bearishIfvgOccurs", bool(r.bear_occ)),
                              ("aboveNYamTrueOpen", bool(r.above_nyam))):
                want = ref[key]
                ok = (want == mine) if isinstance(want, bool) else np.isclose(want, mine)
                if not ok:
                    bad.append(f"{sym} {r.ts} {key}: ref={want} eng={mine}")
            want_sz = (abs(ref["lastIFVG"]["low"] - ref["lastIFVG"]["high"])
                       if ref["lastIFVG"] else np.nan)
            got_sz = float(r.ifvg_size)
            if not ((np.isnan(want_sz) and np.isnan(got_sz)) or np.isclose(want_sz, got_sz)):
                bad.append(f"{sym} {r.ts} lastIFVG size: ref={want_sz} eng={got_sz}")
    report("C1 literal transcription of indicatorScript", not bad,
           f"{n_win} windows, {len(bad)} mismatches" + ("; " + bad[0] if bad else ""))


@check("C2")
def c2_atr():
    bad = []
    P = engine.prepare("ETHUSDT")
    sig = engine.signals(P)
    for r in sig.sample(30, random_state=12).itertuples():
        g = int(r.i)
        s = int(np.searchsorted(P["ms"], P["ms"][g] - WINDOW_MS, "left"))
        ref = reference.atr(P["o"][s:g + 1], P["h"][s:g + 1], P["l"][s:g + 1],
                            P["c"][s:g + 1], ATR_LEN)[-1]
        if not np.isclose(ref, float(r.atr20)):
            bad.append(f"{r.ts}: ref={ref} eng={r.atr20}")
    report("C2 ATR(20) matches the literal transcription", not bad, f"{len(bad)} mismatches")


@check("C3")
def c3_session():
    P = engine.prepare("BTCUSDT")
    sig = engine.signals(P)
    loc = pd.DatetimeIndex(sig.ts).tz_convert(SESSION_TZ)
    mins = loc.hour * 60 + loc.minute
    ok_win = bool(((mins >= 9 * 60 + 40) & (mins <= 11 * 60 + 10)).all())
    ok_dow = bool((loc.dayofweek <= 4).all())
    # and the count is exactly 91 bars on a full weekday
    per_day = sig.groupby(pd.DatetimeIndex(sig.ts).date).size()
    ok_n = bool((per_day == 91).all())
    report("C3 every evaluated bar is 09:40-11:10 New York, Mon-Fri, 91 bars/day",
           ok_win and ok_dow and ok_n,
           f"{len(sig):,} bars, {per_day.min()}..{per_day.max()} per day")


def _prefix_rows(sym, n):
    P = engine.prepare(sym)
    sig = engine.signals(P)
    hits = sig[sig.signal]
    take = min(n, len(hits))
    return P, sig, hits.sample(take, random_state=7), load_1m(sym)


FIELDS = ["bull_occ", "bear_occ", "above_nyam", "in_disc", "bias",
          "has_ifvg", "atr_ok", "range_high", "range_low", "signal",
          "direction", "stop", "target"]


def _cmp(a, b):
    out = []
    for f in FIELDS:
        x, y = getattr(a, f), getattr(b, f)
        if isinstance(x, (bool, np.bool_, np.integer, int)):
            ok = x == y
        else:
            ok = (np.isnan(x) and np.isnan(y)) or np.isclose(x, y, rtol=1e-12)
        if not ok:
            out.append(f"{f}: full={x} prefix={y}")
    return out


def _prefix_run(sym, n, causal_h1: bool):
    P, sig, rows, m1 = _prefix_rows(sym, n)
    h1_full = resample_1h(m1)
    diffs, n_ok = [], 0
    for r in rows.itertuples():
        g = int(r.i)
        t = P["ms"][g]
        a = int(np.searchsorted(P["ms"], t - 810 * 3600 * 1000, "left"))
        m1p = m1.iloc[a:g + 1]
        h1 = None if causal_h1 else h1_full[pd.DatetimeIndex(h1_full.ts).asi8 // 10**6 <= t]
        Pp = engine.prepare(sym, m1p, h1)
        sp = engine.signals(Pp, t, t)
        if len(sp) != 1:
            diffs.append(f"{r.ts}: prefix produced {len(sp)} rows")
            continue
        d = _cmp(r, sp.iloc[0])
        n_ok += not d
        if d:
            diffs.append(f"{r.ts}: " + "; ".join(d))
    return len(rows), n_ok, diffs


@check("C4")
def c4_prefix_causality_m1():
    """PARITY gate 2. The M1 path must be free of lookahead."""
    tot = ok = 0
    diffs = []
    for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"):
        t, k, d = _prefix_run(sym, 60, causal_h1=False)
        tot += t; ok += k; diffs += d
    report("C4 prefix-causality, M1 path (>=200 sampled signals, 0 lookahead)",
           not diffs and tot >= 200,
           f"{ok}/{tot} re-derived identically from a truncated tape"
           + ("; " + diffs[0] if diffs else ""))


@check("C5")
def c5_prefix_causality_causal_h1():
    """Not a pass/fail gate: it MEASURES D-06, the bot's own H1 lookahead."""
    tot = ok = 0
    diffs = []
    for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"):
        t, k, d = _prefix_run(sym, 60, causal_h1=True)
        tot += t; ok += k; diffs += d
    with open(os.path.join(RESULTS, "C5_h1_lookahead.txt"), "w") as fh:
        fh.write(f"{ok}/{tot} signals survive a fully causal H1 frame\n")
        fh.write("\n".join(diffs))
    report("C5 D-06 measured: signals surviving a CAUSAL (partial-last-hour) H1 frame",
           True, f"{ok}/{tot} unchanged, {tot - ok} changed -> see results/C5_h1_lookahead.txt")


@check("C6")
def c6_stop_target():
    sig = pd.read_parquet(os.path.join(RESULTS, "signals.parquet"))
    s = sig[sig.signal]
    entry = s["close"].to_numpy()
    anchor = np.where(s.direction == BUY, s.range_low, s.range_high)
    raw = np.abs(anchor - entry)
    ratio = np.abs(s.range_low.to_numpy() - s.range_high.to_numpy()) / raw
    mult = np.where(ratio < 2.5, 0.5, np.where(ratio < 3.0, 0.7, 1.0))
    want_stop = np.where(s.direction == BUY, entry - raw * mult, entry + raw * mult)
    risk = np.abs(want_stop - entry)
    want_tgt = np.where(s.direction == BUY, entry + TARGET_RR * risk, entry - TARGET_RR * risk)
    ok = (np.allclose(want_stop, s.stop) and np.allclose(want_tgt, s.target)
          and bool((risk > 0).all()))
    # the target really is 2.7R from entry, measured against the ADJUSTED stop
    rr = np.abs(s.target.to_numpy() - entry) / risk
    report("C6 stop/target arithmetic re-derived from scratch", ok and np.allclose(rr, TARGET_RR),
           f"{len(s):,} signals, R:R = {rr.min():.6f}..{rr.max():.6f}")


@check("C7")
def c7_shrink_table():
    sig = pd.read_parquet(os.path.join(RESULTS, "signals.parquet"))
    s = sig[sig.signal]
    entry = s["close"].to_numpy()
    anchor = np.where(s.direction == BUY, s.range_low, s.range_high)
    raw = np.abs(anchor - entry)
    ratio = np.abs(s.range_low.to_numpy() - s.range_high.to_numpy()) / raw
    mult = np.abs(s.stop.to_numpy() - entry) / raw
    hit = {m: int((np.isclose(mult, m)).sum()) for m in (0.5, 0.7, 1.0)}
    ok = all(v > 0 for v in hit.values()) and np.isclose(
        mult, np.where(ratio < 2.5, 0.5, np.where(ratio < 3.0, 0.7, 1.0))).all()
    report("C7 the {0.5, 0.7, 1.0} shrink table fires in all three branches", ok, str(hit))


@check("C8")
def c8_both_lists_required():
    sig = pd.read_parquet(os.path.join(RESULTS, "signals.parquet"))
    ok = bool((~sig.has_ifvg | sig.has_ifvg).all()) and bool(sig.loc[~sig.has_ifvg, "signal"].sum() == 0)
    blocked = int((~sig.has_ifvg).sum())
    report("C8 D-01: no signal is possible while either iFVG list is empty", ok,
           f"{blocked:,}/{len(sig):,} in-window bars blocked by the undefined lastIFVG")


@check("C9")
def c9_sell_default():
    sig = pd.read_parquet(os.path.join(RESULTS, "signals.parquet"))
    share = float((sig.bias == SELL).mean())
    ok = share > 0.5     # D-02 predicts a structural sell lean
    report("C9 D-02: the H1 bias default is sell-leaning", ok,
           f"{share:.1%} of in-window bars carry a sell bias")


@check("C10")
def c10_branches_exclusive():
    sig = pd.read_parquet(os.path.join(RESULTS, "signals.parquet"))
    ok = bool((~(sig.sell_signal & sig.buy_signal)).all())
    s = sig[sig.direction == SELL]
    b = sig[sig.direction == BUY]
    ok &= bool(s.above_nyam.all() and (~s.in_disc).all() and (s.bias == SELL).all()
               and s.bear_occ.all() and s.atr_ok.all())
    ok &= bool((~b.above_nyam).all() and b.in_disc.all() and (b.bias == BUY).all()
               and b.bull_occ.all() and b.atr_ok.all())
    report("C10 the two entry branches are mutually exclusive and fully gated", ok,
           f"{len(s):,} sell / {len(b):,} buy")


@check("C11")
def c11_concurrency():
    tr = pd.read_parquet(os.path.join(RESULTS, "trades_primary.parquet"))
    bad = []
    for (sym, d), grp in tr.groupby(["symbol", "dir"]):
        g = grp.sort_values("entry_ts")
        overlap = (g.entry_ts.to_numpy()[1:] < g.exit_ts.to_numpy()[:-1])
        if overlap.any():
            bad.append(f"{sym}/{d}: {int(overlap.sum())} overlapping")
    report("C11 at most one open order per direction at any time", not bad, "; ".join(bad))


@check("C12")
def c12_forced_flat():
    tr = pd.read_parquet(os.path.join(RESULTS, "trades_primary.parquet"))
    ex = pd.to_datetime(tr.exit_ts, unit="ms", utc=True).dt.tz_convert(SESSION_TZ)
    mins = ex.dt.hour * 60 + ex.dt.minute
    ok = bool((mins <= 11 * 60 + 10).all())
    hold = (tr.exit_ts - tr.signal_ts) / 60000
    report("C12 no position survives 11:10 New York", ok,
           f"max hold {hold.max():.0f} min, latest exit {mins.max()} min past midnight NY")


@check("C13")
def c13_fixtures():
    fx = sorted(glob.glob(os.path.join(RESULTS, "parity_*.txt")))
    bad = [os.path.basename(f) for f in fx if "0 discrepancies" not in open(f).read()]
    report("C13 every recorded TypeScript parity fixture reproduces", fx and not bad,
           f"{len(fx)} fixtures, {len(bad)} failing " + (str(bad) if bad else ""))


def main():
    want = sys.argv[1:] if len(sys.argv) > 1 else None
    fns = [v for v in globals().values() if callable(v) and hasattr(v, "_check")]
    fns.sort(key=lambda f: int(f._check[1:]))
    for fn in fns:
        if want and fn._check not in want:
            continue
        fn()
    n_ok = sum(1 for _, ok, _ in RESULT if ok)
    print(f"\n{n_ok}/{len(RESULT)} PASS")
    with open(os.path.join(RESULTS, "CHECKS.md"), "w") as fh:
        fh.write("# Stage-0 checks\n\n| check | result | detail |\n|---|---|---|\n")
        for name, ok, msg in RESULT:
            fh.write(f"| {name} | {'PASS' if ok else 'FAIL'} | {msg} |\n")
        fh.write(f"\n**{n_ok}/{len(RESULT)} PASS**\n")
    sys.exit(0 if n_ok == len(RESULT) else 1)


if __name__ == "__main__":
    main()
