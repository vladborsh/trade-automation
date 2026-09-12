"""A **literal, deliberately slow** transcription of `indicatorScript`.

`engine.py` is fast: it hoists the `TA.highest` / `TA.lowest` / ATR windows out
of the per-window loop (legitimate, because the bot's window is a contiguous
slice of the same tape) and it collapses `ScriptVar`'s write semantics into two
branches. Both of those are reasoning steps, and a reasoning step is exactly
what a parity pass is not allowed to take on trust.

So this file transcribes the TypeScript line by line, including a faithful
`ScriptVar` — with the `history[history.length - iteration - 1]` write that
JavaScript silently turns into a no-op on a negative index — and `checks.py`
C1 asserts the two agree bar for bar. It is never used in production paths.

Sources: `src/indicator/main-indicator.ts`, `src/indicator/functions/swings.ts`,
`src/indicator/functions/y-in-discount.ts`, `src/indicator/tools/script-var.ts`,
`src/indicator/tools/tech-analysis.ts`, `src/indicator/tools/fvg-element.ts`.
"""
from __future__ import annotations

LOWER, HIGHER = 0, 1


class ScriptVar:
    """script-var.ts, transcribed including the write bug.

    `set()` pushes on the first call of an iteration and otherwise writes to
    `history[history.length - iteration - 1]`. After the push that index is 0,
    not `history.length - 1`, so **every later `set()` in the same iteration is
    lost** (and quietly corrupts the oldest slot). Before the first push, while
    `history` is shorter than `iteration`, the index is negative and JS assigns
    a string-keyed property to the array object instead of an element — also a
    no-op as far as `get()` is concerned. Both are reproduced.
    """

    def __init__(self, value):
        self.history = [value]
        self.iteration = 0
        self.lastUpdateIteration = 0

    def set(self, value):
        if self.lastUpdateIteration < self.iteration:
            self.history.append(value)
            self.lastUpdateIteration = self.iteration
        else:
            idx = len(self.history) - self.iteration - 1
            if 0 <= idx < len(self.history):
                self.history[idx] = value
            # else: JS writes an own property on the Array; get() never sees it

    def end(self):
        if self.lastUpdateIteration < self.iteration:
            self.history.append(self.history[-1])
            self.lastUpdateIteration = self.iteration

    def get(self, index: int = 0):
        return self.history[len(self.history) - 1 - index]


def _highest(length, hi, i):
    return max(hi[k] for k in range(i - 1, i - length, -1))


def _lowest(length, lo, i):
    return min(lo[k] for k in range(i - 1, i - length, -1))


class Swings:
    """functions/swings.ts"""

    def __init__(self, length, hi, lo, high_var, low_var):
        self.length = length
        self.hi = hi
        self.lo = lo
        self.high = high_var
        self.low = low_var
        self.curr = LOWER
        self.prev = LOWER

    def calculate(self, i):
        upper = _highest(self.length, self.hi, i)
        lower = _lowest(self.length, self.lo, i)
        if self.high.get(self.length) > upper:
            self.curr = HIGHER
        elif self.low.get(self.length) < lower:
            self.curr = LOWER
        else:
            self.curr = self.prev
        top = self.high.get(self.length) if (self.curr == HIGHER and self.prev != HIGHER) else 0
        btm = self.low.get(self.length) if (self.curr == LOWER and self.prev != LOWER) else 0
        self.prev = self.curr
        return top, btm


def indicator_script(o, h, l, c, nyam_flag):
    """`indicatorScript(chartData, {})`, restricted to the insights
    `SmartMoneyStrategy` actually reads.

    `nyam_flag[i]` is `isNewYorkAMTrueOpen(t[i-1] + 1, t[i])`, precomputed by
    the caller because the date arithmetic is not what this transcription is
    auditing. Everything else is done the long way.

    Returns the six insights the strategy reads, plus the range, as a dict.
    """
    n = len(c)
    H_SWING_LENGTH, EQ_THRESHOLD_ATR = 60, 200
    SWING_LENGTH, I_SWING_LENGTH = 15, 3

    vars_ = []

    def var(v):
        sv = ScriptVar(v)
        vars_.append(sv)
        return sv

    open_ = var(o[0]); high = var(h[0]); low = var(l[0]); close = var(c[0])
    h_top_y = var(0); h_top_x = var(0); h_trail_up = var(0); h_trail_up_x = var(0)
    h_btm_y = var(0); h_btm_x = var(0); h_trail_dn = var(0); h_trail_dn_x = var(0)

    h_swing = Swings(H_SWING_LENGTH, h, l, high, low)

    bullFvg, bearFvg, bullIFvg, bearIFvg = [], [], [], []
    disc_bull = disc_bear = False
    last_nyam = None

    for i in range(n):
        for sv in vars_:
            sv.iteration = i

        # --- FvgCalculator.calculateStep(i, chartData, open.get(), close.get())
        if i > 2:
            op, cl = open_.get(), close.get()
            if c[i] > o[i - 2] and l[i] > h[i - 2]:
                bullFvg.append({"low": h[i - 2], "high": l[i], "x": i})
            if c[i] < o[i - 2] and h[i] < l[i - 2]:
                bearFvg.append({"low": h[i], "high": l[i - 2], "x": i})
            nb, ns, inv_bear, inv_bull = [], [], [], []
            disc_bull = disc_bear = False
            for f in bullFvg:
                if not (op > f["low"] and cl < f["low"]):
                    nb.append(f)
                else:
                    disc_bull = True
                    inv_bear.append(f)
            for f in bearFvg:
                if not (op < f["high"] and cl > f["high"]):
                    ns.append(f)
                else:
                    disc_bear = True
                    inv_bull.append(f)
            bullFvg, bearFvg = nb, ns
            bullIFvg = bullIFvg + inv_bull
            bearIFvg = bearIFvg + inv_bear
            bullIFvg = [f for f in bullIFvg if not (op > f["low"] and cl < f["low"])]
            bearIFvg = [f for f in bearIFvg if not (op < f["high"] and cl > f["high"])]

        # --- the swing / range block
        if i > max(H_SWING_LENGTH, SWING_LENGTH, I_SWING_LENGTH, EQ_THRESHOLD_ATR):
            h_top, h_btm = h_swing.calculate(i)
            if h_top:
                h_top_y.set(h_top); h_top_x.set(i - H_SWING_LENGTH)
                h_trail_up.set(h_top); h_trail_up_x.set(i - H_SWING_LENGTH)
            h_trail_up.set(max(high.get(), h_trail_up.get()))
            h_trail_up_x.set(i if h_trail_up.get() == high.get() else h_trail_up_x.get())
            if h_btm:
                h_btm_y.set(h_btm); h_btm_x.set(i - H_SWING_LENGTH)
                h_trail_dn.set(h_btm); h_trail_dn_x.set(i - H_SWING_LENGTH)
            h_trail_dn.set(low.get() if h_trail_dn.get() == 0
                           else min(low.get(), h_trail_dn.get()))
            h_trail_dn_x.set(i if h_trail_dn.get() == low.get() else h_trail_dn_x.get())

        # --- the true-open scan
        if i > 0 and nyam_flag[i]:
            last_nyam = o[i]

        # --- "cached variables should be spread"
        if i <= n - 2:
            open_.set(o[i + 1]); high.set(h[i + 1]); low.set(l[i + 1]); close.set(c[i + 1])
        for sv in vars_:
            sv.end()

    def last_ifvg_direction():
        if not bullIFvg:
            return "sell"
        if not bearIFvg:
            return "buy"
        return "buy" if bullIFvg[-1]["x"] > bearIFvg[-1]["x"] else "sell"

    def last_ifvg():
        # getLastIfvg indexes one array by the OTHER's length - 1 -> JS undefined
        if not bullIFvg:
            return None
        if not bearIFvg:
            return None
        return (bullIFvg[-1] if bullIFvg[-1]["x"] > bearIFvg[-1]["x"] else bearIFvg[-1])

    rangeHigh, rangeLow = h_trail_up.get(), h_trail_dn.get()
    return {
        "priceInDiscount": 0.5 * rangeHigh + 0.5 * rangeLow > close.get(),
        "rangeHigh": rangeHigh,
        "rangeLow": rangeLow,
        "bullishIfvgOccurs": disc_bear,
        "bearishIfvgOccurs": disc_bull,
        "lastIFVG": last_ifvg(),
        "lastIFVGDirection": last_ifvg_direction(),
        "aboveNYamTrueOpen": (last_nyam < o[n - 1]) if last_nyam is not None else False,
    }


def atr(o, h, l, c, length):
    """tools/atr.indicator.ts — a simple mean of true ranges, not Wilder's."""
    tr = []
    for i in range(1, len(c)):
        tr.append(max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])))
    out = []
    for i in range(length, len(c)):
        out.append(sum(tr[i - length:i]) / length)
    return out
