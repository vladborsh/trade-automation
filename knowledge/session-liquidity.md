# Session liquidity & liquidity sweeps — v2 definitions

Canonical definitions for the session-liquidity idea. **This file was reissued
wholesale on 2026-08-31** after the user rejected several phase-1 methodology
choices on seeing worked examples (`RESEARCH-LOG.md` Запись 11). The phase-1
definitions and their D1–D9 defaults ledger survive only inside
`research/session-liquidity/` (REPORT.md §1) for reference — **do not build on
them**. Keep this file updated if any definition changes during implementation.

## Sessions (non-overlapping — v2 change)

The London/NY overlap of the standard forex convention is **removed** (user
decision: confusing). The trading day is partitioned into four contiguous,
non-overlapping UTC blocks:

| block | UTC window | produces session levels? |
|---|---|---|
| **Asia** | 00:00–08:00 | yes |
| **London** | 08:00–13:00 (ends when NY begins) | yes |
| **New York** | 13:00–21:00 | yes |
| **Late** | 21:00–24:00 | **no** — residual block; sweeps may happen and are measured in it, but it defines no levels |

Wide full-session windows, not narrow killzones, as before. London is now 5h
(shortened at the NY boundary) while Asia/NY are 8h — a deliberate asymmetry,
chosen over shortening NY because the phase-1 lift ranking put NY at the top
and London at the bottom of the three. Fixed UTC, no DST handling (24/7 crypto
tape; the convention is imposed on the tape, not a property of it).

Two session labels, never conflated:
- **`level_session`** — whose liquidity was taken (Asia / London / NY).
- **`sweep_block`** — the clock block the take-out happens in (Asia / London /
  NY / Late).

## Session liquidity

Within a level-producing session's window, the high and low price reached =
that session's liquidity. Visualized as a rectangle (high / low / window start
/ window end).

## Measurement horizon (v2 change — replaces the fixed 2h)

The fixed 2h post-sweep horizon is **dropped** (user decision). All
post-take-out measurement is **block-scoped**: from the take-out bar to the
**end of the `sweep_block` the take-out occurs in**. A sweep early in a block
gets most of that block; a sweep near block end gets a short window.
Consequences, pinned:

- Report the window-length distribution alongside every magnitude table.
- Primary tables use events with **≥ 12 bars (1h) remaining** in the block;
  the full sample including short-window events is reported in an appendix,
  never silently dropped.
- Report both the **within-window extreme** (max favorable / max adverse
  excursion) and the **end-of-window value**.
- Rejected alternatives, for the record: "until the next session starts" is
  identical under the full partition; "until price re-enters the swept range"
  makes the horizon a function of the outcome being measured and was rejected
  for that reason.

## Measurement units

**ATR(14, 5m) multiples remain the primary unit** (confirmed with the user
2026-08-31 after discussion: raw % breaks cross-asset comparison — SOL looks
~2× BTC purely through asset-level volatility). Raw % is reported as the
secondary column, per asset.

## Liquidity sweep

A sweep = a session level is taken out (a wick beyond the level is
sufficient — close-through not required) and price then reverses, confirmed
by a detection method. **v2 scope: iFVG only.** BoS is a separate later pass —
its phase-1 mechanic was found defective (see
`research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md`) and its v2
definition is deliberately NOT pinned here yet.

### iFVG (inverted Fair Value Gap) — v2

Standard 3-candle FVG: a gap between candle 1 and candle 3 (candle 2's range
inside the gap). It becomes an **iFVG** when price later fully **closes**
through the far edge of the gap with candles in the opposite direction
(partial pokes do not count).

- **Location (relaxed — user override 2026-08-31):** the gap merely
  **reaching beyond** the swept level counts (phase-1's strict
  whole-gap-beyond reading is retired to a sensitivity row).
- **Timing (block-scoped, replaces phase-1's 2h windows):** the FVG's third
  bar AND the inversion close must both occur within
  `[take-out bar, end of the take-out's sweep_block]`. A take-out whose block
  ends before confirmation completes is an unconfirmed event.
- Sweep rule: an iFVG forming above the session high in the bearish direction
  = sweep of the high; mirror for the low.

## Reference-level scope ("which levels can be swept")

Unchanged from phase 1: a session's price action is checked against **all
unswept levels from the last 2 days** (today's earlier sessions plus all of
yesterday), not just the same session on the prior day.

## Pinned mechanical defaults (v2 ledger)

Carried, changed, or removed relative to the phase-1 D1–D9 ledger — any later
pass that deviates must say so explicitly:

| # | Point | v2 default | vs phase 1 |
|---|---|---|---|
| V1 | When a level becomes sweepable | first bar **after** its session window closes | = D1 |
| V2 | Attribution when one bar takes out several levels | largest-excursion level wins; ties → most recently closed session; all levels taken retired; `n_levels_taken` recorded | = D2 |
| V3 | Overlap handling | **removed** — sessions are non-overlapping by construction | replaces D3 |
| V4 | Confirmation / measurement window | **block-scoped** (end of `sweep_block`); primary tables require ≥ 12 bars remaining | replaces D4 (2h) and D6 |
| V5 | iFVG location | **relaxed** (gap reaches beyond the level); strict = sensitivity row | D5 as overridden |
| V6 | BoS mechanic | **not pinned** — deferred to the BoS correction pass | replaces D7 |
| V7 | Re-sweeping a level | not allowed — retired on first take-out | = D8 |
| V8 | Level lifetime | 48h from session close, then expired unswept | = D9 |

## Research protocol notes

The v2 redo is **descriptive**, like phase 1 (user's standing call): no
permutation null, no kill rule, no pass/fail gate. Frequency and magnitude of
iFVG-confirmed sweeps under the v2 definitions, with charts/diagrams at every
step — including a 10×10-style worked-example gallery (the format that
surfaced the phase-1 problems; see
`research/session-liquidity/examples_10x10.py`). Assets: BTC/ETH/SOL/BNB, 5m.
Flow: Researcher (v2 descriptive redo, iFVG only) → user review of worked
examples → BoS correction pass → Architect (strategy design) → Researcher
(backtest). The phase-2 `STRATEGY-DESIGN.md` written against phase-1 numbers
is provisionally invalidated and must be re-derived after the redo.

Deliverables per pass: Python analysis engine + tables + charts, and an
updated Pine v6 indicator reflecting v2 definitions (non-overlapping session
rectangles, relaxed block-scoped iFVG) for the user's manual TradingView
audit.
