-- IB-116 — who wrote a research row: the live loop, or the one-off history backfill
-- (architecture/oi-divergence-design-2026-11-04.md §9, V30–V33).
--
-- `source` goes on the journal, the controls and the near-misses. Paths carry no column: they inherit
-- it from their subject. Every row that exists now was written by the live loop, so the column is added
-- with default 'live' and the default is then DROPPED: a writer that does not say which it is fails at
-- once instead of passing for live.

alter table oi_divergence_alerts add column source text not null default 'live' check (source in ('live', 'backfill'));
alter table oi_divergence_alerts alter column source drop default;
alter table oi_divergence_controls add column source text not null default 'live' check (source in ('live', 'backfill'));
alter table oi_divergence_controls alter column source drop default;
alter table oi_divergence_near_misses add column source text not null default 'live' check (source in ('live', 'backfill'));
alter table oi_divergence_near_misses alter column source drop default;

-- V30: the once-keys include `source`. A rerun of the backfill writes nothing twice, and a backfill row
-- never collides with (or is absorbed by) a live one.
alter table oi_divergence_alerts drop constraint oi_divergence_alerts_once;
alter table oi_divergence_alerts add constraint oi_divergence_alerts_once unique (source, symbol, tf, direction, a_time, b_time);
alter table oi_divergence_controls drop constraint oi_divergence_controls_once;
alter table oi_divergence_controls add constraint oi_divergence_controls_once unique nulls not distinct (source, symbol, tf, kind, direction, bar_time);
alter table oi_divergence_near_misses drop constraint oi_divergence_near_misses_once;
alter table oi_divergence_near_misses add constraint oi_divergence_near_misses_once unique (source, symbol, tf, direction, b_time);

-- V30: a backfilled alert was never sent and is never late. The database refuses one that claims otherwise.
alter table oi_divergence_alerts add constraint oi_divergence_alerts_backfill_unsent
  check (source <> 'backfill' or (fired_at is null and recipients = 0 and not late));

-- V32: the in-sample rule, where a person writing SQL against these tables meets it.
comment on column oi_divergence_alerts.source is
  'live = the alert loop as it ran; backfill = the one-off run over stored history (IB-116), never sent, never late. '
  'Round-2 params were tuned on exactly the backfilled month: backfill rows are IN-SAMPLE. Any statistic reports '
  'live and backfill SEPARATELY and never pools them into one hit rate (design V32).';
comment on column oi_divergence_controls.source is
  'live | backfill (IB-116). Backfill rows are IN-SAMPLE (round-2 params were tuned on that month): report them '
  'separately from live, never pooled (design V32).';
comment on column oi_divergence_near_misses.source is
  'live | backfill (IB-116). Backfill rows are IN-SAMPLE (round-2 params were tuned on that month): report them '
  'separately from live, never pooled (design V32).';
