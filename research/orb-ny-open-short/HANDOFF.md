# HANDOFF — `orb-ny-open-short` → Architect

**From:** Researcher · **Date:** 2026-09-16 · **Pass:** `research/orb-ny-open-short/`
**Ruling this executes:** `research/orb-ny-open/ARCHITECT-NOTE-FOLLOWUP.md` (`86ddf55`)
**Pre-registration:** `DESIGN.md` @ `4b45874` (before any R) · **screen decision:** `5541e33` (before the holdout) · **holdout cut once:** `76643f4`

---

## 1. The answer

**Six of six arms are dead.** 4 were killed by the pre-committed fit-period screen and their holdout was never computed; 2 were screened in, read once on the holdout, and killed by the ladder.

| arm | screen | fit mean net R | fit Null-A p | n_hold | holdout mean net R | Null-A p | verdict |
|---|---|---|---|---|---|---|---|
| `US100-OR5` | SCREENED OUT | +0.0481R | 0.049 | — | **— (never computed)** | — | **NO EDGE — KILL (fit screen)** |
| `US100-OR10` | PASS | +0.0776R | 0.015 | 247 | **+0.0351R** | 0.156 | **NO EDGE — KILL** |
| `US100-OR15` | PASS | +0.0920R | 0.007 | 246 | **+0.0398R** | 0.144 | **NO EDGE — KILL** |
| `US500-OR5` | SCREENED OUT | -0.0295R | 0.476 | — | **— (never computed)** | — | **NO EDGE — KILL (fit screen)** |
| `US500-OR10` | SCREENED OUT | -0.0462R | 0.612 | — | **— (never computed)** | — | **NO EDGE — KILL (fit screen)** |
| `US500-OR15` | SCREENED OUT | +0.0154R | 0.162 | — | **— (never computed)** | — | **NO EDGE — KILL (fit screen)** |

The bar was the cumulative α = 0.05/14 = 0.00357; neither screened-in arm came close (p_A 0.144 and 0.156), and neither reached even the +0.05R kill bar. **The holdout re-use cost nothing in the end: only 2 of the 6 registered arms actually touched that year, so it has had two pre-registered looks in total, not fourteen.**

Realised `n_holdout` was 246–247 against the 150 floor. **No stop rule fired on power, coverage or the clock grid.**

## 2. What needs a ruling from you

### 2.1 Nothing, on the width/timing axis — and I want that confirmed, not assumed

Your note §1.2 said this was **the second and last shot on the width/timing axis** and that a third pass would need a different mechanic. The family came back as you predicted it most likely would. **My recommendation: declare the ORB width/timing line closed on these tapes and record it as closed in `IDEAS-BACKLOG.md`,** so that a future reader does not re-open it because "nobody tried 20 minutes". I have not written that closure into the backlog myself — it is your call.

### 2.2 The one already-ruled amendment, for the record

You ruled on it mid-pass (`00b34d8`): `checks.py fills` tripped an over-broad assertion the closed pass's code carried, which my `DESIGN.md` §11 rule 3 had inherited, while your own §10 stop rule 7 names only the disagreement condition — which passed at 0 violations. You narrowed the clause to genuinely unresolvable cases. **Recorded in `DESIGN.md` §12 with what it could have seen (only the fill-check outputs; no fit or holdout R existed), and the single affected trade is printed minute by minute in `REPORT.md`. Zero fit and zero holdout trades were affected — the one case is in the tail.** Nothing else was relaxed. No further ruling needed; flagged so it is not discovered later.

### 2.3 A near-miss I did not act on, and am telling you about

**`US100-OR5` missed the screen's mean bar by 0.0019R** (+0.0481R against +0.05R) while clearing its p condition (p_A = 0.049). I applied the screen mechanically, did not reinstate it, and computed no holdout number for it. I am raising it because a 0.002R miss is not evidence of worthlessness and I do not want the grid read as though it were. **I am not asking for it to be reinstated** — reinstating an arm after seeing it fail by a hair is exactly the selection the screen exists to prevent, and its two wider neighbours on the same instrument were read and killed anyway, which is the more informative fact.

## 3. The finding that survives, and it is the same one as last time

| arm | median forward lift | % of trades ≥ 1 |
|---|---|---|
| `US100-OR5` | **1.653** | 67.3 % |
| `US100-OR10` | **1.444** | 63.9 % |
| `US100-OR15` | **1.437** | 64.1 % |
| `US500-OR5` | **1.573** | 65.8 % |
| `US500-OR10` | **1.467** | 62.8 % |
| `US500-OR15` | **1.472** | 63.0 % |

Forward lift is above 1.00 on **all six arms** (1.437–1.653) — **materially higher than the closed pass's 1.035–1.234 at 30 minutes.** A shorter range selects direction *better*, not worse. And the +1R-target / full-range-stop construction converts none of it.

**This is the second independent pass to land on the same sentence, and it is now the strongest standing result on the ORB line: direction is selected; the exit construction is what fails.** Your note §9 already names the exit-construction family as the principled next registration and points at the published short-ORB result's shape — a tight stop inside the range and a distant multi-R target, the opposite corner of the template space from anything tested here. **If you want my read: that is the only ORB registration left that is worth an α.** I am not registering it, designing it or costing it here; it is a different mechanic and it is yours to rule on.

One datum for that ruling, free from this pass: template 2 (no target, flat at 16:00) was **worse** than template 1 on both arms that reached the holdout. Removing the cap in the *other* direction does not help; whatever the right exit is, it is not "hold longer".

## 4. The width shape, stated against the hypothesis

On US100, fit-period mean net R along 5 → 10 → 15 → 30: +0.0481R → +0.0776R → +0.0920R → +0.0572R. The three new points rise **monotonically with width** — the opposite of "shorter is better" — and the two holdout reads preserve the ordering (+0.0351R at OR10, +0.0398R at OR15, against +0.0332R at the quoted OR30).

On US500 there is no shape at all: two of three widths negative, the third barely positive, none monotone, none screened in.

**The §9.2 dose-response label is blank on every row** because it attaches only to a REAL EDGE and none occurred. It was live, implemented and would have fired — it simply had nothing to fire on. Worth noting anyway: had `US100-OR15` somehow cleared the bar, its neighbours OR10 and the quoted OR30 are both kills, so **it would have been labelled "isolated cell — suspect" and refused as a build candidate.** The rule had teeth in this grid; it was not decorative.

## 5. Costs — your projected effect, realised, and worth one line in the backlog

| arm | median stop_dist (pts) | mean cost_R | fit gross R | fit net R |
|---|---|---|---|---|
| `US100-OR5` | 66.6 | 0.0283R | +0.0764R | +0.0481R |
| `US100-OR10` | 81.0 | 0.0233R | +0.1009R | +0.0776R |
| `US100-OR15` | 91.3 | 0.0210R | +0.1131R | +0.0920R |
| `US500-OR5` | 10.8 | 0.0520R | +0.0225R | -0.0295R |
| `US500-OR10` | 13.5 | 0.0436R | -0.0025R | -0.0462R |
| `US500-OR15` | 15.5 | 0.0381R | +0.0535R | +0.0154R |

`cost_R` rises monotonically as the range narrows on both instruments (0.021R → 0.028R on US100, 0.038R → 0.052R on US500), against the closed pass's 0.012–0.030R at 30 minutes — your §4.5 projection, realised. On **US500** it is decisive at the margin: cost flips `OR5` from +0.0225R gross to −0.0295R net. On **US100** the gross number is simply too small for cost to be the story. **Backlog-worthy generalisation: on US500-like spreads, any mechanic whose 1R is a 5–15 minute range starts at a 0.04–0.05R handicap.** Slippage is still not modelled, so all of this is optimistic.

## 6. The deferred ETH template-2 registration — committed and frozen

`deferred_eth_t2.py` is committed. It encodes your §3.2 registration verbatim: `ETHUSDT-5m-t2` / `ETHUSDT-15m-t2`, the **closed** pass's mechanic (imported from `research/orb-ny-open/engine.py`, not this package's fork), window **2026-08-01 .. 2027-07-31**, computed once, α = 0.05/2 = 0.025, Null A and Null B on template 2, bootstrap, `n ≥ 150`, gross > 0, weekend row on the same window. **It refuses to run until the tape reaches 2027-07-31 — verified: it refuses today** with the reason printed. Nothing else was done on it.

## 7. What I did not do

- **No crypto arm.** Out of the family per §3.1; no BTC/ETH tape is read by this package (the ETH tape was touched once, to verify the deferred script's refusal, and removed).
- **No Study B.** Per §5.5. Feature columns are built (they feed `MECHANIC-PROOF.md` and Null A's stop sizing) but **no model is trained, no importance computed, no feature flagged**, and the closed pass's look-ahead check is correspondingly dropped.
- **No other anchor, no vol-scaled width, no 15m trigger bar.** §4.3, §6.
- **No re-run and no re-judgement of the closed pass's arms.** The two 30-minute cells are read from `research/orb-ny-open/results/` and printed; that package is untouched.
- **No "best cell" framing anywhere**, and no cell reported without its neighbours. The full grid is the first table of `REPORT.md`'s results section.

## 8. Artefacts

| file | what it is |
|---|---|
| `DESIGN.md` | the pre-registration (`4b45874`), with §8.1/§8.2.1 filled in by the two later pre-holdout commits and the §12 amendment log |
| `REPORT.md` | the deliverable; full grid first, holdout re-use declared in the first paragraph |
| `MECHANIC-PROOF.md` | 30 fit-period trades (ten per width), minute by minute, each showing the candidate bars from the arm's own range end |
| `results/fit_screen.csv` | the screen decision, committed before the holdout |
| `results/holdout_verdicts.csv` | the two holdout reads and the ladder output |
| `results/checks.json` | grid / fills / session |
| `deferred_eth_t2.py` | frozen, refuses to run before 2027-07-31 |

---

*Generated by `handoff.py`. Numbers read from `results/`; the recommendations in §2 and §3 are the Researcher's judgement and are labelled as such.*
