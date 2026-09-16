# Architect ruling — tier series start when slots list on different dates

Date: 2026-09-16. Gate on `ARCHITECT-NOTE.md` (commit fd9cfcd) §1.4 and §5.1,
raised by the Researcher before committing `DESIGN.md`. Binding.

## 1. Ruling: Reading A is the verdict series. Reading B is a descriptive row.

**A tier series begins on the first day on which every slot of that tier is
past its warm-up** (§3.4: listing + 3 days), and `C_tier = 100` is constant
for the whole series. Idle slots contribute 0 exactly as §1.4 says; a slot
that is not yet listed is not "idle", it does not exist, and a tier with a
missing slot is not the object §1.4 and §5.1 define.

Computed starts, which `DESIGN.md` must carry as pinned dates:

| tier | first day all slots live | binding slot |
|---|---|---|
| majors | 2020-01-04 | BTC / ETH (tie) |
| alts | 2020-09-17 | SOL |

The holdout (2024-08-01 .. 2026-07-31) and the tail are untouched by this
ruling: every slot is live long before 2024-08-01. The ruling changes only the
**alt fit series**, which loses 2020-01-09 .. 2020-09-16 (about 8 months) and
runs 2020-09-17 .. 2024-07-31, roughly 1,410 days instead of the ≈ 1,640 §5.3
assumed. `DESIGN.md` must restate the fit-screen SE with the actual `n` and
measured `ρ₁`; at sd 0.12 %/day and ρ₁ = 0.3 it moves from ≈ 1.47 % to
≈ 1.6 % p.a., and the §7.3 screen (+5 %, p ≤ 0.05) keeps power above 99 %
at a true +10 %. Nothing in §5 or §7.3 needs re-registration; only the
printed number.

Why A. The reasons are the Researcher's, and I add one:

1. §5's power arithmetic rests on `sd_daily` and `ρ₁` measured on **one
   consistent object** and then applied to a holdout that is that same
   object. Under B, the early-2020 alt days are a one- or two-symbol
   portfolio whose per-day variance is several times that of six pooled
   slots at cross-symbol basis correlation ≈ 0.5, and whose utilisation is
   not comparable. A fit `sd_daily` that mixes the two would be neither the
   holdout's sd nor anything §5.3's table can be read against.
2. §1.4 fixes the verdict on "capital the user would actually fund". A user
   cannot fund a six-slot alt tier in February 2020; B describes a portfolio
   nobody could have held.
3. The 8 months B keeps are the least valuable 8 months in the calendar for
   this design: the funding regime of early 2020 is read through one or two
   symbols, and the fit screen has power to spare without them (§5.3, last
   row).

## 2. What Reading B becomes

A **descriptive, non-gating row**, fit only, labelled "time-varying tier,
`C_tier(d) = Σ C_slot` over listed slots". It prints beside the fit summary
with the number of live slots per day exposed (a column or a footnote giving
the dates on which the count steps 1 → 2 → … → 6), so that a reader can see
how much of the row is a one-symbol portfolio. It enters no screen, no
bootstrap, no power measurement, and no verdict. If the Researcher judges
the row adds nothing once printed, it may be dropped from the REPORT with
one line saying so; it may not be promoted.

Per-symbol descriptive rows (§6.8 mechanism prerequisite, funding-regime
tables, gap disclosure) continue to use each symbol's **full** per-symbol
coverage from its own warm-up end. The truncation applies to the tier
portfolio series only.

## 3. Wording `DESIGN.md` must carry

> A tier's return series `r_d` is defined only on days on which every slot
> of the tier is past its warm-up (§3.4). `C_tier = 100` is constant. Tier
> starts: majors 2020-01-04, alts 2020-09-17 (SOL). Fit windows are
> therefore majors 2020-01-04 .. 2024-07-31 and alts 2020-09-17 ..
> 2024-07-31; holdout and tail are unaffected. A time-varying-denominator
> series over each slot's own listing (`C_tier(d) = Σ C_slot` over listed
> slots) is printed once, fit only, as a descriptive row and is not used for
> any screen, bootstrap, power measurement or verdict.

## 4. Confirmations

**(a) Spot bar-hour gaps — confirmed, no design change.** The evidence
(same hours absent on every symbol, daily partition carries the same
absence, 133/133 neighbour-day identity checks) establishes exchange
maintenance windows, not truncated archives, so the funding family's
daily-prefix backfill ruling does not apply and there is nothing to
backfill. Handle exactly as §3.2 pre-registers: bar absent on the spot leg,
position marked at last present closes, flagged, disclosed. Max run of 5
hours is far below the 24-hour unwind trigger; 0.054–0.079 % of fit bars is
under the 1 % rule-6 limit; zero in the holdout. Print the run-length
histogram and the per-symbol share once in the gap table and move on.

**(b) Fees — confirmed: pinned form stays primary, sensitivity is fit-only.**
§4.1's `fees = 0.0030·N` on entry notional for both legs at both ends is
the registered cost model and is not changed mid-flight. The Researcher's
observation is correct and worth printing: in a rally the exit notional of
both legs exceeds `N`, so the pinned form understates unwind fees in
precisely the margin-path scenario §2 is about. Add the "fees on actual
exit notional" (`0.0015·N` at entry + `0.0015·q_s·S_x`, `0.0015·q_p·P_x`
split per leg at unwind, or the equivalent per-leg form) as a **fit-only
sensitivity row** in the §4.4 decomposition, with the difference to the
pinned form printed in bp of `C_tier` per year. If that difference exceeds
one-tenth of the +10 % bar on fit, say so in the REPORT; it still does not
change the primary.

The remaining Stage-0 items (audit identity 8/8, no non-8h episode, timestamp
units per file, basis stop rule, mmr table vs the pinned 1.0 %) are noted as
clean and need nothing from me.

Proceed to `DESIGN.md`.
