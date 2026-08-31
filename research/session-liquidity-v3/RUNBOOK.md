# RUNBOOK — `session_liquidity_v3.pine`

**Delta runbook.** Only what changed from
[`../session-liquidity-v2/RUNBOOK.md`](../session-liquidity-v2/RUNBOOK.md) is
written out here. Sessions, level rays, take-out marks, block shading and the
48h lifetime behave exactly as they did in v2 — that runbook still describes
them correctly.

---

## 0. What is new, in one paragraph

v2's indicator marked **every** inversion of **any** gap that reached beyond
**any** level swept earlier in the block. That faithfully mirrored v2's Python
bug. v3 draws the **sequential state machine** instead: one active candidate
per direction at a time, a red **invalidation line** at the take-out bar's own
extreme, and each candidate colour-coded by what happened to it. If you have
used the v2 indicator, the visible difference is that far fewer confirmations
appear and you can now see *why* the others did not.

---

## 1. Install

Same as v2: TradingView → Pine Editor → paste
`session_liquidity_v3.pine` → *Add to chart*. Use a **5-minute** chart of a
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
| solid **red horizontal ray** from a `sweep ▲/▼` label | the **invalidation line** = the take-out bar's own high (or low), fixed at that bar. §5.1 point 3. It is *not* the swept level — that one is already broken by definition. |
| blue box labelled **`#1`, `#2`, …** | a qualifying gap has become the **active candidate**, numbered in formation order. Only the newest one is live. |
| a box turning **grey / "replaced"** | a newer qualifying gap displaced it. Pin 1: it is out **permanently** — if price later closes through it, that is *not* a confirmation. |
| a box turning **red / "✗ invalidated"** | the bar's CLOSE went beyond the red line. The candidate is discarded, and only gaps forming on a **later** bar are eligible afterwards. |
| a box turning **green / "iFVG ✓ CONFIRM"** | the bar's CLOSE went through the active candidate's far edge. This is the event the study counts, and the entry reference for all from-confirmation geometry. |
| a purple **"tie → invalidation (pin 3)"** label | that one close did **both**. The primary rule resolves it as an invalidation. See REPORT.md §2 — this is common (13 % of take-outs), not exotic, and it is the decision you are being asked to rule on. |
| a box turning **orange** at a block boundary | the candidate was still live when the block ended: unconfirmed, window closed. |

---

## 3. The one thing that will confuse you

**Most candidates die immediately, and that is the rule working, not a bug.**
After a high sweep, price is usually still above the take-out bar's high for a
while. Any bullish gap that forms during that push becomes the active
candidate and is then killed on the very next close that is still above the
red line. You will routinely see five, seven, ten numbered boxes in a row all
going red. The engine sees the same thing: median 1 candidate and 1
invalidation per take-out, p90 seven of each.

A confirmation under this rule therefore almost always comes from a gap that
formed **after** price had already come back below the red line — late, and
small. That is the mechanic, and it is exactly what §3.2 of REPORT.md
quantifies.

---

## 4. Verification checklist — please actually run this

Pick any chart day with a visible `sweep ▲` label and check, bar by bar:

1. **The red line is the take-out bar's own wick extreme**, not the dashed
   level it swept. The two are different prices; the red one is further out.
2. **A candidate box only appears after the take-out**, never before, and its
   3rd bar is the bar the `#n` label sits on.
3. **A candidate is never tested on the bar it formed on.** The earliest a
   green CONFIRM can appear is the bar after a `#n` label.
4. **When a `#n+1` appears while `#n` is still blue, `#n` goes grey** — and
   then watch: if price later closes through the grey box's far edge, **no**
   confirmation appears. That is pin 1, and it is the single easiest thing to
   get wrong.
5. **After a red ✗, the next candidate's `#n` label is on a strictly later
   bar** than the ✗.
6. **Every green CONFIRM is a full close through the box's far edge** — the
   candle *body* must clear it. A wick into the box is never enough.
7. **At a block boundary, everything resets**: a live blue box turns orange,
   the watch stops, and no confirmation can arrive from the previous block.
8. **On a purple tie label**, satisfy yourself about the geometry: the close is
   below the gap's lower edge *and* above the red line at the same time. If
   you think that close should have counted as a confirmation, say so — that
   is variant B, and it takes the study from 20.7 % to 34.6 %.

---

## 5. Deliberate differences from the Python engine

1. **One watch per direction per block, not one per take-out event.** Python
   runs an independent state machine for every take-out; Pine restarts the
   watch when a fresh same-side take-out prints. On a block with several
   same-side take-outs you see the latest one's machine. Ordering,
   invalidation, replacement finality and active-only confirmation are
   identical.
2. **No ATR, no MFE/MAE/R, no stop proxy drawn.** Those are measured over the
   whole block after the fact; on a live chart they would be lookahead
   theatre. Read them from the tables.
3. **No variant B or C on the chart.** The indicator draws the primary rule
   (A) only. The B/C comparison lives in `results/TABLES.md` (V1/V2) and in
   the gallery panel headers.
4. **No BoS** (still deferred, §5.2) and **no PDH/PDL** (returns with the
   drill-down pass).
5. `fvgKeep` drops a stale candidate box after N bars — a **cosmetic** limit
   so the chart stays readable, with no equivalent in the engine. Raise it if
   you are auditing a long window.

---

## 6. Inputs worth touching

* **Draw every 3-candle FVG** — off by default. Turn it on to see what the V5
  location filter rejects; the chart gets noisy fast.
* **Label tie bars** — leave it on for this audit round. It is the point.
* **Draw the invalidation line** — leave it on. Nothing else on the chart
  explains why candidates die.
* **Level lifetime (hours)** — 48 is V8. Changing it changes what counts as a
  take-out and puts the chart out of sync with every table in the package.
