# Architect note — spot-lead confirmation (arm (b) of "Spot–perp basis"), insight-bot P4

**Date:** 2026-09-28 · **Status:** pre-registration, **dispatched to the
Researcher**. This is the parked arm (b) of the `IDEAS-BACKLOG.md` entry
"Spot–perp basis and spot-lead signals", dispatched now because the insight
bot's P4 label (`architecture/insight-bot-system-design.md` §9.2) is built on
its hypothesis. Engineering of the label is **not** blocked by this pass; its
use as anything more than a displayed context is. Inputs: the backlog entry,
`research/hedged-carry/fetch_data.py` (spot + perp 1m/1h pulls, the µs rule),
`knowledge/derivatives-positioning.md` §3 (redundancy control),
`research/_surveys/2026-09-lightgbm-role.md` §3.2. No performance number seen.

## 0. Hypothesis

Moves **led by spot** (spot taker-buy CVD positive and larger than perp CVD
during a 4 h advance) continue over the next 1–5 days more reliably than
moves **led by perps**; the mirror for declines. Mechanism: spot flow is
closer to organic demand, perp flow to leverage churn that funding and
liquidations later unwind. Prior for a tradeable arm clearing the bar:
**20 %** — the label is more likely to be useful as a *filter* than as an
entry, which is exactly how the bot uses it.

## 1. Definitions (fixed)

At each **4h close** on Binance 1m spot and perp klines (taker buy volume
field): `cvd_spot_4h = Σ(2·takerBuy − vol)` on spot, `cvd_perp_4h` on perp, in
base units; `ret_4h` the perp's 4 h return, |ret| ≥ 0.25·ATR(4h,14)/price to
count as a move. Labels exactly as design §9.2: `SPOT_LED` (↑, spot ↑),
`PERP_LED` (↑, spot ≤ 0, perp ↑), `ABSORPTION` (↓, spot ↑, perp ↓),
`DISTRIBUTION` (→, spot ↓, perp ↑), else `NONE`.

## 2. Registered arms (four), α = 0.0125

| arm | what is measured |
|---|---|
| L1 continuation | long at the 4h close labelled `SPOT_LED`, stop 1.5·ATR(4h) below, +1R target, 5-day time stop; **versus** the same trade on `PERP_LED` bars (the contrast is the hypothesis) |
| L2 fade | short at `PERP_LED` (leverage-led advance), same template mirrored |
| L3 absorption | long at `ABSORPTION`, same template |
| L4 filter economics | apply the label as a *filter* on the unconditional "buy every 4 h advance" baseline: does keeping only `SPOT_LED` raise mean net R by ≥ +0.05R with ≥ 50 % of trades kept (the can-only-subtract discipline of deriv-positioning) |

Universe: the 8-perp set in two tiers (majors / alts) pooled per arm; costs
0.10 % round trip; funding legs accounted; same-bar stop+target → stop.

## 3. Controls

- **Price shadow (gating)**: label recomputed with **perp CVD replaced by a
  second copy of price return** and spot CVD replaced by the perp's own CVD —
  i.e. does the *spot-vs-perp* contrast add anything beyond "up move with
  positive taker flow"? An arm that does not beat its shadow by +0.05R is
  "no second signal".
- Matched-time placebo, 1,000 runs. Frequency floor 60 fit trades per arm.
- Descriptive: label transition matrix, label persistence, and the
  contemporaneous 4 h return by label (to show the label is not just the move
  itself).

## 4. Split and verdict

Fit listing .. 2025-07-31, holdout 2025-08-01 .. 2026-07-31, fit screen and
ladder as `research/funding-rate-signals/ARCHITECT-NOTE.md` §8. Outcomes for
the bot: **build** → the label may be declared as a playbook `context_gate`
(twin-arm tested live, design §8.3) and its score weight stands; **kill** →
the label stays a displayed context with weight 0 in the score, and the
backlog entry's arm (b) is closed.

## 5. Deliverables

`DESIGN.md`, `fetch_data.py` (extend the hedged-carry pull to 1m with taker
columns), `checks.py`, `REPORT.md`, `HANDOFF.md`, `RESEARCH-LOG.md` Запись,
status update on both backlog entries. Plain-Russian summary at the end of
`REPORT.md`.
