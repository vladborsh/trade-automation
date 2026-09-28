-- IB-BUG-005 — `symbols.coingecko_id`, which no migration ever created.
--
-- IB-031 (008) and IB-036 (007) collided over this column. Resolving the collision removed it from
-- 008 on the understanding that 007 declared it; 007 only MENTIONS it, in a comment on
-- `market_cap_coin.coin`. Meanwhile `db/universe-sync.ts` inserts into it on every boot, so the
-- boot-time universe sync failed on every database — fresh or migrated — with
-- `column "coingecko_id" of relation "symbols" does not exist`, and the app did not come up at all.
--
-- It survived CI because the universe-sync spec fakes the database: it asserted that the INSERT
-- names the column, never that a real schema has one. `test/db/universe-sync.integration.spec.ts`
-- is the spec that could not have passed.
--
-- 009 because 008 is taken; numbers are first-come here, and two migrations sharing a version makes
-- postgrator refuse to run at all.

alter table symbols add column if not exists coingecko_id text;

comment on column symbols.coingecko_id is
  'The CoinGecko id for this coin (universe.yaml `coingecko_id`, e.g. ''bitcoin''), used by the '
  'market-cap collector (IB-036, design §10) to fetch per-coin caps. Null for a symbol CoinGecko '
  'does not list — the symbol is still collected everywhere else.';
