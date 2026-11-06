-- IB-151 undo: the muted rows go first (before 037 nothing wrote them; their paths cascade), then the column.
delete from market_alerts where muted_by is not null;
alter table market_alerts drop constraint market_alerts_muted_unsent;
alter table market_alerts drop column muted_by;
