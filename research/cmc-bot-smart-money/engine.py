"""Bar-for-bar Python port of the `cmc-bot` smart-money signal engine.

This is a **reproduction, not an improvement**. ARCHITECT-NOTE §4's
bug-fidelity rule is binding: every place where the TypeScript does something
other than what its names promise is reproduced here as-is, with a `PARITY.md`
row. Nothing is silently fixed. Search this file for `BUG-FIDELITY` to find
them all.

What is ported (ARCHITECT-NOTE §4, "What reproduce the signals means
operationally"):

  * `FvgCalculator.calculateStep` — `getFvgElement` with its `close[i]` vs
    `open[i-2]` body clause, `filterFvgArrays` (the **proximal-edge**
    inversion), `filterInverseFvgArrays` (the iFVG pruning);
  * `getLastIfvg` / `getLastIfvgDirection` with the index bug and the
    sell-default;
  * the H1 bias — `calculateFVG` over a rolling 720-hour H1 window, re-read on
    every M1 bar;
  * `Swings` at length 60, the `h_trail_up`/`h_trail_dn` running range, the
    `i > 200` warm-up, and `YinDiscount`;
  * `isNewYorkAMTrueOpen` at 07:30 New York and `aboveNYamTrueOpen`;
  * the ATR(20) gate as coded (`ATR / gapSize < 8`);
  * `RiskManager.adjustStopLoss`'s {0.5, 0.7, 1.0} table, the 2.7R target,
    `tryToTrailStopLoss`, the close-only exit checks, `Order.close()`'s
    clamping, the 09:40-11:10 New York session and the forced flat.

What is deliberately NOT ported (ARCHITECT-NOTE §6): PDH/PDL/PWH/PWL/PMH/PML,
the London high/low, the dead BoS flags, the 15-bar `Swings`/liquidity-line
layer, and everything else that `SmartMoneyStrategy` never reads.

Stage 0 reports **counts only**. `simulate_trades` exists to answer "how many
trades would the holdout carry", which is a count, not a result; it records no
P&L and this file computes no R.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from numba import njit

from common import (ATR_LEN, BUY, H1_BIAS_MS, H_SWING_LENGTH, MAX_IFVG_TO_ATR_RATIO,
                    SELL, TARGET_RR, WARMUP, WINDOW_MS, load_1m, nyam_open_bar,
                    resample_1h, session_mask)

MAXF = 4096          # scratch capacity for the live FVG / iFVG lists


# ===========================================================================
# 1. The FVG / iFVG state machine.  fvg-element.ts:16-176, fvg.indicator.ts:6-87
# ===========================================================================
@njit(cache=True)
def _fvg_direction(o, h, l, c, i0, i1):
    """`calculateFVG(...).lastIFVGDirection` over the slice [i0, i1] inclusive.

    Used for the H1 bias. Returns BUY=0 / SELL=1.

    BUG-FIDELITY (D-02): the empty-list branches are **defaults, not
    observations** — with the bullish iFVG list empty the answer is `sell`,
    even when that list is empty because nothing has happened at all.
    """
    bi_x = np.empty(MAXF, np.int64); si_x = np.empty(MAXF, np.int64)
    bi_lo = np.empty(MAXF); bi_hi = np.empty(MAXF)
    si_lo = np.empty(MAXF); si_hi = np.empty(MAXF)
    bf_lo = np.empty(MAXF); bf_hi = np.empty(MAXF); bf_x = np.empty(MAXF, np.int64)
    sf_lo = np.empty(MAXF); sf_hi = np.empty(MAXF); sf_x = np.empty(MAXF, np.int64)
    nbf = nsf = nbi = nsi = 0
    n = i1 - i0 + 1
    for j in range(n):
        if j <= 2:
            continue
        g = i0 + j
        if c[g] > o[g - 2] and l[g] > h[g - 2]:
            bf_lo[nbf] = h[g - 2]; bf_hi[nbf] = l[g]; bf_x[nbf] = j; nbf += 1
        if c[g] < o[g - 2] and h[g] < l[g - 2]:
            sf_lo[nsf] = h[g]; sf_hi[nsf] = l[g - 2]; sf_x[nsf] = j; nsf += 1
        op = o[g]; cl = c[g]
        w = 0
        for t in range(nbf):
            if not (op > bf_lo[t] and cl < bf_lo[t]):
                bf_lo[w] = bf_lo[t]; bf_hi[w] = bf_hi[t]; bf_x[w] = bf_x[t]; w += 1
            else:
                si_lo[nsi] = bf_lo[t]; si_hi[nsi] = bf_hi[t]; si_x[nsi] = bf_x[t]; nsi += 1
        nbf = w
        w = 0
        for t in range(nsf):
            if not (op < sf_hi[t] and cl > sf_hi[t]):
                sf_lo[w] = sf_lo[t]; sf_hi[w] = sf_hi[t]; sf_x[w] = sf_x[t]; w += 1
            else:
                bi_lo[nbi] = sf_lo[t]; bi_hi[nbi] = sf_hi[t]; bi_x[nbi] = sf_x[t]; nbi += 1
        nsf = w
        w = 0
        for t in range(nbi):
            if not (op > bi_lo[t] and cl < bi_lo[t]):
                bi_lo[w] = bi_lo[t]; bi_hi[w] = bi_hi[t]; bi_x[w] = bi_x[t]; w += 1
        nbi = w
        w = 0
        for t in range(nsi):
            if not (op < si_hi[t] and cl > si_hi[t]):
                si_lo[w] = si_lo[t]; si_hi[w] = si_hi[t]; si_x[w] = si_x[t]; w += 1
        nsi = w
    if nbi == 0:
        return SELL
    elif nsi == 0:
        return BUY
    return BUY if bi_x[nbi - 1] > si_x[nsi - 1] else SELL


# ===========================================================================
# 2. One full `indicatorScript` evaluation, for every in-session M1 bar.
# ===========================================================================
@njit(cache=True)
def _scan(o, h, l, c, ev, ws, condH, condL, last_nyam,
          bull_occ, bear_occ, in_disc, rng_hi, rng_lo,
          has_ifvg, ifvg_sz, ifvg_dir, above_nyam, max_list):
    """`indicatorScript(window)` for each evaluation bar, window by window.

    `ev[k]` is the global index of the bar the bot evaluates at; `ws[k]` is the
    first global index inside its rolling 12-hour window. Both are computed by
    timestamp in `prepare()`, exactly as `StaticDataSource.getCandles` filters.
    """
    bf_lo = np.empty(MAXF); bf_hi = np.empty(MAXF); bf_x = np.empty(MAXF, np.int64)
    sf_lo = np.empty(MAXF); sf_hi = np.empty(MAXF); sf_x = np.empty(MAXF, np.int64)
    bi_lo = np.empty(MAXF); bi_hi = np.empty(MAXF); bi_x = np.empty(MAXF, np.int64)
    si_lo = np.empty(MAXF); si_hi = np.empty(MAXF); si_x = np.empty(MAXF, np.int64)

    for k in range(ev.shape[0]):
        s = ws[k]; g = ev[k]; n = g - s + 1
        nbf = nsf = nbi = nsi = 0
        d_bull = False; d_bear = False

        # ---- FvgCalculator.calculateStep, bar by bar over the window -------
        for j in range(n):
            if j <= 2:
                continue
            gg = s + j
            # getFvgElement: the geometric gap AND the body clause vs open[i-2]
            if c[gg] > o[gg - 2] and l[gg] > h[gg - 2]:
                bf_lo[nbf] = h[gg - 2]; bf_hi[nbf] = l[gg]; bf_x[nbf] = j; nbf += 1
            if c[gg] < o[gg - 2] and h[gg] < l[gg - 2]:
                sf_lo[nsf] = h[gg]; sf_hi[nsf] = l[gg - 2]; sf_x[nsf] = j; nsf += 1
            op = o[gg]; cl = c[gg]
            d_bull = False; d_bear = False
            # filterFvgArrays — inversion through the PROXIMAL edge, and the
            # bar must have OPENED on the far side of that edge.
            w = 0
            for t in range(nbf):
                if not (op > bf_lo[t] and cl < bf_lo[t]):
                    bf_lo[w] = bf_lo[t]; bf_hi[w] = bf_hi[t]; bf_x[w] = bf_x[t]; w += 1
                else:
                    d_bull = True
                    si_lo[nsi] = bf_lo[t]; si_hi[nsi] = bf_hi[t]; si_x[nsi] = bf_x[t]; nsi += 1
            nbf = w
            w = 0
            for t in range(nsf):
                if not (op < sf_hi[t] and cl > sf_hi[t]):
                    sf_lo[w] = sf_lo[t]; sf_hi[w] = sf_hi[t]; sf_x[w] = sf_x[t]; w += 1
                else:
                    d_bear = True
                    bi_lo[nbi] = sf_lo[t]; bi_hi[nbi] = sf_hi[t]; bi_x[nbi] = sf_x[t]; nbi += 1
            nsf = w
            # filterInverseFvgArrays — iFVGs are pruned on the same rule
            w = 0
            for t in range(nbi):
                if not (op > bi_lo[t] and cl < bi_lo[t]):
                    bi_lo[w] = bi_lo[t]; bi_hi[w] = bi_hi[t]; bi_x[w] = bi_x[t]; w += 1
            nbi = w
            w = 0
            for t in range(nsi):
                if not (op < si_hi[t] and cl > si_hi[t]):
                    si_lo[w] = si_lo[t]; si_hi[w] = si_hi[t]; si_x[w] = si_x[t]; w += 1
            nsi = w
            if nbf > max_list[0]: max_list[0] = nbf
            if nsf > max_list[0]: max_list[0] = nsf
            if nbi > max_list[0]: max_list[0] = nbi
            if nsi > max_list[0]: max_list[0] = nsi

        # `bullishIfvgOccurs` is fed by isLastCandleDiscardBEARishFvg — the
        # naming inverts in main-indicator.ts:468-469; the polarity is right.
        bull_occ[k] = d_bear
        bear_occ[k] = d_bull

        # ---- Swings(60) + h_trail_up / h_trail_dn --------------------------
        # BUG-FIDELITY (D-05): ScriptVar.set() writes to history[0] instead of
        # the current slot on its SECOND call inside one iteration, so the
        # trailing update is silently dropped on a bar that confirms a swing.
        # Reproduced: a swing bar sets the edge to the swing level, full stop.
        prev_osc = 0            # TrendOscillator.LOWER, per the constructor
        htu = 0.0; htd = 0.0
        for j in range(WARMUP + 1, n):
            gg = s + j
            if condH[gg]:
                cur = 1
            elif condL[gg]:
                cur = 0
            else:
                cur = prev_osc
            h_top = h[gg - H_SWING_LENGTH] if (cur == 1 and prev_osc != 1) else 0.0
            h_btm = l[gg - H_SWING_LENGTH] if (cur == 0 and prev_osc != 0) else 0.0
            prev_osc = cur
            if h_top != 0.0:
                htu = h_top
            elif h[gg] > htu:
                htu = h[gg]
            if h_btm != 0.0:
                htd = h_btm
            elif htd == 0.0:
                htd = l[gg]
            elif l[gg] < htd:
                htd = l[gg]
        rng_hi[k] = htu
        rng_lo[k] = htd
        in_disc[k] = (0.5 * htu + 0.5 * htd) > c[g]     # YinDiscount

        # ---- aboveNYamTrueOpen --------------------------------------------
        # BUG-FIDELITY (D-04): compares the LAST BAR'S OPEN (not its close) and
        # is `false` when no 07:30 level has been set inside the window, so
        # "not above" conflates *below* with *unknown*.
        idx = last_nyam[g]
        above_nyam[k] = (idx >= s + 1) and (o[idx] < o[g])

        # ---- getLastIfvg / getLastIfvgDirection ---------------------------
        # BUG-FIDELITY (D-01): getLastIfvg indexes one array by the OTHER's
        # length - 1, i.e. arr[-1] -> undefined in JS, whenever either list is
        # empty. The ATR gate then divides by nothing and blocks the trade, so
        # the gate silently also requires BOTH lists to be non-empty.
        if nbi == 0 or nsi == 0:
            has_ifvg[k] = False
            ifvg_sz[k] = np.nan
        else:
            has_ifvg[k] = True
            if bi_x[nbi - 1] > si_x[nsi - 1]:
                ifvg_sz[k] = abs(bi_lo[nbi - 1] - bi_hi[nbi - 1])
            else:
                ifvg_sz[k] = abs(si_lo[nsi - 1] - si_hi[nsi - 1])
        if nbi == 0:
            ifvg_dir[k] = SELL
        elif nsi == 0:
            ifvg_dir[k] = BUY
        else:
            ifvg_dir[k] = BUY if bi_x[nbi - 1] > si_x[nsi - 1] else SELL


# ===========================================================================
# 3. Driver
# ===========================================================================
def prepare(symbol: str, m1: pd.DataFrame | None = None,
            h1: pd.DataFrame | None = None) -> dict:
    """Load one symbol and precompute everything that is window-independent.

    The `Swings` comparison window and the ATR window are both addressed by
    GLOBAL bar index inside the bot too (`TA.highest` walks the window array,
    but the window is a contiguous slice of the tape, so the bars it reads are
    the same bars for every window that contains them). Hoisting them out of
    the per-window loop is therefore an optimisation, not a change of
    behaviour — `checks.py` C1 asserts that against a literal transcription.

    `m1` / `h1` override the loaded frames; `checks.py` uses that to re-run the
    whole pipeline on a **prefix truncated at a signal bar** (gate 2), and to
    separate the M1 path's causality from the H1 bias's lookahead (D-06).
    """
    if m1 is None:
        m1 = load_1m(symbol)
    m1 = m1.reset_index(drop=True)
    ts = pd.DatetimeIndex(m1.ts)
    o = m1["open"].to_numpy(float); h = m1["high"].to_numpy(float)
    l = m1["low"].to_numpy(float); c = m1["close"].to_numpy(float)
    ms = ts.asi8 // 1_000_000
    n = len(m1)

    # TA.highest/lowest(60, .., i) read bars i-1 .. i-59 (59 of them, i excluded)
    hs = pd.Series(h); ls = pd.Series(l)
    hh = hs.rolling(H_SWING_LENGTH - 1).max().shift(1).to_numpy()
    ll = ls.rolling(H_SWING_LENGTH - 1).min().shift(1).to_numpy()
    back_h = np.full(n, np.nan); back_l = np.full(n, np.nan)
    back_h[H_SWING_LENGTH:] = h[:-H_SWING_LENGTH]      # high.get(60)
    back_l[H_SWING_LENGTH:] = l[:-H_SWING_LENGTH]
    condH = np.nan_to_num(back_h, nan=-np.inf) > np.nan_to_num(hh, nan=np.inf)
    condL = np.nan_to_num(back_l, nan=np.inf) < np.nan_to_num(ll, nan=-np.inf)

    # ATR(20): the mean of the last 20 true ranges ending at the window's last bar
    tr = np.full(n, np.nan)
    pc = np.empty(n); pc[0] = np.nan; pc[1:] = c[:-1]
    tr[1:] = np.maximum(h[1:] - l[1:],
                        np.maximum(np.abs(h[1:] - pc[1:]), np.abs(l[1:] - pc[1:])))
    atr20 = pd.Series(tr).rolling(ATR_LEN).mean().to_numpy()

    nyam = nyam_open_bar(ts)
    idx = np.where(nyam, np.arange(n), -1)
    last_nyam = np.maximum.accumulate(idx)

    if h1 is None:
        h1 = resample_1h(m1)
    h1_ms = pd.DatetimeIndex(h1.ts).asi8 // 1_000_000

    return dict(symbol=symbol, ts=ts, ms=ms, o=o, h=h, l=l, c=c,
                condH=condH, condL=condL, atr20=atr20, last_nyam=last_nyam,
                sess=session_mask(ts), h1=h1, h1_ms=h1_ms,
                h1_o=h1["open"].to_numpy(float), h1_h=h1["high"].to_numpy(float),
                h1_l=h1["low"].to_numpy(float), h1_c=h1["close"].to_numpy(float))


def h1_bias_series(P: dict, ev_ms: np.ndarray) -> np.ndarray:
    """`getHighTimeFrameBias` — `calculateFVG` over the H1 bars in
    (t - 720h, t], re-read on every M1 bar.

    BUG-FIDELITY (D-06, and the one that matters most): `StaticDataSource`
    returns the *complete* H1 candle whose openTime is <= the current M1
    timestamp, so at 13:47 the bot reads the 13:00-14:00 hour bar in full.
    That is up to 59 minutes of lookahead in the bot's own backtest. It is
    reproduced here because Stage 0's job is parity; `PARITY.md` D-06 carries
    it and the causal variant is a Stage-1 sensitivity, not a silent fix.

    Cached on (first, last) H1 index: inside one 91-minute session those change
    at most twice, so this costs ~3 evaluations per symbol-day.
    """
    lo = np.searchsorted(P["h1_ms"], ev_ms - H1_BIAS_MS, side="left")
    hi = np.searchsorted(P["h1_ms"], ev_ms, side="right") - 1
    out = np.empty(len(ev_ms), np.int8)
    cache: dict[tuple[int, int], int] = {}
    for k in range(len(ev_ms)):
        key = (int(lo[k]), int(hi[k]))
        v = cache.get(key)
        if v is None:
            v = int(_fvg_direction(P["h1_o"], P["h1_h"], P["h1_l"], P["h1_c"],
                                   key[0], key[1]))
            cache[key] = v
        out[k] = v
    return out


def signals(P: dict, lo_ms: int | None = None, hi_ms: int | None = None) -> pd.DataFrame:
    """Every in-session M1 bar with its full funnel state, one row per bar.

    Daily caps are NOT applied (ARCHITECT-NOTE §3.2 "Population (primary)"),
    and neither is the one-open-order-per-direction rule — that one belongs to
    `simulate_trades`, because it is a property of the trade stream, not of the
    signal.
    """
    ms = P["ms"]
    sel = P["sess"].copy()
    if lo_ms is not None:
        sel &= ms >= lo_ms
    if hi_ms is not None:
        sel &= ms <= hi_ms
    ev = np.where(sel)[0].astype(np.int64)
    ws = np.searchsorted(ms, ms[ev] - WINDOW_MS, side="left").astype(np.int64)

    k = len(ev)
    z = lambda dt: np.empty(k, dt)  # noqa: E731
    bull_occ = z(np.bool_); bear_occ = z(np.bool_); in_disc = z(np.bool_)
    rng_hi = z(np.float64); rng_lo = z(np.float64)
    has_ifvg = z(np.bool_); ifvg_sz = z(np.float64); ifvg_dir = z(np.int8)
    above = z(np.bool_); max_list = np.zeros(1, np.int64)

    _scan(P["o"], P["h"], P["l"], P["c"], ev, ws, P["condH"], P["condL"],
          P["last_nyam"], bull_occ, bear_occ, in_disc, rng_hi, rng_lo,
          has_ifvg, ifvg_sz, ifvg_dir, above, max_list)
    assert max_list[0] < MAXF, f"FVG scratch overflow ({max_list[0]})"

    bias = h1_bias_series(P, ms[ev])
    atr = P["atr20"][ev]
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(has_ifvg, atr / ifvg_sz, np.inf)
    atr_ok = ratio < MAX_IFVG_TO_ATR_RATIO        # NaN compares false, as in JS

    close = P["c"][ev]
    sell = above & bear_occ & ~in_disc & (bias == SELL) & atr_ok
    buy = ~above & bull_occ & in_disc & (bias == BUY) & atr_ok

    df = pd.DataFrame({
        "symbol": P["symbol"], "i": ev, "ts": P["ts"][ev],
        "open": P["o"][ev], "close": close,
        "bull_occ": bull_occ, "bear_occ": bear_occ, "above_nyam": above,
        "in_disc": in_disc, "bias": bias, "has_ifvg": has_ifvg,
        "ifvg_size": ifvg_sz, "atr20": atr, "atr_ok": atr_ok,
        "range_high": rng_hi, "range_low": rng_lo,
        "sell_signal": sell, "buy_signal": buy,
    })
    # smartmoney-strategy.ts evaluates the SELL branch first and returns early.
    df["direction"] = np.where(sell, SELL, np.where(buy, BUY, -1)).astype(np.int8)
    df["signal"] = df.direction >= 0
    df["stop"], df["target"] = _stop_target(df)
    return df


def _stop_target(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """`RiskManager.adjustStopLoss` + `adjustTakeProfitToTargetRiskRewardRatio`.

    BUG-FIDELITY (D-03): `getStopLossRatio` returns rangeSize / stopSize, so a
    SMALL ratio means a WIDE stop — the ×0.5 / ×0.7 shrink fires when the stop
    is large relative to the range, the opposite of what the name suggests.
    """
    entry = df["close"].to_numpy()
    anchor = np.where(df.direction == BUY, df.range_low, df.range_high)
    sl_size = np.abs(anchor - entry)
    rng = np.abs(df.range_low.to_numpy() - df.range_high.to_numpy())
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = rng / sl_size
    mult = np.where(ratio < 2.5, 0.5, np.where(ratio < 3.0, 0.7, 1.0))
    new_sz = sl_size * mult
    stop = np.where(df.direction == BUY, entry - new_sz, entry + new_sz)
    loss = np.where(df.direction == BUY, entry - stop, stop - entry)
    target = np.where(df.direction == BUY, entry + TARGET_RR * loss,
                      entry - TARGET_RR * loss)
    off = df.direction.to_numpy() < 0
    stop = np.where(off, np.nan, stop)
    target = np.where(off, np.nan, target)
    return stop, target


# ===========================================================================
# 4. Trade stream — counts only (ARCHITECT-NOTE §4: Stage 0 produces no R).
# ===========================================================================
def simulate_trades(P: dict, sig: pd.DataFrame, daily_caps: bool = False,
                    lo_ms: int | None = None, hi_ms: int | None = None) -> pd.DataFrame:
    """`StrategyTemplate.processStep`'s order lifecycle, in the bot's own order.

    Per bar, in this sequence (strategy-template.ts:85-141):
      1. outside the session -> `processOutOfValidTime` force-closes everything
         at `this.lastCandles`' last close, i.e. the 11:10 bar's close;
      2. `checkAndCloseOrders` — exits on the M1 CLOSE only, never a wick;
      3. `verifyExistingOrders` — `tryToTrailStopLoss`, then the
         both-directions-open rule closes the EARLIER order;
      4. only then may a new order open, and only if no order in that
         direction is already live.

    `daily_caps=False` is the primary population (ARCHITECT-NOTE §3.2); passing
    True reproduces the as-deployed 2-loss / 1-win overlay for the mandatory
    secondary row. Exit prices are recorded so `checks.py` can diff them
    against the TypeScript; no return, R or expectancy is computed here.
    """
    rows = []
    live: list[dict] = []
    by_i = {int(r.i): r for r in sig.itertuples()}
    c = P["c"]; ms = P["ms"]; sess = P["sess"].copy()
    if lo_ms is not None:
        sess &= ms >= lo_ms
    if hi_ms is not None:
        sess &= ms <= hi_ms
    day_of = pd.DatetimeIndex(P["ts"]).normalize().asi8 // 1_000_000
    lost: dict[int, int] = {}
    won: dict[int, int] = {}
    last_in_session = -1

    ev_all = np.where(sess)[0]
    scan = np.union1d(ev_all, np.minimum(ev_all + 1, len(c) - 1))

    def close_order(od, i, price, why):
        # Order.close() clamps a gapped-through fill back to the exact level.
        cp = price
        if od["dir"] == BUY:
            profitable = od["entry"] < cp
            cp = min(max(cp, od["stop"]), od["target"])
        else:
            profitable = od["entry"] > cp
            cp = max(min(cp, od["stop"]), od["target"])
        od.update(exit_i=i, exit_ts=ms[i], exit_price=cp, exit_why=why,
                  profitable=bool(profitable), breakeven=od["stop"] == od["entry"])
        # RiskManager counts by `!order.profitable`, so a break-even close is a
        # "loss" for the daily cap. Reproduced, not tidied.
        d = int(day_of[i])
        if profitable:
            won[d] = won.get(d, 0) + 1
        else:
            lost[d] = lost.get(d, 0) + 1
        rows.append(od)

    for i in scan:
        i = int(i)
        if not sess[i]:
            for od in live:                       # processOutOfValidTime
                close_order(od, last_in_session, c[last_in_session], "TIME_1110")
            live = []
            continue
        last_in_session = i

        still = []                                # checkAndCloseOrders
        for od in live:
            if od["dir"] == BUY and c[i] < od["stop"]:
                close_order(od, i, c[i], "STOP")
            elif od["dir"] == BUY and c[i] > od["target"]:
                close_order(od, i, c[i], "TARGET")
            elif od["dir"] == SELL and c[i] > od["stop"]:
                close_order(od, i, c[i], "STOP")
            elif od["dir"] == SELL and c[i] < od["target"]:
                close_order(od, i, c[i], "TARGET")
            else:
                still.append(od)
        live = still

        for od in live:                           # tryToTrailStopLoss
            prof = (c[i] - od["entry"]) if od["dir"] == BUY else (od["entry"] - c[i])
            r = prof / od["risk"]
            was = od["stop"]
            if 1 < r < 2:
                od["stop"] = (max(od["stop"], od["entry"]) if od["dir"] == BUY
                              else min(od["stop"], od["entry"]))
            elif r > 2:
                one_r = od["entry"] + od["risk"] if od["dir"] == BUY else od["entry"] - od["risk"]
                od["stop"] = (max(od["stop"], one_r) if od["dir"] == BUY
                              else min(od["stop"], one_r))
            if od["stop"] != was:
                od["n_trail"] += 1

        if any(x["dir"] == BUY for x in live) and any(x["dir"] == SELL for x in live):
            earliest = min(live, key=lambda x: x["entry_ts"])
            close_order(earliest, i, c[i], "OPPOSITE")
            live = [x for x in live if x is not earliest]

        r = by_i.get(i)
        if r is None or not r.signal:
            continue
        if daily_caps:
            d = int(day_of[i])
            if lost.get(d, 0) >= 2 or won.get(d, 0) >= 1:
                continue
        if any(x["dir"] == r.direction for x in live):
            continue                              # isNewOrdersAllowed
        live.append(dict(symbol=P["symbol"], entry_i=i, entry_ts=ms[i] + 60_000,
                         signal_ts=ms[i], dir=int(r.direction), entry=float(r.close),
                         stop0=float(r.stop), stop=float(r.stop), target=float(r.target),
                         n_trail=0, risk=abs(float(r.stop) - float(r.close))))
    return pd.DataFrame(rows)
