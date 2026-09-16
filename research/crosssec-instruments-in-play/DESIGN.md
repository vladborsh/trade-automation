# DESIGN — Cross-sectional "instruments in play": RVOL and trailing-return selection on the Binance USD-M perp universe

**Status:** pre-registration, mechanical restatement of
`ARCHITECT-NOTE.md` (this package, 2026-09-16, commit `02c1a96`).
**This file is committed before any R is computed on any row.** Where this
file and the Architect's note disagree, the note is the pre-registration and
this file is the bug; where this file and the code disagree, this file is the
pre-registration and the code is the bug.

The numbers in §2.3 (`N_elig` series, first tradable day) and §13 (the fit
screen) are the only quantities added after the note. `N_elig` is a count of
eligible instruments — it involves no price outcome, no return, no R — and is
recorded here, as the note's §11.2 requires, before `build.py legs` is run.

---

## 1. The α ledger and the declaration (note §7.1, §7.2)

**Family = exactly two arms.** `RVOL-top5-s0.5` and `TR24-top5-s0.5`.
**α = 0.05 / 2 = 0.025 per arm.** This family opens **its own** line count, at
**2 registered / 0 read**, and does not continue the ORB cumulative ledger.
The argument is the note's §7.2 and is not re-opened here.

**Declaration of prior use of the holdout window 2025-08-01 .. 2026-07-31,
verbatim (note §7.1):** the window has been registered on **22**
pre-registered ORB arms and actually **read by 11** of them (RESEARCH-LOG
Записи 23–26), of which **4 reads were on crypto** (`orb-ny-open` BTC/ETH ×
5m/15m), plus **2 further crypto reads** by `cmc-bot-vwap` Stage 1
(BTCUSDT-(a), ETHUSDT-(a), Запись 22). On BTCUSDT and ETHUSDT specifically the
year has been judged six times. Every one of those reads was a
single-instrument, time-series clock mechanic on BTC or ETH.

**The tightening that pays for it (note §7.2):** one design choice — the
09:30 NY anchor — was informed by a holdout-period observation from a closed
family (the NY-anchored crypto ORB forward lift, Запись 23). Therefore a REAL
EDGE verdict on either arm **does not route to a build ruling**; it routes to
the §12 frozen forward confirmation, and only a confirmed pass routes to a
build ruling. **No tail row is read in this pass** — the tail is the
forward-confirmation window.

## 1.1 The honest prior, stated before any number exists (note §6.3)

The source paper's (Zarattini–Barbon–Aziz 2024) tiers, restated in dATR
units at its own 0.10 × dATR14 stop: below-100 %-RVOL **−0.002 dATR**,
above-100 % **+0.008 dATR**, above-3,000 % **+0.038 dATR**, gross of spread.
This project's round trip of 0.10 % of price is **0.04 dATR** for a BTC-like
coin (dATR ≈ 2.5 % of price), **0.02 dATR** for a typical alt (5 %),
**0.0125 dATR** for a high-vol alt (8 %). So the paper's **top** tier,
transplanted naively, nets **≈ +0.018 dATR** on a typical alt and **≈ 0** on a
BTC-like coin; at the gating stop (1R = 0.5 dATR) that is
**+0.036R / 0.0R — below this project's +0.05R kill bar.**

**Therefore: a pass on this family requires roughly twice the paper's
top-tier effect — about +0.07 dATR gross per 4-hour trade on a typical alt.**
That is the hypothesis (a crypto alt "in play" moves more in 4 hours,
relative to its own ATR, than a US stock in play moves in a day; a
50–400-symbol cross-section ranked to the top 1–10 % sits nearer the paper's
top tier than its middle). **If the hypothesis is wrong the family dies at
the fit screen, and that is the correct outcome.** No tier below the paper's
top is a target of this registration. Every R number in the REPORT is printed
beside its dATR equivalent (`netR × s`) so it can be compared with the paper
without the stop in the way.

---

## 2. The universe (note §1)

### 2.1 Admission — survivorship-free by construction

- Source: `https://data.binance.vision/data/futures/um/monthly/klines/<SYM>/<interval>/`, free, no key.
- Symbol list: the **paginated** S3 listing
  `https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/futures/um/monthly/klines/`,
  following `NextMarker` while `IsTruncated`. **Probed 2026-09-16: 1,018
  prefixes** (the note's count exactly).
- **Admission rule, mechanical:** prefix matches `^[A-Z0-9]+USDT$` — no
  underscore (dated delivery contracts), no `SETTLED` suffix, USDT quote.
  **860 symbols admitted.** Reconciliation with the note's "864 end in
  `USDT`": exactly **864** prefixes end in the literal string `USDT`, of which
  **4** are Chinese-character joke tickers (`币安人生USDT`, `我踏马来了USDT`,
  `牛来USDT`, `龙虾USDT`) that the `[A-Z0-9]+` class excludes. 860 = 864 − 4.
  Recorded in `results/listing.json`.
- **No symbol is excluded by name, ever.** Index perps (`DEFIUSDT`,
  `BTCDOMUSDT`) and re-denominated tickers (`1000SHIBUSDT`) are in.
- **Delisted symbols are in the archive and are in the universe.** Listing
  date = first bar of the earliest monthly archive; delisting date = last bar
  of the latest one. Proof case: `LUNAUSDT` 1d archives **2021-01 .. 2022-05**
  and nothing after (verified 2026-09-16; its last daily bar is 2022-05-13).
- `results/universe.csv` records every admitted symbol with first/last archive
  month, first/last daily bar, day count and gap count. **860 symbols,
  636,990 UTC daily bars, 2020-01-01 .. 2026-08-31, 0 fetch errors**
  (`results/history_audit_1d.json`).

### 2.2 Per-day eligibility — the seven rules, each recorded individually

For an anchor day `d` (a NYSE full trading day, §4) with anchor `A` = 09:30
America/New_York on `d`, symbol `s` is **eligible** iff all of:

| # | rule | source of the number | causal? |
|---|---|---|---|
| 1 | `first_bar(s) ≤ A − 30 × 24 h` (listed ≥ 30 days) | 1d archive | yes |
| 2 | all 30 one-minute bars with open time in `[A, A + 30 min)` present, the first opening exactly at `A` | 1m archive | yes |
| 3 | `V30` (§3.1) defined on **≥ 10 of the prior 14 anchor days** (prior NYSE full days) | 1m archive | yes |
| 4 | `dATR14(s)` (§6.1) finite and > 0 on the last complete UTC day before `d` | 1d archive | yes |
| 5 | median daily **quote** volume over the **14 complete UTC days before `d`** ≥ **10,000,000 USDT** | 1d archive | yes |
| 6 | tape runs through the exit: end of `s`'s last daily bar ≥ `A + 4 h 30 min` | 1d archive | **no — declared** |
| 7 | **selector B only:** a 1m close exists at `A − 24 h` (last bar opening in `[A − 24 h − 5 min, A − 24 h)`) | 1m archive | yes |

`N_elig(d)` = symbols passing 1–6 (arm A's set). Arm B's set = those also
passing 7, a subset. **The day is tradable iff `N_elig(d) ≥ 50`**; otherwise
no arm trades and the day is counted in an exclusions row.

Rule 6 is the **only** non-causal element in the primary and it uses 4.5
hours of forward knowledge. It removes instrument-days that **could not be
evaluated**, not ones that lost. Declared here and in the REPORT.

Not in the rule, ever (note §1.4): market cap, sector, age beyond 30 days,
"known scam" lists, Binance delisting announcements, BUSD/USDC duplicates.

### 2.3 `N_elig` over time and the first tradable day

Recorded from `results/n_elig.csv`, built by `build.py panel`. **No R is
computed at this point**; `N_elig` is a count of instruments.

<!-- NELIG -->

**Admitted universe: 860 symbols** (§2.1), of which **707** have at least one day passing the daily-data-only rules 1/4/5 and therefore have 1-minute archives pulled (§15 `prep/pull1m.py`).

**First tradable day (`N_elig ≥ 50`): `2020-11-24`.** The fit period therefore effectively starts there, not at 2020-01-01 — the USD-M venue simply did not have 50 symbols passing the liquidity floor before then. (Stop rule 3 of §14 asked whether `N_elig` reaches 50 before 2021-07-01: it does, in 2020-11.)

**Tradable days: 1,397 of 1,641 NYSE full days in 2020-01-01 .. 2026-07-31** (244 days are counted in the exclusions row as `N_elig < 50`).

| year | NYSE full days | tradable | `N_elig` min | median | max | `N_elig(B)` median |
|---|---|---|---|---|---|---|
| 2020 | 251 | 8 | 0 | 15 | 57 | 15 |
| 2021 | 251 | 250 | 49 | 111 | 132 | 111 |
| 2022 | 250 | 250 | 86 | 132 | 140 | 132 |
| 2023 | 248 | 248 | 81 | 137 | 210 | 137 |
| 2024 | 249 | 249 | 134 | 183 | 303 | 183 |
| 2025 | 247 | 247 | 125 | 195 | 254 | 195 |
| 2026 | 145 | 145 | 115 | 138 | 155 | 138 |

The note projected `N_elig` above 200 from 2022 and 300–400 across the holdout. The realised series is lower than that projection (the 10 M USDT liquidity floor binds harder than the note assumed) but is far above the 50-symbol threshold throughout, so the cross-section is wide enough for a top-5 selection to mean something. Recorded here, before any R, as a fact about the universe rather than about the mechanic.

<!-- /NELIG -->

## 3. The two selectors (note §2)

Both are computed at `A + 30 min` from bars with open time `< A + 30 min`,
over the §2.2 eligible set, and both hand their selection to the **same**
reader, stop, exit and costs. The ranking is the only difference between the
arms; that is the point.

### 3.1 Selector A — opening relative volume (`RVOL`)

```
V30(s, d)  = Σ quote_volume of the 30 one-minute bars with open time in [A, A + 30 min)
RVOL(s, d) = V30(s, d) / median{ V30(s, d') : d' in the prior 14 anchor days, V30 defined }
```

- "Prior 14 anchor days" = the 14 **NYSE full trading days** before `d`, same
  09:30 NY window each (not calendar days). The weekend row uses the prior 14
  **calendar** days' same window (§4.3).
- **Quote** volume (USDT), not base volume.
- Ranking: descending `RVOL`, **ties broken by larger `V30`**.
- **Top 5 = arm A's selection.**

### 3.2 Selector B — trailing 24-hour absolute return (`TR24`)

```
P(t)       = close of the last 1m bar with open time in [t − 5 min, t)   (else undefined)
TR24(s, d) = P(A) / P(A − 24 h) − 1
rank on |TR24|, descending, ties by larger V30
```

- **Top 5 by `|TR24|` = arm B's selection.** The **direction still comes from
  the §5 reader**, never from the sign of `TR24` — this keeps the A-vs-B
  comparison a comparison of selectors only.
- 24 h is fixed. 12 h and 48 h are **fit-only sensitivities** (§11).

### 3.3 The nulls — what makes this a test of selection, not of the reader

Identical reader, stop, exit, costs and day; only the selection changes.

- **Null A — random-5, PRIMARY, 1,000 draws.** Per tradable day, 5 symbols
  drawn uniformly without replacement from that day's eligible set (arm A's
  set for arm A, arm B's for arm B). Each draw is a full stream over the
  period. **One-sided `p` = share of draws whose mean net R ≥ the arm's mean
  net R.** *This `p` is the `p` in the §10 ladder.*
- **Bottom-5 — deterministic null, always reported.** The 5 lowest-ranked
  eligible symbols by the same ranking. Reported with its own mean net R and
  with **`Δ_tb` = mean(top-5) − mean(bottom-5)** and a 90 % day-block
  bootstrap interval, days resampled **jointly** so the top and bottom of the
  same day travel together. **Ladder tightening: a REAL EDGE requires the
  `Δ_tb` interval to exclude 0.**
- **Null B — selection day-shift, secondary, 250 draws.** Day `d` trades the
  set selected on day `d − j`, `j ~ U{1..250}` tradable days; symbols not
  eligible on `d` are dropped from the shifted set.
- **Middle-5** (ranks `⌊N/2⌋ − 2 .. ⌊N/2⌋ + 2`): descriptive only.

### 3.4 The pre-registered A-vs-B comparison — DESCRIPTIVE, NO VERDICT

Reported on the holdout beside the two verdicts: `Δ_AB` = mean net R (A) −
mean net R (B) with a 90 % jointly-resampled day-block interval; per-day
Jaccard overlap of the two selected sets and the share of legs in both; mean
net R of legs in **A only / B only / both** (fit and holdout); Spearman rank
correlation of `RVOL` and `|TR24|` across eligible symbols, averaged over
days. **Pre-committed wording:** "selector A dominates B" iff `Δ_AB > 0` and
its interval excludes 0, symmetrically for B, otherwise
"indistinguishable". This wording informs a *build ruling* only; **it never
creates or rescues a verdict.**

---

## 4. The anchor (note §3)

- **`A` = 09:30 America/New_York, DST-aware** — 13:30 UTC under EDT, 14:30
  UTC under EST, computed by `common.py:ny_ms`, the same convention as
  `research/orb-ny-open/common.py:ny_ms`. **`checks.py` asserts the anchor
  falls on 13:30 or 14:30 UTC and on no other UTC time, on every day.**
- **Days = NYSE full trading days.** Holidays and 1:00 pm early closes are
  excluded and counted (the 14:00 NY exit does not exist on an early close).
  The calendar is `common.py:NYSE_HOLIDAYS / NYSE_EARLY_CLOSES`, carried from
  `orb-ny-open/common.py` (2022–2026 verbatim) and extended to 2020–2021.
- Entry at `A + 30 min`; exit at `A + 4 h 30 min` = 14:00 NY.

### 4.3 Controls on the anchor — descriptive, mandatory, no verdict

- **Weekend row** (fit and holdout): both arms, same NY clock, Saturdays and
  Sundays, RVOL denominator over the prior 14 **calendar** days' same window.
  **Pre-committed reading:** if an arm reaches REAL EDGE and its weekend row
  is at or above that arm's holdout mean net R, the REPORT says "the clock,
  not the open" and the pass is flagged to Architect as suspect before any
  build ruling. On a kill the row is reported and nothing is inferred.
- **Fit-only placebo anchors: 00:00 UTC and 04:00 UTC**, seven days a week,
  identical code path with the anchor as a parameter. **Never the holdout.**
  Reading: if the 04:00 placebo is at or above the 09:30 NY arm on the fit
  period, the anchor is not doing anything and the REPORT says so.
- **Other anchors are not registered.** A different anchor is a different
  registration.

---

## 5. The direction reader — deliberately the plainest possible (note §4)

```
r30(s, d) = close(bar opening at A + 29 min) / open(bar opening at A) − 1
side      = +1 if r30 > 0 ;  −1 if r30 < 0 ;  no trade if r30 == 0 (counted)
entry     = close of the bar opening at A + 29 min  (the price at A + 30 min)
```

**No range, no breakout trigger, no threshold on `|r30|`, no filter of any
kind.** Every selected instrument trades every tradable day unless
`r30 == 0`. If the family passes, nothing in the entry can be credited; if it
fails, nothing in the entry can be blamed. That is the design, and it is why
a pass attributes to the **selector**.

Fit-only sensitivities: the minimum-move filter `|r30| ≥ 0.10 × dATR14`; the
5-minute reader `r5` with entry at `A + 5 min` beside the 5-minute `RVOL`.

---

## 6. Risk, exit, one trade per instrument (note §5)

### 6.1 The volatility unit

`dATR14(s, d)` = **Wilder ATR(14)** — code verbatim from
`orb-utc0-crypto/indicators.py:atr_wilder`, copied into `common.py` — on
**UTC daily bars** of `s` from the 1d archive, value as of the **last
complete UTC day before `d`** (that day ends at 00:00 UTC on `d`, before any
anchor, so the value is strictly causal). UTC days, not NY session days, so
the weekend row and the placebo anchors use the same unit. Warm-up 15 days,
inside the 30-day listing rule. `checks.py` cross-checks the 1d bars against
1m aggregates on 30 random symbol-days.

### 6.2 The stop ladder — 0.5 × dATR14 GATES

```
stop_dist = s × dATR14(s, d) ;  long: stop = entry − stop_dist ;  short: + stop_dist
1R ≡ stop_dist
```

| `s` | status |
|---|---|
| **0.5** | **GATES — this is the arm. Fixed now; does not move for any reason, including power.** |
| 0.25 | fit-only sensitivity |
| 1.0 | fit-only sensitivity |
| 0.10 | fit-only cost row (the 2024 paper's own stop) |

### 6.3 Exit

- **Time exit at `A + 4 h 30 min`** (entry + 4 h; 14:00 NY), at the close of
  the bar opening at `A + 4 h 29 min`, **or the stop**, whichever comes first.
  **No target, no trail, no break-even.**
- **Fill convention** on the 1-minute path from the bar opening at `A + 30`
  onward — `orb-ny-open/engine.py:walk1m` with target = ±∞, reproduced in
  `engine.py:walk_many`: the **stop is checked first**; a stop the minute
  **gapped through fills at that minute's open**; the time exit fills at the
  close. **Missing minutes inside the path are skipped, not filled**, and
  counted per trade; **a trade whose path is missing more than 30 minutes is
  excluded and counted.**
- **One trade per instrument per arm per day. No re-entry.** The same
  instrument may be selected by both arms on the same day; each arm is its own
  hypothesis and evaluates it, and the overlap is reported (§3.4).

### 6.4 The basket rows — DESCRIPTIVE, NO VERDICT, NOT PRE-REGISTERED AS ARMS

`basket.py`: (a) the backlog entry's dollar-neutral basket — long the top 5
by **signed** `TR24`, short the bottom 5, equal notional, **no per-leg stop**,
entry `A + 30`, exit `A + 4 h 30`, 0.10 % per leg; daily return in bp of gross
notional, in units of the basket's own trailing-60-day daily-return standard
deviation, annualised Sharpe, by year. (b) a **beta-hedged** row for each
primary arm — every leg paired with an opposite-side `BTCUSDT` leg of equal
notional, same entry and exit, its own 0.10 %. (c) the **portfolio-risk
description** — per day the sum of leg net R, its distribution, worst day,
worst 20-day run, and the mean pairwise correlation of same-day leg outcomes.
**None of these carries a verdict word.** (c) is why `n_holdout` is counted in
trade-days as well as legs.

---

## 7. Costs and funding (note §6)

- **0.10 % round trip taker per leg, GATING.**
  `cost_R = 0.001 × entry / stop_dist` — `common.py:cost_R`, identical to
  `orb-ny-open/engine.py:cost_R`, Binance branch, on the **entry price**.
- **Fit-only sensitivities, never a verdict:** 0.04 % (maker), **0.20 %**
  (thin-book taker plus slippage on alts).
- **Slippage is not modelled, so every number in this pass is optimistic —
  and a coin in play has a thinner book than BTC.** This sentence appears in
  the REPORT.
- **Funding — MANDATORY SECONDARY ROW WITH A VETO.** Every trade is open
  across the **16:00 UTC** settlement on every eligible day. Primary: funding
  **not** modelled (comparable with every prior crypto arm, none of which
  crossed a settlement). Secondary row: realised funding from
  `data/futures/um/monthly/fundingRate/<SYM>/`, payment
  `= side × (−rate) × entry / stop_dist` in R for each settlement whose
  timestamp lies in `(entry, exit]`; **a missing rate is treated as 0 and
  counted**. **Veto: a REAL EDGE requires the funding row's holdout mean net R
  ≥ +0.05R with the same sign.**

---

## 8. Split (note §7.1)

| period | dates | use |
|---|---|---|
| **Fit** | **2020-01-01 .. 2025-07-31**, effective from the first day with `N_elig ≥ 50` (§2.3) | all exploration, every sensitivity, the fit screen |
| **Holdout** | **2025-08-01 .. 2026-07-31** | **computed once**, after this file and the §13 screen decision are committed |
| **Forward confirmation** | **2026-08-01 .. 2026-10-31** | **NOT READ IN THIS PASS** (§12) |
| **Tail** | — | **there is no tail row in this pass** |

Split by the **NY calendar date of the anchor** (`common.py:period_of`).
**Never re-cut.** Nothing after 2026-07-31 is read in this pass.

---

## 9. The pump-and-dump / delisting control (note §9)

- **In the primary, causal exclusions only:** the 10 M USDT liquidity floor
  (rule 5), the 30-day listing rule (rule 1), and the declared 4.5-hour
  tape-through-exit rule (rule 6).
- **MANDATORY SECONDARY ROW WITH A VETO — "delisted within 30 days AFTER the
  trade" excluded.** Every leg whose symbol's last bar ends `< A + 30 × 24 h`
  is removed; the row is reported for both arms, fit and holdout. **A REAL
  EDGE requires this row's holdout mean net R ≥ +0.05R, same sign.**
  **This exclusion is NOT in the primary and must never be:** it uses
  information the trader did not have, and in the primary it would be
  survivorship bias *in the other direction* — the single easiest way to
  manufacture a fake edge in this design. If the primary passes and this row
  does not, the REPORT's first paragraph says **"delisting-driven"** and the
  arm routes to Architect as suspect.
- **Mandatory descriptive rows:** share of legs on symbols delisted within
  30 / 90 days (fit, holdout); mean net R of legs with `RVOL ≥ 10` vs the
  rest; the 0.20 % cost row; the RVOL-decile dose response (§9.1); mean net R
  by liquidity quintile.
- **No primary-side exclusion of extreme RVOL** — that would be excluding the
  hypothesis. The paper's edge was in the > 3,000 % tier.

### 9.1 Dose–response, pre-committed reading

Mean net R by **decile of the ranking variable across all eligible
instrument-days, deciles cut per day**, per arm, fit and (once, with the
verdict) holdout. **Pre-committed, applied only if the arm reaches REAL
EDGE:** if the holdout mean net R of deciles 8 and 9 (the two below the top)
is **not above** the mean of deciles 1–5, the pass is labelled **"isolated
cell — suspect"** in the REPORT's first paragraph and routed to Architect
before any build ruling — the same discipline `orb-ny-open-short`
pre-committed for its width ladder. **On a kill the table is reported and
nothing is inferred from it.**

---

## 10. The verdict ladder (note §10)

**Per arm, on the holdout, mean net R per leg.**

| condition | verdict |
|---|---|
| `n_holdout < 150` legs **or** `< 150` trade-days | **UNDERPOWERED — inconclusive.** No directional claim. Return to Architect. |
| holdout mean net R `< +0.05R` **or** random-5 `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.025 < p ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| **all** of: mean net R `≥ +0.10R`; random-5 `p ≤ 0.025`; fit same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150` legs **and** `≥ 150` trade-days; 90 % day-block bootstrap interval excludes 0; **gross** expectancy `> 0`; **and** `Δ_tb` interval excludes 0; **and** the funding row `≥ +0.05R` same sign; **and** the delisting-exclusion row `≥ +0.05R` same sign | **REAL EDGE — routes to the §12 forward confirmation**, then to Architect for a build ruling. |

- **α = 0.05 / 2 = 0.025.** The family is exactly the two arms of §1.
- Every cell in §11 is a **fit-only sensitivity, never an arm**, printed in
  full whatever it shows; **none may be promoted by re-reading.** If the arm
  count turns out to be wrong, **tighten, do not loosen.**
- Nulls and intervals: random-5 (Null A, 1,000 draws, supplies `p`), Null B
  day-shift (250 draws, reported), day-block bootstrap of **anchor days** with
  replacement, 2,000 draws, 90 % interval — on each arm's mean net R and
  jointly on `Δ_tb` and `Δ_AB`. Seed 20260916.
- **Pre-registered cross-family interpretations, fixed now:** a kill here says
  nothing about the funding-rate family and does not reopen any ORB arm; a
  pass here does not reopen ORB on any instrument. A pass driven by BTC/ETH
  legs alone (share of legs and of net R on BTC/ETH is reported) is flagged
  as **suspect**. Запись 2 is not contested: the anchor here is a ranking
  time, not a filter, and the weekend row is the control.

---

## 11. Every fit-only sensitivity, by name

Stops `s ∈ {0.25, 1.0, 0.10}`; `k ∈ {3, 10}`; `RVOL ≥ 3` threshold selection
capped at 10 legs; selector B at 12 h and 48 h; the 5-minute reader `r5` with
the 5-minute `RVOL`; horizons +2 h and 16:00 NY; cost modes 0.04 % and
0.20 %; the minimum-move filter `|r30| ≥ 0.10 × dATR14`; the rank-sum combined
selector (top 5 by `rank_A + rank_B`); the signed-`TR24` direction variant;
the 50 M USDT liquidity floor; the two placebo anchors (00:00 and 04:00 UTC).
**None of these is an arm. None may become one in this pass.**

---

## 12. Forward confirmation — pre-registered now, run later (note §7.3)

Window **2026-08-01 .. 2026-10-31**, same two arms, same everything, script
**frozen at the commit that records the holdout verdicts**; run **once**, when
the 2026-10 monthly archives exist (≈ 2026-11-05), and **only** for an arm
that reached REAL EDGE. **Confirmed** iff forward mean net R `≥ +0.05R`, same
sign, random-5 `p ≤ 0.05`, on `≥ 60` trade-days and `≥ 250` legs; otherwise
**"not confirmed forward"** and the arm returns to Architect with no build.
It is a *replication* bar, not a discovery bar, which is why it is +0.05R at
0.05. `analysis.py forward` refuses to run before 2026-11-01. If the window
is short of 60 trade-days when the tape first exists, **wait; do not read
early.**

---

## 13. FIT SCREEN

An arm may read the holdout **iff**, on the fit period, **mean net R ≥ +0.05R
and random-5 `p ≤ 0.05`**. The decision is written into this section with the
fit numbers and **committed before `analysis.py holdout` is run**;
`analysis.py` checks for that commit and refuses otherwise. A screened-out arm
is **NO EDGE — KILL (fit screen)** and its holdout column stays blank. If
**both** arms are screened out, **the holdout is not computed for anything**
and the family's ledger stays at 2 registered / 0 read.

<!-- SCREEN -->

---

## 14. Stop rules — return to Architect immediately (note §11.8)

1. the BTC/ETH 1m identity check fails;
2. the paginated listing returns fewer than 800 USDT symbols;
3. `N_elig` never reaches 50 before 2021-07-01;
4. the look-ahead check fails for any eligibility rule or selector;
5. the 1d and 1m daily bars disagree beyond float tolerance on any checked day;
6. the anchor falls on any UTC time other than 13:30 or 14:30;
7. realised `n_holdout < 150` legs or trade-days on a screened-in arm (that
   arm is UNDERPOWERED; the other proceeds);
8. the pull cannot complete within the session budget — report the coverage
   reached; **do not run on a partial universe.**

---

## 15. Code map

| file | note § | role |
|---|---|---|
| `prep/listing.py` | §1.1 | paginated S3 listing, admission rule, stop rule 2 |
| `prep/fetch.py` | §8.1 | monthly-archive fetch/normalise/gap audit, adapted from `orb-utc0-crypto/prep/extend_history.py` |
| `prep/universe.py` | §8.2.1 | stage 1 — 1d archives for all 860, `results/universe.csv` |
| `prep/pull1m.py` | §8.2.1 | stage 2 — candidate symbol-months from daily rules 1/4/5, 1m pull, **BTC/ETH identity check (stop rule 1)** |
| `prep/pullfunding.py` | §6.2 | `fundingRate` archives |
| `common.py` | all | every pre-registered constant, NYSE calendar, NY DST clock, Wilder ATR, `cost_R` |
| `features.py` | §8.2.2 | the per-(symbol, anchor day) panel, all seven rules recorded separately |
| `engine.py` | §8.2.4 | `walk_many` (= `orb-ny-open:walk1m`, target ±∞), leg table for the whole eligible panel |
| `xselect.py` | §8.2.3 | ranking, top/bottom/middle-k, deciles, Null A, Null B (named `xselect` because `select` is a Python stdlib module) |
| `funding.py` | §6.2 | the funding veto row |
| `basket.py` | §5.4 | dollar-neutral, beta-hedged, portfolio risk — descriptive |
| `analysis.py` | §8.2.7, §10 | day-block bootstrap, the rows, the ladder, `fit / screen / holdout / forward` gates |
| `checks.py` | §1.3, §11.3 | look-ahead re-derivation, 1d-vs-1m agreement, DST, funding-crossing |
| `mechanic_proof.py` | §8.1 | ten hand-checked anchor days per arm |
| `results/instrument_days.parquet` | ML addendum | the direction-reader outcome **and the decision-time observables for every eligible instrument-day**, not only the selected ones (`research/_surveys/2026-09-lightgbm-role.md`) — a by-product of "evaluate the whole panel once, select afterwards", so it costs nothing |
