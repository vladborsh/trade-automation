# Session liquidity & liquidity sweeps

Canonical definitions for the session-liquidity idea. Sorted into stable
sections (facts a later pass looks up), not a chronological log — history of
*why* a definition changed lives in `RESEARCH-LOG.md`, not here. Keep this
file updated whenever a definition changes during implementation.

## 0. Status

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
rule, no pass/fail gate. Frequency and magnitude of iFVG-confirmed sweeps,
with charts/diagrams at every step — including a 10×10-style worked-example
gallery (the format that surfaced both the phase-1 problems and the v2 iFVG
bug; see `research/session-liquidity/examples_10x10.py`). Assets:
BTC/ETH/SOL/BNB, 5m.

**Flow:** Researcher (§5.1 v4 redo — no invalidation, iFVG only) **[done]**
→ user review of worked examples/hour-of-day chart → BoS correction pass
(§5.2) **[done — `research/session-liquidity-bos/`, RESEARCH-LOG Запись 15]**
→ PDH/PDL drill-down (§3.2, 3 combos: NY sweeps London, NY sweeps PDH/PDL,
Asia sweeps PDH/PDL) → Architect (strategy design, re-derived — the phase-2
`STRATEGY-DESIGN.md` was written against phase-1 numbers and is provisionally
invalidated; note that **neither** confirmation method selects, so a design
must treat both as timing/entry references) → Researcher (backtest).

Deliverables per pass: Python analysis engine + tables + charts, and an
updated Pine indicator reflecting the current definitions (non-overlapping
session rectangles, block-scoped relaxed iFVG per §5.1, **the pinned BoS
anchor ray per §5.2**, optional PDH/PDL ray toggle) for the user's manual
TradingView audit. §5.2's rendering requirement is not optional: every worked
example draws the anchored ray, because that omission is what hid the phase-1
BoS defect for a whole pass.
