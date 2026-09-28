-- Dropping a partitioned parent drops its partitions with it.
drop table if exists collector_gaps;
drop table if exists calendar_events;
drop table if exists liquidations;
drop table if exists long_short_5m;
drop table if exists open_interest_5m;
drop table if exists funding_settlements;
drop table if exists mark_funding_1m;
drop table if exists candles_agg;
drop table if exists candles_1m;
