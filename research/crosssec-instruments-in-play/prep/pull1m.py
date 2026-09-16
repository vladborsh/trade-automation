#!/usr/bin/env python3
"""ARCHITECT-NOTE §8.2.1 — stage 2 of the two-stage pull.

From the 1d tapes alone, decide which (symbol, month) pairs can possibly hold
an eligible anchor day, using only the three eligibility rules that need no
1-minute data:

  rule 1  listed >= 30 days before the anchor
  rule 4  dATR14 (Wilder, UTC daily) defined on the last complete UTC day
  rule 5  14-day median daily quote volume >= 10,000,000 USDT

and pull the 1m monthly archives for those months **plus the month before**
(needed for the RVOL denominator's prior 14 anchor days and for P(A - 24 h)).

Writes data/1m/<SYM>.parquet, results/eligible_months.json and
results/history_audit_1m.json.  Then the STOP-RULE identity check: the freshly
pulled BTCUSDT / ETHUSDT 1m tapes must be bit-for-bit identical, over the
common span, to the already-audited tapes in research/cmc-bot-vwap/data/.

No R is computed here.
"""
from __future__ import annotations
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, PKG)
import fetch as F  # noqa: E402
import common as C  # noqa: E402

AUDIT_SYMS = ("BTCUSDT", "ETHUSDT")


# --------------------------------------------------------------- daily rules
def daily_flags(sym: str) -> pd.DataFrame | None:
    """Per UTC day d: is rule 1/4/5 satisfiable for an anchor on the NY date d?

    The anchor on NY date d sits at 13:30/14:30 UTC on the same UTC date, so
    'the last complete UTC day before the anchor' is UTC day d-1. Everything
    below is therefore evaluated with a one-day shift and is strictly causal.
    """
    p = os.path.join(C.DATA_1D, f"{sym}.parquet")
    if not os.path.exists(p):
        return None
    df = pd.read_parquet(p)
    if len(df) < C.ATR_N + 2:
        return None
    df = df.drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
    ts = pd.to_datetime(df.t_ms, unit="ms", utc=True)
    atr = C.atr_wilder(df.high.values, df.low.values, df.close.values, C.ATR_N)
    # median of the 14 complete UTC days ENDING at this day (inclusive)
    med = pd.Series(df.quote_volume.values).rolling(C.LIQ_LOOKBACK).median().values
    first_ms = int(df.t_ms.iloc[0])
    out = pd.DataFrame(dict(
        prev_date=ts.dt.strftime("%Y-%m-%d").values,   # the complete UTC day
        atr_prev=atr, liq_med_prev=med,
        close_prev=df.close.values, t_ms_prev=df.t_ms.values))
    # shift forward: these are the values available to the anchor on the NEXT day
    out["date"] = (ts + pd.Timedelta(days=1)).dt.strftime("%Y-%m-%d").values
    out["listed_days"] = (out.t_ms_prev + C.DAY_MS - first_ms) / C.DAY_MS
    out["r1"] = out.listed_days >= C.MIN_LISTED_DAYS
    out["r4"] = np.isfinite(out.atr_prev) & (out.atr_prev > 0)
    out["r5"] = np.isfinite(out.liq_med_prev) & (out.liq_med_prev >= C.LIQ_FLOOR)
    out["cand"] = out.r1 & out.r4 & out.r5
    out["symbol"] = sym
    return out


def main() -> None:
    ap = __import__("argparse").ArgumentParser()
    ap.add_argument("--audit-only", action="store_true")
    a = ap.parse_args()

    u = pd.read_csv(os.path.join(C.RESULTS, "universe.csv"))
    syms = list(u.symbol)
    nyse = set(C.nyse_days(C.FIT_START, C.HOLD_END))

    print("deriving candidate symbol-months from the 1d tapes ...", flush=True)
    flags, need = [], {}
    for s in syms:
        f = daily_flags(s)
        if f is None:
            continue
        # daily_flags keeps EVERY date (the weekend row and the two fit-only
        # placebo anchors of §3.3 need non-NYSE dates); the candidate-month
        # derivation below uses NYSE full days only.
        flags.append(f[["symbol", "date", "atr_prev", "liq_med_prev",
                        "listed_days", "r1", "r4", "r5", "cand"]])
        c = f[f.cand & f.date.isin(nyse)]
        if not len(c):
            continue
        months = sorted({d[:7] for d in c.date})
        prev = sorted({(pd.Period(m, "M") - 1).strftime("%Y-%m") for m in months})
        need[s] = sorted(set(months) | set(prev))
    pd.concat(flags, ignore_index=True).to_parquet(
        os.path.join(C.RESULTS, "daily_flags.parquet"), index=False)
    with open(os.path.join(C.RESULTS, "eligible_months.json"), "w") as fh:
        json.dump(need, fh, indent=1)
    tot = sum(len(v) for v in need.values())
    print(f"  {len(need)} symbols have at least one candidate day; "
          f"{tot} symbol-months to pull")

    if a.audit_only:
        return

    t0 = time.time()
    done = [0]

    def one(sym: str) -> dict:
        out = os.path.join(C.DATA_1M, f"{sym}.parquet")
        months = need[sym]
        if os.path.exists(out):
            df = pd.read_parquet(out)
        else:
            with ThreadPoolExecutor(max_workers=8) as ex:
                parts = list(ex.map(lambda ym: F.fetch_klines(sym, ym, "1m"), months))
            df = F.norm_klines(parts)
            if not len(df):
                return dict(symbol=sym, error="empty 1m")
            df.to_parquet(out, index=False, compression="zstd")
        g = F.gaps(df.t_ms.values, C.MIN_MS)
        done[0] += 1
        if done[0] % 20 == 0:
            print(f"  {done[0]}/{len(need)}  {time.time()-t0:.0f}s", flush=True)
        return dict(symbol=sym, months=len(months), rows=len(df),
                    first_bar=str(pd.Timestamp(int(df.t_ms.iloc[0]), unit="ms", tz="UTC")),
                    last_bar=str(pd.Timestamp(int(df.t_ms.iloc[-1]), unit="ms", tz="UTC")),
                    n_gaps=len(g), missing_minutes=int(sum(x["missing"] for x in g)))

    with ThreadPoolExecutor(max_workers=6) as ex:
        rows = list(ex.map(one, sorted(need)))

    # ------------------------------------------------ STOP RULE §11.1 / §8.2.1
    ident = {}
    for s in AUDIT_SYMS:
        ap_ = os.path.join(C.AUDITED, f"{s}_1m.parquet")
        if not os.path.exists(ap_):
            ident[s] = dict(checked=False, reason=f"no audited tape at {ap_}")
            continue
        base = pd.read_parquet(ap_).drop_duplicates("t_ms").sort_values("t_ms")
        new = pd.read_parquet(os.path.join(C.DATA_1M, f"{s}.parquet"))
        lo, hi = max(base.t_ms.min(), new.t_ms.min()), min(base.t_ms.max(), new.t_ms.max())
        b = base[(base.t_ms >= lo) & (base.t_ms <= hi)].reset_index(drop=True)
        n = new[(new.t_ms >= lo) & (new.t_ms <= hi)].reset_index(drop=True)
        same_rows = len(b) == len(n)
        same_t = same_rows and bool((b.t_ms.values == n.t_ms.values).all())
        cols = {c: (same_t and bool((b[c].values == n[c].values).all()))
                for c in ("open", "high", "low", "close", "volume")}
        ident[s] = dict(checked=True, span=[str(pd.Timestamp(int(lo), unit='ms', tz='UTC')),
                                            str(pd.Timestamp(int(hi), unit='ms', tz='UTC'))],
                        rows_audited=len(b), rows_new=len(n), same_row_count=same_rows,
                        same_timestamps=same_t, identical=all(cols.values()), per_column=cols)
        print(f"  identity {s}: rows {len(b)} vs {len(n)}  identical={all(cols.values())}")

    with open(os.path.join(C.RESULTS, "history_audit_1m.json"), "w") as fh:
        json.dump(dict(symbols=rows, identity_check=ident), fh, indent=1)
    bad = [r for r in rows if "error" in r]
    print(f"1m pull: {len(rows)-len(bad)} symbols ok, {len(bad)} errors, "
          f"{time.time()-t0:.0f}s")
    if any(v.get("checked") and not v["identical"] for v in ident.values()):
        raise SystemExit("STOP RULE §11.8: the BTC/ETH 1m identity check FAILED. "
                         "Return to Architect.")


if __name__ == "__main__":
    main()
