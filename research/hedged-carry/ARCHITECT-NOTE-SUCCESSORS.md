# ARCHITECT-NOTE-SUCCESSORS — ruling on the three questions the hedged-carry pass parked

**Architect, 2026-09-17. Status: RULING.** Evidence read in full: `REPORT.md`,
`HANDOFF.md`, `DESIGN.md` §2/§5/§12, `ARCHITECT-NOTE.md` §2.6/§10,
`results/capital_collateral.csv`, RESEARCH-LOG Запись 32,
`research/_surveys/2026-09-power-correction.md`, `PROJECT.md` "User rulings,
2026-09-16". Two descriptive computations were made here, both read-only on
free archives and both saved under `successors/` (§5); no holdout of any
registered arm was touched, no arm was re-run, nothing was re-tuned. The
exchange-mechanics facts in §1 were verified against Binance's own pages and
public API endpoints on 2026-09-16/17, and each is dated where it matters.

The HANDOFF's "What NOT to do next" is binding on this note: nothing below
re-runs the family at lower leverage, re-cuts the split, loosens the
150-slot-day floor, or re-registers the extreme-state entry.

---

## 0. Ruling, ranked

| rank | question | decision | prior (build / clean kill / inconclusive) | one line |
|---|---|---|---|---|
| **1** | account-type | **REGISTER NOW** — one registration, two arms, both majors, both on a **COIN-M inverse** account structure, with the Portfolio-Margin/USD-M un-re-centred row as a descriptive sensitivity | **15 / 65 / 20 %** | The structure is real and reachable, cheaper than the pass assumed, and liquidation-free by construction; the premium is a *regime*, and the two-year holdout is a flat one. |
| **2** | dated-futures (quarterly) basis | **WORTH ONE, LATER — as arm 2 of the rank-1 registration**, not standalone | **10 / 75 / 15 %** | Same venue premium with a date attached: locked at entry, no funding clock, no re-centre, one round trip a quarter; front-quarter basis averaged 9 % p.a. on fit and 6 % on the holdout window, under the build bar. |
| **3** | duty-cycle / wider universe | **CLOSED — no registration** | — | The premium regime is a property of *time*, not of the universe: every universe cut prints utilisation 0.34–0.37 on fit and 0.11–0.16 on the holdout at the same gate, and the extra holdout utilisation lives in $1–10M/day symbols at a lower rate with three times the jump hazard. |

If only one thing is dispatched, it is rank 1 with rank 2 folded in as its
second arm. Rank 3 needs nothing further.

**Opportunity cost, named** (per the standing rule to name it before an
N-th pass on a line): this would be the *third* carry-line registration
(funding-rate signals → hedged carry → this). It is cheap — the engine,
harness, margin-path code and audit chain exist, the only new data is the
COIN-M tape — and it is the *last* one: after it the carry line closes
regardless of result, because there is no fourth account structure to ask
about. Waiting undispatched behind it: the OI/taker-flow positioning line
(closed), the time-of-day carry (logged, not registered), the macro-event
reaction (logged), the pivot-structure engine (needs Architect decisions),
and the cross-sectional reversal family the power-correction note named as
the natural home for multi-day crypto. None of those is blocked by this
registration; the Researcher-day it costs is the whole price.

---

## 1. Question 1 — the account-type question

### 1.1 What was actually asked

`REPORT.md` §6: majors, fit period, **+7.89 % p.a.** on the primary account
(isolated USDT margin, spot unpostable, re-centred at half the buffer)
against **+28.40 %** with spot posted at a 90 % haircut and *no re-centres*.
The Researcher's decomposition is the important part and it is right: the
capital denominator (1.5 N → 1.1 N) is worth only 1.36×; the rest is the
short perp's **USD notional compounding with the rally** while the position
is never re-hedged — one ETHUSDT position, 2020-10-21 → 2021-05-19, 396.74 →
2,856.12, collected 46.70 USDT of funding on a 50 USDT slot. The question
put to me: is there a Binance account structure this user can actually open
on which such a position is holdable, and if so, is +28.40 % the number that
structure pays, or an artefact of a margin model no account offers?

### 1.2 The exchange mechanics, verified

Three structures exist. Each is dated because Binance changes these by
announcement.

**(a) Multi-Assets Mode (USD-M futures).** Real, and the default for every
futures account created after 2024-02-09 08:30 UTC. Cross margin only —
"the Isolated Margin Mode and the Multi-Assets Mode are mutually exclusive".
Collateral must sit in the **USD-M futures wallet**, not the spot wallet.
Margin-eligible assets as served by `GET /fapi/v1/exchangeInfo` on
2026-09-16: **USDT, BTC, BNB, ETH, USDC, FDUSD, BNFCR, BFUSD, LDUSDT, RWUSD,
USD1, U** — *twelve assets, and none of SOL, XRP, DOGE, ADA, LINK*. BTC, ETH
and BNB take a **5 % haircut** (95 % collateral value). A negative USDT
balance is auto-exchanged from the other collateral when it passes
**−5,000 USDT** for regular and VIP-1 users (since 2024-05-29; −10,000 for
higher tiers; −0.1 BTC for BTC). Per-asset deposit caps vary by VIP level.
**Consequence:** the majors' spot-as-collateral row is reachable here with a
*better* haircut than the counterfactual assumed (95 % vs 90 %); the alt
tier is not — the six alts are simply not collateral, exactly as
`DESIGN.md` §5 said.

**(b) Portfolio Margin (regular, not Pro).** Real and open: the 10,000 USDT
minimum wallet balance was **removed on 2024-10-23** ("Portfolio Margin will
now be extended to regular users"). It unifies the cross-margin wallet and
both futures wallets into one collateral pool; spot held in the cross-margin
wallet counts automatically at its collateral rate. Risk is one number,
`uniMMR = Σ adjusted equity / Σ maintenance margin`, **liquidation at
105 %**; negative balances in any asset are allowed while uniMMR stays above
that, interest-free up to **1,000 USDT** at VIP 0 (from 2025-05-17) and
charged at the margin-borrow daily rate above it, assessed at 00:00 UTC.
Preconditions to activate: no isolated positions, no Multi-Assets Mode, no
open loans or negative balances. Collateral rates are published on the
Portfolio Margin "Collateral Ratio & Leverage" page (JS-rendered; not
machine-readable without an API key — `GET /sapi/v1/portfolio/collateralRate`
returns it to any keyed account). BTC is quoted at **95 %**; small assets
sit at 10–45 % and are moved by announcement (the 2026-02-13 update cut 19
assets). The rates for SOL, XRP, DOGE, ADA, LINK were **not** readable here
and must be pulled at Stage 0 by the Researcher with the user's read-only key
before any alt row exists. Regional availability: Binance's own pages list
no product-level region rule beyond the platform's; the user confirms PM is
offered in their account UI as a Stage-0 checklist item, not a research
question.

**(c) COIN-M (coin-margined) futures.** Real, standard, on every Binance
Futures account, no mode switch. `GET /dapi/v1/exchangeInfo`: `BTCUSD_PERP`
(contract 100 USD, margin asset BTC), `ETHUSD_PERP` (10 USD, ETH), and
quarterlies `BTCUSD_yymmdd` / `ETHUSD_yymmdd`. The margin *is* the coin. This
is the structure the counterfactual was groping for, and it is better than
either (a) or (b) for this trade, for a reason that is arithmetic rather than
policy: hold `q = N / P_e` coins as margin and short `N` USD of inverse
contracts. The short's P&L in coin is `q (P_e / P_t − 1)`, so total coin
= `q P_e / P_t` and **USD value = q P_e = N, constant** — the position is
exactly USD-hedged at every price with *no re-centre*, because the inverse
contract's convexity does the re-hedging. Margin ÷ maintenance margin
= `(q P_e / P_t) / (mmr · N / P_t) = 1 / mmr` at every price, so **upside
liquidation is impossible by construction** (the rally that killed DOGE on
the primary account and forced 31 re-centres on the majors cannot touch it),
and on the downside the short gains, so neither can a crash. Funding on an
inverse perp is paid in coin on the fixed USD notional `N`.

### 1.3 So is +28.40 % real?

**The structure is real; the number is not the one it pays.**

- On **COIN-M** the USD notional is *fixed* at N, so the compounding that
  produced 46.70 USDT on a 50 USDT slot does not occur. What COIN-M gives
  instead is the *denominator*: capital = **1.0 N** of coin plus a small cash
  buffer, no USDT margin leg, no re-centre round trips (31 of the majors'
  47 fit-period closes were re-centres), no liquidation gate. Translating the
  pass's own numbers by the denominator alone, always-on majors go from
  +9.45 % on 1.5 N to ≈ **+14 % on 1.0 N** (fit) and from +2.60 % to ≈
  **+3.9 %** (holdout); the gated arm from +7.89 % to ≈ +11.8 % and from
  +0.89 % to ≈ +1.3 %. These are *translations*, not measurements: COIN-M
  perps carry their **own** funding series (the archive starts 2022-07;
  `GET /dapi/v1/fundingRate` returns it from 2020-08-10, verified), and it is
  not the USD-M series. The registration measures it.
- On **PM or Multi-Assets Mode with the USD-M perp**, the un-re-centred coin
  hedge is holdable and the notional does compound: adjusted equity
  = `cash + N − 0.05 P_t q` at a 95 % haircut, maintenance margin
  ≈ 0.5 % of `P_t q`, so uniMMR crosses 105 % only near `P_t / P_e ≈ 18` —
  effectively unbounded, as the counterfactual assumed. But the +28.40 % is
  a **fit-period** number carried by **one 2020–21 bull-run position**, and
  the same compounding compounds the tail: a −2 %-capped negative-funding
  week (the SOL FTX week cost −4.03 % of tier capital at *fixed* notional) is
  paid on 7 N once the notional has grown 7×, as are the unwind fees. The
  honest reading is that this row is the *high-variance* form of the same
  trade, and the registration carries it as a descriptive sensitivity with
  the negative-funding tail modelled at the grown notional, not as an arm.

**Net: the account type is worth exactly the denominator and the
liquidation gate, not 3.6×.** That is still the largest single lever the
pass found — it turns a "real but 1.5× too small" object into one whose
fit-period reading sits *above* the build bar for the first time in this
project — and it removes the risk the pre-registration was built around. It
does not manufacture premium: the two-year holdout, at ten times the gated
exposure, paid 2.6 % on 1.5 N, and no denominator turns that into 10 %.
Hence the prior.

### 1.4 The registration — enough for a design dispatch

**Account structure (the centre of gravity).** COIN-M, 1:1 inverse
cash-and-carry: `q = N / P_e` coins in the COIN-M wallet, short `N` USD of
`BTCUSD_PERP` / `ETHUSD_PERP` at 1× (the exchange minimum). Capital per slot
`C = N + b`, with `b = 0.05 N` a cash buffer for fees and any negative
funding, pinned before any number. No margin path to model on the upside
(prove the `1/mmr` identity in `MECHANIC-PROOF`; then assert it on the tape
as a check, not a gate); the only survivability question is the buffer
being exhausted by negative funding, which is a P&L question and is modelled
as such. The **SOL FTX blackout rule does not apply** — no alts.

**Universe.** BTC and ETH only. The six alts have no COIN-M quarterlies after
2025-09 and are not Multi-Assets collateral; their PM rates are unread. An
alt row is admitted **only** as a fit-only descriptive on PM, and only if the
Stage-0 collateral-rate pull shows all six at ≥ 80 %; otherwise the alt tier
stays dead where Запись 32 left it.

**Arms (α = 0.05 / 2 = 0.025 each).**
- **Arm A — passive inverse carry, majors.** Always-on, per `REPORT.md`
  §8.4(1) ("the gate costs money on the majors": always-on beat the gated arm
  on fit *and* holdout). The funding gate of `DESIGN.md` (trailing
  9-settlement mean ON ≥ 0.02 %/8 h, OFF ≤ 0.005 %) is carried **as a risk
  overlay row**, fit-only, non-gating, together with the price-gated shadow
  (expected to lose again) and Null A. Costs: taker on both legs at COIN-M
  fee tiers (verify: COIN-M taker is not the USD-M 0.05 %), spread allowance
  as before, one round trip per position; no re-centre fees exist.
- **Arm B — quarterly basis, majors** (§2 below).

**Data.** COIN-M 1 h klines for `BTCUSD_PERP`, `ETHUSD_PERP` (archive from
2020-08, verified), COIN-M funding (archive 2022-07 → 2026-06; 2020-08 →
2022-06 from `GET /dapi/v1/fundingRate`, paginated, then asserted against the
archive on the overlap), spot 1 h `BTCUSDT`/`ETHUSDT` (the pass's
`fetch_data.py` reproduces it), and for arm B every `BTCUSD_yymmdd` /
`ETHUSD_yymmdd` 1 h kline set (26 contracts each, 2020-09-25 → 2026-12-25).
The spot leg is priced in USDT and the margin coin is the same asset, so the
"basis" for entry/unwind is the inverse mark against spot; the design must
state the clock alignment of the two archives as `DESIGN.md` §3 did.

**Split, holdout, floor.** Fit 2020-08-10 (first COIN-M funding) →
2024-07-31; holdout **2024-08-01 → 2026-07-31**, read once; tail 2026-08
non-gating; forward confirmation 2026-08 → 10 on any REAL EDGE. Observation
unit one UTC day of the tier portfolio, as before. Floor: `≥ 150` ON
slot-days **and** ≥ 300 trade-days on the holdout (the power-correction A4
form); for an always-on arm the floor is met by construction (1,459 on the
pass), so **the holdout of arm A cannot be UNDERPOWERED** — it builds or it
kills. Ladder unchanged: kill < 5 %, build ≥ 10 % p.a. net on `C`, block
bootstrap `p ≤ 0.025`, max drawdown ≤ 10 %, and **buffer never exhausted**
replaces "zero liquidations" as the survivability gate.

**Power statement (owed in `DESIGN.md` before the fit screen, per
`2026-09-power-correction.md`).** The ladder's binding gate is a size floor,
so power at the bar is 50 % by construction; the only power question is how
far above the bar the true edge must sit to pass at 80 %. On the pass's
holdout SE of 1.38 % p.a. at 143 slot-days, an always-on arm at ≈ 1,460
slot-days has SE ≈ 0.45 % p.a. (scaling by √10, to be **measured** by the
block bootstrap on fit, not assumed), so the 80 %-power edge is ≈ +10.4 %
p.a. — the bar itself, to within half a point. Conversely a true +4 % is
rejected at the kill bar with power > 95 %. This is the best-powered
registration the project has had, because the arm is always on.

**Prior, in numbers, before any pull.** Fit: arm A prints **+11 to +15 %**
on `C` if COIN-M funding resembles USD-M funding over 2020-08 → 2024-07
(it need not; COIN-M funding is a separate market and was often lower).
Holdout: **+2 to +5 %** — below the kill bar with high power. Probability of
BUILD ≈ 15 %, CLEAN KILL ≈ 65 %, INCONCLUSIVE ≈ 20 % (the inconclusive mass
is arm B's small-n and the chance that COIN-M funding on fit is too far
below USD-M to pass the screen). **A kill here is the useful outcome**: it
reads the largest unexplored number of the pass on the correct account
model, out of sample, with power, and closes the carry line for the whole
2020–2026 tape rather than leaving it hanging on a descriptive row.

**Sensitivities, fit-only, none a rescue.** (i) PM / Multi-Assets, USD-M
perp, un-re-centred coin hedge at the *published* haircut (95 %), uniMMR
path modelled, negative-funding tail at the grown notional — the row that
reproduces the +28.40 % shape honestly; (ii) haircut shock: the same row at
80 % and 60 % collateral (Binance moves these by announcement); (iii) COIN-M
maker on entry; (iv) buffer `b` = 0.02 N and 0.10 N; (v) the funding-gate
overlay at the pass's thresholds. Nothing in (i)–(v) is admissible in the
primary.

**Stage 0 checklist (Researcher, before any return).** COIN-M funding REST
vs archive identity on 2022-07 → 2026-06; `1/mmr` identity printed on 20
positions; COIN-M fee tier and contract multipliers asserted from
`exchangeInfo`; the user's PM collateral rates pulled with a read-only key
and filed (needed only for the alt descriptive and the PM sensitivity); user
confirms COIN-M and PM are visible in their account.

---

## 2. Question 3 — dated-futures (quarterly) basis

### 2.1 Data, verified rather than assumed

- **USD-M quarterlies:** `BTCUSDT_yymmdd` and `ETHUSDT_yymmdd` only — 24
  contracts each on `data.binance.vision`, 2021-03-26 → 2026-12-25, monthly
  klines at 1 m … 1 w, each contract's 1 h archive starting ≈ 7 months before
  expiry (e.g. `BTCUSDT_240628`: 2023-12 → 2024-07). `exchangeInfo` today
  lists exactly two `CURRENT_QUARTER` and two `NEXT_QUARTER` symbols; no alt
  quarterlies exist on USD-M and none ever did.
- **COIN-M quarterlies:** `BTCUSD_` and `ETHUSD_` from **2020-09-25** (26
  contracts each to 2026-12-25); `BNBUSD_`, `XRPUSD_` to 2026-12; `SOLUSD_`
  2024-09 → 2026-12; `ADAUSD_`, `LINKUSD_`, `DOTUSD_`, `LTCUSD_`, `BCHUSD_`
  2020-12/2021 → **2025-09-26 and no later** (discontinued); a handful of
  2020–21-only contracts (EOS, ETC, FIL, TRX). Same archive family, same
  `fetch.py` path with `futures/cm`.
- No funding series exists for a dated contract, by construction; the basis
  is the contract close against the spot close, and the payoff is the
  convergence to the settlement index at expiry (08:00 UTC on the expiry
  date), which is the mechanic the design pins.

### 2.2 The descriptive number (front contract, daily, ≥ 7 days to expiry)

`successors/results/quarterly_basis.txt`, annualised basis of the USD-M
front quarterly against spot:

| | BTC fit 2021-01 → 2024-07 | BTC holdout 2024-08 → 2026-07 | ETH fit | ETH holdout |
|---|---|---|---|---|
| mean, p.a. of notional | +9.4 % | +6.1 % | +8.7 % | +5.5 % |
| median | +6.6 % | +5.1 % | +5.8 % | +4.6 % |
| share of days ≥ 10 % p.a. | 30 % | 14 % | 30 % | 12 % |
| share of days ≥ 15 % p.a. | 16 % | 4 % | 16 % | 5 % |

By year (BTC mean): 2021 +17.7 %, 2022 +2.3 %, 2023 +6.2 %, 2024 +12.5 %,
2025 +6.1 %, 2026 YTD +2.9 %. The next-quarter contract runs ≈ 1 point
higher with 140 days to expiry. **This is the same premium as the funding
carry on the same venue with a date attached** — the year pattern is the
pass's pattern (2021 and 2024 pay, 2022 and 2025–26 do not) — so it is not
independent evidence of anything and does not escape the regime problem. It
does change the *shape* of the duty-cycle problem: the basis is known at
entry and locked to expiry, so "utilisation" becomes "share of days on which
a ≥ X % p.a. lock is on offer", and a position taken at a 10 % lock earns
10 % for its whole life whatever funding does afterwards.

### 2.3 Ruling

**Worth one, later, as arm B of the rank-1 registration; not standalone,
not now.** It shares the account structure (COIN-M `BTCUSD_yymmdd`,
1:1 coin-collateralised, liquidation-free by the same identity), the spot
tape, the harness and the ladder, and it adds a second, cheaper mechanic: one
round trip per quarter (≈ 0.4 % per 90 days ≈ 1.5 % p.a. at taker, against
the carry's 1.3 %), no funding-path risk, no negative-funding tail, no
9-settlement gate to tune. **Design, pinned here:** enter the front (or
next, whichever annualises higher) quarterly when its annualised basis at
the 1 h close ≥ **10 % p.a.** (the build bar itself, so a filled position is
a build-bar lock before costs by construction) with ≥ 14 days to expiry;
hold to expiry settlement; roll only if the new front also clears the
threshold; one slot per coin; sensitivities at 7 % and 15 %. Holdout prior
on `C = 1.05 N`: gated share of days 12–14 % × ≈ 12 % lock ≈ **+1.5 to
+3 %** p.a.; always-hold prior ≈ +4 to +5 % net. Both under the kill bar;
BUILD ≈ 10 %. With ≈ 8 positions on the holdout the arm will most likely be
UNDERPOWERED rather than killed — the design says so in advance and reports
the always-hold row (which has full exposure) beside it, exactly as
`REPORT.md` §5 did with the always-on benchmark. If rank 1 is not
dispatched, this goes back to the backlog with the data verified and the
prior above, and nobody pulls it standalone.

---

## 3. Question 2 — the duty-cycle question: CLOSED

### 3.1 What was computed

The 515-symbol panel is gitignored and no longer on any reachable disk (the
Researcher's worktree is gone), so it was **re-pulled** from the same
audited monthly archives with the crosssec package's own `fetch.py` (515
symbols with ≥ 400 daily bars, `fundingRate` + 1 d klines, 0 errors, 10
minutes) — `successors/pull.py`. Then the pass's gate was applied to every
symbol: rates normalised to a per-8 h equivalent (many 2024+ listings settle
every 4 h or 1 h), trailing 72 h mean (= 9 settlements at 8 h), ON ≥ 0.02 %,
OFF ≤ 0.005 %, a day counted ON if any settlement that day is ON. Jump hazard
is proxied by a day whose high ≥ +30 % over the prior close while ON — the
daily-bar cousin of the DOGE bar (+42 % in one hour, crossing `x_rc` and
`x_liq` together). `successors/duty.py`, `duty2.py`; per-symbol table in
`results/duty_symbols.csv`, panel tables in `results/duty_panel.txt`. On the
eight symbols this reproduces the pass to within the day-flag convention
(BTC 0.353, ETH 0.400 on fit against the pass's tier 0.373).

### 3.2 What it says

| universe, same gate | fit util. | fit rate ON | fit gross of notional | holdout util. | holdout rate ON | holdout gross | ≥30 % jump-days per ON symbol-year |
|---|---|---|---|---|---|---|---|
| the eight (tier means, pass) | 0.37 / 0.31 | 0.032 / 0.040 % | 13.2 / 13.3 % | 0.098 (majors) | ≈ 0.0025 % (bench.) | — | ≈ 2.6 (fit, this proxy) |
| top-30 by trailing-90 d volume | 0.368 | 0.039 % | 15.7 % | 0.112 | 0.020 % | 2.5 % | 3.1 fit / 6.3 holdout |
| top-100 | 0.339 | 0.039 % | 14.6 % | 0.119 | 0.021 % | 2.7 % | 4.3 fit / 7.8 holdout |
| all 515 listed | 0.343 | 0.034 % | 12.9 % | 0.159 | 0.023 % | 4.1 % | 4.1 fit / **7.7 holdout** |

Share of symbol-days ON by year, top-100 cut: **2020 0.62, 2021 0.60, 2022
0.02, 2023 0.20, 2024 0.43, 2025 0.08, 2026 0.07** — and the all-515 and
top-30 cuts print the same shape within a few points. Where the wider
universe's extra holdout utilisation comes from: of its 40,213 ON symbol-days,
49 % are in symbols doing $1–10M/day, 4 % under $1M, and only 10 % over
$100M; the rate while ON in those buckets is 0.026 % and 0.037 % against
0.018 % in the liquid bucket — higher per settlement, and paid by symbols
that jump ≥ 30 % in a day 7.7 times per ON symbol-year against 2.6 on the
eight over the fit period.

### 3.3 Ruling

**Closed.** (i) At the same rate threshold, no universe cut raises
utilisation on the fit period — 0.34–0.37 everywhere against the eight's
0.31–0.37 — because the ON share is a calendar of premium regimes (2020–21,
2024) shared by the whole venue, not a symbol property. (ii) On the holdout
the wider universe does show 0.16 against 0.11, but at a rate while ON of
0.023 % and a gross of 4.1 % of notional it is a *worse* trade than the one
that just died, and the extra ON days sit in the exact population — small,
young, jump-prone — that the alt tier was killed on. Under the pass's
liquidation gate that population fails the build before any return is read,
and under the COIN-M structure of §1 it is not available at all (no COIN-M
perps beyond the ≈ 40 listed). (iii) The eight were chosen on liquidity and
history, and the panel confirms that choice rather than indicting it. No
registration; the descriptive tables are the record.

---

## 4. What this note does not do

- It does not touch `H_majors`' inconclusive or `H_alts`' kill; both stand
  as written in `REPORT.md` §8.
- It does not register anything on the USD-M perp with spot unpostable at any
  leverage; that account model is closed by the pass.
- It does not read any holdout. The quarterly-basis table in §2.2 is a
  descriptive of a *different instrument* over both windows, computed to set
  a prior; the design dispatch should declare it as a prior read of the
  2024-08 → 2026-07 window at the descriptive level (front-contract mean and
  share ≥ 10 %), exactly as `REPORT.md` §7(7) declared the funding family's
  aggregate reads.
- It does not dispatch a Researcher. The coordinator routes.

## 5. Artefacts

`research/hedged-carry/successors/`: `pull.py` (the re-pull, writes to the
scratchpad; data gitignored), `duty.py`, `duty2.py` (utilisation panel),
`qbasis.py` (quarterly basis), `results/duty_symbols.csv` (515 rows: fit /
holdout / all utilisation, rate ON, gross, episode `x_max ≥ 48.5 %` count,
≥ 30 % jump-days ON, median quote volume), `results/duty_panel.txt`,
`results/quarterly_basis.txt`, `results/front_*.csv`, `results/next_*.csv`.
Exchange facts: Binance FAQ "What Is Multi-Assets Mode and Which Assets Are
Supported", "Updates on Binance Futures Multi-Assets Mode (2024-02-09)",
"Updates on … Auto-Exchange Threshold (2024-05-14)", "Binance Removes the
Minimum Wallet Balance Requirement for Portfolio Margin (2024-10-23)",
"Binance Portfolio Margin Trading Rules", "Wallet Transfers, Auto Fund
Functions, and Negative Balances in Binance Portfolio Margin", "Binance
Portfolio Margin Introduces Tiered Negative Balance Interest" (2025-05-17),
"Update on the Collateral Ratio Under Portfolio Margin" (2026-02-13), "How to
Activate the Portfolio Margin Mode"; `GET /fapi/v1/exchangeInfo` (assets),
`GET /dapi/v1/exchangeInfo`, `GET /dapi/v1/fundingRate`; S3 listings of
`data/futures/um|cm/monthly/klines/…` and `…/cm/monthly/fundingRate/…`, all
2026-09-16/17.
