# RUNBOOK — `session_liquidity_v2.pine`

A TradingView **indicator** (not a strategy) for manually auditing the **v2**
session-liquidity definitions on a live chart. Its only job is to let you look at
the same objects the Python engine counts and say "yes, that is what I meant" or
"no, that is not a sweep".

This is a **delta runbook**: it assumes the phase-1
`research/session-liquidity/RUNBOOK.md` and documents what is different.
Sections 1 and 2 are self-contained if you have never read that one.

---

## 0. Delta from phase 1 — read this first

| # | Phase 1 | **v2** |
|---|---|---|
| 1 | London 08:00–16:00, overlapping NY 13:00–16:00 | **London 08:00–13:00** — the overlap is gone. The day is a clean partition. |
| 2 | Three sessions | **Four blocks**: Asia 00–08, London 08–13, NY 13–21, **Late 21–24**. Late is drawn with a dotted border and produces **no levels** — sweeps happen in it and are measured, it just never contributes a high/low to the pool. |
| 3 | Fixed 2h confirmation / measurement window | **Block-scoped**: every window runs from the take-out bar to the last bar of the block it happened in. The chart marks each block end with a dashed vertical line and a label. |
| 4 | iFVG location: whole gap beyond the level (strict) | **Relaxed** — the gap need only *reach* beyond the swept level. |
| 5 | iFVG marked anywhere on the tape | Pending gaps are **invalidated at a block change**, and with `Only mark inversions that CONFIRM a take-out` on, an inversion is labelled only when a level was taken out earlier in the same block and the gap reaches beyond it — i.e. exactly what the engine counts. |
| 6 | k=3 pivot markers and `BoS↓`/`BoS↑` crosses drawn | **Removed entirely.** The phase-1 BoS mechanic was found defective (`../session-liquidity/corrections/BOS-CORRECTION-NOTE.md`) and is quarantined to its own later pass. It is removed rather than left on the chart looking authoritative. Nothing on this chart is a structure signal. |

---

## 1. Install

1. TradingView → **Pine Editor** → *Open* → *New indicator*.
2. Replace the contents with `session_liquidity_v2.pine`, **Save**, then **Add to chart**.
3. Chart settings that make the output match the study:
   - **Symbol:** `BINANCE:BTCUSDT.P` (or ETH/SOL/BNB perp) — the study used USD-M perps.
   - **Timeframe:** `5m`. The boxes work on other timeframes, but every number
     in `REPORT.md` is 5m.
   - **Chart timezone:** set to **UTC** (right-click the time axis). The
     indicator computes blocks in UTC regardless, but you will misread the
     boxes if the axis is in your local zone.

## 2. What you are looking at

| Drawing | Meaning |
|---|---|
| Coloured rectangle, **solid** border | a level-producing session's realised range: orange Asia 00–08, blue London 08–13, purple NY 13–21 UTC. Grows while open, freezes when it closes. |
| Grey rectangle, **dotted** border | the **Late** block 21–24 UTC. Shown so you can see where you are in the day; it produces no levels. |
| Dashed vertical line + `… block ends` label | a block boundary. Every measurement and iFVG window for a take-out inside the block to its left stopped here. **This is the v2 horizon made visible.** |
| Dashed horizontal ray | an **unswept** session high/low still in the 48h pool, drawn from its session's close and extended each bar. |
| Ray turning grey/dotted | that level left the pool — taken out, or expired at 48h. |
| `sweep ▲` / `sweep ▼` label | this bar's wick took out at least one pooled level. The tooltip gives the deepest level taken **and names the block whose end closes the window**. |
| Teal / maroon box | a 3-candle FVG (bullish / bearish), attributed to its 3rd bar. |
| Box turning red/green, `iFVG↓` / `iFVG↑` | that FVG was **inverted**: a bar CLOSED fully through its far edge. A wick into the gap does nothing. |
| Label reading `iFVG↓ sweep` / `iFVG↑ sweep` (opaque) | the inversion **confirms a take-out** earlier in the same block, with the gap reaching beyond that level. This is the event the engine counts. Faint `iFVG↓`/`iFVG↑` labels are inversions with nothing to confirm. |

## 3. The one thing that will confuse you

**A gap that is still pending when the block ends disappears.** That is
deliberate, not a drawing bug: V4 says the iFVG window closes with the block, so
a gap formed at 20:50 UTC cannot be inverted "into" the Late block and count.
You will see FVG boxes vanish at every block boundary. The engine does exactly
the same thing, and `REPORT.md` T3 quantifies what it costs (**23% of all
unconfirmed take-outs would have confirmed given 2 more hours**).

Phase 1's pivot-repaint caveat no longer applies — there are no pivots on this
chart.

## 4. Verification checklist (please actually run this)

The script has **not been compiled by the author** — your first paste is its
first compile. Report anything that errors. Then, on BTCUSDT.P 5m:

1. **Blocks partition the day.** Pick a day. Do the boxes start/end at 00:00,
   08:00, 13:00 and 21:00 UTC, with **no overlap and no gap** between them?
   Does the London box now end at 13:00, not 16:00?
2. **Late produces nothing.** After the Late box freezes at 00:00 UTC, do
   **no** new rays appear at its high and low? (Asia, London and NY must each
   produce two.)
3. **Levels.** After a level-producing session closes, do two rays appear at its
   high and low? Does a ray stop extending the moment a wick crosses it?
4. **Sweep labels.** Is a `sweep` label printed on the bar whose *wick* — not
   close — crossed the level? Does its tooltip name the right block?
5. **Block ends.** Is there a dashed vertical line at every 08:00 / 13:00 /
   21:00 / 00:00 UTC, and nowhere else?
6. **FVG geometry.** Pick a visible gap: is the box bounded by candle 1's high
   and candle 3's low (bullish), and drawn on candle 3?
7. **Inversion strictness.** Find a bar that wicks deep into an FVG but closes
   back inside it — the box must **not** flip. Only a full close-through flips it.
8. **Relaxed location.** Turn `Only mark inversions that CONFIRM a take-out`
   **on**. Find a confirmed sweep and check the gap only has to *reach past* the
   swept level — it does not have to sit entirely beyond it. (Phase 1 required
   the whole gap beyond; that reading is now a sensitivity row, REPORT.md T11.)
9. **Block-scoped timing.** Find a take-out late in a block. Confirm that an
   inversion happening *after* the block boundary is **not** labelled as
   confirming it.

If 1–9 all look right, the Python engine and the chart are measuring the same
objects, and the numbers in `REPORT.md` describe what you see.

## 5. Deliberate differences from the Python engine

The chart is a *viewing* instrument; a few study rules are omitted because they
would clutter it without helping the eye:

- **No V2 attribution collapse.** When one bar takes out several levels the chart
  labels the bar once and the tooltip names the deepest level, but the engine
  additionally records `n_levels_taken` and emits exactly one event.
- **Take-out memory is per-side, not per-event.** The chart remembers the
  deepest high-side and lowest low-side level taken so far in the block; the
  engine tracks each take-out individually. In practice they agree, but on a
  block with several take-outs on the same side the chart's `sweep`-confirming
  test is the more permissive of the two.
- **No ≥12-bars-remaining filter.** The chart marks every take-out. The primary
  tables in `REPORT.md` use only those with ≥1h of block left; the rest are the
  appendix sample (A1/A2).
- **No measurement overlays.** Reverse move, MFE/MAE, ATR multiples, the stop
  proxy and R live in the Python outputs and in the `viz/` gallery only.

## 6. Inputs worth touching

- `Only mark inversions that CONFIRM a take-out` — **the switch that matters**.
  Off shows every inversion (so you can see what the sweep test filters out);
  on shows only the engine's events.
- `Level lifetime (hours)` — 48h is V8's "last 2 days".
- `Keep an unfilled FVG for N bars` — display hygiene only; TradingView caps
  drawings at 500 boxes and old gaps crowd them out.
- Block windows are exposed as `input.session` so you can test alternative
  boundary conventions visually **before** anyone changes the spec. If you find
  a better partition here, say so — the v2 boundaries are a pinned choice
  (knowledge file §Sessions), not a finding.
