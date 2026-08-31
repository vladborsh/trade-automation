# Hand-off: Researcher → Architect (session-liquidity, phase 1)

**Executes:** the descriptive phase-1 dispatch — sweep frequency, iFVG-vs-BoS
overlap, reverse-move magnitude, charts at every step, plus the Pine indicator.
Protocol was descriptive by explicit user decision: **no permutation null, no
kill rule, no gate, no holdout**. Nothing in this package should be cited as
evidence that the idea passed or failed anything.

**Reads as authoritative:** `knowledge/session-liquidity.md`. That file has been
**updated by this pass** with the nine mechanical defaults (D1–D9) it was silent
on, per its own instruction to keep it current.

**Reuses, unmodified:** `research/intraday-mr-smc/indicators.py` (`fractals`,
`atr`) and the cached 5m pull in `research/intraday-mtf-smc/data/`. No new data
was fetched, nothing in either package was touched.

**Read first:** `REPORT.md` §2 (headline numbers), then §5 (what stands out) and
§6 (doubts). §1 is the pinned-defaults table you will need before designing
anything. `RUNBOOK.md` is for the user's manual chart audit, not for you.

---

## The answer to the backlog's open question

The backlog asked which of iFVG or BoS confirms a sweep. **The premise was
slightly wrong: they are not two readings of the same event.** Over 20,999
take-outs:

| | share |
|---|---|
| BoS only | 37.9% |
| iFVG only | 22.5% |
| both | 16.1% |
| neither | 23.5% |

Requiring both keeps 16% of take-outs. Accepting either keeps 77%, which is
barely a filter. When both do fire, **iFVG is first 82% of the time**, median 6
bars (30 min) earlier.

On the only comparison not contaminated by the definitions themselves — measured
from the **confirmation close**, stop at the sweep leg's running extreme:

| method | n | stop (ATR) | median R over 2h | reach 1R | reach 2R |
|---|---|---|---|---|---|
| iFVG | 8,108 | 2.53 | **0.81** | 41.1% | 15.0% |
| BoS | 11,336 | 3.76 | 0.47 | 20.8% | 5.5% |

**iFVG is the better candidate trigger**: earlier, tighter stop, roughly double
the 1R hit rate. Neither is a green light — median R below 1 with no costs
modelled is a starting point, not an edge.

---

## Three things that should shape your design

1. **The wick-extreme reference flatters both methods, and the report's T5 is a
   trap.** BoS-confirmed events show 4.2 ATR "reverse move" because a bearish BoS
   *is* a close below a prior pivot — the move is in the definition. iFVG events
   show a large *continuation* because the strict gap rule needs an impulse
   beyond the level first. **Design against T12/T13 (from the confirmation bar),
   not T4/T5.** If you want a different entry reference than the confirmation
   close, say so and it can be measured — the event file has every bar index.

2. **The session prior is a lift story, not a level story.** In raw ATR, NY is
   the *worst* session and London the best. Normalised by each clock session's
   own unconditional 2h volatility, NY (1.29/1.32) and Asia (1.27/1.36) lead and
   the London/NY overlap trails badly (1.11/1.20). If the design uses a session
   filter, it should filter on the lift ranking and it must decide whether it
   means the session the *level* came from or the session the *take-out* happened
   in — those are different columns and the numbers differ. The 21:00–24:00
   off-session bucket has the highest lift of all (1.30/1.38, 15.5% of events);
   it was not in the hypothesis and I have not investigated it.

3. **Two pinned defaults are load-bearing and are yours to accept or change.**
   - **D5 (iFVG location):** strict = 38.6% confirmation rate, relaxed = 47.5%
     (T11). A design must state which.
   - **D4 (confirmation window = 2h):** p90 of the delay distribution sits at 22
     of 24 bars, i.e. pressed against the cap. Widening it adds events and
     lengthens the average delay; the current numbers are conditional on 2h.

---

## What I did not do, and would need a fresh dispatch for

- **A matched control.** Take-out bars are new-extreme bars, so part of the 1.25×
  lift over the unconditional baseline is a range artefact. Separating "sweep
  behaviour" from "big bar behaviour" needs a control matched on ATR-normalised
  bar range with no level in reach. This is the first thing I would measure next
  and it is the honest caveat on every magnitude number in the package.
- **Anything with costs, exits, sizing, or a holdout.** Phase 3 (backtest) per the
  agreed flow.
- **Multi-level events.** 18% of take-outs hit ≥2 levels; D2 collapses them. If
  "swept three levels at once" should be a stronger signal, that hypothesis is
  untested here (the raw count is in the event files as `n_levels_taken`).
- **Compiling the Pine script.** Written against the v6 reference, mirrors the
  Python definitions, never pasted into TradingView. The user's audit is its
  first compile; `RUNBOOK.md` §4 is the checklist.

---

## Suggested routing

Architect → strategy/entry design using iFVG as the primary trigger, the T12/T13
geometry as the entry/stop basis, and an explicit decision on D4/D5 and the
session filter. Then Researcher again for the backtest (phase 3), at which point
I would re-propose the staged/kill-rule discipline — it was set aside for this
descriptive pass by user decision, but a backtest without it is how the last
three ideas produced numbers nobody could trust.

**Artifacts:** `REPORT.md`, `results/` (13 tables + 21k-row event files),
`viz/` (8 worked examples + 8 statistical charts), `session_liquidity.pine` +
`RUNBOOK.md`, `engine.py` / `tables.py` / `charts.py` / `examples.py` /
`common.py`. Logged as RESEARCH-LOG.md Запись 10.
