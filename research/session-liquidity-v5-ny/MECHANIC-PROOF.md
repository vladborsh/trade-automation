# Mechanic proof — are iFVG-v4 and the pinned BoS actually implemented correctly?

**This document exists because the question is a fair one.** Three of the six
prior passes on this idea carried real implementation bugs: phase 1's BoS
re-anchored the level it was testing on every new pivot; v2's iFVG picked,
retroactively, whichever gap in the whole window inverted earliest; v3 added an
invalidation rule that was never part of the idea. Each was found, and each was
found by *looking at charts*, not by re-reading code. So "the mechanics are
right this time" is not something to take on assertion.

What follows is the audit trail: **eight hand-picked worked examples on real
BTC/ETH charts, all inside the NY session**, each drawn so that a specific way
the engine could be lying would be visible if it were happening. Alongside them
sit the machine checks that assert the same properties across all 23,423
events, because a chart shows one case and an assertion covers the rest.
Neither is sufficient alone.

**Nothing on these panels is drawn with hindsight.** Every element is
reconstructed from information that existed at the bar it is drawn on, and
`checks.py` proves that by re-deriving the same objects from a *truncated copy
of the price series* that physically cannot see the future.

---

## 0. How to read a panel

Each panel is a wide main chart plus a zoom. On both:

| element | what it is | what it proves if it behaves |
|---|---|---|
| **dashed black horizontal** | the swept session level | the boundary is fixed. It is drawn once and never redrawn — if a later bar could move it, the whole event definition would be circular |
| **dotted black vertical `t0`** | the take-out bar | everything the mechanics are allowed to know is to the left of this line at the moment of selection |
| **solid green ray** | the pinned BoS anchor, drawn from **its own pivot bar** forward to the break (or window end) | **it must be perfectly flat.** A step means the engine re-anchored, which is exactly phase 1's bug |
| **thin green dotted vertical** | the bar the anchor pivot was *confirmed* on | must be at or before `t0`, and exactly 3 bars after the pivot itself (k=3 fractal). This is what makes the anchor knowable in real time |
| **red step-line** | the level a **re-anchoring** implementation would have tested over the same window | drawn purely as contrast. Where it steps away from the green ray, phase 1 was testing a level nobody was watching at the take-out. No number in this pass uses it |
| **grey boxes, numbered** | qualifying iFVG gaps the state machine held and then **discarded** when a newer one formed | seeing the rejected candidates is the proof the winner was not cherry-picked |
| **blue box** | the gap that was active when price closed through it | it is the *latest-formed* qualifying gap at that moment — not the best one in the window |
| **orange band** | the pinned NY window, 13:40–15:20 UTC | the live filter, applied to the confirmation bar |
| **black / red / green brackets** | the pinned trade: entry, stop, +1R target | the stop is the sweep leg's running extreme over `[t0, u]` — a quantity that depends only on bars at or before the entry |

A note on what would *not* be evidence: a grey box that, in hindsight, would
have "worked better" than the blue one proves nothing. It was not the active
candidate at that moment. That is the entire content of the v4 correction and
it is why the displaced candidates are drawn at all.

---

## 1. The eight panels

All eight are in `viz/proof0*.png`. All are BTC or ETH, all are NY-session
take-outs, all have their confirmation (where one exists) inside or adjacent to
the pinned window.

### proof01 — the level did not move
`viz/proof01_bos_BTCUSDT_20220826_1300_hi.png` · BTC, 2022-08-26 13:00 UTC,
high sweep of the London high

The BoS anchor is a pivot low that printed **17 bars before** the take-out and
was confirmed 3 bars after that — so it was a known, watchable level well
before the sweep happened. The break comes **24 bars after** `t0`. Between
those two points the green ray crosses roughly forty bars of chart as **one
flat line**. If the engine re-anchored even once in that stretch, the ray would
visibly step, and it does not. Beside it, the red step-line moves several
times: those are pivots that confirmed *after* the take-out, every one of which
a re-anchoring implementation would have adopted and the pinned one ignores.

The anchor sits 7.58 ATR from the take-out wick, which is the geometric fact
that drives everything uncomfortable about the BoS arm — the stop proxy here is
10.65 ATR wide.

### proof02 — many pivots form after `t0`, and none of them count
`viz/proof02_bos_ETHUSDT_20230714_1320_lo.png` · ETH, 2023-07-14 13:20 UTC,
low sweep of the London low

This is the cleanest available picture of the difference between the corrected
mechanic and phase 1's. Inside the measurement window the red step-line moves
repeatedly as the reversal prints new pivots; the green ray, chosen at `t0` off
a pivot high 14 bars earlier, never budges. The BoS fires 5 bars after the
take-out on a close through that fixed level.

Note also the seven qualifying iFVG gaps (6 displaced, 1 surviving) marching
down the chart — the iFVG arm on this same take-out does not confirm until
**70 bars** after `t0`, far outside the NY window. One take-out, two mechanics,
two completely different answers about when to act. The pinned trade here is
stopped out at −1.13R; the panel is included because the mechanic is legible,
not because the trade worked.

### proof03 — the gap was not cherry-picked
`viz/proof03_ifvg_BTCUSDT_20251117_1300_lo.png` · BTC, 2025-11-17 13:00 UTC,
low sweep of the London low

Six qualifying gaps form in this window and five are displaced. They are drawn
in grey and numbered in formation order, so the sequence the state machine
actually walked is visible on the chart. The blue box — the one that inverted —
is simply whichever gap happened to be the latest-formed one when price closed
back through its far edge, 11 bars after the take-out.

This is precisely the picture v2's bug would have got wrong. v2 scanned every
gap in the window and retroactively kept whichever confirmed earliest across
the whole set; v4 holds exactly one candidate at a time and lets each new gap
displace its predecessor, live. `checks.py` B8 re-runs the machine on a copy of
the price series that **ends at the confirming bar** — so no later bar exists
at all — and gets the identical gap back, on 400 sampled events, zero
mismatches.

### proof04 — the simplest case, for calibration
`viz/proof04_ifvg_ETHUSDT_20240901_1340_lo.png` · ETH, 2024-09-01 13:40 UTC,
low sweep of the Asia low

Exactly **one** qualifying gap exists in the entire window. It forms after the
take-out, price closes back through its far edge, and that close is the
confirmation. There is nothing to choose between, so there is nothing to
cherry-pick — which makes this the right panel to calibrate the eye on before
reading proof03. Trade result: +1R target reached, +0.89R after fees.

### proof05 — both mechanics, one chart
`viz/proof05_ifvg_ETHUSDT_20250327_1320_lo.png` · ETH, 2025-03-27 13:20 UTC,
low sweep of the Asia low

The iFVG confirms **7 bars** after the take-out, near the swept boundary. The
BoS confirms **19 bars** after it, on a close through a ray sitting 3.86 ATR
back inside the swept range. Same sweep, same tape, two entries 12 bars and
several ATR apart, with correspondingly different stops.

This is what "confirmation is a timing / entry-reference mechanic, not a
selection filter" looks like on one chart, and it is worth seeing before
reading any aggregate table: the two methods are not two readings of the same
signal, they are two different signals that happen to share a trigger event.

### proof06 — a failure, drawn as carefully as a success
`viz/proof06_bos_ETHUSDT_20250405_1305_lo.png` · ETH, 2025-04-05 13:05 UTC,
low sweep of the London low

The anchor is 30 bars old and 8.36 ATR away, and price never closes through it
before the NY block ends. There is no BoS, no entry and no trade. The panel is
rendered by the identical code path as every confirmed one.

This matters for a reason that has nothing to do with statistics: **an audit
gallery that only shows the cases where the mechanic fires is not an audit.**
Roughly two thirds of primary take-outs look like this one for the BoS arm, and
the gallery in `results/gallery_ny/` carries unconfirmed and marked-to-market
strata for the same reason.

### proof07 — the trade template, on a loser
`viz/proof07_ifvg_BTCUSDT_20250313_1345_lo.png` · BTC, 2025-03-13 13:45 UTC,
low sweep of the London low

Entry at the iFVG confirmation close, stop on the sweep leg's running extreme
(3.00 ATR = 1R), target one stop-width away. Price takes the stop: −1.09R after
fees. Roughly 45–49% of in-window iFVG trades end exactly here, and reading one
of them in full is the fastest way to understand why the expectancy comes out
where it does.

The stop is worth staring at: it is anchored to a price that was already known
at the entry bar (the lowest low between the take-out and the confirmation), so
it is a rule an execution engine could run. It is not a hindsight-optimal stop
and it was pinned in `DESIGN.md` §4 before any R was computed.

### proof08 — the same template, on a winner, and why the arms differ
`viz/proof08_bos_ETHUSDT_20240327_1310_hi.png` · ETH, 2024-03-27 13:10 UTC,
high sweep of the NY high

The BoS breaks 9 bars after the take-out and the +1R target is reached:
+0.97R after fees. Note the stop: **8.91 ATR**. BoS stops are wide (median 5.6
ATR against the iFVG's 3.1) because a BoS by construction waits for a close
back through a level several ATR inside the swept range.

That geometry is most of why the BoS arm's net expectancy is less negative than
the iFVG arm's. A wider stop makes a fixed 0.10% round-trip fee a smaller
*fraction of the risk taken* — 0.116R against 0.192R. It is a fee-arithmetic
effect, not a better read on direction. Anyone tempted to conclude "BoS is the
better signal" from the headline table should read this panel first.

---

## 2. What the machine checks assert, across all 23,423 events

Charts show eight cases. These cover the rest. `checks.py` — **36/36 PASS**:

**The event stream is not this pass's invention.** The take-out stream and
**both** confirmation streams reproduce `research/session-liquidity-v4/` and
`research/session-liquidity-bos/` **bit for bit** — same events, same rows,
same confirmation bars, same anchor prices, on all four assets (A1–A7). So this
pass changed nothing upstream of the window filter, and any difference in its
numbers is attributable to the window, the horizon and the trade template. It
also validates the data substitution documented in DESIGN §1.1.

**The BoS anchor is causal and immutable.**
* B1/B2/B3 — on every anchorable event the anchor's pivot bar is strictly
  before `t0` (minimum gap 3 bars) and its confirmation bar is at or before
  `t0` (maximum lag 45 bars), with pivot and confirmation exactly `k=3` apart.
* B5 — **the strongest one.** The anchor is re-derived from a copy of the price
  series **truncated at `t0`**, in which no later bar exists at all. It comes
  back identical on 400 sampled events, 0 mismatches. A level that survives
  that test cannot have been chosen using future information.
* B6/B7 — a brute-force bar-by-bar scan against the *fixed* level reproduces
  the engine's break bar exactly, and no bar before the break sits on the far
  side of the ray. The level tested is one constant across the whole window.
* B10 — a structural check: the break-scan function's body assigns to no level
  variable at all (only `seg` and `hit`). It is *incapable* of re-anchoring,
  not merely observed not to.

**The iFVG gap is chosen live.**
* B8 — the state machine is re-run on a prefix that ends at the confirming bar
  and returns the same confirmation bar and the same gap. Zero mismatches.
* B9 — the confirming gap's third bar always lies in `[t0, confirmation bar)`:
  it formed after the take-out and before the close that inverted it.

**The window filter cannot look forward.**
* C1/C2 — the NY flag is exactly `[13:40, 15:20)` UTC evaluated on the
  confirmation bar's own timestamp, and the recorded minute-of-day equals that
  bar's actual clock. It is a pure function of time.
* C3 — every in-window confirmation belongs to an NY-block take-out whose `t0`
  lies in 13:00–15:15 UTC, which is the structural consequence the design
  predicted rather than a coincidence.

**The horizons and the trade arithmetic.**
* C4/C5 — the h24 horizon is exactly `min(t0 + 288, last bar)` and always
  reaches at least as far as the block horizon.
* C6 — the stop proxy is **identical** across the two horizons, because it
  depends only on `[t0, confirmation]`. Verified on 13,760 iFVG and 7,207 BoS
  events.
* C7/C8/C9 — the pinned trade template is reproduced by an independent
  brute-force bar walk (300 sampled trades, 0 differences), `cost_R` and `netR`
  are re-derived from the definition, and every `stop` exit books exactly −1R
  and every `target` exit exactly +1R.
* B13 — prefix stability: re-running the whole engine on the first 60% of the
  data reproduces every event, every flag and every R in that range.

---

## 3. The honest limits of this proof

1. **It proves the code implements the definitions. It does not prove the
   definitions are the right ones.** If `knowledge/session-liquidity.md` §5.1
   or §5.2 describes something other than what a trader means by "iFVG" or
   "break of structure", every check here would still pass. That is a question
   for the charts and for the user's eye, which is why the gallery exists.
2. **`k=3` fractals, 5-minute bars, relaxed gap location** are choices, pinned
   in the knowledge base and inherited unchanged. A different `k` or a stricter
   location rule is a different mechanic, not a bug.
3. **The stop proxy is a convention, not a trader's stop.** It was pinned to
   the sweep leg's running extreme so R stays comparable across six passes. A
   trader taking a BoS entry might stop above the swing that forms *after* the
   break instead. The BoS pass flagged that, the Architect declined it as a
   follow-up (Запись 17 §3), and it would not change the forward-lift or
   expectancy results, which never touch the stop convention.
4. **Eight panels is eight panels.** They were chosen by *mechanical* property
   — anchor age, candidate count, delay, exit type — never by outcome, and the
   24-panel stratified gallery in `results/gallery_ny/` is the un-curated
   version. But if someone wants to check a specific date, the engine writes
   every event to `results/events_*.csv` and `examples.draw_event` will render
   any of them.

**Bottom line:** the mechanics measured in this pass are the ones the knowledge
base defines, they are causal, the BoS level does not move, and the iFVG gap is
not selected with hindsight. The null result in `REPORT.md` is not a bug.
