"""§6.7 harness validation and §6.5 momentum_breakout overlap (DESIGN §6.5, §6.7).

`momentum_breakout` is re-implemented here from `intraday-mr-smc-v2`'s source
(v2 defaults: brk_z = 2.0 on the 50-bar rolling mean/sd of close, ATR(14) as an
ewm with alpha = 1/14, stop = 1.5 ATR beyond the signal bar's extreme, target =
1.5 R, 24-bar time stop) so that this package's 1h frames can be checked
against a number computed elsewhere.  The 1h tape here is a FRESH monthly-
archive pull, not v2's 5m resample, so agreement is expected to be close but
not byte-exact; the REPORT says which.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

BRK_Z, MR_LEN, ATR_LEN, STOP_ATR, MOM_RR, TIME_STOP = 2.0, 50, 14, 1.5, 1.5, 24


def _atr_ewm(d, n=ATR_LEN):
    pc = d["close"].shift(1)
    tr = pd.concat([d["high"] - d["low"], (d["high"] - pc).abs(),
                    (d["low"] - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def mb_signals(bars):
    d = bars.copy()
    d["atr"] = _atr_ewm(d)
    m = d["close"].rolling(MR_LEN).mean()
    sd = d["close"].rolling(MR_LEN).std().replace(0, np.nan)
    z = (d["close"] - m) / sd
    zp = z.shift(1)
    long_ = (zp < BRK_Z) & (z >= BRK_Z)
    short = (zp > -BRK_Z) & (z <= -BRK_Z)
    d["sig"] = np.where(long_, 1, np.where(short, -1, 0))
    d["stop"] = np.where(d["sig"] == 1, d["low"] - STOP_ATR * d["atr"],
                         np.where(d["sig"] == -1,
                                  d["high"] + STOP_ATR * d["atr"], np.nan))
    return d


def run_mb(bars, sett, symbol, w0, w1, with_funding: bool):
    """Gross (no costs) so that the PF is comparable to v2's gross PF."""
    d = mb_signals(bars)
    idx = d.index
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    pres = d["present"].values
    sig, stp = d["sig"].values, d["stop"].values
    out = []
    n = len(idx)
    busy_until = -1
    sbar = np.array([bars.index.get_loc(t) if t in bars.index else -1
                     for t in sett.index])
    f = sett["f"].values
    mark = sett["mark"].values
    for i in range(n):
        if sig[i] == 0 or i <= busy_until or not pres[i]:
            continue
        s, entry, stop = int(sig[i]), c[i], stp[i]
        if not np.isfinite(entry) or not np.isfinite(stop):
            continue
        risk = abs(entry - stop)
        if risk <= 0:
            continue
        tgt = entry + s * MOM_RR * risk
        exit_px, j, cause = None, None, None
        for m in range(i + 1, min(i + 1 + TIME_STOP, n)):
            if not pres[m]:
                break
            if s == 1:
                if o[m] <= stop or l[m] <= stop:
                    exit_px, j, cause = (o[m] if o[m] <= stop else stop), m, "stop"
                elif h[m] >= tgt:
                    exit_px, j, cause = tgt, m, "target"
            else:
                if o[m] >= stop or h[m] >= stop:
                    exit_px, j, cause = (o[m] if o[m] >= stop else stop), m, "stop"
                elif l[m] <= tgt:
                    exit_px, j, cause = tgt, m, "target"
            if exit_px is not None:
                break
            if m == i + TIME_STOP:
                exit_px, j, cause = c[m], m, "time"
        if exit_px is None:
            continue
        busy_until = j
        if not (w0 <= idx[i] < w1):
            continue
        priceR = s * (exit_px - entry) / risk
        fR = 0.0
        if with_funding:
            lo = np.searchsorted(sbar, i + 1, side="right")
            hi = np.searchsorted(sbar, j, side="right")
            if hi > lo:
                ff, mm = f[lo:hi], mark[lo:hi]
                ok = np.isfinite(ff) & np.isfinite(mm)
                fR = float((-s) * np.nansum(ff[ok] * mm[ok]) / risk)
        out.append(dict(symbol=symbol, t=idx[i], side=s, priceR=priceR,
                        fundingR=fR, R=priceR + fR, cause=cause,
                        pnl=(priceR + fR) * risk))
    return out


def pf(rows, key="R"):
    v = np.array([r[key] for r in rows], float)
    win, loss = v[v > 0].sum(), -v[v < 0].sum()
    return float(win / loss) if loss > 0 else np.inf


def mb_event_mask(bars, lookback=12):
    """§6.5 — did a momentum_breakout trigger fire within the prior `lookback`
    bars, and on which side?"""
    d = mb_signals(bars)
    s = pd.Series(d["sig"].values, index=d.index)
    up = (s == 1).rolling(lookback, min_periods=1).max().shift(1).fillna(0)
    dn = (s == -1).rolling(lookback, min_periods=1).max().shift(1).fillna(0)
    return up.astype(bool), dn.astype(bool)
