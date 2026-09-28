import { CollectorsModule } from '../../src/collectors/collectors.module';

/**
 * IB-005 — the collectors are registered only with a database to write into. Without
 * `DATABASE_URL` the app must still boot and serve /health and /metrics (IB-003, §2.1), and
 * `Writers` throws without a `Db` (IB-004) — so the module provides nothing in that case.
 */
describe('CollectorsModule.register()', () => {
  const original = process.env.DATABASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it('provides the collector when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://user@localhost:5432/insight_test';
    const module = CollectorsModule.register();
    expect(module.providers ?? []).toHaveLength(1);
    expect((module.imports ?? []).length).toBeGreaterThan(0);
  });

  it('provides nothing without DATABASE_URL, so the app still boots', () => {
    delete process.env.DATABASE_URL;
    const module = CollectorsModule.register();
    expect(module.providers ?? []).toEqual([]);
    expect(module.imports ?? []).toEqual([]);
  });

  it('treats an empty DATABASE_URL as unset', () => {
    process.env.DATABASE_URL = '';
    expect(CollectorsModule.register().providers ?? []).toEqual([]);
  });
});
