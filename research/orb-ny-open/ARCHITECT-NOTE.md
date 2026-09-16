# Architect note — Opening-range breakout (ORB) at the New York open, with a per-trade LightGBM feature study

**Date:** 2026-09-16 · **Status:** designed, **routed to Researcher**, scope
and numbers fixed below. This note is the binding pre-registration for the
Researcher's pass. `DESIGN.md` restates it mechanically and is committed
before any R is computed. Inputs: `IDEAS-BACKLOG.md` (ORB entry, 2026-08-26),
`research/cmc-bot-vwap/ARCHITECT-NOTE-STAGE1.md` (template for this note),
`research/cmc-bot-smart-money/ARCHITECT-NOTE.md` §3.2 (threshold convention),
`research/session-liquidity-v5-ny/DESIGN.md` §4–§6 (project-standard trade
template and nulls), `RESEARCH-LOG.md` Записи 2, 18, 22, `research/cmc-bot-vwap/
results/COVERAGE.md`, `knowledge/vwap-band-reversal-ict.md` §1, §5, §10.

Nothing in this note was written with sight of any performance number. None
exists. No number in this note was computed on any tape; every count below is
a projection and is labelled as such.

The user's request, as dispatched: ORB anchored on the NY session open, on
US100, US500, BTCUSDT, ETHUSDT, on 5m and 15m bars; collect data first, then
test; for every trade build a feature vector (EMA 200/100/50/20, RSI 15/20,
VWAP, time-of-day, day-of-week, others at Architect's judgement); then use
LightGBM to find which features / parameter values had a positive effect on
trade outcomes.

---

## 0. Summary of rulings

| # | question | ruling |
|---|---|---|
| 1 | ORB mechanic | **Opening range = 09:30–10:00 New York (30 min, fixed), both timeframes.** Trigger = **first bar close beyond** the range on the arm's own bar (5m or 15m), eligible **10:00–12:00 NY**, **one trade per day per arm**, no re-entry. Stop = **opposite side of the range**. **Primary template = project-standard +1R target, forced flat at 16:00 NY.** Mandatory secondary "pure ORB" template: no target, same stop, flat at 16:00 NY (§1). |
| 2 | BTC/ETH anchor | **Routed as pre-registered arms, anchored at the same 09:30 NY cash open, Mon–Fri, NYSE trading days only.** Honest framing: this tests an *imported* anchor (US cash-open flow, spot-ETF era), not an auction the crypto market holds itself. Two built-in controls make that framing falsifiable: a **weekend row** (same clock, no cash open) and a **pre-ETF row** (2022-08 .. 2023-12), both descriptive (§2). |
| 3 | data / split | **Resample the cached, audited 1-minute tapes** (Capital.com mids for the indices, Binance USD-M perps for crypto); no native 5m/15m pull. Signals on resampled bars, **path evaluation on the 1m bars**. **All eight arms: fit 2024-01-01 .. 2025-07-31, holdout 2025-08-01 .. 2026-07-31** (the project's standard holdout), tail 2026-08-01 .. 2026-09-11 non-gating (§3). |
| 4 | features | 24 features, every one computed at the **entry bar's close on the arm's own bars**, no look-ahead, **directional features side-signed**. Exact formulas in §5. RSI(15) and RSI(20) as asked; RSI(14) is *not* a model column (collinear), only a reported correlation. Session VWAP anchored at 09:30 NY plus the project's UTC-midnight VWAP as a second column (§5). |
| 5 | LightGBM | **Two separate questions, two evidentiary standards.** Test A (does ORB work at all) is pre-registered and gates. Study B (which conditions correlate with it working) is **hypothesis-generating**: fit-only training, shallow fixed hyper-parameters, **permutation importance + SHAP, never gain**, a **target-shuffle max-statistic null** for "which features matter", a frozen-model holdout read with pre-committed confirmation criteria, and an explicit rule that a flagged feature is a *proposal for a new registration*, never an edge (§6). |
| 6 | thresholds | **Carried verbatim** from the smart-money / cmc-bot ladder: kill `< +0.05R` or `p > 0.20`; build needs all of `≥ +0.10R`, `p ≤ α`, fit same sign `m_fit ≥ +0.05R`, `n_holdout ≥ 150`, 90 % day-block bootstrap excludes 0, gross > 0. **Family = 8 arms → α = 0.05/8 = 0.00625.** One pre-registered power contingency, decided on the fit period before the holdout is touched (§4.5). |
| 7 | backlog | `IDEAS-BACKLOG.md` ORB entry updated: status **prioritised / dispatched 2026-09-16**, scope changes (crypto added, ML study added, data route decided) recorded there. |

The pre-registered family is **exactly eight arms** — {US100, US500, BTCUSDT,
ETHUSDT} × {5m, 15m} — each with its own verdict, no pooling, no picking. The
two timeframes on one instrument trade the same days and are correlated; the
Bonferroni correction is conservative for that and is kept anyway. Everything
else in the pass is descriptive and says so in its heading.

---

## 1. Ruling 1 — the ORB mechanic

### 1.1 Anchor and clock

- **Session open = 09:30 America/New_York wall-clock**, DST-aware, converted
  as `research/cmc-bot-vwap/common.py:ny_window_utc_ms` does (NY time on the
  session's calendar date). 09:30 NY is 13:30 UTC (EDT) or 14:30 UTC (EST);
  both sit on the quarter-hour grid, so **NY-anchored 5m/15m bins coincide
  with UTC-aligned bins** under either offset. `checks.py` asserts this for
  every session day.
- **Eligible days = NYSE full trading days.** Holidays and early-close days
  are excluded and counted in an exclusions row. This matters more than it
  looks: the Capital.com index CFD tape trades on most US holidays
  (`COVERAGE.md` lists only eight no-data weekdays in 32 months), so "there
  are bars at 09:30" is not the same as "there was a cash open". The crypto
  tape always has bars; the same NYSE calendar applies to it because the
  anchor is the cash open (§2). Researcher takes the holiday and early-close
  lists from the exchange's published calendar and records them verbatim in
  `DESIGN.md`. Expected early closes in span: 2024-07-03, 2024-11-29,
  2024-12-24, 2025-07-03, 2025-11-28, 2025-12-24; 2026 dates from the
  exchange list.
- **Opening-range completeness.** A day is eligible only if every one of the
  six 5-minute bins in 09:30–10:00 NY contains at least one 1-minute bar;
  otherwise the day is excluded and counted.

### 1.2 Opening range — fixed 30 minutes, both timeframes

**OR = [OR_low, OR_high] = min low / max high of the 1-minute bars with open
time in [09:30, 10:00) NY.** Computed from the 1m tape, identical for the 5m
and 15m arms of the same instrument and day.

Why fixed and why 30 minutes, ruled rather than left as a parameter:

1. **One range across both timeframes** keeps the 5m-vs-15m comparison clean:
   the only thing that differs between the two arms of an instrument is how
   much confirmation a "close beyond" carries (a 5-minute close vs a
   15-minute close). If the range width moved with the bar size, a
   difference between arms would be unattributable.
2. **A 15-minute range on a 15m bar is one bar's high/low** — the noisiest
   possible estimate of the auction's range. Thirty minutes is the shortest
   width that is more than one bar on both timeframes.
3. **Volatility-scaled widths are rejected**: a scaled width is a parameter
   with no calibration except the tape, and calibrating it is exactly the
   kind of tuning Study B exists to *look for* rather than bake in. The range
   width in ATR units is a **feature** (§5, `or_width_atr`), not a knob.
4. The 09:30–10:00 window also absorbs the 10:00 ET scheduled releases; a
   breakout eligible from 10:00 is a breakout of a range that already
   contains the open's imbalance. Whether 10:00-bar breakouts differ from
   later ones is, again, a feature question (`tod_min`).

**Non-gating, fit-period-only sensitivities on width: 15 and 60 minutes**,
reported once each, never a verdict.

### 1.3 Trigger — first close beyond, one trade per day

- **Bars.** The arm's bars are 5m or 15m bins of the 1m tape (§3.2), labelled
  by open time. The first bar that can trigger is the one opening at 10:00 NY.
- **Trigger.** A bar whose **close > OR_high** → **long**; **close < OR_low**
  → **short**. Close-beyond, not touch, as the backlog already flagged from
  the pivot-structure pass (`research/pivot-structure/REPORT.md` §C1: the
  touch reading was the dishonest one). A bar closing back inside after a
  wick beyond does not trigger.
- **Eligibility window: bars opening in [10:00, 12:00) NY**, i.e. the last
  eligible bar is the one closing at 12:00 NY. No breakout by then → **no
  trade that day** (counted). Rationale: a session-anchored momentum trade
  needs room to run before the forced flat, and a breakout in the afternoon
  of a range set at the open is a different, weaker object. See §4.5 for the
  one pre-registered contingency on this cutoff.
- **One trade per day per arm — the first close-beyond in either direction.**
  No re-entry after a stop, no second trade on the opposite break. Non-gating
  fit-only sensitivity: re-entry allowed once after a stop, max 2 trades/day.
- **Entry = the trigger bar's close price** (the project's standard: entry at
  the signal bar's close, `session-liquidity-v5-ny/DESIGN.md` §4). Direction
  as above.

### 1.4 Stop — opposite side of the range (confirmed)

- Long: `stop = OR_low`. Short: `stop = OR_high`. **`stop_dist = |entry −
  stop|`; `1R ≡ stop_dist`.** Because entry is a close beyond the range,
  `stop_dist ≥ OR width` always; it is never degenerate on an eligible day.
- `stop_atr = stop_dist / ATR14` on the arm's bars at the entry bar (used by
  Null A to size placebo stops).
- Non-gating, fit-only sensitivity: **stop at the OR midpoint**. Reported
  because the cmc-bot pass (Запись 22) showed cost-in-R is what kills
  small-stop mechanics; the full-range stop is the wide, cheap-in-R one, and
  the midpoint row shows how much of any result is the stop width.

### 1.5 Exit — two templates, one gates

| # | template | rule | status |
|---|---|---|---|
| **1 (primary)** | **project-standard** | target **+1R** from entry; stop as §1.4; **forced flat at 16:00 NY** (mark to market at the close of the last bar ending ≤ 16:00 NY) | **gates** |
| 2 | **pure ORB** | **no target**; stop as §1.4; forced flat at 16:00 NY | mandatory secondary, always reported, no verdict |

Why template 1 gates and not the "pure" form: the ladder's thresholds are on
expectancy in R and the project's every other verdict was reached on the +1R
template (v5-NY, smart-money, cmc-bot template 3), so "this passed where that
failed" stays a like-for-like sentence. Why template 2 is mandatory: it is
the literal hypothesis — that the breakout's direction persists to the close
— and a reader must be able to see whether a +1R cap is what made or unmade
the number. **Pre-registered interpretation if they straddle a tier:** the
arm's verdict is template 1's; the REPORT says so in its first paragraph; a
template-2 number that would on its own clear the build bar is grounds for
**one** Architect-authorised follow-up registration of template 2 as its own
arm, with its own α — never a re-labelling of this one.

**Fill convention — one, realistic**, on the **1-minute path** inside each
arm bar, from the entry bar's close onward: stop checked first on a minute
touching both stop and target; target fills at the level; a stop gapped
through fills at the breaching minute's open; the forced flat fills at the
16:00 bar's close. Evaluating the path on 1m bars is why the 1m tape is the
right source (§3.1): the same-bar-ambiguity that plagues bar-OHLC evaluation
is reduced to the one-minute level and then resolved conservatively.

**Trades never cross a session boundary** (flat at 16:00 NY on every day);
`checks.py` verifies it. No financing modelled for that reason.

---

## 2. Ruling 2 — BTC/ETH and the session anchor

### 2.1 The honest framing

The backlog's own reasoning was correct as far as it went: a 24/7 tape has no
open, and ORB's mechanism is the opening auction. Nothing in this project has
ever found clock structure on crypto that survived a holdout — Запись 2
(time-of-day filters, fit-vs-holdout improvement correlation −0.49) and
Запись 18 (NY-morning session-liquidity, killed under pre-registration) are
the standing nulls. Crypto ORB therefore **cannot be the same hypothesis as
index ORB**, and the note must not pretend it is.

The defensible reframing is this: **since the January 2024 US spot-ETF
listings, the US cash open is an *external* anchor for BTC/ETH** — ETF
creations/redemptions, US-hours equity correlation and US-hours volume share
all key off 09:30 NY. The hypothesis for the crypto arms is therefore:

> *The US equity cash open, transmitted through ETF flow and index
> correlation, imprints a tradable opening range on BTC/ETH on NYSE trading
> days.*

That is a **weaker and different** hypothesis than the indices': the range is
a 30-minute window on a continuous tape, not the resolution of an overnight
order imbalance, and the mechanism is imported, not native. It is also
testable with the same machinery, and — as the cmc-bot precedent ruled for
its crypto arms (`ARCHITECT-NOTE-STAGE1.md` §4.1) — the user asked, the
mechanic is fully specified, power is not the constraint, and the answer is
decisive either way. **Routed as pre-registered arms**, with the weaker
hypothesis written on the label and two controls that can falsify it.

### 2.2 Anchor: 09:30 NY, Mon–Fri, NYSE trading days; not UTC midnight

- **Same anchor as the indices, same eligibility calendar.** On a day with no
  US cash open the crypto anchor does not exist, so NYSE holidays are excluded
  on the crypto arms too.
- **UTC midnight is rejected as an anchor**: it is the Binance daily-candle
  boundary and nothing more (Stage 1 §4.1 ruled exactly this for the cmc-bot
  VWAP reset); no mechanism argues for it, and a second anchor would double
  the family for a hypothesis with no story.
- **Only one anchor per arm.** No "best of" across anchors.

### 2.3 Two built-in controls (descriptive, mandatory, no verdict)

1. **Weekend row.** The identical mechanic — 09:30–10:00 NY range, breakout
   10:00–12:00, flat 16:00 NY, same template, same costs — run on **Saturdays
   and Sundays** on the crypto tape, fit and holdout, reported beside the
   arm. On those days the clock is the same and the cash open does not exist.
   **Pre-registered reading:** if a crypto arm passes and its weekend row is
   at or above the arm's holdout mean net R, the REPORT says "the clock, not
   the anchor" in as many words and the pass is flagged to Architect as
   suspect *before* any build ruling. If the arm is killed, the weekend row is
   reported and nothing is inferred.
2. **Pre-ETF row.** The same mechanic on **2022-08-01 .. 2023-12-31**
   (weekdays), a period the crypto tape covers and the hypothesis says should
   be *weaker*. Descriptive, fit-side, no verdict. If it looks the same as or
   better than the fit period, the ETF-transmission story is wrong and the
   REPORT says so. This is why the crypto fit period starts 2024-01-01 (§3.3)
   rather than 2022-08-01 as in the cmc-bot pass: the hypothesis being
   registered is an ETF-era one.

### 2.4 Standing nulls, stated

The crypto arms contest Запись 2 and Запись 18 in the sense that they impose
a NY-clock structure on BTC/ETH. Pre-registered interpretation: **a kill on a
crypto ORB arm confirms nothing about those entries beyond what they already
said; a pass does not reopen them** — different mechanic (range breakout vs
sweep-then-confirm), different clock (09:30 anchor vs 09:40–11:20 window),
different bar. **No result on a crypto arm is evidence about an index arm or
vice versa** — different tape, different volume quantity in the VWAP, different
cost model. A REAL EDGE on a crypto arm routes to a build *ruling*, not a
build.

---

## 3. Ruling 3 — data and split

### 3.1 Source per instrument: cached 1m, resampled; no native pull

| instrument | tape | file | span on disk | volume field |
|---|---|---|---|---|
| US100 | Capital.com CFD, bid/ask **mid**, `snapshotTimeUTC` | `research/cmc-bot-vwap/data/US100_1m.parquet` | 2024-01-01 .. 2026-09-11 (re-pulled 2026-09-16) | `lastTradedVolume` (broker tick activity) |
| US500 | same | `US500_1m.parquet` — **pull in progress at the time of this note**; Researcher runs `prep_data.py US500` after it completes and the coverage audit must reproduce the committed `results/COVERAGE.md` row **byte-identically** before the tape is used | same | same |
| BTCUSDT | Binance USD-M perp | `BTCUSDT_1m.parquet` | 2022-08-01 .. 2026-09-11 | base-asset volume |
| ETHUSDT | same | `ETHUSDT_1m.parquet` | same | same |

Why resample the 1m tape rather than pull 5m/15m natively from Capital.com:

1. **The 1m tape is already audited** (coverage byte-identical across two
   pulls, order counts reproduced exactly in Запись 22). A native pull is a
   new, unaudited tape.
2. **The cost model needs per-bar spread** (`spread_close`); the 1m tape has
   it at every minute, so the entry and exit minutes pay their own spread. A
   native 5m bar carries one spread per five minutes.
3. **Path evaluation on 1m bars** (§1.5) is strictly more faithful than on 5m
   or 15m OHLC and is only possible from the 1m tape.
4. History is the same either way — Capital.com's retention floor is
   2024-01-01 at every intraday granularity (`PARITY.md`, API probe).

The data files live outside the git tree (`.gitignore`); the Researcher's
package must **not** copy them. Read from `research/cmc-bot-vwap/data/`.

### 3.2 Resampling rule

- Bins of 5 or 15 minutes on the UTC quarter-hour grid (= NY-anchored, §1.1),
  labelled by **open time**; `open` = first 1m open, `high` = max, `low` =
  min, `close` = last 1m close, `volume` = sum, `spread_close` = last 1m
  bar's. A bin with no 1m bar is **absent** — not forward-filled, not
  zero-filled. Indicators (§5) run over the sequence of present bins.
- The index CFD tape runs 23:01 → 20:59 UTC with a 21:00–23:00 gap; the
  overnight bars **are** part of the bar sequence the EMAs/RSI/ATR see (this
  is a continuous-CFD chart, not an RTH-only chart; `DESIGN.md` states it).

### 3.3 Split — one calendar for all eight arms

| period | dates | use |
|---|---|---|
| **Fit** | **2024-01-01 .. 2025-07-31** (19 months) | all exploration, every sensitivity, Study B training |
| **Holdout** | **2025-08-01 .. 2026-07-31** (12 months) | **computed once, at the end**, after `DESIGN.md` is committed; Test A verdicts; Study B frozen-model read |
| Tail | 2026-08-01 .. 2026-09-11 | non-gating "post-holdout tail" row per arm |
| Pre-ETF (crypto only) | 2022-08-01 .. 2023-12-31 | descriptive control (§2.3) |

Split by the **session's NY calendar date** (each trade belongs to exactly
one session day). Never re-cut.

Why the crypto arms do **not** use the 2022-08-01 fit start of every prior
crypto registration: the crypto hypothesis is ETF-era by construction (§2.1),
and aligning all eight arms on one fit calendar makes the 5m/15m and
index/crypto comparisons like-for-like. The cost is 17 months of crypto fit,
which the pre-ETF row uses as a control instead of discarding.

Why the holdout is 2025-08-01 .. 2026-07-31: it is the project's standard
holdout year (v5-NY, smart-money, cmc-bot); every pre-registered line is then
judged on the same twelve months of market.

**Projected counts (assumption, not computed):** ≈ 250 NYSE trading days in
the holdout; if 60–80 % of days produce a breakout by 12:00 NY, `n_holdout ≈
150–200` per arm — **close to the 150 floor**. §4.5 pre-registers what
happens if the fit period says it will fall short.

---

## 4. Ruling 6 (with the test restated) — Test A, the pre-registered ORB verdict

### 4.1 Arms and legs

| arm | tape | bars | window | fit | holdout | status |
|---|---|---|---|---|---|---|
| US100-5m | Capital.com 1m → 5m | 5m | OR 09:30–10:00, entry 10:00–12:00, flat 16:00 NY | 2024-01-01..2025-07-31 | 2025-08-01..2026-07-31 | **pre-registered** |
| US100-15m | same → 15m | 15m | same | same | same | **pre-registered** |
| US500-5m / -15m | same | | same | same | same | **pre-registered** |
| BTCUSDT-5m / -15m | Binance 1m → 5m/15m | | same, NYSE days only | same | same | **pre-registered** |
| ETHUSDT-5m / -15m | same | | same | same | same | **pre-registered** |
| crypto weekend rows (×4) | Binance | 5m/15m | same clock, Sat/Sun | same | same | descriptive |
| crypto pre-ETF rows (×4) | Binance | 5m/15m | same, NYSE days | 2022-08-01..2023-12-31 | — | descriptive |

Every arm: template 1 (gates) and template 2; the tail row; per-side
(long/short) breakdown; exit-cause breakdown (target / stop / time-exit);
the §1.2, §1.3, §1.4 fit-only sensitivities.

### 4.2 Costs

- **Capital.com arms.** One full spread per round trip, taken from the tape:
  half of the entry minute's `spread_close` on entry, half of the exit
  minute's on exit, converted to R by `stop_dist`. No commission, no
  financing (flat every day). Slippage not modelled. Sensitivities,
  non-gating: (i) fixed spread = fit-period median `spread_close` over
  10:00–16:00 NY for that instrument; (ii) 2× the per-bar spread.
- **Binance arms.** **0.10 % round trip** (2 × 5 bp taker), `cost_R = 0.001 ×
  entry / stop_dist`, identical to v5-NY and cmc-bot. Sensitivity 0.04 %
  (maker), non-gating.
- The REPORT shows the `cost_R` distribution per arm and the gross-vs-net
  gap. Because the stop is the full opening range, `cost_R` should be far
  smaller than the cmc-bot pass's 0.25–0.4R; if it is not, that is itself a
  finding worth a sentence.
- The sentence "slippage is not modelled, so every number is optimistic"
  appears in the REPORT.

### 4.3 Nulls and interval (verbatim from the smart-money ruling, windows substituted)

- **Null A — matched-time placebo, primary, 1,000 draws.** Each real trade is
  replaced by one entered at a bar drawn uniformly from the **same 10:00–12:00
  NY eligibility window on a different, randomly chosen eligible weekday**,
  same instrument, same side, **same `stop_atr`** (stop placed at `entry ∓
  stop_atr × ATR14` of the placebo bar), same template, same 16:00 NY flat,
  same costs. One-sided `p = share of draws whose mean net R ≥ observed`.
- **Null B — whole-stream day shift, secondary, 250 draws**, `k ~ U{1..250}`
  eligible days.
- **Interval.** Day-block bootstrap, whole session days with replacement,
  2,000 draws, 90 % interval on the holdout mean net R.
- **Non-circular forward lift** built as `session-liquidity-v5-ny/tables.py:
  block_L`, reported per arm; for the crypto arms read together with the
  weekend row (§2.3).

### 4.4 Verdict ladder — carried verbatim, α re-counted

Applied mechanically to template 1's holdout mean net R, per arm:

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** No directional claim. Return to Architect. |
| holdout mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.00625 < p ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| **all** of: mean net R `≥ +0.10R`; `p ≤ 0.00625`; fit period same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; 90 % day-block bootstrap interval excludes 0; **gross** expectancy `> 0` | **REAL EDGE — build for real.** Routes to Architect for a build ruling. |

**α = 0.05 / 8 = 0.00625** — the family is the eight pre-registered arms of
§0. The kill bar stays at +0.05R and the build bar at +0.10R for the reasons
the smart-money ruling fixed (few trades a day, unmodelled slippage, an
optimistic fill on the primary): ORB takes **at most one trade a day per
arm**, so those reasons hold with more force, not less. Nothing loosened.
`DESIGN.md` may add mechanical detail and may not loosen anything here. If
the Researcher finds the arm count wrong, tighten, do not loosen.

### 4.5 One pre-registered power contingency

The projected `n_holdout` (§3.3) is close to the floor. Rather than discover
that after the holdout is cut, the Researcher computes, **on the fit period
only and before the holdout is touched**, the share of eligible days that
produce a trade per arm, and projects `n_holdout = that share × eligible
holdout days`. **If the projection is `< 150` for an arm, that arm's
eligibility window extends from 12:00 to 13:30 NY** — the one and only
alternative, fixed now — and `DESIGN.md` records which arms run on which
cutoff *before* any holdout number exists. If even the 13:30 projection is
`< 150`, the arm is run anyway and the UNDERPOWERED row applies. No other
parameter moves for power.

---

## 5. Ruling 4 — the per-trade feature vector

### 5.1 Conventions

- **Bar of computation: the entry (trigger) bar's close**, on the arm's own
  bars (5m or 15m), using only bars whose close is ≤ the entry bar's close.
  Session-anchored quantities (OR, session VWAP) use 1m bars up to and
  including the entry bar's last minute. **No feature may see a later bar;
  `checks.py` re-computes every feature for 50 random trades from a tape
  truncated at the entry bar and asserts equality.**
- **Side-signing.** For any feature whose sign has a directional meaning,
  the stored value is `side × raw`, with `side = +1` long, `−1` short, so
  that **positive = aligned with the trade**. Marked "signed" below. Without
  this, long and short trades would cancel each other in every directional
  column.
- `ATR14` = Wilder ATR(14) on the arm's bars. `dATR14` = Wilder ATR(14) on
  **session-day bars** defined as 16:00 NY → 16:00 NY (full 24 h, all four
  tapes, same definition), value as of the prior day's close.
- Warm-up: a trade whose features need more history than exists (EMA200 on
  15m needs 200 bars ≈ 2 trading days; fine from 2024-01-04 on) is excluded
  from Study B and counted; it stays in Test A.

### 5.2 The features (24 columns)

| # | name | formula (at entry bar `t`) | signed | note |
|---|---|---|---|---|
| 1–4 | `ema20_d`, `ema50_d`, `ema100_d`, `ema200_d` | `(close_t − EMA_k(close)_t) / ATR14_t`, k ∈ {20, 50, 100, 200}, standard EMA α = 2/(k+1), seeded with SMA(k) | yes | user-requested EMAs, as distances (levels are not comparable across instruments) |
| 5 | `ema_stack` | number of the three relations EMA20>EMA50, EMA50>EMA100, EMA100>EMA200 that agree with the trade side (0–3) | yes | trend alignment |
| 6 | `ema200_slope` | `(EMA200_t − EMA200_{t−10}) / ATR14_t` | yes | |
| 7 | `rsi15` | Wilder RSI over 15 bars of close (SMMA gains/losses), 0–100 | no | user-requested; **for shorts store `100 − RSI`** so that "high = momentum in the trade direction" holds |
| 8 | `rsi20` | Wilder RSI over 20 bars, same treatment | no | user-requested |
| — | `rsi14` | computed, **not a model column**; its Pearson correlation with `rsi15` is reported once | | conventional period, collinear with 15 |
| 9 | `vwap_sess_d` | `(close_t − VWAP_{09:30}) / ATR14_t`, VWAP = Σ(typical price × volume)/Σvolume over 1m bars from 09:30 NY through the entry bar's last minute, typical = (H+L+C)/3 | yes | session VWAP anchored at the same open as the OR |
| 10 | `vwap_day_d` | same with the anchor at **00:00 UTC** of the session's UTC date (the project's cmc-bot convention, `vwap-band-reversal-ict.md` §1) | yes | overnight-inclusive reference |
| 11 | `tod_min` | minutes from 09:30 NY to the entry bar's **open** (30, 35, … on 5m; 30, 45, … on 15m) | no | user-requested time-of-day |
| 12 | `dow` | NY weekday of the session, Mon=0 … Fri=4, **categorical** | no | user-requested |
| 13 | `or_width_atr` | `(OR_high − OR_low) / ATR14_t` | no | range width relative to intraday volatility |
| 14 | `or_width_datr` | `(OR_high − OR_low) / dATR14` | no | how much of a normal day the range already used |
| 15 | `overshoot_atr` | `side × (close_t − broken edge) / ATR14_t` | yes | how far beyond the range the trigger closed |
| 16 | `or_body` | `side × (close_{09:59 1m bar} − open_{09:30 1m bar}) / (OR_high − OR_low)` | yes | did the range itself drift toward the breakout side |
| 17 | `gap_datr` | `side × (open_{09:30} − close_{prior session 16:00 NY}) / dATR14` | yes | overnight gap in the trade direction |
| 18 | `prev_day_ret` | `side × (prior session close − close of the session before) / dATR14` | yes | |
| 19 | `pd_level_d` | `side × (level − close_t) / ATR14_t`, level = **prior session-day high** for a long, **low** for a short (16:00→16:00 NY day) | yes | distance to the next PDH/PDL in the trade direction (positive = still room) |
| 20 | `range200_pos` | `side × (close_t − mid) / (top − bottom)`, `top/bottom` = max high / min low of the **200 bars preceding `t`** (the cmc-bot rolling range, `vwap-band-reversal-ict.md` §5) | yes | premium/discount in the trade direction |
| 21 | `or_rvol` | Σvolume over 09:30–10:00 NY ÷ median of the same sum over the prior 20 eligible sessions | no | relative opening volume |
| 22 | `bar_rvol` | entry bar volume ÷ mean volume of the bar at the same clock slot over the prior 20 eligible sessions | no | breakout-bar participation |
| 23 | `atr_regime` | `ATR14_t / SMA(ATR14, 200 bars)_t` | no | intraday volatility regime |
| 24 | `datr_pct` | `dATR14 / close_t × 100` | no | daily volatility regime |
| — | `instrument` | categorical, model column only in the pooled model (§6.2) | | |

Not included, with the reason: **iFVG / sweep primitives** (`smart-money-ict.md`,
`session-liquidity.md`) — reversal-shaped triggers with no argued role in a
breakout's outcome; adding them would dilute importance across columns nobody
proposed. **Cross-instrument features** (e.g. US100's same-day OR direction as
a crypto feature) — a genuinely interesting control for §2, but it couples two
tapes with different calendars and is a separate study. **RSI(14)** — as
above.

### 5.3 The target

- **Primary target: `netR` of template 1** (continuous; regression).
- Secondary target: `netR` of template 2, same pipeline; and the binary
  `netR > 0` as a sanity classifier. Reported, not used for flagging.

---

## 6. Ruling 5 — Study B, the LightGBM feature study

### 6.1 What Study B is and is not

Test A asks *does ORB work at all* and is judged by the ladder in §4.4. Study
B asks *which conditions correlate with an ORB trade working better* across
24 engineered features. That is a mining exercise over ~24 comparisons on a
few hundred to a thousand trades. **It is hypothesis-generating. Nothing it
produces is an edge, a verdict, or a parameter change to Test A.** The
deliverable says this in the section heading and again in its first
sentence. Study B **runs regardless of Test A's outcome** — a killed
unconditional signal may still hide a conditional one, and finding a
candidate for that is exactly what the user asked for — but a flag after a
kill is a **proposal for a new registration** (a conditioned ORB), not a
rescue of this one.

### 6.2 Training — fit period only, frozen thereafter

- **Sample.** Trades of the fit period (§3.3), template-1 `netR` as target.
  **One model per timeframe, pooled across the four instruments** with
  `instrument` as a categorical column (projected pooled `n_fit` of the order
  of 800–1,200 per timeframe — assumption). Per-instrument models are a
  secondary, reported with an explicit small-n caveat.
- **Fixed hyper-parameters, no tuning:** `objective=regression_l2`,
  `num_leaves=7`, `max_depth=3`, `min_data_in_leaf=30`, `learning_rate=0.03`,
  `feature_fraction=0.8`, `bagging_fraction=0.8`, `bagging_freq=1`,
  `lambda_l2=10.0`, `cat_smooth=10`, `n_estimators` by early stopping
  (patience 100, cap 2,000) on **blocked, chronological 5-fold CV inside the
  fit period** (folds are contiguous date ranges; no shuffling; a 5-session
  purge gap between train and validation folds). Seeds 0–4, results averaged.
  Shallow and heavily regularised on purpose: the point is which features
  carry signal, not the best fit.
- **Environment.** `lightgbm`, `shap`, `scikit-learn` are **not** in the
  project venv; Researcher installs them and pins the versions in `DESIGN.md`
  and `requirements` for the package. All seeds fixed.

### 6.3 Importance — permutation and SHAP, never gain or split count

- **Permutation importance** on the **out-of-fold** fit predictions: for
  each feature, 100 shuffles, `ΔMSE = MSE(shuffled) − MSE(baseline)`,
  averaged over folds and seeds. Gain and split count are not reported at
  all (biased toward high-cardinality columns; `tod_min` and the continuous
  distances would win by construction).
- **SHAP** (TreeSHAP) mean |value| per feature on the out-of-fold
  predictions, as the second reading, and SHAP dependence plots **for
  flagged features only**, on the fit period, to read the *direction* of the
  effect.

### 6.4 The null for "which features matter" — target-shuffle, max-statistic

Twenty-four features at α = 0.05 will produce about one spuriously
"important" feature per run by chance. Pre-registered control:

- **200 refits of the full pipeline with `netR` permuted** across trades
  (within instrument and within fit-year, to preserve marginal structure),
  one seed each, same hyper-parameters, same folds. For each refit record
  **the maximum permutation importance over all features**.
- A feature is **FLAGGED** iff its real permutation importance exceeds the
  **95th percentile of the null-max distribution**. This controls the
  family-wise error rate across the 24 features (Westfall–Young style). No
  per-feature p-values are reported without this correction.
- Expected outcome under no signal: zero flags. The REPORT states the number
  of flags and the null-max threshold.

### 6.5 The holdout read — frozen model, pre-committed criteria, no verdict

After Test A's holdout is cut and its verdicts are locked, the frozen models
(one per timeframe) are applied **once** to the holdout trades. No refit, no
re-tuning, no re-selection. Reported:

1. **Spearman rank correlation** between predicted and realised `netR` on
   the holdout, with a 90 % day-block bootstrap interval.
2. **Score terciles:** cut-points from the **fit-period** prediction
   distribution; holdout mean `netR` in the top vs bottom tercile, difference
   with a 90 % day-block bootstrap interval.
3. **For each FLAGGED feature:** holdout mean `netR` in the three terciles of
   that feature, cut-points from the **fit period**; sign of the top-minus-
   bottom difference compared with the fit-period SHAP direction.

**Pre-committed wording per flagged feature:**

- "**OOS-consistent**" iff the holdout top-minus-bottom difference has the
  fit-period sign **and** its 90 % interval excludes 0.
- otherwise "**not confirmed out of sample**".

Neither word is a verdict. An OOS-consistent flag is the strongest thing
Study B can say, and what it earns is **a proposal**, written in `HANDOFF.md`
in this form: *"ORB on arm X conditioned on feature F ≥ q (q = the fit-period
tercile boundary, fixed), as a new pre-registered arm, own α, same ladder,
same nulls, fresh registration."* The Architect decides whether to register
it; a registration would test on a **later** holdout or at minimum be
declared as a re-use of this holdout with the conflict named, because this
holdout has now been read by Study B.

### 6.6 Two things that must be said in the deliverable

1. **Ordering of evidence.** "Does ORB work" (Test A, pre-registered,
   Bonferroni, kill/build) is settled before and separately from "which
   conditions correlate with it working better" (Study B, exploratory,
   FWER-controlled flags, no verdict). The REPORT's first paragraph carries
   the eight Test A verdicts; Study B is a later section under a heading that
   contains the words "hypothesis-generating".
2. **`tod_min` and `dow` contest Запись 2.** That entry found clock filters
   on crypto do not survive a holdout. A flag on either feature on a crypto
   arm is not a reversal of that finding; it is a proposal to test it again
   under §6.5's follow-up form.

---

## 7. Order of work and stop rules

1. **Data.** Wait for the US500 pull; `prep_data.py US500`; coverage audit
   byte-identical to `COVERAGE.md`. Resample all four tapes to 5m and 15m
   (§3.2). Build the NYSE eligibility calendar. **No R computed yet.**
2. **`DESIGN.md`** restating this note mechanically — the eight arms and
   their status, the calendar, the OR/trigger/stop/templates, the fill
   convention on the 1m path, the cost model with the price side stated, the
   nulls, the ladder with α = 0.00625, the 24 features with formulas, the
   Study B pipeline with fixed hyper-parameters and the null — **committed
   before any R is computed on any arm**.
3. **Mechanic proof on the fit period** (as v5-NY's `MECHANIC-PROOF.md`):
   ten hand-checked trades per timeframe with the OR, trigger bar, stop,
   exit minute and every feature shown; the §5.1 look-ahead check.
4. **Fit-period Test A numbers** for all arms and rows, the §4.5 projection,
   and the cutoff decision recorded in `DESIGN.md` (a commit).
5. **Study B training** on the fit period: CV, importances, null, flags.
6. **Holdout, once:** Test A verdicts locked first; then the §6.5 frozen read.
7. **`REPORT.md`**: eight verdicts in the first paragraph; descriptive rows
   under their own headings with no verdict words; Study B under a
   "hypothesis-generating" heading; every sensitivity actually run,
   including the ones that came out worse. **`HANDOFF.md`** to Architect with
   any §6.5 proposals in the prescribed form; a `RESEARCH-LOG.md` Запись
   regardless of outcome. A kill is a result.
8. **Stop and return to Architect** immediately if: the US500 coverage audit
   does not reproduce `COVERAGE.md`; the NY-anchored bins fail to coincide
   with the UTC grid on any day; the look-ahead check fails for any feature;
   realised `n_holdout < 150` on any arm (that arm is UNDERPOWERED, the
   others proceed); or the 1m-path fill and a bar-OHLC fill disagree on any
   trade that neither gaps nor touches both levels within one bar.

---

## 8. Explicitly not ruled here

- **Software Engineer / Backtesting** — engage only on a REAL EDGE verdict,
  per arm, after a further Architect ruling.
- **Any conditioned ORB** (a Study B follow-up) — a new registration, §6.5.
- **Template 2 as an arm** — only via the §1.5 follow-up path.
- **Other anchors for crypto** (UTC midnight, Asia/London opens) — rejected
  for this pass, §2.2; a different anchor is a different registration.
- **ES/NQ futures, SPY/QQQ** — the backlog's original instruments; the user's
  request names the Capital.com CFDs and the project has an audited tape for
  them. A futures tape is a different registration.
- **The paused `vwap-mr-indices` item** — the backlog's mutual-control idea
  (same days, opposite mechanism) stands as a future comparison once both
  have numbers; not part of this pass.
