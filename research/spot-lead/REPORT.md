# REPORT — spot-lead confirmation (arm (b) of "Spot–perp basis"; insight-bot P4 research gate)

**Date:** 2026-09-28 · **Researcher** · Pre-registration
`ARCHITECT-NOTE.md` (a0f0ba5) → `DESIGN.md` committed **before any R**
(d3a28c2) → screen decision committed **before any holdout R** (b60da06, DESIGN
§10). Scripts: `fetch_data.py` (wraps the extended
`research/hedged-carry/fetch_data.py --interval 1m`), `data_audit.py`,
`common.py`, `engine.py`, `analysis.py`, `stage1.py`, `checks.py`
(40/40 green), `mechanic_proof.py` → `MECHANIC-PROOF.md`. Results in
`results/`.

## 0. Verdicts

**All four registered arms: NO EDGE — fit-period kill.** None cleared its fit
screen; **the holdout year (2025-08-01 .. 2026-07-31) was never simulated.**
α = 0.0125 over four arms, four registered, zero read.

| arm | what | fit n | fit mean netR | vs price shadow | verdict |
|---|---|---|---|---|---|
| L1 continuation | long at `SPOT_LED` | 9 265 | **−0.008R** | +0.003R [−0.036, +0.043] | NO EDGE — fit kill |
| L2 fade | short at `PERP_LED` | 3 318 | **−0.050R** | −0.035R [−0.083, +0.012] | NO EDGE — fit kill |
| L3 absorption | long at `ABSORPTION` | 3 136 | **−0.060R** | −0.071R [−0.129, −0.013] | NO EDGE — fit kill |
| L4 filter | keep only `SPOT_LED` advances | F 9 265 / B 10 984 | **Δ = +0.0001R** (keep 84 %) | +0.003R [−0.036, +0.043] | NO EDGE — fit kill |

**The hypothesis itself — the L1 contrast "spot-led advances continue better
than perp-led ones" — is +0.005R [−0.041, +0.051]**: indistinguishable from
zero on 9 265 vs 3 318 trades over five and a half years, eight perps.

**Consequence for the bot (note §4, "kill" branch):** `label.p4` stays a
displayed context with **weight 0 in the score**; it may **not** be declared as
a playbook `context_gate`. Arm (b) of the backlog entry "Spot–perp basis and
spot-lead signals" is **closed**.

The one-line reading: **on Binance 4 h bars, whether an advance was bought by
spot takers or by perp takers tells you nothing about the next 1–5 days that
the advance itself doesn't.** The advance does carry a little (see §3), the
label does not add to it.

---

## 1. What was measured (DESIGN §1–§4, in brief)

- 1m spot and USD-M perp klines with `taker_buy_volume`, 8 perps (majors BTC,
  ETH; alts SOL, BNB, XRP, DOGE, ADA, LINK), 2020-01 (perp listing binds) ..
  2026-08. Fit: sample start .. 2025-07-31.
- At each 4 h close: `cvd = Σ(2·takerBuy − volume)` per leg, `ret_4h` of the
  perp, move iff `|ret| ≥ 0.25·ATR(4h,14)/price`; labels exactly as design §9.2.
- Template: entry at the 4 h close on the perp, stop 1.5·ATR, target +1R,
  5-day time stop, walked on 1m bars (same minute stop+target → stop; gap
  through stop fills at the open), funding settled strictly inside the hold,
  0.10 % round trip. One position per (arm, symbol).
- Price shadow: spot-CVD slot ← perp CVD, perp-CVD slot ← price return
  (i.e. "an advance with positive perp taker flow" instead of "spot-led").

## 2. Fit period — every arm, with its decomposition

`results/fit_arms.csv`, `fit_breakdown.csv`.

| arm | n | netR | priceR | fundingR | costR | grossR | win | hold h | stop / target / time |
|---|---|---|---|---|---|---|---|---|---|
| L1 | 9 265 | −0.0078 | +0.0301 | −0.0084 | 0.0295 | +0.0217 | 51.4 % | 26.0 | 47.4 / 50.5 / 2.1 % |
| L1 shadow | 8 412 | −0.0107 | +0.0273 | −0.0071 | 0.0309 | +0.0202 | 51.2 % | 26.5 | 47.5 / 50.3 / 2.2 % |
| L1c (long at `PERP_LED`) | 3 318 | −0.0124 | +0.0254 | −0.0065 | 0.0312 | +0.0189 | 51.0 % | 27.5 | 47.6 / 50.1 / 2.3 % |
| L2 | 3 318 | −0.0501 | −0.0254 | +0.0065 | 0.0312 | −0.0189 | 48.9 % | 27.5 | 50.1 / 47.6 / 2.3 % |
| L2 shadow | 6 239 | −0.0152 | +0.0018 | +0.0102 | 0.0272 | +0.0120 | 50.3 % | 26.7 | 48.7 / 48.8 / 2.5 % |
| L3 | 3 136 | −0.0596 | −0.0233 | −0.0078 | 0.0286 | −0.0310 | 48.6 % | 27.3 | 49.9 / 47.6 / 2.4 % |
| L3 shadow | 1 778 | +0.0113 | +0.0448 | −0.0023 | 0.0312 | +0.0425 | 52.0 % | 28.5 | 46.4 / 50.9 / 2.6 % |
| L4 B (every advance) | 10 984 | −0.0079 | +0.0295 | −0.0082 | 0.0292 | +0.0214 | 51.3 % | 25.9 | 47.5 / 50.4 / 2.1 % |
| L4 F (`SPOT_LED` advances) | 9 265 | −0.0078 | +0.0301 | −0.0084 | 0.0295 | +0.0217 | 51.4 % | 26.0 | 47.4 / 50.5 / 2.1 % |

Boundary exits 0.02 % of trades; excluded trades (> 1 missing funding slot) 0.

**Tiers** (mandatory rows, descriptive): L1 majors **+0.017R** (n 2 413),
alts −0.016R (n 6 852). But **L1c majors +0.032R** (n 979) — in the majors,
perp-led advances did *better* than spot-led ones, the opposite of the
hypothesis. L2 majors −0.110R, alts −0.025R. L3 majors −0.017R, alts −0.071R.
L4 B majors +0.022R vs F +0.017R — the filter *removes* value in the majors.

**Per symbol (L1):** BTC +0.006, ETH +0.027, SOL +0.020, DOGE +0.001, BNB
−0.017, LINK −0.029, XRP −0.035, ADA −0.036. L1c per symbol: BTC +0.054, LINK
+0.024, ETH +0.002, BNB −0.001, SOL −0.020, XRP −0.050, ADA −0.067, DOGE
−0.081. No symbol shows a clean spot-over-perp ordering that its neighbours
share.

### Screen (DESIGN §6.1, `results/fit_screen.json`)

- **L1:** floor ✓; stat −0.008 < +0.05 ✗; placebo 0.000 ✓ (see §4.1);
  shadow margin +0.003 ✗; contrast +0.005 ✗. **OUT.**
- **L2:** stat ✗; placebo 0.998 ✗; margin −0.035 ✗. **OUT.**
- **L3:** stat ✗; placebo 0.428 ✗; margin −0.071 ✗ (the shadow is *better*,
  and the CI excludes 0 on the wrong side). **OUT.**
- **L4:** keep 84 % ✓; Δ +0.0001 ✗; placebo 0.002 ✓ (§4.1); margin +0.003 ✗.
  **OUT.**

Projected holdout `n` would have been 580–1 720 per arm — power was never the
problem; the fit effect is simply zero.

## 3. Descriptive rows the note required (fit only, no verdict)

**Label frequency** (`fit_label_freq.csv`), pooled over valid 4 h bars:
`SPOT_LED` 21.4 %, `PERP_LED` 4.9 %, `ABSORPTION` 4.5 %, `DISTRIBUTION`
6.1 %, `NONE` 63.1 %. Spot takers are net buyers in **69 %** of all 4 h
advances (bar level) — `SPOT_LED` is the *normal* advance, not a special one.

**Transition matrix** (`fit_transition_matrix.csv`) — P(next bar = X | this bar):

| from \ to | ABS | DIST | NONE | PERP_LED | SPOT_LED |
|---|---|---|---|---|---|
| ABSORPTION | 0.069 | 0.040 | 0.601 | 0.041 | 0.248 |
| DISTRIBUTION | 0.033 | 0.103 | 0.615 | 0.062 | 0.187 |
| NONE | 0.039 | 0.061 | 0.638 | 0.052 | 0.209 |
| PERP_LED | 0.037 | 0.086 | 0.615 | 0.071 | 0.191 |
| SPOT_LED | 0.061 | 0.048 | 0.625 | 0.034 | 0.233 |

Every row is within a few points of the unconditional mix. **Persistence**
(mean run length, bars): SPOT_LED 1.30, PERP_LED 1.08, ABSORPTION 1.07,
DISTRIBUTION 1.11 — a label almost never lasts past the bar that produced it.

**Contemporaneous 4 h return by label, ATR units** (`fit_contemporaneous_ret.csv`):
SPOT_LED mean +0.74 (median +0.58), PERP_LED +0.59 (+0.48), ABSORPTION −0.52,
DISTRIBUTION +0.03, NONE −0.22. So `SPOT_LED` is partly "the bigger advance":
the label is correlated with the size of the move it describes.

**Forward return, ATR(k) units** (`fit_forward_profile.csv`), overlapping:

| label | 1 d mean (median) | 3 d mean | 5 d mean (median) |
|---|---|---|---|
| SPOT_LED | +0.131 (−0.016) | +0.399 | +0.650 (+0.088) |
| PERP_LED | +0.162 (+0.037) | +0.328 | +0.648 (+0.164) |
| ABSORPTION | +0.089 (+0.060) | +0.395 | +0.679 (+0.122) |
| DISTRIBUTION | +0.055 (+0.007) | +0.248 | +0.539 (+0.203) |
| NONE | +0.072 (+0.042) | +0.253 | +0.450 (+0.111) |

The five-day drift after a spot-led and a perp-led advance is **identical to
three decimals** (+0.650 vs +0.648 ATR). The means exceed `NONE` by ~0.2 ATR at
5 d, but that is the advance (both labels are advances), and the medians do
not order at all.

**Event-level control** (all closes, overlapping, no one-position rule): long
priceR at `SPOT_LED` +0.0024, at `PERP_LED` +0.0043, at a *random* close
−0.0248. The only structure in this data is "after a 4 h advance, a long does
~0.03R better on price than a random long" — a price fact, the same for both
labels, and not enough to pay the 0.03R of cost.

**§1.4 variant, `SPOT_LED ∧ cvd_spot > cvd_perp`** (the note's hypothesis
sentence, fit-only): n 5 785, **−0.025R** — worse than plain L1.

## 4. Doubts, and what they do and don't change

1. **The placebo p on L1 and L4 (0.000, 0.002) is not evidence for the label.**
   The placebo draws closes *uniformly*; the arm takes the first qualifying
   close after the previous trade closed. That selection alone is worth ~+0.03R
   here: every advance, taken one-position-at-a-time (L4 B) is −0.008R, the
   same advances drawn uniformly are −0.038R. The L1 shadow and L1c —
   which carry no spot information — also score `p ≤ 0.018`. So the matched-time
   placebo as registered is anti-conservative against a non-overlapped arm;
   here it did not decide anything (every arm failed on its statistic and its
   shadow margin), but a future pass with a one-position rule should draw
   placebo trades through the same rule. Flagged for the Architect.
2. **Binance spot is a slice of spot.** Coinbase, US ETFs and OTC are
   invisible; `SPOT_LED` here is "Binance spot takers net-bought". A US-led
   bid that Binance spot *sells into* would label PERP_LED or NONE. This is a
   reason the label might underperform its idea — it is also exactly the
   label the bot computes, so it is the right object to have tested.
3. **Sign-only, 4 h, fixed.** The label uses CVD *sign*, not size, and one
   window. The variant with a size comparison was worse. A z-scored CVD or a
   different window is a new registration, not a rescue, and nothing in the
   forward profile suggests one is waiting.
4. **The template is +1R at 1.5·ATR, five days.** A label predicting slow
   drift could hide under a symmetric bracket — but the forward-return profile,
   which has no bracket, shows no spot/perp difference either.
5. **Majors vs alts.** Majors' advances are mildly positive (+0.02R L4 B),
   alts' negative; costs are larger in R on the majors (lower ATR/price). In
   the majors the perp-led advance was the *better* one. Nothing here is a
   tier-level edge; it is recorded so nobody re-reads "L1 majors +0.017R" as one.
6. **Holdout unread.** The kill is a fit-period kill. The holdout year stays
   unspent for this question family; a future spot/perp flow registration
   could still use it, and should declare this pass's fit reads.

## 5. What this means for the insight bot, concretely

- `label.p4`: keep computing and displaying it (it is cheap and a trader may
  like to see it); **score weight 0**; no `context_gate` declarations.
- **P3's alternative trigger** "close ≥ cascade low + 0.5·ATR(1h) with
  `cvd.spot.slope_4h > 0`" leans on the same observable. This pass did not test
  P3 (post-cascade, 1 h, different template), so it is not a ruling on P3 —
  but it removes the prior that spot-CVD sign is a quality signal. The
  Architect may want P3's twin arms to include the variant without that clause.
- **The squeeze-full-form pass** uses "spot CVD not confirming" as one of four
  filters; that pass is independent and its ablation ladder will speak for it.

## 6. Data and reproducibility

`python3 fetch_data.py` (≈ 10 min, ≈ 1.6 GB parquet, gitignored) →
`python3 data_audit.py` → `python3 stage1.py` (builds `cache/`, ≈ 15 s) →
`python3 checks.py` → `python3 mechanic_proof.py`. Stage-0 audit is in
DESIGN §9: holdout had 0 invalid 4 h bars; fit 31–70 per symbol; one corrupt
taker row (XRP perp 2023-11-30 12:35) neutralised by rule.

---

## Итог простыми словами

**Что проверяли.** В боте есть метка P4: смотрим на последние 4 часа и
спрашиваем, *кто* толкал цену вверх — покупатели на **споте** (обычная
покупка монеты) или покупатели на **бессрочных фьючерсах** (торговля с
плечом). Для этого у Binance есть бесплатное поле «объём, купленный
агрессивным покупателем»; разница «купили агрессивно минус продали
агрессивно» за 4 часа — это CVD (накопленная дельта объёма). Идея: рост,
который ведёт спот, — это «настоящий» спрос, он продолжится; рост на
фьючерсах — это плечо, оно потом откатится.

**Как проверяли.** Восемь монет (BTC, ETH и шесть альтов), с 2020 года по
июль 2025-го, минутные данные спота и фьючерса. На каждом закрытии 4-часовой
свечи ставили метку и открывали виртуальную сделку: стоп на 1,5 среднего
4-часового диапазона (ATR), цель — такое же расстояние в плюс, не дольше пяти
дней, с комиссией 0,10 % и с фондированием. Проверили четыре способа
использовать метку: покупать «спот ведёт», шортить «фьючерс ведёт», покупать
«спот покупает на падении», и — главное для бота — оставлять только «спот
ведёт» из всех ростов, как фильтр. Для каждого был обязательный контроль —
«ценовая тень»: та же сделка, но вместо спотового CVD берём фьючерсный. Если
метка не лучше тени, значит спот ничего не добавил.

**Что получилось.** Ни один из четырёх вариантов не прошёл даже обучающий
период, поэтому проверочный год вообще не открывали.

- Покупка на «спот ведёт»: в среднем **−0,008 R** на сделку (R — размер
  риска в сделке) на 9 265 сделках. Покупка на «фьючерс ведёт»: −0,012 R.
  Разница между ними +0,005 R — это ноль в пределах случайного разброса.
  На BTC и ETH рост «на фьючерсах» даже был немного *лучше*.
- Фильтр «оставлять только спотовые росты» оставляет 84 % сделок и меняет
  средний результат на **+0,0001 R** — то есть никак.
- Шорт на «фьючерс ведёт» и покупка на «поглощении» — оба в минусе (−0,05 и
  −0,06 R); тень у поглощения была даже лучше самой метки.
- Через пять дней после роста «спот ведёт» и роста «фьючерс ведёт» цена в
  среднем ушла одинаково: **+0,650 и +0,648 ATR**.

**Что это значит для бота.** Метку можно и дальше показывать в сообщениях
как справочную информацию, но **её вес в оценке сигнала — ноль**, и ни один
сценарий не может ею фильтроваться. Спотовый CVD на Binance на горизонте
1–5 дней не говорит ничего сверх того, что говорит сама цена. Это закрывает
направление «спот ведёт» в бэклоге.

**Одна оговорка.** Binance — это только часть спотового рынка (Coinbase, ETF
и внебиржевые сделки не видны), и метка смотрит только на знак CVD за 4 часа.
Но бот считает ровно такую метку — её и проверили.
