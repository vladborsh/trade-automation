-- IB-130 (architecture/market-round2-design-2026-11-05.md §7, owner request 2026-11-05) — BTC and ETH
-- dominance (each coin's share of the total crypto market cap, in PERCENT, 0..100), recorded next to the
-- cap from the SAME CoinGecko /global payload (`data.market_cap_percentage.btc` / `.eth`): same key, same
-- fetch, same writer (MarketCapRecorderService), same retention (none). CoinGecko +0 calls, Binance +0.
--
-- Each column is nullable and independent: a payload with a valid total but no ETH share still writes the
-- cap and BTC. Rows written before 030 stay null — no source can give them back, so nothing is backfilled.
-- No default, so the alter is metadata-only (no table rewrite).
--
-- Size: 2 × 8 B per row × ≤ 52 560 rows a year ≈ 0.84 MB a year (arithmetic).
--
-- 029 is applied on the box and frozen by its MD5: never edit it; this is a new version.
alter table market_cap_total
  add column btc_pct double precision null check (btc_pct between 0 and 100),
  add column eth_pct double precision null check (eth_pct between 0 and 100);

comment on column market_cap_total.btc_pct is
  'IB-130: BTC share of the total crypto market cap, percent (CoinGecko /global market_cap_percentage.btc); null before 030 or when absent/invalid.';
comment on column market_cap_total.eth_pct is
  'IB-130: ETH share of the total crypto market cap, percent (CoinGecko /global market_cap_percentage.eth); null before 030 or when absent/invalid.';
