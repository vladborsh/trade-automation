"""The two-tier pivot-structure primitive and the pre-registered rule-sets.

DESIGN.md §1 (`pivot_structure`), §2 (Mode S / Mode M), §4 (arms E1-T1,
E1-T2, E2-T2, control C1). `indicators.py` is imported unchanged and is NOT
modified: only `fractals()` is reused, the retired `structure()` state machine
is not.

Causality conventions, identical to v1/the MTF pass:
  * a fractal at bar i is only KNOWN at bar i+k (`indicators.fractals` shifts it)
  * every state column at bar i uses bars <= i only
  * signals fire on bar i's close and are filled at bar i+1's open by the engine
  * Mode M additionally lags every 1h-derived column by one completed 1h bar
    before `merge_asof`-ing it onto the 5m frame (the `mtf.add_htf_context`
    pattern, reused verbatim in shape).
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
from common import ind

NAN = np.nan

# DESIGN.md §4 -- frozen; the (K, k) grid is the ONLY scanned dimension
P = dict(
    buf=0.25,          # stop buffer behind the leg extreme, x atr
    t1_rr=2.0,         # arm T1 fixed target
    fb_rr=3.0,         # T2 fallback when no opposing major swing exists
    cap_rr=6.0,        # T2 cap
    retest_band=0.25,  # E2 touch band around the broken minor swing, x atr
    retest_win_S=12,   # E2 window, Mode S bars
    retest_win_M=36,   # E2 window, Mode M bars
    time_stop_S=48,    # Mode S: 48 x 1h
    time_stop_M=288,   # Mode M: 288 x 5m = 24h
)

GRID_K = [10, 15, 20]
GRID_k = [2, 3, 4, 5]
PRIMARY = (15, 4, "S")


# ------------------------------------------------------------------ major tier
def major_track(df: pd.DataFrame, K: int) -> pd.DataFrame:
    """Last confirmed, still-unbroken major swing levels + the major-break bias.

    Mirrors `structure()`'s level bookkeeping (a level is cleared once a close
    breaks beyond it) but emits no BOS/CHoCH/OB/FVG: the major tier is
    non-gating by DESIGN.md §3.1, it only initialises `B` and supplies the T2
    target reference.
    """
    n = len(df)
    hi = df.high.to_numpy(); lo = df.low.to_numpy(); cl = df.close.to_numpy()
    sh_f, sl_f = ind.fractals(df, K)
    sh_f = sh_f.to_numpy(); sl_f = sl_f.to_numpy()

    MH = np.full(n, NAN); ML = np.full(n, NAN)
    mbias = np.zeros(n, dtype=np.int8); mbreak = np.zeros(n, dtype=np.int8)
    cur_h = NAN; cur_l = NAN; b = 0
    for i in range(n):
        if sh_f[i]:
            cur_h = hi[i - K] if i - K >= 0 else hi[i]
        if sl_f[i]:
            cur_l = lo[i - K] if i - K >= 0 else lo[i]
        if cur_h == cur_h and cl[i] > cur_h:
            b = 1; mbreak[i] = 1; cur_h = NAN
        elif cur_l == cur_l and cl[i] < cur_l:
            b = -1; mbreak[i] = -1; cur_l = NAN
        MH[i] = cur_h; ML[i] = cur_l; mbias[i] = b
    return pd.DataFrame({"MH": MH, "ML": ML, "mbias": mbias, "mbreak": mbreak},
                        index=df.index)


def merge_major_h1(d5: pd.DataFrame, K: int) -> pd.DataFrame:
    """Mode M: 1h major state merged onto the 5m frame with a one-completed-1h-bar
    lag -- the `mtf.add_htf_context` pattern (resample, shift(1), merge_asof)."""
    h = C.resample_h1(d5)
    mj = major_track(h, K)
    h1 = pd.DataFrame({"ts": h.ts})
    for c in ("MH", "ML", "mbias", "mbreak"):
        h1[c] = mj[c].to_numpy()
    body = h1.drop(columns=["ts"]).shift(1)
    h1 = pd.concat([h1[["ts"]], body], axis=1)
    m = pd.merge_asof(d5[["ts"]], h1, on="ts", direction="backward")
    out = pd.DataFrame(index=d5.index)
    out["MH"] = m.MH.to_numpy(); out["ML"] = m.ML.to_numpy()
    out["mbias"] = np.nan_to_num(m.mbias.to_numpy()).astype(np.int8)
    out["mbreak"] = np.nan_to_num(m.mbreak.to_numpy()).astype(np.int8)
    return out


# ------------------------------------------------------- the two-tier primitive
def pivot_structure(df: pd.DataFrame, K: int, k: int,
                    major: pd.DataFrame | None = None) -> pd.DataFrame:
    """Two-tier pivot structure (DESIGN.md §1.1).

    `major=None`  -> Mode S: the major tier is computed on `df` itself.
    `major=frame` -> Mode M: pre-merged, already-lagged 1h major state.

    Returns per bar: B (tracked bias), flip (+-1 on the flip bar), MH, ML
    (major reference levels), mh, ml (minor swings), X (running leg extreme),
    flip_level (the broken minor swing, for the E2 retest band), flip_X (the
    leg extreme at flip time, for the stop), atr.
    """
    assert k < K, f"minor half-width {k} must be < major half-width {K}"
    n = len(df)
    hi = df.high.to_numpy(); lo = df.low.to_numpy(); cl = df.close.to_numpy()
    mj = major_track(df, K) if major is None else major
    MH = mj.MH.to_numpy(); ML = mj.ML.to_numpy()
    mbias = mj.mbias.to_numpy(); mbreak = mj.mbreak.to_numpy()

    sh_f, sl_f = ind.fractals(df, k)
    sh_f = sh_f.to_numpy(); sl_f = sl_f.to_numpy()

    B = np.zeros(n, dtype=np.int8); flip = np.zeros(n, dtype=np.int8)
    mh_o = np.full(n, NAN); ml_o = np.full(n, NAN)
    X_o = np.full(n, NAN); flev = np.full(n, NAN); fX = np.full(n, NAN)

    cur_mh = NAN; cur_ml = NAN
    b = 0; X = NAN
    for i in range(n):
        if sh_f[i]:
            cur_mh = hi[i - k] if i - k >= 0 else hi[i]
        if sl_f[i]:
            cur_ml = lo[i - k] if i - k >= 0 else lo[i]

        f = 0
        if b == 0:
            # initialisation / re-initialisation: first close beyond a major swing
            if mbias[i] != 0:
                b = int(mbias[i])
                X = hi[i] if b == 1 else lo[i]
        else:
            # THE flip event: a minor CHoCH against the tracked bias IS the flip
            if b == 1 and cur_ml == cur_ml and cl[i] < cur_ml:
                f = -1; flev[i] = cur_ml
            elif b == -1 and cur_mh == cur_mh and cl[i] > cur_mh:
                f = 1; flev[i] = cur_mh
            if f != 0:
                fX[i] = X
                b = f
                X = lo[i] if f == -1 else hi[i]
            elif X == X:
                X = max(X, hi[i]) if b == 1 else min(X, lo[i])

        # a minor swing broken by a close is spent, in either direction
        if cur_mh == cur_mh and cl[i] > cur_mh:
            cur_mh = NAN
        if cur_ml == cur_ml and cl[i] < cur_ml:
            cur_ml = NAN

        B[i] = b; flip[i] = f
        mh_o[i] = cur_mh; ml_o[i] = cur_ml; X_o[i] = X

    out = pd.DataFrame({"B": B, "flip": flip, "MH": MH, "ML": ML,
                        "mh": mh_o, "ml": ml_o, "X": X_o,
                        "flip_level": flev, "flip_X": fX,
                        "mbreak": mbreak}, index=df.index)
    out["atr"] = ind.atr(df, C.ATR_LEN).to_numpy()
    return out


def build(df: pd.DataFrame, K: int, k: int, mode: str) -> pd.DataFrame:
    """Mode S (both tiers native) / Mode M (major 1h, minor native 5m)."""
    if mode == "S":
        return pivot_structure(df, K, k)
    if mode == "M":
        return pivot_structure(df, K, k, major=merge_major_h1(df, K))
    raise ValueError(mode)


# ------------------------------------------------------------------- rule-sets
def _pack(sig, stop, target, index) -> pd.DataFrame:
    out = pd.DataFrame({"sig": sig, "stop": stop, "target": target}, index=index)
    bad = out.stop.isna() | out.target.isna() | (out.stop <= 0)
    out.loc[bad, ["sig", "stop", "target"]] = [0, NAN, NAN]
    return out


def _targets(side, entry, risk, ps, i, arm, p):
    """T1 = fixed 2R; T2 = opposing major swing, 3R fallback, capped at 6R."""
    if arm.endswith("T1"):
        return entry + side * p["t1_rr"] * risk
    lvl = ps.MH.iloc[i] if side == 1 else ps.ML.iloc[i]
    if lvl != lvl or (side == 1 and lvl <= entry) or (side == -1 and lvl >= entry):
        lvl = entry + side * p["fb_rr"] * risk
    cap = entry + side * p["cap_rr"] * risk
    return min(lvl, cap) if side == 1 else max(lvl, cap)


def ruleset(df: pd.DataFrame, ps: pd.DataFrame, arm: str, mode: str,
            p: dict = P) -> pd.DataFrame:
    """Arms E1-T1 / E1-T2 / E2-T2 / C1 (DESIGN.md §4).

    E1-*  : enter on the flip bar's close (filled next open).
    E2-T2 : after a flip, wait for price to retrace to within `retest_band` x atr
            of the broken minor swing, within `retest_win` bars; no touch -> no
            trade (the missed-trade rate is reported).
    C1    : option-(b) control -- the flip only arms the trade; entry requires a
            subsequent close beyond a major swing in the flip direction, before
            the next opposite flip.
    All arms stop behind the leg extreme at flip time, buffered 0.25 x atr.
    """
    n = len(df)
    hi = df.high.to_numpy(); lo = df.low.to_numpy(); cl = df.close.to_numpy()
    fl = ps.flip.to_numpy(); fX = ps.flip_X.to_numpy(); flev = ps.flip_level.to_numpy()
    atr = ps.atr.to_numpy(); mbreak = ps.mbreak.to_numpy()
    sig = np.zeros(n, dtype=np.int8); stop = np.full(n, NAN); target = np.full(n, NAN)
    win = p["retest_win_S"] if mode == "S" else p["retest_win_M"]
    band = p["retest_band"]
    missed = 0; armed_n = 0

    pend = None            # (side, deadline, level, X_at_flip)

    def enter(i, side, xf):
        a = atr[i] if atr[i] == atr[i] else 0.0
        e = cl[i]
        sp = (xf - band * a) if side == 1 else (xf + band * a)
        risk = abs(e - sp)
        if risk <= 1e-12 or not ((side == 1 and sp < e) or (side == -1 and sp > e)):
            return False
        sig[i] = side; stop[i] = sp
        target[i] = _targets(side, e, risk, ps, i, arm, p)
        return True

    for i in range(n):
        # ---- an armed-but-unentered flip (E2 / C1)
        if pend is not None:
            side, dl, lvl, xf = pend
            expired = (i > dl) if dl is not None else False
            opposite = fl[i] != 0 and int(fl[i]) != side
            if expired or opposite:
                pend = None; missed += 1
            else:
                a = atr[i] if atr[i] == atr[i] else 0.0
                if arm.startswith("E2"):
                    hit = (lo[i] <= lvl + band * a) if side == 1 else (hi[i] >= lvl - band * a)
                else:                       # C1: major-level break in the flip direction
                    hit = int(mbreak[i]) == side
                if hit:
                    if not enter(i, side, xf):
                        missed += 1
                    pend = None
                    continue

        if fl[i] == 0:
            continue
        side = int(fl[i]); xf = fX[i]
        if xf != xf:
            continue
        armed_n += 1
        if arm.startswith("E1"):
            if not enter(i, side, xf):
                missed += 1
            continue
        # E2: fixed window; C1: no window, expires on the next opposite flip
        pend = (side, i + win if arm.startswith("E2") else None, flev[i], xf)

    out = _pack(sig, stop, target, df.index)
    out.attrs["armed"] = armed_n
    out.attrs["missed"] = missed
    return out
