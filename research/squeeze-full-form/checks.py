#!/usr/bin/env python3
"""Wiring checks (DESIGN §9). Must be green before any fit number is read.

Prints PASS/FAIL per check and writes results/checks.csv. Prints no R summary:
the trade-level checks build trades only to assert their structure.
"""
from __future__ import annotations
import io, os, sys, zipfile
from urllib.request import urlopen
import numpy as np
import pandas as pd

from common import OUT, DATA, SYMBOLS, NS_15M, W15, FH_ATR, OI_LAG, TIME_STOP, ARM_WINDOW
from prep import build_symbol, venue_state
from engine import armed_mask, evaluable_mask, simulate, Trig, placebo_trade

RES = []


def check(name, ok, detail=""):
    RES.append(dict(check=name, ok=bool(ok), detail=str(detail)))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def archive(url, cols=12):
    raw = urlopen(url, timeout=180).read()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        df = pd.read_csv(z.open(z.namelist()[0]), header=None)
    if not str(df.iloc[0, 0]).isdigit():
        df = df.iloc[1:].reset_index(drop=True)
    df = df.iloc[:, :10].astype(float)
    df.columns = ["ot", "o", "h", "l", "c", "v", "ct", "qv", "n", "tb"]
    unit = "us" if len(str(int(df.ot.iloc[0]))) == 16 else "ms"
    df["ts"] = pd.to_datetime(df.ot.astype("int64"), unit=unit, utc=True)
    return df.set_index("ts"), unit


def main():
    # 1. timestamp unit rule on the pull log
    lg = pd.read_csv(os.path.join(OUT, "fetch_log.csv"))
    sp = lg[(lg.dataset == "spot15m") & (lg.status == "ok")]
    bad = sp[((sp.month >= "2025-01") & (sp.ts_unit != "us")) |
             ((sp.month < "2025-01") & (sp.ts_unit != "ms"))]
    pp = lg[(lg.dataset == "perp1m") & (lg.status == "ok")]
    check("1 ts unit: spot us from 2025-01, ms before; perp ms",
          len(bad) == 0 and (pp.ts_unit == "ms").all(),
          f"spot files {len(sp)}, off-rule {len(bad)}, perp files {len(pp)}")

    # 2. spot 15m == aggregate of spot 1m (a us-era month)
    s1, u1 = archive("https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2025-03.zip")
    agg = s1.resample("15min").agg(dict(o="first", h="max", l="min", c="last", v="sum", tb="sum"))
    s15 = pd.read_parquet(os.path.join(DATA, "BTCUSDT-spot15m.parquet")).set_index("ts")
    s15 = s15.loc["2025-03-01":"2025-03-31 23:59"]
    j = agg.join(s15, how="inner")
    err = max((j.v - j.volume).abs().max() / j.volume.mean(),
              (j.tb - j.taker_buy_volume).abs().max() / j.volume.mean(),
              (j.h - j.high).abs().max(), (j.c - j.close).abs().max())
    check("2 spot 15m archive == sum of spot 1m (BTCUSDT 2025-03, us era)",
          len(j) == len(s15) and len(j) > 2900 and err < 1e-6, f"bars {len(j)}, unit {u1}, max err {err:.2e}")

    # 3. perp 15m / 1h resampled from 1m == archive's own bars
    S = build_symbol("BTCUSDT")
    b = S["b15"].loc["2023-05-01":"2023-05-31 23:59"]
    a15, _ = archive("https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/15m/BTCUSDT-15m-2023-05.zip")
    j = b.join(a15, how="inner")
    e15 = max((j.high - j.h).abs().max(), (j.low - j.l).abs().max(),
              (j.close - j.c).abs().max(), (j.volume - j.v).abs().max() / j.v.mean())
    a1h, _ = archive("https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2023-05.zip")
    p1 = pd.read_parquet(os.path.join(DATA, "BTCUSDT-perp1m.parquet"))
    p1 = p1[(p1.ts >= "2023-05-01") & (p1.ts < "2023-06-01")].set_index("ts")
    r1h = p1.resample("1h").agg(dict(high="max", low="min", close="last", volume="sum"))
    j1 = r1h.join(a1h, how="inner")
    e1h = max((j1.high - j1.h).abs().max(), (j1.low - j1.l).abs().max(),
              (j1.close - j1.c).abs().max())
    check("3 perp 15m/1h resampled from 1m == archive 15m/1h (BTCUSDT 2023-05)",
          len(j) > 2900 and e15 < 1e-6 and len(j1) > 700 and e1h < 1e-6,
          f"15m bars {len(j)} err {e15:.2e}; 1h bars {len(j1)} err {e1h:.2e}")

    # 4. prefix stability: every observable at T < cut is identical when all
    #    inputs are truncated at cut (no look-ahead anywhere in prep)
    cols = ["contig", "atr", "ret24", "cvd_perp", "cvd_spot", "H24", "L24", "fh",
            "fl", "compress", "n_venues", "ext_hi", "ext_lo", "binance_hi",
            "binance_lo", "oi_d24h", "at_7d_high", "sh_pos", "sh_neg"]
    bad = []
    for sym, cut in (("BTCUSDT", "2022-06-15 08:00"), ("SOLUSDT", "2024-03-07 12:00")):
        cut = pd.Timestamp(cut, tz="UTC")
        full = build_symbol(sym)["dec"]
        tr = build_symbol(sym, cut=cut)["dec"]
        full = full[full.index <= cut]
        tr = tr.reindex(full.index)
        for c in cols:
            x, y = full[c].values, tr[c].values
            if x.dtype == bool or y.dtype == bool or x.dtype == object:
                neq = (pd.Series(x).astype(float).fillna(-9).values
                       != pd.Series(y).astype(float).fillna(-9).values)
            else:
                neq = ~(np.isclose(x, y, equal_nan=True))
            if neq.any():
                bad.append(f"{sym}:{c}:{int(neq.sum())}")
    check("4 prefix-stable observables (inputs truncated at T; no look-ahead)",
          not bad, ";".join(bad) or "19 cols x 2 symbols identical up to cut")

    # 5. independent re-derivation of venue state and OI at random instants
    rng = np.random.default_rng(1)
    d = S["dec"]
    fb = venue_state("BTCUSDT", "bybit")
    mt = pd.read_parquet(os.path.join(DATA, "BTCUSDT-metrics.parquet")).set_index("ts")["sum_open_interest"]
    errs = 0
    for T in d.index[rng.integers(3000, len(d), 300)]:
        r = fb[fb.ts <= T]
        exp_hi = (len(r) and pd.notna(r.pct.iloc[-1]) and (T - r.ts.iloc[-1]) <= pd.Timedelta(hours=16)
                  and bool(r.hi.iloc[-1]))
        errs += bool(exp_hi) != bool(d.at[T, "bybit_hi"])
        o = mt[mt.index <= T - OI_LAG]
        o24 = mt[mt.index <= T - pd.Timedelta(hours=24) - OI_LAG]
        if len(o) and len(o24) and np.isfinite(d.at[T, "oi_d24h"]):
            errs += not np.isclose(o.iloc[-1] / o24.iloc[-1] - 1, d.at[T, "oi_d24h"])
    check("5 venue state / OI re-derived independently at 300 instants", errs == 0, f"mismatches {errs}")

    # 6. failed highs re-derived by a slow loop, confirmation bar <= T
    b = S["b15"]
    errs = 0
    for i in rng.integers(3000, len(d), 200):
        T = d.index[i]
        if not d["contig"].iat[i]:
            continue
        w = b[(b.index >= T - pd.Timedelta(hours=24)) & (b.index < T)]
        H = w.high.max(); atr = d["atr"].iat[i]; n = 0
        hs, cs = w.high.values, w.close.values
        for jj in range(1, len(w) - 1):
            if hs[jj] > hs[jj - 1] and hs[jj] > hs[jj + 1] and H - hs[jj] <= FH_ATR * atr and cs[jj] < H:
                n += 1
        # pivots j in [k-95, k-1] need hs[j-1]; the first bar of the window has
        # its left neighbour outside `w`, include it like prep does
        first = b.index.get_loc(w.index[0])
        if b.high.iat[first] > b.high.iat[first - 1] and b.high.iat[first] > b.high.iat[first + 1] \
                and H - b.high.iat[first] <= FH_ATR * atr and b.close.iat[first] < H:
            n += 1
        errs += n != d["fh"].iat[i]
    check("6 failed-high count re-derived (pivots confirmed by T)", errs == 0, f"mismatches {errs}/200")

    # 7-12: structural trade checks on a wide variant (R0, all BTC/SOL history)
    fails = []
    for sym in ("BTCUSDT", "SOLUSDT"):
        S = build_symbol(sym); d = S["dec"]; trig = Trig(S)
        for side in (-1, 1):
            a = armed_mask(d, side, "R0")
            win = (d.index[0], pd.Timestamp("2025-08-01", tz="UTC"))
            tr = pd.DataFrame(simulate(S, side, a, win, "T1R", trig=trig))
            if not len(tr):
                fails.append(f"{sym}{side}:no trades"); continue
            if not (tr.t_entry > tr.t_signal).all() or not (tr.t_entry <= tr.t_signal + ARM_WINDOW).all():
                fails.append(f"{sym}{side}:entry outside armed window")
            if not (tr.stop_dist > 0).all():
                fails.append(f"{sym}{side}:stop_dist")
            st = tr[tr.cause == "stop"]
            if not (np.isclose(st.priceR, -1) | (st.priceR < -1)).all():
                fails.append(f"{sym}{side}:stop priceR")
            tg = tr[tr.cause == "target"]
            if not np.isclose(tg.priceR, 1).all():
                fails.append(f"{sym}{side}:target priceR")
            if not (tr.hold_h <= TIME_STOP / pd.Timedelta(hours=1) + 1e-9).all():
                fails.append(f"{sym}{side}:hold > 5d")
            # one position at a time
            srt = tr.sort_values("t_entry")
            if (srt.t_entry.values[1:] < srt.t_exit.values[:-1]).any():
                fails.append(f"{sym}{side}:overlap")
            # settlements strictly inside (t_entry, t_exit), recounted
            fts = pd.to_datetime(S["fund"]["ts"], utc=True)
            for r in tr.sample(min(50, len(tr)), random_state=0).itertuples():
                n = int(((fts > r.t_entry) & (fts < r.t_exit)).sum())
                if n != r.n_sett:
                    fails.append(f"{sym}{side}:n_sett"); break
            # placebo forced to the real bar reproduces the trade
            for r in tr.head(20).itertuples():
                p = placebo_trade(S, side, r.k, r.atr_units, pd.Timestamp("2025-08-01", tz="UTC").value)
                if p is None or not np.isclose(p["netR"], r.netR):
                    fails.append(f"{sym}{side}:placebo-reproduce"); break
            # trigger level re-derived for P1 (first close below the impulse low)
            if side == -1:
                bb = S["b15"]
                for r in tr.head(30).itertuples():
                    k = r.k
                    w = bb.high.values[k - W15:k]
                    iH = k - W15 + len(w) - 1 - int(np.argmax(w[::-1]))
                    js = [j for j in range(iH - 1, iH - W15 - 1, -1) if bb.pl.values[j]]
                    L = bb.low.values[js[0]]
                    if not (bb.close.values[k] < L and (bb.close.values[iH + 1:k] >= L).all()):
                        fails.append(f"{sym}:p1 trigger"); break
    check("7-12 trades: entry in armed window, stop>0, stop=-1R/target=+1R, "
          "hold<=5d, no overlap, settlements recounted, placebo reproduces, P1 trigger",
          not fails, ";".join(fails) or "BTC+SOL, both sides, R0")

    # 13. evaluable windows are measured, printed
    ev = {s: build_symbol(s)["dec"].index[evaluable_mask(build_symbol(s)["dec"], -1)][0]
          for s in SYMBOLS}
    check("13 effective start measurable for every symbol", all(pd.notna(v) for v in ev.values()),
          "; ".join(f"{k[:-4]} {v:%Y-%m-%d}" for k, v in ev.items()))

    df = pd.DataFrame(RES)
    df.to_csv(os.path.join(OUT, "checks.csv"), index=False)
    print(f"\n{df.ok.sum()}/{len(df)} green")
    sys.exit(0 if df.ok.all() else 1)


if __name__ == "__main__":
    main()
