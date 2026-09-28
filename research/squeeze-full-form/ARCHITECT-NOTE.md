# Architect note — full-form long / short squeeze (insight-bot P1 / P2), research gate

**Date:** 2026-09-28 · **Status:** pre-registration, **dispatched to the
Researcher** through the research contour. No result exists. Inputs:
`architecture/crypto-insight-bot-2026-09-28.md` §5 (the gate the user set),
`architecture/insight-bot-system-design.md` §8.2 / §9.4,
`research/deriv-positioning/{DESIGN,REPORT}.md` and `knowledge/derivatives-positioning.md`
(crowding-squeeze arm b1 **significantly negative**, t = −4.56; redundancy
control), `research/funding-rate-signals/ARCHITECT-NOTE.md` (funding-extreme
definition §1.2, continuation arm B killed; template, costs, ladder),
`research/hedged-carry/fetch_data.py` (spot pull, µs rule),
`research/_surveys/2026-09-lightgbm-role.md` §3.2, `PROJECT.md` scope rulings
(horizon 1–5 days open). Nothing here was written with sight of a performance
number.

## 0. Why this pass exists and what would make it a build

The simple squeeze shape is **closed twice** on this project's tape: extreme
one-sided top-trader positioning + adverse break (deriv-positioning b1) and
extreme funding + trailing return + 1 h break (funding arm B) were both
negative in fit. The user's draft P1/P2 adds four filters the closed forms did
not have — funding extreme on **≥ 2 venues**, OI **+5 %/24 h at a 7-day
high**, **≥ 2 failed highs**, **spot CVD not confirming** — and a structural
15m/4h trigger with a 1–5 day hold. The brief's ruling: build P1/P2 **only if
the extra filters demonstrably rescue the shape**. So this is a *rescue*
pass with a strong negative prior, and its honest outcome is most likely a
kill that closes the squeeze family for good. Prior for a build verdict:
**10–15 %**.

## 1. The registered arms (exactly four)

| arm | side | universe |
|---|---|---|
| P1-M | short (long squeeze) | majors: BTCUSDT, ETHUSDT |
| P1-A | short | alts: SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, LINKUSDT |
| P2-M | long (short squeeze) | majors |
| P2-A | long | alts |

α = 0.05 / 4 = **0.0125** per arm. The same 8-perp universe and the same two
tiers as the funding family, so the prior reads are like-for-like.

## 2. Definitions (fixed; fit-only sensitivities never promoted)

Decision bar: the **4h close** (UTC-aligned bars from 1m). Structure and
trigger: **15m closes** inside the armed window. All observables as of the
decision bar, point-in-time.

**Funding state** (per venue, the funding family's §1.2 verbatim): rate
percentile among the last 90 settlements (`min_periods` 45); extreme-positive
iff `pct ≥ 0.90 ∧ rate ≥ +0.0003`; extreme-negative iff `pct ≤ 0.10 ∧ rate ≤
−0.0003`. **Venue count**: Binance from the archive; **Bybit** from
`/v5/market/funding/history` paged to its earliest; **OKX** from
`/api/v5/public/funding-rate-history` paged to its earliest. Where a second
venue has no history for a date, the count is over the venues that exist
**and the row is flagged**; the arm is re-read fit-only with "Binance-only
count ≥ 1" to show what the multi-venue filter contributed. Measured depth of
Bybit/OKX history is a STAGE-0 deliverable.

**OI** from `data.binance.vision` `futures/um/daily/metrics` (5 m):
`oi_d24h = OI_t / OI_{t−24h} − 1`; `at_7d_high = OI_t ≥ max(OI over 7 d)`.

**Failed highs** (P1) over the last 24 h of 15m bars: pivots (3-bar) whose high
lies within 0.5·ATR(1h,14) below the 24 h high and whose bar closed below it;
count ≥ 2. Mirror for P2 (failed lows), plus the draft's "price ≤ 1 ATR(1h)
below the local high" compression condition.

**Spot CVD not confirming** (P1): `Σ_{4h}(2·takerBuy − vol)` on **spot** 1m ≤ 0
while the perp's same sum > 0. P2 mirror: spot CVD ≥ 0.

**ARMED** (P1): extreme-positive funding on ≥ 2 venues ∧ `oi_d24h ≥ 0.05` ∧
`at_7d_high` ∧ failed highs ≥ 2 ∧ spot CVD not confirming. Armed lasts **8 ×
4h bars**. **Trigger**: 15m close below the low of the last 15m impulse leg
(the swing low preceding the current high). **Entry** at that 15m close.
**Stop**: the rejection high + 0.2·ATR(1h). **Exit**: +1R target (project
standard), **or** a 3R fit-only variant, **or** the draft's structural T1
(VWAP of the rise) as a descriptive row; time stop **5 days**. P2 mirrors
(negative funding ≥ 8 h ∧ `oi_d24h ≥ 0.03` with price flat/up ∧ spot CVD ≥ 0
∧ compression; trigger 15m close above the high with 15m volume > p70 of 24 h).

**Costs**: 0.10 % round trip taker, `cost_R = 0.001 × entry / stop_dist`;
funding collected/paid at settlements inside the hold as a P&L leg (funding
family §4.2 accounting). Same-bar stop and target → stop.

## 3. Controls (gating)

1. **Price shadow, mandatory**: every arm re-run with the funding-and-OI
   conditions replaced by their price shadow — trailing 24 h return percentile
   on the same 90-slot window at the same thresholds — keeping the structural
   trigger. An arm that does not beat its shadow by ≥ +0.05R mean net R on the
   fit period is **"price in disguise"** whatever its own numbers.
2. **Ablation ladder (fit-only, descriptive)**: the closed simple form → + venue
   count → + OI/7d high → + failed highs → + spot CVD. This is the table that
   answers the user's actual question: *which* filter, if any, rescues the
   shape, and by how much.
3. **Matched-time placebo**: same side, same stop, same template, random
   entry days — 1,000 runs, `p` reported.
4. Frequency floor: an arm with < 60 fit-period trades is "underpowered", not
   read on the holdout.

## 4. Split, ladder, verdict

Fit from listing (funding start) to **2025-07-31**; holdout **2025-08-01 ..
2026-07-31**; tail 2026-08+ descriptive. Fit screen: an arm reads the holdout
only if fit mean net R ≥ +0.05R **and** it beats its shadow. Verdict ladder
verbatim from the funding note §8: kill `< +0.05R` or placebo `p > 0.20`;
build only with `≥ +0.10R`, `p ≤ 0.0125`, fit same sign, `n_holdout ≥ 150`,
90 % day-block bootstrap excludes 0, gross > 0, and the shadow margin. **A
kill closes the squeeze family** (P1 and P2 both) on this project; a build
hands the passing thresholds to the Architect as insight-bot's `playbook_config`
v1 and the playbook goes live only after 4+ weeks of `SHADOW` agreeing in sign.

## 5. Deliverables

`DESIGN.md` (this note restated mechanically, committed before any R),
`fetch_data.py` (reuse `hedged-carry/fetch_data.py` for spot/perp 1m and
funding, `deriv-positioning/fetch_metrics.py` for metrics; add Bybit/OKX
funding pulls with a depth log), `checks.py`, `REPORT.md` with the ablation
ladder, `HANDOFF.md`, `RESEARCH-LOG.md` Запись, `IDEAS-BACKLOG.md` status
update on the insight-bot entry. Plain-Russian summary for the user at the end
of `REPORT.md`.
