-- IB-031, design architecture/insight-bot-web-dashboard.md §4 — the dashboard's symbol picker
-- lists "the top 20", which needs a stored order, and the market-context page (IB-037) needs a
-- CoinGecko id to join market-cap rows to our symbols.
--
-- Both are properties of the universe file (§2.3, hand-revised monthly), not measurements: the
-- rank is the 30-day quote-volume rank recorded when the universe was last revised. Storing it
-- rather than computing it keeps the picker's order stable between revisions and identical to
-- what the universe file says.

alter table symbols add column if not exists volume_rank integer;
alter table symbols add column if not exists coingecko_id text;

comment on column symbols.volume_rank is
  '1-based rank by 30-day quote volume at the last universe revision (config/universe.yaml). '
  'Null means unranked — the symbol is still usable, it just does not appear in "top N".';
comment on column symbols.coingecko_id is
  'CoinGecko''s own id for the base asset, for joining market-cap and dominance rows (IB-037). '
  'Null where we have no mapping; a null must never be guessed from the ticker.';

-- the picker's query: "top N by rank, active only"
create index if not exists symbols_volume_rank_idx on symbols (volume_rank) where active;
