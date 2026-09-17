#!/usr/bin/env python3
"""Stage 0 for the COIN-M inverse cash-and-carry pass (DESIGN §11).

Gates (each is a stop rule; a failure escalates, it does not get worked round):

  G1  COIN-M funding REST-vs-archive IDENTITY on the 2022-07 .. 2026-06 overlap
  G2  contract multipliers and the bracket-1 mmr asserted from the exchange
  G3  grids: settlement-on-a-bar-open, interval changes, duplicates, gaps
  G4  basis |b| > 5 % anomaly listing on both legs
  G5  COIN-M vs USD-M funding over the same dates (a REPORT deliverable)

Writes results/data_audit*.csv and results/stage0.json.  Computes no return.
"""
from __future__ import annotations
import json, os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PERPS, SPOT_OF, PAIR_OF, CONTRACT_SIZE, MMR, OUT, DATA,
                    FIT_END, HOLD_START, HOLD_END, TAIL_END, BASIS_ANOM,
                    load_cm_funding, load_um_funding, load_klines)

FAILS = []


def gate(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {detail}", flush=True)
    if not ok:
        FAILS.append(f"{name}: {detail}")
    return ok


def main():
    rows, anom, fund_cmp = [], [], []
    stage0 = {}

    # ---- G2 -----------------------------------------------------------------
    print("G2 contract multipliers / mmr (from GET /dapi/v1/exchangeInfo and "
          "the published COIN-M bracket table, recorded in results/exchange_facts.json)")
    ef = json.load(open(os.path.join(OUT, "exchange_facts.json")))
    for p in PERPS:
        pair = PAIR_OF[p]
        gate(f"{p} contractSize", float(ef[p]["contractSize"]) == CONTRACT_SIZE[pair],
             f"{ef[p]['contractSize']} vs pinned {CONTRACT_SIZE[pair]}")
        gate(f"{p} bracket-1 mmr", float(ef[p]["bracket1_mmr"]) == MMR[pair],
             f"{ef[p]['bracket1_mmr']} vs pinned {MMR[pair]}")
        gate(f"{p} marginAsset", ef[p]["marginAsset"] == pair.replace("USD", ""),
             ef[p]["marginAsset"])

    # ---- G1, G3, G4, G5 -----------------------------------------------------
    for p in PERPS:
        sp = SPOT_OF[p]
        fa = load_cm_funding(p, "archive")
        fr = load_cm_funding(p, "rest")
        fm = load_cm_funding(p, "merged")
        cm = load_klines(p, "cm1h")
        sk = load_klines(sp, "spot1h")
        uf = load_um_funding(sp)

        # G1 identity on the overlap
        lo, hi = fa.ts.min(), fa.ts.max()
        ov = fa[["ts", "last_funding_rate"]].merge(
            fr[["ts", "last_funding_rate"]], on="ts", how="outer",
            suffixes=("_arch", "_rest"), indicator=True)
        ov = ov[(ov.ts >= lo) & (ov.ts <= hi)]
        only_a = int((ov._merge == "left_only").sum())
        only_r = int((ov._merge == "right_only").sum())
        both = ov[ov._merge == "both"]
        maxdiff = float((both.last_funding_rate_arch -
                         both.last_funding_rate_rest).abs().max())
        gate(f"G1 {p} REST==archive on every SHARED settlement",
             maxdiff == 0.0,
             f"n_shared={len(both)} max|diff|={maxdiff:.3e}")
        gate(f"G1b {p} archive has no settlement REST lacks", only_a == 0,
             f"archive_only={only_a}")
        # the monthly archive file omits the last 2-3 settlements of each
        # month; the merged stream is the union and must be a complete grid.
        full = pd.date_range(fm.ts.iloc[0], fm.ts.iloc[-1], freq="8h", tz="UTC")
        miss = len(full) - len(fm)
        # DESIGN §3.3 rule 1: a missing settlement contributes zero funding,
        # is flagged and carries no decision.  Escalate above 0.5 % of grid.
        missing_ts = sorted(set(full) - set(fm.ts))
        gate(f"G1c {p} merged funding grid complete to within 0.5 %",
             miss / len(full) <= 0.005,
             f"expected={len(full)} got={len(fm)} missing={miss} "
             f"({100*miss/len(full):.4f} %) at {[str(t) for t in missing_ts]} "
             f"(archive omits {only_r} month-end settlements, REST supplies them)")

        # G3 grids
        iv = fa.funding_interval_hours.dropna().astype(int)
        ivc = iv.value_counts().to_dict()
        gate(f"G3 {p} funding interval == 8h everywhere",
             set(ivc) == {8}, str(ivc))
        d = fm.ts.diff().dropna().dt.total_seconds() / 3600.0
        gaps = int((d > 8.0).sum())
        onbar = bool((fm.ts.dt.minute == 0).all() and
                     (fm.ts.dt.hour % 8 == 0).all())
        gate(f"G3 {p} every settlement on a 8h bar open", onbar,
             f"gaps>8h={gaps}")

        # kline grid
        for nm, kl in ((f"{p} cm1h", cm), (f"{sp} spot1h", sk)):
            full = pd.date_range(kl.ts.iloc[0], kl.ts.iloc[-1], freq="1h", tz="UTC")
            miss = len(full) - len(kl)
            rows.append(dict(symbol=nm, n=len(kl), first=kl.ts.iloc[0],
                             last=kl.ts.iloc[-1], missing_hours=miss,
                             missing_pct=round(100 * miss / len(full), 4)))

        # G4 basis anomalies (inner join of the two 1h grids)
        j = cm[["ts", "close"]].merge(sk[["ts", "close"]], on="ts",
                                      suffixes=("_cm", "_sp"))
        j["b"] = j.close_cm / j.close_sp - 1.0
        bad = j[j.b.abs() > BASIS_ANOM]
        for _, r in bad.iterrows():
            anom.append(dict(symbol=p, ts=r.ts, perp=r.close_cm,
                             spot=r.close_sp, basis=round(r.b, 6)))
        gate(f"G4 {p} |basis|>5% bars listed", True,
             f"{len(bad)} of {len(j)} ({100*len(bad)/len(j):.4f} %), "
             f"median b={j.b.median():+.6f}")
        rows.append(dict(symbol=f"{p} basis", n=len(j), first=j.ts.iloc[0],
                         last=j.ts.iloc[-1], missing_hours=np.nan,
                         missing_pct=np.nan))

        # G5 COIN-M vs USD-M funding on the same dates
        m = fm.merge(uf[["ts", "last_funding_rate"]], on="ts",
                     suffixes=("_cm", "_um"))
        for lbl, a, b in (("fit", m.ts.min(), FIT_END),
                          ("holdout", HOLD_START, HOLD_END),
                          ("all", m.ts.min(), TAIL_END)):
            w = m[(m.ts >= a) & (m.ts < b)]
            if not len(w):
                continue
            fund_cmp.append(dict(
                symbol=p, window=lbl, n=len(w),
                cm_mean_pct8h=round(100 * w.last_funding_rate_cm.mean(), 6),
                um_mean_pct8h=round(100 * w.last_funding_rate_um.mean(), 6),
                cm_pa_pct=round(100 * w.last_funding_rate_cm.mean() * 3 * 365, 3),
                um_pa_pct=round(100 * w.last_funding_rate_um.mean() * 3 * 365, 3),
                cm_median_pct8h=round(100 * w.last_funding_rate_cm.median(), 6),
                um_median_pct8h=round(100 * w.last_funding_rate_um.median(), 6),
                corr=round(float(w.last_funding_rate_cm.corr(
                    w.last_funding_rate_um)), 4),
                cm_neg_share=round(float((w.last_funding_rate_cm < 0).mean()), 4),
                um_neg_share=round(float((w.last_funding_rate_um < 0).mean()), 4),
            ))

        stage0[p] = dict(
            cm_fund_archive_n=len(fa), cm_fund_rest_n=len(fr),
            cm_fund_merged_n=len(fm),
            cm_fund_first=str(fm.ts.iloc[0]), cm_fund_last=str(fm.ts.iloc[-1]),
            cm1h_n=len(cm), cm1h_first=str(cm.ts.iloc[0]),
            spot1h_n=len(sk), spot1h_first=str(sk.ts.iloc[0]),
            basis_median=float(j.b.median()), basis_p99=float(j.b.quantile(.99)),
            basis_anom=int(len(bad)),
        )

    pd.DataFrame(rows).to_csv(os.path.join(OUT, "data_audit.csv"), index=False)
    pd.DataFrame(anom).to_csv(os.path.join(OUT, "data_audit_anomalies.csv"),
                              index=False)
    fc = pd.DataFrame(fund_cmp)
    fc.to_csv(os.path.join(OUT, "funding_cm_vs_um.csv"), index=False)
    print("\nG5 COIN-M vs USD-M funding, same settlement times:")
    print(fc.to_string(index=False))

    stage0["fails"] = FAILS
    json.dump(stage0, open(os.path.join(OUT, "stage0.json"), "w"),
              indent=1, default=str)
    print(f"\n{'STAGE 0 PASSED' if not FAILS else 'STAGE 0 FAILED: ' + '; '.join(FAILS)}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
