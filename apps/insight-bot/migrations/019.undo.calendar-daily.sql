-- IB-058 / IB-062 undo. Loses the fetch log (the next boot fetches again) and the dedup journal
-- (a restart inside a reminder window could then repeat one).
drop table if exists calendar_notifications_sent;
alter table users drop column if exists calendar_alerts;
drop table if exists calendar_fetch_runs;
