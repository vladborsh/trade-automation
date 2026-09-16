"""Stage 1 sibling of the parity-proven `engine.py` — DESIGN.md §8 step 2.

`engine.py` is **not edited**: Stage 0's bit-exact parity against the bot's
TypeScript (200,322 + 4,591,936 evaluated bars, 0 discrepancies) stands
untouched. Everything Stage 1 needs that the Stage-0 engine does not have
lives here:

  * `run_ablate(..., drop=...)` — the bot's bar loop with one component gate
    removed, for DESIGN §5's fit-period-only component ablation. With
    `drop=None` it is a line-for-line copy of `engine.run`'s loop and the
    self-test in `stage1.py` proves it returns an identical order table.
  * `walk()` — the trade walker: the two trade templates (bot-native /
    project-standard) x the two fill conventions (bot-native close-only with
    clamping / realistic intrabar touch), DESIGN §4.1-§4.2. Used for numbers
    2-4, for Null A's placebo trades and for Null B's shifted trades.

No threshold, window, split or cost constant lives here.
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np
import pandas as pd
from numba import njit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BUY, DAY_MS, MAX_IFVG_TO_ATR_RATIO, MAX_VWAP_ATR_RATIO,  # noqa: E402
                    MIN_MS, MIN_VWAP_ATR_RATIO, SELL, WINDOW_MS)
from engine import GATES, NCOMP, Order, _C, _truthy, alive_minutes, components, stop_target  # noqa: E402

DROPS = (None, "bias", "ifvg", "pd", "sweep")


def run_ablate(P: dict, lo_ms: int, hi_ms: int, daily_caps: bool = True,
               live_like: bool = False, timing=None, drop=None):
    """`engine.run`'s loop with one component gate dropped (DESIGN §5).

    drop=None    the bot, unchanged (self-tested against `engine.run`)
    drop='bias'  no VWAP-band bias and no band-width/ATR regime gate; the side
                 comes from which iFVG inverted on the bar
    drop='ifvg'  no iFVG trigger and no iFVG/ATR size gate; the side comes from
                 the VWAP-band bias
    drop='pd'    no premium/discount gate
    drop='sweep' no prior-hour high/low sweep requirement
    """
    if drop not in DROPS:
        raise ValueError(drop)
    t, o, h, l, c, v = P["t"], P["o"], P["h"], P["l"], P["c"], P["v"]
    Ts, is_entry = alive_minutes(P["symbol"], lo_ms, hi_ms, timing)
    G = np.searchsorted(t, Ts - (MIN_MS if live_like else 0), "right") - 1
    S = np.searchsorted(t, Ts - WINDOW_MS, "left")
    B0 = np.searchsorted(t, (Ts // DAY_MS) * DAY_MS + MIN_MS, "left")

    orders: list[Order] = []
    open_: list[Order] = []
    day_losses: dict = {}
    day_wins: dict = {}
    last_g = None
    n_blocked_same_dir = 0

    def do_close(od, ts, price, why):
        od.close(ts, price, why)
        dk = ts // DAY_MS
        if od.profitable:
            day_wins[dk] = day_wins.get(dk, 0) + 1
        else:
            day_losses[dk] = day_losses.get(dk, 0) + 1

    for i in range(len(Ts)):
        T = int(Ts[i]); ent = int(is_entry[i])
        if ent == -1:
            if last_g is not None:
                for od in open_:
                    do_close(od, int(t[last_g]), float(c[last_g]), "STRATEGY")
                open_ = []
            continue
        g = int(G[i]); s = int(S[i])
        if g - s + 1 <= 0:
            last_g = None
            continue
        last_g = g
        cg = float(c[g]); tg = int(t[g])
        if open_:
            still = []
            for od in open_:
                if od.dir == BUY:
                    if cg < od.stop: do_close(od, tg, cg, "STOP_LOSS")
                    elif cg > od.target: do_close(od, tg, cg, "TAKE_PROFIT")
                    else: still.append(od)
                else:
                    if cg > od.stop: do_close(od, tg, cg, "STOP_LOSS")
                    elif cg < od.target: do_close(od, tg, cg, "TAKE_PROFIT")
                    else: still.append(od)
            open_ = still
            for od in open_:
                prof = (cg - od.entry) if od.dir == BUY else (od.entry - cg)
                r = prof / od.init if od.init != 0 else (math.copysign(math.inf, prof) if prof != 0 else math.nan)
                moved = False
                if r > 1 and r < 2:
                    moved = od.trail(0) or moved
                if r > 2:
                    moved = od.trail(1) or moved
                if moved:
                    od.n_trail += 1
            ob = [od for od in open_ if od.dir == BUY]
            osl = [od for od in open_ if od.dir == SELL]
            if ob and osl:
                lst = ob + osl
                acc = lst[0]
                for cur in lst[1:]:
                    acc = acc if acc.entry_ts < cur.entry_ts else cur
                do_close(acc, tg, cg, "STRATEGY")
                open_ = [od for od in open_ if od is not acc]
        if ent != 1:
            continue
        comp = components(t, o, h, l, c, v, s, g, int(B0[i]))
        n = g - s + 1
        bias = None
        if comp[_C["err"]] == 0:
            last_open = o[g]
            if last_open > comp[_C["vwap_top"]]:
                bias = SELL
            elif last_open < comp[_C["vwap_bottom"]]:
                bias = BUY
        # --- the gates, with `drop` applied ------------------------------
        have_dir = (bias is not None) if drop != "bias" else \
            (comp[_C["err"]] == 0 and (comp[_C["bull_occ"]] == 1.0 or comp[_C["bear_occ"]] == 1.0))
        if not have_dir:
            continue
        atr = comp[_C["atr"]]
        ratio = (comp[_C["vwap_top"]] - comp[_C["vwap_bottom"]]) / atr if atr != 0 else \
            (math.nan if comp[_C["vwap_top"]] == comp[_C["vwap_bottom"]] else math.inf)
        if comp[_C["has_ifvg"]] == 1.0:
            sz = abs(comp[_C["ifvg_low"]] - comp[_C["ifvg_high"]])
            q = atr / sz if sz != 0 else (math.inf if atr != 0 else math.nan)
            ifvg_ok = q < MAX_IFVG_TO_ATR_RATIO
        else:
            ifvg_ok = False
        if comp[_C["prev_found"]] == 1.0:
            if n < 6:
                continue                       # processStep rejects (D-xx), no signal
            above = comp[_C["hi6"]] > comp[_C["prev_high"]]
            below = comp[_C["lo6"]] < comp[_C["prev_low"]]
        else:
            above = below = False
        ratio_ok = (ratio >= MIN_VWAP_ATR_RATIO) and (ratio <= MAX_VWAP_ATR_RATIO)
        if daily_caps:
            dk = tg // DAY_MS
            caps_ok = day_losses.get(dk, 0) < 2 and day_wins.get(dk, 0) < 1
        else:
            caps_ok = True
        in_disc = comp[_C["in_disc"]] == 1.0
        if drop == "bias":
            g_ratio = True; g_bias_s = True; g_bias_b = True
        else:
            g_ratio = ratio_ok; g_bias_s = (bias == SELL); g_bias_b = (bias == BUY)
        if drop == "ifvg":
            g_occ_s = True; g_occ_b = True; g_ifvg = True
        else:
            g_occ_s = comp[_C["bear_occ"]] == 1.0; g_occ_b = comp[_C["bull_occ"]] == 1.0
            g_ifvg = ifvg_ok
        g_pd_s = True if drop == "pd" else (not in_disc)
        g_pd_b = True if drop == "pd" else in_disc
        g_sw_s = True if drop == "sweep" else above
        g_sw_b = True if drop == "sweep" else below
        sell = g_occ_s and g_ratio and g_pd_s and g_bias_s and g_ifvg and g_sw_s and caps_ok
        buy = (not sell) and (g_occ_b and g_ratio and g_pd_b and g_bias_b and g_ifvg and g_sw_b and caps_ok)
        if not (sell or buy):
            continue
        d = SELL if sell else BUY
        stop, target = stop_target(cg, comp[_C["range_bottom"]], comp[_C["range_top"]], d)
        if any(od.dir == d for od in open_):
            n_blocked_same_dir += 1
            continue
        if _truthy(stop) and _truthy(target):
            entry_ts = tg + (tg - int(t[g - 1]))
            od = Order(d, cg, entry_ts, stop, target, T)
            orders.append(od); open_.append(od)

    trades = pd.DataFrame([dict(signal_ts=od.signal_ts, entry_ts=od.entry_ts, dir=od.dir,
                                entry=od.entry, stop0=od.stop0, target=od.target,
                                exit_ts=od.close_ts, exit_price=od.close_price, stop=od.stop,
                                n_trail=od.n_trail, why=od.why, closed=od.closed)
                           for od in orders],
                          columns=["signal_ts", "entry_ts", "dir", "entry", "stop0", "target",
                                   "exit_ts", "exit_price", "stop", "n_trail", "why", "closed"])
    trades.attrs["blocked_same_dir"] = n_blocked_same_dir
    return trades


# ==========================================================================
# The trade walker — DESIGN §4.1 (templates) x §4.2 (fill conventions)
# ==========================================================================
# exit causes, as integers
X_TARGET, X_STOP, X_TRAILSTOP, X_TIME, X_NONE = 0, 1, 2, 3, 4


@njit(cache=True, error_model="numpy")
def walk(o, h, l, c, b0, b1, side, entry, stop0, target, trail, realistic):
    """One trade, bar by bar over tape indices [b0, b1].

    side      +1 BUY, -1 SELL
    trail     1 = bot-native BE-at-1R / +1R-at-2R trail on M1 closes; 0 = none
    realistic 1 = intrabar touch (stop wins a both-touch bar; target fills at
                  the level; a stop the bar GAPPED through fills at that bar's
                  OPEN); 0 = bot-native close-only detection with the fill
                  clamped to the exact stop/target (D-10/D-11)

    Returns (exit_index, exit_price, cause). `cause` distinguishes a stop at
    its original level (X_STOP) from one that had been trailed (X_TRAILSTOP).
    Forced flat at b1's close is X_TIME.
    """
    init = abs(entry - stop0)
    stop = stop0
    moved = False
    for k in range(b0, b1 + 1):
        if realistic == 1:
            if side > 0:
                gap = o[k] <= stop
                hit_s = l[k] <= stop
                hit_t = h[k] >= target
            else:
                gap = o[k] >= stop
                hit_s = h[k] >= stop
                hit_t = l[k] <= target
            if hit_s:                       # stop wins a bar that touches both
                px = o[k] if gap else stop
                return k, px, (X_TRAILSTOP if moved else X_STOP)
            if hit_t:
                return k, target, X_TARGET
        else:
            cl = c[k]
            if side > 0:
                if cl < stop:
                    return k, stop, (X_TRAILSTOP if moved else X_STOP)
                if cl > target:
                    return k, target, X_TARGET
            else:
                if cl > stop:
                    return k, stop, (X_TRAILSTOP if moved else X_STOP)
                if cl < target:
                    return k, target, X_TARGET
        if trail == 1 and init != 0.0:
            r = (c[k] - entry) / init if side > 0 else (entry - c[k]) / init
            if r > 1.0 and r < 2.0:
                ns = entry
                if (side > 0 and ns > stop) or (side < 0 and ns < stop):
                    stop = ns; moved = True
            if r > 2.0:
                ns = entry + init if side > 0 else entry - init
                if (side > 0 and ns > stop) or (side < 0 and ns < stop):
                    stop = ns; moved = True
    return b1, c[b1], X_TIME


@njit(cache=True, error_model="numpy")
def walk_many(o, h, l, c, b0, b1, side, entry, stop0, target, trail, realistic):
    n = len(b0)
    xi = np.empty(n, np.int64)
    xp = np.empty(n, np.float64)
    xc = np.empty(n, np.int8)
    for i in range(n):
        a, b, d = walk(o, h, l, c, b0[i], b1[i], side[i], entry[i], stop0[i], target[i],
                       trail, realistic)
        xi[i] = a; xp[i] = b; xc[i] = d
    return xi, xp, xc


@njit(cache=True, error_model="numpy")
def touch_flags(o, h, l, c, b0, b1, side, entry, stop0, target, trail):
    """Per-trade diagnostics for DESIGN §8's agreement stop rule, on the
    bot-native trade template: did any live bar touch BOTH levels, and did the
    realistic exit bar gap through the stop?"""
    n = len(b0)
    both = np.zeros(n, np.int8)
    gapped = np.zeros(n, np.int8)
    for i in range(n):
        init = abs(entry[i] - stop0[i])
        stop = stop0[i]
        s = side[i]
        for k in range(b0[i], b1[i] + 1):
            if s > 0:
                hs = l[k] <= stop
                ht = h[k] >= target[i]
                gp = o[k] <= stop
            else:
                hs = h[k] >= stop
                ht = l[k] <= target[i]
                gp = o[k] >= stop
            if hs and ht:
                both[i] = 1
            if hs:
                if gp:
                    gapped[i] = 1
                break
            if ht:
                break
            if trail == 1 and init != 0.0:
                r = (c[k] - entry[i]) / init if s > 0 else (entry[i] - c[k]) / init
                if r > 1.0 and r < 2.0:
                    ns = entry[i]
                    if (s > 0 and ns > stop) or (s < 0 and ns < stop):
                        stop = ns
                if r > 2.0:
                    ns = entry[i] + init if s > 0 else entry[i] - init
                    if (s > 0 and ns > stop) or (s < 0 and ns < stop):
                        stop = ns
    return both, gapped


def rolling_atr20(h, l, c, n=20):
    """ATR(20) as the bot computes it (`atr.indicator.ts`): the arithmetic mean
    of the last 20 true ranges ending at the current bar. Computed globally
    here for the placebo pool; `stage1.py` asserts it equals the engine's
    per-bar value on every evaluated bar."""
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    out = np.full(len(h), np.nan)
    cs = np.concatenate(([0.0], np.cumsum(tr)))
    idx = np.arange(n, len(tr) + 1)
    out[idx] = (cs[idx] - cs[idx - n]) / n
    return out
