# Session liquidity & liquidity sweeps

Canonical definitions for the session-liquidity idea. Sorted into stable
sections (facts a later pass looks up), not a chronological log — history of
*why* a definition changed lives in `RESEARCH-LOG.md`, not here. Keep this
file updated whenever a definition changes during implementation.

## 0. Status

- **Phase 1** (`research/session-liquidity/`, fixed 2h horizon, session
  overlap, strict iFVG) — **rejected after user review**, kept on disk for
  reference only. Do not build on it. `RESEARCH-LOG.md` Запись 11.
- **v2** (`research/session-liquidity-v2/`) — reissued sessions/horizon/units
  fixed the phase-1 problems above and are still in force (§1, §6). But its
  **iFVG confirmation algorithm had its own bug** (retroactive best-pick
  across the whole window — see §5.1) that invalidated its confirmation-rate,
  delay, and from-confirmation geometry numbers. Take-out frequency and the
  window-length findings survive (they're upstream of confirmation).
  `RESEARCH-LOG.md` Записи 10–12.
- **v3 iFVG mechanic** (§5.1) — corrected, not yet re-run. This is the
  authoritative iFVG spec; anything computed under v2's algorithm is stale.
- **BoS** — never correctly measured (phase-1 mechanic was defective, v2
  excluded it entirely). Own later pass, not yet designed. See
  `research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md`.
- **PDH/PDL drill-down** (§3.2) — designed, dispatch was halted mid-run when
  the iFVG bug surfaced; partial non-iFVG output (PDH/PDL stream, sub-window
  stratification code) is salvageable once §5.1 lands.

## 1. Sessions (non-overlapping)

The trading day is partitioned into four contiguous, non-overlapping UTC
blocks (the standard forex London/NY overlap is deliberately removed — user
call, it was confusing):

| block | UTC window | produces session levels? |
|---|---|---|
| **Asia** | 00:00–08:00 | yes |
| **London** | 08:00–13:00 (ends when NY begins) | yes |
| **New York** | 13:00–21:00 | yes |
| **Late** | 21:00–24:00 | **no** — residual block; sweeps happen and are measured in it, but it defines no levels |

Wide full-session windows, not narrow killzones. London is 5h (shortened at
the NY boundary) while Asia/NY are 8h — a deliberate asymmetry, kept over
shortening NY because the phase-1 lift ranking put NY at the top and London
at the bottom of the three. Fixed UTC, no DST handling (24/7 crypto tape).

Two session labels, never conflated:
- **`level_session`** — whose liquidity was taken (Asia / London / NY).
- **`sweep_block`** — the clock block the take-out happens in (Asia / London /
  NY / Late).

## 2. Session liquidity (definition)

Within a level-producing session's window, the high and low price reached =
that session's liquidity. Visualized as a rectangle (high / low / window
start / window end).

## 3. Level classes

### 3.1 Per-session levels

The Asia/London/NY highs and lows from §1/§2 — one level pair per session per
day.

### 3.2 Previous-day high/low (PDH/PDL)

A second level class, alongside — not replacing — per-session levels (added
2026-08-31 for the drill-down pass):

- **Definition:** PDH = the high of the **entire prior UTC day (00:00–24:00)**;
  PDL = its low. Deliberately includes the Late block (deviates from "max of
  Asia/London/NY highs"): the day's true extreme can print in 21:00–24:00, and
  a level meant to read as "yesterday's high" must be the actual high. The
  share of days where Late set the extreme is reported as a diagnostic.
- **Sweepable:** from the first bar of the following UTC day (00:00).
  **Lifetime:** that following day only — superseded at the next midnight.
  Retired on first take-out (§7 V7 analog).
- **Coexistence / no double-counting:** PDH/PDL events form a **separate
  event stream** from per-session-level events — existing tables aren't
  contaminated. A single excursion may legitimately take out both the day
  level and a still-alive constituent session level at the same price; the
  day-level event records a `coincident_session_level` flag (an alive session
  level within 0.05 × ATR of the day level at take-out) so tables can split
  "pure" day-level sweeps from coincident ones. Within the PDH/PDL stream
  itself, §7 V2-style attribution applies (one bar, one event).

## 4. Reference-level scope ("which levels can be swept")

A session's price action is checked against **all unswept levels from the
last 2 days** (today's earlier sessions plus all of yesterday), not just the
same session on the prior day. Applies to both level classes (§3.1, §3.2).

## 5. Liquidity sweep — detection methods

A sweep = a level (§3) is taken out (a wick beyond it is sufficient —
close-through not required) and price then reverses, confirmed by a
detection method.

### 5.1 iFVG (inverted Fair Value Gap) — v3, corrected

Standard 3-candle FVG: a gap between candle 1 and candle 3 (candle 2's range
inside the gap). It becomes an **iFVG** when price later fully **closes**
through the far edge of the gap with candles in the opposite direction
(partial pokes never count).

**Location (relaxed — user override 2026-08-31):** the gap merely
**reaching beyond** the swept level qualifies it as a candidate (phase-1's
strict whole-gap-beyond reading is retired to a sensitivity row).

**Confirmation tracking — v3 state machine (corrected 2026-08-31).**
v2's algorithm was defective: it scanned every qualifying gap anywhere in the
block-scoped window, computed each one's inversion time, and retroactively
kept whichever confirmed *earliest across the whole set* — not what a trader
watching live would see, and structurally biased toward small gaps close to
price (they invert fastest), flattening the measured effect and contaminating
any gap-size-vs-outcome analysis. Corrected mechanic, sequential and causal
(one active candidate at a time, no retroactive comparison across the
window):

1. Starting at the take-out bar, watch for gaps that pass the location filter
   above (a candidate).
2. **Active candidate = the most recently formed qualifying gap** that has
   neither confirmed nor been invalidated yet. A new qualifying gap forming
   while the current one is still live **replaces** it (mirrors this
   project's existing order-block convention of preferring the nearest/latest
   qualifying formation over the earliest).
3. **Invalidation:** the active candidate is discarded if price **closes**
   beyond the extreme of the take-out bar itself (not the original swept
   session/day level — that's already broken by the take-out, by definition).
   After invalidation, only gaps forming **after** the invalidation bar are
   eligible — never retroactively reconsidering gaps that formed earlier.
4. **Confirmation** = a close through the far edge of the active candidate's
   gap. This is the final event — MFE/MAE and all downstream geometry are
   measured from this confirmation close to the end of the `sweep_block`
   exactly as in §6.1, unaffected by anything after confirmation (§5.1's
   invalidation rule governs *candidate selection* only, not an exit rule on
   an already-confirmed trade — that's a separate, not-yet-designed question).
5. If no candidate ever confirms before block end (repeated invalidation, or
   none form), the take-out is "unconfirmed" — unchanged from v2.

**Required deliverable when this is re-run:** an hour-of-day chart — gap
frequency by hour, and which hourly windows produce a higher confirmed-reversal
rate — alongside the usual worked-example gallery.

**Timing (block-scoped):** the gap's 3rd bar AND the inversion close must
both occur within `[take-out bar, end of the take-out's sweep_block]`. A
take-out whose block ends before confirmation completes is unconfirmed.

Sweep rule: an iFVG forming above a swept high in the bearish direction =
sweep of the high; mirror for a swept low.

### 5.2 BoS (break of structure) — not yet correctly measured

Phase-1's mechanic re-anchored its tracked level every time any new k=3 pivot
confirmed (including a late-confirming shallow pullback pivot *after* the
take-out), silently testing the wrong level — see
`research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md` for the full
defect analysis and the corrected spec sketch (pin the pre-extreme opposing
pivot at take-out time, draw/track it as a forward ray, break = close through
it, no re-anchoring). **Not pinned as a v-numbered default yet** — own later
pass.

## 6. Measurement

### 6.1 Horizon (block-scoped)

No fixed time horizon (phase-1's 2h is dropped). All post-take-out
measurement is **block-scoped**: from the take-out bar to the **end of the
`sweep_block` the take-out occurs in**. A sweep early in a block gets most of
that block; a sweep near block end gets a short window. Consequences, pinned:

- Report the window-length distribution alongside every magnitude table —
  window length is the strongest single driver found in the study so far, and
  a naive "which hour is best" cut must be stratified by window length or it
  just rediscovers the clock (relevant to §5.1's required hour-of-day chart).
- Primary tables use events with **≥ 12 bars (1h) remaining** in the block at
  take-out time; the full sample including short-window events is reported in
  an appendix, never silently dropped.
- Report both the **within-window extreme** (max favorable / max adverse
  excursion) and the **end-of-window value**.
- Rejected alternatives, for the record: "until the next session starts" is
  identical under the full partition; "until price re-enters the swept range"
  makes the horizon a function of the outcome being measured and was rejected
  for that reason.

### 6.2 Units

**ATR(14, 5m) multiples are the primary unit** (confirmed with the user
2026-08-31 after discussion: raw % breaks cross-asset comparison — SOL looks
~2× BTC purely through asset-level volatility). Raw % is reported as a
secondary column, per asset, never pooled across assets.

## 7. Pinned mechanical defaults ledger

Carried, changed, or removed relative to the phase-1 D1–D9 ledger; any later
pass that deviates must say so explicitly.

| # | Point | Current default | Section | vs phase 1 |
|---|---|---|---|---|
| V1 | When a level becomes sweepable | first bar **after** its session window closes | §1 | = D1 |
| V2 | Attribution when one bar takes out several levels | largest-excursion level wins; ties → most recently closed session; all levels taken retired; `n_levels_taken` recorded | §4 | = D2 |
| V3 | Overlap handling | **removed** — sessions are non-overlapping by construction | §1 | replaces D3 |
| V4 | Confirmation / measurement window | **block-scoped** (end of `sweep_block`); primary tables require ≥ 12 bars remaining | §6.1 | replaces D4 (2h) and D6 |
| V5 | iFVG location | **relaxed** (gap reaches beyond the level); strict = sensitivity row | §5.1 | D5 as overridden |
| V6 | BoS mechanic | **not pinned** — deferred to the BoS correction pass | §5.2 | replaces D7 |
| V7 | Re-sweeping a level | not allowed — retired on first take-out | — | = D8 |
| V8 | Level lifetime | 48h from session close, then expired unswept | — | = D9 |
| V9 | iFVG confirmation tracking | **sequential state machine** (§5.1) — latest-live-candidate, close-based invalidation against the take-out bar's own extreme, no retroactive cross-window pick | §5.1 | new, corrects a v2 implementation bug (not a phase-1 default) |

## 8. Research protocol notes

Descriptive throughout (user's standing call): no permutation null, no kill
rule, no pass/fail gate. Frequency and magnitude of iFVG-confirmed sweeps,
with charts/diagrams at every step — including a 10×10-style worked-example
gallery (the format that surfaced both the phase-1 problems and the v2 iFVG
bug; see `research/session-liquidity/examples_10x10.py`). Assets:
BTC/ETH/SOL/BNB, 5m.

**Flow:** Researcher (§5.1-corrected redo, iFVG only) → user review of worked
examples/hour-of-day chart → PDH/PDL drill-down (§3.2, 3 combos: NY sweeps
London, NY sweeps PDH/PDL, Asia sweeps PDH/PDL) → BoS correction pass (§5.2)
→ Architect (strategy design, re-derived — the phase-2 `STRATEGY-DESIGN.md`
was written against phase-1 numbers and is provisionally invalidated) →
Researcher (backtest).

Deliverables per pass: Python analysis engine + tables + charts, and an
updated Pine indicator reflecting the current definitions (non-overlapping
session rectangles, block-scoped relaxed iFVG per §5.1, optional PDH/PDL ray
toggle) for the user's manual TradingView audit.
