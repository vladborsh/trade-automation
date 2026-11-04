-- IB-115 undo: the research tables go with the feature; the journal loses its build column.
drop table if exists oi_divergence_paths;
drop table if exists oi_divergence_near_misses;
drop table if exists oi_divergence_controls;
alter table oi_divergence_alerts drop constraint if exists oi_divergence_alerts_build;
alter table oi_divergence_alerts drop column if exists build;
