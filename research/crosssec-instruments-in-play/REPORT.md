# REPORT — Cross-sectional "instruments in play": RVOL and trailing-return selection on the Binance USD-M perp universe

**Package:** `research/crosssec-instruments-in-play` ·
**Pre-registration:** `ARCHITECT-NOTE.md` (2026-09-16, commit `02c1a96`) and
its mechanical restatement `DESIGN.md`, **committed at `3b40a8e` before any R
was computed on any row** ·
**Fit:** 2020-11-24 (first day with `N_elig ≥ 50`) .. 2025-07-31 ·
**Holdout 2025-08-01 .. 2026-07-31: NOT READ.**

---

## Verdicts

**Both pre-registered arms are `NO EDGE — KILL (fit screen)`.** Neither
reached the fit screen (`mean net R ≥ +0.05R` **and** random-5 `p ≤ 0.05`),
so under `DESIGN.md` §13 **the holdout was not computed for anything** — not
for the arms, not for the descriptive rows — and **this family's α ledger
stays at 2 registered / 0 read.** Nothing after 2025-07-31 informs any number
below.

| arm | fit legs | fit trade-days | fit mean net R | in dATR units | random-5 `p` | verdict |
|---|---|---|---|---|---|---|
| `RVOL-top5-s0.5` | 5,740 | 1,148 | **−0.0023R** | −0.0011 dATR | 0.000 | **NO EDGE — KILL (fit screen)** |
| `TR24-top5-s0.5` | 5,740 | 1,148 | **−0.0257R** | −0.0128 dATR | 0.321 | **NO EDGE — KILL (fit screen)** |

**The honest prior was pre-registered and it was right, and then some.**
`ARCHITECT-NOTE` §6.3 / `DESIGN.md` §1.1 worked the economics out in dATR
units before any number existed and concluded that the source paper's *top*
RVOL tier (+0.038 dATR), transplanted to crypto perps at 0.10 % round-trip
costs and the gating 0.5 × dATR14 stop, nets **≈ +0.036R — already below this
project's +0.05R kill bar** — so a pass required roughly **twice the paper's
top-tier effect**. The realised RVOL selection effect is **+0.0206R gross =
+0.010 dATR**, about **a quarter** of the paper's top tier and about **an
eighth** of what a pass needed. It is then entirely consumed by the 0.0228R
round trip. `TR24` produced no ranking signal at all.

**The substantive finding is not "nothing happened".** It is that the
selection ranks, and ranks in the predicted direction, at a magnitude one
order too small to trade:

- RVOL top-5 beats the **random-5 null** (Null A, 1,000 draws) by **+0.026R**,
  `p = 0.000` — the random-5 stream averages −0.0284R, the arm −0.0023R;
- RVOL top-5 beats **bottom-5** by `Δ_tb` = **+0.0135R**, and beats
  **middle-5** by +0.0219R;
- but the 90 % day-block interval on `Δ_tb` is **[−0.0118, +0.0387] — it
  includes 0**, so even the ranking claim is not established at this
  resolution;
- and the level, which is what a build needs, is zero.

**Slippage is not modelled, so every number here is optimistic — and a coin
in play has a thinner book than BTC.** Entry is at the signal bar's close,
also optimistic.

**One declaration about the holdout.** `build.py legs` builds the leg table
over the whole panel in one pass (that is what makes the nulls index lookups),
and its progress print reports the mean net R of **all** eligible
instrument-days by period — so a single unselected, whole-panel holdout number
(−0.0152R over 38,907 instrument-days) was on screen before the screen
decision was committed. It identifies no arm, no selection and no
sensitivity, and nothing in `DESIGN.md` was free to move in response to it;
no other holdout quantity was computed, and `results/holdout.json` was never
created. Declared rather than omitted.

### The α declaration, carried verbatim (`DESIGN.md` §1)

The holdout window 2025-08-01 .. 2026-07-31 has been registered on **22**
pre-registered ORB arms and actually **read by 11** of them (Записи 23–26), of
which **4 reads were on crypto**, plus **2 further crypto reads** by
`cmc-bot-vwap` Stage 1 (Запись 22); on BTCUSDT and ETHUSDT the year has been
judged six times. This family opened **its own** count at α = 0.05/2 = 0.025
per arm (the note's §7.2 argument), paying for it with a mandatory frozen
forward confirmation on any REAL EDGE. **Because both arms were screened out
on the fit period, no holdout read was spent: the count closes at 2
registered / 0 read**, and the forward-confirmation window 2026-08-01 ..
2026-10-31 was neither read nor needed.

---

## 1. What was built, and the two stop rules that had to pass

- **Universe, survivorship-free.** The paginated S3 listing returned **1,018**
  monthly-klines prefixes, matching the Architect's probe exactly. The
  mechanical admission rule `^[A-Z0-9]+USDT$` admits **860** symbols.
  Reconciliation with the note's "864 end in `USDT`": exactly 864 prefixes end
  in that literal string, of which **4** are Chinese-character joke tickers
  (`币安人生USDT`, `我踏马来了USDT`, `牛来USDT`, `龙虾USDT`) that the
  `[A-Z0-9]+` class excludes — **860 = 864 − 4**. No symbol was excluded by
  name. Delisted tapes are retained, as the note said: `LUNAUSDT` has 1d
  archives 2021-01 .. 2022-05 and a last daily bar of 2022-05-13.
- **Two-stage pull, complete, 0 fetch errors.** 1d archives for all 860
  (636,990 UTC daily bars, 2020-01-01 .. 2026-08-31); 1m archives for the
  **707** symbols with at least one day passing the daily-data-only
  eligibility rules (**14,078 symbol-months, 14 GB parquet**); `fundingRate`
  archives for the same 707 (**1,731,317 settlements**).
- **STOP RULE — the BTC/ETH identity check PASSES.** The freshly pulled
  `BTCUSDT` and `ETHUSDT` 1m tapes are **bit-for-bit identical** to the
  already-audited tapes over their common span 2022-08-01 .. 2026-07-31:
  **2,103,840 minutes each**, same row count, same timestamp sequence, and
  every one of `open/high/low/close/volume` equal. The new N-symbol puller is
  therefore the same object as the audited one.
- **Every other check passes** (`results/checks.json`): the look-ahead
  re-derivation of rules 1–5, 7, `V30`, `RVOL`, `TR24`, `r30`, `dATR14` and
  the liquidity median from tapes **truncated at `A + 30 min`** on 50 random
  (symbol, day) pairs — **0 mismatches**; 1d bars equal the aggregate of that
  day's 1m bars on 30 random (symbol, UTC day) pairs — **0 mismatches**; the
  anchor falls on **13:30 or 14:30 UTC and no other UTC time**, ever; the
  nominal position window of **every** leg contains the 16:00 UTC funding
  settlement; and the delisting exclusion is demonstrably **not** in the
  primary (see §5).
  *Two checks were re-scoped after first failing — check 4 to the nominal
  position window (3.78 % of legs stop out before 16:00 UTC; 100 % of those
  are stop exits, and a closed position owes no funding) and check 6 to
  eligible rows (a non-eligible row has no window and its clipped indices
  degenerate). Both then pass on every leg. Neither re-scoping changed a
  number.*
- **The panel.** 406,042 (symbol, anchor day) rows; **215,084 eligible
  instrument-days**; 206,820 of them become legs (3,154 dropped for
  `r30 == 0`, **0** dropped for a path missing more than 30 minutes).

### `N_elig` over time, and where the fit really starts

**First tradable day (`N_elig ≥ 50`): `2020-11-24`.** 1,397 of 1,641 NYSE
full days in 2020-01-01 .. 2026-07-31 are tradable; the 244 lost days are all
in 2020, when the venue simply did not have 50 symbols above the 10 M USDT
liquidity floor.

| year | NYSE full days | tradable | `N_elig` min | median | max |
|---|---|---|---|---|---|
| 2020 | 251 | 8 | 50 | 55 | 57 |
| 2021 | 251 | 250 | 51 | 111 | 132 |
| 2022 | 250 | 250 | 86 | 132 | 140 |
| 2023 | 248 | 248 | 81 | 137 | 210 |
| 2024 | 249 | 249 | 134 | 183 | 303 |
| 2025 | 247 | 247 | 125 | 195 | 254 |
| 2026 (to 07-31) | 145 | 145 | 115 | 138 | 155 |

The note projected `N_elig` above 200 from 2022 and 300–400 across the
holdout. **Realised is lower** — median 132–195 from 2022, not 300–400 —
because the 10 M USDT median-daily-quote-volume floor binds harder than the
note assumed. It is nowhere near the 50-symbol threshold, so stop rule 3 did
not fire and a top-5 selection is still a top 2.5–4 % of the cross-section.
Recorded in `DESIGN.md` §2.3 **before any R**.

**Arm B's eligible set turned out to equal arm A's exactly** (215,084 both).
Rule 7 (a 1m close exists at `A − 24 h`) fails 121,606 times across the whole
panel but **never** on a row that already passes rules 1–6: the same missing
tape that would break rule 7 has already broken rule 2 or 3. So the two arms
ranked the identical set every day, which makes the A-vs-B comparison clean.

### Eligibility rule failures across the 406,042 panel rows

| rule | failures | |
|---|---|---|
| 1 listed ≥ 30 days | 12,752 | causal |
| 2 all 30 anchor-window bars present | 120,651 | causal |
| 3 RVOL denominator on ≥ 10 of 14 prior anchor days | 127,554 | causal |
| 4 `dATR14` defined | 6,332 | causal |
| 5 median daily quote volume ≥ 10 M USDT | 184,625 | causal — **the binding rule** |
| 6 tape runs through the exit | 24 | **declared non-causal** |
| 7 `P(A − 24 h)` exists (arm B only) | 121,606 | causal |

Rule 6 is the only non-causal element in the primary and it excludes **24**
panel rows in total — it removes instrument-days that could not be evaluated,
not ones that lost.

---

## 2. The two arms and their nulls, fit period

Mean net R per leg. `dATR` column = `netR × 0.5`, so it can be compared with
the paper's tiers without the stop in the way (the paper's top tier is
+0.038 dATR).

### `RVOL-top5-s0.5` — 1,148 trade-days, median `N_elig` 134

| row | legs | mean net R | dATR | gross R | cost R | hit | 90 % day-block interval |
|---|---|---|---|---|---|---|---|
| **PRIMARY (top 5 by RVOL)** | 5,740 | **−0.0023** | −0.0011 | +0.0206 | 0.0228 | 0.444 | [−0.0270, +0.0223] |
| bottom-5 (deterministic null) | 5,740 | −0.0158 | −0.0079 | +0.0042 | 0.0200 | 0.470 | [−0.0328, +0.0015] |
| middle-5 (descriptive) | 5,740 | −0.0242 | −0.0121 | −0.0000 | 0.0241 | 0.463 | [−0.0448, −0.0027] |
| **Null A — random-5, 1,000 draws** | — | −0.0284 (sd 0.0064, q95 −0.0177) | −0.0142 | | | | **`p` = 0.000** |
| Null B — selection day-shift, 250 draws | — | −0.0258 | −0.0129 | | | | `p` = 0.000 |
| `Δ_tb` = top-5 − bottom-5 | — | **+0.0135** | +0.0068 | | | | **[−0.0118, +0.0387] — includes 0** |
| **VETO row — funding applied** | 5,740 | −0.0009 | −0.0005 | | | | [−0.0255, +0.0240] |
| **VETO row — delisted-within-30d excluded** | 5,719 | −0.0030 | −0.0015 | +0.0198 | 0.0229 | 0.443 | [−0.0278, +0.0221] |

### `TR24-top5-s0.5` — 1,148 trade-days, median `N_elig` 134

| row | legs | mean net R | dATR | gross R | cost R | hit | 90 % day-block interval |
|---|---|---|---|---|---|---|---|
| **PRIMARY (top 5 by \|TR24\|)** | 5,740 | **−0.0257** | −0.0128 | −0.0059 | 0.0198 | 0.450 | [−0.0489, −0.0027] |
| bottom-5 (deterministic null) | 5,740 | −0.0357 | −0.0178 | −0.0025 | 0.0332 | 0.453 | [−0.0570, −0.0131] |
| middle-5 (descriptive) | 5,740 | −0.0354 | −0.0177 | −0.0124 | 0.0230 | 0.462 | [−0.0566, −0.0142] |
| **Null A — random-5, 1,000 draws** | — | −0.0284 (sd 0.0061, q95 −0.0182) | −0.0142 | | | | **`p` = 0.321** |
| Null B — selection day-shift, 250 draws | — | −0.0236 | −0.0118 | | | | `p` = 0.596 |
| `Δ_tb` = top-5 − bottom-5 | — | +0.0100 | +0.0050 | | | | [−0.0162, +0.0361] — includes 0 |
| **VETO row — funding applied** | 5,740 | −0.0239 | −0.0120 | | | | [−0.0473, −0.0009] |
| **VETO row — delisted-within-30d excluded** | 5,724 | −0.0260 | −0.0130 | −0.0061 | 0.0198 | 0.450 | [−0.0490, −0.0028] |

**Reading.** Arm A's `p` of 0.000 is not a pass; it is the statement that
top-5-by-RVOL is reliably *less bad* than a random 5, by about +0.026R. The
level is zero and the screen needs +0.05R. Arm B's `p` of 0.321 says
`|TR24|` does not rank at all — its top-5, bottom-5 and middle-5 are all
inside a whisker of the random-5 mean.

Whole-panel baseline, for scale: the direction reader applied to **every**
eligible instrument-day (206,820 legs) averages **−0.0238R** on the fit
period. So the reader itself loses roughly its cost; the RVOL ranking
recovers about +0.021R of that, and nothing recovers more.

### Funding and the two veto rows

Funding is small and, on the crowded side, slightly *favourable* here: mean
**+0.0014R** for arm A and +0.0018R for arm B (0.87–0.89 settlements crossed
per leg; the 14.0 % / 11.6 % of legs with a missing rate are treated as 0 and
counted). Neither veto row rescues or damages anything, because there is
nothing at that level to rescue: both stay within 0.001R of their primary.
The delisting-exclusion row removes only **21** and **16** legs (0.37 % /
0.28 %) — see §5.

---

## 3. Dose–response by decile of the ranking variable (§9.1)

Deciles cut **per day** over **all** eligible instrument-days, decile 9 = top.
No inference is drawn from this table: `DESIGN.md` §9.1's pre-committed
reading applies only to an arm that reached REAL EDGE, and neither did.

| decile | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 (top) |
|---|---|---|---|---|---|---|---|---|---|---|
| RVOL, mean net R | −0.0147 | −0.0265 | −0.0249 | −0.0234 | −0.0238 | −0.0201 | −0.0252 | −0.0227 | −0.0356 | −0.0210 |
| \|TR24\|, mean net R | −0.0261 | −0.0254 | −0.0286 | −0.0177 | −0.0324 | −0.0243 | −0.0170 | −0.0242 | −0.0227 | −0.0199 |

There is no monotone dose–response in either variable across the full
cross-section. The whole RVOL effect lives in the extreme right tail that the
top-5 selection picks out (top 5 of ~134 ≈ the top 3.7 %, which the top
decile of 13–14 names dilutes away), and the top decile is indistinguishable
from the rest. Consistent with the top-5 vs random-5 gap being real and small.

---

## 4. Every fit-only sensitivity actually run (`results/sensitivities_fit.csv`)

**None of these is an arm and none may become one.** They are printed in full,
including the ones that came out worse. Nothing here reaches +0.05R.

| sensitivity | arm A mean net R | arm B mean net R |
|---|---|---|
| **gating cell (k = 5, s = 0.5, +4 h, 0.10 %)** | **−0.0023** | **−0.0257** |
| k = 3 | −0.0084 | −0.0177 |
| k = 10 | −0.0158 | −0.0216 |
| `RVOL ≥ 3`, capped at 10 legs | −0.0189 | — |
| min-move filter `\|r30\| ≥ 0.10 × dATR14` | −0.0015 | −0.0323 |
| liquidity floor 50 M USDT | −0.0023 | −0.0062 |
| stop 0.25 × dATR14 | −0.0092 | −0.0424 |
| stop 1.0 × dATR14 | −0.0038 | −0.0135 |
| **stop 0.10 × dATR14 (the paper's own stop)** | **−0.0777** | −0.1015 |
| horizon +2 h | −0.0237 | −0.0344 |
| horizon 16:00 NY (+6 h) | **+0.0058** | −0.0186 |
| cost 0.04 % (maker) | **+0.0114** | −0.0138 |
| cost 0.20 % (thin book + slippage) | −0.0251 | −0.0455 |
| direction = sign(TR24) instead of the reader | −0.0349 | −0.0091 |
| 5-minute reader with 5-minute RVOL (the paper's own construction) | −0.0113 | −0.0333 |
| selector B at 12 h | — | −0.0140 |
| selector B at 48 h | — | −0.0301 |
| rank-sum combined selector (A + B ranks) | −0.0122 (single row) | |
| **placebo anchor 00:00 UTC** | −0.0645 | −0.0623 |
| **placebo anchor 04:00 UTC** | −0.0369 | −0.0357 |

Two cells are positive: arm A at the 16:00 NY horizon (+0.0058R) and arm A at
maker fees (+0.0114R). Both are an order below the +0.05R kill bar, and the
second is not a tradable configuration — a taker-entry mechanic does not pay
maker fees on either side.

**The paper's own stop is the worst cell in the grid** (−0.078R / −0.102R at
`s = 0.10`), exactly as §6.3 projected: a 0.10 × dATR stop costs 0.2–0.4R per
round trip and the stop-hit rate goes to 80 %. The dATR-unit column shows
why the level is unmoved by the stop: arm A is −0.0078 dATR at `s = 0.10`,
−0.0023 dATR at 0.25, −0.0011 at 0.5 and −0.0038 at 1.0 — the mechanic has
no expectancy at any stop width, and rescaling R cannot manufacture one.

**The anchor is doing something, and it is not enough.** Both placebo anchors
are far *below* the 09:30 NY arm (−0.065 and −0.037 vs −0.002), so the
pre-registered reading "if the 04:00 placebo is at or above the 09:30 NY arm
the anchor is not doing anything" does **not** fire: the US cash open is a
genuinely better ranking time than 00:00 or 04:00 UTC. It is simply not a
profitable one.

---

## 5. The pump-and-dump / delisting control (§9) — and the one thing that had to stay out

**The non-causal "delisted within 30 days AFTER the trade" exclusion is NOT in
the primary, and `checks.py` check 5 asserts it positively rather than by
assertion in prose:** the primary leg table contains **215** legs on symbols
that delisted within 30 days of the trade (0.10 % of the 206,820
instrument-days). Had the exclusion leaked into the primary those legs would
be absent, so their presence is the proof. In the primary it would be
survivorship bias in the *other* direction — the easiest way to manufacture a
fake edge in this design. It is reported as a mandatory secondary row with a
veto (§2), and it moves arm A by −0.0007R and arm B by −0.0003R.

| descriptive row | arm A | arm B |
|---|---|---|
| share of selected legs on symbols delisted within 30 days | 0.37 % | 0.28 % |
| share within 90 days | 0.77 % | 0.63 % |
| mean net R, legs with `RVOL ≥ 10` (n = 2,146) | **+0.0068** | — |
| mean net R, the remaining legs | −0.0077 | — |
| mean net R by liquidity quintile (Q1 thinnest → Q5) | +0.0040 / +0.0075 / −0.0058 / −0.0082 / −0.0090 | −0.0476 / −0.0494 / −0.0129 / −0.0011 / −0.0176 |
| BTC/ETH share of legs | 0.12 % | 0.05 % |
| BTC/ETH mean net R (n = 7 / 3) | +0.508 | +0.316 |

**The pass was never at risk of being pump-and-dump-driven, because there was
no pass** — but for the record the concern points the *opposite* way to the
result: the extreme-attention legs (`RVOL ≥ 10`) are the *best* subset of arm
A (+0.0068R vs −0.0077R), the thinnest liquidity quintiles are the best
quintiles, and delisting-bound legs are 0.4 % of the sample. The BTC/ETH
concentration flag is moot at 0.12 % of legs (7 legs in 5,740; their +0.51R
mean is 7 observations and is reported only because §10 required it).

---

## 6. The pre-registered A-vs-B comparison (descriptive, no verdict)

Read on the **fit** period only — the holdout was not computed for anything.

| quantity | value |
|---|---|
| `Δ_AB` = mean net R (A) − mean net R (B) | **+0.0234**, 90 % interval **[+0.0040, +0.0429]** |
| pre-committed wording | **"selector A dominates B"** (`Δ_AB > 0` and the interval excludes 0) |
| mean per-day Jaccard overlap of the two selected sets | 0.271 |
| share of arm A's legs also selected by arm B | 39.5 % |
| mean net R, legs in **A only** | −0.0029 |
| mean net R, legs in **B only** | −0.0416 |
| mean net R, legs in **both** | −0.0014 |
| mean daily Spearman rank correlation of `RVOL` and `\|TR24\|` | +0.199 |

The two selectors overlap about a quarter of the time and the overlap is the
better half of both. **This wording informs a build ruling only; it neither
creates nor rescues a verdict**, and there is no build ruling to inform.
Relative volume is the better of the two crypto "in play" proxies, on a
family where neither is tradable.

---

## 7. Descriptive control rows (no verdict words)

### Weekend row (§4.3) — RVOL denominator over the prior 14 **calendar** days

| row | legs | days | mean net R | dATR | gross R | 90 % interval |
|---|---|---|---|---|---|---|
| `RVOL-top5-s0.5`, Saturdays and Sundays | 2,400 | 480 | **+0.0164** | +0.0082 | +0.0393 | [−0.0236, +0.0554] |
| `TR24-top5-s0.5`, Saturdays and Sundays | 2,400 | 480 | +0.0031 | +0.0015 | +0.0232 | [−0.0314, +0.0369] |
| `RVOL-top5-s0.5`, weekdays off the same all-calendar panel | 6,015 | 1,203 | +0.0026 | +0.0013 | +0.0257 | [−0.0225, +0.0266] |
| `TR24-top5-s0.5`, weekdays off the same all-calendar panel | 6,015 | 1,203 | −0.0270 | −0.0135 | −0.0072 | [−0.0488, −0.0063] |

**The weekend row sits above the weekday arm for RVOL (+0.0164 vs −0.0023).**
The pre-registered reading ("the clock, not the open") is conditioned on an
arm reaching REAL EDGE and so does not fire, but it is reported plainly
because it points the same way: whatever small ranking effect RVOL has, it is
not specific to the US cash open. Both weekend intervals include 0 on 480
days, and both are below the kill bar.

### §6.4 baskets — descriptive, no verdict, not pre-registered as arms

**(a) Dollar-neutral signed-`TR24` basket** (long top 5, short bottom 5 by
signed `TR24`, equal notional, **no per-leg stop**, 0.10 % per leg), 1,148
days: mean **−2.18 bp** of gross notional per day (gross of costs +7.82 bp),
sd 150.7 bp, mean return in units of its own trailing-60-day sd −0.0096,
**annualised Sharpe −0.23**. By year: +4.2 / −11.6 / +9.5 / −6.7 / +8.9 /
−17.8 bp (2020 partial, 8 days; 2025 to 07-31). The backlog entry's original
construction is a coin flip that pays 10 round trips a day.

**(b) Beta-hedged rows** (every leg paired with an opposite-side `BTCUSDT`
leg of equal notional, same minutes, its own 0.10 %): arm A goes from
−0.0023R to **−0.0328R**, arm B from −0.0257R to −0.0481R. The hedge costs
more than the beta it removes; there was no crypto-beta component to strip.

**(c) Portfolio risk** (what "one account, 5 legs, netted" means):

| | arm A | arm B |
|---|---|---|
| mean day sum of 5 leg net R | −0.011R | −0.128R |
| sd of the day sum | 2.54R | 2.30R |
| worst day / best day | −5.15R / +15.19R | −5.19R / +13.69R |
| 5th percentile day | −3.55R | −3.55R |
| worst 20-day run | −41.0R | −35.6R |
| mean pairwise correlation of same-day leg outcomes | **+0.065** | +0.092 |

The leg correlation is low — 0.065, well under the ρ ≈ 0.3 the note assumed
for its power projection — so five legs a day are closer to five independent
observations than feared. That makes the fit-period `n` of 5,740 legs an
honest sample and the kill correspondingly well-powered: the 90 % interval on
arm A's mean is ±0.025R, which excludes +0.05R comfortably. Exit mix across
all instrument-days: 186,800 time exits, 20,020 stops (9.7 %).

---

## 8. Power, and what a kill here is worth

Realised fit sample: **1,148 trade-days × 5 legs = 5,740 legs per arm**, with
a same-day leg correlation of 0.065. The 90 % day-block interval on arm A's
fit mean is [−0.0270, +0.0223] — a width of 0.049R, so **the fit period alone
could resolve a true +0.05R effect** and did not find one. Projected holdout
sample, had either arm been screened in: ~250 trade-days × 5 ≈ 1,250 legs,
comfortably above both §10 floors (150 legs, 150 trade-days) — the kill is
not a power failure. Stop rule 7 never became relevant.

## 9. Pre-registered cross-family interpretations (§10, fixed in advance)

- This kill **says nothing about the funding-rate family** (different input,
  per-asset engine) and **does not reopen any ORB arm**.
- It does **not** contest Запись 2: the anchor here is a ranking time, not a
  filter, and the weekend row was the control.
- It closes the *specific* claim that a plain opening-move reader applied to
  the top of a crypto RVOL or trailing-return cross-section is tradable at
  0.10 % costs on a 4-hour horizon. It does **not** close cross-sectional work
  in general — see `HANDOFF.md`, which separates what is dead from what this
  pass has now made cheap.

## 10. Artefacts

| path | contents |
|---|---|
| `DESIGN.md` | the pre-registration; §2.3 `N_elig` filled before any R (commit `3b40a8e`), §13 the committed screen decision (commit `de6f246`) |
| `MECHANIC-PROOF.md` | ten hand-checked anchor days per arm: full top-10/bottom-10 ranking with inputs, then the 5 legs with reader, stop, exit minute, cause, `cost_R`, `netR` |
| `results/universe.csv` | all 860 admitted symbols with first/last archive month and bar |
| `results/listing.json` | the raw 1,018 prefixes, admitted and rejected |
| `results/n_elig.csv` | the `N_elig` series, per day, both selectors, with the tradable flag |
| `results/history_audit_1d.json`, `results/history_audit_1m.json` | the pull audits and the BTC/ETH identity check |
| `results/checks.json` | all seven checks with their counts |
| `results/fit.json`, `results/screen.json`, `results/sensitivities_fit.csv`, `results/descriptive_fit.json` | every number in this report |
| `results/instrument_days.parquet` | **the ML addendum** — 206,820 rows, the direction-reader outcome **and** the decision-time observables for every eligible instrument-day, not only the selected ones (see `HANDOFF.md` §3) |

`results/holdout.json` **does not exist**, and that is the point.
