# DESIGN — COIN-M inverse cash-and-carry on Binance (1:1 coin-collateralised short)

**Researcher, 2026-09-17.** Pre-registration:
`research/hedged-carry/ARCHITECT-NOTE-SUCCESSORS.md` §1 and §2 (commit
9b2ad10), restated mechanically here. **Committed before any arm return
exists.** Sections 1–11 are binding; §12 (measured power + the fit screen) is
committed after the fit numbers and before any holdout number; the holdout is
read once.

Binding context also read in full: `research/hedged-carry/REPORT.md`,
`HANDOFF.md`, `DESIGN.md` §3/§4/§10/§12, RESEARCH-LOG Записи 32 and 33,
`research/_surveys/2026-09-power-correction.md` (power statement, A2/A4 forms),
`PROJECT.md` "User rulings, 2026-09-16" (crypto is the primary tape; horizon
open to multi-day).

**What this pass changes is the ACCOUNT STRUCTURE, not the signal.** The
hedged-carry pass died twice: the alt tier took a liquidation at 2× (DOGE
+42 % in one hour, 2021-01-28) and the majors arm had no premium left on the
holdout. On COIN-M inverse futures a 1:1 coin-collateralised short is
USD-hedged at every price and its margin/maintenance-margin ratio is `1/mmr`
identically, so **it cannot be liquidated on the upside at all**. That removes
the failure mode that killed the alts and removes the 1.5 N capital
denominator. It does not manufacture premium.

**The prior, pre-registered and stated plainly** (note §1.4): fit **+11 to
+15 %** on capital; holdout **+2 to +5 %, i.e. below the kill bar with high
power**. BUILD 15 %, CLEAN KILL 65 %, INCONCLUSIVE 20 %. **A kill here is the
useful outcome.** The **+28.40 %** of `hedged-carry/REPORT.md` §6 is **NOT**
the target: note §1.3 shows it is the high-variance Portfolio-Margin form,
carried by one 2020–21 ETH position riding 397 → 2,856, and it is carried here
only as a fit-only descriptive sensitivity (§9.4 (i)).

---

## 0. Exchange facts, VERIFIED not assumed

Pulled 2026-09-17 into `results/exchange_facts.json` with source URLs, and
asserted by `data_audit.py` gate G2.

| fact | BTCUSD_PERP | ETHUSD_PERP | source |
|---|---|---|---|
| contract multiplier | **100 USD** | **10 USD** | `GET /dapi/v1/exchangeInfo` |
| margin asset | BTC | ETH | same |
| onboard (UTC) | 2020-08-10 07:00 | 2020-08-18 07:00 | same |
| liquidation fee | 1.5 % | 1.5 % | same |
| bracket-1 notional cap | 5 BTC | 15 ETH | published COIN-M bracket table |
| **bracket-1 mmr** | **0.40 %** | **0.50 %** | same |
| bracket-1 max leverage | 125× | 100× | same |

**Fees, VIP 0, verified (note §1.4 asked explicitly):** Binance's own fee FAQ
states a Regular User's maker fee is **0.02 %** and taker **0.05 %**, and it
gives that table for **both** COIN-M and USD-M. **So the COIN-M taker fee is
NOT different from the USD-M 0.05 % the hedged-carry pass used.** The real
COIN-M difference is elsewhere and it is adverse: **the 10 % BNB fee discount
applies to USDⓈ-M futures only, not to COIN-M**, so the pass's "BNB fee
discount" sensitivity has no COIN-M counterpart and is not run. Spot taker
stays 0.10 % at VIP 0. This is recorded, not worked around.

**Contract integrality.** COIN-M quantity precision is 0, so the perp leg
trades in whole contracts of 100 USD (BTC) / 10 USD (ETH). All quantities and
returns below are ratios and are invariant to `N`, but the **minimum real
account** that can run arm A is `1.05 × 100 = 105 USD` per BTC slot and
`1.05 × 10 = 10.5 USD` per ETH slot, i.e. **≈ 116 USD for the two-slot tier**;
below that the trade is not expressible. Recorded here, no number depends on
it.

---

## 1. The trade

### 1.1 The structure, and why it cannot be liquidated on the upside

Per slot, one coin `X ∈ {BTC, ETH}`, one inverse perpetual `XUSD_PERP`:

```
P_e   COIN-M perp 1h close at entry;  P_t at t;  P_x at unwind
S_e   spot (XUSDT) 1h close at entry; S_t at t;  S_x at unwind
b_t   = P_t/S_t − 1                      (the basis, perp against spot)
N     the perp short notional, in USD
q     = N / P_e                          coins held in the COIN-M wallet
b_usd = 0.05 N                           the CASH buffer, held as USDT
C     = q·S_e + b_usd = N/(1+b_e) + 0.05 N     capital allocated to the slot
```

The coins are bought on **spot** at `S_e` (cash outlay `q·S_e = N/(1+b_e)`)
and transferred to the COIN-M wallet (free). The perp leg is a **short of `N`
USD notional at 1× leverage**, the exchange minimum.

Binance inverse P&L for a short is `PnL_coin = Q·(1/P_x − 1/P_e)`. With
`Q = N` and wallet `q = N/P_e`:

```
coin(t) = N/P_e + N(1/P_t − 1/P_e) = N / P_t                      (identity I1)
```

so the wallet's coin balance is `N/P_t` **at every price**, and

```
margin        = N / P_t
maint. margin = mmr · (position notional in coin) = mmr · N / P_t
margin ratio  = 1 / mmr   — CONSTANT at every price                (identity I2)
```

`1/mmr` is **250×** on BTCUSD_PERP and **200×** on ETHUSD_PERP at bracket 1.
**There is no upside margin path to model.** I1 and I2 are proven in
`MECHANIC-PROOF.md` and asserted on 20 real positions on the tape as a
**CHECK, not a gate** (note §1.4). *If the identity does not hold on the tape
the premise of the whole registration is wrong and the pass STOPS and
escalates.*

Marked at the spot price the slot's coin leg is worth `S_t·N/P_t =
N/(1+b_t)`, so its **only** price exposure is the basis:

```
hedge_pnl = N/(1+b_x) − N/(1+b_e)   ≈ N (b_e − b_x)
```

which is the hedged-carry pass's own basis term. There is no directional
term, no re-centre, and no `x_liq`.

### 1.2 The sweep convention (pinned)

Every coin flow into or out of the COIN-M wallet — funding received or paid,
COIN-M trading fees — is **swept to / from the USD buffer at the settlement's
mark**, so the hedged core stays exactly `N/P_t` coins and identity I1 is
exact. A sweep costs `SWEEP = 0.12 %` (spot taker 0.10 % + slippage 0.02 %) of
the swept amount, charged to the buffer.

Consequence, and it is the point: funding in **USD** at settlement `j` is

```
funding_usd(j) = f_j · N            (exactly; the notional is fixed at N)
```

**This is why +28.40 % is not what this structure pays.** On the
un-re-centred USD-M/PM form the short's notional compounds with the rally and
the funding grows with it; on COIN-M the notional is `N` forever. The
unswept alternative — leaving funding coin in the wallet to float with the
price — is a directional bet on the coin and is carried as a **fit-only
sensitivity** (§9.4 (vi)), never the primary.

### 1.3 Entry, hold, unwind

**Arm A is ALWAYS-ON.** Deliberate, per `hedged-carry/REPORT.md` §8.4(1): on
the majors the funding gate **cost money** on fit *and* on holdout. Each slot
enters at the first usable bar of the window (§3.4) and holds to the window's
end. One round trip per window per slot. **No re-centre fees exist.**

The funding gate of the pass (`f9` = trailing 9-settlement mean of the COIN-M
rate, ON ≥ 0.02 %/8 h, OFF ≤ 0.005 %, hysteresis) is carried as a **fit-only,
NON-GATING risk-overlay row**, together with the price-gated shadow and
Null A (§9).

**Arm B — quarterly basis (note §2.3), pinned there and restated in §2.**

### 1.4 Sizing and the tier portfolio

`C_tier = 100` USD, **2 slots** (BTCUSD_PERP, ETHUSD_PERP), `C_slot = 50`.
`N = C_slot / 1.05` is pinned; the coin outlay is `N/(1+b_e)` and the buffer
is `C_slot − N/(1+b_e)`, which equals `0.05 N` exactly at `b_e = 0` and
differs from it by at most `|b_e|·N ≈ 0.05 %` of `N` in practice (measured
median `|b|` is 0.02 %, §11). Observation unit = **one UTC day of the tier
portfolio's return on `C_tier`**, exactly as the pass.

### 1.5 The survivability object: the buffer

There is no liquidation. The only survivability question is the **buffer**
being exhausted by negative funding and fees:

```
buffer(t) = C_slot − N/(1+b_e) − entry_costs
            + Σ_{j ≤ t} [ f_j·N − SWEEP·|f_j·N| ]  − exit_costs
```

**Gate: `buffer(t) ≥ 0` at every settlement, on fit and on holdout.** A
breach is **NOT SURVIVABLE — kill at this structure**, replacing the pass's
"zero liquidations" gate (note §1.4). If a buffer is breached the slot is
unwound at the next bar, flagged and counted, so the tier series stays
defined. **The SOL FTX blackout rule does not apply — no alts.**

---

## 2. Arm B — quarterly basis, majors (note §2.3, pinned there)

Same account structure on `XUSD_yymmdd`: `q = N/F_e` coins, short `N` USD of
the dated contract at its 1 h close `F_e`, 1× leverage, same buffer, same
sweep (a dated contract pays **no funding**, so the buffer only meets fees).

- **Entry.** At any 1 h close, compute the annualised basis of the front and
  the next quarterly against **spot**: `β = (F/S − 1) · 365/d`, `d` = days to
  expiry. Enter the contract whose `β` is higher, if `β ≥ 10 % p.a.` **and**
  `d ≥ 14` days. One slot per coin.
- **Hold to expiry settlement** (08:00 UTC on the expiry date), unwound at the
  last clean tradable mark — see the Stage-0 ruling Q1 immediately below. Roll
  only if the new front also clears the threshold at that hour.

**Stage-0 ruling Q1 — the expiry mark (amendment, 2026-09-17, recorded before
any arm-B verdict number and disclosed in `REPORT.md` §7).** Binance delivers
at 08:00 UTC. In the archive, both the bar opening 08:00 *and* the bar opening
07:00 (which **closes** at 08:00) carry a **stale last-traded price** while
spot keeps moving: measured dislocations of **1.6–3.8 %** on
`BTCUSD_211231`, `BTCUSD_210326`, `ETHUSD_210326`, `ETHUSD_240329` and others,
against ~0.1 % on every earlier hour of the same day. Those prints are not
tradable and they **inflate** the trade (a negative `b_x` adds to
`hedge_pnl`). The unwind is therefore priced at the last bar whose **close is
strictly before delivery** — the bar opening **06:00** — and the position pays
the **full round trip**, which is conservative against Binance's fee-free
delivery settlement. This ruling was made on the price series (the staleness
is visible without any P&L) after a smoke read of arm B's fit return; it moves
that return **down**, 7.22 % → 6.87 % → 6.16 % p.a., and all three are
reported in `REPORT.md`.
- **Payoff.** At expiry `F_T = S_T` (the contract settles to the index), so
  `hedge_pnl = N/(1+β_x·d/365) − N/(1+β_e·d_e/365)` reduces to
  `N·(F_e/S_e − 1)/(F_e/S_e)` — **the basis locked at entry**, earned in full
  whatever price does. There is no directional term.
- **Costs.** One round trip per position: spot taker + slip on the coin leg
  each side, COIN-M taker + slip on the futures leg each side = **0.38 % of
  `N`**. At expiry the futures leg settles with **no taker fee** on Binance
  delivery, so the unwind charges the spot leg only (0.12 %) — the primary
  charges the full 0.19 % anyway, conservatively, and the delivery-fee
  relief is a fit-only sensitivity.
- **Sensitivities:** thresholds 7 % and 15 %; the **always-hold** row (enter
  the front contract unconditionally and roll at every expiry), reported
  beside the arm exactly as the pass reported its always-on benchmark.
- **Declared in advance:** with ≈ 8 gated positions on the holdout, arm B will
  most likely be **UNDERPOWERED** rather than killed. The design says so
  before the number exists, per note §2.3.

---

## 3. Data

All from `data.binance.vision` and the public `dapi` REST endpoint, no
credentials. `fetch_data.py`.

| dataset | path / endpoint | coverage measured |
|---|---|---|
| COIN-M perp 1 h | `data/futures/cm/monthly/klines/<SYM>/1h/` | 2020-08-11 / 2020-08-18 → 2026-08-31 |
| COIN-M funding, archive | `data/futures/cm/monthly/fundingRate/<SYM>/` | **2022-07 → 2026-06 only** |
| COIN-M funding, REST | `GET /dapi/v1/fundingRate`, paginated | 2020-08-10 → now |
| COIN-M quarterly 1 h | `.../klines/<XUSD_yymmdd>/1h/` | **26 contracts per pair**, 2020-09-25 → 2026-12-25 |
| spot 1 h | `data/spot/monthly/klines/<XUSDT>/1h/` | 2020-08-01 → 2026-08-31 |
| USD-M funding (comparison only) | `data/futures/um/monthly/fundingRate/<XUSDT>/` | 2020-08 → 2026-08 |

### 3.1 Timestamp units
Detected **per file** by digit count: 13 = ms, 16 = µs; a mixture inside one
file, or any other count, raises and stops the pull. Same rule as the pass's
§3.1.

### 3.2 Clock alignment of the two archives (the pass's §3.2, restated)
- The COIN-M and the spot archive are both **UTC 1 h grids with the same bar
  opens**; the basis `b_t = P_t/S_t − 1` is formed from the two **closes of
  the same open time** and never across bars.
- **Both legs are priced in different units of account and that is the point:**
  the COIN-M contract is quoted in **USD** (its index is a USD index), the
  spot leg in **USDT**. `b_t` therefore contains the USD/USDT dislocation as
  well as the futures premium. Measured median `b` is **−0.020 %** (BTC) and
  **−0.024 %** (ETH) — small, and negative, i.e. the COIN-M mark sits a
  fraction below USDT spot, which costs the trade a fraction of a basis point
  at entry and gives it back at unwind. It is reported in the §4.1
  decomposition as `hedge_pnl`, never netted away.
- Any `|b_t| > 5 %` is a data anomaly: listed, and the bar is treated as
  **absent on both legs**. Measured: **0 bars on either pair** (§11).
- A settlement `k` maps to the 1 h bar whose open equals `calc_time` rounded
  to the minute; `checks.py` asserts it. Funding notional at settlement `j` is
  marked at the **perp open of the bar opening at `t_j`**.
- A settlement is collected **iff** `t_entry < t_j < t_exit`.
- A position spanning more than **24 absent bar-hours** on either leg is
  unwound at the next present bar and counted.

### 3.3 Gap rule
1. Grid, missing slots, duplicates (keep last, count), **no interpolation, no
   secondary source**. A missing settlement contributes zero funding, is
   flagged, and carries no decision.
2. **The monthly funding archive omits the last 2–3 settlements of each
   month.** Measured: 112 settlements per symbol over 2022-07 → 2026-06. The
   REST stream supplies them and is **identical to the archive on every shared
   settlement to 0.0** (gate G1). The primary stream is the **union**, archive
   preferred where both carry a timestamp.
3. **One genuine venue gap:** `2026-06-30 08:00 UTC` is absent from *both* the
   archive and `GET /dapi/v1/fundingRate` on *both* symbols (verified against
   the endpoint directly). It falls in the holdout. Rule 1 applies: zero
   funding, flagged, no decision. 1 of 6,687 settlements = 0.015 %.
4. **Symbol rule:** a symbol with > 5 % missing funding settlements or > 1 %
   missing spot bars in the fit window is dropped. Measured: COIN-M 1 h bars
   0.18 % missing, spot 1 h 0.036 %, funding 0.015 % — no symbol is near
   either limit.
5. Warm-up starts at `max(first funding row, first COIN-M bar, first spot
   bar)`; earlier settlements feed `f9` history only.

### 3.4 Windows
| window | dates | use |
|---|---|---|
| warm-up | coverage start .. + 3 days | no positions |
| **fit** | tier start .. **2024-07-31** | everything exploratory, every sensitivity, the §12 screen |
| **holdout** | **2024-08-01 .. 2026-07-31** (730 days) | computed ONCE, only for arms that pass the screen |
| tail | 2026-08-01 .. 2026-08-31 | non-gating |
| forward confirmation | 2026-08-01 .. 2026-10-31 | §13, frozen now, REAL EDGE only |

The fit series ends with a **mark**, not an exit. The holdout **starts flat**
on 2024-08-01, carries its own entry costs, never inherits a fit position.
Never re-cut.

---

## 4. Accounting

```
q        = N / P_e                       coins (arm B: N / F_e)
outlay   = q · S_e = N/(1+b_e)           USD spent on the coin leg
buffer0  = C_slot − outlay
entry_fee= N·(SPOT_FEE + SLIP) + N·(CM_FEE + SLIP)            = 0.0019·N
exit_fee = N·(SPOT_FEE + SLIP) + N·(CM_FEE + SLIP)            = 0.0019·N
funding  = Σ_{j: t_entry < t_j < t_exit} f_j · N          (USD, notional FIXED)
sweep    = Σ_j SWEEP · |f_j · N|,  SWEEP = 0.0012
hedge_pnl= N/(1+b_x) − N/(1+b_e)
net      = hedge_pnl + funding − entry_fee − exit_fee − sweep
gross    = hedge_pnl + funding
```

**Round trip = 0.38 % of `N`** — identical to the pass's, by coincidence of
the two fee schedules (the pass paid spot 0.10 % + USD-M perp 0.05 % a side;
this pass pays spot 0.10 % + COIN-M 0.05 % a side).

**Marking.** Slot equity at `t` is `N/(1+b_t) + buffer(t)`. The daily mark is
the bar **closing at 00:00 UTC** (the bar opening 23:00); if that bar is
absent, the last present bar's close is used. Entry costs are charged on the
entry day, exit costs on the exit day, funding on the day of its settlement.

**Maker fills are NOT admissible in the primary** (the pass's §4.3 reasoning
carries over verbatim: the two legs must be filled together or the position
carries a naked leg; Binance spot at VIP 0 charges 0.10 % maker *and* taker).
COIN-M maker on entry is a **fit-only sensitivity**.

### 4.1 Mandatory decomposition, every table
Every table showing a net return shows, adjacent: mean `funding` (annualised
on capital), mean `hedge_pnl`, `fees + slip + sweep`, **utilisation**, round
trips per symbol-year, mean settlements per position, median hold, share of
positions with zero settlements, the **cost/carry ratio**, and the **minimum
buffer** reached as a fraction of `0.05 N`. A verdict-bearing number without
its decomposition is a protocol violation.

---

## 5. Power, in portfolio-days (binding per `2026-09-power-correction.md` A2)

**Observation unit = one UTC day of the tier portfolio's return on `C_tier`.**
Two slots enter one day's `r_d` as a **sum**, not as two observations.

`SE = 365 · sd_daily / sqrt(n_eff)`, `n_eff = n(1 − ρ₁)/(1 + ρ₁)`; both
`sd_daily` and `ρ₁` are **fit-measured** and printed in §12. In addition the
**block bootstrap measures the SE directly** on the fit series, and §12
reports the measured SE beside the formula's — the note is explicit that the
√10 scaling is to be *measured*, not assumed.

**Projected, before any number** (note §1.4 "Power statement"): the pass's
holdout SE was 1.38 % p.a. at 143 ON slot-days; an always-on arm at ≈ 1,460
slot-days should have SE ≈ **0.45 % p.a.** by √10. The ladder's binding gate
is the **+10 % level bar**, a size floor, so power *at* the bar is 50 % by
construction; the 80 %-power edge is `bar + 0.84·SE ≈ +10.4 % p.a.` — the bar
itself to within half a point. Conversely a true **+4 %** is rejected at the
**+5 % kill bar with power > 95 %**. **This is the best-powered registration
the project has had, because the arm is always on.**

### 5.1 THE HONEST GAP, pre-registered
The passive crypto-carry premium is a premium **on notional**. This structure
ties up `C = 1.0 N + 0.05 N` of capital, so it converts at **1/1.05 = 0.95×**
— against the pass's 1/1.5 = 0.67×. **That 1.43× is the whole of what the
account type is worth, and it is the largest single lever the pass found.**
Measured COIN-M funding (§11 G5) is **11.7 % p.a. of notional on the fit
window** and **≈ 5.0 % on the holdout window**; at 0.95× and 0.38 % of costs
that projects to roughly **+10.8 % fit** and **+4.4 % holdout** — inside the
Architect's +11/+15 and +2/+5 bands, straddling the build bar on fit and
**below the kill bar on holdout**. The design records this arithmetic before
running the engine; the engine measures it.

---

## 6. Universe, split, prior reads, α

- **Universe: BTC and ETH only** (note §1.4). The six alts have no COIN-M
  quarterlies after 2025-09 and are not Multi-Assets collateral. An alt row is
  admitted **only** as a fit-only descriptive on Portfolio Margin, and **only
  if** the Stage-0 collateral-rate pull shows all six at ≥ 80 %. That pull
  needs the user's read-only API key (§11 (h)); without it the alt tier stays
  dead where Запись 32 left it.
- **Arms: 2** (A: passive inverse carry; B: quarterly basis). **α = 0.05/2 =
  0.025 each.**
- **Prior reads, declared.** The Architect's note §2.2 published a
  **descriptive** front-quarterly basis table over **both** windows including
  2024-08 → 2026-07, at the level of the mean, median and share ≥ 10 % p.a.
  (USD-M contracts). That is a prior read of the holdout window on a
  *different instrument family at aggregate level* and is declared here as
  the pass's §7(7) declared the funding family's aggregate reads. No COIN-M
  return, no arm of this design, and no hedged P&L has been computed on the
  holdout window by anyone. `hedged-carry`'s own holdout read (2024-08 →
  2026-07, USD-M majors) is likewise declared: it read the *USD-M* funding
  tape, and §11 G5 shows the COIN-M tape is a different series (fit
  correlation 0.81, holdout 0.59, and COIN-M runs 2.9–4.8 points p.a. **below**
  USD-M on fit).

---

## 7. Controls

### 7.1 Null A — timing placebo (1,000 draws) — LABELS, DOES NOT GATE
**Arm A is always-on, so the placebo is degenerate by construction**
(utilisation 1; every placement is the same schedule). Arm A is therefore
**PASSIVE CARRY by construction** and the REPORT says so — which is exactly
the object `hedged-carry/REPORT.md` §8.4(1) pointed at. Null A is run on the
**funding-gate overlay row** and on **arm B**, with the identical accounting,
costs and buffer model on the placebo schedule; one-sided `p_A` = share of
draws whose annualised mean ≥ observed. `p_A ≤ 0.05` → TIMED CARRY.

### 7.2 Null B — whole-stream day shift (250 draws)
Shift the real schedule by `k ~ U{1..250}` days; same accounting. Degenerate
for arm A for the same reason; run on the overlay and on arm B.

### 7.3 Block bootstrap — THE GATING INFERENCE
The mean of the holdout tier series against zero, **10-day blocks, 2,000
draws**, one-sided `p_boot` = share of draws with annualised mean ≤ 0, plus
the 90 % interval and the bootstrap **SE**. **The ladder's `p` is `p_boot`.**
Seed pinned at **20260917**.

---

## 8. Harness validation (must pass before the screen)

1. **`1/mmr` identity (I1, I2)** — proven algebraically in `MECHANIC-PROOF.md`
   and asserted on **20 real positions** on the tape: at every 1 h bar of each
   position, `coin_balance · P_t / N = 1` and `margin/maint = 1/mmr`, to
   `1e−12`. **A failure STOPS the pass** (the premise would be wrong).
2. **Hedge identity** — with the spot series set equal to the COIN-M series
   (`b ≡ 0`), every position's `hedge_pnl == 0` to float and
   `net == funding − fees − sweep` exactly.
3. **Planted accrual (`a = 1`)** — add a constant
   `d ∈ {−0.0002, 0, +0.0002, +0.0005}` to every settlement rate while a
   position is open on the real fit tape; the tier's annualised mean must move
   by exactly `d · Σ N / C_tier / years` to `1e−9` (before the sweep charge,
   which is `|·|` and is checked separately), and the schedule must be
   invariant in `d` for arm A.
4. **Buffer identity** — a synthetic constant negative rate that exhausts the
   buffer at a computable settlement triggers the breach on exactly that
   settlement and no other.
5. **Ledger check** (`MECHANIC-PROOF.md`) — 20 positions at a fixed
   outcome-blind stride with the settlement ledger (`t_j`, `f_j`, mark, USD),
   both entry closes, the basis received, both exit closes, the basis paid,
   fees, sweeps, the buffer path and the daily marks, hand-recomputed to
   `1e−9`.
6. **`checks.py`** — every settlement on a bar open; the COIN-M and spot grids
   coincide on every present hour used; `f9` prefix stability; no settlement
   counted outside `(t_entry, t_exit)`; no decision on a missing row;
   timestamp units normalised; `|b| > 5 %` bars listed; the tier series starts
   on the measured tier-start date; arm B enters only at `β ≥ threshold` and
   `d ≥ 14`.

---

## 9. Mandatory descriptive rows

### 9.1 Null A (arm A) — the passive trade IS the arm
There is no separate "always-on benchmark" for arm A because arm A **is** the
always-on trade. The **funding-gate overlay** takes the benchmark's place and
is reported beside it on every window with the full §4.1 decomposition. **If
the overlay's return on capital is below the arm's on fit AND on holdout, the
REPORT's first paragraph repeats "the gate costs money" — this pass's
confirmation of the pass's §8.4(1) reading.**

### 9.2 Price-gated shadow
`f9` replaced by the trailing 3-day spot return (ON ≥ +3 %, OFF ≤ 0 %, same
hysteresis). Expected to lose again. Descriptive, fit-only.

### 9.3 Sensitivities — all fit-only, all reported including the worse ones
(i) **PM / Multi-Assets, USD-M perp, un-re-centred coin hedge** at the
published **95 %** haircut, uniMMR path modelled, negative-funding tail at the
**grown** notional — the row that reproduces the +28.40 % shape honestly;
(ii) **haircut shock** on the same row at 80 % and 60 %;
(iii) **COIN-M maker on entry** (0.02 %, slippage halved on that fill);
(iv) **buffer `b` = 0.02 N and 0.10 N**;
(v) **the funding-gate overlay** at the pass's thresholds, and the gate
sensitivities ON 0.015/0.03 %, OFF 0/0.01 %, `f9` window 3/15;
(vi) **unswept funding** (funding coin left in the wallet to float with the
price) — the directional variant, reported to size exactly what the sweep
convention costs and buys;
(vii) slippage doubled (0.16 % round trip); zero cost (= gross).
**None is admissible in the primary. Each is labelled "fit-only, not a
rescue."**

### 9.4 Mechanism prerequisite
Mean and median COIN-M funding rate **while the overlay is ON** vs **while
OFF**; the survival curve of the ON state at 3, 9, 15, 30, 60, 90
settlements. Reported for the overlay only (arm A is always on).

### 9.5 The margin table, replaced
There is no margin path. In its place: the **buffer table** — per slot and
window, the minimum buffer reached (USD and as a fraction of `0.05 N`), the
date it was reached, the number of breaches, the longest run of negative
settlements and its cumulative cost, and the **`b*`** distribution: the
smallest buffer fraction that would have survived the window. Plus the printed
`1/mmr` check of §8.1 across every position-hour.

### 9.6 Frequency floors
Fit: ≥ 300 ON slot-days and ≥ 1 round trip per slot. Holdout: **≥ 150 ON
slot-days AND ≥ 300 trade-days** (the power-correction A4 form). For arm A
both are met **by construction** (2 × 730 = 1,460 ON slot-days, 730
trade-days), so **arm A's holdout cannot be UNDERPOWERED — it builds or it
kills.** Thresholds are never loosened.

---

## 10. The verdict ladder

Units: **annualised net return on allocated capital `C`.** Applied
mechanically to each arm's **holdout** tier series, in this order:

| condition | verdict |
|---|---|
| screened out (§12) | **NO EDGE — fit-period kill.** Holdout not read. |
| holdout ON slot-days < 150 **or** trade-days < 300 | **UNDERPOWERED — inconclusive.** |
| **buffer exhausted at least once** on fit or holdout, whatever the return | **NOT SURVIVABLE — kill at this structure.** |
| net **< +5 % p.a.** on capital **or** `p_boot > 0.20` | **NO EDGE — kill.** |
| ≥ +5 % and `0.025 < p_boot ≤ 0.20` | **INCONCLUSIVE.** No build. |
| all of: net **≥ +10 % p.a.**; `p_boot ≤ 0.025`; fit same sign with fit net ≥ +5 %; 90 % bootstrap CI excludes 0; gross > 0; **0 buffer breaches**; **holdout max drawdown on capital ≤ 10 %** | **REAL EDGE — build ruling.** |

**Two pre-registered readings** carried over: (1) *"the gate costs money"* if
the overlay is below the arm on fit and holdout; (2) *"basis, not carry"* if
`hedge_pnl` exceeds `funding` on the holdout.

---

## 11. Stage 0 — measured, no return computed

`data_audit.py`, `results/stage0.json`, `results/data_audit.csv`,
`results/data_audit_anomalies.csv`, `results/funding_cm_vs_um.csv`,
`results/exchange_facts.json`. **All gates PASS.**

(a) **G1 — the COIN-M funding REST-vs-archive identity.** On the 2022-07 →
2026-06 overlap, **4,269 shared settlements per symbol, max |difference| =
0.000e+00 — exact**. The archive additionally **omits** the last 2–3
settlements of each month (112 per symbol); REST supplies them; the primary
stream is the union. This was the registration's first escalation trigger and
it is clean.

(b) **G2 — contract multipliers and mmr**, asserted from
`GET /dapi/v1/exchangeInfo` and the published bracket table: §0's table.

(c) **G3 — grids.** Funding interval is **8 h at every settlement on both
symbols over the whole tape** (no 4 h or 1 h episodes, unlike the 2024+ alt
listings the duty-cycle survey found). One venue gap (§3.3 rule 3).

(d) **Coverage.** COIN-M 1 h: BTC 52,985 bars from 2020-08-11 07:00 (0.18 %
missing), ETH 52,817 from 2020-08-18 07:00 (0.18 %). Spot 1 h: 53,309 bars
each from 2020-08-01 (0.036 % missing). COIN-M funding merged: BTC 6,686 from
2020-08-10 16:00, ETH 6,663 from 2020-08-18 08:00.

(e) **G4 — basis anomalies.** `|b| > 5 %`: **zero bars on either pair**, out
of 52,966 and 52,798 joined hours. Median `b` = **−0.0202 %** (BTC),
**−0.0240 %** (ETH); p99 in `stage0.json`.

(f) **G5 — COIN-M funding against USD-M funding, same settlement times.**
The deliverable the dispatch asks for; `results/funding_cm_vs_um.csv`:

| symbol | window | n | COIN-M mean %/8 h | USD-M mean %/8 h | COIN-M p.a. | USD-M p.a. | corr | COIN-M neg share | USD-M neg share |
|---|---|---|---|---|---|---|---|---|---|
| BTCUSD_PERP | fit | 4,354 | 0.01073 | 0.01329 | **+11.75 %** | +14.55 % | 0.810 | 17.2 % | 11.5 % |
| BTCUSD_PERP | holdout | 2,189 | 0.00478 | 0.00444 | **+5.23 %** | +4.86 % | 0.592 | 21.7 % | 19.3 % |
| ETHUSD_PERP | fit | 4,331 | 0.01064 | 0.01497 | **+11.65 %** | +16.39 % | 0.808 | 19.9 % | 12.4 % |
| ETHUSD_PERP | holdout | 2,189 | 0.00456 | 0.00436 | **+4.99 %** | +4.77 % | 0.594 | 23.4 % | 20.7 % |

**COIN-M funding is a different and, on the fit window, a materially
CHEAPER series than USD-M** — 2.8 points p.a. below on BTC and **4.7 points
below on ETH** — exactly the risk the Architect's prior named ("COIN-M funding
is a separate market and was often lower"). On the holdout the two are the
same and both are near 5 % p.a. of notional. Correlation falls from 0.81 on
fit to 0.59 on holdout.

(g) **Quarterly contracts.** 26 `BTCUSD_yymmdd` and 26 `ETHUSD_yymmdd` 1 h
kline sets pulled, 2020-09-25 → 2026-12-25, as the note said.

(h) **The two items that need the USER, and are NOT blockers** (note §1.4
Stage-0 checklist): the Portfolio-Margin collateral rates for the six alts
need a read-only API key (`GET /sapi/v1/portfolio/collateralRate`), and the
user should confirm COIN-M and PM are visible in their account. **These gate
only the alt descriptive and the PM sensitivity (i)–(ii), not arm A and not
arm B.** Status is recorded in §11 of `REPORT.md`; if unavailable the pass
proceeds with the primary and records them as **not run**.

---

## 12. Power with measured inputs, and the fit-period screen

**TO BE COMMITTED AFTER THE FIT NUMBERS AND BEFORE ANY HOLDOUT NUMBER
EXISTS.** `stage2_holdout.py` refuses to execute until `results/screen.json`
exists, and refuses to run twice.

Screen: fit net ≥ **+5 % p.a.** on capital, fit `p_boot ≤ 0.05`, the §9.6 fit
floors met, and **0 buffer breaches on fit**.

---

## 13. Forward confirmation (frozen now, run later)

REAL EDGE arms only: **2026-08-01 .. 2026-10-31**, net ≥ 0 on capital and 0
buffer breaches. Failure re-labels the verdict **INCONCLUSIVE —
forward-fail**.

---

## 14. Not ruled here

Leverage above 1× on COIN-M; the alt tier on any structure (dead at Запись 32
unless the §6 collateral-rate condition is met); Portfolio Margin or
Multi-Assets as a **primary** account model; negative-funding (short-basis)
carry; cross-venue carry; any threshold, buffer, fee or slippage figure other
than the pinned ones as a gating number. Software/Integration Engineer only on
a REAL EDGE after a further Architect ruling.
