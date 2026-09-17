# HANDOFF — COIN-M inverse cash-and-carry

**Status: CLOSED, and with it THE WHOLE CARRY LINE. Both registered arms dead
on the holdout; no build object; no Software or Integration Engineer work.**
Read `REPORT.md` §0 first; this file is what a successor needs in order not to
repeat the pass — and, more importantly, why there is no successor to write.

## What was registered and what happened

Two arms, α = 0.05/2, both on the **COIN-M inverse** account structure
(`q = N/P_e` coins in the COIN-M wallet, short `N` USD at 1×, `C = 1.05 N`,
funding swept to a USD buffer at every settlement). BTC and ETH only.

- **Arm A — passive inverse carry, always-on.** Fit **+10.99 % p.a. on
  capital** (the first fit reading in this project to reach the +10 % build
  bar); holdout, read once, **+4.79 %** on 1,460 ON slot-days and 730
  trade-days, 0 buffer breaches. **`NO EDGE — kill`**, 0.21 points under the
  kill bar and **8.9 σ** under the build bar at a measured holdout SE of
  0.588 % p.a.
- **Arm B — quarterly basis, ≥ 10 % p.a. lock.** Fit +6.16 % over 16
  positions; holdout **+3.60 %** over 6 positions, 302 trade-days — floors met,
  so **not** the UNDERPOWERED outcome the design predicted, a **`NO EDGE —
  kill`**. Always-hold benchmark +4.58 %, also under the bar.

## The six facts worth carrying forward

1. **The `1/mmr` identity is real and it is exact.** Proven algebraically and
   asserted on 86,400 real position-hours: `|coin·P_t/N − 1| ≤ 9.99e−16`,
   `|margin/maint − 1/mmr| ≤ 2.27e−13`, through a 1.93× price excursion.
   Margin ratio 250× (BTC) / 200× (ETH), constant at every price. **A 1:1
   coin-collateralised inverse short cannot be liquidated, on either side.**
   The hedge held through ETH 3,209 → 1,860 on the holdout with a basis
   residual of +0.03 USD on a 50 USD slot. If anyone in this project ever
   needs a USD-hedged coin position again, this is the structure and
   `MECHANIC-PROOF.md` is the proof.
2. **The account type was worth exactly 1.43×, as pre-registered, and no
   more.** `C = 1.05 N` instead of `1.5 N`. The pass's +7.89 % × 1.43 =
   +11.3 %, measured +10.99 %. **The largest unexplored number in the
   hedged-carry pass has now been read on the correct account model, out of
   sample, with the floors met by construction.** It is not a build.
3. **+28.40 % was never the target, and its honest form is worse than it
   looks.** On COIN-M the notional is fixed, so no compounding occurs. The
   un-re-centred PM/Multi-Assets row that *does* compound returns **+70.6 %**
   on fit at the published 95 % haircut — because the short notional grows
   **6.5× (BTC) / 12.7× (ETH)** over four years. That is a carry trade whose
   **leverage drifts to 6–12× without the operator choosing it**, and it is
   **liquidated outright at a 60 % collateral ratio**, a number Binance moves
   by announcement. Descriptive, fit-only, never tested out of sample.
4. **COIN-M funding is a separate and cheaper market than USD-M.** Over
   2020-08 → 2024-07: **11.75 % vs 14.55 %** p.a. of notional on BTC and
   **11.65 % vs 16.39 %** on ETH, negative on 17–20 % of settlements against
   USD-M's 11–12 %, correlation 0.81. Over the holdout the two are
   indistinguishable at ≈ 5 %. **Never substitute one tape for the other.**
5. **"The gate costs money" now fires on two tapes and two account models, on
   fit and on holdout** (+7.12 vs +10.99 on fit; +0.73 vs +4.79 on holdout) —
   while the gate remains a genuine carry **timer** (`p_A = 0.000`, observed
   +7.12 % against a null mean of +1.70 %). On an account where being on costs
   one 0.19 % round trip in four years, abstention has no value. **A funding
   gate is a risk overlay, not an alpha source. This is settled.**
6. **The premium is a calendar.** Arm A by year: 2020 +14.6, 2021 +22.0,
   **2022 +0.2**, 2023 +6.8, 2024 +12.0, **2025 +4.5, 2026 +2.5**. The same
   shape as the USD-M perp carry, the quarterly basis and the 515-symbol
   duty-cycle panel. **Three instruments, three account structures, one
   calendar.**

## What NOT to do next

- **Do not look for a fourth account structure.** There isn't one. Isolated
  USD-M (dead, `hedged-carry`), Multi-Assets / Portfolio Margin (descriptive
  here, and it is a drifting-leverage bet on a collateral ratio), COIN-M
  inverse (dead here). The account-type question is **answered and closed**.
- **Do not re-cut the split, loosen a floor, or argue the 0.21 points.** Arm A
  missed the kill bar by 0.21 and the build bar by 5.21 at an SE of 0.59. The
  CI upper bound of +5.85 is not a reason to relabel; it is a reason to note,
  as `REPORT.md` §5 does, that the *build* verdict is 8.9 σ away and nothing
  is close to it.
- **Do not promote the unswept variant** (+21.27 % on fit). It is a long
  BTC/ETH position accumulated out of carry proceeds through the largest rally
  in the sample. The sweep was pinned before any number precisely so this
  could be sized rather than claimed.
- **Do not reopen the alt tier.** It has no COIN-M quarterlies after 2025-09,
  is not Multi-Assets collateral, and its PM collateral rates were not read
  (the user's read-only API key was not available this pass — `REPORT.md`
  §7(7)). Even if all six came back ≥ 80 %, the only structure that would hold
  them is the drifting-leverage one in fact 3.
- **Do not register a wider universe or a duty-cycle variant.** Запись 33 §3
  closed that on 515 symbols; this pass's year table is the fourth independent
  confirmation of the same calendar.

## What a successor could legitimately ask

**Nothing on the carry line.** The Architect's own framing was that this is the
third and last carry registration because there is no fourth account structure
to ask about; it has now been run and the answer is a clean kill with the
floors met. The backlog items the note named as waiting behind it —
time-of-day carry (logged, not registered), macro-event reaction (logged), the
pivot-structure engine (needs Architect decisions), and **the cross-sectional
reversal family the power-correction note named as the natural home for
multi-day crypto** — are unblocked and none of them is a carry question.

One methodological item is worth an Architect's attention, and it is not a
registration: **this family's daily variance is a function of the funding
regime, so no √n scaling connects an SE measured on one window to another.**
The registration's projected holdout SE was 0.45 % p.a., the fit-measured one
was 1.40 %, the projection from fit was 1.97 %, and the actual holdout was
0.588 %. What saved the design was that its floors are **counts**, not
variances, and an always-on arm meets them by construction. Future power
statements in regime-driven families should say so.

## Artefacts

`DESIGN.md` (pre-registration; §11 Stage 0, §12 measured power + the screen),
`MECHANIC-PROOF.md` (the `1/mmr` identity, 20 positions, the ledger),
`REPORT.md`, `results/` — `exchange_facts.json`, `stage0.json`,
`data_audit.csv`, `data_audit_anomalies.csv`, **`funding_cm_vs_um.csv`**,
`mmr_identity.csv`, `mechanic_mmr.csv`, `mechanic_ledger.csv`,
`harness_h3.csv`, `fit_arms.csv`, `fit_positions.csv`, `fit_buffer.csv`,
`fit_bstar.csv`, `fit_persistence.csv`, `fit_sensitivities.csv`,
`fit_nulls.csv`, `fit_pm_sensitivity.csv`, `fit_pm_detail.csv`,
`armb_trades.csv`, `by_year.csv`, `screen.json`, `holdout_arms.csv`,
`holdout_positions.csv`, `holdout_armb_trades.csv`, `HOLDOUT_READ.lock`,
`fetch_log.csv`. Code: `fetch_data.py`, `fetch_exchange_facts.py`,
`data_audit.py`, `common.py`, `engine.py`, `portfolio.py`, `armb.py`,
`harness.py`, `checks.py`, `mechanic_proof.py`, `stage1_fit.py`,
`stage1_pm.py`, `stage2_holdout.py`. Data is gitignored; `fetch_data.py`
reproduces it.
