#!/usr/bin/env python3
"""FIT-PERIOD numbers for all four arms, both shadows, and every named
sensitivity and control (DESIGN §6, §8.3).  Fit window only — the holdout is
not touched anywhere in this file.
"""
from __future__ import annotations
import argparse, json, os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SYMBOLS, TIERS, OUT, FIT_END, PCT_HI, PCT_LO, FLOOR,
                    COST_RT, MAKER_RT, welch_t, tstat)
import prep, engine, controls, summarize

START = pd.Timestamp("2019-01-01", tz="UTC")
pd.set_option("display.width", 250, "display.max_columns", 60)


def run_arm(frames, syms, arm, win0, win1, state, lapse_mode="funding", **kw):
    tr = []
    for s in syms:
        bars, sett = frames[s]
        if arm == "A":
            tr += engine.run_A(bars, sett, s, win0, win1, state=state,
                               lapse_mode=lapse_mode, **kw)
        else:
            tr += engine.run_B(bars, sett, s, win0, win1, state=state, **kw)
    keep = [t for t in tr if t.get("excluded") is None]
    excl = [t for t in tr if t.get("excluded") is not None]
    return keep, excl


def frame(trs):
    return engine.kept(engine.to_frame(trs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--draws", type=int, default=1000)
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--tiers", default="majors,alts")
    ap.add_argument("--tag", default="")
    a = ap.parse_args()
    if a.quick:
        a.draws, a.boot = 50, 200

    tiers = {k: v for k, v in TIERS.items() if k in a.tiers.split(",")}
    syms_all = [s for v in tiers.values() for s in v]
    frames = prep.build_all(syms_all)
    tapes = {s: controls.Tape(*frames[s]) for s in syms_all}

    W0, W1 = START, FIT_END
    arms = {}
    rows_decomp, rows_arm = [], []

    for arm in ("A", "B"):
        for tier, syms in tiers.items():
            for kind, state, lapse in (("real", ("ext_pos", "ext_neg"), "funding"),
                                       ("shadow24", ("sh_pos", "sh_neg"), "shadow")):
                key = f"{arm}_{tier}_{kind}"
                keep, excl = run_arm(frames, syms, arm, W0, W1, state,
                                     lapse_mode=lapse)
                df = frame(keep)
                arms[key] = dict(trades=keep, df=df, excl=excl, arm=arm,
                                 tier=tier, kind=kind)
                rows_decomp += summarize.full_block(df, key)
                print(f"{key:26s} n={len(df):5d} excl={len(excl):3d} "
                      f"meanNetR={df['netR'].mean() if len(df) else np.nan:+.4f}",
                      flush=True)

    # ---- frequency parity (DESIGN §6.3) -----------------------------------
    parity = []
    need_72h = False
    for arm in ("A", "B"):
        for tier in tiers:
            nr = len(arms[f"{arm}_{tier}_real"]["df"])
            ns = len(arms[f"{arm}_{tier}_shadow24"]["df"])
            ok = ns >= 0.5 * nr
            parity.append(dict(arm=f"{arm}_{tier}", n_real=nr, n_shadow24=ns,
                               parity_ok=ok))
            need_72h = need_72h or not ok
    print("\n=== §6.3 frequency parity ===")
    print(pd.DataFrame(parity).to_string(index=False))

    if need_72h:
        print("\nshadow24 starved on >=1 arm -> adding the ONE pre-committed "
              "fallback shadow (trailing 72h return)", flush=True)
        frames72 = prep.build_all(syms_all, shadow_ret_bars=72)
        for arm in ("A", "B"):
            for tier, syms in tiers.items():
                key = f"{arm}_{tier}_shadow72"
                keep, excl = run_arm(frames72, syms, arm, W0, W1,
                                     ("sh_pos", "sh_neg"), lapse_mode="shadow")
                df = frame(keep)
                arms[key] = dict(trades=keep, df=df, excl=excl, arm=arm,
                                 tier=tier, kind="shadow72")
                rows_decomp += summarize.full_block(df, key)
                print(f"{key:26s} n={len(df):5d} "
                      f"meanNetR={df['netR'].mean() if len(df) else np.nan:+.4f}",
                      flush=True)

    # ---- nulls + bootstraps + shadow margin -------------------------------
    print("\n=== nulls and the gating margin ===", flush=True)
    for arm in ("A", "B"):
        for tier in tiers:
            rk = f"{arm}_{tier}_real"
            R = arms[rk]
            p_a, _ = controls.null_A(R["trades"], tapes, arm, W0, W1,
                                     draws=a.draws)
            p_b, _ = controls.null_B_dayshift(R["trades"], tapes, arm,
                                              draws=min(250, a.draws))
            lo, hi = controls.boot_mean_ci(R["df"], draws=a.boot)
            # gating shadow: the better-powered of shadow24 / shadow72
            cands = [k for k in (f"{arm}_{tier}_shadow24",
                                 f"{arm}_{tier}_shadow72") if k in arms]
            gate = max(cands, key=lambda k: len(arms[k]["df"]))
            S = arms[gate]
            d = (R["df"]["netR"].mean() - S["df"]["netR"].mean()) \
                if len(R["df"]) and len(S["df"]) else np.nan
            dlo, dhi = controls.boot_diff_ci(R["df"], S["df"], draws=a.boot)
            rows_arm.append(dict(
                arm=f"{arm}_{tier}", n=len(R["df"]),
                mean_netR=R["df"]["netR"].mean() if len(R["df"]) else np.nan,
                mean_priceR=R["df"]["priceR"].mean() if len(R["df"]) else np.nan,
                mean_fundingR=R["df"]["fundingR"].mean() if len(R["df"]) else np.nan,
                mean_costR=R["df"]["costR"].mean() if len(R["df"]) else np.nan,
                mean_grossR=R["df"]["grossR"].mean() if len(R["df"]) else np.nan,
                t=tstat(R["df"]["netR"].values) if len(R["df"]) else np.nan,
                nullA_p=p_a, nullB_p=p_b, boot_lo=lo, boot_hi=hi,
                shadow=gate, n_shadow=len(S["df"]),
                shadow_netR=S["df"]["netR"].mean() if len(S["df"]) else np.nan,
                margin=d, margin_lo=dlo, margin_hi=dhi,
                floor_arm_ok=len(R["df"]) >= 300,
                floor_shadow_ok=len(S["df"]) >= 150,
            ))
            print(f"{arm}_{tier}: n={len(R['df'])} mean={rows_arm[-1]['mean_netR']:+.4f} "
                  f"pA={p_a:.3f} pB={p_b:.3f} shadow={gate}({len(S['df'])}) "
                  f"margin={d:+.4f} [{dlo:+.4f},{dhi:+.4f}]", flush=True)

    arm_df = pd.DataFrame(rows_arm)
    arm_df["margin_ok"] = (arm_df["margin"] >= 0.05) & (arm_df["margin_lo"] > 0)
    arm_df["screen_in"] = (
        (arm_df["mean_netR"] >= 0.05) & (arm_df["nullA_p"] <= 0.20)
        & arm_df["floor_arm_ok"] & arm_df["floor_shadow_ok"] & arm_df["margin_ok"])
    arm_df.round(4).to_csv(os.path.join(OUT, f"fit_arms{a.tag}.csv"), index=False)
    summarize.fmt(rows_decomp).to_csv(os.path.join(OUT, f"fit_decomp{a.tag}.csv"),
                                      index=False)

    # ---- sensitivities (fit-only, never promoted) -------------------------
    sens = []

    def add(label, keep):
        df = frame(keep)
        r = summarize.decomp(df, label)
        sens.append(r)
        print(f"  {label:44s} n={r['n']:5d} netR={r['mean_netR']:+.4f}", flush=True)

    print("\n=== fit-only sensitivities (never promoted) ===", flush=True)
    import common as C
    for tier, syms in tiers.items():
        # §1.2 percentile 0.95 / 0.80 and floor 0 / 0.0005
        for pct in (0.95, 0.80):
            for arm in ("A", "B"):
                fr = {}
                for s in syms:
                    b, st = frames[s]
                    st = st.copy()
                    st["ext_pos"] = (st["fpct"] >= pct) & (st["f"] >= FLOOR)
                    st["ext_neg"] = (st["fpct"] <= 1 - pct) & (st["f"] <= -FLOOR)
                    fr[s] = (b, st)
                k, _ = run_arm(fr, syms, arm, W0, W1, ("ext_pos", "ext_neg"))
                add(f"{arm}_{tier} pct={pct}", k)
        for fl in (0.0, 0.0005):
            for arm in ("A", "B"):
                fr = {}
                for s in syms:
                    b, st = frames[s]
                    st = st.copy()
                    st["ext_pos"] = (st["fpct"] >= PCT_HI) & (st["f"] >= fl)
                    st["ext_neg"] = (st["fpct"] <= PCT_LO) & (st["f"] <= -fl)
                    fr[s] = (b, st)
                k, _ = run_arm(fr, syms, arm, W0, W1, ("ext_pos", "ext_neg"))
                add(f"{arm}_{tier} floor={fl}", k)
        # A: persistence 1 / 3 ; stop 1.0 / 2.5 dATR ; maker cost
        for pz in (1, 3):
            k, _ = run_arm(frames, syms, "A", W0, W1, ("ext_pos", "ext_neg"),
                           persist=pz)
            add(f"A_{tier} persist={pz}", k)
        for sd in (1.0, 2.5):
            k, _ = run_arm(frames, syms, "A", W0, W1, ("ext_pos", "ext_neg"),
                           stop_datr=sd)
            add(f"A_{tier} stop={sd}dATR", k)
        k, _ = run_arm(frames, syms, "A", W0, W1, ("ext_pos", "ext_neg"),
                       cost_rt=MAKER_RT)
        add(f"A_{tier} maker0.04%", k)
        k, _ = run_arm(frames, syms, "B", W0, W1, ("ext_pos", "ext_neg"),
                       cost_rt=MAKER_RT)
        add(f"B_{tier} maker0.04%", k)
        # B template 2: +3R
        k, _ = run_arm(frames, syms, "B", W0, W1, ("ext_pos", "ext_neg"),
                       target_R=3.0)
        add(f"B_{tier} template2 +3R", k)

    summarize.fmt(sens).to_csv(os.path.join(OUT, f"fit_sensitivities{a.tag}.csv"),
                               index=False)

    # ---- §6.8 mechanism prerequisite --------------------------------------
    print("\n=== §6.8 funding persistence (fit-only, descriptive) ===")
    pers = []
    for tier, syms in tiers.items():
        fs, surv = [], {h: [] for h in (1, 3, 6, 9, 15, 30)}
        for s in syms:
            _, st = frames[s]
            st = st[st["warm"] & ~st["blackout"]]
            st = st[st.index < FIT_END]
            f = st["f"].values
            ep = st["ext_pos"].values
            for h in range(1, 10):
                fs.append(pd.Series(f[h:][ep[:-h]]).rename(h))
            for h in surv:
                if h < len(ep):
                    surv[h].append(float(ep[h:][ep[:-h]].mean())
                                   if ep[:-h].sum() else np.nan)
        allf = pd.concat(fs) if fs else pd.Series(dtype=float)
        pers.append(dict(tier=tier, n_ext_pos=int(sum(
            int(frames[s][1][(frames[s][1]["warm"]) & (frames[s][1].index < FIT_END)]
                ["ext_pos"].sum()) for s in syms)),
            mean_f_next9=float(allf.mean()), median_f_next9=float(allf.median()),
            **{f"surv_{h}": float(np.nanmean(v)) for h, v in surv.items()}))
    pdf = pd.DataFrame(pers)
    pdf.round(6).to_csv(os.path.join(OUT, f"fit_persistence{a.tag}.csv"), index=False)
    print(pdf.round(5).to_string(index=False))

    # ---- §6.4 incremental control -----------------------------------------
    print("\n=== §6.4 incremental control (non-promotable) ===")
    inc = []
    for tier, syms in tiers.items():
        rows = []
        for s in syms:
            bars, st = frames[s]
            st = st[st["warm"] & ~st["blackout"] & st["present"]]
            st = st[st.index < FIT_END]
            tp = tapes[s]
            for tk, r in st.iterrows():
                if not np.isfinite(r["spct"]) or not np.isfinite(r["fpct"]):
                    continue
                if not (r["ext_pos"] or r["fpct"] >= 0.50):
                    continue
                i0 = tp.pos.get(tk)
                if i0 is None or not tp.present[i0] or not np.isfinite(tp.datr[i0]):
                    continue
                v = controls.placebo_A(tp, i0, -1, 1.5 * tp.datr[i0], 30)
                if np.isfinite(v):
                    rows.append(dict(spct=r["spct"], ext=bool(r["ext_pos"]), netR=v))
        d = pd.DataFrame(rows)
        if not len(d):
            continue
        d["terc"] = pd.qcut(d["spct"], 3, labels=["low", "mid", "high"])
        for terc, g in d.groupby("terc", observed=True):
            e, ne = g[g.ext]["netR"], g[~g.ext]["netR"]
            inc.append(dict(tier=tier, tercile=str(terc), n_ext=len(e),
                            n_nonext=len(ne), mean_ext=e.mean(),
                            mean_nonext=ne.mean(), diff=e.mean() - ne.mean(),
                            welch_t=welch_t(e, ne)))
    idf = pd.DataFrame(inc)
    if len(idf):
        idf.round(4).to_csv(os.path.join(OUT, f"fit_incremental{a.tag}.csv"), index=False)
        print(idf.round(4).to_string(index=False))
        ok = int(((idf["diff"] > 0)).sum())
        pooled_t = welch_t(idf["mean_ext"], idf["mean_nonext"])
        print(f"cells with funding split positive: {ok}/6 "
              f"(bar: >=4 AND pooled Welch t>2; pooled t={pooled_t:.2f})")

    print("\n=== SCREEN (§8.3) ===")
    print(arm_df[["arm", "n", "mean_netR", "nullA_p", "floor_arm_ok",
                  "floor_shadow_ok", "margin", "margin_lo", "margin_ok",
                  "screen_in"]].round(4).to_string(index=False))
    with open(os.path.join(OUT, f"screen{a.tag}.json"), "w") as fh:
        json.dump({r["arm"]: bool(r["screen_in"])
                   for _, r in arm_df.iterrows()}, fh, indent=2)


if __name__ == "__main__":
    main()
