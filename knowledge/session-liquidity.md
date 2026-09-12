# Session liquidity & liquidity sweeps

Canonical definitions for the session-liquidity idea. Sorted into stable
sections (facts a later pass looks up), not a chronological log — history of
*why* a definition changed lives in `RESEARCH-LOG.md`, not here. Keep this
file updated whenever a definition changes during implementation.

## 0. Status

- **Idea SHELVED by Architect ruling, 2026-08-31** (`RESEARCH-LOG.md`
  Запись 17, `IDEAS-BACKLOG.md`) — closed as a strategy candidate after six
  descriptive passes converge on one null: confirmation (iFVG or BoS) is a
  timing/entry-reference mechanic, not a selection filter, and the
  circularity-free forward lift is below 1.0 for every rule measured
  (corrected BoS 0.87, iFVG-v4 0.83, phase-1 BoS 0.74). All definitions below,
  the four audited engines, galleries, and Pine indicators are **kept** as the
  measurement base. Both pre-registered follow-ups (a trader-realistic BoS
  stop; the no-confirmation reversal population) were declined — see the
  backlog entry for why. **Single named reopen trigger (C3):** PDH/PDL swept
  in Asia (MFE/MAE 1.11, median signed ER +0.024, 4/4 assets) — reopens only
  as a pre-registered, hypothesis-tested pass with a real stop rule pinned
  before any R is computed.
- **v5-NY** (`research/session-liquidity-v5-ny/`, RESEARCH-LOG Запись 18,
  2026-09-01) — the **shelving confirmed under test**. The first
  pre-registered, hypothesis-tested pass in the family (the standard §0's C3
  trigger demands): pinned stop and trade template, 0.10% costs, 75/25
  chronological split, matched-time permutation null, numeric kill rule, all
  committed before any R existed. It tested a live 09:40–11:20 New York window
  (§6.3.2) and a 24h horizon (§6.3.1) on BTC/ETH. **All four pre-registered
  numbers fail the kill rule**: holdout mean net R −0.261 / −0.271 (iFVG,
  block / 24h) and −0.019 / −0.037 (BoS), against a +0.05R threshold. The
  strongest negative in the family: a matched-time placebo beat the iFVG
  signal in **91% of 1,000 runs**. **Gross expectancy is ≈ 0** (−0.006R /
  +0.009R) — the fee is the entire negative, which is a cleaner statement of
  the null than "lift below 1.0". The one thing that moved: forward lift rises
  0.84 → 0.95 and 0.89 → 1.00 inside the window — real, and exactly **par**.
  The pass reproduces the v4 and BoS event streams **bit-for-bit** and ships
  `MECHANIC-PROOF.md` (8 captioned real-chart examples + 36 machine checks
  including prefix-causal re-derivation of both mechanics), which stands as an
  independent re-audit of §5.1 and §5.2. **C3 is untouched** — a time window on
  the session-level stream is not PDH/PDL-in-Asia; its `hypothesis.py` is
  reusable machinery if C3 is ever authorised. New definitions added in §6.3;
  no pinned definition changed.
- **Not this family — `cmc-bot` smart-money ICT** (`knowledge/smart-money-ict.md`,
  `research/cmc-bot-smart-money/`, Запись 19, 2026-09-12). It shares the word
  "iFVG" and an almost identical New York window (09:40–11:10 wall clock vs
  v5-NY's 09:40–11:20 fixed UTC−4) but has **no level-sweep detection step at
  all**, and its iFVG inverts through the gap's **proximal** edge, not §5.1's
  far edge — a different event. Its level machinery (PDH/PDL, London
  high/low) is computed but never read by its signal. **The C3 reopen trigger
  is untouched in either direction:** nothing that pass finds can burn C3, and
  C3 does not bear on it.
- **Phase 1** (`research/session-liquidity/`, fixed 2h horizon, session
  overlap, strict iFVG) — **rejected after user review**, kept on disk for
  reference only. Do not build on it. `RESEARCH-LOG.md` Запись 11.
- **v2** (`research/session-liquidity-v2/`) — reissued sessions/horizon/units
  fixed the phase-1 problems above and are still in force (§1, §6). Its iFVG
  confirmation *algorithm* was ill-defined (retroactive best-pick across the
  whole window — see §5.1), **but the v4 pass proved the defect was
  output-equivalent**: v2 and v4 confirm the identical event set on identical
  bars over all 23,423 take-outs (gap-stacking geometry makes the
  latest-formed gap always the first to invert — near-proof in the v4
  REPORT §2). **v2's confirmation-rate, delay, and from-confirmation
  geometry numbers are therefore numerically correct**, alongside its
  take-out frequency and window-length findings. `RESEARCH-LOG.md`
  Записи 10–12.
- **v3** (`research/session-liquidity-v3/`) — **superseded in full.** Its
  invalidation clause ("give up if price closes beyond the take-out bar's
  extreme", and the resulting A/B/C semantics question) was a **fabricated
  requirement, never part of the idea** — invented during grilling, confirmed
  wrong against the user's worked diagram (2026-08-31). The v4 pass showed
  v3's entire 64%→21% confirmation collapse came from that fabricated rule,
  not from the sequencing fix; v3's numbers measure a rule that does not
  exist in the idea. Kept on disk as the audit trail only.
- **v4 iFVG mechanic** (§5.1) — **authoritative**: fixed boundary,
  latest-formed qualifying gap as the single active candidate, no
  invalidation. Numbers under v4: `research/session-liquidity-v4/`
  (RESEARCH-LOG Запись 13). Key measured facts for any design pass: iFVG
  confirmation is a **timing/entry-reference mechanic, not a selection
  filter** (it keeps 64% of take-outs; confirmed lift 0.97–1.23× vs
  1.23–1.58× for bare take-outs); from-confirmation geometry is a coin flip
  in aggregate; window length dominates everything (37.7→72.5% confirmation
  across remaining-window buckets, and "hour of day" effects are window
  length in disguise); the 30.3% of take-outs with no qualifying gap carry
  the largest reversals in the sample.
- **BoS mechanic** (§5.2) — **authoritative** as of the BoS pass
  (`research/session-liquidity-bos/`, RESEARCH-LOG Запись 15): anchor pinned at
  the take-out bar, no re-anchoring, break = first close through it inside the
  block. Key measured facts for any design pass: the corrected mechanic
  confirms **33.8%** of primary take-outs (phase 1's defective one confirmed
  82.4% — a near-unconditional, different event, and its numbers are retired);
  the anchor sits a median **4.93 ATR** from the take-out wick and on the near
  side of the swept level in ~100% of events, so a BoS is a close back deep
  inside the swept range — median stop proxy **5.77 ATR** against iFVG's 2.67,
  median R proxy **0.41** against 0.84; BoS and iFVG confirm the same take-out
  only **15.6%** of the time and BoS is later by a median of 11 bars; and **BoS
  does not select either** — the non-circular forward lift is 0.87 (iFVG 0.83),
  both below 1.0, so §5.1's "timing mechanic, not a selection filter" now
  covers both methods. The phase-1 defect analysis is
  `research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md`; its
  *directional* prediction (that re-anchoring inflated delay and stop) was
  measured and is **wrong** — re-anchoring made the test easier and tighter.
- **PDH/PDL drill-down** (§3.2) — designed, dispatch was halted mid-run when
  the iFVG bug surfaced; partial non-iFVG output (PDH/PDL stream, sub-window
  stratification code) is salvageable once §5.1 lands.

## 1. Sessions (non-overlapping)

The trading day is partitioned into four contiguous, non-overlapping UTC
blocks (the standard forex London/NY overlap is deliberately removed — user
call, it was confusing):

| block | UTC window | produces session levels? |
|---|---|---|
| **Asia** | 00:00–08:00 | yes |
| **London** | 08:00–13:00 (ends when NY begins) | yes |
| **New York** | 13:00–21:00 | yes |
| **Late** | 21:00–24:00 | **no** — residual block; sweeps happen and are measured in it, but it defines no levels |

Wide full-session windows, not narrow killzones. London is 5h (shortened at
the NY boundary) while Asia/NY are 8h — a deliberate asymmetry, kept over
shortening NY because the phase-1 lift ranking put NY at the top and London
at the bottom of the three. Fixed UTC, no DST handling (24/7 crypto tape).

Two session labels, never conflated:
- **`level_session`** — whose liquidity was taken (Asia / London / NY).
- **`sweep_block`** — the clock block the take-out happens in (Asia / London /
  NY / Late).

## 2. Session liquidity (definition)

Within a level-producing session's window, the high and low price reached =
that session's liquidity. Visualized as a rectangle (high / low / window
start / window end).

## 3. Level classes

### 3.1 Per-session levels

The Asia/London/NY highs and lows from §1/§2 — one level pair per session per
day.

### 3.2 Previous-day high/low (PDH/PDL)

A second level class, alongside — not replacing — per-session levels (added
2026-08-31 for the drill-down pass):

- **Definition:** PDH = the high of the **entire prior UTC day (00:00–24:00)**;
  PDL = its low. Deliberately includes the Late block (deviates from "max of
  Asia/London/NY highs"): the day's true extreme can print in 21:00–24:00, and
  a level meant to read as "yesterday's high" must be the actual high. The
  share of days where Late set the extreme is reported as a diagnostic.
- **Sweepable:** from the first bar of the following UTC day (00:00).
  **Lifetime:** that following day only — superseded at the next midnight.
  Retired on first take-out (§7 V7 analog).
- **Coexistence / no double-counting:** PDH/PDL events form a **separate
  event stream** from per-session-level events — existing tables aren't
  contaminated. A single excursion may legitimately take out both the day
  level and a still-alive constituent session level at the same price; the
  day-level event records a `coincident_session_level` flag (an alive session
  level within 0.05 × ATR of the day level at take-out) so tables can split
  "pure" day-level sweeps from coincident ones. Within the PDH/PDL stream
  itself, §7 V2-style attribution applies (one bar, one event).

## 4. Reference-level scope ("which levels can be swept")

A session's price action is checked against **all unswept levels from the
last 2 days** (today's earlier sessions plus all of yesterday), not just the
same session on the prior day. Applies to both level classes (§3.1, §3.2).

## 5. Liquidity sweep — detection methods

A sweep = a level (§3) is taken out (a wick beyond it is sufficient —
close-through not required) and price then reverses, confirmed by a
detection method.

### 5.1 iFVG (inverted Fair Value Gap) — v4, corrected

**The sweep, defined simply (this is the actual idea — everything below is
just the mechanics of detecting it):** price crosses a horizontal liquidity
boundary (a level from §3 — session high/low, or PDH/PDL) at any point, and
later reverses, confirmed by an opposite-direction iFVG forming *somewhere
after* the crossing — no matter how far price travels past the boundary
first, and no matter how many local highs/lows it makes on the way. The
boundary itself never moves and there is no separate "give-up" trigger tied
to some other bar's extreme — see the correction note below, this used to be
implemented as something more complicated and it was wrong.

Standard 3-candle FVG: a gap between candle 1 and candle 3 (candle 2's range
inside the gap). It becomes an **iFVG** when price later fully **closes**
through the far edge of the gap with candles in the opposite direction
(partial pokes never count).

**Location (relaxed — user override 2026-08-31):** the gap merely
**reaching beyond** the swept level qualifies it as a candidate (phase-1's
strict whole-gap-beyond reading is retired to a sensitivity row).

**Confirmation tracking — v4 (corrected 2026-08-31, invalidation removed).**
v2's algorithm was defective: it scanned every qualifying gap anywhere in the
block-scoped window, computed each one's inversion time, and retroactively
kept whichever confirmed *earliest across the whole set* — not what a trader
watching live would see, and structurally biased toward large gaps in v3's
measurement (the opposite of what was predicted going in — see §0). v3's
fix added a sequential "active candidate" tracker, which was right, but also
added an **invalidation rule** ("give up on the candidate if price closes
beyond the take-out bar's own extreme") that turned out to be **fabricated
during grilling — the user never asked for it, and it doesn't match how they
actually think about a sweep** (confirmed against a hand-drawn diagram,
2026-08-31: price crossing London's high, making two further local highs
inside NY, then reversing through a gap that formed near the top — none of
those intermediate highs invalidate anything; the boundary is just London's
high, fixed, full stop). It also produced a confusing A/B/C
invalidation-semantics decision that is now moot.

**v4 mechanic — sequential, no invalidation:**

1. Starting at the take-out bar, watch for gaps that pass the location filter
   above (a candidate).
2. **Active candidate = the most recently formed qualifying gap** that has
   not yet confirmed. A new qualifying gap forming while the current one is
   still unconfirmed **replaces** it (mirrors this project's existing
   order-block convention of preferring the nearest/latest qualifying
   formation over the earliest) — this alone is what fixes the v2 bug; no
   separate invalidation step is needed, because a stale candidate is
   automatically superseded the moment a fresher one forms.
3. **Confirmation** = a close through the far edge of the active candidate's
   gap. Final event — MFE/MAE and all downstream geometry are measured from
   this confirmation close to the end of the `sweep_block` exactly as in
   §6.1.
4. If no candidate ever confirms before block end, the take-out is
   "unconfirmed" — unchanged from v2/v3.

**Required deliverable when this is re-run:** an hour-of-day chart — gap
frequency by hour, and which hourly windows produce a higher confirmed-reversal
rate — alongside the usual worked-example gallery.

**Timing (block-scoped):** the gap's 3rd bar AND the inversion close must
both occur within `[take-out bar, end of the take-out's sweep_block]`. A
take-out whose block ends before confirmation completes is unconfirmed.

Sweep rule: an iFVG forming above a swept high in the bearish direction =
sweep of the high; mirror for a swept low.

### 5.2 BoS (break of structure) — corrected, pinned anchor

**Authoritative** (pinned 2026-08-31 by `research/session-liquidity-bos/`,
RESEARCH-LOG Запись 15). Replaces the phase-1 mechanic in full.

**What was wrong.** Phase 1's `bos_flags()` kept one active level per side and
**overwrote it every time any new k=3 pivot confirmed** — including pivots
confirming *after* the take-out, during the incipient reversal — so it tested a
level nobody was watching when the sweep happened. v2/v3/v4 excluded BoS rather
than carry that forward. Full diagnosis and the user's two hand-drawn sketches:
`research/session-liquidity/corrections/BOS-CORRECTION-NOTE.md`.

**The mechanic.** High sweep; low sweep is the exact mirror. Pivots are
`fractals(df, k=3)` from `research/intraday-mr-smc/indicators.py`, reused
verbatim — its flags are already shifted by k, so a pivot is known exactly k
bars after it prints.

1. **Anchor selection, once, at the take-out bar `t0`:** the BoS level = the
   most recent pivot **low** that is **confirmed as of `t0`** (its confirmation
   bar ≤ `t0`) and whose **pivot bar is strictly before `t0`**. Pivots
   confirming after `t0` are ignored for this event, permanently.
   *The second condition is provably redundant* — "confirmed as of `t0`" forces
   the pivot bar to be ≤ `t0 − k` — which is what mechanically resolves the
   correction note's open question about multi-bar grind extremes: plain
   bar-index ordering decides it, no special case. Both conditions are asserted
   on every event in `checks.py` regardless.
2. **Persistence:** the anchor is **fixed for the life of the event** and
   watched as a forward ray. **No re-anchoring, ever** — this is the entire
   correction.
3. **Break (the confirmation event):** the first **close** beyond the anchor
   (below the pivot low for a high sweep) within `[t0, end of sweep_block]`
   (§6.1). One break maximum.
4. **No anchor exists** (no qualifying confirmed pivot before `t0`): the event
   is **"unanchorable"** — its own reported category, never silently dropped.
   Measured on BTC/ETH/SOL/BNB 5m: **0 of 23,423 events**. The category stays
   in the schema so a re-run elsewhere has a stated zero to compare against.
5. No break before block end → unconfirmed, as elsewhere.

**Rendering is part of the definition, not decoration.** Every worked example
must draw the anchored ray from its pivot to its break (or window end). The
reason phase 1's defect survived a whole pass is that no chart ever showed the
level being watched, so no example could contradict the engine. If a rendered
ray ever *steps*, the implementation is wrong.

**Measured character (see §0 for the numbers, `research/session-liquidity-bos/REPORT.md`
for all of them).** The anchor is fresh in time (median age 7 bars) but far in
price (median 4.93 ATR from the take-out wick) and on the near side of the
swept level in ~100% of events. A BoS is therefore always a close back deep
**inside** the swept range: late, from a worse price, with a wide stop. Under
the §6.1 stop convention its R proxy is roughly half the iFVG's. An open
question the Architect owns: a trader taking a BoS entry would plausibly stop
above the swing that forms *after* the break rather than above the sweep wick,
which is a different measurement, not a fix — it would not change the selection
result.

## 6. Measurement

### 6.1 Horizon (block-scoped)

No fixed time horizon (phase-1's 2h is dropped). All post-take-out
measurement is **block-scoped**: from the take-out bar to the **end of the
`sweep_block` the take-out occurs in**. A sweep early in a block gets most of
that block; a sweep near block end gets a short window. Consequences, pinned:

- Report the window-length distribution alongside every magnitude table —
  window length is the strongest single driver found in the study so far, and
  a naive "which hour is best" cut must be stratified by window length or it
  just rediscovers the clock (relevant to §5.1's required hour-of-day chart).
- Primary tables use events with **≥ 12 bars (1h) remaining** in the block at
  take-out time; the full sample including short-window events is reported in
  an appendix, never silently dropped.
- Report both the **within-window extreme** (max favorable / max adverse
  excursion) and the **end-of-window value**.
- Rejected alternatives, for the record: "until the next session starts" is
  identical under the full partition; "until price re-enters the swept range"
  makes the horizon a function of the outcome being measured and was rejected
  for that reason.

### 6.2 Units

**ATR(14, 5m) multiples are the primary unit** (confirmed with the user
2026-08-31 after discussion: raw % breaks cross-asset comparison — SOL looks
~2× BTC purely through asset-level volatility). Raw % is reported as a
secondary column, per asset, never pooled across assets.

### 6.3 Secondary measurement additions (v5-NY pass, 2026-09-01)

Added by `research/session-liquidity-v5-ny/` (RESEARCH-LOG Запись 18).
**Nothing in §5.1, §5.2, §6.1, §6.2 or the §7 ledger changes.** These are
*additional* columns and an *additional* filter, defined here so a later pass
reusing them does not have to re-derive them.

#### 6.3.1 The `h24` long horizon — secondary, never primary

- **Definition:** measurement runs from the confirmation bar to
  `min(t0 + 288 bars, last bar of the dataset)` — **24 hours from the take-out
  bar** at 5m. It deliberately crosses block and day boundaries.
- **Detection is NOT extended.** A confirmation must still occur inside the
  block-scoped window of §6.1 to exist at all. Only the post-confirmation
  measurement horizon is lengthened. Mixing the two would conflate "does the
  move continue past the block boundary" with "does a longer search find more
  events", which are different questions.
- **The stop proxy is horizon-invariant** by construction: it depends only on
  `[t0, confirmation bar]`, so it is identical under both horizons. Asserted,
  not assumed (v5-NY `checks.py` C6).
- **§6.1 stays primary.** Report `h24` beside the block-scoped column, in the
  same units, with the same MFE / MAE / end-of-window convention — never
  instead of it.
- **Measured answer (BTC+ETH, NY window):** the long horizon does not change
  the conclusion. Median MFE rises 4.01 → 7.09 ATR (iFVG) but median MAE rises
  4.36 → 7.06 alongside it; the ratio stays ~1.0 and the end-of-window value
  barely moves. Under the §6.3.3 trade template the holdout expectancy is
  −0.010R (iFVG) / −0.018R (BoS) *worse* on the long horizon. **This question
  is considered closed.**

#### 6.3.2 The NY filter window — a fixed-UTC reading of 09:40–11:20 New York

- **Definition:** a bar is *in window* iff its UTC open time falls in
  **`[13:40, 15:20)` UTC** — 20 five-minute bars. That is 09:40–11:20 New York
  at the **pinned fixed offset UTC−4 (EDT)**, chosen because EDT covers ~8
  months of the calendar against EST's 4. The **UTC−5** reading
  (`[14:40, 16:20)`) is a sensitivity row, not a second definition.
- **Consistent with §1's fixed-UTC, no-DST convention.** **Caveat that must
  travel with any number computed on it:** a fixed UTC−4 window is *not*
  09:40–11:20 New York wall clock all year — in EST months it is really
  **08:40–10:20** New York. It coincides with the intended window for about two
  thirds of a 4-year sample. Do not present it as wall-clock precision around
  the 09:30 NYSE open.
- **Applied as a LIVE FILTER on the confirmation bar** (the iFVG inversion
  close or the BoS break close), not on the take-out bar. It is a pure function
  of the clock and cannot look forward.
- **Structural consequence, measured and asserted:** because confirmation is
  block-scoped and `u ≥ t0`, an in-window confirmation forces `t0` itself into
  **13:00–15:15 UTC** inside the NY block. The eligible population is therefore
  a narrow slice — of 11,584 BTC+ETH take-outs, 3,705 have a `t0` that could
  produce an in-window confirmation, and 1,056 (iFVG) / 768 (BoS) actually do.
  Any pass using this window must report that funnel rather than only its
  final count.
- **Measured character:** the window is a **genuinely busier and slightly
  better** stretch of tape — the circularity-free forward lift rises from 0.84
  to **0.95** (iFVG) and 0.89 to **1.00** (BoS) inside it, the first cut in the
  study to move that metric. It lands at **par** (1.00 = no better than a
  random comparable stretch), and MFE *and* MAE both roughly double, so the
  improvement reads as volatility, not direction. Net of a real exit rule and
  real fees it is negative (§6.3.3).

#### 6.3.3 The trade template used for hypothesis-tested passes

Pinned by `research/session-liquidity-v5-ny/DESIGN.md` §4 **before any R was
computed**, and recorded here so a future pre-registered pass (e.g. the C3
reopen trigger, §0) reuses it rather than inventing one after seeing results:

- **Entry** at the confirmation close; high sweep → short, low sweep → long.
- **Stop** at the **sweep leg's running extreme over `[t0, u]`** — the existing
  §6.1-era stop proxy, unchanged, so R stays comparable across all seven
  passes. `1R ≡ |entry − stop|`.
- **Target +1R.** No parameter fitting, and unlike MFE it is an exit an engine
  can actually take.
- **Path:** walk bar by bar; **the stop is checked first**, so a bar touching
  both books a **loss**; unresolved trades are **marked to market** at the
  horizon's last close, signed, in R. (Measured: the tie never binds — the
  barriers are 2R apart and a 5m bar does not span that.)
- **Costs: 0.10 % round trip** (2 × 5 bp Binance USD-M taker),
  `cost_R = 0.001 × entry / stop_dist`, `netR = grossR − cost_R`. Slippage is
  **not** modelled, so a reported net number is optimistic, not conservative.
- **Degenerate trades** (no forward bars, zero stop distance) are excluded
  **and counted**, never silently dropped.
- **Measured baseline for any future comparison:** on BTC+ETH in the §6.3.2
  window, gross expectancy is **≈ 0** (−0.006R iFVG, +0.009R BoS) and the fee
  is the entire negative — it is 0.192R / 0.116R because these stops are only
  3–6 ATR wide.

## 7. Pinned mechanical defaults ledger

Carried, changed, or removed relative to the phase-1 D1–D9 ledger; any later
pass that deviates must say so explicitly.

| # | Point | Current default | Section | vs phase 1 |
|---|---|---|---|---|
| V1 | When a level becomes sweepable | first bar **after** its session window closes | §1 | = D1 |
| V2 | Attribution when one bar takes out several levels | largest-excursion level wins; ties → most recently closed session; all levels taken retired; `n_levels_taken` recorded | §4 | = D2 |
| V3 | Overlap handling | **removed** — sessions are non-overlapping by construction | §1 | replaces D3 |
| V4 | Confirmation / measurement window | **block-scoped** (end of `sweep_block`); primary tables require ≥ 12 bars remaining | §6.1 | replaces D4 (2h) and D6 |
| V5 | iFVG location | **relaxed** (gap reaches beyond the level); strict = sensitivity row | §5.1 | D5 as overridden |
| V6 | BoS mechanic | **pinned (BoS pass, 2026-08-31)** — anchor = the most recent OPPOSING k=3 pivot confirmed as of the take-out bar `t0`; **fixed for the event's life, no re-anchoring**; break = the first close beyond it inside `[t0, end of sweep_block]`, one maximum; no qualifying pivot → **unanchorable**, a reported category (measured 0 of 23,423). Phase 1's re-anchoring mechanic is retired in full: it confirmed 82.4% vs the corrected 33.8%, still tested the take-out-time level on only 11.3% of its own firings, and is a different, near-unconditional event — its T2/T3/T5/T12/T13 BoS rows and the C-BoS arm of `STRATEGY-DESIGN.md` are not to be cited. Every worked example must draw the anchored ray (§5.2) | §5.2 | replaces D7 |
| V7 | Re-sweeping a level | not allowed — retired on first take-out | — | = D8 |
| V8 | Level lifetime | 48h from session close, then expired unswept | — | = D9 |
| V9 | iFVG confirmation tracking | **sequential, no invalidation** (§5.1, v4) — active candidate = latest-formed qualifying gap, replaced by newer ones, no retroactive cross-window pick. The v3 invalidation rule (give up on closes beyond the take-out bar's extreme) was fabricated during grilling and dropped in v4. The v4 pass proved the sequential fix is **output-equivalent to v2's best-pick** (identical confirmations on identical bars; only the named gap differs, on 6.7% of events, with no metric consequence) — so v4 is the correct *definition*, and the substantive v3→v4 change was removing the fabricated rule, while the v2→v3 sequencing change was definitional hygiene with no numeric effect | §5.1 | v4 current; v3 superseded in full; v2 numbers valid |

## 8. Research protocol notes

Descriptive throughout (user's standing call): no permutation null, no kill
rule, no pass/fail gate. **One deliberate exception, and the template for any
future one:** the **v5-NY pass** (§0, Запись 18) was run as a *pre-registered
hypothesis test* — permutation null, numeric kill rule, chronological
fit/holdout split, costs, a stop rule pinned before any R — because it was
motivated by disagreement with a null and built on a hand-picked cut, which is
the p-hacking setup the descriptive protocol has no defence against. That is
the same standard §0's C3 reopen trigger requires. **Rule of thumb going
forward: exploring the shape of the idea is descriptive; arguing with a null,
or acting on a cut somebody chose by eye, is not.** Frequency and magnitude of iFVG-confirmed sweeps,
with charts/diagrams at every step — including a 10×10-style worked-example
gallery (the format that surfaced both the phase-1 problems and the v2 iFVG
bug; see `research/session-liquidity/examples_10x10.py`). Assets:
BTC/ETH/SOL/BNB, 5m.

**Flow (closed):** Researcher (§5.1 v4 redo — no invalidation, iFVG only)
**[done]** → user review of worked examples/hour-of-day chart → BoS correction
pass (§5.2) **[done — `research/session-liquidity-bos/`, RESEARCH-LOG
Запись 15]** → PDH/PDL drill-down (§3.2) **[done — answer is no, see §0]** →
Architect ruling **[done, 2026-08-31 — shelved, RESEARCH-LOG Запись 17]** →
user-requested re-examination under a pre-registered protocol
**[done, 2026-09-01 — `research/session-liquidity-v5-ny/`, RESEARCH-LOG
Запись 18; shelving confirmed under test]**. No further pass is scheduled; the
phase-2 `STRATEGY-DESIGN.md` (written against phase-1 numbers) stays
invalidated. Reopens only via C3 (§0).

Deliverables per pass: Python analysis engine + tables + charts, and an
updated Pine indicator reflecting the current definitions (non-overlapping
session rectangles, block-scoped relaxed iFVG per §5.1, **the pinned BoS
anchor ray per §5.2**, optional PDH/PDL ray toggle) for the user's manual
TradingView audit. §5.2's rendering requirement is not optional: every worked
example draws the anchored ray, because that omission is what hid the phase-1
BoS defect for a whole pass.
