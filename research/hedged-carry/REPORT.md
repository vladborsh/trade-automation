# REPORT — Hedged spot–perp carry on Binance (long spot / short USD-M perp, funding-gated)

**Researcher, 2026-09-16.** Pre-registration: `ARCHITECT-NOTE.md` (commit
fd9cfcd) + `ARCHITECT-RULING-2026-09-16-tier-start.md`, restated mechanically
in `DESIGN.md`, committed before any return was computed (commit fe4b8df).
Screen decision committed before any holdout number existed (commit 842fe0c).
Holdout read once.

---

## 0. Verdicts

**Neither registered arm builds. `H_alts` is `NOT SURVIVABLE — kill at this
leverage`: it was SCREENED OUT on the fit period by one liquidation at the
primary 2× leverage, and its holdout was never computed. `H_majors` passed the
fit screen at +7.89 % p.a. on capital with zero liquidations, and its holdout —
read once — returned +0.89 % p.a. on capital on 143 ON slot-days, which is
below the pre-registered 150-slot-day floor, so its pre-registered label is
`UNDERPOWERED — inconclusive`; the measured +0.89 % sits 4.1 points below the
kill bar and 9.1 below the build bar, and the always-on benchmark at ten times
the exposure (1,459 ON slot-days) returned only +2.60 % p.a. on the same
window, so the missing exposure is not hiding an edge.** Both arms are labelled
**TIMED CARRY** by the Null-A timing placebo (`p_A = 0.000` on both): the
funding gate really does select carry — the same exposure placed at random
times earns +3.16 % (majors) and +1.40 % (alts) against the observed +7.89 %
and +6.90 %. Both are **carry-only**, not basis-assisted (`funding` exceeds
`hedge_pnl` by 26–90× on every window). And the pre-registered §8.4(1) reading
fires: **the gate costs money on the majors** — the always-on trade beat the
gated arm on fit (+9.45 % vs +7.89 %) *and* on holdout (+2.60 % vs +0.89 %), so
if a build object ever exists on this tier it is the passive trade with the
gate as a risk overlay, not the gate itself.

**The honest gap, pre-registered in `DESIGN.md` §5.1 before any number, landed
almost exactly where it was predicted to.** Schmeling, Schrimpf & Todorov's
≥ 10 % p.a. crypto-carry premium is on *notional*; at 2× perp leverage with
spot unpostable, capital is 1.5× notional, so the passive premium converts to
**≈ 6.7 % p.a. on capital — above this ladder's 5 % kill bar and below its
10 % build bar, a "real but too small" object by a factor of ≈ 1.5.** Measured
on fit: **H_majors +7.89 %, H_alts +6.90 % p.a. on capital.** Both land inside
that predicted band. This is the fourth "real but too small" finding in this
project and much the closest — 1.5× short rather than the 4–10× of the ORB
lift, the funding sensor and the RVOL cross-section — and it is short for a
structural reason, the capital denominator, not for want of a signal.

---

## 1. What the arm needed, and what it got

The note said the gap could only close if the gate concentrated the position so
that the **rate while ON averaged ≈ 0.035 %/8 h at utilisation ≈ 0.45**.

| measured on fit | H_majors | H_alts | what the note said the arm needed |
|---|---|---|---|
| mean funding rate while ON | 0.0324 %/8 h (35.5 % p.a.) | **0.0395 %/8 h (43.2 % p.a.)** | ≈ 0.035 %/8 h |
| **utilisation** | 0.373 | **0.308** | **≈ 0.45** |
| gross, of notional | 13.2 % p.a. | 13.3 % p.a. | ≈ 15–17 % |
| gross, on capital (÷1.5) | 8.8 % | 8.9 % | ≈ 10 % + costs |
| **net, on capital** | **+7.89 %** | **+6.90 %** | ≥ +10 % |

**The rate was there; the time was not.** The alt tier's funding rate while ON
*beat* the level the note said the arm needed. Utilisation came in at 0.308
against 0.45 — the premium regime covers under a third of this tape, not the
35–50 % projected — and 13.3 % of notional earned a third of the time is 8.9 %
on capital before a single fee. That is the whole arithmetic of the shortfall,
and no parameter inside the pre-registration moves it: the gate sensitivities
(§4) all land between +5.2 % and +8.7 %.

---

## 2. Fit period (2020-01-04 / 2020-09-17 .. 2024-07-31)

| arm / row | net p.a. on capital | `p_boot` | 90 % CI | Sharpe | maxDD | util. | ON slot-days | round trips | re-centres | **liq. at L=2** |
|---|---|---|---|---|---|---|---|---|---|---|
| **H_majors** (REGISTERED) | **+7.89 %** | 0.000 | [+5.93, +10.06] | 6.79 | 0.81 % | 0.373 | 1,247 | 47 | 31 | **0** |
| always-on benchmark | +9.45 % | 0.000 | [+7.61, +11.53] | 8.23 | 0.88 % | 1.000 | 3,341 | 31 | 31 | 0 |
| price-gated shadow | −2.78 % | 0.979 | [−4.73, −0.56] | −2.00 | 23.9 % | 0.398 | 1,330 | 387 | — | — |
| extreme-state overlay (fit-only) | +2.35 % | 0.000 | [+1.22, +3.68] | 2.95 | 0.67 % | 0.078 | 260 | 59 | 5 | 0 |
| **H_alts** (REGISTERED) | **+6.90 %** | 0.000 | [+4.93, +9.16] | 6.41 | 0.30 % | 0.308 | 2,610 | 166 | 116 | **1** |
| always-on benchmark | +5.59 % | 0.000 | [+3.62, +7.85] | 4.45 | 1.86 % | 0.999 | 8,474 | 108 | 104 | **3** |
| price-gated shadow | −5.29 % | 0.999 | [−7.45, −2.89] | −3.66 | 28.6 % | 0.387 | 3,284 | 1,107 | — | — |
| extreme-state overlay (fit-only) | +2.19 % | 0.000 | [+0.94, +3.71] | 2.89 | 0.46 % | 0.064 | 540 | 191 | 36 | 0 |

**Decomposition (§4.4, mandatory).**

| row | funding p.a. | hedge_pnl p.a. | fees+slip p.a. | cost/carry | mean settlements/pos. | median hold | zero-settlement share |
|---|---|---|---|---|---|---|---|
| H_majors | +9.09 % | +0.10 % | 1.30 % | 0.143 | 79.6 | 21.6 d | 2.1 % |
| always-on majors | +6.64 % | −0.06 % | 0.86 % | 0.129 | 89.7 | 19.8 d | 3.2 % |
| H_alts | +8.38 % | +0.35 % | 1.84 % | 0.219 | 47.2 | 5.9 d | 6.0 % |
| always-on alts | +4.76 % | +0.42 % | 1.26 % | 0.264 | 101.1 | 4.2 d | 11.1 % |
| price shadow majors | +7.75 % | +0.19 % | **10.71 %** | **1.38** | 10.3 | 3.0 d | 0 % |
| price shadow alts | +6.30 % | +0.48 % | **12.07 %** | **1.92** | 8.9 | 2.7 d | 0 % |

Three things to read off it. **The carry is real and it is the whole return:**
`funding` is 9.09 % and 8.38 % p.a. of capital while `hedge_pnl` is +0.10 % and
+0.35 %, so this is carry, not basis — the §8.4(2) "basis, not carry" reading
does **not** apply. **Costs are not what kills it:** fees and slippage take
1.30 % and 1.84 % p.a., a cost/carry ratio of 0.14 and 0.22; even the zero-cost
row only reaches +9.19 % and +8.73 %, still short of the build bar. **A price
gate does not select carry:** the shadow turns over 42–48 round trips per
symbol-year against the funding gate's 5–7, spends more on fees than it
collects in funding (ratio 1.4 and 1.9), and loses 2.8–5.3 % p.a. That is this
family's own version of the funding family's 25–37× result, and it points the
same way.

**Mechanism prerequisite (§6.8): PASSED, decisively.** Mean rate while ON is
0.0324 %/8 h (majors) and 0.0395 % (alts) against 0.0048 % and −0.0008 % while
OFF; on medians, 0.0130 % vs 0.0077 % and 0.0167 % vs 0.0068 %. The ON state
survives 3 settlements 100 %/100 % of the time, 9 settlements 100 %/94 %,
30 settlements 100 %/76 %, and 90 settlements 75 %/46 %; mean episode length is
234 settlements on the majors and 157 on the alts. **The gate is selecting, and
it is selecting persistence, exactly as designed.**

**Nulls.** Null A (timing placebo, 1,000 draws, holding utilisation, hold
lengths, turnover, cost and margin rule fixed): observed +7.89 % against a null
mean of +3.16 % and a null p95 of +4.50 % on the majors, `p_A = 0.000`;
observed +6.90 % against +1.40 % and p95 +2.40 % on the alts, `p_A = 0.000`.
**Both arms are TIMED CARRY.** Null B (whole-stream day shift, 250 draws):
null means +4.19 % and +3.23 %, `p = 0.000` on both.

---

## 3. The margin path — the risk the design was built around, and the one that fired

`x_liq = (1/L + F/N − mmr)/(1 + mmr) = 48.515 %` at `L = 2`, `mmr = 1 %`,
`F = 0`; re-centre at half the buffer, `x_rc = 24.257 %`; both evaluated on the
perp 1 h **high**.

| tier | L | net p.a. on capital | on notional | re-centres | per symbol-year | share of positions with ≥1 | **liquidations** | mean x_max | p90 | p99 | max | `L*` min | `L*` p1 | `L*` median |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| majors | **2** | **+7.89 %** | +11.83 % | 31 | 3.39 | 66 % | **0** | 0.198 | 0.264 | 0.279 | 0.281 | 3.41 | 3.43 | 3.84 |
| majors | 3 | +8.14 % | +10.85 % | 45 | 4.92 | 74 % | 0 | 0.154 | 0.186 | 0.267 | 0.272 | 3.51 | 3.58 | 5.67 |
| majors | 5 | +6.79 % | +8.15 % | 80 | 8.74 | 83 % | **1** | 0.095 | 0.115 | 0.181 | 0.264 | 3.62 | 5.21 | 9.11 |
| alts | **2** | **+6.90 %** | +10.35 % | 116 | 4.99 | 69 % | **1** | 0.233 | 0.327 | 0.443 | **0.558** | **1.74** | 2.19 | 3.73 |
| alts | 3 | +5.33 % | +7.10 % | 166 | 7.14 | 74 % | **8** | 0.173 | 0.241 | 0.435 | 0.514 | 1.89 | 2.23 | 5.40 |
| alts | 5 | +4.10 % | +4.92 % | 287 | 12.35 | 82 % | **16** | 0.114 | 0.159 | 0.325 | 0.463 | 2.09 | 2.96 | 8.44 |

**THE LIQUIDATION.** One, on the alt tier, at the primary 2× leverage, in the
fit period. DOGEUSDT: a position entered 2021-01-02 19:00 UTC (itself a
re-centre re-entry, after six re-centres had already been survived) at
`P_e = 0.011731`; by 2021-01-28 it had collected 77 settlements, so `F/N =
0.0279` had lifted `x_liq` from 48.515 % to **51.280 %**. It was liquidated at
the bar opening **2021-01-28 14:00** — the WallStreetBets DOGE squeeze. That
bar opened at 0.012852 and printed a high of 0.018275: **+42 % inside one
hour**, `x_bar_high = +55.78 %` against `x_liq = +51.28 %`. The next hour's
high was +113 %. **The re-centre rule could not help, because the same bar
crossed `x_rc` (+24.26 %) and `x_liq`** — precisely the §2.5 case the note
named in advance. The position's own realised P&L was **+0.081 USDT**, because
77 settlements of carry more than covered the liquidation: this is a
**survivability kill, not a loss kill**, and the ladder is right to treat it as
a hard gate anyway, because the same hour on a slightly larger position, or one
hour later, is a wipe-out.

**Nothing was re-tuned to avoid it.** The leverage, the maintenance margin
rate, the re-centre fraction, the gate and the cost model are exactly as
committed before any number existed, and the liquidation was escalated as a
build failure rather than engineered away.

**Three further margin facts for a build ruling.** (i) The always-on benchmark
takes **three** liquidations at L = 2 on the alts against the gated arm's one,
so the gate *reduces* liquidation exposure even while it costs return — it is a
better risk overlay than an alpha source. (ii) The alts' survivable-leverage
distribution bottoms at **`L* = 1.74`**: the worst position on this tape needed
sub-2× leverage to survive, which is the honest statement about this universe
on this account model. (iii) Loosening the re-centre to 0.75 × buffer produces
**7** liquidations on the alts and drops the return to +4.69 % — the half-buffer
rule is doing real work, and the sensitivity confirms it rather than rescuing
anything.

---

## 4. Sensitivities — all fit-only, none a rescue

| sensitivity | H_majors | H_alts |
|---|---|---|
| **PRIMARY** | **+7.89 %** (0 liq) | **+6.90 %** (1 liq) |
| gate ON 0.015 % | +8.28 % | +7.01 % (1 liq) |
| gate ON 0.03 % | +7.53 % | +6.72 % (1 liq) |
| gate OFF 0 % | +8.62 % | +7.17 % (1 liq) |
| gate OFF 0.01 % | +6.61 % | +6.06 % (1 liq) |
| f9 window 3 settlements | +8.01 % | +5.21 % (1 liq, maxDD 5.4 %) |
| f9 window 15 settlements | +7.98 % | +6.76 % (1 liq) |
| perp maker on entry + gate-OFF exit (≈0.30 % RT) | +7.98 % | +7.01 % |
| BNB fee discount | +8.09 % | +7.18 % |
| slippage doubled (0.16 %) | +7.61 % | +6.52 % |
| **zero cost (= gross)** | **+9.19 %** | **+8.73 %** |
| fees on actual exit notional (ruling §4(b)) | +7.83 % | +6.79 % |
| L = 3 | +8.14 % | +5.33 % (8 liq) |
| L = 5 | +6.79 % (1 liq) | +4.10 % (16 liq) |
| re-centre at 0.75 × buffer | +8.75 % | +4.69 % (7 liq) |
| published mmr (worst on tier) | +7.88 % | +6.89 % (1 liq) |

**Every row is between +4.1 % and +9.2 % p.a. on capital. Not one reaches the
+10 % build bar, and the best of them — zero cost, i.e. a fee-free counterfactual
that does not exist — still falls short.** That is the cleanest statement this
pass produces: the shortfall is structural, not a cost-model artefact and not a
threshold artefact.

**The fee sensitivity the Architect asked to be sized** (fees on the actual exit
notional rather than the pinned entry notional): the difference is **−0.053 pp**
on the majors and **−0.106 pp** on the alts, i.e. 5 and 11 bp of `C_tier` per
year. Both are **well under one-tenth of the +10 % bar**, so the pinned form's
understatement of unwind fees in a rally is real but immaterial, as the ruling
asked to be checked.

---

## 5. Holdout — read once, `H_majors` only (2024-08-01 .. 2026-07-31, 730 days)

`H_alts` was screened out on fit and **its holdout was never computed.**

| row | net p.a. on capital | `p_boot` | 90 % CI | Sharpe | maxDD | util. | ON slot-days | round trips | liq. at L=2 | funding p.a. | hedge p.a. | fees p.a. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **H_majors** | **+0.885 %** | 0.0005 | [+0.35, +1.56] | 4.38 | 0.07 % | **0.098** | **143** | 2 | **0** | +0.94 % | +0.07 % | 0.13 % |
| always-on benchmark | +2.600 % | 0.000 | [+2.12, +3.23] | 8.71 | 0.19 % | 1.000 | 1,459 | 4 | 0 | +1.84 % | −0.03 % | 0.25 % |
| price-gated shadow | −9.124 % | 1.000 | [−10.22, −8.16] | −10.21 | 18.2 % | 0.352 | 514 | 166 | — | +1.38 % | +0.01 % | 10.51 % |

Holdout margin table: at L = 2, mean max excursion 0.205, max 0.211, zero
re-centres, zero liquidations, `L*` min 4.48. The margin path was never
stressed in the holdout, because the arm was barely ever on.

**Applying the §8.2 ladder mechanically, in its own order:** ON slot-days
= 143 < the pre-registered floor of 150, so the verdict is **UNDERPOWERED —
inconclusive**. It is worth being exact about what that does and does not mean.
The floor was missed by 7 slot-days, and the return it protects against
mis-reading is +0.885 % p.a. — **4.1 points below the kill bar and 9.1 below
the build bar**, with a holdout SE of 1.38 % p.a. and an 80 %-power edge of
+11.2 %. The always-on benchmark ran the *same* window at full utilisation,
1,459 ON slot-days — ten times the exposure, comfortably over any floor — and
returned **+2.60 % p.a.**, also far below the kill bar. **So the missing
exposure is not concealing an edge: the premium itself was absent.** Mean
funding while the benchmark was on implies roughly 0.0025 %/8 h across the
holdout, about a tenth of the fit period's rate. Between 2024-08 and 2026-07
the Binance perpetual premium on BTC and ETH essentially disappeared, the gate
was ON under 10 % of the time, and there was nothing to collect.

**Tail (2026-08, non-gating):** the gate was OFF for the whole month; zero
positions, zero return. **Forward confirmation (§13)** is moot — it is required
only of a REAL EDGE arm, and there is none.

---

## 6. The descriptive rows the pre-registration required

**Reading-B tier row** (time-varying denominator, fit-only, non-gating): alts
+7.86 % against Reading A's +6.90 %, over 1,666 days of which 15.1 % have fewer
than six live slots (steps 2020-01-09→1, 01-20→2, 02-03→3, 02-13→4, 07-13→5,
09-17→6). Majors identical at +7.886 % either way. **The early one- and
two-symbol period flattered the alt tier by about one point**, which is exactly
the distortion the tier-start ruling anticipated; Reading A was the right and
the conservative call.

**SOL FTX-week counterfactual** (§3.3 rule 3, mandatory): the blackout span
2022-11-09 20:00 .. 2022-11-18 16:00 holds 101 rows on a 2 h (99) and 4 h (2)
interval, rates from −2.00 % to +0.0025 %, with **7 rows at the −2 % cap**. A
short perp **pays** a negative rate, so holding a SOL slot through the week at
the printed rates would have **cost −4.03 USDT, i.e. −4.03 % of the whole alt
tier's capital, in nine days.** The blackout therefore removes a large real
loss of the hedged trade from the SOL evidence and the fit numbers above are
flattered by its absence — the single most important entry in §7 below. (As it
happens the gate was OFF on SOL at 2022-11-09 19:00, so no position was
actually unwound at the blackout boundary; the number is what a held position
would have paid.) The holdout is unaffected — no non-8 h rows after 2022-11.

**Spot-as-collateral counterfactual, majors only** (the six alts are not
eligible collateral in Binance Multi-Assets Mode as published):

| row | capital basis | net p.a. | funding p.a. | positions | re-centres |
|---|---|---|---|---|---|
| primary, isolated USDT, spot not collateral | 1.5 N | +7.89 % | +9.09 % | 47 | 31 |
| same, re-centres removed (`x_liq` unbounded) | 1.5 N | +20.82 % | +21.07 % | 16 | 0 |
| **spot as collateral at a 90 % haircut, `N = C_slot/1.1`** | 1.1 N | **+28.40 %** | +28.73 % | 16 | 0 |

**This is the largest number in the pass and it must be read carefully.** The
lift is **not** the 1.5 → 1.1 capital denominator, which is worth only 1.364×.
It is the perp notional compounding with price while capital stays fixed:
`funding` goes from 9.09 % to 21.07 % p.a. because a short that is never
re-hedged collects on a notional that grew with the rally. One position carries
most of it — ETHUSDT held 2020-10-21 → 2021-05-19 through `P_e` 396.74 →
2,856.12, 630 settlements, **46.70 USDT of funding on a 50 USDT slot**. Those
are exactly the positions the primary account cannot hold: their `x_max` runs
many multiples of `x_liq`. The honest reading is that **the account type is
worth more to this trade than the gate is**, and that a build ruling which
wants this premium should be arguing about Multi-Assets Mode or Portfolio
Margin, not about thresholds. It remains descriptive: nothing here was tested
out of sample.

---

## 7. Doubts

1. **The SOL blackout removes a real loss, and it is large.** −4.03 % of alt
   tier capital in nine days, at rates that a short perp pays. The fit alt
   numbers are flattered by its exclusion. The exclusion was ruled by the
   Architect before this pass existed and is not being re-litigated, but the
   size belongs in the reader's head.
2. **The mark-price proxy.** Liquidation is evaluated on the perp 1 h **high**,
   because the archive has no mark-price series. Binance liquidates on the mark
   price, which is smoothed against the index and is normally *inside* the last
   price. This makes the modelled margin path **conservative**: the true
   DOGE liquidation on 2021-01-28 might not have fired at all. Against that,
   an hourly high is a coarser instrument than a real-time mark, and a real
   account on that hour faced a cascading order book, not a print.
3. **The basis proxy.** `b_t` is the ratio of two 1 h closes from two archive
   feeds. It is not a tradable spread, has no depth behind it, and the entry
   and unwind both assume a fill at that close on both legs simultaneously.
   `hedge_pnl` is small everywhere (+0.10 % to +0.42 % p.a.), so the verdict
   does not turn on it; a build would need a real spread study.
4. **Unmodelled book depth.** Slippage is a flat 0.02 % per fill. On DOGE in
   January 2021, on the hour in question, that is fiction. The doubled-slippage
   row (0.16 % round trip) costs 0.3–0.4 pp and does not change anything, but
   no flat allowance describes a squeeze.
5. **Survivorship.** All eight symbols are listed in 2026. The tape
   under-represents perps whose funding blew out before delisting, which for a
   hedged carry is precisely the population where the carry *and* the
   liquidation risk were largest. Declared, not corrected. The single
   liquidation found here is therefore a **lower bound** on this account
   model's true liquidation rate.
6. **The holdout is one funding regime.** 2024-08 .. 2026-07 had almost no
   perpetual premium on BTC/ETH. That is a real fact about the venue, not a
   sampling accident, but it means the holdout tested the gate's *abstention*
   far more than its selection — which is also why the ON-slot-day floor was
   missed.
7. **Prior reads, declared:** 2024-08 .. 2025-07 lay inside the funding
   family's fit window at pooled-aggregate level (carry per trade, survival
   curves, forward rate — quoted as priors, no year-by-year number, no gate of
   this design, no hedged P&L, no basis series). 2025-08 .. 2026-07 has been
   read by six BTC/ETH intraday price-only registrations. No REAL EDGE arm
   exists, so the frozen forward confirmation that would have paid for the
   count is not owed.
8. **One arithmetic correction to the note:** the holdout 2024-08-01 ..
   2026-07-31 is **730** days, not 731 (no 29 February falls inside). `n_eff`
   moves from 394 to 393 and no decision anywhere changes.

---

## 8. Ledger

- **Registered arms:** 2 (`H_majors`, `H_alts`). **α = 0.05/2 = 0.025.**
- **Holdout reads: 1** (`H_majors`). `H_alts` screened out on fit; holdout never
  computed.
- **Verdicts:** `H_alts` **NOT SURVIVABLE — kill at this leverage** (fit-period
  kill, one liquidation at L = 2). `H_majors` **UNDERPOWERED — inconclusive**
  (143 < 150 ON slot-days), measured +0.89 % p.a. on capital against a +5 %
  kill bar and a +10 % build bar.
- **Labels:** both TIMED CARRY (`p_A = 0.000`); both carry-only, not
  basis-assisted; **"the gate costs money" fires on the majors** (always-on
  beats the arm on fit and on holdout).
- **Harness:** audit identity 8/8 against the funding family; harness validation
  44/44 (`a = 1` planted-accrual identity exact to 1e−16); `checks.py` 51/51;
  mechanic proof on 20 positions with the margin path printed step by step,
  worst `|hand − engine|` = **0.000e+00**.
- **Discipline:** `DESIGN.md` committed before any arm return (fe4b8df); screen
  decision committed before any holdout number (842fe0c); holdout read once,
  guarded by a script that refuses to run twice; no parameter moved for power
  or for a liquidation.

**A kill is a result. Stated plainly: on Binance, 2020–2026, at retail VIP-0
taker fees and 2× perp leverage with spot unpostable as collateral, the funding
premium does not pay 10 % a year on the capital it ties up. It pays about 7 %
on the fit period — real, timed, statistically unambiguous and still 1.5×
short — and in the two years to 2026-07 it paid about 1 %, because the premium
itself was gone. The leverage rows and the spot-as-collateral row show exactly
how far short and at what account type it would not be.**
