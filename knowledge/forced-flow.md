# Forced flow: liquidations, predicted funding, spot-vs-perp CVD

Canonical definitions for the observables the crypto insight bot collects and
the playbooks it evaluates (`architecture/insight-bot-system-design.md`).
Reference, not a log. Status of each concept as evidence: the squeeze family
is closed in its simple forms (`derivatives-positioning.md` §4,
`research/funding-rate-signals/REPORT.md`); the full-form squeeze is under a
pre-registered pass (`research/squeeze-full-form/`); **the spot-vs-perp label
was tested and killed 2026-09-28** (§3, `research/spot-lead/REPORT.md`); liquidation-feed
signals have never been researched because the data did not exist before
2026-09-28.

## 1. Liquidation feeds

A **liquidation** is the venue's risk engine closing a position whose margin
fell below maintenance: a market order the trader did not choose. The side we
record is the side **being liquidated**: a Binance `forceOrder` with `S=SELL`
is a *long* being liquidated. Feeds: Binance USD-M `!forceOrder@arr` (WS),
Bybit v5 `allLiquidation.<symbol>`, OKX `liquidation-orders` (SWAP).

**Known measurement limits.** Binance emits **at most one event per second per
symbol** (the venue's documented snapshot rule), so the feed *undercounts*
during cascades — exactly when it matters. Consequences adopted: liquidation
features are relative to the symbol's **own** trailing 30-day history
(log1p z-score of 60-minute sums), never absolute dollar thresholds; venues are
not summed in v1 features. **No history exists** for any venue's liquidation
feed; collection started 2026-09-28 and every day before that is
unrecoverable.

A **cascade** (P3's input) is a 60-minute window whose liquidated-long notional
is ≥ 3 standard deviations above the symbol's 30-day norm, together with a
≥ 8 % 4-hour OI drop (BTC; 12 % alts) and a ≥ 2.5·ATR(1h) drawdown from the
24 h high. The claim behind P3 — that after forced selling ends the seller is
gone — is plausible and untested; the draft's own caveat stands: a cascade
caused by a tier-1 news event is the middle of a move, not its end, so a news
veto is mandatory once the news pipeline exists.

## 2. Funding: settled, predicted, and the multi-venue count

**Settled funding** is exchanged every 8 h (Binance 00/08/16 UTC; Bybit and
OKX on their own grids, some symbols at 4 h or 1 h) between longs and shorts at
the rate fixed at the settlement instant; positive = longs pay. Its history is
free (`data.binance.vision` `fundingRate`, verified 0 missing slots on 8
symbols; Bybit/OKX via REST as far as they serve — depth measured at build).

**Predicted funding** (Binance `markPrice` stream field `r`, Bybit `tickers.
fundingRate`, OKX `funding-rate`) is the venue's running estimate of the
*next* settlement from the current premium index. It is what a trader sees
while deciding; it is **not archived anywhere** and is recorded once per minute
plus at the settlement second from 2026-09-28.

**Extreme funding** (project convention since the funding family): percentile
≥ 0.90 among the last 90 settlements *and* rate ≥ +0.03 %/8 h (mirror for
negative). The **venue count** — on how many of Binance/Bybit/OKX the state is
extreme at once — is the insight bot's crowding-consensus observable (P1/P2
require ≥ 2). Why it might not help: cross-venue funding is highly correlated
by arbitrage, so the count may add little beyond Binance alone; the full-form
pass reports the Binance-only ablation for exactly this reason.

## 3. CVD from taker-buy volume, spot vs perp

Every Binance kline (spot and USD-M) carries **taker buy base volume**: the
part of the bar's volume where the aggressor was a buyer. **Delta** per bar =
`2·takerBuy − volume`; **CVD** over a window = the sum of deltas. It is exact
(no trade-classification heuristic), free, and available at 1m from listing.

The bot computes CVD on **spot** and **perp** separately and labels a 4 h move
(design §9.2): `SPOT_LED` (advance with positive spot CVD), `PERP_LED`
(advance carried by perp CVD while spot is flat/negative), `ABSORPTION`
(decline with positive spot CVD), `DISTRIBUTION` (flat price, spot selling,
perp buying). Hypothesis: spot-led moves are organic demand and persist;
perp-led moves are leverage and unwind. Caveats recorded in the draft and kept:
Binance spot is not all spot (Coinbase, ETFs, OTC are invisible), the window
length changes the answer (fixed at 4 h; not tuned), and market-makers'
maker/taker switching adds noise. Whether the label predicts anything is the
`research/spot-lead/` question; until it answers, the label is context and
score decoration only.

**Tested 2026-09-28 — no information beyond price** (`research/spot-lead/`,
Запись 36; 8 Binance perps, 2020-01 .. 2025-07, 1m spot and perp taker
volume). `SPOT_LED` is the ordinary advance (69 % of all 4 h advances), lasts
one bar (mean run 1.3), and its 1–5 day follow-through equals `PERP_LED`'s
(5-day drift +0.650 vs +0.648 ATR). As a +1R/5-day long the two differ by
+0.005R [−0.041, +0.051]; as a filter on "buy every advance" it changes the
mean by +0.0001R; the absorption long (−0.060R) is beaten by its price shadow.
Consequence: the bot shows the label, gives it **weight 0**, and gates nothing
on it. A future spot/perp flow idea needs a different observable (size, other
venues, Coinbase premium) — the sign of Binance spot CVD over 4 h is spent.

## 4. Open interest and long/short ratios (pointer)

Definitions, the 30-day retention of the REST endpoints, the ~4-year daily
`metrics` archive, and the redundancy-control methodology are in
`derivatives-positioning.md`. The insight bot stores OI and all four ratio
kinds (`top_position`, `top_account`, `global_account`, `taker`) at 5 m
forward and from the archive.
