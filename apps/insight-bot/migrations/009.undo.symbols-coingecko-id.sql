-- Reverses 009. The column is additive and nullable, so nothing else depends on it.
alter table symbols drop column if exists coingecko_id;
