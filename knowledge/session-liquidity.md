# Session liquidity & liquidity sweeps

Domain concepts established during the 2026-08-31 grilling session for the
session-liquidity-sweep idea (`IDEAS-BACKLOG.md`, `RESEARCH-LOG.md` Запись 9).
Reference this instead of re-deriving the definitions from chat history.

## Sessions

Three trading sessions, each a **fixed, wide time-of-day window** (not narrow
ICT "killzones" — the full range over which price moves during that window).
Standard forex convention, UTC:

- **Asia**: 00:00–08:00 UTC
- **London**: 08:00–16:00 UTC
- **New York**: 13:00–21:00 UTC (overlaps London 13:00–16:00)

Exact boundary values should be verified/pinned by whoever implements this
(daylight-saving shifts, exchange-specific conventions) — the above is the
working default, not independently re-derived per pass.

## Session liquidity

Within a session's time window, the **high and low price reached** = that
session's liquidity. Visualized as a rectangle: high price / low price / time
start / time end.

## Liquidity sweep

A sweep = a session's high or low is taken out (a wick beyond the level is
sufficient — close-through is not required) and price then reverses. Two
candidate detection methods for *confirming* a sweep, compared experimentally
against each other (not assumed — the research question is which one, if
either, actually predicts reversal):

### Method 1 — iFVG (inverted Fair Value Gap)

Standard 3-candle FVG: a gap between candle 1 and candle 3 (candle 2's range
inside the gap). An FVG becomes an **iFVG** when price later fully **closes**
through the far edge of the gap with candles in the opposite direction (a
partial poke into the gap does not count — full close-through only).

Sweep rule: if an iFVG forms **above** the session high in the **bearish**
direction (a bullish FVG got closed/inverted from above), that's a liquidity
sweep of the high. Mirror: an iFVG forming below the session low in the
bullish direction is a sweep of the low.

### Method 2 — BoS (break of structure) after the sweep

Structure is defined via pivot high / pivot low with **k=3** (3 bars each
side) — this project's existing `fractals(df, k)` primitive
(`research/intraday-mr-smc/indicators.py`) already implements this and is
confirmed equivalent to TradingView's `ta.pivothigh(high, 3, 3)` /
`ta.pivotlow(low, 3, 3)` (the 3-argument form — the 2-argument form pivots on
`close`, not `high`/`low`, and does *not* match). See
`research/_explainers/fractals-vs-pivots/` for a worked visual explainer
(README + charts) built on real BTC 5m data.

If a pivot low is broken (price closes beyond it), structure turns bearish;
if a pivot high is broken, structure turns bullish.

Sweep rule: after the session high is taken out, if a **bearish** BoS forms,
that's a liquidity sweep of the high. Mirror for the session low / bullish
BoS.

**Important scope note:** this uses BoS as a local, one-off trigger
immediately following a session-extreme take-out — it does **not** run the
project's general-purpose bias/CHoCH structure engine. That engine
(`indicators.structure()`, and its later two-tier pivot variant) has been
closed twice as an entry signal with no edge (`RESEARCH-LOG.md` Записи 5 and
6) — reusing the pivot *primitive* here is fine, reusing the *bias engine* is
not.

## Reference-level scope ("which levels can be swept")

A session's price action is checked against **all unswept levels from the
last 2 days** — today's earlier sessions plus the entirety of yesterday
(Asia/London/NY all included), not just the same session on the prior day.

## Reverse-move measurement

- **Reference point:** the sweep's own extreme (the wick that took out the
  level), not the confirmation bar's close and not the session level itself.
- **Horizon:** fixed 2 hours post-sweep (not a multi-horizon sweep, not
  "until an opposing structural event").

## Research protocol notes

No permutation-null / formal kill-rule discipline for this idea's first pass
— it's deliberately descriptive: sweep frequency per method, reverse-move
magnitude, with charts/diagrams at each step, on BTC/ETH/SOL/BNB at 5m. Flow:
Researcher (frequency/magnitude study) → Architect (strategy/entry design
based on findings) → Researcher (backtest). Sessions of most interest per the
user's hypothesis: **New York and Asia** — not yet tested, just the stated
prior.

Deliverables required: a Pine Script indicator (draws session rectangles,
iFVG formations, pivot markers on a live TradingView chart for manual visual
audit) **and** a Python analysis engine (frequency/magnitude statistics on
the existing cached Binance data) — both, not either/or. Keep this file
updated if either indicator's definition changes during implementation.
