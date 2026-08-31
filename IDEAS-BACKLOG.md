# Ideas backlog

Raw trading ideas not yet dispatched to a Researcher/Architect task. The
Architect should read this at its next decision gate (see
`research/intraday-mr-smc/ARCHITECT-NOTE.md` §4 step 4) and decide whether/when
to route any of these, rather than treating them as pre-committed work.

---

## Session-liquidity sweeps (Asia/London/NY), iFVG vs BoS confirmation

**Status:** **phase 1 methodology REJECTED after review, full redo in
progress (2026-08-31)** — see `RESEARCH-LOG.md` Запись 11. The
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
