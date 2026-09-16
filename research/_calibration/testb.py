#!/usr/bin/env python3
"""TEST B — the overnight index premium through the same tape and primitives.

`DESIGN.md` Test B. Two arms on the Capital.com 1m tape over the `orb-ny-open`
FIT window:

  B-ON   buy the 16:00 NY bar's close on session day t, sell the 09:30 NY
         bar's close on session day t+1;
  B-DAY  the mirror, buy 09:30 close, sell 16:00 close, same day.

The **gate** (B1) is an identity check: the price the engine's own locating
primitives (`common.ny_ms`, `np.searchsorted` over `Tape.t`, and
`engine.flat_index` itself) return must reproduce the number a completely
independent pandas tz-conversion path returns from the same parquet. Two
independent implementations of "which bar is 16:00 NY".

    python testb.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ORB = os.path.join(REPO, "research", "orb-ny-open")
sys.path.insert(0, ORB)

import common as C  # noqa: E402
C.TAIL_END = C.FIT_END
C.TAIL_START = C.FIT_END
import engine as E  # noqa: E402

RESULTS = os.path.join(HERE, "results")
os.makedirs(RESULTS, exist_ok=True)

PAIRS = [("US500", "SPY"), ("US100", "QQQ")]
FIN_BP = (1.1, 2.4)               # DESIGN B.4, red team §3: SOFR + 4 % p.a.
CLOSE_HM = (15, 59)               # the bar ENDING at 16:00 NY (engine convention)
OPEN_HM = (9, 30)                 # the bar OPENING at 09:30 NY


# ==========================================================================
# Path 1 — the engine's own locating primitives
# ==========================================================================
def engine_prices(sym: str, days: list[str]) -> pd.DataFrame:
    tp = E.Tape.get(sym)
    rows = []
    for d in days:
        i_cl = E.flat_index(tp, d)                       # engine's own function
        t_cl = C.ny_ms(d, *CLOSE_HM)
        ok_cl = i_cl >= 0 and tp.t[i_cl] == t_cl
        j = int(np.searchsorted(tp.t, C.ny_ms(d, *OPEN_HM), "left"))
        ok_op = j < tp.n and tp.t[j] == C.ny_ms(d, *OPEN_HM)
        rows.append(dict(date=d,
                         i_close=i_cl if ok_cl else -1,
                         px_close=float(tp.c[i_cl]) if ok_cl else np.nan,
                         sp_close=float(tp.spread[i_cl]) if ok_cl else np.nan,
                         i_open=j if ok_op else -1,
                         px_open=float(tp.c[j]) if ok_op else np.nan,
                         sp_open=float(tp.spread[j]) if ok_op else np.nan))
    return pd.DataFrame(rows)


# ==========================================================================
# Path 2 — an independent pandas tz-conversion over the same parquet
# ==========================================================================
def arithmetic_prices(sym: str, days: list[str]) -> pd.DataFrame:
    df = pd.read_parquet(os.path.join(C.SRC_DATA, f"{sym}_1m.parquet"))
    ny = pd.to_datetime(df.t_ms, unit="ms", utc=True).dt.tz_convert("America/New_York")
    df = df.assign(d=ny.dt.strftime("%Y-%m-%d"), hm=ny.dt.strftime("%H:%M"))
    cl = df[df.hm == f"{CLOSE_HM[0]:02d}:{CLOSE_HM[1]:02d}"].set_index("d")
    op = df[df.hm == f"{OPEN_HM[0]:02d}:{OPEN_HM[1]:02d}"].set_index("d")
    return pd.DataFrame(dict(
        date=days,
        px_close=[float(cl.close.loc[d]) if d in cl.index else np.nan for d in days],
        px_open=[float(op.close.loc[d]) if d in op.index else np.nan for d in days]))


# ==========================================================================
# Yahoo daily — DESIGN B.3, pulled independently of the CFD tape
# ==========================================================================
URL = ("https://query1.finance.yahoo.com/v8/finance/chart/{s}"
       "?period1={a}&period2={b}&interval=1d")


def yahoo_daily(sym: str, start: str, end: str) -> pd.DataFrame:
    a = int(pd.Timestamp(start, tz="UTC").timestamp()) - 86400 * 7
    b = int(pd.Timestamp(end, tz="UTC").timestamp()) + 86400 * 7
    req = urllib.request.Request(URL.format(s=sym, a=a, b=b),
                                 headers={"User-Agent": "Mozilla/5.0"})
    j = json.loads(urllib.request.urlopen(req, timeout=60).read())
    r = j["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    t = pd.to_datetime(r["timestamp"], unit="s", utc=True).tz_convert("America/New_York")
    return pd.DataFrame(dict(date=t.strftime("%Y-%m-%d"),
                             open=q["open"], close=q["close"])).dropna()


def main() -> None:
    days = C.nyse_days(C.FIT_START, C.FIT_END)
    out, ext, weekly = [], [], []
    for sym, etf in PAIRS:
        eng = engine_prices(sym, days)
        ari = arithmetic_prices(sym, days)

        # ---- the two locating paths must agree bar for bar ---------------
        mask = eng.px_close.notna() & ari.px_close.notna()
        dev_c = float(np.nanmax(np.abs(eng.px_close[mask] - ari.px_close[mask]))) \
            if mask.any() else np.nan
        mask_o = eng.px_open.notna() & ari.px_open.notna()
        dev_o = float(np.nanmax(np.abs(eng.px_open[mask_o] - ari.px_open[mask_o]))) \
            if mask_o.any() else np.nan
        n_miss = int((eng.i_close < 0).sum() + (eng.i_open < 0).sum())

        # ---- B-ON: close(t) -> open(t+1), consecutive session days -------
        e = eng.set_index("date")
        rows = []
        for t0, t1 in zip(days[:-1], days[1:]):
            a, b = e.loc[t0], e.loc[t1]
            if not np.isfinite(a.px_close) or not np.isfinite(b.px_open):
                continue
            nights = (pd.Timestamp(t1) - pd.Timestamp(t0)).days
            gross = 100.0 * (b.px_open / a.px_close - 1.0)
            cost = 100.0 * ((a.sp_close + b.sp_open) / 2.0) / a.px_close
            rows.append(dict(d0=t0, d1=t1, nights=nights, gross_pct=gross,
                             cost_pct=cost, net_pct=gross - cost,
                             entry=a.px_close, exit=b.px_open))
        ON = pd.DataFrame(rows)

        # ---- B-DAY: open(t) -> close(t), the mirror ----------------------
        rows = []
        for t0 in days:
            a = e.loc[t0]
            if not np.isfinite(a.px_open) or not np.isfinite(a.px_close):
                continue
            gross = 100.0 * (a.px_close / a.px_open - 1.0)
            cost = 100.0 * ((a.sp_open + a.sp_close) / 2.0) / a.px_open
            rows.append(dict(d0=t0, gross_pct=gross, cost_pct=cost,
                             net_pct=gross - cost))
        DAY = pd.DataFrame(rows)

        # ---- independent arithmetic over the IDENTICAL matched day list --
        ai = ari.set_index("date")
        ar_on = np.array([100.0 * (ai.px_open.loc[r.d1] / ai.px_close.loc[r.d0] - 1.0)
                          for r in ON.itertuples()])
        ar_day = np.array([100.0 * (ai.px_close.loc[r.d0] / ai.px_open.loc[r.d0] - 1.0)
                           for r in DAY.itertuples()])

        sp = float(ON.cost_pct.mean())
        eng_gross, eng_net = float(ON.gross_pct.mean()), float(ON.net_pct.mean())
        ar_mean = float(ar_on.mean())
        out.append(dict(
            instrument=sym, arm="B-ON", n=len(ON), n_unmatched_bars=n_miss,
            engine_gross_pct=eng_gross, engine_net_pct=eng_net,
            arithmetic_gross_pct=ar_mean,
            dev_gross_vs_arith=abs(eng_gross - ar_mean),
            dev_net_vs_arith=abs(eng_net - ar_mean),
            mean_spread_cost_pct=sp,
            B1_within_spread=bool(abs(eng_net - ar_mean) <= sp * (1 + 1e-9)),
            B1_dev_minus_spread=float(abs(eng_net - ar_mean) - sp),
            B1_gross_identity=bool(abs(eng_gross - ar_mean) < 1e-12),
            max_px_dev_close=dev_c, max_px_dev_open=dev_o,
            sd_pct=float(ON.gross_pct.std(ddof=1)),
            t_gross=float(ON.gross_pct.mean() / (ON.gross_pct.std(ddof=1)
                                                 / np.sqrt(len(ON)))),
            ann_sharpe=float(ON.gross_pct.mean() / ON.gross_pct.std(ddof=1)
                             * np.sqrt(252)),
            fin_lo_pct=float(-FIN_BP[0] / 100.0 * ON.nights.mean()),
            fin_hi_pct=float(-FIN_BP[1] / 100.0 * ON.nights.mean()),
            net_after_fin_lo=float(eng_net - FIN_BP[0] / 100.0 * ON.nights.mean()),
            net_after_fin_hi=float(eng_net - FIN_BP[1] / 100.0 * ON.nights.mean()),
            mean_nights=float(ON.nights.mean())))
        out.append(dict(
            instrument=sym, arm="B-DAY", n=len(DAY), n_unmatched_bars=n_miss,
            engine_gross_pct=float(DAY.gross_pct.mean()),
            engine_net_pct=float(DAY.net_pct.mean()),
            arithmetic_gross_pct=float(ar_day.mean()),
            dev_gross_vs_arith=abs(float(DAY.gross_pct.mean()) - float(ar_day.mean())),
            dev_net_vs_arith=abs(float(DAY.net_pct.mean()) - float(ar_day.mean())),
            mean_spread_cost_pct=float(DAY.cost_pct.mean()),
            B1_within_spread=bool(abs(float(DAY.net_pct.mean()) - float(ar_day.mean()))
                                  <= float(DAY.cost_pct.mean()) * (1 + 1e-9)),
            B1_dev_minus_spread=float(abs(float(DAY.net_pct.mean())
                                          - float(ar_day.mean()))
                                      - float(DAY.cost_pct.mean())),
            B1_gross_identity=bool(abs(float(DAY.gross_pct.mean())
                                       - float(ar_day.mean())) < 1e-12),
            max_px_dev_close=dev_c, max_px_dev_open=dev_o,
            sd_pct=float(DAY.gross_pct.std(ddof=1)),
            t_gross=float(DAY.gross_pct.mean() / (DAY.gross_pct.std(ddof=1)
                                                  / np.sqrt(len(DAY)))),
            ann_sharpe=float(DAY.gross_pct.mean() / DAY.gross_pct.std(ddof=1)
                             * np.sqrt(252)),
            fin_lo_pct=0.0, fin_hi_pct=0.0,
            net_after_fin_lo=float(DAY.net_pct.mean()),
            net_after_fin_hi=float(DAY.net_pct.mean()), mean_nights=0.0))

        ON.assign(instrument=sym, arm="B-ON").to_csv(
            os.path.join(RESULTS, f"testB_{sym}_ON.csv"), index=False)

        # ---- B3/B4: the ETF, independent source, identical day list ------
        try:
            y = yahoo_daily(etf, C.FIT_START, C.FIT_END).set_index("date")
            pairs = [(r.d0, r.d1) for r in ON.itertuples()
                     if r.d0 in y.index and r.d1 in y.index]
            yon = np.array([100.0 * (y.open.loc[b] / y.close.loc[a] - 1.0)
                            for a, b in pairs])
            yday = np.array([100.0 * (y.close.loc[a] / y.open.loc[a] - 1.0)
                             for a, b in pairs])
            ext.append(dict(cfd=sym, etf=etf, n=len(pairs),
                            etf_close_to_open_pct=float(yon.mean()),
                            etf_open_to_close_pct=float(yday.mean()),
                            cfd_close_to_open_pct=eng_gross,
                            cfd_open_to_close_pct=float(DAY.gross_pct.mean()),
                            same_sign=bool(np.sign(yon.mean()) == np.sign(eng_gross)),
                            diff_bp=float((eng_gross - yon.mean()) * 100.0),
                            B4_within_3bp=bool(abs(eng_gross - yon.mean()) * 100 <= 3.0),
                            etf_t=float(yon.mean() / (yon.std(ddof=1) / np.sqrt(len(yon))))))
        except Exception as exc:                                   # noqa: BLE001
            ext.append(dict(cfd=sym, etf=etf, error=str(exc)))

    O = pd.DataFrame(out)
    X = pd.DataFrame(ext)
    O.to_csv(os.path.join(RESULTS, "testB_overnight.csv"), index=False)
    X.to_csv(os.path.join(RESULTS, "testB_external.csv"), index=False)
    pd.set_option("display.width", 220)
    print(O[["instrument", "arm", "n", "engine_gross_pct", "engine_net_pct",
             "arithmetic_gross_pct", "dev_gross_vs_arith", "dev_net_vs_arith",
             "mean_spread_cost_pct", "B1_dev_minus_spread", "B1_within_spread", "B1_gross_identity",
             "max_px_dev_close", "max_px_dev_open"]].to_string(index=False))
    print()
    print(O[["instrument", "arm", "t_gross", "ann_sharpe", "mean_nights",
             "net_after_fin_lo", "net_after_fin_hi"]].to_string(index=False))
    print()
    print(X.to_string(index=False))

    bad = O[~O.B1_within_spread]
    if len(bad):
        print("\n*** B1 STOP CONDITION TRIGGERED ***")
        print(bad.to_string(index=False))
    else:
        print("\nB1 PASSES on every arm: engine agrees with the tape's own "
              "arithmetic to better than the applied spread.")


if __name__ == "__main__":
    main()
