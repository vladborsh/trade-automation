# RUNBOOK — `session_liquidity_v4.pine`

**Delta runbook.** Only what changed from
[`../session-liquidity-v3/RUNBOOK.md`](../session-liquidity-v3/RUNBOOK.md) —
and, behind it,
[`../session-liquidity-v2/RUNBOOK.md`](../session-liquidity-v2/RUNBOOK.md) —
is written out here. Sessions, level rays, take-out marks, block shading and
the 48h lifetime behave exactly as they did in v2; that runbook still
describes them correctly.

---

## 0. What is new, in one paragraph

v3's indicator drew a red **invalidation line** at the take-out bar's own
extreme and killed the active candidate on the first close beyond it. **That
rule is gone.** It was fabricated during a grilling session, it was never part
of the idea, and it fired on exactly the shape the user's own diagram draws as
a valid sweep. v4 draws the same sequential state machine with that branch
deleted: **one horizontal reference, the swept level**, one active candidate at
a time, and one way to leave the stage other than confirming — being replaced
by a fresher qualifying gap. If you used the v3 indicator, the visible
difference is that the red line and every red ✗ are gone, and roughly three
times as many confirmations appear.

---

## 1. Install

Same as before: TradingView → Pine Editor → paste
`session_liquidity_v4.pine` → *Add to chart*. Use a **5-minute** chart of a
Binance USD-M perp (BTCUSDT.P / ETHUSDT.P / SOLUSDT.P / BNBUSDT.P) so it
matches the study. Chart timezone can be anything; the sessions are pinned to
UTC in the inputs, not to your display.

**Not compiled by the researcher** — no TradingView in the research
environment. The logic mirrors `engine.py` function for function, but treat the
first load as part of your audit: if Pine throws, the error and the line number
are all that is needed to fix it.

---

## 2. Reading the state machine

| what you see | what it means |
|---|---|
| dashed **black horizontal ray** from a `sweep ▲/▼` label | **the boundary** = the swept level, fixed at the moment it was taken out. This is the *only* reference the mechanic tracks. Nothing else on the chart is a rule. |
| blue box labelled **`#1`, `#2`, …** | a qualifying gap has become the **active candidate**, numbered in formation order. Only the newest one is live. |
| a box turning **grey / "replaced"** | a newer qualifying gap displaced it. Pin 1: it is out **permanently** — if price later closes through it, that is *not* a confirmation. |
| a box turning **green / "iFVG ✓ CONFIRM"** | the bar's CLOSE went through the active candidate's far edge. This is the event the study counts, and the entry reference for all from-confirmation geometry. |
| a box turning **orange** at a block boundary | the candidate was still live when the block ended: unconfirmed, window closed. |
| a box turning **grey / "stale (chart only)"** | `fvgKeep` fired. Cosmetic — see §5.5. Raise the input to make it never fire. |

Gone from v3, and gone on purpose: the red invalidation line, the red ✗
"invalidated" boxes, and the purple "tie → invalidation" labels.

---

## 3. The one thing that will confuse you

**A candidate can sit there for a very long time while price runs further and
further past the boundary — and that is the rule working.** After a high
sweep, price often pushes well above the level, printing several more local
highs on the way. Under v3 every one of those closes killed the candidate.
Under v4 nothing happens: the candidate is simply superseded whenever a fresher
qualifying gap forms, and the machine keeps waiting. The confirmation, when it
comes, is usually through a gap that formed **near the top of that push** —
which is precisely the picture in the user's hand-drawn diagram.

The engine sees the same thing: 72 % of take-outs have at least one close
beyond the take-out bar's extreme (median 9, p90 65 of them), and once a single
candidate exists, ~9 in 10 take-outs go on to confirm.

---

## 4. Verification checklist — please actually run this

Pick any chart day with a visible `sweep ▲` label and check, bar by bar:

1. **There is exactly one horizontal line in play: the dashed swept level.**
   If you see any other reference being tracked, the script is not v4.
2. **A candidate box only appears after the take-out**, never before, and its
   3rd bar is the bar the `#n` label sits on.
3. **A candidate is never tested on the bar it formed on.** The earliest a
   green CONFIRM can appear is the bar after a `#n` label.
4. **When a `#n+1` appears while `#n` is still blue, `#n` goes grey** — and
   then watch: if price later closes through the grey box's far edge, **no**
   confirmation appears. That is pin 1, and it is the single easiest thing to
   get wrong.
5. **Price closing back beyond the take-out wick does nothing at all.** Find a
   bar that closes above the take-out bar's high (for a high sweep) while a
   blue box is live, and confirm the box stays blue. Under v3 that bar would
   have killed it.
6. **Every green CONFIRM is a full close through the box's far edge** — the
   candle *body* must clear it. A wick into the box is never enough.
7. **At a block boundary, everything resets**: a live blue box turns orange,
   the watch stops, and no confirmation can arrive from the previous block.
8. **Find one multi-push example** — price crosses the boundary, makes two or
   three further local highs, then reverses through a gap formed near the top.
   That shape is 32 % of the primary sample and it is the case this pass
   exists to get right. Compare it against your own diagram.

---

## 5. Deliberate differences from the Python engine

1. **One watch per direction per block, not one per take-out event.** Python
   runs an independent state machine for every take-out; Pine restarts the
   watch when a fresh same-side take-out prints. On a block with several
   same-side take-outs you see the latest one's machine. Ordering, replacement
   finality, active-only confirmation and block scoping are identical.
2. **No ATR, no MFE/MAE/R, no stop proxy drawn.** Those are measured over the
   whole block after the fact; on a live chart they would be lookahead
   theatre. Read them from the tables.
3. **No v2/v3 comparison on the chart.** The indicator draws the current spec
   only. The three-way comparison lives in `results/TABLES.md` (D1–D5) and in
   the gallery panel headers.
4. **No BoS** (still deferred, §5.2) and **no PDH/PDL** (returns with the
   drill-down pass).
5. `fvgKeep` drops a stale candidate box after N bars — a **cosmetic** limit so
   the chart stays readable, with **no equivalent in the engine**. On 5m the
   longest block is 96 bars, so setting it to 96+ makes the indicator match the
   engine exactly; the 90 default will very occasionally retire a candidate the
   engine would have kept. Raise it if you are auditing a long window.

---

## 6. Inputs worth touching

* **Draw every 3-candle FVG** — off by default. Turn it on to see what the V5
  location filter rejects; the chart gets noisy fast.
* **Keep the swept boundary drawn across the window** — leave it on. It is the
  whole point of this version: one line, and it never moves.
* **Drop a stale candidate after N bars** — set it to 96 or more if you want
  the chart to be a bit-for-bit mirror of the engine (see §5.5).
* **Level lifetime (hours)** — 48 is V8. Changing it changes what counts as a
  take-out and puts the chart out of sync with every table in the package.
