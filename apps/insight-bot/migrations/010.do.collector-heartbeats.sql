-- IB-BUG-010 — a persisted liveness marker per collector stream, so downtime survives a restart.
--
-- Why a new table rather than more rows in `collector_gaps`: a gap row says "this window was NOT
-- covered", and both `gap_from` and `gap_to` are NOT NULL, so there is no way to write "down since
-- T, still down". The Binance path (`degraded-gaps.ts`) therefore writes its row when the outage
-- ENDS — `gap_to = detected_at` on every existing `binance-perp:forceOrder` row — which means it can
-- only ever record an outage the process lived through. The case this task exists for is the
-- opposite one: the collectors were not running at all through the pause, and a process that is not
-- running writes nothing. The only way to see that from the next start is to have left a mark
-- behind.
--
-- So: a heartbeat is written while a stream is connected, and on startup the distance between the
-- last heartbeat and now is the spell that was not covered. That spell is then written to
-- `collector_gaps` in the ordinary shape, which keeps one place for consumers to read.
--
-- One row per stream, overwritten in place: this is current state, not history. The history is the
-- gap rows.

create table if not exists collector_heartbeats (
  stream        text primary key,
  venue         text        not null,
  market        text,
  -- the first time this stream was ever seen alive. Coverage cannot be claimed before it: absence
  -- of a gap row for 2024 does not mean we were collecting in 2024, it means we did not exist.
  first_seen_at timestamptz not null,
  -- the last time it was seen alive. The gap on the next start runs from here.
  last_seen_at  timestamptz not null
);

comment on table collector_heartbeats is
  'IB-BUG-010: per-stream liveness so a process that was not running still produces a collector_gaps row on its next start.';
comment on column collector_heartbeats.first_seen_at is
  'Earliest known liveness. A coverage figure must not claim covered time before this instant.';
