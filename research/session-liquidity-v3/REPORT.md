# Session-liquidity sweeps — **v3**: the corrected iFVG confirmation, re-derived

**Delta report.** This pass changes exactly one layer — how a sweep gets
confirmed — and re-derives only the numbers that depend on it. Everything
upstream of confirmation (take-out frequency, window-length distribution,
wick-anchored magnitude, the unconditional yardstick) is **unchanged and not
reprinted**: read it in `../session-liquidity-v2/REPORT.md`. That is not an
assumption; `checks.py` proves the v3 take-out stream is identical to v2's
committed events row for row.

* Brief: [`DESIGN.md`](DESIGN.md) · Definitions: `../../knowledge/session-liquidity.md`
  (§5.1 / V9 is the mechanic this pass implements)
* Tables: [`results/TABLES.md`](results/TABLES.md) · Audit gallery:
  [`results/GALLERY.md`](results/GALLERY.md) · Charts: `viz/01..07`
* Hand-off: [`HANDOFF.md`](HANDOFF.md)

---

## 0. What this pass is, and is not

Descriptive, by the user's standing protocol call (§8): no permutation null,
no kill rule, no pass/fail gate, no fit/holdout split. Every number below is a
count, a rate or a quantile on the full 4-year sample. Nothing here is a
backtest and nothing here is tuned.

Correctness hygiene is not part of that relaxation and is checked
mechanically — `checks.py`, 26 assertions plus 2 counted diagnostics, all passing:

* **the take-out stream reproduces v2's committed `events_*.csv` exactly**
  (23,423 events; every upstream column bit-identical) — this is what licenses
  the delta-style report;
* v2's algorithm, re-run inside the v3 engine for the comparison table,
  reproduces v2's own confirmations exactly, so the delta is not contaminated
  by a second unintended difference;
* the state machine's own invariants: a replaced gap never confirms, no
  post-invalidation retroactive eligibility, every confirmation is a full
  close-through of the **active** gap, a gap never forms and confirms on the
  same bar;
* block containment and prefix stability (a 60 %-truncated re-run reproduces
  every event that fits inside the prefix).

Sample: BTC / ETH / SOL / BNB, 5m, 2022-08-01 … 2026-07-31 (1460 days), from
the existing `research/intraday-mtf-smc/` cache. **No new data pull.** v2 code
was forked, never modified.

---

## 1. The mechanic that changed

**v2 (the bug).** `ifvg_confirm` scanned every qualifying gap anywhere in the
block window, computed each gap's inversion bar independently, and kept
whichever inverted **earliest across the whole set** — a comparison no one
watching the tape can make.

**v3 (§5.1 / V9).** One active candidate at a time, walked forward once:

1. the **latest** qualifying gap is the active candidate; a newer qualifying
   gap **replaces** it, and the replaced gap is permanently out (pin 1);
2. only the **active** candidate can confirm (pin 2);
3. the active candidate is **invalidated** by a close beyond the take-out
   bar's own extreme; afterwards only gaps forming on a **later** bar are
   eligible;
4. a gap that forms on bar `t` can confirm at `t+1` at the earliest (pin 4).

---

## 2. Read this first — DESIGN §1 pin 3's premise was wrong

The brief pinned the tie case — one bar that both inverts the active gap and
closes beyond the take-out extreme — as *"contradictory in direction, should
be near-impossible; assert and count"*. **It is neither contradictory nor
rare, and it dominates the result.**

The geometry: for a high sweep the candidate is a **bullish** gap that must
reach above the swept level, and it usually forms **above the take-out bar's
high** — during the impulse that made the sweep. Its lower edge therefore sits
*above* the invalidation reference, so **every close in the band between them
satisfies both tests at once**: the gap inverts while price is still above the
sweep wick. There is no contradiction to resolve; there are two rules whose
trigger zones overlap by construction.

It fires on **3,853 bars across 3,102 take-outs — 13.2 % of all events**
(14.6 % of the primary sample). Under pin 3 as written, every one of them
resolves as an invalidation.

**Architect ruling (mid-pass, recorded here for provenance):** run the user's
pinned rule as primary, surface the finding through the report and the audit
rather than reinterpreting the decision. Two labelled sensitivity variants are
shipped alongside so the user can see what their rule costs:

| variant | invalidation reference | tie resolves as | confirm rate (primary) |
|---|---|---|---|
| **A — PRIMARY** (pin 3 as written) | take-out bar's extreme, fixed at take-out | invalidation | **20.7 %** |
| B — sensitivity | same | confirmation | 34.6 % |
| C — sensitivity | running extreme frozen at the candidate's activation bar | invalidation | 60.4 % |
| — v2 (the bug), for scale | — | — | 64.4 % |

C is the Architect's generalisation of the user's intent — *"the reversal
thesis is dead when price pushes beyond the high-water mark"* — and is
identical to A whenever nothing exceeded the take-out extreme before the
candidate activated. Chart `viz/02_variants_and_tie.png`, table V1/V2 in
`results/TABLES.md`, and the `above*` gallery stratum (panels annotated with
each event's B and C outcome) are the audit surface for this decision.

**Everything below runs under A.**

---

## 3. Headline numbers

### 3.1 The confirmation rate collapses; the geometry does not move

| metric (primary sample, n = 21,118) | v2 (bug) | **v3 (A)** |
|---|---|---|
| take-outs confirmed | 64.4 % | **20.7 %** |
| confirmed events | 13,606 | **4,379** |
| median take-out → confirmation delay | 15 bars (75 m) | **14 bars (70 m)** |
| median MFE from the confirmation close | 2.34 ATR | **2.08 ATR** |
| median MAE from the confirmation close | 2.36 ATR | **2.02 ATR** |
| share where MFE > MAE | 49.7 % | **50.1 %** |
| still on the favourable side at block close | 51.4 % | **52.0 %** |
| median stop proxy | 2.67 ATR | **2.72 ATR** |
| median R proxy | 0.84 | **0.74** |
| share reaching R ≥ 1 | 43.6 % | **40.6 %** |
| share reaching R ≥ 2 | 19.6 % | **17.4 %** |

**The single most important line is the third-from-bottom group.** v2's
central finding — *a confirmed iFVG sweep is, in aggregate, a coin flip* —
**survives the correction unchanged**: 50.1 % of confirmed events have MFE >
MAE, 52.0 % end the block on the favourable side. That was not an artefact of
the bug. What the bug bought was **volume, not edge**: three times as many
"confirmations" with the same ~50/50 geometry.

### 3.2 What the bug actually selected (D1–D3, chart 01)

* v3's confirmed set is a **strict subset** of v2's — 0 events confirm under
  v3 and not under v2 (mechanically expected, and asserted).
* Of the 4,379 take-outs both algorithms confirm, **72.9 % select the same
  gap**; the other 1,188 are the interesting ones.
* **The user's small-gap-bias prediction is not confirmed in the direction
  predicted.** On the matched events, the median selected gap is **0.364 ATR
  under v2 and 0.298 ATR under v3** — v2's picks are *larger*, not smaller.
  Where the two disagree, v2 picks an **early, larger** gap (median formation
  +7 bars from the take-out, 0.352 ATR) and v3 a **late, much smaller** one
  (+33 bars, 0.182 ATR). The bug's bias was toward gaps forming *early in the
  sweep impulse*; v3's survivors are the small gaps that form *after* price has
  come back, because everything formed during the impulse gets invalidated.
  The prediction was right that the algorithm has a systematic gap-selection
  bias, and right that it contaminates any gap-size analysis; it was wrong
  about the sign.

### 3.3 Where v3 changes a v2 conclusion: the lift

v2 concluded that *the take-out gives a moderate lift and the confirmation
eats it*. Under v3 that reverses:

| lift over the block's own unconditional baseline | all take-outs | v2-confirmed | **v3-confirmed** |
|---|---|---|---|
| Asia block | 1.23–1.26× | 1.02–1.03× | **1.28–1.30×** |
| London block | 1.27–1.34× | 0.97–1.06× | **1.29–1.47×** |
| NY block | 1.38–1.43× | 1.11–1.21× | **1.41–1.49×** |
| Late block | 1.39–1.58× | 1.09–1.23× | **1.72–1.75×** |

Median wick-anchored reversal: 4.05 ATR across all take-outs, **3.31 ATR** in
v2's confirmed subset (i.e. *below* the unconditional take-out), **4.26 ATR**
in v3's. The corrected filter is far more selective and it selects **stronger
reversals** — the opposite of what the buggy one did. Window-matched (T9b),
confirmed lift stays above 1.0 in every bucket that has one, which v2's did
not.

Caveat, unchanged from v2: both columns are measured from the wick extreme and
are hindsight-flattered in the same way. The *comparison* survives; the level
does not. And 3.3 sits beside 3.1 without contradiction — v3 picks take-outs
that reverse further from the wick, and *still* only breaks even from the
confirmation close, because the median confirmation arrives 70 minutes and
2.72 ATR of stop distance later.

### 3.4 Why 79 % of take-outs now go unconfirmed (S2, chart 03)

| cause | share of primary take-outs | median in-block reversal it still made |
|---|---|---|
| **confirmed** | 20.7 % | 4.26 ATR |
| **invalidated out** — a candidate existed, all of them died | **44.9 %** | 2.80 ATR |
| **no candidate ever** — no gap passed the location filter | 30.3 % | 5.98 ATR |
| **live at block end** — a candidate never inverted in time | 4.0 % | 2.66 ATR |

Two things stand out. First, invalidation — not gap scarcity — is now the
dominant failure mode, and it is churn: the median event sees 1 candidate and
1 invalidation, the p90 sees 7 and 7 (S1), because while price keeps closing
beyond the take-out extreme each new gap is killed on the next bar.
Confirmation rate falls monotonically with candidate count: 55 % at one
candidate, 20 % at 3–4, 5 % at 5–8, 1 % at 9+ (S1b). Second, the
`no_candidate` bucket has the **largest** median reversal of all (5.98 ATR) —
those are clean V-reversals where price simply never left a 3-candle gap
behind. The rule has nothing to fire on precisely where the move was best.

Only **5.5 %** of unconfirmed take-outs would have confirmed with 2 h more
block (T3), down from v2's 23.4 %: under v3 the block boundary is no longer
the binding constraint — the invalidation rule is.

### 3.5 Hour of day (the §5.1 required deliverable) — chart 06

* **Gap frequency is essentially flat across the clock**: 21.3–24.5 three-candle
  FVGs per 100 bars in every UTC hour, a ±10 % band with a mild dip at 15–17
  UTC and a mild peak at 00–01 and 21–22 (H1). There is no "gaps happen at
  this hour" effect to exploit.
* **The unstratified hourly confirmation rate looks like a strong clock
  effect** — 29 % at 00 UTC falling to 12 % at 06, 21 % at 08 falling to 14 %
  at 11, 23 % at 13 falling to 11 % at 19 — but the sawtooth resets at every
  block boundary, which is the tell: it is **window length wearing an hour
  costume**, exactly as §6.1 warned.
* **Stratified by remaining window, the effect largely flattens.** Within the
  48–71-bars-left stratum the rate runs 20.9–27.4 % across the hours that have
  one; within 12–23 bars left it runs 11.5–13.9 %. The remaining hour-to-hour
  spread inside a stratum is smaller than the spread between strata. The
  honest reading: **there is no best hour, there is a best amount of block
  left**, and the two are the same fact seen twice.

### 3.6 Everything else, briefly

* **Per level_session × sweep_block × direction × asset** (T2c, 96 cells,
  all with n ≥ 15): confirmation rate 3–32 % (median 20 %), median R proxy
  0.04–1.62 (median 0.64). The dispersion across cells is much wider than the
  differences between any two marginals — a caution against reading a single
  cell as a finding.
* **The NY-vs-Asia split from v2 persists, with the same shape.** As a
  *block* (when to be at the screen) NY is best: 51 % of take-outs, median R
  0.84. As a *level source* (whose liquidity to hunt) London is best (median R
  0.90) and NY worst (0.65).
* **Late (21–24 UTC) remains a different, worse regime**: 14.8 % confirmed,
  median R 0.46, only 25 % reach R ≥ 1 — even though its *lift* is the highest
  in the table (3.3), because its baseline is the quietest.
* **Window length is still the strongest single driver** (W2): 12.7 % → 17.9 %
  → 23.3 % confirmed across the 12–23 / 24–47 / 48–95 bars-remaining buckets.
* **Stability** (T12, 48 months): monthly confirmation rate 16–26 % (median
  21 %) — tighter than v2's spread; monthly median R proxy 0.48–1.08, above
  1.0 in only **4 of 48 months**. The result is not stable in the sense that
  matters.
* **Location sensitivity** (T11): strict location confirms 14.3 % vs relaxed
  20.7 %.

---

## 4. The audit surface

[`results/GALLERY.md`](results/GALLERY.md) — **28 panels, seven strata of
four**, stratified across (asset × direction × level_session × sweep_block)
with a fixed seed, not hand-picked. Every panel draws the state machine's
transitions: the invalidation line, every candidate gap numbered in formation
order and coloured by fate (green confirmed / red invalidated with an `x` on
the killing close / grey replaced and permanently out / orange still live),
the confirmation close and the stop proxy, plus a zoom panel on the transition
region and — in the header — what variants B and C did with the same take-out.

Strata: `conf1` (single candidate, clean) · `confrep` (confirmed after a
replacement) · `confinv` (confirmed after invalidations) · **`above` (the
pin-3 tie — the panels the §2 decision rests on)** · `uncinv` (invalidated
out) · `unclive` (live at block end) · `uncnone` (no candidate).

Eight teaching panels `viz/ex01..ex08` cover the same mechanics hand-picked
for clarity, including `ex07` (a take-out v2 confirmed and v3 invalidated on a
tie bar) and `ex08` (both confirmed, through different gaps).

Charts: `01` v2-vs-v3 · `02` variants and the tie · `03` state-machine
diagnostics · `04` rate by level_session × block · `05` from-confirmation
geometry · **`06` hour of day** · `07` monthly stability.

---

## 5. Doubts and limits

1. **The pin-3 tie decision is not settled by this pass, and it is the biggest
   single lever in the study** — 20.7 % / 34.6 % / 60.4 % depending on how one
   line is read. Everything in §3 is conditional on A. This is the first thing
   the user should rule on.
2. **`invalidated out` at 44.9 % deserves scrutiny as a *rule*, not just a
   number.** Under A a candidate formed inside the sweep impulse is dead
   before it can invert, which is why the surviving confirmations are late,
   small gaps (§3.2). Whether that is the intended trading behaviour or an
   over-tight leash is a judgement about the idea, not about the code.
3. **Under a sequential machine, strict location is no longer a subset of
   relaxed** — 179 of 3,060 strict confirmations are not relaxed
   confirmations. A stricter filter admits fewer candidates, so a gap that
   would have been replaced never exists and an earlier one survives to
   confirm. Under v2's best-pick this was impossible by construction. It means
   "sensitivity row" now means something weaker than it did: the variants are
   not nested.
4. **Invalidation is defined on the active candidate**, so a close beyond the
   take-out extreme while nothing is active is not an invalidation event. That
   is the literal §5.1 reading and it is measured, not hidden: 60.9 % of
   confirmations happened after at least one such "orphan breach" (median 4
   per event, p90 55). Under a reading where any breach ends the watch, the
   rate would fall further. Flagged, not decided.
5. **The R proxy is still a proxy.** MFE is a best-case exit nobody hits
   systematically, the stop is a geometric distance rather than an order, and
   there are no costs, no slippage, no exit rule. R ≥ 1 at 40.6 % is a
   statement about the shape of the excursion, not about a strategy.
6. **The Pine indicator has not been compiled in this environment** — no
   TradingView available to the researcher. Its logic mirrors `engine.py`
   line for line and it carries one stated simplification (one watch per
   direction per block rather than one per event, so a block with several
   same-side take-outs shows the latest one's machine). Treat the first
   TradingView load as part of the user's audit, per `RUNBOOK.md` §4.
7. **Wick-anchored lift is hindsight-flattered** (§3.3) and **the gallery's
   group sizes say nothing about frequency** (S2 does).

---

## 6. Reproducing

```bash
# from the repo root, with the project venv
cd research/session-liquidity-v3
python engine.py     # ~40s — writes results/events_*.csv, transitions_*.csv.gz, uncond_*.csv.gz
python checks.py     # must print ALL CHECKS PASSED
python tables.py     # results/TABLES.md + every t*/d*/v*/s*/h*/a* CSV
python charts.py     # viz/01..07
python examples.py   # viz/ex01..ex08
python gallery.py    # viz/{conf1,confrep,confinv,above,uncinv,unclive,uncnone}*.png + results/GALLERY.md
```

`data/` is a symlink to `../intraday-mtf-smc/data` — no new pull. Nothing under
`research/session-liquidity-v2/` or `research/session-liquidity/` is touched by
anything in this package.

---

## 7. Where this goes next

Per `DESIGN.md` §3 and §8 of the knowledge file: **user audit of this
gallery + the hour-of-day chart, and a ruling on §2's A/B/C question** →
PDH/PDL drill-down (salvaged code from `researcher-sl-drilldown`, §5.1 wired
in) → BoS correction pass → Architect re-derives the strategy design → backtest.

`knowledge/session-liquidity.md` needs **one** edit as a result of this pass:
§5.1's tie case should be written down explicitly (it is currently implicit,
and DESIGN.md's pin of it was based on a false premise). Open questions for
the Architect are in [`HANDOFF.md`](HANDOFF.md).
