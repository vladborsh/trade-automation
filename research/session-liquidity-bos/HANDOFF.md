# Hand-off: Researcher → Architect (session-liquidity **BoS pass**, corrected mechanic)

Package: `research/session-liquidity-bos/`. Full detail in `REPORT.md`; every
table in `results/TABLES.md`; the audit surface is `results/GALLERY.md` plus
`viz/`. `checks.py`: **18/18 PASS**.

---

## The short version

1. **The corrected BoS mechanic is now implemented and measured.** It confirms
   **33.8%** of the 21,118 primary take-outs, median delay **18 bars
   (90 min)**, MFE **2.42 ATR**, stop proxy **5.77 ATR**, **R median 0.41**,
   R ≥ 1 on 22.4%. Monthly rate 27–41% over 48 months, no drift.

2. **The re-anchoring defect was much larger than the correction note
   estimated, and in the opposite direction.** Phase 1's mechanic, re-run on
   the identical horizon, confirms **82.4%** — it is close to unconditional.
   The two rules pick the **same level at the take-out on 98.5%** of events but
   phase 1 is still testing that level on only **11.3%** of its own
   confirmations, after a median of **2** pivots overwrote it. The note
   predicted phase 1's delay and stop were *inflated*; measured, they are
   *tighter* (3.86 vs 5.77 ATR) and the delays are within one bar. **The note's
   directional prediction is wrong and I have said so in the report and the
   log** — the pivots that confirm inside the window are ones the reversal just
   made, i.e. nearer to price than the pinned anchor, so each re-anchoring
   hands phase 1 an easier target.

3. **The unanchorable category is empty: 0 of 23,423.** Well under the 2% the
   design asked me to flag. It is kept in the schema, tables and gallery as an
   explicit zero. A second consequence, which resolves the note's open
   question: with a causal `k=3` fractal, "confirmed as of `t0`" already
   implies "pivot bar before `t0`", so the multi-bar-grind ambiguity the note
   flagged **cannot arise** and needs no special case.

4. **Corrected BoS and iFVG-v4 are different signals.** Both confirm only
   **15.6%** of primary take-outs; BoS-only 18.2%, iFVG-only 48.8%, neither
   17.4%. Where both fire BoS is later by a median of **11 bars** and is first
   only 23% of the time. On the take-outs both confirm (event set fixed):
   BoS R median **0.30** vs iFVG **2.05**. Under the pinned stop convention the
   iFVG is the better entry reference, clearly.

5. **BoS does not select — the v4 null holds.** The naive lift table says BoS
   picks 1.9–3.3× bigger reversals; that is **an artifact**, because a break
   mechanically requires the reversal to already exceed the anchor distance
   (100.0% of confirmations, measured). Removing the circularity — forward MFE
   from the confirmation bar, matched on bars remaining — gives **0.87** for
   BoS, **0.83** for iFVG, **0.74** for phase-1 BoS. All below 1.0.
   Confirmation is a timing/entry-reference mechanic for BoS too.

6. **Window length remains the dominant axis** (BoS rate 5.6% → 46.5% across
   remaining-window buckets, an 8× swing vs 1.5–1.9× across session/block), and
   the clock is derived from it. §6.1 is unchanged by this pass.

---

## What I changed outside this package

* `knowledge/session-liquidity.md` — **§5.2 rewritten** with the now-pinned
  mechanic and its measured numbers, **§0's BoS bullet** updated from "never
  correctly measured" to the result, and **V6 in the §7 ledger** changed from
  *not pinned* to the pinned mechanic. This pass is what V6 was waiting for.
* `RESEARCH-LOG.md` — Запись 14 (Russian, usual format), including the
  correction to the correction note.
* Nothing in `research/session-liquidity/`, `-v2`, `-v3` or `-v4` was
  modified. v4 is used read-only and `checks.py` asserts the reuse is exact.

---

## What I need from you

1. **A ruling on §5 of `REPORT.md`, point 2 — the stop convention for BoS.**
   DESIGN §2 pinned the stop to the sweep-leg running extreme so that R is
   comparable across methods, and it is. But a trader taking a BoS entry would
   plausibly stop above the swing that forms *after* the break, not above a
   sweep wick 5 ATR away. That alternative is a different measurement, not a
   fix, and it is the single most likely reason these R numbers understate the
   mechanic. It would **not** change the selection result. Your call whether a
   follow-up measures it; I did not, because it is not in this design.
2. **A decision on the 18.2% "BoS only" cell.** v4 found that the take-outs
   with no qualifying gap carry the largest reversals in the sample; BoS covers
   3,833 primary take-outs the iFVG cannot see. Whether late-but-available
   beats early-but-absent is a design question.
3. **Confirmation that the phase-1 BoS numbers are now formally retired**
   (T2/T3/T5/T12/T13 BoS rows, the C-BoS arm of the invalidated
   `STRATEGY-DESIGN.md`) — not as inflated versions of the right number, but as
   a different, near-unconditional event.

---

## What this does not answer

* Nothing here is tested. Descriptive protocol per §8; the two "does not
  select" statements are nulls the data does not overturn, not hypothesis
  tests. I would not put a p-value on 0.87 vs 0.83.
* PDH/PDL is untouched (out of scope); the drill-down pass is unaffected.
* No strategy design. The C-BoS arm cannot simply be re-costed with these
  numbers — the event is different, so the arm has to be re-derived from
  scratch if it is wanted at all.

---

## Package

```
research/session-liquidity-bos/
  DESIGN.md      the Architect's brief (executed as written)
  README.md      orientation
  common.py      forked v4 plumbing + the k=3 pivot layer
  engine.py      3 arms on identical events: corrected BoS / phase-1 BoS / iFVG-v4
  tables.py      results/TABLES.md + every CSV        (blocks B/T/D/M/W/H/A)
  charts.py      viz/01..07
  examples.py    the panel renderer — the anchor ray on EVERY panel
  gallery.py     28 stratified seeded panels + results/GALLERY.md
  checks.py      18 assertions, all passing
  session_liquidity_bos.pine + RUNBOOK.md
  REPORT.md      the findings
  results/, viz/
```
