#!/usr/bin/env python3
"""Stage 1 — the FIT period only (DESIGN §3.4).  No holdout number is computed
here; `stage2_holdout.py` refuses to run until results/screen.json exists.

Writes:
  results/fit_arms.csv           arm A, the overlay, the price shadow, arm B
  results/fit_positions.csv      every position of arm A
  results/fit_sensitivities.csv  every fit-only sensitivity
  results/fit_buffer.csv         the buffer table (replaces the margin table)
  results/fit_persistence.csv    the mechanism prerequisite for the overlay
  results/fit_nulls.csv          Null A and Null B on the overlay and arm B
  results/armb_trades.csv
"""
from __future__ import annotations
import os, sys
from dataclasses import replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PERPS, PAIR_OF, MMR, C_TIER, SLOTS, OUT, FIT_END,
                    ON_LEVEL, OFF_LEVEL, BUFFER_FRAC, QB_THRESHOLD,
                    QB_MIN_DAYS, ann_mean, block_bootstrap_p)
import engine, portfolio, armb
from engine import Cfg

CFG = Cfg()
SEED = 20260917


def main():
    start = portfolio.tier_start()
    print(f"tier start {start.date()}  fit end {FIT_END.date()}")
    rows, sens = [], []

    # ---------------- arm A, the primary ------------------------------------
    dA, pA, eA = portfolio.run_tier("always", CFG, start, FIT_END)
    sA = portfolio.stats(dA, pA, eA, "ARM A - passive inverse carry (PRIMARY)")
    rows.append(sA)
    pA.to_csv(os.path.join(OUT, "fit_positions.csv"), index=False)

    # ---------------- the funding-gate overlay (fit-only, non-gating) -------
    dO, pO, eO = portfolio.run_tier("hysteresis", CFG, start, FIT_END)
    rows.append(portfolio.stats(dO, pO, eO,
                                "funding-gate overlay (fit-only, non-gating)"))

    # ---------------- the price-gated shadow --------------------------------
    dP, pP, eP = portfolio.run_tier("price", CFG, start, FIT_END)
    rows.append(portfolio.stats(dP, pP, eP, "price-gated shadow (descriptive)"))

    # ---------------- arm B --------------------------------------------------
    dB, tB = armb.run(QB_THRESHOLD, QB_MIN_DAYS, FIT_END)
    rows.append(armb.stats(dB, tB, "ARM B - quarterly basis (PRIMARY)"))
    dBh, tBh = armb.run(QB_THRESHOLD, QB_MIN_DAYS, FIT_END, always_hold=True)
    rows.append(armb.stats(dBh, tBh, "arm B always-hold benchmark"))
    tB.to_csv(os.path.join(OUT, "armb_trades.csv"), index=False)

    arms = pd.DataFrame(rows)
    arms.to_csv(os.path.join(OUT, "fit_arms.csv"), index=False)
    print("\n--- FIT ARMS ---")
    cols = ["label", "net_pa", "p_boot", "ci90_lo", "ci90_hi", "boot_se_pa",
            "sharpe", "maxdd_pct", "utilisation", "on_slot_days", "trade_days",
            "n_positions", "n_trades"]
    print(arms[[c for c in cols if c in arms]].to_string(index=False))
    print("\n--- decomposition ---")
    dcols = ["label", "funding_pa", "hedge_pa", "fee_pa", "sweep_pa",
             "cost_carry_ratio", "mean_settle", "median_hold_days",
             "min_buffer", "min_buffer_frac", "n_buffer_breach"]
    print(arms[[c for c in dcols if c in arms]].to_string(index=False))

    # ---------------- the buffer table ---------------------------------------
    brows = []
    for _, p in pA.iterrows():
        brows.append(dict(arm="A", symbol=p.symbol, t_entry=p.t_entry,
                          N=p.N, buffer0=p.buffer0,
                          buffer0_frac_of_N=p.buffer0 / p.N,
                          min_buffer=p.min_buffer,
                          min_buffer_frac=p.min_buffer / p.buffer0,
                          n_settle=p.n_settle, funding=p.funding,
                          sweep=p.sweep))
    bt = pd.DataFrame(brows)
    bt.to_csv(os.path.join(OUT, "fit_buffer.csv"), index=False)
    print("\n--- BUFFER TABLE (replaces the margin table) ---")
    print(bt.to_string(index=False))

    # b*: the smallest buffer fraction that survives the fit window
    bstar = []
    for frac in (0.005, 0.01, 0.02, 0.03, 0.05, 0.10):
        c = replace(CFG, buffer_frac=frac)
        d, p, e = portfolio.run_tier("always", c, start, FIT_END)
        nb = int((e.kind == "buffer_breach").sum()) if len(e) else 0
        bstar.append(dict(buffer_frac=frac, net_pa=round(100*ann_mean(
            d.r.dropna().values), 4), n_breach=nb,
            min_buffer_frac=round(float((p.min_buffer/p.buffer0).min()), 4)))
    bs = pd.DataFrame(bstar)
    bs.to_csv(os.path.join(OUT, "fit_bstar.csv"), index=False)
    print("\n--- b* ladder (buffer fraction vs survival) ---")
    print(bs.to_string(index=False))

    # ---------------- mechanism prerequisite (overlay) -----------------------
    pers = []
    for s in PERPS:
        f = engine.settlements(s)
        f = f[(f.ts >= start) & (f.ts < FIT_END)]
        st = engine.gate_hysteresis(engine.settlements(s)).reindex(f.index)
        on, off = f.f[st.values], f.f[~st.values]
        row = dict(symbol=s, n_on=len(on), n_off=len(off),
                   mean_on_pct=round(100*on.mean(), 6),
                   mean_off_pct=round(100*off.mean(), 6),
                   median_on_pct=round(100*on.median(), 6),
                   median_off_pct=round(100*off.median(), 6),
                   ratio_mean=round(float(on.mean()/off.mean()), 3)
                   if off.mean() else np.nan)
        # survival of the ON state
        v = st.values
        starts = np.where(v & ~np.concatenate([[False], v[:-1]]))[0]
        lens = []
        for i in starts:
            j = i
            while j < len(v) and v[j]:
                j += 1
            lens.append(j - i)
        lens = np.array(lens)
        for k in (3, 9, 15, 30, 60, 90):
            row[f"surv_{k}"] = round(float((lens >= k).mean()), 3) if len(lens) else np.nan
        row["n_episodes"] = len(lens)
        row["mean_episode"] = round(float(lens.mean()), 1) if len(lens) else np.nan
        pers.append(row)
    pf = pd.DataFrame(pers)
    pf.to_csv(os.path.join(OUT, "fit_persistence.csv"), index=False)
    print("\n--- MECHANISM PREREQUISITE (the overlay's gate) ---")
    print(pf.to_string(index=False))

    # ---------------- sensitivities, all fit-only ---------------------------
    def add(label, d, p, e):
        st = portfolio.stats(d, p, e, label, boot=False)
        sens.append(dict(sensitivity=label, net_pa=st["net_pa"],
                         funding_pa=st.get("funding_pa"),
                         hedge_pa=st.get("hedge_pa"),
                         cost_pa=st.get("cost_pa"),
                         min_buffer_frac=st.get("min_buffer_frac"),
                         n_buffer_breach=st["n_buffer_breach"],
                         utilisation=st["utilisation"]))

    add("PRIMARY (arm A)", dA, pA, eA)
    add("(iii) COIN-M maker on entry",
        *portfolio.run_tier("always", replace(CFG, entry_maker=True),
                            start, FIT_END))
    for frac in (0.02, 0.10):
        add(f"(iv) buffer b = {frac:.2f} N",
            *portfolio.run_tier("always", replace(CFG, buffer_frac=frac),
                                start, FIT_END))
    add("(vi) UNSWEPT funding (directional variant)",
        *portfolio.run_tier("always", replace(CFG, sweep=False),
                            start, FIT_END))
    add("(vii) slippage doubled",
        *portfolio.run_tier("always", replace(CFG, slip=0.0004),
                            start, FIT_END))
    add("(vii) zero cost (= gross)",
        *portfolio.run_tier("always", replace(CFG, spot_fee=0.0, cm_fee=0.0,
                                              slip=0.0, sweep_cost=0.0),
                            start, FIT_END))
    # (v) the gate overlay and its own thresholds
    add("(v) overlay, gate ON 0.02 / OFF 0.005 (pass thresholds)", dO, pO, eO)
    for on in (0.00015, 0.0003):
        add(f"(v) overlay, gate ON {100*on:.3f} %",
            *portfolio.run_tier("hysteresis", CFG, start, FIT_END,
                                gate_kw=dict(on=on)))
    for off in (0.0, 0.0001):
        add(f"(v) overlay, gate OFF {100*off:.3f} %",
            *portfolio.run_tier("hysteresis", CFG, start, FIT_END,
                                gate_kw=dict(off=off)))
    for w in (3, 15):
        add(f"(v) overlay, f9 window {w} settlements",
            *portfolio.run_tier("hysteresis", CFG, start, FIT_END,
                                f9_window=w))
    # arm B thresholds
    for th in (0.07, 0.15):
        d, t = armb.run(th, QB_MIN_DAYS, FIT_END)
        s = armb.stats(d, t, f"arm B threshold {100*th:.0f} %")
        sens.append(dict(sensitivity=f"arm B threshold {100*th:.0f} % p.a.",
                         net_pa=s["net_pa"], funding_pa=np.nan,
                         hedge_pa=s.get("hedge_pa"), cost_pa=s.get("fee_pa"),
                         min_buffer_frac=np.nan, n_buffer_breach=0,
                         utilisation=s["utilisation"]))
    sf = pd.DataFrame(sens)
    sf.to_csv(os.path.join(OUT, "fit_sensitivities.csv"), index=False)
    print("\n--- SENSITIVITIES (all fit-only, none a rescue) ---")
    print(sf.to_string(index=False))

    # ---------------- nulls --------------------------------------------------
    nulls = []
    nulls.append(null_a("funding-gate overlay", start, FIT_END,
                        float(ann_mean(dO.r.dropna().values))))
    nulls.append(null_b("funding-gate overlay", start, FIT_END,
                        float(ann_mean(dO.r.dropna().values))))
    nf = pd.DataFrame(nulls)
    nf.to_csv(os.path.join(OUT, "fit_nulls.csv"), index=False)
    print("\n--- NULLS (arm A is always-on: the timing placebo is degenerate) ---")
    print(nf.to_string(index=False))
    return 0


def null_a(label, start, end, observed, draws=1000, seed=SEED):
    """Timing placebo: keep the ON segment count and lengths, place them at
    random non-overlapping starts inside the same window."""
    rng = np.random.default_rng(seed)
    base = {}
    for s in PERPS:
        f = engine.settlements(s)
        st = engine.gate_hysteresis(f).values
        m = (f.ts >= start) & (f.ts < end)
        v = st & m.values
        idx = np.where(m.values)[0]
        starts = np.where(v & ~np.concatenate([[False], v[:-1]]))[0]
        lens = []
        for i in starts:
            j = i
            while j < len(v) and v[j]:
                j += 1
            lens.append(j - i)
        base[s] = (idx, np.array(lens, int), len(f))
    out = []
    for _ in range(draws):
        ov = {}
        for s, (idx, lens, n) in base.items():
            v = np.zeros(n, bool)
            if len(lens):
                lo, hi = idx[0], idx[-1]
                span = hi - lo + 1
                total = lens.sum()
                gaps = rng.random(len(lens) + 1)
                gaps = gaps / gaps.sum() * max(span - total, 0)
                pos = lo
                for L, g in zip(lens, gaps[:-1]):
                    pos += int(g)
                    v[pos:pos + L] = True
                    pos += L
            ov[s] = pd.Series(v, index=engine.settlements(s).index)
        d, p, e = portfolio.run_tier("hysteresis", CFG, start, end,
                                     state_override=ov)
        out.append(ann_mean(d.r.dropna().values))
    out = np.array(out)
    return dict(null="A timing placebo", row=label, draws=draws,
                observed_pa=round(100*observed, 4),
                null_mean_pa=round(100*out.mean(), 4),
                null_p95_pa=round(100*np.percentile(out, 95), 4),
                p=round(float((out >= observed).mean()), 4))


def null_b(label, start, end, observed, draws=250, seed=SEED + 1):
    """Whole-stream day shift."""
    rng = np.random.default_rng(seed)
    st0 = {s: engine.gate_hysteresis(engine.settlements(s)) for s in PERPS}
    out = []
    for _ in range(draws):
        k = int(rng.integers(1, 251)) * 3      # days -> settlements
        ov = {s: pd.Series(np.roll(v.values, k), index=v.index)
              for s, v in st0.items()}
        d, p, e = portfolio.run_tier("hysteresis", CFG, start, end,
                                     state_override=ov)
        out.append(ann_mean(d.r.dropna().values))
    out = np.array(out)
    return dict(null="B day shift", row=label, draws=draws,
                observed_pa=round(100*observed, 4),
                null_mean_pa=round(100*out.mean(), 4),
                null_p95_pa=round(100*np.percentile(out, 95), 4),
                p=round(float((out >= observed).mean()), 4))


if __name__ == "__main__":
    sys.exit(main())
