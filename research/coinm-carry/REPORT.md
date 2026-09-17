# REPORT — COIN-M inverse cash-and-carry on Binance (1:1 coin-collateralised short)

**Researcher, 2026-09-17.** Pre-registration:
`research/hedged-carry/ARCHITECT-NOTE-SUCCESSORS.md` §1 and §2 (commit
9b2ad10), restated mechanically in `DESIGN.md`, **committed before any arm
return existed** (commit 8e111cf). Screen decision committed before any
holdout number existed (commit eae2500). **Holdout read once**, guarded by a
script that refuses to run twice (`results/HOLDOUT_READ.lock`).

---

## 0. Verdicts

**Neither arm builds. Both are clean kills, and the premise they were built on
is true.**

**Arm A — passive inverse carry, majors, always-on: `NO EDGE — kill`.** Fit
**+10.99 % p.a.** on capital (`p_boot` 0.000, 90 % CI [+8.86, +13.46]), which
is the first fit-period reading in this project to reach the +10 % build bar.
Holdout, read once, 2024-08-01 → 2026-07-31: **+4.79 % p.a. on capital**
(`p_boot` 0.000, CI [+3.90, +5.85], measured SE **0.59 % p.a.**), on **1,460
ON slot-days and 730 trade-days** — both pre-registered floors met **by
construction**, so this arm **could not be UNDERPOWERED**, and it is not. It
sits **0.21 points below the +5 % kill bar and 5.21 below the +10 % build
bar**, i.e. **8.9 σ below the build bar** at the measured holdout SE. **Zero
buffer breaches** on either window; the minimum buffer over 4,319 fit
settlements and 2,188 holdout settlements per slot was **96.1 %** of its
initial size.

**Arm B — quarterly basis, majors, ≥ 10 % p.a. lock: `NO EDGE — kill`.** Fit
+6.16 % p.a. on capital over 16 positions; holdout **+3.60 % p.a.** over
**6 positions**, 582 ON slot-days and **302 trade-days** — both floors met, by
two days on the tighter one, so the pre-registered expectation that arm B
"will most likely be UNDERPOWERED rather than killed" **did not happen**: it
is a kill. The always-hold benchmark at full exposure returned **+4.58 %**,
also under the bar, so the missing exposure is not concealing an edge.

**The 1/mmr identity HELD on the tape, exactly.** Over 20 real positions ×
180 days of hourly bars (86,400 position-hours), `|coin·P_t/N − 1| ≤
9.99e−16` and `|margin/maint − 1/mmr| ≤ 2.27e−13`, through price excursions of
up to **1.93×** the entry price. The margin ratio is **250×** on BTCUSD_PERP
and **200×** on ETHUSD_PERP and it does not move with price. **The structure
is exactly what the Architect said it was: a USD-hedged position that cannot
be liquidated on the upside.** For scale, the hedged-carry pass's `x_liq` at
L = 2 was +48.5 % — a 1.485× excursion killed the position; here a 1.93× one
does nothing at all. `MECHANIC-PROOF.md`.

**"The gate costs money" fires again, on both windows.** The funding-gate
overlay returned **+7.12 %** against arm A's **+10.99 %** on fit and
**+0.73 %** against **+4.79 %** on holdout. The overlay is nevertheless
**TIMED CARRY** (`p_A = 0.000`, observed +7.12 % against a null mean of
+1.70 % and a null p95 of +3.00 % over 1,000 timing placebos): the gate
genuinely selects carry, it simply forgoes more than it saves on an account
where being on costs nothing but a one-off 0.19 %.

**§1.3 OF THE NOTE, CONFIRMED AND RESTATED: +28.40 % WAS NEVER THE TARGET.**
The +28.40 % of `hedged-carry/REPORT.md` §6 is not what this structure pays
and was never claimed to be. On COIN-M the short's USD notional is **fixed at
`N` forever**, so the notional compounding that produced 46.70 USDT of funding
on a 50 USDT slot cannot occur. What the account type is worth is the
**denominator and the liquidation gate, and nothing else**: `C = 1.05 N`
instead of `1.5 N`, i.e. **1.43×**. Measured: the pass's +7.89 % × 1.43 =
+11.3 %, against arm A's **+10.99 %**. **The lever was exactly the size the
Architect said, it was applied honestly, and the two-year holdout still paid
under 5 %.** The +28.40 %'s own honest form is reported below as a fit-only
descriptive and it is **+70.6 %** — see §4, where it is also shown to be a
carry trade whose leverage drifts to 6–12× without the operator choosing it,
and which is liquidated outright if Binance moves the collateral ratio to
60 %.

---

## 1. The exchange facts, verified rather than assumed

`results/exchange_facts.json`, pulled 2026-09-17 with source URLs; asserted by
`data_audit.py` gate G2.

| fact | BTCUSD_PERP | ETHUSD_PERP |
|---|---|---|
| contract multiplier | **100 USD** | **10 USD** |
| margin asset | BTC | ETH |
| bracket-1 maintenance-margin rate | **0.40 %** → `1/mmr` = **250×** | **0.50 %** → **200×** |
| onboard | 2020-08-10 | 2020-08-18 |

**The fee question the note asked to verify, answered: the COIN-M taker fee is
NOT different from USD-M's.** Binance's own fee FAQ gives a Regular User
(VIP 0) maker 0.02 % / taker **0.05 %** and presents that table for **both**
COIN-M and USDⓈ-M. The real COIN-M difference is elsewhere and it is
**adverse**: the **10 % BNB fee discount applies to USDⓈ-M futures only**, so
the hedged-carry pass's "BNB fee discount" sensitivity has no COIN-M
counterpart and was not run. Round trip is therefore **0.38 % of `N`** —
numerically identical to the pass's, by coincidence of the two schedules.

**Contract integrality, recorded:** COIN-M quantity precision is 0, so the
minimum expressible slot is 1 contract — 100 USD on BTC, 10 USD on ETH. The
**minimum real account for the two-slot tier is ≈ 116 USD**. Every number here
is a ratio and is invariant to `N`.

---

## 2. COIN-M funding measured against USD-M funding — the deliverable

`results/funding_cm_vs_um.csv`, same settlement timestamps, whole tape.

| symbol | window | n | COIN-M %/8 h | USD-M %/8 h | **COIN-M p.a.** | **USD-M p.a.** | corr | COIN-M neg. | USD-M neg. |
|---|---|---|---|---|---|---|---|---|---|
| BTCUSD_PERP | fit | 4,354 | 0.01073 | 0.01329 | **+11.75 %** | +14.55 % | 0.810 | 17.2 % | 11.5 % |
| BTCUSD_PERP | holdout | 2,189 | 0.00478 | 0.00444 | **+5.23 %** | +4.86 % | 0.592 | 21.7 % | 19.3 % |
| ETHUSD_PERP | fit | 4,331 | 0.01064 | 0.01497 | **+11.65 %** | +16.39 % | 0.808 | 19.9 % | 12.4 % |
| ETHUSD_PERP | holdout | 2,189 | 0.00456 | 0.00436 | **+4.99 %** | +4.77 % | 0.594 | 23.4 % | 20.7 % |

**COIN-M funding is a separate and, on the fit window, materially cheaper
market — exactly the risk the Architect's prior named.** It runs **2.8 points
p.a. below USD-M on BTC and 4.7 points below on ETH** over 2020-08 → 2024-07,
pays a negative rate on 17–20 % of settlements against USD-M's 11–12 %, and
its correlation with USD-M falls from **0.81** on fit to **0.59** on holdout.
On the holdout the two series are indistinguishable and both sit near **5 %
p.a. of notional**. That 5 % is the whole story of the holdout verdict: a
structure that converts notional to capital at 0.95× cannot turn 5 % of
notional into 10 % on capital.

**The premium is a calendar, not a structure** (`results/by_year.csv`):

| year | arm A net p.a. on capital | COIN-M funding p.a. of notional | window |
|---|---|---|---|
| 2020 (from 08-22) | **+14.61 %** | 16.45 % | fit |
| 2021 | **+22.04 %** | 23.16 % | fit |
| 2022 | **+0.23 %** | 0.40 % | fit |
| 2023 | +6.80 % | 7.46 % | fit |
| 2024 | +12.02 % | 12.64 % | split |
| 2025 | **+4.46 %** | 4.90 % | holdout |
| 2026 (to 08-31) | **+2.52 %** | 3.11 % | tail |

This is the same year pattern the hedged-carry pass found on USD-M and the
same one the Architect's quarterly-basis descriptive found on the dated
contracts: 2021 and 2024 pay, 2022 and 2025–26 do not. **Three instruments,
three account structures, one calendar.**

---

## 3. Fit period (2020-08-22 .. 2024-07-31, 1,440 tier-days)

| arm / row | net p.a. on capital | `p_boot` | 90 % CI | boot SE | Sharpe | maxDD | util. | ON slot-days | positions | **buffer breaches** |
|---|---|---|---|---|---|---|---|---|---|---|
| **ARM A** (REGISTERED) | **+10.99 %** | 0.0000 | [+8.86, +13.46] | 1.400 % | 7.05 | 1.58 % | 1.000 | 2,880 | 2 | **0** |
| funding-gate overlay (fit-only) | +7.12 % | 0.0000 | [+4.97, +9.65] | 1.414 % | 5.00 | 0.83 % | 0.243 | 701 | 14 | 0 |
| price-gated shadow | **−6.93 %** | 1.0000 | [−8.91, −4.74] | 1.266 % | −4.05 | **35.4 %** | 0.386 | 1,111 | 328 | 0 |
| **ARM B** (REGISTERED) | **+6.16 %** | 0.0000 | [+2.99, +9.53] | 1.983 % | 1.36 | 4.02 % | 0.487 | 1,370 | 16 | 0 |
| arm B always-hold benchmark | +6.21 % | 0.0005 | [+2.88, +9.68] | 2.070 % | 1.31 | 4.02 % | 1.000 | 2,811 | 30 | 0 |

**Decomposition (mandatory, DESIGN §4.1).**

| row | funding p.a. | hedge_pnl p.a. | fees p.a. | sweep p.a. | cost/carry | mean settlements/pos. | median hold | min buffer |
|---|---|---|---|---|---|---|---|---|
| ARM A | **+11.05 %** | +0.002 % | 0.046 % | 0.018 % | **0.0058** | 4,319 | 1,440 d | 96.1 % |
| overlay | +7.74 % | +0.032 % | 0.642 % | 0.010 % | 0.084 | 150 | 35.3 d | 96.1 % |
| price shadow | +6.97 % | +1.130 % | **15.02 %** | 0.010 % | **2.16** | 10.2 | 3.0 d | 91.2 % |
| ARM B | n/a (no funding clock) | **+6.71 %** | 0.752 % | n/a | 0.112 | n/a | 91.0 d | n/a |

Three readings. **(i) The carry is the whole return and the basis is nothing:**
arm A's `hedge_pnl` is **+0.002 % p.a.** against funding of +11.05 %. The
1:1 coin-collateralised structure is hedged to four decimal places on a tape
that took BTC from 11,420 to 73,712 — the §8.4(2) "basis, not carry" reading
does **not** apply and could not. **(ii) Costs have stopped mattering:**
0.064 % of capital a year, a cost/carry ratio of **0.0058**, **forty times**
smaller than the pass's 0.14, because the always-on trade makes one round trip
in four years and **re-centres do not exist**. The zero-cost row reaches only
+11.05 %. **(iii) A price gate still does not select carry:** −6.93 % p.a.,
**41.4 round trips per symbol-year**, 15.0 % of capital a year in fees against
7.0 % of funding collected, cost/carry **2.16**, max drawdown 35 %. That is
this family's third independent reproduction of the same result.

**Nulls.** Arm A is always-on, so the timing placebo is **degenerate by
construction** (utilisation 1: every placement is the same schedule) and arm A
is **PASSIVE CARRY by construction** — which is precisely the object
`hedged-carry/REPORT.md` §8.4(1) pointed at. Both nulls were run on the
overlay: Null A (1,000 draws, holding segment count, lengths, turnover, cost
and buffer rule fixed) observed **+7.12 %** against a null mean of **+1.70 %**
and a null p95 of **+3.00 %**, `p_A = 0.000`; Null B (250 draws, whole-stream
day shift) null mean +2.87 %, `p = 0.000`. **The funding gate is a genuine
carry timer on the COIN-M tape as well** — and it still costs money.

**The buffer table (which replaces the margin table).**

| arm | slot | `N` | buffer₀ | as fraction of `N` | min buffer | as fraction of buffer₀ | settlements | funding | sweep cost |
|---|---|---|---|---|---|---|---|---|---|
| A | BTCUSD_PERP | 47.619 | 2.3784 | 0.0499 | 2.2879 | **0.9620** | 4,319 | +21.898 | 0.0343 |
| A | ETHUSD_PERP | 47.619 | 2.3302 | 0.0489 | 2.2397 | **0.9612** | 4,319 | +21.691 | 0.0381 |

**`b*` ladder** — the smallest buffer that survives the fit window:

| buffer `b` | net p.a. | breaches | min buffer as fraction |
|---|---|---|---|
| 0.005 N | +11.48 % | **0** | 0.517 |
| 0.01 N | +11.42 % | 0 | 0.787 |
| 0.02 N | +11.31 % | 0 | 0.900 |
| **0.05 N (pinned)** | **+10.99 %** | **0** | 0.961 |
| 0.10 N | +10.49 % | 0 | 0.981 |

**Even a buffer a tenth the pinned size survives the whole fit window.** The
pre-registered survivability gate is therefore not load-bearing on this tape:
the structure's risk is not the buffer, and it is not liquidation, because
neither exists in any quantity that matters. **That is the finding, and it is
a real one — it is also why the verdict turns entirely on the return.**

**Mechanism prerequisite (the overlay's gate).** Mean COIN-M rate while ON is
**0.0323 %/8 h** (BTC) and **0.0308 %** (ETH) against **0.0047 %** and
**0.0031 %** while OFF — ratios of **6.9×** and **9.9×**, far above the 2×
requirement. The ON state survives 3, 9, 15 settlements 100 % of the time and
30 settlements 100 %/75 %; mean episode length 156 and 146 settlements.
**The gate selects, and it selects persistence.**

---

## 4. Sensitivities — all fit-only, none a rescue

| sensitivity | arm A net p.a. | note |
|---|---|---|
| **PRIMARY** | **+10.99 %** | 0 breaches |
| (iii) COIN-M maker on entry | +11.00 % | +0.01 pp |
| (iv) buffer `b` = 0.02 N | +11.31 % | 0 breaches |
| (iv) buffer `b` = 0.10 N | +10.49 % | 0 breaches |
| (vii) slippage doubled | +10.98 % | −0.01 pp |
| (vii) **zero cost (= gross)** | **+11.05 %** | costs are 6 bp/yr |
| (v) overlay, pass thresholds | +7.12 % | the gate costs money |
| (v) overlay, ON 0.015 % | +7.39 % | |
| (v) overlay, ON 0.03 % | +6.70 % | |
| (v) overlay, OFF 0 % | +7.41 % | |
| (v) overlay, OFF 0.01 % | +5.77 % | |
| (v) overlay, `f9` window 3 | +7.06 % | |
| (v) overlay, `f9` window 15 | +7.15 % | |
| arm B threshold 7 % p.a. | +6.54 % | util. 0.663 |
| arm B threshold 15 % p.a. | +5.79 % | util. 0.377 |
| **(vi) UNSWEPT funding (directional)** | **+21.27 %** | **not the trade — see below** |

**Every row of the primary structure lands between +10.49 % and +11.48 %.**
The fit reading is not a threshold artefact, not a cost artefact and not a
buffer artefact: it is the funding tape times 0.95.

**(vi) The unswept variant, and why the sweep convention is pinned.** Leaving
the received funding *in coin* in the COIN-M wallet doubles the fit return to
**+21.27 %**. Every point of that lift is the coin appreciating — it is a
long BTC/ETH position accumulated out of carry proceeds across the largest
rally in the sample, not carry. `DESIGN.md` §1.2 pinned the sweep before any
number for exactly this reason, and this row exists to size what that decision
costs and buys: it costs 10 points of a bull-market fit number and it buys a
P&L that is hedged at every price.

**(i) and (ii) — Portfolio Margin / Multi-Assets with the USD-M perp and an
un-re-centred coin hedge: the honest form of the +28.40 %.**
`results/fit_pm_sensitivity.csv`, fit-only, **never admissible in the
primary**:

| haircut | `C/N` | net p.a. | funding p.a. | max notional growth | min uniMMR | **liquidated?** |
|---|---|---|---|---|---|---|
| **95 % (published)** | 1.05 | **+70.60 %** | +70.25 % | **12.7×** | 33.7 | no |
| 80 % | 1.20 | +61.77 % | +61.47 % | 12.7× | 6.3 | no |
| **60 %** | 1.40 | +52.95 % | +52.69 % | 12.7× | **−30.1** | **YES** |

Read it carefully, because it is the largest number in this pass as +28.40 %
was in the last one. A four-year un-re-centred hold from 2020-08 lets the
short notional grow **6.5× on BTC and 12.7× on ETH**; funding is paid on the
grown notional, so the ETH slot collects **171.6 USD of funding on a 50 USD
slot**. That is not a better trade, it is **a different trade**: a carry
position whose **leverage drifts to 6–12× without the operator choosing it**,
whose maintenance margin is ~1/33 of equity at the published haircut and ~1/6
at 80 %, and which is **liquidated outright at a 60 % collateral ratio** —
a level Binance moves by announcement (it cut 19 assets on 2026-02-13). The
negative-funding tail is paid at the grown notional and is inside these
numbers. **The account-type question asked whether +28.40 % was real. The
answer, measured twice: the structure is real, the liquidation-free version of
it pays 4.79 % out of sample, and the version that pays 70 % on fit is a
drifting-leverage bet on a collateral ratio.**

---

## 5. Holdout — read ONCE (2024-08-01 .. 2026-07-31, 730 days)

| row | net p.a. on capital | `p_boot` | 90 % CI | boot SE | Sharpe | maxDD | util. | ON slot-days | trade-days | positions | **breaches** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **ARM A** | **+4.791 %** | 0.0000 | [+3.90, +5.85] | **0.588 %** | 7.29 | 0.40 % | 1.000 | **1,460** | **730** | 2 | **0** |
| funding-gate overlay | +0.727 % | 0.0115 | [+0.17, +1.43] | 0.392 % | 2.44 | 0.18 % | 0.061 | 89 | 48 | 2 | 0 |
| **ARM B** | **+3.598 %** | 0.0000 | [+1.92, +4.82] | 0.896 % | 2.61 | 0.68 % | 0.399 | **582** | **302** | **6** | — |
| arm B always-hold | +4.583 % | 0.0000 | [+2.39, +6.09] | 1.132 % | 2.46 | 0.88 % | 1.000 | 1,460 | 730 | 14 | — |

**Decomposition:** arm A funding **+4.861 %** p.a., `hedge_pnl` **+0.029 %**,
fees 0.091 %, sweep 0.009 %, cost/carry 0.020. Arm B `hedge_pnl` +4.141 %,
fees 0.543 %, mean entry basis **+11.20 % p.a.**

**Applying the §10 ladder mechanically, in its own order.**

- **Arm A.** Screened in ✓. ON slot-days 1,460 ≥ 150 ✓ and trade-days 730 ≥
  300 ✓ — **not underpowered**. Buffer breaches **0** ✓ — survivable.
  Net **+4.791 % < +5 %** → **NO EDGE — kill.**
- **Arm B.** Screened in ✓. ON slot-days 582 ≥ 150 ✓ and trade-days **302 ≥
  300** ✓ (by two days) — **not underpowered**, contrary to the design's own
  pre-registered expectation. Net **+3.598 % < +5 %** → **NO EDGE — kill.**

**How close, and how well measured.** Arm A missed the kill bar by **0.21
points**; its 90 % CI upper bound is +5.85, so a +5 % reading was inside the
sampling range and the ladder is applied on the point estimate as pinned. What
is *not* close is the build bar: at a measured holdout SE of **0.588 % p.a.**,
+4.79 % sits **8.9 σ** below +10 %. There is no version of this arm's holdout
that builds. And the always-on benchmark question does not arise, because
**arm A is the always-on trade**: there is no larger exposure to appeal to.

**The gate costs money on the holdout too**, by more than on fit: +0.73 %
against +4.79 %, at utilisation 0.061 — the gate was ON for 6 % of the window,
exactly as it was in the pass (0.098 on the USD-M majors). Both windows now
agree, on two different tapes.

**The hedge held through a 42 % decline.** The ETH slot entered at
`P_e` = 3,209.20 on 2024-08-01 and was marked at **1,859.83** on 2026-07-31 —
a **−42 %** move — and returned **+4.68 USD on a 50 USD slot** with a basis
residual of **+0.032 USD**. The BTC slot did the same through 64,142 →
62,794. This is the pre-registered identity behaving on the holdout exactly as
`MECHANIC-PROOF.md` said it would.

**Tail (2026-08, non-gating):** arm A **+3.48 %** p.a. on capital (62 ON
slot-days), funding +6.50 % p.a. of notional against a basis drag of −0.88 %;
arm B took **no position** — no quarterly cleared the 10 % p.a. lock in the
whole month. **Forward confirmation (§13) is moot**: it is required only of a
REAL EDGE arm, and there is none.

---

## 6. Power, measured — and a correction to the registration's own statement

The note projected a holdout SE of **≈ 0.45 % p.a.** by scaling the pass's
1.38 % at 143 slot-days by √10, and said explicitly to **measure it, not
assume it**. Measured (`DESIGN.md` §12.2, committed before the holdout):

| | note's projection | **measured on fit** | projected to holdout | **actual holdout** |
|---|---|---|---|---|
| arm A SE, % p.a. | 0.45 | **1.400** | 1.97 | **0.588** |
| arm B SE, % p.a. | — | **1.983** | 2.75 | **0.896** |

**Both the note and the fit-based projection were wrong, and in opposite
directions, for the same reason: this family's daily variance is a function of
the funding regime, not of the sample size.** The fit window contains the
2020–21 and 2024 premium regimes and its daily series is volatile
(`sd_daily` 0.082 %); the holdout has almost no premium and barely moves
(`sd_daily` 0.034 %). No √n scaling connects windows whose generating process
changed. The registration's floors were nevertheless the right instrument:
they are **counts**, they were met by construction, and they delivered what
they promised — **an always-on arm that could not be UNDERPOWERED**.

At the **actual** holdout SE of 0.588 %, the verdicts are well separated: the
build bar is **8.9 σ** away, and a true edge of +4 % would be rejected at the
+5 % kill bar with power **96 %**. So the note's "a true +4 % is rejected with
power > 95 %" turned out to be **right on the holdout that happened**, while
being unsupported by the fit-based projection committed before it. Both
statements are in the record, in the order they were made.

---

## 7. Doubts

1. **The basis proxy is two 1 h closes from two archives, and one of them is
   priced in USDT while the contract is priced in USD.** `b_t = P_t/S_t − 1`
   therefore contains the USD/USDT dislocation as well as the futures premium.
   Measured median `b` is **−0.020 %** (BTC) and **−0.024 %** (ETH), and
   `hedge_pnl` is +0.002 % p.a. on fit and +0.029 % on holdout, so **no verdict
   here turns on it**. A build would need a real spread study; there is no
   build.
2. **Arm B's expiry mark was ruled after a smoke read of its fit return.**
   `DESIGN.md` §2 Stage-0 ruling Q1: the archive's last two bars before
   delivery carry a stale last-traded price (measured 1.6–3.8 % dislocations
   against ~0.1 % on every earlier hour), which **inflates** the trade. The
   unwind was moved to the last close strictly before delivery. The ruling was
   made on the price series, it is the conservative direction, and it moved the
   fit number **down**: 7.22 % → 6.87 % → **6.16 %**. All three are stated
   here. The holdout was read after the ruling was committed.
3. **The +28.40 % row's successor is not comparable to it.** The PM row here is
   a four-year always-on hold from 2020-08; the pass's +28.40 % was a gated
   arm with 16 positions on the USD-M tape. Both are descriptive, neither was
   tested out of sample, and the difference between +28 % and +70 % is entirely
   how long the un-re-centred notional was allowed to compound. **Do not read
   the two as a measurement of anything.**
4. **Survivorship does not apply here and the tape is not truncated**, but the
   universe is **two instruments**. Every statement in this report is about
   BTC and ETH on Binance COIN-M, 2020-08 → 2026-08. The alt tier was not
   reopened (§8).
5. **One venue gap.** `2026-06-30 08:00 UTC` is absent from both the archive
   and `GET /dapi/v1/fundingRate` on both symbols; it falls in the holdout.
   Zero funding, flagged, no decision — 1 of 6,687 settlements.
6. **Prior reads, declared.** The Architect's note §2.2 published a descriptive
   front-quarterly basis table over **both** windows including 2024-08 →
   2026-07 (USD-M contracts, means and shares only). That is a prior read of
   the holdout window on a different instrument family at aggregate level and
   is declared as `hedged-carry/REPORT.md` §7(7) declared the funding family's
   aggregate reads. `hedged-carry` itself read the same holdout window on the
   **USD-M** funding tape; §2 above shows the COIN-M tape is a different series
   (fit correlation 0.81, holdout 0.59). No COIN-M return and no arm of this
   design had been computed on the holdout by anyone.
7. **The two user-gated Stage-0 items were NOT RUN.** The Portfolio-Margin
   collateral rates for the six alts need a read-only API key
   (`GET /sapi/v1/portfolio/collateralRate`), and the user's confirmation that
   COIN-M and PM are visible in their account was not obtained during this
   pass. Per the registration these gate **only** the alt descriptive and the
   PM sensitivity's *rate inputs* — not arm A and not arm B. The PM
   sensitivity above therefore uses Binance's **published** 95 % haircut and
   shocks it to 80 % and 60 %, which is what the registration asked for, and
   **the alt descriptive was not produced**: the alt tier stays dead exactly
   where Запись 32 left it.
8. **Arm B cleared its trade-day floor by two days (302 against 300).** Had it
   fallen two days short the verdict would have been UNDERPOWERED rather than
   kill. The floor was not moved, and the always-hold benchmark at full
   exposure (+4.58 %, 730 trade-days) is under the kill bar independently, so
   the verdict does not rest on those two days.

---

## 8. Ledger

- **Registered arms: 2** (A passive inverse carry; B quarterly basis).
  **α = 0.05/2 = 0.025 each.**
- **Holdout reads: 1**, both arms, guarded by `results/HOLDOUT_READ.lock`.
- **Verdicts:** arm A **NO EDGE — kill** (+4.79 % against a +5 % kill bar and a
  +10 % build bar, 1,460 ON slot-days, 0 buffer breaches). Arm B **NO EDGE —
  kill** (+3.60 %, 302 trade-days, floors met).
- **Labels:** arm A **PASSIVE CARRY by construction** (always-on; the timing
  placebo is degenerate). The overlay is **TIMED CARRY** (`p_A = 0.000`). Both
  arms **carry-only, not basis-assisted** (`hedge_pnl` is 0.002–0.03 % p.a.
  against funding of 4.9–11.0 %). **"The gate costs money" fires on fit AND on
  holdout.**
- **The premise held:** the `1/mmr` identity was proven and then asserted on
  the tape to `1e−15`/`1e−13` over 86,400 position-hours; **zero liquidations
  are possible and zero buffer breaches occurred**, on either window, under
  every sensitivity.
- **Harness:** `harness.py` **12/12** (I1/I2 identities; hedge identity at
  `b ≡ 0`; planted accrual exact to `1.6e−14`; buffer breach on the arithmetic
  settlement; breaches non-increasing in `d`). `checks.py` **40/40**.
  `MECHANIC-PROOF.md`: 20 positions × 180 days, worst I1 `9.99e−16`, worst I2
  `2.27e−13`; ledger worst `|hand − engine|` **`1.04e−12`**.
  Stage 0 all gates PASS, including the **exact** REST-vs-archive funding
  identity (`max|diff| = 0.000e+00` on 4,269 shared settlements per symbol).
- **Discipline:** `DESIGN.md` committed before any arm return (8e111cf); §12
  power and screen committed before any holdout number (eae2500); holdout read
  once; no parameter moved for power, for a return, or for a breach.

**A kill is a result, and this one closes a line. Stated plainly: on Binance,
2020–2026, on the account structure that removes the liquidation risk and the
1.5× capital denominator — the best account structure that exists for this
trade, verified against the exchange rather than assumed — the perpetual
funding premium on BTC and ETH paid +10.99 % a year on capital over 2020-08 →
2024-07 and +4.79 % a year over the two years to 2026-07, with 730 trade-days
of exposure, 8.9 σ below the build bar and below the kill bar. The quarterly
basis on the same venue and the same structure paid +3.60 %. The account type
was worth exactly the 1.43× the Architect said and not one point more; the
premium is a property of the calendar, not of the account, the gate, the
instrument or the universe; and there is no fourth account structure to ask
about. The carry line is closed for the whole 2020–2026 tape.**
