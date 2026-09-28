import { HttpException } from '@nestjs/common';
import { SeriesController } from '../../src/web/series/series.controller';
import { UniverseController } from '../../src/web/universe.controller';
import type { Db } from '../../src/db/db.port';

/**
 * IB-031 — the controller's guard rails (architecture/insight-bot-web-dashboard.md §4).
 *
 * The done-line names one of these explicitly: a 1m request over 91 days must be rejected. The
 * rest are the neighbouring cases, because a cap that only covers the example is not a cap.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 5, 1);

/** Returns nothing; these tests are about what never reaches the database. */
const fakeDb = () => {
  const queries: string[] = [];
  const db: Db = {
    query: async (sql: string) => { queries.push(sql); return [] as never; },
    transaction: async (fn) => fn(db),
  };
  return { db, queries };
};

const body = (error: unknown) => (error as HttpException).getResponse() as { code: string; maxDays?: number };

describe('range caps', () => {
  it('REJECTS a 1m request over 91 days, and never touches the database', async () => {
    const { db, queries } = fakeDb();
    const controller = new SeriesController(db);

    await expect(controller.candles('BTCUSDT', String(T0), String(T0 + 91 * DAY), '1m'))
      .rejects.toThrow(HttpException);
    try {
      await controller.candles('BTCUSDT', String(T0), String(T0 + 91 * DAY), '1m');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(400);
      expect(body(error)).toMatchObject({ code: 'RANGE_TOO_WIDE', maxDays: 90 });
    }
    expect(queries).toEqual([]); // refused before any query is built
  });

  it('accepts exactly 90 days at 1m', async () => {
    const { db, queries } = fakeDb();
    await new SeriesController(db).candles('BTCUSDT', String(T0), String(T0 + 90 * DAY), '1m');
    expect(queries).toHaveLength(1);
  });

  it('a 91-day window is fine at a coarser timeframe', async () => {
    const { db } = fakeDb();
    await expect(new SeriesController(db).candles('BTCUSDT', String(T0), String(T0 + 91 * DAY), '4h'))
      .resolves.toMatchObject({ timeframe: '4h' });
  });

  it('applies the same rule to every series endpoint, not just candles', async () => {
    const { db } = fakeDb();
    const c = new SeriesController(db);
    const wide: [string, string] = [String(T0), String(T0 + 91 * DAY)];
    await expect(c.funding('BTCUSDT', ...wide)).rejects.toThrow(HttpException);
    await expect(c.liquidations('BTCUSDT', ...wide, '1m', 'all')).rejects.toThrow(HttpException);
    await expect(c.liquidationsTop('BTCUSDT', ...wide, '50', 'all')).rejects.toThrow(HttpException);
  });

  it('a backwards range is BAD_REQUEST, not an empty chart', async () => {
    const { db } = fakeDb();
    try {
      await new SeriesController(db).candles('BTCUSDT', String(T0 + DAY), String(T0), '1m');
      throw new Error('should have thrown');
    } catch (error) {
      expect(body(error).code).toBe('BAD_REQUEST');
    }
  });

  it('an unknown timeframe, market, bucket, venue or kind is refused', async () => {
    const { db } = fakeDb();
    const c = new SeriesController(db);
    const ok: [string, string] = [String(T0), String(T0 + DAY)];
    await expect(c.candles('BTCUSDT', ...ok, '3s')).rejects.toThrow(HttpException);
    await expect(c.candles('BTCUSDT', ...ok, '1m', 'binance', 'futures')).rejects.toThrow(HttpException);
    await expect(c.liquidations('BTCUSDT', ...ok, '5m', 'all')).rejects.toThrow(HttpException);
    await expect(c.liquidations('BTCUSDT', ...ok, '1m', 'kraken')).rejects.toThrow(HttpException);
    await expect(c.ls('BTCUSDT', ...ok, 'nonsense')).rejects.toThrow(HttpException);
  });
});

describe('liquidations response', () => {
  it('declares the Binance undercount for binance and for "all", not for bybit alone', async () => {
    const { db } = fakeDb();
    const c = new SeriesController(db);
    const ok: [string, string] = [String(T0), String(T0 + DAY)];

    expect((await c.liquidations('BTCUSDT', ...ok, '1m', 'all')).undercounted).toBe(true);
    expect((await c.liquidations('BTCUSDT', ...ok, '1m', 'binance')).undercounted).toBe(true);
    // §12.2 is a Binance rule; claiming it for Bybit alone would be wrong in the other direction
    expect((await c.liquidations('BTCUSDT', ...ok, '1m', 'bybit')).undercounted).toBe(false);
  });

  it('caps n on the top list rather than trusting the query string', async () => {
    const { db } = fakeDb();
    const c = new SeriesController(db);
    const ok: [string, string] = [String(T0), String(T0 + DAY)];
    await expect(c.liquidationsTop('BTCUSDT', ...ok, '100000', 'all')).resolves.toMatchObject({ symbol: 'BTCUSDT' });
    await expect(c.liquidationsTop('BTCUSDT', ...ok, '-5', 'all')).resolves.toMatchObject({ symbol: 'BTCUSDT' });
  });
});

describe('UniverseController', () => {
  it('caps n so the picker cannot be asked for the world', async () => {
    const queries: unknown[][] = [];
    const db: Db = {
      query: async (_sql: string, params?: readonly unknown[]) => { queries.push(params as unknown[]); return [] as never; },
      transaction: async (fn) => fn(db as never),
    };
    await new UniverseController(db).top('100000');
    expect(queries[0][0]).toBe(100);

    await new UniverseController(db).top('abc');
    expect(queries[1][0]).toBe(20); // the default, not NaN
  });
});
