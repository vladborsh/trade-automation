"""Shared plumbing for the spot-lead pass (DESIGN.md §1-§4).

Tapes are held as DENSE minute arrays (NaN where a minute is missing) on a
grid that starts at a 4 h boundary, so a 4 h bar is a reshape(-1, 240) and a
trade path is a slice.  Nothing here reads a return; `data_audit.py` and the
engine build on it.
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "results")
CACHE = os.path.join(HERE, "cache")
for d in (OUT, CACHE):
    os.makedirs(d, exist_ok=True)

MAJORS = ["BTCUSDT", "ETHUSDT"]
ALTS = ["SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"]
SYMBOLS = MAJORS + ALTS
TIER_OF = {s: ("majors" if s in MAJORS else "alts") for s in SYMBOLS}

BAR_MIN = 240                    # 4 h
MIN_PRESENT = 228                # §1.1 validity: >= 228 of 240 minutes, both legs
ATR_N = 14
WARMUP_BARS = 15
MOVE_K = 0.25                    # §1.2 thr = 0.25 * ATR / price
STOP_K = 1.5                     # §3 stop = 1.5 * ATR
HOLD_MIN = 5 * 24 * 60           # §3 time stop, minutes
COST_RT = 0.0010                 # §4

FIT_END = pd.Timestamp("2025-08-01", tz="UTC")       # exclusive; boundary exit
HOLD_START = FIT_END
HOLD_END = pd.Timestamp("2026-08-01", tz="UTC")      # exclusive (entries)

LABELS = ["SPOT_LED", "PERP_LED", "ABSORPTION", "DISTRIBUTION", "NONE"]
L_SPOT, L_PERP, L_ABS, L_DIST, L_NONE, L_INVALID = 0, 1, 2, 3, 4, -1

NS_PER_MIN = 60_000_000_000


def load_leg(symbol: str, leg: str) -> pd.DataFrame:
    """leg in {'perp1m','spot1m'}; returns ts-sorted unique minutes."""
    df = pd.read_parquet(os.path.join(DATA, f"{symbol}-{leg}.parquet"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    n0 = len(df)
    df = df.drop_duplicates(subset="ts", keep="last").sort_values("ts")
    df.attrs["n_dup"] = n0 - len(df)
    return df.reset_index(drop=True)


def load_funding(symbol: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(DATA, f"{symbol}-funding.csv.gz"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True, format="mixed")
    df["last_funding_rate"] = pd.to_numeric(df["last_funding_rate"], errors="coerce")
    df["funding_interval_hours"] = pd.to_numeric(df["funding_interval_hours"],
                                                 errors="coerce")
    n0 = len(df)
    df = df.drop_duplicates(subset="ts", keep="last").sort_values("ts")
    df = df.dropna(subset=["last_funding_rate"]).reset_index(drop=True)
    df.attrs["n_dup"] = n0 - len(df)
    return df


def _minute(ts) -> np.ndarray:
    return (pd.DatetimeIndex(ts).as_unit("ns").asi8 // NS_PER_MIN).astype(np.int64)


class Tape:
    """Dense 1m perp + spot arrays for one symbol on a 4h-aligned grid."""

    def __init__(self, symbol: str, perp: pd.DataFrame | None = None,
                 spot: pd.DataFrame | None = None,
                 funding: pd.DataFrame | None = None):
        self.symbol = symbol
        perp = load_leg(symbol, "perp1m") if perp is None else perp
        spot = load_leg(symbol, "spot1m") if spot is None else spot
        self.funding_df = load_funding(symbol) if funding is None else funding
        pm, sm = _minute(perp["ts"]), _minute(spot["ts"])
        start = max(pm[0], sm[0])
        start = -(-start // BAR_MIN) * BAR_MIN            # ceil to 4h boundary
        end = max(pm[-1], sm[-1]) + 1
        end = -(-end // BAR_MIN) * BAR_MIN
        self.m0 = int(start)                              # minute id of index 0
        n = int(end - start)
        self.n = n

        def dense(m, df, cols):
            keep = (m >= start) & (m < end)
            idx = (m[keep] - start).astype(np.int64)
            out = {}
            for c in cols:
                a = np.full(n, np.nan)
                a[idx] = df[c].to_numpy(float)[keep]
                out[c] = a
            return out

        cols = ["open", "high", "low", "close", "volume", "taker_buy_volume"]
        self.p = dense(pm, perp, cols)
        self.s = dense(sm, spot, cols)
        # DESIGN §9: a minute whose taker_buy_volume is outside [0, volume]
        # contributes no delta (prices kept).  One such row exists (XRP perp).
        self.n_taker_bad = 0
        for leg in (self.p, self.s):
            tb, vol = leg["taker_buy_volume"], leg["volume"]
            bad = (tb < -1e-12) | (tb > vol * (1 + 1e-9) + 1e-12)
            self.n_taker_bad += int(bad.sum())
            tb[bad] = np.nan
            vol[bad] = np.nan
        self.first_perp_min = int(pm[0])
        self.first_spot_min = int(sm[0])

    # ---- time helpers -------------------------------------------------------
    def idx_of(self, ts) -> np.ndarray:
        return _minute(ts) - self.m0

    def ts_of(self, idx) -> pd.DatetimeIndex:
        return pd.to_datetime((np.asarray(idx, np.int64) + self.m0) * NS_PER_MIN,
                              utc=True)

    # ---- funding ------------------------------------------------------------
    def funding_arrays(self):
        """Settlement minute index (relative), rate, price P(t_j), and the
        per-settlement 'missing slots before it' count (§4)."""
        f = self.funding_df
        mj = _minute(f["ts"]) - self.m0
        rate = f["last_funding_rate"].to_numpy(float)
        iv = f["funding_interval_hours"].fillna(8).to_numpy(float)
        gap_h = np.diff(mj, prepend=mj[0]) / 60.0
        # missing slots between the previous row and this one
        miss = np.where(gap_h > 1.5 * iv, np.round(gap_h / iv) - 1, 0).astype(int)
        miss[0] = 0
        inside = (mj >= 0) & (mj < self.n)
        px = np.full(len(mj), np.nan)
        px[inside] = self.p["open"][mj[inside]]
        return mj, rate, px, miss


def build_4h(t: Tape) -> pd.DataFrame:
    """Per-4h-bar observables and labels (DESIGN §1.2-§1.3, §5.1)."""
    nb = t.n // BAR_MIN
    P = {k: v[: nb * BAR_MIN].reshape(nb, BAR_MIN) for k, v in t.p.items()}
    S = {k: v[: nb * BAR_MIN].reshape(nb, BAR_MIN) for k, v in t.s.items()}
    n_p = np.isfinite(P["close"]).sum(1)
    n_s = np.isfinite(S["close"]).sum(1)
    with np.errstate(all="ignore"):
        hi = np.nanmax(P["high"], 1)
        lo = np.nanmin(P["low"], 1)
        # close = last present minute's close; open = first present minute's open
        last = BAR_MIN - 1 - np.argmax(np.isfinite(P["close"])[:, ::-1], 1)
        first = np.argmax(np.isfinite(P["open"]), 1)
        cl = P["close"][np.arange(nb), last]
        op = P["open"][np.arange(nb), first]
        cl[n_p == 0] = np.nan
        op[n_p == 0] = np.nan
        cvd_p = np.nansum(2 * P["taker_buy_volume"] - P["volume"], 1)
        cvd_s = np.nansum(2 * S["taker_buy_volume"] - S["volume"], 1)

    # Wilder ATR(14) over bars with perp data; bars without data carry.
    atr = np.full(nb, np.nan)
    trs, a, prev_c = [], np.nan, np.nan
    for k in range(nb):
        if n_p[k] == 0:
            atr[k] = a
            continue
        tr = hi[k] - lo[k] if not np.isfinite(prev_c) else max(
            hi[k] - lo[k], abs(hi[k] - prev_c), abs(lo[k] - prev_c))
        if len(trs) < ATR_N:
            trs.append(tr)
            if len(trs) == ATR_N:
                a = float(np.mean(trs))
        else:
            a = (a * (ATR_N - 1) + tr) / ATR_N
        atr[k] = a
        prev_c = cl[k]

    prev_cl = np.concatenate([[np.nan], cl[:-1]])
    ret = cl / prev_cl - 1
    thr = MOVE_K * atr / cl
    T = t.ts_of(np.arange(nb) * BAR_MIN)
    df = pd.DataFrame({
        "T": T, "t_close": T + pd.Timedelta(hours=4),
        "open": op, "high": hi, "low": lo, "close": cl,
        "n_perp": n_p, "n_spot": n_s, "cvd_spot": cvd_s, "cvd_perp": cvd_p,
        "ret": ret, "atr": atr, "thr": thr,
    })
    df["bar"] = np.arange(nb)
    valid = ((n_p >= MIN_PRESENT) & (n_s >= MIN_PRESENT) & np.isfinite(ret)
             & np.isfinite(atr) & (df["bar"] >= WARMUP_BARS)
             & np.concatenate([[False], n_p[:-1] > 0]))
    df["valid"] = valid
    df["label"] = label_of(ret, thr, cvd_s, cvd_p, valid)
    # §5.1 shadow: spot slot <- perp CVD, perp slot <- ret
    df["label_sh"] = label_of(ret, thr, cvd_p, ret, valid)
    df["dir"] = np.where(ret >= thr, 1, np.where(ret <= -thr, -1, 0))
    return df


def label_of(ret, thr, spot, perp, valid) -> np.ndarray:
    up = ret >= thr
    dn = ret <= -thr
    fl = ~up & ~dn
    lab = np.full(len(ret), L_NONE, np.int8)
    lab[fl & (spot < 0) & (perp > 0)] = L_DIST
    lab[dn & (spot > 0) & (perp < 0)] = L_ABS
    lab[up & (spot <= 0) & (perp > 0)] = L_PERP
    lab[up & (spot > 0)] = L_SPOT
    lab[~np.asarray(valid, bool)] = L_INVALID
    return lab


def window_of(t_close: pd.Series) -> np.ndarray:
    tc = pd.DatetimeIndex(t_close)
    w = np.full(len(tc), "", object)
    w[tc < FIT_END] = "fit"
    w[(tc >= HOLD_START) & (tc < HOLD_END)] = "holdout"
    return w
