# Session-liquidity **v5-NY** — the first pre-registered, hypothesis-tested pass

**Role:** Researcher · **Hand-off:** Architect (`HANDOFF.md`)
**Pre-registration:** `DESIGN.md`, committed **before any result existed**
(commit `Pre-register the session-liquidity v5-NY pass`).
**Inherited spec:** `knowledge/session-liquidity.md` §1/§3/§4/§5.1/§5.2/§6/§7,
unchanged. **Base implementation:** `research/session-liquidity-bos/`, forked.
**Visual audit:** `MECHANIC-PROOF.md` + `results/gallery_ny/GALLERY.md`.

Sample: BTC / ETH / SOL / BNB USD-M perp, 5m, **2022-08-01 .. 2026-07-31**.
**23,423 take-outs**, bit-identical to the v2 / v4 / BoS event stream;
**21,118 (90.2%)** primary. BTC and ETH foregrounded (DESIGN §2.3); SOL and BNB
computed identically and reported in the appendix.

`checks.py`: **36/36 PASS**.

---

## 0. The verdict, first

> **No edge. All four pre-registered numbers fail the kill rule, and they fail
> it at the first gate — the expectancy is negative before the p-value is even
> consulted.**

| arm | horizon | holdout trades | mean net R | Null-A p | verdict |
|---|---|---|---|---|---|
| iFVG-v4 | block-scoped (primary) | 297 | **−0.261** | 0.910 | NO EDGE — kill |
| iFVG-v4 | 24h | 297 | **−0.271** | 0.923 | NO EDGE — kill |
| BoS pinned anchor | block-scoped (primary) | 209 | **−0.019** | 0.070 | NO EDGE — kill |
| BoS pinned anchor | 24h | 209 | **−0.037** | 0.160 | NO EDGE — kill |

The pre-registered kill threshold was **mean net R < +0.05** (DESIGN §7). Every
arm is below **zero**, let alone below +0.05, on the holdout period that was
touched exactly once. The 90% block-bootstrap interval for the iFVG arm is
**[−0.378, −0.146]** — it does not come close to containing zero. The BoS arm's
interval **[−0.132, +0.092]** contains zero, which is a different way of saying
the same thing: nothing there either.

Three further facts, because a bare kill invites the wrong follow-ups:

1. **Gross expectancy is approximately zero**, not negative: −0.006R (iFVG) and
   +0.009R (BoS) over the full sample. The signal neither makes nor loses money
   before costs. The **0.10% round-trip fee is the entire negative** — and it
   is large in R terms (0.192R for iFVG, 0.116R for BoS) precisely because
   these stops are only 3–6 ATR wide.
2. **The NY window is not the problem, and it is not the fix.** In-window
   expectancy is essentially the same as out of it: iFVG −0.198R in-window
   against −0.216R all hours; BoS −0.107R against −0.100R. The window changes
   the number by less than the noise.
3. **The window does move one descriptive metric, and it is worth saying so
   plainly.** The non-circular forward lift — the metric the shelving ruling
   turned on — rises from 0.84 to **0.95** (iFVG) and from 0.89 to **1.00**
   (BoS) inside the window. That is a real, measurable improvement over the
   rest of the day. It lands the mechanic at **par**: 1.00 means "no better
   than a random comparable stretch of the same tape". Par is not an edge, but
   it is the closest this idea has come in seven passes, and §5 treats it
   seriously rather than dismissing it.

---

## 1. What this pass is, and how it differs from the six before it

The idea was **shelved** on 2026-08-31 (`RESEARCH-LOG.md` Запись 17). The user
reviewed that verdict, was not convinced, and asked for one more pass with
three definitional changes. Two facts about its origin were recorded in
`DESIGN.md` §0 before anything was computed, and they set the standard:

* it is **motivated by disagreement with a null**, and
* the changes are **hand-picked cuts** — a specific 100-minute window of the
  day, chosen by a human who believes that is where the move happens.

That is the classic p-hacking setup. So this is the first pass in the family
run as a **pre-registered hypothesis test** rather than under the descriptive
protocol of `knowledge/session-liquidity.md` §8 — which is also the standard
the Architect's own ruling (Запись 17 §7) demands before this idea may be
reopened. Fixed in advance and not touched afterwards: the hypothesis, the stop
rule, the trade template, the success metric, the chronological fit/holdout
split with stated dates, the permutation null, and a **numeric** kill rule.

The descriptive metrics every prior pass reported (MFE/MAE, forward lift,
window-length stratification, per-asset tables) are computed **as well**, in
`results/TABLES.md`, per DESIGN §0. Rigour was added on top of the house style,
not in place of it.

### 1.1 The three definitional changes

**(a) A long-horizon column, with block-scoping still primary.** The
block-scoped horizon (§6.1) remains the primary measurement. Added beside it:
an **h24** horizon running to `min(t0 + 288 bars, end of data)` — 24 hours from
the take-out bar, freely crossing block and day boundaries. **Detection is
unchanged**: a confirmation still has to occur inside the block-scoped window
to exist at all. Only the measurement horizon after confirmation is extended.
That separation is deliberate — "does the move keep going past the block
boundary" and "does a longer detection window find more events" are different
questions and mixing them would make the column uninterpretable.

**(b) A live NY-session filter, 09:40–11:20 New York.** See §2.

**(c) Assets.** All four computed; BTC and ETH carry the report, the charts and
the gallery; SOL and BNB are the labelled robustness appendix (§6). The
pre-registered test runs on **pooled BTC+ETH**, pinned in advance so the choice
could not be made after seeing which pool looked better.

---

## 2. The NY window: the offset, the caveat, and the eligibility funnel

### 2.1 The fixed UTC offset, and what it costs in precision

House convention is fixed UTC with no DST handling (24/7 crypto tape,
`knowledge/session-liquidity.md` §1). Mapping 09:40–11:20 New York through one
fixed offset:

| offset | becomes, in UTC | inside the NY block (13:00–21:00 UTC)? |
|---|---|---|
| **UTC−4 (EDT) — PINNED** | **13:40–15:20 UTC** | yes, fully |
| UTC−5 (EST) — sensitivity | 14:40–16:20 UTC | yes, fully |

UTC−4 is the primary because EDT covers roughly eight months of the calendar
against EST's four. **Both** offsets place the window fully inside the NY
block, so the design was feasible either way and neither number had to be
forced.

> **DST caveat — read this before quoting any number in this report.** A fixed
> UTC−4 window is **not** 09:40–11:20 New York wall clock all year. During EST
> months (roughly November to mid-March) it is really **08:40–10:20** New York.
> These are fixed UTC minutes that coincide with the intended New York window
> for about two thirds of the sample and sit one hour early for the rest.
> Nobody should read them as wall-clock precision around the 09:30 NYSE open.
> The UTC−5 sensitivity row exists so the reader can see the other reading, and
> it is **worse** for iFVG (−0.279R against −0.198R) and marginally better for
> BoS (−0.025R against −0.107R) — both still negative.

### 2.2 The eligibility funnel (chart `viz/01_funnel_and_clock.png`)

Because confirmation is block-scoped and the confirmation bar is at or after
the take-out bar, an in-window confirmation **forces the take-out itself into
13:00–15:15 UTC**. This is a structural consequence of the existing
definitions, not a choice made here, and `checks.py` C3 asserts it holds on all
3,225 in-window events.

| step | BTC+ETH | all 4 |
|---|---|---|
| take-outs | 11,584 | 23,423 |
| primary (≥12 bars of block left) | 10,447 | 21,118 |
| swept inside the NY block | 5,553 | 10,764 |
| `t0` could still produce an in-window confirmation | 3,705 | 7,058 |
| **iFVG confirms inside the window** | **1,056** | 2,134 |
| **BoS confirms inside the window** | **768** | 1,423 |

Of the 3,705 eligible BTC+ETH take-outs, **28.5%** convert to an in-window iFVG
confirmation and **20.7%** to an in-window BoS. In share-of-all-confirmations
terms the window captures **16.0%** of iFVG confirmations and **21.7%** of BoS
ones.

That is a small population, and the pre-registered minimum of 150 holdout
trades per arm (DESIGN §7) was set with exactly this risk in mind. Both arms
clear it — 297 and 209 holdout trades — so neither result is dismissed as
underpowered. But the reader should hold the sample size in mind: a 297-trade
holdout can resolve "is this clearly profitable" and cannot resolve "is this
worth +0.02R".

---

## 3. The trade, the split, and the null — what was pinned in advance

**The stop rule was not invented for this pass.** It is the project's existing
convention (`research/session-liquidity-bos/DESIGN.md` §2, in force since v2):
the distance from the confirmation close back to the **sweep leg's running
extreme over `[t0, u]`**. It depends only on bars at or before the entry, so it
is a rule an execution engine could run, and it keeps R comparable with all six
prior passes.

**The template** (DESIGN §4, pinned before any R existed): entry at the
confirmation close, direction high-sweep → short and low-sweep → long, stop as
above (`1R ≡ stop distance`), target **+1R**, walked bar by bar; the stop is
checked first so a bar touching both books a **loss**; unresolved trades are
**marked to market** at the horizon's last close; **0.10% round-trip cost**
(2 × 5 bp Binance USD-M taker) applied per trade as
`cost_R = 0.001 × entry / stop_dist`. Degenerate trades are excluded **and
counted** (113 of 20,741 confirmations, `results/a2_exclusions.csv`).

**The split** (DESIGN §5): fit **2022-08-01 .. 2025-07-31** (36 months),
holdout **2025-08-01 .. 2026-07-31** (12 months), by take-out UTC date. The
holdout was computed **once**, at the end.

**Null A, the primary test** (DESIGN §6): every real trade is replaced by one
entered at a random bar inside the *same* NY window on a *different* date, same
asset, same side, same stop width in ATR, same horizon type, same costs. 1,000
draws. It holds the clock, the risk, the direction mix and the cost model fixed
and destroys **only** the alignment with an actual swept level and an actual
confirmation — so it answers the question that matters: *does the
sweep-confirmation add anything over entering at a random moment in the same
window with the same risk?*

**Null B** shifts the whole confirmation stream forward by k whole days and
re-runs it at the same clock time (250 draws). **The bootstrap** resamples
whole UTC days (2,000 draws) for the interval; the day is the natural block
because intraday trades on one day share one tape.

The null machinery uses a vectorised copy of the trade template. It reproduces
the engine's scalar template on **7,114 of 7,114** real trades — asserted every
run, because a null that evaluated a slightly different rule than the
observation would be worthless.

---

## 4. The result (chart `viz/02_result_vs_null.png`)

### 4.1 The trades

BTC+ETH, NY window, block-scoped horizon:

| arm | period | n | mean netR | median netR | mean grossR | mean cost_R | win rate | target | stop | mtm | median stop |
|---|---|---|---|---|---|---|---|---|---|---|---|
| iFVG | fit | 759 | −0.174 | +0.017 | +0.020 | 0.194 | 50.2% | 45.9% | 44.0% | 10.1% | 3.06 ATR |
| iFVG | **holdout** | 297 | **−0.261** | −0.629 | −0.073 | 0.188 | 44.8% | 41.4% | 48.8% | 9.8% | 3.18 ATR |
| BoS | fit | 559 | −0.139 | −0.136 | −0.021 | 0.118 | 46.2% | 34.5% | 35.6% | 29.9% | 5.64 ATR |
| BoS | **holdout** | 209 | **−0.019** | +0.034 | +0.090 | 0.109 | 50.2% | 41.1% | 30.6% | 28.2% | 5.58 ATR |

Full tables, including the h24 horizon: `results/HYPOTHESIS.md` P1.

### 4.2 Against the null

| arm | horizon | holdout mean | Null-A mean | Null-A p | Null-B p | bootstrap 90% | fit mean | fit p |
|---|---|---|---|---|---|---|---|---|
| iFVG | block | −0.261 | −0.183 | **0.910** | 0.892 | [−0.378, −0.146] | −0.174 | 0.223 |
| iFVG | h24 | −0.271 | −0.187 | **0.923** | 0.892 | [−0.393, −0.149] | −0.173 | 0.236 |
| BoS | block | −0.019 | −0.105 | **0.070** | 0.124 | [−0.132, +0.092] | −0.139 | 0.870 |
| BoS | h24 | −0.037 | −0.104 | **0.160** | 0.248 | [−0.165, +0.094] | −0.164 | 0.932 |

**Read the Null-A column carefully, because it is the interesting part.**

The placebo itself averages **−0.18R (iFVG) / −0.10R (BoS)**. That is not a
bug: a symmetric ±1R barrier template with a 3–6 ATR stop, entered at a random
moment and charged a real fee, loses money. So the honest comparison is not
"observed versus zero" — the kill rule already handles that — but "observed
versus an equally-charged random entry":

* **iFVG is *worse* than its own placebo** (−0.261 against −0.183, p = 0.910).
  A random entry in the same window with the same risk beat the iFVG signal in
  **91% of 1,000 runs**. This is the strongest negative result in the whole
  seven-pass family, and it is consistent with the fit period (p = 0.223,
  also worse than the null).
* **BoS beats its placebo** (−0.019 against −0.105, p = 0.070) — and that is
  the one number in this pass that could tempt someone. Three reasons it does
  not survive:
  1. **It is still negative in absolute terms.** "Loses less than a random
     entry with an equally bad template" is not a strategy. The kill rule
     (mean < +0.05R) triggers regardless of p.
  2. **The fit period says the opposite.** Over the 559 fit-period trades, BoS
     was *worse* than its placebo, p = **0.870**. A signal that beats the null
     at p = 0.07 in the last 12 months and loses to it at p = 0.87 in the
     preceding 36 is not a signal — it is a 209-trade sample doing what
     209-trade samples do.
  3. **p = 0.070 is nowhere near the pre-registered bar.** The Bonferroni
     threshold across the four primary numbers is 0.0125. Even the uncorrected
     0.05 is not cleared.
* **Null B agrees** with Null A on all four rows and is slightly weaker
  everywhere (0.124 against 0.070 for the BoS block arm), which is the expected
  direction: shifting the whole stream preserves more of its structure than
  redrawing entry times does.

### 4.3 The long horizon does not rescue it (chart `viz/06_horizons.png`)

Letting the trade run a full 24 hours from the take-out instead of stopping at
the block boundary changes the holdout expectancy by **−0.010R (iFVG)** and
**−0.018R (BoS)** — both slightly *worse*, both far inside the noise.

The descriptive geometry says why. Over 24h the in-window iFVG median MFE rises
from 4.01 to 7.09 ATR — and the median MAE rises from 4.36 to 7.06 ATR
alongside it. Both excursions grow together, the ratio stays at ~1.0, and the
median end-of-window value barely moves (+0.24 → +0.54 ATR for iFVG; −0.22 →
−0.52 for BoS). More time buys more range in **both** directions, which is what
you would expect from tape with no directional edge in it. The long-horizon
column was worth adding — it answers the question — and the answer is no.

---

## 5. The one thing that did move, treated seriously

The non-circular forward lift (chart `viz/05_forward_lift.png`,
`results/l1_forward_lift.csv`) — post-confirmation MFE against the
unconditional forward move for the same `block × bars-remaining × direction`
cell, where **1.00 = no better than a random comparable stretch of tape**:

| arm | all hours | NY window only |
|---|---|---|
| iFVG-v4 | 0.84 | **0.95** |
| BoS pinned anchor | 0.89 | **1.00** |

The user's intuition that the window matters is **partly vindicated by the
data**, and this report is not going to bury that. Inside 13:40–15:20 UTC both
mechanics behave measurably better than they do over the rest of the day, and
the BoS arm lands exactly at par.

What it does not do is become an edge:

* **1.00 is par, not profit.** It means the post-confirmation move is the same
  size as a random stretch of the same tape at the same time of day with the
  same amount of block left. There is nothing to harvest in "the same as
  average".
* **This is the metric with no stop convention in it** — which is what makes it
  worth reporting, and also what makes it non-tradeable. MFE is a best-case
  exit nobody hits systematically. The moment a real exit rule and a real fee
  are attached (§4), par turns into negative.
* **The improvement is consistent with a volatility effect rather than a
  directional one.** In-window MFE *and* MAE both roughly double against the
  all-hours numbers (iFVG 2.37/2.44 → 4.01/4.36 ATR). The window is a busier
  stretch of tape in both directions. A lift that rises because the numerator
  and denominator both grow is not the same thing as a lift that rises because
  the move went further the right way.

The window-length stratification (`results/TABLES.md` W, chart
`viz/03_hour_and_window.png`) reinforces this: the raw
confirmation-rate-by-hour curve looks like a strong clock effect and largely
collapses once take-outs are stratified by bars remaining. The standing null
from v4 and the BoS pass — *no best hour, only a best remaining window* — holds
here too. In-window take-outs are, by construction, take-outs with 72+ bars of
block ahead of them (1,053 of 1,056 iFVG, 763 of 768 BoS).

---

## 6. Robustness appendix — SOL and BNB

**Not the pre-registered population** (DESIGN §2.3 pins the test to BTC+ETH).
No verdict is drawn from these rows; they exist so a reader can see whether the
sign shows up elsewhere. Block-scoped horizon, mean net R:

| arm | scope | n fit | mean fit | n holdout | mean holdout | n all | mean all |
|---|---|---|---|---|---|---|---|
| iFVG | **BTC+ETH (primary)** | 759 | −0.174 | 297 | **−0.261** | 1,056 | −0.198 |
| iFVG | all 4 assets | 1,526 | −0.205 | 608 | −0.191 | 2,134 | −0.201 |
| iFVG | BTCUSDT | 404 | −0.182 | 170 | −0.283 | 574 | −0.212 |
| iFVG | ETHUSDT | 355 | −0.164 | 127 | −0.231 | 482 | −0.181 |
| iFVG | SOLUSDT | 416 | −0.149 | 144 | −0.068 | 560 | −0.128 |
| iFVG | BNBUSDT | 351 | −0.340 | 167 | −0.173 | 518 | −0.286 |
| BoS | **BTC+ETH (primary)** | 559 | −0.139 | 209 | **−0.019** | 768 | −0.107 |
| BoS | all 4 assets | 1,018 | −0.124 | 405 | −0.018 | 1,423 | −0.093 |
| BoS | BTCUSDT | 313 | −0.124 | 114 | −0.049 | 427 | −0.104 |
| BoS | ETHUSDT | 246 | −0.159 | 95 | +0.016 | 341 | −0.110 |
| BoS | SOLUSDT | 236 | −0.154 | 108 | +0.164 | 344 | −0.054 |
| BoS | BNBUSDT | 223 | −0.053 | 88 | −0.237 | 311 | −0.105 |

**8 of 12 full-sample cells are negative and all 12 are below +0.05R.** The
per-asset holdout cells scatter from −0.28 to +0.16 on 88–170 trades each,
which is exactly the dispersion 100-trade samples produce around a zero mean —
SOL's +0.164 holdout BoS cell sits beside SOL's −0.154 fit cell, and BNB swings
the same distance in the other direction. Adding SOL and BNB moves the pooled
4-asset number to −0.201 (iFVG) and −0.093 (BoS): the same answer, with more of
it.

The descriptive per-asset geometry (`results/a1_per_asset.csv`) is likewise
flat across assets — in-window iFVG R-proxy 1.22–1.39, BoS 0.73–0.81, with no
asset standing out.

---

## 7. Every comparison this pass made, so they can be counted

A pre-registered result is only as honest as its list of tests. Everything run:

| # | cut | why | outcome |
|---|---|---|---|
| 1–4 | the four **primary** numbers (2 arms × 2 horizons) | pre-registered §3 | all fail the kill rule |
| 5 | UTC−5 window instead of UTC−4 | declared sensitivity, DESIGN §2.2 | iFVG −0.279R, BoS −0.025R; both negative |
| 6 | all hours, no window filter | the baseline the window is supposed to beat | iFVG −0.216R, BoS −0.100R; the window changes little |
| 7 | 4-asset pool and each asset alone | robustness §6, not the test population | same sign, more dispersion |
| 8 | Null B (day shift) beside Null A | cross-check on the null construction | agrees, slightly weaker |
| 9 | day-block bootstrap interval | interval, not a p-value | consistent with the p-values |
| 10 | same-bar tie booked as a **win** | post-hoc, answering an objection | **irrelevant** — ties occur on 0.000% of trades, because the stop and target sit 2R apart and a 5m bar never spans that |
| 11 | zero-cost (gross) expectancy | post-hoc, answering an objection | −0.006R / +0.009R — the signal is flat, the fee is the negative |

No cut, filter, threshold or window was added after the holdout was computed.
Cuts 10 and 11 are explicitly post-hoc and change no verdict; they exist
because they are the first two objections any reader raises on seeing a
negative expectancy, and both deserve a measured answer rather than a rebuttal.

---

## 8. What I would flag, honestly

1. **The strongest result here is not the kill — it is that iFVG loses to its
   own matched-time placebo, 91% of runs.** That is a stronger statement than
   any of the six descriptive passes made, because it is a comparison against a
   control that holds the clock, the risk and the direction mix fixed. Whatever
   the iFVG confirmation is doing inside the NY window, it is not selecting
   better entries than a coin flip at a random minute in the same window.
2. **The 0.10% cost assumption deserves a sentence of scepticism, in the
   direction that hurts the argument.** It is a plausible taker fee and it
   models **no slippage at all**, so the real number is worse, not better. But
   it is also the single largest term in the result: at gross ≈ 0, the whole
   negative *is* the fee. A reader who believes they trade at maker fees or
   with a stop 3× wider would get a different net number from the same signal.
   That reader should note that the forward lift (§5) and the gross expectancy
   contain **no cost assumption whatsoever**, and both say flat. The cost
   changes how negative the answer is; it does not create the answer.
3. **The BoS holdout p = 0.070 is the number most likely to be quoted out of
   context.** It should not be. The fit-period p on the same arm is 0.870, the
   absolute expectancy is still negative, and 0.070 does not clear a 0.0125
   bar. It is what a 209-trade sample looks like.
4. **The window genuinely is a better stretch of tape than the rest of the
   day** (§5), and the honest framing is that the user's read on *where* was
   partly right while the read on *whether there is an edge there* was not. If
   anything reopens this family, it will be a different mechanic inside this
   window, not this mechanic.
5. **This pass tested one window and one trade template.** A negative result on
   09:40–11:20 New York with a +1R target is not a negative result on every
   window and every exit rule. It is, however, a negative result on the
   specific proposal that motivated the pass, obtained under a protocol that
   could have said yes.
6. **Nothing about the shelving verdict changed.** The forward-lift numbers
   this pass reproduces (0.84 / 0.89 all hours) match Запись 17's 0.83 / 0.87
   to within rounding on a slightly different population cut, and the
   event-stream identity checks prove nothing upstream moved.

---

## 9. Audit surface

* **`MECHANIC-PROOF.md`** — the visual audit the user asked for: 8 hand-picked
  worked examples (`viz/proof0*.png`) proving the swept level and the BoS
  anchor never move and the iFVG gap is not chosen with hindsight, plus what
  the 36 machine checks assert across all 23,423 events, plus an explicit
  section on the limits of that proof.
* **`results/gallery_ny/GALLERY.md` + 24 panels** — stratified, seeded,
  un-curated. Every panel is an event whose confirmation landed inside the
  pinned NY window, covering both mechanics and all three trade outcomes
  (target / stop / marked-to-market), plus "both fired" and "BoS only".
  Winners and losers get the same renderer.
* **`results/HYPOTHESIS.md`** — the pre-registered test in full: trades, both
  nulls, the bootstrap, the verdict ladder applied mechanically, the robustness
  appendix, the sensitivity list and the post-hoc diagnostics.
* **`results/TABLES.md`** — the house-style descriptive layer: eligibility
  funnel, geometry on both horizons, forward lift, window-length strata,
  per-asset appendix, exclusions.
* **`viz/01..06_*.png`** — the aggregate views. Chart 02 is the one to read
  first.
* **`checks.py` — 36/36 PASS**, including bit-identical reproduction of the v4
  and BoS event streams and both confirmation streams, prefix-causal
  re-derivation of the BoS anchor and the iFVG gap, and a brute-force
  re-derivation of the trade template and the cost arithmetic.

---

## 10. Reproduce

```
cd research/session-liquidity-v5-ny
python engine.py       # ~35s, writes results/events_*.csv, uncond_*.csv.gz
python tables.py       # writes results/TABLES.md + the descriptive CSVs
python hypothesis.py   # ~15s, writes results/HYPOTHESIS.md, p*.csv, null_draws.npz
python charts.py       # writes viz/01..06
python examples.py     # writes viz/proof01..08 (MECHANIC-PROOF.md's panels)
python gallery.py      # writes results/gallery_ny/* + GALLERY.md
python checks.py       # 36/36 PASS
```

`hypothesis.py` must run before `charts.py`: chart 02 **loads** the saved null
draws rather than redrawing them, so the p-value printed on the chart is the
same number this report quotes.
