# Research package v2 — timing filters, other crypto assets, equity indices

**Role:** Researcher · **Hand-off to:** Architect (`agents/roles/architect.md`)
**Scope:** exploratory feasibility only — not a formal backtest, not an implementation.
**Continues:** `research/intraday-mr-smc/REPORT.md` (read that first; nothing in it is modified).

---

## 0. Bottom line, in the form the Architect asked for

> **Does ANY tested combination now approach PF > 1.2 and win rate > 50%?**
> **No.** Out of sample, on a pre-committed holdout, nothing reaches it. Zero of
> the 52 time-filter evaluations, zero of the 144 momentum parameter
> configurations, and zero of the 8-symbol / 4-index asset extensions produce a
> holdout cell with PF > 1.2 **and** win rate > 50% on a sample large enough to
> mean anything.
>
> **Would relaxing one target help?** Relaxing **PF to > 1.1 while keeping win
> rate > 50%** does not help either — the two targets trade directly against
> each other and the underlying edge is not large enough to buy both (§4).
> Relaxing the **win-rate** target instead is the only version that produces
> anything: `momentum_breakout` at 1h has gross PF > 1.0 on **8 of 8** perps and
> net PF 0.97–1.11 (median 1.03), but its win rate is 43–47% by construction and
> its net edge is ≈ +0.019 R/trade against a ≈ 0.037 R/trade cost — i.e. **the
> sign is finally right, the magnitude is roughly one round-trip fee.**

Three concrete things changed versus the first report:

1. **Time-of-day / day-of-week is a dead end, and demonstrably so.** In-sample
   filter improvement *anti-correlates* with out-of-sample improvement
   (r = **−0.49** over 52 filter evaluations). The showcase case: the hybrid at
   1h goes from PF 0.87 unfiltered to **4.07 in fit** with the best 6-hour
   allow-list, and back to **0.66 on the holdout**. §1.
2. **The absent-edge finding generalises.** Five additional liquid perps
   (BNB / XRP / DOGE / ADA / LINK, same 48 months) reproduce it: MR net PF
   0.76–0.86 on 8/8 symbols, SMC 0.71–0.91 on 8/8. Nothing is BTC/ETH/SOL
   specific. §2.
3. **The momentum inversion the first report recommended is the one real
   positive.** It is the only rule-set in either package whose *gross* profit
   factor exceeds 1.0 on every single asset tested. It is still not a business
   at retail taker cost, but it is the first thing here with a consistent sign
   rather than a consistent absence. §2, §4.

Weak spots named in the hand-off, and their status after this pass:

| weak spot | addressed? | what this package found |
|---|---|---|
| **interval choice** | partially | 1h continues to dominate 15m for every candidate, on 8 symbols and on indices. 15m is worse in *every* holdout cell in §1. No new interval was found that helps. |
| **signal absence** | **yes, and reversed for one candidate** | MR/SMC/hybrid remain edge-free across 8 perps and 4 index products. But the momentum inversion has gross PF > 1 on 8/8 perps and 2/4 index products — the absence is specific to the *reversion* framing, not to the data. |
| **filter selectivity** | **yes — and it is the wrong tool** | Timing filters buy selectivity, not accuracy. The permutation null in §1.4 shows most of the apparent gain is what any random allow-list of the same size delivers. Meanwhile on indices the hybrid's gate stack is *so* selective it fires 3 times in 35 months (§3.3). |

---

## 1. THREAD 1 — hour-of-day and day-of-week

### 1.1 What was tested and how

Candidates: `mean_reversion`, `smc`, `hybrid`, plus the two new momentum
candidates. Intervals 1h and 15m. Symbols BTC/ETH/SOL (the v1 universe), traded
as three independent accounts, each with the unchanged 1%-per-trade sizing and
the 2%-of-day circuit breaker.

Protocol, fixed before any holdout number was read:

* **fit** `2022-08-01 .. 2025-04-01` (32 months) — the filter is chosen here.
* **holdout** `2025-04-01 .. 2026-08-01` (16 months) — the filter is run once here.

The engine is run over each window separately, so equity and the daily
circuit-breaker start fresh at the holdout boundary. Filters are applied as an
allow-list on the **fill** bar's UTC hour / weekday (the signal fires on bar
close and fills at the next bar's open, so that is the bar whose session
actually matters).

Six pre-registered allow-list rules per candidate × interval, all read off the
fit ranking only: hours with positive mean R (`H_pos`), best 12 hours, best 6
hours, weekdays with positive mean R (`D_pos`), Monday–Friday (`D_weekday`), and
`H_pos × D_pos`.

**Multiple-comparisons accounting.** 52 filter evaluations were carried to the
holdout (5 candidates × 2 intervals × up to 6 rules, minus degenerate empty
ones). That is a small number only because the rules were pre-registered; the
space they were *drawn from* is 2²⁴ × 2⁷ ≈ 2 × 10⁹ hour/day allow-lists. To price
that, §1.4 puts every selected filter inside a 200-draw permutation null of
random allow-lists of identical size.

### 1.2 Before / after — 1h, the interval that matters

`NONE` is the unfiltered baseline over the same window. All figures are pooled
across BTC/ETH/SOL, net of 5 bp/side.

| candidate | filter | fit PF | fit WR | fit n | **holdout PF** | **holdout WR** | holdout n | holdout Sharpe |
|---|---|---|---|---|---|---|---|---|
| mean_reversion | NONE | 0.79 | 45.8% | 1409 | **0.86** | 46.3% | 782 | −0.91 |
| mean_reversion | H_pos (3 h) | 1.09 | 54.2% | 227 | **0.94** | 48.7% | 119 | −0.16 |
| mean_reversion | H_top6 | 1.01 | 50.2% | 448 | **1.05** | 49.1% | 234 | +0.15 |
| smc | NONE | 0.85 | 38.2% | 4778 | **0.81** | 37.9% | 2432 | −1.97 |
| smc | H_top6 | 0.89 | 39.1% | 3455 | **0.86** | 40.1% | 1779 | −1.16 |
| smc | D_pos | 0.92 | 40.0% | 1675 | **0.72** | 34.6% | 804 | −1.93 |
| **hybrid** | NONE | 0.87 | 55.8% | 138 | **0.94** | 59.3% | 54 | −0.01 |
| **hybrid** | **H_top6** | **4.07** | **77.8%** | 36 | **0.66** | 46.7% | 15 | −0.49 |
| **hybrid** | **H_pos_x_D_pos** | **4.60** | **80.0%** | 20 | **1.12** | 50.0% | **4** | +0.10 |
| momentum | NONE | 0.96 | 42.0% | 1410 | **0.92** | 43.2% | 770 | −0.49 |
| momentum | H_top6 | 1.26 | 46.6% | 384 | **1.17** | 48.6% | 179 | +0.51 |
| momentum | H_pos_x_D_pos | 1.76 | 53.8% | 251 | **1.10** | 45.3% | 137 | +0.31 |
| momentum_breakout | NONE | 1.04 | 44.6% | 1703 | **1.00** | 46.1% | 848 | +0.07 |
| momentum_breakout | H_top6 | 1.29 | 48.8% | 650 | **1.10** | 47.0% | 364 | +0.45 |
| momentum_breakout | D_weekday | 1.00 | 44.1% | 1401 | **1.07** | 46.9% | 670 | +0.38 |

Full grid including 15m: `results/tod_dow.csv`; per-hour and per-weekday fit
profiles: `results/tod_profile.csv`.

**Holdout cells meeting both targets: 0 of 52.** The three holdout cells with
PF > 1.1 are hybrid `H_pos_x_D_pos` (**4 trades** — not a result), momentum
`H_top6` (PF 1.17, WR 48.6%, 179 trades) and momentum_breakout `H_top6`
(PF 1.10, WR 47.0%, 364 trades). Both survivors are momentum candidates and both
miss the win-rate target.

### 1.3 The overfitting evidence, stated numerically

Across all 52 filter evaluations, comparing each filter's PF improvement over
its own unfiltered baseline:

| | fit Δ PF | holdout Δ PF |
|---|---|---|
| mean | +0.48 (1h) / +0.32 (15m) | **+0.008 (1h) / −0.038 (15m)** |
| median | +0.17 (1h) / +0.11 (15m) | **+0.021 (1h) / −0.002 (15m)** |
| max | +3.72 | +0.25 |

* **46 of 52 filters improved PF in the fit period. 25 of those 46 improved in
  the holdout** — a coin flip.
* **corr(fit improvement, holdout improvement) = −0.486.** Choosing the filter
  that looked best in-sample was *worse* than choosing at random.
* Median holdout improvement among the filters that looked good in fit: **+0.007
  PF**. Nothing.

The mechanism is visible in the fit hour profiles. The "good" UTC hours are not
the same across candidates and do not line up with any session story:

| candidate (1h, fit) | best 6 UTC hours |
|---|---|
| momentum | 06, 11, 14, 15, 17, 22 |
| momentum_breakout | 03, 04, 06, 09, 15, 16 |
| mean_reversion | 00, 01, 02, 05, 10, 12 |
| hybrid | 01, 02, 03, 05, 18, 21 |

If there were a genuine liquidity-session effect — the 13:00–21:00 UTC EU/US
overlap, say — it would show up in the same hours for rule-sets that trade the
same instruments. It does not. Mean reversion's best hours are almost the
complement of momentum's, which is what you get when both are reading noise.
The one weekday pattern with a plausible story (crypto weekend liquidity drop)
is also the one that does nothing: `D_weekday` moves holdout PF by −0.01 to
+0.07 depending on candidate, and the largest single weekday effect in the fit
data is *Sunday* being the best day for the momentum candidate (+0.36 R), which
is the opposite of the weekend story.

### 1.4 Permutation control — is the chosen hour set better than a random one?

For each candidate × interval, 200 random allow-lists of the *same size* as the
selected `H_pos` filter were run on the holdout. Selectivity alone changes PF
(fewer trades, less cost, different variance), so this null isolates whether the
*choice of hours* added anything.

| candidate | int | k hours | selected holdout PF | null median | null p90 | percentile of selected |
|---|---|---|---|---|---|---|
| mean_reversion | 1h | 3 | 0.94 | 0.86 | 1.16 | 68% |
| smc | 1h | 3 | 0.85 | 0.84 | 0.91 | 55% |
| hybrid | 1h | 10 | 0.67 | 0.92 | 1.40 | **14%** |
| hybrid | 15m | 3 | 0.62 | 0.69 | 1.19 | 39% |
| momentum | 1h | 9 | 1.07 | 0.96 | 1.06 | **91%** |
| momentum | 15m | 3 | 0.91 | 0.69 | 0.82 | **99%** |
| momentum_breakout | 1h | 12 | 1.02 | 0.99 | 1.07 | 72% |
| momentum_breakout | 15m | 2 | 0.78 | 0.78 | 0.90 | 47% |

Five of eight sit between the 39th and 72nd percentile of a random hour set —
i.e. the filter bought nothing beyond its own selectivity. The hybrid's chosen
hours were *worse* than 86% of random hour sets of the same size. Two momentum
cells land in the tail (91st and 99th percentile), which is the only hint of a
real hour effect anywhere in this thread — but with 8 tests one or two at the
90th percentile is roughly what chance produces, and in both cases the resulting
holdout PF is **0.91 and 1.07**, i.e. still not tradable. I would not route on
them.

**Verdict, thread 1: time-of-day and day-of-week are a dead end.** They are not
merely unhelpful — the in-sample gains they produce are actively misleading, and
this thread's main contribution is a measured price for that (r = −0.49).

---

## 2. THREAD 2 — five more crypto perps

### 2.1 Setup

BNB / XRP / DOGE / ADA / LINK USDT-M perpetuals, pulled from the same public
`data.binance.vision` monthly archive as v1, same window
(`2022-08-01 → 2026-07-31`, 35,064 complete 1h bars each, no gaps), 1h only
(v1 established 1h dominates), default parameters, no per-asset tuning. The
BTC/ETH/SOL rows reproduce `REPORT.md` §3 to three decimals, which is the check
that the harness was not silently changed.

### 2.2 Before / after — v1 candidates on the wider universe (1h, net)

| candidate | BTC | ETH | SOL | **BNB** | **XRP** | **DOGE** | **ADA** | **LINK** |
|---|---|---|---|---|---|---|---|---|
| mean_reversion PF | 0.80 | 0.86 | 0.77 | **0.84** | **0.78** | **0.86** | **0.81** | **0.76** |
| mean_reversion WR | 46.5% | 48.0% | 43.5% | 46.1% | 46.3% | 47.6% | 44.8% | 44.6% |
| smc PF | 0.71 | 0.81 | 0.91 | **0.76** | **0.88** | **0.90** | **0.86** | **0.74** |
| smc WR | 37.7% | 38.0% | 38.6% | 37.7% | 38.1% | 38.3% | 38.3% | 36.6% |
| hybrid PF | 1.01 | 0.88 | 0.82 | **1.48** | **0.74** | **0.55** | **0.59** | **0.72** |
| hybrid n | 63 | 64 | 65 | **42** | **70** | **69** | **40** | **57** |

Mean reversion is negative on **8 of 8** assets in a 0.76–0.86 band; SMC on
**8 of 8** in a 0.71–0.91 band. The tightness of those bands is the point — this
is not three unlucky assets, it is a property of the rule-sets.

The hybrid's spread *widens* on the new assets (0.55 to 1.48) purely because
its trade counts are 40–70 over four years. Its single "winner", BNB at PF 1.48
with a 64% win rate, is **42 trades** — the one cell in this whole package that
nominally clears both targets, and I do not believe it. Ten trades either way
flips it. It is exactly the failure mode §9 of the v1 report warned about.

### 2.3 The momentum inversion — the one positive result

The first report's §8 recommended probing continuation rather than reversion,
since the MR trigger's forward return at 1h was negative. Three candidates were
added (`strategies_v2.py`):

* `momentum` — the **exact sign-inversion** of the MR trigger; where MR buys the
  failed −2σ stretch, this sells it. Stop `stop_atr × ATR`, target 1.5 R.
* `momentum_breakout` — trade the stretch while it is still extending: close
  crosses beyond ±2σ.
* `momentum_smc` — `momentum` plus the hybrid's HTF-bias gate and a
  no-opposing-sweep gate.

Pooled over the 8 perps, 48 months, 1h:

| candidate | net PF min / median / max | assets with **net** PF > 1 | assets with **gross** PF > 1 | median WR | median net exp (R) | median gross exp (R) | total trades |
|---|---|---|---|---|---|---|---|
| mean_reversion | 0.76 / 0.81 / 0.86 | 0 / 8 | **0 / 8** | 46.2% | −0.097 | −0.045 | 5,890 |
| smc | 0.71 / 0.84 / 0.91 | 0 / 8 | **1 / 8** | 38.1% | −0.081 | −0.005 | 19,098 |
| hybrid | 0.55 / 0.78 / 1.48 | 2 / 8 | 3 / 8 | 55.4% | −0.091 | −0.047 | 470 |
| momentum | 0.84 / 0.97 / 1.06 | 2 / 8 | 7 / 8 | 43.3% | −0.010 | +0.048 | 5,875 |
| **momentum_breakout** | **0.97 / 1.03 / 1.11** | **5 / 8** | **8 / 8** | 44.8% | **+0.019** | **+0.058** | 6,792 |
| momentum_smc | 0.86 / 0.94 / 1.06 | 3 / 8 | 7 / 8 | 42.8% | −0.026 | +0.043 | 5,129 |

Gross (zero-cost) PF for `momentum_breakout`, per asset:
**BTC 1.11 · ETH 1.13 · SOL 1.13 · BNB 1.10 · XRP 1.18 · DOGE 1.19 · ADA 1.07 ·
LINK 1.12.** Eight for eight, in a narrow band, on ~850 trades per asset.

Compare the same line for mean reversion: **0.93 / 0.97 / 0.83 / 0.95 / 0.87 /
0.91 / 0.89 / 0.83** — eight for eight *below* 1. The two are mirror images of
each other, which is what an actual signed effect looks like rather than noise.

**The magnitude, stated plainly.** `momentum_breakout` earns ≈ **+0.058 R per
trade gross** and pays ≈ **0.037 R per trade** in fees and slippage at 5 bp/side,
netting ≈ **+0.019 R**. At 1% risk per trade and ~210 trades per asset per year
that is roughly **+4% per asset per year before any funding cost**, with a
per-asset max drawdown of 17–33%. That is a real but thin effect sitting on top of
a cost line it barely clears — the honest description is *"the sign is right and
the magnitude is about one round-trip fee"*.

**Does the absent-edge finding hold?** For the reversion family, yes, uniformly
and on five new assets. For the continuation family, **no** — and the difference
between them is far larger than the difference between any two assets.

---

## 3. THREAD 3 — equity indices

### 3.1 Data and the adaptations it forced

**Source, no credentials.** `stooq.com` was tried first, as suggested, and now
sits behind a JavaScript proof-of-work interstitial that returns a challenge
page instead of CSV. Rather than work around it I moved to Yahoo Finance's
anonymous `v8/finance/chart` endpoint, which needs no key, no account and no
cookie. Pulled: **SPY, QQQ** (tradable) and **^GSPC, ^NDX** (cash indices, not
directly tradable — reference only), at 1h and 1d.

**Window caveat, stated up front.** That source caps 1h history at a rolling
~730 *trading* days: **2023-09-27 → 2026-08-25, ~35 months, 5,090 bars per
symbol** — not the 48 months used for crypto. The 1d series goes back to
2011 (3,770 bars) and is included only as a long-window sanity check. Index and
crypto numbers here are therefore **not over an identical window**, and the
index window contains no 2022 bear leg.

Four adaptations were needed, all deliberate:

1. **Regular session only.** The 1h series contains only RTH bars (13:30–20:00
   UTC under EDT, 14:30–21:00 under EST; ~7 bars/session). There is no 24/7
   tape, so "intraday" here means the cash session, and the hour-of-day question
   from thread 1 collapses to ~7 buckets — not enough to filter on, so no
   time-of-day filtering was applied to indices.
2. **Gap-aware fills (`engine_v2.py`).** v1's engine fills a stop at the stop
   price whenever the bar's range spans it. On a 24/7 crypto tape that is fine;
   on an index every session boundary is a gap, and a stop 0.4% away can open
   1.5% away. `engine_v2.py` is a copy of the v1 engine with exactly one change:
   if the bar *opens* beyond the stop or target, the fill is at the open. It
   reproduces the v1 engine to ≤ 0.01 PF on 24/7 crypto for every high-count
   candidate (`results/engine_check.csv`; the one larger gap is 0.048 PF on the
   63-trade hybrid, where a single trade moves the number) — the difference is a session-gap effect, not an
   engine rewrite. **up to 25% of index exits are gap fills** (10–25% on the multi-session hold,
   4–16% on the one-session hold; the hybrid's 2–3 trades are the 0% rows), so this correction is
   not cosmetic.
3. **Daily circuit-breaker = session circuit-breaker.** A US cash session sits
   entirely inside one UTC day, so the engine's existing UTC-day reset already
   *is* the session boundary; the 2%-of-day rule needed no change and is
   enforced identically. On the 1d series the breaker is degenerate (one bar per
   day), which is one more reason the 1d rows are a sanity check, not a result.
4. **Two hold horizons.** `time_stop = 24` bars (~3.5 sessions, carries
   overnight) and `time_stop = 7` (one session, genuinely intraday, no overnight
   gap risk). Costs: 2 bp/side (retail zero-commission plus ~1 bp spread on
   SPY/QQQ), and no perp funding.

### 3.2 Results — 1h, regular session, `time_stop = 24`

| candidate | SPY net PF | SPY WR | SPY n | QQQ net PF | QQQ WR | ^GSPC net PF | ^NDX net PF | SPY gross PF |
|---|---|---|---|---|---|---|---|---|
| mean_reversion | **0.55** | 31.1% | 106 | 0.93 | 39.7% | 0.55 | 0.99 | 0.60 |
| smc | **0.80** | 41.0% | 373 | 0.78 | 42.8% | 0.73 | 0.67 | 0.89 |
| hybrid | **0.00** | — | **3** | 0.45 | 50.0% | 0.00 | 0.49 | 0.00 |
| momentum | **1.18** | 50.5% | 99 | 0.95 | 47.0% | 1.40 | 0.96 | 1.31 |
| momentum_breakout | **1.17** | 49.1% | 112 | 1.00 | 47.9% | 1.13 | 0.95 | 1.28 |
| momentum_smc | **1.02** | 46.7% | 92 | 0.94 | 46.6% | 1.28 | 0.94 | 1.14 |

One-session hold (`time_stop = 7`) is broadly similar and slightly better for
`momentum_breakout` on QQQ (PF 1.15, WR 52.4%, 143 trades) and worse for
`momentum` on SPY (0.98). Full grid: `results/summary_index.csv`.

**Reading it:**

* **Mean reversion is worse on indices than on crypto** — SPY net PF 0.55 with a
  **31% win rate**, gross 0.60. Fading a 2σ intraday stretch in SPY is close to
  the worst thing in either package. The Nasdaq side is milder (QQQ 0.93, ^NDX
  0.99) but still not positive.
* **SMC is uniformly negative** (0.67–0.80 across all four products), the same
  verdict as crypto, on an instrument with completely different microstructure.
  That is worth something: it makes "the SMC encoding is wrong for crypto perps
  specifically" a less available explanation.
* **The momentum family is the only positive again**, and it splits by index
  family, coherently: the S&P products are positive (SPY 1.18 / ^GSPC 1.40 for
  `momentum`; SPY 1.17 / ^GSPC 1.13 for `momentum_breakout`) and the Nasdaq
  products are flat-to-negative (QQQ 0.95–1.00, ^NDX 0.95–0.96). With ~100
  trades per product over 35 months, a 2-of-4 split is not evidence of an edge;
  it is what you would expect from four correlated samples of a coin. Note also
  that the ETF and its own index disagree in *magnitude* by a lot (SPY 1.18 vs
  ^GSPC 1.40) even though they track the same thing — the cash index's opening
  print is a staggered composite, so I would trust the tradable SPY/QQQ numbers
  and treat the ^GSPC/^NDX rows as reference only.
* **1d rows are noise or beta.** The eye-catching cells — `momentum_smc` on QQQ
  at PF 2.90 / 66% WR and ^NDX at 3.37 / 66% — are **55 trades over 15 years**
  and **89% long**, i.e. a levered read of the Nasdaq's 2011–2026 drift. The
  matching SPY row is PF 0.98. Do not route on those.

**Index cells meeting both targets on a defensible sample: none.** The closest
tradable cell is `momentum` on SPY, PF 1.18 / WR 50.5% / n = 99 — which clears
win rate but not PF, on a third of the sample size crypto gives.

### 3.3 A structural finding: the hybrid does not survive a session-gapped tape

On SPY the hybrid produces **3 signals in 35 months**; on QQQ, 2. Tracing the
gate stack on SPY vs BTC:

| | SPY (5,090 bars) | BTC (35,064 bars) |
|---|---|---|
| z-score turns (the MR trigger) | 169 (3.3% of bars) | 1,383 (3.9%) |
| … also with a fresh liquidity sweep | 36 (21% of turns) | 457 (33%) |
| … also passing the HTF-bias gate | **3** (8%) | 72 (16%) |

Two things compound: liquidity sweeps coincide with z-turns much less often on a
session tape (21% vs 33%), and a strongly trending index leaves the HTF bias
pinned to one side, so the gate vetoes most fades. **The hybrid as specified is
structurally unusable on index products** — roughly one trade per year. That is
a design finding, not a performance finding, and it belongs in any decision
about carrying the hybrid forward.

---

## 4. Can relaxing a target rescue anything? — the momentum parameter scan

Because `momentum_breakout`'s win rate is a direct consequence of its 1.5 R
target, the obvious question is whether a closer target buys win rate > 50%
while keeping PF above 1.1. `mom_scan.py` answers it: **144 configurations**
(z ∈ {1.5, 2.0, 2.5} × stop_atr ∈ {1.0, 1.5, 2.0} × reward:risk ∈ {0.75, 1.0,
1.5, 2.0} × time_stop ∈ {12, 24}, two candidates), each pooled across all eight
perps, scanned **on the fit period only**, with the best configurations then run
once on the holdout.

### 4.1 The two targets trade directly against each other

Reward:risk is the knob that moves win rate, and it moves PF the other way.
Pooled across 8 perps, fit period:

| candidate | reward:risk | best PF (any WR) | WR at that PF | highest WR reachable | PF at that highest WR |
|---|---|---|---|---|---|
| momentum | 0.75 | 1.056 | 54.5% | **59.1%** | 0.988 |
| momentum | 1.00 | 1.072 | 49.5% | 53.0% | 0.956 |
| momentum | 1.50 | **1.077** | 44.8% | 45.7% | 1.063 |
| momentum | 2.00 | 1.058 | 44.8% | 44.8% | 1.058 |
| momentum_breakout | 0.75 | 1.000 | 49.4% | **56.3%** | 0.935 |
| momentum_breakout | 1.00 | 1.021 | 46.9% | 50.4% | 0.973 |
| momentum_breakout | 1.50 | **1.039** | 44.1% | 45.2% | 1.021 |
| momentum_breakout | 2.00 | 1.027 | 41.3% | 45.0% | 1.014 |

* **0 of 144 configurations meet PF > 1.2 and WR > 50% — even in-sample.**
* **0 of 144 reach PF > 1.1 at all, in-sample.** The best profit factor anywhere
  in the grid is **1.077**.
* 48 of 144 configurations reach WR > 50%. **The best PF among them is 1.066.**
  So **relaxing PF to > 1.1 while keeping WR > 50% is not attainable** — the
  ceiling with the win-rate constraint on is ~1.07 in-sample and lower out of
  sample.

### 4.2 Fit-selected configurations on the holdout

| candidate | pick | z / stop_atr / rr / time_stop | fit PF | fit WR | fit n | **holdout PF** | **holdout WR** | holdout n | assets PF > 1 |
|---|---|---|---|---|---|---|---|---|---|
| momentum | best fit PF | 1.5 / 1.5 / 1.5 / 24 | 1.077 | 44.8% | 2299 | **0.960** | 42.9% | 1351 | 2/8 |
| momentum | best fit PF, WR > 50% | 1.5 / 2.0 / 1.0 / 24 | 1.066 | 50.8% | 2358 | **0.960** | 50.4% | 1386 | 2/8 |
| momentum | v2 default | 2.0 / 1.5 / 1.5 / 24 | 0.956 | 42.4% | 3818 | **0.995** | 44.0% | 2057 | 3/8 |
| **momentum_breakout** | **best fit PF** | 2.0 / 1.5 / 1.5 / 24 | 1.039 | 44.1% | 4534 | **1.031** | 46.6% | 2258 | **5/8** |
| momentum_breakout | best fit PF, WR > 50% | 2.5 / 1.5 / 0.75 / 12 | 0.986 | 50.7% | 3649 | **0.927** | 50.9% | 1742 | 2/8 |

Two things are worth the Architect's attention here:

1. **The `momentum_breakout` default is the one thing in this package that does
   not decay out of sample.** Fit PF 1.039 → holdout PF 1.031, win rate actually
   *up* (44.1% → 46.6%), on 4,534 fit and 2,258 holdout trades, 5 of 8 assets
   positive in the holdout. The fit-selected configuration and the untuned
   default are the *same configuration* — the scan did not have to reach for
   anything. That is the profile of a small, stable effect rather than a fitted
   one, and it is the exact opposite of the hybrid's fit-4.07 / holdout-0.66
   behaviour in §1.
2. **Every configuration selected for win rate degrades.** Both `WR > 50%` picks
   land at holdout PF 0.93–0.96. Buying win rate with a nearer target hands back
   more in average win size than it gains in hit rate, consistently.

---

## 5. What this means for routing

### 5.1 Direct answers to the questions in the brief

**Is any combination now approaching PF > 1.2 and win rate > 50%?**
No. Out of sample: 0 of 52 time filters, 0 of 144 momentum configurations, 0 of
48 crypto candidate×asset cells on a credible sample, 0 of 24 index cells on a
credible sample. The only nominal double-clear anywhere is `hybrid` on BNBUSDT
(PF 1.48, WR 64%) on **42 trades in four years**, which I am reporting as noise,
not as a finding.

**Would relaxing PF to > 1.1 with the others intact already produce something
viable?** No — and this is the sharpest new number in the package. With the
win-rate constraint held at > 50%, the best profit factor across 144
configurations is **1.066 in-sample and 0.96 out-of-sample**. PF > 1.1 and
WR > 50% together is not within reach of this family at 1h.

**Which relaxation *does* produce something?** Dropping the win-rate target.
`momentum_breakout` at 1h, default parameters, holdout: **PF 1.03, WR 46.6%,
2,258 trades, 5 of 8 assets positive, mean max drawdown 14.5%, mean Sharpe
+0.24.** Full window, all 8 assets: gross PF > 1 on 8/8 (1.07–1.19), net PF
0.97–1.11. That is a genuine, stable, small effect. At ~+0.019 R net per trade
it is not yet a business, and funding cost — still not modelled — is a live
threat to it.

### 5.2 Are the weak spots being addressed?

* **Interval choice — no new information, previous verdict holds.** 1h beats 15m
  in every single holdout cell of thread 1, for every candidate. Nothing found
  here changes "1h only, drop 5m".
* **Signal absence — resolved, with a sign flip.** The absence is a property of
  the *reversion* framing. Across 8 perps and 4 index products, the reversion
  and structure candidates are negative essentially everywhere; the continuation
  candidates are gross-positive nearly everywhere. The first report's §8
  recommendation was correct and this is the evidence for it.
* **Filter selectivity — addressed, and it is the wrong lever.** Timing filters
  buy selectivity, not accuracy (§1.4 permutation null), and the hybrid's
  existing gate stack is already over-selective to the point of being
  inoperable on a session tape (§3.3, 3 trades in 35 months). Adding gates is
  not the path.
* **Time-of-day / day-of-week and other-asset dimensions — dead end and
  partial dead end respectively.** Timing: dead end, with r = −0.49 between
  in-sample and out-of-sample improvement as the receipt. Other crypto assets:
  dead end for the v1 candidates (the finding simply generalises), but the
  wider universe is what made the momentum result credible — 8/8 gross-positive
  is a much stronger statement than 3/3. Indices: dead end for MR/SMC/hybrid,
  ambiguous and under-powered for momentum (2 of 4 products positive, ~100
  trades each).

### 5.3 What I would carry forward, ranked

1. **`momentum_breakout` at 1h, wide crypto universe.** The only thing here with
   a stable out-of-sample sign. Before it could be routed to Implementation it
   needs: **funding cost modelled** (it holds a few hours; at ~210 trades/asset/
   year a persistent funding drag could erase +0.019 R/trade outright), a
   **maker/limit execution model** (its entire net edge is ~half of one
   round-trip taker fee — the same signal at maker fees roughly doubles net
   expectancy), and a **portfolio view** (8 correlated USDT perps on one venue
   are not 8 independent bets, and per-asset drawdowns of 17–33% will not simply
   average away).
2. **Retire pure mean reversion.** Negative gross on 8/8 perps and on SPY, at
   every interval, in both regimes, over four years, and negative again on a
   completely different instrument class. There is nothing left to test.
3. **Retire the hybrid as specified.** Not because it is refuted — its sample is
   too small to refute — but because §1 shows its numbers are the most
   filter-sensitive in the package (fit PF 4.07 → holdout 0.66) and §3.3 shows
   its gate stack does not transfer to another instrument class. Any future
   version must pre-commit to a minimum sample, as the v1 report already said.
4. **SMC: one more question, then retire.** It is now negative on crypto perps
   *and* on index products with entirely different microstructure. That weakens
   the "wrong encoding for crypto" defence the v1 report flagged as its main
   doubt. I would let Critique & Refinement close that question rather than
   spend more research passes on it.

### 5.4 Explicitly not done

* No funding-rate model (flagged in v1, still open, now materially more
  important because the surviving candidate holds positions for hours).
* No maker/limit execution model, which is the single highest-leverage untested
  change for the surviving candidate.
* No portfolio-level sizing or correlation treatment — every number here is
  per-asset on an independent account.
* No index history before 2023-09 at 1h (source limit, §3.1) and no intraday
  index data below 1h at all.
* No time-of-day work on indices (only ~7 session buckets; not enough to filter).

---

## 6. Doubts about this package

* **The momentum result is small enough to be fragile.** +0.019 R/trade net is
  about half a round-trip fee. A 1 bp error in the slippage assumption moves it
  by ~20%. I believe the *sign* (8/8 gross-positive, mirror-image of mean
  reversion, stable fit→holdout) considerably more than I believe the
  *magnitude*.
* **Eight USDT perps on one venue are not eight independent tests.** They are
  highly correlated, so "8 of 8 gross-positive" is worth less than it reads. The
  index thread was partly an attempt to get genuinely independent evidence, and
  it came back ambiguous.
* **The index window is shorter and kinder.** 2023-09 → 2026-08 contains no
  2022-style bear leg. Index results are not directly comparable to the
  48-month crypto results, and I would not read the SPY momentum number as
  confirmation of the crypto one.
* **The cash-index rows disagree with their own ETFs in magnitude** (^GSPC 1.40
  vs SPY 1.18 for the same rule-set on the same underlying). Something in the
  cash index's opening print is doing work there. Trust SPY/QQQ.
* **The holdout has been used.** Thread 1 spent it on 52 filter evaluations and
  §4 spent it on 5 configuration evaluations. It is no longer clean; anything
  further needs a new window, and a formal validation of `momentum_breakout`
  belongs to the Backtesting role on data this package has not touched.
* **The 2%-of-day circuit-breaker interacts with everything and was never
  varied.** It is a fixed part of the engine in both packages, per the risk
  rules. On the higher-frequency candidates it binds often enough to shape
  results, and nobody has measured how much. Worth knowing before any of this
  is sized for real.

---

## 7. Hand-off

To the **Architect** (`agents/roles/architect.md`).

The routing question this package puts in front of you is narrower than the last
one. The reversion and structure ideas are done — three of the four dimensions
this pass tested (timing, wider crypto universe, index instruments) all say the
same thing about them, and the fourth (parameters) says it too. What replaced
them is one small, stable, continuation-shaped effect with a concrete number
attached: **holdout PF 1.03 on 2,258 trades, gross PF > 1 on 8 of 8 perps, net
edge ≈ +0.019 R/trade against a ≈ 0.037 R/trade cost.**

That is not a strategy yet, and it does not meet the targets. Whether it is
worth another pass turns on one question a researcher cannot settle alone:
**is a maker-fee or funding-aware execution model on the table for this
project?** If it is, the surviving candidate's economics change by more than
its entire measured edge, and the next step is a costed execution study before
anything else. If it is not, then at retail taker cost this whole family is a
break-even exercise and the honest recommendation is to shelve the intraday
chart-only line and spend the next pass on a different idea class.

I have not routed to any other role.
