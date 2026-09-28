# REPORT — full-form long / short squeeze (insight-bot P1 / P2), research gate

**Researcher, 2026-09-28.** Pre-registration `ARCHITECT-NOTE.md`; mechanics
`DESIGN.md`, committed before any R (e801763). Code and STAGE-0 audit were
committed with `checks.py` 8/8 green before the first fit number was read
(f89a8c7). The fit run is in 01ed0a9. **The holdout (2025-08-01 … 2026-07-31)
was never simulated.** The 2026-08 tail was never touched.

---

## 0. Bottom line

| arm | fit `n` | fit mean netR | shadow `n` / mean | placebo `p` | **verdict** |
|---|---|---|---|---|---|
| **P1-M** short, majors | **0** | — | 122 / −0.188R | — | **UNDERPOWERED** (floor 60) — holdout not read |
| **P1-A** short, alts | **0** | — | 298 / −0.049R | — | **UNDERPOWERED** — holdout not read |
| **P2-M** long, majors | **0** | — | 14 / +0.234R | — | **UNDERPOWERED** — holdout not read |
| **P2-A** long, alts | **6** | −0.013R [−0.558, +0.531] | 21 / −0.190R | 0.463 | **UNDERPOWERED** — holdout not read |

**The full form is not a trade that fails; it is a trade that almost never
happens.** Across 8 perps and 3.7 years of evaluable history (66,678 decision
instants) the registered P1 conditions co-occurred **zero times**, and P2's
**six times**. No verdict other than UNDERPOWERED is mechanically reachable,
and UNDERPOWERED is not a pass: **the gate the user set — "build only if the
extra filters demonstrably rescue the shape" — is not met.**
**Recommendation: no P1/P2 build**, and the squeeze family should be treated
as closed for the insight bot (§8 says why this is the right reading even
though the formal verdict is UNDERPOWERED, not NO EDGE).

The three facts that carry this:

1. **The binding filter is "OI at a 7-day high"; it and extreme funding are
   each rare, so together they are almost never true.** Of 943 decision instants with funding extreme on
   both Binance and Bybit, **15** had OI at its 7-day high and **11** had it
   together with +5 %/24 h (§5). The draft's picture — funding extreme *while*
   OI is still making new highs — is a state this tape almost never shows.
2. **The rungs that do have power show no rescue.** Ablation ladder (§4):
   adding the second venue moves P1 from +0.124R → +0.033R (majors) and
   +0.020R → +0.019R (alts), every interval spanning 0; the OI rung cuts
   `n` from 65 → 2 and 154 → 8. Nothing on the ladder is significant at any
   rung, in any arm.
3. **In the whole holdout year both venues were never extreme-positive at the
   same time on any of the 8 symbols** (`results/condition_rates.csv`,
   `ext_hi_ge2 = 0.0` on every holdout row — a frequency count, no outcome
   read). A live P1 would have been silent for twelve months.

---

## 1. STAGE 0 — data

### 1.1 What was pulled (`fetch_data.py`, `results/fetch_log.csv`)

| input | rows | coverage |
|---|---|---|
| perp 1m (Binance USD-M, with taker-buy) | 3.1–3.5 M / symbol | listing … 2026-08-31 |
| spot 15m (with taker-buy) | 212–245 k / symbol | 2019-09 (SOL 2020-08) … 2026-08-31; **µs rule applied**: all 661 spot files follow it (check 1) |
| Binance funding | 6.6–7.3 k / symbol | 2020-01 (DOGE 2020-07, SOL 2020-09) … 2026-08 |
| Bybit funding (REST) | 5.7–7.1 k / symbol | see §1.2 |
| OKX funding (REST) | ≈ 295 / symbol | see §1.2 |
| Binance metrics, OI 5 m | 0.50–0.63 M / symbol | **BTC 2020-09-01; every other symbol 2021-12-01** |

Data quality: BTC, ETH, BNB, DOGE, ADA, LINK have **zero** missing perp
minutes; SOL and XRP miss 7,200 minutes each (two gaps > 60 min; 480 15m bars),
handled by the contiguity rule (no bar is filled). OI has one exchange-wide
630-minute gap (the 2024-02-16 outage `deriv-positioning` documented) plus
3–31 short gaps per symbol; the 15-minute staleness rule makes OI undefined
there.

**The OI archive is the effective start.** `data.binance.vision` serves
metrics files from 2020-09-01 for BTCUSDT but returns 404 for every other
symbol from 2020-09-01 to 2021-11-30 (456 days × 7 symbols, all logged).
Effective fit windows (`results/fit_windows.csv`): **BTC 2020-09-02, all
seven others 2021-12-02 → 2025-07-31**. This is the design's own rule
("effective start measured, never chosen"); it costs the alts and ETH the
2021 bull market, which is precisely where extreme positive funding was
common. The ladder's R0 rung is therefore also run on its full Binance-only
window (`R0_FULL`, §6).

### 1.2 Venue depth — the STAGE-0 deliverable (`results/venue_depth.csv`, `venue_pages.csv`)

| venue | first settlement served | depth |
|---|---|---|
| Binance archive | 2020-01-01 (BTC/ETH) … 2020-09-13 (SOL) | full |
| **Bybit** `/v5/market/funding/history` | **BTC 2020-03-25**; ETH, LINK 2020-10-21; ADA 2021-03-18; XRP 2021-05-13; DOGE 2021-06-02; SOL, BNB 2021-06-29 | full from listing, 8 h, no gaps > 8 h |
| **OKX** `/api/v5/public/funding-rate-history` | **2026-06-22 on every symbol** | **≈ 97 days** — paging back returns an empty page |

OKX's public endpoint keeps about three months. With the 45-settlement
`min_periods` it has a defined percentile from **2026-07-07**, i.e. only in
the last 3½ weeks of the holdout. **Everything tested here is the two-venue
form (Binance + Bybit), and "≥ 2 venues" means "both".** The insight bot will
count three venues live, where "≥ 2" means "two of three" — a *looser*
condition than the "two of two" measured here. Noted in HANDOFF as a
live/historical mismatch.

### 1.3 Evaluable decision instants

Fit: 66,678 (BTC 10,725, others 7,913–8,014). Holdout: 2,190 per symbol.

## 2. Wiring checks — 8/8 green (`results/checks.csv`)

1. timestamp unit per file: spot µs from 2025-01, ms before; perp ms (661 + 625 files);
2. spot 15m archive = Σ spot 1m (BTC 2025-03, µs era, max err 1.6e-15);
3. perp 15m / 1h resampled from 1m = archive 15m / 1h (BTC 2023-05, exact);
4. **prefix stability**: 19 observables × 2 symbols identical when every input
   is truncated at the decision instant — no look-ahead anywhere in `prep.py`;
5. venue state and `oi_d24h` re-derived independently at 300 instants, 0 mismatches;
6. failed-high count re-derived by a slow loop at 200 instants, 0 mismatches;
7–12. on R0 trades, BTC + SOL, both sides: entry strictly inside the armed
   window; `stop_dist > 0`; stop exits −1R (or worse when gapped), target
   exits +1R exactly; hold ≤ 5 d; no overlapping positions; settlements
   recounted independently; a placebo forced onto the real bar reproduces
   the real trade's netR; P1 trigger re-derived ("first close below the
   impulse low since the high");
13. effective start measurable for every symbol.

## 3. The four arms and their shadows (`results/fit_arms.csv`, `fit_summary.csv`)

Decomposition (T-1R, fit):

| rule | `n` | netR | priceR | fundingR | costR | 90 % day-block CI | win | stop / target / time | hold h |
|---|---|---|---|---|---|---|---|---|---|
| P1-M full (R4) | 0 | — | | | | | | | |
| P1-M shadow | 122 | **−0.188** | −0.138 | +0.006 | 0.056 | [−0.343, −0.028] | 43 % | 55 / 42 / 3 % | 19.0 |
| P1-A full (R4) | 0 | — | | | | | | | |
| P1-A shadow | 298 | −0.049 | −0.003 | +0.001 | 0.047 | [−0.147, +0.053] | 50 % | 50 / 50 / 1 % | 15.4 |
| P2-M full (R4) | 0 | — | | | | | | | |
| P2-M shadow | 14 | +0.234 | +0.272 | −0.018 | 0.020 | [−0.142, +0.574] | 64 % | 21 / 43 / 36 % | 85.7 |
| **P2-A full (R4)** | **6** | **−0.013** | −0.086 | **+0.097** | 0.025 | [−0.558, +0.531] | 33 % | 33 / 33 / 33 % | 53.3 |
| P2-A shadow | 21 | −0.190 | −0.176 | +0.003 | 0.018 | [−0.489, +0.139] | 38 % | 52 / 38 / 10 % | 51.0 |

P2-A's six trades are 5 BNB (−0.230R) and 1 SOL (+1.068R); placebo `p` = 0.463
(1,000 draws). Its shadow margin (+0.177R, CI [−0.441, +0.864]) is computed
but meaningless on 6 vs 21 trades and the shadow is marked *unreliable* (< 30).
Note that the P2-A full form's mean *price* R is negative (−0.086R); the
funding it collects (+0.097R — it is long while shorts pay) is what brings it
to zero. Six trades cannot say more.

**The P1 shadow is the only well-powered number in the section and it is
negative** (−0.188R majors, CI excludes 0; −0.049R alts). Shorting the first
structural break after a top-decile 24 h rally — with the failed-highs and
spot-CVD-divergence filters kept — loses. That is the `deriv-positioning` b1 /
funding-B finding a third time, with a different trigger.

## 4. The ablation ladder — the user's question (fit-only, descriptive)

Same template (4h arming, 15m structure trigger, +1R, 5-day stop), same
accounting, conditions added cumulatively, on each arm's effective window.
`Δ` is the change in mean netR from the rung above.

**P1 short (long squeeze)**

| rung | adds | majors `n` | majors netR [90 % CI] | Δ | alts `n` | alts netR [90 % CI] | Δ |
|---|---|---|---|---|---|---|---|
| R0 | Binance funding extreme-positive (the closed simple form) | 98 | +0.124 [−0.062, +0.309] | | 215 | +0.020 [−0.115, +0.151] | |
| R1 | + both venues extreme | 65 | +0.033 [−0.194, +0.255] | −0.091 | 154 | +0.019 [−0.138, +0.188] | −0.001 |
| R2 | + OI +5 %/24 h at 7-day high | **2** | −0.043 | | **8** | −0.259 [−0.762, +0.328] | |
| R3 | + ≥ 2 failed highs | 0 | — | | 4 | −0.011 | |
| R4 | + spot CVD ≤ 0 while perp CVD > 0 (**the arm**) | **0** | — | | **0** | — | |

**P2 long (short squeeze)**

| rung | adds | majors `n` | majors netR | alts `n` | alts netR [90 % CI] |
|---|---|---|---|---|---|
| R0 | Binance extreme-negative held ≥ 8 h | 4 | −0.111 | 56 | −0.056 [−0.246, +0.134] |
| R1 | + both venues | 3 | −0.482 | 35 | −0.081 [−0.276, +0.131] |
| R2 | + OI +3 %/24 h, price flat/up | 1 | −0.927 | 12 | +0.193 [−0.192, +0.574] |
| R3 | + ≥ 2 failed lows, compression near the high | 0 | — | 6 | −0.026 |
| R4 | + spot CVD ≥ 0 (**the arm**) | **0** | — | **6** | −0.013 [−0.558, +0.531] |

What the ladder answers:

- **Venue count (R0 → R1):** removes 30–35 % of setups and does not improve
  the mean anywhere (−0.091R majors short, −0.001R alts short, −0.025R alts
  long). Two venues agreeing is not better information than one. The two
  rates correlate 0.69–0.91 across the 8 symbols at the decision instants,
  and when Binance is extreme-positive Bybit is too 53–73 % of the time;
  dropping the setups where they disagree does not improve the result.
- **OI (R1 → R2):** the only filter that changes anything, and what it changes
  is `n` — by 97 % for P1. The one rung that looks positive (P2-A R2 +0.193R)
  rests on 12 trades with a CI from −0.19 to +0.57, and the next two filters
  take it back to zero.
- **Failed highs / lows and spot CVD (R2 → R4):** nothing is left to filter.
  Their marginal contribution is **unmeasurable on this tape**, not zero.

**Nothing rescues the shape.** The closed simple form (R0) is itself
indistinguishable from zero here (and negative on its full window, §6); every
additional filter either leaves the mean where it was or leaves too few
trades to read.

## 5. Why the full form does not fire (`results/p1_oi_cooccurrence.txt`)

On the 66,678 evaluable fit instants:

| condition | instants | share |
|---|---|---|
| funding extreme-positive on both venues | 943 | 1.41 % |
| OI +5 %/24 h **and** at 7-day high | 652 | 0.98 % |
| both venues extreme **and** OI +5 %/24 h | 199 | — (21 % of the funding instants) |
| both venues extreme **and** OI at 7-day high | **15** | **1.6 %** of the funding instants |
| all three | **11** | |

If the two were independent, 0.98 % × 943 ≈ 9 joint instants would be
expected — so they are close to independent, not anti-correlated; they are
both rare, and their product is tiny. The median `oi_d24h` at a two-venue
funding extreme is between −0.8 % and +2.5 % depending on the symbol:
**typically OI is not growing fast when funding is extreme.** A plausible
mechanism (not tested here): funding is an 8-hourly settled average of the
premium and lags the leveraged build-up, while "OI at its 7-day high" marks
the build-up itself; requiring both at the same 4h close asks for the
build-up and its bill to arrive together. The failed-highs (66–72 % of instants) and CVD (11–19 %)
filters are then applied to a near-empty set.

P2's extreme-negative funding on both venues is rarer still (0.07–0.37 % of
instants outside BNB/SOL); BNB alone carries 194 of the fit's R1 P2 arming
instants.

## 6. Side rows (all fit-only, descriptive; none promotable)

| row | `n` | netR [90 % CI] | reading |
|---|---|---|---|
| P1-M R0 on its full window (2020-01 →, `R0_FULL`) | 217 | **−0.070** [−0.191, +0.050] | the +0.124R of the effective window is 2021-12+ only |
| P1-A R0_FULL | 629 | −0.042 [−0.113, +0.033] | |
| P2-M R0_FULL | 6 | −0.075 | |
| P2-A R0_FULL | 108 | +0.059 [−0.077, +0.192] | |
| **P1-M R0, 3R target** (effective window) | 85 | +0.362 [−0.000, +0.736] | **window artefact** — next row |
| P1-M R0_FULL, 3R target | 196 | **−0.020** [−0.225, +0.197] | by year: 2020 −0.40 (73), 2021 −0.03 (78), 2023 +1.29 (11), 2024 +0.39 (34), no 2022 trades |
| P1-A R0_FULL, 3R target | 541 | −0.007 [−0.140, +0.122] | |
| R4 with Binance-only count (the note's multi-venue re-read) | P1: 0 / 0 · P2-M 1 · P2-A 9 | P2-A +0.221 [−0.227, +0.655] | the venue count is not what starves the arm |
| R4 with P2 "flat/up" = ret24 ≥ 0 | P2-A 6 | −0.013 | identical — the clause never binds |
| Shadows, 3R | P1-M −0.052, P1-A −0.193, P2-M +0.326, P2-A +0.182 | | |
| **T-VWAP ("VWAP of the rise" as T1)** | **0 everywhere** | — | **structurally impossible**, see below |

**The draft's structural T1 cannot exist with the draft's trigger.** P1 enters
short on a close *below* the impulse low, so every price in the rise from
that low to the high is above entry, and so is its VWAP: the "target" is on
the stop side of every entry. P2 mirrors it (entry above the 24 h high, the
VWAP of the decline below entry). Every T-VWAP candidate was recorded as
`no_t1`. If P1/P2 were ever revived, the target needs redefining (e.g. the
VWAP of the rise as a *stop* reference, or a target at the pre-rise base).

No 2022 R0 trades on P1 majors is itself informative: extreme positive funding
disappeared for the whole bear year, and did so again in the 2025-08 … 2026-07
holdout (§0 fact 3). The shape is regime-bound to bull markets with
over-levered longs.

## 7. Doubts, in order of how much they should worry a reader

1. **The OI archive gap (alts/ETH before 2021-12)** removes the 2021 bull
   market — the regime richest in extreme positive funding — from every arm
   except BTC. BTC, which has OI from 2020-09 and 10,725 instants, still
   produced **0** P1 trades, so the gap is not the reason the arm is empty;
   but it does mean alts were never tested in the period most favourable to
   the idea. An OI source for 2020–21 (Bybit/OKX/Coinglass) was not in the
   registration and was not sought.
2. **"At 7-day high" is strict** (the current 5-minute OI reading must equal
   the 7-day maximum). It is the note's definition and the insight-bot frame
   key `oi.at_7d_high`; a softer "within x % of the 7-day high" would fire
   more. That is a new registration, not a sensitivity, and I did not run it.
3. **OKX absent historically.** Irrelevant to the outcome (two venues already
   starve the arm) but relevant to the live bot (§1.2).
4. **[R-fix] choices in DESIGN** (venue staleness 16 h, "first close below
   the impulse low", P2 stop at the 24 h low, "flat/up" = ret24 ≥ −1 %,
   ≥ 8 h = three consecutive 4h instants). None can create the 97 % drop at
   the OI rung, which precedes them all except the venue definition; the
   "flat/up" sensitivity is identical.
5. **Costs**: taker 0.10 %, no slippage — irrelevant at these `n`.

## 8. What this closes, and what it does not

- **No P1 / P2 build.** The gate required a demonstrable rescue; there is none
  to demonstrate. Formally every arm is UNDERPOWERED (not NO EDGE), because
  the registered form produced too few trades to be judged at all.
- **Recommended reading for the family (the Architect's call):** treat the
  squeeze family as **closed** for the insight bot. The note says a *kill*
  closes it; this is not a kill, but (a) a playbook that fires ~0 times a year
  on 8 symbols has no product value whatever its edge, (b) the rungs with
  power (R0, R1, the shadows) are zero-or-negative — the third time this tape
  has said so (b1, funding B, now here), and (c) the one well-powered control
  (P1-M shadow, −0.188R, CI excludes 0) is significantly negative.
  Re-opening would need a *different* registration (e.g. OI near rather than
  at the 7-day high, a redefined target), not more data on this one.
- **Not closed:** P3 post-cascade reversal (different mechanism, history does
  not exist; runs in SHADOW as designed); funding carry as a *long-side alts*
  observation (funding family §3.4, unrelated to this shape).
- **For the collectors (useful regardless):** Bybit history is complete back
  to listing via REST, OKX only ~3 months — so every OKX day not collected
  from now on is permanently lost, which supports IB's collectors-first
  ordering.

---

## Коротко по-русски (для пользователя)

**Что проверяли.** Сценарии P1/P2 из бота — «сквиз»: толпа на фьючерсах
перегрузилась в одну сторону (лонги или шорты), платит за это высокий
фандинг, и первый пробой против неё должен вызвать цепочку вынужденных
закрытий. Простую версию этой идеи мы уже дважды проверяли — она убыточна.
Вы добавили четыре фильтра: фандинг экстремальный сразу на двух-трёх биржах,
открытый интерес вырос на 5 % за сутки и стоит на недельном максимуме,
цена минимум дважды не смогла пробить хай, а спот не подтверждает рост
фьючерсов. Вопрос был один: спасают ли эти фильтры идею.

**Что вышло.** Фильтры не «спасают» и не «топят» идею — **с ними сценарий
почти никогда не срабатывает**. За 3,7 года истории по 8 монетам (около
67 тысяч четырёхчасовых свечей) полная версия шорта (P1) не сработала **ни
разу**, лонга (P2) — **шесть раз**, и эти шесть сделок в сумме дали ноль.
По правилам проекта на меньше чем 60 сделках вывод не делается: вердикт —
«недостаточно данных», проверочный год даже не открывался.

**Почему так.** Главный «убийца» — условие «открытый интерес на недельном
максимуме». Экстремальный фандинг (плата за перекос) приходит с опозданием:
к моменту, когда он становится экстремальным, открытый интерес обычно уже
перестал расти. Из 943 моментов с экстремальным фандингом на обеих биржах
открытый интерес был на недельном максимуме только в 15. А за весь последний
год (август 2025 — июль 2026) экстремально положительного фандинга
одновременно на Binance и Bybit не было ни на одной из 8 монет ни разу — бот
с P1 молчал бы весь год.

**По ступенькам (что даёт каждый фильтр).** Вторая биржа ничего не улучшает:
биржи почти всегда показывают одно и то же. Фильтр по открытому интересу
выкидывает 97 % сигналов. Для двух последних фильтров сделок уже не остаётся —
их вклад измерить невозможно. Ни на одной ступеньке результат не отличим от
нуля. Контрольная версия «вместо фандинга — просто сильный рост цены за
сутки» на BTC/ETH уверенно убыточна (−0,19 R на 122 сделках), то есть
«шортить первый слом после сильного роста» проигрывает уже в третьей проверке.

**Ещё два факта.** (1) Цель из черновика — «VWAP роста» — при этом входе
невозможна: вход происходит ниже всей волны роста, и её средняя цена всегда
оказывается по ту сторону входа, где стоит стоп. (2) OKX отдаёт историю
фандинга только за последние ~3 месяца — всё, что бот не соберёт с OKX
с этого момента, будет потеряно навсегда.

**Рекомендация.** P1/P2 не строить. Семейство «сквиз» для бота считать
закрытым: не потому что доказан убыток полной формы, а потому что она не
срабатывает, а все её версии, которые срабатывают достаточно часто, не
зарабатывают. Вернуться можно только с новой идеей (другое условие по
открытому интересу, другая цель), а не с дополнительными данными к этой.
