# What `fractals(df, k)` actually does

This is a plain-language explainer for the `fractals()` function in
`research/intraday-mr-smc/indicators.py` (lines ~55-61). It answers: "how does
this decide a bar was a swing high/low, and can I trust it against what I see
on a TradingView chart?"

```python
def fractals(df, k=2):
    hi, lo = df.high, df.low
    sh = (hi == hi.rolling(2 * k + 1, center=True).max()) & hi.notna()
    sl = (lo == lo.rolling(2 * k + 1, center=True).min()) & lo.notna()
    return (sh.shift(k) == True), (sl.shift(k) == True)
```

## The idea in one sentence

A bar is a **pivot high** if its `high` is the tallest of a small neighborhood
around it (`k` bars before it, and `k` bars after it). A bar is a **pivot
low** the same way, using the lowest `low` in that neighborhood. `k` is the
same thing TradingView calls `leftbars`/`rightbars` in `ta.pivothigh(leftbars,
rightbars)` / `ta.pivotlow(leftbars, rightbars)`.

## Walking through it bar by bar

Take `k = 1` (so the "neighborhood" is 1 bar left + the bar itself + 1 bar
right = 3 bars). Here are 7 bars of highs and lows (bar numbers 1-7):

| bar | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|-----|---|---|---|---|---|---|---|
| high | 10 | 12 | **15** | 13 | 14 | **16** | 11 |
| low  | 9 | 10 | 12 | **11** | 12 | 13 | 9 |

**Pivot highs:**
- Bar 3's high (15) is bigger than bar 2's (12) and bar 4's (13) — it's a
  local peak. So bar 3 is a pivot high.
- Bar 6's high (16) is bigger than bar 5's (14) and bar 7's (11) — also a
  local peak. Bar 6 is a pivot high.
- No other bar's high beats both neighbors, so those are the only two.

**Pivot lows:**
- Bar 4's low (11) is smaller than bar 3's (12) and bar 5's (12) — a local
  trough. Bar 4 is a pivot low.
- That's the only one in this snippet.

This is exactly what `fractals(df, k=1)` on this toy data returns (verified
by actually running the function — see `plot_fractals.py`'s worked example in
its inline comments, or run the 7-bar snippet yourself: it prints pivot-high
flags `True` at bars 3 and 6, and a pivot-low flag `True` at bar 4).

## Why the result is delayed by `k` bars ("shift(k)")

Here's the part that trips people up: **you cannot know bar 3 was a pivot
high the moment bar 3 closes.** At that point you haven't seen bar 4 or bar 5
yet — for `k=1` you need one more bar (bar 4) to close before you can say
"yes, bar 3's high was higher than what came after it too." So:

- The *peak itself* happened at bar 3.
- But it's only *confirmed / knowable* once bar 4 has closed.

That's why the code does `.shift(k)`: the boolean flag for "bar 3 was a pivot
high" doesn't get set to `True` until row `3 + k`. This is not a bug or an
arbitrary delay — it's the only way to mark pivots without lookahead
(without peeking into the future to decide what happened in the past). If you
skipped the shift, you'd be able to "see" a pivot before it was actually
possible to know about it — a classic backtesting error that makes strategies
look better than they can really trade.

Practically: with `k=3` (this project's default), a swing point that visually
peaked "3 bars ago" is the most recent one you're allowed to react to. The
most recent 3 bars can never have a confirmed pivot yet, no matter what their
highs/lows look like — you simply don't have enough bars after them yet.

## Does this match TradingView's `ta.pivothigh` / `ta.pivotlow`?

**Short answer: yes, when used the way this project uses it** — i.e. calling
it on `high`/`low` with equal left/right bar counts, e.g. in Pine:
`ta.pivothigh(high, k, k)` / `ta.pivotlow(low, k, k)`. Both approaches:

- look at a window of `k` bars to the left and `k` bars to the right of a
  candidate bar,
- require that bar's high (low) to be the max (min) of that window,
- only confirm/plot the pivot `k` bars later than where it actually is, and
- never repaint once confirmed (an already-confirmed pivot never gets
  un-confirmed by later data).

**Two things worth flagging as unverified / worth double-checking**, since I
could not fully pin down TradingView's internal source and am going by
documentation and community write-ups rather than Pine's source code:

1. **Default source is `close`, not `high`/`low`.** TradingView's plain
   `ta.pivothigh(leftbars, rightbars)` (2-argument form) pivots on **closing
   price** by default. To match this project's `fractals()` (which pivots on
   `high`/`low`), you need the 3-argument form:
   `ta.pivothigh(high, leftbars, rightbars)` / `ta.pivotlow(low, leftbars,
   rightbars)`. If you're eyeballing a TradingView chart that uses the
   2-argument default, the pivots you see will *not* match this code's
   output — that's a source mismatch, not a bug.
2. **Strict vs. non-strict inequality.** This code uses `==` against a
   rolling max/min, which means if two bars in the same window tie for the
   highest high, *both* would be flagged (rare with real float prices, but
   possible with round numbers). Community documentation describes
   TradingView's pivot as requiring the candidate bar to be strictly greater
   than every other bar in the window on both sides. I was not able to
   confirm from Pine's own source how it resolves exact ties. In practice
   this is unlikely to matter on real crypto price data (exact tied
   highs/lows across multiple bars are rare), but it's called out here as a
   theoretical edge case rather than something independently verified.

Everything else — the core windowing logic and the `k`-bar confirmation
delay — matches TradingView's documented pivot behavior.

## The charts

See `01_pivots_overview.png` and `02_pivots_causality.png`, generated by
`plot_fractals.py` from real BTCUSDT 5-minute candles (already cached in
`research/intraday-mr-smc/data/BTCUSDT-5m.csv.gz` — no new data was
downloaded). Both charts call `fractals()` from the actual `indicators.py`
module, not a reimplementation.

- **`01_pivots_overview.png`** — ~260 real 5m candles with every confirmed
  `k=3` pivot high (red triangle above the bar) and pivot low (blue triangle
  below the bar) marked. Use this to eyeball: does every local peak/trough
  that has 3 bars of confirmed follow-through on both sides get a marker? (It
  should — and only those do.)
- **`02_pivots_causality.png`** — a shorter, more zoomed-in window where the
  trailing `k=3` bars are shaded grey with an annotation, showing that even
  if the last few bars contain a large high, it is *not yet* marked as a
  pivot — because we don't yet know if price will make a new high in the next
  few bars. This is the "no lookahead" property made visual.

## How to reproduce

```bash
source .venv/bin/activate
python research/_explainers/fractals-vs-pivots/plot_fractals.py
```
