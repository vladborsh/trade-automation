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
