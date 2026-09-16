#!/usr/bin/env python3
"""DESIGN §11 — the wiring assertions.  Every one must pass before any number
in this package is believed.

  1. every settlement lands exactly on a 1h bar open
  2. fpct / spct prefix stability
  3. no settlement counted outside (t_entry, t_exit)
  4. no trigger fires on a missing slot
  5. long/short mirror symmetry on a sign-flipped tape
  6. no signal on an absent bar; no indicator reads a future bar
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, OUT, FIT_END, PCT_WINDOW, PCT_MINP,
                    rolling_pct_rank, wilder_atr, PCT_HI, PCT_LO, FLOOR)
import prep, engine

rng = np.random.default_rng(20260916)
START = pd.Timestamp("2020-01-01", tz="UTC")
results = []


def rec(name, ok, detail=""):
    results.append(dict(check=name, ok=bool(ok), detail=detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


frames = prep.build_all()

# --- check 1: settlements on bar opens ------------------------------------
bad = {}
for s, (bars, sett) in frames.items():
    have = sett.index[sett["present"]]
    off = have.difference(bars.index)
    inside = off[(off >= bars.index[0]) & (off <= bars.index[-1])]
    bad[s] = len(inside)
rec("1 settlement-on-bar-open", sum(bad.values()) == 0, str(bad))

# --- check 2: prefix stability of fpct / spct ------------------------------
viol = 0
tested = 0
for s, (bars, sett) in frames.items():
    for _ in range(25):
        k = int(rng.integers(300, len(sett)))
        for col, src in (("fpct", "f"), ("spct", "ret_shadow")):
            trunc = rolling_pct_rank(sett[src].iloc[:k + 1], PCT_WINDOW, PCT_MINP)
            a, b = trunc.iloc[-1], sett[col].iloc[k]
            tested += 1
            if not ((np.isnan(a) and np.isnan(b)) or abs(a - b) < 1e-12):
                viol += 1
rec("2 fpct/spct prefix stability", viol == 0, f"{viol}/{tested} violations")

# --- checks 3,4,6 on real trades ------------------------------------------
all_tr, all_led = [], 0
v_out, v_trig, v_absent = 0, 0, 0
for s, (bars, sett) in frames.items():
    for runner, arm in ((engine.run_A, "A"), (engine.run_B, "B")):
        tr = runner(bars, sett, s, START, FIT_END)
        for t in tr:
            if t.get("excluded") == "bar_gap":
                continue
            all_tr.append(t)
            for e in t.get("ledger", []):
                all_led += 1
                if not (t["t_entry"] < e["t_j"] < t["t_exit"]):
                    v_out += 1
            ts = t["t_signal"]
            if arm == "A":
                slots = sett.loc[:ts].iloc[-2:]
                if not slots["present"].all():
                    v_trig += 1
            else:
                last = sett.loc[:ts]
                last = last[last.index <= ts]
                if len(last) and not last.iloc[-1]["present"]:
                    v_trig += 1
            seg = bars.loc[t["t_signal"]:t["t_exit"]]
            if (~seg["present"]).any():
                v_absent += 1
rec("3 no settlement outside (t_entry,t_exit)", v_out == 0,
    f"{v_out}/{all_led} ledger rows over {len(all_tr)} trades")
rec("4 no trigger on a missing slot", v_trig == 0, f"{v_trig} triggers")
rec("6 no signal/path on an absent bar", v_absent == 0, f"{v_absent} trades")

# --- check 5: long/short mirror symmetry -----------------------------------
# Build a synthetic sign-flipped tape: price reflected about its own first
# close (high<->low swap) and funding negated.  Every short must become a long
# of equal magnitude in R.
def flip(bars, sett):
    b = bars.copy()
    p0 = float(b["close"].dropna().iloc[0])
    for c in ("open", "close"):
        b[c] = 2 * p0 - b[c]
    hi, lo = b["high"].copy(), b["low"].copy()
    b["high"], b["low"] = 2 * p0 - lo, 2 * p0 - hi
    b["atr14"] = wilder_atr(b["high"], b["low"], b["close"], 14)
    d = b.dropna(subset=["close"]).resample("1D").agg(
        {"high": "max", "low": "min", "close": "last"}).dropna()
    da = pd.Series(wilder_atr(d["high"], d["low"], d["close"], 14),
                   index=d.index).shift(1)
    da.index = da.index.date
    b["datr"] = pd.Series(b.index.date, index=b.index).map(da).astype(float)
    b["low12_prior"] = b["low"].rolling(12).min().shift(1)
    b["high12_prior"] = b["high"].rolling(12).max().shift(1)
    b["high12_incl"] = b["high"].rolling(13).max()
    b["low12_incl"] = b["low"].rolling(13).min()
    b["ret24_bar"] = b["close"] / b["close"].shift(24) - 1
    s = sett.copy()
    s["f"] = -s["f"]
    s["mark"] = b["open"].reindex(s.index).values
    s["px_at"] = b["close"].reindex(s.index - pd.Timedelta(hours=1)).values
    s["ret_shadow"] = s["px_at"] / b["close"].reindex(
        s.index - pd.Timedelta(hours=25)).values - 1
    s["fpct"] = rolling_pct_rank(s["f"], PCT_WINDOW, PCT_MINP)
    s["spct"] = rolling_pct_rank(s["ret_shadow"], PCT_WINDOW, PCT_MINP)
    s["ext_pos"] = (s["fpct"] >= PCT_HI) & (s["f"] >= FLOOR)
    s["ext_neg"] = (s["fpct"] <= PCT_LO) & (s["f"] <= -FLOOR)
    s["sh_pos"] = (s["spct"] >= PCT_HI) & (s["ret_shadow"] > 0)
    s["sh_neg"] = (s["spct"] <= PCT_LO) & (s["ret_shadow"] < 0)
    return b, s


sym = "BTCUSDT"
bars, sett = frames[sym]
fb, fs = flip(bars, sett)
END = pd.Timestamp("2022-01-01", tz="UTC")
mism = []
for runner, arm in ((engine.run_A, "A"), (engine.run_B, "B")):
    a = engine.kept(engine.to_frame(runner(bars, sett, sym, START, END)))
    c = engine.kept(engine.to_frame(runner(fb, fs, sym, START, END)))
    if not len(a) or not len(c):
        mism.append(f"{arm}:empty({len(a)},{len(c)})")
        continue
    ja = a.set_index("t_signal")
    jc = c.set_index("t_signal")
    common = ja.index.intersection(jc.index)
    if len(common) < 0.9 * min(len(ja), len(jc)):
        mism.append(f"{arm}:signal-set {len(common)}/{len(ja)}/{len(jc)}")
    side_ok = (ja.loc[common, "side"].values == -jc.loc[common, "side"].values).all()
    dn = np.abs(ja.loc[common, "netR"].values - jc.loc[common, "netR"].values)
    if not side_ok:
        mism.append(f"{arm}:side")
    if len(dn) and np.nanmax(dn) > 1e-6:
        mism.append(f"{arm}:netR max|d|={np.nanmax(dn):.2e} n={len(dn)}")
rec("5 long/short mirror symmetry", len(mism) == 0, "; ".join(mism) or "ok")

df = pd.DataFrame(results)
df.to_csv(os.path.join(OUT, "checks.csv"), index=False)
print("\nALL PASS" if df.ok.all() else "\nFAILURES PRESENT")
