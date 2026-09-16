# Architect note — ORB follow-up: shorter opening ranges, and what "other timings" honestly means

**Date:** 2026-09-16 · **Status:** ruled, **GO — narrowly**, routed to the
coordinator for a Researcher dispatch. This note is the binding
pre-registration for the follow-up family `orb-ny-open-short`. It is written
in the same form as `ARCHITECT-NOTE.md` and inherits everything it does not
explicitly change. Inputs: `ARCHITECT-NOTE.md` (`7ff19fc`), `DESIGN.md`
(`82d6c0b`, amendments 1–2), `REPORT.md`, `HANDOFF.md`, `RESEARCH-LOG.md`
Запись 23, `IDEAS-BACKLOG.md` ORB entry, `research/cmc-bot-smart-money/
ARCHITECT-NOTE.md` §3.1 ("one shot — a miss is a kill, not a rework"),
`research/cmc-bot-vwap/ARCHITECT-NOTE-STAGE1.md` §4.2.

**What I knew when I wrote this, stated so the reader can weigh it.** Unlike
the original note, this one was **not** written blind. I have read the eight
holdout verdicts, the fit-period sensitivities S1–S4, Study B's zero flags, the
crypto controls and the template-2 straddle. §2 lists every design choice
below that the holdout could have influenced and says which evidence actually
drove it. No number in this note was computed on any tape for this note; every
count is a projection or a quotation from `REPORT.md`.

---

## 0. Summary of rulings

| # | question | ruling |
|---|---|---|
| 1 | follow-up warranted? | **Yes, narrowly — one family, one shot, honestly labelled a second look at a read holdout.** The mechanic is not obviously dead: forward lift is above 1.00 on every arm (direction is selected), costs are tiny, and the one width sensitivity already run (S1, fit-only) moved US100 in the right direction. But the evidence for "shorter range = edge" is thin, and Study B says no conditioning variable, timing included, was visible. The user is told this plainly in §1. |
| 2 | the family | **6 new arms: {US100, US500} × OR width {5, 10, 15} min, 5m trigger bar, trigger from the range's end to 12:00 NY, stop = opposite side, +1R template gates, flat 16:00 NY.** The full grid is always reported; no cell may be reported without its neighbours (§4). |
| 3 | Bonferroni | **Cumulative over every pre-registered look at this holdout: 8 original + 6 new = 14 → α = 0.05/14 ≈ 0.00357.** Kill bar +0.05R and build bar +0.10R unchanged. A **fit-period screen** decides which arms are allowed to touch the holdout at all (§5). |
| 4 | instruments | **Indices only.** Crypto is out: its own pre-registered control (pre-ETF row) falsified the imported-anchor story, and the standing nulls on clock structure in crypto (Записи 2, 18) are not contested by a shorter range. The ETH template-2 straddle gets **one deferred registration on future tape** (§3), not a place in this family. |
| 5 | "other timings" | **The timing that matters is trigger start = range end**, which the follow-up varies through the width. **No other anchor (London, 08:30 ET, UTC midnight) and no other cutoff is registered**, with reasons in §6. |
| 6 | volatility-scaled width | **Not included.** Study B already carried the range width in ATR and in daily-ATR units as features and flagged neither; a scaled width trades an arbitrary minute count for an arbitrary multiplier with nothing gained (§6). |
| 7 | anti-p-hacking structure | Cumulative α; fit-period screen before any holdout look; a pre-committed **dose-response reading** (§5.4) that makes an isolated passing cell suspect by rule; the whole grid printed in the first table of `REPORT.md`; the holdout re-use declared in the first paragraph. |
| 8 | machinery | **Fork `research/orb-ny-open/` into `research/orb-ny-open-short/`; parametrise, do not rewrite** (§7). Cached 1m tapes must be **copied from the main checkout, never re-pulled** (§8). |

---

## 1. Ruling 1 — is a follow-up warranted at all?

### 1.1 The honest reading of what the closed pass says

Three facts from `REPORT.md`, in order of weight:

1. **The unconditional mechanic has no edge at 30 minutes.** Eight arms,
   207–236 holdout trades each, gross expectancy near zero on every one. This
   is a well-powered null and this note does not dispute it.
2. **Direction is selected, the construction does not convert it.** Median
   non-circular forward lift is above 1.00 on all eight arms (1.035–1.234,
   fit period). After a close beyond the range the tape moves further in the
   breakout direction than a random comparable bar does. That is the only
   positive signal in the pass and it is the reason the mechanic is not
   simply dead.
3. **Study B saw nothing.** 24 features, both timeframes, zero flags under a
   FWER-controlled null; `tod_min` (when the trigger fired) and the two range
   width features (`or_width_atr`, `or_width_datr`) were among the unflagged.
   The REPORT's own caveat applies: 24 features on ~1,400 trades cannot
   exclude a small conditional effect, only fail to find one.

On the specific question the user asks — does a **shorter** range change the
answer — the pass has exactly one piece of evidence, and it is weak in both
directions:

- **S1 (fit-only, non-gating): 15-minute range.** US100 improved (+0.088R vs
  +0.057R on 5m; +0.072R vs +0.036R on 15m), US500 stayed negative
  (−0.031R / −0.030R), all four crypto arms got worse. **Two caveats.** It
  is fit-period only. And it is **not a true 15-minute ORB**: `engine.py`
  keeps the first trigger bar at 10:00 NY regardless of width
  (`find_trigger` reads `C.TRIG_START`), so S1 is "range of the first 15
  minutes, breakout counted only from 10:00" — a range with a 15-minute dead
  zone after it. A real 15-minute ORB triggers from 09:45. Nobody has run
  that, on any arm.

So: **the pass does not show that a shorter range works, and it does not show
that it doesn't.** It shows a mechanic that picks direction weakly, and one
fit-period hint on one instrument that a tighter range helps.

### 1.2 The ruling, and what the user is being told

**GO, as one narrowly defined family, on the terms in §4–§5.** The reasons it
clears the "one shot" bar rather than being a rework:

- It is **a different registered object**, not the same one re-parametrised:
  a range that ends before the 10:00 release window, a trigger that starts at
  the range's end, a stop that is several times tighter in price. The closed
  pass explicitly did not test it (its own S1 is not it).
- The user asked for it in so many words, the machinery exists, and the
  answer is decisive either way at a cost of roughly a day.
- The dishonest version of this — sweep width × timing × instrument × bar and
  report the cell that clears the bar — is prevented structurally in §5, not
  by asking the Researcher to be careful.

**And the user should hear this plainly, in the note and in the coordinator's
summary:** the prior for this family is *low*. Nothing in the closed pass
predicts that a 5- or 10-minute range produces +0.10R where a 30-minute range
produced +0.03R on the best instrument. The most likely outcome of this family
is six kills. If that happens, the ORB line on these tapes is closed for real
— **the follow-up is the second and last shot on the width/timing axis**, and
a third pass would need a different mechanic (an exit construction, §9), not a
different minute count. I am registering this because the user asked for a
real search and a real search with honest accounting is possible; I am not
registering it because I expect it to pass.

---

## 2. What the holdout could have influenced, and what actually drove each choice

The 2025-08-01 .. 2026-07-31 holdout has been read for the 30-minute
configuration. Every trade in the follow-up family sits on the same days as a
30-minute trade on the same instrument, usually in the same direction. The
follow-up therefore **re-uses a read holdout**, which `ARCHITECT-NOTE.md` §6.5
allowed only "with the conflict named". It is named here and in §5.1.

| choice | could the holdout have driven it? | what drove it |
|---|---|---|
| Drop crypto | Yes — crypto holds the worst holdout numbers | The **pre-ETF control** (fit-side, descriptive, pre-registered): the imported-anchor story is not supported. The standing nulls Записи 2 and 18. And S1 (fit-only): every crypto arm got worse at 15 minutes. All three are fit-side or prior. |
| Keep US500 | Would have argued for dropping it (holdout ≤ +0.006R; S1 fit negative) | Kept deliberately as the anti-selection choice: the hypothesis is about the cash-open auction and both indices have one. Dropping the weaker instrument after seeing it is exactly the selection this note exists to prevent. |
| Widths 5/10/15 | No — no holdout number exists for any width other than 30 | §4.2 |
| 5m trigger bar only | Weakly — holdout showed 5m ≈ 15m | The confirmation bar must be shorter than the range (§4.3); a 15m bar cannot confirm a 5- or 10-minute range. |
| Same template, stop, costs, nulls | No | Carried verbatim so the follow-up is like-for-like with the closed pass. |

---

## 3. Ruling 4 — instruments, and the ETH template-2 straddle

### 3.1 Crypto: out of this family

The crypto arms were registered under an explicitly weaker hypothesis — that
US spot-ETF flow imprints the 09:30 NY open on BTC/ETH — with two controls
that could falsify it. One of them did: the **pre-ETF row (2022-08 ..
2023-12) is indistinguishable from the ETF-era fit period**, both at zero.
Per `DESIGN.md` §4.2 the REPORT already says the transmission story gets no
support. A shorter range does not rescue a mechanism whose anchor was just
shown not to transmit. Add the standing nulls on clock structure in crypto
(Запись 2: time-of-day filters do not survive; Запись 18: NY-morning session
liquidity killed) and the S1 direction on every crypto arm, and the crypto
ORB line is **closed on width and timing**. No crypto arm in this family.

### 3.2 The ETH template-2 straddle: one deferred registration, on future tape

`HANDOFF.md` §2.1 asks for a ruling. `ETHUSDT-5m` (+0.106R) and
`ETHUSDT-15m` (+0.138R) cleared the build bar on **template 2** (no target,
flat 16:00 NY) in the holdout, while their gating verdicts were kills. The
Researcher recommends against registering it; the reasons are right: no null,
no interval, fit period at +0.065R / +0.010R, and the crypto anchor story
falsified by its own control.

**Ruling: not registered on the read holdout, and not part of this family.
Registered once, deferred, on tape that does not yet exist:**

- **Arms:** `ETHUSDT-5m-t2`, `ETHUSDT-15m-t2` — the closed pass's mechanic
  exactly (30-minute range, trigger 10:00–12:00 NY, stop = opposite side,
  **no target**, flat 16:00 NY, NYSE days, 0.10 % round trip), template 2 as
  the gating template.
- **Holdout:** **2026-08-01 .. 2027-07-31**, computed **once**, no earlier
  than the tape reaching 2027-07-31. No fit period — the model has no free
  parameter; the fit period is the already-read 2024-01 .. 2026-07 tape.
- **Family = 2 arms, α = 0.05/2 = 0.025**, own ladder identical to §4.4 of
  the original note with the template-2 mean net R as the metric, **Null A
  and Null B run on template 2**, 90 % day-block bootstrap, `n_holdout ≥
  150`, gross > 0.
- **Weekend row** re-run on the same future window; the "the clock, not the
  anchor" rule applies unchanged.
- **Researcher writes and commits the frozen script now** as part of this
  dispatch (`deferred_eth_t2.py`, one command, no arguments, refuses to run
  if the tape ends before 2027-07-31). Nothing else is done on it until then.

Selecting these two arms *because* of their holdout numbers is legitimate
here only because the test runs on data that did not exist when they were
selected. This is what "test on a later holdout" means, and it is the one
honest way to spend the straddle rule.

---

## 4. Ruling 2 — the family `orb-ny-open-short`

### 4.1 The six arms

| # | arm | instrument | OR window (NY) | trigger bars open in | trigger bar | stop | template |
|---|---|---|---|---|---|---|---|
| 1 | `US100-OR5` | US100 | [09:30, 09:35) | [09:35, 12:00) | 5m | opposite side of OR | +1R gates; pure-ORB secondary |
| 2 | `US100-OR10` | US100 | [09:30, 09:40) | [09:40, 12:00) | 5m | same | same |
| 3 | `US100-OR15` | US100 | [09:30, 09:45) | [09:45, 12:00) | 5m | same | same |
| 4 | `US500-OR5` | US500 | [09:30, 09:35) | [09:35, 12:00) | 5m | same | same |
| 5 | `US500-OR10` | US500 | [09:30, 09:40) | [09:40, 12:00) | 5m | same | same |
| 6 | `US500-OR15` | US500 | [09:30, 09:45) | [09:45, 12:00) | 5m | same | same |

Everything not listed is **verbatim from `DESIGN.md`**: OR from 1m bars
(`OR_high` = max high, `OR_low` = min low over the window), first **close**
strictly beyond the range on a 5m bar, one trade per day, no re-entry, entry
at the trigger bar's close, `1R = |entry − stop|`, 1-minute-path fill
(stop first, target at level, gap fills at the breaching minute's open, flat
at the 16:00 NY minute's close), Capital.com cost = half the entry minute's
spread + half the exit minute's spread in R, no slippage, NYSE full-day
calendar, fit 2024-01-01 .. 2025-07-31, holdout 2025-08-01 .. 2026-07-31,
tail 2026-08-01 .. 2026-09-11 descriptive.

**The closed pass's 30-minute arms `US100-5m` and `US500-5m` are the fourth
point of each instrument's width series** (§5.4). They are not re-run and not
re-judged; their existing numbers are printed alongside.

### 4.2 Why these three widths, and not "try everything"

- **5 minutes** is the canonical short ORB — the first 5-minute candle — and
  the width used by the best-known published ORB result (the 2023
  Zarattini–Aziz QQQ study, which, note, pairs it with a stop far *tighter*
  than the range and a distant target, i.e. a different exit construction
  from ours; §9). It is also one 5m bar, which was the original note's
  objection #2 ("the noisiest possible estimate of the auction's range").
  The objection stands and the test will price it: the user asked for
  shorter, the literature's version is this, and the tape decides.
- **15 minutes** is the width the backlog originally named ("first 15–30
  minutes"), the width S1 pointed at on US100, and — as a *true* ORB with
  the trigger from 09:45 — the one nobody has run.
- **10 minutes** is not there because it might be the winner. It is there
  so the width axis has **four points** (5, 10, 15, 30) and a shape can be
  read: if a shorter range genuinely helps, expectancy should move
  monotonically along that axis, and a single cell that pops between two
  kills is what noise looks like. §5.4 pre-commits that reading.
- **Not 20 or 25** (no distinct reason from 15 and 30). **Not 60** (S2 ran
  it fit-only: near zero everywhere; and it is the opposite of the ask).
  **Not 1–3 minutes** (a 5m trigger bar cannot confirm a range narrower than
  itself, §4.3).

### 4.3 Why the 5m trigger bar only

The 15m arms of the closed pass triggered less often and traded the same
days as the 5m arms with near-identical holdout numbers; the timeframe was not
where any difference lived. For the follow-up the constraint is mechanical: a
confirmation bar coarser than the range it confirms is the noisiest object in
the design (the original note's objection #2, now on the trigger side). With
a 5- or 10-minute range, a 15m bar cannot open on the grid until 09:45 and
would then confirm a range it dwarfs. So **every follow-up arm triggers on 5m
bars.** A 15m-bar variant of the 15-minute range is *not* registered: it
would be one bar's high/low confirmed by the next bar of the same size, and
adding it would be a cell for the sake of a cell.

### 4.4 Trigger start = range end; cutoff 12:00 NY; no contingency needed

- The first eligible trigger bar is the **5m bar opening at the range's end**
  (09:35 / 09:40 / 09:45 NY). All three lie on the 5-minute UTC grid under
  either DST offset (`checks.py` grid check re-run for the new clock points).
- **Cutoff 12:00 NY, unchanged.** Projection (assumption, not computed): with
  a 5–15 minute range the trigger share will approach 100 % of eligible days
  and most triggers will land within a few bars of the range's end, so
  `n_holdout ≈ 240` per arm and the §4.5 power contingency of the original
  note **cannot fire and is retired** for this family. The Researcher still
  records the fit-period trigger share per arm before the holdout is touched,
  as a data note.
- **Opening-range completeness** scales with the width: every 5-minute bin
  inside the range must hold at least one 1m bar (1, 2 or 3 bins). The
  "no 1m bar after the range and before 16:00" exclusion stays.

### 4.5 Costs — a sentence that must appear

With the stop at the far side of a 5-minute range, `stop_dist` is several
times smaller than in the closed pass, so **`cost_R` will be several times
larger** than the 0.012–0.030R seen there (projection: 0.03–0.10R on `OR5`).
It will still be far below the cmc-bot pass's 0.25–0.40R. The REPORT shows
the `cost_R` distribution per arm and the gross-vs-net gap, and says: "the
narrower the range, the more of any gross edge the spread eats; this family
is the one where costs can start to matter."

Cost model and sensitivities verbatim from `DESIGN.md` §5 (per-bar spread;
fixed fit-median spread; 2× spread). **Slippage is not modelled, so every
number is optimistic** — in the REPORT, as before.

---

## 5. Ruling 3 — thresholds, Bonferroni, and the anti-sweep structure

### 5.1 The holdout re-use, declared

`REPORT.md`'s **first paragraph** must contain, in these or equivalent words:
*"This family re-uses the 2025-08-01 .. 2026-07-31 holdout, which was read
once already by the closed `orb-ny-open` pass on the same instruments and
days. It is the second pre-registered look at that year. The α below is
corrected for both looks. A REAL EDGE reached here is weaker evidence than a
first-read REAL EDGE and any build ruling will say so."*

### 5.2 Cumulative Bonferroni

**Family for α purposes = every pre-registered arm judged on this holdout:
the 8 original arms + 6 new arms = 14. α = 0.05 / 14 ≈ 0.00357.** This is
the project's own convention extended to the honest case — a holdout asked a
second batch of questions is one growing family, not a fresh one. The two
timeframes and the four widths of one instrument are correlated and Bonferroni
is conservative for that; it is kept anyway. If the Researcher finds the arm
count wrong, tighten, do not loosen.

### 5.3 The fit-period screen — decided before any holdout number exists

**No arm touches the holdout unless, on the fit period alone:**

1. mean net R (template 1) `≥ +0.05R`, **and**
2. **fit-period Null A** (matched-time placebo, 1,000 draws, drawn from the
   arm's own trigger window on the fit period) gives `p ≤ 0.05`.

An arm that fails the screen is verdicted **"NO EDGE — KILL (fit screen)"**,
its holdout is **never computed**, and the fact is recorded in `DESIGN.md`
with a commit hash **before** any holdout number exists for any arm. This is
strictly tighter than the original ladder (which already required
`m_fit ≥ +0.05R` for a build) and it limits the number of new reads of the
holdout to the arms that have something to confirm. The screen is not a
verdict on the mechanic's merits; it is the price of re-using the holdout.

Nothing about the screen is tuned: +0.05R is the kill bar, 0.05 is the
uncorrected conventional level for a screen that only ever removes arms.

### 5.4 The verdict ladder — verbatim, α substituted, plus one reading rule

Applied mechanically to template 1's holdout mean net R, per screened-in arm:

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** Return to Architect. |
| holdout mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.00357 < p ≤ 0.20` | **INCONCLUSIVE.** No build. No follow-up on the width/timing axis (§1.2). |
| **all** of: mean net R `≥ +0.10R`; `p ≤ 0.00357`; fit same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; 90 % day-block bootstrap excludes 0; gross `> 0` | **REAL EDGE — routes to Architect for a build ruling**, subject to the dose-response reading below. |

**Dose-response reading, pre-committed.** For each instrument the REPORT
prints the width series **5 → 10 → 15 → 30** (the 30 being the closed pass's
`-5m` arm, quoted, not re-run), fit and holdout, in one table. A REAL EDGE on
a cell whose **both** adjacent widths on the same instrument are kills (for
`OR5`, the one adjacent width) is labelled **"isolated cell — suspect"** in
the verdict table itself, is *not* routed as a build candidate, and returns to
the Architect as a noise finding. The hypothesis "shorter is better" predicts
a monotone or at least unimodal shape; a spike does not fit it and is treated
as the multiple-comparisons artefact it most likely is. This rule is what
makes registering a three-width grid honest: the grid is there to read a
shape, not to give three lottery tickets.

### 5.5 Reporting rules the Researcher may not bend

- **The full 6-cell grid, plus the two quoted 30-minute cells, is the first
  table of `REPORT.md`**, every cell with its verdict, fit and holdout mean
  net R, `n`, `p_A`, bootstrap interval, and screen status. **No "best cell"
  sentence exists anywhere in the deliverable** without that table above it.
- Screened-out arms appear in the same table with "(fit screen)" and a blank
  holdout column — the blank is the point.
- Template 2 is reported for every arm as before, **no verdict**; the
  straddle rule is **retired** for this family (it has been spent, §3.2).
- Every sensitivity run is shown, including the ones that came out worse.
- The nulls, interval and forward-lift row are verbatim from `DESIGN.md` §6
  and §4.1 with the trigger window substituted per arm.

### 5.6 Fit-only sensitivities (non-gating, descriptive, never a verdict)

| # | sensitivity | value |
|---|---|---|
| S3' | stop at the OR midpoint | as before |
| S4' | re-entry once after a stop, max 2/day | as before |
| S5 | trigger window end 11:00 NY | one earlier cutoff, to show how much of a short-OR arm's sample is early triggers |

S1/S2 (width) are gone — width is now the axis, not a sensitivity. No
sensitivity on the trigger *start*: it is the range end by definition.

**No Study B.** The feature study found nothing at 30 minutes; re-running it
per cell would multiply comparisons for no stated hypothesis. The feature
columns may be built if the fork makes that free, but **no model is trained
and no flag is reported**.

---

## 6. Ruling 5 — "other timings" and the volatility-scaled width

### 6.1 What "other timings" means here, and what it does not

The user's phrase covers three things. Ruled separately:

1. **When the trigger may start** — the only timing that has a mechanism
   (the range is done, the breakout of *that* range is the signal). The
   follow-up varies it through the width: 09:35, 09:40, 09:45 against the
   closed pass's 10:00. **Registered.**
2. **When the trigger must stop** (the 12:00 cutoff). For a short range the
   trigger lands within minutes on nearly every day, so the cutoff is
   inert; it is kept at 12:00 and shown once as S5. **Not an axis.**
3. **A different session anchor.** Considered and rejected, each for a
   stated reason:
   - **London cash open (08:00 London / 03:00 NY) on the index CFDs.** No
     mechanism: the instrument's own auction is at 09:30 NY; a European
     equity open is a foreign flow event on a US index, the same "imported
     anchor" shape that just failed its control on crypto.
   - **08:30 ET (scheduled US releases).** A news-reaction mechanic, not an
     auction; belongs to the backlog's macro-event pillar, which is its own
     registration.
   - **16:00 NY close, 18:00 ET futures re-open.** The CFD tape's 21:00–23:00
     UTC gap sits on top of the latter; the former has no breakout story.
   - **UTC midnight / Asia open on crypto.** Rejected in the original note
     §2.2 and crypto is out of this family (§3.1).

   **Not registered.** Each is a different hypothesis; if the user wants one,
   it is a fresh Architect ruling with its own family, and none of them
   inherits any credit from the ORB line.

### 6.2 Volatility-scaled range width — not included, with the reason

The backlog's untested question was "fixed minutes vs volatility-scaled".
Ruling: **not a variant of this family.**

- Study B carried the range width **in intraday-ATR units** (`or_width_atr`)
  and **in daily-ATR units** (`or_width_datr`) as features on ~1,400 trades
  per timeframe and **flagged neither**. That is direct, if weak, evidence
  that how big the range was relative to volatility did not predict the
  trade's outcome. A vol-scaled width would be built on the premise it does.
- A scaled width (`k × dATR14`, or "end the range when its width reaches
  `k × ATR`") replaces one arbitrary number (minutes) with another (`k`)
  that has no calibration except the tape — the original note's objection
  #3, unchanged.
- The one parameter-free version I could construct ("the range ends at the
  first inside 5m bar — the auction has settled") is a **new mechanic**, not
  a width rule, and would need its own registration and its own story.

If the user specifically wants the vol-scaled variant tested, it can be one
more arm per instrument in a *later* family at the cost of tightening α
again; I am not spending a cell on it here.

---

## 7. Ruling 8 — what the Researcher forks, parametrises and rebuilds

**Fork `research/orb-ny-open/` → `research/orb-ny-open-short/`** (copy the
package; do not edit the closed one — it is a finished, committed record).

| file | action | what changes |
|---|---|---|
| `common.py` | **parametrise** | `OR_END` and `TRIG_START` stop being constants. Introduce `ARMS = [(sym, or_minutes)]` for the six arms; `TF = 5` only; `OR_BINS = or_minutes // 5`; trigger start derived as `OR_START + or_minutes`. `TRIG_END_WIDE` and `OR_WIDTH_SENS` removed. Keep every other constant. |
| `engine.py` | **parametrise** | `find_trigger` takes `trig_start` (= the range end) instead of reading `C.TRIG_START`; `build_arm` / `eligibility` pass it through from the arm spec; `opening_range` already takes `or_minutes` and its bin count scales — keep. `walk1m`, fills, `cost_R`: untouched. |
| `features.py`, `analysis.py`, `mechanic_proof.py`, `checks.py` | **parametrise the same clock** | each reads `C.TRIG_START` once (lines listed in the dispatch); replace with the arm's trigger start. `checks.py` grid check adds 09:35 / 09:40 / 09:45 to the clock points it asserts on every session day. |
| `build.py` | **rewrite the arm loop** | six arms, template 1 + 2, tail row; S3'/S4'/S5 only; fit-period Null A per arm (for §5.3) **before** any holdout. Drop crypto, weekend, pre-ETF, S1/S2. |
| `projection.py` | **repurpose** | records fit-period trigger share per arm (data note only); no cutoff decision. |
| `analysis.py` | **add the screen** | a `screen` step that writes the §5.3 decision into `DESIGN.md` §8.x and refuses to run `holdout` for screened-out arms. `holdout` computes Null A/B, bootstrap, ladder at α = 0.00357, and the §5.4 isolated-cell label. |
| `studyb.py` | **drop** | no Study B. |
| `report.py`, `handoff.py` | **adapt** | first paragraph carries the §5.1 declaration and the full-grid table; the width-series table per instrument quotes the closed pass's `US100-5m` / `US500-5m` numbers from `research/orb-ny-open/results/` (read, never recomputed). |
| `deferred_eth_t2.py` | **new, small** | §3.2; refuses to run before the tape reaches 2027-07-31; otherwise reuses the closed package's `engine.py` unchanged. |
| `DESIGN.md` | **new, from this note** | committed **before any R is computed on any of the six arms**. |

**Nothing about fills, costs, calendar, nulls, bootstrap or the ladder's
numbers other than α is rewritten.** If the Researcher finds a reason any of
them must change, that is a §11 stop-and-return, not a local fix.

Mechanic proof: **ten hand-checked fit-period trades per width** (30 trades),
minute by minute, as `MECHANIC-PROOF.md` did; the 1m-path vs bar-OHLC fill
check; the grid check; the look-ahead check is moot without Study B and is
dropped.

---

## 8. Data — copy, do not re-pull

The four 1m tapes live **outside the git tree** and a fresh worktree will not
have them:

```
/Users/Vladyslav_Borsh/Documents/trade_automation/research/cmc-bot-vwap/data/
    US100_1m.parquet   US500_1m.parquet   BTCUSDT_1m.parquet   ETHUSDT_1m.parquet   raw/
```

**The Researcher copies (or symlinks) that directory into the worktree's
`research/cmc-bot-vwap/data/` before anything else, and re-runs the coverage
audit (`prep_data.py US100 US500`) to confirm the committed
`results/COVERAGE.md` rows reproduce byte-identically — the tape-integrity
check, not a re-pull.** A re-pull of Capital.com data takes 45+ minutes, is
unnecessary, and would produce a tape that no longer matches the audited one.
The closed pass's resampled `research/orb-ny-open/data/` is also gitignored
and is simply regenerated by `common.py:resample` (seconds).

---

## 9. Explicitly not ruled here — and the one thing that is next if this dies

- **An exit-construction family.** The closed pass's only positive signal —
  forward lift above 1.00 on every arm — is a statement about what happens
  *after* the trigger, and the +1R-target / full-range-stop construction is
  what fails to convert it. The published short-ORB result the user may have
  in mind (Zarattini–Aziz 2023) is, on its own description, a **5-minute
  range with a stop far tighter than the range and a distant, multi-R
  target**: the opposite corner of the template space from anything this
  project has tested. If the six arms above are killed, **that** is the
  principled next registration on ORB — one family, the exit as the axis,
  with the width fixed by whatever this family shows about shape — and it is
  a different mechanic, which is why it is not folded in here. Logged in
  `IDEAS-BACKLOG.md`.
- **The weekend row** (crypto, same clock, no cash open): −0.29R to −0.41R on
  every crypto arm, fit and holdout alike. A descriptive row on ~100 trades
  and not what anyone asked; but a same-mechanic number that far below zero
  is at least a note for the backlog's crypto-reversal pillar. Logged, not
  registered.
- **Other anchors, vol-scaled widths, 15m trigger bars** — §4.3, §6.
- **Software Engineer / Backtesting** — only on a REAL EDGE that survives
  §5.4, after a further Architect ruling.

---

## 10. Order of work and stop rules (for the dispatch)

1. Fork, copy tapes (§8), coverage audit byte-identical. **No R.**
2. Parametrise per §7. `DESIGN.md` written from this note, **committed
   before any R**.
3. Mechanic proof (§7), grid and fill checks.
4. Fit-period numbers for all six arms, S3'/S4'/S5, fit-period Null A per
   arm. **§5.3 screen decision committed into `DESIGN.md`.**
5. **Holdout, once**, screened-in arms only; ladder at α = 0.00357; §5.4
   label.
6. `REPORT.md` (first paragraph: §5.1 declaration + full grid),
   `HANDOFF.md`, `RESEARCH-LOG.md` Запись **regardless of outcome**. A kill
   is a result. `deferred_eth_t2.py` committed.
7. **Stop and return to Architect** if: the coverage audit does not
   reproduce; the 09:35/09:40/09:45 grid check fails on any day; the 1m-path
   and bar-OHLC fills disagree on a trade that neither gaps nor touches both
   levels within a bar; `n_holdout < 150` on a screened-in arm; or the
   pre-registration is ambiguous in a way that changes a number.
