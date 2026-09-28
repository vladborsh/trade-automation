#!/usr/bin/env python3
"""DESIGN §7 invariants.  Every check writes a row to results/checks.csv and
the script exits non-zero if any fails.  Run after `stage1.py` has built the
outcome cache (it reads cache/outcomes.parquet and cache/bars4h.parquet).
"""
from __future__ import annotations
import os, sys
import numpy as np
import pandas as pd

from common import (SYMBOLS, OUT, BAR_MIN, Tape, build_4h, load_leg, load_funding,
                    label_of, L_SPOT, L_PERP, L_ABS, L_DIST, L_NONE, L_INVALID,
                    FIT_END, HOLD_MIN, STOP_K)
from engine import load_all, outcome_table, arm_trades, ARMS, _path

rows = []


def check(name, ok, detail=""):
    rows.append(dict(check=name, ok=bool(ok), detail=str(detail)))
    print(f"[{'OK' if ok else 'FAIL'}] {name} {detail}", flush=True)


O, B = load_all()
rng = np.random.default_rng(7)

# 1. tapes ------------------------------------------------------------------
for s in SYMBOLS:
    tt = Tape(s)
    ok = True
    for leg in (tt.p, tt.s):
        tb, vol = leg["taker_buy_volume"], leg["volume"]
        f = np.isfinite(tb)
        ok &= bool(((tb[f] >= -1e-12) & (tb[f] <= vol[f] * (1 + 1e-9) + 1e-12)).all())
    check(f"1_taker_rule_after_neutralising_{s}", ok, f"neutralised_minutes={tt.n_taker_bad}")
    for leg in ("perp1m", "spot1m"):
        d = load_leg(s, leg)
        mono = d.ts.is_monotonic_increasing and d.ts.is_unique
        tb = ((d.taker_buy_volume >= -1e-12)
              & (d.taker_buy_volume <= d.volume * (1 + 1e-9) + 1e-12)).all()
        hl = ((d.high >= d[["open", "close"]].max(1) - 1e-12)
              & (d.low <= d[["open", "close"]].min(1) + 1e-12)).all()
        check(f"1_tape_{s}_{leg}", mono and hl,
              f"sorted_unique={mono} hl_consistent={hl} raw_taker_in_range={tb}")

# 2-4 on two symbols (full rebuild is the expensive part) ---------------------
for s in ("BTCUSDT", "DOGEUSDT"):
    t = Tape(s)
    b = B[B.symbol == s].reset_index(drop=True)
    # 2. CVD identity, independent loop over 50 random valid bars
    vb = b[b.valid].sample(50, random_state=1)
    err = 0.0
    for _, r in vb.iterrows():
        a, z = int(r.bar) * BAR_MIN, (int(r.bar) + 1) * BAR_MIN
        for leg, col in ((t.s, "cvd_spot"), (t.p, "cvd_perp")):
            tbv, vol = leg["taker_buy_volume"][a:z], leg["volume"][a:z]
            ok = np.isfinite(vol)
            ref = float(np.sum(2 * tbv[ok] - vol[ok]))
            err = max(err, abs(ref - r[col]) / max(1.0, abs(ref)))
    check(f"2_cvd_identity_{s}", err < 1e-9, f"max_rel_err={err:.2e}")

    # 3. prefix stability: truncate the tape at t_k and rebuild
    bad = 0
    for _, r in b[b.valid].sample(20, random_state=2).iterrows():
        cut = (int(r.bar) + 1) * BAR_MIN
        t2 = Tape.__new__(Tape)
        t2.__dict__.update(t.__dict__)
        t2.p = {k: v[:cut].copy() for k, v in t.p.items()}
        t2.s = {k: v[:cut].copy() for k, v in t.s.items()}
        t2.n = cut
        b2 = build_4h(t2).iloc[-1]
        same = (b2.label == r.label and b2.label_sh == r.label_sh
                and np.isclose(b2.atr, r.atr, rtol=1e-12)
                and np.isclose(b2.thr, r.thr, rtol=1e-12))
        bad += not same
    check(f"3_prefix_stability_{s}", bad == 0, f"mismatches={bad}/20")

# 4. labels exclusive/exhaustive and shadow definitions -----------------------
v = B[B.valid]
up, dn = v.ret >= v.thr, v.ret <= -v.thr
fl = ~up & ~dn
exp = np.where(up & (v.cvd_spot > 0), L_SPOT,
      np.where(up & (v.cvd_spot <= 0) & (v.cvd_perp > 0), L_PERP,
      np.where(dn & (v.cvd_spot > 0) & (v.cvd_perp < 0), L_ABS,
      np.where(fl & (v.cvd_spot < 0) & (v.cvd_perp > 0), L_DIST, L_NONE))))
check("4_labels_match_table", (exp == v.label).all(),
      f"n_valid={len(v)} invalid_labelled={(B[~B.valid].label != L_INVALID).sum()}")
sh = np.where(up & (v.cvd_perp > 0), L_SPOT,
     np.where(up & (v.cvd_perp <= 0), L_PERP,
     np.where(dn & (v.cvd_perp > 0), L_ABS, -9)))
m = sh != -9
check("4_shadow_labels", (sh[m] == v.label_sh.to_numpy()[m]).all()
      and not np.isin(v.label_sh.to_numpy()[~m], [L_SPOT, L_PERP, L_ABS]).any())

# 5. trade path ---------------------------------------------------------------
lg, st = O[O.side == 1], O[O.side == -1]
stop_px_l = lg.entry - lg.stop_dist
stop_px_s = st.entry + st.stop_dist
c5a = (lg[lg.cause == "stop"].exit_px <= stop_px_l[lg.cause == "stop"] + 1e-9).all() \
    and (st[st.cause == "stop"].exit_px >= stop_px_s[st.cause == "stop"] - 1e-9).all()
c5b = np.allclose(lg[lg.cause == "target"].priceR, 1.0) and \
    np.allclose(st[st.cause == "target"].priceR, 1.0)
c5c = (O.i_exit >= O.i0).all() and (O.t_exit_i - O.i0 <= HOLD_MIN).all()
check("5_stop_fills_at_or_beyond", c5a)
check("5_target_is_plus_1R", c5b)
check("5_no_exit_before_entry_hold_le_5d", c5c)
# constructed same-minute stop+target
op = np.array([100.0, 100.0]); hi = np.array([100.5, 103.0]); lo = np.array([99.5, 97.0])
cl = np.array([100.0, 100.0])
r = _path(op, hi, lo, cl, 0, 1, 98.0, 102.0, 2, -1)
r2 = _path(op, hi, lo, cl, 0, -1, 102.0, 98.0, 2, -1)
check("5_same_minute_both_is_stop", r[2] == 0 and r[1] == 98.0 and r2[2] == 0 and r2[1] == 102.0,
      f"long={r} short={r2}")
# gap through stop fills at open
op = np.array([100.0, 95.0]); hi = np.array([100.5, 96.0]); lo = np.array([99.5, 94.0])
r = _path(op, hi, lo, cl, 0, 1, 98.0, 102.0, 2, -1)
check("5_gap_stop_fills_at_open", r[2] == 0 and r[1] == 95.0, f"{r}")

# 6. funding ------------------------------------------------------------------
bad_f = 0
for s in SYMBOLS:
    f = load_funding(s)
    oo = O[O.symbol == s].sample(300, random_state=3)
    t_entry = pd.DatetimeIndex(oo.t_entry)
    t_exit = pd.DatetimeIndex(oo.t_exit)
    fts = f.ts.to_numpy()
    for te, tx, n in zip(t_entry, t_exit, oo.n_settle):
        ref = int(((fts > te.to_datetime64()) & (fts < tx.to_datetime64())).sum())
        bad_f += ref != n
check("6_settlements_strictly_inside_hold", bad_f == 0, f"mismatches={bad_f}/2400")
# sign: long pays positive funding, short receives
check("6_funding_sign_long_pays_positive",
      (O[(O.side == 1) & (O.n_settle > 0)].fundingR.mean() < 0)
      == (load_funding("BTCUSDT").last_funding_rate.mean() > 0),
      "mean long fundingR sign opposes mean rate sign")

# 7. non-overlap ------------------------------------------------------------------
bad_o = 0
for arm in ARMS:
    for w in ("fit", "holdout"):
        for sh in (False, True):
            tr, _ = arm_trades(O, arm, w, sh)
            for _, gg in tr.sort_values("i0").groupby("symbol"):
                bad_o += int((gg.i0.to_numpy()[1:] < gg.t_exit_i.to_numpy()[:-1]).sum())
check("7_non_overlap_all_arms", bad_o == 0, f"overlaps={bad_o}")

# 8. mirror symmetry on a reflected tape -------------------------------------------
t = Tape("ETHUSDT")
K = 2 * np.nanmax(t.p["high"])
tm = Tape.__new__(Tape)
tm.__dict__.update(t.__dict__)
tm.p = dict(t.p)
tm.p["open"], tm.p["close"] = K - t.p["open"], K - t.p["close"]
tm.p["high"], tm.p["low"] = K - t.p["low"], K - t.p["high"]
b0 = build_4h(t)
sample = b0[b0.valid & (pd.DatetimeIndex(b0.t_close) < FIT_END)].sample(50, random_state=4)
bad_m = 0
for _, r in sample.iterrows():
    i0 = (int(r.bar) + 1) * BAR_MIN
    d = STOP_K * r.atr
    e = r.close
    a = _path(t.p["open"], t.p["high"], t.p["low"], t.p["close"], i0, 1, e - d, e + d,
              min(i0 + HOLD_MIN, t.n), -1)
    em = K - e
    bm = _path(tm.p["open"], tm.p["high"], tm.p["low"], tm.p["close"], i0, -1, em + d,
               em - d, min(i0 + HOLD_MIN, t.n), -1)
    pa = (a[1] - e) / d
    pb = -(bm[1] - em) / d
    bad_m += not (a[2] == bm[2] and a[0] == bm[0] and abs(pa - pb) < 1e-6)
check("8_mirror_symmetry", bad_m == 0, f"mismatches={bad_m}/50")

# 9. fit trades never read a holdout price ------------------------------------------
fit = O[O.window == "fit"]
fe_ts = pd.DatetimeIndex(fit.t_exit)
check("9_fit_exits_by_boundary", (fe_ts <= FIT_END).all(),
      f"max_fit_exit={fe_ts.max()} boundary_exits={(fit.cause == 'boundary').sum()}")

pd.DataFrame(rows).to_csv(os.path.join(OUT, "checks.csv"), index=False)
n_fail = sum(not r["ok"] for r in rows)
print(f"{len(rows)} checks, {n_fail} failed")
sys.exit(1 if n_fail else 0)
