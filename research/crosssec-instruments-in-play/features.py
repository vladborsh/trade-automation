"""§8.2.2 — the per-(symbol, anchor day) panel.

One row for EVERY (symbol, anchor day) pair the archive can speak about, with
the seven §1.3 eligibility rules evaluated individually, the two selector
values, the direction reader, the volatility unit and the 1m indices the
engine needs. The whole eligible panel is evaluated once; selection happens
afterwards (§8.2.5) — that is what makes the 1,000-draw null an index lookup.

Everything here is computed from bars with open time < A + 30 min, except the
declared §1.3 rule 6 (tape runs through the exit) and the descriptive
delisting columns of §9. `checks.py` re-derives rules 1-5 and 7 plus both
selectors from tapes truncated at A + 30 min and asserts equality.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

PANEL_COLS = [
    "symbol", "date", "anchor_ms",
    # eligibility
    "r1_listed", "r2_window", "r3_rvol_den", "r4_atr", "r5_liq", "r6_tape",
    "r7_tr24", "elig_A", "elig_B",
    # selector A
    "v30", "rvol", "rvol_den_days",
    # selector B
    "tr24", "tr12", "tr48",
    # reader / risk
    "r30", "entry", "datr14", "liq_med", "listed_days",
    # path indices into the symbol's own 1m tape
    "i_entry", "i_path0", "i_path1", "path_bars", "path_missing",
    # §9 descriptive
    "last_bar_ms", "delist_days_after",
]


def _tape(sym: str) -> pd.DataFrame | None:
    p = os.path.join(C.DATA_1M, f"{sym}.parquet")
    if not os.path.exists(p):
        return None
    df = pd.read_parquet(p)
    return df.drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)


def _px_at(t: np.ndarray, close: np.ndarray, target: np.ndarray,
           tol_min: int = C.PRICE_TOL_MIN) -> np.ndarray:
    """§2.2 P(t) — close of the LAST 1m bar with open time in [t - tol, t);
    NaN if none."""
    j = np.searchsorted(t, target, side="left") - 1
    out = np.full(len(target), np.nan)
    ok = (j >= 0)
    if ok.any():
        good = ok.copy()
        good[ok] &= (target[ok] - t[j[ok]]) <= tol_min * C.MIN_MS
        out[good] = close[j[good]]
    return out


def symbol_panel(sym: str, dates: list[str], uni: dict,
                 anchor_hh_mm=C.ANCHOR_NY, anchor_tz: str = "ny",
                 window_min: int = C.WINDOW_MIN,
                 horizon_min: int = C.HORIZON_MIN,
                 daily: pd.DataFrame | None = None) -> pd.DataFrame | None:
    """The panel rows for one symbol. `anchor_tz` = 'ny' (the registered
    anchor, DST-aware) or 'utc' (the two fit-only placebo anchors, §3.3)."""
    tp = _tape(sym)
    if tp is None or len(tp) < 100:
        return None
    t = tp.t_ms.values.astype(np.int64)
    op, hi, lo, cl = (tp.open.values, tp.high.values, tp.low.values, tp.close.values)
    qv = tp.quote_volume.values

    if anchor_tz == "ny":
        A = np.array([C.ny_ms(d, *anchor_hh_mm) for d in dates], np.int64)
    else:
        A = np.array([C.utc_ms(d, *anchor_hh_mm) for d in dates], np.int64)

    W = window_min * C.MIN_MS
    # ---- rule 2: all `window_min` bars with open time in [A, A + W) present
    i0 = np.searchsorted(t, A, "left")
    i1 = np.searchsorted(t, A + W, "left")
    nbar = i1 - i0
    first_is_A = (i0 < len(t)) & (t[np.minimum(i0, len(t) - 1)] == A)
    r2 = (nbar == window_min) & first_is_A

    # ---- V30 and the reader, on the same window
    csum = np.concatenate([[0.0], np.cumsum(qv)])
    v30 = np.where(r2, csum[np.minimum(i1, len(t))] - csum[np.minimum(i0, len(t))], np.nan)
    i_open = np.minimum(i0, len(t) - 1)
    i_ent = np.minimum(np.maximum(i1 - 1, 0), len(t) - 1)
    o_A = np.where(r2, op[i_open], np.nan)
    entry = np.where(r2, cl[i_ent], np.nan)
    r30 = entry / o_A - 1.0

    # ---- selector B: P(A) and P(A - h)
    pA = _px_at(t, cl, A)
    trs = {}
    for h in (C.TR_HOURS,) + tuple(C.TR_HOURS_SENS):
        ph = _px_at(t, cl, A - h * 3_600_000)
        trs[h] = pA / ph - 1.0
    r7 = np.isfinite(trs[C.TR_HOURS])

    # ---- path window [A + W, A + W + horizon)
    p0 = np.searchsorted(t, A + W, "left")            # first bar AFTER the entry bar
    p1 = np.searchsorted(t, A + W + horizon_min * C.MIN_MS, "left") - 1
    path_bars = np.maximum(p1 - p0 + 1, 0)
    path_missing = horizon_min - path_bars

    # ---- rules 1, 4, 5 from the 1d tape (daily_flags, already causal)
    r1 = np.zeros(len(dates), bool); r4 = r1.copy(); r5 = r1.copy()
    datr = np.full(len(dates), np.nan); liq = datr.copy(); ld = datr.copy()
    if daily is not None and len(daily):
        d = daily.set_index("date")
        idx = pd.Index(dates)
        sub = d.reindex(idx)
        r1 = sub.r1.fillna(False).values.astype(bool)
        r4 = sub.r4.fillna(False).values.astype(bool)
        r5 = sub.r5.fillna(False).values.astype(bool)
        datr = sub.atr_prev.values.astype(float)
        liq = sub.liq_med_prev.values.astype(float)
        ld = sub.listed_days.values.astype(float)

    # ---- rule 6 (declared, §1.3): the tape runs through the exit
    last_ms = int(uni["last_bar_ms"]) + C.DAY_MS          # end of the last 1d bar
    r6 = last_ms >= (A + W + horizon_min * C.MIN_MS)

    # ---- rule 3: V30 defined on >= 10 of the prior 14 anchor days
    # `r2` above is exactly "V30 defined on this anchor day"; roll it back.
    den_days = np.zeros(len(dates), np.int64)
    med = np.full(len(dates), np.nan)
    v_ok = r2.astype(np.int64)
    for k in range(len(dates)):
        a, b = max(0, k - C.RVOL_LOOKBACK), k
        if b > a:
            m = r2[a:b]
            den_days[k] = int(m.sum())
            if den_days[k] >= C.RVOL_MIN_DAYS:
                med[k] = np.median(v30[a:b][m])
    r3 = den_days >= C.RVOL_MIN_DAYS
    rvol = v30 / med

    elig_A = r1 & r2 & r3 & r4 & r5 & r6 & np.isfinite(rvol) & np.isfinite(r30) \
        & np.isfinite(datr) & (datr > 0)
    elig_B = elig_A & r7

    out = pd.DataFrame(dict(
        symbol=sym, date=dates, anchor_ms=A,
        r1_listed=r1, r2_window=r2, r3_rvol_den=r3, r4_atr=r4, r5_liq=r5,
        r6_tape=r6, r7_tr24=r7, elig_A=elig_A, elig_B=elig_B,
        v30=v30, rvol=rvol, rvol_den_days=den_days,
        tr24=trs[C.TR_HOURS], tr12=trs[12], tr48=trs[48],
        r30=r30, entry=entry, datr14=datr, liq_med=liq, listed_days=ld,
        i_entry=i_ent, i_path0=p0, i_path1=p1,
        path_bars=path_bars, path_missing=path_missing,
        last_bar_ms=last_ms,
        delist_days_after=(last_ms - A) / C.DAY_MS,
    ))
    return out[out.r1_listed | out.r2_window].reset_index(drop=True)
