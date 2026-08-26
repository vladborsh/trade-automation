# Routing addendum — VWAP-MR goes to Pine Script for TradingView hand-testing

**Role:** Architect · **Supersedes:** the stage-0/1/2 path in `ARCHITECT-NOTE.md` §4
(user decision 2026-08-26: no vendor data purchase for now; log: master `b1b17ae`).
**Design is unchanged** — §3 of `ARCHITECT-NOTE.md` still governs. Only the
execution vehicle changes: a **Pine Script strategy** the user runs on
TradingView (ES/NQ/YM — NQ confirmed in scope), with results brought back
before any spend decision.

## What this path is, honestly

TradingView hand-testing replaces our data purchase with TradingView's data and
our engine with theirs. That buys a free look at the idea but costs rigor: no
pre-registered fit/holdout split we control, no pooled probe, TradingView's
fill model instead of ours, and a strong temptation to twiddle inputs on the
chart until something looks good. The brief below is written to keep as much of
the stage-discipline as this vehicle allows. **A good-looking TradingView run
is evidence for funding stage 0, not a validated strategy** — that promotion
rule is unchanged.

## Researcher brief — deliverable

One Pine Script v6 (v5 acceptable) `strategy()` file in
`research/vwap-mr-indices/`, plus a one-page user runbook (chart setup +
results-recording template). No Python work, no data pulls.

### The strategy must encode the fixed design exactly

1. **RTH-anchored session VWAP.** Reset at the 09:30 America/New_York cash
   open; accumulate `hlc3 × volume` over **RTH bars only** (session filter via
   `time(timeframe.period, "0930-1600", "America/New_York")`). Do **not** use
   built-in `ta.vwap` unless its anchor is demonstrably this session boundary
   on the futures symbols — CME symbols trade near-24h on TradingView and a
   default anchor will silently include Globex volume. Compute σ as the
   **volume-weighted** stdev over the same accumulation.
2. **Trigger:** price stretches beyond VWAP ± k·σ (k an input, default 2.0)
   and the bar **closes back inside the band** → enter toward VWAP on the next
   bar. Long and short symmetric. Entries only during RTH, and no new entries
   in the last 30 minutes of the session.
3. **Exits:** target = current session VWAP (a moving target — implement as a
   limit order refreshed per bar, and state in the runbook that this is
   intentional); stop beyond the stretch extreme; unconditional **session-end
   flat** (close all at 15:55 ET; no overnight holds).
4. **Risk rules in the script, not in the user's head:** position size =
   1% of `strategy.equity` / stop distance (whole contracts, `math.floor`,
   minimum 1 only if the 1% cap allows it — otherwise skip the trade); a
   **2%-of-session-day circuit breaker** that blocks new entries once realized
   + open PnL from the day's starting equity breaches −2%.

### Pine correctness traps (named checks, per our convention)

* Decisions on **confirmed bars only** (`barstate.isconfirmed` / default
  close-based execution); no `calc_on_every_tick`, no `request.security` with
  lookahead. Signal on close, fill next bar open — same convention as all our
  research.
* **Override strategy defaults:** TradingView's default sizing is
  percent-of-equity notional — replace with the risk-based sizing above. Set
  `commission` per contract (runbook gives current CME retail figures per
  symbol) and `slippage` ≥ 1 tick. Defaults are zero-cost and will flatter
  everything.
* Session strings and half-days: use the exchange timezone by name
  (`America/New_York`), never a UTC offset; note in the runbook that early-close
  holidays will leak a few 13:00-close sessions past the 15:55 flat — acceptable
  for a hand-test, listed as a known imprecision.
* Intrabar stop-vs-target ambiguity: TradingView decides intrabar order using
  its own tick assumption. State this in the runbook; our engine's
  stop-before-target conservatism cannot be reproduced, which biases
  TradingView results **optimistic**.

### The runbook must pin the chart setup (or results are uninterpretable)

* Symbols: **ES1!, NQ1!, YM1!** — with chart settings set to **back-adjusted**
  continuous contracts (the roll-boundary trap from `ARCHITECT-NOTE.md` §3
  lives in a TradingView chart setting now; screenshot-level instructions).
* Timeframe: **5m** primary (fine enough for a real session VWAP, coarse enough
  for deep history on the user's plan); record the exact date range TradingView
  actually provides per symbol — it varies by plan and must be reported, since
  the window will differ across ES/NQ/YM.
* **Inputs frozen before running:** k = 2.0, stop at the stretch extreme,
  session 0930–1600, flat 15:55. One pre-registered sensitivity set only
  (k ∈ {1.5, 2.0, 2.5}) — run all three per symbol, report all nine cells,
  **no other knob-turning**. Anything beyond that is a new design pass, not a
  result.
* Results template per cell: net PF, trade count, win rate (reported, not
  gated), max drawdown, date range, commission/slippage settings used. Pooled
  reading first; the **300-trade pooled minimum** before anyone reads PF still
  applies — at ~roughly 1–3 setups/week/symbol on 5m this is reachable on a
  multi-year window, and if it isn't, that is itself the frequency-floor
  verdict.

### Evaluation rule (pre-committed now, before any run)

Promote to a stage-0 data-spend conversation only if, on the frozen inputs:
pooled net PF > 1.1 across ≥300 pooled trades **and** no single symbol below
0.9. Otherwise the idea returns to the backlog with the TradingView cells
attached. (PF > 1.1 rather than 1.2 because this gate is only buying a data
purchase, not an implementation — the full revised target set still governs any
real backtest later.)

## Standing items (unchanged, for the record)

The maker-fee/funding execution-model question on crypto `momentum_breakout`
and the "buy index data once for both VWAP and momentum-on-ES/NQ" coherence
rule both remain open at the decision gate — deferred, not resolved, by this
path change.
