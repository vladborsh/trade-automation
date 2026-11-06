-- IB-126 undo: the level rows go (their paths cascade), then the state, the recipients column and the settings row.
delete from market_alert_controls where type = 'level';
delete from market_alerts where type = 'level';
drop table alert_level_state;
alter table users drop column level_alerts;
delete from alert_type_settings where type = 'level';
