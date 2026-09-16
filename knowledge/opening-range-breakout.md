# Opening-range breakout (ORB) — session-anchored momentum

Canonical definitions for the ORB family as this project tests it. Design
ruling and pre-registration: `research/orb-ny-open/ARCHITECT-NOTE.md`
(2026-09-16). **Not validated** — no number in this project's record supports
or refutes it; the first pre-registered pass is the `orb-ny-open` package.

## 0. Status

- **Mechanic pinned 2026-09-16 by Architect.** Eight pre-registered arms
  ({US100, US500, BTCUSDT, ETHUSDT} × {5m, 15m}); verdicts pending.
- **Family.** Continuation-shaped, session-structure momentum. Not a variant
  of `session-liquidity.md` (sweep-then-confirm, reversal-shaped) nor of
  `smc.md`/`smart-money-ict.md` (iFVG/order-block triggers). Shares the
  09:30 NY cash-open clock with nothing else pre-registered here (the cmc-bot
  windows start 09:40; v5-NY 09:40–11:20); shares the *premium/discount*
  rolling-200-bar range and the UTC-midnight VWAP of
  `vwap-band-reversal-ict.md` §1/§5 only as **features** in the companion
  LightGBM study, not as signal components.

## 1. Definitions

- **Session open.** 09:30 America/New_York, DST-aware. **Eligible days = NYSE
  full trading days** — on a US holiday the Capital.com index CFD tape still
  has bars but there is no cash open, so no opening range exists; the same
  calendar is applied to crypto when the cash open is the anchor.
- **Opening range (OR).** `OR_high / OR_low` = max high / min low of the
  1-minute bars with open time in `[09:30, 10:00)` NY — a **fixed 30-minute**
  range, identical for every timeframe of the same instrument-day. Width in
  ATR units is a *feature*, not a parameter.
- **Trigger.** On the arm's own bars (5m or 15m, UTC quarter-hour grid ≡ NY
  grid), the **first bar close** strictly beyond `OR_high` (long) or `OR_low`
  (short), bar opening in `[10:00, 12:00)` NY. Close-beyond, never touch. One
  trade per day per arm; no re-entry.
- **Entry.** The trigger bar's close.
- **Stop.** The opposite side of the range (`OR_low` for a long, `OR_high`
  for a short). `stop_dist = |entry − stop| ≥ OR width`; `1R ≡ stop_dist`.
- **Exit templates.** *Project-standard*: +1R target, forced flat at 16:00 NY
  (gates). *Pure ORB*: no target, same stop, flat at 16:00 NY (secondary).
  Path evaluated on 1-minute bars, stop checked first.
- **Crypto anchor.** For BTC/ETH the 09:30 NY open is an *imported* anchor
  (ETF-era US-hours flow), not an auction the crypto market holds; the
  hypothesis is weaker and framed separately, with weekend and pre-ETF rows
  as controls (`ARCHITECT-NOTE.md` §2).

## 2. Measurement conventions

- Fit 2024-01-01 .. 2025-07-31; holdout 2025-08-01 .. 2026-07-31 (project
  standard), by NY session date. Standard ladder (kill `< +0.05R` or
  `p > 0.20`; build `≥ +0.10R`, `p ≤ α`, same fit sign, `n ≥ 150`, 90 %
  bootstrap excludes 0, gross > 0), Bonferroni over the arm family.
- Costs: Capital.com — per-minute tape spread, half at entry, half at exit;
  Binance — 0.10 % round trip. Slippage not modelled.
- Companion per-trade feature study (LightGBM, permutation/SHAP, target-shuffle
  max-statistic null) is **hypothesis-generating only**; a flagged feature
  becomes a proposal for a new registration, never a verdict.
