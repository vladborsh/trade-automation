-- IB-031, design architecture/insight-bot-web-dashboard.md §4 — the dashboard's symbol picker
-- lists "the top 20", which needs a stored order.
--
-- Numbered 008 because IB-036 took 007 and landed first; migration numbers are first-come in
-- this repo. `coingecko_id` is IB-036's column (007), not repeated here — it was in this file
-- until that landed, and one declaration is the point.
--
-- It is a property of the universe file (§2.3, hand-revised monthly), not a measurement: the
-- rank is the 30-day quote-volume rank recorded when the universe was last revised. Storing it
-- rather than computing it keeps the picker's order stable between revisions and identical to
-- what the universe file says.

alter table symbols add column if not exists volume_rank integer;

comment on column symbols.volume_rank is
  '1-based rank by 30-day quote volume at the last universe revision (config/universe.yaml). '
  'Null means unranked — the symbol is still usable, it just does not appear in "top N".';
-- the picker's query: "top N by rank, active only"
create index if not exists symbols_volume_rank_idx on symbols (volume_rank) where active;
