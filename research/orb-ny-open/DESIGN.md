# DESIGN — Opening-range breakout at the New York open (`orb-ny-open`)

**Status: PRE-REGISTRATION. Committed before any R was computed on any arm and
before any model was trained.** This file is the mechanical restatement of
`ARCHITECT-NOTE.md` (2026-09-16, commit `7ff19fc`), which is the binding
ruling. Where this file adds detail it adds *mechanical* detail only; it
loosens nothing. Where the two disagree, the Architect's note wins and this
file is the bug.

Style and rigour are forked from `research/cmc-bot-vwap/DESIGN.md` +
`stage1.py` and `research/session-liquidity-v5-ny/DESIGN.md` §4–§6.

No performance number of any kind existed when this file was committed. The
only numbers computed before this commit were **data-coverage counts** (§2),
which contain no R, no win rate and no expectancy.

---

## 0. The question, and the two evidentiary standards

**Test A — does ORB work at all?** Pre-registered, gates, Bonferroni-corrected
over **exactly eight arms**, judged by the ladder in §8. One shot per arm.

**Study B — which conditions correlate with an ORB trade working better?**
**Hypothesis-generating.** Fit-period training only, FWER-controlled flags, a
frozen-model holdout read. **Nothing Study B produces is an edge, a verdict,
or a parameter change to Test A.** Study B runs regardless of Test A's
outcome; a flag after a kill is a *proposal for a new registration*, never a
rescue of this one (§9).

Test A's verdicts are locked before Study B's holdout read is taken (§10).

---

## 1. The eight pre-registered arms, and everything descriptive

| # | arm | tape | bars | status |
|---|---|---|---|---|
| 1 | `US100-5m` | Capital.com CFD mid, 1m → 5m | 5m | **pre-registered** |
| 2 | `US100-15m` | same → 15m | 15m | **pre-registered** |
| 3 | `US500-5m` | Capital.com CFD mid, 1m → 5m | 5m | **pre-registered** |
| 4 | `US500-15m` | same → 15m | 15m | **pre-registered** |
| 5 | `BTCUSDT-5m` | Binance USD-M perp, 1m → 5m | 5m | **pre-registered** |
| 6 | `BTCUSDT-15m` | same → 15m | 15m | **pre-registered** |
| 7 | `ETHUSDT-5m` | Binance USD-M perp, 1m → 5m | 5m | **pre-registered** |
| 8 | `ETHUSDT-15m` | same → 15m | 15m | **pre-registered** |

No pooling across arms, no picking among them. Every other row in this package
is **descriptive and carries no verdict**, and its heading says so:

- **crypto weekend rows** (4): the identical mechanic on Saturdays and Sundays
  (§6.2);
- **crypto pre-ETF rows** (4): the identical mechanic on 2022-08-01 ..
  2023-12-31 weekdays (§6.2);
- **tail rows** (8): 2026-08-01 .. 2026-09-11;
- **template 2** (pure ORB) on every arm (§4.2);
- every sensitivity in §3.6, §4.3 and §5.

### 1.1 The crypto framing, stated on the label

The BTC/ETH arms test an **imported** anchor, not an auction the crypto market
holds itself:

> *The US equity cash open, transmitted through ETF flow and index
> correlation, imprints a tradable opening range on BTC/ETH on NYSE trading
> days.*

This is a **weaker and different** hypothesis than the indices'. Standing
nulls it contests (`RESEARCH-LOG.md` Записи 2 and 18) are not reopened by a
pass and are not re-confirmed by a kill. No result on a crypto arm is evidence
about an index arm or vice versa.

---

## 2. Data

### 2.1 Sources — the cached, audited 1-minute tapes; no native 5m/15m pull

| instrument | file (read-only, outside the git tree) | span | volume field |
|---|---|---|---|
| US100 | `research/cmc-bot-vwap/data/US100_1m.parquet` | 2024-01-01 23:01 .. 2026-09-11 20:59 UTC | `lastTradedVolume` |
| US500 | `research/cmc-bot-vwap/data/US500_1m.parquet` | 2024-01-01 23:01 .. 2026-09-11 20:59 UTC | `lastTradedVolume` |
| BTCUSDT | `research/cmc-bot-vwap/data/BTCUSDT_1m.parquet` | 2022-08-01 .. 2026-09-11 | base-asset volume |
| ETHUSDT | `research/cmc-bot-vwap/data/ETHUSDT_1m.parquet` | 2022-08-01 .. 2026-09-11 | base-asset volume |

This package **reads** those files and never copies or rewrites them. Its own
resampled tapes live in `research/orb-ny-open/data/` (gitignored).

### 2.2 The coverage audit, run before anything was computed

`prep_data.py US100 US500` was re-run from this worktree against the raw
NDJSON and its output compared with the committed
`research/cmc-bot-vwap/results/COVERAGE.md`:

- **US100 reproduced byte-identically** — table row and the whole `### US100`
  section, and `coverage_days_US100.csv` unchanged. 971,812 bars, 0 duplicate
  timestamps, 0 non-monotone, 0 zero-volume bars.
- **US500**, whose pull completed at 2026-09-16 05:59 local and which had no
  committed row before this pass: 954,943 bars, 0 duplicate timestamps, 0
  non-monotone, 0 zero-volume, span identical to US100's, and the **same eight
  no-data weekdays**. Its `coverage_days_US500.csv` was also unchanged from the
  committed one.

The audit output is kept verbatim in `results/COVERAGE-AUDIT.md`.

**Pre-registration note on an ambiguity in the Architect's note.** §3.1 of
`ARCHITECT-NOTE.md` asks that the US500 coverage audit "reproduce the committed
`results/COVERAGE.md` row byte-identically". No US500 row existed in the
committed file — only US100's. The check was therefore read as its evident
intent — *the audit pipeline must be demonstrably stable* — and executed as:
US100's committed row and section must be reproduced byte-identically (they
were), and US500's row is established fresh here. No number in this package
depends on which reading is taken.

### 2.3 Resampling — `common.py:resample`

Bins of 5 or 15 minutes on the **epoch-aligned UTC grid**, labelled by **open
time**:

```
open = first 1m open   high = max 1m high   low = min 1m low
close = last 1m close  volume = sum         spread_close = the bin's LAST 1m spread
```

A bin with **no** 1m bar is **absent** — not forward-filled, not zero-filled.
Indicators run over the sequence of present bins. The index CFD tape runs
23:01 → 20:59 UTC with a 21:00–23:00 gap; **the overnight bars are part of the
bar sequence the EMAs / RSI / ATR see** — this is a continuous-CFD chart, not
an RTH-only chart.

**Grid coincidence.** 09:30 NY is 13:30 UTC (EDT) or 14:30 UTC (EST); both lie
on the 15-minute epoch grid, so the NY-anchored 5m/15m bins coincide with the
UTC-aligned bins under either offset. `checks.py` asserts this for **every**
session day in span; a single failure is a **stop-and-return-to-Architect**
condition (§11).

### 2.4 Eligible days — the NYSE calendar, verbatim

A day is eligible only if it is a **full NYSE trading day**: a weekday that is
neither a full closure nor a **1:00 pm ET early close**. Early-close days are
excluded because the 16:00 NY forced flat does not exist on them.

**The same calendar is applied to the crypto arms**, because the anchor being
tested is the US cash open (§1.1).

Full closures (`common.py:NYSE_HOLIDAYS`), from the exchange's published list:

- **2022** 01-17, 02-21, 04-15, 05-30, 06-20, 07-04, 09-05, 11-24, 12-26
- **2023** 01-02, 01-16, 02-20, 04-07, 05-29, 06-19, 07-04, 09-04, 11-23, 12-25
- **2024** 01-01, 01-15, 02-19, 03-29, 05-27, 06-19, 07-04, 09-02, 11-28, 12-25
- **2025** 01-01, **01-09** (National Day of Mourning, President Carter), 01-20,
  02-17, 04-18, 05-26, 06-19, 07-04, 09-01, 11-27, 12-25
- **2026** 01-01, 01-19, 02-16, 04-03, 05-25, 06-19, 07-03, 09-07, 11-26, 12-25

1:00 pm ET early closes (`common.py:NYSE_EARLY_CLOSES`):

- **2022** 11-25 · **2023** 07-03, 11-24 · **2024** 07-03, 11-29, 12-24 ·
  **2025** 07-03, 11-28, 12-24 · **2026** 11-27, 12-24

This matters materially on the index arms: the Capital.com CFD tape **trades
through most US holidays** (`COVERAGE.md` shows only eight no-data weekdays in
32 months), so "there are bars at 09:30" is not "there was a cash open".

### 2.5 Opening-range completeness

A day is eligible only if **each of the six 5-minute bins in 09:30–10:00 NY
contains at least one 1-minute bar**. Otherwise the day is excluded and
counted in the exclusions table. (For the §3.6 width sensitivities the same
rule is applied to the 3 or 12 bins of a 15- or 60-minute range.)

A day is also excluded if there is no 1-minute bar at all after the range and
before 16:00 NY.

### 2.6 Split — one calendar for all eight arms, by NY session date

| period | dates | use |
|---|---|---|
| **Fit** | **2024-01-01 .. 2025-07-31** | all exploration, every sensitivity, Study B training |
| **Holdout** | **2025-08-01 .. 2026-07-31** | **computed ONCE, at the end**; Test A verdicts; Study B frozen read |
| Tail | 2026-08-01 .. 2026-09-11 | non-gating row per arm |
| Pre-ETF (crypto, descriptive) | 2022-08-01 .. 2023-12-31 | control row (§6.2) |

Each trade belongs to exactly one session day and therefore to exactly one
period. **Never re-cut.**

---

## 3. The signal

### 3.1 Opening range — fixed 30 minutes, identical across timeframes

```
OR_high = max high of the 1m bars with open time in [09:30, 10:00) NY
OR_low  = min low  of the same bars
```

Computed from the **1m tape**, so it is identical for the 5m and 15m arms of
the same instrument-day. The range width is **not** a parameter: it enters the
feature vector as `or_width_atr` / `or_width_datr` (§7.2) and nothing else.

### 3.2 Trigger — first close beyond, one trade per day

- Candidate bars are the arm's own bars (5m or 15m) **opening in
  [10:00, 12:00) NY** — the last candidate is the bar closing at 12:00 NY.
  (§8.2 pre-registers the one alternative cutoff.)
- **Trigger:** `close > OR_high` → **long**; `close < OR_low` → **short**.
  Strictly beyond, on the **close**, never on a touch. A bar that wicks beyond
  and closes back inside does **not** trigger.
- The **first** such bar of the day, in either direction, is the day's only
  trade. No re-entry after a stop; no second trade on the opposite break.
- No trigger by the cutoff → **no trade that day**, and the day is counted.
- **Entry price = the trigger bar's close**, which by construction is the close
  of that bin's last 1-minute bar. That 1-minute bar is the **entry minute**
  and pays the entry half-spread (§5).

### 3.3 Stop — the opposite side of the range

```
long : stop = OR_low        short: stop = OR_high
stop_dist = |entry - stop|      1R == stop_dist
```

Because entry is a close *beyond* the range, `stop_dist >= OR width` always;
it is never degenerate on an eligible day. A trade whose `stop_dist` is 0, or
whose entry minute is at or after the forced flat, is dropped and counted.

### 3.4 Exit — two templates, one gates

| # | template | rule | status |
|---|---|---|---|
| **1** | **project-standard** | target **+1R** from entry; stop as §3.3; forced flat at 16:00 NY | **GATES** |
| 2 | **pure ORB** | **no target**; stop as §3.3; forced flat at 16:00 NY | mandatory secondary, **no verdict** |

**Forced flat** = mark to market at the close of the last 1-minute bar
**ending ≤ 16:00 NY** (i.e. the last bar with open time < 16:00 NY). Trades
never cross a session boundary; `checks.py` verifies it; no financing is
modelled for that reason.

**If the two templates straddle a tier:** the arm's verdict is **template 1's**
and `REPORT.md` says so in its first paragraph. A template-2 number that would
on its own clear the build bar is grounds for **one** Architect-authorised
follow-up registration of template 2 as its own arm with its own α — never a
re-labelling of this arm.

### 3.5 Fill convention — one, realistic, on the 1-minute path

From the minute **after** the entry minute through the forced-flat minute,
walking the **1-minute** bars (`engine.py:walk1m`):

1. the **stop is checked first** on a minute touching both stop and target;
2. a target fills **at its level**;
3. a stop the minute **gapped through** fills at that **minute's open**;
4. no exit by the flat minute → fill at the flat minute's **close**.

Evaluating on 1m bars is why the 1m tape is the source: same-bar ambiguity is
reduced to the one-minute level and then resolved conservatively.

**Stop rule (§11):** on any trade that neither gaps its stop nor touches both
levels inside one arm bar, the 1m-path fill and the arm-bar-OHLC fill must
agree exactly. A disagreement stops the pass.

### 3.6 Fit-period-only sensitivities on the mechanic — non-gating, reported once each

| # | sensitivity | pre-registered value |
|---|---|---|
| S1 | opening-range width | 15 minutes |
| S2 | opening-range width | 60 minutes |
| S3 | stop placement | the OR **midpoint** |
| S4 | re-entry | allowed **once** after a stop, max 2 trades/day |

None of these may change a verdict, and none is computed on the holdout.

---

## 4. Descriptive rows

### 4.1 Per-arm breakdowns, always reported

Per side (long / short); exit-cause counts (target / stop / time-exit);
the `cost_R` distribution and the gross-vs-net gap; median holding time;
the non-circular forward lift built as
`research/session-liquidity-v5-ny/tables.py:block_L`.

### 4.2 The two crypto controls (§1.1), mandatory, no verdict

1. **Weekend row.** The identical mechanic — 09:30–10:00 NY range, breakout
   10:00–12:00, flat 16:00 NY, same template, same costs — on **Saturdays and
   Sundays**, fit and holdout.
   **Pre-registered reading, fixed now:** if a crypto arm passes *and* its
   weekend row is at or above that arm's holdout mean net R, `REPORT.md` says
   **"the clock, not the anchor"** in as many words and the pass is flagged to
   the Architect as suspect **before** any build ruling. If the arm is killed,
   the weekend row is reported and nothing is inferred from it.
2. **Pre-ETF row.** The identical mechanic on **2022-08-01 .. 2023-12-31**
   weekdays. Fit-side, descriptive. **Pre-registered reading:** if it is the
   same as or better than the fit period, the ETF-transmission story is wrong
   and `REPORT.md` says so.

---

## 5. Costs

- **Capital.com arms (US100, US500).** One full spread per round trip, taken
  from the tape: **half the entry minute's `spread_close`** + **half the exit
  minute's `spread_close`**, in price, divided by `stop_dist` to give
  `cost_R`. No commission. No financing (flat every day).
  Non-gating sensitivities: **(i)** fixed spread = the fit-period median
  `spread_close` over 10:00–16:00 NY for that instrument; **(ii)** 2× the
  per-bar spread.
- **Binance arms (BTCUSDT, ETHUSDT).** `cost_R = 0.0010 × entry / stop_dist`
  (0.10 % round trip = 2 × 5 bp taker), identical to v5-NY and cmc-bot.
  Non-gating sensitivity: 0.04 % (maker).
- **Slippage is not modelled, so every number in this package is optimistic.**
  That sentence appears in `REPORT.md`.
- The `cost_R` distribution is reported per arm. Because the stop is the full
  opening range, `cost_R` should be far smaller than the cmc-bot pass's
  0.25–0.4R; if it is not, that is itself a finding and gets a sentence.

---

## 6. Nulls and the interval

Fixed seed `20260916`, `numpy.random.default_rng`.

- **Null A — matched-time placebo. Primary. 1,000 draws.** Each real trade is
  replaced by one entered at a bar drawn uniformly from the **same
  10:00–12:00 NY eligibility window on a different, randomly chosen eligible
  day** of the same instrument and arm, **same side**, **same `stop_atr`**
  (the placebo stop is placed at `entry ∓ stop_atr × ATR14` of the placebo
  bar, `ATR14` on the arm's bars), same template, same 16:00 NY forced flat,
  same cost model. A draw landing on the trade's own date is redrawn once and
  the residual same-date rate is reported.
  **One-sided `p_A` = the share of draws whose mean net R ≥ the observed
  mean net R.**
- **Null B — whole-stream day shift. Secondary. 250 draws**, `k ~ U{1..250}`
  eligible days without replacement; shifted entries landing on a missing
  minute are dropped and the drop rate reported.
- **Interval.** Day-block bootstrap: whole **session days** resampled with
  replacement, **2,000 draws**, **90 %** interval (5th, 95th percentile) on the
  **holdout** mean net R of template 1.

---

## 7. The 24-feature vector (Study B input)

### 7.1 Conventions

- **Bar of computation: the entry (trigger) bar's close**, on the arm's own
  bars, using only bars whose close is ≤ the entry bar's close. Session-
  anchored quantities (OR, session VWAP) use 1m bars up to and including the
  entry bar's last minute.
- **No feature may see a later bar.** `checks.py` re-computes every feature for
  **50 random trades** from a tape truncated at the entry bar and asserts
  equality. A failure stops the pass (§11).
- **Side-signing.** For a feature whose sign has directional meaning the stored
  value is `side × raw` (`side = +1` long, `−1` short), so **positive = aligned
  with the trade**. Marked "signed" below.
- `ATR14` = **Wilder** ATR(14) on the **arm's** bars, at the entry bar.
- `dATR14` = **Wilder** ATR(14) on **session-day bars defined as 16:00 NY →
  16:00 NY** (full 24 h, same definition on all four tapes), read **as of the
  prior trading day's close**.
- EMAs use α = 2/(k+1), seeded with SMA(k). RSI is Wilder (SMMA gains/losses).
- **Warm-up.** A trade needing more history than exists gets NaN in the
  affected columns; it is **dropped from Study B and counted**, and **stays in
  Test A**.

### 7.2 The columns

| # | name | formula at entry bar `t` | signed |
|---|---|---|---|
| 1–4 | `ema20_d` `ema50_d` `ema100_d` `ema200_d` | `(close_t − EMA_k)/ATR14`, k ∈ {20,50,100,200} | yes |
| 5 | `ema_stack` | how many of EMA20>EMA50, EMA50>EMA100, EMA100>EMA200 **agree with the trade side** (0–3) | yes |
| 6 | `ema200_slope` | `(EMA200_t − EMA200_{t−10})/ATR14` | yes |
| 7 | `rsi15` | Wilder RSI(15) of close; **for shorts stored as `100 − RSI`** | no |
| 8 | `rsi20` | Wilder RSI(20), same treatment | no |
| 9 | `vwap_sess_d` | `(close_t − VWAP_{09:30})/ATR14`; VWAP over 1m bars from 09:30 NY through the entry bar's last minute, typical = (H+L+C)/3 | yes |
| 10 | `vwap_day_d` | same, anchor **00:00 UTC** of the entry minute's UTC date | yes |
| 11 | `tod_min` | minutes from 09:30 NY to the entry bar's **open** | no |
| 12 | `dow` | NY weekday, Mon=0 … Fri=4, **categorical** | no |
| 13 | `or_width_atr` | `(OR_high − OR_low)/ATR14` | no |
| 14 | `or_width_datr` | `(OR_high − OR_low)/dATR14` | no |
| 15 | `overshoot_atr` | `side × (close_t − broken edge)/ATR14` | yes |
| 16 | `or_body` | `side × (last 1m close of the OR − first 1m open of the OR)/(OR_high − OR_low)` | yes |
| 17 | `gap_datr` | `side × (09:30 open − prior session 16:00 close)/dATR14` | yes |
| 18 | `prev_day_ret` | `side × (prior session close − the one before)/dATR14` | yes |
| 19 | `pd_level_d` | `side × (level − close_t)/ATR14`; level = prior **session-day high** for a long, **low** for a short | yes |
| 20 | `range200_pos` | `side × (close_t − mid)/(top − bottom)`; top/bottom = max high / min low of the **200 bars preceding t** | yes |
| 21 | `or_rvol` | OR volume ÷ **median** OR volume of the prior 20 sessions in the arm's table | no |
| 22 | `bar_rvol` | entry-bar volume ÷ **mean** volume at the same clock slot over the prior 20 sessions in the arm's table | no |
| 23 | `atr_regime` | `ATR14_t / SMA(ATR14, 200 bars)_t` | no |
| 24 | `datr_pct` | `dATR14 / close_t × 100` | no |

`instrument` is a categorical column **in the pooled model only**.
`rsi14` is computed but is **not a model column**; only its Pearson
correlation with `rsi15` is reported (collinear, conventional period).

**Mechanical note on 21/22 — CORRECTED, see amendment 2.** Both denominators
are built over the **prior 20 eligible sessions**, exactly as
`ARCHITECT-NOTE.md` §5.2 #21–#22 words it: a clock slot is a property of the
session's bar grid and exists whether or not a breakout happened that day, so
an untriggered eligible session still contributes to the denominator.
`features.py:SessionStats` enumerates every eligible session in span for this
purpose and `lookup` reads only sessions strictly before the trade's own date.
Where a session is missing that particular slot bin, the mean is taken over
the 20 most recent prior eligible sessions that carry it. Both remain
features; neither is a signal component.

**Not included, with the reason:** iFVG / sweep primitives (reversal-shaped,
no argued role in a breakout's outcome); cross-instrument features (couples two
tapes with different calendars — a separate study); `rsi14` (collinear).

### 7.3 The target

- **Primary: `netR` of template 1** (continuous; regression).
- Secondary, reported but never used for flagging: `netR` of template 2, and
  the binary `netR > 0`.

---

## 8. Test A — the verdict ladder

### 8.1 The ladder, applied mechanically to **template 1's holdout mean net R**, per arm

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — INCONCLUSIVE.** No directional claim. Return to Architect. |
| holdout mean net R `< +0.05R` **or** Null-A `p_A > 0.20` | **NO EDGE — KILL.** |
| `≥ +0.05R` and `0.00625 < p_A ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| **all** of: mean net R `≥ +0.10R`; `p_A ≤ 0.00625`; fit period same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; 90 % day-block bootstrap excludes 0; **gross** expectancy `> 0` | **REAL EDGE — build for real.** Routes to Architect for a build ruling. |

**α = 0.05 / 8 = 0.00625.** The family is the eight pre-registered arms of §1.
The two timeframes of one instrument trade the same days and are correlated;
Bonferroni is conservative for that and is kept anyway.

Nothing here is loosened. The kill bar stays at +0.05R and the build bar at
+0.10R: ORB takes at most one trade a day per arm, slippage is unmodelled and
the fill on the primary template is optimistic.

### 8.2 The one pre-registered power contingency

≈ 250 NYSE full trading days fall in the holdout. Before the holdout is
touched, and **on the fit period only**, this package computes per arm:

```
share = (fit-period days that produced a trade) / (fit-period eligible days)
projected n_holdout = share x (eligible holdout days, from the calendar alone)
```

`eligible holdout days` is a **calendar count** (§2.4/§2.5 applied to the
holdout dates); it contains no R and no trade outcome.

**If the projection is `< 150` for an arm, that arm's eligibility window
extends from 12:00 to 13:30 NY** — the one and only alternative, fixed now.
Which arms run on which cutoff is recorded **in this file, in a commit, before
any holdout number exists**. If even the 13:30 projection is `< 150`, the arm
runs anyway on the widened window and the UNDERPOWERED row applies.

**No other parameter moves for power, ever.**

#### 8.2.1 Cutoff decision — DECIDED 2026-09-16 on the fit period, before any R

Computed by `projection.py` from **fit-period trigger counts and calendar day
counts only**. No R, no win rate and no expectancy existed when this was run.

| arm | fit eligible days | triggered by 12:00 | share | **projected n_holdout** | triggered by 13:30 | share | projected n_holdout | **cutoff** |
|---|---|---|---|---|---|---|---|---|
| US100-5m | 392 | 370 | 0.944 | **234.1** | 383 | 0.977 | 242.3 | **12:00** |
| US100-15m | 392 | 348 | 0.888 | **220.2** | 372 | 0.949 | 235.3 | **12:00** |
| US500-5m | 391 | 378 | 0.967 | **240.7** | 385 | 0.985 | 245.2 | **12:00** |
| US500-15m | 391 | 368 | 0.941 | **234.4** | 383 | 0.980 | 243.9 | **12:00** |
| BTCUSDT-5m | 392 | 367 | 0.936 | **233.1** | 381 | 0.972 | 242.0 | **12:00** |
| BTCUSDT-15m | 392 | 351 | 0.895 | **223.0** | 376 | 0.959 | 238.8 | **12:00** |
| ETHUSDT-5m | 392 | 358 | 0.913 | **227.4** | 382 | 0.974 | 242.6 | **12:00** |
| ETHUSDT-15m | 392 | 339 | 0.865 | **215.3** | 372 | 0.949 | 236.3 | **12:00** |

Eligible holdout days from the calendar alone: 248 (US100, BTCUSDT, ETHUSDT),
249 (US500).

**DECISION: the contingency does NOT fire. All eight arms run on the
pre-registered [10:00, 12:00) NY trigger window.** Every projection is
comfortably above the 150 floor (lowest: 215.3 on ETHUSDT-15m). The widened
13:30 window is **not used by any arm** and no number in this package is ever
computed on it again.

The Architect's §3.3 projection assumed 60–80 % of eligible days would produce
a breakout by 12:00; the realised fit-period share is **86.5–96.7 %**. That is
a data note, not a change: a *close* beyond a 30-minute range within the next
two hours is a common event, and the mechanic is unchanged by it. The
15-minute arms trigger less often than the 5-minute arms on every instrument,
as a coarser confirmation bar should.


---

## 9. Study B — the LightGBM feature study (hypothesis-generating)

**This section produces no verdict.** Its output is a list of *proposals*.

### 9.1 Training — fit period only, frozen thereafter

- **Sample:** fit-period trades, template-1 `netR` as the target.
  **One model per timeframe, pooled across the four instruments**, with
  `instrument` as a categorical column. Per-instrument models are a secondary
  reading with an explicit small-n caveat.
- **Fixed hyper-parameters, no tuning** (`common.py:LGB_PARAMS`):
  `objective=regression_l2`, `num_leaves=7`, `max_depth=3`,
  `min_data_in_leaf=30`, `learning_rate=0.03`, `feature_fraction=0.8`,
  `bagging_fraction=0.8`, `bagging_freq=1`, `lambda_l2=10.0`, `cat_smooth=10`.
- `n_estimators` by **early stopping** (patience 100, cap 2,000) on **blocked,
  chronological 5-fold CV inside the fit period**: folds are contiguous date
  ranges, no shuffling, with a **5-session purge gap** between train and
  validation.
- **Seeds 0–4**, results averaged.
- **Environment, pinned:** Python 3.9.6; `lightgbm 4.6.0`, `shap 0.49.1`,
  `scikit-learn 1.6.1`, `numpy 2.0.2`, `pandas 2.3.3`, `scipy 1.13.1`,
  `numba 0.60.0`, `pyarrow 21.0.0`. (`lightgbm` needs `libomp`; installed via
  Homebrew `libomp 23.1.1`.) All seeds fixed.

### 9.2 Importance — permutation and SHAP, **never gain or split count**

- **Permutation importance** on the **out-of-fold** fit predictions: per
  feature, **100 shuffles**, `ΔMSE = MSE(shuffled) − MSE(baseline)`, averaged
  over folds and seeds.
- **SHAP** (TreeSHAP) **mean |value|** per feature on the out-of-fold
  predictions, as the second reading; SHAP dependence plots **for flagged
  features only**, on the fit period, to read the *direction*.
- **Gain and split count are not reported at all** — they are biased toward
  high-cardinality columns and `tod_min` and the continuous distances would win
  by construction.

### 9.3 The null for "which features matter" — target-shuffle, max-statistic

- **200 refits of the full pipeline** with `netR` **permuted across trades
  within instrument and within fit-year** (to preserve marginal structure),
  **one seed each**, same hyper-parameters, same folds. Each refit records
  **the maximum permutation importance over all 24 features**.
- A feature is **FLAGGED** iff its real permutation importance exceeds the
  **95th percentile of that null-max distribution**. This controls the
  family-wise error rate across the 24 features (Westfall–Young style).
- **No per-feature p-value is reported without this correction.**
- Expected outcome under no signal: **zero flags**. `REPORT.md` states the
  number of flags **and** the null-max threshold either way.

### 9.4 The holdout read — frozen model, pre-committed wording, no verdict

Taken **after** Test A's holdout is cut and its eight verdicts are locked. The
frozen models are applied **once**. No refit, no re-tuning, no re-selection.

1. **Spearman** rank correlation between predicted and realised `netR` on the
   holdout, with a 90 % day-block bootstrap interval.
2. **Score terciles**, cut-points from the **fit-period** prediction
   distribution: holdout mean `netR` in the top vs bottom tercile, with a 90 %
   day-block bootstrap interval on the difference.
3. **For each FLAGGED feature:** holdout mean `netR` in the three terciles of
   that feature, cut-points from the **fit period**; the sign of the
   top-minus-bottom difference compared with the fit-period SHAP direction.

**Pre-committed wording, fixed now:**

- "**OOS-consistent**" iff the holdout top-minus-bottom difference has the
  fit-period sign **and** its 90 % interval excludes 0;
- otherwise "**not confirmed out of sample**".

**Neither word is a verdict.** What an OOS-consistent flag earns is a
**proposal**, written into `HANDOFF.md` in exactly this form:

> *"ORB on arm X conditioned on feature F ≥ q (q = the fit-period tercile
> boundary, fixed), as a new pre-registered arm, own α, same ladder, same
> nulls, fresh registration."*

The Architect decides whether to register it. Any such registration must test
on a **later** holdout, or at minimum declare the re-use of this holdout with
the conflict named — **because this holdout will have been read by Study B.**

### 9.5 Two things the deliverable must say

1. **Ordering of evidence.** "Does ORB work" (Test A, pre-registered,
   Bonferroni, kill/build) is settled **before and separately from** "which
   conditions correlate with it working better" (Study B, exploratory,
   FWER-controlled flags, no verdict). `REPORT.md`'s **first paragraph**
   carries the eight Test A verdicts; Study B lives under a later heading
   containing the words **"hypothesis-generating"**.
2. **`tod_min` and `dow` contest Запись 2**, which found clock filters on
   crypto do not survive a holdout. A flag on either feature on a crypto arm
   is **not** a reversal of that finding; it is a proposal to test it again
   under §9.4's follow-up form.

---

## 10. Order of work

1. Data: resample all four tapes to 5m and 15m; NYSE eligibility calendar;
   coverage audit (§2.2). **No R.**
2. **This file, committed.** ← *the pre-registration commit*
3. Mechanic proof on the fit period: ten hand-checked trades per timeframe
   with the OR, trigger bar, stop, exit minute and every feature shown
   (`MECHANIC-PROOF.md`); the §7.1 look-ahead check; the §2.3 grid check; the
   §3.5 fill-agreement check.
4. §8.2 projection on the **fit period only** → **cutoff decision committed**
   into §8.2.1 of this file.
5. Fit-period Test A numbers, all arms and rows, all §3.6 sensitivities.
6. Study B training on the fit period: CV, importances, null, flags.
7. **Holdout, ONCE:** Test A verdicts locked first; then the §9.4 frozen read.
8. `REPORT.md`, `HANDOFF.md`, a `RESEARCH-LOG.md` Запись **regardless of
   outcome**. A kill is a result.

---

## 11. Stop rules — return to the Architect, do not decide unilaterally

Stop immediately if:

1. the coverage audit does not reproduce `COVERAGE.md` (§2.2);
2. the NY-anchored bins fail to coincide with the UTC grid on any day (§2.3);
3. the look-ahead check fails for any feature (§7.1);
4. the 1m-path fill and the bar-OHLC fill disagree on a trade that neither
   gaps nor touches both levels within one bar (§3.5);
5. realised `n_holdout < 150` on a pre-registered arm **even after the §8.2
   contingency** — that arm is UNDERPOWERED and returns to the Architect; the
   other arms proceed;
6. the pre-registration turns out to be ambiguous or wrong in a way that
   changes a number.

---

## 12. Amendment log

Only §8.2.1 may be filled in after this commit, and only from fit-period
trigger counts, and only before any holdout number exists. Any other change to
this file after the pre-registration commit is a protocol violation and must be
recorded here with its commit hash and its reason.

| # | date | what | commit |
|---|---|---|---|
| 0 | 2026-09-16 | pre-registration, committed before any R | `82d6c0b` |
| 1 | 2026-09-16 | §8.2.1 filled in from fit-period trigger counts: contingency does NOT fire, all eight arms keep the 12:00 NY cutoff. No R existed at this commit. | `290260e` |
| 2 | 2026-09-16 | **§7.2 `or_rvol` / `bar_rvol` corrected to match the binding note.** The pre-registration commit's mechanical note built both denominators over prior *triggered* sessions; `ARCHITECT-NOTE.md` §5.2 says prior **eligible** sessions, and this file's own preamble makes the Architect's note binding where the two disagree. The original reading was not merely narrower, it was destructive: `bar_rvol` needs 20 prior observations at the *same clock slot*, and triggers concentrate at early slots, so it silently dropped 846 of 1,473 (5m) and 508 of 1,406 (15m) fit trades from Study B — and dropped them non-randomly, discarding precisely the late breakouts. Corrected before any model was trained. Warm-up drops fall to 37 per timeframe (genuine: the first 20 eligible sessions of 2024 and the first 14 session-day bars). **Test A is untouched: the trade tables rebuilt bit-identically in `netR_1` and `grossR_1` on all 4,851 rows**, because no feature enters the signal. | *(this commit)* |
