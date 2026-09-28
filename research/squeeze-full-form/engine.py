"""Arming rules, trigger scan, 1m exit resolution, accounting (DESIGN §4-§7).

`armed_mask(dec, side, variant)` returns the decision-instant mask for an arm,
an ablation rung or the shadow.  `simulate(S, side, armed, win, template)`
turns it into trades.  `placebo(...)` is DESIGN §7.3.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

from common import (P1_OI, P2_OI, P2_FLAT, ARM_WINDOW, STOP_ATR_BUF, TIME_STOP,
                    COST_RT, TARGETS, W15, NS_15M, NS_MIN, SEED, N_PLACEBO)

HALF_MIN = 30 * 10**9

# ------------------------------------------------------------ arming ---------
# variant: 'R0'..'R4' (ladder; R4 = the registered arm), 'SHADOW',
#          'R4_BINONLY' (Binance-only count >= 1), 'R4_P2FLAT0' (fit-only sens.)


def _persist3(x):
    """state held at T, T-4h and T-8h (three consecutive decision instants)."""
    x = np.asarray(x, bool)
    out = x.copy()
    out[1:] &= x[:-1]
    out[2:] &= x[:-2]
    out[:2] = False
    return out


def armed_mask(dec: pd.DataFrame, side: int, variant: str) -> np.ndarray:
    d = dec
    base = d["contig"].values & np.isfinite(d["atr"].values) & ~d["blackout"].values
    rung = {"R0": 0, "R1": 1, "R2": 2, "R3": 3, "R4": 4, "SHADOW": 4,
            "R4_BINONLY": 4, "R4_P2FLAT0": 4}[variant]
    if side == -1:                                   # P1 short
        if variant == "SHADOW":
            fund = d["sh_pos"].values
        elif rung == 0 or variant == "R4_BINONLY":
            fund = d["binance_hi"].values
        else:
            fund = d["ext_hi"].values >= 2
        oi = (d["oi_d24h"].values >= P1_OI) & d["at_7d_high"].values
        struct = d["fh"].values >= 2
        cvd = (d["cvd_spot"].values <= 0) & (d["cvd_perp"].values > 0)
    else:                                            # P2 long
        if variant == "SHADOW":
            fund = _persist3(d["sh_neg"].values)
        elif rung == 0 or variant == "R4_BINONLY":
            fund = _persist3(d["binance_lo"].values)
        else:
            fund = _persist3(d["ext_lo"].values >= 2)
        flat = 0.0 if variant == "R4_P2FLAT0" else P2_FLAT
        oi = (d["oi_d24h"].values >= P2_OI) & (d["ret24"].values >= flat)
        struct = (d["fl"].values >= 2) & d["compress"].values
        cvd = d["cvd_spot"].values >= 0
    m = base & fund
    if variant == "SHADOW":
        return m & struct & cvd                      # OI item replaced by shadow
    if rung >= 2:
        m &= oi
    if rung >= 3:
        m &= struct
    if rung >= 4:
        m &= cvd
    return m


def evaluable_mask(dec: pd.DataFrame, side: int) -> np.ndarray:
    """Decision instants at which every input of the full arm is defined."""
    d = dec
    return (d["contig"].values & np.isfinite(d["atr"].values)
            & ~d["blackout"].values
            & (d["binance_present"].values & d["bybit_present"].values)
            & np.isfinite(d["oi_d24h"].values) & np.isfinite(d["cvd_spot"].values)
            & d["sh_def"].values)


# ------------------------------------------------------------ trigger --------
class Trig:
    """Trigger evaluation at 15m bar k (DESIGN §5), memoised for P1."""

    def __init__(self, S):
        b = S["b15"]
        self.h, self.l, self.c = b["high"].values, b["low"].values, b["close"].values
        self.v = b["volume"].values
        self.atr = b["atr"].values
        self.pl = b["pl"].values
        self.cp = b["contig96_prior"].values
        self.Hp, self.Lp, self.vq = b["H_prior"].values, b["L_prior"].values, b["vq_prior"].values
        n = len(self.c)
        # most recent confirmed pivot-low index at or before i
        idx = np.where(self.pl, np.arange(n), -1)
        self.last_pl = np.maximum.accumulate(idx)
        self.memo = {}

    def p1(self, k):
        if k in self.memo:
            return self.memo[k]
        r = None
        if k >= W15 + 2 and self.cp[k] and np.isfinite(self.c[k]) and np.isfinite(self.atr[k]):
            w = self.h[k - W15:k]
            H = w.max()
            iH = k - W15 + (len(w) - 1 - int(np.argmax(w[::-1])))
            j = self.last_pl[iH - 1] if iH >= 1 else -1
            if j >= 0 and j >= iH - W15:
                L = self.l[j]
                between = self.c[iH + 1:k]
                if self.c[k] < L and (len(between) == 0 or np.nanmin(between) >= L):
                    stop = max(H, self.h[k]) + STOP_ATR_BUF * self.atr[k]
                    r = (self.c[k], stop, j, iH)
        self.memo[k] = r
        return r

    def p2(self, k):
        if not (self.cp[k] and np.isfinite(self.c[k]) and np.isfinite(self.atr[k])):
            return None
        if self.c[k] > self.Hp[k] and self.v[k] > self.vq[k]:
            stop = min(self.Lp[k], self.l[k]) - STOP_ATR_BUF * self.atr[k]
            # "rejection low" bar: last occurrence of the 24h low among k-96..k-1
            w = self.l[k - W15:k]
            iL = k - W15 + (len(w) - 1 - int(np.argmin(w[::-1])))
            return (self.c[k], stop, iL, None)
        return None


# ------------------------------------------------------------ exits ----------
def resolve_exit(S, side, entry, stop, target, t_entry, t_end):
    """1m path from the first minute labelled >= t_entry, to t_end (exclusive)."""
    m = S["m1"]
    a = np.searchsorted(m["ts"], t_entry)
    z = np.searchsorted(m["ts"], t_end)
    if z <= a:
        return None
    h, l, o = m["h"][a:z], m["l"][a:z], m["o"][a:z]
    if side == -1:
        sh = h >= stop
        th = (l <= target) if target is not None else np.zeros(z - a, bool)
    else:
        sh = l <= stop
        th = (h >= target) if target is not None else np.zeros(z - a, bool)
    si = int(np.argmax(sh)) if sh.any() else None
    ti = int(np.argmax(th)) if th.any() else None
    gap_flag = bool((np.diff(m["ts"][a:z]) > 60 * NS_MIN).any())
    if si is not None and (ti is None or si <= ti):
        px = stop
        if (side == -1 and o[si] > stop) or (side == 1 and o[si] < stop):
            px = o[si]
        return px, int(m["ts"][a + si]) + HALF_MIN, "stop", gap_flag
    if ti is not None:
        return target, int(m["ts"][a + ti]) + HALF_MIN, "target", gap_flag
    return m["c"][z - 1], int(t_end), "time", gap_flag


def funding_leg(S, side, t_entry, t_exit, stop_dist):
    f = S["fund"]
    a = np.searchsorted(f["ts"], t_entry, side="right")      # t_j > t_entry
    z = np.searchsorted(f["ts"], t_exit, side="left")        # t_j < t_exit
    if z <= a:
        return 0.0, 0
    tj, rj = f["ts"][a:z], f["rate"][a:z]
    m = S["m1"]
    mi = np.minimum(np.searchsorted(m["ts"], tj), len(m["ts"]) - 1)
    mark = m["o"][mi]
    ok = np.isfinite(rj) & np.isfinite(mark)
    return float(np.sum((-side) * rj[ok] * mark[ok]) / stop_dist), int(ok.sum())


def make_trade(S, side, entry, stop, t_entry, t_end, template, vwap_from=None,
               **extra):
    sd = abs(entry - stop)
    if not np.isfinite(sd) or sd <= 0:
        return None
    if template == "TVWAP":
        m = S["m1"]
        a = np.searchsorted(m["ts"], vwap_from)
        z = np.searchsorted(m["ts"], t_entry)
        cv = m["cum_v"][z] - m["cum_v"][a]
        if cv <= 0:
            return dict(skip="no_t1")
        tgt = (m["cum_pv"][z] - m["cum_pv"][a]) / cv
        if (side == -1 and tgt >= entry) or (side == 1 and tgt <= entry):
            return dict(skip="no_t1")
    else:
        tgt = entry + side * TARGETS[template] * sd
    ex = resolve_exit(S, side, entry, stop, tgt, t_entry, t_end)
    if ex is None:
        return None
    px, t_exit, cause, gapf = ex
    priceR = side * (px - entry) / sd
    fR, nset = funding_leg(S, side, t_entry, t_exit, sd)
    costR = COST_RT * entry / sd
    return dict(sym=S["sym"], side=side, t_entry=pd.Timestamp(t_entry, tz="UTC"),
                t_exit=pd.Timestamp(t_exit, tz="UTC"), entry=entry, stop=stop,
                target=tgt, stop_dist=sd, exit_px=px, cause=cause,
                priceR=priceR, fundingR=fR, costR=costR,
                netR=priceR + fR - costR, grossR=priceR + fR, n_sett=nset,
                hold_h=(t_exit - t_entry) / 3.6e12, gap_flag=gapf, **extra)


# ------------------------------------------------------------ simulate -------
def simulate(S, side, armed, win, template="T1R", trig=None):
    """win = (start, end) Timestamps: entries with t_entry in [start, end).
    Trades still open at `end` are closed there (DESIGN §2.4)."""
    dec, b_ns = S["dec"], S["b_ns"]
    trig = trig or Trig(S)
    T_ns = dec.index.values.astype("datetime64[ns]").astype(np.int64)
    s_ns, e_ns = pd.Timestamp(win[0]).value, pd.Timestamp(win[1]).value
    aT = T_ns[armed]
    ai = np.where(armed)[0]
    if len(aT) == 0:
        return []
    # for every 15m bar: latest armed instant <= its label, and in-window flag
    close_ns = b_ns + NS_15M
    la = np.searchsorted(aT, b_ns, side="right") - 1
    has = la >= 0
    laT = np.where(has, aT[np.maximum(la, 0)], np.iinfo(np.int64).min)
    inwin = has & (close_ns <= laT + ARM_WINDOW.value) & (close_ns > s_ns) & (close_ns < e_ns)
    cand = np.where(inwin)[0]
    trades, last_exit = [], np.iinfo(np.int64).min
    f = trig.p1 if side == -1 else trig.p2
    for k in cand:
        if laT[k] < last_exit or close_ns[k] <= last_exit:
            continue
        r = f(k)
        if r is None:
            continue
        entry, stop, jref, iext = r
        t_entry = int(close_ns[k])
        t_end = min(t_entry + TIME_STOP.value, e_ns)
        vf = int(b_ns[jref]) if jref is not None else None
        i_dec = ai[la[k]]
        tr = make_trade(S, side, entry, stop, t_entry, t_end, template,
                        vwap_from=vf, t_signal=pd.Timestamp(laT[k], tz="UTC"),
                        atr=trig.atr[k], k=int(k),
                        n_venues=int(dec["n_venues"].values[i_dec]))
        if tr is None:
            continue
        if "skip" in tr:
            # T-VWAP only: no valid T1 -> not traded in that template
            continue
        tr["atr_units"] = tr["stop_dist"] / tr["atr"]
        trades.append(tr)
        last_exit = int(tr["t_exit"].value)
    return trades


# ------------------------------------------------------------ placebo --------
def placebo_pool(S, win):
    """Candidate 15m bars for placebo entries: contiguous, finite ATR, entry in win."""
    b = S["b15"]
    close_ns = S["b_ns"] + NS_15M
    ok = (b["contig96_prior"].values & np.isfinite(b["close"].values)
          & np.isfinite(b["atr"].values)
          & (close_ns > pd.Timestamp(win[0]).value) & (close_ns < pd.Timestamp(win[1]).value))
    idx = np.where(ok)[0]
    days = (close_ns[idx] // (86400 * 10**9))
    return idx, days


def placebo_trade(S, side, k, atr_units, win_end_ns):
    b = S["b15"]
    entry = b["close"].values[k]
    sd = atr_units * b["atr"].values[k]
    stop = entry - side * sd
    t_entry = int(S["b_ns"][k] + NS_15M)
    t_end = min(t_entry + TIME_STOP.value, win_end_ns)
    return make_trade(S, side, entry, stop, t_entry, t_end, "T1R")


def placebo(Ss, trades: pd.DataFrame, win_by_sym, draws=N_PLACEBO, seed=SEED):
    """DESIGN §7.3. Returns array of `draws` placebo mean netR."""
    rng = np.random.default_rng(seed)
    pools = {s: placebo_pool(Ss[s], win_by_sym[s]) for s in trades["sym"].unique()}
    means = np.empty(draws)
    rows = list(trades[["sym", "side", "atr_units", "t_entry"]].itertuples(index=False))
    for dr in range(draws):
        vals = []
        for sym, side, au, te in rows:
            idx, days = pools[sym]
            rday = pd.Timestamp(te).value // (86400 * 10**9)
            for _ in range(20):
                k = idx[rng.integers(len(idx))]
                if (S_day := (Ss[sym]["b_ns"][k] + NS_15M) // (86400 * 10**9)) != rday:
                    break
            tr = placebo_trade(Ss[sym], side, k, au,
                               pd.Timestamp(win_by_sym[sym][1]).value)
            if tr is not None:
                vals.append(tr["netR"])
        means[dr] = np.mean(vals) if vals else np.nan
    return means
