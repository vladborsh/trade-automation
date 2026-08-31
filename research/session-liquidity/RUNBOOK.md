# RUNBOOK — `session_liquidity.pine`

A TradingView **indicator** (not a strategy) for manually auditing the
session-liquidity definitions on a live chart. Its only job is to let you look at
the same objects the Python engine counts and say "yes, that is what I meant" or
"no, that is not a sweep".

## 1. Install

1. TradingView → **Pine Editor** → *Open* → *New indicator*.
2. Replace the contents with `session_liquidity.pine`, **Save**, then **Add to chart**.
3. Chart settings that make the output match the study:
   - **Symbol:** `BINANCE:BTCUSDT.P` (or ETH/SOL/BNB perp) — the study used USD-M perps.
   - **Timeframe:** `5m`. Session boxes work on other timeframes, but every
     statistic in `REPORT.md` is 5m.
   - **Chart timezone:** set to **UTC** (right-click the time axis). The
     indicator computes sessions in UTC regardless, but you will misread the
     boxes if the axis is in your local zone.

## 2. What you are looking at

| Drawing | Meaning |
|---|---|
| Coloured rectangle | one session's realised range: orange Asia 00–08, blue London 08–16, purple NY 13–21 UTC. It grows while the session is open and freezes when it closes. |
| Dashed horizontal ray | an **unswept** session high/low still in the 48h pool. It is drawn from the session's close and extended each bar. |
| Ray turning grey/dotted | that level left the pool — taken out, or expired at 48h. |
| `sweep ▲` / `sweep ▼` label | this bar's wick took out at least one pooled level. The tooltip gives the deepest level taken. |
| Teal / maroon box | a 3-candle FVG (bullish / bearish), attributed to its 3rd bar. |
| Box turning red/green with `iFVG↓`/`iFVG↑` | that FVG was **inverted**: a bar CLOSED fully through its far edge. A wick into the gap does nothing. |
| Red ▼ / blue ▲ | k=3 pivot high / low, drawn on the bar it describes. |
| `BoS↓` / `BoS↑` cross | first close beyond the most recent unbroken pivot. |

## 3. The one thing that will confuse you

**Pivot markers appear 3 bars in the past.** `ta.pivothigh(high, 3, 3)` cannot
return a value until 3 bars after the peak, and the script draws it back at the
bar it belongs to (`offset = -3`). So on the live bar the last 3 bars can still
sprout a pivot marker. This is the same `k`-bar delay the Python `fractals()`
primitive has — see `research/_explainers/fractals-vs-pivots/`. It is correct
behaviour, not a repaint bug: nothing that has already been drawn ever moves.

## 4. Verification checklist (please actually run this)

The script has **not been compiled by the author** — your first paste is its
first compile. Report anything that errors. Then, on BTCUSDT.P 5m:

1. **Sessions.** Pick a day. Do the three boxes start/end at 00:00, 08:00 and
   13:00 UTC, and do their tops/bottoms sit on the actual extremes of those windows?
2. **Levels.** After a session closes, do two rays appear at its high and low?
   Does a ray stop extending the moment a wick crosses it?
3. **Sweep labels.** Is a `sweep` label printed on the bar whose *wick* — not
   close — crossed the level?
4. **FVG geometry.** Pick a visible gap: is the box bounded by candle 1's high
   and candle 3's low (bullish), and drawn on candle 3?
5. **Inversion strictness.** Find a bar that wicks deep into an FVG but closes
   back inside it — the box must **not** flip. Only a full close-through flips it.
6. **Pivots.** Spot-check three markers against `ta.pivothigh(high,3,3)` added
   as a separate plot; they must coincide.
7. **BoS.** Does each `BoS↓` sit on the first close below the most recent blue ▲,
   and does that same pivot never produce a second `BoS↓`?

If 1–7 all look right, the Python engine and the chart are measuring the same
objects, and the numbers in `REPORT.md` describe what you see.

## 5. Deliberate differences from the Python engine

The chart is a *viewing* instrument; a few study-specific rules are omitted
because they would clutter it without helping the eye:

- **No attribution rule (D2).** When one bar takes out several levels the chart
  labels the bar once and the tooltip names the deepest level, but it does not
  suppress the other rays' retirement. The engine collapses these into one event.
- **No confirmation window (D4).** The chart marks *every* iFVG and BoS, not only
  the ones within 24 bars of a take-out. Pair them by eye.
- **No iFVG location test (D5).** The chart marks all inversions regardless of
  whether the gap sits beyond the swept level. The engine requires the whole gap
  beyond it.
- **No measurement overlays.** Reverse move, ATR multiples and R live in the
  Python outputs only.

## 6. Inputs worth touching

- `Level lifetime (hours)` — 48h is the spec's "last 2 days".
- `Keep an unfilled FVG for N bars` — display hygiene only; TradingView caps
  drawings at 500 boxes and old gaps crowd them out.
- `Pivot k` — leave at 3 unless you are deliberately exploring; every number in
  the report is k=3.
- Session windows are exposed as `input.session` so you can test alternative
  boundary conventions visually before anyone changes the spec.
