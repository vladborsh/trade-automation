-- IB-058 / IB-062 — the economic calendar becomes a once-a-day fetch with member notifications.
-- One migration for the whole series (IB-058…IB-062), number checked free across every ref on
-- 2026-10-29 before commit.
--
-- calendar_fetch_runs is what "today is already collected" is read from. It cannot be read from
-- calendar_events.fetched_at: the snapshot diff writes nothing when the feed is unchanged, so a
-- quiet day would look uncollected and every restart would fetch again.
--
-- Unpartitioned: one row per UTC day.

create table if not exists calendar_fetch_runs (
  day date primary key,
  fetched_at timestamptz not null,
  events int not null
);

comment on table calendar_fetch_runs is
  'One row per UTC day on which the ForexFactory weekly feed was fetched successfully (IB-058). '
  'The collector fetches only when today has no row, so a restart does not refetch.';
comment on column calendar_fetch_runs.events is
  'Rows in the snapshot that day — not revisions written, which is 0 on an unchanged feed.';

-- IB-062: member notifications (morning digest, reminder before a high-impact USD event).
alter table users add column if not exists calendar_alerts boolean not null default true;

comment on column users.calendar_alerts is
  'Calendar digest and pre-event reminders in the member''s DM; toggled with /calendar.';

create table if not exists calendar_notifications_sent (
  user_id integer not null references users (id),
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

comment on table calendar_notifications_sent is
  'Dedup journal for calendar notifications (IB-062). Keys are digest:YYYY-MM-DD and due:<epoch '
  'ms>. A row is written before the message is sent, so a restart never repeats one — at the cost '
  'that a send that fails after the claim is not retried.';
