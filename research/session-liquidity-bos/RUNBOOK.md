# RUNBOOK — `session_liquidity_bos.pine`

**Delta runbook.** Only what changed from
[`../session-liquidity-v4/RUNBOOK.md`](../session-liquidity-v4/RUNBOOK.md) —
and, behind it,
[`../session-liquidity-v2/RUNBOOK.md`](../session-liquidity-v2/RUNBOOK.md) —
is written out here. Sessions, level rays, take-out marks, block shading, the
48h lifetime and **the whole iFVG state machine** behave exactly as they did in
v4; those runbooks still describe them correctly.

---

## 0. What is new, in one paragraph

This indicator adds the **corrected break-of-structure mechanic** on top of the
v4 chart. At each take-out it pins the most recent already-confirmed *opposing*
`k=3` pivot and draws it as a **green ray from that pivot's own bar, forward,
until a CLOSE breaks it or the block ends**. The ray **never moves**. Phase 1's
engine moved it on every new pivot confirmation, which is why its BoS fired on
82% of take-outs instead of 34% — and the reason nobody caught that for a whole
pass is that no chart ever drew the level being watched. So the ray is not
decoration: **if you ever see the green ray step sideways, this indicator is
wrong.** An optional red step-line draws phase 1's level as it moved, so the
defect is visible next to the correction.

---

## 1. Install

TradingView → Pine Editor → paste `session_liquidity_bos.pine` → *Add to
chart*. Use a **5-minute** chart of a Binance USD-M perp
(BTCUSDT.P / ETHUSDT.P / SOLUSDT.P / BNBUSDT.P) so it matches the study. Chart
timezone can be anything; sessions are pinned to UTC in the inputs.

**Not compiled by the researcher** — no TradingView in the research
environment. The logic mirrors `engine.py` function for function, but treat the
first load as part of your audit: if Pine throws, the error and its line number
are all that is needed to fix it.

---

## 2. Reading the BoS layer

| what you see | what it means |
|---|---|
| green **`BoS anchor ▲/▼`** label on a bar *before* the sweep | the pinned anchor: the most recent opposing `k=3` pivot that was already **confirmed** when the level was taken out. With `k=3` this bar is always **≥ 3 bars before** the take-out — that is the causality, not a fudge. |
| solid **green horizontal ray** running forward from that label | the level under test. It is chosen once and is **fixed for the life of the event**. Flat all the way across, always. |
| green **`BoS ✓`** label | a full **CLOSE** through the ray, inside the sweep block. This is the event the study counts. A wick through the ray is not a break. |
| the ray turning **orange** at a block boundary | no break before the window closed — unconfirmed. 66% of primary take-outs end this way. |
| grey **`BoS UNANCHORABLE`** label | no confirmed opposing pivot existed at all (DESIGN §1 pin 4). **Never observed** in the 4-asset 5m study sample; the label exists so the case is visible if it ever occurs elsewhere. |
| red step-line + red **`phase-1 BoS ✗`** (optional, off by default) | phase 1's tested level, drawn as it *moved*, and the bar it fired on. Every step is a newly confirmed pivot silently overwriting the test. Turn it on once to see the defect, then turn it off. |
| small **▲ / ▼** pivot ticks (optional, off by default) | every confirmed `k=3` pivot — the pool the anchor is chosen from. |

The v4 iFVG boxes (`#1`, `#2`, replaced / confirmed / orange) are unchanged and
run at the same time, on purpose: the study's method comparison is exactly this
picture. Expect them to disagree — only 15.6% of take-outs are confirmed by
both, and when both fire the iFVG is first ~75% of the time.

---

## 3. Inputs that are new

| input | default | note |
|---|---|---|
| **Draw the pinned BoS anchor ray** | on | the deliverable. |
| **Pivot half-width k** | **3** | SPEC value, not a tuning knob — the same `fractals(df, k=3)` the Python engine uses. Changing it changes the mechanic, not the display. |
| **Mark every confirmed k=3 pivot** | off | shows the anchor pool. Noisy. |
| **Also draw PHASE 1's level, as it moved** | off | the museum piece. Costs one line object per bar per live watch, so it only covers recent history before TradingView's 500-line cap starts dropping the oldest. |

---

## 4. What to check on the chart (the audit)

1. the anchor label sits on a bar **before** the sweep label, by at least 3
   bars;
2. the green ray is **flat** from that bar to its end — no steps, ever;
3. the anchor is on the **near** side of the swept level, so a break means
   price closed back **inside** the swept range. This is true on ~100% of
   events in the study and it is why the measured stop proxy is wide
   (5.77 ATR median) and R poor (0.41 median);
4. the break is a **close**, not a wick;
5. the ray stops at the block-end line whether or not it broke;
6. with the phase-1 overlay on: the red line walks away from the green ray, and
   the red ✗ typically appears long before (or instead of) the green ✓.

---

## 5. Known simplifications, stated rather than hidden

* **One watch per direction per block.** The Python engine runs an independent
  machine per take-out *event*; if a block hosts several same-side take-outs,
  the chart shows the latest one. Anchor selection, immobility, close-through
  confirmation and block scoping are identical.
* **No PDH/PDL rays** — that level class belongs to the drill-down pass.
* **The alert conditions fire while a watch is live**, i.e. they can repeat
  within a block; the engine counts one break maximum per event. Treat the
  alerts as attention hooks, not as the event count.
* Everything in §5 of the v4 runbook (session boxes, level lifetime, the
  cosmetic `fvgKeep` staleness drop) still applies unchanged.

---

## 6. What the chart cannot tell you

The numbers this indicator is drawing are, on the study sample: a **33.8%**
break rate, a **90-minute** median delay, and a **median R proxy of 0.41**
against the iFVG's 0.84 — and, on the take-outs both methods confirm, 0.30
against 2.05. It is a real, well-defined, now-correctly-measured signal, and
under the pinned stop convention it is a worse entry reference than the iFVG.
Read `REPORT.md` §2.4 before concluding anything about selection from what the
chart looks like: the obvious way to score BoS on a chart is circular.
