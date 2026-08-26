# Research package — intraday mean-reversion vs SMC vs hybrid (BTC / ETH / SOL perps)

**Role:** Researcher · **Hand-off to:** Architect (`agents/roles/architect.md`)
**Scope:** exploratory feasibility only — not a formal backtest, not an implementation.

---

## 1. The three ideas, in my own words

**Candidate 1 — pure mean reversion.** Claim: on an intraday horizon, crypto
price spends most of its time oscillating around a short-run "fair" level, and a
sharp push away from that level is more often noise (a liquidation cascade, a
thin-book spike, a news flinch) than the start of a real move. So when price
stretches ≥ 2 standard deviations from its 50-bar mean *and then stops
stretching* — the bar closes back inside the band — you fade it, targeting the
mean, with an ATR-based stop beyond the extreme. The edge being claimed is
**overreaction**: the marginal seller who pushed price to −2σ was liquidity-
demanding, not informed.

**Candidate 2 — pure Smart Money Concepts.** Claim: price is not a random walk
but a sequence of engineered moves — large participants push through an obvious
swing level to trigger resting stops (a *liquidity sweep*), then reverse; a
close beyond a prior swing marks a *break of structure* (BOS) that reveals
direction, and the first break against the prevailing direction is a *change of
character* (CHoCH). The candle that launched the impulse (the *order block*) and
the price gap the impulse left behind (the *fair value gap*) are treated as
zones price returns to before continuing. So: read structure, wait for the
retrace into the OB/FVG, enter with structure, stop beyond the zone, target a
fixed multiple of that risk. The edge claimed is **inventory/positioning
footprint** — that the zones mark where a large participant still wants fills.

**Candidate 3 — hybrid (SMC filter, MR trigger).** Claim: candidate 1's problem
is that it fades genuine trends, and candidate 2's problem is that "structure"
alone is too permissive. So use SMC only as a *veto and a confirmation*, never as
the trigger: (a) higher-timeframe structural bias must not oppose the trade
(regime filter), (b) a liquidity sweep must have occurred in the trade's
direction within the last few bars — i.e. the overextension actually ran stops
and failed, which is the exhaustion evidence pure MR lacks — and only then (c)
take the mean-reversion z-score turn as the entry, with the stop placed beyond
the swept extreme rather than at an arbitrary ATR distance.

---

## 2. What was tested

* **Data:** Binance USD-M perpetual futures klines, `2022-08-01 → 2026-07-31`
  (**48 months**), BTCUSDT / ETHUSDT / SOLUSDT, at 5m / 15m / 1h. Public
  `data.binance.vision` bulk archive — no credentials needed, nothing synthetic.
  Bar counts are complete (420,768 / 140,256 / 35,064 per symbol per interval).
* **Regime coverage:** the window deliberately spans the 2022 H2 bear/chop, the
  2023 range, the 2024 bull impulse, and the 2025–26 stretch. Section 6 also
  splits every result into `trend` vs `chop` days using a 30-day efficiency
  ratio, and section 7 splits it into four consecutive 12-month blocks.
* **Risk rules are in the engine, not the report:** 1% equity risk per trade
  sized off the stop distance, and a hard 2%-of-day circuit-breaker that halts
  new entries for the rest of the UTC day (checked bar-by-bar against realised +
  open PnL). Fees 5 bp/side, next-bar-open fills, stop-before-target on
  ambiguous bars.
* Same rule-set applied **independently per asset** — no cross-asset netting.

---

## 3. Headline comparison table (default parameters, 48 months, net of costs)

| candidate | int | symbol | trades | win rate | PF | Sharpe | Sortino | maxDD | Calmar | exp (R) |
|---|---|---|---|---|---|---|---|---|---|---|
| mean_reversion | 5m | BTC | 2358 | 41.3% | 0.56 | -9.04 | -12.72 | 100.0% | -0.90 | -0.385 |
| mean_reversion | 5m | ETH | 2975 | 45.2% | 0.54 | -7.93 | -12.25 | 100.0% | -0.88 | -0.285 |
| mean_reversion | 5m | SOL | 4916 | 45.7% | 0.73 | -5.99 | -12.82 | 100.0% | -0.87 | -0.164 |
| mean_reversion | 15m | BTC | 2360 | 45.8% | 0.62 | -4.64 | -6.73 | 98.9% | -0.68 | -0.185 |
| mean_reversion | 15m | ETH | 2548 | 48.0% | 0.68 | -3.35 | -5.26 | 96.5% | -0.59 | -0.127 |
| mean_reversion | 15m | SOL | 2680 | 46.0% | 0.74 | -3.24 | -5.18 | 96.3% | -0.58 | -0.118 |
| mean_reversion | 1h | BTC | 708 | 46.5% | 0.80 | -1.25 | -1.48 | 55.5% | -0.30 | -0.097 |
| mean_reversion | 1h | ETH | 716 | 48.0% | 0.86 | -0.75 | -0.91 | 48.5% | -0.22 | -0.058 |
| mean_reversion | 1h | SOL | 767 | 43.5% | 0.77 | -1.72 | -2.23 | 68.4% | -0.32 | -0.124 |
| smc | 5m | BTC | 1916 | 32.8% | 0.54 | -8.84 | -18.66 | 100.0% | -0.90 | -0.472 |
| smc | 5m | ETH | 2142 | 33.0% | 0.66 | -7.88 | -19.63 | 100.0% | -0.90 | -0.421 |
| smc | 5m | SOL | 2752 | 34.5% | 0.63 | -7.64 | -21.09 | 100.0% | -0.90 | -0.328 |
| smc | 15m | BTC | 2309 | 33.3% | 0.67 | -7.17 | -15.48 | 100.0% | -0.90 | -0.390 |
| smc | 15m | ETH | 2930 | 34.4% | 0.70 | -6.19 | -16.22 | 100.0% | -0.90 | -0.305 |
| smc | 15m | SOL | 4264 | 35.1% | 0.74 | -5.17 | -15.81 | 100.0% | -0.90 | -0.207 |
| smc | 1h | BTC | 2408 | 37.7% | 0.71 | -2.15 | -3.96 | 96.3% | -0.58 | -0.126 |
| smc | 1h | ETH | 2387 | 38.0% | 0.81 | -1.39 | -2.72 | 89.8% | -0.47 | -0.082 |
| smc | 1h | SOL | 2415 | 38.6% | 0.91 | -1.02 | -2.00 | 83.2% | -0.39 | -0.057 |
| hybrid | 5m | BTC | 520 | 46.5% | 0.33 | -4.22 | -3.44 | 83.8% | -0.43 | -0.344 |
| hybrid | 5m | ETH | 598 | 50.2% | 0.42 | -3.94 | -3.84 | 82.9% | -0.43 | -0.289 |
| hybrid | 5m | SOL | 480 | 52.5% | 0.61 | -2.21 | -2.38 | 58.9% | -0.33 | -0.178 |
| hybrid | 15m | BTC | 213 | 54.9% | 0.58 | -1.54 | -0.90 | 35.5% | -0.24 | -0.168 |
| hybrid | 15m | ETH | 216 | 51.4% | 0.59 | -1.63 | -1.25 | 35.7% | -0.27 | -0.184 |
| hybrid | 15m | SOL | 230 | 50.9% | 0.65 | -1.42 | -0.99 | 34.0% | -0.27 | -0.161 |
| hybrid | 1h | BTC | 63 | 58.7% | 1.01 | 0.04 | 0.01 | 8.9% | 0.01 | +0.008 |
| hybrid | 1h | ETH | 64 | 59.4% | 0.87 | -0.20 | -0.06 | 6.1% | -0.11 | -0.038 |
| hybrid | 1h | SOL | 65 | 52.3% | 0.82 | -0.36 | -0.17 | 10.4% | -0.14 | -0.083 |

**Targets were PF > 1.2 and win rate > 50%. Zero of the 27 combinations meet
both. One combination (hybrid 1h BTC, PF 1.01) is not distinguishable from
break-even.** Calmar is negative wherever equity ended lower than it started,
which is everywhere except that one cell.

Reading the table:

* **Interval is the clearest signal in the whole study.** For all three
  candidates, performance improves monotonically 5m → 15m → 1h. At 5m every
  candidate destroys the account (100% drawdown for MR and SMC). This is a cost
  story: gross edge per trade is small and roughly interval-independent, while
  10 bp round-trip is charged per trade regardless. **If any of this is pursued,
  1h is the only interval worth carrying forward**, and 5m should be dropped
  outright.
* **Mean reversion** loses at every interval. Its win rate never reaches 50%
  even though its target (the mean) is closer than its stop — fading a −2σ
  stretch in crypto gets run over often enough to eat the favourable geometry.
* **SMC** has the worst win rate by construction (33–39% against a 2R target,
  which needs 33% just to break even) and never clears it net of costs.
* **Hybrid** is the best of the three on every risk-adjusted measure: highest
  win rate (51–59%), by far the smallest drawdowns (6–10% at 1h vs 48–96%), and
  the only non-negative Calmar. But it trades only ~16 times per symbol per year
  at 1h, and its PF still sits at 0.82–1.01.

## 4. The decisive diagnostic: this is an absent edge, not a cost problem

Rerunning the whole sweep with **fees and slippage set to zero**
(`results/summary_nofee.csv`):

| candidate | 1h PF, BTC / ETH / SOL (gross) |
|---|---|
| mean_reversion | 0.93 / 0.97 / 0.83 |
| smc | 1.01 / 0.98 / 0.98 |
| hybrid | 1.27 / 1.06 / 0.90 |

Even with **all trading costs removed**, none of the rule-sets has a profit
factor meaningfully above 1.0. That matters more than any single number in the
table: the problem is not that the edge is being eaten by fees, it is that there
is no edge to eat. Exit tuning, better fills, or a maker-rebate execution model
can only redistribute an edge that already exists.

`edge_probe.py` confirms this at the signal level, sidestepping stop/target
choices entirely: it measures direction-adjusted forward returns over 3–48 bar
horizons on non-overlapping triggers.

| candidate × interval | obs | mean fwd return | median t-stat | cells with t > 2 |
|---|---|---|---|---|
| mean_reversion 15m | 27,066 | −2.4 bp | −0.72 | 0% |
| mean_reversion 1h | 8,371 | −9.4 bp | −0.87 | 0% |
| smc 15m | 125,833 | −0.9 bp | −0.78 | 0% |
| smc 1h | 46,045 | −0.03 bp | +0.22 | 0% |
| hybrid 15m | 2,595 | −1.7 bp | −0.13 | 0% |
| hybrid 1h | 784 | **+16.6 bp** | +0.81 | 8% |

Only hybrid-1h shows a positive conditional mean, and it is the one cell with
almost no observations. A median t of 0.81 and one t > 2 out of twelve cells is
what you would expect from chance.

## 5. Parameter sensitivity — is there a better neighbourhood?

192 configurations were scanned per-candidate and aggregated across all three
symbols (so no single lucky symbol can carry a setting), net of costs:

| candidate | configs | configs with PF > 1.0 | configs meeting **both** targets | best PF | best interval |
|---|---|---|---|---|---|
| mean_reversion | 72 | 0 | 0 | 0.87 | 1h |
| smc | 48 | 2 | 0 | 1.01 | 1h |
| hybrid | 72 | 3 | 0 | 1.10 | 1h |

**Zero of 192 configurations meet PF > 1.2 and win rate > 50% together.** The
best cell anywhere is hybrid at 1h (`mr_z=2.0, tp_frac=1.0, stop_atr=3.0,
sweep_lookback=6`) with PF 1.10, win rate 68%, Calmar 0.07 — on 184 trades over
four years across three assets. That is roughly 15 trades per symbol per year;
at 1% risk per trade the strategy would move the account by a couple of percent
a year in either direction. It is not a tradable business even if the 1.10 were
real.

Every candidate's surface is under water almost everywhere. That is the useful
part: the negative result is not a knife-edge parameter choice.

## 6. Regime split (`results/regimes_main.csv`)

Every day is tagged `trend` or `chop` by a 30-day efficiency ratio on daily
closes, split at the median. The result is uncomfortable for all three ideas:
**each candidate loses money in both regimes**, at every interval, on all three
symbols. Mean reversion does not rescue itself in chop (PF 0.58–0.96 there);
SMC does not rescue itself in trend (PF 0.36–0.98). The one nominally positive
cell in the whole regime table is hybrid / 1h / ETH / chop (PF 1.43, 34 trades) —
sample size makes that noise.

This kills the most obvious repair, "run MR in chop and SMC in trend with a
regime switch": neither leg is profitable in its supposedly favourable regime.

## 7. Stability across time (`results/stability.csv`)

Best configuration per candidate, rerun over four consecutive 12-month blocks ×
three symbols (12 cells each):

| candidate | cells with PF > 1 | cells with PF > 1.2 | median PF |
|---|---|---|---|
| mean_reversion | 25% | 0% | 0.91 |
| smc | 42% | 0% | 0.98 |
| hybrid | 50% | 42% | 1.00 |

Hybrid's positive blocks are not the same blocks across symbols — BTC's good
year is 2024-07→2025-07, ETH's is 2023-08→2024-07, SOL's is 2023-08→2024-07 and
then fades. A median PF of exactly 1.00 over 12 independent cells is the
signature of a coin flip, not an edge.

## 8. Verdict and what I would carry forward

**None of the three candidates is fit to route to Implementation as-is.** The
requested targets (PF > 1.2, win rate > 50%) were not met by any candidate at
any interval on any of the three assets, and the zero-cost diagnostic says
that is a property of the signals, not of the execution assumptions.

Ranking, for whatever the Architect decides next:

1. **Hybrid — the only one worth further work.** It is the only candidate whose
   filters visibly *do something*: they cut trade count by ~90% versus pure MR,
   raise win rate from ~46% to ~55–68%, and shrink max drawdown from ~50–100%
   to 6–10%. The SMC-sweep gate is behaving exactly as the idea claimed — it is
   selecting a materially better subset. The problem is the subset is still not
   profitable and is now far too small to measure.
2. **SMC — sits at exactly break-even gross, loses by the fee.** Its 1h numbers
   at zero cost (PF 0.98–1.01) over 2,400+ trades per symbol are a large,
   well-measured *nothing*. That is an informative nothing: as implemented,
   order-block/FVG retracement entries have no directional content.
3. **Mean reversion — clearly negative, including gross.** Fading 2σ
   overextensions on crypto perps is not just cost-marginal, it is the wrong
   sign at 1h. If anything, this hints that short-horizon crypto returns are
   mildly *momentum*-like at these thresholds, which is worth a separate probe.

### If the Architect wants to continue, the highest-value next steps

* **Invert the question.** `edge_probe.py` makes the MR trigger's forward return
  *negative* at 1h. Probing the momentum side of the same trigger (continuation
  after a 2σ push rather than reversion) costs almost nothing — the harness
  already exists — and the sign of the existing evidence points that way.
* **Push the hybrid's filter harder, not its exits.** The filter selects a
  better subset; the question is whether a stricter version (sweep + FVG
  mitigation + HTF CHoCH, all three) concentrates it further. Accept up front
  that this drives trade count toward statistical uselessness — set a minimum
  sample size (say 300 trades pooled) *before* looking at results.
* **Add the missing cost term.** Funding is not modelled here. For a
  hold-time of a few hours it is second-order, but any candidate that starts
  holding overnight needs it.
* **Do not tune 5m further.** The interval sweep is unambiguous.

### If it is implemented anyway — guidelines

* 1h bars only; 5m is not viable at retail taker fees.
* Signal on bar close, execute at next bar open. Never assume the close fill.
* Position size = `0.01 × equity / |entry − stop|`, notional capped at 10×.
  Round to the venue's `stepSize` and enforce `minNotional`.
* Daily circuit breaker evaluated on *realised + open* PnL against the day's
  opening equity, on every bar, in UTC. Halt new entries, keep managing open
  ones. (Reference implementation: `backtest.py:run`.)
* SMC state (`indicators.py:structure`) is a bar-by-bar state machine with
  mutable order-block / FVG / swing state. In a live pipeline it must be
  persisted and replayed from a fixed warm-up point, not recomputed from an
  arbitrary window, or the structure bias will differ between runs.
* Fractal swing detection is only confirmed `k` bars later. Any live version
  must reproduce that lag; the natural bug is to use the un-lagged swing and
  silently look ahead.

---

## 9. Pros, cons, and what made me doubt each idea

**Mean reversion**
*Pros:* trivially cheap to compute; symmetric long/short; high trade count makes
results statistically meaningful; stop and target both fall out of the same
statistic.
*Cons:* structurally short volatility — it is systematically on the wrong side
of every real move; win rate never reached 50% despite a closer target than
stop; 100% drawdown at 5m.
*Doubt:* the premise assumes a stationary "fair value" on an intraday horizon.
Perp funding and liquidation mechanics make crypto stretches self-reinforcing
rather than self-correcting, which is exactly what the negative forward returns
show.

**SMC**
*Pros:* the primitives (BOS/CHoCH/OB/FVG/sweep) are mechanically well-defined
and *were* implementable without discretion; naturally gives a structural stop;
huge sample size.
*Cons:* zero measured directional content; the 2R target needs 33% win rate and
delivers 33–39%, i.e. it sits on the break-even line by construction rather than
by edge.
*Doubt:* this is the honest caveat of the whole package. SMC as practised is
partly discretionary — which order block, which sweep "counts", where exactly
the zone ends. My encoding picks one defensible reading (last opposite candle
before the BOS impulse, unmitigated FVG, close-based BOS). A different but
equally defensible encoding could give different numbers, and I cannot rule out
that a skilled discretionary reading has an edge my rules do not capture.
**What I can say is that the mechanical version of it has none**, and only a
mechanical version can be automated, which is what this project is for.

**Hybrid**
*Pros:* the filters demonstrably improve every quality metric (win rate,
drawdown, expectancy) over pure MR — the idea's core claim, that SMC context
tells you *which* overextensions to fade, is directionally supported.
*Cons:* the improvement is not enough to cross break-even; the filter is so
selective that the surviving sample (63–65 trades per symbol over four years at
1h) cannot support a confident conclusion in either direction; returns at 1%
risk would be negligible even if PF 1.10 were real.
*Doubt:* this is the candidate most exposed to overfitting, because it has the
most gates and the fewest trades. I resisted tuning it into profitability, and
I would treat any future version that "works" with ~200 trades as unproven.

**Cross-cutting doubts**
* **Overfitting.** 192 configurations were scanned; had any cleared the targets
  I would still have discounted it heavily. The reason I trust the *negative*
  result is that it is uniform across candidates, intervals, symbols, regimes,
  and time blocks — a negative that survives that many cuts is not a tuning
  artefact.
* **Data quality.** Binance archives are clean and complete for this window, but
  they are one venue. Wick prints during 2022–23 liquidation cascades can be
  venue-specific, and stop-based exits are exactly what wicks affect. Since
  stops-first is assumed on ambiguous bars, the results are conservative here.
* **Not modelled:** funding, order-book depth, partial fills, exchange outages,
  and the survivorship-flavoured fact that BTC/ETH/SOL are three assets that
  *did* survive and grow over this window.
* **Single venue, single quote asset.** All three symbols are USDT perps on one
  exchange; their microstructure is correlated, so "three assets" is less
  independent evidence than it looks.
