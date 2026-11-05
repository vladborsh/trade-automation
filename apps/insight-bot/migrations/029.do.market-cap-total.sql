-- IB-118 (architecture/market-round2-design-2026-11-05.md §2, owner ruling 2026-11-05 «записываем сами»)
-- — the total crypto market cap, recorded by us, because keyless CoinGecko has no 7-day history of it
-- (`/global/market_cap_chart` is paid; a sum of per-coin `market_chart` is a different number).
--
-- One row per CoinGecko refresh: `ts` is CoinGecko's own `updated_at`, so two polls of the same refresh
-- collapse onto one row. The writer (MarketCapRecorderService) polls every 10 min, independent of viewers.
-- Not partitioned, no retention: ≈ 52 560 rows a year at ≈ 60 B ≈ 3 MB a year (arithmetic). Revisit
-- only if it ever passes 50 MB.
--
-- NOT `market_cap_global` (dropped in 024): that held dominance under a different key; a new name keeps
-- 024's history readable.
create table market_cap_total (
  ts timestamptz primary key,
  total_usd numeric not null check (total_usd > 0),
  fetched_at timestamptz not null
);

comment on table market_cap_total is
  'IB-118: total crypto market cap (CoinGecko /global total_market_cap.usd), one row per CoinGecko updated_at; written every 10 min by the bot; no retention.';
