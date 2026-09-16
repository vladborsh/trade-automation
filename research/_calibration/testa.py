#!/usr/bin/env python3
"""TEST A — a planted signal of known size, end to end.

`DESIGN.md` Test A. Plants a linear post-entry drift of size `d` (in units of
`stop_dist`, i.e. in R) on `orb-ny-open`'s FIT tape and re-runs the shipped
`engine.py`, `cost_R`, `null_A`, `null_B`, `boot_days` and `verdict`
**unchanged and unedited** — they are imported, never patched.

The only interventions are on DATA, and both are pre-registered:
  * `common.TAIL_END := common.FIT_END` so `analysis.Pool` cannot reach the
    holdout (DESIGN §0.1);
  * `common.load_1m` is redirected to an in-memory frame so a planted tape can
    be fed to `engine.Tape` without touching `engine.py` (DESIGN A.1).

    python testa.py
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ORB = os.path.join(REPO, "research", "orb-ny-open")
sys.path.insert(0, ORB)

import common as C  # noqa: E402

# ---- DESIGN §0.1: no holdout, on any code path. Set BEFORE any construction.
C.TAIL_END = C.FIT_END
C.TAIL_START = C.FIT_END          # empty tail window in `period_of`

import engine as E  # noqa: E402
import features as F  # noqa: E402
import analysis as A  # noqa: E402

RESULTS = os.path.join(HERE, "results")
os.makedirs(RESULTS, exist_ok=True)

ARMS = [(s, tf) for s in C.INSTRUMENTS for tf in C.TFS]
DRIFTS = [0.0, 0.05, 0.10, 0.20, -0.05, -0.10, -0.20]
KEY = ["date", "side", "entry", "stop", "stop_dist", "i_entry_min", "i_flat"]

# ---------------------------------------------------------------- data feed
_RAW: dict[str, pd.DataFrame] = {}
_FEED: dict[str, pd.DataFrame] = {}
_orig_load = C.load_1m


def _load_patch(symbol: str) -> pd.DataFrame:
    return _FEED[symbol]


C.load_1m = _load_patch


def raw(symbol: str) -> pd.DataFrame:
    if symbol not in _RAW:
        _RAW[symbol] = _orig_load(symbol)
    return _RAW[symbol]


def _reset_caches() -> None:
    E.Tape._cache.clear()
    F.Ind._cache.clear()
    F.SessionStats._cache.clear()
    F.DayBars._cache.clear()
    A.Pool._cache.clear()


def build(symbol: str, tf: int, frame: pd.DataFrame, days) -> pd.DataFrame:
    """Build the arm from `frame` as the 1m tape, with every cache cold."""
    global _FEED
    _reset_caches()
    _FEED[symbol] = frame
    q = E.build_arm(symbol, tf, days)
    return q.reset_index(drop=True)


def plant(symbol: str, q0: pd.DataFrame, d: float) -> pd.DataFrame:
    """DESIGN A.1 — shift every 1m bar in (i_entry_min, i_flat] by
    side * d * stop_dist * (k - i_entry_min) / (i_flat - i_entry_min)."""
    df = raw(symbol).copy(deep=True)
    o = df.open.values.copy()
    h = df.high.values.copy()
    lo = df.low.values.copy()
    c = df.close.values.copy()
    for ie, ifl, sd, dist in zip(q0.i_entry_min.values, q0.i_flat.values,
                                 q0.side.values, q0.stop_dist.values):
        ie, ifl = int(ie), int(ifl)
        hold = ifl - ie
        if hold <= 0:
            continue
        k = np.arange(ie + 1, ifl + 1)
        sh = sd * d * dist * (k - ie) / hold
        o[ie + 1:ifl + 1] += sh
        h[ie + 1:ifl + 1] += sh
        lo[ie + 1:ifl + 1] += sh
        c[ie + 1:ifl + 1] += sh
    df["open"], df["high"], df["low"], df["close"] = o, h, lo, c
    return df


def main() -> None:
    fit_days = C.nyse_days(C.FIT_START, C.FIT_END)
    rows, gates, weekly = [], [], []
    base: dict[str, pd.DataFrame] = {}

    for sym, tf in ARMS:
        arm = f"{sym}-{tf}m"
        q0 = build(sym, tf, raw(sym), fit_days)
        q0 = A.add_stop_atr(q0)
        base[arm] = q0
        print(f"[{arm}] clean fit trades: {len(q0)}", flush=True)

        for d in DRIFTS:
            frame = raw(sym) if d == 0.0 else plant(sym, q0, d)
            q = build(sym, tf, frame, fit_days)
            q = A.add_stop_atr(q)

            # ---- G0: the plant is signal-neutral -------------------------
            g0 = (len(q) == len(q0)) and all(
                np.allclose(q[k].values.astype(float), q0[k].values.astype(float),
                            rtol=0, atol=1e-12)
                if k != "date" else bool((q[k].values == q0[k].values).all())
                for k in KEY)
            if not g0:
                raise SystemExit(f"G0 FAILED on {arm} d={d}: plant changed the signal")

            # ---- G1: exact recovery on trades that time-exit at both d ---
            g1 = {}
            for num in (1, 2):
                both = (q0[f"exit_{num}"].values == "time-exit") & \
                       (q[f"exit_{num}"].values == "time-exit")
                if both.sum():
                    dev = np.abs((q[f"grossR_{num}"].values[both]
                                  - q0[f"grossR_{num}"].values[both]) - d)
                    g1[num] = (int(both.sum()), float(dev.max()))
                else:
                    g1[num] = (0, np.nan)

            # ---- G5: cost identity and invariance ------------------------
            g5dev = max(float(np.abs(q[f"grossR_{n}"] - q[f"netR_{n}"]
                                     - q[f"cost_R_{n}"]).max()) for n in (1, 2))
            g5inv = float(abs(q.cost_R_1.mean() - q0.cost_R_1.mean()))

            # ---- the ladder, verbatim, on the FIT slice ------------------
            rng = np.random.default_rng(C.SEED)
            m = float(q.netR_1.mean())
            nA, clash = A.null_A(sym, tf, q, C.N_PERM_A, rng)
            pA = float(np.nanmean(nA >= m))
            nB, drop = A.null_B(sym, tf, q, C.N_PERM_B, rng)
            pB = float(np.nanmean(nB >= m))
            bt = A.boot_days(q.netR_1.values, q.date.values, C.N_BOOT, rng)
            blo = float(np.percentile(bt, C.BOOT_LO))
            bhi = float(np.percentile(bt, C.BOOT_HI))
            v, why = A.verdict(len(q), m, pA, m, blo, bhi, float(q.grossR_1.mean()))

            ec = q.exit_1.value_counts()
            rows.append(dict(
                arm=arm, d=d, n=len(q),
                mean_grossR_1=float(q.grossR_1.mean()),
                mean_netR_1=m,
                mean_cost_R_1=float(q.cost_R_1.mean()),
                se_netR_1=float(q.netR_1.std(ddof=1) / np.sqrt(len(q))),
                mean_netR_2=float(q.netR_2.mean()),
                naive_pred=d - float(q.cost_R_1.mean()),
                delta_vs_d0=m - float(q0.netR_1.mean()),
                attenuation=(m - float(q0.netR_1.mean())) / d if d else np.nan,
                n_target=int(ec.get("target", 0)), n_stop=int(ec.get("stop", 0)),
                n_time=int(ec.get("time-exit", 0)),
                nullA_mean=float(np.nanmean(nA)), p_A=pA,
                nullB_mean=float(np.nanmean(nB)), p_B=pB,
                nullA_clash=clash, nullB_drop=drop,
                boot_lo=blo, boot_hi=bhi, verdict=v))
            gates.append(dict(
                arm=arm, d=d, G0=bool(g0),
                G1_n_t1=g1[1][0], G1_maxdev_t1=g1[1][1],
                G1_n_t2=g1[2][0], G1_maxdev_t2=g1[2][1],
                G1=bool((np.isnan(g1[1][1]) or g1[1][1] < 1e-9)
                        and (np.isnan(g1[2][1]) or g1[2][1] < 1e-9)),
                G5_identity_maxdev=g5dev, G5_cost_shift=g5inv,
                G5=bool(g5dev < 1e-12 and g5inv < 0.002),
                G7_boot_covers=bool(blo <= m <= bhi)))
            print(f"  d={d:+.2f} n={len(q)} net={m:+.4f} "
                  f"(d0 {float(q0.netR_1.mean()):+.4f}, delta {m-float(q0.netR_1.mean()):+.4f}) "
                  f"cost={q.cost_R_1.mean():.4f} pA={pA:.4f} "
                  f"boot=[{blo:+.3f},{bhi:+.3f}] G1dev={g1[1][1]:.2e} -> {v.split(' —')[0]}",
                  flush=True)

    R = pd.DataFrame(rows)
    G = pd.DataFrame(gates)
    R.to_csv(os.path.join(RESULTS, "testA_recovery.csv"), index=False)
    G.to_csv(os.path.join(RESULTS, "testA_gates.csv"), index=False)

    # ---- G2 identity against the committed fit run ------------------------
    try:
        comm = pd.read_csv(os.path.join(ORB, "results", "fit_describe.csv"))
        comm = comm[(comm.period == "fit") & (comm.status == "pre-registered")]
        g2 = []
        for arm, q0 in base.items():
            for num in (1, 2):
                c = comm[(comm.arm == arm) & (comm.template == num)]
                if len(c) != 1:
                    continue
                g2.append(dict(arm=arm, template=num,
                               committed=float(c.mean_netR.iloc[0]),
                               replayed=float(q0[f"netR_{num}"].mean()),
                               n_committed=int(c.n.iloc[0]), n_replayed=len(q0)))
        g2 = pd.DataFrame(g2)
        g2["dev"] = (g2.committed - g2.replayed).abs()
        g2["G2"] = (g2.dev < 1e-12) & (g2.n_committed == g2.n_replayed)
        g2.to_csv(os.path.join(RESULTS, "testA_g2_identity.csv"), index=False)
        print("\nG2 identity vs committed fit_describe.csv: "
              f"{int(g2.G2.sum())}/{len(g2)} exact, max dev {g2.dev.max():.3e}")
    except FileNotFoundError:
        print("\nG2 skipped: committed fit_describe.csv not found")

    # ---- G3 monotonicity, G4 sign symmetry, G6/G8 power -------------------
    summ = []
    for arm, g in R.groupby("arm"):
        g = g.sort_values("d")
        mono1 = bool((g.mean_netR_1.diff().dropna() > 0).all())
        mono2 = bool((g.mean_netR_2.diff().dropna() > 0).all())
        m0 = float(g[g.d == 0].mean_netR_1.iloc[0])
        sym_ok = all(float(g[g.d == -x].mean_netR_1.iloc[0]) < m0
                     < float(g[g.d == x].mean_netR_1.iloc[0])
                     for x in (0.05, 0.10, 0.20))
        summ.append(dict(arm=arm, G3_t1=mono1, G3_t2=mono2, G4=sym_ok, mean_d0=m0))
    S = pd.DataFrame(summ)
    S.to_csv(os.path.join(RESULTS, "testA_summary.csv"), index=False)

    pw = []
    for d, g in R[R.d >= 0].groupby("d"):
        pw.append(dict(d=d, n_arms=len(g),
                       n_pA_below_alpha=int((g.p_A <= C.ALPHA).sum()),
                       n_boot_excl_0=int(((g.boot_lo > 0) | (g.boot_hi < 0)).sum()),
                       n_mean_ge_010=int((g.mean_netR_1 >= C.BUILD_MEAN).sum()),
                       n_real_edge=int(g.verdict.str.startswith("REAL EDGE").sum()),
                       mean_nullA=float(g.nullA_mean.mean()),
                       mean_netR=float(g.mean_netR_1.mean())))
    P = pd.DataFrame(pw)
    P["leak_rho"] = (P.mean_nullA - P.mean_nullA.iloc[0]) / P.d.replace(0, np.nan)
    P.to_csv(os.path.join(RESULTS, "testA_power.csv"), index=False)
    print("\n=== G3/G4 ===")
    print(S.to_string(index=False))
    print("\n=== EMPIRICAL POWER CURVE (8 arms, fit period) ===")
    print(P.to_string(index=False))


if __name__ == "__main__":
    main()
