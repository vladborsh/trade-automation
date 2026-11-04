-- IB-109 undo: the journal and the list go with the feature; nothing else references them.
alter table users drop column if exists oi_alerts;
drop table if exists oi_divergence_skips;
drop table if exists oi_divergence_alerts;
drop table if exists alert_settings;
drop table if exists alert_symbols;
