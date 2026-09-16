# DESIGN — Hedged spot–perp carry on Binance (long spot / short USD-M perp, funding-gated)

**Status: COMMITTED BEFORE ANY ARM RETURN IS COMPUTED.** This file restates
`ARCHITECT-NOTE.md` (commit fd9cfcd, 2026-09-16) mechanically and is binding on
the run. Where the note leaves a number to be measured on fit, this file marks
it `[fit-measured]` and §12 is amended — as a separate commit — with the
measured value and the screen decision **before any holdout number exists**.

Amendments carried: `ARCHITECT-RULING-2026-09-16-tier-start.md` (tier series
start, Reading A; spot-gap and fee confirmations) and, by reference,
`research/funding-rate-signals/ARCHITECT-RULING-2026-09-16-stage0.md` (three
Stage-0 rulings, carried over verbatim per note §3.3).

**Provenance of numbers seen before this commit.** Stage 0 only: coverage,
gaps, basis distribution, the published mmr table (§3, §11). One harness smoke
test was run on BTCUSDT alone to confirm the engine executes end to end; it
produced a per-position table for one symbol and no tier series, no annualised
return, no arm, no benchmark and no comparison. No screen input existed and no
design choice in this file was made with sight of it. It is disclosed here
rather than left unsaid.

---

## 1. The trade

Long spot, short USD-M perp, **equal USDT notional `N` at entry**, one symbol
per slot, six alt slots and two major slots run as **two tier portfolios**.
Flat in price to first order; the position collects funding while the premium
persists and collects/pays the basis at entry/unwind. **No price stop** — the
position is hedged, and the risk is the margin path of §2, not price.

### 1.1 The gate (note §1.2) — hysteresis on the 3-day mean funding

At each settlement `k` (time `t_k`, rate `f_k`, present non-blackout rows only):

- `f9_k` = arithmetic mean of `{f_{k−8} … f_k}` — the trailing **9
  settlements = 3 days**, including the current one. `min_periods = 9` present
  rows; **undefined otherwise, and an undefined `f9` carries no decision** (the
  state stays where it was).
- **ON** when `f9_k ≥ +0.0002` (0.02 %/8 h).
- **OFF** when `f9_k ≤ +0.00005` (0.005 %/8 h).
- Between the two the state **persists** (hysteresis).

This is a *persistence* gate, not the funding family's extreme-state trigger.
The reason is arithmetic and is pre-registered (note §1.5): at a 0.38 % two-leg
round trip, a 2–4-day extreme-state hold collects about what it costs. The
extreme-state rule is run as a **mandatory fit-only row** (§9.3), never as an
arm.

### 1.2 Entry, hold, unwind (note §1.3)

- **Decision bar**: the close of the 1 h bar **opening at `t_k`** (one-bar lag,
  the funding family's convention). Entry buys spot at the spot 1 h close and
  sells perp at the perp 1 h close of that bar; `q_s = N/S_e`, `q_p = N/P_e`.
  The first settlement a position can collect is `t_{k+1}`.
- **One position per symbol slot**; no pyramiding, no partial sizing. An OFF
  slot holds USDT and earns nothing.
- **Unwind on gate-OFF** at the close of the bar opening the OFF settlement
  `t_j`; the settlement at `t_j` **is** collected.
- **Re-centre / liquidation**: §2. A re-centre is an unwind plus an immediate
  re-entry at the same closes and costs one full round trip.
- **Re-entry after gate-OFF**: at the next settlement whose `f9` satisfies ON
  afresh. No cooldown — the hysteresis band is the cooldown.
- Only the short-perp side is registered. The negative-funding mirror needs a
  spot borrow this account model does not have.

### 1.3 Sizing and the tier portfolio (note §1.4)

- `C_tier = 100` notional units per tier, in **equal fixed, uncompounded
  slots**: majors 2 × 50, alts 6 × 16.667.
- Per position `N = C_slot / (1 + 1/L)`; at `L = 2`, `N = C_slot / 1.5`, with
  `N` in spot and `N/2` as isolated perp margin — the slot is fully deployed
  when ON.
- **Tier daily return** `r_d = (equity_d − equity_{d−1}) / C_tier`, equity
  marked at the 00:00 UTC bar close, idle slots contributing 0. This is the
  verdict series.

### 1.4 Tier series start — RULING, Reading A (binding)

> A tier's return series `r_d` is defined only on days on which every slot of
> the tier is past its warm-up (§3.4). `C_tier = 100` is constant. Tier starts:
> **majors 2020-01-04, alts 2020-09-17 (SOL)**. Fit windows are therefore
> majors 2020-01-04 .. 2024-07-31 and alts 2020-09-17 .. 2024-07-31; holdout
> and tail are unaffected. A time-varying-denominator series over each slot's
> own listing (`C_tier(d) = Σ C_slot` over listed slots) is printed once, fit
> only, as a descriptive row and is not used for any screen, bootstrap, power
> measurement or verdict.

Per-symbol descriptive rows use each symbol's **full** coverage from its own
warm-up end; the truncation applies to the tier portfolio series only.

---

## 2. The margin path — the primary risk, modelled (note §2)

### 2.1 Account model, pinned

- Binance USD-M futures, **isolated margin, USDT collateral only. Spot
  holdings are in the spot wallet and CANNOT be posted as perp margin.** No
  cross-collateral, no Multi-Assets Mode, no Portfolio Margin.
- **Leverage `L = 2`** on the perp leg: initial margin `M = N/2`.
- **Maintenance margin rate `mmr = 1.0 %`** of perp notional, uniform, pinned.
  (Measured check, §11: Binance's published lowest-bracket mmr on these eight
  symbols is 0.40–0.65 %, so 1.0 % is above every published value, as note §2.2
  asserted. The published table is a sensitivity, never the primary.)
- **Liquidation fee 1.0 %** of notional.
- **Mark price for the liquidation check = the perp 1 h HIGH.** The archive has
  no mark-price series; the high is the worst intra-bar mark and is
  conservative by construction. Stated in the REPORT's doubts section.

### 2.2 Liquidation level

```
margin_balance(x) = M + F − N·x            x = P/P_e − 1, F = funding collected
maintenance(x)    = mmr · N · (1 + x)
liquidation  ⇔    margin_balance ≤ maintenance
x_liq             = (M/N + F/N − mmr) / (1 + mmr)
```

At `L = 2`, `F = 0`, `mmr = 1 %`: **`x_liq ≈ 48.515 %`**. `L = 3`: 32.013 %.
`L = 5`: 18.812 %. Funding collected raises `x_liq` by `F/N/(1+mmr)` and the
engine includes it.

### 2.3 Re-centre rule, pinned

- **Trigger**: the first 1 h bar of the hold whose perp **high** ≥
  `P_e × (1 + x_rc)` with `x_rc = 0.5 × x_liq(F=0)` — **+24.257 %** at `L = 2`
  (+16.006 % at `L = 3`, +9.406 % at `L = 5`).
- **Action at that bar's close**: sell spot, buy perp (taker both, basis paid);
  if the gate is ON at the most recent settlement, re-open at the same closes
  with a fresh `N = C_slot/1.5`. If OFF, stay flat.
- Fit-only sensitivity: `x_rc = 0.75 × x_liq`.

### 2.4 Liquidation

If a bar's perp high reaches `P_e × (1 + x_liq)` and no earlier bar closed the
position, the position is **liquidated**: perp closed at `P_e × (1 + x_liq)`,
liquidation fee 1.0 % of `N`, spot sold at that bar's close (taker: spot fee +
slippage). Every liquidation is logged to `results/liquidations.csv`.

**ONE liquidation at the primary `L = 2`, on fit or on holdout, FAILS THE
BUILD** (§10). It is a hard gate, not a sensitivity. `L = 3`, `L = 5`, the
published mmr table and the spot-as-collateral counterfactual are sensitivities
only. **No parameter moves to avoid a liquidation** (note §7.3).

Margin checks begin at the bar **after** the entry bar (entry is at a close, so
the hold starts after that close).

---

## 3. Data (note §3) — Stage 0 complete, results in §11

Sources, all `data.binance.vision`, no credentials:

| dataset | path |
|---|---|
| funding | `data/futures/um/monthly/fundingRate/<SYM>/` |
| perp 1 h | `data/futures/um/monthly/klines/<SYM>/1h/` |
| spot 1 h | `data/spot/monthly/klines/<SYM>/1h/` |

### 3.1 Timestamp units (new rule, note §3.1)

Kline `open_time` is **detected per file by digit count**: 13 digits = ms,
16 digits = µs. Mixed digit counts inside one file, or any other count, raises
and **stops the pull**. Measured: spot is ms through 2024-12 and µs from
2025-01, exactly as the note predicted; perp is ms throughout.

### 3.2 Alignment

- Settlement `k` → the 1 h bar whose open equals `calc_time` rounded to the
  minute. `checks.py` asserts it.
- **Basis** `b_t = P_t / S_t − 1` from the perp and spot **closes of the same
  open time**. Any `|b_t| > 5 %` is a data anomaly: listed, and the bar is
  **treated as absent on both legs** (no decision, no mark; the position
  carries the previous mark).
- An absent bar is absent on the leg it is absent from. A position spanning an
  absent bar is **marked with the last present closes and flagged**. A position
  spanning **more than 24 absent bar-hours** on either leg is unwound at the
  next present bar and counted.
- The **margin path is evaluated on every present perp bar** regardless of the
  spot leg's presence: the perp leg liquidates whether or not the spot archive
  has a row. A re-centre triggered on a bar with no usable spot close acts at
  the next bar with both legs present, flagged.
- Funding notional at settlement `j` is marked at the **perp open of the bar
  opening at `t_j`**.
- A settlement is collected **iff the position is open strictly across it**:
  `t_entry < t_j < t_exit`. A gate-OFF unwind at `t_j + 1 h` collects `t_j`; a
  re-centre or liquidation at a bar close collects a settlement at that bar's
  open, and the position re-opened at that same close does not. No
  minimum-settlement requirement: a position closed before its first settlement
  is a position with zero funding and full costs, and it counts.

### 3.3 Gap rule and the three carried-over Stage-0 rulings

1. Grid, missing slots, duplicates (keep last, count), no interpolation, no
   secondary source — funding family §3.3 rules 1–4 verbatim. A missing
   settlement contributes zero funding, is flagged, and carries no decision.
2. **Interval changes**: escalate on any *new* non-8 h episode. Measured: none
   (§11).
3. **SOL FTX-week blackout**, restated for a hedged book: SOL funding rows in
   `[2022-11-09 20:00, 2022-11-18 16:00)` UTC are removed from the settlement
   stream for all signal purposes and from the `f9` window. A SOL position open
   at the blackout start is **unwound at the close of the bar opening
   2022-11-09 19:00** (normal costs, basis paid); the SOL slot is **flat
   through the blackout** and may re-enter at the first settlement after
   2022-11-18 16:00 at which `f9` is defined on nine non-blackout rows
   (2022-11-21 08:00 at the earliest). Counted and disclosed. **Mandatory
   descriptive row**: the counterfactual P&L of holding through the blackout at
   the printed rates (4 h then 2 h intervals, part at the −2 % cap, which a
   *short* perp would have **paid**) — the blackout removes a real loss of the
   hedged trade from the SOL evidence and the REPORT's doubts section says so
   with the number. Holdout unaffected.
4. **Truncated monthly kline zips**: the daily-prefix backfill of SOL/XRP perp
   2022-02-26..28 and 2022-04-01..02 (240 bars) is authorised and was applied;
   neighbour-day identity checked. **On the spot leg the ruling does not apply**
   — see §11 (b).
5. **Pre-listing funding rows**: warm-up clock starts at `max(first funding
   row, first perp bar, first spot bar)`; earlier settlements feed `f9` history
   only.
6. **Symbol rule**: a symbol with > 5 % missing funding slots or > 1 % missing
   spot bars in the fit window is dropped from its tier (reported); a tier
   losing more than half its symbols stops and escalates. Measured: no symbol
   is near either limit (§11).

### 3.4 Windows

| window | dates | use |
|---|---|---|
| warm-up | coverage start .. + 3 days (9 settlements) | `f9` undefined; no positions |
| **fit** | tier start (§1.4) .. **2024-07-31** | everything exploratory, every sensitivity, the §12 screen, the §5 power measurements |
| **holdout** | **2024-08-01 .. 2026-07-31** (731 days) | computed ONCE, at the end, only for arms that pass the screen |
| tail | 2026-08-01 .. 2026-08-31 | non-gating post-holdout row |
| forward confirmation | 2026-08-01 .. 2026-10-31 | §13, run later, frozen now |

The fit series ends with a **mark**, not an exit: positions are not closed and
no cost is charged at the boundary. The **holdout run starts flat on
2024-08-01** and enters at the first ON settlement, carrying its own entry
costs; it never inherits a fit position. Never re-cut.

---

## 4. Accounting (note §4)

```
S_e, P_e        spot / perp 1h closes at entry;  S_x, P_x at unwind
b_e = P_e/S_e − 1,   b_x = P_x/S_x − 1
q_s = N/S_e,  q_p = N/P_e
spot_pnl  = q_s·(S_x − S_e)
perp_pnl  = −q_p·(P_x − P_e)
hedge_pnl = spot_pnl + perp_pnl          (reported beside N·(b_e − b_x))
funding   = Σ_{j: t_entry < t_j < t_exit} f_j · q_p · P_open(t_j)
fees      = 0.0030·N   (spot 0.0010 + perp 0.0005, each side, entry and unwind)
slip      = 0.0008·N   (0.0002 per fill × 4)
net       = hedge_pnl + funding − fees − slip   (− liquidation fee if §2.4)
gross     = hedge_pnl + funding
```

**Round trip = 0.38 % of `N`.** Both fee legs are computed on the **entry**
notional `N`, per note §4.1 as pinned; the ruling confirms this stays primary
and adds "fees on actual exit notional" as a **fit-only sensitivity** whose
difference to the pinned form is printed in bp of `C_tier` per year (§9.4).

At a liquidation the perp side is charged the 1.0 % liquidation fee in place of
its exit fee, and the spot side pays taker fee + slippage.

**Marking.** Per slot, `equity = C_slot + realised + unrealised`, with
`unrealised = q_s·(S_t − S_e) − q_p·(P_t − P_e)` at the bar close. Entry costs
are charged on the entry day, exit costs on the exit day, funding on the day of
its settlement. The daily mark is the bar **closing at 00:00 UTC** (the bar
opening 23:00); if that bar is absent the last present bar's close is used.

**Maker fills are NOT admissible in the primary** (note §4.3): the two legs
must be filled together or the position carries a naked leg; re-centres and
liquidations are urgent by definition; Binance spot at VIP 0 charges 0.10 %
maker *and* taker; and a resting perp limit sell during a rally is a fill model
the archive cannot support. Maker is a **fit-only sensitivity, never promoted**.

### 4.1 Mandatory decomposition, every table (note §4.4)

Every table showing a net return shows, adjacent: mean `funding` (annualised on
capital), mean `hedge_pnl`, mean `fees + slip`, re-centre and liquidation cost,
**utilisation** (share of slot-days ON), **round trips per symbol-year**, mean
hold in settlements, share of positions with zero settlements, and the
**cost/carry ratio**. A verdict-bearing number without its decomposition is a
protocol violation.

---

## 5. Power, in portfolio-days (note §5; binding per `2026-09-power-correction.md`)

**Observation unit = one UTC day of the tier portfolio's return on allocated
capital.** Not a settlement, not a position, not a leg. Six alt slots enter one
day's `r_d` as a **sum**, not as six observations — the cross-symbol dependence
the power correction warned about is already inside one day's return.

Two dependence corrections, both explicit:

- **Autocorrelation** of `r_d` from funding persistence: `n_eff ≈ n(1−ρ₁)/(1+ρ₁)`.
  At `n = 731` holdout days and `ρ₁ = 0.3`, `n_eff ≈ 394`. `ρ₁` is
  `[fit-measured]` and printed.
- **Overlap across arms**: majors and alts share the market's funding regime;
  they are not independent tests. `α = 0.05/2` is applied anyway.

**Attenuation `a = 1`.** A funding accrual enters the daily mean whole: no
bracket, no stop, no target to truncate it. The §8.3 planted-accrual test
measures this identity to float.

```
SE(annualised mean) = 365 · sd_daily / sqrt(n_eff)
```

Projected at the note's assumed sd (to be replaced in §12 by
`[fit-measured]` values):

| sd_daily | n_eff (ρ₁=0.3, 731 d) | holdout SE p.a. | α=0.025 threshold | 80 %-power edge |
|---|---|---|---|---|
| 0.06 % | 394 | 1.10 % | 2.2 % | **+10.9 %** |
| **0.12 %** | 394 | 2.21 % | 4.3 % | **+11.9 %** |
| 0.24 % | 394 | 4.41 % | 8.6 % | +13.7 % |
| 0.36 % | 394 | 6.62 % | 13.0 % (α binds) | +18.5 % |

**At any daily sd below ≈ 0.3 %, the α gate does not bind and the +10 % p.a.
LEVEL bar decides alone.** If the fit-measured sd comes out ≥ 0.3 %/day the
family is in the directional families' regime (Sharpe ≈ 2 needed) and §12 says
so in bold.

**Fit-screen SE, restated for the Reading-A tier starts** (ruling §1):
the alt fit series is ≈ **1,410 days** (2020-09-17 .. 2024-07-31), not the
≈ 1,640 the note assumed; the majors' is ≈ 1,671 days. At sd 0.12 %/day and
ρ₁ = 0.3, `n_eff ≈ 760` on the alts and `n_eff ≈ 900` on the majors, so the fit
SE moves from ≈ 1.47 % to ≈ **1.6 % p.a.** on the alts. **Screen power at a
true +10 % p.a. remains above 99 %**: the shortening costs calendar, not the
screen's ability to do its job. Actual `n` and measured `ρ₁` replace these in
§12.

### 5.1 THE HONEST GAP — pre-registered, stated plainly (note §5.5)

Schmeling, Schrimpf & Todorov's ≥ 10 % p.a. crypto-carry premium is **on
NOTIONAL**, gross of retail fees, on the carry-sorted trade. Converted into
this project's unit:

| object | on notional | **on capital, L = 2 (÷ 1.5)** | vs this ladder |
|---|---|---|---|
| passive premium, literature average | ≈ 10 % | **6.7 %** | above kill (5 %), **BELOW BUILD (10 %)** |
| bull-phase premium, literature | ≈ 60 % | 40 % | far above build |
| funding family's extreme-state forward rate | 63 % while ON | 42 % while ON | ON ≈ 5 % of the time |
| what the registered arm needs | ≈ 15 % | **10 %** | = the build bar |

**So the passive Schmeling trade is expected, before any measurement, to land
BETWEEN this ladder's kill bar and its build bar — "real but too small" by a
factor of ≈ 1.5.** This is the fourth instance of the project's recurring
pattern, and it differs from the other three in two ways: the gap is **1.5×,
not the 4–10×** of funding-directional, ORB and the cross-section; and it is
created by the **capital denominator** (margin that must sit idle), a design
variable with a modelled cost, not by a bracket or by costs alone. It is
**much closer than any prior finding and still short.**

The gap can close only if the gate concentrates the position into the premium
periods so that the **rate while ON averages ≈ 0.035 %/8 h at utilisation
≈ 0.45** (≈ 17 % gross of notional, less ≈ 7 round trips) — which the funding
family's persistence numbers make plausible on the **alts** and not on the
majors. Hence the priors (majors 15 %, alts 30–35 % chance of clearing the
build bar) and hence the rule that the fit screen settles this before any
holdout is read. **This paragraph is repeated in `REPORT.md` whatever the
outcome.**

If the 80 %-power edge measured in §12 exceeds +15 % p.a., §12 says so **in
bold** and the pass proceeds anyway.

---

## 6. Universe, split, prior reads, α

**Universe** (note §7.1): BTCUSDT, ETHUSDT (majors); SOLUSDT, BNBUSDT, XRPUSDT,
DOGEUSDT, ADAUSDT, LINKUSDT (alts). Survivorship declared and **not
corrected**: all eight are listed in 2026; the tape under-represents perps whose
funding blew out before delisting — for a hedged carry that is exactly the
population where the carry *and* the liquidation risk were largest.

**Prior reads on the holdout, declared** (note §7.2):

- **2024-08-01 .. 2025-07-31** lay inside the funding family's **fit** window.
  What was seen: pooled fit-period aggregates over 2020 .. 2025-07 (carry per
  trade, survival curves, forward rate), quoted as priors in §5.1. No
  year-by-year number, no gate of this design, no hedged P&L, no basis series
  was computed on it. The gate thresholds here (0.02 %, 0.005 %, 9 settlements)
  derive from the 0.01 % interest baseline and the funding family's
  pre-registered floor, not from any fit number. The same year was fit data for
  the ORB crypto arms and cmc-bot on BTC/ETH (price only). It has never been a
  holdout for anything.
- **2025-08-01 .. 2026-07-31** has been read by six BTC/ETH intraday,
  price-only registrations (Записи 18, 22, 23); never by a funding, basis or
  multi-day design.

**Paid for** by the mandatory frozen forward confirmation of §13 on any REAL
EDGE. This line starts its own count.

**α**: family = **exactly two registered arms**, `H_majors` and `H_alts` →
**α = 0.05/2 = 0.025**, counted by registration whether or not an arm survives
the screen. The always-on benchmark, the extreme-state overlay, the price
shadow and every leverage/cost/gate sensitivity are **descriptive, fit-only
where marked**, and say so in their heading.

---

## 7. Controls

### 7.1 Null A — timing placebo (1,000 draws), per arm — LABELS, DOES NOT GATE

Per symbol, take the real ON segments (count and lengths in settlements) and
place them at random non-overlapping start settlements inside the same window;
run the identical accounting, costs and margin model on the placebo schedule;
form the tier series; one-sided `p_A` = share of draws whose annualised mean
≥ observed. Holds fixed: utilisation, hold lengths, turnover, cost, margin
rule. Destroys: the alignment of ON with the premium.

`p_A ≤ 0.05` → **TIMED CARRY**; otherwise **PASSIVE CARRY** (the gate adds
nothing beyond exposure). A PASSIVE label on a REAL EDGE routes to a build
ruling whose object is the always-on trade with the gate as a risk overlay, and
the REPORT's first paragraph says which.

### 7.2 Null B — whole-stream day shift (250 draws)

Shift the real schedule by `k ~ U{1..250}` days; same accounting.

### 7.3 Block bootstrap — THE GATING INFERENCE

The mean of the holdout tier series is tested against zero with a **10-day
block bootstrap, 2,000 draws** (blocks of consecutive UTC days, resampled with
replacement to the series length): one-sided `p_boot` = share of draws with
annualised mean ≤ 0, plus the 90 % interval of the annualised mean, the Sharpe
interval (reported, not gated) and the max-drawdown interval. **The ladder's
`p` is `p_boot`.** Seed pinned at 20260916.

---

## 8. Harness validation (§8.1–8.5 must pass before the screen)

1. **Audit identity** — the perp/funding pull reproduces the funding family's
   `results/data_audit.csv` row counts, first/last timestamps, interval counts
   and gap list exactly (after the same authorised 240-bar backfill).
2. **Hedge identity** — with the spot series set equal to the perp series
   (`b ≡ 0`), every position's `hedge_pnl == 0` to float and
   `net == funding − fees − slip` exactly.
3. **Planted accrual (the `a = 1` test)** — add a constant
   `d ∈ {−0.0002, 0, +0.0002, +0.0005}` to every settlement rate while a
   position is open on the real fit tape; the tier's annualised mean must move
   by exactly `d × Σ q_p·P_open(t_j) / C_tier / years` to `1e−9`; the schedule,
   entries and re-centres must be invariant in `d` and liquidations
   non-increasing in `d` (funding raises the liquidation level).
4. **Margin identity** — a synthetic rally of exactly `x_rc` and exactly
   `x_liq` on a flat tape triggers the re-centre and the liquidation on the
   expected bar and no other, at `L = 2, 3, 5`.
5. **Ledger check** (`MECHANIC-PROOF.md`) — ten fit-period positions per tier
   at a fixed outcome-blind stride, with the settlement ledger (`t_j`, `f_j`,
   mark, USDT), both entry closes, the basis received, both exit closes, the
   basis paid, fees, re-centres, **the margin path printed step by step**, and
   the daily marks across the hold, hand-recomputed to `1e−9`.
6. **`checks.py`** — every settlement on a bar open; spot and perp grids
   coincide on every present hour; `f9` prefix stability; no settlement counted
   outside `(t_entry, t_exit)`; no decision on a blackout or missing row;
   timestamp units normalised; `|b| > 5 %` bars listed; the tier series starts
   on the Reading-A dates.

---

## 9. Mandatory descriptive rows

### 9.1 Always-on benchmark (note §6.4)
Per tier, the Schmeling passive trade: every slot ON from the tier start,
re-centring per §2, never gated. Printed beside the arm on **every** window
with the full §4.1 decomposition. **If the always-on return on capital exceeds
the arm's on fit AND on holdout, the REPORT's first paragraph says "the gate
costs money" regardless of the arm's verdict.**

### 9.2 Price-gated shadow (note §6.5)
The identical pipeline with `f9` replaced by the trailing 3-day spot return
(ON ≥ +3 %, OFF ≤ 0 %, same hysteresis shape). No margin. Descriptive.

### 9.3 Extreme-state overlay (note §6.6) — MANDATORY, FIT-ONLY
The funding family's extreme-state entry (rolling-90 percentile ≥ 0.90 **and**
`f ≥ 0.03 %/8 h`, two consecutive settlements; exit on lapse to ≤ 0.01 %/8 h or
30 settlements; 3-settlement cooldown), hedged, same accounting, same margin
model. This is §1.1's arithmetic run on the tape. **Never promoted**; a number
here that alone would clear the build bar is grounds for one
Architect-authorised follow-up registration, never a re-labelling.

### 9.4 Sensitivities, all fit-only, all reported including the ones that came out worse
Gate: ON 0.015 / 0.03 %; OFF 0 / 0.01 %; window 3 / 15 settlements.
Costs: perp maker 0.02 % on entry and gate-OFF exits with slippage halved on
those fills (≈ 0.30 % round trip); BNB fee discount (spot 0.075 %, perp
0.045 %); slippage doubled (0.16 %); zero cost (= gross); **fees on actual exit
notional** (ruling §4(b)), with the difference to the pinned form in bp of
`C_tier` per year — if it exceeds one-tenth of the +10 % bar on fit, the REPORT
says so.
Margin: `L = 3`, `L = 5`; `x_rc = 0.75 × x_liq`; the published mmr table; the
spot-as-collateral counterfactual (majors only — the six alts are not eligible
collateral in Binance Multi-Assets Mode as published).
Tier: the Reading-B time-varying-denominator row with the live-slot count.
**Every one is labelled "fit-only, not a rescue."**

### 9.5 Mechanism prerequisite (note §6.8)
Mean and median funding rate **while ON** vs **while OFF**, per tier; the
survival curve of the ON state at 3, 9, 15, 30, 60, 90 settlements. **If the
rate while ON is not at least 2× the rate while OFF, the gate is not selecting
and the REPORT says so in its first section whatever the return.**

### 9.6 Margin table (note §2.6)
Per tier, fit and holdout: the distribution of the **maximum perp adverse
excursion per position** (mean, median, p90, p99, max); re-centre count, per
symbol-year, mean cost, share of positions with ≥ 1; liquidations at `L = 2`
(expected 0), at `L = 3` and `L = 5` with losses; the **survivable leverage**
`L*` distribution and the tier-level `L` at which 99 % of positions survive
without a re-centre; and the **capital efficiency table** (return on capital at
`L = 2, 3, 5` beside return on notional).

### 9.7 Frequency floors (note §6.9)
Fit: **≥ 300 ON slot-days and ≥ 20 round trips per tier**. Holdout: **≥ 150 ON
slot-days per tier**. Below the floor the arm is **"unmeasurable at the
pre-committed definition"**. Thresholds are never loosened to manufacture
exposure.

---

## 10. The verdict ladder (note §8) — converted units, the old R bars do not apply

`1R` is undefined for a hedged position. The ladder is in **annualised net
return on allocated capital**. The +0.05R/+0.10R per-trade bars convert at the
funding family's own frequency and risk unit to ≈ 4.8 % / 9.5 % p.a. of
notional and are then applied on **capital**, which is 1.5× stricter. **Nothing
is loosened.**

Applied mechanically to each arm's **holdout** tier series:

| condition | verdict |
|---|---|
| screened out (§12) | **NO EDGE — fit-period kill.** Holdout not read. |
| holdout ON slot-days < 150 | **UNDERPOWERED — inconclusive.** |
| net **< +5 % p.a.** on capital **or** `p_boot > 0.20` | **NO EDGE — kill.** |
| ≥ +5 % and `0.025 < p_boot ≤ 0.20` | **INCONCLUSIVE.** No build. |
| **≥ 1 liquidation at `L = 2`** on fit or holdout, whatever the return | **NOT SURVIVABLE — kill at this leverage.** |
| all of: net **≥ +10 % p.a.**; `p_boot ≤ 0.025`; fit same sign with fit net ≥ +5 %; 90 % bootstrap CI of the annualised mean excludes 0; gross > 0; **0 liquidations at `L = 2`**; **holdout max drawdown on capital ≤ 10 %** | **REAL EDGE — build ruling**, labelled TIMED/PASSIVE (§7.1) and carry-only (`hedge_pnl ≤ 0`) or basis-assisted. |

**Two pre-registered readings of a pass** (note §8.4): (1) *"the gate costs
money"* if always-on beats the arm on fit and holdout — the build object is the
always-on trade with the gate as a risk overlay; (2) *"basis, not carry"* if
`hedge_pnl` exceeds `funding` on the holdout — a different build object,
sensitive to the 1 h-close basis proxy in a way carry is not, and the HANDOFF
must say so.

---

## 11. Stage 0 — measured, no return computed

Full outputs: `results/data_audit.csv`, `results/data_audit_spot.csv`,
`results/data_audit_spot_months.csv`, `results/basis_audit.csv`,
`results/fit_starts.csv`, `results/data_audit_fills.csv`,
`results/data_audit_anomalies.csv`, `results/margin_table.csv`,
`results/fetch_log.csv`.

**(a) Audit identity (§8.1): PASS on all 8 symbols** — funding row counts,
first/last settlement, missing slots (0), off-grid rows, interval value counts
and perp bar counts all reproduce the funding family exactly, after the same
authorised 240-bar daily-prefix backfill on SOL/XRP. No new non-8 h funding
episode; the only non-8 h rows are SOL's 101 FTX-week rows already covered by
the standing blackout.

**(b) Spot coverage — exchange maintenance, ruled (ruling §4(a)).** Spot 1 h is
complete 2019-09 .. 2026-08 except **35 bar-hours** (SOL 19, its post-listing
subset), **the same hours on every symbol**. The daily partition was probed for
all 17 affected days: every file is HTTP 200 and itself carries 19–23 rows, and
133/133 neighbour-day identity checks matched row for row. These are Binance
spot maintenance windows, not truncated archives; the §3.3 rule-4 backfill does
not apply and nothing is missing that the archive holds. Longest run 5 hours
(the 24-hour unwind trigger never fires); 0.054–0.079 % of each symbol's fit
bars against a 1 % limit; **zero in the holdout**. Handled per §3.2.

**(c) Basis.** Fit-window mean |b| ≤ 2.3 bp on every symbol; sd 7–11 bp on
seven symbols and 48 bp on SOL. `|b| > 5 %`: **42 bars total** — SOL 40
(0.077 %), XRP 1, DOGE 1 — under the 0.1 % stop rule, listed, treated as absent
on both legs.

**(d) Coverage and tier starts.** Per-symbol coverage start = max(first funding
row, first perp bar, first spot bar); fit start = +3 days: BTC/ETH 2020-01-04,
XRP 2020-01-09, LINK 2020-01-20, ADA 2020-02-03, BNB 2020-02-13, DOGE
2020-07-13, SOL 2020-09-17. Tier starts per §1.4: **majors 2020-01-04, alts
2020-09-17**.

**(e) Margin table (§2.1).** Pulled 2026-09-16 from
`https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets`.
Lowest-bracket mmr: BTC/ETH 0.40 %, SOL/BNB/XRP/ADA/LINK 0.50 %, DOGE 0.65 %.
**The pinned 1.0 % is above every published value**, as note §2.2 asserted, so
the primary is the conservative side of the published table.

---

## 12. Power with measured inputs, and the fit-period screen

**COMMITTED AFTER THE FIT NUMBERS AND BEFORE ANY HOLDOUT NUMBER EXISTS**
(note §9 step 4). Sources: `results/fit_arms.csv`, `results/fit_persistence.csv`,
`results/fit_margin.csv`, `results/liquidations.csv`. No holdout window has been
run; `stage2_holdout.py` refuses to execute until this section's
`results/screen.json` exists, and refuses to run twice.

### 12.1 Measured inputs, replacing the assumptions of §5

| measured on fit | H_majors | H_alts | note's assumption |
|---|---|---|---|
| fit days (Reading-A tier series) | **1,671** (2020-01-04 .. 2024-07-31) | **1,414** (2020-09-17 .. 2024-07-31) | ≈ 1,640 |
| `sd_daily` of `r_d` | **0.0608 %** | **0.0563 %** | 0.06–0.12 % base case |
| `ρ₁` of `r_d` | **0.478** | **0.560** | 0.3 |
| utilisation (share of slot-days ON) | **0.373** | **0.308** | 0.35–0.50 |
| round trips per symbol-year | **5.13** | **7.14** | 4–10 |
| mean settlements per position | 79.6 | 47.2 | — |
| median hold | 21.6 days | 5.9 days | "weeks" |
| mean funding rate while ON | **0.0324 %/8 h** (35.5 % p.a.) | **0.0395 %/8 h** (43.2 % p.a.) | ≈ 0.035 % needed |

`sd_daily` came in at the **bottom** of the note's band on both tiers, and `ρ₁`
came in **higher** than the assumed 0.3 — the two move the SE in opposite
directions and roughly cancel.

### 12.2 Standard errors and the 80 %-power edge

`SE = 365 · sd_daily / sqrt(n_eff)`, `n_eff = n(1 − ρ₁)/(1 + ρ₁)`, holdout
`n = 730` (§11 (f)).

| | H_majors | H_alts |
|---|---|---|
| fit `n_eff` | 591 | 399 |
| **fit SE** | **0.91 % p.a.** | **1.03 % p.a.** |
| holdout `n_eff` | 258 | 206 |
| **holdout SE** | **1.38 % p.a.** | **1.43 % p.a.** |
| α = 0.025 one-sided threshold on the mean | 2.71 % p.a. | 2.81 % p.a. |
| **80 %-power edge** (bar + 0.84 SE) | **+11.16 % p.a.** | **+11.20 % p.a.** |

**The α gate does not bind and the +10 % p.a. LEVEL bar decides alone**, exactly
as §5 pre-registered: a 2.7–2.8 % threshold sits far below a 10 % bar. The
measured `sd_daily` is well under the 0.3 %/day line, so this family is **not**
in the directional families' Sharpe regime. The 80 %-power edge is **+11.2 %
p.a.**, below the +15 % that would require the bold statement of §5.

Fit-screen power: at a fit SE of 0.91–1.03 % p.a., a true +10 % p.a. edge sits
**4.9–5.5 σ above the +5 % screen bar**, so screen power at a build-sized edge
exceeds 99 % on both tiers. The screen cannot lose an edge of the size this
family is registered to find, and it kills a family without one for free. The
Reading-A shortening of the alt series cost calendar, not the screen.

### 12.3 §5.1's honest-gap table with the MEASURED row

| object | on notional | on capital, L = 2 | vs ladder |
|---|---|---|---|
| passive premium, literature average | ≈ 10 % | 6.7 % | above kill, below build |
| what the arm needed (note's projection: 0.035 %/8 h while ON × 0.45 utilisation) | ≈ 15–17 % | ≈ 10 % | = build bar |
| **H_majors, MEASURED** (0.0324 %/8 h × 0.373) | **13.2 % gross** | **8.8 % gross → 7.89 % NET** | **above kill, below build** |
| **H_alts, MEASURED** (0.0395 %/8 h × 0.308) | **13.3 % gross** | **8.9 % gross → 6.90 % NET** | **above kill, below build** |

**The gap did not close, and the measured reason is utilisation, not rate.**
The alt tier's funding rate while ON, 0.0395 %/8 h, **beat** the 0.035 %/8 h the
note said the arm needed. Utilisation came in at **0.308 against the 0.45
assumed** — the premium regime covers under a third of the tape, not the
35–50 % projected — and 13.3 % of notional at 0.308 utilisation is 8.9 % on
capital before costs. Both arms therefore land, on fit, exactly where §5.1
predicted the *passive* trade would land: **between the kill bar and the build
bar.** The pre-registered "real but too small by ≈ 1.5×" statement is
confirmed on the fit period rather than refuted by it.

### 12.4 THE SCREEN DECISION (committed; `results/screen.json`)

Screen (note §7.3): fit net ≥ +5 % p.a. on capital, fit `p_boot ≤ 0.05`, the
§9.7 floors met (≥ 300 ON slot-days, ≥ 20 round trips), and **0 liquidations at
L = 2**.

| arm | fit net p.a. | `p_boot` | 90 % CI | ON slot-days | round trips | **liquidations at L = 2** | **DECISION** |
|---|---|---|---|---|---|---|---|
| **H_majors** | **+7.89 %** ✓ | 0.000 ✓ | [+5.93, +10.06] | 1,247 ✓ | 47 ✓ | **0** ✓ | **SCREENED IN — holdout is read** |
| **H_alts** | +6.90 % ✓ | 0.000 ✓ | [+4.93, +9.16] | 2,610 ✓ | 166 ✓ | **1** ✗ | **SCREENED OUT — fit-period kill** |

**H_alts fails on the margin path, not on the return.** One liquidation:
DOGEUSDT, position entered 2021-01-02 19:00 UTC (itself a re-centre re-entry
after six survived re-centres) at `P_e = 0.011731`, `F/N = 0.0279` so
`x_liq = 51.28 %`, liquidated at the bar opening **2021-01-28 14:00** — the
WallStreetBets DOGE squeeze. That bar opened at 0.012852 and printed a high of
0.018275: **+42 % inside one hour**, `x_bar_high = +55.78 %` against
`x_liq = +51.28 %`. The re-centre rule could not help, because the same bar
crossed `x_rc` (+24.26 %) and `x_liq` — precisely the §2.4 case the note names.
The position's own P&L was **+0.081 USDT** (77 settlements collected), so this
is a **survivability kill, not a loss kill**, and the REPORT says so.

Per the §10 ladder this makes H_alts **NOT SURVIVABLE — kill at this
leverage**, and per §7.3 its holdout is **never computed**. **No parameter was
moved to avoid it.** The leverage, the mmr, the re-centre fraction, the gate and
the cost model are exactly as committed in §1–§4 before any number existed.

Recorded for the REPORT, not used to re-open anything: the always-on benchmark
takes **three** liquidations at L = 2 on the alts, so the gate reduces but does
not remove the exposure; at L = 3 the alts take 8 and at L = 5 16; the majors
take 0 at L = 2 and L = 3 and 1 at L = 5. The alts' survivable-leverage
distribution is min `L* = 1.74`, p1 `2.19`, median `3.73`.

## 13. Forward confirmation (frozen now, run later)

For a REAL EDGE arm only: the frozen rule on **2026-08-01 .. 2026-10-31** once
that archive exists. Required: net ≥ 0 on capital and 0 liquidations at
`L = 2`. Failure re-labels the verdict **INCONCLUSIVE — forward-fail**. Three
months cannot certify an accrual; it exists to catch a regime that ended at the
holdout's edge.

---

## 14. Not ruled here (note §10)

Leverage above 2× or any account type where spot is collateral as a **primary**;
negative-funding carry (needs borrow); dated-futures basis; basis-extreme mean
reversion on the perp leg alone; cross-symbol or cross-venue carry sorts;
funding as a selector in the cross-sectional package; any gate threshold,
window, leverage, mmr, fee or slippage figure other than the pinned ones as a
gating number. Software/Integration Engineer only on a REAL EDGE after a
further Architect ruling on the build object and the account type.
