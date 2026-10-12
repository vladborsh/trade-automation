import { WEB_FRAME_VERSION, featureSpecFingerprint } from '@trade-automation/contracts';
import type { Db } from '../db/db.port';

/**
 * IB-015 — the frame's definition cannot change without its version changing, enforced.
 *
 * The contract says "bump `WEB_FRAME_VERSION` when the meaning changes", and a spec makes the
 * fingerprint literal fail until someone does. That protects the repository. It does **not**
 * protect the DATABASE: once frames are stored, a later fingerprint change with the version left
 * alone produces new rows that claim to be the same version as the old ones and are not
 * comparable with them — and nothing in a test run would notice, because the test would have
 * been updated in the same commit.
 *
 * So the first frame written under a version records the fingerprint it was written with, and
 * **every** write checks the live fingerprint against that row. A mismatch throws, naming the
 * fix. This is AGENTS.md's rule for a shape carrying a behavioural invariant — assert it at
 * runtime rather than trust it — applied to the frame's own definition.
 *
 * It replaces a `WEB_FRAME_VERSION_FROZEN_FROM_FIRST_WRITE = true` constant, which was prose
 * wearing a type: it documented the boundary and enforced nothing.
 */

export class FrameVersionMismatchError extends Error {
  constructor(
    readonly frameVersion: number,
    readonly storedFingerprint: string,
    readonly liveFingerprint: string,
    readonly firstWrittenAt: Date,
  ) {
    super(
      `feature frame spec changed under frame_version ${frameVersion}: ` +
        `frames stored since ${firstWrittenAt.toISOString()} were written with fingerprint ` +
        `${storedFingerprint}, this build computes ${liveFingerprint}. ` +
        'Bump WEB_FRAME_VERSION — the stored frames mean something different and must not be ' +
        'mixed with new ones under the same version.',
    );
    this.name = 'FrameVersionMismatchError';
  }
}

/** The decision, pure, so the rule is spec'd without a database. */
export function checkFingerprint(
  frameVersion: number,
  stored: { spec_fingerprint: string; first_written_at: Date } | undefined,
  live: string,
): void {
  if (!stored) return; // nothing written under this version yet; the caller claims it
  if (stored.spec_fingerprint === live) return;
  throw new FrameVersionMismatchError(
    frameVersion,
    stored.spec_fingerprint,
    live,
    new Date(stored.first_written_at),
  );
}

/**
 * Claims the version for this fingerprint if it is unclaimed, then verifies.
 *
 * The insert is `on conflict do nothing` followed by a read rather than a read-then-insert: two
 * processes starting together would otherwise both see no row and both insert, and one of them
 * would be writing frames under a fingerprint nobody recorded. The loser of the race reads the
 * winner's row and is checked against it, which is the correct outcome either way.
 */
export async function assertFrameVersionFingerprint(
  db: Db,
  frameVersion: number = WEB_FRAME_VERSION,
  live: string = featureSpecFingerprint(),
): Promise<void> {
  await db.query(
    `insert into feature_frame_versions (frame_version, spec_fingerprint)
     values ($1, $2)
     on conflict (frame_version) do nothing`,
    [frameVersion, live],
  );
  const rows = await db.query<{ spec_fingerprint: string; first_written_at: Date }>(
    `select spec_fingerprint, first_written_at from feature_frame_versions where frame_version = $1`,
    [frameVersion],
  );
  checkFingerprint(frameVersion, rows[0], live);
}
