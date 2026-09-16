# Architect note — Hedged spot–perp carry on Binance (long spot / short USD-M perp, funding-gated)

**Date:** 2026-09-16 · **Status:** designed, **awaiting Researcher dispatch by
the coordinator**; scope and numbers fixed below. This note is the binding
pre-registration for the Researcher's pass. `DESIGN.md` restates it
mechanically and is committed before any return is computed. Inputs:
`research/funding-rate-signals/REPORT.md` (the redundancy control that
exonerated the funding sensor; the mechanism prerequisite; §3.7 and §9),
`RESEARCH-LOG.md` Запись 29; `research/_surveys/2026-09-red-team.md` §5.2 and
§8 items 4, 7, 8; `research/_surveys/2026-09-power-correction.md` (binding on
§5 of this note); `research/_calibration/REPORT.md` §A.3–A.4, §C.2;
`PROJECT.md` "User rulings, 2026-09-16"; `research/funding-rate-signals/
ARCHITECT-NOTE.md` (the closest analogue; its §3 data rules and §4 accounting
are restated here, not re-derived) and `ARCHITECT-RULING-2026-09-16-stage0.md`;
`research/crosssec-instruments-in-play/REPORT.md` and Запись 30 (the third
"real but too small" case).

Nothing in this note was written with sight of any performance number of this
family. None exists. Data touched while writing: HTTP HEAD on the spot 1 h
kline month list of `data.binance.vision` for the eight symbols (listing
months only, §3.1). No return, no basis, no funding average was computed on
any tape for this design. The funding-family REPORT numbers quoted below are
published fit-period aggregates of a closed pass, used as priors and declared
as such in §7.2.

---

## 0. Summary of rulings

| # | question | ruling |
|---|---|---|
| S | **the unrun mirror arms** (`Bm_majors`, `Bm_alts`, mirror ruling of 2026-09-16) | **WITHDRAWN before computation; the hedged family supersedes them.** Their fit-period outcome is arithmetically foreknown: the mirror's price leg is the negation of B's, its funding leg is the negation of B's (a mirror long pays what the B short collected), its cost is identical. From REPORT §3.1: `Bm_alts ≈ +0.0208 − 0.0280 − 0.0216 = −0.029R`, `Bm_majors ≈ −0.0702 − 0.0390 − 0.0240 = −0.133R`; both below the `+0.05R` fit screen, both below the 300-event floor B already failed (196, 32), and the only rows where the negation is inexact (same-bar ambiguity, resolved as a loss for the mirror too) can only lower them. A registration whose screen outcome is known before it is run is not a test. **The funding family's ledger closes at 4 registered / 0 holdout reads; the α = 0.05/6 amendment is void, never applied.** The mirror *question* (does a funding-extreme break against the crowd revert) is answered by B's own price leg: −0.021R on the alts, not the −58 bp / t = −4.56 of b1 — the quantity-sensor result did not replicate through the price-of-crowding sensor. Recorded in `ARCHITECT-RULING-2026-09-16-mirror.md` (status header), `IDEAS-BACKLOG.md`, Запись 31. |
| 1 | the trade | **Long spot, short USD-M perp, equal USDT notional at entry, one symbol per slot, six alt slots and two major slots as two tier portfolios.** Position **ON** when the trailing 9-settlement (3-day) mean funding rate `f9 ≥ +0.02 %/8 h` (twice Binance's 0.01 % interest baseline; ≈ 22 % annualised); **OFF** when `f9 ≤ +0.005 %/8 h` (the premium is gone) — a hysteresis gate, §1.3. No price stop: the position is hedged. Exits: gate-OFF, the margin re-centre of §2, the fit/holdout boundary. **Not** the funding family's extreme-state entry, for the arithmetic in §1.5: at a 0.38 % round trip a 2–4-day extreme-state hold collects roughly what it costs. That rule is a mandatory fit-only row, not an arm. |
| 2 | the margin path | **Modelled on the real tape as the primary risk, not as a footnote.** Account model: USD-M **isolated** margin, **USDT collateral only, spot not postable** (the worst case the red team named). Perp leverage **L = 2** (margin = N/2; capital per slot = 1.5 N). Maintenance margin rate pinned **1.0 %** uniformly. Liquidation at perp adverse excursion `x_liq ≈ (1/L − mmr)/(1 + mmr) ≈ 48.5 %`. **Re-centre rule:** at the close of the first 1 h bar whose perp **high** is ≥ entry × (1 + x_liq/2) (≈ +24 %), both legs are closed at that close, the round trip is paid, and the position is re-opened at the same close if the gate is ON. A bar whose high reaches `x_liq` before a re-centre closed the position is a **liquidation**: perp closed at `x_liq` plus a 1.0 % liquidation fee, spot sold at the bar close, event counted. **Zero liquidations at L = 2 on fit and holdout is a build condition** (§8). Sensitivities: L = 3, 5; re-centre at 0.75 × buffer; published mmr table; the spot-as-collateral counterfactual. §2. |
| 3 | data | Funding and USD-M 1 h klines exactly as the funding family verified them (BTC/ETH/XRP/LINK from 2020-01, ADA 2020-01-31, BNB 2020-02-10, DOGE 2020-07-10, SOL 2020-09-14; zero missing 8 h slots; interval 8 h except the SOL FTX week). **Spot 1 h klines verified today** (§3.1): every spot pair lists *before* its perp, so funding start binds coverage. The funding family's gap rule and all three Stage-0 rulings **carry over verbatim** (§3.3); the SOL blackout is restated for a hedged book (the slot is flat across it). One new data rule: spot kline timestamps switch from milliseconds to microseconds in the 2025 archive files; Stage 0 must normalise and assert. |
| 4 | costs | **Taker on all four fills, primary:** spot 0.10 % + perp 0.05 % per side = **0.30 % of notional per round trip**, plus a **0.02 % per fill spread/slippage allowance = 0.08 %** → **0.38 %**. The spot–perp basis at entry and at unwind is **P&L, not cost** (received at entry, paid at unwind; §4.1) and is accounted from the two 1 h closes. **Maker is not admissible in the primary**: a fit-only sensitivity (perp leg maker on entry and on gate-OFF exits only, never on a re-centre or liquidation; spot has no maker discount at VIP 0), reported, never promoted. §4.3 says why. |
| 5 | power | **Observation unit = one UTC day of the tier portfolio's return on allocated capital.** Not a settlement, not a position, not a leg. `n_holdout = 731` days (two years), effective ≈ 400 after funding-persistence autocorrelation. Attenuation `a = 1`: an accrual reaches the mean whole (no bracket). Projected SE of the annualised holdout mean **1.1–2.2 % p.a.** at the assumed daily sd, so the **α gate does not bind; the level bar does**, as calibration §A.4 found for every family. 80 %-power edge ≈ **+10.9 to +11.9 % p.a. on capital** (assumptions to be replaced by fit measurements in `DESIGN.md` before the screen). The literature's ≥ 10 % p.a. is on **notional**, i.e. **6.7 % p.a. on capital at L = 2 — between this ladder's kill bar and build bar.** Stated plainly in §5.5: the *passive* trade is expected to be "real but not build-sized" by a factor of ≈ 1.5, not the 4–10× gap of the three prior families; the registered rate-gated arm on the alt tier is where that gap can close. |
| 6 | split / α | **Two-year holdout adopted: fit listing + warm-up .. 2024-07-31, holdout 2024-08-01 .. 2026-07-31, tail 2026-08.** The first holdout year lies inside the funding family's *seen fit window* at pooled-aggregate level (declared, §7.2) and inside the ORB/cmc-bot fit windows on BTC/ETH; the second year carries six BTC/ETH intraday reads and no funding or carry read. Paid for with a mandatory frozen forward confirmation (2026-08-01 .. 2026-10-31) on any REAL EDGE. **Family = 2 registered arms (H_majors, H_alts) → α = 0.05/2 = 0.025**, this line's own count, prior reads declared. Fit-period screen before any holdout read. |
| 7 | success | **R is not defined for a hedged position** (no stop distance, no bracket), so the ladder is restated in **annualised net return on allocated capital**: kill `< +5 % p.a.` or `p > 0.20`; build needs `≥ +10 % p.a.`, block-bootstrap `p ≤ 0.025`, fit same sign `≥ +5 %`, 90 % CI excludes 0, gross > 0, **0 liquidations at L = 2**, **holdout max drawdown on capital ≤ 10 %**, forward confirmation. The 5 %/10 % numbers are the `+0.05R/+0.10R` per-trade ladder converted at the funding family's own frequency and risk unit (§8.1: 0.05R × ≈ 13 trades per symbol-year × 1R ≈ 7.5 % of notional ≈ 4.8 % p.a. of notional; 0.10R ≈ 9.5 %) and then applied on *capital*, which is 1.5× stricter. Nothing is loosened; the units are adapted because the mechanic is an accrual. Sharpe is reported with its own bootstrap CI beside the return, not as a gate — §5.4 shows the return bar is the harder of the two at any plausible daily sd. |

The pre-registered family is **exactly two arms**: {H} × {majors, alts}. The
always-on Schmeling benchmark, the extreme-state (funding-family) entry
overlay, the price-gated shadow, every leverage and cost sensitivity — all
descriptive, fit-only where marked, and say so in their heading.

---

## 1. The trade

### 1.1 What is being claimed, and what is not

A Binance USD-M perpetual pays funding every 8 h from longs to shorts when the
perp trades at a premium to the index. Holding **short perp + long spot** in
equal notional is flat in price to first order and collects that funding; it
also collects the basis at entry (perp sold above spot) and pays the basis at
unwind. Schmeling, Schrimpf & Todorov (*Crypto Carry*, BIS WP 1087 / Mgmt Sci
2024; red-team §5.2) document this carry at above 10 % p.a. on average, 60 %
in bull phases, driven by leveraged trend-chasing demand against scarce
arbitrage capital, with the risk concentrated in **margin** rather than price.
This project's own funding pass (Запись 29) measured the ingredients on this
venue: funding-selected entries collect 25–37× more carry than price-selected
ones; the extreme state persists (40 % past 3 settlements, 28 % past 9;
forward rate ≈ 0.058 %/8 h ≈ 63 % annualised); and the *only* leg that killed
the directional version was the unhedged price leg (−0.046R against +0.035R
of carry on the alts). The claim here is the one that pass could not test:

> *On Binance, 2020–2026, a long-spot / short-perp position held while the
> trailing 3-day funding rate carries a premium earns, net of four taker fills,
> the basis round trip and a margin path that never liquidates at 2× perp
> leverage, at least 10 % per year on the capital it ties up.*

Not claimed: any price prediction; any cross-venue or cross-symbol basis; any
timing finer than the 8 h settlement clock. Prior for clearing the build bar:
**majors 15 %, alts 30–35 %** — §5.5 gives the arithmetic that sets them, and
it is the reason this design is registered on the gated rather than the
passive trade.

This is **not intraday and not directional**; the user opened the horizon to
1–5 days knowing that (PROJECT.md rulings). Holds here will typically run
days to weeks; the *decision* clock is 8 h. The design says why it is not
intraday: the edge is an accrual whose round trip costs ≈ 2 days of carry
(§1.5), so a shorter hold is a losing hold by construction.

### 1.2 The funding gate — one definition

At each settlement `k` (time `t_k`, rate `f_k`, from the archive, present rows
only, §3.3):

- `f9_k` = arithmetic mean of `{f_{k−8}, …, f_k}` — the trailing **9
  settlements = 3 days**, including the current one; `min_periods = 9`
  present rows; undefined otherwise (no decision on an undefined `f9`).
- **ON condition:** `f9_k ≥ +0.0002` (0.02 % per 8 h).
- **OFF condition:** `f9_k ≤ +0.00005` (0.005 % per 8 h).
- Between the two thresholds the state **persists** (hysteresis).

Why a 3-day mean and a hysteresis band. The funding family's absolute floor
(0.03 %/8 h at a single settlement) selected carry well and cost a round trip
every few days; here the round trip is ≈ 4× dearer (two legs, §4) and the hold
must be long enough to amortise it. The ON level is twice the 0.01 %/8 h
interest component — the smallest premium at which a 3-day hold (≈ 9 × 0.02 %
= 0.18 %) covers half the round trip and the ex-ante carry is ≈ 22 %
annualised on notional. The OFF level is half the interest component: the
premium has not merely shrunk, it has gone. The band exists so a rate that
oscillates around 0.02 % does not churn. Fit-only sensitivities, never
promoted: ON 0.015 / 0.03 %; OFF 0 / 0.01 %; window 3 / 15 settlements.

### 1.3 Entry, hold, unwind

- **Decision bar and prices.** `f_k` is final at `t_k`. The decision is taken
  at the **close of the 1 h bar that opens at `t_k`** (`t_k + 1 h`), the
  funding family's one-bar-lag convention. Entry: **buy spot at the spot 1 h
  close, sell perp at the perp 1 h close**, equal USDT notional `N` on each
  leg (spot quantity `N/S_e`, perp quantity `N/P_e`). Consequence: the first
  settlement a position can collect is `t_{k+1}`, 7 h later.
- **One position per symbol slot.** No pyramiding, no partial sizing: `N` is
  fixed per slot (§1.4). A slot that is OFF holds USDT and earns nothing.
- **Unwind on gate-OFF**: at the close of the 1 h bar opening at the OFF
  settlement `t_j`; the settlement at `t_j` is collected (position open at
  `t_j`, §4.2). Sell spot at the spot close, buy perp at the perp close.
- **Re-centre / liquidation**: §2. A re-centre is an unwind and an immediate
  re-entry; it counts as two round trips' worth of fills (one full round
  trip: close both, open both).
- **Re-entry after gate-OFF**: at the next settlement whose `f9` satisfies ON
  afresh; no cooldown (the hysteresis band is the cooldown).
- **Only the short-perp side is registered.** The mirror (short spot / long
  perp when funding is negative) needs a spot borrow the account model does
  not have; not registered, not a sensitivity.

### 1.4 Sizing and the tier portfolio

- Tier capital `C_tier` is notional 100 units, split into **equal fixed slots**:
  majors 2 × 50, alts 6 × 16.67. Slot capital `C_slot` is not compounded.
- Per position `N = C_slot / (1 + 1/L) = C_slot / 1.5` at L = 2: `N` in spot,
  `N/2` as isolated perp margin, the remaining 0 held as buffer — i.e. the
  slot is fully deployed when ON. (Sensitivities at L = 3, 5 deploy
  `C_slot / 1.33`, `C_slot / 1.2`.)
- **Tier daily return** `r_d = (equity_d − equity_{d−1}) / C_tier`, equity
  marked at the 00:00 UTC bar close (§4.2), idle slots contributing 0. This is
  the verdict series (§5.1). "Return on deployed capital" is a descriptive row.
- Why fixed slots and a tier portfolio rather than one pooled book with
  dynamic allocation: the verdict must be on capital the user would actually
  fund, and a dynamic allocator is a second signal that would need its own
  registration. Why not a basket weighted by carry (the paper's sort): eight
  symbols do not make a sort; the tier average is the honest analogue.

### 1.5 Why not the funding family's extreme-state entry (the arithmetic)

The natural first design is "enter on the §1.2 extreme state of the funding
family, hedged". It is a fit-only mandatory row (§6.6), not an arm, because
the numbers already published make it a losing round trip at this cost model:
A-alts trades collected 6.05 settlements at ≈ 0.058 %/8 h ≈ **0.35 % of
notional per trade**; a two-leg round trip is **0.38 %**. Removing the price
stop lengthens the hold (26 % of A trades were stopped) to perhaps 8–12
settlements → 0.45–0.70 %; the basis received at an extreme entry and paid at
a lapsed exit adds perhaps +0.1 to +0.3 %; net ≈ +0.2 to +0.6 % per trade, at
≈ 13 trades per symbol-year and ≈ 7 % slot utilisation → **≈ 2–5 % p.a. of
notional, ≈ 1.5–3.5 % p.a. on capital**. Below the kill bar before any
measurement. The extreme state is the right *sensor* and the wrong *gate*: it
is ON ≈ 5 % of the time and turns over every few days. The hysteresis gate of
§1.2 is ON whenever a premium exists, which the literature says is most of a
bull phase, and turns over when the premium ends, which is weeks. The row is
run so the REPORT can show the reader the two side by side.

### 1.6 Projected utilisation and turnover (assumption, not computed)

If the premium regime (`f9 ≥ 0.02 %`) covers ≈ 35–50 % of settlements on the
alts and ≈ 30–45 % on the majors over 2020–2026 (bull-phase-heavy), with
episodes lasting weeks, the gate yields ≈ 4–10 round trips per symbol-year and
utilisation ≈ 0.35–0.50. These two numbers, measured on fit, are the inputs
to §5's power statement and are the first thing `DESIGN.md`'s power section
replaces.

---

## 2. The margin path — the risk, modelled

### 2.1 Why this is the whole risk

A hedged carry has no price risk and one real loss mechanism: **the short perp
leg is marked against a rally and liquidated when its isolated margin runs
out, while the offsetting spot gain sits in a wallet that cannot be posted.**
A liquidation converts a hedged position into a naked long spot at the top of
a rally, charges a liquidation fee, and is followed by the re-hedge at the
worst basis of the episode. A backtest that credits funding and ignores this
reports a yield that a real account would not have survived. The red team
named it (§5.2, §8 item 7); this section is the model.

### 2.2 Account model (primary, pinned)

- **Venue:** Binance USD-M futures, **isolated margin**, **USDT collateral
  only**. Spot holdings are in the spot wallet and **cannot be posted** as
  perp margin. No cross-collateral, no Multi-Assets Mode, no Portfolio Margin.
  This is the account every user has; it is also the worst case, which is
  the case a primary must survive.
- **Leverage L = 2** on the perp leg: initial margin `M = N/2`.
- **Maintenance margin rate** `mmr = 1.0 %` of perp notional, uniform. Binance
  publishes per-symbol bracket tables (lowest bracket ≈ 0.4 % on BTC/ETH,
  0.5–1.0 % on the alts, rising with notional); 1.0 % is at or above every
  lowest-bracket value and is pinned so it cannot move. Stage 0 records the
  table **as published on the pull date** in `results/margin_table.csv`
  (source URL and date), and the published values are a sensitivity.
- **Liquidation fee** 1.0 % of notional (assumption; the published
  per-symbol "liquidation clearance fee" is recorded beside the mmr table
  and used in the same sensitivity).
- **Mark price** for the liquidation check: the perp 1 h **high** (the worst
  intra-bar mark; the archive has no mark-price series). Conservative by
  construction; stated in the REPORT.

### 2.3 The margin balance and the liquidation level

For a short perp entered at `P_e` with margin `M`, funding collected so far
`F` (USDT), and perp price `P`, with `x = P/P_e − 1`:

```
margin_balance(x) = M + F − N·x
maintenance(x)    = mmr · N · (1 + x)
liquidation  ⇔    margin_balance ≤ maintenance
x_liq             = (M/N + F/N − mmr) / (1 + mmr)
```

At L = 2, `F = 0`, `mmr = 1 %`: `x_liq = (0.5 − 0.01)/1.01 ≈ 48.5 %`. At
L = 3: ≈ 32.0 %; L = 5: ≈ 18.8 %; L = 10: ≈ 8.9 %. Funding collected raises
`x_liq` slightly (it is added to the margin balance — Binance credits funding
to the futures wallet); the model includes it.

### 2.4 The re-centre rule (liquidation avoidance, pinned)

- **Trigger:** the first 1 h bar during the hold whose perp **high** ≥
  `P_e × (1 + x_rc)` with `x_rc = 0.5 × x_liq` (≈ +24.0 % at L = 2, ≈ +16.0 %
  at L = 3, ≈ +9.4 % at L = 5).
- **Action, at that bar's close:** sell spot at the spot close, buy perp at
  the perp close (taker, both; the basis at that close is paid); if the gate
  is ON at the most recent settlement, **re-open** at the same closes with a
  fresh `N = C_slot/1.5` — the spot gain has been realised into USDT and half
  of the slot is posted as margin again. If the gate is OFF, stay flat.
- Why half the buffer, and why a bar close: the re-centre is a *decision*
  taken with one bar of lag on a threshold seen at the bar's high; a real
  operator would act sooner and more often (margin alerts), which only makes
  the modelled path more conservative in the one way that matters
  (liquidation frequency), and slightly less conservative in cost (fewer
  round trips). Half leaves a further ≈ 24 % of rally for the bar in which
  the threshold is crossed; §2.5 counts the cases where that was not enough.
- Sensitivity, fit-only: `x_rc = 0.75 × x_liq`.

### 2.5 Liquidation — when the rule fails

If a bar's perp high reaches `P_e × (1 + x_liq)` and no re-centre closed the
position at an earlier bar (i.e. the bar that crosses `x_rc` also crosses
`x_liq`, or the crossing happens inside the hour of entry), the position is
**liquidated**: perp closed at `P_e × (1 + x_liq)`, liquidation fee 1.0 % of
notional charged, spot sold at that bar's close (taker). The realised loss is
`N·(x_liq − x_close) + fee + basis` where `x_close` is the spot close's
excursion — usually a loss because the liquidation print is at the high.
Every liquidation is logged (`results/liquidations.csv`: symbol, entry, bar,
`x_liq`, loss) and **one liquidation at the primary L = 2 on fit or holdout
fails the build** (§8). This is the rule that makes the margin path a gate
and not a footnote.

### 2.6 What the REPORT must print, per tier, fit and holdout

- Distribution of the **maximum perp adverse excursion per position** (max
  over the hold of `high/P_e − 1`): mean, median, p90, p99, max.
- Re-centres: count, count per symbol-year, mean cost per re-centre
  (round trip + basis paid), share of positions with ≥ 1 re-centre.
- Liquidations at L = 2 (expected 0); at L = 3, 5 (counted, with losses).
- **Survivable leverage**: for each position, `L*` = the largest leverage at
  which no bar would have breached `x_liq`; report the distribution and the
  tier-level "L at which 99 % of positions survive without a re-centre".
- The **capital efficiency table**: return on capital at L = 2, 3, 5 net of
  re-centres and liquidations, beside return on notional — the reader sees
  what leverage buys and what it costs on this tape.
- **Spot-as-collateral counterfactual** (descriptive): under an account where
  spot is posted at a 90 % haircut and nets against the perp mark, `x_liq` is
  effectively unbounded for BTC/ETH (eligible collateral) — the row reports
  return on capital at `N = C_slot/1.1` with no re-centres for the majors, and
  notes that the six alts are not eligible collateral in Binance
  Multi-Assets Mode as published, so the counterfactual does not apply to
  them. No verdict; it exists so a future build ruling knows the size of the
  prize of a better account type.

---

## 3. Data

### 3.1 Sources and verified coverage

| dataset | path on `data.binance.vision` | status |
|---|---|---|
| funding | `data/futures/um/monthly/fundingRate/<SYM>/` | verified by the funding family (Запись 29 §1.1): zero missing 8 h slots on all 8 symbols; one interval anomaly (SOL, §3.3) |
| USD-M 1 h klines | `data/futures/um/monthly/klines/<SYM>/1h/` | verified by the funding family; 240 bars backfilled from the daily prefix on SOL/XRP (§3.3) |
| **spot 1 h klines** | `data/spot/monthly/klines/<SYM>/1h/<SYM>-1h-<YYYY-MM>.zip` | **HTTP HEAD 2026-09-16**: first archive month BTCUSDT, ETHUSDT **2017-08**; BNBUSDT **2018-01**; XRPUSDT, ADAUSDT, LINKUSDT **2019-01**; DOGEUSDT **2019-07**; SOLUSDT **2020-08**; all present through **2026-08**. |

Every spot pair lists **before** its perp, so **coverage is bound by the
funding start** (BTC/ETH/XRP/LINK 2020-01, ADA 2020-01-31, BNB 2020-02-10,
DOGE 2020-07-10, SOL 2020-09-14), and the fit start per symbol is the
funding family's computed `results/fit_starts.csv` date **plus the §3.4
warm-up restated for a 9-settlement window** (3 days instead of 15). The spot
pair is the same ticker (`BTCUSDT` spot vs `BTCUSDT` perp).

**Stage 0 must verify all of this on the full pull**, per symbol and per
month, for the spot series exactly as `data_audit.py` did for the perp series
(rows expected vs present, gaps, duplicates, first/last timestamp) and
deliver `results/data_audit_spot.csv` **before** any derived series exists.
Reuse `research/funding-rate-signals/fetch_data.py` and `data_audit.py` by
import or copy — the perp/funding audit must reproduce the funding family's
row counts exactly (a harness check, §6.7).

**New data rule — timestamp units.** Binance's spot archive switched kline
`open_time`/`close_time` from milliseconds to **microseconds** in files from
2025-01 onward (16-digit values). Stage 0 must detect the unit per file
(digit count), normalise to UTC bar opens, and `checks.py` must assert that
every spot bar open lies on the hour and that the spot and perp bar grids
coincide on every present hour. A file whose unit cannot be determined stops
the pull.

### 3.2 Alignment

- Settlement `k` → the 1 h bar whose open time equals `calc_time` rounded to
  the minute (funding family §3.2); `checks.py` asserts it.
- **Basis** at bar `t`: `b_t = P_t / S_t − 1` from the perp and spot closes of
  the same open time. Both feeds are UTC by open time; the two closes are
  within the same second by construction of the archive. Stage 0 prints the
  distribution of `b_t` per symbol (mean, sd, p1, p99, max |b|); any
  `|b_t| > 5 %` is flagged as a data anomaly, listed, and the bar is treated
  as absent for both legs (no decision, no mark; the position carries the
  previous mark).
- `f9_k` uses settlements `≤ k` only; prefix stability check as before.
- Klines: 1 h by open time, UTC; an absent bar is absent on the leg it is
  absent from; a position spanning an absent bar on either leg is marked
  with the last present closes and flagged; a position spanning more than 24
  absent bar-hours on either leg is **unwound at the next present bar and
  counted** (the portfolio series cannot exclude days).
- Funding notional at settlement `j` is marked at the **perp open of the bar
  opening at `t_j`** (last-price proxy for mark price; funding family §3.2).

### 3.3 Gap rule and Stage-0 rulings — restated, not re-derived

1. **Grid, missing slots, duplicates, secondary source, no interpolation:**
   funding family §3.3 rules 1–4 verbatim. A missing settlement contributes
   zero funding, is flagged on the position, and cannot carry a decision;
   `f9` uses present rows with `min_periods = 9`, undefined otherwise.
2. **Interval changes** (rule 2): escalate on any *new* non-8 h episode; the
   hours-restatement fallback stands.
3. **SOL FTX-week blackout** (`ARCHITECT-RULING-2026-09-16-stage0.md` (1)):
   rows in `[2022-11-09 20:00, 2022-11-18 16:00)` UTC are removed from the
   SOL settlement stream for all signal purposes and from the `f9` window.
   **Restated for a hedged book:** a SOL position open at the blackout start
   is **unwound at the close of the 1 h bar opening 2022-11-09 19:00** (the
   last bar before the blackout; normal costs, basis paid); the SOL slot is
   flat through the blackout and may re-enter at the first settlement after
   2022-11-18 16:00 at which `f9` is defined on non-blackout rows (nine such
   rows → 2022-11-21 08:00 at the earliest). Counted and disclosed. **Mandatory
   descriptive row:** the counterfactual P&L of holding through the blackout
   at the printed rates (4 h then 2 h intervals, part of it at the −2 % cap,
   which a *short* perp would have **paid**) — the blackout removes a real
   loss of the hedged trade from the SOL evidence, and the REPORT's doubts
   section must say so with the number. Holdout unaffected (no non-8 h rows
   after 2022-11).
4. **Truncated monthly kline zips** (ruling (2)): the daily-prefix backfill of
   SOL/XRP 2022-02-26..28 and 2022-04-01..02 is authorised for the perp
   series; if the spot pull shows truncated months, the same procedure and
   the same neighbour-day identity check apply, logged in
   `results/data_audit_fills.csv`; any other discrepancy escalates.
5. **Pre-listing funding rows** (ruling (3)): warm-up clock starts at
   `max(first funding row, first perp bar, first spot bar)`; the 38 rows feed
   `f9` history only.
6. **Symbol rule:** a symbol with > 5 % missing funding slots or > 1 % missing
   spot bars in the fit window is dropped from its tier (reported); a tier
   that loses more than half its symbols stops and escalates.

### 3.4 Windows

| window | dates | use |
|---|---|---|
| warm-up | listing .. listing + 3 days (9 settlements) | `f9` undefined; no positions |
| **fit** | warm-up end .. **2024-07-31** | everything exploratory, every sensitivity, the §7.3 screen, the §5 power measurements |
| **holdout** | **2024-08-01 .. 2026-07-31** (731 days) | computed once, at the end, only for arms that pass the screen |
| tail | 2026-08-01 .. last archived month | non-gating "post-holdout tail" row |
| forward confirmation | 2026-08-01 .. 2026-10-31 | §7.4, run later, frozen now |

The fit series ends with a mark-to-market at the 2024-07-31 00:00 UTC close
(positions are *not* closed; no cost is charged at the boundary); the
**holdout run starts flat on 2024-08-01** and enters at the first ON
settlement (costs charged), so the holdout carries its own entry costs and
never inherits a fit position. Never re-cut.

---

## 4. Accounting

### 4.1 Per position, in USDT, notional `N`

```
S_e, P_e        spot / perp 1 h closes at entry;  S_x, P_x at unwind
b_e = P_e/S_e − 1,  b_x = P_x/S_x − 1               (basis, received / paid)
q_s = N / S_e   (spot units)      q_p = N / P_e     (perp units)
spot_pnl     = q_s · (S_x − S_e)                    = N · (S_x/S_e − 1)
perp_pnl     = −q_p · (P_x − P_e)                   = −N · (P_x/P_e − 1)
hedge_pnl    = spot_pnl + perp_pnl                  ≈ N · (b_e − b_x)  (to first order)
funding      = Σ_{j : t_entry < t_j < t_exit}  f_j · q_p · P_open(t_j)     (short: +f collects)
fees         = 0.0030 · N   (spot 0.0010 + perp 0.0005, each side, at entry and unwind)
slip         = 0.0008 · N   (0.0002 per fill × 4)
net          = hedge_pnl + funding − fees − slip     (− liquidation fee if §2.5)
gross        = hedge_pnl + funding
```

`hedge_pnl` is reported split into its exact form (`spot_pnl + perp_pnl`) and
its basis reading (`N·(b_e − b_x)`); the difference is the quantity mismatch
`q_s·S vs q_p·P`, second order in `b`, printed so nobody wonders. Sign check:
funding positive with a short perp → `funding > 0`; entry at a premium
(`b_e > 0`) and unwind at par (`b_x = 0`) → `hedge_pnl > 0`.

### 4.2 Marking and timing

- **Daily mark** at the 00:00 UTC bar close: `equity_d = Σ_slots [USDT_slot +
  q_s·S_d − q_p·(P_d − P_e) + funding_to_date − fees_paid]` with `S_d, P_d` the
  closes of the bar closing at 00:00 UTC. `r_d = (equity_d − equity_{d−1})/C_tier`.
  Entry fees and slippage are charged on the entry day, exit costs on the
  exit day, funding on the day of its settlement.
- **A settlement is collected iff the position is open strictly across it:
  `t_entry < t_j < t_exit`** (funding family §4.2 verbatim). Gate-OFF unwinds
  at `t_j + 1 h` collect `t_j`. Re-centres and liquidations at a bar close
  collect any settlement at that bar's open. No minimum-settlement
  requirement; a position closed before its first settlement is a position
  with zero funding and full costs, and it counts.
- The fit/holdout boundary is a mark, not an exit (§3.4).

### 4.3 Costs — the ruling on maker fills

**Primary: taker on every fill.** Reasons, fixed now so no fit number can
argue: (i) the two legs must be filled together or the position carries a
naked leg for the interval — the honest simultaneous fill is a taker on both;
(ii) re-centres and liquidations are urgent by definition and can never be
maker; (iii) Binance spot at VIP 0 charges 0.10 % maker **and** taker, so a
maker assumption helps only the perp leg (0.02 % vs 0.05 %), i.e. 0.06 % of
the 0.38 % round trip; (iv) a resting limit sell on the perp during a rally
fills only when price rises through it, which is favourable when it fills and
unhedged-by-omission when it does not — a fill model the archive cannot
support (red-team §2.2). **Fit-only sensitivity, never promoted:** perp maker
0.02 % on entry and on gate-OFF unwinds, taker on re-centres; slippage
allowance halved on the maker fills → round trip ≈ 0.30 %. Further fit-only
rows: BNB fee discount (spot 0.075 %, perp 0.045 %); slippage allowance
doubled (0.16 %); zero cost (= gross). The REPORT prints all four beside the
primary. Every one is labelled "fit-only, not a rescue".

**Why the cost model matters more here than anywhere before.** At the ON
threshold the ex-ante carry is 0.02 %/8 h; a 0.38 % round trip is **19
settlements ≈ 6.3 days** of carry at that rate, ≈ 2.2 days at the extreme-
state rate of 0.058 %. Every design choice in §1 (window, hysteresis, no
price stop, no cooldown) exists to make holds long relative to that number.
The mandatory decomposition (§4.4) shows the reader the ratio directly.

### 4.4 Mandatory decomposition, every table

Every table that shows a net return shows, in adjacent columns: mean
`funding` (annualised on capital), mean `hedge_pnl`, mean `fees + slip`,
re-centre and liquidation cost, **utilisation** (share of slot-days ON),
**round trips per symbol-year**, mean hold in settlements, share of positions
with zero settlements, and the **cost/carry ratio** (fees + slip ÷ funding). A
verdict-bearing number without its decomposition is a protocol violation.

---

## 5. Power — mandatory, binding per `2026-09-power-correction.md`

### 5.1 The observation unit

**One observation is one UTC day of the tier portfolio's return on allocated
capital**, `r_d` of §1.4. Not a settlement (three per day, perfectly
dependent within a position), not a position (variable length, overlapping
across slots), not a leg. Carry is a continuous accrual: the natural unit is
the calendar unit at which the portfolio is marked, and the cross-symbol
dependence the power correction §1.1 warned about is already *inside* one
day's return (six alt slots enter `r_d` as a sum, not as six observations).

Two dependence corrections remain and are made explicit:

- **Autocorrelation of `r_d`** from funding persistence (a premium that is
  high today is high tomorrow). With lag-1 autocorrelation `ρ₁`, the
  effective sample is `n_eff ≈ n·(1 − ρ₁)/(1 + ρ₁)`: at `ρ₁ = 0.3`, 731 days
  are worth ≈ 394; at 0.5, ≈ 244. The **10-day block bootstrap** (§6.3) is the
  inference tool precisely because of this; `ρ₁` is measured on fit and
  printed.
- **Overlap across arms**: majors and alts share the market's funding regime.
  The two arms are not independent tests; α = 0.05/2 is applied anyway
  (conservative in the right direction).

### 5.2 Attenuation

`a = 1`. A funding accrual enters the daily mean whole; there is no bracket,
no stop, no target to truncate it (calibration §A.3's 0.45–0.60 factor was a
property of the ±1R template and does not apply). Costs subtract, they do not
attenuate. The §6.7 planted-accrual test measures this identity to float.

### 5.3 Standard error, in the design's own units

```
SE(annualised mean) = 365 · sd_daily / sqrt(n_eff)
```

with `n_eff` from §5.1. **Assumptions, to be replaced by fit measurements in
`DESIGN.md` before the screen** (§7.3): daily sd of `r_d` is basis-mark noise
× utilisation, pooled across slots with cross-symbol basis correlation
≈ 0.5, plus funding variance. Base case **majors 0.06 %/day, alts 0.12 %/day**
(vol on capital ≈ 1.1 % and 2.3 % p.a.); band 0.06–0.36 %.

| sd_daily | `n_eff` (ρ₁ = 0.3, 731 d) | SE, holdout (p.a.) | α = 0.025 threshold on the mean (p.a.) | **80 %-power edge** (p.a. on capital) | Sharpe at the +10 % bar |
|---|---|---|---|---|---|
| 0.06 % | 394 | 1.10 % | 2.2 % | **+10.9 %** | 8.7 |
| **0.12 %** | 394 | 2.21 % | 4.3 % | **+11.9 %** | 4.4 |
| 0.24 % | 394 | 4.41 % | 8.6 % | +13.7 % | 2.2 |
| 0.36 % | 394 | 6.62 % | 13.0 % (α binds) | +18.5 % | 1.45 |
| *0.12 %, one-year holdout, reference* | 197 | 3.12 % | 6.1 % | +12.6 % | 4.4 |
| *fit, 0.12 %, ≈ 1,640 d* | 884 | 1.47 % | 2.9 % | (screen: +5 %, p ≤ 0.05 → power > 99 % at a true +10 %) | — |

Reading: **at any daily sd below ≈ 0.3 %, the α gate never binds and the
+10 % p.a. level bar decides alone** — the same structure calibration §A.4
found for the R ladder. The 80 %-power edge is the bar plus 0.84 SE:
**≈ +11–12 % p.a. on capital** in the base case. The two-year holdout roughly
halves the SE against one year; it does not move the bar. The fit screen at
SE ≈ 1.5 % cannot lose a build-sized edge and does not need the holdout to
find out there is none.

### 5.4 What a Sharpe of the literature's size means here

A one-sided test of the mean at α = 0.025 on `n_eff = 394` days is
`SR_annual ≥ 1.96 / sqrt(394/365) ≈ 1.9` as a Gaussian approximation; the
block bootstrap is what is actually applied and is heavier in the tails. So
this holdout **can certify an annualised Sharpe of ≈ 1.9 at coin-flip power,
≈ 2.7 at 80 % power** (`(1.96 + 0.84)/sqrt(394/365)`) — on the *Sharpe* axis
this family is no better off than the directional ones. What is different is
that for an accrual the Sharpe and the level are decoupled: at sd 0.12 %/day
a +10 % p.a. mean *is* Sharpe 4.4, and the level bar is the harder one. If the
fit-measured sd comes out ≥ 0.3 %/day, the family is in the directional
families' regime (Sharpe ≈ 2 needed) and `DESIGN.md`'s power section says so
in bold. **The carry literature reports the level (≥ 10 % p.a., 60 % in bull
phases) and not a net Sharpe of this exact rule at Binance retail fees; no
Sharpe is put beside the bar that this note cannot source.** The fit period
measures it.

### 5.5 The literature's number in this project's units — and the honest gap

Schmeling et al.'s ≥ 10 % p.a. is on **notional**, gross of retail fees, on
the *carry-sorted* trade. Converted:

| object | on notional | on capital, L = 2 (÷ 1.5) | L = 3 (÷ 1.33) | vs ladder |
|---|---|---|---|---|
| passive premium, literature average | ≈ 10 % | **6.7 %** | 7.5 % | above kill (5 %), **below build (10 %)** |
| bull-phase premium, literature | ≈ 60 % | 40 % | 45 % | far above build |
| funding family's extreme-state forward rate, 2020–25 fit | 63 % while ON | 42 % while ON | — | ON ≈ 5 % of the time (§1.5) |
| what the registered arm needs (ON ≈ 45 % of the time, 4–10 round trips/yr at 0.38 %) | ≈ 15 % | **10 %** | 11.3 % | = build bar |

So: **the passive Schmeling trade is expected to sit between the kill and the
build bar on capital — a "real but too small" object by a factor of ≈ 1.5.**
That is the fourth instance of the pattern in one respect (a documented
mechanism whose *level* is below this ladder's build bar) and different in
two others: the gap is 1.5×, not the 4–10× of funding-directional, ORB and
the cross-section; and the gap is created by the **capital denominator**
(margin that must sit idle), which is a design variable with a modelled cost
(§2), not by a bracket or by costs alone. The registered arm closes the gap
only if the gate concentrates the position in the premium periods so that
the **rate while ON averages ≈ 0.035 %/8 h with utilisation ≈ 0.45** (≈ 17 % gross of notional, less ≈ 7 round trips) — which
the funding family's persistence numbers make plausible on the alts and not
on the majors. Hence the priors of §1.1, and hence the rule that the fit
screen (§7.3) settles this before any holdout is read.

`DESIGN.md` **must** contain a "Power, in portfolio-days" section, committed
with the screen decision and before any holdout number, with: fit days per
tier; measured `sd_daily`, `ρ₁`, utilisation, round trips per symbol-year,
mean rate while ON; the projected holdout SE from §5.3's formula with those
numbers; the 80 %-power edge; and this §5.5 table with the measured "what the
arm needs" row beside the literature row. If the 80 %-power edge exceeds
+15 % p.a., the statement says so in bold and the Researcher proceeds anyway.

---

## 6. Controls

### 6.1 Null A — timing placebo (labelling control, 1,000 draws), per arm

Per symbol, take the real ON segments (count and lengths in settlements) and
place them at random non-overlapping start settlements inside the same
window; run the identical accounting, costs, margin model on the placebo
schedule; form the tier series; one-sided `p = share of draws whose
annualised mean ≥ observed`. What it holds fixed: utilisation, hold lengths,
turnover, cost, margin rule. What it destroys: the alignment of ON with the
premium. So `p_A` answers "does the gate select carry better than the same
exposure at random times" — the **timing** question. **It labels; it does
not gate.** `p_A ≤ 0.05` → the arm is **TIMED CARRY**; otherwise **PASSIVE
CARRY** (the gate adds nothing beyond exposure). A PASSIVE label on a REAL
EDGE routes to a build ruling whose object is the always-on trade with the
gate as a risk overlay; the REPORT's first paragraph says which.

### 6.2 Null B — whole-stream day shift (250 draws)

Shift the real schedule by `k ~ U{1..250}` days, same accounting.

### 6.3 Certification of the premium — block bootstrap (gating)

The mean of the holdout tier series is tested against zero with a **10-day
block bootstrap, 2,000 draws** (blocks of consecutive UTC days, resampled
with replacement to the series length): one-sided `p_boot = share of draws
with annualised mean ≤ 0`, and the 90 % interval of the annualised mean. The
ladder's `p` is `p_boot`. The same bootstrap yields the Sharpe interval
(reported, not gated) and the max-drawdown interval.

### 6.4 The always-on benchmark (mandatory, descriptive)

Per tier, the Schmeling passive trade: every slot ON from its fit start,
re-centring per §2, never gated. Same accounting. Printed beside the arm on
every window with the full §4.4 decomposition. If the always-on return on
capital exceeds the arm's on fit **and** on holdout, the REPORT's first
paragraph says "the gate costs money" regardless of the arm's verdict.

### 6.5 The price-gated shadow (descriptive, non-gating)

The identical pipeline with `f9` replaced by the trailing 3-day spot return
(ON at ≥ +3 %, OFF at ≤ 0 %, same hysteresis shape): does a price gate select
carry as well as a funding gate? The funding family answered this for the
directional template (25–37×); here it is printed once so the hedged family
carries its own version of the answer. No margin.

### 6.6 The extreme-state overlay (mandatory, fit-only)

The funding family §1.2/§1.3 extreme-state entry (two consecutive extreme-
positive settlements; exit on lapse to ≤ 0.01 %/8 h or 30 settlements),
hedged, same accounting, same margin model. This is the §1.5 arithmetic run
on the tape; printed beside the arm so the reader sees why it is not the arm.
Never promoted; a number here that alone would clear the build bar is grounds
for one Architect-authorised follow-up registration, never a re-labelling.

### 6.7 Harness validation (before the screen)

1. **Audit identity:** the perp/funding pull reproduces the funding family's
   `results/data_audit.csv` row counts, first/last timestamps and gap list
   exactly.
2. **Hedge identity:** with the spot series set equal to the perp series
   (`b ≡ 0`), every position's `hedge_pnl == 0` to float and `net == funding −
   fees − slip` exactly.
3. **Planted accrual (the `a = 1` test):** add a constant `d ∈ {−0.0002, 0,
   +0.0002, +0.0005}` to every settlement rate *while a position is open* on
   the real fit tape; the tier's annualised mean must move by exactly
   `d × (settlements collected) × Σ q_p·P_open / C_tier / years`, to `1e−9`;
   schedule, entries, re-centres invariant in `d` (funding enters the margin
   balance, so the liquidation level may move by `F/N`: assert re-centres
   invariant and liquidations non-increasing in `d`).
4. **Margin identity:** a synthetic rally of exactly `x_rc` and exactly
   `x_liq` on a flat tape triggers the re-centre and the liquidation on the
   expected bar and no other; at L = 2, 3, 5.
5. **Ledger check** (`MECHANIC-PROOF.md`): ten fit-period positions per tier,
   chosen by a fixed outcome-blind stride, with the settlement ledger (each
   `t_j`, `f_j`, mark, USDT), both entry closes, the basis received, both
   exit closes, the basis paid, fees, re-centres if any, and the daily marks
   across the hold, hand-recomputed to `1e−9`.
6. `checks.py`: every settlement on a bar open; spot and perp grids coincide;
   `f9` prefix stability; no settlement counted outside `(t_entry, t_exit)`;
   no decision on a blackout or missing row; timestamp units normalised
   (§3.1); `|b| > 5 %` bars listed.

### 6.8 Mechanism prerequisite (fit-only, descriptive)

Mean and median funding rate **while ON** vs **while OFF**, per tier; the
survival curve of the ON state (share still ON after 3, 9, 15, 30, 60, 90
settlements). If the rate while ON is not at least **2×** the rate while OFF,
the gate is not selecting and the REPORT says so in §0 whatever the return.

### 6.9 Frequency floors

Fit: **≥ 300 ON slot-days and ≥ 20 round trips per tier**; holdout: **≥ 150
ON slot-days per tier** (the calendar length is fixed at 731 days). Below the
floor the arm is **"unmeasurable at the pre-committed definition"**;
thresholds are not loosened to manufacture exposure.

---

## 7. Universe, split, prior reads, α, screen

### 7.1 Universe

The project's 8: BTCUSDT, ETHUSDT (majors); SOLUSDT, BNBUSDT, XRPUSDT,
DOGEUSDT, ADAUSDT, LINKUSDT (alts) — two tier portfolios (§1.4). Reasons:
like-for-like with the funding family whose measurements this design rests
on; spot pairs exist for all eight from before their perps; the alts are
where the premium is largest and the margin path is hardest, which is the
pair of facts the design must weigh. Survivorship declared as before: all
eight are listed in 2026; the tape under-represents perps whose funding blew
out before delisting — for a hedged carry that is the population where the
carry *and* the liquidation risk were largest. Not corrected.

### 7.2 Split and prior reads, declared

Fit: warm-up end .. 2024-07-31 (≈ 4.5 years). **Holdout: 2024-08-01 ..
2026-07-31, two years**, the red-team §8 item 4 convention, adopted here as
the first crypto design after the funding family's cut. Declared:

- **2024-08-01 .. 2025-07-31** lay inside the funding family's **fit** window.
  What was seen of it: pooled fit-period aggregates over 2020–2025-07 (the
  carry per trade, the survival curves, the forward rate) that this note
  quotes as priors. No year-by-year number, no gate of this design, no
  hedged P&L, no basis series was computed on it. The gate thresholds here
  (0.02 %, 0.005 %, 9 settlements) derive from the 0.01 % interest baseline
  and the funding family's pre-registered floor, not from any fit number.
  The same year was fit data for the ORB crypto arms and cmc-bot on BTC/ETH
  (price-only). It has never been a holdout for anything.
- **2025-08-01 .. 2026-07-31** has been read by six BTC/ETH intraday,
  price-only registrations (Записи 18, 22, 23); never by a funding, basis or
  multi-day design. The funding family and the cross-sectional family were
  screened out before reading it.

**Paid for** with the §7.4 forward confirmation on any REAL EDGE, exactly as
the cross-sectional family paid for its count. This line starts its own count.

### 7.3 Fit-period screen (committed before the holdout is touched)

Per arm on fit: annualised net return on capital, `p_boot`, floors, liquidation
count at L = 2, and the §5.5 power section with measured inputs. **An arm
reads the holdout only if** fit net `≥ +5 % p.a.`, fit `p_boot ≤ 0.05`,
floors met, and **0 liquidations at L = 2**. Arms that fail are **SCREENED
OUT — fit-period kill**; their holdout is never computed. The screen decision
is a commit. No parameter moves for power or for a liquidation.

### 7.4 Forward confirmation (pre-registered now, run later)

For a REAL EDGE arm only: the frozen rule run on 2026-08-01 .. 2026-10-31
once that archive exists; required: net ≥ 0 on capital and 0 liquidations
at L = 2. Failure re-labels the verdict INCONCLUSIVE — forward-fail. Three
months is short for an accrual and cannot certify anything; it exists to
catch a regime that ended at the holdout's edge.

### 7.5 α

**Family = 2 registered arms → α = 0.05/2 = 0.025**, counted by registration
whether or not an arm survives the screen.

---

## 8. Verdict ladder

### 8.1 Units, and why the standard is not loosened

`1R` is undefined for a hedged position. The per-trade ladder's bars are
converted at the funding family's own frequency and risk unit and then made
stricter by the capital denominator:

| per-trade ladder | × trades per symbol-year (A alts: 394 / ≈ 31 symbol-years ≈ 12.7) | × 1R (1.5 dATR ≈ 7.5 % of price on a typical alt) | ≈ p.a. of notional | on capital at L = 2 |
|---|---|---|---|---|
| +0.05R kill bar | 0.64R/yr | — | **4.8 %** | 3.2 % |
| +0.10R build bar | 1.27R/yr | — | **9.5 %** | 6.3 % |

The ladder below uses **5 % and 10 % p.a. on capital**: the same numbers the
per-trade ladder implies per year of notional, charged against 1.5× the
notional. Nothing is looser; the majors (smaller dATR, fewer trades) would
map lower and are held to the same bar.

### 8.2 Applied mechanically to each arm's holdout tier series

| condition | verdict |
|---|---|
| screened out (§7.3) | **NO EDGE — fit-period kill.** Holdout not read. |
| holdout ON slot-days `< 150` | **UNDERPOWERED — inconclusive.** |
| net `< +5 % p.a.` on capital **or** `p_boot > 0.20` | **NO EDGE — kill.** |
| `≥ +5 %` and `0.025 < p_boot ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| **≥ 1 liquidation at L = 2** on fit or holdout, whatever the return | **NOT SURVIVABLE — kill at this leverage.** Reported with the L = 3/5 rows; a follow-up registration at lower leverage is admissible only via the Architect. |
| all of: net `≥ +10 % p.a.`; `p_boot ≤ 0.025`; fit same sign with fit net `≥ +5 %`; 90 % block-bootstrap CI of the annualised mean excludes 0; gross `> 0`; 0 liquidations at L = 2; **holdout max drawdown on capital ≤ 10 %** | **REAL EDGE — build ruling**, labelled **TIMED** or **PASSIVE** by §6.1, and **carry-only** (`hedge_pnl ≤ 0`) or **basis-assisted** by the decomposition. Routes to Architect; forward confirmation §7.4 pending. |

The drawdown condition is a tightening specific to the mechanic: a carry
whose worst peak-to-trough on capital exceeds a year's target return is not
the object described in §1.1, whatever its mean.

### 8.3 Mandatory rows beside every verdict

Per-symbol return on capital and utilisation; the §4.4 decomposition; the
§2.6 margin table; the always-on benchmark (§6.4); the extreme-state overlay
(§6.6); the price shadow (§6.5); every §1.2 and §4.3 sensitivity actually
run on fit, including the ones that came out worse; the tail row; the SOL
FTX-week counterfactual (§3.3); the Sharpe with its bootstrap interval.

### 8.4 Two pre-registered readings of a pass

1. **"The gate costs money."** If always-on beats the arm on fit and
   holdout, the pass is a passive premium and the build object is the
   always-on trade with the gate as an optional risk overlay; the REPORT says
   so first.
2. **"Basis, not carry."** If `hedge_pnl` exceeds `funding` on the holdout,
   what passed is basis convergence timed by funding, not carry; a legitimate
   result, a different build object (it is sensitive to the 1 h-close basis
   proxy in a way carry is not), and the HANDOFF must say so.

---

## 9. Order of work and stop rules

1. **Pull and audit.** Spot 1 h klines for the 8 symbols, first month ..
   latest, into `research/hedged-carry/data/` (gitignored); perp 1 h and
   funding re-pulled with the funding family's fetcher (or its `data/` reused
   read-only, with the audit identity of §6.7.1 either way). Stage-0 audits
   → `results/data_audit_spot.csv`, `results/basis_audit.csv`,
   `results/margin_table.csv`. **No return computed.** Stop and escalate on:
   an undeterminable timestamp unit; any new non-8 h funding episode; a
   symbol over the §3.3 rule-6 limits; a basis distribution with > 0.1 % of
   bars beyond |5 %|.
2. **`DESIGN.md`** restating this note mechanically — the gate, the
   portfolio and slots, the §2 account model with `x_liq`, `x_rc`, the
   re-centre and liquidation mechanics, the §4 accounting with the collection
   rule and the basis sign, the restated gap rule and SOL blackout, the
   nulls, the bootstrap, the screen, the ladder with α = 0.025 — **committed
   before any return is computed.**
3. **Harness validation and mechanic proof** (§6.7), `checks.py` green.
4. **Fit-period numbers** for both arms, the benchmark, the overlay, the
   shadow, all sensitivities, §6.8; the **power section with measured inputs
   and the screen decision recorded in `DESIGN.md` and committed**.
5. **Holdout, once**, for screened-in arms only; verdicts locked; then the
   tail row.
6. **`REPORT.md`** (two verdicts and their labels in the first paragraph;
   §8.4 readings applied; decomposition and margin table everywhere; doubts
   section led by the mark-price proxy, the basis-close proxy, the SOL
   counterfactual and unmodelled book depth), **`HANDOFF.md`**,
   **`RESEARCH-LOG.md` Запись** regardless of outcome, backlog status. A kill
   is a result. If both arms die, the deliverable is the measured statement
   that on Binance, 2020–2026, at retail fees and 2× perp leverage with spot
   unpostable, the funding premium does not pay 10 % a year on the capital it
   ties up — with the always-on and leverage rows showing exactly how far
   short, and at what account type it would not be.

---

## 10. Explicitly not ruled here

- **Leverage above 2×, or any account type in which spot is collateral, as a
  primary** — sensitivities and the §2.6 counterfactual only; a build ruling
  may reopen this with the measured margin table in hand.
- **Negative-funding carry** (short spot / long perp) — needs borrow; not
  registered.
- **Dated futures (quarterlies) basis** — a different instrument with a
  different convergence; the backlog's basis entry keeps it.
- **Basis-extreme mean reversion on the perp leg alone** — the backlog's
  original (a) hypothesis; parked, not merged into this family.
- **Cross-symbol or cross-venue carry sorts**; **funding as a selector in the
  cross-sectional package**.
- **Any gate threshold, window, leverage, mmr, fee or slippage figure other
  than the pinned ones** as gating numbers — the sensitivities exist so a
  reader can see the shape, never to pick from.
- **Software Engineer / Integration Engineer** — only on a REAL EDGE, after a
  further Architect ruling that decides the build object (§8.4) and the
  account type.
