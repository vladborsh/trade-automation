# Architect note — intraday MR / SMC / hybrid (BTC / ETH / SOL perps)

**Role:** Architect · **Inputs:** `REPORT.md`, `HANDOFF.md` (Researcher package, 2026-08)
**Status of the idea:** not routable to Implementation. Diagnosis and re-routing below.

A second Researcher pass (time-of-day / day-of-week filters, other assets) is
running in parallel as of this writing. This note does not wait on it; §5 says
where its results would change the plan.

---

## 1. What the evidence actually established

The Researcher's package is unusually decisive for an exploratory study, and I
accept its core findings as settled:

1. **The signals carry no forward edge at the signal level.** The zero-fee rerun
   (gross PF 0.83–1.27, nothing meaningfully above 1.0) and `edge_probe.py`
   (median t-stats −0.9 to +0.8, no significant cells outside chance) close off
   the entire "fix the execution" repair space. No exit scheme, fill model, or
   fee optimization can rescue a conditional expectation of ~0.
2. **The negative is robust, not a tuning artefact** — uniform across 192
   configs, 3 symbols, 3 intervals, both regimes, four 12-month blocks.
3. **Interval dominance (1h ≫ 15m ≫ 5m) is structural.** Gross edge per trade is
   roughly interval-independent while cost is charged per trade. Any future
   intraday work in this family starts at 1h; 5m is dead at taker fees.
4. **The hybrid's SMC gate genuinely selects a better subset** (win rate 46% →
   55–68%, maxDD 50–100% → 6–10%) — but selection quality is not expectancy, and
   the surviving sample is too small to prove anything.

## 2. Weak-parts diagnosis — which *design choices* produced the absent edge

### 2.1 The MR trigger is pointed the wrong way (highest-confidence weak part)

The design assumes a stationary intraday "fair value" that a 2σ stretch reverts
to. On crypto perps that premise fights the venue's own mechanics: liquidation
cascades and funding pressure make stretches **self-reinforcing** — a −2σ move
triggers stops and liquidations that extend it. The evidence is not merely that
the MR edge is absent; it is **negative-signed** (−9.4 bp mean forward return at
1h on 8,371 non-overlapping triggers). That is a design-level error in the
signal's sign hypothesis, not a parameter problem — which is why none of the 72
MR configs got above PF 0.87. The fixed 50-bar window / fixed 2σ threshold is a
secondary weakness (volatility is non-stationary, so "2σ" is a different event
in different regimes), but fixing the window cannot fix the sign.

### 2.2 The SMC candidate is pinned to its own break-even line by construction

Two compounding choices:

* **Fixed 2R target, structural stop.** A 2R target sets break-even at 33.3%
  win rate. Measured win rate: 33–39%. The design's payoff geometry places it
  *exactly on* the break-even frontier, so the whole outcome hinges on the entry
  having directional content — and the edge probe says the entry has none
  (−0.03 bp at 1h over 46,045 observations). The 2R choice didn't cause the
  absent edge, but it guaranteed that an edge-less entry would show up as an
  exact, expensive nothing rather than failing loudly and early.
* **One mechanical encoding of a discretionary practice.** "Last opposite candle
  before the BOS impulse, unmitigated FVG, close-based BOS" is one defensible
  reading among several. The Researcher flagged this honestly (§9). The large
  sample makes the verdict on *this* encoding definitive; it does not cover the
  encoding family. This is the one part of the package where a second opinion
  can still change the conclusion, which drives my routing (§4).

### 2.3 The hybrid's architecture can only subtract, never add

The hybrid uses SMC strictly as veto/confirmation on the MR trigger. A pure
filter architecture cannot create positive expectancy that the underlying
trigger lacks — it can only find a conditional subset where expectancy was
already positive. Given the MR trigger's unconditional expectation is *negative*,
the filter has to overcome the sign before contributing anything, and the data
shows it almost exactly cancels it (hybrid-1h: +16.6 bp mean, t ≈ 0.8, 784
observations). Stacking stricter gates (sweep + FVG + HTF CHoCH) pushes the
same architecture further along a curve where trade count collapses faster than
quality accrues — the best cell found (PF 1.10, WR 68%) is already down to
~15 trades/symbol/year, below any tradable frequency at 1%/trade sizing.

**The structurally more promising inversion is to flip the roles:** if the sweep
gate is where the selection power lives (and the win-rate jump says it is), the
sweep-failure event should be the *trigger* and MR-style stretch merely context
— not the other way round. That is a different strategy, not a tune of this one.

### 2.4 Execution assumptions — checked, and largely exonerated

Next-bar-open fills, stop-before-target on ambiguous bars, and taker fees are
all conservative choices, and the zero-fee rerun proves they are not the cause.
Two residual gaps worth carrying forward, not reasons for the result:

* **Funding is unmodelled.** Second-order at few-hour holds, first-order for
  anything that holds overnight — and 1h-bar strategies drift toward overnight
  holds. Any future 1h candidate must include it (infra implication, §6).
* **Single venue, single quote asset.** Three USDT perps on one exchange share
  microstructure; the "3 assets × 4 years" sample is materially less independent
  than it looks. This inflates confidence rather than biasing the sign, so it
  makes the negative *more* trustworthy and any future positive *less* so.

### 2.5 The target set itself is a weak part (see §3)

## 3. Target-feasibility assessment

### 3.1 The targets are pairwise coupled in ways the brief didn't acknowledge

PF, win rate, and reward:risk are one identity:
`PF = WR/(1−WR) × (avgWin/avgLoss)`. Demanding **both** PF > 1.2 and WR > 50%
constrains the payoff shape per strategy family:

* **MR-shaped trades** (target = mean, closer than the stop, R:R ≈ 0.6–0.8)
  need WR ≈ 60–67% just to reach PF 1.2. Measured MR win rate: 43–48%. The
  target pair is ~15–20 points of win rate away — structurally out of reach for
  this trigger, not marginally.
* **SMC-shaped trades** (2R target) reach PF 1.2 at WR 37.5% — but the WR > 50%
  target then *independently* fails them, and a 2R strategy that did hit WR 50%
  would have PF 2.0, i.e. the joint targets implicitly demand a far stronger
  edge from SMC than "PF > 1.2" suggests.
* Only the hybrid's shape (WR 55–68% with modest R:R) is even *aimed at* the
  joint target region — and it gets frequency-starved before arriving.

So the target combination is not impossible in the abstract, but it selects for
exactly one strategy shape (moderate-R:R, high-selectivity) and then the
implicit tradability requirement (enough trades/year for 1%-risk sizing to
compound) punishes that same shape. **The brief's targets are jointly
achievable only by a strategy that is both selective and frequent, which is the
rarest kind.**

### 3.2 Probabilities (honest, order-of-magnitude)

| Outcome | Probability | Basis |
|---|---|---|
| This family (MR / SMC-as-encoded / veto-hybrid), on these 3 assets, hits **all** of {PF>1.2, WR>50%, Sharpe & Sortino > 0, ≤1%/trade, ≤2%/day} at tradable frequency | **~5%** | Signal-level expectation measured ≈ 0 across the family; risk caps are satisfiable but the return targets require an edge the probes say isn't there. The residual 5% is the SMC re-encoding possibility and hybrid-region luck. |
| Same family hits a **relaxed** but still tradable set (PF > 1.1, Sharpe > 0, drop WR floor, keep both risk caps) | ~15–20% | Hybrid's quality metrics are real; the question is whether any variant clears costs at sufficient frequency. |
| **Momentum inversion** of the MR trigger shows a signal-level edge worth a full backtest (not yet the full target set) | ~25–35% | Only branch with existing *signed* evidence in its favor; crypto intraday continuation is also a documented effect. Passing a probe ≠ passing targets. |
| Sweep-as-trigger redesign (§2.3) reaches a full backtest | ~15–25% | Selection power is demonstrated; expectancy as a trigger is untested. |

Note the risk-side targets (≤1%/trade, ≤2%/day) are **not** part of the problem
— they are engine constraints, already enforced, and satisfiable by anything.
The binding conflict is {PF, WR, frequency}. If a relaxed set is entertained, my
recommendation as Architect: **keep PF and risk caps, drop the WR > 50% floor,
and add an explicit minimum-frequency floor (≥100 trades/symbol/year pooled at
whatever interval) plus a pre-committed minimum evaluation sample.** Win rate is
cosmetic; expectancy, drawdown, and sample size are not.

## 4. Routing plan

**Do not route to Implementation, Backtesting, Strategy-Application, or
Live-Signal Development.** Nothing here is buildable yet.

### Step 1 — Critique & Refinement (engage now, in parallel with step 2)

Scope: adversarial review of the **SMC encoding only** (`indicators.py:structure`,
order-block and sweep definitions), per REPORT §9. One question: *is there a
defensibly different mechanical encoding of OB/sweep/BOS that the study's
verdict does not cover?* Deliverable: either "the encoding is representative —
shelve SMC-as-entry with confidence" or a concrete alternative encoding spec
handed back to Researcher for a cheap rerun on the existing harness. Time-boxed;
this is a second opinion, not a rebuild.

### Step 2 — Researcher (engage now): momentum-inversion probe

Highest expected value per unit cost. Reuse the existing harness; probe
continuation (not reversion) after the same 2σ trigger at 1h, `edge_probe.py`
first, full backtest only if the probe shows t-significant positive forward
returns. Pre-commit thresholds before looking: pooled t > 2 on non-overlapping
triggers, ≥1,000 observations. Include the funding cost term this time (§6).

### Step 3 — Researcher (conditional): sweep-as-trigger redesign

Only after steps 1–2 report. The reframed hybrid from §2.3: liquidity-sweep
failure as the *entry event*, stretch/z-score as context, pre-committed minimum
pooled sample of 300 trades and the relaxed target set from §3.2 as the bar. If
step 1 produces a better sweep encoding, fold it in here rather than rerunning
the old hybrid. The Researcher's own "tighten the veto-hybrid filter" option I
am explicitly **deprioritizing** — §2.3 says that architecture thins itself out
faster than it improves.

### Step 4 — decision gate (Architect)

When steps 1–3 and the parallel worker have reported: either promote exactly one
surviving candidate to a formal Backtesting-role validation pass (out-of-sample
protocol designed *before* Implementation builds anything), or shelve the family
and return to idea intake. No candidate skips the Backtesting role on the
strength of research-harness numbers alone.

### Where the parallel worker's results change this plan

* **Time-of-day / day-of-week filters show a significant edge cell** → those
  filters become a required conditioning layer in steps 2–3 (a session filter
  composes cheaply with both), and step 3's priority rises.
* **Other crypto assets/indices show the same uniform nothing** → strong
  evidence the absence is family-level, not asset-level; probability in §3.2
  row 1 drops toward ~2% and the shelving option at step 4 becomes the default.
* **Non-crypto assets (equities/indices) show MR working where perps don't** →
  consistent with the §2.1 diagnosis (perp mechanics kill reversion); routing
  would then fork a separate equities-MR track with its own data-infrastructure
  prerequisite (§6) rather than continuing on perps.

## 5. Coherence notes for future strategies

Two reusable, hard-won constraints from this package that I will hold every
future intraday idea to:

1. **Cost floor rule:** at retail taker fees, no sub-1h crypto strategy proceeds
   past research unless its *gross* per-trade edge exceeds ~3× the round-trip
   cost. The 5m result should never be re-learned.
2. **Pre-committed samples:** any filter-heavy candidate declares its minimum
   trade count before results are seen. The hybrid's 63-trade cells are the
   cautionary example.

## 6. Infra flags for DevOps Engineer (flag only — provisioning is theirs)

* **Funding-rate history** (Binance USD-M, all studied symbols) is now a
  required research input for step 2 onward. Same public-archive family as the
  klines; small volume; belongs beside the klines in whatever S3-backed
  ingestion path is chosen.
* The **Binance bulk-archive → S3 ingestion path** the Researcher flagged
  (33 MB gzipped per full 48-month pull, no credentials) is worth standing up
  once *any* candidate reaches step 3 — three research passes re-pulling the
  same data is the trigger point, not before.
* **Contingent, do not provision yet:** if the parallel worker's other-asset
  results open an equities/indices track, that needs a separate market-data
  source (equities intraday bars are not free-bulk-archive the way Binance is)
  — a real cost/licensing decision. Flagging so it's on the radar, not a request.

---

*Next actions dispatched per this plan: Critique & Refinement (step 1) and
Researcher momentum probe (step 2) can start immediately and in parallel; both
report back to Architect. Step 3+ gated on their results plus the parallel
time-of-day/other-assets worker already in flight.*
