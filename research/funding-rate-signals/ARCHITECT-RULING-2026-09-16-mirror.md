# Architect ruling — the mirror of hypothesis B (funding-rate-signals)

**Date:** 2026-09-16 · **Trigger:** red-team survey §5.4 (`research/_surveys/2026-09-red-team.md`, commit 0fad533) · **Binding on:** `research/funding-rate-signals/` (ARCHITECT-NOTE 61a2058, DESIGN.md af89ea7 → 31a9c0e) · **Status:** binding amendment to the registration; supersedes note §7.4 and DESIGN §9 on α.

## 0. Ruling in one paragraph

**Option (A), amended: add the mirror of B as two new arms of the same family, `Bm_majors` and `Bm_alts`, and finish the pass as one family of six arms at α = 0.05/6 = 0.00833.** The red team wrote "fifth arm, α = 0.05/5"; that count is wrong for this design, because B is registered per tier, so its mirror is per tier too. Six arms, one α, applied uniformly to A and B as well (tightening α after fit has been seen can only make a pass harder, so it is admissible). B stays registered and reported; nothing about A or B is recomputed or reworded. Options (B) and (C) are rejected in §3.

## 1. State of knowledge at the moment of this ruling (must be reproduced verbatim in DESIGN.md and REPORT.md)

The dispatch text described the Researcher as "majors tier done, alts unblocked". The Researcher's branch has since moved: commit 31a9c0e (2026-09-16 14:40:08 −0700) is titled "fit-period screen decision, ALL FOUR ARMS SCREENED OUT; holdout never read". So the exact state is:

| who | what has been seen | evidence |
|---|---|---|
| Researcher | fit-period results of `A_majors`, `A_alts`, `B_majors`, `B_alts`, their shadows, incremental control, sensitivities; the §7.3 screen on all four | 09d5ef8 (14:35:47, first `results/fit_*_majors.csv`), 31a9c0e (14:40:08, `results/screen.json`) |
| Coordinator | the Researcher's status text ("majors tier done, clean of all 3 anomalies"); no numbers per the dispatch text. If the coordinator saw numbers, the Researcher's disclosure says so. | dispatch text of this ruling |
| Architect (this ruling) | **no results file, no screen file, no commit body of 31a9c0e.** Only file names on the Researcher's branch, the two Architect documents, Запись 8, the closed `deriv-positioning/REPORT.md`, and the red-team survey. | this document; the Architect's worktree `architect-mirror-gate` contains no `results/` |
| everyone | **the holdout year 2025-08-01 .. 2026-07-31 has not been read by any arm of this family.** | 31a9c0e title; DESIGN §5.4 |

**Independence of the justification.** The mirror is justified by exactly two documents, both of which predate every fit number of this family: RESEARCH-LOG Запись 8 (2026-08-26; b1 = crowd ≥ 95th pct + 12-bar adverse break: −58.4 bp at 24 h, t = −4.56, 0th percentile of its random-event null, 1,188 events) and red-team §5.4 (commit 0fad533, 14:34:51, written in the `architect-redteam` worktree with no access to the Researcher's worktree, whose first results were committed at 14:35:47). Nothing observed in this family was used to decide the registration, its side, its template, or its shadow.

**What is not blind, and is disclosed.** By construction (§4.2) the +1R price leg of the mirror is, trade for trade, the negation of B's price leg. The Researcher has seen B's fit price leg on both tiers, so the mirror's **fit-period screen is a mechanical gate, not a blind test**. This is acceptable because the §7.3 screen has no discretionary input (thresholds fixed, fallback shadow pre-committed) and because the verdict is on the holdout, which is unread. The **prior read that matters is the fit period, and it is declared**; the holdout read count of this family stays at zero until the mirror's screen decision.

## 2. Wording that goes into the Researcher's documents

**DESIGN.md — new §3.4 "Arms `Bm_majors`, `Bm_alts` — the mirror of B, registered after fit, before holdout":**

> Registered 2026-09-16 by `ARCHITECT-RULING-2026-09-16-mirror.md`, **after** the fit-period screen of the four original arms had been computed and seen by the Researcher (31a9c0e) and **before** any holdout bar was read by any arm. The registration, side, template and shadow of the mirror were fixed by an Architect who had opened no results file of this package; the sole justification is RESEARCH-LOG Запись 8 (2026-08-26) and red-team §5.4 (0fad533), both older than every number in `results/`. Because the mirror's +1R price leg is the negation of B's, its fit-period screen is a mechanical gate whose price component was foreknown; it is run and reported exactly as for the other arms. Family = six registered arms → α = 0.05/6 = 0.00833, applied to all six. Holdout reads by this family before this amendment: **0**.

**DESIGN §0 arm table:** add rows `Bm_majors` (B mirror, majors, BTC/ETH) and `Bm_alts` (B mirror, alts, six alts). Change "exactly four arms" to "exactly six arms (four registered at af89ea7, two added by the mirror ruling before any holdout read)".

**DESIGN §9 (α) and §10 ladder:** every `0.0125` becomes `0.00833`; `0.0125 < p ≤ 0.20` becomes `0.00833 < p ≤ 0.20`. `checks.py`: any assertion pinned to 4 arms or 0.0125 is updated; add the two assertions of §4.5 below.

**REPORT.md — mandatory row beside every verdict table, and its own paragraph in the summary:**

> Six arms, α = 0.05/6. Arms `Bm_*` were registered after the fit screen of `A_*`/`B_*` had been seen and before any holdout read; their fit price leg was foreknown as the negation of B's (identity check: §4.5 rows). Holdout reads by this family: [0 or 1, and by which arm]. Two-year crypto holdout convention (red-team §8 item 4) **not** applied: this family's split was cut at af89ea7 and 2024-08..2025-07 is seen fit data.

## 3. Why not (B) or (C)

**(C) replace B** — rejected. B has been computed and screened on both tiers; deleting a registered arm after its result is known is a post-hoc edit whatever the motive, and B's kill is itself informative (it closes the squeeze-entry shape on the second sensor, as pre-registered in note §2.1). Both arms stay, and the REPORT prints them as adjacent rows.

**(B) separate follow-up family** — rejected, on three grounds. (i) It does not buy blindness: the follow-up's fit price leg is still the negation of numbers already seen; the only genuinely blind data is the holdout, which is equally blind under (A). (ii) The honest family count is six either way: same tape, same events, same holdout year; splitting the mirror into its own family to get α = 0.05/2 would be family-splitting to buy α, which the project's by-registration counting rule exists to prevent. (iii) It interacts badly with red-team §8 item 4: a "next design" would by default take the two-year holdout 2024-08..2026-07, and 2024-08..2025-07 is fit data whose B price leg has been seen, so the follow-up would have to be exempted from the new convention anyway. Under (A) there is no such interaction: the two-year convention starts with the next design that is not this family.

**(A)'s residual cost** is one number: α tightens from 0.0125 to 0.00833 for all arms. Since all four original arms are already screened out on fit, this changes no verdict of theirs. For the mirror, at the power this project has (red-team §1: a one-year crypto holdout certifies roughly Sharpe ≥ 2.5 at per-arm α), the α step is not what decides the outcome.

## 4. Specification of the mirror arms (implementable without a round trip)

### 4.1 Events — identical to B, by construction

`Bm` fires on exactly the B event set: conditions 1–3 of DESIGN §3.1 verbatim (extreme-positive funding at the last settlement `k ≤ T`; `close_T/close_{T−24} − 1 > 0`; `close_T < min(low_{T−12…T−1})`), same kline-presence rule, same warm-up, same blackout and gap rules. Condition 4 (de-overlap) is applied to `Bm`'s own book: not within 12 bars of the previous `Bm` event on the symbol, no open `Bm` position on the symbol. `B` and `Bm` are independent books; because their exits fall on the same bar (§4.2), the two event sets should be identical up to the rows flagged in §4.5.

**Side:** the mirror **enters long at `close_T`** on the short-side B event (fade the breakdown into the crowded long). On the long-side B event (extreme-negative funding, `close_T/close_{T−24} − 1 < 0`, `close_T > max(high_{T−12…T−1})`) the mirror **enters short at `close_T`**. Per-side rows mandatory, as for A and B.

### 4.2 Risk unit and exits — the exact negation of B's +1R trade

The mirror is defined as **the sign-flipped B trade at the same event with the same risk unit**, not as "the b1 template reflected onto the other side". Reason, fixed a priori: this makes `Bm` the literal signed test that Запись 8 calls for (is B's price leg *significantly negative*), and it keeps 1R identical across the pair. The reflected b1 stop (`min(low_{T−12…T}) − 0.25·ATR`) sits a fraction of an ATR under the entry after a breakdown close and would define a different, much tighter trade; it is **not registered** and must not be run with a verdict.

- **Risk unit (short-side event, mirror long):** `1R ≡ max(high_{T−12…T}) + 0.25 × ATR14(T) − close_T` — B's own 1R at that event, unchanged.
- **Stop:** `close_T − 1R` (the level where B would have taken its +1R target).
- **Target (gating template):** `close_T + 1R` = `max(high_{T−12…T}) + 0.25 × ATR14(T)` — the level whose reclaim refutes the squeeze, i.e. B's stop.
- **Long-side event, mirror short:** `1R ≡ close_T − (min(low_{T−12…T}) − 0.25 × ATR14(T))`; stop `close_T + 1R`; target `close_T − 1R`.
- **Time stop:** 48 bars after entry, marked at that bar's close. Same bar as B's.
- **Same-bar ambiguity resolved as a loss** (stop checked first); gapped stop fills at the breaching bar's open. These are the only rows where `priceR_Bm ≠ −priceR_B`.
- **Secondary template, no verdict:** target `+3R` (`close_T + 3·1R` for the long), same stop, same time stop. Descriptive only; the ORB §1.5 rule applies (a template-2 number alone is grounds for one Architect-authorised follow-up, never a re-labelling). Note this template is *not* the negation of B's +3R template and is not compared to it.

### 4.3 Funding accounting — applies, and works against the mirror

DESIGN §4 verbatim: a settlement at `t_j` is collected iff `t_entry < t_j < t_exit`. A mirror long during extreme-positive funding **pays** every settlement in its hold; `fundingR` is negative by construction for `Bm`. The verdict is on **total net R** (`priceR + fundingR − costR`), as for every arm. Consequences, pre-registered: (i) the §8.3 "carry, not signal" label cannot apply to a `Bm` pass; (ii) a `Bm` whose `priceR` alone clears the ladder but whose total does not is a **kill**, reported with both numbers, no re-labelling; (iii) `fundingR` and `priceR` are printed beside each other in every `Bm` row.

### 4.4 Controls — same template, same shadow, per tier

- **Null A** (matched-time placebo, 1,000 draws) and **Null B** (day shift, 250 draws) exactly as DESIGN §6.1–6.2, per `Bm` tier.
- **Shadow-Bm** (gating): condition 1 replaced by `spct_k ≥ 0.90` at the last settlement (the same price-shadow variable as Shadow-B), conditions 2–4 unchanged, **long** side, §4.2 template, same funding accounting. In words: "buy the first 12-bar breakdown after a top-decile 24 h rally". Margin (i)–(iii) of DESIGN §6.3 applies unchanged; a `Bm` that clears the ladder but not the margin is **DOMINATED — no second signal**, and its shadow is written up as a proposal for the standalone-momentum line. Frequency-parity fallback (72 h shadow) as pre-committed; no other shadow.
- **Incremental control** (DESIGN §6.4) run for `Bm` inside the fixed shadow bucket, descriptive, non-promotable.
- **Frequency floors** (DESIGN §6.6) as for B: ≥ 300 fit events per tier, ≥ 150 per shadow; below floor the arm is UNDERPOWERED, no parameter moves.
- **Fit-period screen** (DESIGN §8 / note §7.3) mechanically: fit `mean netR ≥ +0.05R`, Null-A `p ≤ 0.20`, floors, shadow margin on fit. **Only an arm that passes reads the holdout**, and that read is this family's first. The screen decision is committed before the holdout is touched, as at 31a9c0e.

### 4.5 Two new `checks.py` assertions (run before the `Bm` fit)

1. **Event identity:** on the fit period, per tier, the `Bm` event set equals the `B` event set on ≥ 98 % of events (symmetric difference reported with its cause: open-position de-overlap only).
2. **Price-leg negation:** on matched events, `priceR_Bm + priceR_B == 0` (tolerance 1e-9) on every row not flagged `same_bar_ambiguity` or `gap_fill`; the flagged share is printed and must be < 5 %. A failure here means the mirror was not implemented as specified, and nothing is reported until it passes.

### 4.6 Pre-registered interpretation and prior

- **Prior for `Bm`: ≈ 15–20 %**, and here is why it is not higher despite Запись 8. The 0th-percentile negative was on raw forward returns. Through the closed `deriv-positioning` engine (REPORT §6.2) b1 was gross **−0.0251R** per trade against a median cost of 0.0264R: its mirror is a gross +0.025R object *before* paying its own costs and *before* paying the crowd's funding, i.e. roughly zero net. This family's cost model is heavier (Null-A means −0.07 … −0.09R on crypto per red-team §6.0). The mirror is the right-signed registration; it is not a likely pass, and the disclosure must not read as if it were.
- **Pairwise logic, stated in advance:** on the +1R template at most one of `B`, `Bm` can have a positive price leg per tier, and both can be kills (costs plus funding eat both sides). The REPORT prints them as adjacent rows with `priceR`, `fundingR`, `costR`, `netR`.
- A `Bm` REAL EDGE is consistent with Запись 8 and needs no reconciliation paragraph beyond saying so; a `B` pass would still need the b1 reconciliation of note §2.1. A `Bm` kill together with the `B` kill closes both signs of the funding-extreme break on this venue; the REPORT says so in one sentence and the backlog item is closed.
- **No mirror of A.** A's opposite side (pay the crowd's funding) has no prior evidence and is not registered.

## 5. Interaction with the two-year holdout recommendation

Red-team §8 item 4 (crypto holdout 2024-08 .. 2026-07 from the next design onward) is **not applied** to this family, retroactively or via the mirror: 2024-08 .. 2025-07 is fit data that has been computed and seen for B, hence for `Bm`. The convention takes effect with the next crypto design that is not this family. The REPORT's mandatory row (§2) says so.

## 6. Order of operations for the Researcher

1. Commit the DESIGN.md amendment (§2 wording, arm table, α, ladder) and the two `checks.py` assertions **before** any `Bm` number is computed, in the af89ea7 pattern; cite this ruling and the commit hashes 09d5ef8 and 31a9c0e in the amendment.
2. Run `checks.py`; §4.5 must be green.
3. Run the `Bm` fit on both tiers with shadows, nulls, incremental control; run the screen; commit the screen decision.
4. Holdout: read once, only for `Bm` arms that pass the screen, only after step 3 is committed.
5. REPORT.md: six arms, the §2 row, the pairwise table, the two-year-holdout sentence.

Nothing about `A_*` or `B_*` is rerun, re-thresholded, or re-worded.
