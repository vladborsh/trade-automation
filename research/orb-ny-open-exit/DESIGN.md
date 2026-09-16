# DESIGN — ORB exit construction at the New York open (`orb-ny-open-exit`)

**Status:** pre-registration, **committed before any R was computed on any arm
of this family**. Mechanical restatement of
`research/orb-ny-open/ARCHITECT-NOTE-EXIT-CONSTRUCTION.md` (commit `89365fd`,
2026-09-16), which is the binding document; it in turn inherits everything
from `ARCHITECT-NOTE.md` (`7ff19fc`) and `ARCHITECT-NOTE-FOLLOWUP.md`
(`86ddf55`) that it does not explicitly change. Where this file and the
Architect note disagree, **the note wins and this file is the bug**.

**Forked from `research/orb-ny-open-short/` (the width family).** That package
is a finished record and is not edited. The trigger, the fills, the cost
model, the calendar, the nulls, the bootstrap, the descriptive rows and the
verdict ladder are carried over **verbatim**; the only constant that changes
is `ALPHA`, and it only tightens.

**This family reads the 2025-08-01 .. 2026-07-31 holdout for the THIRD AND
LAST time.** α = 0.05/20 = 0.0025, cumulative over every arm ever
pre-registered against that year. A REAL EDGE reached here does **not** route
to a build; it routes to a pre-committed forward confirmation on tape from
2026-08-01 onward (§9.4). After this family, any further ORB registration on
these instruments must use tape from 2026-08-01 onward: this pass closes the
year for ORB.

---

## 0. The question, and why the exit is the axis

Two closed passes, fourteen arms, end on one sentence: **after the trigger the
tape moves further in the breakout direction than a random comparable bar**
(median forward lift 1.04–1.65 on every arm, computed without using the
trade's outcome), **and the +1R-target / full-range-stop construction converts
none of it** (holdout −0.123R .. +0.047R, every arm killed). That is a
statement about the exit, not about the entry.

So the entry is frozen and the exit becomes the axis. There are exactly three
places a real directional lift can fail to become money:

| where it is lost | the hypothesis | the arm |
|---|---|---|
| **capped** — the target sits below the typical run | remove the target | **E0** |
| **given back** — the run happens, then reverses before the exit | bound the give-back without capping the run | **E1** |
| **never reached** — the stop fires on noise before the move | size the stop to volatility, not to the range | **E2** |

Nothing else is registered. Every other construction considered is nested in
one of these, a linear combination of two of them, cost-dead by projection, or
a parameter with no calibration; the Architect note §4.2 rules on each one
individually, and the ones worth seeing are printed as **fit-only descriptive
ladders** (§3.7) so the full risk:reward picture is on the record without
spending α on it.

**The external anchor.** E0 is the Zarattini–Aziz 2023 base shape (5-minute
range, stop at the first candle's extreme, no meaningful target, flat at the
close) on this project's own trigger; E2 is the Zarattini–Barbon–Aziz 2024
exit verbatim (stop at 10 % of the 14-day ATR, no target, flat at 16:00). The
2023 result on QQQ — the Nasdaq-100, i.e. `US100`'s underlying — was 1,795
trades, **24 % win rate, +0.13R per trade**, Sharpe 1.12: a losing majority
paid for by a right tail that a +1R target would have cut off. What does *not*
carry over is stated where it matters: their entry is earlier and closer to
the range than ours (§3.2), and they model a per-share commission with **no
spread and no slippage**, which is not a survivable omission on a CFD (§5).

**The honest prior is low-to-moderate, and the likeliest outcome is six
kills.** Against the hypothesis: the no-target shape was ≈ 0 on this same
holdout at the 10- and 15-minute widths (+0.002R / −0.002R); our tight-stop
arm pays a spread the papers do not; and this project's experience with small
stops is uniformly bad (`cmc-bot` Запись 22: `cost_R` of 0.25–0.40R killed
everything). For it: the mechanism is specific, the external anchor is on the
closest available instrument, and the one number we already have on our own
tape for E0's shape at this width (`US100-OR5`, no target, fit period,
**+0.122R**) is consistent with it.

---

## 1. The six pre-registered arms

Two instruments × three exit constructions, on the **5-minute** opening range.

| # | arm | instrument | stop at entry | after entry | target | flat | hypothesis |
|---|---|---|---|---|---|---|---|
| 1 | `US100-E0` | US100 | opposite side of the 5-min range | fixed | **none** | 16:00 NY | the cap |
| 2 | `US100-E1` | US100 | opposite side of the 5-min range | **ratchet, 1R behind the best price** | **none** | 16:00 NY | the give-back |
| 3 | `US100-E2` | US100 | **entry ∓ 0.10 × dATR14** | fixed | **none** | 16:00 NY | the stop width |
| 4 | `US500-E0` | US500 | as 1 | as 1 | **none** | 16:00 NY | the cap |
| 5 | `US500-E1` | US500 | as 2 | as 2 | **none** | 16:00 NY | the give-back |
| 6 | `US500-E2` | US500 | as 3 | as 3 | **none** | 16:00 NY | the stop width |

`common.py:ARM_SPECS` is exactly this list, in this order. The count is fixed
by registration, not by survival: an arm whose fit number is already known to
be negative is registered anyway and charged to α.

**One width only.** The width axis is closed (`RESEARCH-LOG.md` Запись 24).
The 5-minute range is chosen because it has the highest forward lift on both
instruments (1.65 / 1.57, fit), is the width of both Zarattini papers, gives
the earliest trigger and hence the longest session for a trend to develop,
carries the largest fit-period no-target number (+0.122R), and makes E0 the
literal 2023 base stop. If this family passes, width is a later sensitivity,
never an arm here.

**Both instruments, including the weak one.** Every fit number `US500` has is
at or below zero, its spread is 1.8× `US100`'s as a fraction of the range, and
E2 will pay ≈ 0.06–0.08R on it. It stays because both instruments hold a cash
open auction, the hypothesis is about that auction, and removing the weaker
instrument after seeing it is selection. The §8 screen removes what deserves
removal, mechanically, before the holdout.

**No side-split arms.** `US100` longs beat shorts on the fit period at all four
widths, but the fit period is a rising tape and the long premium is at least
partly drift; Null A is side-matched and controls for it at the arm level. The
long/short split is printed for every arm on fit **and** holdout, and a passing
arm with a non-positive side gets the "one-sided — flagged" label (§9.3). No
side-only arm is registered, now or as a follow-up, on this holdout.

**No crypto.** The parallel crypto NY-anchor investigation has not reported. If
it concludes the anchor is real, crypto gets its own exit family on the
deferred 2026-08-01 .. 2027-07-31 window with its own count — never a late
addendum here, because adding arms after this holdout is cut would change the
α denominator retroactively.

**No Study B.** No model is trained and no feature is flagged. The feature
vector is built for the mechanic proof and for Null A's `stop_atr` only.

### 1.1 The +1R corner is quoted, never re-run

The fourth cell of each instrument's exit grid is the **already-killed +1R
target on the range stop** — the short pass's own `US100-OR5` / `US500-OR5`
template 1. It is **read** from
`research/orb-ny-open-short/results/fit_describe.csv` into
`results/quoted_corner.csv` on the **fit period only** (fit mean net R
**+0.0481R** / **−0.0295R**), never recomputed and never re-judged.

**Its holdout is not computed. The grid's holdout column for that corner stays
blank, and the blank is the point:** it is a killed arm, and computing it would
be a look this family has not paid for.

---

## 2. Data

### 2.1 Sources — the cached, audited 1-minute tapes; no re-pull

`research/cmc-bot-vwap/data/US100_1m.parquet` and `US500_1m.parquet`
(Capital.com mids, `(ask+bid)/2` per `mapMarketDataToChartData`, with
`spread_close = ask − bid` at each minute's close). They are gitignored and
therefore absent from a fresh worktree; they were **copied** from the main
checkout, never re-pulled (note §9) — a re-pull takes 45+ minutes and would
produce a tape that no longer matches the audited one.

No native 5m pull exists and none is used: the 5m bars are resampled from the
1m tape by `common.py:resample`, and the exit path is walked on the 1m tape.

### 2.2 The tape-integrity check, run before anything was computed

`prep_data.py US100 US500` was re-run from the raw NDJSON in the worktree and
its output compared with the committed
`research/cmc-bot-vwap/results/COVERAGE.md`:

- regenerated `US100_1m.parquet` MD5 `d31941693e2943bd101cc46b894d5885` —
  **identical** to the copied file, to the main checkout's, and to the MD5 the
  short pass committed;
- regenerated `US500_1m.parquet` MD5 `2b548cc6f0762ee3b3475f17b62b1361` —
  **identical**;
- the `US100` and `US500` summary rows and per-instrument coverage blocks of
  `COVERAGE.md` reproduce **byte-identically** (diffed, empty).

Quoting the audited rows, unchanged from both closed passes:

| symbol | bars | first bar (UTC) | last bar (UTC) | dup ts | non-monotone | zero-volume bars |
|---|---|---|---|---|---|---|
| US100 | 971,812 | 2024-01-01 23:01 | 2026-09-11 20:59 | 0 | 0 | 0 |
| US500 | 954,943 | 2024-01-01 23:01 | 2026-09-11 20:59 | 0 | 0 | 0 |

A failure to reproduce would have been a §11 stop. It did not occur.
`research/cmc-bot-vwap/results/COVERAGE.md` was restored to its committed
content afterwards (the re-run drops the `EURCHF`/`GBPCHF` blocks, which were
not re-audited and are not read by this package).

### 2.3 Resampling and the clock grid

5-minute bins on the **UTC epoch grid**, labelled by OPEN time, `open` = first
1m open, `high` = max, `low` = min, `close` = last 1m close, `volume` = sum,
`spread_close` = the bin's last 1m bar's spread. **A bin with no 1m bar is
ABSENT** — not forward-filled, not zero-filled.

Because 09:30 NY is an exact multiple of 5 minutes past the epoch under either
DST offset, the NY-anchored and UTC-aligned 5-minute grids are the same
object. `checks.py grid` asserts this on every session day for every clock
point this family reads — 09:30, **09:35**, 11:00, 12:00, 14:00, 16:00 NY.

### 2.4 Eligible days — the NYSE calendar, verbatim

Full NYSE trading days only: weekday, not a holiday, not a 1:00 pm ET early
close. Early closes are excluded as full days because the 16:00 NY forced flat
does not exist on them. The holiday and early-close lists in `common.py` are
byte-for-byte the closed pass's.

### 2.5 Opening-range completeness

A day is eligible only if the single 5-minute bin inside [09:30, 09:35) NY
carries **≥ 1** 1-minute bar. Ineligible days are counted by
`engine.eligibility()`, never silently dropped.

### 2.6 Split — one calendar for all six arms, by NY session date

| period | window | use |
|---|---|---|
| fit | 2024-01-01 .. 2025-07-31 | every number, every ladder, the screen |
| **holdout** | **2025-08-01 .. 2026-07-31** | **read ONCE, screened-in arms only. THIRD AND LAST ORB look.** |
| tail | 2026-08-01 .. 2026-09-11 | descriptive only (~29 trades); also the window `forward_confirm.py` will eventually read |

Never re-cut. `SEED = 20260916`.

---

## 3. The signal and the three exits

### 3.1 Opening range

`OR_high` / `OR_low` = max high / min low of the **1-minute** bars with open
time in **[09:30, 09:35) NY**. Identical for all three constructions.

### 3.2 Trigger — identical for all three constructions

The **first 5-minute bar opening in [09:35, 12:00) NY whose CLOSE is strictly
beyond the range**; `side = +1` if the close is above `OR_high`, `−1` if below
`OR_low`. Close-beyond, never a touch. Entry = that bar's close. **One trade
per day, no re-entry.**

Because the trigger is identical, **the (date, side, entry) triples of E0, E1
and E2 on an instrument are the same list, and it is the same list as the
short pass's killed `US100-OR5` / `US500-OR5` arm.** `checks.py tradelist`
asserts exactly that, against the short package's own unmodified code
executing itself, and any difference is a §11 stop rule.

*What does not carry over from the papers.* They enter at the second 5-minute
candle's open in the first candle's direction (2023) or on a resting stop order
at the range edge (2024). We enter on the first 5-minute **close** beyond the
range, which is later and further from the range. The task is to isolate the
exit, so the entry stays ours; the difference is one reason our numbers may be
smaller than theirs, and their entry is logged as the one untested ORB *entry*
variant, not folded in here.

### 3.3 E0 — the cap hypothesis

`stop = OR_low` (long) / `OR_high` (short). `R = |entry − stop|`.
`target = +∞ / −∞` — **no target**. Forced flat at the 16:00 NY minute's
close. `walk1m` verbatim.

This is the closed passes' "template 2" on the `OR5` trigger, unchanged, and
the literal 2023 base shape. On our tape a 10R target on the range stop is
≈ 1.6 daily ATRs of intraday travel from a 09:40 entry — reached on a handful
of days a year — so "10R or end of day" and "end of day" are the same
construction to within a few trades. E0 is registered as end-of-day; the 10R
cell is printed in the S-T ladder.

### 3.4 E1 — the give-back hypothesis: a parameter-free 1R ratchet

`stop_0` and `R` exactly as E0. **No target.** Walked on 1-minute bars
`k = b0 .. b1` (`b0` = the minute after the entry minute, `b1` = the last
minute ending ≤ 16:00 NY), with `best = entry`, `stop = stop_0`:

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

- **Trail distance = the initial risk, so there is no free parameter.** At
  MFE = 1R the stop is at entry, at 2R it is at +1R, and so on — the
  continuous version of the `cmc-bot` bot's "breakeven at 1R, +1R at 2R" rule.
- **The stop only ever tightens**, and minute k is tested against the stop as
  of the end of minute k−1 — never against a stop that minute k's own high
  moved. That is what makes the trail free of intrabar look-ahead.
- **E1 nests E0.** The first live minute is tested against `stop_0`, so E1 can
  never exit earlier or worse than E0 on the same minute, and **on any trade
  where the ratchet never moved (`stop_at_exit == stop_0`) E1's fill is E0's
  fill, exactly** — a structural identity `checks.py trail` asserts on every
  such trade. If E1 passes and E0 does not, the ratchet is the finding, by
  construction.
- Exit cause is `stop` when `stop_at_exit == stop_0`, `trail-stop` otherwise,
  `time-exit` at the flat. Worst case is −1R plus the gap, as for E0.
- **E1 is NOT asserted to beat E0 per trade, and it will not always.** A
  ratchet can exit a trade that E0 would have held to a better close. The share
  of trades where E1 beat E0 and where it did not is **printed in both
  directions** in `REPORT.md` and in `results/checks.json`.
- `walk1m_trail` (numba) is cross-checked against `walk1m_trail_ref`, an
  independently written pure-Python implementation of the same rule, on
  **every trade of every period**; they must agree exactly on exit index,
  price, cause, stop at exit and best price. A disagreement is a §11 stop rule,
  not a debugging session.

### 3.5 E2 — the stop-width hypothesis: a 0.10 × dATR14 stop

`dATR14` = Wilder ATR(14) over **session-day bars** (16:00 NY → 16:00 NY),
read **as of the prior trading day's 16:00 close** — exactly
`features.DayBars.prior(date)["datr14"]`, the project's existing feature,
already used by `gap_datr` and `or_width_datr`. It is fixed before the session
opens and cannot move with the opening bars, which is why it is preferred to a
5-minute ATR14 that a 09:40 entry would have contaminated with the opening
bars themselves.

`stop = entry ∓ 0.10 × dATR14`; `R = 0.10 × dATR14`; `target = ±∞`; `walk1m`
verbatim; flat at 16:00 NY. **The stop is not clipped to the range in either
direction.**

`stop_atr = R / ATR14` at the entry bar is recorded as before, because Null A
sizes its placebo stops in that unit — which is how an E2 placebo carries an
E2-sized stop.

**The fraction 0.10 is the 2024 paper's number and is not tuned here.** It is
also, by projection, the tightest stop this project's cost floor tolerates on
these spreads (§5). Nothing else about it is chosen. The 2023 paper's own
optimum, 0.05 dATR, is **not registered** — at our spreads it projects to
`cost_R` ≈ 0.09R on US100 and 0.12–0.15R on US500 with p90 well above 0.3R, so
the arm would measure the spread rather than the edge, which is the paper's own
caveat quantified. It is printed in the S-K ladder so the cost gradient is on
the record.

### 3.6 E2's dATR14 warm-up — the one exclusion, and the note's erratum

Architect note §5.3 says, of E2: *"A day on which `DayBars.prior` returns
`None` is excluded and counted (it cannot happen after 2022-08 on these
tapes)."* **The parenthetical is a factual error about these tapes and is
recorded here as an erratum.** These Capital.com tapes begin 2024-01-01, not
2022-08; the session-day bars therefore begin 2024-01-02, and Wilder ATR(14)
over them is first finite on the bar labelled 2024-01-18. So `DayBars.prior()`
returns `None` on exactly **12 triggered days per instrument, all in January
2024**: 2024-01-02, 03, 04, 05, 08, 09, 10, 11, 12, 16, 17, 18.

The operative clause of §5.3 — "excluded and counted" — is applied, and the
Architect was asked before any R was computed rather than the collision with
`checks.py tradelist` being resolved locally:

- **E2 excludes those 12 days on each instrument**, because it has no defined
  stop on them. They are listed, per day and per side, in
  `results/exclusions.csv`.
- `checks.py tradelist` asserts the trade list **exactly** for E0 and E1
  against the short pass's own `US100-OR5` / `US500-OR5` table, and for E2 on
  the subset of days where a stop is defined — additionally asserting that the
  excluded set is **exactly** the `DayBars.prior() is None` set, that it is no
  larger, and that E2 has no day the reference list lacks.
- **The holdout and the tail are entirely unaffected**: zero excluded days lie
  outside the fit period, so every holdout `n` is identical across all six arms
  and the screen/holdout comparison stays like-for-like.
- E0's fit number therefore remains directly comparable to the short pass's
  committed no-target number on the same arm, which is the cross-pass
  consistency row in `REPORT.md`.

**Process note, for the record.** The Architect was asked before any R was
computed on any arm (`orca orchestration ask`, thread `msg_b110864722e0`),
with both readings and their costs set out. The question timed out unanswered
after 900 s and was re-sent as a durable escalation (`msg_690967473a50`). The
clause applied is the note's **own operative instruction**, so this is the
specification rather than a local decision: the alternative — dropping those
12 days from all six arms — would have been the deviation, because it breaks
the cross-pass trade-list identity the note asserts three times.

Because that alternative could in principle have moved a marginal fit screen,
the fit-period numbers for all six arms **under both readings** are computed
and printed as a **descriptive, non-gating robustness annex**
(`results/fit_erratum_annex.csv`), so the effect of the ruling on the screen is
auditable rather than asserted. The annex reads no holdout number and no
verdict reads the annex.

Nothing else about fills, costs, calendar, nulls, bootstrap or the ladder is
changed. Amendment logged in §12.

### 3.7 Fill convention — one, realistic, on the 1-minute path

The exit path is walked on the **1-minute** tape from the minute after the
entry minute to the last minute ending ≤ 16:00 NY:

- **the stop is checked first** on a minute touching both levels (no arm here
  has a second level, so this only binds in the S-T ladder);
- **a stop the minute GAPPED through fills at that minute's OPEN**, not at the
  stop level — the pessimistic convention;
- no exit by the last live minute → **forced flat at its close**;
- **no slippage is modelled anywhere, so every number in this package is
  optimistic.** That sentence appears in `REPORT.md`.

`checks.py fills` asserts, for the fixed-stop arms E0 and E2, that on every
trade which neither gapped its stop nor resolved an ambiguity the 1-minute path
fill and the 5-minute-bar-OHLC fill agree exactly, with the short pass's §12
narrowed exclusion clause verbatim. E1 has no bar-OHLC analogue and is checked
by `checks.py trail` instead.

### 3.8 Fit-only descriptive ladders — non-gating, every cell printed

**None of these can create, upgrade or downgrade a verdict. None is ever
computed on the holdout. There is no "best cell" sentence anywhere in the
deliverable** — they are shapes, and `REPORT.md` describes each shape in one
sentence (monotone / flat / peaked). A ladder cell that would clear the build
bar on the fit period generates **no follow-up of any kind**; it is a backlog
note, and only a fresh registration on 2026-08+ tape could test it.

| # | ladder | cells | on |
|---|---|---|---|
| S-T | fixed target | 2R, 3R, 5R, 10R (1R quoted; EoD = the arm) | the range stop (E0) **and** the 0.10 dATR stop (E2) |
| S-K | stop fraction, EoD exit | 0.05, 0.15, 0.25 dATR (0.10 = E2; range = E0), with `cost_R` per cell | E2 |
| S-C | time exit | flat at 11:00, 12:00, 14:00 NY (16:00 = the arm) | E0 and E1 |
| S-D | trail distance | 0.5R, 2R (1R = the arm) | E1 |
| S-P | scale-out, **derived** | half off at +1R, remainder per E1; computed per trade with **both** exits' spreads | E1 + the quoted +1R corner |

---

## 4. Descriptive rows, always reported, no verdict attached

Per arm, **fit and holdout**: `n`, mean / median net R, mean gross R, mean /
median / p90 `cost_R`, win rate, % long, median `stop_atr`, median `stop_dist`
in points, median hold in minutes, exit-cause counts
(`stop` / `trail-stop` / `time-exit`), **mean win R and mean loss R** (the
payoff asymmetry the 2023 paper's result lives on), and the **long/short split
on fit and holdout**.

- **Common-scale row.** Mean net PnL per trade in **points** and in **dATR14
  units**, per arm, so E0/E1 (large R) and E2 (small R, roughly half E0's in
  price) can be compared on one scale. **The ladder does not read this row** —
  the ladder is in R, which is what a trader sizes on.
- **Harvest ratio.** Per trade, realised net R divided by the trade's MFE in R
  over the same horizon (entry → 16:00 NY); median per arm, fit and holdout.
  This is the direct "how much of the excursion did the construction keep"
  number, and it is the diagnostic that says *where* the lift went on the arms
  that die.
- **Forward lift** (verbatim `block_L`, [09:35, 12:00) window) is printed
  **once per instrument**: it is a property of the trigger and is identical
  across E0/E1/E2 by construction. `REPORT.md` says so rather than printing it
  three times.

---

## 5. Costs

`cost_R = (½ × entry minute's spread_close + ½ × exit minute's) / stop_dist`.
Capital.com mids; no commission, no financing, **no slippage**. Verbatim from
both closed passes.

`cost_R` is set by **the stop**, not by the exit, so it is a property of the
construction. From the short pass's committed fit tables: `US100-OR5` median
`stop_dist` 66.6 points at median `cost_R` 0.0267R (⇒ round-trip spread ≈ 1.8
points); `US500-OR5` 10.85 points at 0.041R (⇒ ≈ 0.45 points).

**Projections, not computations** (Architect note §5.4; the realised
distribution is what `REPORT.md` prints):

| construction | stop, US100 | `cost_R`, US100 | stop, US500 | `cost_R`, US500 |
|---|---|---|---|---|
| E0 / E1 (range) | ≈ 67 pts (median) | ≈ 0.027R (known) | ≈ 11 pts | ≈ 0.041R (known) |
| E2 (0.10 dATR) | ≈ 35–40 pts | **≈ 0.045–0.05R** | ≈ 6–7.5 pts | **≈ 0.06–0.08R** |
| 0.05 dATR (**not registered**) | ≈ 18–20 pts | ≈ 0.09R | ≈ 3–4 pts | ≈ 0.12–0.15R, p90 > 0.3R |

`REPORT.md` prints the realised `cost_R` distribution per arm, the
gross-vs-net gap, and the sentence: *"on E2 the stop is sized to volatility,
not to the range, so `cost_R` is roughly double E0's; on US500 it approaches
the level at which this project has previously seen costs decide a verdict."*

Cost sensitivities, verbatim, **holdout, non-gating**: 2× per-bar spread; a
fixed fit-median spread.

---

## 6. Nulls and the interval — verbatim

- **Null A — matched-time placebo, 1,000 draws, gating.** For each real trade,
  a random 5-minute bar opening in the arm's own **[09:35, 12:00) NY** window
  on a different day, from days eligible for the arm. The placebo **keeps the
  real trade's side and its `stop_atr`**, and **is exited by the arm's own
  template** — the 1R ratchet for E1, the fixed stop and the 16:00 flat for E0
  and E2 — with the same fills and the same cost model.
  `p_A = P(placebo mean ≥ observed mean)`.
- **Null B — whole-stream day shift, 250 draws, reported, never gating.**
  Every trade moves k eligible days forward keeping its clock slot.
- **90 % day-block bootstrap, 2,000 draws.** Blocks are NY session days, so
  same-day trades move together.

`SEED = 20260916`. The residual same-date rate of Null A and the drop rate of
Null B are reported per arm.

---

## 7. The per-trade feature vector — built, not modelled

The short pass's 24 columns are built unchanged, for two uses only: the
mechanic proof's printed vector, and `stop_atr` for Null A. **No model is
trained, no feature is flagged, there is no Study B in this family.** A trade
whose features need more history than exists gets NaN and is still in the
verdict.

---

## 8. The fit-period screen — decided before any holdout number exists

**No arm touches the holdout unless, on the fit period alone:**

1. **mean net R ≥ +0.05R**, and
2. **fit-period Null A (1,000 draws, drawn from the arm's own
   [09:35, 12:00) fit-period trigger window) gives p ≤ 0.05.**

An arm that fails is verdicted **"NO EDGE — KILL (fit screen)"**, its holdout
is **never computed**, and its holdout column in `REPORT.md` stays blank.
Verbatim from the follow-up note §5.3; nothing is tuned. +0.05R is the kill
bar and 0.05 is the uncorrected conventional level for a screen that only ever
**removes** arms.

It is known in advance that `US500-E0`'s fit number is **−0.0489R** — it is
the short pass's `US500-OR5` no-target cell — so that arm is expected to screen
out. It is registered and charged to α anyway.

`analysis.py holdout` **refuses to run** without `results/fit_screen.csv`, and
computes nothing for a screened-out arm nor for the quoted +1R corner.

### 8.1 Power

The trade list is the `OR5` list: fit 391–392 trades, projected `n_holdout`
≈ 247–249 per instrument, identical for E0/E1/E2. **Floor 150.** No contingency
exists or is needed; a screened-in arm realising `n_holdout < 150` is a §11
stop.

### 8.2 Screen decision — to be written into this file, with the numbers, BEFORE the holdout is touched

*(This subsection is filled in by the same dispatch, from
`results/fit_screen.csv`, and committed before `analysis.py holdout` is run.
It is empty in the commit that precedes any R.)*

---

## 9. The verdict ladder

### 9.1 Applied mechanically to each screened-in arm's **holdout mean net R**

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** Return to Architect. |
| holdout mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.0025 < p ≤ 0.20` | **INCONCLUSIVE.** No build. No follow-up on the exit axis. |
| **all** of: mean net R `≥ +0.10R`; `p ≤ 0.0025`; fit same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; 90 % day-block bootstrap excludes 0; gross `> 0` | **REAL EDGE (third look)** — routes to Architect; **forward confirmation required before any build ruling** (§9.4) |

**α = 0.05 / 20 = 0.0025**, cumulative over 8 (`orb-ny-open`) + 6
(`orb-ny-open-short`) + 6 (this family) pre-registered arms judged on the same
holdout year. Tighten, never loosen.

### 9.2 Attribution — the sentence the reader is owed

`REPORT.md`'s first results table is the full grid per instrument — the quoted
+1R corner (fit only, holdout blank), E0, E1, E2 — fit and holdout, with `n`,
`p_A`, the interval, the screen status and the verdict. **No cell is reported
without the others.** For any arm that passes, the REPORT states which axis
carried it, **by construction**:

- **E1 passing with E0 killed ⇒ the ratchet** (the give-back);
- **E0 passing ⇒ the cap**;
- **E2 passing with E0 killed ⇒ the stop width**;
- **E0 and E2 both passing ⇒ the cap**, with the stop width not separately
  supported;
- E1 passing *with* E0 also passing ⇒ ambiguous between cap and give-back,
  since E1 nests E0.

This is **not a veto** — the cells are hypotheses, not doses, and a lone pass
at α = 0.0025 is what the correction is for. It is applied mechanically by
`analysis.py:attribution`.

### 9.3 "One-sided — flagged"

The long/short split is printed for every arm on fit and holdout. **An arm
reaching REAL EDGE whose holdout mean net R on either side is ≤ 0 is labelled
"one-sided — flagged".** It still routes to the Architect; the forward
confirmation is then run side-split, and the build ruling must treat the result
as directional.

### 9.4 What a pass earns — the forward confirmation, not a build

Because a third look at an already-read year is weaker evidence than a first
look, **a REAL EDGE here does not route to a build.** For every arm verdicted
REAL EDGE (third look), this dispatch writes and commits a frozen
`forward_confirm.py` that:

- runs that arm's exact construction on tape from **2026-08-01 onward**, NYSE
  full days, same trigger, fills, costs;
- **refuses to run** until that window holds **≥ 150 triggered days** for the
  arm (projected ≈ 2027-03-01) — it may print the trigger count, never an R;
- is computed **once**, at α = 0.05 / (number of REAL EDGE arms), same ladder,
  same Null A / Null B / bootstrap, gross > 0, side-split printed;
- a pass there is the evidence a build ruling is written on; a miss there is a
  **kill of the arm, not a rework**.

**No Software Engineer or Backtesting engagement follows from this family on
the holdout read alone.** If no arm reaches REAL EDGE, `forward_confirm.py` is
**not** written — it is not built speculatively — and `REPORT.md` says so in
one line.

### 9.5 Reporting rules that may not be bent

- `REPORT.md`'s **first paragraph** is the third-and-last-look declaration
  (§0 above, and the note §6.1 wording).
- `REPORT.md`'s **first table** is the full 6-arm grid with the quoted corner.
- The harvest-ratio, common-scale and long/short rows appear for every arm.
- Every ladder cell is printed, including the worse ones, with the registered
  cell marked and **no "best cell" sentence**.
- The no-slippage caveat is stated.
- `HANDOFF.md` and a `RESEARCH-LOG.md` entry are written **regardless of
  outcome** — a kill is a result.

---

## 10. Order of work

1. Fork `orb-ny-open-short/` → `orb-ny-open-exit/`; copy the tapes; run the
   coverage audit. **No R.**
2. Parametrise `common.py`; add `walk1m_trail`, `walk1m_trail_ref` and
   `stop_mode="datr"` to `engine.py`; rewrite `build.py`'s arm loop; adapt
   `analysis.py`, `checks.py`, `mechanic_proof.py`, `report.py`,
   `handoff.py`. Write **this file** and **commit it before any R is computed
   on any arm.**
3. `build.py`; `mechanic_proof.py` (30 trades — ten per construction, minute by
   minute, with E1's ratchet path and E2's dATR source); `checks.py all`
   (checks 1–6).
4. `analysis.py fit`; all five ladders; `analysis.py screen` (fit-period Null A
   per arm). **Write the screen decision into §8.2 of this file and commit it
   before the holdout is touched.**
5. `analysis.py holdout` — **once**, screened-in arms only, α = 0.0025, §9.2
   and §9.3 labels, harvest / common-scale / side rows.
6. `REPORT.md`, `HANDOFF.md`, `RESEARCH-LOG.md` entry, **regardless of
   outcome**. `forward_confirm.py` only for an arm reaching REAL EDGE.

---

## 11. Stop rules — return to the Architect, do not decide unilaterally

Halt and escalate if:

1. the coverage audit does not reproduce byte-identically;
2. the clock-grid check fails;
3. the E0 / E1 / E2 trade lists differ from each other, or from the short
   pass's own `US100-OR5` / `US500-OR5` table (§3.6's bounded, asserted
   exclusion aside);
4. the fixed-stop fill check fails;
5. the two E1 implementations (numba and pure Python) disagree on any trade, or
   E1's exit differs from E0's on a trade where the ratchet never moved;
6. the dATR14 recomputation from a truncated tape differs from the value used;
7. any trade crosses 16:00 NY;
8. `n_holdout < 150` on a screened-in arm;
9. the pre-registration is genuinely ambiguous in a way that changes a number.

**Nothing about fills, costs, calendar, nulls, bootstrap or the ladder other
than α may be rewritten locally.**

---

## 12. Amendment log

| # | date | amendment |
|---|---|---|
| A-01 | 2026-09-16 | **§3.6, before any R was computed.** Architect note §5.3's parenthetical "it cannot happen after 2022-08 on these tapes" is a factual error about the Capital.com tapes, which begin 2024-01-01: `DayBars.prior()` returns `None` on 12 triggered days per instrument, all in January 2024, during the Wilder ATR(14) warm-up. Escalated to the Architect as a §11 item 9 / item 3 collision rather than resolved locally. Ruling applied: §5.3's operative clause "excluded and counted" stands; E2 excludes exactly those 12 fit-period days, they are enumerated in `results/exclusions.csv`, and `checks.py tradelist` asserts the excluded set is exactly the `DayBars.prior() is None` set and no larger. Holdout and tail unaffected (zero excluded days). |
