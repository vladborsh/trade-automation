# DESIGN — `orb-utc0-crypto`: an opening range at the crypto-native 00:00 UTC reset

**Status:** pre-registration, **committed before any R exists on either arm.**
**Date:** 2026-09-16 · **Package:** `research/orb-utc0-crypto/`

This document is the mechanical restatement of the binding pre-registration
`research/orb-ny-open/ARCHITECT-NOTE-CRYPTO-INVESTIGATION.md` (commit
`eaacce2`, 2026-09-16). That note is the canonical spec; where this document
and the note disagree, **the note wins and this document is the bug**. Where
the note says "verbatim from the closed pass", the referent is
`research/orb-ny-open/DESIGN.md` (commit `7ff19fc`) and its follow-up
`ARCHITECT-NOTE-FOLLOWUP.md` (`86ddf55`).

Nothing in this document was chosen after seeing a number computed on either
arm at the 00:00 UTC anchor. No such number exists at the time of this
commit. The only numbers that exist are the data-audit counts of §5.2, which
contain no price outcome of any kind.

---

## 0. What this family is, in one paragraph

The closed `orb-ny-open` pass tested an opening range anchored at the **New
York cash open**, on indices and on BTC/ETH, and killed all eight arms; its
crypto arms were an *imported-flow* hypothesis (US ETF flow imprinting the
NY open on bitcoin) and their own pre-ETF control falsified the transmission
story. This family changes **exactly one thing**: the clock. The range is
formed at **00:00–00:30 UTC** — the point at which the daily candle boundary
on every venue, the 8-hour perpetual funding settlement, and the Tokyo cash
open coincide, every day of the week, with no DST anywhere. Every other
element of the mechanic — width, timeframe, trigger rule, stop, target,
fills, costs, nulls, bootstrap, ladder — is carried over unchanged, so that
the answer this pass produces is an answer about the **anchor** and nothing
else.

**The honest prior is low** (note §3.2, §6): three standing nulls in this
project on "the clock structures the crypto tape tradably", and the
best-documented activity concentration of the crypto day (the US open) gave
zero with 208–228 trades per arm. Activity at a clock point is not a tradable
breakout. **This is the crypto ORB line's second and last shot**; a kill here
closes it on every anchor.

---

## 1. The registered hypothesis

> At 00:00 UTC the crypto market performs a reset of its own — every major
> venue's daily candle closes and reopens, perpetual funding settles on
> Binance / Bybit / OKX, and Tokyo cash opens — and the 30 minutes of trade
> that follow form a range whose first decisive break carries directional
> persistence, **on every day of the week**, because none of the three
> coincident events depends on a Western cash market being open.

The hypothesis is **crypto-native by claim**. §8.1 registers the control that
can falsify that claim even if the arithmetic passes: if the effect appears
only Monday–Friday, the operative event was the Tokyo cash open, i.e. an
imported anchor again, and the result is labelled as such rather than built.

---

## 2. The arms — exactly two

| # | arm | instrument | tape | OR window (UTC) | trigger bars open in (UTC) | trigger bar | stop | forced flat (UTC) | template |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `BTCUSDT-5m` | BTCUSDT USD-M perp, Binance | 1m | [00:00, 00:30) | [00:30, 02:30) | 5m | opposite side of the OR | 07:55:00 | +1R gates; pure-ORB secondary |
| 2 | `ETHUSDT-5m` | ETHUSDT USD-M perp, Binance | 1m | same | same | 5m | same | same | same |

**5-minute bars only.** The closed pass showed 5m ≈ 15m on every instrument
and the follow-up ruled 5m for the same reason; a second timeframe would
double the α cost for a known non-difference (note §4.1).

**No index arms.** The anchor has no meaning on a Capital.com index CFD,
whose tape has a 21:00–23:00 UTC gap and no crypto-venue events (note §3.3).

---

## 3. The mechanic

### 3.0 Clock and grid

`SESSION_TZ = "UTC"`. **There is no DST conversion anywhere in this package.**
The session date is the **UTC calendar date of the range**. 00:00, 00:30,
02:30 and 07:55 UTC lie on the 5-minute epoch grid on every day, trivially;
`checks.py:check_grid` keeps this as an assertion and additionally asserts
that the UTC offset of the anchor is 0 on every day in span — the assertion
that replaces the closed pass's DST check.

The 5-minute bars are bins on the **UTC epoch grid**, labelled by **open
time**: `open` = first 1m open, `high` = max, `low` = min, `close` = last 1m
close, `volume` = sum. **A bin with no 1m bar is ABSENT** — never
forward-filled, never zero-filled.

### 3.1 Eligible days — every calendar day, all seven

An eligible day is **any UTC calendar date** on which the opening range is
complete. There is:

- **no weekday filter** — Saturdays and Sundays are ordinary eligible days of
  this family, because the anchor exists on them by definition;
- **no exchange-holiday calendar on the eligibility path** — the anchor is
  the venue's own boundary and the venue never closes;
- **no DST adjustment** — UTC has none.

**Completeness rule (the only exclusion):** each of the six 5-minute bins of
[00:00, 00:30) UTC must hold **at least one** 1-minute bar. A day failing it
is excluded and **counted** in `results/exclusions.csv`. Binance maintenance
windows and missing bars are handled by this rule and by nothing else. A day
whose forced-flat minute does not exist after the range is likewise excluded
and counted (`no session after the range`).

The JPX (Tokyo) calendar appears in `common.py` for **one purpose only**: the
descriptive §8.2 row. It never removes a day from any arm.

### 3.2 The opening range and the trigger

- `OR_high` = max **high**, `OR_low` = min **low**, over the **1-minute** bars
  whose open time lies in **[00:00, 00:30) UTC**.
- **Trigger:** the **first** 5-minute bar whose **open time** lies in
  **[00:30, 02:30) UTC** and whose **close** is **strictly** beyond the range
  — `close > OR_high` → long, `close < OR_low` → short. A *touch* never
  triggers; the close does.
- Last eligible trigger bar opens **02:25 UTC**. No breakout by the cutoff →
  **no trade that day**, and the day is counted as eligible-but-untriggered.
- **There is no widened-window contingency.** The closed pass's
  `TRIG_END_WIDE` is removed from this package. If the projection of §7.2 is
  wrong and an arm's holdout is short, the **UNDERPOWERED** row of the ladder
  applies and the pass returns to the Architect (note §4.11).

### 3.3 Entry, stop, R

- **Entry** = the trigger bar's **close**.
- **Stop** = the **opposite side of the opening range** (`OR_low` for a long,
  `OR_high` for a short).
- `1R = |entry − stop|`. A day with `stop_dist = 0` is skipped and counted.
- **One trade per day, no re-entry.** The closed pass's re-entry sensitivity
  (S4) and midpoint-stop sensitivity (S3) are **not run** — the closed pass
  showed both inert on crypto (note §4.8d).

### 3.4 Forced flat — and the funding-timestamp guarantee

- **Forced flat at 07:55:00 UTC** = mark to market at the close of the 5m bar
  opening 07:50, i.e. on the 1-minute path, the close of the 07:54 minute.
- The rule is implemented as a **function of the anchor**, so the fit-only
  placebo rows of §8.3 obey it too: `flat = anchor + 7 h 55 m`, capped at
  **five minutes before the next Binance 8-hour funding settlement** (00:00 /
  08:00 / 16:00 UTC). At all four anchors used in this package the two
  clauses coincide (00:00 → 07:55; 04:00 → 07:55; 08:00 → 15:55; 16:00 →
  23:55).
- **Consequence, registered and to be restated in `REPORT.md`:** the position
  is opened at or after 00:30 UTC (that day's 00:00 settlement has already
  passed) and closed before 08:00 UTC. **No position is ever open at a
  funding timestamp.** Funding is therefore not merely unmodelled here — it
  is **structurally zero**. This is the first crypto registration in this
  project for which that is true. `checks.py:check_funding` asserts it on
  every trade of both templates; a single crossing is a §12 stop rule.
- **No trade crosses a UTC session boundary.** `checks.py:check_session`
  asserts it.

### 3.5 Exit templates

| # | template | rule | status |
|---|---|---|---|
| 1 (primary) | project standard | target **+1R**; stop as §3.3; forced flat 07:55 UTC | **gates every verdict** |
| 2 | pure ORB | **no target**; same stop; same forced flat | mandatory secondary, always reported, **no verdict word, no straddle rule** (that rule was spent on the ETH t2 deferral, follow-up §3.2) |

---

## 4. Fills

### 4.1 The one fill convention — the 1-minute path

Every exit is walked on the **1-minute tape**, from the minute **after** the
entry minute to the last minute ending ≤ the forced flat:

1. the **stop is checked FIRST** on a minute touching both levels;
2. a **target** fills **at its level**;
3. a stop the minute **gapped through** fills at that minute's **open**;
4. no exit by the last minute → **forced flat at that minute's close**.

**Slippage is not modelled anywhere.**

### 4.2 The agreement rule (a §12 stop rule)

On every trade that neither gapped its stop nor touched both levels inside a
single 5-minute bar, the 1m-path fill and the bar-OHLC fill must agree
**exactly**, on both the R and the exit cause. Stronger than the closed pass
asks, and carried over from it: on the **excluded** (gapping / both-touch)
trades the 1m path must never be **kinder** than the bar convention. A
violation of either stops the pass.

---

## 5. Costs

- **Primary, gating: 0.10 % round trip** (2 × 5 bp taker) on notional, as
  every Binance registration in this project:
  `cost_R = 0.0010 × entry / stop_dist`.
- **Sensitivities, non-gating, reported for fit and holdout:**
  **0.04 %** (maker) and **0.20 %** (2 × the primary). The 0.20 % row is new
  relative to the closed pass and exists because the 00:30–02:30 UTC book is
  thinner than the US-hours book (note §4.4).
- `REPORT.md` shows the `cost_R` distribution per arm and the gross-vs-net
  gap, and carries this sentence verbatim: *"slippage is not modelled; in
  this window the book is thinner than in US hours, so every number here is
  more optimistic than the closed pass's."*

---

## 6. Nulls, interval, forward lift — verbatim, windows substituted

### 6.1 Null A — matched-time placebo (primary, 1,000 draws)

Each real trade is replaced by one entered at a 5-minute bar drawn uniformly
from the **same [00:30, 02:30) UTC window on a different, randomly chosen
eligible day** — **any day of the week; the population is seven-day** — same
instrument, same side, same `stop_atr` (= `stop_dist / ATR14` on the arm's
bars at the entry bar), same template, same 07:55 UTC flat, same costs.
One-sided `p` = the share of draws whose mean net R is ≥ the observed mean.
A draw landing on the trade's own date is redrawn once; the residual
same-date rate is reported.

That a weekend trade's placebo may land on a weekday and vice versa is the
**registered** Null A, not an oversight: the eligible population of this
family is seven-day by construction (note §4.6).

### 6.2 Null B — whole-stream day shift (250 draws)

Every trade moves `k ~ U{1..250}` eligible days forward, keeping its clock
slot. Entries with no bar at the shifted slot drop; the drop rate is
reported. Secondary, never gating.

### 6.3 Interval and forward lift

- **Day-block bootstrap**, 2,000 draws, **90 %** interval, blocks = session
  days.
- **Non-circular forward lift** as `session-liquidity-v5-ny/tables.py:block_L`:
  the trade's MFE over its own horizon in ATR units, divided by the median
  MFE of a random comparable bar in the same horizon bucket and on the same
  side. Reported **per arm, fit and holdout, and per weekday/weekend half**
  (§8.1). The reference table is built once per instrument from the whole
  pool, so the two halves are compared against the **same** reference.

### 6.4 Seed

`SEED = 20260916`, one `numpy.random.default_rng` per command, fixed before
any run.

---

## 7. Data, split, screen

### 7.1 Tapes

Binance **USD-M perpetual** 1-minute klines for BTCUSDT and ETHUSDT, from the
public `data.binance.vision` monthly archives. The audited tape
`research/cmc-bot-vwap/data/<SYM>_1m.parquet` (2022-08-01 .. 2026-09-11) is
**copied from the main checkout and never re-pulled or modified** — other
packages depend on it.

### 7.2 History extension and its audit — done before this commit

`prep/extend_history.py` probed `data.binance.vision` month by month from
2019-06 and recorded the **actual** first available monthly 1m archive per
symbol, rather than assuming one. Result, written to
`results/history_audit.json` and reproduced here:

| symbol | first monthly archive that exists | first bar | last bar | extension rows | audited-segment rows | total rows | duplicates | gaps | missing minutes | 2022-08+ slice byte-identical to the audited file |
|---|---|---|---|---|---|---|---|---|---|---|
| BTCUSDT | **2020-01** | 2020-01-01 00:00 UTC | 2026-09-11 23:59 UTC | 1,357,920 | 2,164,320 | 3,522,240 | 0 | 0 | 0 | **yes** |
| ETHUSDT | **2020-01** | 2020-01-01 00:00 UTC | 2026-09-11 23:59 UTC | 1,357,920 | 2,164,320 | 3,522,240 | 0 | 0 | 0 | **yes** |

2019-06 .. 2019-12 return HTTP 404 for both symbols; **2020-01 is the floor
the archive actually publishes**, which is what the note expected but did not
assume. 3,522,240 = 2,446 days × 1,440 minutes exactly: the extended tape has
**no missing minute at all** over six years and eight months. The extension
is written to a **new** file `<SYM>_1m_2020.parquet`; the audited file is
untouched. The fallback of note §4.5 (fit from 2022-08 if the audit fails)
therefore **does not fire**, and this is recorded here before any R.

These counts contain no price outcome. Nothing about them could influence any
choice in this document.

### 7.3 Split — cut once, never re-cut

| period | span | use |
|---|---|---|
| **fit** | **2020-01-01 .. 2025-07-31** (67 months) | every table of §8; the screen; nothing is judged here |
| **holdout** | **2025-08-01 .. 2026-07-31** (the project standard) | read **once**, screened-in arms only |
| **tail** | 2026-08-01 .. 2026-09-11 | descriptive, no verdict |

Breaking the cross-package 2022-08 fit alignment is deliberate and is the
user's standing preference for the deepest available crypto history; the
**holdout — the only period any verdict is judged on — stays aligned** with
every other line in the project. A longer fit only makes the §7.4 screen
harder to pass by luck.

### 7.4 The fit-period screen — decided before any holdout number exists

Follow-up §5.3, verbatim. An arm **touches the holdout only if, on the fit
period alone**:

> template-1 **mean net R ≥ +0.05R** **and** fit-period Null A (1,000 draws
> from the arm's own window) gives **p ≤ 0.05**.

A screened-out arm is verdicted **NO EDGE — KILL (fit screen)**, **its
holdout is never computed**, and the decision is appended to this document
(§13) with its commit hash before `analysis.py holdout` may be run.
`analysis.py holdout` refuses to start unless `results/fit_screen.csv`
exists, and computes nothing for a screened-out arm.

### 7.5 Era sub-rows — descriptive, fit-side, no verdict

(i) before / from **2021-11-01** (the structural break the periodicity
literature identifies); (ii) before / from **2024-01-11** (US spot ETF
launch). **Pre-registered reading:** if an arm passes, `REPORT.md` says which
era carries it; **if the from-2024 era alone carries it, the NY-flow
explanation is back on the table and the pass is flagged to the Architect
before any build ruling.** If the arm is killed, the rows are reported and
**nothing is inferred**.

---

## 8. The built-in falsification controls

These can kill the **story** even when the arithmetic passes. They are
pre-registered here with their readings fixed **before any number exists**.

### 8.1 Weekday vs weekend split — the test of "crypto-native" (the crux)

For each arm, template 1, **fit and holdout**: mean net R, `n`, and forward
lift, for **Mon–Fri UTC** and **Sat–Sun UTC** separately. **The verdict is on
all seven days pooled**; this split never changes the pooled number.

**Pre-registered reading, fixed now.** If an arm reaches **REAL EDGE** on the
pooled holdout number **and** its **weekend half has holdout mean net R below
+0.05R** while the weekday half carries the result, then `REPORT.md` says, in
these words —

> **"the Tokyo open, not the reset — an imported anchor again"**

— the arm is labelled **"story falsified — suspect"** in the verdict table, it
is **not** routed as a build candidate, and it returns to the Architect. A
crypto-native boundary that only works when a foreign cash market is open is
the hypothesis this family exists to rule out.

If the weekend half is **at or above +0.05R**, or the two halves lie within
each other's 90 % intervals, the crypto-native reading **stands**.

If the arm is **killed**, the split is reported and **nothing is inferred
from it**.

This label can only **downgrade** a REAL EDGE. It never rescues a kill, and
it is applied mechanically by `analysis.py:weekend_label`.

### 8.2 Tokyo-holiday row — descriptive corroboration

UTC weekdays on which the **Tokyo Stock Exchange is closed** (JPX published
calendar, recorded verbatim in `common.py:JPX_HOLIDAYS`, 2020–2026), fit and
holdout **pooled**, beside the complementary "JPX trading weekday" row. Same
mechanic, same arm, no separate build. Projection ~20 days/year — small.
**Descriptive only**; §8.1 is the control that bites.

### 8.3 Fit-only alternative-anchor rows — the placebo anchors

The **identical** mechanic (30-minute range, 2-hour trigger window, flat by
the §3.4 rule) at three other UTC clock points, run through **the same code
path** as the registered arms:

| anchor | what is there | role |
|---|---|---|
| **08:00 UTC** | funding settlement + Deribit daily settlement and every options expiry + (in winter) the London cash open | the honest competitor |
| **16:00 UTC** | funding settlement only | weaker competitor |
| **04:00 UTC** | **nothing** — no funding on the 8-hour contracts, no venue event, the middle of the 02:00–06:00 volume trough | **the pure placebo** |

**Fit period only. They never touch the holdout. They carry no verdict and
gate nothing.**

**Pre-registered readings, fixed now.**
- If the **04:00** row on the fit period is **as good as or better than** the
  00:00 arm's fit number, `REPORT.md` says **"any clock, not the reset"**, and
  should an arm later pass on the holdout, the pass is **flagged to the
  Architect as suspect**.
- If **08:00** looks **better** than 00:00 on the fit period, that is recorded
  as a note for a possible future Architect registration and **nothing else**:
  it does not become an arm of this family, it does not touch the holdout,
  and it is not promoted if this family is killed.

### 8.4 Fit-only width sensitivities

**S1 = 15-minute range, S2 = 60-minute range**, fit period only, for
like-for-like comparison with the closed pass's crypto rows. The registered
30-minute row is reported on the same fit population beside them.
**Non-gating.** No S3 (midpoint stop) and no S4 (re-entry) — inert on crypto
in the closed pass.

---

## 9. The ladder — cumulative Bonferroni

### 9.1 α

**The family for α is every pre-registered arm judged on the 2025-08-01 ..
2026-07-31 holdout:**

| pass | arms judged on this holdout |
|---|---|
| `orb-ny-open` (closed) | 8 |
| `orb-ny-open-short` | 6 |
| `orb-utc0-crypto` (this family) | **2** |
| **total** | **16** |

**α = 0.05 / 16 = 0.003125.** Kill bar **+0.05R**, build bar **+0.10R**,
unchanged. If the count turns out to be wrong, it is **tightened, never
loosened**.

### 9.2 Holdout re-use, declared

`REPORT.md`'s first paragraph carries the declaration in the follow-up's
words: this is the **third** pre-registered look at the 2025-08 .. 2026-07
year on the crypto tapes (Запись 22's crypto arms and Запись 23's crypto arms
read it already); α is corrected for all of them; **a REAL EDGE here is
weaker evidence than a first-read one.**

### 9.3 The ladder, applied mechanically to template 1's holdout mean net R

| condition | verdict |
|---|---|
| screened out by §7.4 | **NO EDGE — KILL (fit screen)**, holdout never computed |
| `n_holdout < 150` | **UNDERPOWERED — INCONCLUSIVE**, return to Architect (§12) |
| mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — KILL** |
| `≥ +0.05R` and `0.003125 < p ≤ 0.20` | **INCONCLUSIVE** — no build, no follow-up on this line |
| all of: `≥ +0.10R`; `p ≤ 0.003125`; fit same sign with `m_fit ≥ +0.05R`; `n ≥ 150`; 90 % bootstrap excludes 0; gross > 0; **and the §8.1 weekend reading does not fire** | **REAL EDGE — routes to the Architect for a build ruling** |

Template 2 is reported for both arms **with no verdict word beside it**.

---

## 10. Order of work — and what may be read when

1. Fork the closed package; copy the audited tapes from the main checkout.
   **No R.**
2. History extension pull and audit (§7.2); the first available month per
   symbol recorded. **No R.**
3. **This document, committed.** *(← the commit that carries this line)*
4. Build the trade tables; `checks.py all` (grid, funding, fills, session);
   `mechanic_proof.py` — ten fit-period trades per arm, five weekday and five
   weekend.
5. **Fit-period numbers only:** both arms, templates 1 and 2, the
   weekday/weekend halves, the era rows, the Tokyo-holiday row, S1/S2, the
   cost sensitivities, the three placebo-anchor rows, and the fit-period
   Null A per arm. **The §7.4 screen decision committed into this document.**
6. **Holdout, once**, screened-in arms only; the §9.3 ladder at α = 0.003125;
   the §8.1 label; the tail row.
7. `REPORT.md`, `HANDOFF.md`, and a `RESEARCH-LOG.md` entry — **regardless of
   outcome**. A kill is a result, and here it is the result that closes the
   crypto ORB line on every anchor.

---

## 11. Reporting rules that may not be bent

- **The first table of `REPORT.md`** is the two arms with verdict, fit and
  holdout mean net R, `n`, `p_A`, `p_B`, bootstrap interval, screen status,
  **and the weekday/weekend halves beside them**. No "best" sentence exists
  anywhere above that table.
- The §8.3 placebo-anchor rows are the **second** table, fit-only, **with a
  blank holdout column — the blank is the point**.
- Template 2 reported for both arms, **no verdict word**.
- Era rows, Tokyo-holiday row, S1/S2, cost sensitivities: each under its own
  heading, **no verdict words**.
- The closed pass's crypto rows (`BTCUSDT-5m`, `ETHUSDT-5m` at the NY anchor,
  and their weekend rows) are **quoted** from `research/orb-ny-open/results/`
  in a comparison table — **never recomputed, never re-judged** — so the
  reader sees the two anchors side by side.
- **Every sensitivity actually run is reported, including the ones that came
  out worse.**
- **No Study B, no feature columns, no model.**

---

## 12. Stop rules — return to the Architect, do not decide locally

Stop and escalate if:

1. the audited 2022-08+ segment does not reproduce byte-identically;
2. the extension's audit fails **and** a clean fallback to the 2022-08 fit is
   not possible;
3. **any position is found open at a funding timestamp**;
4. the 1m-path and bar-OHLC fills disagree on a trade that neither gaps nor
   touches both levels within a bar;
5. `n_holdout < 150` on a screened-in arm — there is **no power contingency**:
   the projection is ~300+ per arm, and if it is wrong the **UNDERPOWERED**
   row applies;
6. the pre-registration is ambiguous in a way that changes a number.

---

## 13. Machinery map

| file | role |
|---|---|
| `common.py` | every constant: the UTC clock, the seven-day calendar, the split, α = 0.05/16, the screen bars, the JPX calendar (descriptive only), the placebo anchors |
| `engine.py` | the mechanic. The **anchor is a parameter**, so the §8.3 placebo rows run through the same code as the arms; `walk1m`, fills and `cost_R` are carried over unchanged |
| `indicators.py` | Wilder ATR14 only — what Null A and the forward lift need. The closed pass's 24-feature vector is dropped |
| `checks.py` | §12 checks: grid, **funding**, fills, session |
| `build.py` | the two arms; the three placebo anchors (fit only); S1/S2 |
| `projection.py` | §7.2 data note — trigger shares and exclusions, no R |
| `analysis.py` | `fit` → every §8 table · `screen` → §7.4 · `holdout` → once, screened-in only, ladder + §8.1 label |
| `mechanic_proof.py` | `MECHANIC-PROOF.md`, ten fit trades per arm |
| `prep/extend_history.py` | §7.2 history extension and its audit |

### 13.1 The §7.4 screen decision — **BOTH ARMS SCREENED OUT**

Run on 2026-09-16 by `python analysis.py screen`, against the pre-registration
committed in `1f2a3c9`. Written here, and committed, **before
`analysis.py holdout` was run**. Source: `results/fit_screen.csv`.

| arm | `n_fit` | fit mean net R (t1) | fit gross R | fit mean `cost_R` | fit-period Null-A `p` | screen |
|---|---|---|---|---|---|---|
| `BTCUSDT-5m` | 1,885 | **−0.2330R** | −0.0319R | 0.2011R | 0.899 | **SCREENED OUT** |
| `ETHUSDT-5m` | 1,901 | **−0.1519R** | −0.0074R | 0.1444R | 0.670 | **SCREENED OUT** |

Both arms fail **both** limbs of the screen: mean net R is far below the
+0.05R bar (it is negative, not merely small), and the fit-period Null A puts
the observed mean **below** the placebo mean (`p` = 0.899 and 0.670 — the
matched-time placebo does *better* than the real breakout).

**Consequence, applied mechanically per §7.4 and §9.3:**

- both arms are verdicted **NO EDGE — KILL (fit screen)**;
- **the 2025-08-01 .. 2026-07-31 holdout is NEVER computed for either arm.**
  It was not read, and `analysis.py holdout` refuses to compute it. The
  cumulative α of §9.1 is therefore **not spent** by this family: the count of
  pre-registered arms judged on that holdout remains **14**, not 16, and the
  next registration that reaches the holdout inherits 14 + its own arms, not
  16. This is a tightening relative to the note's arithmetic and is recorded
  here so the next Architect uses the right number;
- the §8.1 weekend reading cannot fire (it applies only to a REAL EDGE), so
  the weekday/weekend split is **reported and nothing is inferred from it**,
  exactly as §8.1 pre-committed for the kill branch.

### 13.2 Architect ruling on the α ledger (2026-09-16) — the count is by REGISTRATION; the window is retired for ORB

The Researcher's arithmetic (§13.1, `HANDOFF.md` §2.1: "carry 14, not 16")
is **not adopted**, because it is internally inconsistent: 14 = 8 + 6 already
includes the **four** `orb-ny-open-short` arms that were screened out on the
fit period and never read the holdout either. A "count only holdout reads"
convention gives **8 + 2 + 1 = 11** (8 from `orb-ny-open`, 2 from
`orb-ny-open-short`, 1 from `orb-ny-open-exit`; this family 0); a "count every
registered arm" convention gives **8 + 6 + 6 + 2 = 22**. Fourteen is neither.

**Ruling.** The ledger for the 2025-08-01 .. 2026-07-31 window counts
**registered pre-registered arms, screened-out or not**: **22** across the
ORB line, of which **11** actually read the holdout. Reasons: (i) this is the
convention already in force — the exit-construction note §6.2 registered
`US500-E0` knowing its fit number would screen it out "because the count is
fixed by registration, not by survival"; (ii) every arm registered after the
first family was designed with knowledge of that holdout's earlier reads
(the forward-lift finding that motivated the exit family was a holdout
observation), so registration, not the read, is the moment a hypothesis is
formed on this window; (iii) "tighten, never loosen". Both numbers are to be
quoted by any future registration on this window.

**Practical effect: nil for ORB.** The exit family already retired this
window for ORB on the indices ("any further ORB registration on these two
instruments must use tape from 2026-08-01 onward") and this family's kill
closes crypto ORB on every anchor. A non-ORB family that wants this window
starts its own line count but **declares** the 22/11 prior use in its
DESIGN.md so the reader knows the year has been read eleven times.
