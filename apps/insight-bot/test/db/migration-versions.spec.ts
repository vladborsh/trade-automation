import { readdirSync } from 'node:fs';
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

const files = readdirSync(MIGRATIONS_DIR).sort();
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
    // without this, a moved directory turns the whole suite green by finding nothing
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
describe('burned version numbers', () => {
  const BURNED = [13, 14];

  const versions = () => [...new Set(
    readdirSync(MIGRATIONS_DIR).map(parse).filter((m): m is Migration => m !== null)
      .map((m) => Number(m.version)),
  )].sort((a, b) => a - b);

  it('has exactly the gaps we know about, and no others', () => {
    const present = versions();
    const highest = present[present.length - 1] as number;
    const gaps: number[] = [];
    for (let v = 1; v <= highest; v += 1) if (!present.includes(v)) gaps.push(v);
    expect(gaps).toEqual(BURNED);
  });

  it('refuses a migration that fills a burned number', () => {
    // The check above states it; this says out loud what filling one would mean, so the next
    // person meets the reason rather than an unexplained expectation.
    for (const burned of BURNED) {
      expect(versions()).not.toContain(burned);
    }
  });

  it('would catch a gap being filled', () => {
    // The real check reads the directory; this proves the arithmetic flags it.
    const pretend = [1, 2, 13, 15];
    const highest = 15;
    const gaps: number[] = [];
    for (let v = 1; v <= highest; v += 1) if (!pretend.includes(v)) gaps.push(v);
    expect(gaps).not.toEqual(BURNED); // 13 present, 14 still missing — no longer the known set
  });
});
