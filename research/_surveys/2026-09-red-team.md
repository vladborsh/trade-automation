# Red team — is the game itself the problem? (Architect, 2026-09-16)

**Role:** Architect, assigned to attack the project's own premise, not to
design arm 31. **Audience:** coordinator / Architect / Researcher (technical
English); §7 is the user-facing paragraph, in plain Russian. **Not a
registration.** Nothing here is dispatched.

**Evidence base read:** `2026-09-intraday-directions.md` (all), `2026-09-
lightgbm-role.md` (§0, §4), `RESEARCH-LOG.md` Записи 1.1, 8, 22–27 (the log
in this worktree ends at 27; there is no Запись 28 yet), `IDEAS-BACKLOG.md`,
`research/funding-rate-signals/ARCHITECT-NOTE.md` (the cross-sectional
package has no ARCHITECT-NOTE yet), and — the part nobody had opened for this
question — `research/orb-ny-open/results/` (`trades_all.parquet`,
`null_draws.json`, `holdout_verdicts.csv`, `holdout_cost_sensitivity.csv`),
which is where §1 comes from. Numbers from external sources are that
source's claim; numbers from the results files were recomputed here.

Correction of the premise as stated to me: the repository's first commit is
2026-08-26. This is **three weeks** of research, not three months.

---

## 0. Bottom line

**The pipeline is not broken, but it is calibrated to certify only strategies
with an annualised Sharpe of roughly 2 or more — and no single-instrument
intraday mechanic in the published literature is that good, so 30 kills is
the only outcome this design could ever have produced.** The cost structure
is binding on crypto and on every tight-stop mechanic, but it is *not* what
killed the index arms (gross was ≈ 0 at `cost_R` 0.01–0.03R); the binding
constraint on the indices is **sample size**: a 2024-01 tape floor and a
one-year holdout of ~220 trades cannot distinguish a Sharpe-1 edge from
luck, and the project has never written that down.

What follows from that, in order of consequence:

1. **Run the three calibration tests in §6 before arm 31** (≤ 2 Researcher-
   days, no holdout read). One of them already exists implicitly and passes
   (§6.0). The other two are the single cheapest thing in this note.
2. **The cross-sectional family in flight is the right bet, and for a reason
   the survey did not give: statistical power.** Fifty instruments × 250 days
   is ~40× the observations of one index × one year. It is the only design in
   the project that can pass an edge of the size the literature actually
   reports (+0.08R tier), rather than one that only exists in headline tables.
   Wait for it.
3. **The funding family has a sign problem that should be fixed before
   dispatch** (§5.4): its hypothesis B re-tests, with prior ≤ 10 %, the exact
   shape `deriv-positioning` found *significantly negative* (t = −4.56, 1,188
   events, 0th percentile of its null), while the mirror of that finding —
   the strongest signed result this project has ever produced — has sat
   unregistered since 2026-08-26.
4. **"Intraday" is a user preference, not a constraint the evidence supports**
   (§3). At 1–5 days on a single index the landscape is not better; on the
   2020+ crypto tape a longer horizon at least has the sample size intraday
   lacks. The user should decide this consciously; nobody should redesign it
   for them.
5. **The one structural premium reachable with the accounts this project
   has** is hedged perp carry / cash-and-carry basis on Binance (§5.2). It is
   not intraday and not directional. If the goal is "find something that
   makes money", it is the highest-prior thing on the list. If the goal is
   "intraday directional", say so and stop counting it against the project.

What I do **not** conclude: that costs are the one change that would matter
(§2 — they matter only on crypto, and maker fills do not rescue any closed
arm); that a CME/paid-data venue would cut costs (§2.3 — it would not; it
would buy *history*, which is the actual scarce resource); that volatility
or the variance risk premium is reachable (§4 — not without an options
venue); that the base rate needs excusing (§6 — it is normal, and it is also
exactly what a Sharpe-2 hurdle produces on Sharpe-1 candidates).

---

## 1. The number nobody has computed: what this pipeline can pass

Everything below is from `orb-ny-open/results/`, the largest completed
package, and generalises to every registration because they share the
ladder, the null construction and the ~one-trade-a-day frequency.

| quantity (holdout, per arm) | value | source |
|---|---|---|
| trades per arm, one holdout year | 207–236 | `holdout_verdicts.csv` |
| per-trade std of net R (1R stop / +1R target template) | 0.74–0.88R | `trades_all.parquet` |
| standard error of the arm mean | **0.052–0.058R** | computed |
| Null-A (matched-time placebo, 1,000 draws) std | 0.050–0.058R | `null_draws.json` |
| Null-A mean, indices | −0.013 … −0.027R | ≈ −`cost_R` (§6.0) |
| Null-A mean, crypto | −0.069 … −0.093R | ≈ −`cost_R` |
| Null-A 99.4th percentile (the α = 0.05/8 gate), indices | **+0.097 … +0.115R** | computed |
| Null-A 99.4th percentile, crypto | +0.033 … +0.076R | computed |

The ladder demands, simultaneously: mean net ≥ +0.10R, `p_A` ≤ α (0.00625 for
8 arms; 0.0023 under the 22-arm ledger), fit same sign, bootstrap excluding
zero. On the indices the α gate and the +0.10R bar coincide at ≈ +0.11R. So
the question "what true edge passes this ladder?" has an answer:

| true per-trade edge (net) | P(arm passes +0.10R and α) at n ≈ 220 | implied annual Sharpe (220 trades, σ = 0.8R) |
|---|---|---|
| +0.05R (the kill bar) | ≈ 15 % | 0.9 |
| +0.08R (Zarattini 2024, > 100 % RVOL tier, at zero spread) | ≈ 30 % | 1.5 |
| +0.10R (the build bar) | ≈ 45 % | 1.85 |
| +0.155R | 80 % | **2.9** |
| +0.38R (Zarattini 2024, > 3,000 % RVOL tier) | ≈ 100 % | 7 |

Read the other way: to give a **+0.05R** edge an 80 % chance of clearing
α = 0.00625 you need n ≈ (2.5 + 0.84)² × 0.8² / 0.05² ≈ **2,900 trades**,
i.e. ~13 years of one-a-day on one instrument. For **+0.08R**, ~1,100 trades,
~5 years. The Capital.com tape has 2.6 years in total, of which the holdout
is one.

The same arithmetic in Bailey–López de Prado's minimum-track-record form:
to reject Sharpe = 0 at one-sided 95 % you need (1.645/SR)² years — 2.7 years
for a true Sharpe of 1, 11 years for 0.5; at Harvey–Liu–Zhu's t = 3 bar,
9 and 36 years. **A one-year holdout can certify Sharpe ≥ 1.65 at p = 0.05,
≥ 2.5 at this project's per-arm α, ≥ 2.8 at the 22-arm ledger.**

Now put the literature's *own* numbers against that bar. Baltussen et al.
(JFE 2021), the strongest academic intraday-momentum result on index futures:
timing-strategy Sharpe **0.87–1.73 gross** → +0.05–0.09R per trade at this
frequency → below the build bar *before costs*. Gao et al. (JFE 2018): OOS R²
of 1.4–2.0 %. The 2024 ORB paper's broad-universe tier: +0.08R at zero
spread. Mesfin 2026 on MNQ: gross edge ceiling 0.07–1.5 points against 2
points of friction. **Nothing in the published record on a single liquid index
is a Sharpe-2 object.** The only published number that would pass this ladder
is the cross-sectional top tier (+0.38R), which is exactly what the family in
flight is built to test.

So the honest description of the last three weeks is not "30 mechanics had no
edge". It is: **30 mechanics had no edge large enough to be certified in one
year on one instrument, and the literature never claimed one that large.**
Both statements are true; only the second tells the user what to do next.

This is not an argument to loosen the ladder. A Sharpe-1 strategy *is*
indistinguishable from luck in one year; that is a fact about the world, not
about the pipeline, and a filter that passed Sharpe-1 candidates on one year
of data would pass noise at a rate that would bankrupt the user. It is an
argument that **the project's power is the binding constraint, and every
design decision should be read through it**: more instruments, more years,
or a bigger premium. Costs and mechanics are second-order to that.

---

## 2. Constraint 1 — costs

### 2.1 Where cost is binding and where it is not

| package / arm class | `cost_R` | gross per trade | verdict driver |
|---|---|---|---|
| ORB, indices, full-range stop (Записи 23–25) | 0.010–0.030R | −0.002 … +0.053R | **gross ≈ 0; cost irrelevant** |
| ORB, indices, short range / tight stop (24, 25-E2) | 0.04–0.19R | +0.02 … +0.10R | cost decides at the margin |
| ORB, crypto, NY anchor | 0.07–0.10R | −0.02 … +0.12R | cost is half the story |
| ORB, crypto, 00:00 UTC anchor (26) | 0.14–0.20R | ±0.05R | **cost decides** |
| `cmc-bot` VWAP (22), indices | 0.06–0.13R | +0.02 … +0.09R | cost decides |
| `cmc-bot` VWAP, crypto | 0.24–0.38R | +0.03 … +0.15R | **cost decides** |
| `cmc-bot` VWAP, CHF pairs | 0.74–0.90R | +0.13 … +0.22R | absurd |

The user's framing — "entry fee exceeds the prize" — is exactly right for
crypto at taker fees and for any mechanic whose stop is a 5–15 minute range,
and exactly wrong for the index ORB arms, where the fee was 1–3 % of a risk
unit and the prize was still zero. Two different failures; conflating them
leads to fixing the wrong one.

### 2.2 Maker fills

Binance USD-M VIP 0: maker 0.02 %, taker 0.05 % (0.018 / 0.045 % paying in
BNB). A limit entry with a stop exit — the only honest mixed case, because a
stop-loss is never a maker fill — gives 0.07 % round trip, `cost_R` × 0.7.
Full maker (0.04 %) is the row every crypto package already prints as a
non-gating sensitivity. Its effect on the closed arms:

| arm | taker net | full-maker net | passes anything? |
|---|---|---|---|
| BTCUSDT-15m ORB | −0.065R | −0.007R | no |
| ETHUSDT-15m ORB | +0.047R | +0.091R | no (p unchanged; n ≈ 208) |
| `cmc-bot` BTC/ETH | −0.34 / −0.24R | still deeply negative | no |

Maker fills are worth modelling on the crypto families in flight (the
funding note already does) and are **not a rescue of anything closed**. They
also cost something the backtests do not price: a resting limit that does not
fill on the days that move — precisely the days a breakout wants.

### 2.3 A "real" venue: CME futures

Priced, since nobody had:

- **Execution.** MES at ~6,500: 1 tick = $1.25 on ~$32,500 notional; IBKR
  commission ≈ $0.25 + ~$0.55 exchange/clearing per side. Round trip ≈ 1 tick
  + $1.60 ≈ **0.9 bp**. Capital.com US500: 0.4-point spread ≈ **0.6 bp**, no
  commission, no financing when flat by the close. **CME does not cut the
  intraday cost; on a micro contract it is the same or slightly worse.** The
  cost_R of 0.01–0.03R on the index ORB arms was already a near-zero-cost
  regime. This is the single most common wrong intuition in the user's
  frame and it should be retired.
- **Data.** FirstRate Data: ES/NQ 1-minute continuous from **2008-01-02**
  through 2026-09-15 (individual contracts from ESZ08); purchase price not
  shown on the page, updates $99.95/yr — the bundle is an order of $100, not
  $1,000. Databento is metered per query for the same CME 1-minute OHLCV.
- **What paid data would actually buy: not cost, history.** Sixteen more
  years of tape (2008, 2011, 2015, 2018, 2020, 2022 — every regime the ORB
  papers' samples contain and this project's 2024+ tape does not), which
  under §1 is the *only* thing that gives a single-index registration power.
  With 2008–2023 as fit and 2024–2026 as holdout, the project could (a) test
  whether the papers' regime effect is real on the same instrument, (b) run
  a three-year holdout instead of one. That is the honest price comparison:
  ~$100 against three weeks of research that was structurally underpowered
  on the index side. **I recommend the coordinator put the question to the
  user in exactly those terms.** The prior that it changes a verdict is
  still low (every independent 2022–2026 test is negative); the prior that
  it changes *what the project can know* is high.

### 2.4 Fewer, larger trades

Cuts `cost_R` proportionally and cuts n proportionally. Under §1 the second
effect dominates: a mechanic with 60 trades a year cannot certify anything
in one year at any cost. On the 2020+ crypto tape it is viable (six fit
years); on the index tape it is not.

**Ruling on constraint 1:** binding on crypto and on tight-stop mechanics;
not binding on the index arms; maker fills and CME do not change it; paid
data changes something else and is cheap.

---

## 3. Constraint 2 — horizon

The user's arithmetic is right: cost is fixed per round trip and a 3× wider
stop makes 0.15R into 0.05R. The arithmetic it omits is that the same 3×
wider stop at a multi-day hold gives roughly 5–10× fewer trades a year, and
§1 says n is what the project is short of. On the **index tape (2024-01
floor)** a 1–5-day mechanic gets ~50–100 trades a year and a one-year
holdout: no power at all. On the **crypto tape (2020-01)** it gets 5–6 fit
years and can afford a two-year holdout: this is the one place a longer
horizon is a real gain, and the funding family already sits there (multi-
day holds, 1h decision bar).

What the literature says exists at 1–5 days *on one liquid index* — not on
a cross-section of stocks, which is where nearly all of it lives:

- **Overnight vs intraday.** The most robust single-index daily effect there
  is; SPY close→open +47.1 % vs open→close +29.9 % over 2020-Q3..2025-Q3 per
  the secondary sources checked, i.e. ≈ 3.7 bp/night. It is **in this
  project's tape and tradable on the CFD** (24/5). Net of the 0.6 bp spread
  and Capital.com's overnight financing (SOFR + 4 % p.a. ≈ 1.1–2.4 bp/night
  depending on the leg) it is ≈ +1–2 bp/night on σ ≈ 55 bp: annual Sharpe
  ≈ 0.5. Real, published, and **unpassable under §1**. Its use here is as a
  calibration instrument (§6.2), not as a strategy.
- **Short-term reversal / continuation at daily lags** (Heston–Korajczyk–
  Sadka, Bogousslavsky, end-of-day reversal): cross-sectional stock effects;
  the survey already ruled them unreachable on an index.
- **Pre-FOMC drift** (Lucca–Moench): faded after 2016 by most accounts;
  ~8 events a year; not testable on this tape.
- **Time-series momentum**: monthly formation, monthly hold — not 1–5 days.

So: a 1–5-day horizon on one index is not a richer hunting ground than
intraday; it is the same ground with fewer trades. On crypto it is a
different statement, and the project is already there with funding.

**Plain ruling for the user, as instructed:** intraday is not what the
evidence is fighting; the evidence is fighting *single-instrument directional
prediction with one year of certification*. Keeping intraday is a legitimate
preference (the user trades their own attention span, not a paper's). It is
also a preference that removes the horizon lever entirely on the index side.
Their call; this note only asks that it be made knowingly.

---

## 4. Constraint 3 — what is predicted

- **Volatility.** Realised-vol persistence is the best-documented predictive
  fact in the field (HAR out-of-sample R² ≈ 0.7 on the S&P 500; strong
  daily/weekly persistence on BTC). The project could forecast it well by
  Friday. **It cannot sell it.** Monetising a vol forecast needs options,
  variance swaps, or a VIX product: Capital.com's index-CFD menu and a
  Binance USD-M account have none of these at the liquidity a backtest could
  pretend to (Binance's BTC/ETH options are thin; Deribit is a separate
  venue with its own KYC, margin and data, and its retail-accessible history
  is the 2019+ book). The reachable use of a vol forecast is **volatility
  targeting** (Moreira–Muir 2017): scale position size by 1/σ̂ — which
  raises the Sharpe of a strategy that already has one and does nothing for
  one that does not. Worth writing into any future build ruling as a sizing
  clause. Not an edge.
- **Variance risk premium.** Documented on BTC (Deribit), positive and large,
  regime-dependent. **Needs an options venue. Not reachable. Say so and
  stop.**
- **Relative value.** Reachable, free, and already the two things in the
  backlog with the best priors: the cross-sectional package (in flight) and
  the spot–perp basis entry (prioritised 2026-08-26, still undispatched).
  This is where "predict something other than direction" is real for this
  project.
- **Range / no-direction intraday plays** (straddle-like structures via two
  stops): synthetically possible on a perp, but the payoff is a vol bet paid
  for with two round-trip fees; at crypto `cost_R` that is dead on arrival.

**Ruling on constraint 3:** the only non-directional target reachable is
*relative* value; vol and VRP are not, and no amount of design changes that
without a new account.

---

## 5. Constraint 4 — the role in the market

### 5.1 What is not reachable

Liquidity provision (resting quotes on a perp) is market-making against
informed and toxic flow with retail latency; the maker rebate is 0.02 % and
the adverse selection is larger. Cross-venue basis needs two funded venues,
synchronous execution and transfer latency. Neither belongs in this project's
backlog.

### 5.2 What is reachable: hedged carry / cash-and-carry basis

Schmeling–Schrimpf–Todorov (BIS WP 1087; Management Science 2024): crypto
carry (short perp or dated future, long spot) averages **above 10 % p.a.**,
reaches 60 % in bull phases, is driven by leveraged trend-chasing demand and
scarce arbitrage capital, and **a high carry predicts crashes** — the
position is delta-neutral in price but not in margin: drawdowns bring margin
spikes and liquidation risk on the short leg. Costs: two legs of fees (spot
0.1 %/0.075 % + perp 0.05 %, ×2) ≈ 0.25–0.3 % round trip, so it is a
multi-week hold by construction. Data: free (spot klines + perp klines +
funding, all on `data.binance.vision`). Venue: the Binance account the user
already has. This is the **only structural-premium class this project can
reach without a new venue**, and it is the class where the prize is a
documented premium rather than a price pattern.

It is not intraday, not directional, and its risk is a jump-to-liquidation
tail the backtest must model explicitly (margin path, not just P&L path).
The funding note §10 correctly parks it with the spot–perp basis entry. My
recommendation: **promote the hedged carry to the basis package's primary
hypothesis when that package is designed** — as a relative-value
registration with a margin model — and let the user decide whether a
non-intraday premium counts as "finding something".

### 5.3 What the one positive diagnosis points to

The perp liquidation / funding self-reinforcement is a **flow** fact. The
project has tested it twice: `deriv-positioning` (Запись 8) with the
quantity sensor, and the funding family (in flight) with the price-of-
leverage sensor. What Запись 8 actually found — and what nobody promoted:

- (b1) crowded extreme (≥ 95th pct) **plus** a counter-breakout through the
  12-bar extreme, entered *with* the squeeze: **−7.9 → −58.4 bp on 3h → 24h,
  t = −4.56, negative on 6/8 symbols, 0th percentile of the random-event
  null on 5 of 6 horizons, 1,188 events.** The pass called this "a fade,
  not a squeeze" and closed the line — correctly, because a sign flip is a
  new hypothesis under the project's rules.
- Nobody then registered the new hypothesis. **The mirror — crowded
  positioning plus a break against the crowd is *bought*, i.e. liquidation
  wicks revert — is the single largest |t| ever produced in this project,
  and it has sat in a REPORT since 2026-08-26.** Caveats that a
  registration would have to carry: fit-window only (2022-12 .. 2025-04),
  raw forward returns rather than an engine run with stops, 3–24 h
  horizons (not flat-by-session), unhedged funding exposure, and the
  price-shadow control the pass invented.

### 5.4 The finding on the in-flight funding family

The funding note's **hypothesis B** is: extreme funding + trailing 24h with
the crowd + 1h close through the prior 12-bar extreme *against* the crowd →
**enter with the squeeze**. That is the (b1) shape with funding replacing
crowd-ratio as the sensor. The note gives it prior ≤ 10 % and says so. But
under Запись 8's result, the *expected* sign of B is negative, and the arm as
registered can only kill or pass — it cannot report "significantly the other
way" as anything but a kill. **Recommendation to the coordinator, before
dispatch:** add the mirror of B as a pre-registered fifth arm (same trigger,
opposite side, same template, same shadow, α = 0.05/5), or replace B with it.
This is the one place in the project where a registration is being written
*against* its own strongest prior evidence, and fixing it costs one paragraph
in the note and one line of code.

---

## 6. Constraint 5 — is the filter working, and can it pass anything?

### 6.0 Calibration that already exists and passes

- **Cost model.** Null-A's mean is a random-entry strategy paying the same
  costs; it should sit at ≈ −`cost_R`. It does, on every arm of every
  package: indices −0.013…−0.027R vs `cost_R` 0.011–0.016R (the residual is
  the window's slight negative drift), crypto −0.069…−0.093R vs 0.073–0.104R.
  Costs are not double-counted and not sign-flipped.
- **Sign / look-ahead.** Gross R is positive on 10 of 14 ORB index/crypto
  arms across fit and holdout; forward lift > 1 on 14 of 16 arms; the
  `cmc-bot` Stage 0 reproduced the live TypeScript bot bit-identically; the
  1-minute-path and bar-OHLC fill conventions agree with zero violations on
  every package that checks them. A systematic sign error would not produce
  this pattern.
- **The statistics can flag a positive.** The `deriv-positioning` price
  shadow reached t = 4.98 and beat its null on 6/6 horizons; (b1) hit the
  0th percentile. ETHUSDT-5m template 2 posted +0.106R on the holdout. The
  machinery reports positives when the data has them; it has simply never
  had a *pre-registered arm* whose true edge was large enough (§1).

So the pipeline is not broken in any way the existing evidence can see. What
it has never had is a **positive control with a known answer run end to end
through the ladder**, and §1 says that without one, "never passed anything"
and "cannot pass anything realistic" are indistinguishable. Three tests fix
that. Total cost ≤ 2 Researcher-days, no holdout read, no new data beyond
what the cross-sectional package pulls anyway.

### 6.1 Test A — planted signal, end to end (half a day)

On `orb-ny-open`'s **fit** tape, for each signal day, shift every post-entry
1-minute bar by a deterministic drift `d × stop_dist × (t / hold)` in the
trade's direction, for `d ∈ {0, 0.05, 0.10, 0.20}`; rerun `engine.py`,
`cost_R`, both nulls and the bootstrap unchanged. Pre-registered pass
criteria: recovered mean net R = `d` − `cost_R` ± 1 SE at every `d`; `p_A`
falls below α at `d = 0.20` and not at `d = 0`; the bootstrap interval
covers `d` − cost. Then the same with the **side inverted** (`d < 0`). This
proves, in one table, that the engine, the cost model, the nulls and the
ladder recover a known edge of known size — and it prints the project's
power curve empirically, which §1 only computed.

### 6.2 Test B — a known published effect through the same engine (hours)

Overnight index premium on the Capital.com tape: a registered-in-advance
"buy 16:00 NY, sell 09:30 NY" arm on US500 and US100, 2024-01 .. 2025-07,
with the actual spread and the actual financing, and the mirror
open-to-close arm. Pre-registered expectations: close→open mean > open→close
mean on both, same sign as SPY/QQQ computed independently from public daily
data over the same dates, and **the engine's mean equals the arithmetic mean
of the tape's own close-to-open returns to the precision of the spread.** It
will *not* pass the ladder (Sharpe ≈ 0.5, §3) and the design must say so;
it is a mechanical check that the tape and the engine reproduce an effect the
whole field agrees on. If the engine's close→open number differs from the
tape's arithmetic by more than the spread, something in fills or timestamps
is wrong and every index verdict is suspect.

### 6.3 Test C — a known cross-sectional effect as the portfolio harness's stage 0 (one day)

The cross-sectional package needs a new harness. Its Stage 0 should be a
**positive control with a published answer**: Liu–Tsyvinski–Wu (JF 2022)
cross-sectional crypto momentum — rank the ≥ 50-perp universe on trailing
1–4-week return, long top quintile / short bottom, weekly hold, gross of
costs, 2020-01 .. 2025-07. The published result is a positive, significant
long–short spread over 2014–2020 on a coin universe; the pre-registered
expectation is **same sign, t ≥ 2 on the fit period**, not a verdict. If the
harness cannot reproduce a Journal of Finance factor on free data, its
verdict on the RVOL selector is worthless; if it can, the RVOL family's
verdict inherits that credibility. The `deriv-positioning` REPORT's
own note — that a shadow control must *fire* comparably often — applies.

### 6.4 The base rate, honestly

In systematic research shops the survival rate from idea to deployed
strategy is low single-digit percent, and a three-week run of 30 kills is
unremarkable. That is true and the user should hear it. It is also, on its
own, an evasion: a filter's kill rate is uninformative until its pass rate on
known positives is measured, and §1 says this filter's pass rate on the
positives the literature actually contains is roughly zero *by design*. The
two things the user is owed are therefore (i) the base-rate statement and
(ii) the sentence "the hurdle is Sharpe ≈ 2 in one year, here is what that
means, here is what would give us power". Nobody has said (ii) to them.

---

## 7. Что сказать пользователю (коротко, без утешений)

Мы не «три месяца ничего не нашли» — мы за три недели проверили тридцать
вариантов одной и той же игры: угадать направление одного индекса или одной
монеты внутри дня и доказать это на одном годе данных. У такой игры есть
жёсткая математика: за один год (~220 сделок) наш фильтр может подтвердить
только стратегию с годовым коэффициентом Шарпа около 2 и выше (Шарп — это
средняя прибыль, делённая на разброс результатов; 2 — уровень лучших
хедж-фондов). В научной литературе ни у одной внутридневной стратегии на
одном индексе такого нет — там честные числа около 0,5–1,5. То есть тридцать
«убийств» — это не «стратегии плохие» и не «фильтр сломан», а «на одном
инструменте за один год нельзя отличить хорошую стратегию от везения». Это
свойство рынка, а не нашей лени.

Что с этим делать — три вещи, и все дешёвые. Первое: проверить сам конвейер
на «подсаженном» сигнале и на известном эффекте (ночная доходность индекса),
чтобы закрыть вопрос «а вдруг сломано» раз и навсегда (§6, два дня). Второе:
дождаться кросс-секционного пакета — пятьдесят монет вместо одной дают в
десятки раз больше наблюдений, и это единственная наша конструкция, которая
способна подтвердить эдж того размера, что реально описан в статьях. Третье:
решить, что именно мы ищем. Если «внутри дня, направление, один инструмент» —
то честный ответ: на индексах без платной истории с 2008 года (≈ $100) у нас
нет данных, чтобы это доказать, а на крипте комиссия съедает 0,1–0,4 единицы
риска на сделку. Если «что-то, что зарабатывает» — то ближайшая по
вероятности вещь у нас уже под рукой: хеджированный кэрри на Binance (лонг
спот, шорт перп, сбор фандинга), который в исследованиях даёт в среднем
больше 10 % годовых, но с риском маржин-колла в обвал. Это не внутри дня и
это не «угадать направление». Выбор — ваш; моя задача была сказать это прямо.

---

## 8. Recommendations, ranked, and what I am explicitly not recommending

1. **Before arm 31:** Tests A, B, C (§6.1–6.3) as one Researcher dispatch,
   fit-period only, pre-registered expectations, no verdicts. Test C is the
   cross-sectional package's Stage 0 and costs nothing extra.
2. **Funding family, before dispatch:** register the mirror of hypothesis B
   (§5.4). One paragraph in the ARCHITECT-NOTE, α = 0.05/5.
3. **Cross-sectional family:** unchanged. It is the right bet for power
   reasons as well as literature reasons. Wait for it.
4. **Holdout length on crypto:** the 2020+ tape supports a two-year holdout
   (2024-08 .. 2026-07) at the cost of one fit year; §1 says that roughly
   doubles what a crypto registration can certify. Worth adopting as the
   crypto convention from the next design onward — not retroactively.
5. **Put the ~$100 CME-history question to the user** in §2.3's terms:
   it buys sixteen years of index tape, not lower costs; without it every
   single-index registration is underpowered by construction.
6. **Ask the user the horizon question once, plainly** (§3), and record the
   answer in `PROJECT.md`. If intraday stays, retire the index-side
   single-instrument line until item 5 is decided, because it cannot produce
   a certifiable result on the current tape.
7. **Basis / hedged carry:** design it with the hedged Schmeling trade as
   the primary and an explicit margin-path model, when the coordinator
   reaches it. Non-intraday; label it so.
8. **Add a power statement to every future DESIGN**: projected n, SE, the
   edge size that passes at 80 % power, and the literature's own number for
   the mechanic beside it. If the second is below the first, the design says
   so before any data is pulled. The LightGBM note already asks for a power
   statement in Stage B; it belongs in Stage 1.

**Not recommended:** loosening the ladder (§1 explains why it is right);
maker-fill assumptions as a rescue of any closed arm (§2.2); a CME venue for
cost reasons (§2.3); vol or variance-premium strategies without an options
venue (§4); market-making or cross-venue basis (§5.1); reopening any closed
ORB / VWAP / session-liquidity family on the strength of this note — §1
does not make them alive, it explains why they could never have been
certified.

---

## 9. Sources

Project files: `research/orb-ny-open/results/{trades_all.parquet,
null_draws.json, holdout_verdicts.csv, holdout_describe.csv,
holdout_cost_sensitivity.csv, fit_forward_lift.csv}`; `research/orb-ny-open/
{engine.py, DESIGN.md}`; `research/cmc-bot-vwap/REPORT.md` §3; `research/
deriv-positioning/REPORT.md` via Запись 8; `research/funding-rate-signals/
ARCHITECT-NOTE.md` §0, §2, §4, §7–§8, §10; the two 2026-09 surveys.

External (secondary sources checked 2026-09-16; primary papers as cited in
the survey): Binance USD-M fee schedule (VIP 0 maker 0.02 % / taker 0.05 %,
BNB −10 %); Capital.com US500 spread 0.4 and overnight funding (SOFR + 4 %
p.a., /365) from capital.com pricing pages and brokerchooser; IBKR micro
futures commissions and CME pass-through fees; FirstRate Data ES page
(continuous 1-minute from 2008-01-02; updates $99.95/yr); Schmeling,
Schrimpf & Todorov, *Crypto Carry*, BIS WP 1087 / Management Science 2024;
Liu, Tsyvinski & Wu, *Common Risk Factors in Cryptocurrency*, JF 77 (2022);
Bailey & López de Prado, *The Sharpe Ratio Efficient Frontier* (J. Risk
2012) and *The Deflated Sharpe Ratio* (2014); Harvey, Liu & Zhu, RFS 29
(2016); Moreira & Muir, *Volatility-Managed Portfolios*, JF 72 (2017);
Baltussen, Da, Lammers & Martens, JFE 142 (2021); HAR out-of-sample
figures from the Portfolio Optimizer HAR note and the MDPI 2026 BTC-HAR
paper; overnight-vs-intraday SPY figures from CXO Advisory and Robot
Wealth summaries; Almeida, Grith & Miftachov, *Risk Premia in the Bitcoin
Market* (arXiv 2410.15195) for the BTC variance risk premium.
