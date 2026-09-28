drop index if exists symbols_volume_rank_idx;
alter table symbols drop column if exists coingecko_id;
alter table symbols drop column if exists volume_rank;
