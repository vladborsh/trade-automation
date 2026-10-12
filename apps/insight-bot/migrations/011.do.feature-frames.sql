-- IB-015 — the feature frames of design §8.2, and the mechanism that stops their meaning
-- drifting out from under them.
--
-- Two tables, and the second one is the point.
--
-- `feature_frames` is the §3.4 shape: one row per (symbol, tf, close_time), the keys as jsonb,
-- the basis it was computed over, and `complete`. A frame is written even when a key could not be
-- computed — a skipped frame is indistinguishable from "the feature pass was not running", which
-- is IB-BUG-010 one layer up. `complete` is an INDEX for "does this frame hold a non-computable
-- key", never a gate: arming is decided per key by the consumer, because a boolean is something a
-- consumer can forget to read and a per-key type is not.
--
-- `feature_frame_versions` records, for each `frame_version`, the spec fingerprint the FIRST frame
-- under it was written with. The writer compares the live fingerprint against that row on EVERY
-- write and fails hard on a mismatch. Without it, "bump the version when the meaning changes" is
-- a sentence in a contract file, and the person editing the spec six months after the first frame
-- lands will not read it. AGENTS.md's rule for a shape carrying a behavioural invariant is to
-- assert it at runtime rather than trust it; this is that rule applied to the frame's own
-- definition.

create table feature_frames (
  symbol        text        not null,
  tf            text        not null check (tf in ('15m','4h')),
  -- the bar's close, always UTC. The frame is stamped by its bar, never by the wall clock, so a
  -- late-completed frame still counts as that bar's decision (§8.1).
  close_time    timestamptz not null,
  frame_version int         not null,
  -- the §8.2 key set: each key is {"ok":true,"value":…} or {"ok":false,"why":…}. Never a bare
  -- null and never a zero standing in for "not computable".
  keys          jsonb       not null,
  -- what it was computed over: the venue set, and whether collector coverage was recorded at all
  -- (IB-BUG-010's vocabulary — "not recorded" is not "no events").
  basis         jsonb       not null,
  complete      boolean     not null,
  -- which bucket or slot was short, when one was. Empty when complete.
  incomplete_reason text[]  not null default '{}',
  computed_at   timestamptz not null default now(),
  -- the partition key is in the primary key because Postgres requires it; the key is also §8.1's
  -- idempotency key, so a recompute after the heal pass updates the frame rather than duplicating
  -- that bar's decision.
  primary key (symbol, tf, close_time)
) partition by range (close_time);

comment on table feature_frames is
  'Design 8.2. One row per (symbol, tf, close_time). A frame is written even when keys are not '
  'computable: absence would be indistinguishable from the feature pass not running. `complete` is '
  'an index, not a gate — no consumer may arm on it; arming is decided per key.';

comment on column feature_frames.complete is
  'True when every key computed. An INDEX for finding frames with refusals, never a safety '
  'mechanism: a consumer decides per key, because a boolean can be forgotten and a typed value '
  'cannot.';

create index feature_frames_incomplete_idx on feature_frames (close_time) where not complete;

-- ---------------------------------------------------------------------------------------------
-- The version guard. Tiny, not partitioned: one row per frame_version, ever.
-- ---------------------------------------------------------------------------------------------

create table feature_frame_versions (
  frame_version    int         primary key,
  -- the fingerprint over the whole key registry — names, types, windows, every meaning-defining
  -- parameter, and each key's definition text.
  spec_fingerprint text        not null,
  first_written_at timestamptz not null default now()
);

comment on table feature_frame_versions is
  'IB-015: the spec fingerprint the first frame of each version was written under. The writer '
  'compares the live fingerprint to this on every write and refuses on a mismatch, so changing '
  'what a key MEANS without bumping frame_version fails loudly instead of silently producing '
  'frames that cannot be compared with the ones already stored.';
