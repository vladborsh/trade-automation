import { createDb } from '../src/db/db.module';
import { PgDatabase } from '../src/db/pg/pg-database';

function config(values: Record<string, unknown>) {
  return { env: { get: (key: string) => values[key] } } as unknown as Parameters<typeof createDb>[0];
}

describe('createDb', () => {
  it('returns null when DATABASE_URL is unset — the app boots without a database', () => {
    expect(createDb(config({}))).toBeNull();
    expect(createDb(config({ DATABASE_URL: '' }))).toBeNull();
  });

  it('builds a PgDatabase when DATABASE_URL is set', async () => {
    const db = createDb(config({ DATABASE_URL: 'postgresql://u:p@localhost:5432/insight_dev2' }));
    expect(db).toBeInstanceOf(PgDatabase);
    // Constructing the pool opens no connection; close it so the spec leaves no handle behind.
    await (db as PgDatabase).end();
  });
});
