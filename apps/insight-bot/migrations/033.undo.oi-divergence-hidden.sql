-- IB-144 undo: hidden rows go (they cannot be told from regular without the column; their paths cascade, and a
-- hidden repeat's run_of points only at hidden rows), then the column, the old once-keys and the switch.
delete from oi_divergence_alerts where kind = 'hidden' and run_of is not null;
delete from oi_divergence_alerts where kind = 'hidden';
delete from oi_divergence_near_misses where kind = 'hidden';

alter table oi_divergence_alerts drop constraint oi_divergence_alerts_once;
alter table oi_divergence_alerts add constraint oi_divergence_alerts_once unique (source, symbol, tf, direction, a_time, b_time);
alter table oi_divergence_near_misses drop constraint oi_divergence_near_misses_once;
alter table oi_divergence_near_misses add constraint oi_divergence_near_misses_once unique (source, symbol, tf, direction, b_time);
alter table oi_divergence_alerts drop column kind;
alter table oi_divergence_near_misses drop column kind;

update alert_settings
   set params = jsonb_set(params, '{perTf}', (
         select jsonb_object_agg(e.tf, e.v - 'sendHidden') from jsonb_each(params -> 'perTf') as e(tf, v)))
 where id = 1 and jsonb_typeof(params -> 'perTf') = 'object';
