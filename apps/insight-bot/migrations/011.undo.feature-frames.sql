-- IB-015 — undo. Both tables go: a frame is a derived artefact and can be recomputed from the
-- stored series, and the version row is only meaningful while frames exist to compare against.
--
-- Note what this does NOT claim: recomputing a dropped frame reproduces today's definition, not
-- the one that frame was armed under. That is exactly why `feature_frame_versions` exists, and
-- exactly why dropping these is a real loss of the audit trail rather than a tidy-up.
drop table if exists feature_frames;
drop table if exists feature_value_conflicts;
drop table if exists feature_frame_versions;
