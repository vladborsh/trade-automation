# Ideas backlog

Raw trading ideas not yet dispatched to a Researcher/Architect task. The
Architect should read this at its next decision gate (see
`research/intraday-mr-smc/ARCHITECT-NOTE.md` §4 step 4) and decide whether/when
to route any of these, rather than treating them as pre-committed work.

---

## VWAP mean-reversion, US index futures (ES/NQ/YM)

**Status:** dispatched to Architect for routing (user requested launch,
2026-08-26) — explicitly confirmed to include Nasdaq (NQ, Nasdaq-100 futures)
as one of the three instruments.

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

**Open questions for whoever picks this up:**
- Trigger definition: needs its own design pass — candidates include
  range/structure breakout, MA/MACD crossover, ROC or RSI threshold
  continuation. Should not just inherit the MR candidate's 2σ trigger inverted
  (that's what the narrow probe already covers) — a well-designed momentum
  entry may look nothing like an inverted mean-reversion entry.
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
