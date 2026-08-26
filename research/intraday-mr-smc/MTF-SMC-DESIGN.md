# Design: multi-timeframe SMC (1h context / 5m execution)

**Role:** Architect · **Status:** design only — no code, no data, no results exist yet.
**Hand-off to:** Researcher (`agents/roles/researcher.md`).
**Prerequisite reading for the Researcher:** `REPORT.md` (v1), `ARCHITECT-NOTE.md`
(§2.2, §2.3, §5), `../intraday-mr-smc-v2/REPORT.md` (§1.4 permutation method,
§4.2 fit/holdout protocol), and `RESEARCH-LOG.md` at the repo root.

## 0. What this is and why it exists

The single-timeframe SMC candidate (`strategies.py:smc`, one timeframe for both
structure and entry) is a large, well-measured zero: win rate 33–39% against a
2R target whose break-even is 33.3%, gross PF 0.98–1.01 over 2,400+ trades per
symbol. `ARCHITECT-NOTE.md` §2.2 flagged the *encoding* as the one place a
different design could still change the verdict. This document specifies, at the
user's direction, a multi-timeframe re-encoding: **1h for context, 5m for
execution** — two concrete variants, a comparison, and a pre-committed research
protocol.

Two priors from the existing work constrain everything below, and the designs
must be read against them:

1. **The 5m interval was killed by cost-per-trade × churn, not by the clock.**
   v1's 5m death (100% drawdowns) came from paying ~10 bp round-trip on
   2,000–5,000 trades with ~zero gross edge each. A design that *times* entries
   on 5m but is *gated* to 1h-scale events trades at 1h-scale frequency and does
   not automatically re-run that failure. What it **does** inherit is a subtler
   cost problem: a 5m structural stop is much tighter than a 1h one, and fees
   are charged in basis points of notional, so **cost measured in R rises as
   the stop tightens** (cost_R = round_trip_cost_pct / stop_distance_pct; at
   10 bp round-trip a 1.5% stop costs 0.067 R, a 0.3% stop costs 0.33 R).
   Section 5's success bar prices this explicitly. Any evaluation of these
   designs must report cost in R off the *realised* median stop distance, not
   assume v1's 1h figure.
2. **A pure filter cannot create expectancy** (`ARCHITECT-NOTE.md` §2.3). A
   second timeframe earns its place only if it changes the *trade event* or the
   *payoff geometry* — not if it merely subtracts entries from an edge-less
   trigger. Section 4 judges both variants on exactly this criterion.

---

## 1. Shared infrastructure (both variants)

### 1.1 Data

* Binance USD-M perp klines, **5m interval, all 8 symbols** (BTC/ETH/SOL from
  v1 plus BNB/XRP/DOGE/ADA/LINK from v2), `2022-08-01 → 2026-07-31`, same
  `data.binance.vision` bulk archive. Note v1 pulled 5m only for BTC/ETH/SOL
  and v2 pulled only 1h for the new five — **a fresh 5m pull for 5 symbols is
  required** (~420k bars each; same fetch path as `fetch_data.py` /
  `fetch_crypto_v2.py`).
* 1h bars are **derived by resampling the 5m frame**, not pulled separately
  (see §1.2). This guarantees the two timeframes can never disagree about a
  print.

### 1.2 Timeframe alignment — no lookahead

Reuse the `strategies.py:add_htf_bias()` pattern exactly, generalised from one
column to many. The mechanics, restated so the Researcher implements them
without re-deriving:

* Resample the 5m frame with `htf_mult = 12` (12 × 5m = 60min; `_htf_rule()`
  already computes this from the bar spacing) into 1h OHLCV bars, labelled by
  left edge (pandas default): the bar labelled 13:00 covers 13:00–13:55 and is
  only *known* at 14:00.
* Compute `indicators.structure()` on the resampled 1h frame (`k = 2`
  unchanged), then **`shift(1)`** every derived column before merging — the
  value attached to the 1h bar labelled 13:00 is the state as of the *close of
  the 12:00 bar*, which is fully known during 13:00–13:55.
* `pd.merge_asof(d5[["ts"]], h[...], on="ts", direction="backward")` onto the
  5m frame. Net effect: every 5m bar sees the structure state of the last
  **completed** 1h bar. This is the same one-bar-lag discipline `add_htf_bias()`
  already implements and v1 verified causal.

Concretely: write one helper `add_htf_context(d5, p)` that merges the following
1h columns onto the 5m frame, all shifted as above, prefixed `h1_`:
`bias, bos, choch, swing_high, swing_low, ob_low, ob_high, ob_dir, fvg_low,
fvg_high, fvg_dir, sweep`, plus `h1_atr` (14-period ATR on the 1h frame — needed
for zone buffers so that buffer sizes are 1h-scaled, not 5m-scaled).

The 5m frame separately gets its own `indicators.structure(d5, k=2)` columns
(unprefixed) and its own `atr` — the existing `prepare()` already does this.

### 1.3 Engine, risk rules, execution assumptions

Unchanged from v1, deliberately: **1% equity risk per trade sized off the stop,
2%-of-UTC-day circuit-breaker on realised + open PnL, 5 bp/side taker fees,
signal on 5m bar close → fill at next 5m bar open, stop-before-target on
ambiguous bars.** Reuse `backtest.py:run` (or `engine_v2.py`; on a 24/7 crypto
tape they were verified equivalent to ≤0.01 PF).

Two explicit interactions to flag rather than change:

* **The daily circuit-breaker will bind more often than at 1h.** Entries can
  occur on any 5m bar, so several losses can land inside one UTC day far more
  easily than with ~2 trades/day maximum at 1h. This is the rule working as
  intended, not a conflict — but it shapes results, so the Researcher must
  **report breaker-bind frequency** (days halted / total days, per variant) so
  we can see how much of the PnL profile the breaker is responsible for. No
  change to either risk rule.
* **One position per symbol at a time** (existing engine behaviour): a new
  signal while a position is open is ignored. With 5m signal granularity this
  will drop more signals than at 1h; report the drop rate but do not change it.

### 1.4 Time stops

Both variants hold for 1h-scale moves on 5m bars. Time stop = **144 five-minute
bars (12 hours)**, pre-committed, not scanned. (v1's `time_stop=24` was 24 *1h*
bars = 24h; 12h keeps the trade genuinely intraday and halves overnight funding
exposure, which remains unmodelled — see §5.6.)

---

## 2. VARIANT A — HTF bias + LTF confirmation/entry

**Hypothesis being encoded:** the 1h structure trend has forward directional
content, and a 5m structural pullback-entry is a good *time* to join it. The 1h
answers "which side, if any"; the 5m answers "now". This is
continuation-shaped — the same family as `momentum_breakout`, the only signed
positive in v2 — expressed through SMC primitives instead of a z-score.

### 2.1 The 1h bias (context)

From the merged `h1_` columns (§1.2):

* **Tradable long context:** `h1_bias == +1`.
* **Tradable short context:** `h1_bias == -1`.
* `h1_bias == 0` (undecided) → no entries in either direction.
* **Freshness condition:** at least one 1h `bos` in the bias direction within
  the last **24 completed 1h bars** (implement as a rolling max over the
  shifted `h1_bos` column on the 1h frame before merging: column
  `h1_bos_recent` ∈ {0,1} per direction). A bias established weeks ago with no
  follow-through is stale trend, and without this condition the gate is nearly
  always open in a trending market (v2 §3.3 showed the pinned-bias failure on
  indices from the opposite side).

No new primitive is needed; `structure()` provides everything.

### 2.2 The 5m confirmation + entry (trigger)

Compute `structure(d5, k=2)` on the 5m frame. Entry conditions, long side
(short is the exact mirror):

1. Context: `h1_bias == +1` **and** `h1_bos_recent_up == 1` (§2.1).
2. 5m structure agrees: `d5.bias == +1` (the 5m state machine is itself in
   bullish structure — i.e. the 5m has broken structure upward at some point
   and not flipped since).
3. Retest trigger, identical mechanics to `strategies.py:smc` but on 5m
   columns: this 5m bar trades down into the active 5m bullish order block
   (`ob_dir == 1 and low <= ob_high and close > ob_low`) **or** into the active
   5m bullish FVG (`fvg_dir == 1 and low <= fvg_high and close > fvg_low`).
4. `sig = +1` on this bar's close; fill next 5m bar's open.

This is deliberately `smc()`'s own entry with the timeframe split in two: the
directional layer that was previously the *same-timeframe* `bias` column is
replaced by the 1h bias + freshness, and the retest layer stays on the
execution timeframe. That makes Variant A a clean experiment: if it outperforms
single-TF `smc`, the difference is attributable to the timeframe separation and
nothing else.

### 2.3 Stops and targets

* **Stop (structural, 5m):** `min(ob_low_or_fvg_low, entry_bar.low) −
  0.25 × atr_5m` — same formula as `smc()`, all off 5m levels. This is the
  tight-stop variant; §0's cost_R warning applies and gets measured.
* **Target:** fixed **3R** (pre-committed, not scanned). Rationale: v1 proved a
  2R target off a *1h* stop sits on the break-even knife-edge; here the stop is
  5m-tight, so a 1h-scale move is many R away and 3R is still conservative
  relative to the context's scale. Break-even win rate at 3R = 25%.
* Time stop per §1.4.

### 2.4 Free parameters (all pre-committed, none scanned in the first pass)

`k=2` (both TFs), freshness window 24 × 1h bars, stop buffer 0.25 × atr_5m,
target 3R, time stop 144 × 5m bars. Zero new knobs beyond v1's set. If the
probe (§5.3) passes, a *pre-registered* mini-scan of {target ∈ 2R/3R/4R,
freshness ∈ 12/24/48} is allowed on the fit window only — 9 cells, nothing else.

---

## 3. VARIANT B — HTF zone-of-interest + LTF entry

**Hypothesis being encoded:** specific 1h *locations* (unmitigated order
blocks, unmitigated FVGs, resting liquidity beyond a confirmed 1h swing) are
where reactions happen, and a 5m sweep-failure or structure-shift *inside such
a location* is the reaction starting. The trade event is "price reached a
pre-identified 1h zone and rejected it on 5m" — which is a different event from
anything v1/v2 measured, not a filtered version of one. It also operationalises
`ARCHITECT-NOTE.md` §2.3's "sweep-failure as the trigger" recommendation, with
the 1h zone supplying the *where*.

### 3.1 The 1h zones (context)

Three zone types, all from the merged `h1_` columns; each zone is a price band
`[z_lo, z_hi]` with a direction:

| type | long-side definition (short is mirror) | band |
|---|---|---|
| **OB** | active bullish 1h order block (`h1_ob_dir == +1`) | `[h1_ob_low, h1_ob_high]` |
| **FVG** | active bullish 1h FVG (`h1_fvg_dir == +1`) | `[h1_fvg_low, h1_fvg_high]` |
| **LIQ** | last confirmed, unbroken 1h swing low (`h1_swing_low`) — the resting-liquidity level below which stops cluster | `[h1_swing_low − 0.25 × h1_atr, h1_swing_low + 0.25 × h1_atr]` |

Notes:

* OB and FVG reuse `structure()`'s single-slot state (the *most recent*
  unmitigated zone per direction) — **no new primitive needed** for the first
  pass. A multi-zone inventory (tracking the last N unmitigated OBs/FVGs per
  side instead of one) is a well-defined extension — a new
  `indicators.zones()` that appends on each qualifying event and removes on
  mitigation, returning up to 3 active zones per side — but it is **out of
  scope for the first pass**; run single-slot first, and only build the
  inventory if the probe passes and zone-touch frequency turns out to be the
  binding constraint.
* LIQ is a new but trivial derivation: `h1_swing_low/high` already exist in
  `structure()`'s output; only the ±0.25 × h1_atr banding is new. Note its
  direction convention: a *swing-low* zone is a **long** zone (expected sweep
  of the low, then reclaim), unlike OB/FVG where the direction comes from
  `*_dir`.
* Zone state, like all `h1_` columns, is one-1h-bar lagged (§1.2). A zone
  created by the 1h bar closing at 14:00 is invisible to 5m bars before 14:00.

### 3.2 The 5m entry trigger (timing)

Long side; short is the exact mirror. All 5m columns from `structure(d5, k=2)`.

1. **Touch:** the current 5m bar overlaps an active long zone
   (`low <= z_hi and high >= z_lo`). The touch opens an **entry window of 36
   five-minute bars (3 hours)**; the window closes early if the zone is
   mitigated on the 1h (its `h1_*_dir` drops to 0) or price closes beyond the
   far side of the zone by more than 0.5 × h1_atr (zone failed, stand down).
2. **Trigger, primary encoding — sweep-and-reclaim:** within the window, a 5m
   bar has `d5.sweep == +1` (wick below a confirmed 5m swing low, close back
   above it — `structure()`'s existing sweep definition) **and** that bar's
   close is at or above `z_lo`. Entry `sig = +1` on that close; fill next 5m
   open.
3. **Trigger, secondary encoding — 5m CHoCH:** within the window, a 5m bar has
   `d5.choch == +1` (first upward break against prevailing 5m bearish
   structure). Same fill mechanics. **Primary and secondary are evaluated as
   two separate pre-registered rule-sets, not OR-ed together** — they answer
   "which mechanical reading of 'confirmation' works, if either", and OR-ing
   them would blur that.
4. **One entry per zone per direction:** after an entry (or after the window
   closes), that zone is consumed — no re-entry until a *new* zone of that
   type/direction is created on the 1h. Implement by remembering the zone's
   (type, `z_lo`, `z_hi`) at entry and suppressing further signals while the
   active zone is identical.
5. If multiple zone types are touched simultaneously, take the trade once
   (zones frequently nest); record which types were active for the diagnostic
   split in §5.5.

### 3.3 Stops and targets

* **Stop:** `min(z_lo, sweep_bar.low) − 0.25 × atr_5m` for the sweep encoding;
  `min(z_lo, entry_bar.low) − 0.25 × atr_5m` for the CHoCH encoding. The stop
  is behind *both* the zone boundary and the local 5m extreme — behind the
  swept liquidity, which is the structural invalidation ("the zone did not
  hold").
* **Target (structural, 1h):** the nearest opposing 1h liquidity — for longs,
  `h1_swing_high` at entry time; if it is NaN (no unbroken swing high),
  fall back to `entry + 3 × (entry − stop)`. Cap the target at 6R: if the
  structural target is further than 6R away, use 6R (uncapped structural
  targets make expectancy hostage to a few outlier trades and make the sample
  slow to converge).
* Time stop per §1.4.

This is where the payoff geometry diverges from everything tested so far: risk
is 5m-sized, reward is 1h-sized. Expected R multiples of 2–6R put break-even
win rate at 14–33%. The realised distribution of R multiples is itself a
required output (§5.5).

### 3.4 Free parameters (pre-committed)

Zone band 0.25 × h1_atr (LIQ only), entry window 36 × 5m bars, zone-fail
threshold 0.5 × h1_atr, stop buffer 0.25 × atr_5m, target cap 6R, fallback 3R,
time stop 144 × 5m bars, `k=2` both TFs. No scanning in the first pass.

---

## 4. Comparison — which variant can actually add directional content?

The test each variant must pass, from `ARCHITECT-NOTE.md` §2.3: a second
timeframe earns its place only if it changes the **trade event** or the
**payoff geometry**. A layer that only *vetoes* entries from an edge-less
trigger reproduces the v1 hybrid's arithmetic — it subtracts trades and cannot
add expectancy.

**Variant A is, structurally, mostly a filter — with one honest difference.**
Its entry is the *same* OB/FVG-retest mechanic that measured ≈ 0 directional
content at 15m and 1h (edge probe: −0.9 bp and −0.03 bp, ~172k observations),
now computed at 5m where the family-wide uniformity of that result makes ~0 the
strong prior. Gating it by 1h bias adds expectancy only if the 1h bias itself
has forward content at those entry moments — and the v1 hybrid's `htf_bias`
gate (4h-from-1h) never demonstrated any. The honest difference: in Variant A
the HTF layer supplies the *sign* rather than vetoing an already-signed
trigger, and bias-following is continuation-shaped — the one family with a
measured positive sign (v2: `momentum_breakout` gross PF > 1 on 8/8 perps). So
Variant A is best understood as **a test of whether 1h structure-trend
continuation survives being expressed through SMC retest timing** — a
legitimate question, but the likeliest outcome is that it collapses to a noisy,
worse-costed cousin of `momentum_breakout`: same directional engine, plus an
entry-timing layer with no measured content, minus the cost advantage of the
wider 1h stop. I put a low probability (~10–15%) on Variant A clearing the §5
bar.

**Variant B changes both the event and the geometry.** The trade event —
5m sweep-failure *inside a pre-identified 1h zone* — is not a filtered version
of any measured-zero entry; it is the sweep-as-trigger redesign already ranked
as the most promising structural inversion (§2.3), and the sweep gate is the
only component in the whole v1 package with demonstrated selection power (win
rate 46% → 55–68% when it was merely a filter). The payoff geometry (5m-sized
risk, 1h-sized structural target, 2–6R) is genuinely new: v1's SMC pinned
itself to the break-even line with 2R off a same-timeframe stop; Variant B's
break-even win rate at realised ~4R would be ~20%, so even a modest reaction
tendency at 1h zones clears it. That geometry is also its main exposure: tight
5m stops raise cost in R (§0) and lower win rate mechanically, so the equity
curve will be streaky and the daily breaker will bind on clustered stop-outs.
The second exposure is the familiar one: zone-touch × window × trigger ×
one-per-zone could starve the sample the way the hybrid did. My frequency
estimate from v1's zone-touch counts (single-TF smc at 1h fired ~600/yr/symbol
on every zone touch): after the 5m trigger and one-per-zone rule, **roughly
40–150 trades/symbol/year** — above the hybrid's fatal ~16, but this is the
first thing the probe must verify, and §5's minimum-sample bar is
non-negotiable precisely because of this failure mode.

**Could both repeat the v1 hybrid failure?** Variant A: yes, and probably —
its architecture is the closer cousin. Variant B: the failure mode it risks is
frequency starvation, not the can-only-subtract arithmetic; that is a risk
worth one research pass, because unlike the hybrid it has a mechanism by which
it could genuinely *add* expectancy (new event + new geometry), and both of its
components have the best evidence pedigree available in this family.

## 5. Recommendation and pre-committed research protocol

**Recommendation: route both to a single Researcher pass, with Variant B as
the primary question and Variant A as a cheap secondary** (they share the data
pull, the alignment helper, and the engine; A is ~50 lines on top of B's
infrastructure). A doubles as an informative control: if A shows nothing while
B shows something, the content is in the *zones*, not in generic 1h
directionality — and vice versa. If forced to run only one: **Variant B.**

Everything below is committed **now, before any result exists.** The Researcher
runs it as written; deviations require coming back to Architect first.

### 5.1 Universe and windows

* All 8 perps (§1.1), 5m base data, 2022-08-01 → 2026-07-31.
* **fit** `2022-08-01 → 2025-04-01` · **holdout** `2025-04-01 → 2026-08-01` —
  the same pre-committed split as v2. v2 §6 notes this holdout has been *read*
  (52 filter + 5 config evaluations) — but nothing in these two designs was
  selected using it, no parameter here was tuned on any window, and the final
  arbiter for anything that survives is a formal Backtesting-role pass on data
  neither package has touched (per `ARCHITECT-NOTE.md` step 4). Engine state
  (equity, breaker) resets at the boundary, as in v2.
* Everything in §5.3–§5.5 is computed on **fit only**; the holdout is run
  **once**, at the end, for the surviving rule-set(s) only.

### 5.2 Cost accounting (new requirement, from §0)

For every rule-set, report median and IQR of stop distance in % of entry, and
`cost_R = 0.0010 / stop_distance` per trade (10 bp round-trip). All expectancy
comparisons below are in R **net and gross**, with cost_R computed from
realised stops — not assumed from v1's 1h figure of 0.037 R.

### 5.3 Stage 1 — signal-level probe (gate to any backtest)

`edge_probe.py` methodology, unchanged: direction-adjusted forward returns on
non-overlapping triggers, horizons 3–48 bars (5m bars here, so 15 min – 4 h),
plus 96 and 144 bars to cover the holding horizon. Pass bar, per variant:

* pooled (8 symbols) mean forward return **positive with t > 2** at ≥ 2
  adjacent horizons, on
* **≥ 1,000 non-overlapping observations for Variant A; ≥ 400 for Variant B**
  (its event is rarer by construction) over the fit window.

A variant that fails stage 1 is **dead — no backtest, no tuning to resurrect
it.** This is the same discipline that would have killed v1's MR before a
single equity curve was drawn.

### 5.4 Stage 2 — permutation controls (gate to believing stage 1)

Both controls use the v2 §1.4 machinery: 200 draws, same-selectivity null,
computed on the fit window.

* **Variant A — random-direction control:** identical entry mechanics, but the
  1h bias sign replaced by a random ±1 (drawn per 1h-bias-regime segment, so
  the null preserves the gate's autocorrelation and trade count). Variant A's
  pooled expectancy must beat the **90th percentile** of the null. This
  isolates whether the 1h *direction* carries the content, which is the entire
  hypothesis.
* **Variant B — random-zone control:** same number, width, and lifetime of
  zones per symbol, placed at price offsets drawn uniformly within ±3 × h1_atr
  of the true zone location; identical 5m trigger and exits. Variant B must
  beat the **90th percentile** of the null. This isolates whether the 1h
  *location* matters — if a sweep-reclaim works equally well at random levels,
  the finding is "5m sweep-reclaim has content", which is a different (also
  interesting) result and must be reported as such, not dressed as zone
  evidence.

### 5.5 Stage 3 — backtest bar (only for rule-sets passing stages 1–2)

Full engine (§1.3), fit window, pooled across 8 symbols:

| criterion | bar |
|---|---|
| minimum sample | **≥ 300 trades pooled** in fit (project standard) — a rule-set below this is "unmeasurable", not "promising" |
| gross economics | pooled gross expectancy **≥ 3 × median cost_R** (the coherence rule from `ARCHITECT-NOTE.md` §5, applied in R terms) |
| net economics | pooled net PF **≥ 1.1** in fit |
| breadth | gross PF > 1.0 on **≥ 5 of 8** symbols |
| holdout (run once) | net PF **≥ 1.0** and gross expectancy sign preserved; fit→holdout PF decay ≤ 0.15 |

Targets note: per `ARCHITECT-NOTE.md` §3.2, the WR > 50% floor is **not**
applied to these designs — Variant B in particular is a low-WR/high-R shape by
construction and a WR floor would misjudge it. PF, expectancy, drawdown, sample
size, and breadth are the bar. Required diagnostics alongside the metrics:
realised R-multiple distribution (B), per-zone-type split OB/FVG/LIQ (B),
primary vs secondary trigger encoding (B, reported separately per §3.2),
breaker-bind frequency and skipped-signal rate (both, §1.3), median hold time
(both), trades/symbol/year (both).

### 5.6 Standing caveats to carry into the report

* **Funding is unmodelled.** Median hold must be reported; if it exceeds ~8 h,
  funding cost must be added before any promotion past this pass.
* **8 USDT perps on one venue ≈ far fewer than 8 independent tests** (v2 §6).
  Breadth counts are supporting evidence, not multiplicity.
* Fractal swings confirm `k` bars late on *both* timeframes; the 1h merge adds
  its own one-bar lag. Both lags are mandatory, on purpose, and any live
  version must reproduce them (v1 §8 guidelines).

### 5.7 Decision gate (back to Architect)

Outcomes and their routing, fixed now:

* **Both variants fail stage 1 or 2** → the MTF re-encoding question is
  answered; SMC-as-entry is retired in full (this closes the `ARCHITECT-NOTE`
  §2.2 escape hatch from the *design* side; the Critique & Refinement
  second-opinion task, if still undispatched, shrinks to reviewing whether
  these two encodings plus v1's were representative — likely a no-op).
* **A rule-set passes all of §5.5** → it goes to a formal Backtesting-role
  validation on untouched data (fresh months past 2026-08 plus the maker-fee /
  funding-aware execution model question raised in v2 §7) — **not** to
  Implementation directly.
* **Stage 1–2 pass but §5.5 fails on sample size alone** (the hybrid failure
  mode) → one follow-up is permitted: the multi-zone inventory extension
  (§3.1) to raise event frequency, re-run once under this same protocol.
  Anything beyond that returns to idea intake.
