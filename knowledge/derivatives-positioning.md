# Derivatives positioning data (OI, top-trader ratios, taker flow)

Canonical definitions and verdict for the derivatives-positioning idea.
**Status: closed** — all three pre-registered hypotheses killed, redundancy
control (§3) is the reusable methodology worth keeping even though this
specific idea didn't survive it. `RESEARCH-LOG.md` Запись 8,
`research/deriv-positioning/REPORT.md`.

**No chart images exist for this package** — the research pass produced
tables/CSVs only (`results/*.csv`), no visualization deliverable was
requested or built. Unlike `knowledge/smc.md` and `knowledge/
session-liquidity.md`, there's nothing to embed/point to here; if this idea
is ever revisited, a worked-example gallery (the format that caught real
bugs in the SMC and session-liquidity lines) would be a reasonable first ask.

## 1. Data source and metrics

`data.binance.vision`, `futures/um/.../metrics/` — free, no credentials,
5m granularity per symbol:

- **Open interest** (`sum_open_interest`, contracts and notional) — the
  quantity-side measurement of leveraged positioning.
- **Top-trader long/short ratio** (`sum_toptrader_long_short_ratio`,
  by *positions* — the leverage-liquidation-relevant one; a by-*accounts*
  variant also exists but was recorded as a diagnostic only, not swept).
- **Global long/short account ratio** (`count_long_short_ratio`).
- **Taker buy/sell volume ratio** (`sum_taker_long_short_vol_ratio`) — the
  most price-correlated of the sensors (aggressive order flow).

## 2. The central question this idea existed to answer

Does positioning data add anything **beyond what price already says**? OI,
ratios, and taker flow are all correlated with recent returns — a "signal"
that is trailing return in disguise is not a second signal. This framing
(not the specific hypotheses below) is the part worth reusing if a similar
non-OHLCV data source ever comes up again.

## 3. Redundancy control — reusable methodology

For every hypothesis, rerun the identical test with the positioning variable
replaced by its **price-derived shadow** (e.g. trailing-N-hour return
percentile instead of an OI/ratio percentile). A hypothesis whose positioning
version does not visibly beat its price-shadow version (same sign, larger
magnitude, shadow fails where the real one passes) is reported as **"price in
disguise — no second signal,"** regardless of its own stage-1 t-stat. This
control is what actually killed hypothesis (a) below (see §4) — it initially
looked real and only failed here. Worth applying to *any* future non-OHLCV
data source before trusting a positive stage-1 result.

## 4. Hypotheses tested — all killed

| # | Hypothesis | Result |
|---|---|---|
| (a) | OI-conditioned `momentum_breakout` — does rising ΔOI at trigger time select the good half of the strategy's trades? (framed as a filter, can-only-subtract discipline) | **Passed stage-1 (t up to 3.44) and its permutation null — then failed the redundancy control decisively.** The price-derived shadow (trailing-4h-return percentile) separates the same trades *better* on 5 of 6 horizons, 8/8 symbol breadth. The filter kept 55% of trades but only 10% of net PnL — it made the base strategy worse, not better. Without the redundancy control this would have been reported as a discovery. |
| (b1) | Crowding-squeeze entry: extreme one-sided top-trader positioning (`crowd ≥ 95th pctile`) + adverse 12-bar break → enter with the squeeze | Significantly **negative** at stage 1 (t = −4.56), 0th percentile of its null. Killed outright. |
| (b2) | Taker-imbalance continuation: extreme taker buy pressure + up bar → probe continuation | Significantly **negative** at stage 1 (t = −2.86), 0th percentile of its null. Killed outright (weakest of the three a priori — taker flow is the most price-correlated sensor). |

**Deliverable takeaway, stated for the record:** Binance's public positioning
feeds add no signal beyond price at 1h, on this asset set — a measured
statement, not an absence-of-effort one (stage-0 data audit, three
pre-registered hypotheses, permutation nulls, and the redundancy control
above were all applied as designed).

## 5. Spin-off carried forward (not evidence, flagged for future use)

The redundancy control's price-shadow variable for (a) — trailing-4h-
return-strength terciles on `momentum_breakout` triggers — produced the
strongest conditioning split measured in any package so far (t up to ~5.0,
6/6 horizons, 8/8 symbols). Post-hoc (it was a control, not a hypothesis),
and even a working split failed (a)'s comparative-economics bar. Pre-
registered as a candidate hypothesis in `IDEAS-BACKLOG.md`'s standalone-
momentum entry for whenever that design pass happens — not standing evidence
for anything on its own.
