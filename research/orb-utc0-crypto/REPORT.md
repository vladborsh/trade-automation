# REPORT — `orb-utc0-crypto`: the opening range at the 00:00 UTC crypto reset

**Date:** 2026-09-16 · **Pre-registration:** `DESIGN.md` (commit `1f2a3c9`),
restating `research/orb-ny-open/ARCHITECT-NOTE-CRYPTO-INVESTIGATION.md`
(`eaacce2`) · **Screen decision:** `DESIGN.md` §13.1 (commit `915dbd0`)

**Holdout re-use declaration, first, as `DESIGN.md` §9.2 requires.** This
family was registered as the **third** pre-registered look at the
2025-08-01 .. 2026-07-31 year on the crypto tapes — Запись 22's crypto arms
and Запись 23's crypto arms read it already — and α was set at
0.05 / 16 = 0.003125 to correct for every pre-registered arm judged on that
holdout. **In the event, neither arm reached the holdout.** Both were
screened out on the fit period, so **the 2025-08 .. 2026-07 holdout was
never computed, never read, and not spent** by this pass. See §6 for the
consequence for the next registration's α.

**Cost caveat, registered in `DESIGN.md` §5 and carried here verbatim:**
*slippage is not modelled; in this window the book is thinner than in US
hours, so every number here is more optimistic than the closed pass's.*

---

## 1. Verdicts — the two registered arms

| arm | screen status | verdict | `n_fit` | fit mean net R (t1) | fit gross R | fit `cost_R` | fit Null-A `p` | **fit weekday Mon–Fri** | **fit weekend Sat–Sun** | holdout `n` | holdout mean net R | `p_A` | `p_B` | 90 % bootstrap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **`BTCUSDT-5m`** | **SCREENED OUT** | **NO EDGE — KILL (fit screen)** | 1,885 | **−0.2330R** | −0.0319R | 0.2011R | 0.899 | **−0.2003R** (n = 1,354) | **−0.3162R** (n = 531) | *never computed* | — | — | — | — |
| **`ETHUSDT-5m`** | **SCREENED OUT** | **NO EDGE — KILL (fit screen)** | 1,901 | **−0.1519R** | −0.0074R | 0.1444R | 0.670 | **−0.1102R** (n = 1,353) | **−0.2548R** (n = 548) | *never computed* | — | — | — | — |

The screen (`DESIGN.md` §7.4) required, on the fit period alone, template-1
mean net R ≥ +0.05R **and** fit-period Null-A `p` ≤ 0.05. Both arms fail
**both** limbs, and not narrowly: the mean is negative rather than small, and
Null A puts the **matched-time placebo above the real breakout** on both arms
(`p` = 0.899 and 0.670 — 90 % and 67 % of 1,000 placebo draws did better than
the actual trigger). The blank holdout columns are not an omission; they are
the pre-registered consequence.

**Template 2 (pure ORB, no target), fit period, no verdict word:**
`BTCUSDT-5m` −0.2609R · `ETHUSDT-5m` −0.1776R.

---

## 2. The falsification controls — read first, as `DESIGN.md` §8 requires

### 2.1 Weekday vs weekend — the crux (§8.1)

This is the control the family exists for: a genuinely **crypto-native** reset
must work on Saturdays, because none of the three events that coincide at
00:00 UTC — the daily-candle boundary, the perpetual funding settlement, the
Tokyo cash open — needs a Western cash market to be open, and two of the three
happen on weekends too.

| arm | half | `n` | mean net R (t1) | mean gross R | mean `cost_R` | win rate | median forward lift | median hold |
|---|---|---|---|---|---|---|---|---|
| `BTCUSDT-5m` | weekday Mon–Fri UTC | 1,354 | −0.2003R | −0.0243R | 0.1760R | 47.4 % | 0.976 | 94.5 min |
| `BTCUSDT-5m` | **weekend Sat–Sun UTC** | 531 | **−0.3162R** | −0.0512R | 0.2650R | 44.8 % | 0.980 | 114 min |
| `ETHUSDT-5m` | weekday Mon–Fri UTC | 1,353 | −0.1102R | +0.0207R | 0.1309R | 50.0 % | 1.095 | 92 min |
| `ETHUSDT-5m` | **weekend Sat–Sun UTC** | 548 | **−0.2548R** | −0.0769R | 0.1779R | 44.0 % | 1.019 | 111.5 min |

**The pre-registered reading, applied as written.** `DESIGN.md` §8.1 fixed two
branches before any number existed. The branch that fired is the second one:
**if the arm is killed, the split is reported and nothing is inferred from
it.** Both arms are killed, so this table carries **no inference** about the
anchor's nature, and the sentence *"the Tokyo open, not the reset"* is **not**
said — it was reserved for an arm that reached REAL EDGE, and neither did.

What can be stated as description, without inference: **the weekend half is
worse than the weekday half on both arms, gross as well as net** (BTC
−0.051R vs −0.024R gross; ETH −0.077R vs +0.021R gross), so the direction of
the difference is not a cost artefact alone, and the effect the hypothesis
predicted on weekends is **absent, not merely weaker**. This is the same
direction the closed pass's crypto weekend rows showed at the NY anchor
(§4) — the mechanic remains sensitive to whether the range-forming window
contains real activity, and 00:00–00:30 UTC on a Saturday does not supply it.

**These are fit-period halves.** There are no holdout halves, because the
holdout was never read.

### 2.2 Tokyo-holiday row (§8.2, descriptive)

UTC weekdays on which the Tokyo Stock Exchange is closed (JPX calendar,
`common.py:JPX_HOLIDAYS`), fit and holdout-eligible days pooled as
pre-registered, beside the complementary JPX-trading weekday row. Descriptive
only; no verdict.

| arm | row | `n` | mean net R (t1) | mean gross R | win rate |
|---|---|---|---|---|---|
| `BTCUSDT-5m` | Tokyo **closed** (JPX holiday, UTC weekday) | 104 | −0.2010R | −0.0159R | 47.1 % |
| `BTCUSDT-5m` | Tokyo **open** (JPX trading, UTC weekday) | 1,497 | −0.2076R | −0.0244R | 47.6 % |
| `ETHUSDT-5m` | Tokyo **closed** | 104 | −0.1289R | +0.0078R | 49.0 % |
| `ETHUSDT-5m` | Tokyo **open** | 1,497 | −0.1352R | −0.0003R | 48.8 % |

The two rows are indistinguishable on both arms (differences of 0.006R on
~100 vs ~1,500 trades). Corroboration only, and it corroborates nothing in
either direction: at this anchor there is no effect on JPX trading days for
the JPX holidays to be missing.

### 2.3 Placebo anchors — fit only, holdout column blank by design (§8.3)

The identical mechanic through the identical code path, at three other UTC
clock points. **Fit period only. Never the holdout. No verdict. Gates
nothing.** The blank column is the point.

| anchor | what is there | arm | `n` | **fit** mean net R (t1) | fit gross R | fit `cost_R` | **holdout** |
|---|---|---|---|---|---|---|---|
| **00:00 UTC** *(the registered arm)* | candle reset + funding + Tokyo open | `BTCUSDT-5m` | 1,885 | −0.2330R | −0.0319R | 0.2011R | *never computed* |
| **00:00 UTC** *(the registered arm)* | " | `ETHUSDT-5m` | 1,901 | −0.1519R | −0.0074R | 0.1444R | *never computed* |
| 08:00 UTC | funding + Deribit settlement/expiry + London open | `BTCUSDT-5m` | 1,900 | −0.2906R | −0.0450R | 0.2455R | — |
| 08:00 UTC | " | `ETHUSDT-5m` | 1,886 | −0.1653R | +0.0116R | 0.1769R | — |
| 16:00 UTC | funding only | `BTCUSDT-5m` | 1,845 | −0.1833R | −0.0095R | 0.1738R | — |
| 16:00 UTC | " | `ETHUSDT-5m` | 1,828 | −0.1150R | +0.0149R | 0.1299R | — |
| **04:00 UTC** | **nothing — the pure placebo** | `BTCUSDT-5m` | 1,922 | −0.3405R | −0.0512R | 0.2893R | — |
| **04:00 UTC** | **nothing — the pure placebo** | `ETHUSDT-5m` | 1,929 | −0.2312R | −0.0174R | 0.2138R | — |

**Pre-registered readings, applied as written.**

- **"Any clock, not the reset" — does NOT fire.** The reading required the
  04:00 UTC placebo to be *as good as or better than* the 00:00 arm on the fit
  period. It is **worse** on both instruments (−0.341R vs −0.233R on BTC;
  −0.231R vs −0.152R on ETH). So the registered anchor is not merely
  indistinguishable from a no-story clock point — but this is a comparison
  between two negative numbers, and it buys the hypothesis nothing.
- **08:00 UTC does NOT look better than 00:00.** The honest competitor is
  worse on BTC (−0.291R vs −0.233R) and marginally worse on ETH (−0.165R vs
  −0.152R). Per §8.3 there is therefore **no note for a future registration**
  at 08:00, and it is not promoted now that the family is killed.
- **What the row ordering actually tracks is cost, not story.** Across all
  four anchors and both instruments, the ranking of net R is the inverse
  ranking of `cost_R` almost exactly (16:00 cheapest → least bad; 04:00 dearest
  → worst), and every gross number sits within ±0.05R of zero. The anchors are
  not telling different stories; they are all telling the same one — no
  directional edge — at different prices.

---

## 3. The registered arms in full

### 3.1 Fit-period description (template 1 gates; template 2 carries no verdict)

| arm | template | `n` | mean net R | median net R | mean gross R | mean `cost_R` | median `cost_R` | win rate | % long | median `stop_atr` | median hold |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `BTCUSDT-5m` | 1 | 1,885 | −0.2330R | −0.2579R | −0.0319R | 0.2011R | 0.1623R | 46.7 % | 48.2 % | 3.12 | 99 min |
| `BTCUSDT-5m` | 2 | 1,885 | −0.2609R | −1.0649R | −0.0599R | 0.2011R | 0.1623R | 31.0 % | 48.2 % | 3.12 | 99 min |
| `ETHUSDT-5m` | 1 | 1,901 | −0.1519R | −0.1171R | −0.0074R | 0.1444R | 0.1121R | 48.2 % | 49.1 % | 3.20 | 100 min |
| `ETHUSDT-5m` | 2 | 1,901 | −0.1776R | −1.0336R | −0.0332R | 0.1444R | 0.1121R | 34.4 % | 49.1 % | 3.20 | 100 min |

**Tail row (2026-08-01 .. 2026-09-11, descriptive, no verdict):**
`BTCUSDT-5m` n = 39, −0.3566R · `ETHUSDT-5m` n = 42, −0.3070R.

### 3.2 Exit causes, fit period

| arm | t1 target | t1 stop | t1 time-exit | t2 stop | t2 time-exit |
|---|---|---|---|---|---|
| `BTCUSDT-5m` | 778 | 823 | 284 | 1,017 | 868 |
| `ETHUSDT-5m` | 801 | 803 | 297 | 978 | 923 |

### 3.3 By side, fit period

| arm | side | `n` | mean net R | mean gross R | win rate |
|---|---|---|---|---|---|
| `BTCUSDT-5m` | long | 909 | −0.2641R | −0.0664R | 44.9 % |
| `BTCUSDT-5m` | short | 976 | −0.2040R | +0.0002R | 48.4 % |
| `ETHUSDT-5m` | long | 934 | −0.1741R | −0.0302R | 47.1 % |
| `ETHUSDT-5m` | short | 967 | −0.1304R | +0.0145R | 49.3 % |

### 3.4 Non-circular forward lift, fit period — the closed pass's one positive signal, gone

| arm | half | `n` | median lift | % ≥ 1 |
|---|---|---|---|---|
| `BTCUSDT-5m` | all | 1,885 | **0.978** | 49.2 % |
| `BTCUSDT-5m` | weekday | 1,354 | 0.976 | 49.3 % |
| `BTCUSDT-5m` | weekend | 531 | 0.980 | 48.8 % |
| `ETHUSDT-5m` | all | 1,901 | **1.073** | 52.9 % |
| `ETHUSDT-5m` | weekday | 1,353 | 1.095 | 53.9 % |
| `ETHUSDT-5m` | weekend | 548 | 1.019 | 50.5 % |

This is the sharpest negative result in the pass and it is worth stating
plainly. The closed `orb-ny-open` pass's **only** positive finding was that
median forward lift exceeded 1.00 on **all eight** arms (1.035–1.234 on fit;
1.162 and 1.227 on the two crypto 5m arms): after a close beyond the range,
the tape moved further in the breakout direction than a comparable random bar
did. **At the 00:00 UTC anchor that is not true on BTC** (0.978 — below 1) and
it is much weaker on ETH (1.073 vs 1.162 at the NY anchor). The UTC-midnight
range breakout does not even *select direction*, let alone convert it. That
removes the one reason the mechanic was not simply dead at the NY anchor.

### 3.5 Era rows — fit-side, descriptive, no verdict (§7.5)

| arm | cut | era | `n` | mean net R | mean gross R |
|---|---|---|---|---|---|
| `BTCUSDT-5m` | 2021-11 break | pre-2021-11 | 595 | −0.1058R | +0.0210R |
| `BTCUSDT-5m` | 2021-11 break | from-2021-11 | 1,290 | −0.2916R | −0.0563R |
| `BTCUSDT-5m` | ETF launch | pre-2024-01 | 1,338 | −0.1831R | +0.0057R |
| `BTCUSDT-5m` | ETF launch | from-2024-01 | 547 | −0.3550R | −0.1240R |
| `ETHUSDT-5m` | 2021-11 break | pre-2021-11 | 610 | −0.0174R | +0.0666R |
| `ETHUSDT-5m` | 2021-11 break | from-2021-11 | 1,291 | −0.2154R | −0.0424R |
| `ETHUSDT-5m` | ETF launch | pre-2024-01 | 1,358 | −0.1169R | +0.0223R |
| `ETHUSDT-5m` | ETF launch | from-2024-01 | 543 | −0.2393R | −0.0817R |

§7.5's pre-registered reading applies only to a passing arm; both arms are
killed, so **nothing is inferred** from these rows. Descriptively, the
2020–2021 era is the least bad on both arms and the from-2024 era the worst —
the *opposite* of what an ETF-flow story would need, and consistent with the
periodicity literature's finding that the structural break is late 2021 and
not January 2024. That observation is a description of a dead arm, not
evidence for anything.

### 3.6 Width sensitivities S1/S2 — fit only, non-gating (§8.4)

| arm | OR width | `n` | mean net R (t1) | mean net R (t2) | mean gross R | mean `cost_R` | win rate |
|---|---|---|---|---|---|---|---|
| `BTCUSDT-5m` | 15 min (S1) | 2,001 | −0.3098R | −0.3362R | −0.0393R | 0.2705R | 46.2 % |
| `BTCUSDT-5m` | **30 min (registered)** | 1,885 | −0.2330R | −0.2609R | −0.0319R | 0.2011R | 46.7 % |
| `BTCUSDT-5m` | 60 min (S2) | 1,641 | −0.1347R | −0.1170R | +0.0154R | 0.1501R | 46.5 % |
| `ETHUSDT-5m` | 15 min (S1) | 1,988 | −0.2164R | −0.2484R | −0.0135R | 0.2029R | 48.4 % |
| `ETHUSDT-5m` | **30 min (registered)** | 1,901 | −0.1519R | −0.1776R | −0.0074R | 0.1444R | 48.2 % |
| `ETHUSDT-5m` | 60 min (S2) | 1,639 | −0.0954R | −0.0878R | +0.0145R | 0.1099R | 47.6 % |

Reported including the rows that came out worse, per `DESIGN.md` §11. The
monotone ordering 15 → 30 → 60 is again **cost**: a wider range is a wider
stop, a wider stop is a smaller `cost_R`, and gross stays inside ±0.02R at
every width. Same shape as the closed pass's S1 on crypto (crypto got worse at
15 minutes). Nothing here is a hidden edge at 60 minutes: +0.015R gross, and
the pre-registered width is 30.

### 3.7 Cost sensitivities, fit period (non-gating, §5)

| arm | gross | **0.10 % round trip (primary)** | 0.04 % (maker) | 0.20 % (2×, thin-book) | mean `cost_R` |
|---|---|---|---|---|---|
| `BTCUSDT-5m` | −0.0319R | **−0.2330R** | −0.1123R | −0.4340R | 0.2011R |
| `ETHUSDT-5m` | −0.0074R | **−0.1519R** | −0.0652R | −0.2963R | 0.1444R |

**Even at the maker fee both arms are negative, and both are negative
gross.** There is no cost assumption under which this mechanic is positive at
this anchor: the edge is absent, not eaten. The 0.20 % row exists because the
00:30–02:30 UTC book is thinner than the US-hours book, and it shows how much
a realistic thin-book fill would cost if there *were* an edge — twice the
primary drag.

### 3.8 Eligibility and coverage

| arm | period | calendar days | eligible | excluded (incomplete OR) | excluded (no session) | triggered | trigger share | projected `n_holdout` |
|---|---|---|---|---|---|---|---|---|
| `BTCUSDT-5m` | fit | 2,039 | 2,039 | 0 | 0 | 1,885 | 0.924 | 337.4 |
| `ETHUSDT-5m` | fit | 2,039 | 2,039 | 0 | 0 | 1,901 | 0.932 | 340.3 |

**Zero excluded days in 2,039 calendar days on either symbol** — the extended
tape has no missing minute at all (§5). The power projection was ~337–340
holdout trades per arm, comfortably above the 150 floor; power was never the
binding constraint and the arms died on the fit period instead.

---

## 4. The two anchors side by side — the closed pass's crypto rows, quoted

Quoted from `research/orb-ny-open/results/`, **never recomputed and never
re-judged** (`DESIGN.md` §11). The NY-anchor arms are a *different family* with
a *different* eligible-day population (NYSE trading days only, 2024-01 fit)
and their own verdicts; this table is a reader's orientation, not a test.

| anchor | arm | fit `n` | fit mean net R | fit gross R | fit `cost_R` | fit forward lift | holdout `n` | holdout mean net R | holdout `p_A` | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **09:30 NY** (closed pass) | `BTCUSDT-5m` | 367 | −0.0008R | +0.0950R | 0.0958R | 1.227 | 228 | −0.1231R | 0.718 | NO EDGE — KILL |
| **09:30 NY** (closed pass) | `ETHUSDT-5m` | 358 | −0.0253R | +0.0565R | 0.0818R | 1.162 | 220 | +0.0132R | 0.060 | NO EDGE — KILL |
| **00:00 UTC** (this pass) | `BTCUSDT-5m` | 1,885 | **−0.2330R** | −0.0319R | 0.2011R | **0.978** | *never read* | — | — | NO EDGE — KILL (fit screen) |
| **00:00 UTC** (this pass) | `ETHUSDT-5m` | 1,901 | **−0.1519R** | −0.0074R | 0.1444R | **1.073** | *never read* | — | — | NO EDGE — KILL (fit screen) |

And the closed pass's crypto **weekend** rows at the NY anchor, quoted for the
§8.1 comparison (`research/orb-ny-open/results/descriptive_rows.csv`):
`BTCUSDT-5m` fit −0.3836R / holdout −0.3955R; `ETHUSDT-5m` fit −0.2895R /
holdout −0.4074R. This pass's weekend rows at the 00:00 UTC anchor
(−0.3162R and −0.2548R) are **of the same magnitude and the same sign**, on
the days that were supposed to be the crypto-native anchor's home ground.

**The comparison that matters.** At the NY anchor the crypto arms were a
well-powered *null* — gross positive, cost small, forward lift above 1, mean
net R at zero. At the UTC-midnight anchor they are *worse than null*: gross is
at or below zero, `cost_R` is roughly **double** (0.14–0.20R against
0.08–0.10R, because the 00:00–00:30 UTC range is narrower and the stop is
therefore tighter relative to price), and forward lift has fallen to or below
1.00. The crypto-native anchor did not merely fail to beat the imported one;
it is the weaker of the two on every component.

---

## 5. Data

| symbol | first monthly 1m archive that exists on `data.binance.vision` | first bar | last bar | extension rows | audited-segment rows | total | duplicates | gaps | missing minutes | 2022-08+ slice byte-identical to the audited tape |
|---|---|---|---|---|---|---|---|---|---|---|
| BTCUSDT USD-M perp | **2020-01** | 2020-01-01 00:00 UTC | 2026-09-11 23:59 UTC | 1,357,920 | 2,164,320 | 3,522,240 | 0 | 0 | 0 | **yes** |
| ETHUSDT USD-M perp | **2020-01** | 2020-01-01 00:00 UTC | 2026-09-11 23:59 UTC | 1,357,920 | 2,164,320 | 3,522,240 | 0 | 0 | 0 | **yes** |

2019-06 .. 2019-12 return HTTP 404 for both symbols; **2020-01 is the floor
the archive actually publishes**, verified by probing rather than assumed.
3,522,240 = 2,446 × 1,440 exactly. Fit is therefore the full
**2020-01-01 .. 2025-07-31** (67 months), and the pre-registration's
2022-08 fallback did not fire. Audit: `results/history_audit.json`.

**Checks (`results/checks.json`), all pass:**

| check | result |
|---|---|
| grid — the four clock points on the 5-minute epoch grid, UTC offset 0 on all 2,446 days | **pass**, 0 violations |
| **funding — no position open at 00:00 / 08:00 / 16:00 UTC**, both templates, 4,556 trades | **pass**, **0 crossings** |
| fills — 1m-path vs bar-OHLC agreement, and the 1m path never kinder on excluded trades | **pass**, 0 violations, max abs diff 0.0 |
| session — no trade past its forced flat, none crossing UTC midnight | **pass**, 0 |

The funding check is new in this family and it delivers what `DESIGN.md` §3.4
registered: entries are at or after 00:30 UTC (that day's 00:00 settlement has
passed) and every exit is before 08:00 UTC, so **funding is structurally zero
here, not merely unmodelled** — the first crypto registration in this project
for which that is true. Earliest entry observed 01:29 UTC (BTC) / 01:19 UTC
(ETH); latest exit 07:54 UTC on both.

Ten fit-period trades per arm — five weekday, five weekend — are shown minute
by minute in `MECHANIC-PROOF.md`.

---

## 6. What this closes, and the one thing the next Architect must carry forward

1. **The crypto ORB line is closed on every anchor.** The pre-registration
   (§0, §3.2, §5 of the note) stated this was the line's second and last shot,
   and that a kill closes it on every anchor *because the fit-only rows will
   already have shown whether 08:00 / 16:00 look any different*. They do not:
   all four anchors, on both instruments, produce gross expectancy inside
   ±0.05R and net expectancy between −0.10R and −0.35R, ordered by cost rather
   than by story. 08:00 UTC is **not** promoted (§8.3), and there is no note
   recommending it for a future registration.
2. **The α ledger is not spent by this family — carry 14, not 16.** Because
   both arms were screened out on the fit period, the 2025-08 .. 2026-07
   holdout was never computed for either. The count of pre-registered arms
   judged on that holdout therefore remains **8 (`orb-ny-open`) + 6
   (`orb-ny-open-short`) = 14**. The next registration that reaches that
   holdout should use 14 + its own arm count, not 16. This is a **tightening
   of nothing and a loosening of nothing** relative to what was actually
   spent, and it follows the note's own instruction to correct the count in
   the direction of rigour; it is flagged to the Architect in `HANDOFF.md`
   rather than decided here.
3. **The forward-lift finding travels.** The closed pass's only positive
   signal — direction is selected after a close beyond the range, even though
   the +1R / full-range-stop construction does not convert it — is a property
   of the **NY anchor**, not of the ORB mechanic in general. At 00:00 UTC it is
   absent on BTC and halved on ETH. Any future exit-construction family (the
   follow-up note's §9 item) that hoped to inherit "lift > 1" as a starting
   condition should note that it inherits it **on the indices and at the NY
   anchor only**.
4. **A structural note for any crypto registration, not just ORB.** `cost_R`
   at this anchor is 0.14–0.20R against 0.08–0.10R at the NY anchor, on the
   same instruments, the same fee, and the same 30-minute width. The
   00:00–00:30 UTC range is simply narrower relative to price than the
   09:30–10:00 NY range, so any R-normalised mechanic anchored in the Asian
   hours starts roughly twice as deep in the hole before it has an opinion.
   That is a design constraint for the whole Asian-session block, and it is
   the most transferable thing this pass found.

**No build. No follow-up on this line.** Both arms: **NO EDGE — KILL (fit
screen).**
