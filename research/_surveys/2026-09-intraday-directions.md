# Survey — what is left to try intraday, after ORB (Architect, 2026-09-16)

**Role:** Architect · **Trigger:** the user's request, after the ORB line closed,
to think broadly about what else is worth trying for intraday trading, with
explicit licence to search the internet and the research literature. **Audience:**
Architect / Researcher / coordinator (role-to-role; technical English). **Not a
registration.** Nothing here is dispatched; the coordinator routes.

**Status of this document:** survey and recommendation. Every number quoted
from an external source is that source's claim, not this project's finding.
Where a source could not be read in full (paywall, bot wall) that is said.

**See also** `2026-09-lightgbm-role.md` (Architect, 2026-09-16): where
LightGBM / ML fits relative to §4.1 and §4.2 — a ranker as the conditional
second step of §4.1, Stage B as a standard clause after any REAL EDGE, no
standalone regime classifier.

---

## 0. The one-paragraph answer

The published intraday edges that this project has now tried and killed —
ORB in every form, VWAP-band reversal, session-liquidity sweeps — share a
property the literature of the last three years has converged on: they are
**unconditional OHLCV mechanics on a single liquid index**, and on the
2022–2026 tape those are dead at realistic costs. Every independent test I
could find says so (§2.4, §2.6). What survives in the same literature is
**conditional**: the edge appears only when information arrival or forced
flow is elevated — a stock "in play" on abnormal opening volume, a session
where dealers are short gamma, a macro-release window — and it is largely
**cross-sectional** (which instrument today) rather than time-series (which
direction on a fixed instrument every day). This project has never run a
cross-sectional or conditioning hypothesis; two of them have sat prioritised
by the user since 2026-08-26 and undispatched while three ORB families ran.
My recommendation (§5) is therefore not a new intraday mechanic on US100/
US500 — that well is dry on this tape at these costs — but (1) a
cross-sectional "instruments in play" family on a wide crypto perp universe,
which is the transplant of the one thing the strongest ORB paper says
actually worked; (2) the already-prioritised funding-rate family, the only
mean-reversion-adjacent idea that does not fight the diagnosed perp
mechanics; and (3) two cheap fit-only *probes*, not registrations, on
market intraday momentum and macro-event continuation, each with a
pre-committed bar that decides whether a registration is ever written.

---

## 1. What is closed, so that nothing below is a re-skin

| line | packages | mechanic shape | verdict |
|---|---|---|---|
| Intraday MR / SMC / hybrid, crypto | `intraday-mr-smc`, `-v2`, `intraday-mtf-smc`, `pivot-structure` | rolling-z fade; order-block/FVG/CHoCH; multi-timeframe | closed; MR negative-signed on perps (Запись 1.1 §2.1); time-of-day filters do not survive a holdout (Запись 2) |
| Session-liquidity sweeps | `session-liquidity` v1–v5 | session-extreme / PDH-PDL sweep + iFVG or BoS confirmation | closed (Записи 10–18) |
| Derivatives positioning | `deriv-positioning` | OI / taker-flow / long-short ratio conditioning | closed (Запись 8) |
| `cmc-bot` VWAP band reversal | `cmc-bot-vwap` | UTC-midnight VWAP expanding band + iFVG + prior-hour sweep, 3R | 4/4 arms closed; placebo beat the strategy on both indices (Запись 22) |
| `cmc-bot` smart-money ICT | `cmc-bot-smart-money` | H1 bias → M1 iFVG | pending its own pass — **not** closed, not touched here |
| ORB, all axes and anchors | `orb-ny-open`, `-short`, `-exit`, `orb-utc0-crypto` | 30/15/10/5-min range, close-beyond trigger, +1R / no target / ratchet / dATR stop; NY and 00:00 UTC anchors | 22 arms, 11 holdout reads, no edge (Записи 23–26); line closed |
| VWAP-MR on CME futures | `vwap-mr-indices` | RTH session VWAP ±kσ touch, revert-to-VWAP | **never run** — paused on paid data; Pine script for manual testing only |

Standing constraints inherited from those passes and not re-argued below:
Capital.com 1-minute tape starts 2024-01-01 (no minute bars before), candles
are bid/ask mids so every round trip costs one full spread, and the CFD
"volume" is broker tick volume, not exchange volume; Binance USD-M 1-minute
tape from 2020-01 for BTC/ETH (verified, gap-free) and 5-minute for 8 perps;
project-standard holdout year 2025-08-01 .. 2026-07-31, now read 11 times by
the ORB line on the index tapes; verdict ladder (kill < +0.05R or p > 0.20;
build ≥ +0.10R, α Bonferroni, fit same sign, n_holdout ≥ 150, day-block
bootstrap excludes 0, gross > 0).

---

## 2. Why the ORB papers find an edge and this project found none

The user asked this directly. Six candidate explanations were listed in the
dispatch; each is ruled on below with what I could verify.

### 2.1 What the papers actually claim, read again

- **Zarattini & Aziz 2023, "Can Day Trading Really Be Profitable?"** (SSRN
  4416622; QQQ, 2016-01 .. 2023-02). Rules per CXO Advisory's summary and the
  paper: observe the first 5-minute candle; **at 09:35 enter in the direction
  of that candle** (no breakout trigger — an immediate directional entry);
  stop at the candle's opposite extreme; target 10R or the close; size so a
  stop loses 1 %; max 4× leverage. Headline: 1,484 % on TQQQ vs 169 % for QQQ,
  33 % annualised alpha. Assumptions the paper states: $0.0005/share
  commission, **no bid-ask spread, no slippage**, fills at the recorded
  09:35 and 16:00 prints. The 9,350 % variant "comes from a parameter search"
  (danfin.net's reading).
- **Zarattini, Barbon & Aziz 2024, "A Profitable Day Trading Strategy for the
  U.S. Equity Market"** (SSRN 4729284; ~7,000 US stocks, 2016–2023). Rules:
  resting stop order beyond the first 5-minute high/low in the first candle's
  direction; stop 10 % of the 14-day ATR; EoD exit; $0.0035/share. The
  paper's own attribution, quoted by danfin.net: **the plain 5-minute ORB on
  all liquid stocks returned 29 % total against 198 % for the S&P 500 (Sharpe
  0.48 vs 0.78)**; selecting the top-20 stocks by *opening relative volume*
  turned that into 1,637 %. Per-trade: **about −0.02R below 100 % relative
  volume, +0.08R above 100 %, +0.38R above 3,000 %.** Their words: "a simple
  five-minute ORB applied broadly across liquid US stocks was not enough to
  produce an attractive historical result."
- **Zarattini, Aziz & Barbon 2024, "Beat the Market"** (SSRN 4824172; SPY,
  2007 .. 2024-02). Not ORB: a minute-by-minute **noise boundary** = open ×
  (1 ± average |move-to-this-minute| over the last 14 days), gap-adjusted;
  enter on a breach at half-hourly checks; trail on the boundary or VWAP;
  flat at the close; 1,985 % net, Sharpe 1.33, hit rate ~43 %. This is the
  volatility-scaled, time-of-day-scaled ORB the backlog flagged as untested.
  The quantmacro review calls the results "a bit too good to be true", notes
  execution assumptions are unstated, and that robustness is limited to SPY.
- Concretum's paper list (fetched 2026-09-16) has **no futures paper and no
  independent replication**; it is a practitioner shop publishing its own
  positives, which matters for 2.2.

### 2.2 (a) Publication / survivorship bias — CONFIRMED as a large part of the gap

The three ORB-adjacent papers are all from one group, all positive, all
full-sample backtests with no holdout. The one systematic *negative* study I
found says it in its abstract: "Survivorship bias means most published work
shows only the things that worked" (Mesfin 2026, §2.4). CXO Advisory's
review of the QQQ paper is paywalled past the rules; the visible part lists
the zero-spread / zero-slippage assumption and stops. QuantifiedStrategies
(Feb 2026, bot-walled at fetch time; search snippet only) states that ORB
"doesn't work very well anymore". So the published record on ORB is
one positive group, one paywalled reviewer, and independent negatives.

### 2.3 (b) The entry construction — PARTLY DIFFERENT, and it is NOT the source of the edge

The papers' entry (first-candle direction at 09:35; or a resting stop order)
is genuinely different from this project's close-beyond trigger, and this
project has not tested it. But three things say it is not where the money
was: (i) the 2024 paper's own decomposition (2.1) — the plain entry on
liquid stocks underperformed buy-and-hold, and the selection did the work;
(ii) Mesfin 2026 tested the 09:30–09:55 range with **immediate (bar+1),
delayed (bar+15) and pullback** entries on MNQ 2021–2025 and every variant
failed (best: long bar+15, +2.82 pts net, T = 1.50, driven by 2024 alone:
2022 −1.42 / 2023 +2.43 / 2024 +7.04; pullback entry 80.7 % stop-out rate);
(iii) on this project's tapes the 5-minute range was already the `OR5` arm
(fit +0.048R US100, −0.030R US500, screened out) and the papers' tight stop
is cost-dead at CFD spreads (projected `cost_R` 0.09–0.15R for a 5 %-ATR
stop, exit note §4.2). The 2023 paper's stop *is* the first candle's range,
i.e. our `OR5` stop, at zero assumed spread. **Ruling: the entry variant is
logged and will not be registered on a single index** (IDEAS-BACKLOG ORB
entry, final status).

### 2.4 (c) Instrument and venue — CONFIRMED as decisive, in two ways

*Costs.* QQQ trades at a 1-cent spread on a ~$450 print (≈ 0.02 bp) and the
papers assume even that away. Capital.com US100/US500 CFDs pay a full spread
per round trip on bid/ask-mid candles: ≈ 1.8 points on US100 and ≈ 0.45 on
US500 (exit note §7). At a full-range stop that is a tolerable 0.027–0.041R;
at the papers' stops it is 0.045–0.15R. A +0.08R/trade edge (the 2024
paper's above-100 %-RVOL number) does not survive the second regime. The
crypto rows were worse still (`cost_R` 0.08–0.10R at NY, 0.14–0.20R at
00:00 UTC).

*Cross-section.* The 2024 paper's edge is a **selection across 7,000
stocks** of the ~20 with the most abnormal opening volume — news-driven names.
A single index has no cross-section; the project's time-series analogue
`or_rvol` was a Study B feature and was not flagged (SHAP direction −0.51 on
5m, wrong sign). So the venue question is not "CFD vs ETF" only; it is
"one instrument vs a ranked universe". This is the single most important
finding of the survey and drives candidate §4.1.

### 2.5 (d) Regime — CONFIRMED; this project's tape is the dead regime

The QQQ sample (2016–2023) and the SPY sample (2007–2024) contain 2008,
2020 and 2022. Every recent independent test locates whatever ORB / intraday
momentum edge exists in elevated-volatility years and finds it gone after:
Mesfin's ORB gross edges of ~0.8–1.5 points sit in 2021–2022 and fail
2023–2025 ("one strong year masking flat or negative other years" is his
most common failure mode); firmtape's 0DTE-era retest of market intraday
momentum on 1,085 SPX sessions 2022-04 .. 2026-08 is **flat in every year**
(slopes +0.009 / +0.002 / −0.016 / +0.016 / −0.012, overall t = +0.6) and
survives only on the ~15 % of sessions where dealers are short gamma at
15:30 (slope +0.055, t = 3.1); QuantConnect's replication of Gao et al. on
2015–2020 gives Sharpe −0.63 outside the 2020 crash. This project's fit
period is 2024-01 .. 2025-07 and its holdout 2025-08 .. 2026-07: entirely
inside the period where the independent tests say the effect is absent. The
minute-bar floor of the Capital.com tape (2024-01) means this project
*cannot* test the papers' regime on these instruments; that is a data
statement, not a hypothesis.

### 2.6 (e) Range / trigger conventions — NOT the explanation

The first-5-minutes convention was tested (`OR5`); the 5/10/15/30 ladder is
closed with the shape running the *wrong* way (wider better on US100, no
shape on US500). Volatility-scaled width: Study B carried two volatility
features and flagged neither; the "noise area" of *Beat the Market* is the
published version, and its reviewer flags unstated execution and SPY-only
robustness. The independent MNQ study's Asia-session range-expansion family
(bars > 1.5×/2×/2.5× the rolling range) is negative at every threshold
(T −0.90 to −10.96). Nothing here suggests a convention this project missed.

### 2.7 (f) Statistics — CONFIRMED; the papers make a weaker epistemic claim than this project requires

None of the three Zarattini papers has a train/test split, a permutation or
placebo null, or a multiple-testing correction; each is one full-sample
backtest with parameter exploration reported as sensitivity. Harvey, Liu &
Zhu (RFS 2016) put the hurdle for a newly claimed effect at t > 3.0 given
the amount of mining in the literature; Bailey & López de Prado's deflated
Sharpe ratio exists because a backtest's reported Sharpe is the maximum over
the variants tried. Under this project's standard the papers' results are
**hypotheses**, and this project's three families were their out-of-sample
test on a different venue and a later regime. A kill under that standard is
consistent with the papers, not in contradiction with them — they never
claimed what this project demands before saying REAL EDGE.

**Summary ruling on question 1:** the gap is explained by (c) cross-section
+ costs, (d) regime and (f) statistics, with (a) as the reason the positive
papers are the visible ones. (b) is real but not the source of the edge; (e)
is not the explanation. Nothing in it argues for reopening ORB on a single
index.

---

## 3. What the literature says survives, 2022–2026

Sources read for this section: Gao, Han, Li & Zhou (JFE 2018, "Market
intraday momentum": first half-hour return predicts the last half-hour, SPY
1993–2013, OOS R² 1.4–2.0 %, stronger on volatile / high-volume / macro-news
days); Baltussen, Da, Lammers & Martens (JFE 2021, full text read: 60+
futures 1974–2020, last-30-minute return predicted by the rest-of-day return,
timing-strategy Sharpe 0.87–1.73 gross, **reverts over the next days**,
mechanism = gamma hedging by option market makers and leveraged-ETF
rebalancing; they state that the net Sharpe on S&P 500 futures is positive
only at ~1-tick costs); Baltussen, Da & Soebhag (2025, "End-of-Day
Reversal": *individual stocks* reverse in the cross-section in the last 30
minutes, distinct from market momentum, driven by retail attention buying and
short-seller risk management — **cross-sectional, not applicable to an
index**); Heston, Korajczyk & Sadka (JF 2010): return continuation at exact
daily lags in the cross-section of stocks; Bogousslavsky (JFE 2021): anomaly
returns accrue at different times of day, last-30-minute returns reverse the
next morning — cross-sectional; Lou, Polk & Skouras (JFE 2019): overnight vs
intraday "tug of war" — cross-sectional; Shen et al. (Financial Review 2022,
"Bitcoin intraday time series momentum": with the trading day defined by
volume, the first half-hour predicts the last half-hour in and out of sample,
strongest on high-volume/volatility sessions, attributed to liquidity
provision — abstract only, full text bot-walled); Wen, Bouri, Xu & Zhao
(NAJEF 2022): Bitcoin shows both intraday momentum and reversal, pattern
changes around jumps, FOMC and liquidity; an MDPI JRFM 2026 paper (Kraken
hourly 2016–2025): BTC conditional *reversal* in both 12-hour sessions, ETH
overnight drift + daytime reversal — with the session start chosen by search
(08:00 vs 05:00 UTC), which is p-hacked by construction; Quantpedia /
Padyšák–Vojtko (2015–2021): BTC 22:00–23:00 UTC carries the day's positive
return (already in the backlog as the US-hours-drift entry); a 2026 ES/NQ
30-minute seasonality note (quanttraderjournal, 2019–2024): opening and
closing 30 minutes carry +1.8–2.8 bp/window, t 2.1–2.8, "marginal but
positive" after 2 bp costs — unverified single source; Mesfin 2026 (arXiv
2605.04004, full text read): 14 OHLCV signal families on MNQ 5-minute bars,
947 days 2021-12 .. 2025-08, walk-forward, T ≥ 2, N ≥ 30, 2-point friction,
year-stability — **nothing passed**; gross edge ceiling 0.07–1.50 pts/trade
vs 2.0 pts friction; gap-fill fade fails at 09:30/09:45/10:00; the only
near-pass is a gap-continuation short with N = 22; **post-announcement
"drift" is entirely inside bars 1–5 of the release, T 0.14–0.69 from bar 6**;
his two positive controls (regime-classifier + volume-z conditioned entries,
T 5.8 and 5.2, permutation p < 0.001) are claims from a separate program,
definitions insufficient to replicate, and I treat them as unverified.

Four regularities across those sources:

1. **Unconditional single-instrument OHLCV mechanics are dead on 2022–2026
   index tapes at realistic costs** — ORB, gap fade, VWAP rejection, volume
   spikes, cross-session momentum, and the classic market intraday momentum.
2. **The surviving directional effects are conditional on elevated
   information arrival or forced flow**: macro-news days, high-volume days,
   dealer short-gamma days, stocks in play. Conditioning variables this
   project can get for free: exchange volume (crypto only — CFD volume is
   tick count), the release calendar, cross-sectional relative volume across
   a universe. Not free: dealer gamma (SqueezeMetrics/CBOE), options flow.
3. **The robust intraday effects are cross-sectional** (which instrument
   today), and this project has never run one.
4. **Mean reversion at the index level has no academic support intraday**;
   the reversion effects with support are cross-sectional stock effects
   (end-of-day, overnight/intraday) or next-day reversal of the momentum
   itself. The practitioner VWAP-reversion evidence (QuantConnect 2022: ±2σ
   band touches on 100 NASDAQ *stocks*, 61–63 % win rate) is, again,
   cross-sectional stocks, not an index.

---

## 4. Candidate directions

For each: what it is, why it is not a re-skin of a closed mechanic, data and
build, and a "dispatch now / wait" read. Ranked in §5.

### 4.1 Cross-sectional "instruments in play" — relative-volume selection + directional continuation, wide crypto perp universe

**What.** Each day at a fixed anchor (the US cash open 13:30 UTC is where the
NY-anchor forward lift lived; 00:00 UTC is the crypto-native alternative and
is *not* the primary), rank a universe of N ≥ 50 Binance USD-M perps by
**opening relative volume** = volume in the first 30 minutes ÷ median of the
same window over the prior 14 days. Take the top k (k = 3–5, pre-registered).
Direction = sign of the return from the anchor to +30 min (a direction reader
with no range, no trigger and no range stop). Stop = a pre-registered
fraction of the instrument's 14-day ATR, on a small ladder printed in full;
exit at a fixed horizon (e.g. +4 h) or the stop; one trade per instrument
per day; dollar-neutral across the basket is a secondary row, not the
primary (the primary is directional, as in the paper). Controls: the same
mechanic on the *bottom*-k by relative volume (the paper's −0.02R tier) and on
a random-k draw — both are the pre-registered nulls, and they are what makes
this a test of *selection* rather than of the direction reader.

**Why it is different.** The closed ORB arms tested "does a range break on
this one index predict continuation" every day; this tests "does abnormal
attention select which instruments continue" — the variable the 2024 paper
says carried the whole result (−0.02R → +0.08R → +0.38R across RVOL tiers)
and which a single index cannot express. The direction reader is deliberately
the plainest possible so that a pass attributes to the selector. It also
answers the crypto-anchor family's finding — no anchor selects direction on
BTC/ETH — with the reply that BTC/ETH are the two *least* likely coins to be
"in play" on any given day.

**Overlap with the backlog.** The user-prioritised "Cross-sectional relative
momentum, dollar-neutral, 8-perp universe" (2026-08-26) shares the portfolio
harness and the cross-sectional frame but ranks on trailing *return*; this
ranks on *relative volume*. They should be one package with two
pre-registered selectors (RVOL; trailing return) and a pre-registered
comparison, not two packages, and the universe must be widened from 8 to ≥ 50
(8 is too thin to rank, as that entry already says).

**Data / build.** `data.binance.vision` has 1-minute klines for every USD-M
perp from listing; free, no key, and the history-depth audit procedure from
`orb-utc0-crypto/prep/extend_history.py` is reusable. Universe membership
must be fixed by a survivorship-free rule (all perps listed ≥ 30 days before
the day, including delisted ones — delistings are available from the same
archive's month list). New engine work: a small portfolio-level harness (one
account, k legs, netted risk) — the cross-sectional entry already scopes it.
Costs 0.10 % round trip taker per leg; `cost_R` will be 0.1–0.3R at ATR-
fraction stops, so the +0.08R tier of the paper is *not* enough and the
family's honest target is the +0.38R top tier — say so in the DESIGN.

**Holdout.** Crypto tapes: fit 2020-01 .. 2025-07, project holdout
2025-08 .. 2026-07 — the holdout year has been read by crypto ORB arms
(4 in `orb-ny-open`) and cmc-bot crypto arms (2); a new line starts its
own count but declares the prior reads.

**Prior.** Moderate — the only candidate here whose external evidence is a
per-trade decomposition rather than a headline equity curve. Likeliest
outcome: the selector works on the top tier only, at a frequency that is
thin (top-5 across 50 coins, but a coin in play is often a coin with a
pump-and-dump, so a pre-registered "delisted within 30 days" exclusion and a
cost-sensitivity row are mandatory). **Dispatch: now, as the first
cross-sectional package**, merged with the prioritised cross-sectional item.

### 4.2 Funding-rate signals (carry; funding-extreme continuation) — already prioritised, never dispatched

**What.** The backlog entry of 2026-08-26 (prioritised by the user, undispatched
since): (a) funding carry — hold the paying side when funding is in its top
rolling percentile, price stop; (b) funding-extreme continuation — extreme
funding + price moving with the crowd predicts the squeeze once price turns.
Nothing in this survey changes that design; what it adds is the reason it
ranks above any new price-only mechanic.

**Why it is different.** It is the only mean-reversion-adjacent idea in the
project that *uses* the mechanism the project's one confirmed diagnosis rests
on (liquidation/funding self-reinforcement) instead of fighting it. The
crypto MR line died on sign; VWAP-MR on indices has no academic support (§3
item 4) and the cmc-bot placebo beat it; the index tapes cannot host a
mechanism test because CFD volume is not volume. Funding is the one
non-OHLCV input already free on disk-adjacent archives.

**Data / build.** `data.binance.vision` fundingRate history, same archive
family, 2020-01+ for BTC/ETH; per-symbol coverage check first. Per-asset
engine as is. Costs 0.10 % round trip; holding across settlements is the
point, so funding is modelled as P&L, not as a cost.

**Prior.** Low-to-moderate, and the honest worry is the one the entry already
states: funding may proxy the same continuation effect `momentum_breakout`
measured, so the pre-registered "does it add anything beyond price momentum"
comparison is mandatory. **Dispatch: next after 4.1, or in parallel — it is
per-asset and needs no new harness.**

### 4.3 Market intraday momentum — a fit-only *probe*, not a registration

**What.** The Gao / Baltussen predictor and target, computed on tapes already
on disk, on the fit period only, with no trade construction: on US100/US500
(Capital.com, 2024-01 .. 2025-07), regress the 15:30–16:00 NY return on the
return from the prior 16:00 to 15:30 (`r_ROD`) and on the first-half-hour
return; on BTC/ETH (Binance 1m, 2020-01 .. 2025-07), the same with the
trading day defined by the volume profile (Shen et al.'s device: the
30-minute window of peak median volume is the "open" — expected to be 13:30
UTC; 00:00 UTC as a second definition, since the anchor study measured it as
the volatility peak). Report slope, t, by year, by volatility tercile, by
scheduled-release day vs not. **Pre-committed bar to earn a registration:
pooled t ≥ 3.0 (Harvey–Liu–Zhu) on the *conditional* row (high-volatility
tercile or release days), with the sign stable in every year, and a
back-of-envelope net of one full spread / 0.10 % that stays positive.**
Otherwise the probe closes the family and is logged as such.

**Why a probe and not a family.** The most relevant external evidence says
the unconditional effect is gone on the S&P since 2022 (firmtape: 1,085
sessions, flat every year) and survives only on dealer-short-gamma days (a
variable this project cannot buy); QuantConnect's 2015–2020 replication is
negative outside the 2020 crash. On crypto, Shen et al. is positive but ends
before the ETF era and reports gross numbers; the cost of a 30-minute
round trip at 0.10 % against a few-bp expected move is the killer. Spending
a registration and a holdout read on this would be spending them on a
hypothesis whose best evidence is a decade old. A probe costs a day and no
holdout.

**Why it is different from ORB.** No range, no trigger, no stop: it is a
sign-conditional fixed-window hold, and the crypto version's "open" is
defined by volume, not by a clock story. It is the family the ORB forward
lift (> 1 at the NY anchor) would belong to *if* the lift were harvestable
without a stop — the exit family showed every stop truncates it; this asks
whether a no-stop, fixed-horizon hold does better, without paying a
registration to find out.

**Dispatch: as a one-day Researcher probe, fit-only, any time; not before
4.1.**

### 4.4 Scheduled-macro-event continuation — a fit-only probe on BTC/ETH; indices descriptive only

**What.** The backlog's "Scheduled-macro-event reaction, BTC/ETH" (logged
2026-08-26, not prioritised) — measure the first 5–15 minutes after CPI /
FOMC / NFP, enter with it, fixed horizon. The economic-calendar
infrastructure was designed 2026-09-16 (`architecture/economic-calendar.md`)
and the historical event table is hand-assembled from BLS/Fed schedules.

**What this survey adds, and it is a downgrade.** Mesfin 2026 measured
exactly this on MNQ 2021–2025 and found the post-release "drift" to be
entirely contained in bars 1–5 of the release, with T between 0.14 and 0.69
from bar 6 onward — i.e. the first-N-minute reaction does not continue on the
Nasdaq. On BTC the evidence is that the *contemporaneous* reaction has become
large (Block Scholes 2026: 1-hour beta to CPI surprise ≈ −3.2 % per pp, R²
rising toward 80 % through 2026 — a latency race, not a strategy), that BTC
"sold the news" after 7 of 8 FOMC decisions in 2025 (CoinGecko — 8 events,
not evidence), and a 2026 KSE thesis (65 CPI prints, 44 FOMC days 2020–2025)
that I could not read past the abstract. Sample size is structurally thin:
~32 events/year, so ≥ 150 holdout events needs ~5 years of holdout on one
instrument — on the 2024-01 index tape that is unreachable before ~2029; on
BTC 2020+ it is reachable only by pooling fit and using a rolling holdout.

**Dispatch: a fit-only probe on BTC/ETH (2020-01 .. 2025-07, ~180 events)
measuring bar-6+ continuation vs the bar-1–5 spike, with the same t ≥ 3.0
bar as 4.3; indices as a descriptive row only. Not before 4.1 and 4.2.** The
calendar build proceeds on its own merits (it is infrastructure for the news
pillar regardless).

### 4.5 Considered and NOT proposed

- **VWAP mean reversion as a standalone, on any tape.** Academic support for
  index-level intraday reversion to VWAP: none found (the 2026 SSRN FX/gold
  "VWAP framework" papers are single-author rule sets without holdouts; the
  Zarattini VWAP paper is a *trend* rule — long above / short below VWAP on
  QQQ, 671 % 2018–2023, same zero-slippage caveats — not reversion). The
  practitioner evidence is cross-sectional stocks. On Capital.com the VWAP
  itself is computed on tick volume, so the mechanism claim ("institutional
  benchmark execution attracts price") cannot be tested there at all; on CME
  futures it needs paid data the user has declined. The cmc-bot pass's
  placebo beat the VWAP-band mechanic on both indices. `vwap-mr-indices`
  stays where it is: paused, Pine-only, no registration. If VWAP returns it
  is as the *regime/side classifier* or trailing reference inside another
  family (as *Beat the Market* uses it), never as the trigger.
- **The papers' ORB entry, volatility-scaled ORB / noise area, gap fade,
  gap-conditioned ORB, any anchor.** §2; closed by ruling in the backlog.
- **Dealer-gamma-conditioned last-half-hour momentum.** The one conditional
  form of market intraday momentum with fresh positive evidence (firmtape:
  slope +0.055, t = 3.1 on short-gamma sessions), but the conditioning
  variable is paid options-positioning data and the effect covers ~15 % of
  sessions. Logged as reference only.
- **End-of-day reversal / HKS daily-lag periodicity / overnight-intraday tug
  of war on crypto.** All cross-sectional stock effects; a crypto
  cross-section version (return at hour h today predicts return at hour h
  tomorrow across a perp universe) is untested anywhere I found — interesting,
  but with no external evidence it is a fishing licence, and the portfolio
  harness of 4.1 is the prerequisite anyway. Logged, not proposed.
- **BTC time-of-day carry (US-hours vs off-hours).** Already logged
  2026-09-16 with its reasons for non-registration; nothing new found.
- **Regime-classifier-conditioned entries (Mesfin's positive controls).**
  Unverifiable from the paper; reproducing them would be inventing them.
- **Index momentum on the 1-hour Yahoo tape.** v2 found the momentum family
  positive-leaning on SPY (PF 1.17–1.18) — that was the seed of the ORB
  line, and the ORB line is its answer.

---

## 5. Ranking and recommendation

| rank | direction | genuinely new axis | data | build | prior | when |
|---|---|---|---|---|---|---|
| **1** | §4.1 cross-sectional "in play" (RVOL selector) + trailing-return selector, wide crypto perp universe | cross-section; attention conditioning | free (Binance archive), needs a ≥ 50-perp pull with delistings | portfolio harness (new, small) | moderate | **dispatch now**; merges the prioritised cross-sectional item |
| **2** | §4.2 funding-rate signals | non-OHLCV input; monetises the diagnosis | free (Binance funding archive) | none new | low-to-moderate | **dispatch next or in parallel**; prioritised 2026-08-26, still undispatched |
| 3 | §4.3 market intraday momentum probe (indices + crypto, volume-defined day) | no-stop fixed-window hold; conditional rows | on disk | none (fit-only script) | low unconditional; unknown conditional | one-day probe, after 1 |
| 4 | §4.4 macro-event continuation probe, BTC/ETH | news pillar; conditioning on information arrival | on disk + hand-built calendar | none (fit-only) | low (MNQ evidence negative) | one-day probe, after 1–2 |
| — | VWAP-MR standalone; any ORB form; gap fade | — | — | — | — | **not proposed** |

**Top recommendation: §4.1.** It is the only direction where the strongest
positive paper's *own attribution* points, it is the axis this project has
never tested (cross-section), it sits on free data with a verified audit
procedure, it absorbs a user-prioritised item that has waited three weeks
behind three ORB families, and its nulls (bottom-k, random-k) make a pass
attributable to selection rather than to the direction reader. Its honest
risks are stated in §4.1: thin top tier, pump-and-dump contamination, and
`cost_R` that only the paper's top RVOL tier would survive.

**What I would tell the user in one sentence:** on one index, at CFD costs,
on the 2024–2026 tape, the published intraday edges are not there — every
independent test agrees with our 22 kills — and the next thing worth a
registration is not a better trigger on US100 but *which instrument to be in
today*, on a market where we have real volume and fifty instruments to
choose from.

---

## 6. Sources

Read in full or in substantial part: Baltussen, Da, Lammers & Martens,
*Hedging demand and market intraday momentum*, JFE 142 (2021) 377–403
(https://academicweb.nd.edu/~zda/intramom.pdf); Mesfin, *Structural Limits of
OHLCV-Based Intraday Signals in MNQ Futures*, arXiv:2605.04004 (May 2026)
(https://arxiv.org/abs/2605.04004); Baltussen, Da & Soebhag, *End-of-Day
Reversal* (April 2025) (https://academicweb.nd.edu/~zda/EOD.pdf), abstract and
introduction; firmtape, *Is intraday momentum still alive?* (2026)
(https://dev.to/firmtape/intraday-momentum-is-dead-in-the-0dte-era-we-measured-it-on-1085-spx-sessions-43g0);
danfin.net, *Opening Range Breakout Research: What Two Day-Trading Papers
Actually Found* (https://danfin.net/opening-range-breakout-research); CXO
Advisory on the QQQ paper (rules and assumptions; results paywalled)
(https://www.cxoadvisory.com/technical-trading/day-trading-with-an-opening-range-breakout-strategy/);
quantmacro, *Paper Review: An Effective Intraday Momentum Strategy*
(https://quantmacro.substack.com/p/paper-review-an-effective-intraday);
QuantConnect, *Intraday ETF Momentum* replication
(https://www.quantconnect.com/research/15348/intraday-etf-momentum/);
algorithmictoken, *Strategy Lab #3* (summary of Mesfin)
(https://algorithmictoken.substack.com/p/strategy-lab-3-the-signals-that-dont);
Quantpedia, *Are there seasonal intraday or overnight anomalies in Bitcoin?*
(https://quantpedia.com/are-there-seasonal-intraday-or-overnight-anomalies-in-bitcoin/);
quanttraderjournal, *Intraday seasonality patterns in futures markets*
(https://quanttraderjournal.com/articles/intraday-seasonality-futures);
Concretum Group paper list (https://concretumgroup.com/papers/).

Abstract / search-snippet only (full text paywalled or bot-walled at fetch
time, 2026-09-16): Zarattini & Aziz 2023 (SSRN 4416622); Zarattini, Barbon &
Aziz 2024 (SSRN 4729284); Zarattini, Aziz & Barbon 2024 *Beat the Market*
(SSRN 4824172); Zarattini & Aziz 2023 *VWAP — The Holy Grail for Day Trading
Systems* (SSRN 4631351); Gao, Han, Li & Zhou, *Market intraday momentum*, JFE
129 (2018); Heston, Korajczyk & Sadka, JF 65 (2010); Bogousslavsky, JFE 141
(2021); Lou, Polk & Skouras, JFE 134 (2019); Shen, Urquhart & Wang, *Bitcoin
intraday time series momentum*, Financial Review 57 (2022); Wen, Bouri, Xu &
Zhao, NAJEF 62 (2022); *On the Performance of Lagged Momentum and Reversal
Strategies Across Daytime and Overnight Sessions in Bitcoin and Ethereum*,
JRFM 19(9):692 (2026); Harvey, Liu & Zhu, RFS 29 (2016); Bailey & López de
Prado, *The Deflated Sharpe Ratio* (2014); QuantifiedStrategies ORB and
intraday-momentum pages (bot wall); Block Scholes, *Is Bitcoin showing greater
sensitivity to US CPI releases again?* (2026); Nazaruk, KSE thesis (2026).
