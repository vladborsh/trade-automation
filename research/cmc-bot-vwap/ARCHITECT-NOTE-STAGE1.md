# Architect note — Stage 1 gate ruling, `cmc-bot` VWAP band-reversal

**Date:** 2026-09-16 · **Status:** Stage 1 **approved**, scope and numbers
fixed below. This note is the binding pre-registration for the Researcher's
Stage 1 pass. It supplements `ARCHITECT-NOTE.md` (2026-09-12 routing ruling),
which stays in force wherever this note is silent. Inputs: `HANDOFF.md`
(Stage 0 + 2026-09-13 addendum), `PARITY.md`, `results/INVENTORY.md`,
`results/crypto/*`, `RESEARCH-LOG.md` Записи 20–21,
`knowledge/vwap-band-reversal-ict.md`.

Nothing in this note was written with sight of any performance number. None
exists. The Researcher computes nothing on the holdout until `DESIGN.md`
restating this note is committed.

---

## 0. Summary of rulings

| # | question | ruling |
|---|---|---|
| 1 | tape (D-01) | **`snapshotTimeUTC` — the live bot's bars — is the only admissible tape.** The bot's own mislabelled backtest hours are not a secondary row; they are not run. |
| 2 | bar (L-01) | **Backtest bar (bar opened at T, `live_like=False`) is primary.** `live_like=True` is a **mandatory secondary row with one gating consequence** (§2). |
| 3 | split / forex | **Pre-registered arms: US100, US500.** Fit **2024-01-01 .. 2025-07-31**, holdout **2025-08-01 .. 2026-07-31**. **EURCHF, GBPCHF: descriptive-only**, same pipeline, no verdict, never promoted without a fresh registration (§3). |
| 4 | crypto | **Routed, as two further pre-registered arms — BTCUSDT and ETHUSDT under condition (a), the NY window.** Condition (b) 24/7 is **descriptive-only, caps off**. Fit 2022-08-01 .. 2025-07-31, holdout 2025-08-01 .. 2026-07-31 (§4). |
| 5 | thresholds | **Carried verbatim** from the 2026-09-12 ruling — kill `< +0.05R` or `p > 0.20`; build needs all of `≥ +0.10R`, `p ≤ 0.0125`, fit same sign, `n_holdout ≥ 150`, 90 % day-block bootstrap excludes 0, gross > 0 — **per arm, plus one tightening** (the live-like row must not sit in the kill tier). Nothing loosened (§5). |

The pre-registered family is therefore **exactly four arms — US100, US500,
BTCUSDT-(a), ETHUSDT-(a)** — each with its own verdict, α = 0.05/4 = 0.0125
per arm, no pooling, no picking. Everything else in the pass is descriptive
and says so in its heading.

---

## 1. Ruling 1 — which tape (D-01)

**Primary and only tape: bars keyed by `snapshotTimeUTC`**, exactly as
Stage 0 keyed them. This is what the deployed bot trades; the mislabelled
`snapshotTime` reading is a bug in the bot's *offline* path only.

- The bot's-own-backtest hours (indices ≈ 06:xx–09:xx NY, forex ≈
  00:xx–01:xx NY) are **not run, not reported, not a sensitivity**. They share
  0–3 orders in ~900 with the live stream; they are a different strategy
  wearing this one's labels, and measuring them would only invite a reader to
  compare two things that must not be compared.
- **To the user, stated plainly in the REPORT's first section:** any past
  backtest or grid search of this strategy on Capital.com scraped files
  (`npm run scrap` → `BacktestRunner`) measured hours 2–3 h earlier than the
  labels said and is not evidence about the live windows. The 09:40–11:40 NY
  / 03:02–03:20 NY windows have never been measured by anyone before this
  pass.
- **The index windows stay the user-specified provisional values** (entry
  09:40–11:40 NY, alive 09:40–14:30 NY). They are *this registration's*
  parameters. Changing them after seeing a result is precisely what
  pre-registration forbids: a different window is a **new registration** with
  its own one shot and its own Bonferroni accounting, not a rework of this
  one. Researcher does not run alternative windows in this pass, gating or
  otherwise.

## 2. Ruling 2 — backtest bar vs. live bar (L-01)

**Primary: the backtest bar** — at gate minute T evaluate the bar that opened
at T (`engine.run(..., live_like=False)`).

Why: it is the object Stage 0 proved bit-exact against the bot's TypeScript
over 200,322 bars. `live_like=True` is, by the Researcher's own docstring,
"NOT the parity target": it approximates deployment through assumptions
about request latency and the `max: 720` truncation, and the live path has
two further behaviours (L-02 chunk-boundary double count on 59 % of US500
evaluations, L-03 clock-lead rejection) that cannot be reproduced
bar-exactly at all. A primary must be the thing that was proven.

**Mandatory secondary row: `live_like=True`**, same template, same costs,
same nulls, reported beside the primary for every arm and every descriptive
leg. **Gating consequence (a tightening, §5):** a REAL EDGE verdict on the
primary requires the live-like row to have holdout mean net R **≥ +0.05R with
the same sign**. If the two rows straddle a verdict tier the REPORT says so
in its first paragraph; the primary decides the tier, the live-like row can
only veto a build. Rationale: a build would run the live path, and 92–98 %
order overlap is not 100 %.

L-02 and L-03 are listed in `DESIGN.md` as unmodelled live-path divergences,
not simulated.

## 3. Ruling 3 — split, and the forex legs

### 3.1 The forex legs are descriptive-only (option c)

EURCHF and GBPCHF are **removed from the pre-registered gate**. Reasons, in
order of weight:

1. **Power.** ≈ 89–90 caps-off orders per year each. `n_holdout ≥ 150` needs
   ≥ 20 months of holdout out of 32.3, leaving ≤ 12 months of fit — that is
   not a fit/holdout design, it is a holdout with a decorative prefix. Option
   (b) "thin fit anyway" would produce a number the verdict ladder cannot
   honestly place: a pass would rest on a fit-period sign check with ~90
   trades, a kill would be indistinguishable from noise at +0.05R. The
   2026-09-12 ruling's own stop rule (`n_holdout < 150` → UNDERPOWERED,
   return to Architect) already answers this; I am applying it now rather
   than after a run.
2. **Cost geometry.** Median initial stop is 2.7 bp (EURCHF) / 3.6 bp
   (GBPCHF) (`results/crypto/stop_distance_bp.txt`). A Capital.com forex
   spread of the order of 1–2 bp is a large fraction of the stop, so
   `cost_R` per trade is of order 0.3–0.7R before slippage. Whatever the
   mechanic does, the forex legs are a cost problem first; that is worth
   *seeing*, not worth a one-shot verdict.
3. **The windows are hard-coded in the bot** (17–18 minutes), so unlike the
   indices there is no cheap way to widen the population without changing the
   strategy.

**What "descriptive-only" means here, precisely:**

- Same engine, same tape, same split dates as the indices (§3.2), same
  templates, same cost model, same Null A / Null B / bootstrap machinery,
  same tables — **run and reported in full**, under a REPORT heading that
  reads "Descriptive — no verdict — not pre-registered".
- **No verdict word** (kill / inconclusive / real edge) may appear next to a
  forex number. No pooled index+forex row anywhere.
- These rows **cannot be promoted** to a verdict later by re-reading them. If
  the user wants a forex verdict, the path is a fresh registration once the
  Capital.com floor has moved far enough: at ~90 orders/yr the forex legs
  need ≈ 20 months holdout + ≈ 24 months fit ≈ 44 months, i.e. **not before
  ~2027-09** on this vendor, or a different vendor (a different tape, hence a
  different registration — `ARCHITECT-NOTE.md` §4's broker caveat).
- Option (a) "indices only" was rejected only in the sense that running the
  forex rows costs nothing once the pipeline exists and the user trades
  them; option (b) was rejected for reason 1.

### 3.2 The split (all Capital.com instruments)

- **Fit: 2024-01-01 .. 2025-07-31** (19 months).
- **Holdout: 2025-08-01 .. 2026-07-31** (12 months), by the signal bar's UTC
  date, **computed once, at the end, after `DESIGN.md` is committed**. Never
  re-cut.
- **Tail: 2026-08-01 .. 2026-09-11** (≈ 6 weeks) — reported as a separate
  non-gating "post-holdout tail" row per arm; it never enters any verdict.

Why these dates and not "last 12 of 32 months": the holdout year
**2025-08-01 .. 2026-07-31 is this project's standard holdout** (v5-NY,
smart-money ruling §3.2, and the crypto arms in §4 below). Aligning it means
every pre-registered line in this project is judged on the same twelve
months of market, so "this passed where that one failed" is a like-for-like
statement. The cost is one month of fit (19 vs 20), which is immaterial at
≈ 675 / 760 projected caps-off fit orders for US100 / US500.

Projected holdout n (caps off, from `INVENTORY.md` per-year counts):
US100 ≈ 420, US500 ≈ 480 — both comfortably ≥ 150. If the realised
`n_holdout` for either index falls below 150 the ladder's UNDERPOWERED row
applies and the arm returns to Architect with no directional claim.

### 3.3 Population (restating the 2026-09-12 ruling, unchanged)

Primary population per arm: every order the engine places with the **daily
2-loss / 1-win caps removed** (`daily_caps=False`), the ≤1-open-per-direction
rule kept. The **as-deployed capped population is a mandatory secondary row**.
The ~38 % of index signals swallowed by an open same-direction order is a
property of what a "trade" is here and stays; report the count.

## 4. Ruling 4 — crypto (BTCUSDT, ETHUSDT)

### 4.1 Routed, as separate pre-registered arms — condition (a) only

**BTCUSDT and ETHUSDT under condition (a)** — entry 09:40–11:40 NY, alive
09:40–14:30 NY, Mon–Fri, i.e. the indices' configuration transplanted
unchanged — are **two further pre-registered arms**, each with its own
verdict, run in the same Stage 1 pass as the indices.

Why include them at all: the user asked; the mechanic is fully specified and
bit-exact on this tape (4.59 M bars, 0 discrepancies); power is not a
constraint (≈ 335–410 caps-off orders/yr); the machinery is identical; and
the answer is decisive either way. Deferring would buy nothing but a second
pass later.

Why (a) and not (b): the strategy as designed is a **session** strategy — a
VWAP anchored at a daily reset, an entry window, a forced flat, daily caps.
Condition (a) tests *that* hypothesis on a new tape. Condition (b) tests a
different hypothesis — the mechanic with no session concept — on a
population nobody designed: its "window" is an artefact of the caps
(93–94 % of as-deployed orders in 00:00–06:00 UTC), the UTC-midnight VWAP
anchor is the Binance daily-candle boundary and nothing more, the band is
zero-width at the reset and the 00:00 bar throws daily, the caps-off
population is ≈ 4,000 orders/yr dominated by re-entries, and the median
stop (17.7 / 25.2 bp) is under twice the standard round-trip cost. Giving
that a one-shot verdict would be registering a strategy the user never
wrote.

**Condition (b) is descriptive-only, caps off**, same rules as §3.1's
forex legs: full pipeline, full tables, "Descriptive — no verdict" heading,
no verdict word, no pooling with (a), never promoted by re-reading. The
caps-on (b) population is reported once, as a count and a clock histogram,
to document the artefact — nothing else is computed on it.

### 4.2 Standing nulls and the "one shot" concern

The Researcher's question was whether testing crypto here risks the
concerns the 2026-09-12 ruling raised. Ruling:

- **The crypto arms contest the same standing nulls as the index arms, no
  more.** The proximal-edge iFVG (`smc.md` §3 encoding #4, siblings closed)
  and the prior-hour-sweep shape (`session-liquidity.md` family, Запись 18
  killed) are already what this strategy is arguing with; the tape does not
  change the argument. The 2026-09-12 ruling accepted that argument for one
  shot; the same acceptance covers crypto under the same one-shot terms. **A
  miss on a crypto arm is a kill of this mechanic on that symbol**, not a
  rework request.
- **Overlap with the killed v5-NY window** (Запись 18: NY morning on BTC/ETH,
  iFVG holdout −0.26R, placebo beat it 91 %): the overlap is the clock, not
  the mechanic (far-edge vs proximal iFVG, session-extreme vs prior-hour
  sweep, 5m vs 1m, fixed-UTC vs NY-DST window). Pre-registered
  interpretation, fixed now: **a kill on BTC/ETH-(a) does not touch Запись
  18 and Запись 18 does not touch this; a pass on BTC/ETH-(a) does not
  reopen v5-NY.** The forward-lift row (§6.4) is the one place the two are
  allowed to speak to each other, and only as attribution: if this
  mechanic's signals also land at ≈ 1.00 lift in that window, the REPORT
  says "the window, not the mechanic" in as many words.
- **No result on a crypto arm is evidence about an index arm or vice versa.**
  Different tape, different volume quantity in the VWAP (exchange base-asset
  volume vs broker tick activity), different cost model. Four verdicts,
  never a pooled one.
- **A REAL EDGE on a crypto arm routes to a *build decision*, not to
  "validate the deployed bot"** — the bot never ran `VWapStrategy` on
  crypto; there is no deployment to validate. Software Engineer would be
  building a new configuration, and that gets its own Architect ruling on
  whether to.

### 4.3 Crypto split, costs, caps

- **Split: fit 2022-08-01 .. 2025-07-31 (36 mo), holdout 2025-08-01 ..
  2026-07-31 (12 mo)**, by the signal bar's UTC date — identical to v5-NY and
  the smart-money ruling. Tail 2026-08-01 .. 2026-09-11 as a non-gating row.
- **Costs: 0.10 % round trip** (2 × 5 bp Binance USD-M taker),
  `cost_R = 0.001 × entry / stop_dist`, identical to v5-NY for
  comparability. Because the median stop in (a) is 31.8 / 41.9 bp, the
  median `cost_R` is of order 0.25–0.3R; **the REPORT must show the `cost_R`
  distribution per arm and the gross-vs-net gap explicitly**. One non-gating
  sensitivity: 0.04 % round trip (maker-side fills), reported, never used
  for a verdict.
- **Caps off in the primary**, capped as-deployed as the mandatory secondary
  row — same as every other arm.
- **Parameters unchanged**, every one. The Researcher's §4 notes (real vs
  tick volume, the band-width gate passing 88–89 % of biased bars in (a))
  go in `DESIGN.md` as stated facts, not as adjustments.

## 5. Ruling 5 — thresholds

**The 2026-09-12 thresholds carry over verbatim.** Per arm, applied
mechanically to the primary number (§6.2, template 1) on the holdout:

| condition | verdict |
|---|---|
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** No directional claim. Return to Architect. |
| holdout mean net R `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.0125 < p ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| **all** of: mean net R `≥ +0.10R`; `p ≤ 0.0125`; fit period same sign with `m_fit ≥ +0.05R`; `n_holdout ≥ 150`; 90 % day-block bootstrap interval excludes 0; **gross** expectancy `> 0`; **and (new, §2) the `live_like=True` row has holdout mean net R `≥ +0.05R`, same sign** | **REAL EDGE — build for real.** Routes to Architect for a build ruling. |

Why nothing is adjusted:

- **3.0R target vs 2.7R.** The thresholds are on **expectancy in R**, which
  is what a target trades off against hit rate; a higher target lowers the
  hit rate and raises the payoff, and the bar on their product is the same
  bar. The reasons the build bar sits at +0.10R rather than v5-NY's +0.05R
  (few trades per day inside one window, unmodelled slippage, an optimistic
  bot-native fill convention in the primary) all hold here unchanged. The
  kill bar stays at +0.05R so "failed the same bar" remains a true sentence
  across v5-NY, smart-money and this line.
- **Instrument mix.** Handled by *scope* (§3, §4 — which arms get a verdict)
  and by *cost model* (§6.3 — spread for CFDs, taker for perps), not by
  moving the bar. A CFD arm and a perp arm are judged against the same R
  thresholds after each pays its own realistic costs.
- **Family of nulls.** The same two standing nulls the smart-money ruling
  faced, plus a VWAP-band ingredient with no null. Not a reason to loosen;
  not a reason to tighten beyond what §2 adds.
- **Bonferroni.** `α = 0.05/4 = 0.0125` is retained; the family it now
  corrects is the four pre-registered arms of §0. Only template 1 gates per
  arm, so the four-arm family is the whole family. If Researcher finds this
  count wrong, tighten, do not loosen.

**The one addition is a tightening only** (the live-like veto on a build).
`DESIGN.md` may add mechanical detail and may not loosen anything here.

---

## 6. The test, restated for `DESIGN.md`

The smart-money ruling's §3.2 design is the template; differences are
this strategy's own template and windows. Fork
`research/session-liquidity-v5-ny/hypothesis.py` as that ruling did.

### 6.1 Arms and legs

| arm | tape | window (entry / alive) | fit | holdout | status |
|---|---|---|---|---|---|
| US100 | Capital.com 1m, `snapshotTimeUTC` | 09:40–11:40 / 09:40–14:30 NY | 2024-01-01..2025-07-31 | 2025-08-01..2026-07-31 | **pre-registered** |
| US500 | same | same | same | same | **pre-registered** |
| BTCUSDT-(a) | Binance USD-M perp 1m | same, Mon–Fri | 2022-08-01..2025-07-31 | same | **pre-registered** |
| ETHUSDT-(a) | same | same | same | same | **pre-registered** |
| EURCHF | Capital.com | 03:02–03:20 / 03:00–04:00 NY | 2024-01-01..2025-07-31 | same | descriptive |
| GBPCHF | Capital.com | 03:03–03:20 / 03:00–05:00 NY | same | same | descriptive |
| BTCUSDT-(b) | Binance | none, 24/7, caps off | 2022-08-01..2025-07-31 | same | descriptive |
| ETHUSDT-(b) | Binance | none, 24/7, caps off | same | same | descriptive |

All eight: primary caps-off, secondary as-deployed caps-on, secondary
`live_like=True`, tail row 2026-08-01..2026-09-11.

### 6.2 The four numbers per arm (2 templates × 2 fill conventions)

| # | trade template | fill convention |
|---|---|---|
| **1 (primary)** | **Bot-native**: entry at signal-bar close (+1 min, as the engine does), stop per `adjustStopLoss` shrink table, **target 3.0R**, BE-at-1R / +1R-at-2R trail, forced flat at the arm's alive-window end | **Bot-native**: exits on M1 closes only, fill clamped to the exact stop/target |
| 2 | Bot-native | **Realistic**: intrabar touch, stop checked first on a bar touching both, fill at the level for target and at the breaching bar's actual price for a gapped stop |
| 3 | **Project-standard** (v5-NY §6.3.3): entry at signal close, same stop anchor, target +1R, no trail, forced flat at the alive-window end | Realistic |
| 4 | Project-standard | Bot-native |

Number 1 gates. Numbers 2–4 are reported so the result cannot be dismissed
as an artefact of either choice; they carry no verdict. The realistic
template must be added to `engine.py` (or a sibling) as the smart-money
ruling required — Stage 0's engine has only the bot-native one.

### 6.3 Costs

- **Capital.com arms and legs.** The bot's candles are **bid/ask mids**
  (`capital-com.helpers.ts:10-13`), and `prep_data.py` keeps `spread_close`
  per bar. Cost model: **one full spread per round trip, taken from the
  tape** — half of the entry bar's `spread_close` on entry, half of the exit
  bar's on exit, converted to R by the trade's `stop_dist`. No commission
  (Capital.com CFDs are spread-only). No financing: every position is forced
  flat inside its alive window; `DESIGN.md` asserts and the checks verify
  that no position crosses a session boundary. Slippage is not modelled.
  Sensitivities, non-gating: (i) fixed spread = the in-window median for that
  instrument over the fit period; (ii) 2× the per-bar spread. The REPORT
  shows the `cost_R` distribution per arm.
- **Binance arms and legs.** 0.10 % round trip as §4.3; 0.04 % sensitivity.
- The sentence "slippage is not modelled, so every number is optimistic"
  appears in the REPORT.

### 6.4 Nulls, interval, secondaries (verbatim from the smart-money ruling, windows substituted)

- **Null A — matched-time placebo, primary, 1,000 draws.** Each real trade
  replaced by one entered at a bar drawn uniformly from the **same entry
  window on a different random weekday** (for the (b) legs: any bar of a
  different random day), same symbol, same side, same stop distance in ATR,
  same template, same forced-flat rule, same costs. One-sided
  `p = share of draws with mean net R ≥ observed`.
- **Null B — whole-stream day shift, secondary, 250 draws**, `k ~ U{1..250}`.
- **Interval.** Day-block bootstrap, whole UTC days with replacement, 2,000
  draws, 90 % interval on the holdout mean net R.
- **Secondary, non-gating, always reported:** exit-cause breakdown (target /
  stop / trailed stop / time-exit); **component ablation on the fit period
  only** — drop each of the VWAP-band bias+regime gate, the iFVG trigger,
  the premium/discount gate, the prior-hour sweep in turn; **non-circular
  forward lift** built as `v5-ny/tables.py:block_L`, with the §4.2
  pre-registered interpretation for the crypto arms.
- **Bug fidelity.** The primary reproduces the bot's behaviour exactly as
  Stage 0 proved it, including D-03's asymmetric `getLastIfvg` (1 order in
  2,322 — no sensitivity row needed), D-05/D-06/D-07, and D-18 (`VWAP([])`
  on forex holidays → no signal, as live). No "improvements" in the primary.

### 6.5 Order of work and stop rules

1. `DESIGN.md` restating this note in mechanical detail, **committed before
   any R is computed** on any arm or leg. It names: the tape, the bar
   convention, the eight legs and their status, the split dates, the four
   numbers, the cost model with the price side stated, the nulls, the
   ladder with the §2 tightening.
2. Fit-period numbers for all legs, then holdout **once**.
3. `REPORT.md`: verdict per pre-registered arm in the first paragraph; the
   D-01 statement to the user in the first section; descriptive legs under
   their own heading with no verdict words; every sensitivity actually run,
   including the ones that came out worse.
4. `HANDOFF.md` to Architect and a `RESEARCH-LOG.md` entry regardless of
   outcome. A kill is a result.
5. **Stop and return to Architect** immediately if realised `n_holdout < 150`
   on any pre-registered arm (that arm is UNDERPOWERED; the others proceed),
   if the realistic-fill template cannot be made to agree with the bot-native
   one on trades that neither gaps nor touches both levels, or if any
   parity re-run after engine changes shows a discrepancy.

## 7. Explicitly not ruled here

- **Software Engineer / Backtesting** — engage only on a REAL EDGE verdict,
  per arm, after a further Architect ruling (a crypto build is a new
  configuration, §4.2; an index build must fix D-01/D-18/L-03 per
  `HANDOFF.md`'s SE guidelines).
- **The smart-money package's D-03 exposure** (`knowledge/smart-money-ict.md`
  §1.3 and the unmerged Stage-0 WIP `429b0db` encode the symmetric reading)
  — belongs to that package's owner; flagged to the coordinator, not
  actioned here.
- **A 2022 extension of the Capital.com instruments** — impossible on this
  vendor (intraday floor 2024-01-01, confirmed by API probe). A different
  vendor is a different tape and would be a new registration; not routed.
- **Any alternative index window** — new registration, §1.
