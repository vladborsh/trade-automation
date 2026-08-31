"""Shared plumbing for the session-liquidity **drill-down** pass (post-v4).

Brief: `DESIGN.md` in this directory, **as reframed 2026-08-31 after the v4
pass**. Authoritative definitions: `knowledge/session-liquidity.md` — §3.2
(PDH/PDL level class), §5.1 **v4** (the iFVG mechanic), §6 (block-scoped
horizon, ATR units), §7 (V-ledger), §8 (descriptive protocol).

**The question this pass answers is "which level class and which window regime
select".** The iFVG-v4 mechanic is the *fixed, not-under-test entry reference*:
v4 established it keeps 64% of take-outs and its confirmed lift sits below bare
take-outs, i.e. it is a timing device, not a filter. So nothing here re-derives
or re-tunes confirmation — it is imported from the v4 package verbatim.

Imports, never modified:
  * `research/session-liquidity-v4/common.py`  — blocks, block-scoped horizon,
    session frames, ATR units (byte-equivalent to v2's).
  * `research/session-liquidity-v4/engine.py`  — `fvg_arrays`,
    **`ifvg_confirm_v4`**, `_from_confirmation`.
  * `research/session-liquidity-v4/tables.py`  — `load_events` (the v4-confirmed
    session-level stream, which is combo C1's source).

New here, and only here: the PDH/PDL level class (a second, separate stream),
the post-confirmation trendiness metric (signed ER) and the gap-size predictor.

Protocol: **descriptive only** — no permutation null, no kill rule, no pass/fail
gate. Block-scoped horizon, non-overlapping sessions, ATR(14, 5m) primary unit,
**iFVG-v4 only** (BoS still quarantined, neither computed nor drawn).
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
# The confirmation layer comes from the v4 package (§5.1 v4 is authoritative);
# the v2 package is the *parent* only in the sense of directory layout and the
# tables/report conventions this pass follows. Neither is modified.
V4 = os.path.abspath(os.path.join(HERE, "..", "..", "session-liquidity-v4"))
if V4 not in sys.path:
    sys.path.insert(0, V4)

import common as C        # noqa: E402  v4 plumbing (blocks / horizon / ATR)
import engine as E        # noqa: E402  v4 FVG geometry + ifvg_confirm_v4
import tables as T        # noqa: E402  v4 event loader / primary-sample rule

RESULTS = os.path.join(HERE, "results")
VIZ = os.path.join(HERE, "viz")
os.makedirs(RESULTS, exist_ok=True)
os.makedirs(VIZ, exist_ok=True)

SYMBOLS = C.SYMBOLS
MINB = C.MIN_BARS_REMAINING           # 12 bars = 1h, the parent primary rule

# ---------------------------------------------------------------- DD ledger --
# Choices this pass had to make that the brief left to the Researcher. Each is
# documented here and in REPORT.md §1 rather than asked upstream, per the
# brief's "ask only where a choice changes what is measured" instruction.
#
# DD1  PDH/PDL level_session label            -> "PriorDay" (a 4th value, never
#                                                mixed into Asia/London/NY)
# DD2  prior day must be materially complete  -> >= 240 of 288 5m bars, else the
#                                                day defines no PDH/PDL
# DD3  coincidence tolerance                  -> 0.05 * ATR at the take-out bar
#                                                (pinned by the knowledge file)
# DD4  signed ER span                         -> confirmation close .. block end
# DD5  ER denominator                         -> sum of |bar-to-bar close moves|
#                                                over the same span; ER is NaN
#                                                when that sum is 0
# DD6  gap-size ATR denominator               -> ATR(14) at the FVG's 3rd bar
# DD7  quintile edges                         -> per combo, pooled over assets
# DD8  window-length strata                   -> 12-24 / 24-48 / 48-72 / 72+
#                                                bars_remaining (brief-pinned)
# -----------------------------------------------------------------------------

PRIOR_DAY_MIN_BARS = 240              # DD2
COINCIDENCE_ATR = 0.05                # DD3
PD_SESSION = "PriorDay"               # DD1

# DD8 — the stratified companion's strata. Left-closed, right-open.
STRATA_BINS = [12, 24, 48, 72, 10 ** 9]
STRATA_LBL = ["12-24", "24-48", "48-72", "72+"]

COMBOS = {
    "C1": dict(label="London level swept in NY", stream="session",
               level_session="London", sweep_block="NY", hours=range(13, 21)),
    "C2": dict(label="PDH/PDL swept in NY", stream="pd",
               level_session=PD_SESSION, sweep_block="NY", hours=range(13, 21)),
    "C3": dict(label="PDH/PDL swept in Asia", stream="pd",
               level_session=PD_SESSION, sweep_block="Asia", hours=range(0, 8)),
}
COMBO_ORDER = ["C1", "C2", "C3"]


def stratum(bars_remaining: pd.Series) -> pd.Series:
    return pd.cut(bars_remaining, STRATA_BINS, right=False, labels=STRATA_LBL)


# ------------------------------------------------------------- price cache ---
class Prices:
    """Per-symbol cache of the prepped frame, FVG arrays and session frames.

    Everything downstream (ER, gap size, the galleries, the checks) needs the
    same three objects; building them once per symbol keeps the whole pass to a
    single pass over the tape.
    """

    def __init__(self):
        self._c: dict[str, tuple] = {}

    def get(self, sym: str):
        if sym not in self._c:
            d = C.prep(C.load(sym))
            self._c[sym] = (d, E.fvg_arrays(d), C.session_frames(d))
        return self._c[sym]


# --------------------------------------------------------- derived metrics ---
def signed_er(close: np.ndarray, i0: int, i1: int, side: str) -> float:
    """Signed efficiency ratio of the post-confirmation path (DESIGN.md §1).

    `(close[i1] - close[i0])`, signed **into the reversal direction**, divided by
    the sum of absolute bar-to-bar close moves over the same span.

    +1 = a perfectly trending reversal, ~0 = chop, negative = a trend running
    *against* the sweep. The denominator is path length, so |ER| <= 1 always.
    NaN when the span is empty or perfectly flat (DD5).
    """
    if i1 <= i0:
        return np.nan
    seg = close[i0:i1 + 1]
    path = np.abs(np.diff(seg)).sum()
    if not np.isfinite(path) or path <= 0:
        return np.nan
    net = seg[0] - seg[-1] if side == "high" else seg[-1] - seg[0]
    return float(net / path)


def attach_derived(ev: pd.DataFrame, prices: Prices) -> pd.DataFrame:
    """Add the drill-down's own columns to an event stream (either stream).

    New columns
      hour              take-out bar's UTC hour (the sub-window bucket)
      stratum           window-length stratum of `bars_remaining` (DD8)
      er                signed efficiency ratio, confirmation close -> block end
      clean_trend       MFE >= 2 * MAE (the "clean trend" share's per-event flag)
      gap_atr           iFVG gap height / ATR at the gap's 3rd bar   (primary)
      gap_over_struct   iFVG gap height / the swept structure's own range (secondary)
      struct_range_atr  that structure's range, in ATR at the take-out bar
                        (reported so the secondary denominator is interpretable)

    All of it is causal: the gap height and its ATR are read at the formation
    bar, the structure range is frozen before the level became sweepable, and
    the ER span starts at the confirmation close.
    """
    ev = ev.copy()
    ev["hour"] = ev.ts.dt.hour
    ev["stratum"] = stratum(ev.bars_remaining)
    for c in ("er", "gap_atr", "gap_over_struct", "struct_range_atr", "gap_abs"):
        ev[c] = np.nan

    for sym, idx in ev.groupby("symbol").groups.items():
        d, fv, sess = prices.get(sym)
        close = d.close.to_numpy()
        atrv = d.atr.to_numpy()
        sub = ev.loc[idx]

        # ---- structure range (denominator #2), frozen before the sweep -----
        # session levels: the level_session's own high-low on its own day;
        # PDH/PDL: the prior day's range. Both are already carried on the event
        # for the PD stream; for the session stream they are recovered from the
        # session frame the level came from (end_idx is implied by level_age_h).
        # The PD stream carries its own denominator (the prior day's range);
        # session-stream rows do not, so it is recovered from the session frame
        # the level came from -- `level_age_h` pins that frame's last bar
        # exactly, since the engine wrote it as (bar - end_idx) * 5 / 60.
        if "struct_range" in sub.columns:
            rng = sub["struct_range"].to_numpy(float)
        else:
            rng = np.full(len(sub), np.nan)
        need = ~np.isfinite(rng)
        if need.any():
            key = {(r.session, int(r.end_idx)): r.high - r.low
                   for _, r in sess.iterrows()}
            end_idx = np.rint(sub.bar.to_numpy()
                              - sub.level_age_h.to_numpy() * 60 / C.BAR_MIN).astype(int)
            rng[need] = [key.get((ls, int(k)), np.nan) for ls, k in
                         zip(sub.level_session.to_numpy()[need], end_idx[need])]

        gap = np.full(len(sub), np.nan)
        gap_atr = np.full(len(sub), np.nan)
        er = np.full(len(sub), np.nan)
        form = sub.ifvg_form_bar.to_numpy()
        side_hi = (sub.direction.to_numpy() == "high_sweep")
        for k in range(len(sub)):
            f = form[k]
            if np.isfinite(f):
                f = int(f)
                lo_e = fv["bull_lo"][f] if side_hi[k] else fv["bear_lo"][f]
                hi_e = fv["bull_hi"][f] if side_hi[k] else fv["bear_hi"][f]
                if np.isfinite(lo_e) and np.isfinite(hi_e):
                    gap[k] = hi_e - lo_e
                    a = atrv[f]
                    if np.isfinite(a) and a > 0:
                        gap_atr[k] = gap[k] / a
        bar = sub.bar.to_numpy().astype(int)
        be = sub.block_end_bar.to_numpy().astype(int)
        dly = sub.ifvg_delay_bars.to_numpy()
        for k in range(len(sub)):
            if np.isfinite(dly[k]):
                i0 = bar[k] + int(dly[k])
                if i0 < be[k]:
                    er[k] = signed_er(close, i0, be[k], "high" if side_hi[k] else "low")

        ev.loc[idx, "gap_abs"] = gap
        ev.loc[idx, "gap_atr"] = gap_atr
        ev.loc[idx, "er"] = er
        ev.loc[idx, "struct_range_atr"] = rng / sub.atr.to_numpy()
        with np.errstate(invalid="ignore", divide="ignore"):
            ev.loc[idx, "gap_over_struct"] = gap / rng

    ev["clean_trend"] = ev.ifvg_mfe_atr >= 2 * ev.ifvg_mae_atr
    return ev


def outcome_block(g: pd.DataFrame) -> dict:
    """The pinned outcome column set (DESIGN.md §1) for one bucket of events.

    `n` counts the bucket's confirmed events (the population every outcome
    column below is computed on); `n_takeouts` is the bucket before the
    confirmation filter, so the confirmation rate is always visible next to the
    outcomes it conditions on.
    """
    c = g[g.ifvg_confirmed]
    er = c.er.dropna()
    return {
        "n_takeouts": len(g),
        "n": len(c),
        "ifvg_rate": 100 * g.ifvg_confirmed.mean() if len(g) else np.nan,
        "er_median": er.median() if len(er) else np.nan,
        "er_p25": er.quantile(.25) if len(er) else np.nan,
        "er_p75": er.quantile(.75) if len(er) else np.nan,
        "mfe_atr_median": c.ifvg_mfe_atr.median(),
        "mae_atr_median": c.ifvg_mae_atr.median(),
        "mfe_over_mae": (c.ifvg_mfe_atr.median() / c.ifvg_mae_atr.median()
                         if c.ifvg_mae_atr.median() else np.nan),
        "clean_trend_pct": 100 * c.clean_trend.mean() if len(c) else np.nan,
        "stop_atr_median": c.ifvg_stop_atr.median(),
        "R_median": c.ifvg_R.median(),
        "R_ge1_pct": 100 * (c.ifvg_R >= 1).mean() if len(c) else np.nan,
        "bars_left_median": g.bars_remaining.median(),
        "bars_left_p25": g.bars_remaining.quantile(.25),
        "bars_left_p75": g.bars_remaining.quantile(.75),
    }


def md(df: pd.DataFrame, floatfmt="{:.2f}") -> str:
    d = df.copy()
    for c in d.columns:
        if pd.api.types.is_float_dtype(d[c]):
            d[c] = d[c].map(lambda v: "" if pd.isna(v) else floatfmt.format(v))
    head = "| " + " | ".join(str(c) for c in d.columns) + " |"
    sep = "|" + "|".join(["---"] * len(d.columns)) + "|"
    rows = ["| " + " | ".join(str(v) for v in r) + " |" for r in d.values]
    return "\n".join([head, sep] + rows)


def save(df: pd.DataFrame, name: str) -> pd.DataFrame:
    df.to_csv(os.path.join(RESULTS, name), index=False)
    return df
