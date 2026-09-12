#!/usr/bin/env python3
"""Stage-0 machine checks. Writes results/CHECKS.md and results/checks.log.

C1  prefix-causality: for sampled signals (and sampled non-signal evaluated
    bars) the tape is TRUNCATED at the signal bar — every later bar deleted —
    and the bot's whole day is re-run from UTC midnight on the prefix. Every
    component (VWAP + bands, bias, 200-bar range, iFVG state, ATR, prior-hour
    high/low and both sweep flags, gates, the signal and its stop/target) must
    be identical. Pass = 0 differences.
C2  invariants on the full as-deployed run: no order outside the entry window;
    every order closed; no order alive after its day's alive window; no order
    open across a UTC midnight (which is what makes monthly TS chunking exact);
    entry time = signal bar + one bar.
C3  full-period TypeScript parity summary (reads results/parity_<SYM>.csv):
    every month present, 0 problems, tape fingerprints matched.
C4  D-03 unit check against the bot's own calculateFVG (results/D03_unit_last_ifvg.txt).
C5  D-01 size: how different is the stream the bot's OWN backtest would produce
    on `npm run scrap` files (candle times = broker-local snapshotTime parsed as
    UTC) from the UTC-timed stream? Counts only.

    python checks.py [SYMBOLS...]
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import DAY_MS, MIN_MS, RESULTS, SYMBOLS, TIMINGS, fmt, load_1m, ms, ny_window_utc_ms  # noqa: E402
import engine  # noqa: E402

RNG = np.random.default_rng(20260912)
N_SIG, N_BAR = 100, 50
CMP = [c for c in engine.COMP if c not in ("err",)] + ["bias", "signal", "ratio", "ifvg_ok", "above", "below",
                                                        "caps_ok", "stop", "target", "allowed", "placed"]


def same(a, b) -> bool:
    if isinstance(a, float) and isinstance(b, float) and np.isnan(a) and np.isnan(b):
        return True
    if a is None or b is None or (isinstance(a, float) and np.isnan(a)) or (isinstance(b, float) and np.isnan(b)):
        return (a is None or (isinstance(a, float) and np.isnan(a))) and (b is None or (isinstance(b, float) and np.isnan(b)))
    return a == b


def c1_prefix(sym, P, ev, trades, log):
    sig_T = trades.signal_ts.values
    pick = RNG.choice(sig_T, size=min(N_SIG, len(sig_T)), replace=False) if len(sig_T) else np.array([], np.int64)
    non = ev[(ev.n > 0) & (~ev["T"].isin(sig_T))]["T"].values
    pick_b = RNG.choice(non, size=min(N_BAR, len(non)), replace=False)
    full = ev.set_index("T")
    bad = 0
    for T in np.concatenate([pick, pick_b]).astype(np.int64):
        g = int(np.searchsorted(P["t"], T, "right") - 1)
        Pt = {k: (v[: g + 1] if isinstance(v, np.ndarray) else v) for k, v in P.items()}
        day = (int(T) // DAY_MS) * DAY_MS
        tr2, ev2, _ = engine.run(Pt, day, int(T))
        r2 = ev2.set_index("T").loc[T]
        r1 = full.loc[T]
        diffs = [c for c in CMP if c in r1.index and not same(_py(r1.get(c)), _py(r2.get(c)))]
        t1 = trades[trades.signal_ts == T][["dir", "entry", "entry_ts", "stop0", "target"]].reset_index(drop=True)
        t2 = tr2[tr2.signal_ts == T][["dir", "entry", "entry_ts", "stop0", "target"]].reset_index(drop=True) \
            if len(tr2) else t1.iloc[0:0]
        # dtype-insensitive: two EMPTY frames can carry int64 vs object dtypes
        if len(t1) != len(t2) or (len(t1) and not np.array_equal(t1.to_numpy(dtype=float), t2.to_numpy(dtype=float))):
            diffs.append("order")
        if diffs:
            bad += 1
            log.append(f"C1 {sym} {fmt(T)}: {diffs}")
    return len(pick), len(pick_b), bad


def _py(x):
    if isinstance(x, (np.floating,)):
        return float(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    if isinstance(x, (np.integer,)):
        return int(x)
    return x


def c2_invariants(sym, P, trades, log):
    tm = TIMINGS[sym]
    t = P["t"]
    problems = 0
    for r in trades.itertuples():
        d = (r.signal_ts // DAY_MS) * DAY_MS
        e0, e1 = ny_window_utc_ms(d, *tm["entry"])
        a0, a1 = ny_window_utc_ms(d, *tm["alive"])
        g = int(np.searchsorted(t, r.signal_ts, "right") - 1)
        step = int(t[g] - t[g - 1])
        checks = [("outside entry window", e0 <= r.signal_ts <= e1),
                  ("not closed", bool(r.closed)),
                  ("alive past window end", r.exit_ts <= a1),
                  ("crosses UTC midnight", r.exit_ts // DAY_MS == r.signal_ts // DAY_MS),
                  ("entry_ts != bar + interval", r.entry_ts == int(t[g]) + step)]
        for name, ok in checks:
            if not ok:
                problems += 1
                log.append(f"C2 {sym} {fmt(r.signal_ts)}: {name}")
    return problems


def c3_parity(sym, log):
    path = os.path.join(RESULTS, f"parity_{sym}.csv")
    if not os.path.exists(path):
        log.append(f"C3 {sym}: no parity run")
        return None
    df = pd.read_csv(path, dtype={"month": str})
    return df


def c5_label_tape(sym, df, trades, log):
    lab = df.copy()
    lab["t_ms"] = lab["label_ms"]
    lab = lab.drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
    P = engine.prepare(sym, lab)
    lo = ms(df.ts.iloc[0].normalize() + pd.Timedelta("1D"))
    hi = ms(df.ts.iloc[-1])
    tr_lab, _, _ = engine.run(P, lo, hi, record_components=False)
    # map each label-tape order's bar back to its true UTC bar
    off = dict(zip(df.label_ms.values, df.t_ms.values))
    g = np.searchsorted(P["t"], tr_lab.signal_ts.values, "right") - 1
    real_bar = np.array([off[int(P["t"][i])] for i in g])
    g0 = np.searchsorted(P["t"], trades.signal_ts.values, "right") - 1  # noqa: F841
    real_utc = set(zip(trades.signal_ts.values.tolist(), trades.dir.values.tolist()))
    shared = sum(1 for rb, d in zip(real_bar.tolist(), tr_lab.dir.values.tolist()) if (rb, d) in real_utc)
    ny = pd.to_datetime(real_bar, unit="ms", utc=True).tz_convert("America/New_York")
    hours = pd.Series(ny.hour).value_counts().sort_index()
    return len(tr_lab), shared, hours


def main() -> None:
    syms = sys.argv[1:] or SYMBOLS
    log: list[str] = []
    md = ["# CHECKS — Stage 0", "", "Produced by `checks.py`.", "",
          "| check | symbol | result | detail |", "|---|---|---|---|"]
    extra = []
    allpass = True
    for sym in syms:
        df = load_1m(sym)
        P = engine.prepare(sym, df)
        trades = pd.read_parquet(os.path.join(RESULTS, f"signals_{sym}.parquet"))
        ev = pd.read_parquet(os.path.join(RESULTS, f"evals_{sym}.parquet"))

        ns, nb, bad = c1_prefix(sym, P, ev, trades, log)
        ok = bad == 0
        allpass &= ok
        md.append(f"| C1 prefix-causality | {sym} | {'PASS' if ok else 'FAIL'} | "
                  f"{ns} signals + {nb} non-signal bars re-derived on a tape truncated at the bar; {bad} differ |")

        p2 = c2_invariants(sym, P, trades, log)
        allpass &= p2 == 0
        md.append(f"| C2 invariants | {sym} | {'PASS' if p2 == 0 else 'FAIL'} | {len(trades)} orders, {p2} violations |")

        par = c3_parity(sym, log)
        if par is None:
            allpass = False
            md.append(f"| C3 TS parity | {sym} | MISSING | — |")
        else:
            months_expected = pd.period_range(df.ts.iloc[0].tz_localize(None), df.ts.iloc[-1].tz_localize(None), freq="M")
            missing = sorted(set(m.strftime("%Y-%m") for m in months_expected) - set(par.month))
            ok3 = par.problems.sum() == 0 and not missing and (par.evals_ts == par.evals_match).all()
            allpass &= ok3
            md.append(f"| C3 TS parity | {sym} | {'PASS' if ok3 else 'FAIL'} | {len(par)} months, "
                      f"{par.evals_ts.sum():,} evaluated bars ({par.evals_bit_exact.sum():,} bit-exact), "
                      f"{par.orders_ts.sum()} TS orders vs {par.orders_py.sum()} Python, "
                      f"{int(par.problems.sum())} problems, missing months: {missing or 'none'} |")

        n_lab, shared, hours = c5_label_tape(sym, df, trades, log)
        md.append(f"| C5 D-01 size (info) | {sym} | — | label-timed tape: {n_lab} orders; {shared} share "
                  f"(true bar, direction) with the {len(trades)} UTC-timed orders |")
        extra += [f"- {sym}: NY hour of the true bar for label-tape orders: "
                  + ", ".join(f"{h:02d}h {c}" for h, c in hours.items())]
        print(sym, "C1 bad", bad, "C2", p2, "C5", n_lab, shared, flush=True)

    unit = open(os.path.join(RESULTS, "D03_unit_last_ifvg.txt")).read().strip().splitlines()
    u = [json.loads(x) for x in unit]
    ok4 = (u[0]["lastIFVG"] != "undefined") and (u[1]["lastIFVG"] == "undefined")
    md.append(f"| C4 D-03 unit | TS | {'CONFIRMED' if ok4 else 'NOT REPRODUCED'} | bullish-only list → lastIFVG "
              f"{'defined' if u[0]['lastIFVG'] != 'undefined' else 'undefined'}; bearish-only → "
              f"{u[1]['lastIFVG'] if u[1]['lastIFVG'] == 'undefined' else 'defined'} |")
    md += ["", f"**Overall: {'ALL GATING CHECKS PASS' if allpass else 'FAILURES — see checks.log'}**", "",
           "C5 detail (where the bot's own backtest would actually be trading, in true New York time):", ""] + extra
    with open(os.path.join(RESULTS, "CHECKS.md"), "w") as fh:
        fh.write("\n".join(md) + "\n")
    with open(os.path.join(RESULTS, "checks.log"), "w") as fh:
        fh.write("\n".join(log) + ("\n" if log else "no problems\n"))
    print("\n".join(md))


if __name__ == "__main__":
    main()
