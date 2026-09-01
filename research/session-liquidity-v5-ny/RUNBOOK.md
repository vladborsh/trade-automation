# RUNBOOK — session-liquidity v5-NY

**Delta runbook, and a short one on purpose.** Everything on the chart is
already described by
[`../session-liquidity-bos/RUNBOOK.md`](../session-liquidity-bos/RUNBOOK.md)
and, behind it, the v4 and v2 runbooks. Sessions, level rays, take-out marks,
block shading, the 48h lifetime, the whole iFVG state machine and the pinned
BoS anchor ray behave **exactly** as they did in the BoS pass — this pass
reproduced both confirmation streams bit-for-bit (`checks.py` A1–A7), so the
existing indicator is still a correct picture of what the engine does.

---

## 0. No new `.pine` file was written — and why

This pass changed **no detection rule**. It added a clock filter on the
confirmation bar, a second measurement horizon, and a trade template. None of
those is a new mechanic to draw; two of them are analysis-side only.

Shipping a fifth near-identical Pine file for a null result would add
maintenance surface for no audit value. `session_liquidity_bos.pine` remains
the manual-audit indicator for this whole family. **Recorded as not-done in
`HANDOFF.md` §5.4**; the two-line change to get the NY window onto that chart
is below, for the user to paste if they want it.

---

## 1. Adding the NY window to `session_liquidity_bos.pine`

Copy `../session-liquidity-bos/session_liquidity_bos.pine` into a new
TradingView script (do not edit the committed file — that package is closed and
audited), then add:

**(a) two inputs**, beside the existing session-hour inputs:

```pine
nyWinOn    = input.bool(true,  "Shade the NY filter window",      group="NY window")
nyWinStart = input.int (13*60+40, "start, minutes past 00:00 UTC", group="NY window")
nyWinEnd   = input.int (15*60+20, "end (exclusive), minutes UTC",  group="NY window")
```

**(b) one background call**, anywhere at the top level:

```pine
_utcMin = hour(time, "UTC") * 60 + minute(time, "UTC")
bgcolor(nyWinOn and _utcMin >= nyWinStart and _utcMin < nyWinEnd
        ? color.new(color.orange, 85) : na, title="NY filter window")
```

That is the whole change. `13:40–15:20 UTC` is 09:40–11:20 New York at the
pinned fixed offset UTC−4; enter `14*60+40` / `16*60+20` to see the UTC−5
sensitivity window instead.

---

## 2. What to check on your own chart

The pass's claim is that a confirmation landing inside the orange band is not
worth more than one landing outside it. On the chart that reads as:

1. **The band is inside the NY block.** Both the orange band and the NY session
   shading should be on screen together, with the band fully inside it. If the
   band straddles a block boundary, the minutes are wrong.
2. **In-window confirmations are always early-block.** Because confirmation is
   block-scoped, a marker inside the band always has most of the NY block still
   ahead of it. You should never see an in-window confirmation near the 20:55
   block end — the take-out that produced it has to have happened between 13:00
   and 15:15 UTC.
3. **The green BoS ray is flat.** Unchanged from the BoS runbook and still the
   single most important thing to verify by eye: **if the ray ever steps
   sideways, the indicator is wrong.**
4. **iFVG boxes and BoS markers disagree often.** Expected — only ~16% of
   take-outs are confirmed by both, and where both fire the iFVG is usually
   first. Seeing them disagree is the indicator working, not failing.

---

## 3. What the chart deliberately does not show

* **The trade template** (entry / stop / +1R target, 0.10% round-trip cost).
  It is an analysis convention pinned in `DESIGN.md` §4, not a charting object,
  and drawing it would invite reading the indicator as a strategy. It is drawn
  on the *research* panels instead — see `viz/proof07*.png` and
  `viz/proof08*.png` for a loser and a winner with the full bracket on them.
* **The h24 horizon.** It is a measurement window, not a signal. On a chart it
  would just be "288 bars later".

If you want either on screen, the research renderer will draw any event in
`results/events_*.csv`:

```
cd research/session-liquidity-v5-ny
python -c "
import tables as T
from examples import Loader
e = T.load_events()
ev = e[(e.symbol=='BTCUSDT') & (e.ts=='2025-11-17 13:00:00+00:00')].iloc[0]
Loader().render(ev, 'ifvg', 'adhoc.png', 'ad-hoc panel')
"
```
