# Design: two-tier pivot structure (major/minor CHoCH)

**Role:** Architect · **Status:** design only — no code, no data, no results exist yet.
**Hand-off to:** Researcher (`agents/roles/researcher.md`).
**Source of the idea:** `IDEAS-BACKLOG.md` entry "Pivot-based structure
(major/minor CHoCH)" and `RESEARCH-LOG.md` Запись 6 — a user idea, grilled and
logged by a parallel Architect session, with two design decisions explicitly
delegated to this note (§3).
**Prerequisite reading for the Researcher:** `research/intraday-mr-smc/REPORT.md`
(v1), `research/intraday-mr-smc-v2/REPORT.md` (v2, esp. §1.3–1.4 for the
overfitting/permutation discipline), `research/intraday-mtf-smc/REPORT.md`
(the pass that retired SMC-as-entry, esp. §4 diagnostics), and
`research/intraday-mtf-smc/mtf.py` (the `add_htf_context` alignment helper this
design reuses).

---

## 0. What this is, and where it stands relative to the retired family

The user's proposal replaces `indicators.structure()` — the single-`k=2`
fractal → BOS/CHoCH state machine behind every retired SMC candidate — with a
**two-tier pivot engine** on the same `fractals(df, k)` primitive:

* a **major pivot tier** (`K ∈ {10, 15, 20}`) defines the large structural
  swings and initializes the tracked bias;
* a **minor pivot tier** (`k ∈ {2, 3, 4, 5}`) supplies the flip event: a CHoCH
  against the tracked bias on the *minor* structure **is** the moment the
  tracked bias flips (confirmed with the user explicitly: not a candidate
  awaiting major-level confirmation).

Honesty first, because this family has a body count. Three facts frame the
prior probability:

1. **SMC-as-entry is retired** (`intraday-mtf-smc/REPORT.md` §6): OB/FVG
   retests, sweep-reclaims, and 5m CHoCH-in-zone are all measured zeros or
   worse, at 5m/15m/1h, on 310k+ probe observations. In particular **B-choch —
   a CHoCH entry at k=2 — was significantly negative** (t = −3.9 short-horizon).
   A pivot-CHoCH flip entry is a cousin of that dead rule-set, and this note
   does not pretend otherwise.
2. What is **genuinely untested** is the *k-scale dimension*: every structure
   computation in all three packages used `k=2` fractals — the smallest
   possible swings. Nobody has measured whether structure defined on 10–20-bar
   pivots (multi-day swings at 1h) behaves differently. That is the actual
   novel content of this idea, and the parameter grid is aimed straight at it.
3. The strategy shape is **continuation/trend-following** — enter in the new
   direction at the earliest structural evidence of reversal, hold with the
   new trend. That is the one family with a measured positive sign in this
   codebase (`momentum_breakout`: gross PF > 1 on 8/8 perps, reproduced
   independently by the MTF pass's own control). Structurally this design is
   "momentum expressed through swing geometry instead of a z-score", not
   another reversion-at-a-zone scheme.

My honest estimate: ~15–20% that the flip event clears the stage-1 probe
somewhere in the grid's *interior* (not an isolated cell), lower for the full
economic bar. That is roughly the same prior I gave momentum-inversion, which
paid off, and better than I would give any further zone/retest scheme, which
would be ~0. It is worth exactly one disciplined pass.

**Phase 2 (1h FVG priority zones) is deferred**, per the user, until phase-1
results exist. §7 records the design constraint it must satisfy and the one
relevant data point already in hand.

---

## 1. The new primitive: `pivot_structure(df, K, k)`

New module-level function (natural home: a new `pivot.py` in the research
package; do **not** modify `indicators.py` — the retired engine stays frozen
for reproducibility). Everything causal, same conventions as `structure()`:
signal on bar close, act next bar open.

### 1.1 State and events

Inputs: OHLC frame, major half-width `K`, minor half-width `k` (`k < K`
required; assert it).

* **Major pivots:** `fractals(df, K)` — confirmed `K` bars late by
  construction. Maintain the last confirmed major swing high `MH` and low `ML`
  (each cleared when a close breaks beyond it, mirroring `structure()`).
* **Minor pivots:** `fractals(df, k)` — confirmed `k` bars late. Maintain the
  last confirmed minor swing high `mh` and low `ml` the same way.
* **Tracked bias `B` — initialization:** `B = 0` until the first close beyond
  a confirmed major swing (`close > MH` → `B = +1`; `close < ML` → `B = −1`).
  This is the only role initialization plays; no trades while `B = 0`.
* **Flip event (the core of the idea):** while `B = +1`, the first close below
  the current confirmed minor swing low `ml` flips `B` to −1 **on that bar**
  and emits `flip = −1`. Mirror for `B = −1` → `flip = +1`. This is the minor
  CHoCH *as* the major flip — no waiting for a major-level break. After a
  flip, the broken minor swing is cleared and tracking continues.
* **Leg extreme `X`:** the running extreme of the current leg — for `B = +1`,
  the highest high since the last flip (or since initialization); for
  `B = −1`, the lowest low. At the moment of a flip to −1, `X` is the high the
  market just failed to sustain; the stop goes behind it (§4).

Outputs per bar: `B`, `flip`, `MH`, `ML`, `ml`, `mh`, `X`, plus `atr` as
usual. Prefix-stability and lag checks per `intraday-mtf-smc/checks.py` are
**required** (truncation invariance; a flip at bar i must use only minor
swings confirmed at or before i).

### 1.2 Why the major tier must keep a persistent role (design catch)

The grilling left "role of major K after initialization" open (§3.1). One
consequence nobody stated: **under pure option (a) — major sets only the
starting bias — the major-K sweep {10, 15, 20} is degenerate.** After the
first flip, `K` would influence nothing, and all three grid columns would
converge to identical trade lists modulo a few warm-up bars. A three-value
sweep of a parameter that provably cannot matter is wasted compute and, worse,
an invitation to read noise differences as signal. The resolution is in §3.1:
the major tier keeps two *non-gating* roles (target reference and
initialization), so `K` has teeth in exactly one pre-registered arm, and the
note states up front where the sweep is expected to be degenerate (the
fixed-RR arm) so nobody interprets identical columns as a robustness finding.

---

## 2. Timeframe modes

* **Mode S (single-TF, 1h) — runs first.** Both tiers on 1h bars. 1h is the
  only defensible single TF: v1 established 1h ≫ 15m ≫ 5m on costs, and the
  MTF pass measured `cost_R` 0.089–0.231 for 5m-scale stops vs 0.037 at 1h —
  a single-TF 5m version fails the cost-floor rule (`ARCHITECT-NOTE.md` §5)
  before it is even probed. Note the confirmation lags in time units: `K=15`
  major pivots confirm ~15 h late, `k=4` minors ~4 h late. Both are correct
  and mandatory, not bugs to optimize away.
* **Mode M (multi-TF: major 1h / minor 5m) — probed in the same pass.** Major
  tier computed on the resampled 1h frame; `B`-relevant major state
  (`MH, ML`, initialization bias) merged onto the 5m frame via the existing
  `add_htf_context` pattern (`mtf.py`: resample ×12, `shift(1)` every derived
  column, `merge_asof` backward — one-completed-1h-bar lag, verified causal
  four ways in that package; reuse, do not reimplement). Minor tier
  (`k ∈ {2,3,4,5}`) runs on native 5m bars; flips are detected on 5m closes
  against the merged major state. Stops are 5m-scale here, so **the MTF
  pass's cost_R warning applies in full**: report realised `cost_R` and hold
  the gross bar of §6 against it. Mode M's justification is earlier flip
  detection (a 5m close through a minor swing beats waiting for the 1h
  close); its cost is exactly the tighter-stop fee multiplier that killed the
  last package. The probe decides.

---

## 3. The two delegated decisions — decided

### 3.1 Role of major K after initialization → **option (a), with the major
tier retained as target reference; option (b) demoted to a single control arm**

**Decision:** the minor CHoCH fully drives the tracked bias after
initialization — no major-level break is required for a flip or an entry
(option (a), as the grilling recommendation anticipated). The major tier
persists in two non-gating roles:

1. **Target reference:** in the structural-target arm (§4, T2), the profit
   target is the opposing major swing (`MH` for longs, `ML` for shorts) —
   the payoff side of the trade is major-scale while the risk side is
   minor-scale. This is what makes the {10,15,20} sweep meaningful (§1.2),
   and it is the same risk-geometry asymmetry (small structural risk, large
   structural reward) that was the one sound part of the retired Variant B.
2. **Initialization and re-initialization:** sets the starting `B`; if the
   engine is ever flat-biased (warm-up, or after a data gap), the same rule
   re-arms it.

**Why not (b)** (minor CHoCH as early candidate + major-level break required
for entry): it reconstructs the retired close-beyond-swing BOS engine with an
extra early-warning light. Architecturally it is a *filter* on an event
family already measured at zero, and the can-only-subtract argument
(`ARCHITECT-NOTE.md` §2.3) applies unchanged. The user's grilling session
reached the same conclusion. **However**, because (b) is cheap and my
argument is a prediction rather than a measurement, it runs as **one
pre-registered control arm at the grid center only** (K=15, k=4, Mode S): if
(b) outperforms (a) there, my architectural claim is falsified and we revisit;
if (a) ≥ (b), the claim is confirmed at the cost of one config. It does not
get the full grid.

### 3.2 Entry timing / stop / target → **flip-close entry as primary; one
retest arm; two target arms; opposite-flip exit mandatory everywhere**

Decided rule-sets (all details in §4): primary entry is **on the flip bar's
close, no retest** (fill next bar open) — the user's baseline instinct is
right, and not only for comparability: the whole hypothesis is that the minor
CHoCH *is* the information event, so the design should measure that event
undiluted. A **retest arm** runs alongside it because the flip-close entry
pays the worst price of the leg by construction (it buys after an impulsive
break), and one pre-registered alternative measures whether patience is worth
the missed trades. Two target arms (fixed 2R for backward comparability;
opposing-major-swing for the geometry this design actually believes in).
Stops behind the leg extreme, not the broken minor swing — §4 explains.

---

## 4. Rule-sets (pre-registered; nothing else gets run)

Shared by all arms: risk rules unchanged (**1%/trade sized off the stop,
2%-of-UTC-day circuit-breaker** — no conflict, but with flip-driven entries
the breaker will bind on clustered stop-outs; report bind frequency per the
MTF pass's §4.1 format). Fees 5 bp/side taker. Signal on close, fill next bar
open, stop-before-target on ambiguous bars. Engine: reuse `backtest.py:run`
with **one small extension — the opposite-flip exit** (below); everything
else untouched.

**Opposite-flip exit (all arms, mandatory):** an open position is closed at
the next bar's open when a flip against it fires. Without this, the fixed-RR
arm can sit in a position whose own engine says the bias has reversed —
incoherent with the idea being tested. This is the one engine change the
design needs (a few lines where `time_stop` is already checked); verify it
against the no-position case in a smoke test.

**Time stops** (secondary to the flip exit, pre-committed): Mode S — 48 × 1h
bars; Mode M — 288 × 5m bars (24 h). Two-tier swings live on multi-hour to
multi-day scale; the flip exit is the primary abandonment mechanism, the time
stop is a backstop.

### Arm E1-T1 — flip-close entry, fixed 2R (the comparability arm)

* Entry: `flip = ±1` on bar close → enter next open in the flip direction.
* Stop: behind the leg extreme `X` at flip time, buffered `0.25 × atr`
  (long entry after `flip=+1`: stop `= X_low − 0.25×atr`; short mirror).
  Behind the *extreme*, not the broken minor swing: the broken swing is
  inside the leg and frequently within noise range of entry; the extreme is
  the level whose violation refutes the reversal.
* Target: `entry + 2.0 × (entry − stop)` (old `smc_rr` default, kept solely
  so this engine is comparable against the retired one on identical payoff
  geometry).
* **Expected degeneracy:** in this arm the major K affects only
  initialization; the K-sweep columns should be near-identical. That is
  anticipated, not a finding.

### Arm E1-T2 — flip-close entry, structural major target (the thesis arm)

* Entry and stop: as E1-T1.
* Target: the opposing major swing at entry (`MH` for longs, `ML` for
  shorts); fallback 3R if NaN; **capped at 6R** (same outlier-control
  convention as the MTF design). This is the arm where minor-scale risk buys
  major-scale reward and where the K-sweep is meaningful.

### Arm E2-T2 — retest entry, structural major target

* After a flip, wait for price to retrace to within `0.25 × atr` of the
  broken minor swing level (the CHoCH line) within **12 bars** (Mode S) /
  **36 bars** (Mode M). First bar whose range touches that band → enter next
  open. No touch within the window → no trade (report the missed-trade
  rate — this arm's cost is measured in trades it never takes).
* Stop and target: as E1-T2 (stop behind the flip-time leg extreme).

### Control arm C1 — option (b), grid center only (K=15, k=4, Mode S)

* As E1-T2, but entry additionally requires a close beyond the major swing
  level in the flip direction (`close > MH` for longs) after the minor flip
  and before entry. Exists solely to test §3.1's architectural claim.

### Parameter grid

`K ∈ {10, 15, 20} × k ∈ {2, 3, 4, 5}` (12 combos; skip any cell where
`k ≥ K/2` fails — none here), × Mode {S, M} = 24 structure configs.
**Primary config, pre-declared: K=15, k=4, Mode S** (the user's stated
center). Arms E1-T1/E1-T2/E2-T2 are evaluated per §6's stages; C1 at grid
center only. The k-grid is the **only** scanned dimension; buffers, windows,
caps, time stops are frozen as written.

---

## 5. Frequency, drift, and diagnostics expectations

* **Frequency estimate:** minor-CHoCH flips against a tracked bias at 1h,
  k=3–5, should land in the low hundreds of flips/symbol/year (each flip
  alternates direction, so trades/year ≈ flips/year minus breaker/overlap
  skips). Expected comfortably above the 300-pooled minimum; the MTF pass
  showed this family's failure mode is absent edge, not starvation, and the
  estimate is not load-bearing this time.
* **Long/short split is a required diagnostic** (MTF report §4.4 lesson): the
  2022–2025 fit window has positive crypto drift, and a symmetric flip engine
  takes ~50% shorts. The probe's direction-adjustment nets drift out;
  the engine numbers do not. Report both sides separately.
* Also required, same formats as `intraday-mtf-smc/REPORT.md` §4:
  skipped-signal rate, breaker-bind frequency, median hold time (if median
  hold > ~8 h — plausible with 48-bar time stops and major-scale targets —
  **funding must be added before any promotion**; flag it in the report
  either way), realised R-multiple distribution, per-(K,k) trade counts,
  `cost_R` off realised stops (Mode M especially).

---

## 6. Pre-committed research protocol and success bar

Same staged discipline as `MTF-SMC-DESIGN.md` §5, which just proved its worth
by killing three rule-sets for the price of a probe. Committed now, before
any result exists; deviations come back to Architect first.

* **Universe / windows:** 8 perps, existing 5m data (`intraday-mtf-smc`
  package's pull; 1h derived by resample via the same helpers). **fit**
  2022-08-01 → 2025-04-01, **holdout** 2025-04-01 → 2026-08-01, engine state
  reset at the boundary. Everything below runs on fit only; the holdout is
  read once, at the end, for survivors only.
* **Stage 1 — flip-event probe (gate to everything).** `edge_probe`
  methodology on flip events (non-overlapping by construction): direction-
  adjusted forward returns, horizons 3–48 bars plus 96/144 (Mode M) — the
  probe tests E1 (the flip itself) and, separately, the E2 retest-touch
  event. Pass bar for the **primary config** (K=15, k=4, S): pooled mean
  positive with **t > 2 at ≥ 2 adjacent horizons**, ≥ 1,000 flips in fit.
  **Grid interpretation rule, fixed now:** the 24-config grid is sensitivity,
  not a search — a pass is credible only if the passing cell's neighbors in
  (K, k) show the same sign; an isolated passing cell surrounded by zeros is
  reported as noise (the v2 r = −0.49 lesson, applied to a grid instead of an
  hour list). If the primary config fails but an interior *region* (≥ 3
  adjacent cells, same mode) passes, that region may proceed with the fact
  disclosed prominently.
* **Stage 2 — controls (gate to believing stage 1).** (i) **Random-flip
  control:** 200 draws per config under test — same number of flips per
  symbol, alternating direction, placed at random bars (preserving count and
  alternation, destroying location); the real flip set must beat the 90th
  percentile of the null on pooled expectancy. This isolates whether flip
  *location* carries the content. (ii) **Harness validation both ways** (now
  standard): the probe must reproduce the single-TF `smc` zero and the
  `momentum_breakout` positive sign on the same code path.
* **Stage 3 — engine bar (survivors only).** Arms E1-T1 / E1-T2 / E2-T2 (+ C1
  at center) on fit: **≥ 300 trades pooled**; **gross expectancy ≥ 3 × median
  cost_R**; **net PF ≥ 1.1 pooled**; **gross PF > 1.0 on ≥ 5/8 symbols**.
  Holdout, read once: **net PF ≥ 1.0, fit→holdout decay ≤ 0.15**. No WR
  floor (E1-T2 is a low-WR/high-R shape by construction; judge it on
  expectancy, per `ARCHITECT-NOTE.md` §3.2).
* **Kill rule:** stage-1 failure at the primary config *and* no credible
  interior region ⇒ the two-tier pivot engine is dead as an entry engine — no
  backtest, no tuning, and phase 2 (FVG zones) does not run on top of a dead
  phase 1.

## 7. Phase 2 (deferred): 1h FVG priority zones — constraint on the future design

Not designed here, by the user's own sequencing. Two things recorded now so
the eventual design starts honest:

* **Constraint:** an FVG layer that merely *vetoes* flips is another filter
  on the trigger and inherits the can-only-subtract critique. To earn its
  place it must change the event or the geometry — e.g. FVG as target
  selection, or FVG-located flips as a *separately probed* event class — not
  gate the existing one.
* **The one data point in hand:** the MTF pass's zone-type split
  (`intraday-mtf-smc/REPORT.md` §4.3) found 1h-FVG the least-dead zone type
  (+1.9/+2.6 bp, not significant) and OB the most dead. That is a post-hoc
  scrap, not evidence — but it is consistent with the user's instinct to
  reach for FVGs rather than OBs in phase 2.

## 8. Routing

This does **not** qualify for direct dispatch to Implementation (two
architectural decisions were open until this note; the engine itself is
unvalidated). Route: **Researcher**, one pass, executing §6 as written —
deliverable is a research package in `research/pivot-structure/` following
the `intraday-mtf-smc` package's report format, reporting back to Architect
at the §6 kill/promote gate. Backtesting role engages only if something
clears stage 3 on the holdout; phase 2 design returns to Architect only if
phase 1 survives.
