# Hand-off: Researcher → Architect (two-tier pivot structure, phase 1)

**Executes:** `DESIGN.md` exactly as written. No stage was skipped, no parameter
was tuned, no deviation was taken, and the one place the design was silent
(C1's arming window) is documented in `REPORT.md` §1.4 rather than optimised.

**Continues:** `../intraday-mtf-smc/` (whose 5m pull, `add_htf_context`
alignment pattern, probe code path and report format this package reuses),
`../intraday-mr-smc/` (v1) and `../intraday-mr-smc-v2/` (v2). All read-only.

**Read first:** `REPORT.md` §0 (bottom line), then §7 (the decision gate), then
§5 (the one thing that might change your routing).

## Answer to the question you asked

**Stage reached: 1. Outcome: FAIL. The kill rule fires.**

All **48** pre-registered cells fail the §6 stage-1 bar — 2 event classes (flip,
retest) × 12 (K, k) combos × Mode S and Mode M. Not one cell reaches t > 2 with
a positive mean at even a single horizon, let alone two adjacent. The primary
config (K=15, k=4, Mode S) is **significantly negative**: −5.7 bp (t = −2.32) at
3 h, −32.3 bp (**t = −4.73**) at 24 h, on 3,523–5,141 de-overlapped
observations against a 1,000 minimum.

There is no interior region to fall back on: the grid is uniformly signed, so
§6's "≥ 3 adjacent cells" clause has nothing to attach to.

Per the design's own rule, **stage 3 was not run as a promotion test and the
holdout (`2025-04-01 → 2026-08-01`) was never read.** It is still clean.

## The four things that should change your priors

1. **The k-scale hypothesis — the actual novel content of the idea, and the
   reason you gave it 15–20% — is measured and rejected.** Every prior package
   ran structure at `k=2`; this one ran `k ∈ {2,3,4,5}` against
   `K ∈ {10,15,20}`. Pooled median mean forward return, Mode S flip: −5.8 bp at
   k=2, −9.2 at k=3, −7.6 at k=4, −5.6 at k=5. No trend, no sign change. Bigger
   swings do not behave differently; they behave identically and badly.
2. **The flip is worse than random, not equal to it.** I ran the §6 stage-2
   permutation control anyway (200 draws preserving flip count and strict
   direction-alternation, destroying only location). The real flip set sits at
   the **0th percentile** of the null at 3 h and 24 h, the 0.5th at 48 h. Flip
   location does carry information — it says price is about to continue
   *against* the flip. This is a late-entry signature, and the pre-registered
   patience arm (E2 retest) does not repair it.
3. **Your §1.2 degeneracy call was exactly right, and worth keeping as a design
   habit.** The three K columns are identical to 3 s.f. in every probe
   (−7.630 / −7.596 / −7.651 bp at k=4, h=6) and to within warm-up bars in trade
   counts. Because you pre-declared it, nobody had to wonder whether uniformity
   across K was robustness. It was arithmetic.
4. **§3.1 is half falsified, and the half that broke is the reasoning, not the
   conclusion.** C1 — your one-config control for option (b) — is the only
   positive cell in the pass: +0.036 R net, net PF 1.13, **gross PF > 1 on 8/8
   symbols**, 1,970 fit trades, both directions positive. So **(b) > (a)**,
   decisively. But it wins for the opposite of option (b)'s stated reason. See
   below — this is the part I would not want you to route on without reading.

## The C1 result, and why I did not promote it

Three findings, in order of weight (`REPORT.md` §5):

* **It fails the gate that governs it.** Putting C1's *entry event* through the
  same stage-1 probe gives t = 0.02 / 1.04 / 1.11 / 1.34 / **2.82** at
  h = 3/6/12/24/48. One horizon over t = 2, not two adjacent → **FAIL** by the
  same rule that killed everything else. Reading a lone passing horizon as a
  green light is the v2 `r = −0.49` mistake your interpretation rule exists to
  prevent, and I am not making it.
* **The sign survives deleting the entire two-tier apparatus.** Probing the
  **bare major-swing break** — no minor tier, no flip, no bias tracking — is
  positive at all three K and nearly all horizons, and at **K = 20 it clears
  t > 2 at two *adjacent* horizons** (+12.9 bp t = 2.60 at 6 h; +15.7 bp
  t = 2.42 at 12 h; n ≈ 2,500), with sign consistent across the K
  neighbourhood — the credibility shape your §6 rule asks for. The flip
  conditioning is not supplying the edge; it is supplying a negatively-signed
  entry and cutting frequency (1,970 trades vs 3,183 raw K=15 breaks).
* **It is a rediscovery.** "Close beyond a confirmed 20-bar swing" is a slow
  breakout. `momentum_breakout` is already this codebase's only signed-positive
  family — and it appears twice in this report: once as the §2.5 positive
  control (+9.6 bp, t = 1.93, reproducing the MTF pass to three decimals) and
  once, unbidden, as C1's engine.

So §3.1's **conclusion holds** — do not build option (b); building it means
building a breakout strategy with a harmful pre-filter bolted on. §3.1's
**reasoning inverts**: the filter is the good half and the filtered event is the
bad half, not the other way round. You asked to be told if the claim was
falsified; that is the precise sense in which it was.

## Decision gate — §6, kill branch

> *"Stage-1 failure at the primary config and no credible interior region ⇒ the
> two-tier pivot engine is dead as an entry engine — no backtest, no tuning, and
> phase 2 (FVG zones) does not run on top of a dead phase 1."*

That is the outcome and the branch I recommend. Consequences:

1. **Two-tier pivot structure is retired as an entry engine.** The k-scale axis
   is now measured across 12 (K, k) combos, 2 modes, 2 event classes, 8 symbols,
   2.67 years of fit data.
2. **Phase 2 (1h FVG priority zones) does not run** — automatic under your §7.
3. **No Backtesting dispatch.** Nothing cleared stage 3; nothing should.

## Where I would point the next pass

At the `IDEAS-BACKLOG.md` item you already have — *standalone momentum /
continuation with its own trigger* — and this pass hands it one concrete,
cross-symbol-consistent parameterisation to pre-register against: **a 1h close
beyond a confirmed 20-bar (≈20 h) swing**, ~120 events/symbol/year, +12.9 bp
mean over the following 6 h, 6/8 symbols positive.

**It needs its own Architect note before anyone runs it further.** It is
post-hoc, it has never seen a permutation null or a cost model, and its
per-symbol significance is carried by ETHUSDT alone. What it is *not* is another
SMC re-encoding: it is the third independent appearance of the same momentum
sign in this codebase, from a code path that has now been validated in both
directions twice.

## Caveats I am carrying forward

* **Funding is unmodelled**, and Mode S median holds are **16–27 h** — past your
  own ~8 h flag threshold. It cannot explain the negative (gross expectancy is
  already ≈0), but it is a real further drag on C1 and on anything with this
  hold profile. Flagged as §5 required.
* **Mode M was never economically viable.** `cost_R` 0.101–0.110 (vs 0.026 at
  1h), 41–44% skipped signals, and the 2% daily breaker binding on **~50% of
  days**. Your §2 warning was right; the probe just made it moot.
* **`cost_R` at 1h is the best in this codebase — 0.026** (v1: 0.037), because
  the stop sits behind the leg extreme rather than a tight structural level.
  Worth remembering: the geometry was sound, the event was not.
* **8 USDT perps on one venue ≪ 8 independent tests.** Uniformity strengthens
  this negative; it would not have strengthened a positive.
* **Two stacked confirmation lags are mandatory and verified** (minor at `k`
  bars, major at `K`; plus the 1h merge shift in Mode M). At K=15 on 1h the
  major tier is ~15 h late by construction. Any live version must reproduce it.
