"""The A and B trade engines and the §4 funding accounting (DESIGN §2, §3, §4).

One engine, four callers: A / B, each on the real funding state or on its
price shadow.  The ONLY thing that differs between real and shadow is which
boolean columns of the settlement frame define the state and which column the
lapse exit reads.  The template, the stop, the exits, the cooldown, the
de-overlap and — critically — the funding accounting are byte-identical
(DESIGN §6.3).

Every trade carries its full settlement ledger so MECHANIC-PROOF.md can print
it and checks.py can assert on it.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

from common import (A_STOP_DATR, B_STOP_ATR_BUF, B_LOOKBACK, B_TIME_BARS,
                    B_TARGET_R, B_DEOVERLAP, COST_RT, LAPSE, PERSIST,
                    COOLDOWN_SETTLEMENTS, MAX_SETTLEMENTS)

HOUR = pd.Timedelta(hours=1)
MIN1 = pd.Timedelta(minutes=1)


# --------------------------------------------------------------------------
# funding accounting (DESIGN §4) — shared by every engine, real and shadow
# --------------------------------------------------------------------------
def collect(sett, side, t_entry, t_exit, stop_dist):
    """SUM over { j : t_entry < t_j < t_exit } of (-side)*f_j*mark_j/stop_dist.

    Returns (fundingR, ledger, n_slots, n_missing).  A missing slot credits
    ZERO and is listed in the ledger with f = NaN (DESIGN §5.3 rule 5(iii)).
    """
    sl = sett.loc[(sett.index > t_entry) & (sett.index < t_exit)]
    led, tot, nmiss = [], 0.0, 0
    for tj, r in sl.iterrows():
        if not r["present"] or not np.isfinite(r["f"]) or not np.isfinite(r["mark"]):
            nmiss += 1
            led.append(dict(t_j=tj, f_j=np.nan, mark=np.nan, R=0.0,
                            status="MISSING -> zero"))
            continue
        contrib = (-side) * r["f"] * r["mark"] / stop_dist
        tot += contrib
        led.append(dict(t_j=tj, f_j=float(r["f"]), mark=float(r["mark"]),
                        R=float(contrib), status="collected"))
    return tot, led, len(sl), nmiss


def _finish(side, entry, stop_px, exit_px, t_entry, t_exit, sett, **extra):
    stop_dist = abs(entry - stop_px)
    fR, led, nsl, nmiss = collect(sett, side, t_entry, t_exit, stop_dist)
    priceR = side * (exit_px - entry) / stop_dist
    costR = COST_RT * entry / stop_dist
    t = dict(side=side, entry=entry, stop=stop_px, exit_px=exit_px,
             stop_dist=stop_dist, t_entry=t_entry, t_exit=t_exit,
             priceR=priceR, fundingR=fR, costR=costR,
             netR=priceR + fR - costR, grossR=priceR + fR,
             n_settlements=nsl, n_missing_slots=nmiss,
             zero_settlements=(nsl == 0),
             hold_h=(t_exit - t_entry) / HOUR, ledger=led)
    t.update(extra)
    return t


def _spans_blackout(sett, t_entry, t_exit):
    """ARCHITECT-RULING §1: any A/B trade whose (t_entry, t_exit) span
    intersects the interval-anomaly blackout is excluded and counted."""
    if "blackout" not in sett.columns:
        return False
    return bool(sett.loc[(sett.index > t_entry) & (sett.index < t_exit),
                         "blackout"].any())


def _bars_absent(bars, t0, t1):
    """True if any 1h bar in [t0, t1] is absent from the tape (DESIGN §5.2)."""
    seg = bars.loc[t0:t1]
    return bool((~seg["present"]).any())


# --------------------------------------------------------------------------
# Hypothesis A (DESIGN §2)
# --------------------------------------------------------------------------
def run_A(bars, sett, symbol, win_start, win_end, state=("ext_pos", "ext_neg"),
          lapse_mode="funding", stop_datr=A_STOP_DATR, persist=PERSIST,
          cost_rt=None):
    """win_start/win_end select ENTRY bars by date; an open trade is marked to
    market at the last bar close before win_end (DESIGN §5.4)."""
    pos_col, neg_col = state
    idx = sett.index
    ok = sett["warm"].values & (~sett["blackout"].values)
    pos = sett[pos_col].values & ok
    neg = sett[neg_col].values & ok
    present = sett["present"].values
    trades = []
    i = 1
    cooldown_until = pd.Timestamp("1970-01-01", tz="UTC")
    while i < len(idx):
        t_k = idx[i]
        if t_k < win_start or t_k >= win_end or t_k < cooldown_until:
            i += 1
            continue
        # persistence over `persist` CONSECUTIVE present slots
        lo = i - persist + 1
        if lo < 0:
            i += 1
            continue
        sl = slice(lo, i + 1)
        long_sig = bool(neg[sl].all() and present[sl].all())
        short_sig = bool(pos[sl].all() and present[sl].all())
        if not (long_sig or short_sig):
            i += 1
            continue
        side = -1 if short_sig else 1
        # entry at the close of the bar OPENING at t_k
        if t_k not in bars.index or not bars.at[t_k, "present"]:
            i += 1
            continue
        entry = bars.at[t_k, "close"]
        datr = bars.at[t_k, "datr"]
        if not np.isfinite(entry) or not np.isfinite(datr) or datr <= 0:
            i += 1
            continue
        t_entry = t_k + HOUR
        sd = stop_datr * datr
        stop_px = entry + sd if side == -1 else entry - sd

        # walk forward
        fwd = bars.loc[t_entry:]
        exit_px, t_exit, cause = None, None, None
        slot_count = 0
        for tb, b in fwd.iterrows():
            if tb >= win_end:
                prev = bars.loc[:tb].iloc[-2]
                exit_px, t_exit, cause = prev["close"], tb, "window"
                break
            if not b["present"]:
                exit_px, t_exit, cause = np.nan, tb, "bar_gap"
                break
            # 1) stop, checked on this bar's adverse extreme
            if side == -1:
                if b["open"] >= stop_px:
                    exit_px, t_exit, cause = b["open"], tb + MIN1, "stop_gap"
                elif b["high"] >= stop_px:
                    exit_px, t_exit, cause = stop_px, tb + MIN1, "stop"
            else:
                if b["open"] <= stop_px:
                    exit_px, t_exit, cause = b["open"], tb + MIN1, "stop_gap"
                elif b["low"] <= stop_px:
                    exit_px, t_exit, cause = stop_px, tb + MIN1, "stop"
            if exit_px is not None:
                break
            # 2) settlement-driven exits at this bar's OPEN -> exit at its CLOSE
            if tb in sett.index and tb > t_entry:
                slot_count += 1
                r = sett.loc[tb]
                if slot_count >= MAX_SETTLEMENTS:
                    exit_px, t_exit, cause = b["close"], tb + HOUR, "time"
                    break
                if r["present"]:
                    if lapse_mode == "funding":
                        lap = (r["f"] <= LAPSE) if side == -1 else (r["f"] >= -LAPSE)
                    else:   # shadow lapse (DESIGN §6.3)
                        lap = (r["spct"] <= 0.50) if side == -1 else (r["spct"] >= 0.50)
                    if bool(lap):
                        exit_px, t_exit, cause = b["close"], tb + HOUR, "lapse"
                        break
        if exit_px is None:                      # ran off the tape
            i += 1
            continue
        if cause == "bar_gap":
            trades.append(dict(symbol=symbol, excluded="bar_gap",
                               t_entry=t_entry, side=side))
            i += 1
            continue
        t = _finish(side, entry, stop_px, exit_px, t_entry, t_exit, sett,
                    symbol=symbol, cause=cause, arm="A",
                    f_at_k=float(sett.at[t_k, "f"]) if np.isfinite(sett.at[t_k, "f"]) else np.nan,
                    fpct_at_k=float(sett.at[t_k, "fpct"]),
                    spct_at_k=float(sett.at[t_k, "spct"]),
                    datr=float(datr), t_signal=t_k)
        if cost_rt is not None:
            t["costR"] = cost_rt * entry / t["stop_dist"]
            t["netR"] = t["priceR"] + t["fundingR"] - t["costR"]
        if t["n_missing_slots"] > 1:            # DESIGN §5.3 rule 5(iii)
            t["excluded"] = "missing_slots"
        elif _spans_blackout(sett, t_entry, t_exit):
            t["excluded"] = "blackout_span"
        trades.append(t)
        # advance past the exit; cooldown only after a stop
        j = int(np.searchsorted(idx, t_exit, side="right"))
        if cause in ("stop", "stop_gap"):
            cooldown_until = t_exit + pd.Timedelta(hours=8 * COOLDOWN_SETTLEMENTS)
        i = max(j, i + 1)
    return trades


# --------------------------------------------------------------------------
# Hypothesis B (DESIGN §3)
# --------------------------------------------------------------------------
def run_B(bars, sett, symbol, win_start, win_end, state=("ext_pos", "ext_neg"),
          target_R=B_TARGET_R, cost_rt=None):
    pos_col, neg_col = state
    ok = sett["warm"].values & (~sett["blackout"].values) & sett["present"].values
    st_pos = pd.Series(sett[pos_col].values & ok, index=sett.index)
    st_neg = pd.Series(sett[neg_col].values & ok, index=sett.index)
    # state of the LAST settlement with t_k <= T, as of each bar T
    lp = st_pos.reindex(bars.index, method="ffill").fillna(False).values
    ln = st_neg.reindex(bars.index, method="ffill").fillna(False).values

    b = bars
    trades = []
    last_event = {-1: None, 1: None}
    open_until = pd.Timestamp("1970-01-01", tz="UTC")
    vals = b[["open", "high", "low", "close", "atr14", "ret24_bar",
              "low12_prior", "high12_prior", "high12_incl", "low12_incl",
              "present", "contig25"]].values
    cols = {c: i for i, c in enumerate(["open", "high", "low", "close", "atr14",
                                        "ret24_bar", "low12_prior", "high12_prior",
                                        "high12_incl", "low12_incl", "present",
                                        "contig25"])}
    idxb = b.index
    for n in range(len(idxb)):
        T = idxb[n]
        if T < win_start or T >= win_end or T < open_until:
            continue
        v = vals[n]
        if not v[cols["present"]] or not v[cols["contig25"]]:
            continue
        atr = v[cols["atr14"]]
        r24 = v[cols["ret24_bar"]]
        c = v[cols["close"]]
        if not (np.isfinite(atr) and np.isfinite(r24) and atr > 0):
            continue
        side = 0
        if lp[n] and r24 > 0 and np.isfinite(v[cols["low12_prior"]]) \
                and c < v[cols["low12_prior"]]:
            side = -1
        elif ln[n] and r24 < 0 and np.isfinite(v[cols["high12_prior"]]) \
                and c > v[cols["high12_prior"]]:
            side = 1
        if side == 0:
            continue
        le = last_event[side]
        if le is not None and (T - le) < pd.Timedelta(hours=B_DEOVERLAP):
            continue
        last_event[side] = T
        entry = c
        stop_px = (v[cols["high12_incl"]] + B_STOP_ATR_BUF * atr) if side == -1 \
            else (v[cols["low12_incl"]] - B_STOP_ATR_BUF * atr)
        sd = abs(entry - stop_px)
        if not np.isfinite(sd) or sd <= 0:
            continue
        tgt = entry - target_R * sd if side == -1 else entry + target_R * sd
        t_entry = T + HOUR
        exit_px, t_exit, cause = None, None, None
        for m in range(n + 1, min(n + 1 + B_TIME_BARS, len(idxb))):
            tb = idxb[m]
            if tb >= win_end:
                exit_px, t_exit, cause = vals[m - 1][cols["close"]], tb, "window"
                break
            w = vals[m]
            if not w[cols["present"]]:
                exit_px, t_exit, cause = np.nan, tb, "bar_gap"
                break
            o, h, l, cl = w[cols["open"]], w[cols["high"]], w[cols["low"]], w[cols["close"]]
            if side == -1:
                if o >= stop_px:
                    exit_px, t_exit, cause = o, tb + MIN1, "stop_gap"
                elif h >= stop_px:                       # stop first (loss)
                    exit_px, t_exit, cause = stop_px, tb + MIN1, "stop"
                elif l <= tgt:
                    exit_px, t_exit, cause = tgt, tb + MIN1, "target"
            else:
                if o <= stop_px:
                    exit_px, t_exit, cause = o, tb + MIN1, "stop_gap"
                elif l <= stop_px:
                    exit_px, t_exit, cause = stop_px, tb + MIN1, "stop"
                elif h >= tgt:
                    exit_px, t_exit, cause = tgt, tb + MIN1, "target"
            if exit_px is not None:
                break
            if m == n + B_TIME_BARS:
                exit_px, t_exit, cause = cl, tb + HOUR, "time"
                break
        if exit_px is None:
            continue
        open_until = t_exit
        if cause == "bar_gap":
            trades.append(dict(symbol=symbol, excluded="bar_gap",
                               t_entry=t_entry, side=side))
            continue
        t = _finish(side, entry, stop_px, exit_px, t_entry, t_exit, sett,
                    symbol=symbol, cause=cause, arm="B", t_signal=T,
                    atr14=float(atr), ret24=float(r24),
                    target=float(tgt))
        if cost_rt is not None:
            t["costR"] = cost_rt * entry / t["stop_dist"]
            t["netR"] = t["priceR"] + t["fundingR"] - t["costR"]
        if t["n_missing_slots"] > 1:
            t["excluded"] = "missing_slots"
        elif _spans_blackout(sett, t_entry, t_exit):
            t["excluded"] = "blackout_span"
        trades.append(t)
    return trades


def to_frame(trades):
    if not trades:
        return pd.DataFrame(columns=["symbol", "netR", "excluded"])
    df = pd.DataFrame([{k: v for k, v in t.items() if k != "ledger"}
                       for t in trades])
    if "excluded" not in df.columns:
        df["excluded"] = np.nan
    return df


def kept(df):
    return df[df["excluded"].isna()].copy() if len(df) else df
