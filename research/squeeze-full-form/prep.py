"""Per-symbol, point-in-time frames (DESIGN §2.2, §3). Computes no R.

build_symbol(sym) -> dict with
  m1    : perp 1m arrays (ns timestamps, o/h/l/c, cumulative tp*v and v for VWAP)
  b15   : perp 15m bars on the full UTC grid (NaN = missing), atr at the bar's
          close, P2 trigger inputs (vectorised), pivot arrays for P1
  dec   : one row per 4h decision instant T with every observable of §3
  fund  : Binance settlements (ns, rate) for the P&L leg
Cached to data/cache/<sym>.pkl.
"""
from __future__ import annotations
import os, pickle
import numpy as np
import pandas as pd

from common import (DATA, CACHE, SYMBOLS, PCT_WINDOW, PCT_MINP, PCT_HI, PCT_LO,
                    FLOOR, VENUE_STALE, VENUES, SOL_BLACKOUT, W15, FH_ATR,
                    OI_LAG, OI_STALE, COMP_ATR, P2_VOL_Q, NS_15M,
                    rolling_pct_rank, wilder_atr)

AGG = {"open": "first", "high": "max", "low": "min", "close": "last",
       "volume": "sum", "taker_buy_volume": "sum"}


def load_perp1m(sym):
    return pd.read_parquet(os.path.join(DATA, f"{sym}-perp1m.parquet"))


def resample(df1, rule):
    g = df1.set_index("ts").resample(rule, label="left", closed="left")
    out = g.agg(AGG)
    out["n"] = g["close"].count()
    miss = out["n"] == 0
    out.loc[miss, ["open", "high", "low", "close", "volume",
                   "taker_buy_volume"]] = np.nan
    return out


def venue_state(sym, venue, cut=None):
    """Funding state per settlement row for one venue (§3)."""
    p = os.path.join(DATA, f"{sym}-funding-{venue}.parquet")
    f = pd.read_parquet(p)[["ts", "rate"]].dropna()
    f = f.sort_values("ts").drop_duplicates("ts", keep="last")
    if cut is not None:
        f = f[f.ts < cut]
    if sym == "SOLUSDT":
        a, b = SOL_BLACKOUT
        f = f[~((f.ts >= a) & (f.ts < b))]
    f = f.reset_index(drop=True)
    f["pct"] = rolling_pct_rank(f["rate"], PCT_WINDOW, PCT_MINP)
    f["hi"] = (f["pct"] >= PCT_HI) & (f["rate"] >= FLOOR)
    f["lo"] = (f["pct"] <= PCT_LO) & (f["rate"] <= -FLOOR)
    return f


def state_at(f, T_ns):
    """Venue state at each decision instant: last row with ts <= T."""
    ts = f["ts"].values.astype("datetime64[ns]").astype(np.int64)
    if len(ts) == 0:
        z = np.zeros(len(T_ns), bool)
        return z, z, z, np.full(len(T_ns), np.nan)
    idx = np.searchsorted(ts, T_ns, side="right") - 1
    ok = idx >= 0
    j = np.where(ok, idx, 0)
    age = T_ns - ts[j]
    present = ok & f["pct"].notna().values[j] & (age <= VENUE_STALE.value)
    hi = present & f["hi"].values[j]
    lo = present & f["lo"].values[j]
    rate = np.where(ok, f["rate"].values[j], np.nan)
    return present, hi, lo, rate


def build_symbol(sym, use_cache=True, cut=None):
    """cut: truncate every input at this instant (checks.py prefix test; no cache)."""
    cp = os.path.join(CACHE, f"{sym}.pkl")
    if cut is not None:
        use_cache = False
    if use_cache and os.path.exists(cp):
        with open(cp, "rb") as fh:
            return pickle.load(fh)

    p1 = load_perp1m(sym)
    if cut is not None:
        p1 = p1[p1.ts < cut].reset_index(drop=True)
    m1 = dict(ts=p1["ts"].values.astype("datetime64[ns]").astype(np.int64),
              o=p1["open"].values, h=p1["high"].values, l=p1["low"].values,
              c=p1["close"].values)
    tp = (p1["high"] + p1["low"] + p1["close"]).values / 3.0
    v = p1["volume"].values
    m1["cum_pv"] = np.concatenate([[0.0], np.cumsum(tp * v)])
    m1["cum_v"] = np.concatenate([[0.0], np.cumsum(v)])

    b = resample(p1, "15min")
    h1 = resample(p1, "1h")
    del p1
    # ATR(1h,14) on present 1h bars only, then known at label + 1h
    h1p = h1.dropna(subset=["close"])
    atr = pd.Series(wilder_atr(h1p["high"], h1p["low"], h1p["close"], 14),
                    index=h1p.index)
    # at a 15m close c: last completed 1h bar is labelled floor_h(c - 1h)
    close_t = b.index + pd.Timedelta(minutes=15)
    lab = (close_t - pd.Timedelta(hours=1)).floor("1h")
    b["atr"] = atr.reindex(lab, method="ffill").values

    # spot 15m -> CVD
    sp = pd.read_parquet(os.path.join(DATA, f"{sym}-spot15m.parquet")).set_index("ts")
    sp = sp[~sp.index.duplicated(keep="last")]
    if cut is not None:
        sp = sp[sp.index < cut]
    b["cvd_perp_bar"] = 2 * b["taker_buy_volume"] - b["volume"]
    sp_cvd = (2 * sp["taker_buy_volume"] - sp["volume"]).reindex(b.index)
    b["cvd_spot_bar"] = sp_cvd.values

    hi, lo, cl = b["high"].values, b["low"].values, b["close"].values
    n = len(b)
    present = ~np.isnan(cl)
    # 3-bar pivots, confirmed by bar j+1
    ph = np.zeros(n, bool); pl = np.zeros(n, bool)
    ph[1:-1] = (hi[1:-1] > hi[:-2]) & (hi[1:-1] > hi[2:])
    pl[1:-1] = (lo[1:-1] < lo[:-2]) & (lo[1:-1] < lo[2:])
    b["ph"], b["pl"] = ph, pl
    # contiguity of the 96 bars ending at k and of the 96 bars before k
    pres_s = pd.Series(present.astype(float), index=b.index)
    b["contig96"] = pres_s.rolling(W15).min().values == 1.0
    b["contig96_prior"] = np.concatenate([[False], b["contig96"].values[:-1]])
    # P2 trigger inputs over bars k-96..k-1 (vectorised)
    b["H_prior"] = b["high"].rolling(W15).max().shift(1).values
    b["L_prior"] = b["low"].rolling(W15).min().shift(1).values
    b["vq_prior"] = b["volume"].rolling(W15).quantile(P2_VOL_Q).shift(1).values

    # ---------------------------------------------------------------- dec ----
    t0 = b.index[0].ceil("4h") + pd.Timedelta(hours=24)
    T = pd.date_range(t0, b.index[-1] + pd.Timedelta(minutes=15), freq="4h")
    T_ns = T.values.astype("datetime64[ns]").astype(np.int64)
    b_ns = b.index.values.astype("datetime64[ns]").astype(np.int64)
    kT = np.searchsorted(b_ns, T_ns - NS_15M)       # bar labelled T-15m
    kT = np.minimum(kT, n - 1)
    ok_k = b_ns[kT] == T_ns - NS_15M
    d = pd.DataFrame(index=T)
    d["kT"] = kT
    d["contig"] = ok_k & b["contig96"].values[kT]
    atrT = b["atr"].values[kT]
    d["atr"] = atrT
    closeT = cl[kT]
    d["close"] = closeT
    k24 = kT - W15
    d["ret24"] = np.where(k24 >= 0, closeT / cl[np.maximum(k24, 0)] - 1.0, np.nan)
    cvdp = pd.Series(b["cvd_perp_bar"].values).rolling(16, min_periods=16).sum().values
    cvds = pd.Series(b["cvd_spot_bar"].values).rolling(16, min_periods=16).sum().values
    d["cvd_perp"] = cvdp[kT]
    d["cvd_spot"] = cvds[kT]
    H24 = b["high"].rolling(W15).max().values[kT]
    L24 = b["low"].rolling(W15).min().values[kT]
    d["H24"], d["L24"] = H24, L24
    fh = np.zeros(len(T), int); fl = np.zeros(len(T), int)
    for i, k in enumerate(kT):
        if not d["contig"].values[i] or not np.isfinite(atrT[i]):
            continue
        j0, j1 = k - W15 + 1, k                         # pivots j in [k-95, k-1]
        jj = np.arange(j0, j1)
        m = ph[j0:j1] & (H24[i] - hi[j0:j1] <= FH_ATR * atrT[i]) & (cl[j0:j1] < H24[i])
        fh[i] = int(m.sum())
        m = pl[j0:j1] & (lo[j0:j1] - L24[i] <= FH_ATR * atrT[i]) & (cl[j0:j1] > L24[i])
        fl[i] = int(m.sum())
    d["fh"], d["fl"] = fh, fl
    d["compress"] = closeT >= H24 - COMP_ATR * atrT

    # funding, per venue
    nven = np.zeros(len(T), int); ehi = np.zeros(len(T), int); elo = np.zeros(len(T), int)
    for vname in VENUES:
        f = venue_state(sym, vname, cut)
        pr, fhi, flo, rate = state_at(f, T_ns)
        d[f"{vname}_present"], d[f"{vname}_hi"], d[f"{vname}_lo"] = pr, fhi, flo
        d[f"{vname}_rate"] = rate
        nven += pr; ehi += fhi; elo += flo
    d["n_venues"], d["ext_hi"], d["ext_lo"] = nven, ehi, elo

    # OI (metrics, 5m, lag rule)
    mt = pd.read_parquet(os.path.join(DATA, f"{sym}-metrics.parquet"))
    mt = mt[["ts", "sum_open_interest"]].dropna()
    if cut is not None:
        mt = mt[mt.ts < cut]
    mt = mt[mt["sum_open_interest"] > 0].sort_values("ts").drop_duplicates("ts")
    oi = mt.set_index("ts")["sum_open_interest"]
    oimax7 = oi.rolling("7D").max()
    o_ns = oi.index.values.astype("datetime64[ns]").astype(np.int64)

    def oi_at(t_ns):
        q = t_ns - OI_LAG.value
        idx = np.searchsorted(o_ns, q, side="right") - 1
        ok = (idx >= 0)
        j = np.where(ok, idx, 0)
        ok &= (q - o_ns[j]) <= OI_STALE.value
        return np.where(ok, oi.values[j], np.nan), np.where(ok, oimax7.values[j], np.nan)
    oiT, mx = oi_at(T_ns)
    oi24, _ = oi_at(T_ns - 24 * 3600 * 10**9)
    d["oi"], d["oi_d24h"] = oiT, oiT / oi24 - 1.0
    d["at_7d_high"] = np.isfinite(oiT) & (oiT >= mx) & (T_ns >= o_ns[0] + 7 * 86400 * 10**9)

    # price shadow on the 8h grid (funding family §5.3)
    g = pd.date_range(T[0].floor("8h"), T[-1], freq="8h")
    g_ns = g.values.astype("datetime64[ns]").astype(np.int64)
    kg = np.searchsorted(b_ns, g_ns - NS_15M)
    okg = (kg < n) & (b_ns[np.minimum(kg, n - 1)] == g_ns - NS_15M)
    cg = np.where(okg, cl[np.minimum(kg, n - 1)], np.nan)
    kg24 = kg - W15
    cg24 = np.where(okg & (kg24 >= 0), cl[np.maximum(kg24, 0)], np.nan)
    sh = pd.DataFrame({"r": cg / cg24 - 1.0}, index=g)
    if sym == "SOLUSDT":
        a, bb = SOL_BLACKOUT
        sh.loc[(sh.index >= a) & (sh.index < bb), "r"] = np.nan
    sh["spct"] = rolling_pct_rank(sh["r"], PCT_WINDOW, PCT_MINP)
    sh["pos"] = (sh["spct"] >= PCT_HI) & (sh["r"] > 0)
    sh["neg"] = (sh["spct"] <= PCT_LO) & (sh["r"] < 0)
    gi = np.searchsorted(g_ns, T_ns, side="right") - 1
    d["sh_pos"] = sh["pos"].values[gi]
    d["sh_neg"] = sh["neg"].values[gi]
    d["sh_def"] = sh["spct"].notna().values[gi]

    blk = np.zeros(len(T), bool)
    if sym == "SOLUSDT":
        a, bb = SOL_BLACKOUT
        blk = (T >= a) & (T < bb)
    d["blackout"] = blk

    fb = venue_state(sym, "binance", cut)
    fund = dict(ts=fb["ts"].values.astype("datetime64[ns]").astype(np.int64),
                rate=fb["rate"].values)
    b = b[["open", "high", "low", "close", "volume", "atr", "ph", "pl",
           "contig96", "contig96_prior", "H_prior", "L_prior", "vq_prior"]]
    out = dict(sym=sym, m1=m1, b15=b, b_ns=b_ns, dec=d, fund=fund)
    if cut is None:
        with open(cp, "wb") as fh_:
            pickle.dump(out, fh_, protocol=pickle.HIGHEST_PROTOCOL)
    return out


if __name__ == "__main__":
    import sys, time
    for s in (sys.argv[1:] or SYMBOLS):
        t = time.time()
        o = build_symbol(s, use_cache=False)
        print(s, len(o["dec"]), f"{time.time()-t:.1f}s", flush=True)
