import fs from 'node:fs';
import path from 'node:path';

/**
 * WD-008: "ЗАПИСЬ В POSTGRES ЗАПРЕЩЕНА" — the on-demand layer reads venues and keeps answers in
 * memory; it never writes the tape. Pinned here, where a helper that "also stores it" would be added:
 * nothing under `src/venues/` and none of the on-demand services may import the database or the
 * writers. Row TYPES from `collectors/writers/tables` are allowed (`oi-ls.mapper` shapes its output
 * with them); the modules that write are not.
 */
const SRC = path.join(__dirname, '..', '..', 'src');
const ON_DEMAND = [
  ...walk(path.join(SRC, 'venues')),
  ...['funding.service.ts', 'funding-points.ts', 'oi-ls.service.ts', 'oi-ls-window.ts'].map((f) => path.join(SRC, 'web', 'market', f)),
];
const FORBIDDEN = [/from '[^']*\/db\//, /from 'pg'/, /from '[^']*writers\/(batch-writer|upsert|writers\.module)'/, /DbModule|WritersModule/];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
}

describe('the on-demand layer never writes Postgres (WD-008)', () => {
  it('covers real files — an empty list would pass vacuously', () => {
    expect(ON_DEMAND.length).toBeGreaterThanOrEqual(15);
    for (const file of ON_DEMAND) expect(fs.existsSync(file)).toBe(true);
  });

  it.each(ON_DEMAND.map((f) => [path.relative(SRC, f), f]))('%s imports no database or writer', (_name, file) => {
    const source = fs.readFileSync(file, 'utf8');
    const hits = FORBIDDEN.filter((re) => re.test(source)).map(String);
    expect(hits).toEqual([]);
  });

  it('the patterns catch what they are for', () => {
    for (const line of ["import { Db } from '../../db/db.module';", "import { Pool } from 'pg';",
      "import { BatchWriter } from '../../collectors/writers/batch-writer';"]) {
      expect(FORBIDDEN.some((re) => re.test(line))).toBe(true);
    }
    expect(FORBIDDEN.some((re) => re.test("import { LongShortRow } from '../../collectors/writers/tables';"))).toBe(false);
  });
});
