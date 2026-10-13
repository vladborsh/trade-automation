-- IB-054 — the twin-arm frame pin becomes a TABLE, so its key states the thing it promises.
--
-- Number taken immediately before the merge, per the policy of 2026-10-12. 017 is applied and
-- therefore frozen: postgrator stores an md5 per file and validates it on every boot, so a
-- correction to a shipped migration — including a comment — refuses the whole chain. Anything
-- 017 needs comes here instead.
--
-- ---------------------------------------------------------------------------------------------
-- What a column could not express
--
-- The pin's promise is: **the two arms of one close are judged on the same frame.** It lived as
-- `playbook_evaluations.frame_revision` — a column on a PER-ARM row. So the property spanning
-- arms was enforced by logic rather than by the schema, and nothing could notice it being
-- broken:
--
--   * nothing forced arm A and arm B to carry the same value; and
--   * once evaluations gain revisions, a re-evaluation writes a NEW row that may carry a
--     DIFFERENT frame_revision, silently re-pinning the close and reintroducing exactly the
--     lookahead the pin exists to prevent — inside the mechanism built to prevent it.
--
-- A column cannot say "all rows for this close agree". A table keyed
-- `(playbook, symbol, close_time, source_mode)` says that and nothing else: there is ONE pin per
-- close per mode, structurally, and an arm reads it rather than deciding it. Same move as
-- putting the frame-version claim inside the write primitive rather than beside it (IB-049).
--
-- **Note there is no `arm` column.** Its absence is the entire content of this table.
--
-- ---------------------------------------------------------------------------------------------
-- Why now, and why this is free
--
-- `playbook_evaluations` holds **0 rows** on insight_dev1 and insight_dev2, so the pin moves with
-- no data migration at all. That window closes the moment either slot writes an evaluation — the
-- same argument that made the IB-016 keys and the IB-052 version bump free while frames were
-- empty, and the same argument that expired for frames overnight.
-- ---------------------------------------------------------------------------------------------

create table playbook_frame_pins (
  playbook       text not null,
  symbol         text not null,
  close_time     timestamptz not null,
  source_mode    playbook_source_mode not null,

  -- The frame the FIRST evaluation of this close was judged on, and every later one must be.
  --
  -- Both halves, because a revision alone stopped identifying one frame when v1 and v2 began to
  -- coexist (IB-053). Revision 1 of v1 and revision 1 of v2 are different frames.
  frame_revision int not null,
  frame_version  int not null,

  pinned_at      timestamptz not null default now(),

  primary key (playbook, symbol, close_time, source_mode)
) partition by range (close_time);

comment on table playbook_frame_pins is
  'One frame pin per (playbook, symbol, close, source_mode) — the frame both arms of that close '
  'are judged on. It is a TABLE rather than a column on playbook_evaluations because the promise '
  'spans arms, and a per-arm column cannot express "all rows for this close agree". An arm READS '
  'this; it never decides it.';

comment on column playbook_frame_pins.frame_revision is
  'Settled by CONTENT, not by arrival: the lowest (frame_version, frame_revision) offered wins, '
  'so two racing writers reach the same pin in either order and a replay is reproducible. See '
  'the upsert in playbooks.repo.pinFrame.';
