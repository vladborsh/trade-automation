-- architecture/insight-bot-system-design.md §3.3 (corrected), §9.3 and §16.7 — the three columns
-- the ForexFactory logic lifted in IB-010 produces and the §3.3 row omitted, plus the index the
-- §9.3 veto reads through. Purely additive: nothing migration 002 shipped changes, so a database
-- already carrying calendar_events rows keeps every one of them (the new columns are NULL, and
-- `status` takes its default on the existing rows).
--
-- Why each one (§16.7):
--   status        a cancelled event must not fire the veto, and a rescheduled event mints a NEW id
--                 (id = ff:<seriesId>:<scheduledDay>), so the old row has to be marked rather than
--                 left looking live. §9.3 filters positively on 'scheduled'.
--   series_id     the next-occurrence actuals rule is keyed on the series: "when occurrence n+1
--                 appears, its `previous` is the value released at occurrence n".
--   actual_source which of feed / next-previous / provider asserted `actual`, guarding the rule
--                 "never overwrite an actual whose source is feed or provider".

alter table calendar_events
  add column series_id     text,
  add column status        text not null default 'scheduled',
  add column actual_source text;

comment on column calendar_events.status is
  '§9.3, §16.7: scheduled | cancelled | rescheduled. The veto reads status = ''scheduled'' on the '
  'latest revision — an event ForexFactory withdrew is written as a new revision with '
  'status = ''cancelled'' and must not fire EVENT_RISK.';
comment on column calendar_events.series_id is
  '§16.7: the ForexFactory series the event belongs to (the numeric id in its calendar URL), NULL '
  'when the JSON/XML join failed and the row carries a synthetic ffx: id. Keys the '
  'next-occurrence actuals rule.';
comment on column calendar_events.actual_source is
  '§16.7: feed | next-previous | provider — who asserted `actual`. NULL while `actual` is NULL. '
  'A next-previous value may be revised by a later next-previous value; a feed or provider value '
  'is never overwritten.';

-- §9.3's read: impact = 'high', currency = 'USD', event_time within ±60 min, latest revision per
-- id. event_time stays the trailing column so the index also serves a plain window scan for one
-- (impact, currency) pair.
create index calendar_events_impact_currency_time_idx
  on calendar_events (impact, currency, event_time);
