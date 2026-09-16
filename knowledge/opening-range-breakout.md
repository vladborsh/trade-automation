# Opening-range breakout (ORB) — session-anchored momentum

Canonical definitions for the ORB family as this project tests it. Design
ruling and pre-registration: `research/orb-ny-open/ARCHITECT-NOTE.md` and
`research/orb-ny-open/DESIGN.md` (2026-09-16). **Tested and killed** —
see `research/orb-ny-open/REPORT.md`.

## 0. Status

- **Mechanic pinned 2026-09-16 by Architect.** Eight pre-registered arms
  ({US100, US500, BTCUSDT, ETHUSDT} × {5m, 15m}).
- **2026-09-16 — all eight arms KILLED (NO EDGE)** on the pre-registered
  holdout 2025-08-01 .. 2026-07-31, template 1 (+1R, flat 16:00 NY),
  α = 0.05/8 = 0.00625. Holdout mean net R: US100-5m +0.033, US100-15m +0.042,
  US500-5m −0.018, US500-15m +0.006, BTCUSDT-5m −0.123, BTCUSDT-15m −0.065,
  ETHUSDT-5m +0.013, ETHUSDT-15m +0.047. **Not one arm reaches the +0.05R kill
  bar.** Well powered: n_holdout 207–236 per arm against a floor of 150; the
  pre-registered power contingency never fired.
- **Costs are not the cause.** With the stop at the full opening range,
  `cost_R` is 0.016–0.030R on the indices and 0.076–0.096R on crypto (the
  cmc-bot pass, by contrast, paid 0.25–0.40R). Gross expectancy is itself near
  zero. The edge is **absent, not eaten** — a different failure mode from
  Запись 22.
- **But the mechanic does select direction.** The non-circular forward lift is
  **above 1.00 on all eight arms** (1.035–1.234): price does travel further in
  the breakout's direction than from a random comparable bar in the same
  window. The pre-registered trade construction simply does not convert it.
  Whether some *other* exit does is open, and untested.
- **2026-09-16 — the crypto line is closed on EVERY anchor.** A third family,
  `research/orb-utc0-crypto/`, re-opened crypto on the one crypto-native
  anchor (00:00 UTC — the daily-candle reset, the perpetual funding
  settlement and the Tokyo open coinciding, seven days a week, no DST), with
  the closed pass's mechanic verbatim and only the clock changed. **Both arms
  (`BTCUSDT-5m`, `ETHUSDT-5m`) were KILLED on the fit-period screen and never
  reached the holdout**: fit mean net R −0.233R and −0.152R over
  2020-01-01 .. 2025-07-31 (1,885 / 1,901 trades on the deepest available
  Binance history), fit-period Null-A p = 0.899 and 0.670 — the matched-time
  placebo beats the real breakout. Three fit-only placebo anchors (08:00,
  16:00, **04:00 UTC = no story at all**) are all in the same negative band,
  ordered by `cost_R` rather than by story; 08:00 is not promoted. The
  weekend half is **worse** than the weekday half on both arms, gross as well
  as net — the opposite of what a crypto-native reset predicts. See
  `research/orb-utc0-crypto/REPORT.md`.
- **Forward lift > 1 is a property of the NY anchor, not of the mechanic.**
  At 00:00 UTC median lift is **0.978** on BTC (below 1) and 1.073 on ETH,
  against 1.227 / 1.162 for the same instruments at 09:30 NY. Any
  exit-construction follow-up inherits "direction is selected" **on the
  indices at the NY anchor only**.
- **Cost structure of the Asian block, for any R-normalised mechanic.**
  `cost_R` at the 00:00 UTC anchor is 0.14–0.20R against 0.08–0.10R at
  09:30 NY — same instruments, same 0.10 % fee, same 30-minute width. The
  00:00–00:30 UTC range is narrower relative to price, so the stop is tighter
  and the same fee costs twice as much in R.
- **Companion LightGBM study: 0 of 24 features flagged** on either timeframe,
  against a 200-refit target-shuffle max-statistic null (FWER-controlled). The
  frozen-model holdout read carries no out-of-sample skill either (Spearman
  +0.051 / +0.011, both 90 % intervals spanning 0). No conditioned-ORB
  proposal follows. A null here is weaker than Test A's: 24 features on ~1,400
  trades per timeframe cannot exclude a small conditional effect.
- **Crypto controls.** Weekend rows are far worse than the arms (−0.29R to
  −0.41R) — but nothing is inferred, because the pre-registered reading only
  bites on a *passing* arm and none passed. The pre-ETF row (2022-08 .. 2023-12)
  is **not weaker** than the ETF era, so **the ETF-transmission story gets no
  support from the tape**.
- **Open, not settled:** template 2 (pure ORB, no target) reached +0.106R
  (ETHUSDT-5m) and +0.138R (ETHUSDT-15m) on the holdout, at or above the build
  bar — but it is the secondary template, was never run through the nulls or
  the bootstrap, and disagrees with its own fit period. It is grounds for at
  most one Architect-authorised fresh registration, never a re-labelling of
  these arms.
- **2026-09-16 — crypto re-opened on one crypto-native anchor, one shot.**
  `ARCHITECT-NOTE-CRYPTO-INVESTIGATION.md` researched the alternatives
  (CME open — gone since CME's 2026-05-28 move to 24/7; BRRNY 15:00–16:00 NY
  ETF fixing — a close, not an open; funding 00/08/16 UTC; Deribit 08:00 UTC;
  the periodicity literature, which finds no structural break at the ETF
  launch) and registered family **`orb-utc0-crypto`**: `BTCUSDT-UTC0`,
  `ETHUSDT-UTC0`, the same mechanic with the clock substituted (OR 00:00–00:30
  UTC, trigger 00:30–02:30 UTC, 5m, flat 07:55 UTC, seven days, fit from the
  earliest Binance month), cumulative α = 0.05/16, fit screen, with a
  pre-committed weekday/weekend reading and fit-only placebo anchors at
  08:00/16:00/04:00 UTC. Prior stated low; a kill closes crypto ORB on every
  anchor.
- **Family.** Continuation-shaped, session-structure momentum. Not a variant
  of `session-liquidity.md` (sweep-then-confirm, reversal-shaped) nor of
  `smc.md`/`smart-money-ict.md` (iFVG/order-block triggers). Shares the
  09:30 NY cash-open clock with nothing else pre-registered here (the cmc-bot
  windows start 09:40; v5-NY 09:40–11:20); shares the *premium/discount*
  rolling-200-bar range and the UTC-midnight VWAP of
  `vwap-band-reversal-ict.md` §1/§5 only as **features** in the companion
  LightGBM study, not as signal components.

- **2026-09-16 — LINE CLOSED (Architect).** 22 pre-registered arms across four
  families (30-min width; 5/10/15-min width; exit construction E0/E1/E2; the
  00:00 UTC crypto anchor), 11 holdout reads, no edge anywhere; the 2025-08 ..
  2026-07 window is retired for ORB (`research/orb-utc0-crypto/DESIGN.md`
  §13.2). What stays unexplored and why it is not reopened on a single index —
  the papers' second-candle-open / resting-stop entry, relative volume as a
  cross-sectional selector — is written in `IDEAS-BACKLOG.md` (ORB entry,
  final status) and `research/_surveys/2026-09-intraday-directions.md` §2.

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
