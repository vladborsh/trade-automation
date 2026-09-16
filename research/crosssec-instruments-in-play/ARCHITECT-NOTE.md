# Architect note — Cross-sectional "instruments in play": relative-volume and trailing-return selection on a wide Binance USD-M perp universe, directional continuation from the US cash open

**Date:** 2026-09-16 · **Status:** designed, **routed to Researcher** (dispatch
is the coordinator's). This note is the binding pre-registration for the
Researcher's pass. `DESIGN.md` restates it mechanically and is committed
before any R is computed. Inputs: `research/_surveys/2026-09-intraday-directions.md`
§2.4, §4.1, §5 (the recommendation this note executes); `IDEAS-BACKLOG.md`
"Cross-sectional relative momentum, dollar-neutral, 8-perp universe"
(prioritised 2026-08-26, merged here); `research/orb-ny-open/ARCHITECT-NOTE.md`
and `research/cmc-bot-vwap/ARCHITECT-NOTE-STAGE1.md` (style and rigor
references); `research/orb-utc0-crypto/DESIGN.md` §13.2 (the α-ledger ruling
this note must obey); `research/orb-utc0-crypto/prep/extend_history.py` (the
archive audit procedure); `RESEARCH-LOG.md` Записи 2, 22, 23, 26, 27.

Nothing in this note was written with sight of any performance number on
this universe. None exists — no cross-sectional quantity has ever been
computed in this project. Every count below is a projection and is labelled
as such. Three facts about the data source *were* verified today by probing
the archive, and are marked "verified 2026-09-16".

The user's go-ahead, as relayed: execute survey §4.1 as the first
cross-sectional package, merged with the prioritised cross-sectional item,
as one registration with two pre-registered selectors and a pre-registered
comparison between them.

---

## 0. Summary of rulings

| # | question | ruling |
|---|---|---|
| 1 | universe | **Every Binance USD-M perpetual quoted in USDT that the `data.binance.vision` archive lists, delisted ones included** (864 symbols today, verified). Per-day eligibility is a mechanical, survivorship-free rule (§1.3): listed ≥ 30 days, full anchor window present, RVOL denominator and dATR14 defined, 14-day median daily quote volume ≥ 10 M USDT, tape runs through the day's exit. A day is tradable only if **≥ 50** symbols are eligible. |
| 2 | selectors | Two, both pre-registered, **k = 5** each: **(A) opening relative volume** = quote volume in the 30 min from the anchor ÷ median of the same sum over the prior 14 anchor days, top 5; **(B) trailing 24-hour absolute return** \|P(A)/P(A−24h) − 1\|, top 5. Each has two pre-registered nulls: **bottom-5** by the same ranking (deterministic) and **random-5** from the same eligible set (1,000 draws — this is Null A, the p-value in the ladder). A pre-registered comparison between A and B (§2.5). |
| 3 | anchor | **09:30 America/New_York, DST-aware (13:30 UTC in summer, 14:30 UTC in winter), NYSE full trading days only.** Not 00:00 UTC (§3). Weekend row and two fit-only placebo anchors (00:00, 04:00 UTC) as controls. |
| 4 | direction | **sign of the return from the anchor to +30 min** on the selected instrument: `r30 = close(A+29 min bar) / open(A bar) − 1`; long if > 0, short if < 0, no trade if 0. No range, no trigger, no filter (§4). |
| 5 | risk / exit | Stop = **0.5 × dATR14** (Wilder ATR(14) on UTC daily bars, prior complete day) — **gates**; 0.25 × and 1.0 × dATR14 fit-only; 0.10 × (the paper's) as a fit-only cost row. **Exit at the fixed horizon entry + 4 h** (14:00 NY) or the stop, whichever first. One trade per instrument per arm per day. Dollar-neutral basket = **secondary, descriptive** (§5). |
| 6 | costs | 0.10 % round trip taker per leg, `cost_R = 0.001 × entry / stop_dist`; 0.04 % and **0.20 %** sensitivities, fit-only. Funding at the 16:00 UTC settlement, which every trade crosses, is a **mandatory secondary row with a veto** (§6.2). The honest target, worked in dATR units (§6.3): **the paper's top RVOL tier, transplanted at these costs and this stop, sits at or below this project's kill bar; a pass needs a selection effect stronger than the paper's** — stated so the Researcher does not chase the +0.08R tier. |
| 7 | split / α | Fit **2020-01-01 .. 2025-07-31** (effective from the first day with ≥ 50 eligible symbols), holdout **2025-08-01 .. 2026-07-31**, read once. This window has been registered on 22 arms and read 11 times by the ORB line plus 2 cmc-bot crypto arms (declared, §7.1). **Ruling: this family starts its own count — α = 0.05/2 = 0.025 per arm — with one tightening that pays for the contamination: a REAL EDGE earns a frozen forward confirmation on 2026-08-01 .. 2026-10-31 before any build ruling, and no tail row is read in this pass** (§7.2–7.3). |
| 8 | engine | New small portfolio harness (§8): universe table, per-day cross-sectional ranking, multi-leg trade table keyed by (day, arm, leg), vectorised random-k null, basket accounting. Reused verbatim: the monthly-archive pull/audit, Wilder ATR, the 1-minute path walker, the Binance cost branch, the NYSE calendar, day-block bootstrap. Two-stage pull (1d archives first, 1m only for eligible symbol-months). |
| 9 | pump-and-dump | Primary carries the **causal** exclusions (liquidity floor, ≥ 30-day listing). The **non-causal "delisted within 30 days after the trade" exclusion is a mandatory secondary row with a veto on a build**, plus a 0.20 % cost row and an RVOL-decile dose-response reading with a pre-committed "isolated cell — suspect" label (§9). |
| 10 | ladder | Carried verbatim: kill `< +0.05R` or `p > 0.20`; build needs all of `≥ +0.10R`, `p ≤ 0.025`, fit same sign `m_fit ≥ +0.05R`, `n_holdout ≥ 150` legs **and** ≥ 150 trade-days, 90 % day-block bootstrap excludes 0, gross > 0, **plus three tightenings**: top-minus-bottom-5 interval excludes 0; funding row ≥ +0.05R; delisting-exclusion row ≥ +0.05R. Fit screen before any holdout look. **Family = exactly 2 full arms.** |

The pre-registered family is **exactly two arms** — `RVOL-top5-s0.5` and
`TR24-top5-s0.5` — each with its own verdict, no pooling, no picking. Every
other cell of every ladder is a fit-only sensitivity and says so in its
heading. The dollar-neutral basket, the weekend row, the placebo anchors, the
decile tables and the selector comparison are descriptive and carry no
verdict word.

---

## 1. Ruling 1 — the universe, survivorship-free

### 1.1 Source (verified 2026-09-16)

- **Archive:** `https://data.binance.vision/data/futures/um/monthly/klines/<SYMBOL>/<interval>/<SYMBOL>-<interval>-<YYYY-MM>.zip`, free, no key, the same family `orb-utc0-crypto/prep/extend_history.py` audited for BTC/ETH.
- **Symbol list:** the S3 listing `https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/futures/um/monthly/klines/`, **paginated** (1,000 keys per page, follow `NextMarker` while `IsTruncated` is `true`). Probed today: **1,018 prefixes, of which 864 end in `USDT`**. The rest are BUSD/USDC quotes, dated delivery contracts (`BTCBUSD_210129`) and `…USDTSETTLED` pseudo-symbols.
- **Delisted symbols are kept in the archive.** `LUNAUSDT` has 1m archives 2021-01 .. 2022-05 and nothing after (verified). `FTTUSDT` is present. This is what makes a survivorship-free universe possible without any external delisting list: **listing date = first bar of the earliest monthly archive; delisting date = last bar of the latest one.**
- **Daily (`1d`) and `fundingRate` monthly archives exist for the same symbols over the same span** (BTCUSDT: 2020-01 .. 2026-08 for both, verified). The 1d archive drives the two-stage pull (§8.2); the funding archive drives the §6.2 row.
- Columns per 1m row: `open_time, open, high, low, close, volume, close_time, quote_volume, count, taker_buy_volume, taker_buy_quote_volume, ignore`. Header row present in some months, absent in others; microsecond timestamps in some recent months (`extend_history.py` handles both — reuse it).

### 1.2 Symbol admission rule

A symbol `s` is **in the universe** iff its archive prefix matches
`^[A-Z0-9]+USDT$` (no underscore, no `SETTLED` suffix, USDT quote). This
admits every USDT-margined perpetual that ever traded, including index perps
(`DEFIUSDT`, `BTCDOMUSDT`) and re-denominated tickers (`1000SHIBUSDT`). A
re-listing under a new ticker is a new symbol; a ticker that was delisted
and re-listed under the *same* name shows up as a gap in its archive and is
handled by the per-day rule below, not by hand. **No symbol is excluded by
name, ever.** The Researcher records the full admitted list with first/last
archive month in `results/universe.csv` and commits it.

### 1.3 Per-day eligibility — the survivorship-free test

For anchor day `d` (a NYSE full trading day, §3) with anchor time `A` (09:30
NY on `d`), symbol `s` is **eligible on `d`** iff all of:

1. **Listed ≥ 30 days:** `first_bar(s) ≤ A − 30 × 24 h`.
2. **Anchor window complete:** all 30 one-minute bars with open time in `[A, A + 30 min)` are present on `s`.
3. **RVOL denominator defined:** the 30-minute quote-volume sum (§2.1) exists on **≥ 10 of the prior 14 anchor days** (prior NYSE full trading days).
4. **dATR14 defined:** Wilder ATR(14) on UTC daily bars has a value for the last complete UTC day before `d` (§5.1) — implied by 1 in practice, asserted anyway.
5. **Liquidity floor (causal):** median of the daily **quote volume** (USDT) over the **14 complete UTC days before `d`** ≥ **10,000,000 USDT**. Fit-only sensitivity: 50 M.
6. **Tape runs through the exit:** `last_bar(s) ≥ A + 4 h 30 min` on `d`. (This uses 4.5 hours of ex-post knowledge; a trader would have known a delisting was announced. Declared; it is the only non-causal element in the primary and it removes trades that could not be evaluated, not trades that lost.)
7. **For selector B only:** a 1m close exists at `A − 24 h` (the last bar with open time in `[A − 24 h − 5 min, A − 24 h)`; otherwise the symbol is not rankable by B that day and is excluded from B's eligible set, counted).

`N_elig(d)` = the number of symbols satisfying 1–6 (A's set; B's set is a
subset). **The day is tradable iff `N_elig(d) ≥ 50`**; otherwise no arm trades
and the day is counted in an exclusions row. Projection (not computed): the
USD-M venue had ~25 USDT perps in 2020-01 and crossed 50 during 2020-H2, so
the **effective fit start is expected in 2020-H2**; the Researcher records the
first tradable day and the `N_elig` series (`results/n_elig.csv`) in
`DESIGN.md` before any R is computed. `N_elig` is expected to exceed 200 from
2022 and 300–400 across the holdout.

Everything in 1–7 is computable from the archive alone and from bars strictly
before the entry (except 6, declared). `checks.py` re-derives eligibility for
50 random (symbol, day) pairs from a tape truncated at `A + 30 min` and
asserts equality for 1–5 and 7.

### 1.4 What is deliberately not in the rule

- **No exclusion by market cap, sector, age beyond 30 days, or "known scam".** Any such list is survivorship in a different coat.
- **No Binance delisting-announcement lookup.** The announcements are not archived in machine-readable form for 2020–2022; using them for some years and not others would bias the fit/holdout comparison. The §9 delisting row covers the concern ex post.
- **No BUSD/USDC duplicates.** The same base in a second quote is the same instrument; the USDT contract is the liquid one.

---

## 2. Ruling 2 — two selectors, their nulls, their comparison

Both selectors are computed at `A + 30 min` on day `d`, from bars with open
time `< A + 30 min`, over the eligible set of §1.3. Both then hand the
selected instruments to the **same** direction reader (§4), stop, exit and
costs (§5, §6). The only thing that differs between the two arms is the
ranking; that is the point.

### 2.1 Selector A — opening relative volume (`RVOL`)

```
V30(s, d)   = Σ quote_volume of the 30 one-minute bars with open time in [A, A + 30 min)
RVOL(s, d)  = V30(s, d) / median{ V30(s, d') : d' in the prior 14 anchor days, V30 defined }
```

- "Prior 14 anchor days" = the 14 NYSE full trading days before `d`, same
  09:30 NY window each. Anchor days, not calendar days: the quantity is
  "abnormal for this coin at *this* window", and the weekend window is a
  different regime (the weekend row uses prior 14 calendar days, §3.3).
- **Quote** volume, not base volume: a USDT quantity is what "dollar volume"
  means in the paper and it is price-invariant across the window.
- Ranking: descending `RVOL`, ties broken by larger `V30`. **Top 5 = arm A's
  selection.** Bottom 5 = its deterministic null (§2.3).
- The paper's quantity (Zarattini–Barbon–Aziz 2024) is the first 5 minutes'
  volume over the 14-day average of the same; this note uses 30 minutes and
  the median (robust to one pump day in the denominator). The 5-minute
  version is a **fit-only sensitivity**.

### 2.2 Selector B — trailing 24-hour absolute return (`TR24`)

```
P(t)        = close of the last 1m bar with open time in [t − 5 min, t)   (else undefined)
TR24(s, d)  = P(A) / P(A − 24 h) − 1
rank on     |TR24(s, d)|, descending; ties by larger V30
```

- **Top 5 by |TR24| = arm B's selection.** Direction still comes from the
  §4 reader, *not* from the sign of `TR24`. This keeps the A-vs-B comparison a
  comparison of selectors only. The signed form (long the top-5 by `TR24`,
  short the bottom-5) is the dollar-neutral basket row of §5.4, which is the
  backlog entry's original idea run descriptively; a per-leg "direction =
  sign(TR24)" variant is a fit-only sensitivity.
- **Why 24 h**, fixed here (the backlog said "12–48 h"): it is the shortest
  window that spans one full daily cycle, so the intraday volume/volatility
  profile cancels between numerator and denominator dates, and it does not
  overlap the 30-minute reader window. 12 h and 48 h are **fit-only
  sensitivities**, printed in full, never a verdict.

### 2.3 The nulls — what makes this a test of selection

Both nulls run the identical reader, stop, exit and costs on the identical
day; only the selection changes.

- **Null A — random-5 draw, primary, 1,000 draws.** For each tradable day,
  5 symbols drawn uniformly without replacement from that day's eligible set
  (A's set for arm A, B's set for arm B). Each draw is a full stream over the
  period; **one-sided `p` = share of draws whose mean net R ≥ the arm's mean
  net R.** This is the family's analogue of the matched-time placebo of every
  prior registration: the placebo is a random *instrument* rather than a
  random *bar*. It is the `p` in the ladder (§10).
- **Bottom-5 — deterministic null, always reported.** The 5 lowest-ranked
  eligible symbols by the same ranking (the paper's "below 100 % RVOL" tier).
  Reported with its own mean net R, and **`Δ_tb` = mean(top-5) −
  mean(bottom-5)** with a 90 % day-block bootstrap interval (days resampled
  jointly, so top and bottom of the same day travel together). **Tightening
  in the ladder:** a REAL EDGE requires the interval on `Δ_tb` to exclude 0.
  Rationale: if top-5 and bottom-5 both clear the bar, the reader or the
  market did the work, not the selection, and the family's claim is false
  even though its number is positive.
- **Null B — selection day-shift, secondary, 250 draws.** Day `d` trades the
  set selected on day `d − j`, `j ~ U{1..250}` tradable days (symbols not
  eligible on `d` are dropped from the shifted set). The analogue of the
  whole-stream day shift.
- **Middle-5** (ranks `⌊N/2⌋ − 2 .. ⌊N/2⌋ + 2`): descriptive, for the decile
  picture only.

### 2.4 Dose–response — the paper's own table, pre-registered as a reading

For each arm, fit period and (once, with the verdict) holdout: mean net R by
**decile of the ranking variable** across all eligible symbol-days, deciles
cut per day. **Pre-committed reading, applied only if the arm reaches REAL
EDGE:** if the holdout mean net R of deciles 8 and 9 (the two below the top)
is not above the mean of deciles 1–5, the pass is labelled **"isolated cell —
suspect"** in the REPORT's first paragraph and routed to Architect before any
build ruling, exactly as `orb-ny-open-short` pre-committed for its width
ladder. A kill reports the table and infers nothing from it.

### 2.5 The pre-registered comparison between selectors (descriptive)

Reported on the holdout beside the two verdicts, no verdict word:

1. `Δ_AB` = mean net R (arm A) − mean net R (arm B), 90 % day-block bootstrap interval (joint resampling of days).
2. Per-day **Jaccard overlap** of the two selected sets; share of legs that appear in both arms.
3. Mean net R of legs in **A only**, **B only**, **both** (fit and holdout).
4. Spearman rank correlation of `RVOL` and `|TR24|` across eligible symbols, averaged over days.

Fit-only: a **rank-sum combined selector** (top 5 by `rank_A + rank_B`), a
sensitivity, not an arm.

**Pre-committed wording:** "selector A dominates B" iff `Δ_AB > 0` and its
interval excludes 0; symmetrically for B; otherwise "indistinguishable". This
wording informs a *build ruling* only; it never creates or rescues a verdict.

---

## 3. Ruling 3 — the anchor: 09:30 New York, not 00:00 UTC

### 3.1 The anchor

- **`A` = 09:30 America/New_York on `d`, DST-aware**, converted as
  `research/orb-ny-open/common.py:ny_ms` does — 13:30 UTC under EDT, 14:30
  UTC under EST. The survey's "13:30 UTC" is the summer value of this clock,
  not a fixed UTC time; the mechanism argued below is the US cash open, which
  moves with US DST.
- **Days = NYSE full trading days** (`common.py:nyse_days`; holidays and
  early closes excluded and counted). On a day with no US cash open the
  anchor does not exist.
- Entry at `A + 30 min`; fixed exit at `A + 4 h 30 min` = 14:00 NY, inside
  the cash session on every eligible day (that is why early closes are
  excluded rather than kept).

### 3.2 Why this anchor and not the crypto-native one

1. **The 00:00 UTC reset does not select direction on crypto.** `orb-utc0-crypto` (Запись 26): forward lift **0.978** on BTC at 00:00 UTC on 1,885 fit trades; the same negative band at 08:00, 16:00 and the no-story 04:00 placebo. Whatever a range at UTC midnight is, it is not the start of a directional move.
2. **The NY anchor is where a direction signal on crypto was last seen.** The NY-anchored crypto ORB arms were killed on the ladder (Запись 23), but their forward lift sat **above 1.00 on all four crypto arms** (1.035–1.234) — direction was selected and the construction did not convert it. This family keeps the anchor where the lift lived and changes the two things the survey says mattered: *which* instrument (the cross-section) and *no range/trigger/target* (the plainest reader).
3. **The mechanism is information arrival at the US open.** US-hours volume share, ETF flow, US equity correlation and the US news cycle all key off 09:30 NY. "Abnormal volume in the first 30 minutes of US hours" is the crypto analogue of the paper's opening relative volume; "abnormal volume at UTC midnight" has no analogue in the paper and no mechanism in Запись 26.
4. **Honesty about what informed the choice:** point 2 is a holdout-period observation from a closed family. That is one of the reasons §7.2 attaches a forward-confirmation requirement to any pass.

### 3.3 Controls on the anchor (descriptive, mandatory, no verdict)

- **Weekend row.** Both arms, same NY clock, Saturdays and Sundays; RVOL denominator over the prior 14 *calendar* days' same window (anchor days do not exist on weekends). Pre-registered reading: if an arm reaches REAL EDGE and its weekend row is at or above the arm's holdout mean net R, the REPORT says "the clock, not the open" and the pass is flagged to Architect as suspect before any build ruling; on a kill the row is reported and nothing is inferred.
- **Fit-only placebo anchors: 00:00 UTC and 04:00 UTC**, seven days, identical code path with the anchor as a parameter. **Never the holdout.** Reading as in `orb-utc0-crypto` §8.3: if the 04:00 placebo is at or above the 09:30 NY arm on the fit period, the anchor is not doing anything and the REPORT says so.

**Other anchors are not registered** (08:00 UTC London, 00:00 UTC as an arm,
the 16:00 NY close): a different anchor is a different registration.

---

## 4. Ruling 4 — the direction reader, deliberately the plainest possible

```
r30(s, d) = close(bar opening at A + 29 min) / open(bar opening at A) − 1
side      = +1 if r30 > 0, −1 if r30 < 0, no trade if r30 == 0 (counted)
entry     = close of the bar opening at A + 29 min   (the price at A + 30 min)
```

- **No range, no breakout trigger, no threshold on |r30|, no filter of any
  kind.** Every selected instrument trades every tradable day (unless
  `r30 == 0`). If this family passes, nothing in the entry can be credited;
  if it fails, nothing in the entry can be blamed — that is the design.
- **Same window as the selector.** `RVOL` is measured on `[A, A + 30)` and
  the direction is read on `[A, A + 30)`; both are known at `A + 30`. This
  mirrors the paper (volume and first-candle direction on the same opening
  window, entry after it).
- Entry at the signal bar's close is the project's standard fill
  (`session-liquidity-v5-ny/DESIGN.md` §4); slippage is not modelled.
- **Fit-only sensitivities:** a minimum-move filter `|r30| ≥ 0.10 × dATR14`
  (trade only if the opening move is not noise); the 5-minute reader
  (`r5`, with entry at `A + 5 min`, the paper's own construction — reported
  once beside the 5-minute `RVOL` sensitivity of §2.1).

---

## 5. Ruling 5 — stop, exit, one trade per instrument, the basket as secondary

### 5.1 The volatility unit

`dATR14(s, d)` = Wilder ATR(14), code **verbatim** from
`orb-utc0-crypto/indicators.py:atr_wilder`, on **UTC daily bars** of `s`
(00:00 → 00:00 UTC, from the 1d archive, cross-checked against 1m
aggregates on 30 random symbol-days in `checks.py`), value as of the **last
complete UTC day before `d`** (that day ends at 00:00 UTC on `d`, before any
anchor). UTC days rather than NY session days so the weekend row and the
placebo anchors use the same unit. Warm-up 15 days, inside the 30-day
listing rule.

### 5.2 Stop ladder — 0.5 × dATR14 gates

```
stop_dist = s × dATR14(s, d);   long: stop = entry − stop_dist;  short: stop = entry + stop_dist
1R ≡ stop_dist
```

| `s` | status | projected `cost_R` at dATR = 2.5 % / 5 % / 8 % of price |
|---|---|---|
| **0.5** | **gates (the arm)** | 0.08R / 0.04R / 0.025R |
| 0.25 | fit-only sensitivity | 0.16R / 0.08R / 0.05R |
| 1.0 | fit-only sensitivity | 0.04R / 0.02R / 0.0125R |
| 0.10 | fit-only **cost row** (the 2024 paper's stop) | 0.40R / 0.20R / 0.125R |

Why 0.5 gates, ruled rather than searched: a 4-hour hold on a coin whose
volatility is elevated that day has a typical excursion of the order of
0.4–0.7 dATR (assumption, not computed); 0.5 dATR is a stop that binds on a
real adverse move and not on noise, at a `cost_R` in the 0.03–0.08R band
that every prior crypto verdict in this project was reached in. 0.25 is the
cost-sensitive end and 1.0 the effectively-unstopped end; both are printed.
1.5 × dATR (the dispatch's example) is dropped because inside 4 hours it is
indistinguishable from 1.0 — it would be a row that says nothing. **The
gating cell is fixed now and does not move for any reason, including power.**

### 5.3 Exit — fixed horizon or stop; the 1-minute path

- **Time exit at `A + 4 h 30 min`** (entry + 4 h; 14:00 NY), at the close of
  the bar opening at `A + 4 h 29 min`. **Or the stop**, whichever comes first.
  No target, no trail, no break-even: the hypothesis is continuation over a
  fixed horizon and the number must be allowed to show it.
- **Fill convention** on the 1-minute path from the bar opening at `A + 30`
  onward, `orb-ny-open/engine.py:walk1m` with no target: a minute whose low
  (long) / high (short) touches the stop fills at the stop; a stop gapped
  through fills at that minute's open; the time exit fills at the close.
  Missing minutes inside the path are skipped (not filled), counted per
  trade; a trade whose path has > 30 missing minutes is excluded and
  counted.
- **One trade per instrument per arm per day.** No re-entry. The same
  instrument may be selected by both arms on the same day — each arm is its
  own hypothesis and evaluates it; the overlap is reported (§2.5). A build
  would trade it once; that is a build-ruling matter.
- **Fit-only horizon sensitivities:** +2 h; 16:00 NY (end of cash session).
  Never a verdict.

### 5.4 The dollar-neutral basket — secondary, descriptive, no verdict

The backlog entry's original construction, run in full and reported under a
heading that reads "Descriptive — no verdict — not pre-registered":

- Each tradable day: **long the top 5 by signed `TR24`, short the bottom 5 by
  signed `TR24`**, equal notional per leg (10 legs, dollar-neutral), entry at
  `A + 30`, exit at `A + 4 h 30`, **no per-leg stop**. Report the daily basket
  return in bp of gross notional, net of 0.10 % per leg, and in units of the
  basket's own trailing-60-day daily-return standard deviation; annualised
  Sharpe; by year.
- The same basket on selector A is not dollar-neutral by construction (RVOL
  has no sign) and is not run. Instead, a **beta-hedged row for each
  primary arm**: every leg paired with an opposite-side `BTCUSDT` leg of
  equal notional, same entry and exit, its own 0.10 %. Answers "is this just
  crypto beta for four hours"; descriptive.
- **Portfolio risk description** for the build ruling: per day, the sum of
  leg net R across the 5 legs of an arm (distribution, worst day, worst
  20-day run), and the mean pairwise correlation of same-day leg outcomes.
  These numbers are what "one account, k legs, netted risk" means for sizing
  and they are why `n_holdout` is counted in trade-days as well as legs (§10).

---

## 6. Ruling 6 — costs, funding, and the honest target

### 6.1 Costs

- **0.10 % round trip** (2 × 5 bp Binance USD-M taker), `cost_R = 0.001 ×
  entry / stop_dist`, `orb-ny-open/engine.py:cost_R` Binance branch,
  identical to every prior crypto arm. Slippage not modelled; the sentence
  "slippage is not modelled, so every number is optimistic" appears in the
  REPORT, and here with the addition "and a coin in play has a thinner book
  than BTC".
- **Sensitivities, fit-only, never a verdict:** 0.04 % (maker) and **0.20 %**
  (thin-book taker + slippage on alts — the cost-sensitivity row survey §4.1
  requires for the pump-and-dump concern). The REPORT shows the `cost_R`
  distribution per arm and the gross-vs-net gap.

### 6.2 Funding — every trade crosses the 16:00 UTC settlement

A position open from 13:30/14:30 UTC to 18:00/19:00 UTC crosses the 16:00 UTC
funding settlement on every eligible day. Typical funding (0.01 % per 8 h) is
≈ 0.005R at the gating stop and is ignored in the primary, **but a coin in
play can carry extreme funding** (0.1–0.3 % per 8 h is common in a pump),
which is 0.04–0.12R against the crowded side. Ruling:

- **Primary: funding not modelled** (comparable with every prior crypto arm, none of which crossed a settlement).
- **Mandatory secondary row: realised funding applied**, from the archive's `fundingRate` monthly files (`data/futures/um/monthly/fundingRate/<SYMBOL>/`), payment `= side × (−rate) × entry / stop_dist` in R for a position open at the settlement timestamp; a missing rate is treated as 0 and counted.
- **Veto in the ladder (§10):** a REAL EDGE requires the funding row's holdout mean net R ≥ +0.05R with the same sign. If the primary and the funding row straddle a tier the REPORT says so in its first paragraph.

### 6.3 The honest target, in the unit that does not depend on the stop

The survey said the +0.08R tier of the paper will not survive 0.1–0.3R
costs and the honest target is the top tier (+0.38R). Worked through in
dATR units, the statement is sharper than that, and the Researcher must
read it before the fit period:

- The paper's stop is **0.10 × dATR14**, so its per-trade tiers in dATR units are: below-100 %-RVOL **−0.002 dATR**, above-100 % **+0.008 dATR**, above-3,000 % **+0.038 dATR** — gross of spread, which the paper assumes away.
- Our round trip is 0.10 % of price = **0.04 dATR** for a BTC-like coin (dATR 2.5 %), **0.02 dATR** for a typical alt (5 %), **0.0125 dATR** for a high-vol alt (8 %).
- So the paper's **top** tier, transplanted naively, nets **≈ +0.018 dATR** on a typical alt and **≈ 0** on a BTC-like coin. At the gating stop (R = 0.5 dATR) that is **+0.036R / 0.0R — below this project's +0.05R kill bar**. At `s = 0.25` it is +0.07R / 0; at the paper's own `s = 0.10` it is +0.18R / 0 but at a `cost_R` of 0.2–0.4R.
- The mapping is indicative, not exact: expectancy at a wide stop is not a linear rescale of expectancy at a tight one (a tight stop truncates losers *and* winners differently). It is printed so that everyone knows the scale.

**Ruling and statement for the REPORT:** to clear the build bar at the gating
stop on a typical alt, the selected instruments must continue by roughly
**+0.07 dATR gross per 4-hour trade**, about **twice** the paper's top tier.
The family is registered on the argument that a crypto alt "in play" moves
more in 4 hours than a US stock in play moves in a day *relative to its own
ATR*, and that a 50–400-symbol cross-section ranked to the top 1–10 % is
closer to the paper's top tier than to its middle. **That argument is the
hypothesis; if it is wrong the family dies at the fit screen, which is the
correct outcome.** The REPORT prints, beside every R number, the **mean net
return in dATR units** (`netR × s`) so the reader can compare with the paper
without the stop in the way. No tier below the paper's top is a target of
this registration.

---

## 7. Ruling 7 — split, the used holdout, and the α ruling

### 7.1 Split and declaration

| period | dates | use |
|---|---|---|
| **Fit** | **2020-01-01 .. 2025-07-31**, effective from the first day with `N_elig ≥ 50` (expected 2020-H2, recorded in `DESIGN.md`) | all exploration, every sensitivity, the fit screen |
| **Holdout** | **2025-08-01 .. 2026-07-31** | **computed once, at the end**, after `DESIGN.md` and the fit-screen decision are committed; the two verdicts and every descriptive row's holdout column |
| **Forward confirmation** | **2026-08-01 .. 2026-10-31** | **not read in this pass** (§7.3); frozen script, run once when the tape exists, only if an arm reaches REAL EDGE |
| Weekend / placebo anchors | fit dates only (placebos); fit + holdout (weekend row) | descriptive |

Split by the **NY calendar date of the anchor**. Never re-cut. **No tail row
in this pass** — a deliberate departure from every prior package, because the
tail is the forward-confirmation window.

**Declaration, required by `orb-utc0-crypto/DESIGN.md` §13.2 and carried
into `DESIGN.md` §1 verbatim:** the 2025-08-01 .. 2026-07-31 window has been
registered on **22** pre-registered ORB arms and actually **read by 11** of
them (Записи 23–26), of which **4 reads were on crypto** (`orb-ny-open`
BTC/ETH × 5m/15m), plus **2 further crypto reads** by `cmc-bot-vwap` Stage 1
(BTCUSDT-(a), ETHUSDT-(a), Запись 22). On BTCUSDT and ETHUSDT specifically,
the year has been judged six times. Every one of those reads was a
single-instrument, time-series clock mechanic on BTC or ETH.

### 7.2 The α ruling — a fresh line count, argued, with a paid-for tightening

The question the dispatch asks: does this family continue the cumulative
ledger (α = 0.05 / (22 + 2) ≈ 0.0021) or start its own (α = 0.05 / 2 =
0.025)? **Ruling: its own count, α = 0.025 per arm**, for these reasons,
each of which had to hold:

1. **What Bonferroni protects against is picking the best of several
   hypotheses on the same data and reporting it as if it were the only one
   tried.** The 22 ORB arms were 22 variants of one mechanic (a range break
   on one of four instruments); the cumulative count was right because each
   family was a re-try of the last one's question with a parameter moved. This
   family's object is different in kind: a *ranking across ~50–400 symbols*,
   498 of which have never been read on this window, with a reader that has
   no range, no trigger and no target. A pass here would not be "ORB finally
   worked on the 23rd try"; it would be a different claim. The §13.2 ruling
   already anticipated this ("a non-ORB family that wants this window starts
   its own line count but declares the 22/11 prior use").
2. **The cumulative α would make the test unpowered by construction.** With
   ≈ 250 trade-days × 5 legs in the holdout and within-day correlation of
   legs (design effect ≈ 2 at ρ ≈ 0.3 — assumption), a true +0.10R effect at
   per-leg σ ≈ 0.8R gives an effective `t ≈ 3`, i.e. `p ≈ 0.001`: powered at
   0.025, marginal at 0.002. Registering a test that cannot pass is not
   rigour; it is a kill written in advance.
3. **What the prior reads did leak into this design is specific and
   bounded:** the anchor choice (§3.2 point 2 — the NY forward lift is a
   holdout observation) and the knowledge that BTC/ETH single-instrument
   clock signals are dead on this year. Neither touches the ranking, the
   `k`, the stop, the horizon or the nulls, which are set from the paper and
   from first principles above.

**The tightening that pays for point 3:** because one design choice was
informed by a read of this window, **a REAL EDGE verdict on either arm does
not route to a build ruling; it routes to a frozen forward confirmation
(§7.3) and only a confirmed pass routes to a build ruling.** This is the
same remedy the exit family applied to its third look at the indices, and it
is nearly free here: at ≈ 5 legs per trading day the forward window
accumulates the required sample in three months.

**Both ledger numbers (22 registered / 11 read, plus 2 cmc-bot crypto) are
quoted in `DESIGN.md` and in the REPORT's first paragraph**, and this
family's own count is opened at **2 registered / 0 read** until the holdout
is computed. Any future family on this window that ranks a cross-section
continues *this* count.

### 7.3 Forward confirmation — pre-registered now, run later

- Window **2026-08-01 .. 2026-10-31**, same two arms, same everything, script
  frozen at the commit that records the holdout verdicts; run **once**, when
  the 2026-10 monthly archives exist (≈ 2026-11-05). Only for an arm that
  reached REAL EDGE.
- **Confirmed** iff forward mean net R ≥ +0.05R, same sign, random-5 `p ≤
  0.05`, on ≥ 60 trade-days and ≥ 250 legs; otherwise **"not confirmed
  forward"** and the arm returns to Architect with no build. A confirmation
  is a *replication* bar, not a discovery bar; that is why it is +0.05R at
  0.05.
- If the forward window is short of 60 trade-days when the tape is first
  available, wait; do not read early.

---

## 8. Ruling 8 — engine work: what is reused, what is new

### 8.1 Reused verbatim or by direct adaptation

| piece | source | use here |
|---|---|---|
| monthly-archive fetch, timestamp normalisation, header handling, gap audit, `history_audit.json` | `orb-utc0-crypto/prep/extend_history.py` | generalised to N symbols and to the paginated S3 listing (§1.1); the `1d` and `fundingRate` archives use the same fetch with different `COLS` |
| Wilder ATR(14) | `orb-utc0-crypto/indicators.py:atr_wilder` | `dATR14` on UTC daily bars |
| 1-minute path walker, gapped-stop fill | `orb-ny-open/engine.py:walk1m / walk1m_many` | stop-or-time exit (target = `±inf`) |
| Binance cost branch | `orb-ny-open/engine.py:cost_R` | unchanged; 0.04 %/0.20 % modes added |
| NYSE full-day calendar, NY DST clock, weekend days | `orb-ny-open/common.py` | the anchor day set and `A` |
| day-block bootstrap, Null-B day shift, ladder application, REPORT tables | `orb-utc0-crypto/analysis.py` | resampling unit = anchor day (all legs of a day travel together) |
| mechanic-proof format | `orb-ny-open/mechanic_proof.py` | ten hand-checked *days* per arm, each with all 5 legs, the full ranking table of that day (top 10 / bottom 10), the reader, stop, exit minute |

### 8.2 New — the portfolio harness

1. **Universe table** (`prep/universe.py`): paginated listing → admitted symbols → first/last archive month → `results/universe.csv` (committed). **Two-stage pull:** (i) `1d` monthly archives for every admitted symbol (small), giving listing/delisting dates, daily quote volume and `dATR14`; (ii) `1m` monthly archives **only for symbol-months in which the symbol is eligible on at least one day** by rules 1, 4, 5 of §1.3 (which need only daily data), plus the month before (for the RVOL denominator and `P(A − 24 h)`). Projection: 300–500 symbols with eligible months, 15–25 GB of zips, 6–10 GB of parquet; several hours with 6 threads. Data lives under `research/crosssec-instruments-in-play/data/` (add to `.gitignore`), one parquet per symbol per interval. The audited `BTCUSDT_1m_2020.parquet` / `ETHUSDT_1m_2020.parquet` must be **byte-identical** to the freshly pulled BTC/ETH tapes over their common span — this is the stop rule that validates the new puller against the old.
2. **Per-day feature build** (`features.py`): for every (symbol, anchor day) — `V30`, `RVOL`, `TR24`, `r30`, `dATR14`, liquidity median, eligibility flags with the failing rule recorded. One long table, `results/panel.parquet`. Computed once for 09:30 NY, weekends and the two placebo anchors.
3. **Cross-sectional ranking** (`select.py`): per day and selector, ranks over the eligible set; top-5 / bottom-5 / middle-5 / deciles; the rank-sum combined selector; the RVOL-threshold sensitivity (`RVOL ≥ 3`, capped at 10 legs, fit-only).
4. **Multi-leg trade table** (`engine.py`): one row per (day, arm/row, leg) with `symbol, side, entry, stop_dist, exit_cause, exit_price, grossR, cost_R, netR, funding_R, minutes_missing`, the selection rank and the ranking value. Basket rows carry `notional_ret_bp` instead of R.
5. **Vectorised random-5 null** (`nulls.py`): draws are (day × 5) symbol indices; each draw's legs are evaluated through the same `engine.py` path. 1,000 draws × ~1,250 holdout legs is ~1.25 M leg evaluations per arm — precompute the per-(symbol, day) leg outcome once for **every eligible symbol-day** (the reader, stop and exit do not depend on the selection), then every null, decile, bottom-5 and sensitivity is an index lookup. This is the one design decision that makes the harness cheap: **evaluate the whole eligible panel once, select afterwards.**
6. **Basket accounting** (`basket.py`): dollar-neutral daily return, beta-hedged rows, daily sum-of-legs R and its distribution.
7. **Screen and holdout gate** (`analysis.py fit | screen | holdout | forward`): `holdout` refuses to run until `DESIGN.md` contains the §13-style screen decision commit hash; `forward` refuses to run before 2026-11-01.

Nothing here needs LightGBM or any ML; the package installs nothing beyond
the project venv.

---

## 9. Ruling 9 — the pump-and-dump / delisting control

The concern (survey §4.1): a coin in play is often a coin in a pump-and-dump
or on its way to delisting; a pass could be a handful of such days.

- **In the primary, causal only:** the 10 M USDT liquidity floor, the 30-day
  listing rule, and the 4.5-hour tape-through-exit rule (§1.3). Nothing that
  uses the future beyond the trade's own path.
- **Mandatory secondary row with a veto: "delisted within 30 days after the
  trade" excluded** — every leg whose symbol's `last_bar < A + 30 × 24 h` is
  removed; the row is reported for both arms, fit and holdout. **A REAL EDGE
  requires this row's holdout mean net R ≥ +0.05R, same sign.** It is a veto,
  not the primary, because it uses information a trader did not have (the
  future delisting); in the primary it would be survivorship in the other
  direction. If the primary passes and this row does not, the REPORT's first
  paragraph says "delisting-driven" and the arm routes to Architect as
  suspect.
- **Mandatory descriptive rows:** share of legs on symbols delisted within
  30 / 90 days (fit, holdout); mean net R of legs whose `RVOL ≥ 10` (extreme
  attention) vs the rest; the 0.20 % cost row (§6.1); the RVOL-decile dose
  response with its pre-committed "isolated cell" label (§2.4); mean net R
  by liquidity quintile (14-day median quote volume).
- **Why no primary-side exclusion of extreme RVOL:** "exclude the coins with
  the most attention" would be excluding the hypothesis. The paper's edge was
  in the > 3,000 % tier.

---

## 10. Ruling 10 — the verdict ladder, α re-counted, screen, tightenings

### 10.1 Fit screen — decided before any holdout number

As `orb-ny-open-short` §5 and `orb-utc0-crypto` §7.4: an arm may read the
holdout iff, on the fit period, **mean net R ≥ +0.05R and random-5 `p ≤
0.05`**. The decision is written into `DESIGN.md` with the fit numbers and
**committed before `analysis.py holdout` is run**; the script checks for that
commit. A screened-out arm is **NO EDGE — KILL (fit screen)** and its holdout
column stays blank. Descriptive rows still get their holdout column when at
least one arm is screened in; if both arms are screened out **the holdout is
not computed for anything** and the family's ledger stays at 2 registered / 0
read.

### 10.2 The ladder — per arm, template as above, holdout mean net R per leg

| condition | verdict |
|---|---|
| `n_holdout < 150` legs **or** `< 150` trade-days | **UNDERPOWERED — inconclusive.** No directional claim. Return to Architect. |
| holdout mean net R `< +0.05R` **or** random-5 `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.025 < p ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| **all** of: mean net R `≥ +0.10R`; random-5 `p ≤ 0.025`; fit same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150` legs and ≥ 150 trade-days; 90 % day-block bootstrap interval excludes 0; **gross** expectancy `> 0`; **and** `Δ_tb` (top-5 − bottom-5) interval excludes 0 (§2.3); **and** the funding row `≥ +0.05R` same sign (§6.2); **and** the delisting-exclusion row `≥ +0.05R` same sign (§9) | **REAL EDGE — routes to the §7.3 forward confirmation**, then to Architect for a build ruling. |

- **α = 0.05 / 2 = 0.025** — the family is the two full arms of §0. The
  fit-only ladders (stops 0.25/1.0/0.10; k = 3/10; RVOL ≥ 3; 12 h/48 h;
  5-minute reader and RVOL; horizons; cost modes; minimum-move filter;
  rank-sum selector; signed-`TR24` direction) are **sensitivities, never
  arms**, printed in full whatever they show, and none may be promoted by
  re-reading. If the Researcher finds the arm count wrong, tighten, do not
  loosen.
- The kill bar stays at +0.05R and the build bar at +0.10R for the standing
  reasons (unmodelled slippage, optimistic close-fill) with one added here:
  five correlated legs a day make the per-leg `n` overstate the evidence,
  which the trade-day floor and the day-block resampling address and the
  bars do not loosen.
- **Nulls and interval:** random-5 (Null A, 1,000 draws, `p`), Null B
  selection day-shift (250 draws, reported), day-block bootstrap of anchor
  days with replacement, 2,000 draws, 90 % interval — on the arm's mean net R
  and jointly on `Δ_tb` and `Δ_AB`.
- **Pre-registered interpretations across families, fixed now:** a kill here
  says nothing about the funding-rate family (different input, per-asset
  engine) and does not reopen any ORB arm; a pass here does not reopen ORB on
  any instrument (the reader has no range and no trigger; the claim is about
  selection). A pass driven by BTC/ETH legs alone (reported: share of legs
  and of net R on BTC/ETH) is flagged as suspect, because survey §4.1's own
  reasoning is that those are the two coins least likely to be "in play".
  Запись 2 (clock filters on crypto) is not contested: the anchor here is a
  ranking time, not a filter, and the weekend row is the control.

---

## 11. Order of work and stop rules

1. **Universe and daily data.** `prep/universe.py`: paginated listing, admitted symbols, `1d` archives for all, `results/universe.csv` and `results/history_audit_1d.json`. Then the eligible symbol-month set and the `1m` pull for it; `results/history_audit_1m.json` with per-symbol first/last bar, gap list, duplicate count. **BTC/ETH identity check against the audited `_1m_2020.parquet` files — stop rule.** `fundingRate` archives for eligible symbols. **No R computed yet.**
2. **`DESIGN.md`** restating this note mechanically — universe rule, eligibility with each rule numbered, the `N_elig` series and first tradable day, anchor and calendar, both selectors' formulas, the reader, the ladder cells with the gating cell marked, fill convention, cost model with the price side stated, funding row, nulls, the two-arm family with α = 0.025, the §7.1 declaration with both ledger numbers, the forward-confirmation window, the screen rule, every fit-only sensitivity listed by name — **committed before any R is computed on any row**.
3. **Mechanic proof on the fit period** (`MECHANIC-PROOF.md`): ten hand-checked anchor days per arm, each showing that day's eligible count, the top-10 and bottom-10 of the ranking with their `V30` / median / `RVOL` (or `P(A)`, `P(A − 24 h)`, `TR24`), the five selected legs with `r30`, side, entry, `dATR14`, stop, exit minute and cause, `cost_R`, `netR`; the §1.3 look-ahead check; the 1d-vs-1m daily bar agreement check; the DST check (anchor = 13:30 or 14:30 UTC on every day, never anything else).
4. **Fit-period numbers** for both arms and every row and sensitivity; the power projection (trade-days and legs per year, projected `n_holdout`); the **screen decision recorded in `DESIGN.md` and committed**.
5. **Holdout, once:** the two verdicts locked, then the descriptive rows' holdout columns, `Δ_tb`, `Δ_AB`, the decile tables, the veto rows. **Nothing after 2026-07-31 is read.**
6. **`REPORT.md`**: the two verdicts and the §7.1 declaration in the first paragraph; the §6.3 dATR-unit numbers beside every R number; descriptive rows under headings without verdict words; every sensitivity actually run, including the ones that came out worse; the cost and slippage sentences. **`HANDOFF.md`** to Architect; a `RESEARCH-LOG.md` Запись regardless of outcome. A kill is a result.
7. **Forward confirmation** (§7.3): only on a REAL EDGE, only after 2026-11-01, script frozen at step 5's commit; a second short REPORT section and a follow-up Запись.
8. **Stop and return to Architect** immediately if: the BTC/ETH identity check fails; the paginated listing returns fewer than 800 USDT symbols (the archive changed); `N_elig` never reaches 50 before 2021-07-01 (the universe assumption is wrong and the threshold needs a ruling, not a quiet change); the look-ahead check fails for any eligibility rule or selector; the 1d and 1m daily bars disagree beyond float tolerance on any checked day; the anchor falls on any UTC time other than 13:30 or 14:30; realised `n_holdout < 150` legs or trade-days on a screened-in arm (that arm is UNDERPOWERED, the other proceeds); or the pull cannot complete within the Researcher's session budget (report the coverage reached; do not run on a partial universe).

---

## 12. Explicitly not ruled here

- **Software Engineer / Backtesting / a live configuration** — only after a *confirmed* REAL EDGE (§7.3) and a further Architect ruling on sizing (per-leg vs per-basket risk, the §5.4 numbers are the input).
- **The funding-rate family** (survey §4.2) — a separate registration, per-asset engine, may run in parallel; it does not share this family's α count or its harness.
- **A cross-sectional reversal / end-of-day / lagged-periodicity family on this universe** (survey §4.5) — the harness built here is its prerequisite; a different registration.
- **Any other anchor as an arm**, any `k` other than 5 as an arm, any stop other than 0.5 × dATR14 as an arm, any horizon other than +4 h as an arm — sensitivities here, registrations elsewhere.
- **The 8-perp 5m data on disk** (`research/intraday-mtf-smc/`) — not used; too thin to rank (the backlog entry already said so) and 5-minute bars cannot evaluate the 1-minute path.
- **US equities** — the paper's own venue; no free survivorship-free intraday tape exists for it and the user has not authorised paid data.
