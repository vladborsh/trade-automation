# Power correction — the cross-sectional family in rebalance terms, the harness certification, and §1 restated with attenuation (Architect, 2026-09-16)

**Role:** Architect. **Status: RULING.** Amends `2026-09-red-team.md` §0 item 2,
§1 (table), §8 item 3, and `research/crosssec-instruments-in-play/ARCHITECT-NOTE.md`
§7.1, §8.2, §10.2, §11 — the exact amendments are in §4, written so the
Researcher can apply them without a round trip. **Audience:** coordinator,
Researcher (crosssec, mid-build; no R computed yet), Architect.

**Evidence read:** `research/_calibration/REPORT.md` in full (esp. §A.3, §A.4,
§C.2); `DESIGN.md` of the same; `2026-09-red-team.md` §0, §1, §6.3, §8;
`crosssec-instruments-in-play/ARCHITECT-NOTE.md` §0, §2, §5, §6.3, §7, §10,
§11; `PROJECT.md` "User rulings, 2026-09-16". One number was computed here,
read-only, from the Researcher's 1d pull (515 symbols with ≥ 400 daily bars,
2020-01 .. 2026-08): the same-day cross-sectional correlation of perp
returns, §1.2. Nothing was pulled and nothing in that worktree was written.

---

## 0. Rulings

1. **Red team §1's "~40× observations" claim was wrong, and I made it.** A
   cross-sectional arm yields one *day* of evidence per day, not five; five
   same-day crypto legs at pairwise correlation ρ ≈ 0.5 are worth **1.7
   independent draws**, not 5. On the registered design (daily anchor, top-5
   directional, +4 h, one holdout year) the family has **≈ 300–570 effective
   observations against the ORB arms' ≈ 220 — an advantage of 1.4–2.6×, not
   40×.** Its holdout standard error is 0.038–0.052R against ORB's 0.054R.
   Full arithmetic in §1.
2. **The family is not underpowered by construction, and it proceeds —
   amended, not paused.** Two facts carry that: (i) the ladder's binding gate is
   the `+0.10R` mean bar (calibration §A.4), which is a *size floor*, so power at
   the bar is 50 % in every family by construction and the only power question
   is "how far above the bar must the true edge sit to pass at 80 %" — here
   `+0.13–0.14R` on one holdout year versus `+0.145R` for ORB; (ii) the **fit
   screen** (`≥ +0.05R`, `p ≤ 0.05`, ~1,230 days) has SE ≈ 0.02R and **> 98 %
   power at a true measured `+0.10R`**, so a family with an edge of the size it
   is registered to find cannot be lost at the screen, and a family without one
   dies there for free. The holdout is where certification is scarce, and that
   is what the amendment buys.
3. **Amendment (binding, §4):** the holdout becomes **two years, 2024-08-01 ..
   2026-07-31**, fit **2020-01-01 .. 2024-07-31** (the red team §8 item 4
   convention, applied now because no R has been computed — this *is* "the next
   design"). That takes the 80 %-power edge from `+0.137R` to `+0.126R` (ρ = 0.5)
   and effective observations to ≈ 600–1,100. The arm, stop, hold, k, α,
   nulls and every tightening are unchanged. A power statement in rebalance
   terms, with ρ **measured** on the fit period, goes into `DESIGN.md` before
   the fit screen.
4. **Harness certification: (c).** Test C did not fail the harness and did not
   certify it; it failed a bar that was set above what this tape can deliver
   for *any* harness (§C.2: a Sharpe-0.91 hurdle on a Sharpe-0.70 object, on a
   universe and era the paper never studied). A control whose "known answer" is
   not known on this tape is not a positive control. **The certifying Stage 0
   is replaced by a planted selection effect of known size run through the
   portfolio harness** — Test A's method, which the calibration proved to
   `1e-14`, transplanted (§3). Test C is retained as a descriptive sign check
   (4/4 horizons, p = 1/16 under no effect) with **no certification role**.
   The family may proceed on the planted control; it must pass before the fit
   screen is read.
5. **Red team §1's hurdle table is restated with the bracket attenuation
   (§2).** For the ±1R ORB template a measured `+0.10R` requires a true
   post-entry drift of `≈ +0.20R`; every literature number in §1 is a drift or a
   stop-only number and therefore sat **half as close** to the bar as §1 said.
   For the cross-sectional template (stop only, no target) the attenuation is
   smaller — assumed 0.75–0.85, **measured** by the new Stage 0 — and the
   honest target of ARCHITECT-NOTE §6.3 becomes ≈ **2.2× the paper's top tier
   for a coin-flip pass, ≈ 2.6× for an 80 % pass on the two-year holdout**
   (§1.5). That is the hypothesis; it dies at the screen if wrong, as §6.3
   already says.
6. **The 1–5 day horizon ruling does not change this family's arm.** A longer
   hold lowers `cost_R` but also the number of independent days per year
   (overlapping holds are correlated across days), so on the power axis it
   does not help a daily-anchor design; the 12 h / 48 h sensitivities already
   registered in §10.2 print what it does. Multi-day crypto belongs to a
   separate registration (basis/carry, or a cross-sectional reversal family),
   not to a mid-build amendment.

---

## 1. The power arithmetic, in the design's own terms

### 1.1 Which regime the registered design sits in

Test C's object is a dollar-neutral weekly long–short basket: one return per
rebalance, 253 rebalances. The registered primary (ARCHITECT-NOTE §0 rulings
2, 4, 5) is different: **per NYSE day, 5 directional legs**, each with its own
side from `r30`, its own `0.5 × dATR14` stop, a +4 h exit, and the arm's mean
net R is the mean over legs with a **day-block** bootstrap and a random-5 null
(§10.2). So the unit of evidence is the trade-day, and the question is how
many independent draws five same-day legs are worth.

If the five legs' net-R outcomes have common pairwise correlation ρ, the
day-mean has variance `σ² (1 + 4ρ) / 5`, i.e. each day is worth

```
n_eff/day = 5 / (1 + 4ρ)
```

independent legs. That is the whole correction: at ρ = 0 the day is worth 5
legs and §1's "×50" arithmetic would have been right up to k; at ρ = 1 it is
worth 1 and Test C's "one per rebalance" is exact. The crypto cross-section
sits near the second.

### 1.2 ρ on this tape (computed here, read-only)

Mean pairwise correlation of daily log returns across all perps present
≥ 90 % of the year, and the fraction of symbol-days whose sign matches the
cross-sectional median sign that day:

| year | symbols | mean pairwise ρ (daily) | PC1 share | mean ρ with BTC | same-sign as market |
|---|---|---|---|---|---|
| 2021 | 86 | 0.57 | 0.58 | 0.60 | 80 % |
| 2022 | 131 | 0.64 | 0.67 | 0.69 | 80 % |
| 2023 | 160 | 0.48 | 0.54 | 0.58 | 75 % |
| 2024 | 249 | 0.51 | 0.56 | 0.55 | 77 % |
| 2025 | 391 | 0.48 | 0.58 | 0.57 | 71 % |

These are daily-return correlations, not 4-hour leg-outcome correlations
under a stop; the latter is what §5.4 already requires the Researcher to
report and is what the `DESIGN.md` power statement must use (§4, A2). Three
things push the leg-outcome ρ *below* the daily 0.5: the 4 h window is
shorter than a day, the stop truncates the common-factor tail, and on days
where `r30` gives the five legs mixed sides the common factor enters with
opposite signs. One thing pushes it *above*: the five selected names are the
ones "in play", which are the names most exposed to the day's common move.
**Base case ρ = 0.5; the table below prints 0.3–0.8.** The direction of the
finding does not depend on the choice.

### 1.3 Standard error and effective n, registered design (one holdout year)

Assumptions: σ_leg = 0.9R (ORB's ±1R template gave 0.74–0.88R; a stop-only
4 h template has a longer right tail — 0.9 is the central guess, 0.8–1.1 the
band); 250 tradable NYSE days per holdout year (2024-08 onward every day has
≥ 249 eligible symbols, so none drop); 5 legs/day.

```
SE(arm mean, 1 year) = σ_leg × sqrt((1 + 4ρ) / 5) / sqrt(250)
```

| ρ | n_eff / day | effective n, 1 y | SE, 1 y | SE, 2 y | SE, fit (~1,230 d) |
|---|---|---|---|---|---|
| 0.3 | 2.27 | 568 | 0.038R | 0.027R | 0.017R |
| **0.5** | **1.67** | **417** | **0.044R** | **0.031R** | **0.020R** |
| 0.7 | 1.32 | 329 | 0.050R | 0.035R | 0.022R |
| 0.8 | 1.19 | 298 | 0.052R | 0.037R | 0.024R |
| *ORB arm, reference* | — | *220* | *0.054R* | — | — |
| *Test C weekly L–S, reference* | — | *253* | — | — | — |

So: **1.4–2.6× ORB's effective sample on one holdout year, 2.7–5.2× on two.**
Not 40×. Raising k does not help — at ρ = 0.5, k = 10 gives `n_eff/day` =
1.82 against 1.67 — because the common factor, not the leg count, is the
constraint. (The one thing that *would* break ρ is hedging every leg with an
opposite BTC leg, which is ARCHITECT-NOTE §5.4's beta-hedged row; it doubles
cost per leg and changes the hypothesis to "in-play continuation *relative to
BTC*". It stays descriptive in this pass and is the obvious separate
registration if the fit-period ρ comes out ≥ 0.7.)

### 1.4 What passes, and at what power

Calibration §A.4 established that the `+0.10R` mean bar binds alone and α
never does. Check it holds here: the random-5 null has the same leg
structure, so its sd ≈ SE and its mean ≈ −`cost_R` ≈ −0.04R; the one-sided
α = 0.025 threshold is ≈ −0.04 + 1.96 × 0.044 = **+0.046R**, well under the
bar. The bar binds. Then P(pass) = P(measured mean ≥ +0.10R):

| true measured edge per leg | P(pass), 1-y holdout, ρ = 0.5 | 2-y holdout, ρ = 0.5 | ORB arm (reference) | annualised Sharpe of the arm (ρ = 0.5) |
|---|---|---|---|---|
| +0.05R (kill bar) | 13 % | 5 % | 18 % | 1.1 |
| +0.08R | 33 % | 26 % | 36 % | 1.8 |
| **+0.10R (build bar)** | **50 %** | **50 %** | **50 %** | **2.3** |
| **80 %-power point** | **+0.137R** | **+0.126R** | **+0.145R** | 3.1 / 2.9 |
| +0.155R | 89 % | 96 % | 85 % | 3.5 |

Across ρ = 0.3 … 0.8 the 80 %-power point is +0.132 … +0.144R on one year
and +0.122 … +0.131R on two. **The ladder still certifies only Sharpe ≳ 2.3
objects, as red team §0 said; the cross-sectional design lowers the entry
price of that certification by a fifth, and the two-year holdout by a
further tenth. Neither turns a Sharpe-1 edge into a certifiable one, and
nothing should.**

The fit screen is a different matter and is where this family's actual
information lives: at SE ≈ 0.02R, a true measured `+0.10R` clears
`≥ +0.05R, p ≤ 0.05` with **> 98 %** probability (ρ = 0.5: 99.4 %; ρ = 0.8:
98.3 %), and a `+0.07R` with ≈ 80–84 %. **The family cannot lose a
build-sized edge at the screen, and it does not need the holdout to find out
that it has none.** That is why it proceeds.

### 1.5 The honest target restated (amends ARCHITECT-NOTE §6.3)

§6.3 mapped the paper's top tier to `+0.036R` net at the gating stop on a
typical alt and said a pass needs ≈ `+0.07 dATR` gross per 4 h, "about twice"
the paper's top tier. With the attenuation and the power point in:

| what has to be true | measured mean needed | ÷ attenuation (0.8, assumed, to be measured) | + cost (0.02 dATR, typical alt) → gross drift, dATR/4 h | × paper's top tier (0.038 dATR) |
|---|---|---|---|---|
| coin-flip pass (bar) | +0.10R = 0.050 dATR | 0.0625 dATR | **0.083 dATR** | **2.2×** |
| 80 % pass, 1-y holdout | +0.137R = 0.069 dATR | 0.086 dATR | 0.106 dATR | 2.8× |
| 80 % pass, 2-y holdout | +0.126R = 0.063 dATR | 0.079 dATR | **0.099 dATR** | **2.6×** |

The registration's argument — that a crypto alt in play moves more in 4 h
relative to its own ATR than a US stock in play moves in a day — now has to
carry a factor of 2.2–2.6, not 2. Stated so nobody is surprised; it remains
the hypothesis, and the screen is where it is tested.

---

## 2. Red team §1's hurdle table, restated with the bracket attenuation

Calibration §A.3: through the ±1R bracket, a planted post-entry drift `d`
reaches the arm mean as **0.45–0.60 × d** (falls with |d|), and exactly
`1.0 × d` on trades held to the flat. §1's table was in *measured* units and
compared measured hurdles with literature numbers that are not measured
through a ±1R bracket. Corrected:

| measured net edge per trade (§1's column) | P(pass), n ≈ 220 | **true post-entry drift required through a ±1R bracket (÷ 0.5)** | literature number that was set against it, and what it would *measure* as |
|---|---|---|---|
| +0.05R (kill bar) | ≈ 15 % | **+0.10R** | Baltussen et al. +0.05–0.09R per trade is a *hold-to-close* drift → measures as **+0.025–0.045R** |
| +0.08R | ≈ 30 % | **+0.16R** | Zarattini 2024 > 100 % tier, +0.08R at a 0.1-ATR stop, no target → through a ±1R bracket ≈ **+0.05–0.06R** (stop-only → bracket factor ≈ 0.6) |
| +0.10R (build bar) | ≈ 45–50 % | **+0.20R** | — |
| +0.155R | 80 % | **+0.31R** | — |
| +0.38R (Zarattini > 3,000 % tier) | ≈ 100 % | +0.76R | still passes at ≈ 0.6 × 0.38 = +0.23R measured |

Two consequences. First, §1's sentence "nothing in the published record on a
single liquid index is a Sharpe-2 object" understated the gap by a factor of
two: the published objects measure as +0.025–0.06R through this ladder's
template, against a +0.10R bar. Second, the "n for 80 % power at +0.05R ≈
2,900 trades" line stands in measured units, but the mechanic that produces
a measured +0.05R is a +0.10R-drift mechanic — which is already at the top
of what the single-instrument literature reports. **The single-instrument
index closure in `PROJECT.md` was right for a stronger reason than was given.**

For the cross-sectional template (stop, no target) the attenuation is
stop-only: drift survives fully on legs that reach the time exit and
partially on stopped legs. **Assumed 0.75–0.85; measured by the Stage 0 of
§3, whose recovery ratio `Δ_tb / d` is exactly this number.** Until measured,
every dATR-unit target in this family uses 0.8 and says so.

---

## 3. Harness certification — what replaces Test C's bar

### 3.1 Why (c)

- Test C could not distinguish "harness defect" from "effect weaker on this
  universe and era" (`REPORT` §C.1 says so). A test that cannot fail for the
  reason it was designed to catch is not a certification instrument.
- Its bar (t ≥ 2 on 253 weeks = Sharpe 0.91) was set by me, in §6.3 of the red
  team, without the §C.2 arithmetic; the same note's §1 would have predicted
  the failure had it been applied. That is a miscalibrated bar, not a broken
  harness.
- Nothing Test C *did* show points at a defect: correct sign 4/4 (p = 1/16
  under no effect), long leg > short leg 4/4, NW and plain t agree, universe
  and leg counts non-degenerate, delisted names carried honestly.
- But "nothing points at a defect" is not certification either. Test A showed
  what certification looks like: **a planted effect of known size recovered
  exactly.** That test is constant-free and the calibration proved it to
  `1e-14` on the single-instrument engine. The portfolio harness gets the same.

### 3.2 Stage 0 (replaces ARCHITECT-NOTE §8.2's "Stage 0 = Test C")

`stage0_plant.py`, fit period only, before the fit screen is read, results
committed with `DESIGN.md`. On the **real** fit tape, for each arm (RVOL,
TR24) and `d ∈ {−0.20, −0.10, 0, +0.10, +0.20}` in R units of that leg's stop:

- **Plant:** add a linear ramp of `d × stop_dist` over the 4 h path, in the
  direction of the leg's *side*, to the post-entry 1-minute path of the
  **top-5 legs only** (the selected legs). Bottom-5, random-5 draws and every
  unselected instrument see the unplanted tape. This is a planted *selection
  effect* — exactly the object the harness exists to measure.
- **Gates (hard, all must pass):**
  - P0 — selection invariant in `d`: identical eligible set, ranking, top-5,
    bottom-5, sides, entries, stops on every day (the plant is post-entry).
  - P1 — exact recovery: on selected legs that reach the time exit at both
    `d = 0` and `d`, `ΔgrossR == d` to ≤ `1e-9`.
  - P2 — ranking exactness: the harness's top-5 and bottom-5 equal an
    independent pandas `argsort` on the same per-day table, every day, both
    selectors (the multi-leg analogue of Test B's two-path bar check).
  - P3 — monotone and sign-symmetric in `d`: arm mean strictly increasing;
    `mean(−d) < mean(0) < mean(+d)`.
  - P4 — `gross − net == cost` to float; cost invariant in `d`.
  - P5 — **null isolation**: the random-5 null's mean moves by < 0.01R across
    the full `d` sweep (the overlap of a random draw with the top-5 is 5/N
    per leg and this measures it); the bottom-5 mean moves by exactly 0.
  - P6 — the day-block bootstrap interval covers the run's own mean, every
    cell; `Δ_tb` interval likewise.
  - P7 — `d = 0` reproduces the committed fit run bit-for-bit (run *after*
    the fit numbers exist; otherwise it is the fit run).
- **Measured, reported, not gated:** the recovery ratio `Δ_tb / d` per cell —
  this is the template's attenuation factor `a`, which replaces the 0.8
  assumption in the `DESIGN.md` power statement and in §1.5's table.
- **Certification statement** for `REPORT.md`, verbatim if it passes: "The
  portfolio harness recovers a planted selection effect of known size, with
  the right sign, on both selectors, with the random-5 null isolated from
  the plant; the attenuation of this template is `a` = …". If any gate fails,
  stop and return to Architect; the fit screen is not read.
- **Test C** is lifted as `stage0_xsmom.py` unchanged and reported under a
  heading "Descriptive — published-factor sign check — no certification":
  sign per horizon, t, and the sentence from `REPORT` §C.1. No bar.

Cost: the harness already has every primitive this needs; Test A's `testa.py`
has the ramp and the gate code. Half a Researcher-day, no holdout read.

---

## 4. The amendments, exactly

Apply to `research/crosssec-instruments-in-play/ARCHITECT-NOTE.md` and carry
into `DESIGN.md`. Nothing else in that note moves.

**A1 — §0 row 7 and §7.1 table, split.**
Fit: `2020-01-01 .. 2024-07-31` (effective from the first day with
`N_elig ≥ 50`, expected 2020-09). Holdout: **`2024-08-01 .. 2026-07-31`**, two
years, read once. Forward confirmation `2026-08-01 .. 2026-10-31` unchanged.
Split by NY anchor date, never re-cut. **Declaration to add to §7.1:** the
first holdout year, `2024-08-01 .. 2025-07-31`, lay inside the *fit* window
of the single-instrument ORB crypto arms and cmc-bot on BTCUSDT/ETHUSDT
only; it has never been a holdout for anything, and no cross-sectional or
selection quantity has been computed on it. The second year's six BTC/ETH
reads are declared as already written. The §7.2 α ruling (0.025, two arms)
and the forward-confirmation tightening stand unchanged — the contamination
argument that paid for them is, if anything, weaker now.

**A2 — §7.1 / §11 step 4, the power statement.** `DESIGN.md` gains a section
"Power, in trade-days", committed with the fit-screen decision and before
any holdout number, containing: fit-period tradable days and legs per arm;
the **measured** mean pairwise correlation of same-day leg net R per arm
(the §5.4 quantity) and the measured attenuation `a` from Stage 0; the
projected holdout SE from §1.3's formula with those two numbers; the true
measured edge that passes the `+0.10R` bar at 80 % power; and the §1.5
dATR-unit target beside the paper's top tier. If the projected 80 %-power
edge exceeds `+0.15R`, the statement says so in bold and the Researcher
proceeds anyway — that is information for the Architect, not a stop rule.

**A3 — §8.2 and §11 step 3, Stage 0.** Replace "Stage 0 = Test C, t ≥ 2"
with §3.2 above: `stage0_plant.py` gates P0–P7 certify; `stage0_xsmom.py`
(= `_calibration/testc.py`, lifted verbatim) is descriptive. Stage 0 runs
after the fit numbers exist and before the screen decision is committed;
any gate failure is a stop rule (§11 step 8).

**A4 — §10.2 ladder, the sample floor.** `n_holdout ≥ 150` legs **and ≥ 300
trade-days** (two years); UNDERPOWERED otherwise. The two-year holdout is
the point of A1 and the floor should say so.

**A5 — §6.3, one sentence appended.** "With the stop-only attenuation
(assumed 0.8 until Stage 0 measures it) and 80 % power on the two-year
holdout, the required gross continuation is ≈ 0.10 dATR per 4 h, ≈ 2.6× the
paper's top tier (`2026-09-power-correction.md` §1.5)."

**Unchanged, explicitly:** the two arms, k = 5, `0.5 × dATR14`, the +4 h
exit, the 09:30 NY anchor, both selectors, the nulls, α = 0.025, every
tightening, every fit-only sensitivity, the pull that is in progress (the
1d/1m tape already spans both holdout years). No new arm, no new
sensitivity, no horizon change.

---

## 5. Corrections to my own earlier notes

- `2026-09-red-team.md` §0 item 2 and §8 item 3: "fifty instruments × 250
  days is ~40× the observations" is **withdrawn**; the honest figure is
  1.4–2.6× (one year) or 2.7–5.2× (two years). The recommendation — the
  cross-sectional family is the right bet — **stands**, on the corrected
  figure and on the fit-screen power in §1.4, not on the withdrawn one.
- `2026-09-red-team.md` §1 table: superseded by §2 above.
- `2026-09-red-team.md` §6.3: the `t ≥ 2` bar for Test C is withdrawn as a
  certification criterion, for the reason in §3.1. The calibration
  Researcher applied it exactly as written and reported the failure exactly
  as pre-registered; the error was in the bar.
- `crosssec-instruments-in-play/ARCHITECT-NOTE.md` §10.2's sentence "five
  correlated legs a day make the per-leg n overstate the evidence" was right
  and should have been carried through to the power claim in the survey. It
  now is.
