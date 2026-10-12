# The feature frame's history map — what each key needs, what we hold, when it can first be computed

**Measured 2026-10-12 against `insight_coord`.** IB-045. Requirements read from IB-015's
`WINDOWS` constants (`apps/insight-bot/src/features/feature-keys.ts`, `frame_version 1`), not from
memory — if a window changes, that is a new `frame_version` and this map is re-measured.

## The headline, which is not what the task assumed

**20 of the 22 key groups are computable today.** The feature engine is not about to be "correct and
empty": it is about to be correct and nearly full. Two groups are short, and only one of them is
short in a way that waiting would fix.

| | blocked now | blocked after IB-041's consolidation |
|---|---|---|
| key groups (22 total) | **2** | **1** |

The premise in the brief was that "the ATR, OI and long/short percentile keys all want 90". They do
not. The only `90` in `WINDOWS` is `fundingPercentileSamples: 90`, which is **90 settlements at an
8-hour cadence = 30 days**, and it applies to the *funding* family — the one family with 6.5 years of
history. The OI and long/short keys want 7 and 30 days, and we hold 36.5–39.

## What is held (per symbol, the minimum across all 30 — not the aggregate)

| series | span now | after IB-041 | note |
|---|---|---|---|
| `funding_settlements` | **2 387 d** (2020-03-25 →) | 2 392 d | 6.5 years; deepest thing we own |
| `open_interest_5m` | **36.5–39 d** | 41.4–43.9 d | every one of 30 symbols ≥ 36.5 d |
| `long_short_5m` | **36.5–39 d** | 41.4–43.9 d | same |
| `liquidations` | **9.5 d** | **14.3 d** | websocket-only, nothing can refetch it |
| `candles_1m` | **9.0 d** | 13.9 d | 30 symbols × perp **and** spot |

Spot candles exist for all 30 symbols, so `cvd.spot.*` is not null for want of a market.

## The map

`needs` is days of history required before the key returns a number instead of `null`.

| key group | series | needs | first computable (now) | after IB-041 |
|---|---|---|---|---|
| `funding.{venue}.rate` | funding | 0.33 d | now | now |
| `funding.{venue}.pct30d` | funding | 30 d | now | now |
| `funding.extreme_hi/lo_venues` | funding | 30 d | now | now |
| `funding.predicted.binance` | live REST | — | now | now |
| `oi.binance.now` | OI | latest | now | now |
| `oi.d4h_pct` | OI | 0.17 d | now | now |
| `oi.d24h_pct` | OI | 1 d | now | now |
| `oi.at_7d_high` | OI | 7 d | now | now |
| `ls.{3 kinds}` | L/S | latest | now | now |
| `ls.{3 kinds}.pct30d` | L/S | 30 d | now | now |
| `cvd.{spot,perp}.4h`, `slope_4h` | candles | 0.17 d | now | now |
| `cvd.{spot,perp}.24h` | candles | 1 d | now | now |
| `atr.1h.14` | candles | 0.62 d | now | now |
| `atr.4h.14` | candles | 2.5 d | now | now |
| **`atr.1d.14`** | candles | **15 d** | **2026-10-18** (+6.0 d) | **2026-10-13** (+1.1 d) |
| `structure.swing_high/low_12h` | candles | 0.5 d | now | now |
| `structure.failed_highs_24h` | candles | 1 d | now | now |
| `structure.impulse_low_15m` | candles | 0.01 d | now | now |
| `liq.{side}.{15m,60m}` | liquidations | 0.04 d | now | now |
| **`liq.{side}.z60m`** | liquidations | **14 d** | **2026-10-17** (+4.5 d) | **now** |
| `px.ret_4h` | candles | 0.17 d | now | now |
| `px.ret_24h`, `drawdown_from_24h_high` | candles | 1 d | now | now |

`atr.1d.14` needs **15** daily bars, not 14: Wilder seeds on a previous close, so `period + 1`
(`atr.ts:41`). That one extra bar is the difference between 2026-10-17 and 2026-10-18.

## Fetchable, or only accruable forward?

This is the distinction the map exists to make, and it is where the brief's assumption and mine were
both wrong.

| series | source | depth | verdict |
|---|---|---|---|
| candles 1m | `data.binance.vision` monthly klines | **2020-01** for BTC/ETH/XRP/LINK; later-listed symbols from their listing month | **fetchable** |
| OI + long/short | `data.binance.vision` **daily metrics** | **2020-09-01** BTC, **2021-12-01** six majors, listing date for newer | **fetchable** |
| OI + long/short | `fapi` `/futures/data/*` REST | **exactly 30 days** | live path only |
| funding | already held | 2020-03-25 | — |
| liquidations | websocket only | — | **forward only, nothing can refetch it** |

**The daily metrics archive carries long/short as well as OI.** One file is 288 five-minute rows with
`sum_open_interest`, `sum_open_interest_value`, `count_toptrader_long_short_ratio`,
`sum_toptrader_long_short_ratio`, `count_long_short_ratio`, `sum_taker_long_short_vol_ratio` — every
field the `oi.*` and `ls.*` keys read. So the 30-day REST limit never gates history; it gates only
the live poll.

### Two corrections to beliefs this project was holding

1. **I reported the metrics archive as missing and I was wrong.** `monthly/metrics/…` 404s for every
   month including recent ones; the path is `daily/metrics/…`. The archive is there. I nearly filed
   "no OI archive exists" off a wrong URL — the same shape as reading retention backwards off one
   probe (BUG-022).
2. **The Architect's §5 is right and should be kept**: "the OI archive starts 2021-12 for every
   symbol except BTC". Measured across 9 symbols: BTC 2020-09-01, and ETH/SOL/XRP/DOGE/BNB/LINK all
   exactly 2021-12-01. The refinement worth adding is that 2021-12-01 is a *floor*, not a universal
   start: `1000PEPEUSDT` begins 2023-05-05 and `HYPEUSDT` 2025-05-30, i.e. at their listing.

## The venue retention measurement (AGENTS.md repetition rule)

**Binance `/futures/data/*` serves exactly 30 days and refuses beyond it** — it does not return an
empty array, it rejects the request:

```
{"msg":"parameter 'startTime' is invalid.","code":-1130}   HTTP 400
```

Measured on **two occasions ~20 minutes apart** (20:0x and 20:20 UTC, 2026-10-12), four endpoints
each, ten probes per endpoint per round:

| endpoint | served at (days ago) | refused at (days ago) |
|---|---|---|
| `globalLongShortAccountRatio` | 20, 25, 28, 29, 30 | 31, 32, 35, 45, 90 |
| `topLongShortPositionRatio` | 20, 25, 28, 29, 30 | 31, 32, 35, 45, 90 |
| `takerlongshortRatio` | 20, 25, 28, 29, 30 | 31, 32, 35, 45, 90 |
| `openInterestHist` | 20, 25, 28, 29, 30 | 31, 32, 35, 45, 90 |

Both rounds identical. An hour-resolution ladder puts the edge between **720 h (served)** and
**722 h (refused)** — 30 days exactly, as a hard parameter check rather than a data-availability
fade.

Cost: ~40 requests of weight 1 per round, against the 2400/min budget — under 2 %, and a one-off
probe rather than a loop.

## What this means for IB-015 and IB-016

- **Nothing is gated on a multi-day fetch.** The only key that waiting would fix, `liq.*.z60m`, is
  unlocked by **IB-041's consolidation**, which is already rehearsed and waiting on one command —
  not by collecting for another 4.5 days.
- **`atr.1d.14` is the one key a backfill fixes today.** It needs 6 more days of 1m candles (1.1 days
  after IB-041), and the klines archive holds years. This is work, not waiting.
- **Liquidation history is the only thing that can never be recovered**, which is the argument for
  IB-041 landing promptly and for the tape never being split across two databases again.
- IB-016's regime axes inherit exactly two null keys, both named above, and neither is permanent.

**No multi-day fetch has been started.** The backfill sizing for `atr.1d.14` — 30 symbols × 6 days of
1m klines — is a decision for the Tech Lead, with the numbers above.
