# BoS correction — sketch reading and engine cross-check

**Role:** Architect, 2026-08-31. Inputs: the user's two hand-drawn sketches in
this directory (`bos_correction_downtrend.png`, `bos_correction_uptrend.png`,
read directly), phase-1 `engine.py:bos_flags()`.
**Scope:** documents the defect for the **later BoS pass**. The iFVG v2 redo
does not depend on anything here.

## What the sketches specify

Both sketches draw ordinary pivot highs/lows as short ticks at their point,
but the pivot **currently being tested for a break** as a **horizontal ray
extended forward in time** from that pivot until price actually closes through
it — the BoS is the close through that persisting ray.

- **Uptrend sketch:** rising structure; each higher-low carries a green ray;
  the labeled BoS is the close **below the most recent higher-low that led
  into the top** (the last opposing pivot before the extreme). Pivot highs
  (red ticks) are not what gets watched.
- **Downtrend sketch:** falling structure; the red ray extends from the **last
  lower-high before the final low**, and the BoS is the close up through it.

So the intended mechanic, stated once: **at the moment the relevant extreme
is in place, the BoS level is the most recent confirmed *opposing* pivot that
anchored the final leg into that extreme — pinned there, drawn forward as a
ray, and watched until a close breaks it.** The level does not move afterward.

## What the phase-1 engine actually does (`bos_flags()`)

It keeps one active level per side = the **most recently confirmed** pivot
low/high, **overwriting it every time a new pivot confirms**, and flags a BoS
at the first close beyond the currently active level (retiring it after one
break).

## Classification: both a viz gap and an engine-selection defect

1. **Viz gap (real but minor):** `draw_event()` never rendered the watched
   level as a forward-extending ray, so the user could not see which pivot was
   being tested — this is what made the defect visible only via worked
   examples.
2. **Engine-selection defect (the substantive one):** because the active level
   is overwritten on every new confirmation, a pivot that confirms **after the
   take-out** — during the incipient reversal itself, since k=3 pivots confirm
   only 3 bars late — silently **re-anchors the test level away from the pivot
   the sketches intend** (the pre-extreme opposing pivot). Concretely, after a
   session-high take-out, a shallow pullback low formed post-take-out can
   confirm mid-window and replace the higher-low that anchored the final
   up-leg; the engine then demands a close below the *newer, lower* level —
   later, looser, and occasionally never, relative to the sketch semantics.
   Phase-1's BoS delay (median 14 bars) and stop width (3.76 ATR) are both
   inflated by this in an unmeasured amount.

## Spec for the corrected mechanic (for the later BoS pass — not run yet)

At the take-out bar `t0` of a high sweep (low sweep is the mirror):

1. **Anchor selection:** the BoS level = the most recent pivot low **confirmed
   as of `t0`** whose bar index precedes the take-out extreme — the higher-low
   anchoring the leg into the take-out. Pivots confirming after `t0` are
   ignored for this event.
2. **Persistence:** the level is fixed for the life of the event and watched
   as a ray; BoS = first close beyond it within the (v2 block-scoped)
   confirmation window. No re-anchoring, one break maximum.
3. **Rendering:** every worked example must draw the anchored ray from its
   pivot to its break (or window end), so the user can audit the selection —
   the audit gap that hid this defect is itself part of the fix.
4. Open question to pin at design time (Architect, with the user if needed):
   whether "precedes the take-out extreme" means the extreme *bar* or the
   start of the final leg when the extreme is a multi-bar grind; the sketches
   show clean V-shapes and do not disambiguate. Default proposal: pivot bar
   index < take-out bar index, i.e. strictly before `t0`.

Phase-1 BoS numbers (T2/T3/T5/T12/T13 BoS rows, the C-BoS arm of the
invalidated STRATEGY-DESIGN.md) should be treated as measuring the *wrong
event* and not cited.
