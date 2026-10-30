import { HttpException } from '@nestjs/common';
import { WEB_MAX_CANDLE_BARS, WEB_MAX_LIQUIDATION_EVENTS } from '@trade-automation/contracts';
import { SeriesController } from '../../src/web/series/series.controller';
import type { Db } from '../../src/db/db.port';

/**
 * IB-039 §12.5 — `GET /api/web/series/liquidations/events`.
 *
 * The property worth testing is the REFUSAL. Silently sending the first 2 000 of a larger window
 * would draw a chart that goes calm halfway through a cascade, which is the same class of lie as
 * IB-BUG-011: not an error, just a confident wrong picture.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

/** Answers the symbol lookup with a real mapping, then the event query with `count` rows. */
const dbWith = (count: number, biggest = 1_000_000) => {
  const queries: string[] = [];
  const db: Db = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('from symbols')) {
        return [{ binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' }] as never;
      }
      // descending by notional, as the repo orders them
      return Array.from({ length: count }, (_, i) => ({
        ts: new Date(T0 + i * 1_000),
        side: i % 2 === 0 ? 'long' : 'short',
        notional: String(biggest - i),
        price: '100',
        venue: i % 3 === 0 ? 'okx' : 'bybit',
      })) as never;
    },
    transaction: async (fn) => fn(db),
  };
  return { db, queries };
};

const body = (error: unknown) => (error as HttpException).getResponse() as { code: string; minUsd?: number };

describe('liquidation events', () => {
  it('returns the events in TIME order, though the query picks them by size', () => {
    // The cap keeps the biggest events; a chart draws left to right. Both are needed.
    return (async () => {
      const { db } = dbWith(5);
      const result = await new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY));
      const times = result.events.map((e) => e.time);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(result.events).toHaveLength(5);
    })();
  });

  it('REFUSES rather than truncating when the window holds more than the cap', async () => {
    const { db } = dbWith(WEB_MAX_LIQUIDATION_EVENTS + 1);
    const controller = new SeriesController(db);
    await expect(controller.liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY)))
      .rejects.toThrow(HttpException);
    try {
      await controller.liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY));
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(400);
      expect(body(error).code).toBe('RANGE_TOO_WIDE');
    }
  });

  it('the refusal CARRIES THE FIX: the min_usd that would bring it under the cap', async () => {
    // An error that only says no makes the caller guess. This one names the threshold.
    const { db } = dbWith(WEB_MAX_LIQUIDATION_EVENTS + 1, 1_000_000);
    try {
      await new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY));
      throw new Error('expected a refusal');
    } catch (error) {
      const sent = body(error);
      expect(sent.minUsd).toBe(1_000_000 - (WEB_MAX_LIQUIDATION_EVENTS - 1));
      expect((error as HttpException).message).toContain('min_usd');
    }
  });

  it('accepts a window exactly at the cap', async () => {
    const { db } = dbWith(WEB_MAX_LIQUIDATION_EVENTS);
    const result = await new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY));
    expect(result.events).toHaveLength(WEB_MAX_LIQUIDATION_EVENTS);
  });

  it('names the venues the DATA came from, and always flags the Binance undercount', async () => {
    const { db } = dbWith(6);
    const result = await new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY));
    expect(result.venuesPresent).toEqual(['bybit', 'okx']);
    expect(result.undercounted).toBe(true);
  });

  it('an empty window claims no venues rather than a filter name', async () => {
    const { db } = dbWith(0);
    const result = await new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY));
    expect(result.events).toEqual([]);
    expect(result.venuesPresent).toEqual([]);
  });

  it('rejects junk dates before it touches the database', async () => {
    const { db, queries } = dbWith(0);
    await expect(new SeriesController(db).liquidationEvents('BTCUSDT', 'banana', String(T0)))
      .rejects.toThrow(HttpException);
    expect(queries).toEqual([]);
  });
});

/**
 * IB-068 — with `tf`, the server groups per bar. The SQL itself is pinned against a real database
 * in `test/db/liquidation-event-buckets.integration.spec.ts`; here, the routing and the bound.
 */
describe('liquidation events grouped per bar (tf)', () => {
  /** Answers the symbol lookup, then `count` grouped rows as the repo's query returns them. */
  const groupedDb = (count: number) => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db: Db = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('from symbols')) {
          return [{ binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' }] as never;
        }
        return Array.from({ length: count }, (_, i) => ({
          bar_ms: String(T0 + i * 60_000), side: 'long', venue: 'bybit',
          usd: '500', price: '100', n: '5', max_usd: '200',
        })) as never;
      },
      transaction: async (fn) => fn(db),
    };
    return { db, queries };
  };

  it('does NOT apply the 2 000 cap: a dense window comes back whole', async () => {
    const { db } = groupedDb(WEB_MAX_LIQUIDATION_EVENTS + 500);
    const result = await new SeriesController(db)
      .liquidationEvents('BTCUSDT', String(T0), String(T0 + 7 * DAY), '0', '1m');
    expect(result.events).toHaveLength(WEB_MAX_LIQUIDATION_EVENTS + 500);
    expect(result.events[0]).toEqual({
      time: T0 / 1000, side: 'long', usd: 500, price: 100, venue: 'bybit', count: 5, maxUsd: 200,
    });
  });

  it('passes the week grid to the query: 1w buckets open on Monday', async () => {
    const { db, queries } = groupedDb(0);
    await new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + 90 * DAY), '0', '1w');
    const grouped = queries.find((q) => q.sql.includes('group by'));
    // [spellings, from, to, minUsd, offset, span, limit]
    expect(grouped?.params[4]).toBe(4 * DAY);
    expect(grouped?.params[5]).toBe(7 * DAY);
  });

  it('asks the database for one row over the bound, so an overflow is seen', async () => {
    const { db, queries } = groupedDb(0);
    await new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY), '0', '1h');
    const grouped = queries.find((q) => q.sql.includes('group by'));
    expect(grouped?.params[6]).toBe(24 * 2 * 3 + 1);
  });

  it('REFUSES a result over bars × sides × venues rather than cutting it', async () => {
    const { db } = groupedDb(24 * 2 * 3 + 1);
    await expect(new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY), '0', '1h'))
      .rejects.toThrow(/narrow the range/);
  });

  it('REFUSES a window wider than the candle cap, before touching the database', async () => {
    const { db, queries } = groupedDb(0);
    const tooWide = String(T0 + (WEB_MAX_CANDLE_BARS + 1) * 3_600_000);
    try {
      await new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), tooWide, '0', '1h');
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(400);
      expect(body(error).code).toBe('RANGE_TOO_WIDE');
    }
    expect(queries).toEqual([]);
  });

  it('rejects an unknown timeframe', async () => {
    const { db } = groupedDb(0);
    await expect(new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY), '0', '2h'))
      .rejects.toThrow(HttpException);
  });

  it('without tf, nothing changes: the ungrouped query and its cap', async () => {
    const { db } = dbWith(WEB_MAX_LIQUIDATION_EVENTS + 1);
    await expect(new SeriesController(db).liquidationEvents('BTCUSDT', String(T0), String(T0 + DAY)))
      .rejects.toThrow(/min_usd/);
  });
});
