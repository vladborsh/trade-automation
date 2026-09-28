import { BinancePerpService } from '../../src/collectors/binance-perp/binance-perp.service';
import { OiLsPoller } from '../../src/collectors/binance-perp/oi-ls.poller';
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

  it('provides the collectors when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://user@localhost:5432/insight_test';
    const module = CollectorsModule.register();
    // Named, not counted: every new collector joins this list (IB-007 added the OI/LS poller),
    // and a bare count would fail each time without saying anything about what is registered.
    expect(module.providers ?? []).toEqual(expect.arrayContaining([BinancePerpService, OiLsPoller]));
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
