-- IB-053 undo.
--
-- The keys narrow back. **This is lossy in one specific way and it is worth stating:** if v1 and
-- v2 frames coexist for any close by the time this runs, narrowing the frames key to
-- (symbol, tf, close_time, revision) will fail on a duplicate-key violation — correctly, because
-- those rows are two distinct measurements that the old key has no room for.
--
-- That failure is the honest outcome. The fix is not to force it: decide which version to keep,
-- delete the other explicitly, and re-run. Frames are derived data, rebuildable with
-- `npm run features -- --from <date> --to <date>`.
--
-- The orphan conflicts deleted by the `do` are not restored, for the same reason migration 016's
-- undo cannot restore what it removed: they had no recoverable version, which is why they went.
alter table playbook_evaluations drop column if exists frame_version;

alter table feature_value_conflicts drop constraint if exists feature_value_conflicts_pkey;
alter table feature_value_conflicts drop column if exists frame_version;
alter table feature_value_conflicts add constraint feature_value_conflicts_pkey
  primary key (symbol, tf, close_time, revision, feature_key, seen_at);

alter table feature_frames drop constraint if exists feature_frames_pkey;
alter table feature_frames add constraint feature_frames_pkey
  primary key (symbol, tf, close_time, revision);
