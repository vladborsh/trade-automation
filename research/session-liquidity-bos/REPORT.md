# Session-liquidity sweeps — **BoS pass**: the corrected mechanic, measured for the first time

**Role:** Researcher · **Hand-off:** Architect (`HANDOFF.md`)
**Spec:** `DESIGN.md` §1 (the pinned mechanic) ·
`knowledge/session-liquidity.md` §1/§3/§4/§6/§8 (unchanged conventions),
§5.2 (what this pass rewrites) ·
`research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md` (the defect
analysis and the user's two sketches, read directly)
**Comparison layer:** `research/session-liquidity-v4/` (iFVG §5.1 v4), reused
read-only and asserted identical (`checks.py`).

Sample: BTC/ETH/SOL/BNB USD-M perp, 5m, 2022-08-01 .. 2026-07-31.
**23,423 take-outs**, byte-identical to the v2/v4 event stream; **21,118
(90.2%)** primary (≥ 12 bars left in the sweep block). Session levels only;
PDH/PDL out of scope. Descriptive protocol (§8): no null, no gate, no kill
rule.

`checks.py`: **18/18 PASS**.

---

## 0. What this pass is, and is not

* It **implements and measures the corrected BoS mechanic for the first
  time.** Phase 1's BoS numbers measured a different event; v2/v3/v4 excluded
  BoS entirely. Everything numbered here is new.
* It is **not** a re-measurement of the take-out stream or of iFVG. Both are
  reproduced bit-identically so that every difference in this package is
  attributable to the confirmation layer. `checks.py` asserts the take-out
  columns and the iFVG confirmations against v4's committed CSVs.
* It is **descriptive**. No permutation null, no pass/fail. Two results below
  are stated as *nulls that the data does not overturn*, not as tests.
* The stop and R columns are **proxies**, pinned by DESIGN §2 to be the same
  convention iFVG already used, so R is comparable across methods and across
  packages. They are not a trading result: no costs, no exit rule, and MFE is
  a best-case exit nobody hits systematically.

---

## 1. The mechanic, restated in one paragraph

At the take-out bar `t0` of a high sweep (low sweep is the exact mirror), the
BoS level is **the most recent pivot low that is already confirmed as of
`t0`** — `fractals(df, k=3)` from `research/intraday-mr-smc/indicators.py`,
reused verbatim, whose flags are already shifted by `k`, so a pivot is known
exactly 3 bars after it prints. That level is **pinned**: drawn forward as a
ray and watched, unchanged, for the life of the event. **The BoS is the first
CLOSE beyond it inside `[t0, end of the sweep block]`.** One break maximum. No
qualifying pivot at all → the event is *unanchorable* and is reported as its
own category.

Two mechanical facts fall out of this and are worth stating before any number:

1. **DESIGN §1's second condition is redundant, and that resolves the
   correction note's open question.** "Confirmed as of `t0`" already forces the
   pivot bar to be `≤ t0 − k`, so "strictly before `t0`" can never bind. The
   note's open question — whether "precedes the extreme" means the extreme bar
   or the start of the final leg when the extreme is a multi-bar grind — is
   therefore moot under a causal `k=3` fractal: the anchor is *always* at least
   3 bars before the take-out, and plain bar-index ordering decides it with no
   special case. `checks.py` asserts both conditions on all 23,423 events
   anyway (min gap 3 bars, max lag 45).
2. **The anchor is fresh in time but far in price.** Median age **7 bars**
   (p90 15, max 48), so it really is "the pivot that anchored the leg into the
   sweep" and not some ancient level. But its median distance from the take-out
   wick is **4.93 ATR** (p10 3.16, p90 7.41), and it lies on the *near* side of
   the swept level in **100.0%** of events. A BoS is therefore always a close
   back **deep inside** the swept range. Everything uncomfortable in §4 and §5
   follows from this one geometric fact.

---

## 2. Read this first — the four headline results

### 2.1 The unanchorable category is empty

**0 of 23,423 events** (0.000%). DESIGN §1 asks for a loud flag above ~2%;
there is nothing to flag. The category stays in the schema, in the tables and
in the gallery (as an explicitly empty stratum) so that a re-run on another
instrument, another timeframe or a coarser `k` has a stated zero to compare
against.

### 2.2 The re-anchoring defect was enormous, and in the opposite direction to the prediction

On the same 21,118 primary take-outs, with the same horizon, the same geometry
formulas and the same `k=3` pivots — the *only* difference being whether the
tested level may move after `t0`:

| arm | confirms | rate | delay median | stop median | R median |
|---|---|---|---|---|---|
| **BoS, corrected** (pinned anchor) | 7,135 | **33.8%** | 18 bars | **5.77 ATR** | **0.41** |
| **BoS, phase 1** (re-anchoring) | 17,394 | **82.4%** | 19 bars | 3.86 ATR | 0.51 |

And the defect, in the two numbers that name it (D2):

* the two mechanics select the **same level at the take-out bar** on **98.5%**
  of take-outs — at `t0` they *are* the same rule;
* by the bar phase 1 fires, it is still testing that level on only **11.3%**
  of its own confirmations, because a **median of 2** newly confirmed pivots
  overwrote it in between.

So phase-1 "BoS" was not a break of the structure that led into the sweep. It
was a break of whatever minor swing happened to be the most recent one at the
time — a signal that fires on **82%** of all take-outs and is therefore close
to unconditional. The correction note predicted that re-anchoring **inflated**
phase 1's delay (14 bars) and stop (3.76 ATR). Measured on a common horizon,
the direction is **wrong on both counts**: re-anchoring made the test *easier
and tighter* (82% vs 34%, 3.86 vs 5.77 ATR), not looser, and the delays are
within one bar of each other. The note's reasoning only considered pullback
lows forming *below* the pre-extreme anchor after the reversal had begun; in
practice the pivots that confirm inside the window are overwhelmingly ones the
reversal *just made*, i.e. much closer to price than the pinned anchor, so each
re-anchoring hands phase 1 a nearer target. That is a correction to the
correction note and it is recorded in `RESEARCH-LOG.md`.

**Consequence for the record:** phase-1's T2/T3/T5/T12/T13 BoS rows and the
C-BoS arm of the invalidated `STRATEGY-DESIGN.md` should not be cited, exactly
as the note said — but not because they are a stretched version of the right
number. They are a different, near-unconditional event.

### 2.3 Corrected BoS and iFVG-v4 are two different signals, not two readings of one

First comparison with both methods correctly implemented, on identical
take-outs (M1, primary sample):

| | iFVG confirms | iFVG does not |
|---|---|---|
| **BoS confirms** | 15.6% | 18.2% |
| **BoS does not** | 48.8% | 17.4% |

Only **15.6%** of primary take-outs are confirmed by both; the union is 82.6%.
Where both fire, BoS is **later by a median of 11 bars** and is first on only
**23.3%** of them (M2). On the 3,302 take-outs both confirm — event set held
fixed, so nothing is confounded by them selecting different sweeps — the two
entry references are not close (M3b):

| method | delay | MFE | MAE | stop | R median | R ≥ 1 |
|---|---|---|---|---|---|---|
| BoS, corrected | 24 bars | 2.04 | 3.66 | **6.78** | **0.30** | 15.9% |
| iFVG v4 | 13 bars | 6.01 | 1.64 | **2.94** | **2.05** | 76.9% |

Read that as the price of the mechanic, not as a verdict on the idea: BoS by
construction waits until price has come back through a level several ATR away,
so it enters late, from a worse place, with a wider stop, and after most of the
move it was waiting for has already happened.

### 2.4 BoS does **not** select either — the v4 null survives, once the circularity is removed

This is the result that most needs care, because the naive version says the
opposite.

The naive lift table (M4/M4b) says BoS-confirmed take-outs reverse **1.9–3.3×**
the unconditional median, against 1.1–1.9× for bare take-outs and 0.9–1.5× for
iFVG-confirmed. That looks like a strong selection effect and it is **an
artifact**. The lift metric is the wick-anchored reversal `rev_atr`; a BoS
requires a close through a ray a median of 4.22 ATR below the take-out wick;
so a BoS confirmation **mechanically implies `rev_atr > anchor_dist_atr`** —
measured on **100.0%** of confirmations (M4d, chart 05 left panel). The
criterion is a threshold on the very quantity being reported. iFVG has no such
floor, which is why v4's lift table was interpretable and this one is not.

The non-circular version (M4e) throws away everything before the confirmation
bar and compares each event's **post-confirmation MFE** against the
unconditional forward move for the same block × bars-remaining-at-confirmation
× direction cell:

| method | forward lift, median | share ≥ 1 |
|---|---|---|
| BoS, corrected | **0.87** | 44.6% |
| iFVG v4 | **0.83** | 41.8% |
| BoS, phase 1 | 0.74 | 38.2% |

All three are **below 1.0**: after either confirmation, what is left of the
block is slightly *smaller* than a random comparable stretch of tape, not
larger. The v4 finding — *confirmation is a timing / entry-reference mechanic,
not a selection filter* — extends to the corrected BoS unchanged. BoS is
marginally the better of the two on this axis (0.87 vs 0.83), a gap far too
small to build on and not tested against any null.

---

## 3. Core numbers (corrected BoS, primary sample)

### 3.1 Confirmation rate — `level_session` × `sweep_block` (T2)

| level_session | Asia | London | NY | Late | ALL |
|---|---|---|---|---|---|
| Asia | 25.0 | 33.6 | 32.3 | 19.3 | 31.9 |
| London | 28.4 | 23.2 | **43.9** | 11.8 | 40.7 |
| NY | 31.6 | 23.3 | 28.5 | 22.2 | 27.0 |
| **ALL** | 29.7 | 31.6 | **39.0** | 20.8 | **33.8** |

The strongest cell — London liquidity taken out inside NY, 43.9% — is also the
biggest cell (2,920 events) and is the same cell the earlier passes liked. The
Late block is the weakest everywhere, which is window length (T3, W1). Spread
across the 96 fully-populated `level_session × sweep_block × direction × asset`
cells: 3% / 28% / 46% (min / median / max), median R proxy 0.06 / 0.34 / 1.21
(T2c) — i.e. the cell-level dispersion is large and the median cell is not
close to R = 1.

### 3.2 Timing (T3)

Median take-out → break delay **18 bars (90 minutes)**; p25 9, p75 33, p90 51.
Per block: Asia 23, London 18, NY 18, Late 11 — the Late number is a window
truncation, not speed. Of the 13,983 anchorable take-outs that never broke,
**13.4%** would have broken had the block run 2h longer (a probe, not a
definition), rising to 22–23% in London and Late where blocks are short.

### 3.3 Geometry from the break close (T6, T7)

Pooled: MFE **2.42 ATR**, MAE **2.37 ATR**, ratio 1.02; end-of-window value
−0.08 ATR with **48.2%** of events still on the favourable side at block close.
Stop proxy **5.77 ATR** (p90 9.78), **R median 0.41**, R ≥ 1 on **22.4%**, R ≥ 2
on **7.4%**.

The MFE/MAE ratio of ~1.0 and the coin-flip end value are the same shape v4
found for iFVG. What is different is the denominator: iFVG's stop proxy is
2.67 ATR, BoS's is 5.77. Same MFE, twice the stop, half the R. **That is the
central quantitative finding about the corrected mechanic and it is a direct
consequence of §1's fact 2** — the anchor is a long way from the take-out, and
the stop convention measures back to the sweep leg's running extreme.

### 3.4 Window length is the primary axis (W1, W2)

| bars left at take-out | share | BoS | iFVG | phase-1 BoS |
|---|---|---|---|---|
| < 12 (short) | 9.8% | 5.6% | 10.7% | 7.9% |
| 12–24 | 10.2% | 14.3% | 37.7% | 37.9% |
| 24–48 | 22.6% | 26.0% | 56.1% | 71.8% |
| 48–72 | 23.7% | 31.5% | 68.9% | 90.8% |
| 72+ | 33.7% | **46.5%** | 75.0% | 97.0% |

An 8× swing in BoS rate across window buckets, versus a 1.5× swing across
`level_session` and 1.9× across `sweep_block`. The **anchor distance is flat
across the buckets** (5.45 → 4.78 ATR), so this is time, not geometry: the
mechanic needs enough bars for price to travel back through a distant ray. R
climbs with window length too (0.23 → 0.53), for the same reason.

### 3.5 The clock is derived (H1, chart 07)

Unstratified, BoS rate by take-out hour ranges 11% (19:00) to 54% (13:00) —
and 13:00 is simply the hour with a full 96-bar NY block ahead of it. Inside a
bars-remaining stratum the hourly pattern largely collapses; the residual
(hour 13, 54.3% vs hour 0, 41.6%, both in the 72+ bucket) is the *block*
difference already in T2 (NY 39.0% vs Asia 29.7%), plus the fact that the "72+"
bucket is coarse (96 vs 84 bars). The §6.1 rule — *no best hour, only a best
remaining window* — holds for BoS as it did for iFVG. Chart 07 shows both
panels side by side, which is the honest way to present it.

### 3.6 Stability (T12, chart 06)

Monthly BoS rate **27–41%** (median 33%) across 48 months; monthly median R
proxy **0.25–0.59** (median 0.41). No regime break, no drift, worst month
2026-03 and best 2023-01.

### 3.7 Full sample (A1, A2)

Including the 9.8% of take-outs with < 12 bars left: BoS 31.0%, phase-1 BoS
75.0%, iFVG 59.1%. Nothing is hidden by the primary filter — the short-window
events simply have almost no window (median 6 bars) and confirm at 5.6%.

---

## 4. What I would flag, honestly

1. **The corrected BoS is a poor entry reference under this stop
   convention.** R median 0.41 vs iFVG's 0.84 on their own subsets, and 0.30 vs
   2.05 on the take-outs both confirm. If a design wants an entry, the iFVG is
   the better-behaved of the two and this pass does not change that.
2. **But the stop convention may be the wrong question for BoS.** DESIGN §2
   pinned the stop to the sweep-leg running extreme precisely so R would be
   comparable, and it is — but a trader using a BoS would plausibly stop above
   the *last swing that formed after the break*, not above the sweep wick 5 ATR
   away. That is a different measurement, not a fix to this one, and it is out
   of scope for a descriptive pass. I flag it as the single most likely reason
   these R numbers understate the mechanic. **It would not change §2.4** — the
   forward-lift test never touches the stop.
3. **The 18.2% "BoS only" cell is the interesting one.** These are take-outs
   with a real reversal and no qualifying gap anywhere — v4 already noted that
   the 30% of take-outs with no gap carry the *largest* reversals in the
   sample. BoS covers part of that blind spot: it is the only confirmation
   available on 3,833 primary take-outs. Whether that coverage is worth its
   lateness is a design question, not a research one.
4. **Nothing here is tested.** Every number is descriptive. The two "does not
   select" statements are nulls the data does not overturn under a
   window-matched descriptive ratio, not hypothesis tests, and I would not put
   a p-value on the 0.87 vs 0.83 gap.
5. **The anchor is fresh (7 bars) more often than the sketches suggest.** In
   the user's drawings the ray comes off a clearly-formed higher-low several
   swings back. In the data the most recent confirmed pivot is usually the last
   shallow pullback inside the final leg. Both are the same rule; the sketches
   just draw cleaner legs than the tape produces. The `sketch*` gallery stratum
   (aged anchor, far anchor, late break — 4.8% of primary events) is where the
   drawn shape actually occurs, and those panels do look like the sketches.

---

## 5. Audit surface

* **`results/GALLERY.md` + `viz/{broke,sketch,nobreak,defect,p1only,bosonly,ifvgonly}*.png`**
  — 28 stratified, seeded, un-curated panels, plus 6 hand-picked teaching
  panels `viz/ex0*.png`. **Every panel draws the pinned anchor ray from its
  pivot to its break (or window end)**, beside phase 1's level *as it moved*.
  The correction note called the missing ray a minor "viz gap"; it was the
  reason the defect survived a whole pass, because no worked example could
  contradict the engine. Drawing it is part of the fix. The unanchorable
  stratum is present and explicitly empty. No take-out-wick star (user
  preference); the take-out is the dotted vertical `t0` line.
  `viz/ex02_BNBUSDT_20230527_1355_lo.png` is the defect on one chart.
* **`results/TABLES.md`** — every table, with the CSV beside it.
* **`viz/01..07_*.png`** — the aggregate views. Chart 05 is the one to read
  first: it shows why the naive selection answer is wrong and what the right
  one is.
* **`checks.py` — 18/18 PASS**, including the two DESIGN §2 asks that matter
  most: *anchor precedence* (pivot bar < `t0`, confirmation ≤ `t0`, on every
  event) and *anchor immutability*, proved three ways — re-deriving the anchor
  from a data **prefix that ends at `t0`** (so no later pivot is even visible),
  brute-forcing the break against the fixed level, and asserting no bar before
  the break sits on the far side of the ray. Plus block containment, prefix
  stability, the v2/v4 take-out-stream reproduction, and the iFVG arm
  reproducing v4's confirmations bar for bar.
* **`session_liquidity_bos.pine` + `RUNBOOK.md`** — the manual TradingView
  audit, with the anchor ray, the optional phase-1 step-line, and the v4 iFVG
  machine on the same chart.

---

## 6. Reproduce

```
cd research/session-liquidity-bos
python engine.py     # ~35s, writes results/events_*.csv, uncond_*.csv.gz
python tables.py     # writes results/TABLES.md + every CSV
python charts.py     # writes viz/01..07
python examples.py   # writes viz/ex01..06
python gallery.py    # writes viz/<stratum>* + results/GALLERY.md
python checks.py     # 18/18 PASS
```
