"""Timeframe alignment + the two MTF-SMC rule-sets (MTF-SMC-DESIGN.md §1-§3).

Everything is causal and reproduces v1's lag discipline exactly:
  * fractal swings on BOTH timeframes confirm `k` bars late (indicators.fractals)
  * every 1h-derived column is shift(1)-ed before being merged onto the 5m frame,
    so a 5m bar only ever sees the last COMPLETED 1h bar (§1.2)
  * signals fire on a 5m bar's close and are filled at the next 5m bar's open
    by the engine (backtest.run), unchanged from v1.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
from common import ind, st

P = dict(
    k=2,                 # fractal half-width, BOTH timeframes
    htf_mult=12,         # 12 x 5m = 1h
    atr_len=14,
    time_stop=144,       # 144 x 5m bars = 12h (§1.4)
    # --- Variant A (§2.4)
    fresh=24,            # 1h BOS freshness window, in completed 1h bars
    a_buf=0.25,          # stop buffer, x atr_5m
    a_rr=3.0,            # fixed 3R target
    # --- Variant B (§3.4)
    liq_band=0.25,       # LIQ zone half-width, x h1_atr
    window=36,           # entry window after a zone touch, in 5m bars
    zone_fail=0.5,       # close beyond the far side by this x h1_atr -> stand down
    b_buf=0.25,          # stop buffer, x atr_5m
    cap_rr=6.0,          # target cap in R
    fb_rr=3.0,           # fallback target when no structural level exists
)

H1_COLS = ["bias", "bos", "choch", "swing_high", "swing_low",
           "ob_low", "ob_high", "ob_dir", "fvg_low", "fvg_high", "fvg_dir", "sweep"]


# ------------------------------------------------------------------ alignment
def resample_h1(d5: pd.DataFrame, p: dict) -> pd.DataFrame:
    """5m -> 1h OHLCV, left-labelled (pandas default), same rule helper as v1."""
    rule = st._htf_rule(d5, p["htf_mult"])
    h = (d5.set_index("ts")
           .resample(rule)
           .agg({"open": "first", "high": "max", "low": "min",
                 "close": "last", "volume": "sum"})
           .dropna()
           .reset_index())
    return h


def add_htf_context(d5: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Merge one-bar-lagged 1h structure state onto the 5m frame as `h1_*` (§1.2)."""
    h = resample_h1(d5, p)
    sh = ind.structure(h, p["k"])
    h1 = pd.DataFrame({"ts": h.ts})
    for c in H1_COLS:
        h1["h1_" + c] = sh[c].to_numpy()
    h1["h1_atr"] = ind.atr(h, p["atr_len"]).to_numpy()

    # shift(1): the state attached to the 1h bar labelled T is the state as of the
    # CLOSE of the previous 1h bar, i.e. fully known throughout T..T+59min.
    body = h1.drop(columns=["ts"]).shift(1)

    # BOS freshness, computed on the already-shifted 1h column (§2.1)
    up = (body["h1_bos"] == 1).astype(float)
    dn = (body["h1_bos"] == -1).astype(float)
    body["h1_bos_recent_up"] = up.rolling(p["fresh"], min_periods=1).max().fillna(0)
    body["h1_bos_recent_dn"] = dn.rolling(p["fresh"], min_periods=1).max().fillna(0)

    h1 = pd.concat([h1[["ts"]], body], axis=1)
    m = pd.merge_asof(d5[["ts"]], h1, on="ts", direction="backward")
    out = d5.copy()
    for c in h1.columns:
        if c == "ts":
            continue
        out[c] = m[c].to_numpy()
    for c in ("h1_bias", "h1_bos", "h1_choch", "h1_ob_dir", "h1_fvg_dir", "h1_sweep",
              "h1_bos_recent_up", "h1_bos_recent_dn"):
        out[c] = out[c].fillna(0)
    return out


def prepare(d5: pd.DataFrame, p: dict) -> pd.DataFrame:
    """5m own structure + ATR (v1 `prepare()` minus the MR-only columns), then the
    1h context merge."""
    d = d5.copy()
    d["atr"] = ind.atr(d, p["atr_len"])
    d = pd.concat([d, ind.structure(d, p["k"])], axis=1)
    return add_htf_context(d, p)


# ------------------------------------------------------------------- VARIANT A
def variant_a(d: pd.DataFrame, p: dict, bias_override: np.ndarray | None = None) -> pd.DataFrame:
    """1h bias + freshness (context) -> 5m OB/FVG retest (trigger). §2.2.

    `bias_override` replaces the 1h bias SIGN only (used by the §5.4
    random-direction permutation control); the freshness gate keeps its true
    on/off pattern so the null preserves the gate's autocorrelation.
    """
    hb = d.h1_bias.to_numpy() if bias_override is None else bias_override
    gate_up = (hb == 1) & (d.h1_bos_recent_up.to_numpy() == 1)
    gate_dn = (hb == -1) & (d.h1_bos_recent_dn.to_numpy() == 1)

    in_ob_l = (d.ob_dir == 1) & (d.low <= d.ob_high) & (d.close > d.ob_low)
    in_fv_l = (d.fvg_dir == 1) & (d.low <= d.fvg_high) & (d.close > d.fvg_low)
    long_ = gate_up & (d.bias.to_numpy() == 1) & (in_ob_l | in_fv_l).to_numpy()

    in_ob_s = (d.ob_dir == -1) & (d.high >= d.ob_low) & (d.close < d.ob_high)
    in_fv_s = (d.fvg_dir == -1) & (d.high >= d.fvg_low) & (d.close < d.fvg_high)
    short = gate_dn & (d.bias.to_numpy() == -1) & (in_ob_s | in_fv_s).to_numpy()

    sig = np.where(long_ & ~short, 1, np.where(short & ~long_, -1, 0))
    base_lo = np.where(d.ob_dir == 1, d.ob_low, d.fvg_low)
    base_hi = np.where(d.ob_dir == -1, d.ob_high, d.fvg_high)
    buf = p["a_buf"] * d.atr
    stop = np.where(sig == 1, np.minimum(base_lo, d.low) - buf,
                    np.where(sig == -1, np.maximum(base_hi, d.high) + buf, np.nan))
    risk = np.abs(d.close.to_numpy() - stop)
    target = np.where(sig == 1, d.close + p["a_rr"] * risk,
                      np.where(sig == -1, d.close - p["a_rr"] * risk, np.nan))
    return _pack(d, sig, stop, target)


def bias_segments(hb: np.ndarray) -> list[tuple[int, int, int]]:
    """Contiguous (start, end, sign) runs of the 1h bias column on the 5m frame."""
    segs = []
    i = 0
    n = len(hb)
    while i < n:
        j = i
        while j + 1 < n and hb[j + 1] == hb[i]:
            j += 1
        segs.append((i, j + 1, int(hb[i])))
        i = j + 1
    return segs


def random_direction_bias(hb: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """§5.4 control for Variant A: keep every bias regime's extent, randomise its sign."""
    out = hb.copy()
    for a, b, s in bias_segments(hb):
        if s != 0:
            out[a:b] = 1 if rng.random() < 0.5 else -1
    return out


# ------------------------------------------------------------------- VARIANT B
# zone type codes
OB, FVG, LIQ = 0, 1, 2
ZONE_NAMES = {OB: "OB", FVG: "FVG", LIQ: "LIQ"}


def zone_bands(d: pd.DataFrame, p: dict) -> dict:
    """Per-5m-bar active 1h zone bands, one slot per (type, direction) (§3.1)."""
    ob_dir = d.h1_ob_dir.to_numpy(); fv_dir = d.h1_fvg_dir.to_numpy()
    obl, obh = d.h1_ob_low.to_numpy(), d.h1_ob_high.to_numpy()
    fvl, fvh = d.h1_fvg_low.to_numpy(), d.h1_fvg_high.to_numpy()
    sl, sh = d.h1_swing_low.to_numpy(), d.h1_swing_high.to_numpy()
    ha = d.h1_atr.to_numpy()
    nan = np.nan
    band = p["liq_band"]

    def slot(active, lo, hi):
        return (np.where(active, lo, nan), np.where(active, hi, nan))

    z = {}
    z[(OB, 1)] = slot(ob_dir == 1, obl, obh)
    z[(OB, -1)] = slot(ob_dir == -1, obl, obh)
    z[(FVG, 1)] = slot(fv_dir == 1, fvl, fvh)
    z[(FVG, -1)] = slot(fv_dir == -1, fvl, fvh)
    # a swing LOW is a LONG zone (sweep the low, reclaim); swing HIGH is a SHORT zone
    z[(LIQ, 1)] = slot(~np.isnan(sl), sl - band * ha, sl + band * ha)
    z[(LIQ, -1)] = slot(~np.isnan(sh), sh - band * ha, sh + band * ha)
    return z


def zone_identity(d: pd.DataFrame) -> dict:
    """Stable identity per (type, direction) slot -- what makes a zone the SAME zone.

    OB/FVG bands are fixed at creation, so the band low identifies them. A LIQ band
    is re-derived every bar from `h1_swing_low/high +- 0.25 * h1_atr`, so its numeric
    bounds move with ATR while the zone itself is unchanged: its identity is the
    swing level. Getting this wrong would silently re-arm the one-entry-per-zone rule
    every hour.
    """
    ob_dir = d.h1_ob_dir.to_numpy(); fv_dir = d.h1_fvg_dir.to_numpy()
    obl = d.h1_ob_low.to_numpy(); fvl = d.h1_fvg_low.to_numpy()
    sl, sh = d.h1_swing_low.to_numpy(), d.h1_swing_high.to_numpy()
    nan = np.nan
    return {
        (OB, 1): np.where(ob_dir == 1, obl, nan),
        (OB, -1): np.where(ob_dir == -1, obl, nan),
        (FVG, 1): np.where(fv_dir == 1, fvl, nan),
        (FVG, -1): np.where(fv_dir == -1, fvl, nan),
        (LIQ, 1): sl,
        (LIQ, -1): sh,
    }


def offset_zones(z: dict, ident: dict, ha: np.ndarray, rng: np.random.Generator,
                 k: float = 3.0) -> dict:
    """§5.4 control for Variant B: keep each zone's width and lifetime, move it to a
    price offset drawn uniformly within +-k * h1_atr of the true location."""
    out = {}
    for key, (lo, hi) in z.items():
        lo2 = lo.copy(); hi2 = hi.copy()
        idv = ident[key]
        idx = np.flatnonzero(~np.isnan(lo))
        if len(idx) == 0:
            out[key] = (lo2, hi2); continue
        off = 0.0; prev = None
        for i in idx:
            cur = idv[i]
            if prev is None or cur != prev:          # new zone lifetime -> new draw
                a = ha[i] if not np.isnan(ha[i]) else 0.0
                off = rng.uniform(-k * a, k * a)
                prev = cur
            lo2[i] = lo[i] + off
            hi2[i] = hi[i] + off
        out[key] = (lo2, hi2)
    return out


def variant_b(d: pd.DataFrame, p: dict, encoding: str,
              zones: dict | None = None, ident: dict | None = None):
    """1h zone-of-interest (context) -> 5m sweep-reclaim or CHoCH (trigger). §3.2.

    Returns the signal frame with an extra `ztypes` column carrying which zone
    types were active at each entry, for the §5.5 diagnostic split.
    """
    n = len(d)
    z = zone_bands(d, p) if zones is None else zones
    idv = zone_identity(d) if ident is None else ident
    lo = d.low.to_numpy(); hi = d.high.to_numpy(); cl = d.close.to_numpy()
    atr5 = d.atr.to_numpy(); ha = d.h1_atr.to_numpy()
    swp = d.sweep.to_numpy(); cho = d.choch.to_numpy()
    swing_hi = d.h1_swing_high.to_numpy(); swing_lo = d.h1_swing_low.to_numpy()
    use_sweep = encoding == "sweep"

    sig = np.zeros(n, dtype=np.int8)
    stop = np.full(n, np.nan); target = np.full(n, np.nan)
    types = np.empty(n, dtype=object)

    keys = list(z.keys())
    cur_id = {k: np.nan for k in keys}
    deadline = {k: -1 for k in keys}
    consumed = {k: False for k in keys}
    zfail = p["zone_fail"]; win = p["window"]

    for i in range(n):
        long_lo = []; short_hi = []; act = []
        for key in keys:
            zlo = z[key][0][i]
            if zlo != zlo:                                  # NaN -> no active zone
                cur_id[key] = np.nan; deadline[key] = -1; consumed[key] = False
                continue
            cid = idv[key][i]
            if cid != cur_id[key]:                          # new zone -> re-armed
                cur_id[key] = cid; deadline[key] = -1; consumed[key] = False
            if consumed[key]:
                continue
            if deadline[key] >= 0 and i > deadline[key]:    # window expired -> spent
                consumed[key] = True; continue
            zhi = z[key][1][i]
            zd = key[1]
            a = ha[i]
            if a != a:
                a = 0.0
            if (cl[i] < zlo - zfail * a) if zd == 1 else (cl[i] > zhi + zfail * a):
                consumed[key] = True; continue           # zone failed, stand down
            if deadline[key] < 0:
                if lo[i] <= zhi and hi[i] >= zlo:           # touch opens the window
                    deadline[key] = i + win
                else:
                    continue
            if zd == 1:
                if (swp[i] == 1 and cl[i] >= zlo) if use_sweep else (cho[i] == 1):
                    long_lo.append(zlo); act.append(key)
            else:
                if (swp[i] == -1 and cl[i] <= zhi) if use_sweep else (cho[i] == -1):
                    short_hi.append(zhi); act.append(key)

        if not act or (long_lo and short_hi):    # nothing, or contradictory -> pass
            continue
        side = 1 if long_lo else -1
        for key in act:
            consumed[key] = True
        b = atr5[i]
        buf = p["b_buf"] * (b if b == b else 0.0)
        if side == 1:
            st_px = min(min(long_lo), lo[i]) - buf
            risk = cl[i] - st_px
            if risk <= 0:
                continue
            tgt = swing_hi[i]
            if tgt != tgt or tgt <= cl[i]:
                tgt = cl[i] + p["fb_rr"] * risk
            tgt = min(tgt, cl[i] + p["cap_rr"] * risk)
        else:
            st_px = max(max(short_hi), hi[i]) + buf
            risk = st_px - cl[i]
            if risk <= 0:
                continue
            tgt = swing_lo[i]
            if tgt != tgt or tgt >= cl[i]:
                tgt = cl[i] - p["fb_rr"] * risk
            tgt = max(tgt, cl[i] - p["cap_rr"] * risk)
        sig[i] = side; stop[i] = st_px; target[i] = tgt
        types[i] = "+".join(sorted({ZONE_NAMES[k[0]] for k in act}))

    out = _pack(d, sig, stop, target)
    out["ztypes"] = types
    return out


def sim_R(d: pd.DataFrame, sig: pd.DataFrame, p: dict, cost_rt: float = C.COST_RT):
    """Sizing-free trade replay used for the §5.4 permutation nulls.

    Same fill/exit mechanics as `backtest.run` -- next-bar-open entry, stop checked
    before target on ambiguous bars, `time_stop` bars max, one position at a time --
    but no equity, no 1% sizing and no daily breaker, so the statistic it returns
    (expectancy in R) is a property of the rule-set alone and is fast enough to run
    200 times. Real and null rule-sets are always compared through THIS function.
    """
    o = d.open.to_numpy(); h = d.high.to_numpy()
    l = d.low.to_numpy(); c = d.close.to_numpy()
    s = sig.sig.to_numpy(); sp = sig.stop.to_numpy(); tg = sig.target.to_numpy()
    n = len(d); ts = p["time_stop"]
    rows = []
    pos = 0; entry = stop = target = 0.0; bar_in = 0
    for i in range(n):
        if pos != 0:
            ex = None
            if pos == 1:
                if l[i] <= stop:
                    ex = (stop, "stop")
                elif h[i] >= target:
                    ex = (target, "target")
            else:
                if h[i] >= stop:
                    ex = (stop, "stop")
                elif l[i] <= target:
                    ex = (target, "target")
            if ex is None and i - bar_in >= ts:
                ex = (c[i], "time")
            if ex is not None:
                risk = abs(entry - stop)
                gross = (ex[0] - entry) * pos / risk
                rows.append((gross, gross - cost_rt * entry / risk,
                             risk / entry, i - bar_in, pos, ex[1], bar_in))
                pos = 0
        if pos == 0 and i > 0 and s[i - 1] != 0:
            side = int(s[i - 1]); px = o[i]; st_px = sp[i - 1]; tp = tg[i - 1]
            if abs(px - st_px) > 1e-12 and ((side == 1 and st_px < px < tp)
                                            or (side == -1 and tp < px < st_px)):
                pos, entry, stop, target, bar_in = side, px, st_px, tp, i
    return pd.DataFrame(rows, columns=["gross_R", "net_R", "stop_pct", "bars",
                                       "side", "reason", "i_in"])


def _pack(d, sig, stop, target) -> pd.DataFrame:
    out = pd.DataFrame({"sig": sig, "stop": stop, "target": target}, index=d.index)
    bad = out.stop.isna() | out.target.isna() | (out.stop <= 0)
    out.loc[bad, ["sig", "stop", "target"]] = [0, np.nan, np.nan]
    return out
