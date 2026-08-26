# Architect note — VWAP mean-reversion, US index futures (ES / NQ / YM)

**Role:** Architect · **Source idea:** `IDEAS-BACKLOG.md` ("VWAP mean-reversion,
US index futures"), dispatched by the user 2026-08-26 · **Log:** `RESEARCH-LOG.md`
Запись 3.
**Routing verdict up front: route to Researcher, staged, with a hard data-source
gate at stage 0. Nothing goes to Implementation. NQ is in scope per the user's
explicit confirmation.**

---

## 1. What this idea is, and what it is not

Session-VWAP mean-reversion on CME index futures (ES, NQ, YM): fade a material
stretch away from the session VWAP, target reversion toward it before session
end. This is **not** the crypto MR candidate ported to a new asset:

* different anchor (session-anchored volume-weighted mean, resetting daily, vs
  a rolling 50-bar unweighted mean),
* different claimed mechanism (institutional VWAP-benchmarked execution
  creating genuine gravitation toward the session's volume-weighted price, vs
  generic "overreaction"),
* different session structure (a tape with an open, a close, and an overnight
  segment, vs 24/7).

The backlog entry frames it as the control group for my §2.1 diagnosis in
`research/intraday-mr-smc/ARCHITECT-NOTE.md` (crypto MR fails because perp
liquidation/funding mechanics make stretches self-reinforcing). That framing
needs an honest correction before anyone starts work — see §2.

## 2. Prior evidence check — the control group has partially already run, and it hurt

Researcher-v2 (`research/intraday-mr-smc-v2/REPORT.md` §3) already ran the
**rolling-z MR candidate on US index products** (SPY/QQQ/^GSPC/^NDX, 1h RTH,
~35 months): SPY net PF **0.55** at **31% win rate**, gross 0.60 — *worse* than
crypto — while the momentum family was the only positive one there too (SPY
1.17–1.18). Two consequences for this idea:

1. **The strong version of the premise is already dead.** "MR fails on crypto
   only because of perp mechanics; remove the mechanics and reversion appears"
   is contradicted: an instrument with no funding and no liquidation cascades
   fades even worse, and the 2023–26 index tape leans momentum intraday. Whoever
   picks this up must not sell the idea to themselves on that argument.
2. **What is genuinely untested is the mechanism, not the asset class.** V2
   probed a *rolling unweighted* mean on a *coarse RTH-only 1h* tape with no
   volume weighting and no session anchoring. The VWAP hypothesis is that the
   session's volume-weighted price is a real institutional attractor
   (benchmark-execution flows) in a way an arbitrary rolling mean is not. That
   is a legitimately different signal and v2 says nothing about it. It also
   requires *fine intraday bars with volume* — which the free index data v2
   used cannot provide (Yahoo 1h RTH, ~7 bars/session, is far too coarse to
   even compute a usable session VWAP; sub-hour history there is capped at
   30–60 days).

So the idea survives, but with a lowered prior and a sharpened question:
**"does session VWAP specifically act as an attractor," not "does mean
reversion work on indices."** The stretch-off-VWAP trigger must be designed to
test attraction to VWAP, and its null result must not be double-counted with
v2's rolling-z null.

## 3. Design decisions I am fixing now (so the Researcher doesn't re-litigate them)

* **Anchor: session VWAP, RTH-anchored (reset at the 9:30 ET cash open).** The
  claimed mechanism is institutional benchmark execution, which is an RTH
  phenomenon. First pass trades RTH only; the Globex overnight segment is
  excluded from *trading* but its data is kept (it's needed for gap handling and
  is a pre-registered secondary probe, not a mined afterthought — v2's
  time-of-day lesson (fit/holdout correlation **−0.49**) applies with full
  force: every session-structure hypothesis is written down *before* results
  are seen, or not tested at all).
* **Trigger family: std-dev bands off VWAP as primary** (VWAP ± k·σ, σ computed
  volume-weighted within the session), with declining-volume-on-the-stretch as
  a single pre-registered secondary variant. Fixed tick/point distances are
  rejected — they don't scale across ES/NQ/YM's very different point values and
  vol regimes. Do **not** inherit the crypto 2σ/50-bar trigger.
* **Exit frame: revert-to-VWAP target** (that's the hypothesis — target IS the
  anchor), stop beyond the stretch extreme, plus a hard **session-end flat**
  (no overnight holds in the first pass; kills the funding/roll complexity and
  matches the mechanism's intraday claim).
* **Targets: my revised framework, as the backlog already specifies.** PF > 1.2
  net, Sharpe/Sortino > 0, ≤1%/trade, ≤2%/day (the UTC-day breaker becomes a
  *session* breaker, which v2 §3 already showed is the same thing for a US
  session), a minimum-frequency floor (≥100 trades/instrument/year — a
  session-VWAP strategy that can't find two setups a week isn't a business),
  and a pre-committed pooled minimum sample of **300 trades** before any PF is
  read. Win rate reported, not gated.
* **Stage discipline: the MTF-SMC protocol is the template**
  (`research/intraday-mr-smc/MTF-SMC-DESIGN.md` worked exactly as intended —
  pre-registered rules, signal-level probe first, stage-1 fail = death, holdout
  never read). Same here: fit/holdout split pre-committed, edge probe on
  forward returns toward VWAP before any backtest, no parameter mining across
  stages.
* **Futures-specific engine requirements** (new to this project): gap-aware
  fills are mandatory (v2's `engine_v2.py` open-beyond-stop rule; up to 25% of
  index exits were gap fills), and the price series must be a **back-adjusted
  continuous contract** with the roll methodology chosen and documented before
  results are seen — VWAP computed across a roll boundary on unadjusted prices
  is silently wrong. This is a real correctness trap and goes in the design doc
  as a named check.

## 4. Routing plan

### Stage 0 — Researcher: data-source survey, then STOP at the credential/budget gate

There is no free no-key bulk archive for CME intraday (v2 confirmed the free
tier of this space: stooq is JS-walled, Yahoo sub-hour history is capped at
30–60 days — useless for a multi-year study). The Researcher's first and only
immediate deliverable is a **concrete options memo**: Databento (likely
cheapest per-symbol for 1m OHLCV-with-volume on ES/NQ/YM over ~4 years),
CME DataMine, or any broker API the user already has (e.g. an IBKR account),
with actual price estimates, license terms (can the data be stored in our S3?
committed to the repo? — almost certainly not the latter), and minimum viable
granularity (1m bars with volume are sufficient for session VWAP; tick data is
not required for a feasibility pass).

**Then stop and ask the user.** Per the backlog's own rule: credentials or
spend require explicit user approval; synthetic or substituted data is
forbidden. The ask should present 2–3 costed options, not an open question.

### Stage 1 — Researcher: pre-registered design doc + signal probe (conditional on data)

Write the design doc (this note's §3 decisions + exact trigger/probe/kill
criteria) **before** the data arrives, MTF-SMC style. Then the edge probe:
direction-adjusted forward return toward session VWAP after a k·σ stretch, on
non-overlapping triggers, fit window only. Kill criteria fixed in the doc; a
stage-1 fail retires the idea without a backtest and without reading holdout.

### Stage 2 — Researcher: full backtest (conditional on stage-1 pass)

Gap-aware engine, session breaker, session-end flat, roll-adjusted series,
CME fee schedule + realistic index-future spread (ES is ~1 tick; NQ wider —
model per-instrument, not a flat 5 bp), pooled-first reading across ES/NQ/YM
with the 300-trade floor. Only a stage-2 pass reaches my decision gate for a
formal Backtesting-role validation.

### Explicitly not routed

* **Not Implementation** — standing rule, nothing here is buildable yet.
* **Not DevOps yet** — flags only (§6); no provisioning until stage 0 produces
  a chosen vendor and the user approves spend.

### Sequencing vs the rest of the portfolio

This idea does not collide with the open `momentum_breakout` maker-fee/funding
question from Запись 2 (still the highest-value open item at my decision gate —
unanswered, and not part of this dispatch). Stage 0 here is a cheap survey and
can run immediately in parallel with anything. One coherence rule: if both this
and a momentum follow-up end up wanting index data, **buy the data once** —
stage 0's options memo should note whether each vendor's package would also
cover a momentum-on-ES/NQ probe (v2 found the S&P side of the momentum family
positive on 35 coarse months; a finer, longer tape would sharpen that too).

## 5. Honest probability assessment

* Stage 1 signal probe shows a real attraction-to-VWAP effect (t > 2, correct
  sign, pre-registered horizon): **~15–20%**. The mechanism is economically
  real (VWAP-benchmarked execution exists at scale), which is worth something,
  but the tape this decade leans momentum intraday and v2's adjacent null cuts
  the prior. This is below the ~25–35% I gave the crypto momentum probe, and
  that one only barely survived.
* Conditional on stage 1 passing, stage 2 clears the full revised target set
  net of realistic costs: **~30–40%** (intraday holds and session-end flats
  keep costs contained; frequency floor is the likelier failure).
* Unconditional: **~5–8%** that this reaches the Backtesting role. Worth a
  staged look precisely because stage 0–1 costs are one memo, one design doc,
  one probe, and a small data purchase — not an implementation.

## 6. Infra flags for DevOps Engineer (flag only)

* **First paid market-data dependency of the project.** Whatever stage 0
  selects: credential storage (not in repo), license-compliant storage (vendor
  agreements typically prohibit committing raw data — the existing
  `data/`-gitignored + regeneration-script pattern must become
  `data/`-gitignored + *documented purchase/pull procedure*), and an S3 home
  next to the planned Binance-archive path.
* **Continuous-contract build step** (roll calendar + back-adjustment) is a new
  pipeline stage crypto never needed; if index work continues past stage 2 it
  should be a maintained dataset, not a per-study script.
* Nothing to provision now; both items activate only on a stage-0 vendor
  decision approved by the user.

---

*Hand-off: this note goes back to the dispatching Architect session for
Researcher dispatch per §4. The Researcher's stage-0 memo returns to the user
(budget/credential gate), then to me at the stage gates.*
