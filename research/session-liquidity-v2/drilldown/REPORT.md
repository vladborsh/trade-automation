# Session-liquidity drill-down (post-v4) — which level class, which window regime

**Package:** `research/session-liquidity-v2/drilldown/` · **Role:** Researcher ·
**Brief:** `DESIGN.md` in this directory, as **REFRAMED 2026-08-31 after the v4
pass**. **Definitions:** `knowledge/session-liquidity.md` §3.2 (PDH/PDL), §5.1
v4 (the iFVG mechanic), §6 (block-scoped horizon, ATR units), §7 (V-ledger), §8
(descriptive protocol).

**Data:** BTC / ETH / SOL / BNB USD-M perps, 5m, 2022-08-01 → 2026-07-31
(1,461 UTC days per asset). No new data pull.

**Protocol:** descriptive only — no permutation null, no kill rule, no pass/fail
gate. Nothing below is a test result; everything is a measured pattern with its
sample size attached.

---

## 0. The question, and the answer in one paragraph

The v4 pass established the baseline this drill-down argues with: iFVG
confirmation is a **timing/entry-reference mechanic, not a selection filter**,
and from the confirmation close the aggregate is a coin flip (C1's median R
proxy = 1.00). The reframed question was therefore **which level class and which
window regime select**, with the iFVG-v4 mechanic held fixed.

**The answer is no — no (level class × window regime) cut separates from the
break-even aggregate in a way that survives the scale-free check.** Exactly one
cell beats median R 1.00 by a visible margin: **London level swept in NY, with
≥72 bars (6h) of the NY block still remaining — median R 1.128, R≥1 in 54.2% of
3,502 confirmed events, up from 1.005 / 50.0% aggregate, and above 1.00 in 4/4
assets.** But that cell's own excursion symmetry is **MFE/MAE = 0.90** and its
median signed efficiency ratio is **+0.003**. It is not selecting better sweeps;
it is selecting *longer windows*, and R's numerator (max favourable excursion)
grows with the window while the stop proxy — fixed at the sweep leg — does not.
Strip the window-length scaling out and the cell is the same coin flip as
everything else.

The one thing that *is* consistent across all four assets on the scale-free
metrics is a **level class**, not a window regime: **PDH/PDL swept in Asia (C3)
is the only combo whose MFE exceeds its MAE (1.11 aggregate, >1 in 4/4 assets)
and whose median signed ER is positive (+0.024, >0 in 4/4 assets).** It pays for
that with a wider stop, so its median R (0.80–0.92) sits *below* C1's. That is a
structural observation worth carrying — a shape, not an edge — and it is the
only finding in this pass that does not dissolve under stratification.

The clock question is closed the same way v4 closed it: **the clock, not the
hour.** Section 4.

---

## 1. What this pass is, mechanically, and what it inherited

### 1.1 The confirmation layer is fixed and imported, not re-derived

`ifvg_confirm_v4` (`../../session-liquidity-v4/engine.py`) is called verbatim —
the sequential state machine, latest-formed qualifying gap as the single active
candidate, replacement final, **no invalidation** (V9). Nothing in this directory
defines a confirmation rule. `dd_checks.py` asserts both halves of that:

* **PD0** — re-running `ifvg_confirm_v4` from this package over 6,000 sampled
  session-level events reproduces the v4 package's committed
  `ifvg_confirmed` / `ifvg_delay_bars` / `unconf_cause` with **0 mismatches**.
* **PD0b** — the imported `engine` module resolves to
  `session-liquidity-v4/engine.py`, and this package exposes no confirmation
  function of its own.

That is the wiring check the brief asked for. The halted first attempt ran on
v2's retroactive best-pick `ifvg_confirm`; **everything downstream of
confirmation was regenerated**, and only the level-class machinery, the
stratification code and the plotting plumbing were salvaged.

### 1.2 Researcher's ledger (choices the brief left open)

Documented here rather than escalated, per the brief's "ask only where a choice
changes what is measured".

| # | Choice | Decision |
|---|---|---|
| DD1 | PDH/PDL `level_session` label | `"PriorDay"` — a fourth value, never mixed into Asia/London/NY |
| DD2 | prior day must be materially complete | ≥ 240 of 288 5m bars, else the day defines no PDH/PDL |
| DD3 | coincidence tolerance | 0.05 × ATR at the take-out bar (pinned by §3.2) |
| DD4 | signed-ER span | confirmation close → block end |
| DD5 | ER denominator | Σ\|bar-to-bar close moves\| over the same span; NaN when that is 0 |
| DD6 | gap-size ATR denominator | ATR(14) at the **FVG's third bar**, not at the take-out |
| DD7 | quintile edges | per combo, pooled over assets |
| DD8 | window-length strata | 12–24 / 24–48 / 48–72 / 72+ bars remaining (brief-pinned) — **the primary axis** |
| DD9 | clock sub-window | reported as the **secondary, derived** cut, tested against the v4 null |
| DD10 | C1's event source | the v4 package's committed `events_*.csv`, not v2's `results/` |

### 1.3 What is not here

BoS (V6, still quarantined — neither computed nor drawn). No permutation null,
no gate. The strict-location iFVG variant is carried as a column but not
analysed; §5.1's relaxed reading (V5) is the primary throughout.

---

## 2. The PDH/PDL stream — diagnostics before any outcome

A new level class does not report outcomes before it is shown to behave.
Everything in this section is about the stream itself.
Chart: `viz/01_pd_stream_diagnostics.png`. Tables: `results/d1`–`d6`.

**Frequency (D1).** ~0.90 day-level take-outs per asset-day, against ~4.0
session-level take-outs — the day level is a much rarer object. The prior day's
high is taken out on 45.5–47.4% of days, the low on 42.9–44.3%, both on ~10%.
PDH/PDL is 18.4% of all take-out events across both streams.

**Where in the clock (D2).** Asia hosts the most day-level take-outs of any
block. That is a **property of the definition, not a market fact** — the level
becomes sweepable at 00:00 UTC and Asia gets first refusal on it every day. C3's
event count should be read with that in mind.

**Confirmation (D3).** The day level confirms at essentially the session level's
rate: **64.9% vs 64.4%** on the primary sample (≥12 bars remaining), median delay
15 bars either way. The new class is neither harder nor easier for iFVG-v4 to
see, which is what makes C1/C2/C3 comparable at all.

**Why the full prior day, Late included (D4).** On **16.3%** of days the day's
high prints in the 21:00–24:00 Late block, and on **15.9%** the low does; on
**32.1%** of days at least one extreme does. A "max of the three session highs"
shorthand would be wrong on a third of days, and wrong in the direction that
matters — sitting *below* the real high, so that a "sweep" of it is not a sweep
of anything. This is the number that justifies §3.2's choice.

**Coincidence — the most important diagnostic here (D5).** **73.2%** of
day-level take-outs happen at a price where a still-alive session level sits
within 0.05 ATR: the same excursion takes both. **The day level is mostly not an
independent object** — it is a relabelling of a session level that happened to be
the day's extreme. The 26.8% "pure" remainder is the honest read of what the
class adds, and it is the *better* half: median R 0.87 vs 0.72, median ER +0.025
vs +0.012, confirmation 67.8% vs 63.8%. Better — and still below break-even.

**Pure day-level by block (D6).** Asia 700 confirmed events, MFE/MAE 1.085, ER
+0.027, R 0.896; NY 103 events, MFE/MAE 0.921, R 0.875. London (48) and Late (11)
are too thin to read.

**Worked-example gallery.** `results/PD-GALLERY.md` + `viz/pd_*.png` — 18 real
day-level take-outs (6 wins / 6 failures / 6 unconfirmed), stratified across
symbol × side × block × coincidence with a fixed seed, not hand-picked. Each
panel draws the prior UTC day as a shaded band, the midnight boundary at which
the level becomes sweepable (the lookahead audit, visible by eye), both rays
across their one-day lifetime, a marker on the bar *inside the prior day* where
the extreme printed with its block, and — inherited from the v4 panel — **every
candidate gap the state machine saw**, numbered in formation order and coloured
by fate (confirmed / replaced / still-live). **Per the user's request the
take-out-wick star marker is not drawn**; the boundary line is the swept level
and the shaded window starts on the take-out bar. No measurement anchor changed.

---

## 3. Question (a), primary axis — the window regime

Tables `results/w1`–`w5`; charts `viz/02_window_regime.png`,
`03_window_matched_combos.png`, `04_per_asset_consistency.png`.

### 3.1 What the regime buys (W1)

Every combo shows the same gradient. C1, across 12–24 / 24–48 / 48–72 / 72+ bars
remaining:

| | 12–24 | 24–48 | 48–72 | 72+ | ALL |
|---|---|---|---|---|---|
| confirmed n | 68 | 307 | 914 | 3,502 | 4,791 |
| iFVG-v4 rate | 31.3% | 53.6% | 71.6% | 76.1% | 71.8% |
| median R | 0.53 | 0.63 | 0.81 | **1.13** | 1.00 |
| R ≥ 1 | 14.7% | 32.6% | 42.5% | **54.2%** | 50.0% |
| MFE/MAE | 1.41 | 1.05 | 0.91 | **0.90** | 0.90 |
| median signed ER | +0.082 | −0.006 | −0.006 | **+0.003** | +0.001 |

The confirmation rate reproduces v4's window-length gradient exactly — longer
window, higher rate, mechanically, because there is more block left for a gap to
form and invert in. **R and MFE rise for the same mechanical reason**: a longer
window contains a larger maximum excursion, and the stop proxy (the sweep leg,
frozen at confirmation) does not grow with it.

The two scale-free columns say the opposite thing. MFE/MAE **falls** from 1.41 to
0.90 as the window lengthens, and ER is flat at ~0. Read together: *the long-window
regime does not contain better sweeps. It contains more time for a fixed-quality
path to reach a larger extreme against a fixed stop.*

### 3.2 Level class vs level class at matched window regime (W2, W3)

The clock cannot be held fixed inside a block (§4.2), but the level class can.
In the 72+ stratum:

| combo | n | iFVG rate | median R | R≥1 | MFE/MAE | clean-trend | median ER |
|---|---|---|---|---|---|---|---|
| C1 London→NY | 3,502 | 76.1% | **1.128** | **54.2%** | 0.901 | 34.0% | +0.003 |
| C2 PDH/PDL→NY | 373 | 72.1% | 0.893 | 46.4% | 0.921 | 35.1% | −0.002 |
| C3 PDH/PDL→Asia | 1,060 | 72.0% | 0.915 | 46.8% | **1.106** | **39.1%** | **+0.027** |

Two different orderings, and they disagree. On **R**, C1 wins — and the ATR
columns show why: C1's median MFE in this stratum is **3.29 ATR** against C2/C3's
2.79, on a comparable stop (2.82 / 3.00 / 2.85). London-in-NY sweeps simply run
further in absolute terms. But their MAE is larger too (3.65 vs 3.04 / 2.52),
which is exactly why C1 has the *worst* MFE/MAE of the three. On the
**scale-free** columns, C3 wins.

Per asset (W3, 72+ stratum, `viz/04`):

* MFE/MAE > 1: **C3 in 4/4** assets (1.03–1.19), C1 in 0/4, C2 in 1/4.
* Median ER > 0: **C3 in 4/4** (+0.006 … +0.034), C1 in 3/4 (all ≤ +0.008), C2 in 1/4.
* Median R ≥ 1: C1 in 4/4 (1.007–1.196), C2 in 2/4, C3 in 1/4.

C1's R advantage and C3's shape advantage are both consistent across assets, and
they are measuring different things. Neither is large.

### 3.3 The pure day-level subset (W4)

Repeating the window-regime cut on the 26.8% of day-level take-outs that stand
alone: C3-pure in the 72+ stratum is 534 confirmed events, MFE/MAE 1.018, ER
+0.018, median R 0.914 — essentially C3 unchanged, which is the reassuring
result (the class's shape is not an artefact of the coincident majority).
C2-pure's 72+ cell shows median R 1.197, but on **43 confirmed events**; that is
noise, and it is flagged here rather than quoted as a finding.

### 3.4 The separation summary (W5)

| combo | agg R | agg ER | agg MFE/MAE | best regime | best R | best R≥1 | regime R spread | vs C1 agg |
|---|---|---|---|---|---|---|---|---|
| C1 | 1.005 | +0.001 | 0.900 | 72+ (n=3,502) | 1.128 | 54.2% | 0.593 | **+0.123** |
| C2 | 0.735 | −0.003 | 0.889 | 72+ (n=373) | 0.893 | 46.4% | 0.371 | −0.111 |
| C3 | 0.804 | +0.024 | 1.113 | 72+ (n=1,060) | 0.915 | 46.8% | 0.458 | −0.090 |

**This is the pass's headline table.** The best cell in the whole design is C1 ×
72+, at **+0.123 median R over the break-even aggregate** and +4.2pp on the R≥1
share, on a large sample and consistent in 4/4 assets. Whether that is "a real
cut" depends entirely on whether you believe R is measuring the sweep or
measuring the window: §3.1 says it is measuring the window.

---

## 4. Question (a), secondary — the clock sub-window

Tables `results/s1`–`s4`; charts `viz/05_subwindow_hourly.png`,
`06_clock_not_hour.png`. **The v4 result — "no best hour, only a best remaining
window" — is the null every claim here is tested against.**

### 4.1 The raw hourly picture, and why it is not about the hour

C1's median R by take-out hour runs 1.171 (13:00) → 1.046 → 0.812 → 0.808 →
0.686 → 0.561 → 0.535 (19:00). A 0.64 spread, perfectly monotone, and it looks
like a strong intraday effect. The `bars_left_median` column in the same table
runs 91 → 78 → 67 → 54 → 42 → 30 → 19. It is the same curve.

C3 and C2 show the identical shape on their own blocks (C3: 0.900 at 00:00 down
to 0.457 at 06:00, bars left 91 → 17).

### 4.2 Why the confound cannot be removed at this resolution (S3b)

Inside a fixed block the take-out hour and the bars-of-block-remaining are the
**same variable measured twice**: Spearman ρ = **−0.944 (C1), −0.986 (C2),
−0.971 (C3)**. Every 2h window sits in exactly one window-length stratum
(`two_h_windows_per_stratum` = 1.00 in all three combos), so at 2h resolution
there is *nothing left to compare* inside a stratum. Only at 1h resolution does
any within-stratum comparison exist at all, and then only ~1.75 hours per
stratum. This is not a caveat attached to the hourly tables — it is what those
tables are.

### 4.3 What survives (S4)

| combo | raw 2h R spread | R spread within the largest stratum | raw ER spread | ER spread within stratum |
|---|---|---|---|---|
| C1 | 0.593 | **0.125** | 0.088 | **0.002** |
| C2 | 0.371 | **0.043** | 0.102 | **0.001** |
| C3 | 0.458 | **0.047** | 0.039 | **0.024** |

Between 79% and 88% of the raw R spread disappears the moment window length is
held fixed, and essentially all of the ER spread does in C1/C2. **The clock, not
the hour.** The v4 null stands; this pass found nothing to overturn it, on either
level class.

---

## 5. Question (b) — iFVG gap size as a predictor

Tables `results/g1`–`g5`; charts `viz/07_gap_quintiles.png`,
`08_gap_spearman.png`. Descriptive, not gated.

**The predictor.** Primary: the inverting FVG's height ÷ ATR(14, 5m) **at the
gap's own third bar** (causal, cross-asset comparable). Secondary: the same
height ÷ the swept structure's own frozen range (the level session's high−low;
for PDH/PDL, the prior day's range) — known before the sweep. The sweep block's
range was **rejected** as a denominator: it is not known at confirmation time.

**Distribution (G1).** A typical inverting 5m FVG is a fraction of one ATR tall —
median 0.31 ATR (C1), 0.30 (C2), 0.35 (C3) — and a low single-digit percentage of
the structure it swept (median 6.0% for C1's session ranges, 2.6% for the day
ranges). Quintile edges should be read in those terms.

**Quintiles (G2).** Median R falls monotonically with gap size in all three
combos — C1 1.049 → 1.098 → 1.137 → 0.938 → 0.797, C2 0.828 → 0.526, C3 0.973 →
0.657. That looks like a finding. It is not:

* Median **MFE barely moves** across the quintiles (C1 2.59 → 3.35 ATR, C3 2.40 →
  2.46).
* Median **stop proxy moves a lot** (C1 2.25 → 3.69, C2 2.16 → 4.09, C3 2.39 → 3.75).
* **ρ(gap size, stop proxy) = +0.37 (C1), +0.42 (C2), +0.34 (C3)** — G5.

A taller gap puts the inversion close further back from the sweep extreme, so R's
**denominator** grows with the predictor almost by construction. The declining R
is a relationship with the stop, not with the move.

**Correlations (G3).** Against signed ER the predictor is **flat**: |ρ| ≤ 0.06 in
every one of the 12 asset × combo cells, and the sign is not even consistent
(positive in 2, negative in 10, all trivially small). Against MFE it is
0.00–0.15, again inconsistent. Against R it is negative in **12/12** — the stop
artefact above.

**Robustness within strata (G4).** The R correlation persists inside every
window-length stratum (−0.10 to −0.26), which is what you would expect from a
mechanical stop relationship rather than a time-dependent one. The ER correlation
stays flat inside strata too, except C1's 68-event 12–24 cell (−0.263, too small
to read).

**Entanglement check (G5).** The design says gap size and time-remaining "should
be unrelated, but that is checked, not assumed". They are unrelated: ρ(gap,
bars-left) = +0.036 / +0.037 / −0.018, ρ(gap, hour) = −0.029 / −0.034 / +0.030.

**Verdict against the design's pre-pinned bar** (monotone quintiles **plus** a
consistent-sign correlation across all four assets): the R column meets the
letter of the bar and fails its intent, because the mechanism is R's denominator.
On the metric that cannot be gamed that way — signed ER — the predictor is
**flat**. **Not a relationship worth carrying to a design pass.**

---

## 6. Correctness

`dd_checks.py` — **27 assertions, all passing.** Beyond PD0/PD0b (§1.1):

* **Level construction** — PDH/PDL equals the prior *full* UTC day's extreme with
  Late included (PD5); the level is frozen before its sweepable day's first bar
  (PD6, the lookahead audit); its lifetime is exactly that one day (PD7); it is
  retired on first take-out per side (PD4, V7); Late genuinely moves the day's
  high on 15.9% of days, so the definition is not cosmetic (PD8).
* **Block containment** — `bars_remaining` consistent with the block end (PD9);
  the horizon never crosses a block or day boundary (PD10); the confirming close
  and the FVG's third bar both inside the window (PD11, PD12).
* **Stream separation** — disjoint files and disjoint labels, no session label in
  the day stream and no `PriorDay` in the session stream (PD15a, PD16); every
  exact-price overlap flagged, never deduplicated (PD15b: 3,633 overlaps, 0
  unflagged); 4,099 shared bars, 74.6% flagged coincident (PD17).
* **Prefix stability** — a 60%-truncated re-run reproduces all 773 in-prefix
  events bar-for-bar (PD18), i.e. the engine is causal.
* **Derived metrics** — |ER| ≤ 1 by construction (PD19); gap heights positive
  (PD20); the predictor resolves on 100.0% of confirmed events (PD21); the
  structure-range denominator on 100.0% (PD22).
* **v4 hygiene** — the day stream carries `n_candidates` / `n_replacements` /
  `unconf_cause`, whose values are exactly {confirmed, no_candidate,
  live_at_block_end} (PD23), and no event carries the deleted v3
  `invalidated_out` cause (PD24).

---

## 7. Pine

`session_liquidity_v4_pdhpdl.pine` — the **v4** indicator plus an optional
PDH/PDL layer, **default off**. The diff against the v4 file is purely additive
(118 added lines; the only changed lines are the header's "no PDH/PDL rays"
sentence and the `indicator()` title). Full delta and the audit recipe in
`PINE-DELTA.md`. Deliberately absent: BoS; PDH/PDL joining the level pool; a
second on-chart iFVG machine watching day-level take-outs; de-duplication of
coincident levels.

The earlier attempt's delta was built on `session_liquidity_v2.pine`, whose iFVG
drawing is the retroactive best-pick v4 replaced. That file is not in this
package.

---

## 8. What this means for a design pass

**Pros.**

* The PDH/PDL level class is cheap, behaves, and is fully audited (§2, §6). It
  can be added to any later design without disturbing the session-level stream.
* **C3 (PDH/PDL swept in Asia) is the only cut in the study with a consistent
  scale-free shape**: MFE > MAE in 4/4 assets, positive median ER in 4/4, highest
  clean-trend share (39.1% in the 72+ stratum). If a later design wants a
  *directional* post-sweep path rather than a favourable stop ratio, that is
  where to look — and it survives on the pure, non-coincident subset.
* The window regime is a genuinely strong sorter of the **confirmation rate**
  (31% → 76%), which is operationally useful even though it is not an edge: it
  tells you when the mechanic will fire at all.

**Cons, and the doubts.**

* **Nothing here beats the coin flip once window-length scaling is removed.** The
  single R-positive cell (C1 × 72+, +0.123 over aggregate) has MFE/MAE 0.90 and
  ER +0.003. I do not believe it is a selection effect, and I would not build on
  it.
* **73% of the new level class is the old one in disguise.** The genuinely new
  events are 26.8% of an already-rare stream — ~0.24 pure day-level take-outs per
  asset-day. C3-pure's 72+ cell is 534 confirmed events over four years and four
  assets. That is a small tradeable population.
* The gap-size predictor is flat on every metric that is not contaminated by the
  stop proxy. It should not be carried.
* C2 (PDH/PDL swept in NY) is the weakest combo on every column and every asset
  count. It does not warrant further work.
* The stop proxy itself is doing a lot of work in this pass's R numbers, and it
  is a *proxy* (the sweep-leg extreme), not a rule anyone has committed to.
  Several of the orderings above would move under a different stop. That is the
  largest single fragility in the conclusions, and it is worth pinning a real
  stop rule before any further R-based comparison is run.

**Software Engineer guidelines, if anything here is built.** PDH/PDL is the full
prior UTC day (Late included, DD2's ≥240-bar completeness gate), sweepable from
00:00, one-day lifetime, retired on first take-out per side, emitted to its own
event stream with a `coincident_session_level` flag at 0.05 ATR. Confirmation is
`ifvg_confirm_v4`, unchanged and unforked. All measurement is block-scoped with
the ≥12-bars-remaining primary rule, in ATR(14, 5m).

---

## 9. Reproducing

```
.venv/bin/python research/session-liquidity-v2/drilldown/pd_engine.py   # ~15s, PDH/PDL stream
.venv/bin/python research/session-liquidity-v2/drilldown/dd_prep.py     # both streams + derived cols
.venv/bin/python research/session-liquidity-v2/drilldown/dd_checks.py   # 27 assertions
.venv/bin/python research/session-liquidity-v2/drilldown/dd_tables.py   # results/TABLES.md + CSVs
.venv/bin/python research/session-liquidity-v2/drilldown/dd_charts.py   # viz/01..08
.venv/bin/python research/session-liquidity-v2/drilldown/dd_gallery.py  # viz/pd_*.png + PD-GALLERY.md
```

Requires `research/session-liquidity-v4/data` → `../intraday-mtf-smc/data`
(the cached 5m klines) and the v4 package's committed `results/events_*.csv`.
`results/dd_events.csv.gz` is a 6.7 MB intermediate and is gitignored — `dd_prep.py`
rebuilds it in a few seconds.
