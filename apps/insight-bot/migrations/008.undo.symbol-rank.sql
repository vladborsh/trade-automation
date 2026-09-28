drop index if exists symbols_volume_rank_idx;
-- coingecko_id belongs to IB-036's migration and is dropped by its own undo.
alter table symbols drop column if exists volume_rank;
