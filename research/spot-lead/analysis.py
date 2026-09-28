"""Arm evaluation shared by stage 1 (fit) and stage 2 (holdout), DESIGN §5-§6."""
from __future__ import annotations
import numpy as np
import pandas as pd

from engine import arm_trades, summary, boot_mean, boot_diff, boot_paired, placebo
from common import L_SPOT

MARGIN = 0.05


def _any(d):
    return np.ones(len(d), bool)


def _up(d):
    return (d.dir == 1).to_numpy()


def evaluate(O: pd.DataFrame, window: str) -> tuple[pd.DataFrame, dict]:
    """Returns (rows table, trades dict).  One row per (arm, variant)."""
    rows, trades = [], {}

    def run(arm, shadow):
        tr, excl = arm_trades(O, arm, window, shadow)
        trades[(arm, shadow)] = tr
        return tr, excl

    for arm in ("L1", "L1c", "L2", "L3", "L4B", "L4F"):
        for sh in (False, True):
            if arm in ("L4B",) and sh:
                continue
            tr, excl = run(arm, sh)
            r = dict(arm=arm, variant="shadow" if sh else "real", window=window,
                     excluded=excl, **summary(tr))
            if len(tr):
                pool = _up if arm.startswith("L4F") else _any
                p, means = placebo(O, tr, pool)
                r["placebo_p"] = p
                r["placebo_mean"] = means.mean()
                r["boot_lo"], r["boot_hi"] = boot_mean(tr)
            rows.append(r)
    tab = pd.DataFrame(rows)

    # margins / contrasts ---------------------------------------------------------
    M = {}
    for arm in ("L1", "L2", "L3"):
        a, b = trades[(arm, False)], trades[(arm, True)]
        d = a.netR.mean() - b.netR.mean()
        lo, hi = boot_diff(a, b)
        M[f"{arm}_shadow_margin"] = dict(diff=d, lo=lo, hi=hi)
    a, c = trades[("L1", False)], trades[("L1c", False)]
    lo, hi = boot_diff(a, c)
    M["L1_contrast_vs_L1c"] = dict(diff=a.netR.mean() - c.netR.mean(), lo=lo, hi=hi)
    F, Bs, Fs = trades[("L4F", False)], trades[("L4B", False)], trades[("L4F", True)]
    lo, hi = boot_paired(F, Bs)
    M["L4_delta"] = dict(diff=F.netR.mean() - Bs.netR.mean(), lo=lo, hi=hi,
                         keep=len(F) / len(Bs))
    lo, hi = boot_paired(Fs, Bs)
    M["L4_shadow_delta"] = dict(diff=Fs.netR.mean() - Bs.netR.mean(), lo=lo, hi=hi,
                                keep=len(Fs) / len(Bs))
    lo, hi = boot_diff(F, Fs)
    M["L4_shadow_margin"] = dict(diff=F.netR.mean() - Fs.netR.mean(), lo=lo, hi=hi)
    return tab, trades, M


def breakdown(trades: dict, arm: str, shadow=False) -> pd.DataFrame:
    tr = trades[(arm, shadow)]
    out = []
    for key, g in [("pooled", tr)] + [(f"tier:{k}", v) for k, v in tr.groupby("tier")] \
            + [(f"sym:{k}", v) for k, v in tr.groupby("symbol")]:
        out.append(dict(arm=arm, variant="shadow" if shadow else "real", group=key,
                        **summary(g)))
    return pd.DataFrame(out)
