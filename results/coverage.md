# insight-bot historical backfill — coverage

Generated 2026-09-28T17:50:55.463Z by `npm run backfill` (IB-012, design §5).

`missing` is a hole worth chasing. `unavailable` is a month the venue never served —
the Binance 5-minute metrics archive starts 2020-09 for BTCUSDT and 2021-12 for every
other symbol, and OKX funding REST serves only about the last 97 days. Neither is a gap,
and the daily gap report must not count them as one.

| Symbol | Series | Rows | First row | Last row | Missing | Unavailable |
|---|---|---|---:|---|---|---|
| BTCUSDT | 1m candles (perp) | 3501710 | 2020-01-01T00:00:00.000Z | 2026-09-28T17:49:00.000Z | — | — |
| BTCUSDT | 1m candles (spot) | 3499385 | 2020-01-01T00:00:00.000Z | 2026-09-28T17:49:00.000Z | — | — |
| BTCUSDT | funding (Binance) | 7296 | 2020-01-01T00:00:00.000Z | 2026-09-28T16:00:00.001Z | — | — |
| BTCUSDT | open interest 5m | 629222 | 2020-09-01T00:00:00.000Z | 2026-09-27T23:55:00.000Z | — | 2020-01..2020-08 |
| BTCUSDT | long/short 5m | 2289402 | 2020-09-01T00:00:00.000Z | 2026-09-27T23:55:00.000Z | — | 2020-01..2020-08 |
| BTCUSDT | funding (Bybit) | 7135 | 2020-03-25T16:00:00.000Z | 2026-09-28T16:00:00.000Z | — | 2020-01..2020-02 |
| BTC-USDT-SWAP | funding (OKX) | 291 | 2026-06-24T00:00:00.000Z | 2026-09-28T16:00:00.000Z | — | 2020-01..2026-05 |
| ETHUSDT | 1m candles (perp) | 3546351 | 2020-01-01T00:00:00.000Z | 2026-09-28T17:50:00.000Z | — | — |
| ETHUSDT | 1m candles (spot) | 3544025 | 2020-01-01T00:00:00.000Z | 2026-09-28T17:50:00.000Z | — | — |
| ETHUSDT | funding (Binance) | 7389 | 2020-01-01T00:00:00.000Z | 2026-09-28T16:00:00.001Z | — | — |
| ETHUSDT | open interest 5m | 507316 | 2021-12-01T00:00:00.000Z | 2026-09-27T23:55:00.000Z | — | 2020-01..2021-11 |
| ETHUSDT | long/short 5m | 1801828 | 2021-12-01T00:00:00.000Z | 2026-09-27T23:55:00.000Z | — | 2020-01..2021-11 |
| ETHUSDT | funding (Bybit) | 6506 | 2020-10-21T08:00:00.000Z | 2026-09-28T16:00:00.000Z | — | 2020-01..2020-09 |
| ETH-USDT-SWAP | funding (OKX) | 291 | 2026-06-24T00:00:00.000Z | 2026-09-28T16:00:00.000Z | — | 2020-01..2026-05 |
| SOLUSDT | 1m candles (perp) | 3168651 | 2020-09-14T07:00:00.000Z | 2026-09-28T17:50:00.000Z | — | — |
| SOLUSDT | 1m candles (spot) | 3193566 | 2020-09-01T00:00:00.000Z | 2026-09-28T17:50:00.000Z | — | — |
| SOLUSDT | funding (Binance) | 6694 | 2020-09-13T16:00:00.004Z | 2026-09-28T16:00:00.001Z | — | — |
| SOLUSDT | open interest 5m | 507298 | 2021-12-01T00:00:00.000Z | 2026-09-27T23:55:00.000Z | — | 2020-09..2021-11 |
| SOLUSDT | long/short 5m | 1801754 | 2021-12-01T00:00:00.000Z | 2026-09-27T23:55:00.000Z | — | 2020-09..2021-11 |
| SOLUSDT | funding (Bybit) | 6113 | 2021-06-29T08:00:00.000Z | 2026-09-28T16:00:00.000Z | — | 2020-09..2021-05 |
| SOL-USDT-SWAP | funding (OKX) | 291 | 2026-06-24T00:00:00.000Z | 2026-09-28T16:00:00.000Z | — | 2020-09..2026-05 |

**Every series is complete inside the window each venue serves.**
