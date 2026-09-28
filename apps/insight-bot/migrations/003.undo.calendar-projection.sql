-- Reverses 003.do.calendar-projection.sql. The index goes with the columns; the rows migration
-- 002 shipped are untouched either way.
drop index if exists calendar_events_impact_currency_time_idx;

alter table calendar_events
  drop column if exists actual_source,
  drop column if exists status,
  drop column if exists series_id;
