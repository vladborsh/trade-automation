# REPORT — Short opening-range breakout at the New York open (`orb-ny-open-short`)

**This family re-uses the 2025-08-01 .. 2026-07-31 holdout, which was read once already by the closed `orb-ny-open` pass on the same instruments and days. It is the second pre-registered look at that year. The α below is corrected for both looks — α = 0.05 / 14 = 0.00357, the 8 arms of the closed pass plus the 6 arms here. A REAL EDGE reached here would be weaker evidence than a first-read REAL EDGE and any build ruling would say so.** No REAL EDGE was reached: **all six arms are dead.**

**Pre-registration:** `DESIGN.md`, committed at `4b45874` **before any R was computed on any arm**; binding ruling `research/orb-ny-open/ARCHITECT-NOTE-FOLLOWUP.md` (`86ddf55`). The fit-period screen that decided which arms were allowed to touch the holdout was committed at `5541e33`, **before the holdout was cut**. The holdout was then cut **once**.

Because 4 of the 6 arms failed the fit-period screen, **the holdout was read for only 2 of them**. The 2025-08-01 .. 2026-07-31 year has therefore received **two** pre-registered looks in total — the closed pass's eight arms, and these 2 — not fourteen. The α is corrected for fourteen anyway, because the correction is fixed by how many arms were *registered*, not by how many happened to be computed; the note's rule is to tighten, never loosen.

## Results

### The full grid — all six arms, plus the two quoted 30-minute cells

Every cell of the registered family, with its neighbours. **The four screened-out arms carry a blank holdout column: their holdout was never computed, and the blank is the point.** The `OR30` rows are the closed pass's `US100-5m` / `US500-5m` arms, **quoted from `research/orb-ny-open/results/holdout_verdicts.csv`, neither re-run nor re-judged** — they are the fourth point of each instrument's width series.

| instrument | OR width | arm | screen | n_fit | fit mean net R | fit Null-A p | n_hold | **holdout mean net R** | Null-A p | 90 % day-block bootstrap | **verdict** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| US100 | 5 min | `US100-OR5` | SCREENED OUT | 391 | +0.0481R | 0.049 | — | **—** | — | — | **NO EDGE — KILL (fit screen)** |
| US100 | 10 min | `US100-OR10` | PASS | 391 | +0.0776R | 0.015 | 247 | **+0.0351R** | 0.156 | [-0.067, +0.134] | **NO EDGE — KILL** |
| US100 | 15 min | `US100-OR15` | PASS | 387 | +0.0920R | 0.007 | 246 | **+0.0398R** | 0.144 | [-0.057, +0.131] | **NO EDGE — KILL** |
| US100 | 30 min *(quoted)* | `US100-5m` | *n/a — closed pass* | 370 | +0.0572R | — | 222 | **+0.0332R** | 0.168 | [-0.056, +0.117] | **NO EDGE — KILL** *(closed pass)* |
| US500 | 5 min | `US500-OR5` | SCREENED OUT | 392 | -0.0295R | 0.476 | — | **—** | — | — | **NO EDGE — KILL (fit screen)** |
| US500 | 10 min | `US500-OR10` | SCREENED OUT | 392 | -0.0462R | 0.612 | — | **—** | — | — | **NO EDGE — KILL (fit screen)** |
| US500 | 15 min | `US500-OR15` | SCREENED OUT | 389 | +0.0154R | 0.162 | — | **—** | — | — | **NO EDGE — KILL (fit screen)** |
| US500 | 30 min *(quoted)* | `US500-5m` | *n/a — closed pass* | 378 | -0.0438R | — | 236 | **-0.0179R** | 0.436 | [-0.108, +0.073] | **NO EDGE — KILL** *(closed pass)* |

**Six of six arms are dead** — 4 killed by the fit-period screen without the holdout ever being read for them, 2 killed on the holdout. Both quoted 30-minute cells were already kills. The ORB line on these tapes, on the width and timing axis, is closed.

Per-arm reasons, mechanically from the ladder and the screen:

- **`US100-OR5` — NO EDGE — KILL (fit screen).** fit mean net R +0.0481R < +0.05R. Its holdout was never computed.
- **`US100-OR10` — NO EDGE — KILL.** holdout mean net R +0.035R < the pre-registered +0.05R kill bar.
- **`US100-OR15` — NO EDGE — KILL.** holdout mean net R +0.040R < the pre-registered +0.05R kill bar.
- **`US500-OR5` — NO EDGE — KILL (fit screen).** fit mean net R -0.0295R < +0.05R; fit-period Null-A p = 0.476 > 0.05. Its holdout was never computed.
- **`US500-OR10` — NO EDGE — KILL (fit screen).** fit mean net R -0.0462R < +0.05R; fit-period Null-A p = 0.612 > 0.05. Its holdout was never computed.
- **`US500-OR15` — NO EDGE — KILL (fit screen).** fit mean net R +0.0154R < +0.05R; fit-period Null-A p = 0.162 > 0.05. Its holdout was never computed.

**`US100-OR5` is a near-miss, not a comfortable kill, and is labelled as one.** Its fit-period Null-A p = 0.049 clears the screen's second condition, and its fit mean net R of +0.0481R misses the +0.05R bar by 0.0019R. The screen is mechanical and was committed before the number existed, so it removes the arm; that is the whole point of fixing the rule first. It is **not** reinstated and no holdout number was computed for it. A reader should not read 'screened out' here as 'clearly worthless'.

### The width series, per instrument — the pre-committed dose-response reading

`DESIGN.md` §9.2 pre-committed this reading before any number existed: the hypothesis "shorter is better" predicts a **monotone or at least unimodal** shape along 5 → 10 → 15 → 30, and a REAL EDGE on a cell whose adjacent widths are all kills would have been labelled **"isolated cell — suspect"**, refused as a build candidate and returned to the Architect as a noise finding.

**US100** — mean net R along the width axis:

| | OR5 | OR10 | OR15 | OR30 *(quoted)* |
|---|---|---|---|---|
| **fit** | +0.0481R | +0.0776R | +0.0920R | +0.0572R |
| **holdout** | — *(screened out)* | **+0.0351R** | **+0.0398R** | **+0.0332R** |
| **verdict** | NO EDGE — KILL (fit screen) | NO EDGE — KILL | NO EDGE — KILL | NO EDGE — KILL |

**US500** — mean net R along the width axis:

| | OR5 | OR10 | OR15 | OR30 *(quoted)* |
|---|---|---|---|---|
| **fit** | -0.0295R | -0.0462R | +0.0154R | -0.0438R |
| **holdout** | — *(screened out)* | — *(screened out)* | — *(screened out)* | **-0.0179R** |
| **verdict** | NO EDGE — KILL (fit screen) | NO EDGE — KILL (fit screen) | NO EDGE — KILL (fit screen) | NO EDGE — KILL |

**What the shape says, and it is not what the family was registered to look for.** On US100 the fit-period mean net R **rises monotonically with width** across the three new points — +0.0481R (OR5) → +0.0776R (OR10) → +0.0920R (OR15) — with the quoted OR30 cell at +0.0572R, and the two holdout reads reproduce that ordering weakly (+0.0351R at OR10, +0.0398R at OR15, against +0.0332R at the quoted OR30). The hypothesis under test was that a **shorter** range works better. Within this grid the tape says the opposite across 5 → 10 → 15, weakly, on the one instrument that got as far as a holdout read — and not strongly enough anywhere to clear a bar. On US500 the fit period runs -0.0295R (OR5), -0.0462R (OR10), +0.0154R (OR15) and -0.0438R at the quoted OR30 — two of the three new widths are negative, the third (+0.0154R) is positive but far below the screen's bar, there is no monotone shape at all, and none of the three reached the holdout.

**No cell in this report is presented without its neighbours, and there is no 'best cell' reading anywhere in this deliverable.** The grid exists to read a shape; the shape it shows is flat-to-adverse.

The dose-response label is **blank on every row** for the simple reason that it attaches only to a REAL EDGE, and no arm reached one.

### The nulls, on the arms that reached the holdout

Null A (the gate) is the matched-time placebo: 1,000 draws, each replacing every real trade with a random 5m bar drawn from **that arm's own** trigger window (09:40 / 09:45 NY to 12:00) on a day eligible for that arm, keeping the real trade's side and its stop size in ATR14 units, walked, costed and exited by the same code. Null B is the whole-stream day shift; it is reported, not gating.

| arm | n_hold | realised mean net R | Null-A mean | **Null-A p** | Null-B mean | Null-B p | same-date residual | Null-B drop rate |
|---|---|---|---|---|---|---|---|---|
| `US100-OR10` | 247 | +0.0351R | -0.0178R | **0.156** | -0.0189R | 0.168 | 4.05e-06 | 1.62e-05 |
| `US100-OR15` | 246 | +0.0398R | -0.0158R | **0.144** | -0.0136R | 0.168 | 4.07e-06 | 3.25e-05 |

Both arms sit far above the corrected bar of 0.00357 and above the 0.20 inconclusive line, and both 90 % day-block bootstrap intervals straddle zero. The placebo means are slightly negative, so the strategy does beat a random comparable bar on average — by an amount that is not distinguishable from noise at this sample size.

### Template 2 (pure ORB) — reported, **no verdict**, straddle rule retired

Template 2 is the literal hypothesis: the breakout's direction persists to the close. It carries **no verdict** (`DESIGN.md` §3.4). **The straddle rule of the closed pass is retired for this family** — it was spent on the deferred ETH template-2 registration — so a template-2 number that clears any bar here generates **no follow-up of any kind**.

| arm | fit mean net R (t2) | holdout mean net R (t2) | holdout t1 (the gate) |
|---|---|---|---|
| `US100-OR5` | +0.1220R | — *(screened out)* | — |
| `US100-OR10` | +0.1100R | +0.0019R | +0.0351R |
| `US100-OR15` | +0.0779R | -0.0021R | +0.0398R |
| `US500-OR5` | -0.0489R | — *(screened out)* | — |
| `US500-OR10` | -0.0344R | — *(screened out)* | — |
| `US500-OR15` | +0.0167R | — *(screened out)* | — |

Nothing on template 2 reaches the +0.10R build bar on any holdout read, and on the two arms that were read it is **worse** than template 1 (essentially zero). The +1R cap is not what is unmaking these numbers.

## Costs — the section this family exists to make honest

**With the stop at the far side of a 5-, 10- or 15-minute range, `stop_dist` is several times smaller than in the closed pass, so `cost_R` is several times larger** than the 0.012–0.030R seen there. **The narrower the range, the more of any gross edge the spread eats; this family is the one where costs can start to matter.**

| arm | median stop_dist (pts) | mean `cost_R` | median `cost_R` | p90 `cost_R` | fit gross R | fit net R | gross→net gap |
|---|---|---|---|---|---|---|---|
| `US100-OR5` | 66.6 | 0.0283R | 0.0267R | 0.0431R | +0.0764R | +0.0481R | 0.0283R |
| `US100-OR10` | 81.0 | 0.0233R | 0.0222R | 0.0364R | +0.1009R | +0.0776R | 0.0233R |
| `US100-OR15` | 91.3 | 0.0210R | 0.0197R | 0.0330R | +0.1131R | +0.0920R | 0.0210R |
| `US500-OR5` | 10.8 | 0.0520R | 0.0410R | 0.0999R | +0.0225R | -0.0295R | 0.0520R |
| `US500-OR10` | 13.5 | 0.0436R | 0.0358R | 0.0795R | -0.0025R | -0.0462R | 0.0436R |
| `US500-OR15` | 15.5 | 0.0381R | 0.0312R | 0.0737R | +0.0535R | +0.0154R | 0.0381R |

The cost gradient is exactly as the Architect's note projected: it rises monotonically as the range narrows on **both** instruments, and it is roughly 1.8× as large on US500 as on US100 at the same width (US500's spread is a larger fraction of a much smaller point-value range). It is still far below the `cmc-bot` pass's 0.25–0.40R.

**US500 is the instrument where this matters, and it is worth being precise about it.** Its fit-period **gross** expectancy is +0.0225R (OR5), -0.0025R (OR10), +0.0535R (OR15) — positive at two of the three widths — while its **net** expectancy is -0.0295R (OR5), -0.0462R (OR10), +0.0154R (OR15). The cost flips the sign outright at **OR5** (+0.0225R gross becomes −0.0295R net), and at **OR15** it eats roughly seven tenths of a small positive gross number (+0.0535R → +0.0154R); at OR10 the gross number was already negative and cost merely deepens it. That is the note's projected effect, realised. It does not rescue the arms — a gross expectancy of +0.0535R at best is nowhere near the +0.10R build bar even at zero cost, and these three arms failed the screen on their Null-A p as well — but 'costs ate it' is the honest description on US500, where on US100 the gross number is simply too small to matter.

Cost sensitivities on the holdout (non-gating):

| arm | base | 2x per-bar spread | fixed fit-median spread |
|---|---|---|---|
| `US100-OR10` | +0.0351R | +0.0192R | +0.0348R |
| `US100-OR15` | +0.0398R | +0.0253R | +0.0398R |

Doubling the spread costs roughly 0.015R and moves neither verdict; neither would any plausible cost model. **Slippage is not modelled anywhere, so every number in this report is optimistic.** No commission is modelled on these Capital.com index CFDs and no financing on any arm (every trade is flat by 16:00 NY).

## Descriptive rows — none of these can move a verdict

### Trigger share and exclusions (fit period, recorded before the screen)

| arm | trigger opens | eligible days | triggered | share | projected n_hold | median lag from range end | p90 lag |
|---|---|---|---|---|---|---|---|
| `US100-OR5` | 09:35 | 392 | 391 | 0.997 | 247.4 | 5 min | 20 min |
| `US100-OR10` | 09:40 | 392 | 391 | 0.997 | 247.4 | 5 min | 30 min |
| `US100-OR15` | 09:45 | 392 | 387 | 0.987 | 244.8 | 5 min | 35 min |
| `US500-OR5` | 09:35 | 392 | 392 | 1.000 | 249.0 | 5 min | 25 min |
| `US500-OR10` | 09:40 | 392 | 392 | 1.000 | 249.0 | 5 min | 30 min |
| `US500-OR15` | 09:45 | 392 | 389 | 0.992 | 247.1 | 10 min | 40 min |

The trigger share approaches 100 % on every arm and the trigger lands a median of 5–10 minutes after the range's end, which is what makes the 12:00 NY cutoff inert for this family and is why the closed pass's power contingency was retired. Realised `n_holdout` was 246–247 against the floor of 150; no power stop rule came close to firing.

### Exit causes (fit period)

| arm | n | target | stop | time-exit | t2 stop | t2 time-exit |
|---|---|---|---|---|---|---|
| `US100-OR5` | 391 | 204 | 176 | 11 | 241 | 150 |
| `US100-OR10` | 391 | 199 | 159 | 33 | 205 | 186 |
| `US100-OR15` | 387 | 186 | 144 | 57 | 180 | 207 |
| `US500-OR5` | 392 | 198 | 189 | 5 | 271 | 121 |
| `US500-OR10` | 392 | 190 | 191 | 11 | 240 | 152 |
| `US500-OR15` | 389 | 192 | 171 | 26 | 210 | 179 |

The time-exit share rises with the width (the wider the range, the longer +1R takes to reach), which is the mechanical signature of the width axis working as intended.

### Long / short split (fit period, template 1)

| arm | side | n | mean net R | win rate |
|---|---|---|---|---|
| `US100-OR5` | long | 189 | +0.0661R | 54.5 % |
| `US100-OR5` | short | 202 | +0.0312R | 53.0 % |
| `US100-OR10` | long | 185 | +0.1393R | 58.4 % |
| `US100-OR10` | short | 206 | +0.0222R | 51.9 % |
| `US100-OR15` | long | 190 | +0.1581R | 59.5 % |
| `US100-OR15` | short | 197 | +0.0283R | 52.3 % |
| `US500-OR5` | long | 200 | -0.0760R | 49.0 % |
| `US500-OR5` | short | 192 | +0.0189R | 53.6 % |
| `US500-OR10` | long | 191 | -0.0298R | 51.3 % |
| `US500-OR10` | short | 201 | -0.0618R | 49.8 % |
| `US500-OR15` | long | 193 | +0.0187R | 53.9 % |
| `US500-OR15` | short | 196 | +0.0120R | 52.6 % |

### Forward lift — the one positive signal, and it is unchanged

The non-circular forward lift is the median ratio of the trade's maximum favourable excursion, in ATR14, to the median MFE of a horizon-matched, side-matched comparison drawn from the arm's own trigger window. **1.00 means "no better than a random comparable bar".**

| arm | n | median lift | % of trades with lift ≥ 1 | reference pool n |
|---|---|---|---|---|
| `US100-OR5` | 391 | **1.653** | 67.3 % | 19397 |
| `US100-OR10` | 391 | **1.444** | 63.9 % | 18728 |
| `US100-OR15` | 387 | **1.437** | 64.1 % | 18059 |
| `US500-OR5` | 392 | **1.573** | 65.8 % | 19405 |
| `US500-OR10` | 392 | **1.467** | 62.8 % | 18735 |
| `US500-OR15` | 389 | **1.472** | 63.0 % | 18065 |

Lift is above 1.00 on **all six arms** (1.437–1.653), and materially higher than the closed pass's 1.035–1.234 at 30 minutes. **After a close beyond a short opening range the tape does move further in the breakout's direction than a random comparable bar does — and the +1R-target / full-range-stop construction still fails to convert it into money.** This is the same finding the closed pass reported, now stronger on the measurement and just as dead on the money. It is a statement about what happens *after* the trigger, which is why the Architect's note points at an **exit construction** as the next principled registration and not at another minute count.

### Fit-period sensitivities — every one shown, including the worse ones

Non-gating and descriptive. None of these can create, upgrade or downgrade a verdict.

**S3' stop at OR midpoint**

| arm | n | mean net R (t1) | pre-registered fit net R | mean net R (t2) | mean cost_R | win rate |
|---|---|---|---|---|---|---|
| `US100-OR5` | 391 | -0.0285R | +0.0481R | +0.0930R | 0.0476R | 50.9 % |
| `US100-OR10` | 391 | +0.0015R | +0.0776R | +0.1189R | 0.0406R | 52.2 % |
| `US100-OR15` | 387 | +0.0426R | +0.0920R | +0.1368R | 0.0372R | 53.7 % |
| `US500-OR5` | 392 | -0.0659R | -0.0295R | -0.0798R | 0.0883R | 51.3 % |
| `US500-OR10` | 392 | -0.0464R | -0.0462R | +0.0018R | 0.0752R | 51.5 % |
| `US500-OR15` | 389 | +0.0038R | +0.0154R | +0.0650R | 0.0655R | 53.5 % |

**S4' re-entry once after a stop**

| arm | n | mean net R (t1) | pre-registered fit net R | mean net R (t2) | mean cost_R | win rate |
|---|---|---|---|---|---|---|
| `US100-OR5` | 730 | +0.0192R | +0.0481R | +0.0712R | 0.0253R | 52.6 % |
| `US100-OR10` | 659 | +0.0497R | +0.0776R | +0.0803R | 0.0211R | 54.5 % |
| `US100-OR15` | 599 | +0.0440R | +0.0920R | +0.0510R | 0.0193R | 53.9 % |
| `US500-OR5` | 749 | -0.0393R | -0.0295R | +0.0275R | 0.0454R | 50.1 % |
| `US500-OR10` | 699 | -0.0362R | -0.0462R | -0.0019R | 0.0389R | 49.9 % |
| `US500-OR15` | 657 | -0.0152R | +0.0154R | +0.0097R | 0.0345R | 50.1 % |

**S5 trigger window ends 11:00 NY**

| arm | n | mean net R (t1) | pre-registered fit net R | mean net R (t2) | mean cost_R | win rate |
|---|---|---|---|---|---|---|
| `US100-OR5` | 390 | +0.0509R | +0.0481R | +0.1250R | 0.0283R | 53.8 % |
| `US100-OR10` | 386 | +0.0815R | +0.0776R | +0.1183R | 0.0233R | 55.2 % |
| `US100-OR15` | 376 | +0.0918R | +0.0920R | +0.0735R | 0.0211R | 55.6 % |
| `US500-OR5` | 391 | -0.0300R | -0.0295R | -0.0493R | 0.0521R | 51.2 % |
| `US500-OR10` | 387 | -0.0457R | -0.0462R | -0.0333R | 0.0439R | 50.4 % |
| `US500-OR15` | 377 | +0.0162R | +0.0154R | +0.0113R | 0.0384R | 53.3 % |

S3' (stop at the OR midpoint) is **worse than the pre-registered stop on every one of the six arms**. S4' (re-entry) is worse on five of six. S5 (11:00 NY cutoff) is marginally better on most arms, which is the expected consequence of dropping the late, weak triggers — it is a descriptive row, it was never a gate, and it changes no verdict. None of the three moves any arm to the +0.10R build bar.

## Stop-rule checks

- **Grid check — pass.** 670 session days, **0 violations**. The clock points asserted on the 5-minute epoch grid are `09:30`, `12:00`, `11:00`, `16:00`, `09:35`, `09:40`, `09:45`, under both UTC offsets of 09:30 NY seen in span ([13, 14]). The three new points 09:35 / 09:40 / 09:45 are the ones this family needed and they hold on every day.
- **Fill check — pass.** On the 3980 trades that neither gap the stop nor touch both levels inside a single bar, the 1m-path fill and the bar-OHLC fill agree to `max_absdiff = 0.0`, with **0 violations** on any arm.
- **Session check — pass.** 0 trades cross 16:00 NY, on either template, on any arm.
- **The look-ahead check is dropped**, per the follow-up note §7: it existed to protect Study B's feature matrix, and there is no Study B here. No feature reaches any verdict in this family.

### The one excluded-fill case, recorded in full (Architect ruling, `00b34d8`)

`checks.py fills` initially reported a failure. It was **not** the pre-registered §3.5 condition — that passed with 0 violations and `max_absdiff` 0.0 — but an over-broad extra assertion the closed pass's code carried ('the 1m path may never be kinder than the bar fill on an excluded trade'), which `DESIGN.md` §11 rule 3 had inherited while the Architect's own stop rule names only the disagreement condition. It was escalated under §11 rule 6 rather than decided locally; the Architect narrowed the clause to genuinely unresolvable cases and relaxed nothing else (`DESIGN.md` §12).

**Trips of the old, unnarrowed clause by period, over all 4,002 trades: fit 0 of 2,342; holdout 0 of 1,487; tail 1 of 173.** Zero fit-period and zero holdout-period trades are affected. The single case, in full:

`US500-OR5`, **2026-08-28**, TAIL period (descriptive only — it feeds no screen, no null and no ladder). Long, entry `7741`, stop `7733.5`, target `7748.5`, `1R = 7.5` points.

The 5-minute bar that spans **both** levels, and the 1-minute bars that resolve the order:

| bar | open | high | low | close | touches |
|---|---|---|---|---|---|
| **5m 10:00** | 7740.55 | 7749.4 | 7730.9 | 7735.7 | **target (7749.4 ≥ 7748.5) and stop (7730.9 ≤ 7733.5)** |
| 1m 10:00 | 7740.55 | 7749.4 | 7739.6 | 7746.15 | **target** |
| 1m 10:01 | 7746.9 | 7746.9 | 7738.2 | 7738.4 | — |
| 1m 10:02 | 7739.45 | 7740.55 | 7735.7 | 7739.2 | — |
| 1m 10:03 | 7738.65 | 7739.2 | 7734.7 | 7735.7 | — |
| 1m 10:04 | 7732.7 | 7735.7 | 7730.9 | 7735.7 | **stop** |

The 5m bar touches both levels, so the bar-OHLC convention takes the **stop** first — it is deliberately pessimistic and cannot know the order. The 1-minute tape resolves it unambiguously: the 10:00 minute takes the **target**; the stop is not touched until 10:04. The 1m fill is 'kinder' here **because the coarse convention is pessimistic, not because the result is being flattered** — and resolving exactly this order is what the 1-minute path exists for. This class of trade is near-absent at a 30-minute range and appears here only because 1R is several times tighter; it is a consequence of the width axis, by construction.

## What this closes, and what it does not

**Closed.** The ORB mechanic on these tapes, on the **width and timing axis**, for US100 and US500. Four widths (5, 10, 15, 30), a trigger that starts at the range's own end, two instruments, a pre-registered screen and a cumulative-α holdout read: **six of six new arms dead, on top of the closed pass's eight.** Per the Architect's note §1.2 this was the **second and last shot on the width/timing axis**. A third pass on a different minute count is not warranted and is not requested.

**A bug in the closed pass is also closed.** Its 15-minute width sensitivity (S1) was never a 15-minute ORB — `find_trigger` kept the first trigger bar at 10:00 NY regardless of width, so S1 measured a 15-minute range with a 15-minute dead zone after it. This family ran the real thing, triggering from 09:45, and S1's fit-period hint on US100 does not survive into a verdict.

**Not closed, and pointed at explicitly.** The **exit construction**. Forward lift is above 1.00 on all six arms here (1.437–1.653) and was above 1.00 on all eight arms of the closed pass. Direction is selected; the +1R-target / full-range-stop template is what fails to convert it. The published short-ORB result this family's 5-minute arm was modelled on pairs its 5-minute range with a stop far *tighter* than the range and a distant multi-R target — the opposite corner of the template space from anything this project has tested. That is the Architect's named next registration if one is wanted, and it is a **different mechanic**, not another width.

**Explicitly out of scope here and unchanged:** crypto (removed by the note §3.1 on fit-side and prior evidence), other session anchors (London, 08:30 ET, UTC midnight — each a different hypothesis needing its own registration), volatility-scaled range widths (note §6.2), and 15m trigger bars (note §4.3).

**The deferred ETH template-2 registration** (`deferred_eth_t2.py`) is committed and frozen. It refuses to run before the tape reaches 2027-07-31 and nothing was done on it in this pass.

---

*Generated by `report.py` from the CSVs in `results/`. Every number above is read from a committed table; nothing is retyped by hand. The two 30-minute cells are read from `research/orb-ny-open/results/` and were not recomputed.*
