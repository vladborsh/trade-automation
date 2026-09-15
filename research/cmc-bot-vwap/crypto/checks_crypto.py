#!/usr/bin/env python3
"""Crypto extension machine checks -> results/crypto/CHECKS_CRYPTO.md.

C1  prefix-causality, both conditions: sampled orders + sampled non-signal
    evaluated bars re-derived on a tape truncated at the bar. `win` re-runs the
    day from UTC midnight (state cannot cross a day); `all` re-runs from the
    start of the parity chunk containing the bar (a midnight with no open order,
    `crypto/chunks.py`), because 24/7 orders can live for days.
C2  invariants: `win` — orders only inside the entry window, all closed, none
    alive after 14:30 NY, none across a UTC midnight; `all` — entry time = bar +
    1 min (no gaps on this tape), at most one open order per direction at any time.
C3  full-period TypeScript parity summary per symbol x condition
    (results/parity_<SYM>_<cond>.csv), every chunk present, 0 problems.

    python crypto/checks_crypto.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
sys.path.insert(0, PKG)
from common import CRYPTO, CRYPTO_WINDOW, DAY_MS, RESULTS, fmt, load_1m, ms, ny_window_utc_ms  # noqa: E402
import engine  # noqa: E402
from checks import CMP, _py, same  # noqa: E402

OUT = os.path.join(RESULTS, "crypto")
RNG = np.random.default_rng(20260913)
N_SIG, N_BAR = 100, 50
CONDS = {"win": CRYPTO_WINDOW, "all": engine.ALWAYS}


def chunk_starts(sym):
    rows = [l.split()[1] for l in open(os.path.join(PKG, "data", f"chunks_{sym}_all.txt")) if l.strip()]
    return np.array(sorted(ms(pd.Timestamp(r.split("+")[0], tz="UTC")) for r in rows), np.int64)


def c1(sym, cond, P, log):
    lo = int(P["t"][0]); hi = int(P["t"][-1])
    trades, ev, _ = engine.run(P, lo, hi, timing=CONDS[cond])
    starts = chunk_starts(sym)
    sig = trades.signal_ts.values
    pick = RNG.choice(sig, size=min(N_SIG, len(sig)), replace=False)
    non = ev[(ev.n > 0) & (~ev["T"].isin(sig)) & (ev.err == 0)]["T"].values
    pick_b = RNG.choice(non, size=min(N_BAR, len(non)), replace=False)
    full = ev.set_index("T")
    bad = 0
    for T in np.concatenate([pick, pick_b]).astype(np.int64):
        g = int(np.searchsorted(P["t"], T, "right") - 1)
        Pt = {k: (v[: g + 1] if isinstance(v, np.ndarray) else v) for k, v in P.items()}
        start = (int(T) // DAY_MS) * DAY_MS if cond == "win" else int(starts[np.searchsorted(starts, T, "right") - 1])
        tr2, ev2, _ = engine.run(Pt, start, int(T), timing=CONDS[cond])
        r1 = full.loc[T]; r2 = ev2.set_index("T").loc[T]
        diffs = [c for c in CMP if c in r1.index and not same(_py(r1.get(c)), _py(r2.get(c)))]
        cols = ["dir", "entry", "entry_ts", "stop0", "target"]
        t1 = trades[trades.signal_ts == T][cols].reset_index(drop=True)
        t2 = tr2[tr2.signal_ts == T][cols].reset_index(drop=True)
        # dtype-insensitive: two EMPTY frames can carry int64 vs object dtypes
        if len(t1) != len(t2) or (len(t1) and not np.array_equal(t1.to_numpy(dtype=float), t2.to_numpy(dtype=float))):
            diffs.append("order")
        if diffs:
            bad += 1
            log.append(f"C1 {sym} {cond} {fmt(T)}: {diffs}")
    return trades, len(pick), len(pick_b), bad


def c2(sym, cond, P, trades, log):
    t = P["t"]; bad = 0
    for r in trades.itertuples():
        g = int(np.searchsorted(t, r.signal_ts, "right") - 1)
        checks = [("entry_ts != bar + 1 min", r.entry_ts == int(t[g]) + 60_000)]
        if cond == "win":
            d = (r.signal_ts // DAY_MS) * DAY_MS
            e0, e1 = ny_window_utc_ms(d, *CRYPTO_WINDOW["entry"])
            a0, a1 = ny_window_utc_ms(d, *CRYPTO_WINDOW["alive"])
            checks += [("outside entry window", e0 <= r.signal_ts <= e1), ("not closed", bool(r.closed)),
                       ("alive past 14:30 NY", r.exit_ts <= a1),
                       ("crosses UTC midnight", r.exit_ts // DAY_MS == r.signal_ts // DAY_MS),
                       ("weekend", pd.Timestamp(r.signal_ts, unit="ms").dayofweek <= 4)]
        for name, ok in checks:
            if not ok:
                bad += 1; log.append(f"C2 {sym} {cond} {fmt(r.signal_ts)}: {name}")
    if cond == "all":
        for d in (0, 1):
            x = trades[trades.dir == d].sort_values("entry_ts")
            ends = x.exit_ts.fillna(np.iinfo(np.int64).max).values
            # the next same-direction order may only open at or after the previous one's close bar
            overl = int((x.signal_ts.values[1:] < ends[:-1]).sum())
            if overl:
                bad += overl; log.append(f"C2 {sym} all dir {d}: {overl} overlapping same-direction orders")
    return bad


def main() -> None:
    log: list[str] = []
    md = ["# CHECKS — crypto extension", "", "Produced by `crypto/checks_crypto.py`.", "",
          "| check | symbol | condition | result | detail |", "|---|---|---|---|---|"]
    allpass = True
    for sym in CRYPTO:
        df = load_1m(sym)
        P = engine.prepare(sym, df)
        for cond in CONDS:
            trades, ns, nb, bad = c1(sym, cond, P, log)
            allpass &= bad == 0
            md.append(f"| C1 prefix-causality | {sym} | {cond} | {'PASS' if bad == 0 else 'FAIL'} | "
                      f"{ns} orders + {nb} non-signal bars re-derived on a truncated tape; {bad} differ |")
            b2 = c2(sym, cond, P, trades, log)
            allpass &= b2 == 0
            md.append(f"| C2 invariants | {sym} | {cond} | {'PASS' if b2 == 0 else 'FAIL'} | {len(trades):,} orders, {b2} violations |")
            path = os.path.join(RESULTS, f"parity_{sym}_{cond}.csv")
            if not os.path.exists(path):
                allpass = False
                md.append(f"| C3 TS parity | {sym} | {cond} | MISSING | — |")
            else:
                par = pd.read_csv(path, dtype={"month": str})
                want = [l.split()[1] for l in open(os.path.join(PKG, "data", f"chunks_{sym}_{cond}.txt")) if l.strip()]
                missing = sorted(set(want) - set(par.month))
                ok3 = par.problems.sum() == 0 and not missing and (par.evals_ts == par.evals_match).all()
                allpass &= ok3
                md.append(f"| C3 TS parity | {sym} | {cond} | {'PASS' if ok3 else 'FAIL'} | {len(par)} chunks, "
                          f"{par.evals_ts.sum():,} evaluated bars ({par.evals_bit_exact.sum():,} bit-exact), "
                          f"{par.orders_ts.sum():,} TS orders vs {par.orders_py.sum():,} Python, "
                          f"{int(par.problems.sum())} problems, missing chunks: {len(missing)} |")
            print(sym, cond, "C1", bad, "C2", b2, flush=True)
    md += ["", f"**Overall: {'ALL CHECKS PASS' if allpass else 'FAILURES — see checks_crypto.log'}**"]
    with open(os.path.join(OUT, "CHECKS_CRYPTO.md"), "w") as fh:
        fh.write("\n".join(md) + "\n")
    with open(os.path.join(OUT, "checks_crypto.log"), "w") as fh:
        fh.write("\n".join(log) + ("\n" if log else "no problems\n"))
    print("\n".join(md))


if __name__ == "__main__":
    main()
