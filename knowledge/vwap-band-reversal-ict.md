# VWAP band reversal — `cmc-bot`'s `VWapStrategy`

Canonical definitions for the composed strategy in the user's pre-built bot at
`cmc-bot-main/` (`src/strategy/vwap-strategy.ts`), live-traded on four
Capital.com instruments: US100, US500, EURCHF, GBPCHF
(`src/strategy/strategy-provider.ts`).

**Everything below was read directly off the TypeScript source and is a
description of code that exists, not a design proposal.** Where the code's
behaviour differs from its own naming, the code wins and the difference is
called out. Nothing here has been validated by this project — see §0.

## 0. Status

- **Mechanic pinned 2026-09-12 by Architect** (`research/cmc-bot-vwap/ARCHITECT-NOTE.md`).
  **Not validated.** No number in this project's record supports or refutes
  it. The bot's own in-repo backtester has the same properties documented in
  `knowledge/smart-money-ict.md` §0/§4.6 (no costs/spread/slippage, close-only
  exits, gapped-through stops clamped to the exact stop price) — inadmissible
  here for the same reason.
- **Stage 0 (reproduction) passed 2026-09-12** (`research/cmc-bot-vwap/PARITY.md`):
  a Python port matches the bot's TypeScript bit-for-bit on every evaluated
  bar of the full Capital.com history (2024-01 .. 2026-09, all four
  instruments). Still **no performance number** — that is Stage 1. The
  reproduction corrected several statements in this file; they are marked
  *(Stage 0)* below.
- **Family:** shares two primitives already pinned elsewhere in this project
  — the **proximal-edge iFVG** (`smart-money-ict.md` §1, `smc.md` §3 encoding
  #4, whose siblings #1–#3 are closed) as its entry trigger, and a
  **prior-hour sweep** condition structurally similar in shape (though not in
  reference level) to `session-liquidity.md`'s sweep-then-confirm family
  (whose whole session-extreme version was killed under pre-registration,
  Запись 18). It composes them with a **third** ingredient neither of those
  files has: a **VWAP band regime/bias filter**. Treat this as its own
  composition — not a variant of either existing file.
- **Untouched by this idea, in either direction:** `session-liquidity.md`'s
  C3 reopen trigger (PDH/PDL-in-Asia) and `smart-money-ict.md`'s validation
  status. Nothing here bears on the smart-money bot's H1-bias→M1-iFVG signal
  or vice versa — they are different strategy classes in the same source
  repo.
- **Distinct from `research/vwap-mr-indices/`** — that package is a *design
  proposal* for VWAP mean-reversion on CME index futures (ES/NQ/YM),
  currently paused pending a data-vendor decision. This file documents an
  *already-coded, already-parameterized* strategy trading Capital.com CFDs
  (US100/US500) plus two forex pairs (EURCHF/GBPCHF) that `vwap-mr-indices`
  never covered. Same anchor (VWAP), different mechanic, different venue —
  see the architecture note for the full comparison.

## 1. VWAP and its bands

Source: `cmc-bot-main/src/indicator/tools/vwap.indicator.ts`.

- Standard cumulative-volume VWAP, **reset at UTC midnight**. *(Stage 0)* The
  bias request starts at **00:01 UTC**, so the 00:00 bar is never in it; volume
  is Capital.com `lastTradedVolume` (broker tick activity, not exchange
  volume); for the indices the anchor is 19:00/20:00 New York — the overnight
  CFD session, not the cash open. Day-reset test:
  (`startOfDay(candle.openTime)` — a host-timezone caveat identical to
  `smart-money-ict.md` §2's: correct on a UTC host, can slip a day elsewhere).
- The bands are **not** a fixed-lookback Bollinger-style width. At each bar,
  the standard deviation is computed over an **expanding window of
  price-minus-VWAP deviations since the day's reset**, sized to
  `differenceInMinutes(candle, dayStart)` — for 1-minute bars this is
  effectively "every deviation observed so far today." `vwapTop`/`vwapBottom`
  = `vwap ± that stdev`. The band therefore starts at zero width at the open
  and widens through the session as more deviations accumulate; it is not
  comparable bar-to-bar the way a fixed 20-bar Bollinger band is.
  *(Stage 0)* Precisely: the **population** stdev (÷N) of `close − VWAP`, where
  each bar's deviation is taken against the VWAP *as it stood at that bar*.

## 2. Bias — a same-timeframe, session VWAP fade (not H1 despite the method name)

Source: `vwap-strategy.ts:268` (`getHighTimeFrameBias`).

- Despite its name, this method fetches **M1** candles (not H1) from **UTC
  midnight** to the current bar, and runs `VWAP()` over exactly that window —
  i.e. it recomputes the same-session VWAP band described in §1, at M1
  resolution, purely to read a bias off it.
- *(Stage 0)* `lastPrice` is the evaluated bar's **open** (`lastCandle.open`),
  compared against the band computed through that bar's close.
- **Contrarian bias:** `lastPrice > vwapTop` → bias **sell** (price has
  stretched above the upper band — fade it); `lastPrice < vwapBottom` → bias
  **buy**. Inside the bands, no bias is set and the strategy returns no
  signal for that bar (`vwap-strategy.ts:83-88`).
- **Regime filter, applied downstream in `processCharts`:**
  `vwapAtrRatio = (vwapTop − vwapBottom) / ATR(20)` must be in **[2.5, 11.5]**
  — identical on all four instruments
  (`strategy-provider.ts:27-29,40-42,63-65,86-88`). This gates on band
  *width* relative to volatility, independent of the bias direction.

## 3. Entry trigger — proximal-edge iFVG, computed on M1 directly

Source: `vwap-strategy.ts:308-333` (`processCandles`), `fvg.indicator.ts`.

- Uses `calculateFVG`, the **same algorithm** pinned in `smart-money-ict.md`
  §1 (3-candle FVG with the extra body condition, §1.1; inversion through the
  gap's **proximal** edge, §1.2 — not the far-edge definition in
  `session-liquidity.md` §5.1).
- Unlike the smart-money bot (which runs this function on a separate **H1**
  fetch for bias only), this strategy runs it **directly on the M1 window
  it is already evaluating**, and reads `bearishIfvgOccurs`/
  `bullishIfvgOccurs` as the entry trigger itself.
- **Corrected (Stage 0, PARITY.md D-03).** The earlier text here — "`lastIFVG`
  is `undefined` whenever either iFVG list is empty, so entries require both
  lists non-empty" — is **wrong**, and so is the same sentence in
  `smart-money-ict.md` §1.3. `getLastIfvg` is asymmetric: with the **bullish**
  list (bearish FVGs closed back up through their proximal edge) empty it
  returns `bearish[-1]` → `undefined` and the ATR gate blocks; with the
  **bearish** list empty it returns `bullish[bullish.length − 1]`, a valid
  element, and the gate evaluates normally. Entries therefore require the
  **bullish** iFVG list to be non-empty — for sells as well as buys. Verified
  against the bot's own `calculateFVG` on a constructed tape
  (`research/cmc-bot-vwap/ts_parity/unit_last_ifvg.ts`). Measured effect on
  this strategy: 1 order in 2,322.

## 4. The ATR-ratio gate on iFVG size

Source: `vwap-strategy.ts:232-249` (`isIFVGtoATRRatioAllowed`).

Identical shape to `smart-money-ict.md` §4.4: `ATR(20) / |lastIFVG.high −
lastIFVG.low| < MAX_IFVG_TO_ATR_RATIO` (= **8**, same constant value, same
instrument-independent threshold). Same consequence: this is `ATR ÷ gap
size`, so it rejects **small** gaps, and inherits the `lastIFVG`-undefined
blocking behaviour from §3 above.

## 5. Premium / discount — a different definition than the smart-money bot's

Source: `cmc-bot-main/src/indicator/tools/range.indicator.ts`.

- `range(candles, 200)`: a **plain rolling 200-bar high/low window**,
  recomputed fresh at every bar by sliding the window (no swing detection, no
  trailing/anchored state). `top`/`bottom` are simply
  `max(high)`/`min(low)` over the trailing 200 bars. *(Stage 0)* The slide
  records the window **before** appending the current bar, so the 200 bars
  are the ones **preceding** the evaluated bar; the evaluated bar's own
  high/low is not in its range.
- `priceInDiscount ≡ close[last] < (top + bottom) / 2` — same polarity
  convention as `smart-money-ict.md` §3 (below midpoint = discount), but a
  **structurally different range**: `smart-money-ict.md` §3's `rangeHigh`/
  `rangeLow` is a 60-bar-swing-seeded value that **trails** with new highs/
  lows and only resets on a fresh swing confirmation; this one has no memory
  beyond the current 200-bar slide. Do not treat these as the same
  computation despite the identical variable name and identical downstream
  role (stop anchor, §7).
- No stated warm-up requirement beyond needing ≥200 prior bars for the first
  value — unlike `smart-money-ict.md` §3's documented ≥201-bar hard warm-up
  floor tied to its `Swings` detector, this range simply has no output before
  200 bars, which is a much softer constraint.

## 6. The sweep condition — the strategy's only level-sweep-shaped component

Source: `vwap-strategy.ts:335-357`, `cmc-bot-main/src/indicator/tools/previous-hour-lh.indicator.ts`.

- `previousHourLH` scans candles falling within the **previous clock hour**
  (`[targetHour:00, targetHour:59]` relative to the latest candle's hour) and
  returns that hour's high/low.
- `abovePrevHourHigh`: true if the **max high of the last 6 bars** (current
  bar plus the 5 preceding) exceeds the previous hour's high.
  `belowPrevHourLow` is the mirror on lows.
- **This is the strategy's only sweep-shaped gate**, and its reference level
  is neither a session extreme (`session-liquidity.md`) nor a true-open level
  (`smart-money-ict.md` §2) — it is the **immediately preceding clock hour's**
  high/low, a much shorter-horizon and more local reference than either.
- Composition: sell requires **breaking above** the prior hour's high (a
  local upside sweep) **and** a bearish iFVG (reversal) **and** VWAP-band
  bias = sell (price already stretched above the day's VWAP band) **and**
  premium-side (not in discount, §5). Buy is the full mirror. Read together:
  *a local upside sweep of the prior hour's high, reversing via iFVG, while
  the bar is already in a VWAP-stretched, premium-side, sell-biased regime.*

## 7. Risk — same shared `RiskManager`, different target

Source: `cmc-bot-main/src/strategy/risk-manager.ts` (the **same class** the
smart-money bot uses — see `smart-money-ict.md` §4.5/§4.7 for the identical
mechanics, reproduced here for this file's completeness):

- **Stop anchor:** `range(v,200)`'s bottom for a buy, top for a sell (§5
  above — note this is the *different* range definition, not §3's swing
  range).
- **Shrink table**, keyed on `rangeSize / stopSize`: `<2.5` → ×0.5; `2.5–3` →
  ×0.7; else ×1 (identical thresholds to the smart-money bot).
- **Target: fixed 3.0R** (`TARGET_RISK_REWARD_RATIO = 3`,
  `vwap-strategy.ts:28`) — **differs** from the smart-money bot's 2.7R.
- **Trail:** unrealised profit `>1R` → stop to breakeven; `>2R` → stop to
  `+1R`. Identical to the smart-money bot.
- **Daily/position caps:** max 2 losing / 1 winning closed order per day; at
  most 1 open order per direction. Identical to the smart-money bot — same
  `RiskManager` instance shape, same constants.

## 8. Session gates and per-instrument differences

Source: `vwap-strategy.ts:41-75`, `strategy-provider.ts`.

- `isValidTimeForNewOrders` (entry window) and `canOrdersBeAlive` (force-close
  window) are **independently configurable per instance** via
  `hyperParameters.timings`/`orderAliveTimings` — unlike the smart-money bot,
  where both predicates share one identical window.
- **US100 (`nasdaq`) and US500 (`snp`)** both read their windows in
  production from `config.FOREX_TIMINGS`/`config.FOREX_ORDER_ALIVE_TIMINGS`
  (`strategy-provider.ts:25-26,38-39`) — an **external S3 object**
  (`ConfigClient.getObject('telegram-bot-config', 'dynamic_config.json')`,
  not committed to this repo and not read for this pass (user declined AWS
  access). **For this research pass, the user specified these values
  directly instead**, as a provisional first cut to be revisited after
  testing — entry **09:40–11:40 NY**, alive **09:40–14:30 NY**, both
  instruments. Treat these as this pass's pinned parameters, not as a
  verified reading of the bot's actual live S3 config.
- **EURCHF and GBPCHF** have hardcoded, asset-specific, narrow windows
  (`strategy-provider.ts:51-62,74-85`), interpreted as **America/New_York**
  wall-clock hours regardless of the pair traded (`vwap-strategy.ts:43,61`):
  - EURCHF: entry **03:02–03:20 NY**, alive **03:00–04:00 NY**.
  - GBPCHF: entry **03:03–03:20 NY**, alive **03:00–05:00 NY**.
  These are 17–18-minute entry windows around a roughly 1–2 hour alive
  window — narrow enough that a reproduction must not assume they generalize
  from one pair to the other, or from the forex pairs to the (unknown) index
  windows.
- **MIN/MAX_VWAP_ATR_RATIO and MAX_IFVG_TO_ATR_RATIO are identical across all
  four instruments** (§2, §4) — only the timing windows vary per asset.

## 9. Computed but unused

`priceAtTime(v, 9, 0)` (`opening`, `vwap-strategy.ts:323-324`) is computed
every evaluation and never read by any signal condition — the same
"computed but unused" pattern flagged for the smart-money bot's PDH/PDL/BoS
machinery (`smart-money-ict.md` §5). Do not port it, and do not read its
presence as evidence this strategy uses an opening-price reference.

## 10. Timestamps, data and the live bot (Stage 0)

Source: `research/cmc-bot-vwap/PARITY.md` D-01, D-18, §4.

- **The bot's candle times are not UTC.** `mapMarketDataToChartData` uses
  Capital.com's `snapshotTime` — broker-local wall-clock time, UTC+2 (EU
  winter) / UTC+3 (EU summer), no offset suffix — which `Date.parse` reads as
  UTC on a UTC host; the payload's `snapshotTimeUTC` is discarded. Request
  `from`/`to` *are* UTC. Live, the clock gates use `Date.now()` so the right
  bars are traded, only mislabelled. The bot's **own backtest on
  `npm run scrap` files** gates on the labels and so evaluates bars 2–3 h
  earlier than it claims (indices ≈ 06:xx–09:xx NY; forex ≈ 00:xx–01:xx NY);
  it shares essentially no orders with the live stream. Research uses
  `snapshotTimeUTC`.
- **Capital.com 1-minute history starts 2024-01-01** for all four instruments.
- **Live reads one bar earlier than the backtest**: at clock minute T the
  live request returns bars through T−1 (`max: 720` drops the newest; the
  forming minute is not yet served in the first seconds), while the backtest
  reads the bar that opened at T. ~92–98 % of orders coincide.
- `VWAP([])` throws when no bar exists since 00:01 UTC (forex on 25 Dec /
  1 Jan): no signal live (caught), a crash in the bot's backtest CLI.

## 11. Out of scope of this concept file

`cmc-bot-main` also contains the smart-money ICT strategy
(`knowledge/smart-money-ict.md`), a `tech-analysis`/RSI strategy, a
`correlation-analyzer`, a Telegram control/notification bot, and AWS/OTel
deployment plumbing. None of those are covered here.
