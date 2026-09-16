# Where LightGBM / ML actually fits — NY-session intraday, after Study B (Architect, 2026-09-16)

**Role:** Architect · **Trigger:** the user's request, in parallel with the two
just-dispatched families (cross-sectional "instruments in play", funding-rate
signals), for a *concrete* proposal on where machine learning is genuinely
useful in this project — not "use more ML". **Audience:** Architect /
Researcher / coordinator (role-to-role; technical English). **Not a
registration; nothing here is dispatched.** Companion to
`2026-09-intraday-directions.md` (the survey), which this note assumes read.

**Status of this document:** ruling on roles and timing, with enough
specification that a future Researcher dispatch can act on each item without a
second Architect round. Numbers quoted from this project's own passes are cited
to their files.

---

## 0. The one-paragraph answer

ML in this project is a **second-stage tool, and in one place a first-class
selector — never a signal generator.** Three concrete roles survive scrutiny,
in priority order: (1) a **LightGBM ranker inside the cross-sectional family**
(§2) — the only place in the project where the data volume (tens of thousands
of instrument-days, not ~1,400 trades) and the task shape (rank *which*
instrument today, inside a day-grouped structure with nulls already designed)
make gradient boosting the right tool rather than a decoration; it is
conditional on the simple two-selector package first earning a REAL EDGE on at
least one selector, and its baseline to beat is that selector; (2) **Stage B as
a standard, pre-planned second stage after any future REAL EDGE** (§1), rebuilt
from ORB's Study B with three changes forced by what the project has since
learned — a power statement, the "filter can only subtract" economics row from
the deriv-positioning pass, and a price-shadow redundancy control for every
non-price feature; (3) **ML as a leakage detector in the checks stage** (§4.3),
cheap and discipline-strengthening. A **regime / context classifier as a
standalone model is not proposed** (§3): on this project's tapes it has ~400
training sessions on the index side, every regime feature it would use was
already tested and unflagged in Study B or killed in Запись 2, and the honest
conditioning variables (release day, funding extreme, relative volume) are
already being tested as pre-registered *rules* in the two dispatched families,
which is the stronger design. **Timing:** no ML work warrants its own
Researcher dispatch today; two zero-cost addenda to the running families (§5)
make the later ML stages possible, and the rest waits for a verdict.

---

## 1. Role 1 — Stage B as the standard second stage after a REAL EDGE

### 1.1 What ORB's Study B established, and what it could not

`research/orb-ny-open/studyb.py` and `ARCHITECT-NOTE.md` §6 are the project's
working ML discipline: fit-only training, fixed shallow hyper-parameters
(`num_leaves=7, max_depth=3, min_data_in_leaf=30, lambda_l2=10`), blocked
chronological 5-fold CV with a 5-session purge, seeds 0–4, **permutation and
SHAP importance on out-of-fold rows only, never gain**, a **200-refit
target-shuffle max-statistic null** (Westfall–Young FWER control over the 24
features), a frozen-model holdout read with pre-committed wording, and the rule
that a flag is a proposal for a new registration, never an edge. Result: zero
flags on both timeframes; early stopping fired at a median of 3 (5m) and 1
(15m) rounds; the frozen 5m model's holdout tercile spread was +0.114R with a
90 % interval [−0.009, +0.236] — spanning zero, correctly reported as no skill
(`REPORT.md`, Study B section; `results/studyb/holdout_frozen_read.csv`).

Two things about that result that the next Stage B must build on:

- **The base signal had E[netR] ≈ 0, so the target was pure noise.** Study B
  on ORB could not have found a *conditional* edge unless it was large enough
  to exist inside a signal that on average paid nothing. That is the user's
  point and it is correct: a Stage B on a signal with a real base edge asks a
  better-posed question — *which slices of a positive expectancy carry it.*
- **It was underpowered for anything but a large conditional effect, and
  this is arithmetic, not design.** With n ≈ 1,400 fit trades and a per-trade
  netR standard deviation of about 1R, the standard error of a top-vs-bottom
  tercile difference is ≈ 1R × √(2/467) ≈ 0.065R; the FWER-controlled flag
  bar over 24 features sits near 2.5σ, so **Stage B can only find a tercile
  spread of roughly ≥ 0.15R** — i.e. a conditional effect *larger than the
  build bar for the unconditional edge itself*. A base edge does not fix
  that; only n does. This must be stated in the DESIGN of every future Stage
  B so that "no flags" is read as "no *large* conditional structure" and
  nothing more, as the ORB REPORT already worded it.

### 1.2 Ruling: pre-plan Stage B as a standard clause, with three changes

Every future family's `DESIGN.md` carries a **Stage B clause**, not written
fresh each time. The clause:

1. **Trigger.** The fit-period part (train, importances, null, flags) runs
   **regardless** of the family's verdict, as ORB's did — it is cheap and a
   killed unconditional signal may still hide a conditional one worth a *new*
   registration. The **frozen-model holdout read runs only if at least one arm
   of the family reached REAL EDGE** (or, at Architect discretion, cleared the
   fit-period screen). Reason: a holdout read on a killed arm spends a look at
   the holdout year for a proposal that could not be registered on that year
   anyway; the project's α ledger (Запись 27) counts looks, and ORB's Study B
   read was one. **Every Stage B frozen read is entered in the ledger as a
   declared non-verdict look.**
2. **Target and table.** Target = the arm's template-1 `netR`, as ORB's. The
   per-trade table with the feature vector computed at decision time is
   persisted as `results/trades_all.parquet` with a `period` column, as ORB's
   is — this is what makes Stage B a one-command step later rather than a
   re-engineering job. (**§5.1 asks the two running families to do this now.**)
3. **Feature vector.** Pre-registered, **capped at 15–20 columns**, each with
   a one-line mechanism, computed on bars closing ≤ the entry bar (ORB
   `features.py` conventions and the `checks.py` look-ahead assertion carried
   verbatim). Directional features side-signed. **No feature is added after
   any out-of-fold number exists.**
4. **Method, fixed.** Study B's hyper-parameters and null, unchanged, plus one
   addition: **a univariate tercile scan with the same max-statistic null is
   the primary reading; LightGBM is the secondary, kept for interactions.**
   At n ≈ 1,400 the boosted model early-stopped into a one-to-three-stump
   ensemble — it *was* a univariate scan with 200 × 5 × 5 refits of overhead.
   The scan has the same power at a fraction of the compute and is easier to
   read; the model earns its place only if a two-feature interaction beats
   every single feature under the null (report that comparison once).
5. **The "filter can only subtract" economics row — mandatory for every
   flagged feature, fit period.** From `deriv-positioning` (Запись 8): the ΔOI
   top-tercile filter passed the permutation null and still destroyed 90 % of
   the fit-period P&L (+8,339 → +816) while keeping 55 % of trades, because
   the **middle tercile carried much of the unconditional edge**. For each
   flag, print: trades retained, gross and net P&L retained, and expectancy
   with the filter, vs unconditional. A flag whose filter does not raise
   *total* net P&L on the fit period is reported and **not proposed**, whatever
   its tercile spread. This is the single most important lesson the project
   has for ML conditioning and Study B did not have it yet.
6. **Price-shadow redundancy control for every non-price feature** (funding,
   OI, taker imbalance, calendar): rerun the identical tercile read with the
   feature replaced by its nearest price-only proxy (trailing return rank,
   realised-vol rank), same code, same cut-points. A non-price flag that its
   price shadow matches is dead (the deriv-positioning rule, §5.3 there). This
   matters most for the funding family: the backlog's own worry is that
   funding proxies `momentum_breakout`'s continuation, and Stage B is where
   that worry gets a number.
7. **Proposal form, unchanged.** "*Arm X conditioned on F ≥ q (q = fit-period
   tercile boundary, fixed), as a new pre-registered arm, own α, same ladder,
   same nulls, fresh registration, on a later holdout or a declared re-use*."
   Never a rescue.

**Meta-labeling (López de Prado) is this clause, not a further step.** The
project's template-1 outcome (+1R target / range stop / 16:00 time exit) *is*
a triple-barrier label, and Stage B's model on `netR` *is* the secondary
model of meta-labeling with the pre-registered rule as the primary. The one
piece of that framework not yet in the clause is **sizing by predicted
probability instead of binary filtering** — which is exactly the remedy for
item 5's failure mode (a sized book keeps the middle tercile at reduced
weight instead of discarding it). It is added as a **descriptive fit-period
row only**: net P&L of the book with bet size ∝ clipped out-of-fold predicted
`netR` (0.5×–1.5× of 1R, pre-registered clip), vs flat. A sized book is a new
strategy and, if it looks better, earns its own registration; it does not
change the arm's verdict.

### 1.3 Would it be more informative on the two dispatched families? Honestly

- **Funding family (survey §4.2):** per-asset on 8 perps; trade counts will
  be in Study B's range (hundreds to low thousands per arm). Stage B there is
  the same power-limited object as ORB's, with one difference that makes it
  worth running: the *specific* question "does funding add anything beyond
  price" already has a pre-registered comparison in the family, and Stage B's
  price-shadow row is its per-feature complement. Expect it to confirm or
  deny redundancy, not to find new structure.
- **Cross-sectional family (survey §4.1):** here Stage B collapses into
  §2 — the "trades" are instrument-days, there are tens of thousands of them,
  and "which conditions make the trade pay" *is* "which instrument to pick".
  That is why §2 is the strongest ML case in the project.

---

## 2. Role 2 — a LightGBM ranker inside the cross-sectional family

### 2.1 Why this is the one place gradient boosting is the right tool

| | ORB Study B | cross-sectional ranker |
|---|---|---|
| rows | ~1,400 trades / timeframe | ~40–50 eligible perps × ~1,450 weekdays (2020-01 .. 2025-07) ≈ **50–70k instrument-days** fit; ~13k holdout |
| task | regress noise on 24 features | **rank within a day**: which k of ~50 pay, given a fixed trade construction |
| structure | independent-ish trades | day groups; within-day ranking removes the market factor by construction |
| nulls | target-shuffle | **already designed**: bottom-k, random-k, and (new) target-shuffle *within day* |
| baseline | none (no base edge) | **the pre-registered RVOL / trailing-return selector**, which must first have earned REAL EDGE |

Learning-to-rank inside a day-grouped cross-section is the textbook shape for
a boosted-tree model, the only shape in this project with enough rows for the
model to be more than a stump ensemble, and the only one where the hand-built
baseline and the nulls already exist. It is also a direct answer to the user's
own point 2: the simple two-selector design is deliberately the plainest
possible so that a pass attributes to *selection*; a richer ranker is the
natural second step *of the same hypothesis*, not a third direction.

### 2.2 Gate — strictly after 4.1's verdict, and only on a pass

- **If both selectors are killed:** no ML ranker. The hypothesis "abnormal
  attention selects which instruments continue" would then have no evidence
  on this tape, and a richer ranker over the same universe would be searching
  for a *new* cross-sectional signal with 15 features — the unconditional
  mining the survey §0 diagnosed as dead, done with more comparisons. Log
  and stop.
- **If ≥ 1 selector reaches REAL EDGE:** the ranker is registered as a
  follow-up family with that selector's top-k basket as **the baseline it
  must beat**, on a **later** holdout (2026-08-01 .. 2027-07-31, run once
  when the tape exists) or a declared re-use of the project year with the
  cumulative ledger stated. A ranker that merely *matches* the simple
  selector loses to it by parsimony, and the DESIGN says so before any number.

### 2.3 Specification for the future Researcher dispatch

- **Rows.** Every eligible instrument-day (universe rule from 4.1, survivorship-
  free, including delisted names, pump-and-dump exclusion as pre-registered
  there). **Target = the 4.1 direction-reader trade's `netR` on that
  instrument-day**, computed for *all* instrument-days, not only the selected
  ones. This is the meta-labeling framing: primary = 4.1's rule, secondary =
  the ranker.
- **Features (pre-registered, ≤ 15, all expressed as within-day percentile
  ranks so the model is scale-free across coins and regimes):** opening RVOL
  (the baseline selector, kept in so the model must *add* to it, not replace
  it); trailing return 1d / 3d / 7d; realised-vol 1d / 7d; **funding rate at
  the last settlement and its 7-day percentile** (the bridge to family 4.2);
  ΔOI over 24 h and taker buy/sell imbalance (both already on disk from
  `deriv-positioning`; subject to §1.2 item 6's price shadow); dollar-volume
  rank (size proxy); days since listing; beta to BTC over 30 d; BTC's own
  realised-vol rank that day (a *market-wide* day feature — the only form of
  "regime" this note proposes, §3). Every feature computed strictly before
  the 13:30 UTC anchor + 30 min decision point.
- **Model.** LightGBM, Study B's fixed shallow parameters, `objective =
  regression_l2` pointwise on within-day-ranked features (**not**
  `lambdarank`: it adds a tuning axis and the pointwise model evaluated by
  within-day rank is adequate at this k). **Walk-forward, not k-fold:**
  expanding-window refits every 6 months inside the fit period with a 5-day
  embargo, so every out-of-fold prediction is strictly causal; seeds 0–4
  averaged. **A rank-linear baseline (ridge on the same ranked features) is
  mandatory beside it**; if LightGBM does not beat ridge on the fit-period
  metric, ridge is the model that goes to the holdout.
- **Metric.** Out-of-fold **top-k basket net P&L per day** vs the RVOL top-k
  basket, same k, same costs (0.10 % taker round trip per leg, `cost_R`
  printed), same stop ladder; secondary: mean within-day Spearman of
  prediction vs realised `netR`.
- **Nulls.** (a) **Target-shuffle within day** — `netR` permuted across
  instruments inside each day, 200 refits, max-statistic over features for
  flags *and* the null distribution of the basket P&L; this tests *selection*
  specifically, holding every day effect fixed. (b) The 4.1 nulls, bottom-k
  and random-k, re-run on the ranker's own k. (c) The RVOL-only baseline.
- **Bar, pre-committed.** Fit period: ML top-k must beat RVOL top-k by a
  pre-registered margin (proposal: ≥ +0.05R per leg net, day-block bootstrap
  90 % interval on the *difference* excluding 0) **and** beat ridge. Holdout,
  one read: the same difference, same interval, plus the ladder's own kill /
  build thresholds on the ML basket itself. Everything else descriptive.
- **Importances.** Permutation and SHAP on out-of-fold rows, never gain;
  flagged features against the within-day null; the §1.2 item 5 economics row
  per flag; price-shadow row per non-price flag.
- **Honest prior.** Moderate *conditional on 4.1 passing*, low otherwise. The
  likeliest positive outcome is that funding and RVOL together beat RVOL
  alone by a small margin, which is exactly the kind of result the +0.05R
  bar and the ridge comparison exist to keep honest.

---

## 3. Role 3 — a regime / context classifier: not proposed as a standalone

### 3.1 What the literature offers and what it is worth

Regime conditioning of intraday rules is everywhere in the practitioner
literature (HMM on realised volatility, trend-vs-range classifiers, "VIX
regimes") and in the two papers the survey read closely: Baltussen et al.
(JFE 2021) and Gao et al. (JFE 2018) both report market intraday momentum
stronger on high-volatility, high-volume and macro-news days; firmtape's 2026
retest survives only on dealer-short-gamma sessions. Mesfin's (2026)
regime-classifier positive controls are unverifiable and were already set
aside in the survey §4.5. In every case the conditioning variable is either a
**single observable rule** (volatility tercile, release day) or a **paid
external input** (dealer gamma). None is a fitted classifier over engineered
features, and none of the peer-reviewed ones is out of sample on the 2022+
tape.

### 3.2 Would it have helped a closed strategy? No, and the project already has the evidence

- Study B carried `atr_regime`, `datr_pct`, `or_rvol`, `bar_rvol`, `tod_min`,
  `dow`, `gap_datr`, `prev_day_ret` — the whole volatility / clock / activity
  regime vocabulary — and flagged none (`REPORT.md`, both timeframes).
- Запись 2: time-of-day / day-of-week filters on crypto had a fit-vs-holdout
  improvement correlation of **−0.49**; the permutation test said the chosen
  hours were no better than random hours of the same selectivity.
- Запись 8: a positioning-based conditioning that *passed* its permutation
  null was killed by its price shadow and by the economics row.
- Survey §2.5: the independent tests place whatever ORB / intraday-momentum
  edge exists in elevated-volatility *years* (2020, 2022) and find it gone
  after; this project's fit and holdout are entirely inside the dead regime.
  A classifier trained on this tape would have learned "never trade" — which
  is the verdict, not a strategy.
- Sample size makes it worse: a *day-level* classifier on the Capital.com
  index tape has ~400 fit sessions (2024-01 .. 2025-07). Any fitted model on
  400 rows is dominated by the single-rule alternative it would replace.

**Ruling.** No standalone regime classifier, on any tape, for any closed
family. The legitimate form of "condition participation on context" is a
**pre-registered rule on one mechanistically motivated observable** — release
day, funding-extreme day, top-k relative volume — tested as an arm with a
comparison bar against the unconditional version and a price shadow. That is
what families 4.1 and 4.2 and probes 4.3 / 4.4 already are (4.3 explicitly
reports by volatility tercile and by release day). ML adds nothing to that
except comparisons. The only regime input this note proposes is a **single
market-wide day feature inside the §2 ranker** (BTC realised-vol rank that
day), where it costs one column and is judged under the same null as
everything else.

---

## 4. Other genuinely useful things, and the tool question

### 4.1 Is gradient boosting even the right tool at this project's data volumes?

- **Per-trade studies (n ≈ 10² – 10³, all per-asset families):** no. The ORB
  Study B boosted model early-stopped at 1–3 rounds; it was a univariate
  scan with a 5,000-refit overhead. §1.2 item 4 makes the univariate tercile
  scan with the max-statistic null the primary tool and keeps LightGBM only
  for a one-shot interaction check. Ridge / rank-regression is the honest
  multivariate alternative at this n.
- **Cross-sectional instrument-days (n ≈ 10⁴ – 10⁵):** yes, with the ridge
  baseline beside it (§2.3). This is the only setting where the model has
  enough rows to learn a non-linear interaction (e.g. RVOL × funding) that a
  hand rule would not write down.
- **Deep / sequence models on raw bars:** no, and not because of taste — the
  survey's §0 diagnosis is that unconditional price-only mechanics are dead at
  realistic costs on this tape, and a model that learns from raw OHLCV is the
  same search with an unbounded comparison count. Explicitly excluded by the
  user's brief and by this ruling.

### 4.2 Feature engineering worth doing, NY-session crypto specifically

Only inputs the project already has or can get free, each with a mechanism,
each ranked within day where cross-sectional: opening relative volume at the
13:30 UTC anchor (attention); funding rate and its rolling percentile
(crowding); ΔOI and taker imbalance (positioning — must beat their price
shadow); US-hours volume share = volume 13:30–20:00 UTC ÷ 24 h volume over the
prior 5 days (how "US-driven" the coin currently is — the ETF-era transmission
story from `orb-ny-open/ARCHITECT-NOTE.md` §2, expressed as a per-coin feature
instead of an anchor hypothesis); days since listing and dollar-volume rank
(pump-and-dump / thin-name control). Not proposed: CME basis, ETF flows,
dealer gamma, options data — all paid or unavailable, and the user has
declined paid data.

### 4.3 ML as a leakage detector in the checks stage — cheap, recommended

The strongest practical use of a boosted model in a fit-only pipeline is as a
**bug finder**: a model that finds a large, null-beating importance on any
feature is far more likely to have found a look-ahead than an edge. Study B's
zero flags is what a clean pipeline looks like. Proposal: every future family's
`checks.py` gains one step — train Study B's fixed model on the pre-registered
feature vector against the *forward return from the entry bar to the exit*,
with a 50-refit target-shuffle max-statistic null, **before** any expectancy
number is read; any flag is treated as a **leakage suspect first**, and the
feature is re-derived from a truncated tape (the existing `checks.py`
look-ahead assertion) before it is allowed to stay. This costs minutes, uses
code that exists, and turns the model's tendency to overfit into a detector
for exactly the error class that would otherwise inflate a verdict. It does
not read the holdout.

### 4.4 Guardrails specific to ML, to be carried into every DESIGN that uses it

Restating the discipline in ML terms so a Researcher cannot relax it under
"the model will figure it out": fixed hyper-parameters (early stopping is the
only fitted quantity); feature set pre-registered and capped; out-of-fold
importances only, never gain; Westfall–Young max-statistic null over features;
a linear baseline reported beside every boosted model; one frozen holdout
read per family, entered in the α ledger; no re-engineering of features or
target after an out-of-fold number exists; **the number of model variants
tried is itself a count** (a second objective, a second feature set, a second
k is a second arm — deflated-Sharpe logic, survey §2.7); every non-price
feature has a price shadow; every flag has an economics row.

---

## 5. Timing and recommendation

### 5.1 Now — two zero-cost addenda to the running families, no new dispatch

1. **Cross-sectional family (4.1):** compute and persist the direction-reader
   trade outcome (`netR`, gross, cost) for **every eligible instrument-day**,
   not only the selected top-k, together with the decision-time observables
   already in the design (RVOL, trailing returns, ATR, dollar volume, days
   since listing). This is the random-k null's raw material anyway; kept as
   `results/instrument_days.parquet` with a `period` column it is also the
   §2 ranker's training table, and no re-engineering will be needed later.
   No feature beyond what the family already computes; nothing is read.
2. **Funding family (4.2):** persist the per-trade table with the feature
   vector at decision time (`trades_all.parquet` convention, ORB
   `features.py` conventions), including the trailing-return and realised-vol
   columns that will serve as the funding features' price shadows.

Both are data-retention notes the coordinator can forward in one sentence
each; neither changes a registered arm.

### 5.2 After verdicts

| condition | ML step | what it is |
|---|---|---|
| 4.1 REAL EDGE on ≥ 1 selector | **§2 ranker**, own registration, later holdout | the strongest ML case in the project |
| 4.1 both selectors killed | nothing | a ranker would be unconditional mining |
| any family REAL EDGE (4.1 or 4.2) | **§1 Stage B** frozen read, ledger entry | conditional structure + sized-book row |
| any family killed | §1 Stage B fit-period part only, no holdout read | cheap, may propose a *new* registration |
| every new family, from the next DESIGN on | §4.3 leakage check in `checks.py`; §1.2 Stage B clause; §4.4 guardrails | discipline, not research |

### 5.3 Is there a standalone ML angle worth pursuing now? No.

Every ML use that survives this note is either conditional on a verdict the
two dispatched families will deliver, or a discipline item that costs no
dispatch. The one thing that looks like a standalone ML project — "train a
ranker over a wide crypto universe and see what it finds" — is the thing the
brief and the survey both exclude, and its legitimate version (§2) is the
second step of 4.1, not a parallel track. **Recommendation: forward the two
§5.1 addenda now, adopt §1.2 / §4.3 / §4.4 as standing clauses in the next
DESIGN template, and hold every other ML step until 4.1 reports.**

---

## 6. Files referenced

`research/orb-ny-open/studyb.py`, `features.py`, `checks.py`,
`ARCHITECT-NOTE.md` §5–§6, `REPORT.md` (Study B section),
`results/studyb/train_summary.json`, `results/studyb/holdout_frozen_read.csv`;
`research/deriv-positioning/DESIGN.md` §5.3 and `RESEARCH-LOG.md` Запись 8
(price shadow, economics row); `RESEARCH-LOG.md` Запись 2 (time-of-day null);
`research/_surveys/2026-09-intraday-directions.md` §0, §2.5, §2.7, §4.1, §4.2,
§4.5; `IDEAS-BACKLOG.md` (funding-rate; cross-sectional entries).
