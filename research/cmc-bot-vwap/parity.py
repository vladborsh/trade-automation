#!/usr/bin/env python3
"""PARITY.md gate 1 — bar-for-bar diff of the Python port against the bot's own
TypeScript, on byte-identical tape, chunk by chunk.

    python parity.py US100 2024-03 [2024-04 ...]     # specific months
    python parity.py US100 all                        # every chunk with an events file

Two layers are compared:

1. **Every evaluated bar** (every minute where `isValidTimeForNewOrders` is
   true): window size and bounds, the 200-bar range top/bottom and
   priceInDiscount, both iFVG-occurs flags, lastIFVG (presence, low, high),
   both iFVG list lengths, ATR(20), the previous-hour high/low, the bias-window
   length, VWAP and both bands, the bias direction, the ATR-ratio gate and both
   prior-hour sweep flags. Floats must be **bit-identical** (exact `==`), not
   merely close; the count within rtol 1e-9 is reported separately.
2. **Every order**: signal bar, entry time, direction, entry, stop as placed,
   target, and the whole lifecycle — exit time, exit price, exit cause, stop at
   exit, number of trails.
"""
from __future__ import annotations

import glob
import gzip
import hashlib
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from common import BUY, SELL, RESULTS, fmt, ms  # noqa: E402
import engine  # noqa: E402
sys.path.insert(0, os.path.join(HERE, "ts_parity"))
from export_static import chunk_bytes  # noqa: E402
from common import load_1m  # noqa: E402

DF: dict = {}
EXC: dict = {}
EXC_N: dict = {}

EV = os.path.join(HERE, "ts_parity", "events")
FLOAT_F = ["range_top", "range_bottom", "ifvg_low", "ifvg_high", "atr", "prev_high", "prev_low",
           "vwap", "vwap_top", "vwap_bottom"]
INT_F = ["n", "n_bull_ifvg", "n_bear_ifvg", "n_bias", "g_ts", "s_ts"]
BOOL_F = ["in_disc", "bull_occ", "bear_occ", "has_ifvg", "prev_found"]


def load_ts(sym: str, month: str):
    ev = [json.loads(x) for x in gzip.open(os.path.join(EV, f"{sym}-{month}.jsonl.gz"), "rt")]
    return ev


def py_side(P, month):
    a = pd.Timestamp(month + "-01", tz="UTC")
    b = a + pd.offsets.MonthBegin(1) - pd.Timedelta("1min")
    trades, evals, events = engine.run(P, ms(a), ms(b))
    return trades, evals, events


def fnum(x):
    if x is None:
        return np.nan
    if x == "inf":
        return np.inf
    if x == "-inf":
        return -np.inf
    return float(x)


def compare_month(P, sym, month, out_rows):
    ev = load_ts(sym, month)
    ts_eval = [e for e in ev if e["ev"] == "eval"]
    ts_sig = [e for e in ev if e["ev"] == "signal"]
    ts_close = {}
    for e in ev:
        if e["ev"] == "close" and e["id"] not in ts_close:
            ts_close[e["id"]] = e
    ts_trail = {}
    for e in ev:
        if e["ev"] == "trail":
            ts_trail[e["id"]] = ts_trail.get(e["id"], 0) + 1
    ts_err = [e for e in ev if e["ev"] == "error" or (e["ev"] == "eval" and "error" in e)]
    end = [e for e in ev if e["ev"] == "end"]

    trades, evals, _ = py_side(P, month)
    problems = []
    sha = open(os.path.join(EV, f"{sym}-{month}.sha256")).read().strip()
    if hashlib.sha256(chunk_bytes(sym, month, DF[sym])).hexdigest() != sha:
        problems.append("TAPE MISMATCH: the TypeScript ran on different bytes than the current parquet")
    if end and end[0]["open"] != 0:
        problems.append(f"TS left {end[0]['open']} order(s) open at chunk end")
    if len(trades) and not trades.closed.all():
        problems.append("Python left an order open at chunk end")
    # Exceptions are part of the behaviour under test (D-18): the TypeScript
    # throws `Cannot read properties of undefined (reading 'openTime')` inside
    # VWAP() when the bias window since UTC midnight is empty, and processStep
    # rejects with no signal. The port marks that bar err=2. Parity requires the
    # two sets of bars to be IDENTICAL; any other exception is a problem.
    ts_err_t = sorted({e["t"] for e in ev if e["ev"] == "error"})
    ts_eval_err_t = sorted({e["t"] for e in ev if e["ev"] == "eval" and "error" in e})
    py_err_t = sorted(evals.loc[evals.err == 2, "T"].astype(int).tolist()) if len(evals) else []
    if len(evals) and (evals.err >= 3).any():
        problems.append(f"Python err>=3 on {int((evals.err >= 3).sum())} bars")
    if ts_err_t != py_err_t or ts_eval_err_t != py_err_t:
        problems.append(f"exception bars differ: ts processStep {len(ts_err_t)}, ts eval {len(ts_eval_err_t)}, py {len(py_err_t)}")
    msgs = {e["error"] for e in ev if e["ev"] == "error"}
    if any("openTime" not in m for m in msgs):
        problems.append(f"unexpected TS exception text: {msgs}")
    EXC.setdefault(sym, set()).update(msgs)
    EXC_N[sym] = EXC_N.get(sym, 0) + len(py_err_t)

    # ---- layer 1: every evaluated bar ------------------------------------
    n_exact = n_close = 0
    if len(ts_eval) != len(evals):
        problems.append(f"eval count ts={len(ts_eval)} py={len(evals)}")
    m = min(len(ts_eval), len(evals))
    for k in range(m):
        a = ts_eval[k]; b = evals.iloc[k]
        if a["t"] != b["T"]:
            problems.append(f"eval {k}: t ts={a['t']} py={b['T']}"); break
        bad = []
        if "error" in a or b["err"] == 2:
            if not ("error" in a and b["err"] == 2):
                problems.append(f"eval {fmt(a['t'])}: exception on one side only")
            else:
                n_close += 1; n_exact += 1
            continue
        if int(a["n"]) == 0 or int(b["n"]) == 0:
            if int(a["n"]) != int(b["n"]):
                problems.append(f"eval {fmt(a['t'])}: n ts={a['n']} py={b['n']}")
            else:
                n_close += 1; n_exact += 1
            continue
        for f in INT_F:
            if int(a[f]) != int(b[f]):
                bad.append(f)
        for f in BOOL_F:
            if bool(a[f]) != bool(b[f] == 1.0):
                bad.append(f)
        exact = True
        for f in FLOAT_F:
            x, y = fnum(a.get(f)), float(b[f])
            if np.isnan(x) and np.isnan(y):
                continue
            if x != y:
                exact = False
                if not np.isclose(x, y, rtol=1e-9, atol=0):
                    bad.append(f"{f}(ts={x!r} py={y!r})")
        bias_ts = {"buy": BUY, "sell": SELL, None: -1}[a["bias"]]
        if bias_ts != int(b["bias"]) and not (b["err"] != 0 and a["bias"] is None):
            bad.append(f"bias(ts={a['bias']} py={b['bias']})")
        # gate flags are only computed on the Python side when a bias exists
        if b["bias"] != -1:
            if bool(a["ifvg_ok"]) != bool(b["ifvg_ok"]): bad.append("ifvg_ok")
            if bool(a["above"]) != bool(b["above"]): bad.append("above")
            if bool(a["below"]) != bool(b["below"]): bad.append("below")
        if bad:
            problems.append(f"eval {fmt(a['t'])}: " + ", ".join(bad))
        else:
            n_exact += exact
            n_close += 1

    # ---- layer 2: every order --------------------------------------------
    if len(ts_sig) != len(trades):
        problems.append(f"order count ts={len(ts_sig)} py={len(trades)}")
    for k in range(min(len(ts_sig), len(trades))):
        a = ts_sig[k]; b = trades.iloc[k]
        c = ts_close.get(a["id"])
        checks = [("signal_ts", a["t"], b.signal_ts), ("entry_ts", a["entryTime"], b.entry_ts),
                  ("dir", SELL if a["dir"] == "sell" else BUY, b.dir),
                  ("entry", a["entry"], b.entry), ("stop0", a["stop"], b.stop0), ("target", a["target"], b.target)]
        if c is None:
            problems.append(f"order {k}: TS never closed it")
        else:
            checks += [("exit_ts", c["closeTime"], b.exit_ts), ("exit_price", c["closePrice"], b.exit_price),
                       ("why", c["why"], b.why), ("stop_at_exit", c["stop"], b.stop)]
        checks.append(("n_trail", ts_trail.get(a["id"], 0), b.n_trail))
        for name, x, y in checks:
            if isinstance(x, str) or isinstance(y, str):
                ok = x == y
            else:
                ok = float(x) == float(y)
            if not ok:
                problems.append(f"order {k} @{fmt(a['t'])}: {name} ts={x!r} py={y!r}")

    out_rows.append(dict(symbol=sym, month=month, evals_ts=len(ts_eval), evals_py=len(evals),
                         evals_match=n_close, evals_bit_exact=n_exact,
                         orders_ts=len(ts_sig), orders_py=len(trades), problems=len(problems)))
    return problems


def main() -> None:
    sym = sys.argv[1]
    months = sys.argv[2:]
    if months == ["all"]:
        months = sorted(os.path.basename(p)[len(sym) + 1:-len(".jsonl.gz")]
                        for p in glob.glob(os.path.join(EV, f"{sym}-*.jsonl.gz")))
    DF[sym] = load_1m(sym)
    P = engine.prepare(sym, DF[sym])
    rows, allp = [], []
    for mo in months:
        pr = compare_month(P, sym, mo, rows)
        r = rows[-1]
        print(f"{sym} {mo}: evals {r['evals_ts']}/{r['evals_py']} match {r['evals_match']} "
              f"(bit-exact {r['evals_bit_exact']}), orders {r['orders_ts']}/{r['orders_py']}, "
              f"problems {len(pr)}", flush=True)
        for p in pr[:15]:
            print("   -", p)
        allp += [f"{mo}: {p}" for p in pr]
    print(f"{sym}: exception bars (both sides identical) {EXC_N.get(sym, 0)}; TS messages {EXC.get(sym, set())}")
    df = pd.DataFrame(rows)
    path = os.path.join(RESULTS, f"parity_{sym}.csv")
    if os.path.exists(path) and months != sorted(df.month):
        old = pd.read_csv(path, dtype={"month": str})
        df = pd.concat([old[~old.month.isin(df.month)], df]).sort_values("month")
    df.to_csv(path, index=False)
    with open(os.path.join(RESULTS, f"parity_{sym}_problems.txt"), "w") as fh:
        fh.write("\n".join(allp) + ("\n" if allp else "0 discrepancies\n"))
    sys.exit(1 if allp else 0)


if __name__ == "__main__":
    main()
