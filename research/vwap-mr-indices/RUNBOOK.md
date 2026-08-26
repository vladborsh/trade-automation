# Runbook — VWAP-MR TradingView hand-test (ES / NQ / YM)

Script: `vwap_mr.pine` (Pine v6 `strategy()`). Design: `ARCHITECT-NOTE.md` §3,
routed by `ROUTING-ADDENDUM-PINE.md`. **A good-looking run here is evidence for
funding a data purchase, not a validated strategy.**

## 1. Chart setup (results are uninterpretable without this)

* **Symbols:** `ES1!`, `NQ1!`, `YM1!` — one chart each, run separately.
* **Back-adjusted continuous contract — mandatory.** Chart **Settings** →
  **Symbol** tab → check **"Adjust for contract changes"**. Unadjusted `1!`
  series carry a price jump at every roll; a session VWAP computed across that
  boundary is silently wrong. Verify the checkbox is on for each of the three
  charts before running anything.
* **Timeframe: 5m.** Not 1m (history too short), not 15m (too few bars for a
  session VWAP to mean anything).
* **Record the actual date range TradingView gives you, per symbol.** Scroll to
  the oldest available 5m bar and note its date. The window depends on your plan
  and differs across ES/NQ/YM; every result cell must carry its own range.
* Sanity check before recording anything: the plotted orange VWAP line must
  **reset at 09:30 ET each day** and must be **absent overnight**. If it runs
  continuously through the Globex session, the session filter is not matching
  the symbol's exchange calendar — stop and report that, don't record results.

## 2. Cost settings — set these per symbol, in Settings → Properties

The script's declaration defaults ($1.40/contract/side, 1 tick) are placeholders;
Pine requires a constant there. Override in the **Properties** tab:

| Symbol | Commission (cash per contract, **per side**) | Slippage (ticks) |
|---|---|---|
| ES1! | 2.00 | 1 |
| NQ1! | 2.00 | 2 |
| YM1! | 2.00 | 2 |

$2.00/side ≈ $4.00 round turn — a conservative retail all-in estimate (broker +
CME exchange + NFA). Slippage differs because ES's book is deep at its 0.25 tick
while NQ and YM are wider/thinner in practice. **These are estimates. Check them
against your own broker's schedule and record whatever you actually used.**
Leaving costs at zero flatters every cell and invalidates the run.

## 3. Frozen inputs

k = 2.0 primary. Everything else — session 09:30–16:00 ET, entry cutoff 15:30,
flat 15:55, stop at the stretch extreme, 1% risk sizing, 2% session breaker — is
a compile-time constant, deliberately not an input.

Sensitivity set, pre-registered: **k ∈ {1.5, 2.0, 2.5}** × 3 symbols = **9 cells,
all reported**. That is the entire permitted search. Any other change (timeframe,
session, stop rule, target) is a new design pass, not a result.

## 4. Results template — one row per cell, all nine

| Symbol | k | Date range (from → to) | Trades | Net PF | Win rate | Max DD (%) | Commission/side | Slippage (ticks) |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |

Take **Net Profit Factor** (the "Profit Factor" on the Performance Summary tab
with costs applied), total closed trades, percent profitable, and max equity
drawdown. Report win rate; it is not gated.

**Pooled minimum: 300 trades across all three symbols at k = 2.0 before anyone
reads a PF.** Under 300, the only reading is "insufficient sample" — and if a
multi-year 5m window cannot produce 300 setups, that is itself the
frequency-floor verdict and should be reported as such.

## 5. Pre-committed evaluation rule

On the frozen inputs (k = 2.0): **pooled net PF > 1.1 across ≥300 pooled trades
AND no single symbol below 0.9** → reopen the stage-0 data-spend conversation.
Otherwise the idea goes back to the backlog with these nine cells attached. The
k = 1.5 / 2.5 cells are a stability check on that verdict, not an alternative
route to passing it.

## 6. Known imprecisions — read before interpreting

* **Intrabar fill order is TradingView's guess.** When a bar touches both the
  stop and the VWAP target, TradingView resolves it with its own tick assumption.
  Our own engine's stop-before-target conservatism cannot be reproduced here, so
  these results are biased **optimistic**. Expect real PF below what you see.
* **The VWAP target is a moving target, on purpose.** The limit order is
  re-issued at the current session VWAP every bar, so it walks with the anchor.
  That is the hypothesis under test (does price come to the VWAP), not a bug.
* **Early-close holidays leak.** On half-days the tape closes 13:00 ET; the
  15:55 flat cannot fire, and the position is closed by the fallback on the
  first non-RTH bar instead. A handful of sessions per year, accepted for a
  hand-test.
* **Data window differs per symbol and plan**, so pooled numbers mix unequal
  histories. Report ranges; do not average PFs across differing windows without
  saying so.
* **Sizing uses the signal bar's close** as a proxy for the unknown next-bar-open
  fill, so realised risk drifts from 1% by the entry gap. Trades where 1% of
  equity cannot fund a single contract are **skipped**, not rounded up to 1 —
  expect fewer trades than triggers, especially early in a drawdown.
* **Volume dependency.** The whole anchor is volume-weighted; if a symbol's feed
  reports no volume, the bands never appear and the strategy takes no trades.
  Confirm bands are plotting before concluding "no setups".
