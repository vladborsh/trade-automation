-- IB-BUG-018 — repair: delete the Binance liquidation rows whose `notional` was never USD.
--
-- `!forceOrder@arr` also carries contracts the mapper priced as `price × qty` although that is not
-- USD for them (measured on insight_coord 2026-11-02/03):
--   * COIN-M (inverse) perpetuals and quarterlies, `<BASE>USD_PERP` / `<BASE>USD_<YYMMDD>`: `qty`
--     counts USD contracts (100 USD for BTC, 10 USD for most), so the stored notional was ~price/100
--     to ~price/10 times too high — 22 BTCUSD_PERP rows were 61 % of a day's total;
--   * BTC/ETH/BNB-quoted contracts (`ETHBTC`): `price × qty` is in the quote coin, not USD.
-- The collector now skips these at ingest (counted on ib_liquidations_skipped_total).
--
-- NOT deleted, because they were priced correctly (`qty` in base coin, quote ≈ USD): USDT quarterlies
-- (`BTCUSDT_261225`) and stablecoin-margined linear contracts (`…USDC`, `BTCUSD1`, `BTCU`). The
-- ingest rule skips those too from now on (USDT-M only); their history is kept as true.
--
-- OKX and Bybit: no rows of this class exist — OKX liquidations are filtered to the universe's
-- `-USDT-SWAP` instruments before sizing, and Bybit subscribes only universe symbols on the linear
-- endpoint. Nothing to delete there.
--
-- Runs once on every database on boot (box `insight`, insight_coord, the slots).
delete from liquidations
 where venue = 'binance'
   and (symbol ~ '^[A-Z0-9]+USD_(PERP|[0-9]{6})$'
     or symbol ~ '^[A-Z0-9]+(BTC|ETH|BNB)$');
