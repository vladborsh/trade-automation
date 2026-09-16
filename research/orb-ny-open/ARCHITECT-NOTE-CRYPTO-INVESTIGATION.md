# Architect note — is there a crypto-native "session open" for ORB? Research, ruling, and one registration

**Date:** 2026-09-16 · **Status:** ruled, **GO — narrowly, one family, one
shot**, routed to the coordinator for a Researcher dispatch. This note is the
binding pre-registration for the family **`orb-utc0-crypto`**. It is written
in the form of `ARCHITECT-NOTE.md` and `ARCHITECT-NOTE-FOLLOWUP.md` and
inherits everything from them it does not explicitly change. Inputs:
`ARCHITECT-NOTE.md` (`7ff19fc`), `ARCHITECT-NOTE-FOLLOWUP.md` (`86ddf55`),
`DESIGN.md`, `REPORT.md` §4.2 (the two crypto controls), `RESEARCH-LOG.md`
Записи 2, 17, 18, 22, 23, `research/cmc-bot-vwap/ARCHITECT-NOTE-STAGE1.md`
§4.1, `knowledge/session-liquidity.md` §1 (the project's UTC session blocks),
`IDEAS-BACKLOG.md` (ORB and funding-rate entries), and the external sources
cited inline in §2.

**What I knew when I wrote this.** Like the follow-up note, this one was not
written blind: I have read the eight holdout verdicts, the crypto weekend and
pre-ETF rows, S1/S2, and Study B's zero flags. §3.3 lists every design choice
below that those numbers could have influenced and says what actually drove
it. **No number in this note was computed on any tape for this note.** Every
count is a projection or a quotation from `REPORT.md`, and is labelled.

The user's request, as dispatched: do not accept "crypto is closed" as the
last word; form an independent view of why the crypto arms were dropped;
research, with external sources, whether a *different, properly justified*
opening-range structure exists for a 24/7 market; if one does, register it
with the project's rigor; if none does, say so plainly.

---

## 0. Summary of rulings

| # | question | ruling |
|---|---|---|
| 1 | why crypto was dropped | **Correctly, for the anchor that was tested.** The imported 09:30 NY anchor was registered as a weaker hypothesis with a falsifying control; the control (pre-ETF row ≈ ETF-era row, both at zero) fired. External literature independently agrees that the US spot ETFs did **not** create a structural break in when bitcoin moves (§2.6). What was closed is *the imported NY anchor*. **No crypto-native anchor has ever been tested by this project.** (§1) |
| 2 | is there a crypto-native "open"? | **Yes, exactly one defensible candidate: 00:00 UTC.** It is where three structural events coincide every day of the week — the daily candle/settlement boundary on every venue (the Binance daily-candle reset the project already uses for VWAP), the 8-hour perpetual **funding settlement** (00:00/08:00/16:00 UTC on Binance, Bybit, OKX), and the **Tokyo cash open** (09:00 JST) — and it is independently measured as the most volatile hour of the day and a volatility peak on BTC/USDT (§2.5). None of that depends on New York. (§3) |
| 3 | the other candidates | **Not registered, each for a stated reason** (§2, §5): the CME futures open/weekend gap (CME went 24/7 on 2026-05-28 — the anchor ceased to exist *inside the project's holdout*); the ETF NAV fixing 15:00–16:00 NY / CME daily settlement (a *close*, not an open; the known effect is a drift, not a breakout); 08:00 UTC (funding + Deribit settlement + London open — a real event, but DST-shifting and less evidenced than 00:00; run as a **fit-only descriptive anchor row**); 16:00 UTC (funding only; fit-only row); a volume-defined "open" (the literature's own answer, which points at US hours — already tested); the forex "Asian-range breakout at London open" (trader lore with weak backtests). |
| 4 | the family | **2 arms: `BTCUSDT-UTC0`, `ETHUSDT-UTC0`** — the closed pass's mechanic **verbatim** (30-minute range from 1m bars, first 5m close beyond in a 2-hour window, stop = opposite side, +1R template gates, pure-ORB secondary, one trade/day), with **only the clock substituted**: range 00:00–00:30 UTC, trigger 00:30–02:30 UTC, forced flat 07:55 UTC, **all seven days**, no holiday calendar, no DST. One thing changes so the answer is about the anchor and nothing else. (§4) |
| 5 | Bonferroni | **Cumulative over every pre-registered look at the 2025-08 .. 2026-07 holdout: 8 + 6 + 2 = 16 → α = 0.05/16 = 0.003125.** Kill bar +0.05R, build bar +0.10R unchanged. **Fit-period screen** (follow-up §5.3) before any holdout look. (§4.7) |
| 6 | built-in falsification | Three controls that can kill the *story* even if a number passes: (a) **weekday vs weekend split** with a pre-committed reading — a crypto-native reset must work on Saturdays; if it works only Mon–Fri it is the Tokyo open, i.e. an imported anchor again; (b) a **Tokyo-holiday row**; (c) **fit-only anchor rows at 08:00, 16:00 and 04:00 UTC** — the last has no story at all and is the placebo anchor. (§4.8) |
| 7 | history | **Fit extended as deep as Binance USD-M history goes** (expected 2020-01 for both symbols on `data.binance.vision`; Researcher verifies), holdout unchanged at the project standard. Era sub-rows (pre/post 2021-11, pre/post 2024-01) descriptive. Per the user's stated preference for deepest available crypto history. (§4.5) |
| 8 | honest prior | **Low.** Stated to the user in §6. Three standing nulls on clock structure in crypto; the best-documented activity peak of the crypto day (the US open) gave zero in both eras. **This is the crypto ORB line's second and last shot**: a kill closes it on *every* anchor, because the fit-only rows will already have shown whether 08:00/16:00 look any different. |
| 9 | what the follow-up ruling gets revised | `ARCHITECT-NOTE-STAGE1.md` §4.1 and `ARCHITECT-NOTE.md` §2.2 called UTC midnight "the Binance daily-candle boundary and nothing more". **That sentence was written without the literature and is withdrawn** — it is also the funding settlement, the Tokyo open, and the measured volatility peak. The Stage-1 rejection of a UTC-midnight *VWAP reset* stands on its own reasons (zero-width band at the reset) and is not touched. |

---

## 1. Ruling 1 — why the crypto arms were dropped, read independently

I re-read the evidence rather than the coordinator's summary. Three facts,
in order of weight:

1. **The registered hypothesis was falsified by its own control.** The
   crypto arms were never "ORB on crypto"; `ARCHITECT-NOTE.md` §2.1 registered
   *"the US equity cash open, transmitted through ETF flow and index
   correlation, imprints a tradable opening range on BTC/ETH on NYSE trading
   days"* — an ETF-era, imported-flow story — and attached a pre-ETF row that
   the story said must be weaker. `REPORT.md` §4.2: pre-ETF 2022-08 .. 2023-12
   gives −0.020R .. +0.027R against an ETF-era fit of −0.044R .. +0.004R. Not
   weaker; both at zero. The pre-registered reading was written before any
   number existed and it was applied: the transmission story gets no support.
2. **The arms themselves are a well-powered null.** 208–228 holdout trades
   per crypto arm, gross expectancy near zero, `cost_R` only 0.07–0.10R. The
   edge is absent, not eaten. `ETHUSDT-15m` at +0.047R / p = 0.024 is the
   one number a motivated reader would cling to; it fails the kill bar by
   rule and its fit period was −0.044R.
3. **The weekend row is the only strong signal, and it points the wrong way
   for the anchor story.** Same mechanic on Sat/Sun: −0.29R .. −0.41R on
   every arm, fit and holdout. Read literally: a 30-minute range formed at a
   clock point with *no* flow event is a range whose breakouts fail badly.
   The pre-registration forbade inferring anything from it because no arm
   passed, and that discipline was right. But as a design fact for *this*
   note it matters: the mechanic is sensitive to whether the range-forming
   window contains real activity. A crypto-native anchor must be one where
   the tape is demonstrably active **every day**, weekends included — that is
   the test §4.8(a) builds in.

So the drop was correct, and the follow-up note's sentence "the crypto ORB
line is closed on width and timing" is correct **for the 09:30 NY anchor**.
The same note said explicitly (§6.1, §9): *"a different anchor is a different
hypothesis; if the user wants one, it is a fresh Architect ruling with its own
family."* This is that ruling. What was never tested — by this project or, as
far as I can find, in any published form — is an opening range anchored to
something the crypto market does *itself*.

---

## 2. What the external research found, candidate by candidate

Sources are cited inline; every factual claim below about market structure
was checked against a primary or near-primary source. Where I could only
reach an abstract, I say so.

### 2.1 CME bitcoin / ether futures: a real open — and it just stopped existing

- Until May 2026 CME crypto futures traded Sunday 17:00 to Friday 16:00
  Central Time with a **60-minute daily halt 16:00–17:00 CT** and a weekend
  closure; daily settlement is computed from Globex trading in the
  **14:59–15:00 CT** minute, and the contracts' final settlement is to the
  CME CF reference rates published at **16:00 London**
  ([CME FAQ](https://www.cmegroup.com/articles/faqs/frequently-asked-questions-cryptocurrency-futures.html);
  [CME settlement procedure](https://cmegroupclientsite.atlassian.net/wiki/display/EPICSANDBOX/Bitcoin)).
  That is the only genuine "open after a halt" anywhere in crypto, and the
  weekend gap it produced ("CME gap fills") is one of the most-followed
  conventions in retail crypto trading, with claimed fill rates of 70–90 %
  ([Phemex](https://phemex.com/academy/cme-futures-gap);
  [CryptoSlate counter-example](https://cryptoslate.com/do-cme-gaps-always-have-to-fill-bitcoins-60k-flush-says-no/)).
- **On 2026-05-28 CME moved bitcoin and ether futures to 24/7 trading**, with
  only a two-hour maintenance pause on Saturdays 03:00–05:00 UTC; the
  weekend gap is gone ([CoinDesk, 2026-05-28](https://www.coindesk.com/markets/2026/05/28/bitcoin-s-famous-cme-gaps-are-about-to-disappear-though-three-remain-unresolved);
  [Yahoo Finance](https://finance.yahoo.com/markets/crypto/articles/bitcoin-first-cme-gap-free-174649486.html)).
- **Ruling: not registered.** Two independent reasons. (i) The anchor
  ceased to exist two months *inside* the project's holdout year
  (2025-08 .. 2026-07) and will not exist on any future tape; a registration
  would be testing a mechanic that cannot be traded. (ii) Even before the
  change, the spot and perpetual tapes this project trades never halted, so
  there was no order imbalance to resolve at the CME re-open — the mechanism
  was, again, an imported one, and thinner than the NY cash open (CME's
  share of 24-hour volume is small; its influence is through basis, not
  through an auction on the Binance tape).

### 2.2 The ETF NAV fixing (15:00–16:00 NY) and the CME daily settlement

- The US spot bitcoin ETFs strike NAV on the **CME CF Bitcoin Reference Rate
  – New York Variant (BRRNY)**, computed over **15:00–16:00 New York** as the
  average of twelve 5-minute volume-weighted medians across the constituent
  spot exchanges ([CF Benchmarks BRRNY](https://www.cfbenchmarks.com/data/indices/BRRNY);
  [methodology guide](https://docs.cfbenchmarks.com/CME%20CF%20Reference%20Rates%20Methodology.pdf)).
  CME's own daily settlement minute (14:59–15:00 CT) is the same wall-clock
  hour. Since January 2024 this is a **crypto-native, ETF-era fixing**: the
  creations/redemptions that the original note hoped would imprint the
  *open* actually settle at the *close*.
- The documented effect around it is a **drift**, not a breakout: since
  the ETF launch, holding IBIT close-to-open has gained while open-to-close
  has lost (Bespoke, via [CNBC](https://www.cnbc.com/2025/12/10/night-owl-bitcoin-traders-soon-therell-be-an-etf-just-for-you.html);
  Velo data via [CoinDesk](https://www.coindesk.com/markets/2025/12/09/nicholas-proposes-afterdark-bitcoin-etf-that-skips-u-s-trading-hours)),
  to the point that an ETF issuer filed a fund that holds bitcoin only
  outside US hours. An earlier academic version of the same pattern:
  bitcoin returns at **22:00–24:00 UTC** are the day's most economically
  significant, positive at the 5 % level, 2015–2021
  ([Padyšák & Vojtko, SSRN 4081000, via Quantpedia](https://quantpedia.com/strategies/intraday-seasonality-in-bitcoin)).
- **Ruling: not an ORB anchor.** A fixing pins price into a window; an
  opening range needs price to *leave* one. A "closing-range breakout" at
  16:00 NY has no mechanism I can state. The overnight-drift seasonality is
  a **different family** (a time-of-day carry, no range, no breakout) and is
  logged in `IDEAS-BACKLOG.md` as such, not registered here.

### 2.3 Funding-rate settlement: three genuine crypto-native clock points

- Binance USD-M perpetual funding settles at **00:00, 08:00 and 16:00 UTC**
  on the 8-hour contracts (BTCUSDT and ETHUSDT among them); some smaller
  contracts moved to 4-hour settlement in October 2023
  ([Binance FAQ](https://www.binance.com/en/support/faq/introduction-to-binance-futures-funding-rates-360033525031);
  [Binance announcement](https://www.binance.com/en/support/announcement/detail/3243c81a35bd4f0c86a37315c3dc96cc)).
  Bybit and OKX use the same three timestamps. Funding is charged to
  whoever holds a position at the timestamp, with a one-minute tolerance.
- Academic evidence that these timestamps structure the tape:
  [Hansen, Kim & Kimbrough (2021), *Periodicity in Cryptocurrency Volatility
  and Liquidity*](https://arxiv.org/abs/2109.12142) find "systematic patterns
  in both volatility and volume across day-of-the-week, hour-of-the-day, and
  within the hour" on Binance and Coinbase, strengthening over time, and
  relate them to algorithmic trading and "funding times in futures markets"
  (abstract; I could not extract the body's per-timestamp magnitudes).
  A separate strand documents a **turn-of-the-candle effect**: positive
  returns of ~0.6 bp per minute concentrated at the 15-minute candle
  boundaries, emerging mid-2020, t > 9 on every exchange in 2021, attributed
  to algorithms reacting to candle information
  ([Shanaev, Vasenin & Stepanov, *Heliyon* 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10015199/)).
  I found **no** paper documenting a *directional* return effect anchored
  at the funding timestamp itself; the funding literature (Ackerer,
  Hugonnier & Jermann, *Mathematical Finance* 2026;
  [arXiv 1912.03270](https://arxiv.org/pdf/1912.03270)) is about pricing
  and the rate as a state variable, not about the settlement minute.
- **Ruling:** funding timestamps are real, crypto-native, DST-free and
  seven-day. They are **not enough on their own** — a volatility burst at a
  clock point is not an auction. Where one of them *coincides* with other
  structural events (00:00 UTC, §2.5) it becomes the anchor; the other two
  are run as **fit-only descriptive rows** (§4.8c), never as arms.

### 2.4 Deribit: 08:00 UTC daily settlement and every options expiry

- Deribit marks all futures and perpetuals to market **daily at 08:00 UTC**,
  and every option series — daily, weekly (Fridays), monthly, quarterly —
  expires at **08:00 UTC**, settling to a 30-minute TWAP of the Deribit index
  over 07:30–08:00 UTC ([Deribit support](https://support.deribit.com/hc/en-us/articles/29734325712413-Settlement)).
  Dealer-gamma "pinning" into the expiry and a release in the hours after
  it is a widely reported pattern on large expiries
  ([CoinDesk, 2026-08-25](https://www.coindesk.com/markets/2026/08/25/a-massive-usd6-4-billion-bitcoin-options-expiry-on-friday-could-amplify-volatility)),
  though I found no peer-reviewed measurement of it.
- 08:00 UTC is therefore a **triple** structural point: funding settlement
  on the perps, Deribit settlement/expiry, and (in winter) the London cash
  open. **Ruling:** it is the second-best candidate and the one honest
  competitor to 00:00 UTC. It is not registered as an arm because (i) the
  London open moves by an hour with UK DST, which reintroduces exactly the
  DST ambiguity the crypto arms should be free of; (ii) volume at 08:00 UTC
  is a "gradual climb" from the 02:00–06:00 trough, not a measured burst
  (§2.6); (iii) the expiry story is strongest on Fridays and month-ends,
  i.e. it is a *conditioning*, not a daily anchor. It runs as a fit-only
  descriptive anchor row (§4.8c) so the family's REPORT can say whether it
  looks different from 00:00.

### 2.5 The UTC-daily-candle boundary, 00:00 UTC — the candidate

What coincides at 00:00 UTC, every day of the week, with no DST anywhere:

1. **The daily candle / daily reference boundary on every major venue.** The
   crypto convention for the daily bar is 00:00 UTC
   ([Bitget](https://www.bitget.com/wiki/when-does-bitcoin-daily-candle-close-est));
   it is the project's own UTC-midnight VWAP anchor (`vwap-band-reversal-ict.md`
   §1) and the start of its Asia block (`session-liquidity.md` §1). It is the
   *largest* candle boundary, on which the turn-of-the-candle mechanism
   (§2.3) acts by construction.
2. **Perpetual funding settlement** on Binance, Bybit and OKX (§2.3).
3. **The Tokyo cash open** (09:00 JST = 00:00 UTC), with Seoul and Hong
   Kong opening in the following hour.

What is measured there, independently and without reference to New York:

- On Binance BTC/USDT 2018–2023, **00:00 UTC is a Garman–Klass volatility
  peak** (alongside 12:00–14:00 and 17:00 UTC) and in 2023 "by far the
  highest positive return hour in the day"
  ([Amberdata, *Trading Between Hours*](https://blog.amberdata.io/trading-between-hours-volatility-dispersion-across-multiple-regions)).
- A two-year study reported by Bitcoinist found **00:00–01:00 UTC the
  single most volatile hour** of bitcoin's day
  ([Bitcoinist](https://bitcoinist.com/study-finds-bitcoins-most-volatile-from-midnight-to-1-a-m-utc/)).
- Volume "surges" at 00:00 UTC with the Asian open and then declines into
  the 02:00–06:00 trough ([Coin Bureau](https://coinbureau.com/education/crypto-trading-hours);
  [Financefeeds](https://financefeeds.com/when-is-crypto-volume-highest-best-trading-hours/));
  CoinMetrics puts more than 35 % of global BTC volume in Asian hours
  ([Bitget, citing CoinMetrics 2024](https://www.bitget.com/wiki/asian-stock-market-open-time)).
- The 22:00–24:00 UTC positive drift of Padyšák & Vojtko (§2.2) ends exactly
  at this boundary.
- Practitioner convention agrees: when ORB is applied to crypto at all, the
  standard advice is to anchor the range at the **00:00 UTC daily open**
  ([LuxAlgo](https://www.luxalgo.com/library/concept/opening-range-and-orb/);
  [ChartingLens](https://chartinglens.com/blog/opening-range-breakout-strategy)),
  with the honest caveat that the premise is weaker than on an exchange
  with a real auction. No published backtest of it exists that I could find.

**This is the one anchor that is (a) crypto-native, (b) seven-day, (c)
DST-free, (d) independently measured as an activity peak, and (e) never
tested by this project.** It is not a re-skin of the NY anchor: different
clock, different mechanism (a settlement/reset boundary and an algorithmic
candle-turn, not an equity cash auction), and it exists on the very days the
NY anchor's weekend control used as its placebo.

### 2.6 Session volume share and the US-hours migration — and the fact that matters most

- The academic periodicity literature agrees on the shape: bitcoin volume
  and volatility follow the operating hours of the NYSE, LSE and Hang Seng,
  in a reverse-V through the day peaking in the London/NY overlap
  ([Eross et al., *Finance Research Letters* 2019](https://www.sciencedirect.com/science/article/abs/pii/S1544612319301904);
  [Wątorek et al. 2023](https://arxiv.org/abs/2306.17095), who also find
  recurring bursts at US macro release times and at 15-minute marks;
  [2024 study on natives and tokens](https://www.sciencedirect.com/science/article/pii/S1059056024006506)).
  Volume and depth peak at 13:00–16:00 UTC and trough at 02:00–06:00 UTC
  ([Coin Bureau](https://coinbureau.com/education/crypto-trading-hours)).
- **The decisive external fact for this note**: a 2026 paper on ten years of
  hourly Kraken XBT/USD (2016–2025, 87,672 observations) shows bitcoin's
  realized variance migrating to US hours — 50.6 % of daily variance in
  US hours in 2022–2025 versus 38.4 % in 2016–2018 and a 37.5 % baseline,
  variance-weighted centre moving from 14.1 to 17.1 UTC, the peak shifting
  by one UTC hour with US clock changes, weekend/weekday volatility ratio
  falling from 0.96 to 0.60 — **and identifies November 2021 as the single
  structural break, with no comparable break at the CME launch (Dec 2017)
  or the spot-ETF approval (Jan 2024)**
  ([*J. Risk Financial Manag.* 19(9):707, 2026](https://www.mdpi.com/1911-8074/19/9/707),
  summarised by [CryptoSlate](https://cryptoslate.com/crypto-never-closes-but-bitcoin-ethereum-xrp-and-solana-now-move-on-wall-street-time/);
  I reached the abstract and the summary, not the full text).
- Two things follow. First, **this is independent confirmation of the
  project's pre-ETF control**: the ETFs did not change when bitcoin moves,
  so an ETF-transmission story for the 09:30 open was wrong on the
  literature as well as on the tape. Second, and more important for the
  prior of *any* crypto anchor: **the US open is the best-documented
  activity concentration in the crypto day, and an opening range anchored
  there produced zero in both eras with 208–228 trades per arm.** So
  "activity concentrates at this clock point" is *not sufficient* for an
  opening range to carry an edge. A candidate anchor needs a mechanism for
  directional persistence, not just a volume spike. That is why §3 sets the
  prior low and why the family is one anchor, not a sweep of clock points.

### 2.7 How the literature itself defines an "open" for bitcoin

[Shen, Urquhart & Wang, *Financial Review* 2022](https://onlinelibrary.wiley.com/doi/abs/10.1111/fire.12290)
face the exact question — "Bitcoin trades 24 h a day and therefore has not
got a clear opening and closing period" — and answer it by **using trading
volume as the proxy for market time**, finding that the first (highest-
volume) half-hour predicts the last half-hour, driven by liquidity provision.
That is the one published, principled definition of a crypto "session open",
and it resolves to **US hours** — the clock this project has already tested
three times (Записи 18, 22, 23) without finding an edge. A volume-defined
open is therefore not a new anchor for this project; it is the old one under
a better name. (Their finding is day-scale momentum, not ORB, and it is
noted for the backlog's momentum pillar.)

### 2.8 The forex analogue: Asian-range breakout at the London open

The nearest established practice for a market without a single open is the
forex "London breakout" — take the Asian-session range, trade the break at
08:00 London. The evidence is trader-education material with mixed or weak
backtests ([QuantifiedStrategies](https://www.quantifiedstrategies.com/london-breakout-strategy/);
[GitHub backtest](https://github.com/MHZardary/london-strategy-backtest)) and
no peer-reviewed support I could find. On crypto it would be a range of the
whole 00:00–08:00 UTC Asia block broken at 08:00 UTC — an 8-hour "opening
range", which is a different object from ORB (it is closer to the project's
closed session-liquidity family, Запись 17). **Not registered.**

### 2.9 What the equity ORB literature says about conditioning

The best-known published ORB result ([Zarattini, Barbon & Aziz 2024, SSRN
4729284](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4729284)) gets
its performance from restricting to "stocks in play" — the top names by
**opening relative volume** — with a 5-minute range, a tight stop and a
distant target. The relative-volume idea was already carried into Study B as
`or_rvol` and `bar_rvol` and flagged on neither timeframe (Запись 23). The
exit construction is the follow-up note's §9 item. Neither is re-opened here.

---

## 3. Ruling 2 — judgment: one genuinely different anchor, registered narrowly

### 3.1 Why 00:00 UTC clears the bar for a registration

The follow-up note's test for a fresh family was: a different registered
object with its own mechanism, fully specified, decisive either way, with
the dishonest version (sweep the clock and report the cell that clears the
bar) prevented structurally. Applied here:

- **Different object.** The clock, the calendar (seven days, no holidays),
  the absence of DST, and the mechanism (a venue-wide settlement/reset
  boundary plus an algorithmic candle-turn, plus the Asian cash open as a
  third coincident flow) are all different from the NY cash auction. The
  NY family's weekend placebo days are *eligible days* here.
- **Crypto-native.** Two of the three coincident events are things the
  crypto market does to itself. The third (Tokyo) is an external flow, and
  §4.8(a)–(b) are designed to tell the two apart *after* the fact rather
  than assume.
- **Evidenced.** §2.5: independent measurements place the day's volatility
  peak and, in 2023, the highest-return hour at this boundary. The weekend
  row of the closed pass says the mechanic needs an active window; this is
  the one candidate where the window is active seven days a week.
- **Decisive and cheap.** The machinery exists (`research/orb-ny-open/`);
  the change is five constants and a calendar. Projected `n_holdout` ≈ 300+
  per arm (assumption: ~365 eligible days × the 0.87–0.94 trigger share the
  crypto arms showed at 30 minutes), so power is not a question.
- **No sweep.** One anchor, one width, one timeframe, two instruments. The
  alternative anchors are run fit-only so the REPORT can *show* they were
  not chosen after the fact.

### 3.2 Why the prior is low, said plainly

- Запись 2: time-of-day filters on crypto did not survive a holdout.
  Запись 18: a NY window on BTC/ETH, killed. Запись 23: an opening range at
  the crypto day's largest activity peak, killed in both eras. Three
  independent nulls on the general proposition "the clock structures the
  crypto tape tradably".
- The 00:00 UTC evidence is about **volatility and volume**, plus a
  minute-scale candle-turn drift. None of it is a breakout-persistence
  result. The closed pass showed that volatility concentration alone does
  not make an opening range work.
- 00:30–02:30 UTC is a thinner book than 10:00–12:00 NY; realised slippage
  will be worse than the 0.10 % model, so every number is more optimistic
  here than in the closed pass. The REPORT must say so.

**Most likely outcome: two kills.** I am registering this because the user
asked for a real search and the search found exactly one anchor that has
never been tested and can be tested honestly — not because I expect it to
pass. If it dies, the crypto ORB line is closed on every anchor, and §5
says what would be next instead.

### 3.3 What the read holdout could have influenced, and what actually drove each choice

| choice | could the holdout have driven it? | what drove it |
|---|---|---|
| 00:00 UTC as the anchor | No — no ORB number exists at any UTC anchor | §2.5 external evidence; the project's own block/VWAP conventions |
| 30-minute width, 5m bar, 2-hour trigger window, +1R template | Weakly — the crypto arms' holdout is known | Carried **verbatim** so that the only difference from the closed pass is the clock; S1 (fit-only) said crypto got *worse* at 15 minutes, which argues against a narrower range, not for one |
| Seven-day calendar | Yes — the weekend rows are known and negative | The anchor exists on weekends *by definition*; excluding them would be selecting on the known number. The weekday/weekend split is reported and pre-read (§4.8a) |
| Flat at 07:55 UTC | No | The next structural point (08:00 UTC funding + Deribit); keeps the position clear of any funding timestamp |
| Deeper fit history | No | User preference on record; the 2022-08 start was a convention, not a floor |
| Crypto only | Yes — the index arms are known | The anchor has no meaning on an index CFD (the Capital.com tape has a 21:00–23:00 UTC gap and no crypto-venue events) |

---

## 4. Ruling 3 — the family `orb-utc0-crypto`

### 4.1 The two arms

| # | arm | instrument | OR window (UTC) | trigger bars open in (UTC) | trigger bar | stop | forced flat (UTC) | template |
|---|---|---|---|---|---|---|---|---|
| 1 | `BTCUSDT-UTC0` | BTCUSDT USD-M perp, Binance 1m | [00:00, 00:30) | [00:30, 02:30) | 5m | opposite side of OR | 07:55:00 | +1R gates; pure-ORB secondary |
| 2 | `ETHUSDT-UTC0` | ETHUSDT, same | same | same | 5m | same | same | same |

Everything not listed is **verbatim from `research/orb-ny-open/DESIGN.md`**:
OR from 1m bars (`OR_high` = max high, `OR_low` = min low over the window,
open time in [00:00, 00:30) UTC); every one of the six 5-minute bins in the
range must hold ≥ 1 1m bar or the day is excluded and counted; first 5m bar
**close** strictly beyond the range, bars labelled by open time on the UTC
5-minute grid; one trade per day, no re-entry; entry at the trigger bar's
close; `1R = |entry − stop|`; 1-minute-path fill (stop first, target at
level, gapped stop fills at the breaching minute's open); Binance cost
0.10 % round trip, `cost_R = 0.001 × entry / stop_dist`; no slippage.

**5m bars only** — the closed pass showed 5m ≈ 15m on every instrument and
the follow-up ruled 5m for the same reason; a second timeframe would double
the α cost for a known non-difference.

### 4.2 Clock, calendar, DST — the things that change

- **Session date = the UTC calendar date** of the range. `SESSION_TZ = "UTC"`.
  No DST conversion anywhere in the package; `checks.py`'s grid check
  becomes trivial and is kept as an assertion that 00:00, 00:30, 02:30 and
  07:55 UTC lie on the 5-minute grid on every day.
- **Eligible days = every calendar day** with a complete range (§4.1). No
  exchange holiday calendar: the anchor is the venue's own boundary and the
  venue never closes. Binance maintenance windows or missing bars are
  handled by the completeness rule and counted in the exclusions row.
- **Trigger window [00:30, 02:30) UTC**, i.e. 2 hours as in the closed pass,
  ending before the 02:00–06:00 UTC liquidity trough deepens. Last eligible
  bar opens 02:25. No breakout by then → no trade that day (counted).
- **Forced flat at 07:55:00 UTC** = mark to market at the close of the 5m
  bar opening 07:50 (on the 1m path: the close of the 07:54 minute). Chosen
  so that **no position is ever open at a funding timestamp** (00:00 has
  passed before the first trigger; 08:00 is never reached). Consequence, to
  be stated in the REPORT: funding is not merely unmodelled here, it is
  structurally zero — the first crypto registration in this project for
  which that is true.
- **Trades never cross a session boundary**; `checks.py` verifies it.

### 4.3 Exit templates — unchanged

| # | template | rule | status |
|---|---|---|---|
| 1 (primary) | project-standard | target +1R; stop as §4.1; forced flat 07:55 UTC | **gates** |
| 2 | pure ORB | no target; same stop; forced flat 07:55 UTC | mandatory secondary, always reported, **no verdict, no straddle rule** (that rule was spent on the ETH t2 deferral, follow-up §3.2) |

### 4.4 Costs

- 0.10 % round trip in the primary, as every Binance registration in this
  project. Sensitivities, non-gating: **0.04 %** (maker) and **0.20 %**
  (2×) — the second is new relative to the closed pass and is there because
  the 00:30–02:30 UTC book is thinner than the US-hours book and the REPORT
  needs to show how much of any gross edge a wider realised spread would
  eat.
- The REPORT shows the `cost_R` distribution per arm and the gross-vs-net
  gap (projection: 0.07–0.10R, as the crypto arms showed at 30 minutes), and
  carries the sentence: *"slippage is not modelled; in this window the book
  is thinner than in US hours, so every number here is more optimistic than
  the closed pass's."*

### 4.5 Data, history depth, split

- **Tape:** the audited Binance 1m parquets in
  `research/cmc-bot-vwap/data/` (copied from the main checkout, never
  re-pulled — follow-up §8), currently 2022-08-01 .. 2026-09-11.
- **Extension, required, before any R:** pull 1m klines for BTCUSDT and
  ETHUSDT USD-M perpetuals from the earliest month available on
  `data.binance.vision` (expected 2020-01 for both; Researcher verifies and
  records the actual first month) through 2022-07-31, using the same loader
  family as the existing tape, and run the same coverage audit (row counts,
  duplicates, ordering, gap list) on the extension; the existing 2022-08+
  segment must reproduce byte-identically. The extended tape is written to
  a **new** file (`*_1m_2020.parquet`); the audited 2022-08+ file is not
  modified, because other packages depend on it.
- **Split.** **Fit: first audited month .. 2025-07-31** (expected 2020-01-01
  .. 2025-07-31, ~67 months). **Holdout: 2025-08-01 .. 2026-07-31** (the
  project standard, computed once). **Tail: 2026-08-01 .. 2026-09-11**
  (descriptive). If the extension fails its audit, fit = 2022-08-01 ..
  2025-07-31 and `DESIGN.md` records why, with a commit, before any R.
- **Era sub-rows, descriptive, fit-side, no verdict:** (i) before / from
  2021-11-01 (the break the periodicity paper identifies, §2.6); (ii)
  before / from 2024-01-11 (spot ETF launch). Pre-registered reading: if the
  arm passes, the REPORT says which era carries it; if the from-2024 era
  alone carries it the NY-flow explanation is back on the table and the
  pass is flagged to Architect before any build ruling. If the arm is
  killed, the rows are reported and nothing is inferred.
- Why break the cross-package 2022-08 alignment: the user asked for it on
  record, the extra history is free and audited the same way, and the
  holdout — the only period any verdict is judged on — stays aligned with
  every other line in the project. A longer fit only makes the fit-period
  screen (§4.7) harder to pass by luck.

### 4.6 Nulls, interval, forward lift — verbatim, windows substituted

- **Null A — matched-time placebo, primary, 1,000 draws.** Each real trade
  is replaced by one entered at a 5m bar drawn uniformly from the **same
  00:30–02:30 UTC window on a different, randomly chosen eligible day**
  (any day of the week — the population is seven-day), same instrument,
  same side, same `stop_atr`, same template, same 07:55 flat, same costs.
  One-sided `p`.
- **Null B — whole-stream day shift, 250 draws**, `k ~ U{1..250}` days.
- **Interval:** day-block bootstrap, 2,000 draws, 90 %.
- **Non-circular forward lift** as `session-liquidity-v5-ny/tables.py:block_L`,
  per arm, fit and holdout, **and per weekday/weekend half** (§4.8a).

### 4.7 Thresholds, cumulative Bonferroni, fit-period screen

- **Family for α = every pre-registered arm judged on the 2025-08-01 ..
  2026-07-31 holdout: 8 (closed pass) + 6 (`orb-ny-open-short`) + 2 (this
  family) = 16. α = 0.05/16 = 0.003125.** Same convention as the follow-up
  note; the holdout is one growing family. If the Researcher finds the count
  wrong, tighten, do not loosen.
- **Fit-period screen, decided before any holdout number exists** (follow-up
  §5.3, verbatim): an arm touches the holdout only if, on the fit period
  alone, template-1 mean net R ≥ +0.05R **and** fit-period Null A (1,000
  draws from the arm's own window) gives p ≤ 0.05. A screened-out arm is
  verdicted **NO EDGE — KILL (fit screen)**, its holdout is never computed,
  and `DESIGN.md` records the decision with a commit hash.
- **Ladder, applied mechanically to template 1's holdout mean net R:**

| condition | verdict |
|---|---|
| `n_holdout < 150` | UNDERPOWERED — return to Architect |
| mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill** |
| `≥ +0.05R` and `0.003125 < p ≤ 0.20` | INCONCLUSIVE — no build, no follow-up on this line |
| all of: `≥ +0.10R`; `p ≤ 0.003125`; fit same sign with `m_fit ≥ +0.05R`; `n ≥ 150`; 90 % bootstrap excludes 0; gross > 0; **and the §4.8(a) weekend reading does not fire** | **REAL EDGE — routes to Architect for a build ruling** |

- **Holdout re-use, declared** in the REPORT's first paragraph in the
  follow-up's words: this is the third pre-registered look at the
  2025-08 .. 2026-07 year on the crypto tapes (Запись 22's crypto arms and
  Запись 23's crypto arms read it already); α is corrected for all of them;
  a REAL EDGE here is weaker evidence than a first-read one.

### 4.8 The built-in falsifications (descriptive rows with pre-committed readings)

**(a) Weekday vs weekend split — the test of "crypto-native".** For each
arm, template 1, fit and holdout: mean net R, `n`, forward lift, for
**Mon–Fri UTC** and **Sat–Sun UTC** separately. The verdict is on all seven
days pooled. Pre-registered reading, fixed now: if an arm reaches REAL EDGE
on the pooled number **and its weekend half has holdout mean net R below
+0.05R** while the weekday half carries the result, the REPORT says, in these
words, *"the Tokyo open, not the reset — an imported anchor again"*, the arm
is labelled **"story falsified — suspect"** in the verdict table, it is *not*
routed as a build candidate, and it returns to Architect. A crypto-native
boundary that only works when a foreign cash market opens is the hypothesis
this family exists to rule out. If the weekend half is at or above +0.05R
(or the two halves are within each other's 90 % intervals), the
crypto-native reading stands. If the arm is killed, the split is reported
and nothing is inferred.

**(b) Tokyo-holiday row.** Weekdays on which the Tokyo Stock Exchange is
closed (JPX published calendar, recorded verbatim in `DESIGN.md`), fit and
holdout pooled (projection: ~20 days/year — small, descriptive only). Same
mechanic. Reported beside the arm; the (a) reading is the one that bites,
this row is corroboration.

**(c) Fit-only alternative-anchor rows — the placebo anchors.** The
identical mechanic (30-minute range, 2-hour trigger window, flat before the
next funding timestamp or 7 h 55 m later, whichever is earlier) at
**08:00 UTC** (funding + Deribit settlement/expiry + London open — the
honest competitor, §2.4), **16:00 UTC** (funding only), and **04:00 UTC**
(nothing: no funding on the 8-hour contracts, no venue event, the volume
trough — the no-story placebo). **Fit period only, never the holdout, no
verdict.** Pre-registered reading: if the 04:00 row on the fit period is as
good as or better than the 00:00 arm's fit number, the REPORT says *"any
clock, not the reset"* and, should the arm later pass on the holdout, the
pass is flagged to Architect as suspect. If 08:00 looks *better* than 00:00
on the fit period, that is recorded as a note for a possible future
registration and **nothing else** — it does not become an arm of this
family and it does not touch the holdout.

**(d) Fit-only width sensitivities S1/S2 (15 and 60 minutes),** as in the
closed pass, for like-for-like comparison with its crypto rows. Non-gating.
No S3/S4 (stop midpoint, re-entry) — the closed pass showed them inert on
crypto.

### 4.9 Reporting rules the Researcher may not bend

- **The first table of `REPORT.md`** is the two arms with verdict, fit and
  holdout mean net R, `n`, `p_A`, `p_B`, bootstrap interval, screen status,
  **and the weekday/weekend halves** beside them. No "best" sentence exists
  without that table above it.
- The (c) placebo-anchor rows are the **second** table, fit-only, with a
  blank holdout column — the blank is the point.
- Template 2 reported for both arms, no verdict word next to it.
- Era rows, Tokyo-holiday row, S1/S2, cost sensitivities: each under its own
  heading with no verdict words.
- The closed pass's crypto rows (`BTCUSDT-5m`, `ETHUSDT-5m` at the NY anchor,
  and their weekend rows) are **quoted** from `research/orb-ny-open/results/`
  in a comparison table — never recomputed, never re-judged — so the reader
  sees the two anchors side by side.
- Every sensitivity actually run, including the ones that came out worse.
- No Study B, no feature columns, no model.

### 4.10 Machinery — fork and parametrise, do not rewrite

**Fork `research/orb-ny-open/` → `research/orb-utc0-crypto/`.** The closed
package is a finished record and is not edited.

| file | action | what changes |
|---|---|---|
| `common.py` | parametrise | `SESSION_TZ = "UTC"`; `OR_START = (0, 0)`, `OR_END = (0, 30)`, `TRIG_START = (0, 30)`, `TRIG_END_BASE = (2, 30)`, `FLAT = (7, 55)`; `TRIG_END_WIDE` removed (no contingency, §4.11); `TFS = (5,)`; `INSTRUMENTS = ("BTCUSDT", "ETHUSDT")`; `N_ARMS_CUMULATIVE = 16`, `ALPHA = 0.05/16`; split constants per §4.5; **`NYSE_HOLIDAYS` and the early-close list are removed from the eligibility path** (kept only if the (b) row needs a calendar object, and that one is the JPX calendar); add `PLACEBO_ANCHORS = ((8, 0), (16, 0), (4, 0))` for §4.8(c). |
| `engine.py` | parametrise | `eligibility` takes "every UTC date"; `find_trigger` unchanged in logic; the flat rule reads `FLAT` in UTC; the anchor is a parameter so the §4.8(c) rows reuse the same code path. `walk1m`, fills, `cost_R`: untouched. |
| `checks.py` | adapt | grid check on 00:00/00:30/02:30/07:55 UTC; "no position open at 00:00 or 08:00 UTC" assertion (new); session-boundary check; 1m-path vs bar-OHLC fill check as before. |
| `build.py` | rewrite the arm loop | two arms; template 1 + 2; tail row; weekday/weekend split; era rows; Tokyo-holiday row; S1/S2; the three placebo anchors fit-only; fit-period Null A per arm for the screen **before** any holdout. Drop indices, NYSE calendar, pre-ETF row (superseded by the era rows), Study B. |
| `projection.py` | repurpose | records fit-period trigger share per arm (data note only). |
| `analysis.py` | add the screen | as the follow-up's §7: a `screen` step that writes the decision into `DESIGN.md` and refuses to run `holdout` for screened-out arms; `holdout` computes Null A/B, bootstrap, ladder at α = 0.003125, the §4.8(a) label. |
| `studyb.py`, `features.py`, `mechanic_proof.py` | drop / keep | Study B and features dropped; mechanic proof kept — ten hand-checked fit-period trades per arm, minute by minute, on the UTC clock. |
| `prep`-side | new, small | the history-extension pull + audit of §4.5, writing `*_1m_2020.parquet`. |
| `report.py`, `handoff.py` | adapt | first paragraph = holdout re-use declaration + the first table of §4.9; comparison table quoting the closed pass's crypto rows. |
| `DESIGN.md` | new, from this note | **committed before any R is computed on either arm.** |

### 4.11 Order of work and stop rules (for the dispatch)

1. Fork; copy tapes (follow-up §8); coverage audit of the 2022-08+ segment
   byte-identical. **No R.**
2. History extension pull and audit (§4.5); first audited month recorded.
   **No R.**
3. `DESIGN.md` from this note, **committed before any R**.
4. Mechanic proof (ten trades per arm), grid, funding-timestamp and fill
   checks.
5. Fit-period numbers: both arms, template 1 + 2, weekday/weekend halves,
   era rows, Tokyo-holiday row, S1/S2, cost sensitivities, the three
   placebo-anchor rows, fit-period Null A per arm. **Screen decision
   committed into `DESIGN.md`.**
6. **Holdout, once**, screened-in arms only; ladder at α = 0.003125; the
   §4.8(a) label; tail row.
7. `REPORT.md` (first paragraph: declaration + first table), `HANDOFF.md`,
   `RESEARCH-LOG.md` Запись **regardless of outcome**. A kill is a result,
   and here it is the result that closes the crypto ORB line on every anchor.
8. **Stop and return to Architect** if: the 2022-08+ audit does not
   reproduce; the extension's audit fails *and* the Researcher cannot fall
   back cleanly to the 2022-08 fit; any position is found open at a funding
   timestamp; the 1m-path and bar-OHLC fills disagree on a trade that
   neither gaps nor touches both levels within a bar; `n_holdout < 150` on
   a screened-in arm (there is no power contingency — the projection is
   ~300+, and if it is wrong the UNDERPOWERED row applies); or the
   pre-registration is ambiguous in a way that changes a number.

---

## 5. Explicitly not ruled here — and what is next if this dies

- **08:00 UTC and 16:00 UTC as arms** — fit-only rows in this family
  (§4.8c). If this family is killed, they are *not* promoted; the fit-only
  rows will already have shown whether they look any different from 00:00,
  and the crypto ORB line is closed on every anchor. If 08:00 looks
  materially different on the fit period, that is a note for a future
  Architect, not a registration.
- **The US-hours / overnight drift** (§2.2) — a time-of-day carry with no
  range and no breakout. Logged in `IDEAS-BACKLOG.md` under the crypto
  seasonality heading as a separate idea; it belongs to no ORB family.
- **Deribit expiry days / large-expiry conditioning** — a conditioning
  variable, not an anchor; nothing to register until an unconditional
  mechanic exists.
- **The exit-construction family** (follow-up §9) remains the principled
  next ORB registration *on the indices* if `orb-ny-open-short` dies; it is
  not extended to crypto by this note.
- **Volume-defined open** (§2.7) — is US hours; already tested; not a new
  registration.
- **Software Engineer / Backtesting** — only on a REAL EDGE that survives
  §4.8(a), after a further Architect ruling; a crypto build would be a new
  configuration, per Stage 1 §4.2.

---

## 6. For the user, in plain terms (to be translated by the coordinator)

**Why crypto was dropped.** The test we ran on BTC and ETH was not "does an
opening-range breakout work on crypto". It was a narrower bet: that since
the US bitcoin ETFs launched in 2024, the New York stock-market open at
09:30 leaves a footprint on bitcoin that you can trade. We built in a check
that could prove that bet wrong: run the same thing on 2022–2023, before
the ETFs existed. If the ETF story were true, the earlier period had to look
worse. It looked the same — both were zero. Independently, a 2026 academic
study of ten years of hourly bitcoin data finds the ETF launch changed
nothing about *when* bitcoin moves during the day (the real shift to US
hours happened in late 2021). So the New York anchor was dropped for the
right reason. But that is all that was dropped.

**What I researched.** Whether the crypto market has an "open" of its own —
something the market itself does at a fixed time every day, not something
borrowed from Wall Street. I looked at: the CME bitcoin futures (which did
have a real daily open and a weekend close — but CME switched to 24/7
trading on 28 May 2026, so that anchor no longer exists); the price fixing
that the ETFs use to value themselves (15:00–16:00 New York — a *close*, not
an open, and what happens around it is a slow drift, not a breakout); the
three times a day when perpetual-futures funding is paid (00:00, 08:00,
16:00 UTC); the Deribit options settlement (08:00 UTC); the daily-candle
boundary that every crypto exchange uses (00:00 UTC); and the academic
literature on which hours of the day bitcoin is most active.

**What I found.** One time of day stands out for reasons that have nothing
to do with New York: **00:00 UTC**. At that moment, every day of the week
including weekends, three things happen at once — every exchange's daily
candle closes and a new one opens, funding is settled on the perpetuals,
and the Tokyo stock market opens. Independent measurements find it the most
volatile hour of bitcoin's day. Nobody has published a proper backtest of an
opening range anchored there, and this project has never tested it.

**What I am proposing.** One test, two arms (BTC and ETH), identical in
every detail to the test we already ran — same 30-minute range, same
breakout rule, same stop, same target — with only the clock changed to
00:00 UTC, run on every day of the week, on the deepest Binance history
available (back to 2020). Built into it are checks that can kill the *story*
even if the number looks good: if it only works Monday to Friday, then it
was the Tokyo open — a borrowed anchor again — and it will be labelled as
such rather than built; and three other clock times are run on the training
data as decoys, one of them (04:00 UTC) chosen because *nothing* happens
then. If the decoy looks as good as the real thing, the result is noise.

**Honest expectation.** Low. Three separate earlier studies in this project
found that the clock does not structure bitcoin tradably, and the best-known
busy hour of the crypto day (the US open) produced nothing even with 200+
trades per arm. Activity at a time of day is not the same as a tradable
breakout. If this test fails, the opening-range idea is closed for crypto
on every anchor — this is the last shot on it. If it passes all its checks,
it is the first crypto session-anchored result in the project's history and
would go to a separate build ruling.
