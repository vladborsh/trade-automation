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
# ARCHITECT-RULING §3: scoped to settlements AT OR AFTER the first 1h bar; the
# pre-listing rows are exempt and COUNTED, never silently dropped.
bad, prelist = {}, {}
for s, (bars, sett) in frames.items():
    have = sett.index[sett["present"]]
    first_bar = bars.index[bars["present"]][0]
    prelist[s] = int((have < first_bar).sum())
    scoped = have[(have >= first_bar) & (have <= bars.index[-1])]
    bad[s] = len(scoped.difference(bars.index))
rec("1 settlement-on-bar-open (>= first bar)", sum(bad.values()) == 0,
    f"offenders {bad}; pre-listing rows exempt+counted {prelist} "
    f"(total {sum(prelist.values())})")

# --- check 1b: the SOL blackout leaves fpct defined (ARCHITECT-RULING §1) ---
_b, _s = frames["SOLUSDT"]
_bl = _s[_s["blackout"]]
_span = (_s.index >= _bl.index[0]) & (_s.index <= _bl.index[-1] +
                                      pd.Timedelta(days=30))
_cnt = _s["f"].rolling(PCT_WINDOW).count()[_span].min()
_after = _s.loc[_s.index > _bl.index[-1]].iloc[:90]
rec("1b blackout: min_periods still met, fpct defined after the span",
    (_cnt >= PCT_MINP) and bool(_after["fpct"].notna().all()),
    f"{len(_bl)} grid slots blacked out [{_bl.index[0]} .. {_bl.index[-1]}]; "
    f"min valid rows in a 90-slot window = {int(_cnt)} (>= {PCT_MINP}); "
    f"fpct defined on {int(_after['fpct'].notna().sum())}/90 slots after")

# --- check 1c: the authorised daily-prefix backfill (ARCHITECT-RULING §2) ---
import gzip
FILL_SPANS = {"SOLUSDT": ["2022-02-26", "2022-02-27", "2022-02-28",
                          "2022-04-01", "2022-04-02"],
              "XRPUSDT": ["2022-02-26", "2022-02-27", "2022-02-28",
                          "2022-04-01", "2022-04-02"]}
prob = []
for sym, days in FILL_SPANS.items():
    cur = pd.read_csv(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "data", f"{sym}-1h.csv.gz"))
    cur["ts"] = pd.to_datetime(cur["ts"], utc=True)
    if cur["ts"].duplicated().any():
        prob.append(f"{sym}: duplicate open times after fill")
    want = pd.DatetimeIndex(sorted(
        t for d in days for t in pd.date_range(d, periods=24, freq="1h",
                                               tz="UTC")))
    got = pd.DatetimeIndex(cur["ts"])
    if len(want.difference(got)):
        prob.append(f"{sym}: {len(want.difference(got))} filled opens missing")
    # a neighbouring day present in BOTH monthly and daily must match row-for-row
    from fetch_data import _read_zip_csv, _ts, KLINE_COLS
    from urllib.request import urlopen
    for nb in ("2022-02-25", "2022-03-31"):
        raw = urlopen(f"https://data.binance.vision/data/futures/um/daily/"
                      f"klines/{sym}/1h/{sym}-1h-{nb}.zip", timeout=120).read()
        dd = _read_zip_csv(raw, KLINE_COLS)
        dd["ts"] = _ts(dd["open_time"])
        m = cur[(cur.ts >= pd.Timestamp(nb, tz="UTC")) &
                (cur.ts < pd.Timestamp(nb, tz="UTC") + pd.Timedelta(days=1))]
        m = m.sort_values("ts").reset_index(drop=True)
        dd = dd.sort_values("ts").reset_index(drop=True)
        if len(m) != len(dd) or not (m["ts"].values == dd["ts"].values).all():
            prob.append(f"{sym}/{nb}: row set differs")
            continue
        for col in ("open", "high", "low", "close", "volume"):
            d_ = np.abs(pd.to_numeric(m[col]).values
                        - pd.to_numeric(dd[col]).values).max()
            if d_ > 1e-9:
                prob.append(f"{sym}/{nb}: {col} differs by {d_:.2e}")
rec("1c authorised daily-prefix backfill: opens exact, monthly==daily on "
    "neighbouring days", len(prob) == 0,
    "; ".join(prob) or "240 bars filled; 4 neighbouring monthly days match "
    "the daily files row-for-row on OHLCV and open time")

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
# A naive "reflect the tape" mirror is NOT a valid test here, and saying why is
# part of the check.  Three quantities in this design are not equivariant under
# any single price transform: (i) the trailing-RATIO return (B condition 2 and
# the shadow), (ii) the funding notional, which is a price LEVEL times a rate,
# and (iii) costR, which is a price level over a distance.  So the mirror is
# decomposed into three parts, each of which is EXACT.
#
#   5a  trigger + stop + exit branches, on an additively reflected tape
#       (high<->low swapped, all absolute distances and ATRs preserved), with
#       the funding state booleans swapped and f negated, the funding notional
#       zeroed and costs zeroed.  A short on the original tape must become a
#       long on the reflected tape with the SAME stop_dist, the SAME priceR and
#       the SAME exit cause.
#   5b  the funding sign convention, algebraically: collect(side, f) must equal
#       collect(-side, -f) exactly, for random inputs.
#   5c  the percentile definition's own symmetry, measured rather than assumed.

def reflect(bars, sett):
    b = bars.copy()
    p0 = float(b["close"].dropna().iloc[0])
    b["open"] = 2 * p0 - bars["open"]
    b["close"] = 2 * p0 - bars["close"]
    b["high"] = 2 * p0 - bars["low"]
    b["low"] = 2 * p0 - bars["high"]
    b["atr14"] = wilder_atr(b["high"], b["low"], b["close"], 14)
    b["low12_prior"] = b["low"].rolling(12).min().shift(1)
    b["high12_prior"] = b["high"].rolling(12).max().shift(1)
    b["high12_incl"] = b["high"].rolling(13).max()
    b["low12_incl"] = b["low"].rolling(13).min()
    # B condition 2 is a trailing RATIO return: no price transform mirrors it,
    # so it is mirrored by construction here, exactly as the funding state is.
    # B's OWN geometry (close < min(prior lows) vs close > max(prior highs)) is
    # still recomputed from the reflected tape above and is therefore tested.
    b["ret24_bar"] = -bars["ret24_bar"]
    s = sett.copy()
    s["f"] = -sett["f"]
    s["ext_pos"] = sett["ext_neg"].values      # states swapped by construction
    s["ext_neg"] = sett["ext_pos"].values
    return b, s


mism = []
END = pd.Timestamp("2023-01-01", tz="UTC")
for sym in ("BTCUSDT", "DOGEUSDT"):
    bars, sett = frames[sym]
    b0, s0 = bars.copy(), sett.copy()
    s0["mark"] = 0.0                            # zero the funding notional
    rb, rs = reflect(b0, s0)
    rs["mark"] = 0.0
    # the reflected tape must carry byte-equal risk units
    for col in ("atr14",):
        d = np.abs(b0[col] - rb[col]).max()
        if not (d < 1e-8 or np.isnan(d)):
            mism.append(f"{sym}:{col} not preserved ({d:.2e})")
    rb["datr"] = b0["datr"]                     # ranges are identical by (i)
    for runner, arm in ((engine.run_A, "A"), (engine.run_B, "B")):
        kw = dict(cost_rt=0.0)
        a = engine.kept(engine.to_frame(runner(bars.assign(**{}), s0, sym,
                                               START, END, **kw)))
        c = engine.kept(engine.to_frame(runner(rb, rs, sym, START, END, **kw)))
        if not len(a) or not len(c):
            mism.append(f"{sym}/{arm}: empty ({len(a)},{len(c)})")
            continue
        ja, jc = a.set_index("t_signal"), c.set_index("t_signal")
        if set(ja.index) != set(jc.index):
            mism.append(f"{sym}/{arm}: signal sets differ "
                        f"{len(ja)} vs {len(jc)}")
        common = ja.index.intersection(jc.index)
        if not len(common):
            mism.append(f"{sym}/{arm}: no common signals")
            continue
        if not (ja.loc[common, "side"].values == -jc.loc[common, "side"].values).all():
            mism.append(f"{sym}/{arm}: sides not mirrored")
        dsd = np.abs(ja.loc[common, "stop_dist"].values
                     - jc.loc[common, "stop_dist"].values).max()
        dpr = np.abs(ja.loc[common, "priceR"].values
                     - jc.loc[common, "priceR"].values).max()
        if dsd > 1e-8:
            mism.append(f"{sym}/{arm}: stop_dist max|d|={dsd:.2e}")
        if dpr > 1e-8:
            mism.append(f"{sym}/{arm}: priceR max|d|={dpr:.2e} n={len(common)}")
        if not (ja.loc[common, "cause"].values == jc.loc[common, "cause"].values).all():
            n = int((ja.loc[common, "cause"].values
                     != jc.loc[common, "cause"].values).sum())
            mism.append(f"{sym}/{arm}: {n} exit causes differ")
rec("5a trigger/stop/exit branch mirror", len(mism) == 0, "; ".join(mism) or "ok")

# 5b -- the funding sign convention, exact
r2 = np.random.default_rng(7)
n = 400
ss = pd.DataFrame({"f": r2.normal(0, 3e-4, n), "mark": r2.uniform(10, 5e4, n),
                   "present": True},
                  index=pd.date_range("2021-01-01", periods=n, freq="8h",
                                      tz="UTC"))
t0, t1 = ss.index[0], ss.index[-1]
worst = 0.0
for side in (-1, 1):
    a, _, _, _ = engine.collect(ss, side, t0, t1, 12.5)
    m = ss.copy(); m["f"] = -m["f"]
    b, _, _, _ = engine.collect(m, -side, t0, t1, 12.5)
    worst = max(worst, abs(a - b))
rec("5b funding sign convention collect(s,f)==collect(-s,-f)", worst < 1e-12,
    f"max|d|={worst:.2e}")

# 5c -- the percentile definition's own symmetry, MEASURED not assumed
x = pd.Series(np.random.default_rng(11).normal(size=4000))   # tie-free
up = rolling_pct_rank(x, PCT_WINDOW, PCT_MINP)
dn = rolling_pct_rank(-x, PCT_WINDOW, PCT_MINP)
neff = np.minimum(np.arange(1, len(x) + 1), PCT_WINDOW).astype(float)
expect = pd.Series(1.0 / neff, index=x.index)
off = (up + dn - 1 - expect).dropna()
worst5c = float(np.nanmax(np.abs(off))) if len(off) else np.nan
rec("5c percentile mirror = 1 - fpct + 1/n_window (pre-registered definition)",
    worst5c < 1e-12,
    f"max|d|={worst5c:.2e}; fpct(-x) == 1-fpct(x)+1/n exactly. The §1.2 "
    f"definition counts the current value with '<=', so ext_neg is stricter "
    f"than ext_pos by exactly ONE RANK IN 90 (0.0111). Inherited from "
    f"ARCHITECT-NOTE §1.2, not introduced here; reported, not corrected.")

df = pd.DataFrame(results)
df.to_csv(os.path.join(OUT, "checks.csv"), index=False)
print("\nALL PASS" if df.ok.all() else "\nFAILURES PRESENT")
