# Design: derivatives-positioning signals (OI / taker flow / long-short ratios)

**Role:** Architect · **Status:** design only — no code, no data, no results exist yet.
**Hand-off to:** Researcher (`agents/roles/researcher.md`).
**Source of the idea:** `IDEAS-BACKLOG.md` "Derivatives-positioning data",
prioritized by the user 2026-08-26.
**Prerequisite reading:** `research/intraday-mr-smc/ARCHITECT-NOTE.md` §2.1 (the
mechanism diagnosis this idea is built on), `research/intraday-mr-smc-v2/REPORT.md`
§2.3 + §4.2 (`momentum_breakout` — the strategy hypothesis (a) conditions),
`research/intraday-mtf-smc/REPORT.md` and `research/pivot-structure/REPORT.md`
(the staged probe/control/kill discipline this design reuses, and the harness
patterns to copy).

---

## 0. The idea and its honest frame

Every candidate so far consumed only OHLCV. Binance's free bulk archive
(`data.binance.vision`, `futures/um/.../metrics/`) also publishes, at 5m
granularity per symbol: **open interest** (contracts and notional), **top-trader
long/short ratios** (by accounts and by positions), the **global long/short
account ratio**, and the **taker buy/sell volume ratio**. These are the
quantity-side measurement of the mechanism the project's one confirmed diagnosis
rests on: crowded leveraged positioning is the fuel of the self-reinforcing
moves that killed reversion and power the small continuation edge.

Three pre-registered hypotheses, in two architectural classes:

* **(a) OI-confirmed continuation — a conditioning study, not a new strategy.**
  A price move on *rising* OI is new positioning entering (continuation-
  favorable); the same move on *falling* OI is covering/liquidation exhaust.
  Test: does ΔOI at trigger time separate `momentum_breakout`'s good trades
  from its bad ones? This is a **filter**, so the can-only-subtract rule
  governs it: the pre-registered question is *"does the conditioned subset beat
  the unconditioned strategy net of the trades it gives up"*, never "can we
  find a positive subset".
* **(b1) Crowding-squeeze entry — a standalone event.** Extreme one-sided
  positioning plus an adverse price break = the start of a squeeze; enter
  *with* the squeeze (against the crowd). Continuation-shaped, which is the
  only family with a positive sign in four packages.
* **(b2) Taker-imbalance continuation — a standalone event.** Extreme taker
  buy pressure plus an up bar = aggressive flow initiating; probe continuation.
  This is the weakest of the three a priori (taker imbalance is the most
  price-correlated of the sensors) and exists mostly to feed §5.3's
  redundancy control.

**The one question that matters more than any single result:** does positioning
data add anything **beyond what price already says**? OI, ratios, and taker flow
are all correlated with recent returns. A "signal" that is trailing return in
disguise is not a second signal. §5.3's redundancy control is therefore
mandatory for every hypothesis, not an optional diagnostic.

Prior probability, stated for the record: (a) ~25–30% of showing a real
conditional split (mechanism-adjacent, cheap, but filters have a bad record
here); (b1) ~15–20% of clearing stage 1; (b2) ~10%. Worth one disciplined pass,
jointly, on one data pull.

---

## 1. Data (stage 0 is a real stage, not a formality)

* **Klines:** already on disk — reuse the `intraday-mtf-smc` 5m pull (8 perps,
  2022-08-01 → 2026-07-31), 1h derived by resample via the existing helpers.
* **Metrics:** fresh pull, `data.binance.vision` `futures/um/monthly/metrics/
  <SYMBOL>/` (fall back to daily files where a month is missing), all 8
  symbols, full window. No credentials. Columns of record (verify exact names
  against the files, do not assume): `create_time`, `sum_open_interest`,
  `sum_open_interest_value`, `sum_toptrader_long_short_ratio` (positions),
  `count_toptrader_long_short_ratio` (accounts), `count_long_short_ratio`
  (global accounts), `sum_taker_long_short_vol_ratio`.

### Stage 0 — data audit (gate to everything; report before designing around gaps)

This dataset is known to have holes. Pre-committed handling:

1. Per symbol: coverage start, coverage end, and a gap map (count and total
   duration of missing 5m rows) over the full window, fit and holdout
   separately. Deliver as `results/data_audit.csv` plus a short §1 in the
   report.
2. **Gap rule (fixed now):** forward-fill single missing rows (≤ 5 min);
   any longer gap marks the affected 1h bars **unusable** — no signal may be
   generated on an unusable bar, and probes exclude them. No interpolation.
3. **Symbol rule (fixed now):** a symbol with > 10% unusable 1h bars in the
   fit window is dropped from that hypothesis's pooled statistics (reported,
   not silently excluded). If more than 3 of 8 symbols drop, stop and escalate
   to Architect before proceeding — the study design assumed breadth.
4. **Alignment rule (fixed now):** a metrics row is usable on the first 1h
   decision bar whose *close* is ≥ `create_time + 5 min` — one full metrics
   period of lag, mirroring the one-completed-bar discipline used for HTF
   merges. All derived series (ΔOI, percentiles) are computed on the lagged
   series. Prefix-stability check per `intraday-mtf-smc/checks.py` applies.

## 2. Derived series (all on 1h decision bars, all causal)

* `dOI_4h` — percent change of `sum_open_interest` over the trailing 4 hours
  (primary); `dOI_1h` as the pre-registered secondary. Normalized as percent of
  current OI, then converted to a **rolling 30-day percentile** per symbol
  (levels and raw deltas are non-stationary across the window; percentiles are
  comparable).
* `crowd` — rolling 30-day percentile of `sum_toptrader_long_short_ratio`
  (positions; the top-trader *position* ratio is the most
  leverage-liquidation-relevant of the three ratios — the other two are
  recorded as diagnostics, not swept).
* `taker` — rolling 30-day percentile of `sum_taker_long_short_vol_ratio`.
* All percentile windows: 30 days (720 1h bars), `min_periods` = 15 days;
  bars before that are unusable. **No window sweep.**

## 3. Hypothesis (a) — OI-conditioned `momentum_breakout`

* Base strategy: `momentum_breakout` exactly as v2 defaults (z = 2.0,
  stop 1.5 × ATR, RR 1.5, time stop 24 × 1h; `strategies_v2.py`) — the one
  configuration with stable out-of-sample behaviour. **Nothing about the base
  strategy may be re-tuned in this pass.**
* Conditioning variable at each trigger: `dOI_4h` percentile, split into
  pre-registered terciles (≤ 33 / middle / ≥ 67).
* **Stage-1 test (fit window, pooled, usable bars only):** difference in mean
  direction-adjusted forward return between top and bottom ΔOI terciles of
  triggers, at the probe horizons. Pass = top-minus-bottom positive with
  **t > 2 at ≥ 2 adjacent horizons** (Welch t on the two samples). Report all
  horizons 3–48 bars.
* **Stage-3 economics (only if stage 1 + controls pass):** run
  `momentum_breakout` restricted to top-tercile-ΔOI triggers vs unrestricted,
  same engine, fit window. The conditioned version must beat the unconditioned
  one on **net expectancy per trade AND total net PnL** (not PnL per trade
  alone — a filter that keeps 1/3 of trades must overcome its own frequency
  loss), with ≥ 300 conditioned trades pooled. Holdout read once.

## 4. Hypotheses (b1)/(b2) — standalone entry events

### b1 — crowding squeeze

Short side (crowd is long; long side is the exact mirror):

* `crowd ≥ 95` (30-day percentile) on the last usable bar, **and** this 1h bar
  closes below the lowest low of the prior 12 1h bars (the adverse break that
  starts marking crowded longs underwater).
* `sig = −1` on close, fill next 1h open.
* Stop: above the highest high of the prior 12 bars + 0.25 × ATR (the level
  whose reclaim refutes the squeeze). Target: 3R fixed. Time stop 48 × 1h.
  One position per symbol; opposite-signal exit not needed (events are rare).

### b2 — taker-imbalance continuation

Long side (mirror for shorts): `taker ≥ 95` **and** the bar closes up with
close > prior bar's high. Same exit frame as b1 (stop below 12-bar low +
0.25 × ATR buffer, 3R, 48-bar time stop).

* **Stage-1 probe (both):** event-level direction-adjusted forward returns,
  non-overlapping events (drop an event if within 12 bars of the prior one,
  keep the first), horizons 3–48 h. Pass = pooled mean positive, **t > 2 at
  ≥ 2 adjacent horizons**, **≥ 400 events** pooled in fit. Frequency floor:
  if either event fires < 400 times pooled in fit, that hypothesis is
  reported "unmeasurable at the pre-committed definition" and stops — the
  95th-percentile threshold is **not** loosened to manufacture sample.
* Thresholds (95, 12-bar break window, 30-day percentile window) are **fixed,
  not swept**. The only pre-registered secondary: `crowd ≥ 90` recorded as a
  sensitivity row, reported alongside, never promoted on its own.

## 5. Controls (stage 2 — gate to believing any stage-1 pass)

1. **Random-subset null for (a):** 200 draws of random trigger subsets of the
   same size as the top tercile; the real tercile split must beat the 90th
   percentile of the null on the stage-1 statistic.
2. **Random-event null for (b1)/(b2):** 200 draws of same-count random bar
   sets per symbol (restricted to usable bars); real events must beat the 90th
   percentile on pooled expectancy at the passing horizons.
3. **Redundancy control (mandatory for all three):** rerun the identical test
   with the positioning variable replaced by its **price-derived shadow** —
   for (a), trailing 4h return percentile instead of ΔOI percentile; for (b1),
   trailing 24h return percentile (crowding proxy) instead of `crowd`; for
   (b2), same-bar volume percentile instead of `taker`. A hypothesis whose
   positioning version does not visibly beat its price-shadow version (same
   sign, larger magnitude, and the shadow fails where the real one passes) is
   reported as **"price in disguise — no second signal"**, whatever its
   stage-1 t-stat. This is the design's central question (§0) given teeth.
4. **Harness validation both ways** (standard): reproduce the
   `momentum_breakout` positive and the single-TF `smc` zero on the same code
   path.

## 6. Engine, risk, windows, bar

* Engine: reuse `backtest.py:run` unchanged (no flip exits needed here). Risk
  rules unchanged: 1%/trade, 2%-of-day breaker; report breaker-bind frequency,
  skipped signals, hold times, cost_R off realised stops, long/short split
  (drift lesson), realised R distribution — the standard diagnostic block.
* Windows: **fit** 2022-08-01 → 2025-04-01, **holdout** 2025-04-01 →
  2026-08-01 (adjusted per-symbol to metrics coverage from stage 0; state the
  effective windows in the report). Fit-only until survivors; holdout read
  once.
* **Stage-3 bar (standalone b1/b2):** ≥ 300 trades pooled, gross expectancy
  ≥ 3 × median cost_R, net PF ≥ 1.1 fit, gross PF > 1.0 on ≥ 5 of the usable
  symbols, holdout net PF ≥ 1.0 with decay ≤ 0.15. For (a), the §3 comparative
  bar replaces the absolute PF bar (the base strategy's absolute economics are
  a settled fact from v2 — this pass judges only the *increment*).
* Funding still unmodelled; with 48-bar time stops, median holds may exceed
  8h — report holds, and flag funding as a promotion blocker if they do.
* **Kill rule:** a hypothesis that fails stage 1, its permutation null, or the
  redundancy control is dead — no tuning, no threshold search. If all three
  die, the deliverable is the measured statement that Binance's public
  positioning data adds no signal beyond price at 1h — which, given how much
  of crypto-trading folklore leans on these feeds, is a finding worth having.

## 7. Deliverable and routing

Research package in `research/deriv-positioning/` (REPORT.md in the
`intraday-mtf-smc` format, code, `results/`, HANDOFF.md to Architect;
raw metrics data gitignored like prior packages' data dirs). Report the stage
reached per hypothesis and the §6 gate outcome. Escalate to Architect (via
ask) on: stage-0 symbol-drop > 3, any protocol ambiguity, or any deviation
from pre-registered definitions. Backtesting role engages only if something
clears stage 3 on the holdout. If (a) passes in full, the natural next hop is
folding OI-conditioning into the standalone-momentum design pass already
sitting in the backlog — flag it, don't do it.
