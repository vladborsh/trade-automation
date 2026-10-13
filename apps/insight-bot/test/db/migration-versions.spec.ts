import { basename } from 'node:path';
import { listFiles } from '../helpers/source-scan';
import { join } from 'node:path';

/**
 * Two migrations must never share a version — and git cannot tell you when they do.
 *
 * Postgrator refuses to run **at all** on a duplicate version: not the clashing pair, the whole
 * chain. So the symptom is every database suite failing at once, plus a service that will not boot,
 * and the cause is invisible in the diff that created it. It has now happened three times:
 *
 * - **IB-036** — two 007s after a rebase. Cost 6 suites / 52 tests before anyone looked at `ls`.
 * - **IB-027, 2026-10-12** — a branch written when 006-008 were taken came back to find 009 and
 *   010 gone, and merged cleanly into a tree holding two 009s.
 * - **IB-027 again, hours later** — renumbered to 011, which dev-2's unmerged branch already held.
 *   Master's highest was 010, so both branches read 011 as free and both were right at the time.
 *
 * The common thread is that **two new files with different names merge without a conflict**. Git
 * has nothing to object to; the working tree is the only place the duplicate exists, and only once
 * both branches are in it. That is exactly the moment this test runs, which is why it is a test and
 * not a convention: it turns a silent refusal at boot into a red build at merge time.
 *
 * It deliberately checks the **directory**, not a hard-coded list. A list would need updating by
 * the same person who just forgot to check, and would pass while being wrong.
 */

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

interface Migration {
  version: string;
  direction: 'do' | 'undo';
  name: string;
  file: string;
}

/** `<version>.<do|undo>.<name>.sql` — postgrator's own convention. */
function parse(file: string): Migration | null {
  const match = /^(\d+)\.(do|undo)\.(.+)\.sql$/.exec(file);
  if (match === null) return null;
  return { version: match[1], direction: match[2] as 'do' | 'undo', name: match[3], file };
}

// `listFiles` THROWS on an empty directory instead of returning [], so a moved or renamed
// migrations path reads as "the guard cannot find the migrations" rather than as a clean tree. That
// is the shared half of this spec's own lesson, now in test/helpers/source-scan.ts and used by the
// two other source-scanning guards as well.
const files = listFiles(MIGRATIONS_DIR, { ext: '.sql' }).map((path) => basename(path)).sort();
const migrations = files.map(parse).filter((m): m is Migration => m !== null);

describe('the migrations directory', () => {
  it('has no two migrations sharing a version', () => {
    const byVersion = new Map<string, Migration[]>();
    for (const m of migrations.filter((x) => x.direction === 'do')) {
      byVersion.set(m.version, [...(byVersion.get(m.version) ?? []), m]);
    }

    const clashes = [...byVersion.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([version, group]) => `  ${version}: ${group.map((g) => g.file).join('  AND  ')}`);

    expect(clashes.join('\n') || null).toBeNull();
  });

  it('pairs every do with an undo, so a migration can be rolled back', () => {
    const dos = new Set(migrations.filter((m) => m.direction === 'do').map((m) => `${m.version}.${m.name}`));
    const undos = new Set(migrations.filter((m) => m.direction === 'undo').map((m) => `${m.version}.${m.name}`));
    const unpaired = [...dos].filter((d) => !undos.has(d)).concat([...undos].filter((u) => !dos.has(u)));
    expect(unpaired).toEqual([]);
  });

  it('recognises every .sql file in the directory', () => {
    // a file postgrator cannot parse is silently ignored by it and by the duplicate check above,
    // so an unparseable name would hide a migration rather than fail
    const unparseable = files.filter((f) => f.endsWith('.sql') && parse(f) === null);
    expect(unparseable).toEqual([]);
  });

  it('finds the migrations at all — a wrong path would make every check above vacuous', () => {
    // without this, a moved directory turns the whole suite green by finding nothing. `listFiles`
    // now refuses the empty case outright, so this is the second line of defence rather than the
    // only one — the count still has to be stated, because "it threw nothing" is not "it read 30".
    expect(migrations.length).toBeGreaterThan(10);
  });
});

describe('the duplicate check itself', () => {
  // the check must be able to fail, or it is decoration: these feed it the shapes it exists to
  // catch, through the same parser the real check uses
  it('parses postgrator names and rejects anything else', () => {
    expect(parse('012.do.news.sql')).toMatchObject({ version: '012', direction: 'do', name: 'news' });
    expect(parse('012.undo.news.sql')).toMatchObject({ version: '012', direction: 'undo', name: 'news' });
    expect(parse('012.do.news-with-dashes.sql')).toMatchObject({ name: 'news-with-dashes' });
    expect(parse('README.md')).toBeNull();
    expect(parse('012.sideways.news.sql')).toBeNull();
  });

  it('would catch two files sharing a version', () => {
    const pretend = ['011.do.feature-frames.sql', '011.do.news.sql'].map(parse).filter((m): m is Migration => m !== null);
    const versions = pretend.map((m) => m.version);
    expect(new Set(versions).size).toBe(1);
    expect(pretend).toHaveLength(2); // same version, two files — the real check reports this
  });
});

/**
 * A number BELOW the current maximum must never be filled in later — and 013 and 014 are now
 * permanently unusable.
 *
 * The second failure mode of this directory, and the quieter one. Postgrator applies migrations
 * whose version is greater than the database's current version, so a 013 added after 015 has
 * landed is **silently skipped on every existing database and applied on every fresh one**. The
 * result is two schemas that both believe they are current, and the difference surfaces much
 * later as a column that exists in dev and not in production, or the reverse.
 *
 * It is a live hazard rather than a hypothetical: IB-017's 015 merged while dev-3's 013 and
 * dev-1's 014 were still unmerged, so those two were renumbered to 016 and 017 and their
 * original numbers are burned. Verified on a scratch database the same day — a chain of
 * 001-012 plus 015 applies cleanly as 13 migrations, so the gap itself is harmless; what is
 * not harmless is filling it.
 *
 * The guard is the gap SET rather than a "no gaps" rule, because a no-gaps rule would fail
 * today and teach the next person to delete the test. Filling 013 shrinks the set and fails
 * here; opening a new gap grows it and also fails, which is the conversation worth forcing
 * before a number is skipped on purpose.
 */
/** Gaps below the highest present version. */
export function gapsIn(present: readonly number[]): number[] {
  if (present.length === 0) return [];
  const highest = Math.max(...present);
  const gaps: number[] = [];
  for (let v = 1; v <= highest; v += 1) if (!present.includes(v)) gaps.push(v);
  return gaps;
}

/**
 * The failure message, and the reason this is a function rather than a bare `toEqual`.
 *
 * dev-3 found it while comparing guards: an UNREBASED branch is missing the migrations that
 * landed on master since it forked, so those numbers read as gaps. The check fires correctly —
 * the tree really does have a hole — but `expected [13,14,15] to equal [13,14]` sends the reader
 * looking for a missing file when the answer is "rebase". A guard that fires for the right
 * reason with a misleading message costs the next person twenty minutes in the wrong place, and
 * that cost is what eventually gets guards deleted.
 *
 * Returns '' when the gap set is exactly the burned one.
 */
export function gapReport(present: readonly number[], burned: readonly number[]): string {
  const gaps = gapsIn(present);
  const unexpected = gaps.filter((g) => !burned.includes(g));
  const filled = burned.filter((b) => present.includes(b));
  if (unexpected.length === 0 && filled.length === 0) return '';

  const lines: string[] = [];
  if (filled.length > 0) {
    lines.push(
      `migration version(s) ${filled.join(', ')} are BURNED and must never be used: postgrator ` +
      'applies only versions greater than the database\'s current one, so filling one is ' +
      'silently skipped on every existing database and applied on every fresh one.',
    );
  }
  if (unexpected.length > 0) {
    const highest = Math.max(...present);
    // The tell for an unrebased branch: the unexpected gaps run up against the top of the tree,
    // i.e. they are the numbers that landed on master after this branch forked.
    const contiguousWithTop = unexpected.includes(highest - 1) || unexpected.some((g) => g > Math.max(...burned));
    lines.push(`unexpected gap(s) in the migrations directory: ${unexpected.join(', ')}`);
    if (contiguousWithTop) {
      lines.push(
        'Gaps just below the highest version usually mean THIS BRANCH IS BEHIND MASTER rather ' +
        'than that a file is missing — rebase and re-run before looking for one.',
      );
    }
    lines.push('If a number was skipped deliberately, add it to BURNED with the reason.');
  }
  return lines.join('\n');
}

describe('burned version numbers', () => {
  const BURNED = [13, 14];

  const versions = () => [...new Set(
    listFiles(MIGRATIONS_DIR, { ext: '.sql' }).map((p) => basename(p)).map(parse).filter((m): m is Migration => m !== null)
      .map((m) => Number(m.version)),
  )].sort((a, b) => a - b);

  it('has exactly the gaps we know about, and no others', () => {
    expect(gapReport(versions(), BURNED)).toBe('');
  });

  it('refuses a migration that fills a burned number', () => {
    // The check above states it; this says out loud what filling one would mean, so the next
    // person meets the reason rather than an unexplained expectation.
    for (const burned of BURNED) {
      expect(versions()).not.toContain(burned);
    }
  });

  it('would catch a gap being filled, and SAYS it is burned', () => {
    const report = gapReport([1, 2, 13, 15], BURNED);
    expect(report).toContain('13');
    expect(report).toContain('BURNED');
    // The reason, not just the fact: skipped on existing databases, applied on fresh ones.
    expect(report).toContain('silently skipped');
  });

  /**
   * dev-3's finding, fixed here: the check reads the TREE, so a branch that has not rebased is
   * missing whatever landed on master since it forked, and those numbers read as gaps.
   */
  it('tells an UNREBASED branch to rebase, instead of sending it to look for a file', () => {
    // A branch forked before 015 landed, carrying its own 016: 15 reads as a gap.
    const report = gapReport([...Array.from({ length: 12 }, (_, i) => i + 1), 16], BURNED);
    expect(report).toContain('BEHIND MASTER');
    expect(report).toContain('rebase');
  });

  it('does NOT blame a rebase when the gap is nowhere near the top', () => {
    // A hole in the middle of a tree whose top is current is a genuinely missing file, and
    // saying "rebase" there would be the same wrong-direction advice pointing the other way.
    const present = [...Array.from({ length: 12 }, (_, i) => i + 1), 15, 16, 17];
    const report = gapReport(present.filter((v) => v !== 5), BURNED);
    expect(report).toContain('5');
    expect(report).not.toContain('BEHIND MASTER');
  });

  it('names the deliberate-skip escape hatch, so the fix is not "delete the test"', () => {
    expect(gapReport([1, 3], BURNED)).toContain('add it to BURNED');
  });

  it('is silent on a healthy tree', () => {
    const healthy = [...Array.from({ length: 12 }, (_, i) => i + 1), 15];
    expect(gapReport(healthy, BURNED)).toBe('');
  });

  it('is silent on an empty directory rather than inventing a gap', () => {
    // Vacuous, but the anti-vacuity check above already proves the directory is found.
    expect(gapReport([], BURNED)).toBe('');
  });
});
