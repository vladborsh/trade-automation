import { createDb, DbEnvSource } from '../../src/db/db.module';

function fakeConfig(values: Record<string, unknown>): DbEnvSource {
  return { env: { get: (key: string) => values[key] } };
}

/**
 * architecture/backtest-app-system-design.md §12.8 — "without DATABASE_URL the server boots
 * exactly as before". `createDb` is the pure factory `db.module.ts`'s `DB` provider uses; this
 * test exercises it directly against a fake config rather than booting the whole Nest
 * `ConfigModule` — that module validates `process.env` once, synchronously, the first time
 * `config.module.ts` is `require`d in a process (a real gotcha this test used to trip on:
 * mutating `process.env` in a `beforeEach` after some other test file had already imported
 * `config.module.ts` had no effect on it).
 */
describe('DbModule.createDb — disabled without DATABASE_URL (T-004, §12.8)', () => {
  it('resolves to null when DATABASE_URL is unset', () => {
    expect(createDb(fakeConfig({}))).toBeNull();
  });

  it('resolves to null when DATABASE_URL is an empty string', () => {
    expect(createDb(fakeConfig({ DATABASE_URL: '' }))).toBeNull();
  });

  it('resolves to a Db instance when DATABASE_URL is set', () => {
    const db = createDb(fakeConfig({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/backtest_dev3' }));
    expect(db).not.toBeNull();
    expect(typeof db!.query).toBe('function');
    expect(typeof db!.transaction).toBe('function');
  });
});
