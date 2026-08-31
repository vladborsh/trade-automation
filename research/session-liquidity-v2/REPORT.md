# Session-liquidity sweeps — descriptive study **v2** (iFVG only)

**Package:** `research/session-liquidity-v2/` · **Role:** Researcher · **Date:** 2026-08-31
**Spec:** `knowledge/session-liquidity.md` (v2 reissue — authoritative)
**Brief:** `DESIGN.md` (Architect) · **Prior log entries:** RESEARCH-LOG.md Записи 9, 10, 11

---

## 0. What this pass is, and is not

A **descriptive frequency/magnitude study**, by explicit user decision. There is
**no permutation null, no kill rule, no pass/fail gate, no fit/holdout split**
here, and nothing below should be read as one. Every number describes what the
tape did; none of them is a verdict on whether the idea has edge.

It is a **redo**. The user rejected several phase-1 methodology choices after
auditing worked examples (Запись 11), the knowledge file was reissued wholesale,
and this pass re-measures everything under the corrected definitions.
`research/session-liquidity/REPORT.md` and `STRATEGY-DESIGN.md` are provisionally
invalidated — their **code** was reused where the definitions permit (forked into
this package; no phase-1 file was modified), their **numbers and definitions**
were not.

**BoS is out of scope entirely.** It is not computed, tabulated, or drawn. Its
phase-1 mechanic was found defective (`../session-liquidity/corrections/BOS-CORRECTION-NOTE.md`)
and a separate later pass owns it.

### What *is* enforced, because it is correctness rather than protocol

| Hygiene rule | How it is enforced |
|---|---|
| A session level enters the pool only after its window closes (V1) | `known_from = session_end_bar + 1` |
| Every forward measurement starts strictly after the bar it is measured from | window is `(take_out_bar, block_end]` |
| ATR is causal | `ATR(14)` read **at** the take-out bar, never over the horizon |
| iFVG needs a full close-through | inversion test is `close < gap_low` / `close > gap_high`, never a wick poke |
| The horizon never crosses a block boundary (V4) | block runs are derived from contiguous `(UTC date, block)` labels; asserted |
| Both the FVG's 3rd bar **and** the inversion close sit inside the window (V4) | asserted per event |
| The engine is causal end-to-end | **prefix stability**: re-running on a 60%-truncated tape reproduces every event that fits inside the prefix, bar-for-bar |

All of these are asserted mechanically by `checks.py` (run after `engine.py`).
**As of this commit all 19 checks pass.** Two were failing during development
and both were real: MFE/MAE were not floored at zero (19.5% of take-outs never
trade past their own wick again, which produced negative "excursions"), and the
prefix comparison keyed on `bar` alone when one bar can host both a high-side
and a low-side take-out. Both are fixed; the floor's information is preserved as
`share_no_continuation` in T4 rather than discarded.

**Scope:** BTCUSDT / ETHUSDT / SOLUSDT / BNBUSDT, 5m Binance USD-M perp klines,
2022-08-01 .. 2026-07-31 (1460 days, 420,768 bars/asset), reusing the existing
`research/intraday-mtf-smc/` pull — no new data was fetched.

---

## 1. Definitions in force (v2) and what changed

`knowledge/session-liquidity.md` governs; this is the operative summary.

**Sessions are a partition, not a set of windows.** Asia 00–08, London 08–13,
NY 13–21, **Late 21–24** UTC, contiguous and non-overlapping. Late hosts sweeps
and they are measured, but it produces no levels. Two labels are reported
separately throughout and are never conflated:

- **`level_session`** — whose liquidity was taken (Asia / London / NY).
- **`sweep_block`** — the clock block the take-out happened in (+ Late).

**The measurement horizon is block-scoped.** From the take-out bar to the last
bar of its `sweep_block`. This replaces phase-1's fixed 2h **everywhere**,
including iFVG formation and inversion timing. Consequences the knowledge file
pins and this report obeys: window-length distribution reported alongside every
magnitude table (W1/W2); **primary tables use only events with ≥12 bars (1h) of
block remaining**, with the short-window sample in an appendix (A1/A2), never
silently dropped; both the within-window extreme and the end-of-window value
reported.

**The v1–v8 ledger** (from the knowledge file, unchanged by implementation —
nothing forced a pinned choice to move):

| # | Point | v2 default | vs phase 1 |
|---|---|---|---|
| V1 | When a level becomes sweepable | first bar **after** its session window closes | = D1 |
| V2 | Attribution when one bar takes out several levels | largest-excursion level wins; ties → most recently closed session; all taken levels retired; `n_levels_taken` recorded | = D2 |
| V3 | Overlap handling | **removed** — sessions are non-overlapping by construction | replaces D3 |
| V4 | Confirmation / measurement window | **block-scoped**; primary tables require ≥12 bars remaining | replaces D4 (2h) and D6 |
| V5 | iFVG location | **relaxed** (gap reaches beyond the level); strict = sensitivity row (T11) | D5 as overridden |
| V6 | BoS mechanic | **not pinned** — deferred | replaces D7 |
| V7 | Re-sweeping a level | not allowed — retired on first take-out | = D8 |
| V8 | Level lifetime | 48h from session close, then expired unswept | = D9 |

**Units.** ATR(14, 5m) at the take-out bar is primary; raw % is the secondary
per-asset column. Chart 09 is the one-picture justification: in % SOL's median
reversal is **1.78×** BTC's; in ATR the ordering reverses and shrinks to
**0.88×**. Raw % ranks the assets by their own volatility, not by anything
about sweeps.

---

## 2. Headline numbers

**23,423 take-outs** across 4 assets over 1460 days. **21,118 (90.2%)** clear
the ≥1h-of-block-remaining rule and form the primary sample — **14.5/day across
the four assets**, ~3.6/day each.

| | |
|---|---|
| iFVG confirms a take-out (primary sample) | **64.4%** — 13,606 events |
| …of which the R proxy reaches ≥ 1 | **43.6%** |
| Median R proxy at the confirmation close | **0.84** |
| Median MFE / MAE from the confirmation close | **2.34 / 2.36 ATR** |
| Share of confirmed events where MFE > MAE | **49.7%** |
| Still on the favourable side when the block closes | **51.4%** |
| Median take-out → confirmation delay | **15 bars = 75 min** |
| Lift of a **confirmed** sweep over its block's own baseline | **1.02 – 1.15** |

**The one-sentence finding: under the corrected definitions the iFVG-confirmed
session sweep is, in aggregate, a coin flip.** MFE and MAE from the entry
reference are the same size to two decimal places, MFE exceeds MAE in 49.7% of
confirmed events, and the block-close sign is positive 51.4% of the time. The R
proxy's median of 0.84 is not a contradiction of that — it is the ratio of a
best-case excursion to a *small* stop, and a favourable ratio between two
numbers is not a directional edge.

Three things do separate cleanly, and they are the parts worth carrying forward:

1. **The take-out itself carries mild lift; the confirmation removes most of
   it.** Over all take-outs, the in-block reversal runs **1.25–1.48×** the same
   block's unconditional move. Restricted to iFVG-confirmed take-outs that
   collapses to **1.02–1.15×** (chart 05). The reason is visible in the delay:
   the median confirmation arrives **15 bars = 75 minutes** after the take-out,
   and the median reversal measured from the wick on those same events is
   3.31 ATR while the median MFE remaining after confirmation is 2.34 ATR. The
   iFVG spends about a third of the move buying its own confirmation.
2. **The Late block (21–24 UTC) is materially worse than the other three** and
   is worse on every axis at once: it confirms least often (46.8% vs 60–70%),
   it has the shortest windows (median 23 bars vs 41–76), its median R proxy is
   **0.47** against 0.81–0.94 elsewhere, and only 23% of its confirmed events
   reach R≥1 against 42–48%.
3. **The best-behaved cell is London liquidity taken out in the NY block.**
   6,671 primary take-outs (**4.6/day across four assets**), 71.8% confirm,
   median R proxy exactly **1.00**, 50.0% reach R≥1. It is the only cell above
   n=300 with a median R at or above 1. **But even there MFE > MAE in only
   48.2% of events**, and the cell's median R clears 1 in just **46% of the 48
   months**. It is the strongest cell in a weak field, not a signal.

**Re-answering the user's NY/Asia prior.** The prior gets a split answer under
the new windows, and the split is only visible because the two labels are kept
apart:

- As a **block** — *when* to be at the screen — NY is the best of the four:
  most take-outs (10,764 primary, 51%), highest confirmation rate (69.9%),
  highest median R (0.94), most events reaching R≥1 (47.6%). Asia is middling.
- As a **level source** — *whose* liquidity to hunt — NY is the **worst** of
  the three (median R 0.72, 38.1% reaching R≥1), London is the best (0.96,
  48.8%), Asia is in between (0.80, 42.3%).

So "NY is where it happens" survives; "NY levels are the ones to trade" does
not. The two readings of the prior point in opposite directions, and phase-1's
overlapping windows could not have separated them.

**What the block-scoped rule costs.** Of the 7,512 primary take-outs left
unconfirmed, **23.4% would have confirmed had the block run 2h longer** — 34.3%
in the Late block, 16.1% in NY. That is the price of V4 and it is a real cost,
not a rounding error. It is reported as a diagnostic probe only; those events
remain unconfirmed in every table.

---

## 3. Charts

### 3.1 Worked-example gallery — the audit surface

`results/GALLERY.md` indexes **30 real take-outs**, ten each of wins
(confirmed, R≥1), failures (confirmed, R<1) and unconfirmed take-outs.
Selection is **stratified across (symbol × direction × level_session ×
sweep_block) with seed 42 and is not hand-curated** — re-running `gallery.py`
reproduces exactly these panels, and no outcome column orders the picks. The
group sizes are equal by construction and say nothing about how common each
outcome is (that is §2 and T2/T7).

Every panel draws, on real 5m candles: the non-overlapping session rectangles
(**solid** = already closed at the take-out, so a legitimate level source;
**dotted and faint** = still forming, so *not* one — this distinction is what
makes the panel auditable for lookahead by eye), the swept level, the take-out
wick, the block-scoped window shaded from take-out to block end, the block-end
line, the FVG zone and the bar whose close inverted it, the wick-anchored
reverse/continuation extremes, and the stop proxy. A **second panel zooms the
sweep → inversion region**, because at block scale a 5m gap is a few pixels tall
and the iFVG geometry is exactly what needs auditing.

`viz/ex01..ex08` are eight additional hand-picked *teaching* panels, one per
phenomenon the tables report — including `ex02` (the iFVG fires and price runs
42 ATR the other way) and `ex04` (a take-out unconfirmed *only* because the
block ended). These are labelled as hand-picked; the gallery is not.

### 3.2 Statistics

| File | What it shows |
|---|---|
| `viz/01_window_length.png` | the horizon is now a variable, not a constant — window length by block, and how much of the confirmation rate is just window length |
| `viz/02_frequency_and_rate.png` | where sweeps happen and where they confirm, `level_session` × `sweep_block` |
| `viz/03_reverse_move_wick.png` | reversal size from the wick extreme (hindsight-anchored) |
| `viz/04_from_confirmation.png` | **the tradable view** — MFE vs MAE, the R survival curve, per-block R |
| `viz/05_lift.png` | **the honest comparison** — lift over each block's own baseline, raw and window-matched |
| `viz/06_delay_and_truncation.png` | how long the iFVG makes you wait, and what the block-scoped rule costs |
| `viz/07_monthly_stability.png` | 48 months of frequency, confirmation rate and R |
| `viz/08_sensitivities.png` | the three pinned choices that move the numbers most, each against its alternative |
| `viz/09_units.png` | why ATR is the primary unit |

---

## 4. Tables

Full generated block: [`results/TABLES.md`](results/TABLES.md); every table is
also a CSV in `results/`. Reading order: **W1/W2** (window length — read these
first, they condition everything), **T1–T3** (frequency, confirmation, delay),
**T4–T5** (magnitude from the wick), **T6–T7** (magnitude from the confirmation
close — the tradable view), **T8–T9b** (baseline and lift), **T10–T12**
(splits, sensitivity, stability), **A1–A2** (the short-window appendix).

---

## 5. Reading the tables — what actually stands out

**1. Window length is the strongest single driver in the whole study, and it is
a property of the clock, not of the market.** Confirmation rate runs 37.7% →
56.1% → 72.5% across the 12–23 / 24–47 / 48–95 bars-remaining buckets (W2).
Nothing about a sweep changed between those buckets; only how long the rule was
given to fire. Every cross-block comparison in this report is therefore either
window-matched (T9b) or reported with its window length beside it (W1). This is
the main thing phase 1's fixed 2h horizon hid, and it is the main thing a
strategy design must not accidentally re-hide.

**2. The confirmation is a filter that costs more than it gives.** 64.4% of
take-outs confirm — that is not a selective filter to begin with. And what it
selects for is *later*: median 75 minutes of the move already spent. Both facts
show up in the same place, T9's `lift_takeout` (1.25–1.48) versus
`lift_confirmed` (1.02–1.15). The window-matched version (T9b) is blunter still:
in the 48–95-bar bucket the confirmed lift is **below 1.0 in all three
blocks that have such a bucket** (Asia 0.93/0.95, London 0.94/0.86,
NY 0.99/0.94 for high/low sweeps); Late's windows never get that long. Waiting for the iFVG in a long window makes the measured reversal
*smaller* than a random bar's.

**3. MFE and MAE are the same size, everywhere.** T6's `mfe_over_mae` is 0.92 to
1.10 across every level_session × direction cell, with the pooled figure at
0.99. High sweeps are consistently the slightly better side (1.06 vs 0.92) —
the one directional asymmetry in the table, and it is small. This is the number
that should discipline any strategy design built on top of this pass: whatever
the R proxy says, the raw excursion in each direction after an iFVG confirms is
symmetric.

**4. The R proxy is favourable and it does not mean what it looks like.** Median
0.84, 43.6% ≥1, 19.7% ≥2 (T7). It reads better than the MFE/MAE symmetry
because the denominator — the sweep-leg extreme at 2.67 ATR median — is a
*tight* stop, not because the move is directional. R is computed against MFE, a
best-case exit nobody hits systematically, with no costs, no slippage and no
exit rule. Treat T7 as a statement about **stop geometry**, which is genuinely
favourable, and not as an expectancy.

**5. Late is a different regime; the other three are not.** Everything about
Late is worse and it is not subtle (§2, point 2). Its 2,520 primary take-outs
are 11.9% of the sample. Meanwhile Asia / London / NY differ from each other by
far less than any of them differs from Late — median R 0.81 / 0.81 / 0.94, R≥1
share 43.7 / 42.2 / 47.6%. If any block filter is warranted by this data it is
"not Late", not "only NY".

**6. Multi-level take-outs are worse, monotonically, and rare.** 88.7% of
take-outs clear one level. Confirmation rate falls 65.0 → 60.6 → 58.4 → 36.6%
and median R falls 0.86 → 0.71 → 0.62 → 0.30 as `n_levels_taken` goes 1 → 4
(T10). The wick-anchored reversal *rises* over the same range (4.01 → 5.09 ATR)
— a clean illustration of why the wick view flatters: a bar that clears four
levels made a large excursion, and measuring the bounce from the tip of it
inflates the reversal while the tradable entry gets worse.

**7. The relaxed iFVG (V5) buys 7 points of coverage and slightly better
events.** Relaxed 64.4% vs strict 57.2%, with the relaxed set confirming sooner
(15 vs 18 bars median) and on marginally larger reversals (3.31 vs 3.08 ATR).
The user's override is supported by the data, weakly and in the right direction.

**8. Stability is good on frequency, poor on outcome.** Monthly take-outs are
385–493 with a median of 444 across 48 months — the mechanism fires at a steady
rate. Monthly confirmation rate is 52–74%. But the monthly median R proxy ranges
**0.57–1.16** and clears 1.0 in only **15% of months** (7 of 48). Even the best
cell (London-in-NY) clears it in 46% of months. Nothing here is stable enough at
the outcome level to build a design on without a real backtest.

---

## 6. Doubts, limits, and what would change these numbers

- **This is not a backtest and cannot become one by being read harder.** No
  costs, no funding, no slippage, no exit rule, no position sizing, no
  sequencing (overlapping events are counted independently; on a trending day
  many correlated take-outs enter the same tables as separate rows). The R
  proxy in particular is MFE-based and is the single most flattering number in
  the report.
- **The block boundaries are a pinned choice, not a finding.** London being 5h
  while Asia and NY are 8h is a deliberate asymmetry chosen by the Architect,
  and W1 shows it does real work: London's median window is 41 bars against
  NY's 76, which alone depresses London's confirmation rate. The `.pine`
  exposes the boundaries as inputs precisely so the user can challenge them
  visually before anyone changes the spec.
- **The ≥12-bar rule is a defensible line, not a natural one.** It removes 9.8%
  of take-outs whose confirmation rate is 10.7% against the primary sample's
  64.4% (A1). A different threshold would move the headline rate by several
  points. Both samples are reported; neither is hidden.
- **The truncation probe peeks past the block end.** It is a diagnostic and is
  excluded from every other number, but it is the one place in the study that
  looks at bars the definitions say are out of window. It is labelled as such
  everywhere it appears.
- **`level_session` and `sweep_block` are correlated by construction.** A
  London level is most often taken out in the NY block simply because NY
  follows London. Cell-level readings in T2/T7 should not be interpreted as
  independent.
- **V2 attribution changes what "a sweep" counts as.** Crediting a multi-level
  bar to the deepest level and emitting one event is the right call for
  avoiding correlated duplicates, but it means the 23,423 count is a count of
  *bars that took out something*, not of levels retired.
- **Four assets, all crypto perps, one venue, four years covering roughly one
  and a half cycles.** The per-asset spread in median R (0.75 ETH to 0.90 BNB)
  is wide enough that pooling is doing some averaging.
- **What would most change these numbers:** a different block partition;
  allowing confirmation to run past the block end; a stop other than the
  sweep-leg extreme; and any exit rule at all, since every magnitude here is an
  excursion rather than a realised exit.

---

## 7. Reproducing

```bash
# from the repo root, with the project venv
cd research/session-liquidity-v2
python engine.py      # ~35s — writes results/events_*.csv, results/uncond_*.csv.gz
python checks.py      # 19 correctness assertions; must print ALL CHECKS PASSED
python tables.py      # writes results/TABLES.md + every t*/w*/a* CSV
python charts.py      # writes viz/01..09_*.png
python gallery.py     # writes viz/{win,fail,unconf}*.png + results/GALLERY.md
python examples.py    # writes viz/ex01..ex08_*.png (hand-picked teaching panels)
```

`data/` is a symlink to the existing `research/intraday-mtf-smc/` pull; no
network access is used anywhere in this package.

| File | Role |
|---|---|
| `common.py` | data loading, v2 block partition, `block_arrays()` (the block-scoped horizon), `session_frames()` |
| `engine.py` | take-out detection, block-scoped measurement, relaxed iFVG confirmation. **No BoS.** |
| `checks.py` | the 19 assertions behind §0, incl. block containment, iFVG timing containment, prefix stability |
| `tables.py` | every table; primary/appendix split lives here |
| `charts.py` | charts 01–09 |
| `examples.py` | `draw_event()` — the shared panel renderer — plus 8 teaching panels |
| `gallery.py` | the stratified 30-panel audit gallery |
| `session_liquidity_v2.pine` + `RUNBOOK.md` | TradingView audit instrument and its delta runbook |

---

## 8. Where this goes next

Per `DESIGN.md`: **user audit of this gallery and the Pine** → BoS correction
pass → Architect re-derives the strategy design → Researcher backtest.
`HANDOFF.md` carries the routing note and the specific questions the Architect
needs answered before the design can be re-derived.
