# Smart Money Concepts (SMC) — order block, FVG, CHoCH/BoS, sweep

Canonical definitions and verdict history for SMC-family concepts in this
project. **Status: closed as an entry-trigger mechanism** — three separate
encodings tested across three research packages, all killed. Kept here so a
future idea doesn't silently re-invent one of these and re-pay the cost of
finding out it doesn't work; a genuinely different encoding is still fair
game, but read §3 first to make sure it actually differs.

## 0. Relationship to session-liquidity

`knowledge/session-liquidity.md` reuses two SMC-family primitives (FVG,
pivot/fractal) but as a **different mechanism family** — session/liquidity
sweep-based, not the general-purpose bias/structure engine this file
describes. Don't conflate the two: session-liquidity's iFVG and pivot use are
not another attempt at what's described below, and aren't covered by §3's
closure.

## 1. Core concepts and mechanical definitions

Source: `research/intraday-mr-smc/indicators.py`, function `structure()`
(built on `fractals()`). All of the below share one causal pivot primitive —
`fractals(df, k)`: a bar is a swing high/low if its high/low is the extreme
of a centered `2k+1`-bar window (k bars either side), results `.shift(k)` so
a swing is only known once confirmed (no lookahead). Confirmed equivalent to
TradingView's `ta.pivothigh(high, k, k)` / `ta.pivotlow(low, k, k)` — the
3-argument form; the 2-argument form pivots on `close`, not `high`/`low`, and
does **not** match. Visual proof on real BTC 5m data:
`research/_explainers/fractals-vs-pivots/` (README + 2 charts).

- **Order block (OB):** created only at the moment of a BOS, as "the last
  opposite-colored candle before the impulse leg." On a bullish BOS: walk
  backward from the break bar (capped 30 bars) while candles are bullish/doji;
  the first genuinely bearish candle found becomes the bullish OB
  (`ob_low`/`ob_high` = its low/high). Mirror for bearish. **Invalidated**
  (mitigated) once a close trades back through it (below `ob_low` for
  bullish, above `ob_high` for bearish).
- **FVG (Fair Value Gap):** standard 3-candle imbalance — a gap between
  candle 1 and candle 3 (candle 2's range inside it). Bullish: `low[t] >
  high[t-2]`. Bearish: `high[t] < low[t-2]`.
- **CHoCH (change of character):** a BOS that flips the *prevailing* running
  bias (`b`). A bullish break when bias was ≤0, or a bearish break when bias
  was ≥0. Every CHoCH is a BOS; not every BOS is a CHoCH — a break in the
  same direction as the already-established bias is BOS-only (continuation),
  not a character change.
- **BOS (break of structure):** a close beyond the last confirmed,
  still-unbroken swing high/low. Fires on *every* qualifying break regardless
  of prior bias (the superset CHoCH is drawn from).
- **Sweep / liquidity grab:** price wicks beyond a reference level then
  reverses — the general concept session-liquidity (`knowledge/
  session-liquidity.md`) formalizes for session highs/lows specifically.

## 2. Example trades (visual reference)

10 worked example charts from the original single-timeframe SMC candidate
(1h), win/loss/timeout mixed, not cherry-picked wins:
`research/intraday-mr-smc/viz/trade_01_ETHUSDT_20230621_long_win.png`
through `trade_10_BTCUSDT_20251008_long_timeout.png` (10 files, same
directory). A parallel v2 set exists at
`research/intraday-mr-smc-v2/viz/trade_01_SOLUSDT_20230730_short_win.png`
through `trade_10_LINKUSDT_20250605_short_timeout.png`. Open any of these
directly (they're real chart images, not linkable inline in a way a
text-only reader renders — `Read` the PNG path itself to view it).

## 3. Encodings tested — all closed as entry triggers

| # | Encoding | Package | Verdict |
|---|---|---|---|
| 1 | Single-timeframe: bias + OB/FVG retest | `research/intraday-mr-smc/` (`smc()` in `strategies.py`) | **Statistically reliable zero.** Win rate 33–39% sits exactly on the 2R-target breakeven line — the entry has no directional content, not "unlucky." `RESEARCH-LOG.md` Запись 1. |
| 2 | Multi-timeframe: 1h bias/BOS-freshness context → 5m OB/FVG retest (variant A) or 1h zone → 5m sweep-and-reclaim/CHoCH (variant B) | `research/intraday-mtf-smc/` (`mtf.py`) | All three pre-registered rule sets (A, B-sweep, B-choch) **failed stage-1** signal probe; A and B-choch significantly negative on short horizons. Holdout never read. `RESEARCH-LOG.md` Запись 5. |
| 3 | Two-tier pivot structure: major pivot (k=15) sets bias, minor pivot (k=3-5) CHoCH flips it | `research/pivot-structure/` | All 48 pre-registered cells failed stage-1; the one novel axis (k-scale 2-5) measured and rejected — behaves identically to the old k=2 engine. Permutation control: real flips at the **0th percentile** of random null (worse than random, not neutral). `RESEARCH-LOG.md` Запись 6. |
| 4 | ICT composition from the user's pre-built `cmc-bot`: H1 iFVG direction sets bias, M1 iFVG triggers entry, gated on premium/discount side **and** side of the 07:30-NY "true open", inside a 09:40–11:10 New York window | `research/cmc-bot-smart-money/` — mechanic pinned in `knowledge/smart-money-ict.md` | **Untested.** Routed 2026-09-12 as a **pre-registered** hypothesis test (thresholds fixed in `research/cmc-bot-smart-money/ARCHITECT-NOTE.md` §3.2 before any result), precisely because it contests the standing null of #1–#3 and its parameters were hand-picked on unpublished data. `RESEARCH-LOG.md` Запись 19. |

**Common thread across the first three:** none of the three found a payoff shape
distinguishable from noise once tested rigorously (stage-1 signal probe +
permutation null). `indicators.structure()` (the general bias/BOS/CHoCH
engine) is closed for entry use — reusing its *primitives* (fractals, FVG
geometry) elsewhere is fine; reusing it as *the bias/entry engine itself* is
not, without new evidence.

## 4. One surviving thread from encoding #3

The pivot-structure kill (`RESEARCH-LOG.md` Запись 6) found one coherent
positive-signed cell — but attribution showed the sign belonged to a **bare
confirmed-swing breakout** (K=20, close beyond a ~20-bar-confirmed 1h swing),
not to the two-tier pivot machinery being tested. This is `momentum_breakout`
rediscovered through a different parameterization, not a resurrection of SMC
— folded into the standalone-momentum backlog item (`IDEAS-BACKLOG.md`,
"Momentum (trend-continuation) intraday") as a pre-registered candidate
hypothesis, not evidence.
