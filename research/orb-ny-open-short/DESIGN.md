# DESIGN — Short opening-range breakout at the New York open (`orb-ny-open-short`)

**Status:** pre-registration. **Committed before any R was computed on any of
the six arms.** Binding ruling: `research/orb-ny-open/ARCHITECT-NOTE-FOLLOWUP.md`
(commit `86ddf55`, 2026-09-16), which is itself a follow-up to
`research/orb-ny-open/ARCHITECT-NOTE.md` (`7ff19fc`) and inherits everything it
does not explicitly change.

This document is the mechanical restatement of that note. Where this document
and the code disagree, **this document is the pre-registration and the code is
the bug**. Where this document and the follow-up note disagree, the note wins
and this document is the bug — and the disagreement is a §11 stop, not a local
fix.

**This family re-uses a holdout that has already been read.** The
2025-08-01 .. 2026-07-31 year was cut once by the closed `orb-ny-open` pass, on
the same instruments and the same days. Every consequence of that — the
cumulative Bonferroni bar, the fit-period screen, the dose-response reading,
the reporting rules — is in §4.2, §8 and §9 and is not optional.

---

## 0. The question, and the two evidentiary standards

**The question.** Does a *shorter* opening range — 5, 10 or 15 minutes instead
of 30 — with the trigger starting **at that range's end**, produce an edge
where the 30-minute range did not?

**What the closed pass actually established**, quoted, not re-litigated:

1. The unconditional mechanic has **no edge at 30 minutes**: eight arms,
   207–236 holdout trades each, gross expectancy near zero on every one. A
   well-powered null. Not disputed here.
2. **Direction is selected; the construction does not convert it.** Median
   non-circular forward lift was above 1.00 on all eight arms (1.035–1.234,
   fit period).
3. **Study B saw nothing** — 24 features, both timeframes, zero flags under a
   FWER-controlled null, including `tod_min`, `or_width_atr`, `or_width_datr`.

**The one piece of evidence on width**, and why it does not settle anything:
the closed pass's S1 (fit-only, non-gating, 15-minute range) improved US100 and
left US500 negative. But S1 **was not a 15-minute ORB**: the closed
`engine.py` kept the first trigger bar at 10:00 NY regardless of the width
(`find_trigger` read `C.TRIG_START`), so S1 measured "the range of the first 15
minutes, with a 15-minute dead zone after it". A real 15-minute ORB triggers
from 09:45. Nobody has run that on any arm. **Not repeating that bug is the
technical reason this fork exists** (§3.2, §10 step 2).

**The prior is low and is stated on the label.** Nothing in the closed pass
predicts that a 5- or 10-minute range produces +0.10R where a 30-minute range
produced +0.03R on the best instrument. Per the note §1.2, **the most likely
outcome of this family is six kills**, and this is the second and last shot on
the width/timing axis. A third pass would need a different mechanic (an exit
construction), not a different minute count.

**Two standards, as always in this project.**

- **Test A — the gate.** The six pre-registered arms, one holdout read,
  a mechanical ladder (§9). This is the only thing that can produce a verdict.
- **Descriptive rows.** Exit causes, per-side splits, forward lift, cost
  distributions, the three fit-only sensitivities, template 2. **None of them
  can create, upgrade or downgrade a verdict.** They are printed so a reader
  can see the shape of what was killed.

**There is no Study B in this family** (note §5.5). The feature study found
nothing at 30 minutes; re-running it per cell would multiply comparisons for no
stated hypothesis. The feature columns are still *built* (the fork makes them
nearly free, `MECHANIC-PROOF.md` prints them, and `ATR14` is what Null A sizes
its placebo stops with), but **no model is trained and no flag is reported.**

---

## 1. The six pre-registered arms

Indices only. **Crypto is out of this family** (note §3.1): its own
pre-registered pre-ETF control falsified the imported-anchor story, the
standing nulls on clock structure in crypto (Записи 2, 18) are not contested by
a shorter range, and the closed pass's S1 moved every crypto arm the wrong way.
No BTCUSDT/ETHUSDT tape is read by this package.

| # | arm | instrument | OR window (NY) | trigger bars open in | trigger bar | stop | template |
|---|---|---|---|---|---|---|---|
| 1 | `US100-OR5` | US100 | [09:30, 09:35) | [09:35, 12:00) | 5m | opposite side of OR | +1R gates; pure-ORB secondary |
| 2 | `US100-OR10` | US100 | [09:30, 09:40) | [09:40, 12:00) | 5m | same | same |
| 3 | `US100-OR15` | US100 | [09:30, 09:45) | [09:45, 12:00) | 5m | same | same |
| 4 | `US500-OR5` | US500 | [09:30, 09:35) | [09:35, 12:00) | 5m | same | same |
| 5 | `US500-OR10` | US500 | [09:30, 09:40) | [09:40, 12:00) | 5m | same | same |
| 6 | `US500-OR15` | US500 | [09:30, 09:45) | [09:45, 12:00) | 5m | same | same |

`US500` is kept deliberately (note §2): it holds the weaker closed-pass
numbers, and dropping the weaker instrument after seeing them is exactly the
selection this design exists to prevent. The hypothesis is about the cash-open
auction and both indices have one.

### 1.1 The 30-minute cells are quoted, never re-run

The closed pass's `US100-5m` and `US500-5m` arms are **the fourth point of each
instrument's width series** (5 → 10 → 15 → 30). They are read from
`research/orb-ny-open/results/holdout_verdicts.csv`, printed alongside, and
**neither re-run nor re-judged**. Their verdicts stand as the closed pass
recorded them:

| quoted cell | n_hold | holdout mean net R | fit mean net R | Null-A p | verdict |
|---|---|---|---|---|---|
| `US100-5m` (OR30) | 222 | +0.0332R | +0.0572R | 0.168 | NO EDGE — KILL |
| `US500-5m` (OR30) | 236 | −0.0179R | −0.0438R | 0.436 | NO EDGE — KILL |

### 1.2 Why exactly these widths, and why only the 5m trigger bar

- **5 minutes** — the canonical short ORB, the first 5-minute candle, and the
  width used by the best-known published ORB result. It is also one 5m bar,
  i.e. the noisiest possible estimate of the auction's range; the objection
  stands and the test prices it.
- **15 minutes** — the width the backlog named, the width the closed pass's S1
  pointed at on US100, and, as a *true* ORB triggering from 09:45, the one
  nobody has run.
- **10 minutes** is not here because it might win. It is here so the width axis
  has **four points (5, 10, 15, 30)** and a **shape** can be read. §9.2
  pre-commits that reading.
- **Not 20 or 25** (no distinct reason from 15 and 30). **Not 60** (the closed
  pass's S2 ran it fit-only, near zero everywhere, and it is the opposite of
  the question). **Not 1–3 minutes** (a 5m trigger bar cannot confirm a range
  narrower than itself).
- **5m trigger bars only, on every arm.** A confirmation bar coarser than the
  range it confirms is the noisiest object in the design; a 15m bar cannot open
  on the grid until 09:45 and would then confirm a range it dwarfs. A
  15m-bar variant of the 15-minute range is **not registered** — it would be
  one bar's high/low confirmed by the next bar of the same size.

---

## 2. Data

### 2.1 Sources — the cached, audited 1-minute tapes; no re-pull

`research/cmc-bot-vwap/data/US100_1m.parquet` and `US500_1m.parquet`
(Capital.com mids, `(ask+bid)/2` per `mapMarketDataToChartData`, with
`spread_close = ask − bid` at each minute's close). They are gitignored and
therefore absent from a fresh worktree; they were **copied** from the main
checkout, never re-pulled (note §8) — a re-pull takes 45+ minutes and would
produce a tape that no longer matches the audited one.

No native 5m pull exists and none is used: the 5m bars are resampled from the
1m tape by `common.py:resample`, and the exit path is walked on the 1m tape.

### 2.2 The tape-integrity check, run before anything was computed

`prep_data.py US100 US500` was re-run from the raw NDJSON in the worktree and
its output compared with the committed `research/cmc-bot-vwap/results/COVERAGE.md`:

- regenerated `US100_1m.parquet` MD5 `d31941693e2943bd101cc46b894d5885` —
  **identical** to the copied file and to the main checkout's;
- regenerated `US500_1m.parquet` MD5 `2b548cc6f0762ee3b3475f17b62b1361` —
  **identical**;
- the `US100` and `US500` summary rows and per-instrument coverage blocks of
  `COVERAGE.md` reproduce **byte-identically**;
- `results/coverage_days_US100.csv` and `coverage_days_US500.csv` reproduce
  with no diff.

Quoting the audited rows, unchanged from the closed pass:

| symbol | bars | first bar (UTC) | last bar (UTC) | dup ts | non-monotone | zero-volume bars |
|---|---|---|---|---|---|---|
| US100 | 971,812 | 2024-01-01 23:01 | 2026-09-11 20:59 | 0 | 0 | 0 |
| US500 | 954,943 | 2024-01-01 23:01 | 2026-09-11 20:59 | 0 | 0 | 0 |

A failure to reproduce would have been a §11 stop. It did not occur.
`research/cmc-bot-vwap/results/COVERAGE.md` was restored to its committed
content afterwards (the re-run drops the `EURCHF`/`GBPCHF` blocks, which were
not re-audited and are not read by this package).

### 2.3 Resampling and the clock grid

5-minute bins on the **UTC epoch grid**, labelled by OPEN time, `open` = first
1m open, `high` = max, `low` = min, `close` = last 1m close, `volume` = sum,
`spread_close` = the bin's last 1m bar's spread. **A bin with no 1m bar is
ABSENT** — not forward-filled, not zero-filled.

Because 09:30 NY is an exact multiple of 5 minutes past the epoch under either
DST offset, the NY-anchored and UTC-aligned 5-minute grids are the same object.
This now has to hold for the **three new clock points 09:35 / 09:40 / 09:45**
as well, and `checks.py grid` asserts it on every session day in span (§11).

Note that 09:35 and 09:45 do **not** lie on the 15-minute grid. That is not a
defect; it is precisely why every arm in this family triggers on 5m bars
(§1.2).

### 2.4 Eligible days — the NYSE calendar, verbatim

Full NYSE trading days only. Weekends, published full-day closures and 1:00 pm
ET **early closes** are excluded — an early close has no 16:00 NY forced flat,
so the mechanic is not defined on it. The holiday and early-close lists are
carried over from the closed pass's `common.py` byte-for-byte.

### 2.5 Opening-range completeness — scales with the width

Every 5-minute bin inside the opening range must carry at least one 1m bar:
**1 bin for OR5, 2 for OR10, 3 for OR15**. A day failing this is *ineligible*
and is counted in `results/exclusions.csv` as `incomplete opening range`. The
"no 1m bar after the range and before 16:00 NY" exclusion stays
(`no session after the range`).

### 2.6 Split — one calendar for all six arms, by NY session date

| period | window | how it is used |
|---|---|---|
| fit | 2024-01-01 .. 2025-07-31 | every table, every sensitivity, the §8.2 screen |
| **holdout** | **2025-08-01 .. 2026-07-31** | **cut ONCE, screened-in arms only** |
| tail | 2026-08-01 .. 2026-09-11 | descriptive only, no verdict |

Never re-cut. Identical to the closed pass's calendar — see §4.2 for what that
costs.

---

## 3. The signal

### 3.1 Opening range — 5, 10 or 15 minutes, from the 1m tape

`OR_high` = max high, `OR_low` = min low over the 1m bars whose **open time**
lies in `[09:30, 09:30 + width)` NY. The range is a property of the day and the
width, identical for both templates.

### 3.2 Trigger — first close beyond, starting at the range's END

The first 5m bar **opening in `[range end, 12:00)` NY** whose **close** is
strictly beyond the range triggers: close `>` `OR_high` → long; close `<`
`OR_low` → short. **A touch is not a trigger.** One trade per day, no
re-entry (except the S4' sensitivity). Entry is the trigger bar's close.

The range end is `09:35` / `09:40` / `09:45` NY for OR5 / OR10 / OR15
respectively, and it is **derived from the arm's own width** — `common.py:
trig_start(or_minutes)` — never a constant. This is the closed pass's bug,
fixed; `engine.find_trigger`, `engine.build_arm` and `engine.eligibility` take
`trig_start` as an argument and no longer read a module-level `TRIG_START`.

The 12:00 NY cutoff is **unchanged and is not an axis** (note §6.1): with a
5–15 minute range the trigger is expected to land within minutes on nearly
every eligible day, which makes the cutoff close to inert. It is shown once as
the fit-only sensitivity S5 (11:00 NY).

### 3.3 Stop — the opposite side of the range

Long: stop at `OR_low`. Short: stop at `OR_high`. `1R = |entry − stop|`.
A day with `stop_dist = 0` produces no trade. This is the same construction as
the closed pass; **in price it is several times tighter**, which is the point
of §5.

### 3.4 Exit — two templates, one gates

- **Template 1 (the gate).** Target at `entry + side × 1R`; stop as above;
  forced flat at the 16:00 NY minute's close if neither is reached.
- **Template 2 (secondary, NO VERDICT).** No target; stop and the 16:00 NY
  flat only — the literal "the breakout's direction persists" hypothesis.

**The straddle rule of the closed pass is RETIRED for this family** (note §5.5
and §3.2): it has been spent on the deferred ETH template-2 registration. A
template-2 number that clears any bar while template 1 is killed is **reported
and given no verdict, and generates no follow-up**.

### 3.5 Fill convention — one, realistic, on the 1-minute path

Verbatim from the closed pass, `engine.walk1m`:

- the exit path is walked on **1-minute** bars from the minute after the entry
  minute to the last minute ending ≤ 16:00 NY;
- on a minute touching **both** levels the **stop is taken first**;
- a target fills **at its level**;
- a stop the minute **gapped through** fills at that minute's **open**;
- no exit by the last minute → forced flat at that minute's close.

**Stop rule (§11):** on a trade that neither gapped its stop nor touched both
levels inside a single arm bar, the 1m-path fill and the arm-bar-OHLC fill must
agree **exactly**. On the excluded trades the 1m path must never be *kinder*
than the bar fill. `checks.py fills` asserts both.

### 3.6 Fit-period-only sensitivities — non-gating, descriptive, reported once each

| # | sensitivity |
|---|---|
| S3' | stop at the OR midpoint instead of the far side |
| S4' | re-entry once after a stop, max 2 trades/day |
| S5 | trigger window ends 11:00 NY instead of 12:00 |

**Every one of these is reported, including the ones that come out worse.**
None can change a verdict. The closed pass's S1/S2 (OR width) are **gone** —
width is the axis of this family, not a sensitivity. There is **no sensitivity
on the trigger start**: it is the range end by definition.

---

## 4. Descriptive rows, and the re-used holdout

### 4.1 Per-arm breakdowns, always reported

Per arm and period: `n`, mean/median net R, mean gross R, mean/median/p90
`cost_R`, win rate, `n_days`, % long, median `stop_atr`, median `stop_dist`,
median hold time; exit-cause counts for both templates; the long/short split;
the **non-circular forward lift** (the median ratio of the trade's MFE, in
ATR14, to the median MFE of a horizon-matched, side-matched comparison drawn
from the arm's own trigger window — 1.00 means "no better than a random
comparable bar").

### 4.2 The holdout is re-used, and this is declared

The 2025-08-01 .. 2026-07-31 year **has already been read once**, by the closed
`orb-ny-open` pass, on these two instruments and on the same days. Every trade
in this family sits on a day that already produced a 30-minute trade on the
same instrument, usually in the same direction.

`REPORT.md`'s **first paragraph** must therefore contain, in these or
equivalent words:

> This family re-uses the 2025-08-01 .. 2026-07-31 holdout, which was read once
> already by the closed `orb-ny-open` pass on the same instruments and days. It
> is the second pre-registered look at that year. The α below is corrected for
> both looks. A REAL EDGE reached here is weaker evidence than a first-read
> REAL EDGE and any build ruling will say so.

Three structural consequences, all binding: the **cumulative** α of §9.1, the
**fit-period screen** of §8.2 that decides which arms may touch the holdout at
all, and the **dose-response reading** of §9.2.

---

## 5. Costs

**Capital.com, per trade:** half the **entry** minute's `spread_close` plus
half the **exit** minute's `spread_close`, in price, divided by `stop_dist`.
No commission is modelled (the venue's index CFDs are spread-only) and no
financing (every trade is flat by 16:00 NY).

**Slippage is not modelled, so every number in the deliverable is optimistic.**
This must be stated in `REPORT.md`.

**A sentence `REPORT.md` must carry (note §4.5).** With the stop at the far
side of a 5-, 10- or 15-minute range, `stop_dist` is several times smaller than
in the closed pass, so **`cost_R` will be several times larger** than the
0.012–0.030R seen there. *The narrower the range, the more of any gross edge
the spread eats; this family is the one where costs can start to matter.* The
report prints the `cost_R` distribution per arm and the gross-vs-net gap.

**Cost sensitivities (non-gating, holdout, reported not gating):** 2× the
per-bar spread; a fixed spread at the fit-period median over 09:35–16:00 NY.

---

## 6. Nulls and the interval

Verbatim from the closed pass, with **the trigger window substituted per arm**
— this matters: an OR5 arm's placebo must be drawn from 09:35–12:00, not from
10:00–12:00, or the null would be an easier comparison than the strategy.

- **Null A — matched-time placebo (the gating null).** 1,000 draws. Each draw
  replaces every real trade with a random 5m bar drawn from **that arm's own**
  pool: every bar opening in `[range end, 12:00)` NY on a day **eligible for
  that arm**, with a finite positive ATR14 and a live session after it. The
  placebo keeps the real trade's **side** and its **stop size in ATR14 units**,
  and is walked, costed and exited by exactly the same code. A draw landing on
  the trade's own date is redrawn once; the residual same-date rate is
  reported. `p_A` = share of draws whose mean net R is ≥ the realised mean.
- **Null B — whole-stream day shift.** 250 draws. Every trade moves *k*
  eligible days forward keeping its clock slot; entries with no bar at the
  shifted slot drop, and the drop rate is reported. Reported, **not gating**.
- **Interval.** 90 % **day-block** bootstrap of the mean net R, 2,000 draws,
  resampling whole session days (trades on one day are not independent).

`SEED = 20260916`, fixed before any run.

---

## 7. The per-trade feature vector — built, not modelled

The same 24 columns as the closed pass (`features.py:SPEC`), computed at the
entry bar's close from bars whose close is ≤ the entry bar's close, with
directional columns side-signed.

They exist here for three reasons and no others: `ATR14` sizes Null A's
placebo stops; `MECHANIC-PROOF.md` prints the vector per hand-checked trade;
and the fork makes them nearly free. **No model is trained. No importance is
computed. No feature is flagged. No feature can touch a verdict.** (Note §5.5:
"No Study B.")

Two columns are arm-dependent and are parametrised accordingly: `or_rvol` and
`bar_rvol` are defined over the prior 20 sessions **eligible for that arm** and
over that arm's own clock slots, so `features.SessionStats` is keyed on
`(symbol, timeframe, or_minutes)`.

The closed pass's look-ahead check existed to protect Study B's feature matrix.
With no Study B and no feature reaching a verdict, it is **dropped** (note §7).

---

## 8. Before the holdout: the trigger share, then the screen

### 8.1 Fit-period trigger share — a DATA NOTE, not a decision

The closed pass's power contingency (widen the trigger window to 13:30 NY when
the projected `n_holdout` falls below 150) is **retired for this family** (note
§4.4). With a 5–15 minute range the trigger is expected to land within minutes
on nearly every eligible day, so the cutoff is inert and there is nothing for a
contingency to choose between.

`projection.py` still records, per arm, on the fit period and **before the
holdout is touched**: eligible days and exclusion reasons, the trigger share,
the projected `n_holdout` from that share and the holdout **calendar** alone,
and the distribution of the lag from the range's end to the trigger. It
contains **no R, no win rate and no expectancy**, and reads no holdout outcome.

If a screened-in arm nevertheless realises `n_holdout < 150`, that is a **§11
stop**, not a widened window.

> **PLACEHOLDER at the pre-registration commit.** This table is filled in by
> `projection.py`'s output in a later commit, before the screen is run. It
> contains no R.

| arm | trigger opens | fit eligible days | fit triggered | trigger share | projected n_holdout | median lag from range end |
|---|---|---|---|---|---|---|
| `US100-OR5` | 09:35 | — | — | — | — | — |
| `US100-OR10` | 09:40 | — | — | — | — | — |
| `US100-OR15` | 09:45 | — | — | — | — | — |
| `US500-OR5` | 09:35 | — | — | — | — | — |
| `US500-OR10` | 09:40 | — | — | — | — | — |
| `US500-OR15` | 09:45 | — | — | — | — | — |

### 8.2 THE FIT-PERIOD SCREEN — §5.3 of the note

**No arm touches the holdout unless, on the FIT PERIOD ALONE, both hold:**

1. **mean net R (template 1) ≥ +0.05R**, and
2. **fit-period Null A p ≤ 0.05** (1,000 draws, drawn from the arm's own
   trigger window on the fit period).

An arm that fails is verdicted **"NO EDGE — KILL (fit screen)"**, **its holdout
is never computed**, and it appears in `REPORT.md`'s grid with "(fit screen)"
and a **blank holdout column — the blank is the point**.

Nothing about the screen is tuned: +0.05R **is** the kill bar of §9.1, and 0.05
is the uncorrected conventional level for a screen that only ever **removes**
arms. The screen is not a verdict on the mechanic's merits; it is the price of
re-using a read holdout. It is strictly tighter than the closed pass's ladder,
which already required `m_fit ≥ +0.05R` for a build.

`analysis.py holdout` refuses to run unless `results/fit_screen.csv` exists,
and computes nothing for a screened-out arm.

#### 8.2.1 Screen decision — DECIDED 2026-09-16 on the fit period, before any holdout number existed

> **PLACEHOLDER at the pre-registration commit.** This subsection is written
> from `analysis.py screen`'s output and **committed before `analysis.py
> holdout` is run for the first time**. At the pre-registration commit no
> fit-period screen number and no holdout number exists for any arm of this
> family. The commit hash of the filled-in screen decision is recorded in §12
> and in `HANDOFF.md`.

| arm | n_fit | fit mean net R | fit gross R | fit mean cost_R | fit Null-A p | >= +0.05R? | p <= 0.05? | **screen** |
|---|---|---|---|---|---|---|---|---|
| `US100-OR5` | — | — | — | — | — | — | — | — |
| `US100-OR10` | — | — | — | — | — | — | — | — |
| `US100-OR15` | — | — | — | — | — | — | — | — |
| `US500-OR5` | — | — | — | — | — | — | — | — |
| `US500-OR10` | — | — | — | — | — | — | — | — |
| `US500-OR15` | — | — | — | — | — | — | — | — |

---

## 9. Test A — the verdict ladder

### 9.1 The ladder, applied mechanically to template 1's **holdout** mean net R, per screened-in arm

**Bonferroni is CUMULATIVE over every pre-registered look at this holdout**
(note §5.2): the 8 arms of the closed pass **plus** the 6 arms here = **14**.

> **α = 0.05 / 14 = 0.0035714…**

A holdout asked a second batch of questions is **one growing family**, not a
fresh one. The two timeframes and the four widths of one instrument are
correlated and Bonferroni is conservative for that; it is kept anyway. If the
arm count turns out to be wrong, **tighten, never loosen**.

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** Return to the Architect (§11). |
| holdout mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.0035714 < p ≤ 0.20` | **INCONCLUSIVE.** No build. No follow-up on the width/timing axis. |
| **all** of: mean net R `≥ +0.10R`; `p ≤ 0.0035714`; fit same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; 90 % day-block bootstrap excludes 0; gross `> 0` | **REAL EDGE — routes to the Architect for a build ruling**, subject to §9.2. |

Kill bar +0.05R and build bar +0.10R are unchanged from the closed pass.

An arm removed by the §8.2 screen carries **"NO EDGE — KILL (fit screen)"** and
no holdout number at all.

### 9.2 The dose-response reading — pre-committed, and it can veto a pass

For each instrument, `REPORT.md` prints the width series **5 → 10 → 15 → 30**
(the 30 quoted from the closed pass, §1.1), fit and holdout, in one table.

> **A REAL EDGE on a cell whose adjacent widths on the same instrument are ALL
> kills — for `OR5`, its one adjacent width `OR10`; for `OR15`, both `OR10` and
> the quoted `OR30` — is labelled "isolated cell — suspect" in the verdict
> table itself, is NOT routed as a build candidate, and returns to the
> Architect as a noise finding.**

The hypothesis "shorter is better" predicts a monotone or at least unimodal
shape along the width axis. A spike between two kills does not fit it and is
treated as the multiple-comparisons artefact it most likely is. A screened-out
neighbour counts as a kill. This rule is what makes registering a three-width
grid honest: **the grid is there to read a shape, not to hand out three lottery
tickets.** Implemented in `analysis.py:dose_response_label`.

### 9.3 Reporting rules that may not be bent (note §5.5)

- **The full 6-cell grid, plus the two quoted 30-minute cells, is the FIRST
  TABLE of `REPORT.md`'s results section** — every cell with its verdict, fit
  and holdout mean net R, `n`, `p_A`, bootstrap interval and screen status.
- **No "best cell" sentence exists anywhere in the deliverable.** No cell may
  be reported without its neighbours.
- Screened-out arms appear in the same table with "(fit screen)" and a **blank
  holdout column**.
- The holdout re-use is declared in the **first paragraph** (§4.2).
- Template 2 is reported for every arm, **with no verdict**; the straddle rule
  is retired (§3.4).
- Every sensitivity is shown, including the ones that came out worse.
- Slippage is not modelled and the report says so.

---

## 10. Order of work

1. Fork `research/orb-ny-open/` → `research/orb-ny-open-short/`; copy the
   cached 1m tapes; re-run the coverage audit and confirm it reproduces
   byte-identically (§2.2). **No R.**
2. Parametrise `common.py` / `engine.py` / `features.py` / `checks.py` /
   `mechanic_proof.py`: the opening-range end and the trigger start become the
   arm's own `or_minutes`, never a module constant. Rewrite `build.py`'s arm
   loop, repurpose `projection.py`, drop `studyb.py`. **No R.**
3. **This `DESIGN.md`, committed before any R is computed on any of the six
   arms.**
4. `build.py`, then `checks.py all` (grid including 09:35/09:40/09:45; fills;
   session), then `mechanic_proof.py` — ten hand-checked fit-period trades per
   width, 30 in total. Then `analysis.py fit`, `projection.py`.
5. `analysis.py screen` — the §8.2 decision, **committed before the holdout is
   touched**, with its commit hash recorded.
6. `analysis.py holdout` — **ONCE**, screened-in arms only, ladder at
   α = 0.05/14, §9.2 label applied.
7. `REPORT.md` (first paragraph: the §4.2 declaration; first results table: the
   full grid), `HANDOFF.md`, `RESEARCH-LOG.md` entry — **regardless of
   outcome. A kill is a result.**
8. `deferred_eth_t2.py` committed (note §3.2): the frozen script for the
   deferred ETH template-2 registration, which refuses to run before the tape
   reaches 2027-07-31 and is not run by this pass.

---

## 11. Stop rules — return to the Architect, do not decide unilaterally

Any of the following stops the pass:

1. the coverage audit does not reproduce byte-identically;
2. the grid check fails on any session day for any of
   09:30 / 09:35 / 09:40 / 09:45 / 11:00 / 12:00 / 16:00 NY;
3. the 1m-path and bar-OHLC fills disagree on a trade that neither gaps nor
   touches both levels within a bar (**a hard stop, unchanged**), or the 1m
   path is *kinder* than the bar fill on an excluded trade **whose order the 1m
   tape itself cannot resolve — i.e. a single 1-minute bar touches both levels**
   (narrowed by the §12 amendment of 2026-09-16);
4. any trade's exit crosses 16:00 NY;
5. **`n_holdout < 150` on a screened-in arm** (the widened-cutoff contingency
   is retired; there is no local fix);
6. the pre-registration is ambiguous in a way that changes a number.

Nothing about fills, costs, the calendar, the nulls, the bootstrap or the
ladder's numbers other than α may be rewritten. A reason that one of them must
change is a stop, not a local fix.

---

## 12. Amendment log

*(Append-only. An amendment made after any R exists on an arm must say so and
must say which numbers it could have seen.)*

- **2026-09-16, initial.** Written from
  `research/orb-ny-open/ARCHITECT-NOTE-FOLLOWUP.md` (`86ddf55`) before any R
  existed on any of the six arms. §8.1's table and §8.2.1's screen table were
  **empty placeholders at that commit** and were filled in by the two later
  commits named below, in that order, each before the next step ran.
- *(§8.1 and §8.2.1 are filled in by the two later commits named above, each
  before the next step ran. Their hashes are appended here as they are made.)*
- **2026-09-16, §11 rule 3 narrowed — AMENDMENT MADE AT THE FILL-CHECK STAGE,
  BEFORE ANY FIT OR HOLDOUT R EXISTED.** Architect ruling, requested by the
  Researcher under §11 rule 6 rather than decided locally.

  **What the amendment could have seen.** Only the outputs of `checks.py fills`
  — agreement counts, `max_absdiff`, the excluded-trade flags, and the one 1m
  path printed below. **No fit-period and no holdout-period expectancy, mean R,
  p-value or verdict existed for any arm of this family at the time it was
  made.** `analysis.py fit`, `analysis.py screen` and `analysis.py holdout` had
  not been run.

  **The ambiguity.** `ARCHITECT-NOTE-FOLLOWUP.md` §10 stop rule 7 names only
  the *disagreement* condition. This document's §11 rule 3 additionally carried
  over an assertion that lives in the closed pass's `checks.py` as a
  deliberately over-strict extra ("STRONGER than §3.5 asks"): that on an
  *excluded* trade the 1m-path fill must never be kinder than the bar-OHLC
  fill. The pre-registered condition passed perfectly — **0 violations on all
  six arms, `max_absdiff` = 0.0 across all 3,977 agreeing trades** — while the
  carried-over extra assertion fired on exactly one trade in 4,002.

  **The narrowing, as ruled.** The clause now reads: the 1m path is kinder than
  the bar fill on an excluded trade **where the 1m tape itself touches both
  levels within one 1m bar** (i.e. where the order is genuinely unresolvable).
  A bar-level both-touch that the 1-minute tape resolves cleanly is **not** a
  violation: the bar-OHLC convention takes the stop first on any bar spanning
  both levels, and resolving that order is precisely what the 1m path exists
  for. The finer path coming out kinder there is the coarse convention's
  pessimism, not a flattered result. This case is near-absent at a 30-minute
  range and appears here only because 1R is several times tighter — by
  construction, not by accident.

  **Nothing else is relaxed.** The disagreement condition of rule 3 remains a
  hard stop, and no other stop rule, fill convention, cost, null, bootstrap or
  ladder number is touched.

  **The one case, and its period — stated explicitly, not implied.** Trips of
  the *old, unnarrowed* clause, by period, over all 4,002 trades of the six
  arms:

  | period | trades | trips of the old clause |
  |---|---|---|
  | fit (2024-01-01 .. 2025-07-31) | 2,342 | **0** |
  | holdout (2025-08-01 .. 2026-07-31) | 1,487 | **0** |
  | tail (2026-08-01 .. 2026-09-11, descriptive only) | 173 | **1** |

  **Zero fit-period and zero holdout-period trades trip the old clause.** The
  single case is `US500-OR5`, 2026-08-28, in the **tail** — a descriptive
  period that carries no verdict and feeds no screen and no ladder. Its
  minute-by-minute path is printed in `REPORT.md`. Under the narrowed clause it
  is not a violation (its 1-minute both-touch flag is 0 — the 1m tape resolves
  the order unambiguously), and `checks.py fills` now passes on all six arms.
