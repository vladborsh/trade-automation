-- IB-011, design §6.2 — the daily gap report is the stage-0 exit instrument: the Tester reads
-- fourteen consecutive clean ones. A Telegram message can be scrolled past, edited or lost when a
-- chat is cleared, so every report is also a row: one per UTC day, the whole report as jsonb.
--
-- Unpartitioned on purpose: one row per day is 365 rows a year.

create table if not exists gap_reports (
  day date primary key,
  report jsonb not null,
  clean boolean not null,
  created_at timestamptz not null default now()
);

comment on table gap_reports is
  'One row per UTC day (IB-011, design §6.2). `clean` is the stage-0 criterion for that day: no '
  'missing 1m bars on any symbol or market, no missing 5m OI/LS slots, and no unrepaired '
  'mark/liquidation silence longer than WATCHDOG_SILENCE_MIN. Fourteen consecutive true values '
  'are what the cluster is accepted on.';

comment on column gap_reports.report is
  'The full report object the builder produced, so a later reader can see WHY a day was not clean '
  'without re-deriving it from data that has since been repaired.';

create index if not exists gap_reports_clean_idx on gap_reports (clean, day desc);
