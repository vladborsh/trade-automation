# Hand-off: Researcher → Architect (MTF-SMC)

**Executes:** `research/intraday-mr-smc/MTF-SMC-DESIGN.md` exactly as written.
No stage was skipped, no parameter was tuned, no deviation was taken. The two
places the design left genuinely open are recorded in `REPORT.md` §1.4.

**Continues:** `research/intraday-mr-smc/` (v1) and `research/intraday-mr-smc-v2/`
(v2). Both are read-only here — v1's `indicators.py` / `strategies.py` /
`backtest.py` / `fetch_data.py` and v2's `strategies_v2.py` are imported
unchanged; nothing in either package is modified.

**Read first:** `REPORT.md` §0 (bottom line), then §6 (the decision gate).
`README.md` covers how to rerun everything; §7 of the report is the file map.

## Answer to the question you asked

**Both variants are dead at stage 1, and so is Variant B's secondary encoding.**
21 of 21 horizon tests fail the §5.3 bar; no horizon reaches t > 2 with a
positive mean. Variant A and B-choch are *significantly negative* at 15–60
minutes (t = −3.0, −4.2). Sample sizes are 14× to 250× the pre-committed
minimums, so this is a measured zero, not an underpowered one.

Per the design's own rule, **stages 2 and 3 were not run and the holdout window
(`2025-04-01 → 2026-08-01`) was never read by this package.** It remains as
clean as v2 left it.

## The three things that should change your priors

1. **Sample starvation — the failure mode you flagged as Variant B's main
   exposure — did not happen.** Realised 765 trades/symbol/year against your
   40–150 estimate; 19,336 pooled fit trades against a 300 minimum. The
   single-slot zone inventory was never the binding constraint, which makes
   §5.7's third branch (multi-zone follow-up) **factually unavailable** rather
   than a judgment call I am making. I recommend against building it: raising
   the frequency of an event whose gross expectancy is +0.003 R produces more
   of nothing.
2. **Your §0 cost-in-R warning was right and understated.** Measured off
   realised stops: `cost_R` = 0.231 (A) / 0.157 (B-sweep) / 0.100 (B-choch)
   versus v1's 1h figure of 0.037 — **2.7× to 6.2× worse**. Your §5.5 gross bar
   (3 × cost_R) therefore lands at +0.27 to +0.61 R; measured gross expectancy
   is −0.057 / +0.003 / −0.023 R. It also shows up mechanically: the median
   losing Variant A trade is **−1.19 R**, and the 0.19 R overshoot is exactly
   the fee in R.
3. **The instrument was validated before the kill was accepted.** The same probe
   code path reproduces v1's zero for single-TF `smc` at 1h and recovers v2's
   positive sign for `momentum_breakout` (+9.6 bp, t = 1.93 at 12h) — on the 1h
   frame this package derives from its own 5m data, so the resampler is
   cross-checked too. `REPORT.md` §2.4.

## Decision gate — §5.7, branch 1

> *"Both variants fail stage 1 or 2 → the MTF re-encoding question is answered;
> SMC-as-entry is retired in full."*

That is the outcome, and it is the branch I recommend. Branch 2 (promote to
Backtesting) requires a §5.5 pass — there is none. Branch 3 (multi-zone
follow-up) requires a sample-size-only failure — see point 1 above.

This spends the `ARCHITECT-NOTE.md` §2.2 escape hatch on the two encodings you
judged most likely to work, including the sweep-as-trigger inversion §2.3 ranked
as the most promising structural redesign. SMC-as-entry has now been measured at
15m, 1h and 5m; single-timeframe and multi-timeframe; as trigger and as context;
on 8 symbols over 4 years.

**For the Critique & Refinement second opinion** (if still undispatched): the
three encodings now measured span the two axes that were in dispute — what the
SMC layer supplies (direction in A, location in B) and what the trade event is
(retest, sweep-failure, structure-shift). The only untested axis is a
*discretionary* reading, which is not mechanisable and so not researchable in
this pipeline. `REPORT.md` §6.

## Caveats I am carrying forward (design §5.6)

* **Funding is unmodelled**, but median holds are 0.75–3.25 h — inside your ~8 h
  threshold, so it cannot explain the negative and would not have rescued it.
* **8 USDT perps on one venue ≪ 8 independent tests.** The cross-symbol
  uniformity strengthens a negative; it would not have strengthened a positive.
* **Three stacked lags** (5m fractal confirm, 1h fractal confirm, 1h merge
  shift) are mandatory and were verified causal four ways. Any live version in
  this family must reproduce all three.
* **One mildly positive post-hoc cell** — sweep-reclaim inside a 1h FVG,
  +1.9/+2.6 bp — is recorded in `REPORT.md` §4.3 because §5.5 asked for the zone
  split. I do not believe it and I am not routing on it: median t = +0.64, one
  of twelve cells, and a quarter of a round-trip fee.

## Where I would point the next pass

Nowhere in this family. The only signed-positive thing in the harness remains
`momentum_breakout`, independently reproduced here as a control — and even that
does not clear this probe's t > 2 bar. The open, genuinely untested idea is the
one already in `IDEAS-BACKLOG.md`: a standalone momentum/continuation design
with its own trigger, rather than an inversion of the MR trigger.
