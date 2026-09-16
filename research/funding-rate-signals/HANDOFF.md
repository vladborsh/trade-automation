# HANDOFF — `funding-rate-signals` → Architect

**From:** Researcher (Opus 5) · **Date:** 2026-09-16 · **Package:**
`research/funding-rate-signals/` · **Full write-up:** `REPORT.md`

---

## 1. What you need to decide

**Nothing is being promoted.** All four registered arms are
**NO EDGE — fit-period kill**, the holdout was never read, and the line as
registered is finished. The decisions that are actually yours:

1. **Close the line, or authorise the one follow-up §2 describes.** My
   recommendation is **close it** — see §4 for why I do not think a follow-up
   on the per-side asymmetry is worth an α slot.
2. **Where the α ledger stands** (§3) — 4 arms registered, 0 holdout reads.
3. **Whether §4.4's funding-cost number changes the promotion checklist** for
   every future 1 h crypto candidate. This is the only immediately usable
   output of the pass and it is not mine to apply.
4. **Whether the hedged-carry backlog entry is re-prioritised** in light of
   §5 — this pass produced a positive argument for it while killing its own
   hypothesis.

---

## 2. The verdicts, mechanically

| arm | fit `n` | mean netR | Null-A `p` | §6.6 floor | **verdict** |
|---|---|---|---|---|---|
| A carry, majors | 89 | −0.1294 | 0.891 | failed | **NO EDGE — fit-period kill** |
| A carry, alts | 394 | −0.0201 | 0.572 | met | **NO EDGE — fit-period kill** |
| B continuation, majors | 32 | +0.0852 | 0.209 | failed | **NO EDGE — fit-period kill** |
| B continuation, alts | 196 | −0.0144 | 0.448 | failed | **NO EDGE — fit-period kill** |

Screen-in required **all** of: mean netR ≥ +0.05R, Null-A `p` ≤ 0.20, both
frequency floors, and the §6.3 margin, on fit. **No arm satisfies two of the
four.** Three arms are additionally **UNMEASURABLE at the pre-committed
definition** under §6.6 (below the 300-event floor), but **the floors are not
load-bearing**: each of the four independently fails a criterion that has
nothing to do with sample size.

**The §6.3 gating margin never engaged**, because it only applies to an arm
that has already cleared the ladder. It is recorded, not applied.

---

## 3. For the α ledger and the holdout register

- **Registered:** 4 arms → α = 0.05/4 = **0.0125**. Counted by registration
  per Запись 27's convention.
- **Actual holdout reads: 0.** The holdout year **2025-08-01 .. 2026-07-31**
  was **not touched** by this package and remains clean for the next line. The
  2026-08 tail was likewise not computed (§5.4 scopes it to "post-holdout",
  and there is no holdout read to post-date).
- Prior reads of that year by four earlier crypto lines were declared in
  `DESIGN.md` §8.1 before the screen; none concerned funding.

---

## 4. The one thing that pointed somewhere — and why I am not asking for it

`A_alts`, **long side only** (being *paid* to be long when funding is
extreme-negative, i.e. the crowd is short): **+0.098R on n = 135, t = 2.05,
win rate 60 %**, inside an arm that is −0.020R pooled. The short side is
−0.082R on n = 259.

**I am not requesting a follow-up registration for it**, and the reasons are
worth stating because the asymmetry is real enough to tempt someone later:

- it is a **post-hoc side split inside a registered arm**, exactly the move
  the project's own discipline exists to prevent;
- `t` = 2.05 on 135 trades is nowhere near α = 0.0125;
- the long side is **rare and crash-clustered** — it fires when the market is
  panicking — which is precisely the population where this pass's **unmodelled
  slippage** (REPORT §7.1) is worst, and the omission can only make it worse;
- the §6.4 incremental control is significantly **anti**-informative pooled
  (0/6 cells, t = −4.32), which argues the split is a feature of the crash
  tape rather than of funding.

If you disagree and want it registered, it should be registered as **its own
hypothesis on its own tape** — "being paid to be long into capitulation" is a
different claim from the carry claim, with a different mechanism and a
different risk profile — not as a re-label of this arm.

---

## 5. What I would put in front of you as genuinely new information

**The funding sensor works. The trade does not.** This is not the
`deriv-positioning` outcome and it should not be filed next to it.

- `deriv-positioning` killed its signal as **price in disguise** — the price
  shadow beat it at every horizon.
- Here the price shadow collects **+0.0014R** of carry while the funding rule
  collects **+0.0353R** — **25× to 37×** more. Funding and trailing price are
  **genuinely different series**, and funding measures the thing it claims to.
- The §6.8 mechanism prerequisite **passes**: the extreme state persists (40 %
  still extreme after 3 settlements, 28 % after 9) and the forward rate
  averages **+0.058 %/8 h ≈ 63 % annualised**.
- It dies because **the unhedged price leg costs more than the carry pays**:
  −0.046R of price against +0.035R of funding on the alts, −0.171R against
  +0.055R on the majors. The 5 A-alts trades that ran the full 30 settlements
  collected **+0.197R** of funding — *when you get to hold it, it is a real
  number; only 1.3 % of trades get there.*

**Two consequences I think are yours to route:**

1. **This is an argument for the hedged carry** (short perp / long spot) that
   §10 of your note explicitly left out of scope. The leg that killed A is
   exactly the leg a hedge removes. I have not tested it and I am not claiming
   it works — but the evidence this pass produced points at it, and the
   backlog's spot–perp basis entry is where it belongs.
2. **Funding is a measured promotion blocker, not a suspected one.** §6.7's
   answer to the standing `deriv-positioning` §6 flag: turning funding
   accounting on costs a 1 h continuation strategy **0.0009–0.0033 R/trade**,
   **always negative**, which is **1.4 %–24 % of the edge** on these thin
   numbers. Any future 1 h long-biased crypto candidate should carry funding
   in its P&L from stage 1 rather than as a late haircut.

---

## 6. Protocol record

- `DESIGN.md` committed at **`af89ea7`**, **before any R existed on any arm** —
  the engine, checks and controls modules were written but never run.
- Stage-0 anomalies escalated **before any derived series existed**; ruling
  `a393ffc` recorded at **`09d5ef8`**; all three went as recommended.
- `checks.py` **10/10 PASS**. Check 5 was **rebuilt** after the naive
  "reflect the tape" mirror was found to test the wrong thing — three
  quantities here are not equivariant under any price transform. It is now
  three exact sub-checks. Details in `REPORT.md` §2.
- `MECHANIC-PROOF.md`: 20 outcome-blind fit trades with full settlement
  ledgers; **all 20 hand re-checks reproduce `netR` to 1e-12**.
- Screen decision committed at **`31a9c0e`**, **before any holdout number
  existed**.
- **One correction to your note, for the record** (`DESIGN.md` §5.6.3): the
  §3.1 fit-start table grouped BTC/ETH/XRP/LINK at 2020-01-16, but **XRP
  listed 2020-01-06 and LINK 2020-01-17**, so their computed warm-ups end
  **2020-01-21** and **2020-02-01**. The computed dates govern per your
  ruling; the cost is 5 and 16 days of fit sample and nothing else.
- **One asymmetry in your note, reported not corrected** (`REPORT.md` §2):
  §1.2's `fpct` counts the current value with `<=`, so `ext_neg` is stricter
  than `ext_pos` by exactly **one rank in 90 (0.0111)**. It runs *against* the
  side that performed better, so it is not manufacturing §4.
