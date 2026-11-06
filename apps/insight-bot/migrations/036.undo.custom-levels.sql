-- IB-128 undo: the custom levels' journal rows go (their paths cascade), then the table.
delete from market_alerts where type = 'level' and details ->> 'kind' = 'custom';
drop table alert_custom_levels;
