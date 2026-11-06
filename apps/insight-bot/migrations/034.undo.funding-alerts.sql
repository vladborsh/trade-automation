-- IB-124 undo: the funding rows go (their paths cascade), then the state, the recipients column and the settings row.
delete from market_alert_controls where type = 'funding';
delete from market_alerts where type = 'funding';
drop table alert_funding_state;
alter table users drop column funding_alerts;
delete from alert_type_settings where type = 'funding';
