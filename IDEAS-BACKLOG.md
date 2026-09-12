# Ideas backlog

Raw trading ideas not yet dispatched to a Researcher/Architect task. The
Architect should read this at its next decision gate (see
`research/intraday-mr-smc/ARCHITECT-NOTE.md` §4 step 4) and decide whether/when
to route any of these, rather than treating them as pre-committed work.

---

## Session-liquidity sweeps (Asia/London/NY), iFVG vs BoS confirmation

**Status:** **SHELVED by Architect ruling, 2026-08-31 — confirmed under test,
2026-09-01.** The family is closed as a strategy candidate; all measurement work
is kept. Decision record: `RESEARCH-LOG.md` Запись 17; the test that confirmed
it: Запись 18.

**Update, 2026-09-01 (Запись 18, `research/session-liquidity-v5-ny/`).** The
user reviewed the shelving, was not convinced, and commissioned a seventh pass
with three definitional changes — a 24h horizon beside the block-scoped one, a
live 09:40–11:20 New York filter (fixed UTC−4 = 13:40–15:20 UTC), BTC/ETH
foregrounded — plus visual proof that the detection mechanics are correctly
implemented. Because the pass was motivated by disagreement with a null and
built on a hand-picked cut, it was run as the **first pre-registered,
hypothesis-tested pass in this repo**: pinned stop, pinned 1R trade template,
0.10 % round-trip costs, 75/25 chronological split, matched-time permutation
null, numeric kill rule — all committed before any R was computed.

* **All four pre-registered numbers fail the kill rule**, at the first gate.
  Holdout mean net R: iFVG **−0.261** (block) / **−0.271** (24h); BoS
  **−0.019** / **−0.037**. Threshold was +0.05R. 297 and 209 holdout trades, so
  not a power problem.
* **The strongest negative the family has produced:** a matched-time placebo
  (same window, same side, same stop in ATR, same fees, random date) beat the
  iFVG signal in **91 % of 1,000 runs** (p = 0.910). BoS's holdout p = 0.070 is
  contradicted by its own fit period (p = 0.870) and is still negative in
  absolute terms.
* **Gross expectancy is ≈ 0** (−0.006R / +0.009R); the fee is the entire
  negative. Cleaner statement of the null than "lift below 1.0".
* **The 24h horizon question is closed**: −0.010R / −0.018R, both slightly
  worse. MFE and MAE grow together.
* **One thing genuinely moved, and it is worth remembering:** the
  circularity-free forward lift rises from 0.84 → **0.95** (iFVG) and 0.89 →
  **1.00** (BoS) inside the NY window — the first cut in seven passes to shift
  it. It lands at **par**, and MFE and MAE both roughly double, so it reads as
  a volatility effect. The user's read on *where* was partly right; the read on
  *whether there is an edge there* was not.
* **The mechanics are not the problem.** The pass reproduces the v4 and BoS
  event streams **bit-for-bit** on all four assets and ships
  `MECHANIC-PROOF.md` — 8 captioned real-chart examples plus 36 machine checks
  including prefix-causal re-derivation of both the BoS anchor and the iFVG gap.
* **C3 is untouched** — this tested a time window on the session-level stream,
  not PDH/PDL-in-Asia. `hypothesis.py` is reusable machinery for it.

Six descriptive passes (phase 1, v2, v3, v4, the PDH/PDL drill-down, the BoS
pass) had already converged on one null that no further pass could overturn from
inside: **confirmation is a timing / entry-reference mechanic, not a selection
filter**, and the circularity-free forward lift is **below 1.0 for every
confirmation rule measured** — corrected BoS **0.87**, iFVG-v4 **0.83**,
phase-1 BoS **0.74**, against an unconditional 1.00. The stop-free measures
agree: at the iFVG confirmation close MFE/MAE = 0.99, 51.4 % are still on the
favourable side at block close with a median of +0.10 ATR; the best drill-down
cell has MFE/MAE 0.90 and median signed ER +0.003. Costs were applied for the
first time in the v5-NY pass, and they confirmed the null rather than creating
it.

Both pre-registered follow-ups are **declined**, with reasons on the record:

* **(a) A trader-realistic stop for BoS** (`session-liquidity-bos/HANDOFF.md`
  item 1). A stop convention re-labels R; it does not create drift. R already
  correlates with the stop proxy (ρ = +0.34…+0.42, drill-down §4) and every
  stop-free measure is flat, so the pass would re-order two mechanics that are
  both flat — and its only consumer is a strategy design the nulls do not
  support. Pin a real stop rule if and when something reopens (below), not
  before.
* **(b) The no-confirmation reversal thread** (v4 §7 `no_candidate`: 6,401
  events, 30.3 %, median wick reversal 5.98 ATR vs 3.31 for confirmed; the BoS
  pass's "neither" cell, 17.4 %). The 5.98 ATR is measured from the sweep wick,
  which is knowable only in hindsight; there is no trigger and no entry
  reference in that population. Turning it into a rule means inventing a new
  confirmation mechanic — a new research family, not a follow-up — and every
  trigger measured so far has forward lift below 1.0.

**Kept:** the pinned definitions (`knowledge/session-liquidity.md` §3.2, §5.1 v4,
§5.2 BoS, §6, §7 ledger), the four audited engines and their reuse harness, the
galleries, and the Pine indicators. **Formally retired:** the phase-1 BoS numbers
(T2/T3/T5/T12/T13 BoS rows) — as a *different, near-unconditional event*, not as
an inflated version of the right number — and the C-BoS arm of the invalidated
`research/session-liquidity/STRATEGY-DESIGN.md`.

**Single named reopen trigger — C3.** PDH/PDL swept in Asia is the only finding
that survives stratification on stop-free metrics (MFE/MAE 1.11 and median
signed ER +0.024, both consistent in 4/4 assets). It reopens **only** as a
pre-registered, hypothesis-tested pass — permutation null, kill rule,
fit/holdout split, costs in from bar one, and a real stop rule pinned *before*
any R is computed — on the ~0.24 pure day-level take-outs per asset-day. Under
the descriptive protocol it would yield another shape, and the log already holds
six of those.

Prior status (2026-08-31, superseded by the above): **PDH/PDL drill-down DONE — answer is NO; v4 iFVG mechanic DONE,
awaiting user audit; BoS still open (2026-08-31)** — see `RESEARCH-LOG.md`
Запись 15 and `research/session-liquidity-v2/drilldown/REPORT.md`. The
drill-down asked which level class and which window regime select, with the
iFVG-v4 mechanic held fixed. **No (level class × window regime) cut separates
from the break-even aggregate once window-length scaling is removed.** The one
cell above median R 1.00 — London-level-swept-in-NY with ≥72 bars of block left,
R 1.128 / R≥1 54.2 % / n=3,502 / 4 of 4 assets — has MFE/MAE 0.90 and median
signed ER +0.003: the regime buys a longer window, not a better sweep. The
clock question closed the same way v4 closed it (raw 2h R spread 0.37–0.59
collapses to 0.043–0.125 within a window-length stratum; hour vs bars-left
ρ = −0.94…−0.99) — "the clock, not the hour". The gap-size predictor is flat
(|ρ| ≤ 0.06 vs signed ER; its R correlation is a relationship with the stop
proxy, ρ = +0.34…+0.42). PDH/PDL itself works and is fully audited, but **73.2 %
of its take-outs sit within 0.05 ATR of a still-alive session level** — the new
population is ~0.24 pure day-level take-outs per asset-day. The only consistent
structural signal: **PDH/PDL swept in Asia has MFE > MAE and positive median ER
in 4/4 assets**, at the cost of a wider stop (median R 0.80–0.92). Open for the
Architect: whether that population warrants a design pass, and pinning a real
stop rule before any further R-based comparison (the stop proxy drives most of
the R numbers). C2 (PDH/PDL in NY) does not warrant further work.

Prior status (2026-08-31, superseded by the above): **v4 iFVG mechanic DONE,
awaiting user audit + two Architect rulings; BoS still open** — see
`RESEARCH-LOG.md` Запись 14 and
`research/session-liquidity-v4/REPORT.md`. v4 deleted the invalidation clause
v3 had added (fabricated during grilling, never part of the idea) and
re-derived everything. Result: deleting it restores v2's numbers **exactly** —
same confirmed set over all 23,423 take-outs, same confirming bar, 64.4 %
confirmation rate; the algorithms differ only in which gap they name (same gap
93.3 % of the time, zero consequence for any measured number). So **v3's
headline was misattributed** — the 64 %→21 % collapse was the invalidation
rule, not the sequencing fix — and **v2's confirmation/delay/geometry numbers,
marked stale in `knowledge/session-liquidity.md` §0, are in fact correct**
(§0/§7 need an Architect edit). The decision-relevant finding: at a 64 %
confirmation rate the mechanic **does not select** — confirmed take-outs
reverse 0.97–1.23× the unconditional baseline against 1.23–1.58× for bare
take-outs, so iFVG confirmation is a timing/entry-reference mechanic, not a
filter. And 30.3 % of take-outs never produce a qualifying gap at all — the
group with the **largest** median reversal in the sample (5.98 ATR). Next:
user audits the 24-panel gallery + hour chart → Architect rules on §0/§7 and
on trigger-vs-filter → PDH/PDL drill-down → BoS correction → strategy design.

Prior status (2026-08-31, superseded by the above; v3 numbers are stale — they
measure the fabricated invalidation rule): **v3 corrected-iFVG pass DONE**,
see `RESEARCH-LOG.md` Запись 13 and `research/session-liquidity-v3/REPORT.md`.

Prior status (2026-08-31, superseded): **v2 redo DONE for iFVG, awaiting user
audit; BoS still open** — see `RESEARCH-LOG.md` Запись 12 and
`research/session-liquidity-v2/REPORT.md`. The v2 pass re-measured everything
under the reissued definitions (non-overlapping sessions, block-scoped
horizon, relaxed iFVG, ATR primary) and found the iFVG-confirmed sweep to be
**in aggregate a coin flip**: from the confirmation close median MFE 2.34 ATR
vs median MAE 2.36 ATR, MFE>MAE in 49.7% of events, favourable at the block
close 51.4% of the time. The take-out itself carries mild lift over its
block's own baseline (1.25–1.48×) and the iFVG confirmation removes most of it
(1.02–1.15×), because the median confirmation costs 75 minutes of the move.
The NY/Asia prior splits: NY is the best *block* to watch and the worst
*level source* to hunt. Late (21–24 UTC) is a distinctly worse regime.
Next: user audits the 30-panel gallery + the v2 Pine → BoS correction pass →
Architect re-derives the strategy design → backtest.

Prior status (2026-08-31, superseded by the above): phase 1 methodology
REJECTED after review, full redo in progress — see `RESEARCH-LOG.md` Запись 11. The
2026-08-31 phase-1 pass (Запись 10, `research/session-liquidity/REPORT.md`)
and the strategy design built on it (Запись 10.1, `STRATEGY-DESIGN.md`) are
**provisionally invalidated**, not deleted — kept for reference, do not build
on them until the redo lands. Both Architects are on HOLD pending a new
design brief. Corrections ordered by the user after reviewing 20 worked
example charts: drop the fixed 2h measurement horizon (measure across the
whole clock-session instead — exact semantics TBD by Architect); drop the
London/NY session overlap (confusing, wants non-overlapping session bounds);
ATR stays as the unit (user initially objected, kept after being shown why
raw % isn't cross-asset comparable); redo iFVG methodology first, BoS
separately after; BoS's underlying mechanic is wrong, not just its
visualization — user-drawn correction sketches saved at
`research/session-liquidity/corrections/bos_correction_{downtrend,uptrend}.png`
for the Architect to read directly.

Prior (now-superseded) headline for reference only: iFVG and BoS confirmed
largely **different** take-outs (BoS-only 37.9%, iFVG-only 22.5%, both 16.1%,
neither 23.5%); from the confirmation bar iFVG looked stronger (median R
0.81 vs BoS 0.47). Don't treat these numbers as current — the horizon,
session bounds, and BoS mechanic they were computed under have all changed.

**Idea:** Mark each of the three trading sessions' high/low as "session
liquidity" (wide time-of-day windows, not narrow killzones — see
`knowledge/session-liquidity.md` for exact hours and full definitions). A
**liquidity sweep** = a session extreme is taken out (wick sufficient) and
price reverses, confirmed by one of two candidate methods compared
experimentally: **iFVG** (a 3-candle FVG fully closed-through/inverted by
opposite-direction candles) or **BoS** (break of structure via the existing
`fractals(df, k=3)` pivot primitive, used as a local trigger — not the
general-purpose bias/CHoCH engine already closed twice, Записи 5/6). Full
mechanical definitions, the reference-level scope (unswept levels from the
last 2 days), and the reverse-move measurement convention (extreme-to-extreme,
fixed 2h horizon) are all pinned in `knowledge/session-liquidity.md` — read
that, not this summary, before designing the research pass.

**Why this is genuinely new here:** first idea in the log built on
session/time-of-day structure combined with ICT-style liquidity concepts
(iFVG, BoS-after-sweep) rather than a rolling-window statistical trigger —
distinct mechanism family from MR/SMC/pivot-structure/momentum/positioning.

**Assets/data:** BTC/ETH/SOL/BNB, 5m (reuses the already-cached Binance pull).

**Research protocol (user's explicit call — deviates from prior packages'
discipline):** no permutation-null, no formal kill-rule stage. Phase 1 is
deliberately descriptive: measure sweep frequency per method (iFVG vs BoS)
and reverse-move magnitude, with charts/diagrams reported at each step — not
a pass/fail statistical gate. Flow: Researcher (frequency/magnitude study,
this dispatch) → Architect (strategy/entry design based on what the numbers
show) → Researcher (backtest, later, separate dispatch).

**Deliverables required (both, not either/or):** a Pine Script indicator
that draws session rectangles + iFVG formations + pivot markers on a live
TradingView chart for the user's manual visual audit, and a Python analysis
engine computing frequency/magnitude statistics on history. See
`research/_explainers/fractals-vs-pivots/` for the precedent visual-explainer
format already produced for the pivot primitive this idea reuses.

**Open questions — status after phase 1:** the iFVG-vs-BoS reporting question is
**answered** (both separately *and* as an overlap matrix; they are largely
different event sets — see above). The session-of-interest prior is **answered
with a caveat** (holds as lift, not in raw ATR). Still open: exact session hour
boundaries against daylight-saving/exchange conventions (only the working UTC
default is fixed in `knowledge/session-liquidity.md`), and the matched control
that would separate sweep behaviour from ordinary large-bar behaviour —
explicitly not measured in phase 1.

---

## VWAP mean-reversion, US index futures (ES/NQ/YM)

**Status:** design fixed (Architect's `research/vwap-mr-indices/ARCHITECT-NOTE.md`,
branch `architect-mr-smc-review`, commit `9ea71d4`), explicitly confirmed to
include Nasdaq (NQ, Nasdaq-100 futures) as one of the three instruments. **Paid
data-vendor backtest (Stage 0/1/2 in the architect's note) is deliberately
paused** — user does not want to spend on Databento/CME DataMine/broker-API
data yet. Instead: Researcher should produce a **Pine Script implementation**
of the fixed design (RTH-anchored session VWAP, VWAP±k·σ bands trigger,
revert-to-VWAP target, session-end flat) for the user to hand-test on
TradingView and report back with results. No Python backtest, no credentials,
no spend until the user decides otherwise based on that manual test.

**Idea:** Intraday mean-reversion off session VWAP (not a rolling mean/z-score
like the crypto MR candidate) on CME index futures — ES (S&P 500), NQ (Nasdaq
100), YM (Dow). Claim: price that stretches materially away from VWAP with
shrinking order flow/volume tends to revert toward it before session end,
especially outside of trend days — a different mechanism than the crypto MR
candidate's fixed-window z-score, and one that doesn't inherit the perp-specific
failure mode the Architect diagnosed (liquidation/funding-driven
self-reinforcement — see ARCHITECT-NOTE.md §2.1). Index futures don't have perp
funding or liquidation cascades, so the sign hypothesis that failed for crypto
MR is not automatically disqualified here — this needs its own signal-level
probe, not an assumption either way.

**Instrument:** CME index futures (ES/NQ/YM), not ETFs — chosen for near-24h
session coverage (true intraday including overnight, closer to how the crypto
research is structured) over the regular-hours-only ETF alternative. Tradeoff
accepted knowingly: futures intraday data is not available from a free no-key
bulk archive the way Binance's is, so a data source decision is a prerequisite
(flag to Researcher: check exchange/vendor options, e.g. Databento, CME
Data Mine, or a broker API already available to this project; if credentials
are needed, stop and ask rather than substituting synthetic data).

**Risk framework:** reuse the same engine constraints as the crypto work — 1%
equity risk per trade, 2%-of-day hard circuit-breaker enforced in-engine. Do
NOT reuse the original WR>50% target as a hard gate — the Architect's
target-feasibility analysis (ARCHITECT-NOTE.md §3) showed that pairing PF>1.2
with WR>50% structurally selects against MR-shaped payoffs regardless of
asset class; apply the Architect's revised framework instead (PF + risk caps +
minimum-frequency floor + pre-committed sample size, WR reported but not gated).

**Open questions for whoever picks this up:**
- VWAP anchor: session VWAP (resets daily) vs. a rolling VWAP — session is the
  standard reading and the default assumption unless research finds otherwise.
- Entry trigger definition: distance from VWAP in std-dev bands (like
  Bollinger-on-VWAP) vs. a fixed tick/point distance vs. volume-weighted
  exhaustion (declining volume on the stretch) — needs its own design pass, not
  inherited from the crypto MR trigger.
- Session-time structure: does the RTH open/close, overnight (Globex) session,
  or the cash-market open (9:30 ET) matter the way time-of-day is already being
  probed for crypto (see the in-flight Researcher-v2 pass)? Worth reusing that
  same time-of-day methodology once it lands.
- Relationship to the crypto momentum-inversion probe the Architect is routing
  now (ARCHITECT-NOTE.md §4 step 2): if crypto MR fails because of
  perp-specific mechanics, this idea is the natural control group — does the
  *same* trigger shape work on an instrument without those mechanics? Worth
  flagging explicitly when this is picked up, rather than treated as an
  unrelated idea.

---

## Pivot-based structure (major/minor CHoCH) — replacement for the SMC engine

**Status:** logged, design grilled with user, needs Architect decisions before
dispatch to Researcher.

**Idea:** Replace `indicators.structure()` (single-`k` fractal → BOS/CHoCH,
the engine behind both `smc` v1 and the `mtf.py` v2 variants, which the
Architect closed for entry use — see `RESEARCH-LOG.md` Запись 5) with a
two-tier pivot structure built on the same `fractals(df, k)` primitive
(already equivalent to TradingView's pivothigh/pivotlow — k bars each side,
causally shifted):

- **Major pivot**: k=15 — sets the baseline/tracked structural bias.
- **Minor pivot**: k=3-5 — a small-swing CHoCH on the minor pivot *is* the
  event that flips the tracked major bias (not merely a candidate awaiting
  separate major-level confirmation — user confirmed this reading explicitly).
- **Phase 2 (deferred until phase 1 results land):** 1h-timeframe FVGs treated
  as priority/problem reversal zones. Mechanism undecided (hard gate vs.
  scoring/priority vs. risk-sizing influence) — user wants structure-only
  results first before layering this on.

**Parameter grid for phase 1 (structure-only, no FVG):**
- Major k ∈ {10, 15, 20}
- Minor k ∈ {2, 3, 4, 5}
- Timeframe: (i) both on one timeframe first (cheapest/fastest baseline
  sweep), then (ii) multi-timeframe — major on 1h / minor on 5m, following the
  existing `add_htf_context`/`merge_asof` pattern in
  `research/intraday-mtf-smc/mtf.py` (same `k` is already shared cross-TF
  there today; two different `k` values on one TF has no prior precedent in
  this codebase — confirmed by search).

**Open questions explicitly delegated to the Architect (user declined to
decide, asked for Architect design judgment + several variants to test):**
1. **Role of major k=15 after initialization.** (a) sets only the starting
   bias, then minor-CHoCH flips fully drive direction going forward with k=15
   unused thereafter; (b) minor CHoCH is an early candidate but entry still
   requires price to also break the major (k=15) swing level in the same
   direction — early-warning + confirmation, not a full redefinition; (c)
   other. Recommendation offered to user during grilling: (a), since (b)
   degenerates into "old BOS/CHoCH plus an early filter" rather than the new
   "minor structure drives major" idea — but left open for Architect.
2. **Entry timing, stop, target for the structure-only variant.** Enter on the
   flip bar's close with no retest (baseline recommendation, for a fair
   apples-to-apples comparison against the old engine), vs. requiring a
   pullback/retest of the broken minor swing before entry. Stop beyond the
   minor-swing extreme; target RR — reuse the old `smc()` RR=2.0 default, or
   something else. User asked Architect to think this through and design
   several concrete variants rather than picking one now.

**Why this needs Architect (not straight to Researcher):** two structurally
open design decisions above are not fully specified, so this doesn't qualify
for direct-dispatch-to-Implementation (see "Direct dispatch authority" in
`agents/roles/architect.md`) — it needs an architecture note first.

---

## Momentum (trend-continuation) intraday, BTC/ETH/SOL perps

**Status:** logged, not dispatched.

**Idea:** A standalone momentum/trend-continuation strategy for the same three
assets and interval sweep as the original research (BTC/ETH/SOL USDT perps,
5m/15m/1h) — enter *with* an intraday impulse rather than fading it, targeting a
multiple of the move rather than a reversion to a mean. This is a broader idea
than the Architect's already-dispatched **momentum-inversion probe**
(ARCHITECT-NOTE.md §4 step 2), which specifically inverts the existing MR
trigger (continuation after a 2σ stretch) as a cheap, narrow signal-level check.
This backlog item is not a duplicate of that probe — it's the standing
invitation to design momentum as its own candidate (breakout of range/structure,
moving-average or MACD-style crossover, RSI/ROC threshold continuation, etc.),
independent of whatever the narrow inversion probe finds. If the probe comes
back positive, this item becomes its natural full-design follow-up; if it comes
back negative, this item should still be considered on its own terms since a
different momentum trigger family may behave differently than the inverted MR
trigger specifically.

**Why this is plausible given what's already been found:** the Architect's
diagnosis (§2.1) was that MR is pointed the wrong way *because* perp mechanics
(liquidations, funding pressure) make stretches self-reinforcing rather than
mean-reverting — i.e. the evidence points toward momentum/continuation being the
correctly-signed hypothesis for this asset class, not just "MR happened to
fail." That's a substantive reason to invest in momentum as a first-class
candidate rather than treating it as a fallback.

**Risk framework:** same engine constraints as the rest of this research line —
1% equity risk per trade, 2%-of-day hard circuit-breaker enforced in the
backtest engine itself. Apply the Architect's revised target framework (PF +
risk caps + minimum-frequency floor + pre-committed sample size) rather than the
original WR>50% hard gate — momentum/trend-following strategies canonically have
*lower* win rates than mean-reversion (small frequent losses, occasional large
wins), so a WR>50% floor would be an even worse fit here than it was for MR/SMC.

**Pre-registered candidate hypotheses carried forward from other packages'
kill messages (flagged there, not yet done — this is where they land):**
- **K=20 confirmed-swing breakout @ 1h** (from `research/pivot-structure/
  REPORT.md` §3, kill message 2026-08-26): the pivot-structure engine's only
  cell with a coherent positive sign was a bare close beyond a confirmed
  ~20h swing (+12.9 bp t=2.60 @6h, +15.7 bp t=2.42 @12h) — attribution showed
  the sign belonged to the raw swing break, not the two-tier pivot machinery.
  This is `momentum_breakout` rediscovered through a different
  parameterization; treat as a hypothesis, not evidence, and needs its own
  permutation null / cost model / funding check (median holds 16–27h, past
  the funding-flag threshold).
- **Trailing-4h-return-strength terciles on `momentum_breakout` triggers**
  (from `research/deriv-positioning/REPORT.md`, kill message 2026-08-26): the
  redundancy control's price-shadow variable produced the strongest
  conditioning split measured in any package (t up to ~5.0, 6/6 horizons,
  8/8 symbols) — post-hoc (it was a control), and even a working split failed
  hypothesis (a)'s comparative-economics bar there, but worth pre-registering
  properly here with the full comparative bar.

**Open questions for whoever picks this up:**
- Trigger definition: needs its own design pass — candidates include
  range/structure breakout, MA/MACD crossover, ROC or RSI threshold
  continuation (the two carried-forward hypotheses above are candidates, not
  the whole design). Should not just inherit the MR candidate's 2σ trigger
  inverted (that's what the narrow probe already covers) — a well-designed
  momentum entry may look nothing like an inverted mean-reversion entry.
- Exit design: trend-following payoffs are usually asymmetric (trail a stop,
  let winners run) rather than a fixed R-multiple target like the MR/SMC
  candidates used — worth deciding deliberately rather than reusing the fixed
  stop/target frame by default.
- Same interval question as before: does 1h dominate 5m/15m here too, or does
  momentum (which needs a move to *not* have finished yet) behave differently
  across timeframes than mean-reversion did? Don't assume the prior interval
  ranking carries over.
- Reuse existing 48-month BTC/ETH/SOL data already fetched
  (`research/intraday-mr-smc/data/`, or whatever Researcher-v2/momentum-probe
  extends it to) rather than re-pulling.

---

## Funding-rate signals: carry and funding-extreme continuation (crypto perps)

**Status:** **prioritized** (user review, 2026-08-26), not yet dispatched.

**Idea:** Use the perp **funding rate itself as the signal input**, not just as
an unmodelled cost. Two distinct sub-hypotheses, probed separately:
(a) **funding carry** — when funding is persistently extreme (e.g. top-decile
positive over the last N settlements), hold the paying side short (collect
funding) with a price-based stop; (b) **funding-extreme continuation** — the
Architect's own diagnosis (`intraday-mr-smc/ARCHITECT-NOTE.md` §2.1) says
funding pressure makes price stretches *self-reinforcing*; extreme funding plus
price pushing in the crowded direction should then predict continuation of the
squeeze against the crowd once price turns (long-squeeze / short-squeeze
mechanics).

**Why this is genuinely new here:** every candidate so far consumed only OHLCV.
This is the first idea whose input is the venue's own positioning mechanism —
the very mechanism the project's one confirmed diagnosis is built on. It
*monetizes* the diagnosis instead of merely avoiding its failure mode.

**Data:** Binance USD-M `fundingRate` history lives in the same free
`data.binance.vision` bulk-archive family as the klines already used (flagged in
ARCHITECT-NOTE.md §6 as a required future input anyway). No credentials.
Researcher verifies per-symbol coverage across the 2022-08 → 2026-07 window
before designing anything.

**Open questions:** funding-extreme definition (absolute threshold vs rolling
percentile — percentile preferred, thresholds are regime-dependent); holding
horizon vs the 8h settlement cycle; whether carry P&L survives the price risk
taken to collect it (that is the whole question); interaction with the momentum
findings — funding may just proxy the same continuation effect already measured,
so a pre-registered "does it add anything beyond momentum_breakout" comparison
belongs in the protocol from day one.

---

## Cross-sectional relative momentum, dollar-neutral, 8-perp universe

**Status:** **prioritized** (user review, 2026-08-26), not yet dispatched.

**Idea:** Rank the existing 8-perp universe by trailing return (e.g. 12–48h),
go **long the top 2 / short the bottom 2**, dollar-neutral, rebalance on a fixed
intraday cadence. Every candidate so far has been **time-series per-asset**;
this is the first **cross-sectional** hypothesis — it bets on *relative*
continuation (leaders keep leading) rather than absolute direction.

**Why this is plausible given what's been found:** (1) time-series continuation
is the one signed-positive effect in three packages, and cross-sectional
momentum is its standard, extensively documented sibling; (2) it directly
attacks two standing structural criticisms — the drift exposure that poisoned
symmetric long/short rule-sets (pivot pass §4.4: shorts pay the 2022–25 drift)
and the "8 correlated perps are not 8 bets" portfolio problem (v2 §5.3) —
because a dollar-neutral basket nets out both the drift and the common market
factor by construction.

**Data:** already on disk (`research/intraday-mtf-smc/` 5m pull, 8 symbols).
No new pull.

**Open questions:** this doesn't fit the per-asset engine — it needs a small
portfolio-level harness (one account, N legs, netted risk), which is new
engine work the design must scope honestly; how the 1%/trade risk rule maps to
a basket (per-leg vs per-basket risk — Architect decision); rebalance cadence
vs fee drag (8 legs × frequent rebalance can eat the edge the way 5m churn did
— the cost-floor rule applies to basket turnover); whether 8 symbols is enough
cross-section for ranking to mean anything (it is thin — say so up front and
judge accordingly).

---

## Opening-range breakout (ORB), US index products — session-anchored momentum

**Status:** logged (Architect idea-generation pass, 2026-08-26); **not
prioritized** at the 2026-08-26 user review (not rejected — just not picked).

**Idea:** Classic session-structure momentum on equity index products (ES/NQ
futures, or SPY/QQQ): define the opening range as the first 15–30 minutes after
the 9:30 ET cash open; trade a breakout beyond that range in the breakout
direction; stop at the opposite side of the range; session-end flat. The
mechanism is the **session auction** — an anchor point (the open) that crypto's
24/7 tape structurally lacks — which is why this is not a re-skin of any crypto
candidate: none of the crypto work had a session anchor at all, and the one
session-shaped thing tried (time-of-day filters) failed precisely because it
*imposed* clock structure on an anchor-less market. Here the market itself
provides the anchor.

**Why plausible:** it is continuation-shaped (the only positive family so far);
ORB is one of the most-documented intraday equity effects; and the v2 index
thread already found the momentum family positive-leaning on S&P products
(SPY 1.17–1.18) with everything reversion-shaped negative — consistent sign.

**Data / route:** intraday RTH bars finer than 1h are the constraint (Yahoo's
free 1h feed won't carve a 15-minute opening range; 15m history there is
~60 days). Two no-spend routes, Architect to pick at dispatch: (a) **Pine
Script for manual TradingView testing** — the exact route just built for
VWAP-MR (`research/vwap-mr-indices/`), reusing its RTH/session plumbing; (b)
free-source hunt for ≥2 years of 5m/15m RTH bars with the stooq/Yahoo caveats
already learned. Do not spend on data without the user's explicit go-ahead.

**Open questions:** range width (fixed minutes vs volatility-scaled); breakout
confirmation (touch vs close-beyond — the pivot pass showed close-beyond is
the honest reading); one-trade-per-day vs re-entry; NQ vs ES first (v2 found
S&P-side positive, Nasdaq-side flat — test both, expect divergence); overlap
with the paused VWAP-MR item (same instruments, opposite mechanism — running
both against the same tape is a feature, not a conflict: they cannot both be
right on the same days, which is a useful mutual control).

---

## Scheduled-macro-event reaction, BTC/ETH — first entry into the news pillar

**Status:** logged (Architect idea-generation pass, 2026-08-26); **not
prioritized** at the 2026-08-26 user review (not rejected — just not picked).

**Idea:** Trade the **first directional reaction after scheduled US macro
releases** (CPI, FOMC statement/press conference, NFP) on BTC/ETH perps: at a
known timestamp, measure the first N-minute move (e.g. 5–15 min), enter in its
direction, structural stop at the pre-release price, time-boxed exit (1–4h).
Hypothesis: scheduled releases inject genuine information; the initial repricing
under-shoots and continues (event-momentum), and on perps the continuation is
amplified by the same liquidation mechanics already diagnosed.

**Why this is genuinely new here:** `PROJECT.md` names news-driven strategies
as a core pillar and **nothing in six log entries has touched it**. This is the
cheapest possible entry into that pillar: scheduled events need a calendar, not
NLP — the "news analysis" is one timestamp column. It also isolates exactly the
hours where the time-of-day study's *negative* result doesn't apply: that study
showed uniform clock-hours carry no signal, but event hours are not uniform
clock-hours, and nothing tested conditioned on them.

**Data:** kline data already on disk (5m, 8 perps). Release calendar:
historical CPI/FOMC/NFP timestamps are public and small (BLS/Fed schedules) —
Researcher assembles a dated event table as part of the pass, no vendor needed.

**Open questions:** sample size is the honest worry — ~12 CPI + ~8 FOMC + ~12
NFP per year × 4 years ≈ 120–130 events; a per-event-type split will be
underpowered, so pre-commit pooling rules and a minimum-event floor before
looking; reaction-window and holding-period grid must be tiny (this is exactly
the setting where 144-config sweeps manufacture fit); the 2%-day breaker
interacts with event days by design — report it; extension to crypto-native
scheduled events (ETF flows, unlock schedules) is a later idea, not this one.

---

## Derivatives-positioning data: OI and taker-flow imbalance (crypto perps)

**Status:** **closed — all three hypotheses killed** (Researcher pass complete,
Architect-ratified, 2026-08-26; `research/deriv-positioning/REPORT.md`,
`RESEARCH-LOG.md` Запись 8). (a) OI-conditioned `momentum_breakout` passed
stage-1 and its permutation null but failed the mandatory redundancy control —
a price-derived shadow (trailing-4h-return percentile) separates the same
trades better, so it's "price in disguise," not a second signal; the
pre-registered filter also made the base strategy's net PnL worse, not better.
(b1) crowding squeeze and (b2) taker-imbalance continuation were both
significantly negative at stage 1 (0th percentile of their nulls) — killed
outright. Deliverable: Binance's public positioning feeds add no signal beyond
price at 1h. **Do not re-dispatch this idea** without a genuinely different
angle — the redundancy-control finding is a structural objection to
OI/taker/ratio data as a *signal source* here, not a parameter-tuning miss.

**Spin-off worth carrying forward (not this idea, flagged for Запись 4 /
standalone-momentum instead):** the redundancy control's price-shadow variable
(trailing-4h-return-strength terciles on `momentum_breakout` triggers)
produced the strongest conditioning split measured in any package so far
(t up to ~5.0, beats null at 6/6 horizons, 8/8 symbols) — but it's post-hoc
(it was a control, not a hypothesis) and even a working split failed (a)'s
comparative-economics bar. Should be pre-registered as a hypothesis, with the
full comparative bar, whenever the standalone-momentum design pass happens.

**Idea:** Binance's same free bulk archive exposes a **futures `metrics`
dataset** — open interest, top-trader long/short ratios, taker buy/sell volume
ratio — at 5m granularity. Use these as a *positioning/order-flow* input layer,
with two concrete probe-able hypotheses: (a) **OI-confirmed continuation** — a
price move on *rising* OI is new positioning (continuation-favorable), the same
move on *falling* OI is covering (fade-favorable); probe whether OI-rising
breakouts outperform OI-falling ones; (b) **crowding reversal** — extreme
long/short-ratio + an adverse price push predicts squeeze acceleration
(complements the funding idea; same mechanism, different sensor).

**Why this is genuinely new here:** second non-OHLCV input class, and the most
direct measurement available of the liquidation-fuel mechanism the whole
crypto diagnosis rests on. Funding is the *price* of crowding; OI and taker
flow are its *quantity* — the pair covers the mechanism from both sides.

**Data:** `data.binance.vision` futures `metrics` files, no credentials.
Coverage typically starts ~2021-12 — Researcher must verify per-symbol
completeness over the study window first, and treat gaps honestly (this
dataset is known to have holes; a gap-handling rule belongs in the protocol,
not in post-hoc cleaning).

**Open questions:** (a) is best framed as a *conditioning study on
momentum_breakout* (does OI-rising select the good half of its trades?) — that
makes it a filter, so the can-only-subtract rule applies and the pre-registered
question must be "does the conditioned subset beat the unconditioned strategy
net of the trades it gives up", with the v2 permutation-null discipline; (b) is
standalone-entry-shaped and gets the full staged probe; both must show they add
anything beyond price-derived signals (a positioning signal that is just
yesterday's return in disguise is not a second signal).

---

## Spot–perp basis and spot-lead signals (Binance spot vs USD-M perp)

**Status:** **prioritized** (user review, 2026-08-26), not yet dispatched.

**Idea:** Pull Binance **spot** klines (same free bulk archive, same symbols)
alongside the existing perp data and trade the **relationship between the two
prices of the same asset**: (a) **basis-extreme convergence** — when the
perp-spot basis stretches beyond its rolling distribution, trade the perp
toward convergence (the anchor is the spot print, not a rolling mean of the
perp itself); (b) **spot-lead confirmation** — probe whether moves led by spot
(spot moves first / on dominant volume) continue more reliably than
perp-led moves (hypothesis: spot flow is closer to informed/organic demand,
perp flow closer to leverage churn).

**Why this is genuinely new here:** first *relative-value* hypothesis — every
prior candidate priced one instrument against its own history. It also gives
the reversion family its only principled second chance: crypto MR failed
because a rolling mean of the perp's own price is not an anchor (the
Architect's §2.1 diagnosis), but spot *is* a real anchor — the arbitrage
relation is mechanical, enforced by actual capital. If basis-MR fails too, the
reversion story on this venue is closed with a much stronger argument.

**Data:** Binance spot monthly klines, `data.binance.vision`, no credentials;
5m/1h for the 8 symbols' spot pairs. Note: basis measured off 5m closes of two
separate feeds is noisy — the design must set a minimum basis threshold well
above tick noise and state clock-alignment assumptions explicitly.

**Open questions:** basis definition (raw difference vs funding-adjusted —
funding-adjusted is the economically honest one, which couples this to the
funding-data pull above; do both pulls in one pass); whether basis extremes at
retail-visible size occur often enough to trade (frequency floor first, before
any backtest); execution realism — basis trades in size are the domain of
HFT/market-makers, so the pre-registered question is whether anything survives
at taker fees on the *perp leg only* (this project trades the perp leg
directionally, not the two-legged arb).

---

## Smart-money ICT strategy from `cmc-bot` (existing pre-built bot, user's own prior project)

**Status:** **routed by Architect 2026-09-12** — approved for **one
pre-registered, hypothesis-tested Researcher pass**, thresholds fixed in
advance. Full ruling: `research/cmc-bot-smart-money/ARCHITECT-NOTE.md`;
mechanic pinned in `knowledge/smart-money-ict.md`; `RESEARCH-LOG.md` Запись 19.

- **Family:** *not* session-liquidity — the bot has **no sweep-detection step
  at all**, and its iFVG inverts through the gap's **proximal** edge, not
  §5.1's far edge. It is **encoding #4** in `knowledge/smc.md` §3 (HTF bias →
  LTF entry trigger), whose encodings #1–#3 are all closed. The C3 reopen
  trigger is untouched in either direction.
- **Standard:** pre-registered, not descriptive — its parameters were chosen
  by eye on unpublished data, and it contests a standing null. §8's own rule.
  **One shot**: a miss is a kill, not a rework.
- **Thresholds, fixed now:** kill if holdout mean net R **< +0.05R** or
  placebo `p > 0.20`; build only if **all** of mean net R **≥ +0.10R**,
  `p ≤ 0.0125` (Bonferroni /4), fit agrees in sign, `n_holdout ≥ 150`, the
  90 % day-block bootstrap interval excludes 0, and gross expectancy > 0.
- **Symbols/data:** BTC/ETH/SOL/BNB USD-M perp, **1m** (+1h and 5m resampled),
  2022-08-01 .. 2026-07-31, pulled with this project's own
  `research/intraday-mr-smc/fetch_data.py` — **not** the bot's `npm run scrap`.
  Daily 2-loss/1-win caps removed from the primary population (capped version
  a mandatory secondary row).
- **Route:** Researcher, one package `research/cmc-bot-smart-money/`, two
  stages with an Architect gate between — **Stage 0** Python reproduction +
  bar-for-bar parity against the TypeScript + prefix-causality proof + signal
  inventory (no performance number); **Stage 1** the pre-registered test.
  Software Engineer / Backtesting engage only on a REAL EDGE verdict.
- **Inadmissible:** the bot's own in-repo backtest results — it models no
  costs/spread/slippage, checks exits on M1 closes only, and clamps a
  gapped-through stop back to the exact stop price.
- **Out of scope, explicitly:** `vwap-strategy`, `tech-analysis`/RSI,
  `correlation-analyzer`, the Telegram bot, AWS/OTel plumbing,
  `chart-visualizer`, and the bot's unused level machinery.

**Idea:** The user has a pre-existing, already-coded trading bot at
`cmc-bot-main/` (own prior project, not built by this team) implementing a
full ICT/"smart money concepts" strategy end to end — indicator engine,
strategy logic, risk manager, backtester, live exchange clients (Binance +
Capital.com), and a Telegram bot for control/notification. The user wants this
specific, already-implemented strategy adopted into this project: reproduce
its signals and collect performance metrics on it, i.e. treat it as a
candidate strategy to validate and potentially operate here rather than a
from-scratch idea.

**What the code actually does** (read directly from
`cmc-bot-main/src/strategy/smartmoney-strategy.ts`,
`cmc-bot-main/src/indicator/main-indicator.ts`,
`cmc-bot-main/src/strategy/risk-manager.ts` — this is a description of
existing code, not a design proposal):

- **Session filter:** trades only Mon–Fri, only within a **09:40–11:10
  America/New_York wall-clock window** (`isValidTimeForNewOrders` /
  `canOrdersBeAlive`) — note this is wall-clock (DST-aware), not a fixed UTC
  offset, and it is a *narrower* window (09:40–11:10) than the one just tested
  and killed in the session-liquidity family (09:40–11:20, fixed UTC−4) — see
  "Coexistence" below.
- **Bias (H1):** direction of the most recent inverted FVG on the H1 chart
  over a trailing 720h lookback (`getHighTimeFrameBias` → `calculateFVG`) sets
  a required trade direction (buy/sell) for the session.
- **Entry (M1):** a same-direction M1 iFVG confirmation
  (`bullishIfvgOccurs`/`bearishIfvgOccurs`, from a stateful FVG/iFVG
  calculator run bar-by-bar, `FvgCalculator` in
  `indicator/tools/fvg-element.ts`), gated on price being on the correct side
  of the day's premium/discount midpoint (`priceInDiscount`, computed from a
  60-bar high-timeframe swing range) **and** the correct side of the "NY AM
  true open" (`aboveNYamTrueOpen` — the open price of the New York AM quarter,
  a distinct concept from this project's PDH/PDL or session-liquidity levels).
- **Filters:** an iFVG-size-to-ATR(20) ratio cap (`MAX_IFVG_TO_ATR_RATIO = 8`,
  rejects abnormally large/illiquid gaps), and a daily risk gate (max 2 losing
  orders/day, max 1 winning order/day, `RiskManager`).
- **Risk:** stop-loss anchored to the high-timeframe swing range extreme
  (`rangeHigh`/`rangeLow`), shrunk by a discrete ratio table
  (`adjustStopLoss`) when the raw stop is small relative to that range; target
  is a fixed **2.7R** (`TARGET_RISK_REWARD_RATIO`); a two-stage breakeven/1R
  trail once the trade reaches 1R and 2R.
- Also present in the repo, not part of this idea: a separate `vwap-strategy`
  and a `tech-analysis`/RSI strategy, a `correlation-analyzer`, a Telegram bot
  UI, AWS/OTel deploy plumbing. Out of scope unless the Architect decides
  otherwise.

**Why this needs an Architect decision before Researcher touches it, not just
a straight port:**

1. **It is not new to this repo's knowledge in spirit.** It reuses the same
   primitive vocabulary this project has spent seven passes on (`H1 iFVG`,
   `M1 iFVG`, premium/discount, a fixed NY-morning window) but combines them
   into a materially different mechanic than anything in
   `knowledge/session-liquidity.md`: there is no explicit "sweep" detection
   step at all — entry is gated on iFVG + bias + premium/discount + a true-open
   side, never on a level being taken out first. Calling it "the smart-money
   strategy" and calling `session-liquidity` "smart-money" risks conflating
   two different ideas under one name; an Architect read is needed to decide
   whether this is a new `knowledge/` file or a variant section of an existing
   one.
2. **Direct overlap with a very recently killed result.** The
   `session-liquidity-v5-ny` pass (`RESEARCH-LOG.md` Запись 18, this project,
   2026-09-01) pre-registered and killed a 09:40–11:20-NY-window sweep+iFVG
   idea on BTC/ETH — mean net R −0.26 (iFVG) / −0.02 (BoS) on holdout, iFVG
   worse than a matched-time placebo in 91% of 1,000 draws. This bot's window
   (09:40–11:10) and entry primitive (iFVG) sit close enough to that killed
   result that an independent naive backtest risks re-discovering the same
   null, or — worse — a p-hacked-looking positive from small changes in
   filters (bias direction, premium/discount, true-open side, R:R target,
   ATR-ratio cap) that were never tested against a placebo. The Architect
   should decide up front whether this reopens under the same pre-registered
   standard the shelving ruling (Запись 17) demands, treats it as a
   sufficiently distinct mechanic to warrant a fresh descriptive pass first,
   or something else.
3. **It is untested by this project's protocol.** The bot has its own
   in-repo backtester (`src/backtesting/`, see `cmc-bot-main/docs/backtesting.md`)
   and was presumably run against it historically, but that is the user's own
   prior tooling, not an independent Researcher validation under this
   project's descriptive/pre-registered standards, and no result from it is
   on record in `RESEARCH-LOG.md`.

**What the user asked for:** reproduce this strategy's signals in this
project and collect performance metrics on it — i.e. validate it as a
candidate, not merely document it.

**Data needed:** BTC/ETH (and whatever other symbols the user wants) 1m and
1h candles — `cmc-bot-main` already has Binance/Capital.com clients and a
scraper (`npm run scrap`) that can pull this independently of the
`intraday-mtf-smc` data used by the session-liquidity family; H1 lookback
needs ~720h (30 days) of history per bias calculation, full backtest needs
whatever sample size the Architect/Researcher pins for a fit/holdout split.

**Dispatched to:** Architect, same session, for an architecture note +
routing plan (new `knowledge/` entry vs. extension of an existing one,
Researcher scope, and whether/how this reopens or relates to the
session-liquidity shelving ruling).

## The `cmc-bot` ICT mechanic on cash-open indices (US500/US100) — spun off

**Status:** logged 2026-09-12 by Architect as a **deliberate spin-off** from
the entry above, so it does not ride along on that pass's pre-registration.
Not routed; no Researcher work authorised.

**Idea:** the same H1-bias → M1-iFVG composition
(`knowledge/smart-money-ict.md`), but on equity-index instruments. The reason
to separate it is not administrative: **a 09:40–11:10 New York window means
something categorically different on an instrument that only trades
09:30–16:00 New York.** On an index it is "the first hundred minutes after the
cash open" — a different, and arguably more plausible, hypothesis than the
same clock slice of a 24/7 crypto tape. Testing both under one registration
would let a result on one be read as support for the other.

**Blockers to resolve before this could be routed:**

- `PROJECT.md` scopes to crypto/equities intraday; index CFDs sit at the edge
  of that and the crypto pipeline is not yet proven.
- The bot's index path is **Capital.com**, a CFD broker, not an exchange tape:
  prices and costs (spread, financing) are broker-specific, so a result would
  be neither reproducible nor portable, and this project has no honest cost
  model for it. A real pass would need an exchange-sourced index/futures tape.
- The bot's own documented smart-money backtests are BTCUSDT/ETHUSDT only;
  US500/US100 in `cmc-bot-main/docs/backtesting.md` are the **vwap** strategy.
- Partly overlaps `research/vwap-mr-indices/` on data sourcing — reuse that
  package's instrument/vendor findings rather than re-deriving them.

## The `cmc-bot` VWAP band-reversal strategy (from `cmc-bot-main`, distinct from the smart-money ICT bot above)

**Status:** **routed by Architect 2026-09-12** — approved for **one
pre-registered, hypothesis-tested Researcher pass**, thresholds fixed in
advance. **Data gate resolved same day**: user supplied Capital.com
credentials (`cmc-bot-main/.env`, gitignored) and gave the US100/US500 timing
windows directly (entry 09:40–11:40 NY, alive 09:40–14:30 NY — provisional,
user flagged for revisiting after a first test) rather than granting AWS
access to the bot's S3 config. Stage 0 is unblocked. Full ruling:
`research/cmc-bot-vwap/ARCHITECT-NOTE.md`; mechanic pinned in
`knowledge/vwap-band-reversal-ict.md`.

**Stage 0 done 2026-09-12 (Researcher, `RESEARCH-LOG.md` Запись 20):** both
gates PASS on the full Capital.com history (2024-01-01 .. 2026-09-11 — the
API's 1-minute floor), 200,322 bars bit-identical to the TypeScript, 600/600
prefix-causality. No performance number yet. **Awaiting Architect decision
for Stage 1** on: tape timing (D-01 — the bot's candle times are broker-local,
its own backtest trades 2–3 h earlier than labelled), backtest-vs-live bar
(L-01), the split, and the forex legs (~90 orders/yr each, underpowered for
`n_holdout ≥ 150`). Package: `research/cmc-bot-vwap/HANDOFF.md`.

**Idea:** the user's pre-existing `cmc-bot-main` also ships a second,
separately-coded strategy — `VWapStrategy`
(`cmc-bot-main/src/strategy/vwap-strategy.ts`) — live-traded (per
`strategy-provider.ts`) on four Capital.com instruments: **US100** (Nasdaq,
code `nasdaq`), **US500** (S&P, code `snp`), **EURCHF**, **GBPCHF**. The user
wants this strategy's signals reproduced and its performance measured, same
as the smart-money bot above.

**What the code actually does** (read directly from
`cmc-bot-main/src/strategy/vwap-strategy.ts`,
`cmc-bot-main/src/indicator/tools/vwap.indicator.ts`,
`cmc-bot-main/src/indicator/tools/range.indicator.ts`,
`cmc-bot-main/src/indicator/tools/previous-hour-lh.indicator.ts`,
`cmc-bot-main/src/strategy/risk-manager.ts`,
`cmc-bot-main/src/strategy/strategy-provider.ts` — description of existing
code, not a design proposal; full detail in the architecture note):

- **Bias — a same-timeframe, session-anchored VWAP band, not an H1 bias
  despite the method's name.** `getHighTimeFrameBias` (vwap-strategy.ts:268)
  actually fetches **M1** candles from **UTC midnight** to now (not H1), runs
  `VWAP()` over them, and reads a **contrarian** bias: price above the upper
  band (`vwapTop`) → bias **sell** (fade the stretch); below `vwapBottom` →
  bias **buy**. The band is an *expanding intraday* stdev band of
  price-vs-VWAP deviation since the session reset (`vwap.indicator.ts:33-42`),
  not a fixed rolling Bollinger-style window.
- **Regime filter:** band width ÷ `ATR(20)` (`vwapAtrRatio`) must sit in
  **[2.5, 11.5]** — identical thresholds on all four instruments
  (`strategy-provider.ts:27-29,40-42,63-65,86-88`).
- **Entry trigger — the same proximal-edge iFVG primitive already pinned in
  `knowledge/smart-money-ict.md` §1**, but computed directly on the **M1**
  window itself (not a separate H1 fetch): `calculateFVG` from
  `fvg.indicator.ts`, same algorithm as the smart-money bot, same §1.3
  sell-biased-default and `lastIFVG`-undefined-blocks-ATR-gate behavior
  inherited verbatim.
- **A different premium/discount than the smart-money bot's.** `range(v, 200)`
  (`range.indicator.ts`) is a **plain rolling 200-bar high/low window**,
  recomputed fresh each bar (no swing-anchoring, no trailing state) —
  structurally different from smart-money-ict.md §3's 60-bar swing-anchored
  *trailing* range. Sell requires **not** in discount (premium side); buy
  requires discount side — same polarity convention as the smart-money bot.
- **A sweep-style condition unique to this strategy:** sell additionally
  requires price to have broken **above the previous clock-hour's high**
  within the last 6 bars (`abovePrevHourHigh`); buy requires breaking
  **below** the previous hour's low. This is the strategy's only
  level-sweep-shaped component — the reference level is the **prior 1-hour
  high/low** (`previous-hour-lh.indicator.ts`), not a session extreme
  (`session-liquidity.md`) or a true-open level (`smart-money-ict.md` §2).
- **Risk:** same shared `RiskManager` class as the smart-money bot — identical
  stop-shrink table (`<2.5`→×0.5, `2.5–3`→×0.7, else ×1), identical trail
  (`>1R`→breakeven, `>2R`→+1R), identical daily caps (max 2 losers / 1 winner,
  1 open order per direction). **Target differs:** fixed **3.0R**
  (`TARGET_RISK_REWARD_RATIO = 3`, vwap-strategy.ts:28) vs the smart-money
  bot's 2.7R.
- **Per-asset differences are in timing only**, not in mechanic or
  thresholds. US100/US500 share one set of windows pulled from an **external,
  not-in-repo dynamic config** (`config.FOREX_TIMINGS` /
  `config.FOREX_ORDER_ALIVE_TIMINGS`, `strategy-provider.ts:25-26,38-39`) — an
  S3 object (`ConfigClient.getObject`, `telegram-bot-config/dynamic_config.json`)
  this project cannot currently read (no AWS credentials in this environment
  either — see below). EURCHF/GBPCHF have hardcoded, asset-specific, very
  narrow windows: EURCHF entry 03:02–03:20 NY / alive 03:00–04:00 NY; GBPCHF
  entry 03:03–03:20 NY / alive 03:00–05:00 NY (`strategy-provider.ts:51-62,74-85`).
- Confirmed: `StrategyProvider` injects **only `CapitalComClient`** — the
  Binance client elsewhere in this bot is entirely irrelevant to this
  strategy. All four instruments are Capital.com CFDs.

**Why this needs an Architect decision before Researcher touches it:**

1. **It reuses a primitive with a standing null (the proximal-edge iFVG,
   `smc.md` §3 encoding #4) inside a third distinct composition** — not the
   smart-money bot's H1-bias→M1-iFVG shape, and not session-liquidity's
   session-extreme-sweep shape. It needs its own `knowledge/` entry, not a
   silent variant of either.
2. **Same "contests a standing null with hand-picked, unpublished-data
   parameters" trigger `session-liquidity.md` §8 and the smart-money ruling
   both used** — the VWAP-ratio band `[2.5, 11.5]`, the ATR-ratio cap `8`, and
   all four timing windows were tuned by eye on the user's own unpublished
   history, and the mechanic overlaps two already-closed/killed families
   (proximal-edge iFVG entry; prior-hour sweep-and-reversal, the same shape
   `session-liquidity-v5-ny` killed for session-level sweeps). One
   pre-registered pass, one shot, same standard.
3. **Direct overlap with the already-existing, currently-paused
   `research/vwap-mr-indices/` package** — that package studies VWAP
   mean-reversion on **CME index futures** (ES/NQ/YM), paused pending a paid
   data-vendor decision, currently routed to a Pine-Script-manual-TradingView-test-only
   path (no Python backtest, no spend). This bot's VWAP strategy trades
   **US100/US500 as Capital.com CFDs**, not CME futures, and adds two forex
   legs (EURCHF/GBPCHF) that package never touched. Same underlying anchor
   (VWAP) and two shared instruments (Nasdaq/S&P), different venue, different
   broker-vs-exchange cost structure, different entry mechanic entirely (this
   bot fades VWAP-band stretches with an iFVG+sweep trigger;
   `vwap-mr-indices` is a plainer band-touch mean-reversion). Architect
   ruling: **keep separate, do not merge registrations** — a result on one
   cannot support the other, but Researcher must reuse `vwap-mr-indices`'s
   Capital.com/CME data-vendor findings rather than re-deriving them from
   scratch (see data question below).

**Data — resolved 2026-09-12:** user supplied `CAPITAL_COM_API_KEY`,
`CAPITAL_COM_IDENTIFIER`, `CAPITAL_COM_CUSTOM_PASS` (now in
`cmc-bot-main/.env`, gitignored, not committed) — Researcher pulls real
historical CFD data through the bot's own `CapitalComClient` on all four
instruments. Binance is irrelevant here (no crypto leg). The two index
instruments' timing windows were given directly by the user rather than read
from the bot's S3 config (user declined AWS access): entry **09:40–11:40
NY**, alive **09:40–14:30 NY**, both provisional — user flagged these for
revisiting after a first test, not a verified reading of the bot's live
config. Capital.com's broker-specific spread/financing costs remain a
standing caveat (non-exchange, not portable) for Stage 1's cost model
regardless of credential access.

**Dispatched to:** Architect, same session, for an architecture note +
routing plan (new `knowledge/` entry, Researcher scope pending the data
question, relationship to `vwap-mr-indices` and the smart-money bot).
