# Session-liquidity sweeps — **v4**: iFVG confirmation with the invalidation rule deleted

**Delta report.** This pass changes exactly one thing — it **removes** the
invalidation clause v3 added — and re-derives every number that depended on
it. Everything upstream of confirmation (take-out frequency, window-length
distribution, wick-anchored magnitude, the unconditional yardstick) is
**unchanged and not reprinted**: read it in
`../session-liquidity-v2/REPORT.md`. That is not an assumption; `checks.py`
proves the v4 take-out stream is identical to v2's committed events row for
row, for the second pass running.

* Definitions: `../../knowledge/session-liquidity.md` §5.1 / V9 (**v4** — the
  authoritative spec; the v3 invalidation rule is retired as fabricated)
* Tables: [`results/TABLES.md`](results/TABLES.md) · Audit gallery:
  [`results/GALLERY.md`](results/GALLERY.md) · Charts: `viz/01..08`
* Hand-off: [`HANDOFF.md`](HANDOFF.md) · Indicator:
  [`session_liquidity_v4.pine`](session_liquidity_v4.pine) +
  [`RUNBOOK.md`](RUNBOOK.md)

> **Note on the brief.** The dispatch referenced a
> `research/session-liquidity-v4/DESIGN.md` that was not present in this
> worktree (the branch carries only commit `a0c2244`, which updated
> `knowledge/session-liquidity.md` and did not add a v4 brief). The pass was
> executed against the dispatch text's §1 pins and §2 required outputs plus
> §5.1 v4 as the authoritative spec, both of which are self-contained. Nothing
> was invented to fill a gap; if the missing brief pinned something else, say
> so and it will be re-run.

---

## 0. What this pass is, and is not

Descriptive, by the user's standing protocol call (§8): no permutation null,
no kill rule, no pass/fail gate, no fit/holdout split. Every number below is a
count, a rate or a quantile on the full 4-year sample. Nothing here is a
backtest and nothing here is tuned.

Correctness hygiene is not part of that relaxation and is checked
mechanically — `checks.py`, **30 assertions plus 4 counted diagnostics, all
passing**:

* the take-out stream reproduces v2's committed `events_*.csv` **exactly**
  (23,423 events; every upstream column bit-identical) — this is what licenses
  the delta-style report;
* **v2's algorithm and v3's variant A, both re-run inside this engine,
  reproduce their own committed confirmations exactly** (v3 down to the
  forming bar and the invalidation count), so the three-way comparison is
  computed on identical event rows and cannot be contaminated by a second,
  unintended difference;
* the v4 machine's own invariants: the confirming gap is always the
  latest-formed candidate, a replaced gap never confirms, every confirmation
  is a full close-through of the **active** gap, a gap never forms and
  confirms on the same bar;
* **no invalidation state exists anywhere** — asserted structurally, not just
  in prose: the transition log contains only `candidate / replaced / confirmed
  / live_at_block_end`, and no event column carries an invalidation reference;
* block containment and prefix stability (a 60 %-truncated re-run reproduces
  every event that fits inside the prefix).

Sample: BTC / ETH / SOL / BNB, 5m, 2022-08-01 … 2026-07-31 (1460 days), from
the existing `research/intraday-mtf-smc/` cache. **No new data pull.** v2 and
v3 code was forked, never modified.

---

## 1. The mechanic, and the deletion

**v4 (§5.1 / V9).** One active candidate at a time, walked forward once:

1. the **latest** qualifying gap is the active candidate; a newer qualifying
   gap **replaces** it, and the replaced gap is permanently out (pin 1);
2. only the **active** candidate can confirm (pin 2);
3. a gap that forms on bar `t` can confirm at `t+1` at the earliest (pin 3);
4. confirmation = a close through the active candidate's far edge. If none
   happens before the block ends, the take-out is unconfirmed.

That is the whole machine. The swept level is used in exactly one place — the
V5 location filter on a forming gap — and it never moves.

**What was deleted.** v3 added: *"discard the active candidate if a bar closes
beyond the take-out bar's own extreme"*. It was invented during a grilling
session, the user never asked for it, and it contradicts the worked diagram
they drew (price crosses London's high, prints two further local highs inside
NY, then reverses through a gap near the top — a valid sweep, which that rule
rejects). Deleting it also deletes v3's A/B/C tie question: with one rule left
there is nothing to tie against.

---

## 2. Read this first — the headline is not what the previous two passes implied

**Removing the invalidation rule does not "partially restore" v2's numbers. It
restores them exactly.**

| metric (primary sample, n = 21,118) | v2 (best-pick bug) | v3-A (+invalidation) | **v4 (spec)** |
|---|---|---|---|
| take-outs confirmed | 64.4 % | 20.7 % | **64.4 %** |
| confirmed events | 13,606 | 4,379 | **13,606** |
| median take-out → confirmation delay | 15 bars (75 m) | 14 bars | **15 bars (75 m)** |
| median selected gap height | 0.355 ATR | 0.298 ATR | **0.363 ATR** |
| median MFE from the confirmation close | 2.34 ATR | 2.08 ATR | **2.34 ATR** |
| median MAE from the confirmation close | 2.36 ATR | 2.02 ATR | **2.36 ATR** |
| median R proxy | 0.84 | 0.74 | **0.84** |
| share R ≥ 1 | 43.6 % | 40.6 % | **43.6 %** |

Over all 23,423 take-outs, v2 and v4 confirm **the same set** — zero
disagreements in either direction — and on **100 %** of them they confirm on
**the same bar**. They differ only in *which gap they name* (§3). Chart
`viz/01_three_way_delta.png`; tables D1–D3.

**Why the v2 "bug" cost nothing on the headline.** v2's defect was real — it
compared every gap's inversion time across the whole window, which no one
watching the tape can do — but for a high sweep it is close to a theorem that
the comparison is vacuous: if no bar before `u` closed below an older bullish
gap's lower edge, then every intervening bar's high, and hence every later
bullish gap's lower edge, sits at or above it. So the close that inverts the
old gap inverts the freshest one too. The retroactive scan almost never buys
an earlier confirmation; it only mislabels which gap did it.

**This is a correction to what v3's REPORT.md claimed.** v3 attributed the
64 % → 21 % collapse to "the corrected sequential mechanic". It was not the
sequencing. **The entire collapse was the invalidation rule** — the one part
of v3 that was fabricated. The sequencing fix, which was right, changes almost
nothing measurable.

---

## 3. The same-gap agreement analysis (the residual v2-vs-v4 difference)

With invalidation gone, the only thing separating v2 from v4 is
earliest-inverting vs latest-formed gap selection. On the 13,606 primary
take-outs both confirm:

| | value |
|---|---|
| same gap selected | **93.3 %** (12,688) |
| different gap selected | 6.7 % (918) |
| …of those, same confirming **bar** | **100 %** |
| …median formation-bar gap (v4 later by) | 1 bar (mean 2.7, p90 6) |
| …median selected-gap height, v2 | 0.245 ATR |
| …median selected-gap height, **v4** | **0.347 ATR** |
| …delay / MFE / stop / R difference | **0.00 in every case** |

Agreement falls only where there was something to disagree about: 100 % with
one candidate, 89 % with two, 84 % with nine or more (D4c). Where they differ,
v4's gap is the fresher and — 58 % of the time — the larger one, which is the
opposite of the small-gap bias v2's defect was predicted to introduce; on this
mechanic the retroactive scan biases *small*, but only within the 6.7 % of
events where the choice is live, so the pooled distributions barely move
(D2: median 0.355 vs 0.363 ATR).

Practically: **the gap-identity difference has no measurable consequence** for
any number this study reports. It matters only for implementation fidelity —
a live system must name the gap v4 names, because v2's rule is not executable.
Chart `viz/02_same_gap_agreement.png`; tables D4, D4b, D4c; gallery stratum
`diffgap*`.

---

## 4. What the deleted rule was actually doing

The rule fired on the shape the idea is *about*. Splitting the primary sample
by how many further local highs (lows) price printed **beyond the take-out
bar** before reversing — a 2-bar pivot count, diagnostic only, never a filter:

| local extremes beyond the boundary | n | share | **v4 rate** | v3-A rate |
|---|---|---|---|---|
| 0 | 3,732 | 17.7 % | 11.3 % | 11.3 % |
| 1 | 3,391 | 16.1 % | 36.9 % | 22.2 % |
| 2 | 2,433 | 11.5 % | 59.4 % | 25.1 % |
| 3–4 | 3,515 | 16.6 % | 78.0 % | 24.7 % |
| 5+ | 8,047 | 38.1 % | **96.3 %** | 21.5 % |

v3-A's rate is flat at ~21–25 % regardless — it was, near enough, measuring
"did price fail to push past the take-out wick", not "did the level get swept
and reversed". v4's rises monotonically, because more room past the boundary
means more chances for a qualifying gap to form. **72 % of take-outs have at
least one close beyond the take-out bar's extreme** (median 9 such closes,
p90 65); every one of those killed v3's candidate on the first occurrence.

Chart `viz/08_invalidation_cost.png`; table D5. The gallery's `multiext*`
stratum draws four of these — 31.5 % of the primary sample is a take-out that
v4 confirms and v3 rejected after printing ≥2 further local extremes.

---

## 5. Re-derived core numbers (v4, primary sample)

### 5.1 Confirmation rate — level_session × sweep_block

| whose level ↓ / swept in → | Asia | London | NY | Late | ALL |
|---|---|---|---|---|---|
| **Asia** | 60.7 | 61.6 | 67.9 | 45.8 | 63.4 |
| **London** | 64.7 | 51.2 | 71.8 | 44.8 | **69.6** |
| **NY** | 68.2 | 54.7 | 64.1 | 47.1 | 58.9 |
| **ALL** | 66.1 | 60.1 | 69.9 | 46.8 | **64.4** |

London's levels swept in the NY block is the top cell (71.8 %), NY-in-Late the
bottom (47.1 %) — but see §5.4: most of this table is window length. Rates are
tight across assets (T2b: every cell within ~5 pts of its row) and across the
96 populated four-way cells (min 30 %, median 61 %, max 76 %).

### 5.2 Timing

Median take-out → confirmation **15 bars (75 minutes)**; p25 8, p75 26, p90 40.
The confirming gap's third bar lands a median of 11 bars after the take-out —
so the gap that ends up mattering typically forms about an hour into the
window and inverts a handful of bars later. Of unconfirmed take-outs, 23 %
would have confirmed had the block run 2 h longer (T3) — a diagnostic probe,
not part of any definition.

### 5.3 Geometry from the confirmation close

Median MFE **2.34 ATR**, median MAE **2.36 ATR**, MFE/MAE ratio **0.99**;
51.4 % are still on the favourable side of the entry when the block closes,
with a median end value of +0.10 ATR. Stop proxy (confirmation close back to
the sweep-leg extreme) median **2.67 ATR**; R proxy median **0.84**, share
R ≥ 1 **43.8 %**, R ≥ 2 **19.7 %** (T6, T7, `viz/05`).

Best block by R: **NY** (median 0.94, R ≥ 1 47.6 %). Worst by a distance:
**Late** (0.47, 23.3 %) — short windows. The single best populated cut is
London levels swept in the NY block: R median 1.00, R ≥ 1 50.2 %, n = 4,780.

**Read this as a descriptive shape, not an edge.** MFE is a best-case exit
nobody systematically hits, there are no costs, and the median R below 1 with
MFE ≈ MAE says that at the confirmation close the favourable and adverse
excursions are about the same size.

### 5.4 Window length is still the dominant driver

| bars left in the block | n | share | v4 rate |
|---|---|---|---|
| < 12 (appendix only) | 2,305 | 9.8 % | 10.7 % |
| 12–23 | 2,392 | 10.2 % | 37.7 % |
| 24–47 | 5,291 | 22.6 % | 56.1 % |
| 48–95 | 13,435 | 57.4 % | 72.5 % |

A 7× spread in confirmation rate across window-length buckets, against a
~1.5× spread across the whole level × block table. Any hour-of-day or
session-ranking read that is not window-matched is mostly reading the clock
(W2, and §6.1's standing warning).

### 5.5 The uncomfortable one: confirmation barely selects

| sweep block / direction | take-out lift | **v4 confirmed lift** | v3-A confirmed lift |
|---|---|---|---|
| Asia high | 1.234 | **1.020** | 1.281 |
| London high | 1.343 | **1.064** | 1.468 |
| NY high | 1.433 | **1.206** | 1.491 |
| NY low | 1.381 | **1.110** | 1.412 |
| Late low | 1.576 | **1.231** | 1.745 |

`lift` = median wick-anchored in-block reversal, conditional / same-block
unconditional. A bare take-out reverses ~1.23–1.58× the unconditional
baseline. **Conditioning on a v4 iFVG confirmation makes that number smaller,
not larger** — 0.97–1.23, i.e. the confirmed subset reverses about as much as
any random bar in the block, and *less* than the average take-out. Window-
matched (T9b) the same picture holds: confirmed lift hovers at 0.86–1.29.

This is arithmetically unsurprising once the rate is 64 %: a filter that keeps
two thirds of everything cannot select much. v3-A's confirmed lift looked
better (1.28–1.75) precisely **because** its rule was discarding — it was, in
effect, a fast-reversal filter wearing an iFVG costume. That is not an
argument for keeping it: it was rejecting the user's own definition of a
sweep. It is an argument that **the iFVG confirmation as specified is a timing
and entry-reference mechanic, not a selection filter** — and that whatever
selectivity a strategy needs has to come from somewhere else.

---

## 6. Hour of day (§5.1's required deliverable)

`viz/06_hour_of_day.png`, tables H1/H2.

* **Gap frequency by clock hour is almost flat** — 21.3 to 24.5 three-candle
  FVGs per 100 bars across all 24 hours, mildly higher in Asia and the Late
  block, mildly lower mid-NY. There is no "gaps form at 14:00" effect to
  exploit.
* **Unstratified, the hourly confirmation rate looks dramatic** — 77 % at 13:00
  down to 35 % at 06:00 — and is almost entirely the clock: a take-out at
  13:00 has 96 bars of NY block left, one at 06:00 has 12 bars of Asia.
* **Window-matched, it nearly flattens.** Inside the 72+ bars stratum the rate
  is 72–77 % at every hour that has one; inside 24–48 it is 49–63 %; inside
  12–24 it is 34–40 %. Because a take-out's hour and its remaining window are
  the same fact seen twice, the strata barely overlap across hours — which is
  itself the finding: **there is no hour-of-day effect left once window length
  is held fixed.**

**Location sensitivity (V5).** Strict location (the whole gap beyond the
level) gives 57.2 % vs the relaxed default's 64.4 %, with a longer median
delay (18 vs 15 bars) and a slightly smaller wick reversal. Zero
strict-but-not-relaxed confirmations under v4 (it was non-zero under v3, where
invalidation gave the relaxed run a second way to lose a candidate). The
relaxed reading stays the default (T11).

**Monthly stability.** v4's monthly confirmation rate ranges 52–74 % (median
65 %) across 48 months; median R proxy 0.57–1.16 (median 0.85). No regime
where the mechanic stops firing (`viz/07`).

---

## 7. State-machine diagnostics — two unconfirmed causes now

| cause | n | share | median bars left | median wick reversal it still made |
|---|---|---|---|---|
| confirmed | 13,606 | 64.4 % | 66 | 3.31 ATR |
| no_candidate | 6,401 | 30.3 % | 51 | **5.98 ATR** |
| live_at_block_end | 1,111 | 5.3 % | 29 | 2.76 ATR |

`invalidated_out` — 45 % of v3's primary sample — **cannot occur under v4**.

The interesting row is `no_candidate`: 30 % of take-outs never see a single
qualifying gap, and they are the ones that reversed **hardest** (5.98 ATR
median, vs 3.31 for confirmed ones). Those are V-shaped reversals with no gap
in them — the rule has nothing to fire on, and it misses the biggest moves in
the sample. Only 11.8 % of them would have confirmed given 2 h more window — the other
88 % simply never produce a qualifying gap at all, so this is a property of
the rule, not of the clock. `live_at_block_end` is small and
mostly a truncation artefact (89.8 % would confirm given 2 h more).

Once **one** candidate exists, 93 % of take-outs confirm, and more candidates
barely lowers it (87 % at 9+). Under v3 this curve sloped the other way. Median
1 candidate and 0 replacements per take-out; p90 four candidates, three
replacements (S1, S1b, `viz/03`).

---

## 8. Audit surface

`results/GALLERY.md` — **24 panels**, six strata × four, stratified across
(symbol × direction × level_session × sweep_block) with a fixed seed, not
hand-curated. Each panel draws **one horizontal line, the swept boundary**, the
take-out wick, every candidate gap numbered in formation order and coloured by
fate (green confirmed / grey replaced / orange live at block end), and the
confirmation close. v3's four extra horizontals (invalidation line, in-block
reverse and continuation extremes, stop proxy) are gone — the panel now matches
the user's diagram, and every number that used to be a line is in the header
text.

Strata: `conf1` (single candidate), `confrep` (replacement), **`multiext`** (≥2
further local extremes beyond the take-out before reversing, restricted to
take-outs v3 rejected — the user's diagram as it occurs in the data),
`diffgap` (v2 names a different gap), `unclive`, `uncnone`. Six hand-picked
teaching panels are in `viz/ex01..ex06`; `ex03` is the diagram shape at its
clearest (BTC 2023-03-22, Asia high swept, 10 further local highs, confirmed
at +45 bars, R 8.47 — v3 gave up after 3 invalidations).

The gallery is deliberately not flattering: `multiext03` is a confirmed event
with R 0.16.

---

## 9. What I would flag to the Architect

1. **The v2 bug never mattered for the headline numbers**, only for gap
   identity and executability. v2's confirmation-rate, delay and
   from-confirmation geometry tables — declared stale in §0 of the knowledge
   file — are in fact numerically correct. The knowledge file's §0 should be
   updated to say *why* they are correct rather than leaving them marked
   invalid.
2. **v3's headline claim was misattributed** and its numbers are superseded in
   full. §2 above states the correction.
3. **The mechanic does not select.** §5.5. A strategy built on this needs its
   selectivity from elsewhere — level class (PDH/PDL), window length, block, or
   a second confirmation layer. That is a design question, not a research
   finding, and it is the main thing I would want ruled on before the
   drill-down.
4. **The biggest reversals are exactly the ones with no gap** (§7). If the
   goal is to catch reversals rather than to have a clean entry trigger, the
   iFVG requirement is throwing away the best third of the sample. Worth an
   explicit decision.
5. Sequencing per the standing plan: user audits this gallery + hour chart →
   PDH/PDL drill-down (§3.2) → BoS correction pass (§5.2) → strategy design.
