# PARITY — crypto extension (BTCUSDT, ETHUSDT; conditions `win` and `all`)

## What this parity claim is, and is not

- **Is:** the Python port produces exactly what the bot's own TypeScript
  (`VWapStrategy`, `StrategyTemplate`, `RiskManager`, `Order`, `StaticDataSource`,
  all indicators — unmodified, run in `BacktestRunner`'s bar loop) produces on
  the same Binance tape, bar for bar, over the **entire** 2022-08-01 → 2026-09-11
  period, in both clock conditions, for both symbols.
- **Is not:** a comparison with anything the bot ever did. `StrategyProvider`
  never built `VWapStrategy` for BTC/ETH; there is no live or shipped history
  for this combination. Nothing here says a crypto deployment of the bot would
  have produced these orders. Such a deployment would also go through
  `BinanceClient`, whose request/forming-candle behaviour was not examined.
- **Harness deviations, both declared:** in condition `win` the US100/US500
  `timings`/`orderAliveTimings` objects are passed for BTC/ETH (configuration,
  not code). In condition `all` a four-line subclass overrides
  `isValidTimeForNewOrders` and `canOrdersBeAlive` to return `true`
  (`ts_parity/dump_vwap.ts`, `VWapStrategyAlways`); every other line is the bot's.

## Result

| symbol | condition | chunks | evaluated bars | bit-identical | TS orders | Python orders | exception bars (identical) | discrepancies |
|---|---|---|---|---|---|---|---|---|
| BTCUSDT | win | 50 months | 131,648 | 131,648 | 1,309 | 1,309 | 0 | **0** |
| BTCUSDT | all | 215 (~7-day) | 2,164,320 | 2,164,320 | 2,845 | 2,845 | 1,503 | **0** |
| ETHUSDT | win | 50 months | 131,648 | 131,648 | 1,145 | 1,145 | 0 | **0** |
| ETHUSDT | all | 215 (~7-day) | 2,164,320 | 2,164,320 | 2,859 | 2,859 | 1,503 | **0** |

**4,591,936 evaluated bars, every intermediate value bit-identical; 8,158
orders identical in every lifecycle field; 0 discrepancies.** The comparison
layers are the ones described in `PARITY.md` §1.1 (every component on every
evaluated bar + every order's full lifecycle), on sha256-fingerprinted
byte-identical tape. Evidence: `results/parity_<SYM>_<win|all>.csv/.log`.

The 1,503 exception bars per 24/7 run are the 00:00 UTC bar of every day. The
bias window starts at 00:01 UTC, so at 00:00 it is empty and `VWAP([])` throws
(PARITY.md D-18); the TypeScript and the port agree on every one.

## Chunking — why it is exact

- `win`: calendar months. Every order is force-closed after 14:30 NY each day,
  so no state crosses a UTC midnight (asserted, `CHECKS_CRYPTO.md` C2).
- `all`: nothing is ever force-closed, so orders can live for days.
  `crypto/chunks.py` cuts only at UTC midnights where the continuous Python run
  has no order open (and hence nothing earlier that day to count toward the
  daily caps). This does not assume the conclusion. Each TypeScript chunk
  starts with empty state, and `parity.py` requires both sides to end each
  chunk with the same number of open orders, so a boundary where the bot would
  really have held a position would show up as a discrepancy. None did. And
  the chunked TypeScript totals equal the **continuous** Python run's totals
  exactly (2,845 / 2,859), which is only possible if every cut was exact.

## Prefix-causality and invariants

`CHECKS_CRYPTO.md`: C1 **600/600** (100 orders + 50 non-signal bars per
symbol × condition, tape truncated at the bar, re-run from that day's
midnight for `win` or the chunk start for `all`), C2 invariants all pass, C3
parity all pass.

## Two checker bugs found and fixed during this pass (recorded, not hidden)

1. `checks.py`/`checks_crypto.py` C1 compared per-bar order frames with
   `DataFrame.equals`, which reports two *empty* frames with different dtypes
   (int64 vs object) as different. On the first crypto run that flagged 61
   non-signal bars as "order" mismatches, all with zero component differences.
   Replaced by a dtype-insensitive comparison. The Capital.com C1 re-run still
   gives 600/600.
2. `parity.py` overwrote `results/parity_<SYM>.csv` instead of merging when a
   single chunk was re-run. Fixed; the US100 record was regenerated from the
   TypeScript events on disk (33/33 months, 0 problems).

The engine refactor for this extension (`timing` argument, column-wise
evaluated-bar storage, open-order and daily-close bookkeeping) was re-proven
against the full Capital.com battery: 132/132 months, 0 problems, the
committed order logs reproduced exactly.
