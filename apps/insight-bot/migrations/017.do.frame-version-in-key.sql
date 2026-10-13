-- IB-053 — `frame_version` joins the keys that identify a frame, and everything that points at one.
--
-- Number taken immediately before the merge, per the policy of 2026-10-12: greater than master's
-- highest AT MERGE TIME, because nobody controls merge order. Allocating at build time burned 013
-- and 014.
--
-- ---------------------------------------------------------------------------------------------
-- What was wrong
--
-- IB-052 bumped WEB_FRAME_VERSION to 2 under a ruling that v1 frames are kept and read
-- version-aware, never recomputed in place. That ruling was unimplementable against this schema:
--
--   feature_frames_pkey  PRIMARY KEY (symbol, tf, close_time, revision)   -- no frame_version
--
-- so a v2 frame for a close that already has a v1 frame **cannot be written at all** — it
-- collides on a key that does not mention the thing that makes it a different frame. The version
-- was a column, which is a fact the row carries, rather than part of its identity, which is what
-- it actually is. A v1 ATR and a v2 ATR for the same close are two measurements, not two attempts
-- at one.
--
-- The same omission repeats in two places that POINT at a frame, and both are fixed here because
-- they are the same defect rather than three:
--
--   feature_value_conflicts (symbol, tf, close_time, revision, feature_key, seen_at)
--   playbook_evaluations    (playbook, symbol, arm, close_time, source_mode) + frame_revision
--
-- ---------------------------------------------------------------------------------------------
-- Why a cross-version difference is NOT a conflict
--
-- `feature_value_conflicts` records a re-check that would have changed an already-published
-- value: evidence that an input moved under us, a defect, rare and worth reading. Comparing a v2
-- recompute against a v1 published value is a different thing entirely — **the definition
-- changed, so a difference is expected.** `atr.4h.14` going value -> insufficient_history is v2
-- correctly needing 71 four-hourly bars, not a data defect.
--
-- Letting those into this table would bury every real finding under every definition change we
-- ever make, which is the failure mode IB-048 already cost us once: 954 false conflicts made the
-- signal unreadable. A conflict is therefore scoped to a version by its key, and the read path
-- (`publishedFrame`) takes the version as a REQUIRED argument so a cross-version pair cannot be
-- assembled in the first place. That is a mechanism rather than a rule.
--
-- The cross-version comparison IS worth having — "what did the definition change do to the
-- numbers" — and it is a separate, labelled artefact. It must never land here.
-- ---------------------------------------------------------------------------------------------

-- 1. The frames key. -------------------------------------------------------------------------
--
-- No data is lost and nothing is rewritten: `frame_version` is already not-null on every row, so
-- this only widens the identity to include a value each row already carries. Existing v1 frames
-- keep their revisions; a v2 pass now writes alongside them instead of colliding with them.
alter table feature_frames drop constraint feature_frames_pkey;
alter table feature_frames add constraint feature_frames_pkey
  primary key (symbol, tf, close_time, frame_version, revision);

comment on column feature_frames.frame_version is
  'The registry version this frame was computed under, and part of its IDENTITY since IB-053. '
  'v1 and v2 frames for one close coexist and are two measurements, not two attempts at one; '
  'amendments append revisions INSIDE a version. Reads must scope to a version — comparing '
  'across versions compares definitions, not data.';

-- 2. Conflicts carry the version they were observed within. ----------------------------------
--
-- Backfilled by JOIN rather than by assumption, because the frame itself records the version and
-- a conflict always refers to one: (symbol, tf, close_time, revision) resolves to exactly one
-- frame row under the OLD key, which is what makes this exact rather than a guess.
alter table feature_value_conflicts add column frame_version integer;

update feature_value_conflicts c
   set frame_version = f.frame_version
  from feature_frames f
 where f.symbol = c.symbol and f.tf = c.tf
   and f.close_time = c.close_time and f.revision = c.revision;

-- Orphans: a conflict whose frame is gone. Migration 016 deleted every frame without deleting
-- the conflicts that referenced them, so these exist and cannot be resolved — nothing records
-- which definition either side of the comparison came from, and inventing one is the retroactive
-- legitimisation 016 refused. Say what is being destroyed BEFORE destroying it.
do $$
declare
  n   bigint;
  lo  timestamptz;
  hi  timestamptz;
  ks  text;
begin
  select count(*), min(close_time), max(close_time) into n, lo, hi
    from feature_value_conflicts where frame_version is null;
  if n = 0 then
    raise notice '017: no orphan conflicts; every conflict row resolved to a frame.';
  else
    select string_agg(t.feature_key || ' x ' || t.c, '; ' order by t.c desc) into ks
      from (select feature_key, count(*) c from feature_value_conflicts
             where frame_version is null group by 1 limit 10) t;
    raise notice '017: deleting % orphan conflict rows spanning % .. % [%] — their frames were '
                 'removed by migration 016, so no version can be established for either side.',
      n, lo, hi, coalesce(ks, 'unknown keys');
  end if;
end $$;

delete from feature_value_conflicts where frame_version is null;

alter table feature_value_conflicts alter column frame_version set not null;

alter table feature_value_conflicts drop constraint feature_value_conflicts_pkey;
alter table feature_value_conflicts add constraint feature_value_conflicts_pkey
  primary key (symbol, tf, close_time, frame_version, revision, feature_key, seen_at);

comment on column feature_value_conflicts.frame_version is
  'The frame version BOTH sides of the comparison were computed under. Conflicts are within a '
  'version only: across versions the definition changed, so a difference is expected and is not '
  'a data defect. No default — a writer that omits it must fail rather than claim a version.';

-- 3. The playbook audit pin. -----------------------------------------------------------------
--
-- NOT in the original ruling, and it is the same defect one layer out. `frame_revision` pins the
-- exact frame an arm was decided against (IB-017), so that a sibling arm retried after a heal
-- cannot see a better-informed frame than the arm it is compared with. That pin is
-- (symbol, close_time, revision) — which stops identifying ONE frame the moment v1 and v2
-- coexist, so `frameAtRevision` would return an arbitrary one of two and the audit row could not
-- say which DEFINITION the arm was decided under.
--
-- An audit row whose pin is ambiguous is worse than one with no pin: it still looks precise.
--
-- Backfill: every existing evaluation pinned a v1 frame, because v2 frames could not be written
-- until this migration — that is what the bug WAS. But that is an argument, and an argument is
-- not evidence, so it is checked rather than assumed: if any frame of another version already
-- exists, this migration REFUSES instead of stamping a 1 over rows it cannot vouch for.
do $$
declare
  other bigint;
begin
  select count(*) into other from feature_frames where frame_version <> 1;
  if other > 0 then
    raise exception '017: % frames exist at a version other than 1, so playbook_evaluations '
                    'cannot be back-filled as v1. Resolve by hand before re-running.', other;
  end if;
end $$;

alter table playbook_evaluations add column frame_version integer;
update playbook_evaluations set frame_version = 1 where frame_version is null;
alter table playbook_evaluations alter column frame_version set not null;

comment on column playbook_evaluations.frame_version is
  'The frame version this arm was evaluated against. With frame_revision it identifies exactly '
  'one frame row; revision alone stopped doing so when v1 and v2 began to coexist (IB-053). '
  'Back-filled to 1 on rows written before v2 frames could exist, after verifying none did.';
