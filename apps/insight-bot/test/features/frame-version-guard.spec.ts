import { WEB_FRAME_VERSION, featureSpecFingerprint } from '@trade-automation/contracts';
import {
  FrameVersionMismatchError, assertFrameVersionFingerprint, checkFingerprint,
} from '../../src/features/frame-version-guard';
import type { Db } from '../../src/db/db.port';

/**
 * IB-015 — the version guard. A spec protects the repository; only the stored row protects the
 * database, because a test and the thing it tests are edited in the same commit.
 */

const WRITTEN = new Date('2026-10-12T00:00:00Z');

describe('checkFingerprint', () => {
  it('passes when nothing has been written under this version yet', () => {
    expect(() => checkFingerprint(1, undefined, 'abc12345')).not.toThrow();
  });

  it('passes when the stored fingerprint matches', () => {
    expect(() => checkFingerprint(1, { spec_fingerprint: 'abc12345', first_written_at: WRITTEN }, 'abc12345'))
      .not.toThrow();
  });

  it('THROWS when the spec changed under a version that already has frames', () => {
    expect(() => checkFingerprint(1, { spec_fingerprint: 'abc12345', first_written_at: WRITTEN }, 'deadbeef'))
      .toThrow(FrameVersionMismatchError);
  });

  it('the error NAMES THE FIX and both fingerprints, not just "mismatch"', () => {
    try {
      checkFingerprint(3, { spec_fingerprint: 'abc12345', first_written_at: WRITTEN }, 'deadbeef');
      throw new Error('expected a throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('Bump WEB_FRAME_VERSION');
      expect(message).toContain('abc12345');   // what the stored frames mean
      expect(message).toContain('deadbeef');   // what this build would write
      expect(message).toContain('2026-10-12'); // since when it has mattered
      expect(message).toContain('frame_version 3');
    }
  });
});

describe('assertFrameVersionFingerprint', () => {
  /** Records the SQL it is asked for and answers the select from a settable row. */
  const fakeDb = (stored?: { spec_fingerprint: string; first_written_at: Date }) => {
    const sql: string[] = [];
    const db: Db = {
      query: async (text: string) => {
        sql.push(text);
        return (text.includes('select') && stored ? [stored] : []) as never;
      },
      transaction: async (fn) => fn(db),
    };
    return { db, sql };
  };

  it('CLAIMS the version before reading it, so a race cannot leave it unrecorded', async () => {
    // Read-then-insert would let two processes both see nothing and both insert; one would then
    // be writing frames under a fingerprint nobody recorded.
    const { db, sql } = fakeDb();
    await assertFrameVersionFingerprint(db, 1, 'abc12345');
    expect(sql[0]).toContain('insert into feature_frame_versions');
    expect(sql[0]).toContain('on conflict (frame_version) do nothing');
    expect(sql[1]).toContain('select spec_fingerprint');
  });

  it('passes when the stored row agrees', async () => {
    const { db } = fakeDb({ spec_fingerprint: 'abc12345', first_written_at: WRITTEN });
    await expect(assertFrameVersionFingerprint(db, 1, 'abc12345')).resolves.toBeUndefined();
  });

  it('REJECTS a write when the live spec no longer matches the stored one', async () => {
    const { db } = fakeDb({ spec_fingerprint: 'abc12345', first_written_at: WRITTEN });
    await expect(assertFrameVersionFingerprint(db, 1, 'deadbeef')).rejects.toThrow(FrameVersionMismatchError);
  });

  it('defaults to the live contract, so a caller cannot forget which fingerprint to check', async () => {
    const { db } = fakeDb({ spec_fingerprint: featureSpecFingerprint(), first_written_at: WRITTEN });
    await expect(assertFrameVersionFingerprint(db)).resolves.toBeUndefined();
    expect(WEB_FRAME_VERSION).toBeGreaterThan(0);
  });
});
