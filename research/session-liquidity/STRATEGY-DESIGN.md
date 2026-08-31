# Design: session-liquidity sweep strategy (phase 2 → phase-3 backtest spec)

**Role:** Architect · **Status:** design only — the phase-3 backtest is a
separate, later Researcher dispatch.
**Inputs:** `REPORT.md` (phase 1, this directory), `HANDOFF.md` (its three
design questions), `knowledge/session-liquidity.md` (canonical definitions,
D1–D9 as amended), user decisions of 2026-08-31: **D4 confirmed at 2h; D5
overridden to relaxed** (gap merely reaching beyond the level counts).

---

## 0. What the phase-1 numbers permit, and what they warn

Design basis is **T12/T13 — geometry from the confirmation close** — per the
handoff's explicit warning that T4/T5's wick-extreme numbers are contaminated
by the confirmation definitions themselves (a BoS *is* a completed reversal;
a strict iFVG *requires* a continuation impulse first). From that basis:

* **iFVG is the primary trigger** (median R 0.81, 41% reach 1R in 2h, stop
  2.53 ATR — versus BoS 0.47 / 21% / 3.76 ATR). BoS is retained as one
  comparison cell, not co-equal.
* **Neither method is tradable as measured** (MFE/MAE ≈ 1 over 2h, median
  R < 1, no costs). The design therefore has to buy its expectancy from
  *selection* (session filter, multi-level events) and *exit shape*, and must
  prove the purchase against a matched control — the phase-1 lift (~1.25×)
  is partly a mechanical big-bar artefact, which phase 1 deliberately did not
  separate.
* **Cost-in-R is the loudest threat.** A 2.5-ATR stop on 5m bars is roughly a
  0.2–0.3% stop on BTC; 10 bp round-trip taker cost is then ~0.03–0.05R *per
  side of geometry* — of the same order as the entire uncosted median R.
  The MTF pass measured cost_R 0.089–0.231 for 5m-scale stops; this design's
  stops are wider than those, which helps, but the bar in §5 prices it
  explicitly and nothing survives on vibes.
* **Two phase-1 caveats carried forward:** the report's geometry tables were
  computed under **strict** D5, so all phase-3 numbers are re-derived under
  relaxed D5 (expect ~47.5% confirmation rate, ~10k events / 4 assets /
  4 years ≈ 600/symbol/year before filters — selection-limited, as the report
  said); and the 21:00–24:00 off-session bucket's top lift ranking was an
  observation, not a hypothesis — it enters as part of the session filter
  below, flagged as post-hoc in origin.

## 1. The rule-set (event and entry — common to all arms)

All definitions from `knowledge/session-liquidity.md` (D1–D9, **D5 relaxed**),
computed exactly as phase 1's `engine.py` does, on BTC/ETH/SOL/BNB 5m:

1. **Event:** a session-level take-out (D1–D3, D8–D9) followed by an iFVG
   confirmation (D5 relaxed, D6) within 24 bars (D4).
2. **Direction:** the reversal direction (short after a high sweep, long
   after a low sweep).
3. **Entry:** signal on the confirmation bar's close → **fill at the next 5m
   bar's open** (project convention; phase 1 measured from the confirmation
   close, so re-derive T12/T13-style geometry from the actual fill for the
   record).
4. **Stop (all arms):** the sweep leg's running extreme (take-out bar →
   confirmation bar) ± **0.25 × ATR(14, 5m)** buffer — the structural
   invalidation phase 1's R proxy was built on.
5. One position per symbol; a new event while a position is open is skipped
   (report the skip rate). One entry per event.

## 2. Pre-registered arms (the only things run — no other exits, no scans)

| arm | exit | filter |
|---|---|---|
| **A1** | time exit: close at market 24 bars (2h) after entry; stop active throughout; no target | none |
| **A2** | target **1.5R** / stop / 2h time exit backstop | none |
| **F1** | as A1 | session filter |
| **F2** | as A2 | session filter |
| **C-BoS** | as A1, but BoS-confirmed events (D7) instead of iFVG | none |

* **A1 is the honest translation** of what phase 1 measured (the full 2h
  conditional distribution, stop-truncated). **A2** tests whether a modest
  asymmetric target (1.5R ≈ between the 41% @1R and 15% @2R hit rates)
  monetises the right tail better than the time exit.
* **Session filter (F-arms):** trade only events whose **`sweep_session`**
  (the clock session the take-out happens in — the actionable label at trade
  time) is **NY, Asia, or off-session** — the three buckets with
  volatility-adjusted lift ≥ 1.27 in T7b; London and the London/NY overlap
  (lift 1.11–1.24) are excluded. Pre-registered as one fixed set — no
  per-session sweeping. The off-session bucket's post-hoc origin is disclosed;
  the F-arms' report must show the three included buckets separately so a
  pass driven by one bucket is visible.
* **C-BoS** exists to close the method comparison with real economics on the
  same tape; it is expected to lose to A1 and is not a promotion candidate on
  its own.
* **Required split, not an arm:** every arm's results split by
  `n_levels_taken` (1 vs ≥ 2 — 18% of events). The multi-level-sweep-is-
  stronger hypothesis is read from this split; if it looks real it becomes a
  pre-registered arm in a *later* pass, not a mid-pass addition.

## 3. The matched control (mandatory — the attribution test)

Phase 1's central unresolved question: is the reversal tendency *sweep*
behaviour or just *big-bar* behaviour? The backtest answers it or the result
is unattributable:

* For each traded event, draw control bars matched on **(symbol, clock
  session, ATR-normalised 24-bar range percentile ± 5 points)** with **no
  active session level within 1 ATR** of the bar's extreme, at least 24 bars
  from any real event. Apply the identical downstream machinery to each
  control bar as if its extreme were a take-out: same iFVG-confirmation scan,
  same entry/stop/exit geometry, same engine.
* 200 control draws (event-count-matched per symbol). **The real strategy
  must beat the 90th percentile of the control distribution on pooled net
  expectancy** for the arm under judgment. An arm that makes money but does
  not beat its control is reported as "big-bar effect, not a liquidity
  effect" — potentially interesting, but it is not this idea, and it does not
  get promoted under this idea's name.

## 4. Engine, risk, discipline

* Engine `backtest.py:run` unchanged; risk rules unchanged (1%/trade,
  2%-of-day breaker — with ~600 events/symbol/year pre-filter the breaker
  will matter; report bind frequency). Fees 5 bp/side taker. Standard
  diagnostics block (long/short split, hold times, realised R distribution,
  cost_R off realised stops, skip rate).
* **The staged discipline is reinstated for this phase.** The user's opt-out
  was explicitly scoped to the descriptive pass; the phase-1 Researcher
  recommended reinstatement for the backtest, and the matched control has the
  user's assent. Concretely: **fit** 2022-08-01 → 2025-04-01, **holdout**
  2025-04-01 → 2026-08-01, all selection on fit, holdout read once for
  surviving arms. No signal-level probe stage this time — phase 1 already
  played that role descriptively; the gates here are the matched control (§3)
  and the economic bar (§5).
* Causality hygiene as in phase 1 (`checks.py` assertions carried over;
  pivots confirm k=3 late; D1 no-lookahead; prefix stability).

## 5. Pre-committed bar and kill rule

Per arm, fit window, pooled over 4 symbols:

| criterion | bar |
|---|---|
| sample | ≥ 300 trades pooled (expected to clear easily; if a filtered arm lands under, it is "unmeasurable", not tunable) |
| attribution | beats its matched control's 90th percentile (§3) |
| gross economics | pooled gross expectancy ≥ 3 × median cost_R |
| net economics | pooled net PF ≥ 1.1 |
| breadth | gross PF > 1.0 on ≥ 3 of 4 symbols |
| holdout (once, survivors only) | net PF ≥ 1.0, fit→holdout PF decay ≤ 0.15 |

No WR floor (A1's time-exit payoff shape makes WR meaningless as a gate).
**Kill rule:** an arm failing the control or the economic bar is dead — no
exit re-design, no threshold search, no session re-selection. If all five
arms die, the idea returns to the user with the measured statement and the
phase-1 descriptive value intact; the one pre-authorized follow-up question
(multi-level events, §2) goes back to backlog rather than into a rerun.

## 6. Routing

Phase 3 = one Researcher dispatch executing this spec as written (package
extends `research/session-liquidity/`; reuse phase-1 `engine.py`/`common.py`
event machinery, re-derived under relaxed D5; REPORT-PHASE3.md + HANDOFF +
RESEARCH-LOG entry per logging conventions). Escalate via ask on any
ambiguity that changes what is measured. Dispatch timing is the
user's/coordinator's call — the user's manual Pine audit (RUNBOOK.md §4) can
run in parallel and does not block the backtest, but any definition change it
produces must land in `knowledge/session-liquidity.md` *before* the phase-3
dispatch, not during it. Backtesting-role validation on untouched data
remains the promotion path for anything that survives §5.
