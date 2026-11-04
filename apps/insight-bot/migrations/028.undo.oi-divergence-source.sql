-- IB-116 undo: the backfilled rows go (they cannot be told from live without the column), then the column.
delete from oi_divergence_alerts where source = 'backfill';
delete from oi_divergence_controls where source = 'backfill';
delete from oi_divergence_near_misses where source = 'backfill';

alter table oi_divergence_alerts drop constraint if exists oi_divergence_alerts_backfill_unsent;
alter table oi_divergence_alerts drop constraint oi_divergence_alerts_once;
alter table oi_divergence_alerts add constraint oi_divergence_alerts_once unique (symbol, tf, direction, a_time, b_time);
alter table oi_divergence_controls drop constraint oi_divergence_controls_once;
alter table oi_divergence_controls add constraint oi_divergence_controls_once unique nulls not distinct (symbol, tf, kind, direction, bar_time);
alter table oi_divergence_near_misses drop constraint oi_divergence_near_misses_once;
alter table oi_divergence_near_misses add constraint oi_divergence_near_misses_once unique (symbol, tf, direction, b_time);

alter table oi_divergence_alerts drop column source;
alter table oi_divergence_controls drop column source;
alter table oi_divergence_near_misses drop column source;
