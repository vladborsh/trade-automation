# insight-bot historical backfill — coverage

Generated 2026-09-28T20:10:58.861Z by `npm run backfill` (IB-012, design §5).

`missing` is a hole worth chasing. `unavailable` is a month the venue never served —
the Binance 5-minute metrics archive starts 2020-09 for BTCUSDT and 2021-12 for every
other symbol, and OKX funding REST serves only about the last 97 days. Neither is a gap,
and the daily gap report must not count them as one.

| Symbol | Series | Rows | First row | Last row | Missing | Unavailable |
|---|---|---|---:|---|---|---|
| BTCUSDT | 1m candles (perp) | 83663 | 2026-08-01T00:00:00.000Z | 2026-09-28T20:10:00.000Z | — | — |
| BTCUSDT | 1m candles (spot) | 83662 | 2026-08-01T00:00:00.000Z | 2026-09-28T20:10:00.000Z | — | — |
| BTCUSDT | funding (Binance) | 177 | 2026-08-01T00:00:00.001Z | 2026-09-28T16:00:00.001Z | — | — |
| BTCUSDT | open interest 5m | 8654 | 2026-08-29T17:55:00.000Z | 2026-09-28T20:00:00.000Z | — | — |
| BTCUSDT | long/short 5m | 34598 | 2026-08-29T17:55:00.000Z | 2026-09-28T20:00:00.000Z | — | — |
| BTCUSDT | funding (Bybit) | 7135 | 2020-03-25T16:00:00.000Z | 2026-09-28T16:00:00.000Z | — | — |
| BTC-USDT-SWAP | funding (OKX) | 296 | 2026-06-22T08:00:00.000Z | 2026-09-28T16:00:00.000Z | — | — |

**Every series is complete inside the window each venue serves.**
