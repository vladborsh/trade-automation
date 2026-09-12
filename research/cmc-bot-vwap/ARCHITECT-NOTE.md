# Architect note — `cmc-bot`'s VWAP band-reversal strategy

## 1. What this idea is, and what it is not

The user's pre-existing `cmc-bot-main` ships a second, independently coded
strategy — `VWapStrategy` — alongside the smart-money ICT bot already ruled
on (`research/cmc-bot-smart-money/ARCHITECT-NOTE.md`). It is live-traded on
four Capital.com instruments (US100, US500, EURCHF, GBPCHF) via
`StrategyProvider`. The user wants it reproduced and measured, same ask as
the smart-money bot.

Full mechanical detail is pinned in the new `knowledge/vwap-band-reversal-ict.md`
— read that, not this summary, before designing the research pass. This note
covers classification, routing, and the data-access gate.

**It is not a variant of anything already in this project's knowledge base.**
It shares primitives with two closed/tested families but composes them
differently:

- The **entry trigger** (proximal-edge iFVG) is the identical primitive
  behind `smc.md` §3 encoding #4 and the smart-money bot — a family whose
  siblings #1–#3 are closed as statistically indistinguishable from noise.
- The **sweep condition** (break of the *prior clock hour's* high/low) is
  structurally the same shape as `session-liquidity.md`'s sweep-then-confirm
  mechanic, whose session-extreme version was killed under pre-registration
  (Запись 18, iFVG holdout mean net R −0.26, beaten by a matched-time placebo
  91% of the time).
- The **regime/bias filter** (VWAP band width and side) is genuinely new to
  this project's pinned vocabulary — neither `session-liquidity.md` nor
  `smart-money-ict.md` has a VWAP-band component.

Three ingredients, none of which is new in isolation, combined into a
composition this project has not measured. That is exactly the situation
`session-liquidity.md` §8 and the smart-money ruling both treat as requiring
pre-registration, not a descriptive pass — see §3 below.

**It is also not `research/vwap-mr-indices/`.** That package designs VWAP
mean-reversion for **CME index futures** (ES/NQ/YM) — a plain band-touch
reversion mechanic, no iFVG, no sweep condition, currently paused pending a
paid data-vendor decision, routed to a Pine-Script-manual-TradingView-test-only
path (no Python backtest, no spend, per its own `ARCHITECT-NOTE.md` §4
Stage 0/1/2 gating). This bot's VWAP strategy trades **US100/US500 as
Capital.com CFDs** (not CME futures) plus two forex pairs that package never
touched, and its entry mechanic is materially different (iFVG + prior-hour
sweep + VWAP-band regime filter, vs. a plainer band-touch reversion). Same
anchor, same two index names, different everything else. **Ruling: keep the
two ideas' registrations separate** — a result on one must not be read as
supporting the other — but Researcher must reuse `vwap-mr-indices`'s
already-done Capital.com/CME data-vendor legwork rather than re-surveying
data vendors from scratch (§4 Stage 0 below).

## 2. What the code actually does — corrections against the raw backlog description

Reading the source directly (same discipline the smart-money ruling used —
that ruling caught four things the backlog summary got wrong) surfaces one
naming trap worth calling out explicitly: `getHighTimeFrameBias`
(`vwap-strategy.ts:268`) does **not** fetch a higher timeframe. It fetches
**M1** candles from UTC midnight to the current bar — i.e. it is a
same-timeframe, session-anchored VWAP band read at M1 resolution. Anyone
porting this strategy from the method name alone would build the wrong bias
engine (an H1 VWAP) rather than the one the bot actually runs (an M1,
session-VWAP band). `knowledge/vwap-band-reversal-ict.md` §2 documents the
corrected reading.

Second: despite an identical variable name (`range`, `rangeHigh`/`rangeLow`,
`priceInDiscount`) to the smart-money bot's premium/discount machinery, this
strategy's `range(v, 200)` is a **plain rolling 200-bar high/low window**
with no trailing/swing state — structurally different from the smart-money
bot's 60-bar swing-anchored *trailing* range (`smart-money-ict.md` §3). Do
not let the shared name imply a shared computation; §5 of the new knowledge
file documents both.

Full breakdown — VWAP/band construction, bias polarity, the ATR-ratio
regime filter, iFVG entry, premium/discount, the prior-hour sweep, risk
management, and per-instrument timing differences — is in
`knowledge/vwap-band-reversal-ict.md` §1–§9.

## 3. Standard: pre-registered, not descriptive

Same reasoning as the smart-money ruling, and the same trigger
`session-liquidity.md` §8 names ("arguing with a null, or acting on a cut
somebody chose by eye, is not descriptive"):

- The VWAP-ratio band `[2.5, 11.5]`, the ATR-ratio cap `8`, and all four
  timing windows were hand-picked by the user on unpublished data.
- The mechanic overlaps two already-adjudicated families: the proximal-edge
  iFVG entry (closed siblings in `smc.md` §3) and a prior-hour-sweep shape
  whose session-level analogue was killed with a strong negative result
  (session-liquidity-v5-ny).

**One pre-registered pass, one shot** — a miss is a kill, not a rework, same
standard as the smart-money bot.

**Thresholds, fixed now** (mirroring the smart-money ruling's structure —
Researcher does not choose these at fit time):

- **Kill** if holdout mean net R **< +0.05R** or placebo `p > 0.20`.
- **Build only if all** of: mean net R **≥ +0.10R**, `p ≤ 0.0125`
  (Bonferroni /4 — four instruments), fit agrees in sign, `n_holdout ≥ 150`
  per instrument, the 90% day-block bootstrap interval excludes 0, and gross
  expectancy > 0.
- Per-instrument verdicts, not a pooled one: US100, US500, EURCHF, GBPCHF are
  different asset classes (index CFD vs forex CFD) with different cost
  structures and, per §5 below, possibly different data feasibility
  entirely. A pass on one instrument does not imply a pass on another.

## 4. Data access — resolved 2026-09-12

**Route chosen: (1), real Capital.com data.** The user supplied the three
Capital.com credentials directly (`CAPITAL_COM_API_KEY`,
`CAPITAL_COM_IDENTIFIER`, `CAPITAL_COM_CUSTOM_PASS`), now stored in
`cmc-bot-main/.env` (gitignored, never committed). Researcher pulls real
historical CFD data through the bot's own `CapitalComClient` on all four
instruments. Binance is not used — this strategy has no crypto leg.

**US100/US500 timing windows: given directly by the user, not read from AWS
S3.** The user does not want to grant AWS access; instead they specified the
values by hand, so `config-client.ts`'s S3 object is bypassed entirely for
this pass:

- `timings` (entry window): **09:40–11:40 America/New_York**.
- `orderAliveTimings` (force-close window): **09:40–14:30 America/New_York**.

These are **user-specified, provisional values, not read off the bot's live
S3 config** — the user explicitly flagged them as a first pass to be
revisited after testing ("потом протестируем поменяем если что"). Treat them
as this pass's pinned parameters, not as a verified historical-accuracy claim
about what the bot has actually been live-trading. `knowledge/vwap-band-reversal-ict.md`
§8 records this same caveat.

**Broker-cost caveat still stands regardless of credential access:**
Capital.com is a CFD broker, not an exchange — spread/financing costs are
broker-specific, not reproducible/portable the way an exchange tape is (same
objection already on record in this backlog's "cash-open indices" spin-off
entry for the smart-money bot's index path). Stage 1's cost model must use
Capital.com's actual historical spread data where available, and state
plainly wherever it has to assume a fixed spread instead.

**Stage 0 data work is now unblocked.**

## 5. Routing plan

### Stage 0 — Researcher: parity proof

- Verify per-instrument Capital.com history depth/coverage before designing
  anything (same discipline as every other data-source survey in this
  project) — confirm all four instruments (US100, US500, EURCHF, GBPCHF) have
  enough 1-minute history for a fit/holdout split before committing to a
  sample-size plan.
- **Bug-faithful Python (or Pine) reproduction with bar-for-bar parity
  against the TypeScript**, plus a signal inventory — no performance number
  yet. Same Stage-0 discipline as the smart-money bot (`RESEARCH-LOG.md`
  Запись 19's Stage 0), including prefix-causality verification for the
  VWAP band, the M1 "high-timeframe" bias, the 200-bar range, and the
  prior-hour sweep.

### Stage 1 — Researcher: the pre-registered test (conditional on Stage 0 parity)

- Apply §3's thresholds, per instrument.
- **Inadmissible:** the bot's own in-repo backtest results — same reasons as
  the smart-money bot (no costs/spread/slippage modelled, close-only exits,
  gapped-through stops clamped to the exact stop price) — see
  `knowledge/vwap-band-reversal-ict.md` §0.
- Report the daily 2-loss/1-win caps' effect on the trade population
  explicitly (same path-dependence flag as the smart-money ruling), and
  report the forex pairs' very narrow (17–18 minute) entry windows'
  effect on sample size honestly before drawing any conclusion from a thin
  `n_holdout`.

### Explicitly not routed yet

- Software Engineer / Backtesting / Integration Engineer — engage only on a
  REAL EDGE verdict, per instrument, same gate as the smart-money bot.
- Any spend on Capital.com or AWS data access — not authorised without the
  user's explicit answer to §4.

## 6. Knowledge base

New file: `knowledge/vwap-band-reversal-ict.md` — not a section of
`smart-money-ict.md` (different bias engine, different premium/discount
window, different sweep reference, different instruments) and not a section
of `session-liquidity.md` (no session-extreme sweep, and this project's
"session liquidity" vocabulary specifically means wide session
high/low windows, not a rolling clock-hour). Cross-referenced from both
existing files is left to a follow-up edit if a future pass needs it — not
done in this pass to avoid churning files this ruling doesn't require
touching.
