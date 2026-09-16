# Architect note — ORB exit construction: the family that tests where the lift is lost

**Date:** 2026-09-16 · **Status:** ruled, **GO — one family, one shot, third
and last look at the read holdout**, routed to the coordinator for a Researcher
dispatch. This note is the binding pre-registration for the family
`orb-ny-open-exit`. It inherits everything from `ARCHITECT-NOTE.md`
(`7ff19fc`) and `ARCHITECT-NOTE-FOLLOWUP.md` (`86ddf55`) that it does not
explicitly change. Inputs: both closed passes in full —
`research/orb-ny-open/{REPORT,HANDOFF,DESIGN}.md`,
`research/orb-ny-open-short/{REPORT,HANDOFF,DESIGN}.md` and their committed
`results/` tables; `RESEARCH-LOG.md` Записи 22–24; the two Zarattini papers
(§2, read in full from the SSRN PDFs); `research/cmc-bot-smart-money/
ARCHITECT-NOTE.md` §3.1 ("one shot — a miss is a kill, not a rework").

**What I knew when I wrote this, stated so the reader can weigh it.** I have
read every holdout number of both closed passes: template 1 (+1R) and
template 2 (no target) on the 30-minute arms of four instruments, and on
`US100-OR10` / `US100-OR15`. I have **not** seen any holdout number for any
5-minute-range arm — both `OR5` arms were screened out and their holdout was
never computed — and no holdout number exists anywhere for a trailing stop or
a volatility-sized stop. §3 lists every design choice below that the read
holdout could have influenced and says what actually drove it. No number in
this note was computed on any tape for this note; every count is a projection
or a quotation from a committed table, and is labelled.

**The user's request, as dispatched:** stop defaulting to a +1R target nobody
asked for; think like the best minds in trading; try genuinely different
approaches to risk:reward and risk management on the same instruments, not one
more sweep of the same template.

---

## 0. Summary of rulings

| # | question | ruling |
|---|---|---|
| 1 | is an exit family warranted? | **Yes.** Two independent passes, fourteen arms, land on one sentence: after the trigger the tape moves further in the breakout direction than a random comparable bar (median forward lift 1.04–1.65 on every arm), and the +1R / full-range-stop construction converts none of it. That is a statement about the exit, not the entry. The entry is fixed and the exit becomes the axis (§1). |
| 2 | the external design point | **Zarattini–Aziz 2023 (QQQ/TQQQ) and Zarattini–Barbon–Aziz 2024 (US stocks) are read in full in §2.** Their template is a 5-minute range, a stop at the first candle's extreme (2023) or **10 % of the 14-day ATR** from entry (2024), **no meaningful target** (10R or end-of-day; end-of-day best), 1 % risk per trade. Their result on QQQ: 1,795 trades, **24 % win rate, +0.13R per trade**, Sharpe 1.12. What carries over, and what does not (no spread modelled; entry differs; the relative-volume result is cross-sectional), is in §2.3. |
| 3 | the family | **Three exit constructions × two instruments, on the 5-minute range, 6 arms** (§5): **E0** range stop, no target, flat 16:00 (the literal Zarattini 2023 shape on our trigger); **E1** range stop, no target, **1R ratchet** (stop trails 1R behind the best price); **E2** stop at **0.10 × dATR14** from entry, no target, flat 16:00 (Zarattini 2024's exit exactly). The +1R corner of the grid is the already-killed `OR5` template 1, quoted on the fit period, its holdout **never computed**. |
| 4 | why these three and not twenty | They are the three distinct hypotheses about **where** the lift is lost — the cap (E0 vs quoted +1R), the give-back (E1 vs E0), the stop width (E2 vs E0) — and E1 nests E0, so the pair attributes. Every other construction the user named or I considered is either nested in one of these, a linear combination of two of them, cost-dead by projection, or a parameter with no calibration; each is ruled on individually in §4 and most are printed as **fit-only descriptive ladders** so the user gets the full R:R picture without spending α on it. |
| 5 | holdout and Bonferroni | **The 2025-08-01 .. 2026-07-31 holdout is re-used — its third and last pre-registered ORB look.** Cumulative family = 8 + 6 + 6 = **20 arms → α = 0.05/20 = 0.0025**. Argued, not defaulted, in §6.1: a fresh holdout does not exist (the tail is six weeks), the trades sit on the very days and sides already read, and the honest price of that is the cumulative α, the fit-period screen, the declaration in the REPORT's first paragraph, and **a pre-committed forward confirmation on tape from 2026-08-01 before any pass can become a build** (§6.5). |
| 6 | instruments | **US100 and US500, 5-minute range.** US500 is kept as the anti-selection choice although every fit number it has is at or below zero. **Crypto is not in this family**: the parallel crypto-anchor investigation has not reported; if it finds the NY anchor real on BTC/ETH, crypto gets its own exit family on future tape, not a late addendum here (§7). |
| 7 | side asymmetry | **No side-split arms.** US100 longs beat shorts on the fit period at all four widths; US500 shows no pattern; the fit period is a rising tape and the long premium is at least partly drift. Symmetric arms, mandatory long/short rows on fit **and holdout**, and a pre-committed **"one-sided — flagged"** label (§6.4). |
| 8 | machinery | Fork `research/orb-ny-open-short/` → `research/orb-ny-open-exit/`; one new walker (`walk1m_trail`), one new stop mode (`datr`), one new screen-and-ladder pass; tapes copied, never re-pulled (§9). |

---

## 1. Ruling 1 — what the two closed passes actually established

### 1.1 The sentence both passes end on

| pass | arms | holdout template 1 (+1R) | median forward lift (fit) | template 2 (no target) |
|---|---|---|---|---|
| `orb-ny-open` (30-min range) | 8 | −0.123R .. +0.047R, all KILL | 1.035–1.234, > 1 on 8/8 | US100 ≈ +0.01 / +0.04R; ETH +0.106 / +0.138R (no null behind it) |
| `orb-ny-open-short` (5/10/15-min) | 6 | +0.035R, +0.040R on the two screened-in arms, KILL; four screened out | **1.437–1.653**, > 1 on 6/6 | fit +0.078 .. +0.122R on US100; holdout **+0.002 / −0.002R** on `OR10` / `OR15` |

The forward lift is the median ratio of a trade's maximum favourable
excursion (in ATR14, from entry to 16:00 NY) to the median MFE of a random
side-matched, horizon-matched bar from the same trigger window. It is **not
circular** — it does not use the trade's outcome — and it says one thing: the
breakout selects direction. The shorter the range, the more strongly it does
so. And the +1R target with the stop at the far side of the range turns that
into +0.03R at best.

### 1.2 The two exit data points we already have, and what they rule out

1. **Removing the cap alone does not help — with the range stop, at 10 and
   15 minutes, on this holdout.** Template 2 (no target, range stop, flat
   16:00) was +0.002R and −0.002R on `US100-OR10` / `US100-OR15` where
   template 1 was +0.035R / +0.040R. The Researcher's reading — "whatever the
   right exit is, it is not *hold longer*" — is correct **for that stop and
   those widths**. It is not known for the 5-minute range (never read), and
   it says nothing about a stop that is not the range.
2. **Halving the stop with the +1R target makes everything worse** (S3 / S3',
   fit-only, midpoint stop): worse on 13 of 14 arms. That is the cmc-bot
   lesson — a tighter stop doubles `cost_R` and raises the stop rate — **but
   it was measured with the +1R cap in place**, so the price of the tighter
   stop was paid and its benefit (a small R that a long move pays many times)
   was capped away by construction. It is the wrong experiment for the
   tight-stop hypothesis and it is not evidence against it.

So the space that is genuinely unread is: **(a)** no cap at the 5-minute
width; **(b)** an exit that bounds the give-back without capping the run;
**(c)** a stop sized to volatility rather than to the range, paired with an
uncapped exit. Those are E0, E1 and E2.

### 1.3 The honest prior

Low-to-moderate, and higher than the width family's was. The width family
tested a *minute count* with no mechanism behind "shorter is better". This
family tests a *construction* that a published study found, on the closest
possible instrument (QQQ ↔ US100), to be the whole difference between +0.13R
per trade and nothing — and the one number we already have on our own tape
for that shape (`US100-OR5` template 2, fit period, **+0.122R**) is
consistent with it. Against: that same shape was ≈ 0 on the holdout at 10 and
15 minutes; the paper models no spread and our tight-stop arm pays one; the
project's own experience with small stops is uniformly bad. **The likeliest
outcome is still six kills.** I am registering this because it is the last
ORB hypothesis with a mechanism and an external anchor, and because a real
search with honest accounting is possible.

---

## 2. Ruling 2 — what Zarattini and co-authors actually did

Both papers were read from the SSRN PDFs (`4416622`, `4729284`); the numbers
below are quoted, not paraphrased from summaries (several web summaries get
the stop rule wrong).

### 2.1 Zarattini & Aziz (2023), "Can Day Trading Really Be Profitable?" — QQQ / TQQQ, 2016-01-01 .. 2023-02-17

| element | rule |
|---|---|
| range | first **5-minute** candle, 09:30–09:35 ET |
| entry | **open of the second 5-minute candle, in the direction of the first candle's move** (no breakout confirmation); no trade if the first candle is a doji |
| stop | **low of the first candle** (long) / **high** (short); `R = entry − stop` |
| target | **10R, or end of day, whichever first**; no partial target |
| sizing | 1 % of account per trade, leverage cap 4×, commission $0.0005/share, **no slippage, no spread** |
| result, QQQ | 1,795 trades, 51 % long; **win rate 24 %; average +0.13R per trade**; annual return 31 %, Sharpe 1.12, alpha 33 %/yr; total 675 % vs 169 % buy-and-hold |
| result, TQQQ | 1,484 %, Sharpe 1.18 (leverage constraint relaxed via the 3× ETF) |
| sensitivity ("A Further Investigation") | stop replaced by **a fraction of the 14-day ATR**; targets swept **1R .. 10R and EoD**; "best results with tight stop losses (**5 % of the 14-day ATR**) and by keeping the trade active until EoD"; TQQQ 9,350 % — and the authors' own caveat: "can be considered unrealistic as our model assumed no slippage … a stop placed at 5 % of the 14-day ATR implies a stop width of $0.08 … the stop will likely be exceeded" |

The base template's expectancy decomposes as 0.24 × (mean win) − 0.76 ≈
+0.13R → mean win ≈ **3.9R**. That is the entire shape of the result: a
losing majority paid for by a right tail that a +1R target would have cut off.

### 2.2 Zarattini, Barbon & Aziz (2024), "A Profitable Day Trading Strategy for the U.S. Equity Market" — ~7,000 US stocks, 2016 .. 2023

| element | rule |
|---|---|
| range | 5-minute (15/30/60 also run) |
| entry | **stop order at the range high (long) / low (short), in the direction of the first candle** |
| stop | **10 % of the 14-day ATR from the executed entry** |
| target | **none; flat at 16:00 ET** |
| filters | price > $5, 14-day average volume > 1 M shares, 14-day ATR > $0.50 |
| sizing | 1 % risk, leverage cap 4×, commission $0.0035/share, no slippage |
| base result (all eligible stocks) | total 29 %, IRR 3.2 %, Sharpe 0.48, hit ratio 41.4 %; PnL per trade ≈ −0.02R when opening-range relative volume < 100 % |
| with relative volume ≥ 100 %, top-20 by relative volume | total 1,637 %, Sharpe 2.81, hit ratio 48.4 %, alpha 36 %/yr; +0.08R per trade above 100 % RV, +0.38R above 30× |
| widths (with RV filter) | Sharpe **5 m 2.81**, 15 m 1.43, 30 m 0.21, 60 m 0.40 — "the reason for the 5-minute ORB's superior performance is unclear" |

### 2.3 What carries over to our tape, and what does not

- **Carries over — the exit shape.** Both papers pair a stop **tighter than or
  equal to a 5-minute range** with an exit that is **not a fixed small
  multiple**. The 2023 base stop *is* our `OR5` range stop (the far side of
  the first candle); the 2024 stop is 10 % of the daily ATR. Neither ever
  uses a 1R target, and the 2023 sweep found every target below EoD worse.
  That is E0 (their 2023 base) and E2 (their 2024 exit) below. Note that on
  our tape a 10R target on the range stop is ≈ 1.6 daily ATRs of intraday
  travel from a 09:40 entry (an `OR5` range is ~0.10–0.28 dATR in the
  mechanic proof's examples) — reached on a handful of days a year — so
  "10R or EoD" and "EoD" are the same construction to within a few trades.
  E0 is registered as EoD; the 10R cell is printed in the target ladder.
- **Carries over — the instrument.** QQQ is the Nasdaq-100; `US100` is the
  Nasdaq-100 CFD. The 2023 paper is as close to an external replication
  target as this project will get.
- **Does not carry over — the entry.** They enter at the second candle's open
  in the first candle's direction (2023) or on a stop order at the range edge
  (2024). We enter on the **first 5-minute close beyond the range from
  09:35**, which is later and further from the range. The task is to isolate
  the exit, so the entry stays ours; the difference is stated and is one
  reason our numbers may be smaller than theirs. Their entry is logged as the
  one untested ORB *entry* variant (§11), not folded in.
- **Does not carry over — costs.** They model a per-share commission and no
  spread or slippage. On QQQ at $300 that is fine; on a CFD with a 1–2 point
  spread and a stop of 30–40 points it is not, and on `US500` with a ~0.5
  point spread and a 6–7 point stop it is decisive. Our cost model is kept
  verbatim; §5.4 projects `cost_R` per construction, and the 5 %-ATR extreme
  is **not registered** because at our spreads it is a cost test, not an edge
  test — the paper's own caveat, quantified.
- **Does not carry over — relative volume.** The 2024 result is a
  *cross-sectional* selection effect (which stocks are in play today). On a
  single index there is no cross-section; the time-series analogue,
  `or_rvol` (opening-range volume over the prior 20 eligible sessions), was a
  Study B feature on ~1,400 trades and was **not flagged** (5 m SHAP
  direction −0.51, i.e. if anything the wrong sign). Not a variant of this
  family.
- **Does not carry over — era and regime.** 2016–2023 on a cash ETF vs
  2024–2026 on a CFD. That is what the holdout is for.

---

## 3. What the read holdout could have influenced, and what actually drove each choice

| choice | could the holdout have driven it? | what drove it |
|---|---|---|
| **5-minute range only** | **No** — no holdout number exists for any `OR5` arm; both were screened out on the fit period | Highest forward lift on both instruments (1.65 / 1.57, fit); the literature's width in both papers and in Tsai et al. 2018 as cited there; the earliest trigger (median lag 5 min) and hence the longest session for a trend to develop; the largest fit-period template-2 number (+0.122R); and it makes E0 the literal 2023 base stop. |
| Register E0 (no cap, range stop) | Would have argued **against** it — template 2 was ≈ 0 on the holdout at OR10/OR15 | Kept deliberately: E0 is the corner that lets E1 (ratchet) and E2 (stop width) be attributed; dropping the cell the holdout looks bad on is selection in the other direction. Its fit number at OR5 (+0.122R) is known and is the fit screen's business. |
| Register E1 (ratchet) | No — nothing with a trailing stop has been computed on any period | The give-back hypothesis (§4), the one construction that keeps the run and bounds the give-back; parameter-free. |
| Register E2 (0.10 dATR stop) | No — no volatility-sized stop has been computed on any period; S3's midpoint stop was fit-only and capped | The 2024 paper's exit verbatim; the 2023 sweep's direction; the project's cost floor sets the fraction (§4.2, §5.4). |
| Keep US500 | Would have argued for dropping it | Kept as the anti-selection choice, as in the follow-up note §2; the fit screen will remove it mechanically if it deserves removal. |
| No side-split arms | Weakly — US100 holdout template 1 is 56 % long | The fit-period by-side table (§6.4) and the drift confound; a side-split doubles the arm count for a beta-shaped hypothesis. |
| Same trigger, fills, costs, calendar, nulls | No | Verbatim, so the family is like-for-like with both closed passes and the exit is the only variable. |

---

## 4. Ruling 4 — the design space, walked honestly

The user asked for the thinking of the best minds in trading, not a habit.
Here is the full menu I considered, each with the hypothesis it would test
and the ruling. The organising question is not "which exit is best" but
**"where, mechanically, does a real directional lift fail to become money?"**
There are exactly three places it can go: it is **capped** (the target is
below the typical run), it is **given back** (the run happens, then reverses
before the exit), or it is **never reached** because the stop fires on noise
first — and the last one is a statement about the stop, not the target.
Each registered arm is one of those three; everything else is a nested,
derived or uncalibrated version of one of them.

### 4.1 Registered — one arm per hypothesis

| id | construction | hypothesis tested | why this form |
|---|---|---|---|
| **E0** | range stop, **no target**, flat 16:00 NY | **the cap.** The +1R target truncates a right tail that averages more than 1R. | The literal 2023 base (stop at the first candle's extreme, 10R ≈ EoD). Already the project's template 2, so the machinery exists and the 30-min and OR10/15 reads sit beside it as neighbours. The only width where it has never been read. |
| **E1** | range stop, **no target**, **stop ratchets to 1R behind the best price since entry**, flat 16:00 NY | **the give-back.** The run happens (the lift is real) and E0 loses it by holding through the reversal into the close; a ratchet keeps the run and bounds the give-back to 1R. | Trail distance = the initial risk, so there is **no free parameter**: at MFE = 1R the stop is at entry, at 2R it is at +1R, and so on — the continuous version of the cmc-bot bot's "breakeven at 1R, +1R at 2R" rule. E1 **nests** E0 (E1 = E0 + ratchet): if E1 passes and E0 does not, the ratchet is the finding, by construction. |
| **E2** | stop at **entry ∓ 0.10 × dATR14**, no target, flat 16:00 NY | **the stop.** The range stop is several times wider than the noise a genuine breakout must survive; it makes 1R large in price, so the lift is worth ~1R and losers are full-sized. A tight volatility stop makes losers small in price and the same MFE worth many R, so a 30–45 % win rate suffices. | The 2024 paper's stop verbatim (10 % of the 14-day ATR), the 2023 sweep's direction, and — decisively — the fraction the project's cost floor allows (§5.4). dATR14 is read as of the prior session's close and is the project's existing `datr14` feature; it is fixed at 09:30 and does not move with the opening bars, which is why it is preferred to the 5-minute ATR14 (§4.2 item 8). |

### 4.2 Considered and ruled — each with its reason

1. **Fixed multi-R targets on the range stop: 2R, 3R, 5R, 10R.** The user's
   first question. Every one of these is *nested between* the +1R corner
   (quoted) and E0 (registered): as the multiple grows the construction
   converges on E0, and 10R is E0 to within a few trades a year. A fixed
   3R could in principle beat both ends (it banks a trend day before the
   give-back) — but that is the give-back hypothesis, which E1 tests
   without picking a number. **Printed as a fit-only ladder, not
   registered** (§8.2, S-T).
2. **Fixed multi-R targets on the tight stop: 2R .. 10R with 0.10 dATR.**
   Same nesting toward E2; 10R = 1.0 dATR of travel. The 2023 sweep found
   every target below EoD worse. **Fit-only ladder** (S-T).
3. **The 5 %-dATR stop (the 2023 paper's optimum).** Projected `cost_R`
   ≈ 0.09R on US100 and 0.12–0.15R mean (p90 well above 0.3R) on US500 —
   the cmc-bot death zone (Запись 22: 0.25–0.40R killed everything). The
   paper itself says the stop "will likely be exceeded". At our spreads the
   arm would measure the spread, not the edge. **Not registered; printed in
   the stop ladder** (S-K) so the cost gradient is on the record.
4. **Tight stop + ratchet (E2 with E1's trail).** With R = 0.10 dATR the
   ratchet sits 0.10 dATR behind the best price — roughly one 5-minute ATR14
   — and would be hit by ordinary bar-to-bar noise on most trades; it is
   "exit on the first pullback", which is neither paper's construction and
   no trader's. **Not registered.**
5. **Breakeven-at-1R only** (move the stop to entry once +1R is reached, no
   further trail). Strictly nested in E1 — it is E1 with the ratchet frozen
   after its first step. Not a distinct hypothesis. **Not registered.**
6. **Scale-out (half off at +1R, remainder per E1).** Its per-trade net R is
   exactly ½ × (template-1 net R) + ½ × (E1 net R) up to the second exit's
   spread, because the remainder's ratchet path does not depend on the
   partial. It is a portfolio of two cells, not a hypothesis. **Printed as a
   derived row** (§8.2, S-P), computed properly with both exits' costs.
7. **Time-based exits (flat at 11:00 / 12:00 / 14:00 instead of 16:00).**
   The "opening drive only" hypothesis — a real one (the intraday U-shape),
   but it is a clock parameter with no calibration, and the 2023 sweep found
   EoD best. **Fit-only ladder on E0 and E1** (S-C), so the give-back's
   timing is visible without spending α on a minute of the day.
8. **ATR14(5-minute)-multiple stops (0.5×, 1×, 1.5×).** The same idea as E2
   in a different unit: from the mechanic proof's examples, one 5-minute
   ATR14 ≈ 0.11 dATR14 (`or_width_atr` / `or_width_datr` ≈ 9), so 1×ATR14
   ≈ E2's stop. Two units for one idea is a sweep. The daily unit is chosen
   because it is what both papers use, it is fixed before the session opens,
   and the 5-minute ATR at 09:40 is contaminated by the opening bars
   themselves. **Not a separate arm.**
9. **Chandelier / ATR trail (stop = best price − k × ATR).** The same idea
   as E1 with a free parameter. E1's trail distance is 1R by construction;
   S-D prints 0.5R and 2R so the sensitivity is visible. **Not registered.**
10. **No-progress / time stop ("if not +0.5R within 30 min, exit").** Two
    parameters, no calibration, and the smart-money lineage that used such
    rules is closed. **Not registered.**
11. **Stop at the range midpoint.** S3 / S3' already ran it fit-only on all
    fourteen arms with both templates: worse than the range stop on 13 of 14
    with the cap, and worse on template 2 too (`US100-OR5` t2: +0.093R vs
    +0.122R). **Not registered.**
12. **Asymmetric R by side.** Ruled in §6.4: no side-split arms; mandatory
    side rows; a one-sided label.
13. **The papers' entry** (second candle's open in the first candle's
    direction; or a stop order at the range edge) and **the relative-volume
    filter.** Entry variants and a cross-sectional filter — out of this
    family by the task's own instruction to isolate the exit, and with the
    Study B note on `or_rvol` in §2.3. **Logged in §11.**
14. **A different range width for the exit family (10 or 15 minutes).** The
    width axis is closed (Запись 24). One width; if the family passes, width
    is a later sensitivity, not an arm.

**Why three and not eight.** Bonferroni is only the mechanical reason. The
real one is that arms in this family trade the *same days, sides and entries*
— they are one trade stream exited three ways — so extra cells do not add
independent evidence, they add tickets. Three cells that each answer a
different "where is it lost" question, with the fit-only ladders printing the
rest of the R:R picture, is the honest shape.

---

## 5. Ruling 3 — the family `orb-ny-open-exit`

### 5.1 What is common to all six arms — verbatim from `orb-ny-open-short/DESIGN.md`

Opening range = 1-minute high/low over [09:30, 09:35) NY; **trigger = first
5-minute bar opening in [09:35, 12:00) NY whose close is strictly beyond the
range**; entry at that bar's close; one trade per day, no re-entry; NYSE full
days; opening-range completeness (the single 5-minute bin holds ≥ 1 1-minute
bar); exit path walked on the 1-minute tape; stop checked first on a minute
touching both levels; a gapped stop fills at the breaching minute's open;
forced flat at the 16:00 NY minute's close; Capital.com cost = half the entry
minute's `spread_close` + half the exit minute's, over `stop_dist`; no
commission, no financing, **no slippage — so every number is optimistic**, in
the REPORT; fit 2024-01-01 .. 2025-07-31; holdout 2025-08-01 .. 2026-07-31;
tail 2026-08-01 .. 2026-09-11 descriptive. `SEED = 20260916`.

Because the trigger is identical, **the trade list (dates, sides, entries) of
all three constructions on an instrument is the same list**, and it is the
same list as the killed `OR5` template-1 arm of the short pass. `checks.py`
asserts this (§9.3).

### 5.2 The six arms

| # | arm | instrument | stop at entry | after entry | target | flat |
|---|---|---|---|---|---|---|
| 1 | `US100-E0` | US100 | opposite side of the 5-min range | fixed | none | 16:00 NY |
| 2 | `US100-E1` | US100 | opposite side of the 5-min range | **ratchet, 1R behind best price** | none | 16:00 NY |
| 3 | `US100-E2` | US100 | **entry ∓ 0.10 × dATR14** | fixed | none | 16:00 NY |
| 4 | `US500-E0` | US500 | as 1 | as 1 | none | 16:00 NY |
| 5 | `US500-E1` | US500 | as 2 | as 2 | none | 16:00 NY |
| 6 | `US500-E2` | US500 | as 3 | as 3 | none | 16:00 NY |

**The +1R corner** — range stop, +1R target, the short pass's `US100-OR5` /
`US500-OR5` template 1 — is printed beside these on the **fit period only**
(fit mean net R +0.0481R / −0.0295R, quoted from
`research/orb-ny-open-short/results/fit_describe.csv`). **Its holdout is not
computed**: it is a killed arm and computing it would be a look. The grid's
holdout column for that corner is blank, and the blank is the point.

### 5.3 Exact definitions

**E0.** `stop = OR_low` (long) / `OR_high` (short); `R = |entry − stop|`;
`target = +∞ / −∞`; `walk1m` verbatim. This is the closed passes' template 2
on the `OR5` trigger, unchanged.

**E1 — the 1R ratchet.** `stop_0` and `R` as E0. Walked on 1-minute bars
`k = b0 .. b1` (b0 = the minute after the entry minute, b1 = the last minute
ending ≤ 16:00 NY), with `best = entry`, `stop = stop_0`:

```
for k in b0..b1:
    # (i) test minute k against the stop AS OF THE END OF MINUTE k-1
    long:  if o[k] <= stop -> exit at o[k]      (gapped)
           elif l[k] <= stop -> exit at stop
    short: if o[k] >= stop -> exit at o[k]
           elif h[k] >= stop -> exit at stop
    # (ii) then let minute k move the ratchet, for minute k+1 onward
    long:  best = max(best, h[k]);  stop = max(stop, best - R)
    short: best = min(best, l[k]);  stop = min(stop, best + R)
no exit by b1 -> flat at c[b1]
```

The stop only ever tightens. The first live minute is tested against
`stop_0`, so E1 can never exit earlier or worse than E0 on the same minute,
and **on any trade where the ratchet never moved (`stop == stop_0` at exit)
E1's fill is E0's fill, exactly** — a structural identity `checks.py` asserts
on every such trade. Exit cause is `stop` if `stop == stop_0` at exit,
`trail-stop` otherwise, `time-exit` at the flat. Worst case is −1R plus the
gap, as for E0. Using minute k's high to set the stop that is tested on
minute k+1 (never on minute k itself) is what makes the trail free of
intrabar look-ahead; the mechanic proof prints the ratchet path minute by
minute on ten trades.

**E2 — the 0.10 dATR stop.** `dATR14` = Wilder ATR(14) over the session-day
bars (16:00 NY → 16:00 NY) **as of the prior trading day's 16:00 close**,
exactly `features.DayBars.prior(date)["datr14"]` — already built, already
look-ahead-free, already used by `gap_datr` / `or_width_datr`. `stop = entry
∓ 0.10 × dATR14`; `R = 0.10 × dATR14`; `target = ±∞`; `walk1m` verbatim. The
stop is **not** clipped to the range in either direction. A day on which
`DayBars.prior` returns `None` is excluded and counted (it cannot happen after
2022-08 on these tapes). `stop_atr = R / ATR14` at the entry bar is recorded
as before, because Null A sizes placebo stops in that unit.

**The fraction 0.10 is the 2024 paper's number and is not tuned here.** It is
also, by projection, the tightest stop the project's cost floor tolerates on
these spreads (§5.4). Nothing else about it is chosen.

### 5.4 Costs — the projection that must appear in the REPORT

`cost_R = spread / stop_dist`, so it is set by the stop, not the exit. From
the short pass's committed fit tables: `US100-OR5` median `stop_dist` 66.6
points at median `cost_R` 0.0267R (⇒ round-trip spread ≈ 1.8 points);
`US500-OR5` 10.85 points at 0.041R (⇒ ≈ 0.45 points). From the mechanic
proof, an `OR5` range on US100 was 0.10–0.28 dATR14 (dATR14 ≈ 380 points on
2025-03-05). **Projections, not computations:**

| construction | stop, US100 | `cost_R`, US100 | stop, US500 | `cost_R`, US500 |
|---|---|---|---|---|
| E0 / E1 (range) | ≈ 67 pts (median) | ≈ 0.027R (known) | ≈ 11 pts | ≈ 0.041R (known) |
| E2 (0.10 dATR) | ≈ 35–40 pts | **≈ 0.045–0.05R** | ≈ 6–7.5 pts | **≈ 0.06–0.08R** |
| 0.05 dATR (not registered) | ≈ 18–20 pts | ≈ 0.09R | ≈ 3–4 pts | ≈ 0.12–0.15R, p90 > 0.3R |

The REPORT prints the realised `cost_R` distribution per arm, the gross-vs-net
gap, and the sentence: *"on E2 the stop is sized to volatility, not to the
range, so `cost_R` is roughly double E0's; on US500 it approaches the level
at which the project has previously seen costs decide a verdict."* Cost
sensitivities verbatim (2× per-bar spread; fixed fit-median spread), holdout,
non-gating.

### 5.5 Power

The trade list is the `OR5` list: fit 391–392 trades, projected `n_holdout`
≈ 247–249 per instrument (`orb-ny-open-short/DESIGN.md` §8.1), identical for
E0/E1/E2. Floor 150. No contingency exists or is needed; a screened-in arm
realising `n_holdout < 150` is a §10 stop.

---

## 6. Ruling 5 — holdout, Bonferroni, screen, ladder, and what a pass earns

### 6.1 The holdout is re-used a third time, and here is the argument

**The question.** Does an exit family — a different mechanic on the exit side —
earn a fresh holdout and a fresh α, or does it continue the cumulative count?

**Against reuse.** Three looks at one year is a lot. And this family is the
*least independent* reuse possible: its trades are the very same days, sides
and entries as the `OR5` template-1 arms, and on US100 the same days as the
`OR10` / `OR15` / 30-minute arms whose holdout I have read. The directional
content of that year is known to me; only the exit path is unread.

**For reuse.** (i) A fresh holdout does not exist: the tail is
2026-08-01 .. 2026-09-11, ~29 trades. (ii) The only alternative is to defer
the whole family to tape ending 2027-07-31 — a year's wait for the one ORB
question left, which the user has not asked for and which leaves the
question open for no gain in rigour that the cumulative α does not already
buy. (iii) The project's rule for this case exists and was applied once
already: **cumulative Bonferroni over every pre-registered arm judged on that
year, tighten never loosen, a fit-period screen before any holdout number, the
reuse declared in the REPORT's first paragraph.**

**Ruling.** Re-used, as the **third and last** pre-registered ORB look at
2025-08-01 .. 2026-07-31. **Family for α = 8 + 6 + 6 = 20 arms → α = 0.05/20
= 0.0025.** After this family, any further ORB registration on these
instruments — of any kind — must use tape from 2026-08-01 onward; this note
closes the year for ORB. And because a third-look pass is weaker evidence
than a first-look pass, **a REAL EDGE here does not route to a build; it
routes to a pre-committed forward confirmation (§6.5).** That, not a fresh
α, is what a genuinely different mechanic earns from a read holdout.

`REPORT.md`'s first paragraph must say, in these or equivalent words: *"This
family re-uses the 2025-08-01 .. 2026-07-31 holdout, already read by the
closed `orb-ny-open` and `orb-ny-open-short` passes on the same instruments
and days. It is the third and last pre-registered ORB look at that year. α is
corrected for all twenty registered arms. A REAL EDGE reached here is weaker
evidence than a first-read REAL EDGE and earns a forward confirmation on
later tape, not a build."*

### 6.2 The fit-period screen — decided before any holdout number exists

**No arm touches the holdout unless, on the fit period alone:** (1) mean net R
≥ +0.05R, **and** (2) fit-period Null A (1,000 draws, drawn from the arm's own
[09:35, 12:00) trigger window on the fit period) gives p ≤ 0.05. Failing arms
are verdicted **"NO EDGE — KILL (fit screen)"**, their holdout is **never
computed**, and the screen decision is committed into `DESIGN.md` with a hash
**before** any holdout number exists for any arm. Verbatim from the follow-up
note §5.3; nothing tuned. It is known now that `US500-E0`'s fit number is
−0.0489R (it is the short pass's `US500-OR5` template 2), so that arm will be
screened out; it is registered anyway because the count is fixed by
registration, not by survival.

### 6.3 The verdict ladder — verbatim, α substituted

Applied mechanically to each screened-in arm's **holdout mean net R**:

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** Return to Architect. |
| holdout mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.0025 < p ≤ 0.20` | **INCONCLUSIVE.** No build. No follow-up on the exit axis. |
| **all** of: mean net R `≥ +0.10R`; `p ≤ 0.0025`; fit same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; 90 % day-block bootstrap excludes 0; gross `> 0` | **REAL EDGE (third look)** — routes to Architect; **forward confirmation required before any build ruling** (§6.5). |

Nulls and interval verbatim from `orb-ny-open-short/DESIGN.md` §6: Null A
(matched-time placebo, 1,000 draws, placebo keeps the trade's side and
`stop_atr`, **and is exited by the arm's own template** — the ratchet for E1,
the fixed stop and flat for E0/E2), Null B (day shift, 250, reported not
gating), 90 % day-block bootstrap (2,000). The bars stay in R: the ladder is
expectancy per unit risk, which is what a trader sizes on. Because R differs
by construction (E2's is roughly half of E0's in price), §8.1 adds a
**common-scale row** so the constructions can also be compared in one unit.

### 6.4 Two reading rules, pre-committed

**Attribution.** The REPORT's first results table is the full 2 × 4 grid per
instrument — the quoted +1R corner (fit only, holdout blank), E0, E1, E2 —
fit and holdout, `n`, `p_A`, interval, screen status, verdict. No cell is
reported without the others. For any arm that passes, the REPORT states
which axis carried it, by construction: E1 passing with E0 killed ⇒ the
ratchet (give-back); E0 passing ⇒ the cap; E2 passing with E0 killed ⇒ the
stop width; E0 and E2 both passing ⇒ the cap, with the stop width not
separately supported. This is not a veto — the cells are hypotheses, not
doses, and a lone pass at α = 0.0025 is what the correction is for — it is
the sentence the reader is owed.

**One-sided — flagged.** Fit-period long/short means, template 1, from both
passes: US100 longs beat shorts at every width (OR5 +0.066R vs +0.031R; OR10
+0.139R vs +0.022R; OR15 +0.158R vs +0.028R; OR30 +0.064R vs +0.050R). US500
has no pattern (OR5 −0.076R vs +0.019R; OR10 −0.030R vs −0.062R; OR15
+0.019R vs +0.012R). The 2023 paper reports 51 % long / 49 % short with beta
≈ 0. The US100 long premium was measured on a rising fit tape and is at least
partly drift; Null A is side-matched and controls for it at the arm level,
which is why arms stay symmetric. Rule: **the long/short split is printed for
every arm on fit and holdout; an arm reaching REAL EDGE whose holdout mean
net R on either side is ≤ 0 is labelled "one-sided — flagged" in the verdict
table.** It still routes to the Architect; the forward confirmation (§6.5) is
then run side-split, and the build ruling must treat the result as
directional. No side-only arm is registered, now or as a follow-up, on this
holdout.

### 6.5 What a pass earns — the forward confirmation, committed now

For every arm verdicted REAL EDGE (third look), the Researcher **writes and
commits a frozen script in the same dispatch**, `forward_confirm.py`, that:

- runs the arm's exact construction on tape from **2026-08-01 onward**, NYSE
  days, same trigger, fills, costs;
- **refuses to run** until that window holds **≥ 150 triggered days** for the
  arm (projected ≈ 2027-03-01) — it may print the trigger count, never an R;
- is computed **once**, at α = 0.05 / (number of REAL EDGE arms), same ladder,
  same Null A / Null B / bootstrap, gross > 0, side-split printed;
- a pass there is the evidence a build ruling is written on; a miss there is
  a kill of the arm, not a rework.

This is the ETH template-2 deferral applied to the case where the fit
evidence is stronger, and it is the only honest way to turn a third look at a
read year into something a build can rest on. **No Software Engineer or
Backtesting engagement follows from this family on the holdout read alone.**

---

## 7. Ruling 6 — instruments, and crypto

**US100 and US500, 5-minute range, both.** US500's every fit number is at or
below zero (template 1 −0.030R at OR5, template 2 −0.049R), its spread is
1.8× US100's as a fraction of the range, and E2 will pay ≈ 0.06–0.08R on it.
It stays for the same reason it stayed last time: both instruments hold a
cash-open auction, the hypothesis is about that auction, and removing the
weaker instrument after seeing it is selection. The screen removes what
deserves removal, mechanically, before the holdout.

**Crypto: not in this family.** The parallel Architect dispatch on the
crypto NY-open anchor (`ARCHITECT-NOTE-CRYPTO-INVESTIGATION.md`) has not
reported as of this note — the file does not exist on any branch. The
follow-up note §3.1 removed crypto on its own pre-registered control (pre-ETF
row indistinguishable from the ETF era) and the standing nulls on clock
structure (Записи 2, 18). Until that investigation says the anchor is real,
adding BTC/ETH arms here would be guessing, and adding them *after* this
family's holdout is cut would change the α denominator retroactively, which
the count rule forbids. **Ruling:** if the crypto investigation concludes
the anchor is real, crypto gets **its own exit family**, same three
constructions, on the **deferred window 2026-08-01 .. 2027-07-31** (the
crypto holdout has been read once and its anchor evidence is contested — it
does not get a third look), with its own count. One datum already belongs to
it: the closed pass's ETH template 2 (= E0's shape, 30-min range) cleared
+0.10R on the holdout without a null and is already frozen as a deferred
registration (`deferred_eth_t2.py`); a crypto exit family would subsume, not
duplicate, that script.

---

## 8. Mandatory descriptive rows and the fit-only ladders

### 8.1 Per arm, fit and holdout, always — no verdict attaches

- `n`, mean / median net R, gross R, mean / median / p90 `cost_R`, win rate,
  % long, median `stop_atr`, median `stop_dist` (points), median hold; exit
  causes (`stop` / `trail-stop` / `time-exit`); **mean win R, mean loss R**
  (the payoff asymmetry the 2023 paper's result lives on); long/short split
  **on fit and holdout** (§6.4).
- **Common-scale row:** mean net PnL per trade in **dATR14 units** and in
  points, per arm, so E0/E1 (large R) and E2 (small R) are compared on one
  scale. The ladder does not read this row.
- **Forward lift** (verbatim `block_L`, [09:35, 12:00) window): printed
  **once per instrument** — it is a property of the trigger and is identical
  across E0/E1/E2 by construction; the REPORT says so rather than printing it
  three times.
- **Harvest ratio:** per trade, realised net R divided by the trade's MFE in
  R over the same horizon as the lift (entry → 16:00 NY); median per arm,
  fit and holdout. This is the direct "how much of the excursion did the
  construction keep" number, and it is the diagnostic that says *where* the
  lift went on the arms that die.

### 8.2 Fit-only sensitivities — descriptive, non-gating, every one printed including the worse ones

These answer the user's R:R questions as **shapes**, without spending α.
None can create, upgrade or downgrade a verdict, and none is computed on the
holdout.

| # | ladder | cells | on |
|---|---|---|---|
| S-T | **fixed target** | 2R, 3R, 5R, 10R (1R quoted; EoD = the arm) | the range stop (E0) **and** the 0.10 dATR stop (E2) |
| S-K | **stop fraction**, EoD exit | 0.05, 0.15, 0.25 dATR (0.10 = E2; range = E0), with `cost_R` per cell | E2 |
| S-C | **time exit** | flat at 11:00, 12:00, 14:00 NY (16:00 = the arm) | E0 and E1 |
| S-D | **trail distance** | 0.5R, 2R (1R = the arm) | E1 |
| S-P | **scale-out**, derived | half off at +1R, remainder per E1; computed per trade with both exits' spreads | E1 + quoted template 1 |

Each ladder is printed with the registered cell marked, in one table per
instrument. **No "best cell" sentence exists anywhere in the deliverable**;
the ladders are shapes, and the REPORT describes the shape (monotone, flat,
peaked) in one sentence each. A ladder cell that would clear the build bar on
the fit period generates **no follow-up of any kind** — it is a note for the
backlog, and only a fresh registration on 2026-08+ tape could test it.

**No Study B.** No model is trained, no feature flagged.

---

## 9. Ruling 8 — what the Researcher forks, adds and checks

**Fork `research/orb-ny-open-short/` → `research/orb-ny-open-exit/`** (copy;
the short package is a finished record and is not edited). Tapes: **copy or
symlink `research/cmc-bot-vwap/data/` from the main checkout into the
worktree, never re-pull**; re-run the coverage audit and confirm the committed
`COVERAGE.md` rows reproduce byte-identically (follow-up note §8, verbatim).

| file | action | what changes |
|---|---|---|
| `common.py` | parametrise | `OR_WIDTHS = (5,)`; `CONSTRUCTIONS = ("E0", "E1", "E2")`; `ARM_SPECS = [(sym, "E0"/"E1"/"E2")]`; `DATR_FRAC = 0.10`; `TRAIL_R = 1.0`; `N_ARMS_CUMULATIVE = 8 + 6 + 6 = 20`, `ALPHA = 0.05/20`; ladder constants unchanged; sensitivity constants for S-T/S-K/S-C/S-D. |
| `engine.py` | **add** `walk1m_trail` (numba) per §5.3, and `stop_mode="datr"` in `build_arm` reading `features.DayBars.prior(date)["datr14"]`; `_evaluate` walks E0 (existing `walk1m`, ±∞ target), E1 (`walk1m_trail`), E2 (`walk1m`, ±∞) and records exit cause, `stop_at_exit`, `best_px`; `walk1m`, `cost_R`, fills, calendar **untouched**. Also a **pure-Python reference** `walk1m_trail_ref` for the §9.3 check. |
| `features.py` | keep | `DayBars` is the dATR source; feature columns are built for the mechanic proof and Null A only. |
| `build.py` | rewrite the arm loop | six arms; the quoted +1R corner read from `research/orb-ny-open-short/results/` (never recomputed); S-T/S-K/S-C/S-D/S-P; fit-period Null A per arm **before** any holdout. |
| `analysis.py` | adapt | the screen; `holdout` refuses screened-out arms; Null A exits placebos by the arm's own template; ladder at α = 0.0025; §6.4 labels; harvest ratio and common-scale rows; forward lift once per instrument. |
| `checks.py` | extend | §9.3 below. |
| `mechanic_proof.py` | extend | ten fit-period trades **per construction**, minute by minute; for E1 the ratchet path (best, stop) per minute until exit; for E2 the dATR14 value, its source session bar, and the stop. |
| `report.py`, `handoff.py` | adapt | first paragraph = §6.1 declaration; first table = the full grid (§6.4); ladders per §8.2. |
| `forward_confirm.py` | **new, only on a REAL EDGE** | §6.5; refuses to run before ≥ 150 triggered days from 2026-08-01. |
| `DESIGN.md` | new, from this note | committed **before any R is computed on any arm of this family**. |

### 9.3 Checks — before any number counts

1. **Coverage** byte-identical (as before). **Grid**: 09:30 / 09:35 / 11:00 /
   12:00 / 14:00 / 16:00 NY on the 5-minute epoch grid on every session day.
2. **Same trade list.** The (date, side, entry) triples of E0, E1, E2 on an
   instrument are identical to each other **and to the short pass's
   `US100-OR5` / `US500-OR5` table** (read from its committed
   `results/trades_all.parquet` or equivalent). Any difference is a stop.
3. **Fills, fixed-stop arms (E0, E2):** the existing 1m-vs-bar agreement
   check verbatim, with the narrowed exclusion clause of the short pass's
   §12 amendment.
4. **Fills, E1:** (a) `walk1m_trail` (numba) and `walk1m_trail_ref` (pure
   Python) agree **exactly** on every trade, all periods; (b) on every trade
   where `stop_at_exit == stop_0`, E1's exit minute, price and cause equal
   E0's **exactly**; (c) on every trade, E1's exit minute ≤ E0's and E1's
   net R ≥ E0's net R − (spread difference) is **not** asserted — it is false
   in general (a ratchet can exit a trade that E0 would have held to a better
   close) — and the REPORT prints the share of trades where E1 beat E0 and
   where it did not, both directions.
5. **dATR look-ahead:** on 20 sampled E2 trades across fit and holdout,
   `dATR14` recomputed from a 1-minute tape **truncated at 09:30 NY of the
   trade day** equals the value used, exactly.
6. **Session:** 0 trades cross 16:00 NY on any arm.
7. **Screen before holdout:** `analysis.py holdout` refuses to run without
   `results/fit_screen.csv`, and computes nothing for a screened-out arm or
   for the quoted +1R corner.

---

## 10. Order of work and stop rules (for the dispatch)

1. Fork; copy tapes; coverage audit. **No R.**
2. Parametrise per §9; `DESIGN.md` from this note, **committed before any
   R**.
3. Mechanic proof (30 trades), checks 1–6.
4. Fit-period numbers, all six arms; ladders S-T/S-K/S-C/S-D/S-P; fit-period
   Null A per arm. **Screen decision committed into `DESIGN.md`.**
5. **Holdout, once**, screened-in arms only; ladder at α = 0.0025; §6.4
   labels; harvest ratio, common-scale, side rows.
6. `REPORT.md` (first paragraph §6.1, first table §6.4), `HANDOFF.md`,
   `RESEARCH-LOG.md` Запись **regardless of outcome** — a kill is a result.
   `forward_confirm.py` committed for every REAL EDGE arm; if there is none,
   the REPORT says so in one line.
7. **Stop and return to the Architect** if: the coverage audit does not
   reproduce; the grid check fails; the trade lists differ (check 2); the
   fixed-stop fill check fails; the two E1 implementations disagree, or E1 ≠
   E0 on an unmoved-ratchet trade; the dATR recomputation differs; any trade
   crosses 16:00; `n_holdout < 150` on a screened-in arm; or the
   pre-registration is ambiguous in a way that changes a number. Nothing
   about fills, costs, calendar, nulls, bootstrap or the ladder other than α
   may be rewritten locally.

---

## 11. Explicitly not ruled here, and what a full kill means

- **The papers' entry** (second candle's open in the first candle's
  direction, no close-beyond confirmation; or a stop order resting at the
  range edge) — the one ORB *entry* variant this project has not tested. It
  would trade every day, earlier and closer to the range, at a lower win
  rate. Logged in `IDEAS-BACKLOG.md`; if wanted, it is a fresh registration
  on 2026-08+ tape with its own count, never a cell here.
- **Relative volume as a filter** — cross-sectional in the paper; on a single
  index `or_rvol` was tested in Study B and not flagged (§2.3). Logged, not
  registered.
- **Crypto** — §7.
- **Software Engineer / Backtesting** — only after a REAL EDGE (third look)
  passes its forward confirmation and a further Architect build ruling.

**If all six arms die**, the ORB line on these tapes is closed on the exit
axis as it already is on the width/timing axis, and the sentence that
survives is the same one, sharpened: *the breakout selects direction, and no
exit construction with a mechanism — capped, uncapped, ratcheted, or
volatility-stopped — converts it at realistic costs.* The only ORB items left
would be the frozen deferred scripts and the entry variant above, and the
backlog will say so, so that nobody re-opens this because "nobody tried a
1.5-ATR trail".
