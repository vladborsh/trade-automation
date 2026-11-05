import { Logger } from '@nestjs/common';
import type { Db } from '../../src/db/db.port';
import { MARKET_CAP_RECORD_MS, MarketCapRecorderService, marketCapObservation } from '../../src/web/market/market-cap/market-cap-recorder.service';
import { WebModule } from '../../src/web/web.module';

/**
 * IB-118 — the market cap writer: every 10 min whether or not anyone is viewing, keyed on CoinGecko's
 * `updated_at`; a failed read writes nothing and the next tick retries. The table side (the key really
 * collapses two polls) is the migration 029 spec.
 */
const NOW = Date.UTC(2026, 10, 5, 12);
const payload = (usd: unknown, updatedAt: unknown) => ({ data: { total_market_cap: { usd }, market_cap_percentage: {}, updated_at: updatedAt } });

function fakeDb(opts: { fail?: boolean } = {}) {
  const inserts: unknown[][] = [];
  const db = {
    query: async (sql: string, params: unknown[]) => {
      if (opts.fail) throw new Error('connection terminated unexpectedly');
      if (!sql.includes('insert into market_cap_total')) throw new Error(`unexpected SQL: ${sql}`);
      inserts.push(params);
      return [{ ts: params[0] }];
    },
    transaction: async () => { throw new Error('not used'); },
  };
  return { db: db as unknown as Db, inserts };
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('marketCapObservation', () => {
  it('the row: CoinGecko updated_at (s → ms) and total_market_cap.usd', () => {
    expect(marketCapObservation(payload(2.68e12, 1_793_800_000) as never)).toEqual({ tsMs: 1_793_800_000_000, totalUsd: 2.68e12 });
  });

  it('no updated_at, no positive finite usd, or nothing ever read: no row', () => {
    expect(marketCapObservation(null)).toBeNull();
    expect(marketCapObservation(payload(2.68e12, undefined) as never)).toBeNull();
    expect(marketCapObservation(payload(0, 1_793_800_000) as never)).toBeNull();
    expect(marketCapObservation(payload(undefined, 1_793_800_000) as never)).toBeNull();
    expect(marketCapObservation(payload(Number.NaN, 1_793_800_000) as never)).toBeNull();
  });
});

describe('recordOnce', () => {
  it('writes the observation with its fetched_at', async () => {
    const { db, inserts } = fakeDb();
    const svc = new MarketCapRecorderService(db, { global: async () => payload(2.68e12, 1_793_800_000) } as never);
    expect(await svc.recordOnce(NOW)).toBe('recorded');
    expect(inserts).toEqual([[new Date(1_793_800_000_000), 2.68e12, new Date(NOW)]]);
  });

  it('a failed read writes NOTHING and resolves; warns once per run of failures, again after a success', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { db, inserts } = fakeDb();
    let answer: unknown = null;
    const svc = new MarketCapRecorderService(db, { global: async () => answer } as never);
    expect(await svc.recordOnce(NOW)).toBe('failed');
    expect(await svc.recordOnce(NOW)).toBe('failed');
    expect(inserts).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    answer = payload(2.68e12, 1_793_800_000);
    expect(await svc.recordOnce(NOW)).toBe('recorded');
    answer = payload(2.68e12, undefined);
    expect(await svc.recordOnce(NOW)).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a database error is a failed tick, not a rejection', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new MarketCapRecorderService(fakeDb({ fail: true }).db, { global: async () => payload(2.68e12, 1) } as never);
    await expect(svc.recordOnce(NOW)).resolves.toBe('failed');
  });

  it('a throwing cards read is a failed tick too', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const svc = new MarketCapRecorderService(fakeDb().db, { global: async () => { throw new Error('boom'); } } as never);
    await expect(svc.recordOnce(NOW)).resolves.toBe('failed');
  });
});

describe('the schedule', () => {
  it('once at boot, then every 10 min — with nobody viewing anything', async () => {
    jest.useFakeTimers({ now: NOW });
    const reads: number[] = [];
    const svc = new MarketCapRecorderService(fakeDb().db, { global: async () => { reads.push(Date.now()); return payload(2.68e12, Date.now() / 1000); } } as never);
    svc.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(reads).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(MARKET_CAP_RECORD_MS * 3);
    expect(reads).toHaveLength(4);
    svc.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(MARKET_CAP_RECORD_MS * 3);
    expect(reads).toHaveLength(4);
  });

  it('no database: no timer, no read', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    let reads = 0;
    const svc = new MarketCapRecorderService(null, { global: async () => { reads++; return null; } } as never);
    svc.onApplicationBootstrap();
    expect(await svc.recordOnce(NOW)).toBeNull();
    expect(reads).toBe(0);
  });

  it('is wired into the web module (a writer nobody provides records nothing)', () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://localhost/none';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      expect(WebModule.register().providers).toContain(MarketCapRecorderService);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
    }
  });
});
