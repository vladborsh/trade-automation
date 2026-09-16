#!/usr/bin/env python3
"""Study B — the LightGBM per-trade feature study. `DESIGN.md` §9.

**HYPOTHESIS-GENERATING. This file produces no verdict.** It trains on the fit
period only, with fixed shallow hyper-parameters and no tuning, and reports
permutation + SHAP importance against a target-shuffle max-statistic null. A
flagged feature is a *proposal for a new pre-registered arm*, never an edge.

    python studyb.py train     # fit-period CV, importances, the null, the flags
    python studyb.py holdout   # the frozen-model read (run AFTER Test A is locked)
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import features as F  # noqa: E402

import lightgbm as lgb  # noqa: E402
from scipy.stats import spearmanr  # noqa: E402

OUT = os.path.join(C.RESULTS, "studyb")
os.makedirs(OUT, exist_ok=True)
CATS = ["dow", "instrument"]


# ==========================================================================
# Data
# ==========================================================================
def frame(period="fit") -> pd.DataFrame:
    q = pd.read_parquet(os.path.join(C.RESULTS, "trades_all.parquet"))
    q = q[q.period == period].copy()
    q["instrument"] = q.symbol
    return q


def xy(g: pd.DataFrame, cols):
    X = g[cols].copy()
    for c in CATS:
        if c in X.columns:
            X[c] = X[c].astype("category")
    return X, g.netR_1.values


def usable(g: pd.DataFrame, cols) -> pd.DataFrame:
    """§7.1 warm-up: a trade needing more history than exists is dropped from
    Study B and counted. It stays in Test A."""
    return g[g[[c for c in cols if c not in ("instrument",)]].notna().all(axis=1)]


# ==========================================================================
# Blocked chronological CV with a purge gap — §9.1
# ==========================================================================
def folds(g: pd.DataFrame, k=C.LGB_FOLDS, purge=C.LGB_PURGE_SESSIONS):
    """Contiguous date ranges, no shuffling, `purge` sessions dropped from the
    TRAIN side on either boundary of the validation block."""
    days = np.array(sorted(g.date.unique()))
    cuts = np.array_split(np.arange(len(days)), k)
    out = []
    for cu in cuts:
        vd = set(days[cu])
        lo, hi = cu[0] - purge, cu[-1] + purge
        pd_ = set(days[max(0, lo):min(len(days), hi + 1)])
        va = g.date.isin(vd).values
        tr = (~g.date.isin(pd_)).values
        if tr.sum() > 50 and va.sum() > 10:
            out.append((np.flatnonzero(tr), np.flatnonzero(va)))
    return out


def fit_oof(g: pd.DataFrame, cols, seed: int, n_est=None):
    """One seed: train on each fold, collect out-of-fold predictions and the
    fold models. `n_estimators` by early stopping unless `n_est` is given."""
    X, y = xy(g, cols)
    oof = np.full(len(g), np.nan)
    models, rounds = [], []
    p = dict(C.LGB_PARAMS, seed=seed, bagging_seed=seed, feature_fraction_seed=seed,
             data_random_seed=seed, deterministic=True, num_threads=4)
    for tr, va in folds(g):
        dtr = lgb.Dataset(X.iloc[tr], y[tr], categorical_feature=[c for c in CATS if c in cols])
        dva = lgb.Dataset(X.iloc[va], y[va], reference=dtr)
        if n_est is None:
            m = lgb.train(p, dtr, num_boost_round=C.LGB_N_EST_CAP, valid_sets=[dva],
                          callbacks=[lgb.early_stopping(C.LGB_PATIENCE, verbose=False)])
            rounds.append(m.best_iteration)
        else:
            m = lgb.train(p, dtr, num_boost_round=n_est)
            rounds.append(n_est)
        oof[va] = m.predict(X.iloc[va], num_iteration=m.best_iteration or None)
        models.append((m, tr, va))
    return oof, models, rounds


def perm_importance(models, g, cols, seed) -> np.ndarray:
    """§9.2 — permutation importance on the OUT-OF-FOLD predictions.
    100 shuffles per feature, dMSE = MSE(shuffled) - MSE(baseline), averaged
    over folds. All 100 shuffles are predicted in one batched call."""
    X, y = xy(g, cols)
    rng = np.random.default_rng(seed)
    acc = np.zeros(len(cols))
    for m, tr, va in models:
        Xv, yv = X.iloc[va], y[va]
        ni = m.best_iteration or None
        base = float(np.mean((m.predict(Xv, num_iteration=ni) - yv) ** 2))
        n = len(va)
        for fi, c in enumerate(cols):
            big = pd.concat([Xv] * C.PERM_SHUFFLES, ignore_index=True)
            col = np.concatenate([rng.permutation(Xv[c].values)
                                  for _ in range(C.PERM_SHUFFLES)])
            big[c] = pd.Categorical(col, categories=Xv[c].cat.categories) \
                if c in CATS else col
            pr = m.predict(big, num_iteration=ni).reshape(C.PERM_SHUFFLES, n)
            acc[fi] += float(np.mean((pr - yv[None, :]) ** 2)) - base
    return acc / max(len(models), 1)


def shap_importance(models, g, cols) -> np.ndarray:
    """§9.2 — TreeSHAP mean |value| per feature, on the out-of-fold rows."""
    X, _ = xy(g, cols)
    tot = np.zeros(len(cols))
    n = 0
    for m, tr, va in models:
        sv = m.predict(X.iloc[va], pred_contrib=True,
                       num_iteration=m.best_iteration or None)[:, :len(cols)]
        tot += np.abs(sv).sum(axis=0)
        n += len(va)
    return tot / max(n, 1)


def shap_direction(models, g, cols) -> dict:
    """Sign of the fit-period relationship: Spearman(feature, its SHAP value)
    on the out-of-fold rows. Positive = a higher value pushes predicted netR up."""
    X, _ = xy(g, cols)
    num = {c: ([], []) for c in cols}
    for m, tr, va in models:
        sv = m.predict(X.iloc[va], pred_contrib=True,
                       num_iteration=m.best_iteration or None)[:, :len(cols)]
        for i, c in enumerate(cols):
            v = X.iloc[va][c]
            v = v.cat.codes.values if c in CATS else v.values
            num[c][0].append(v)
            num[c][1].append(sv[:, i])
    out = {}
    for c in cols:
        a = np.concatenate(num[c][0]).astype(float)
        b = np.concatenate(num[c][1])
        ok = np.isfinite(a) & np.isfinite(b)
        out[c] = float(spearmanr(a[ok], b[ok]).statistic) if ok.sum() > 10 else np.nan
    return out


# ==========================================================================
# train
# ==========================================================================
def train() -> None:
    fit = frame("fit")
    cols = F.FEATURES + ["instrument"]
    summary = {}
    for tf in C.TFS:
        g0 = fit[fit.tf == tf].reset_index(drop=True)
        g = usable(g0, cols).reset_index(drop=True)
        n_drop = len(g0) - len(g)
        print(f"[train] {tf}m: n_fit={len(g)} (dropped {n_drop} on warm-up)", flush=True)

        perm = np.zeros(len(cols))
        shp = np.zeros(len(cols))
        oofs, rounds_all, dirs = [], [], []
        for seed in C.LGB_SEEDS:
            oof, models, rounds = fit_oof(g, cols, seed)
            perm += perm_importance(models, g, cols, seed)
            shp += shap_importance(models, g, cols)
            dirs.append(shap_direction(models, g, cols))
            oofs.append(oof)
            rounds_all += rounds
            print(f"   seed {seed}: rounds {rounds}", flush=True)
        perm /= len(C.LGB_SEEDS)
        shp /= len(C.LGB_SEEDS)
        oof = np.nanmean(np.vstack(oofs), axis=0)
        direction = {c: float(np.nanmean([d[c] for d in dirs])) for c in cols}

        # ---- §9.3 the target-shuffle max-statistic null ------------------
        print(f"[train] {tf}m: {C.NULL_REFITS} target-shuffle refits...", flush=True)
        nullmax = null_max(g, cols)
        thr = float(np.percentile(nullmax, C.NULL_PCTL))
        flagged = [c for c, v in zip(cols, perm) if v > thr and c in F.FEATURES]

        imp = pd.DataFrame(dict(feature=cols, perm_importance=perm, shap_mean_abs=shp,
                                shap_direction=[direction[c] for c in cols]))
        imp["flagged"] = imp.feature.isin(flagged)
        imp = imp.sort_values("perm_importance", ascending=False)
        imp.to_csv(os.path.join(OUT, f"importance_{tf}m.csv"), index=False)
        np.save(os.path.join(OUT, f"nullmax_{tf}m.npy"), nullmax)
        g[["date", "arm", "symbol", "netR_1"]].assign(pred=oof).to_parquet(
            os.path.join(OUT, f"oof_{tf}m.parquet"), index=False)

        # ---- the frozen model: refit on ALL fit trades, rounds = CV median
        n_est = int(np.median(rounds_all))
        Xf, yf = xy(g, cols)
        frozen = []
        for seed in C.LGB_SEEDS:
            p = dict(C.LGB_PARAMS, seed=seed, bagging_seed=seed,
                     feature_fraction_seed=seed, data_random_seed=seed,
                     deterministic=True, num_threads=4)
            m = lgb.train(p, lgb.Dataset(Xf, yf, categorical_feature=CATS),
                          num_boost_round=n_est)
            m.save_model(os.path.join(OUT, f"frozen_{tf}m_seed{seed}.txt"))
            frozen.append(m)
        summary[f"{tf}m"] = dict(
            n_fit=len(g), n_dropped_warmup=int(n_drop),
            cv_rounds_median=n_est, cv_rounds=rounds_all,
            null_refits=C.NULL_REFITS, nullmax_p95=thr,
            nullmax_mean=float(nullmax.mean()), nullmax_max=float(nullmax.max()),
            flagged=flagged,
            spearman_oof=float(spearmanr(oof, g.netR_1.values).statistic),
            top5=imp.head(5)[["feature", "perm_importance"]].to_dict("records"))
        print(f"[train] {tf}m: null-max p95 = {thr:.6g}; FLAGGED = {flagged or 'none'}",
              flush=True)

    # rsi14 vs rsi15 correlation, reported once (§7.2)
    r = fit[["rsi14", "rsi15"]].dropna()
    summary["rsi14_vs_rsi15_pearson"] = float(r.corr().iloc[0, 1])
    with open(os.path.join(OUT, "train_summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2, default=str)
    print(json.dumps({k: v for k, v in summary.items() if k != "cv_rounds"},
                     indent=2, default=str)[:2000])


def null_max(g: pd.DataFrame, cols) -> np.ndarray:
    """§9.3 — 200 refits with `netR` permuted WITHIN instrument and WITHIN
    fit-year, one seed each, same folds, same hyper-parameters. Each refit
    records the maximum permutation importance over all features."""
    rng = np.random.default_rng(C.SEED)
    key = g.symbol.values.astype(str) + "|" + pd.to_datetime(g.date).dt.year.astype(str).values
    groups = {k: np.flatnonzero(key == k) for k in np.unique(key)}
    y0 = g.netR_1.values.copy()
    out = np.empty(C.NULL_REFITS)
    for i in range(C.NULL_REFITS):
        y = y0.copy()
        for idx in groups.values():
            y[idx] = y0[rng.permutation(idx)]
        gg = g.copy()
        gg["netR_1"] = y
        _, models, _ = fit_oof(gg, cols, seed=i)
        out[i] = perm_importance(models, gg, cols, seed=i).max()
        if (i + 1) % 20 == 0:
            print(f"     null refit {i+1}/{C.NULL_REFITS} "
                  f"(running p95 {np.percentile(out[:i+1], 95):.6g})", flush=True)
    return out


# ==========================================================================
# holdout — the frozen read (§9.4). Run only after Test A is locked.
# ==========================================================================
def boot_diff(a_r, a_d, b_r, b_d, rng, n=C.N_BOOT):
    """Day-block bootstrap on the difference of two group means."""
    days = np.array(sorted(set(a_d) | set(b_d)))
    ai = {d: a_r[a_d == d] for d in days}
    bi = {d: b_r[b_d == d] for d in days}
    out = np.empty(n)
    for k in range(n):
        pick = days[rng.integers(0, len(days), size=len(days))]
        A = np.concatenate([ai[d] for d in pick if len(ai[d])]) if any(len(ai[d]) for d in pick) else np.array([np.nan])
        B = np.concatenate([bi[d] for d in pick if len(bi[d])]) if any(len(bi[d]) for d in pick) else np.array([np.nan])
        out[k] = A.mean() - B.mean()
    return out


def holdout() -> None:
    lock = os.path.join(C.RESULTS, "holdout_verdicts.csv")
    if not os.path.exists(lock):
        raise SystemExit("Test A's holdout verdicts are not locked yet "
                         "(results/holdout_verdicts.csv missing). DESIGN §9.4.")
    fit = frame("fit")
    hold = frame("holdout")
    cols = F.FEATURES + ["instrument"]
    rng = np.random.default_rng(C.SEED)
    rows, terc, flagrows = [], [], []
    summ = json.load(open(os.path.join(OUT, "train_summary.json")))
    for tf in C.TFS:
        gf = usable(fit[fit.tf == tf].reset_index(drop=True), cols).reset_index(drop=True)
        gh = usable(hold[hold.tf == tf].reset_index(drop=True), cols).reset_index(drop=True)
        Xh, yh = xy(gh, cols)
        Xf, _ = xy(gf, cols)
        pr = np.mean([lgb.Booster(model_file=os.path.join(
            OUT, f"frozen_{tf}m_seed{s}.txt")).predict(Xh) for s in C.LGB_SEEDS], axis=0)
        pf = np.mean([lgb.Booster(model_file=os.path.join(
            OUT, f"frozen_{tf}m_seed{s}.txt")).predict(Xf) for s in C.LGB_SEEDS], axis=0)
        # 1. Spearman, with a day-block bootstrap interval
        sp = float(spearmanr(pr, yh).statistic)
        days = np.array(sorted(gh.date.unique()))
        bs = np.empty(C.N_BOOT)
        by = {d: np.flatnonzero(gh.date.values == d) for d in days}
        for k in range(C.N_BOOT):
            idx = np.concatenate([by[d] for d in days[rng.integers(0, len(days), len(days))]])
            bs[k] = spearmanr(pr[idx], yh[idx]).statistic
        # 2. score terciles, cut-points from the FIT prediction distribution
        q1, q2 = np.percentile(pf, [100 / 3, 200 / 3])
        top, bot = pr >= q2, pr <= q1
        d = boot_diff(yh[top], gh.date.values[top], yh[bot], gh.date.values[bot], rng)
        rows.append(dict(tf=f"{tf}m", n_holdout=len(gh), spearman=sp,
                         spearman_lo=float(np.percentile(bs, C.BOOT_LO)),
                         spearman_hi=float(np.percentile(bs, C.BOOT_HI)),
                         fit_cut_lo=float(q1), fit_cut_hi=float(q2),
                         n_top=int(top.sum()), n_bot=int(bot.sum()),
                         mean_netR_top=float(yh[top].mean()) if top.any() else np.nan,
                         mean_netR_bottom=float(yh[bot].mean()) if bot.any() else np.nan,
                         top_minus_bottom=float(np.nanmean(d)),
                         tmb_lo=float(np.nanpercentile(d, C.BOOT_LO)),
                         tmb_hi=float(np.nanpercentile(d, C.BOOT_HI))))
        # 3. per FLAGGED feature
        imp = pd.read_csv(os.path.join(OUT, f"importance_{tf}m.csv"))
        for f_ in summ[f"{tf}m"]["flagged"]:
            a, b = np.percentile(gf[f_].values, [100 / 3, 200 / 3])
            t_, bo = gh[f_].values >= b, gh[f_].values <= a
            dd = boot_diff(yh[t_], gh.date.values[t_], yh[bo], gh.date.values[bo], rng)
            lo, hi = float(np.nanpercentile(dd, C.BOOT_LO)), float(np.nanpercentile(dd, C.BOOT_HI))
            sdir = float(imp.loc[imp.feature == f_, "shap_direction"].iloc[0])
            diff = float(np.nanmean(dd))
            ok = (np.sign(diff) == np.sign(sdir)) and (lo > 0 or hi < 0)
            flagrows.append(dict(tf=f"{tf}m", feature=f_, fit_cut_lo=float(a),
                                 fit_cut_hi=float(b), n_top=int(t_.sum()),
                                 n_bottom=int(bo.sum()),
                                 mean_netR_top=float(yh[t_].mean()) if t_.any() else np.nan,
                                 mean_netR_bottom=float(yh[bo].mean()) if bo.any() else np.nan,
                                 top_minus_bottom=diff, lo=lo, hi=hi,
                                 fit_shap_direction=sdir,
                                 wording="OOS-consistent" if ok
                                 else "not confirmed out of sample"))
        print(f"[holdout] {tf}m: spearman={sp:+.4f} "
              f"top-bottom={rows[-1]['top_minus_bottom']:+.4f}", flush=True)
    pd.DataFrame(rows).to_csv(os.path.join(OUT, "holdout_frozen_read.csv"), index=False)
    pd.DataFrame(flagrows).to_csv(os.path.join(OUT, "holdout_flagged_features.csv"), index=False)
    print(pd.DataFrame(rows).round(4).to_string(index=False))
    if flagrows:
        print(pd.DataFrame(flagrows).round(4).to_string(index=False))
    else:
        print("no flagged features — nothing to read out of sample")


if __name__ == "__main__":
    {"train": train, "holdout": holdout}[sys.argv[1] if len(sys.argv) > 1 else "train"]()
