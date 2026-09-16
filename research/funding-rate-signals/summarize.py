"""The mandatory reporting shapes (DESIGN §4.3, §9.2).  Every verdict-bearing
number is produced here so that none can be printed without its decomposition.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from common import tstat


DECOMP = ["n", "mean_netR", "mean_priceR", "mean_fundingR", "mean_costR",
          "mean_settlements", "share_zero_settlements", "mean_hold_h",
          "mean_grossR", "t", "win_rate"]


def decomp(df, label=""):
    if df is None or not len(df):
        return dict(label=label, n=0, **{k: np.nan for k in DECOMP[1:]})
    return dict(
        label=label,
        n=int(len(df)),
        mean_netR=float(df["netR"].mean()),
        mean_priceR=float(df["priceR"].mean()),
        mean_fundingR=float(df["fundingR"].mean()),
        mean_costR=float(df["costR"].mean()),
        mean_settlements=float(df["n_settlements"].mean()),
        share_zero_settlements=float((df["n_settlements"] == 0).mean()),
        mean_hold_h=float(df["hold_h"].mean()),
        mean_grossR=float(df["grossR"].mean()),
        t=float(tstat(df["netR"].values)),
        win_rate=float((df["netR"] > 0).mean()),
    )


def by(df, col, label_prefix=""):
    if df is None or not len(df):
        return []
    out = []
    for v, g in df.groupby(col):
        out.append(decomp(g, f"{label_prefix}{col}={v}"))
    return out


def full_block(df, name):
    rows = [decomp(df, name)]
    rows += by(df, "side", f"{name} ")
    rows += by(df, "symbol", f"{name} ")
    rows += by(df, "cause", f"{name} ")
    return rows


def fmt(rows):
    d = pd.DataFrame(rows)
    for c in d.columns:
        if c != "label" and c != "n":
            d[c] = d[c].astype(float).round(4)
    return d
