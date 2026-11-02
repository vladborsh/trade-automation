import { HttpException } from '@nestjs/common';
import { SeriesController } from '../../src/web/series/series.controller';
import type { Db } from '../../src/db/db.port';
import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import { CandlesService } from '../../src/web/market/candles.service';
import type { FundingService, OnDemandFunding } from '../../src/web/market/funding.service';
import type { OiLsService } from '../../src/web/market/oi-ls.service';
import { WEB_MAX_POINTS, type WebLongShortResponse, type WebOpenInterestResponse } from '@trade-automation/contracts';

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

/** IB-063: candles come from the venue. This one answers every page empty and counts the calls. */
const fakeCandles = () => {
  const calls: string[] = [];
  const service = new CandlesService({
    futuresBaseUrl: 'https://fapi.example', spotBaseUrl: 'https://api.example', weight: new BinanceWeightTracker(),
    fetchImpl: (async (url: URL) => {
      calls.push(String(url));
      return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => [] };
    }) as unknown as typeof fetch,
  });
  return { service, calls };
};

/** WD-009: the on-demand services, faked at their public method — the services have their own specs. */
const fakeFunding = (answer: Partial<OnDemandFunding> = {}) => {
  const calls: Array<[string, number, number]> = [];
  const service = {
    funding: async (symbol: string, fromMs: number, toMs: number): Promise<OnDemandFunding> => {
      calls.push([symbol, fromMs, toMs]);
      return { symbol, settled: [], predicted: [], downsampled: false, unavailable: [], ...answer };
    },
  } as unknown as FundingService;
  return { service, calls };
};

const series = (n: number, startSec = T0 / 1000) => Array.from({ length: n }, (_, i) => startSec + i * 300);

const fakeOiLs = (points: number, extra: { coverageFrom?: number; truncated?: boolean } = {}) => {
  const calls: unknown[][] = [];
  const service = {
    openInterest: async (symbol: string, fromMs: number, toMs: number): Promise<WebOpenInterestResponse> => {
      calls.push(['oi', symbol, fromMs, toMs]);
      return { symbol, venue: 'binance', downsampled: false, points: series(points).map((time) => ({ time, value: 1, notional: 2 })), ...extra };
    },
    longShort: async (symbol: string, kind: WebLongShortResponse['kind'], fromMs: number, toMs: number): Promise<WebLongShortResponse> => {
      calls.push(['ls', symbol, kind, fromMs, toMs]);
      return { symbol, kind, downsampled: false, points: series(points).map((time) => ({ time, ratio: 1.5 })), ...extra };
    },
  } as unknown as OiLsService;
  return { service, calls };
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

  it('accepts exactly 90 days at 1m (funding, now read from the venues — WD-009)', async () => {
    const { db, queries } = fakeDb();
    const funding = fakeFunding();
    await new SeriesController(db, undefined, funding.service).funding('BTCUSDT', String(T0), String(T0 + 90 * DAY));
    expect(funding.calls).toEqual([['BTCUSDT', T0, T0 + 90 * DAY]]);
    expect(queries).toEqual([]);
  });

  it('IB-063: candles hold a tighter cap of their own — every 1m bar is a venue page bought', async () => {
    const { db } = fakeDb();
    const candles = fakeCandles();
    const error = await new SeriesController(db, candles.service)
      .candles('BTCUSDT', String(T0), String(T0 + 90 * DAY), '1m').catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(400);
    expect(body(error)).toMatchObject({ code: 'RANGE_TOO_WIDE', maxDays: 7 });
    expect(candles.calls).toEqual([]);
  });

  it('a 91-day window is fine at a coarser timeframe', async () => {
    const { db } = fakeDb();
    await expect(new SeriesController(db, fakeCandles().service).candles('BTCUSDT', String(T0), String(T0 + 91 * DAY), '4h'))
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

describe('IB-063 candles route', () => {
  it('reads the venue, never the database, and answers the unchanged contract', async () => {
    const { db, queries } = fakeDb();
    const candles = fakeCandles();
    const res = await new SeriesController(db, candles.service)
      .candles('BTCUSDT', String(T0), String(T0 + DAY), '1h', 'binance', 'spot');
    expect(res).toEqual({ venue: 'binance', market: 'spot', symbol: 'BTCUSDT', timeframe: '1h', candles: [], downsampled: false });
    expect(queries).toEqual([]);
    expect(candles.calls).toHaveLength(1);
    expect(candles.calls[0]).toContain('/api/v3/klines');
  });

  it('a venue other than Binance is an empty answer, as the tape gave it (it only held Binance)', async () => {
    const { db } = fakeDb();
    const candles = fakeCandles();
    const res = await new SeriesController(db, candles.service).candles('BTCUSDT', String(T0), String(T0 + DAY), '1h', 'bybit');
    expect(res.candles).toEqual([]);
    expect(candles.calls).toEqual([]);
  });

  it('IB-066: a window holding the forming bar is answered no-store; a closed one is not', async () => {
    const { db } = fakeDb();
    const headers = (from: number, to: number) => {
      const set: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => { set[k] = v; } } as never;
      return new SeriesController(db, fakeCandles().service)
        .candles('BTCUSDT', String(from), String(to), '1m', 'binance', 'perp', res).then(() => set);
    };
    const now = Date.now();
    expect(await headers(now - 120_000, now + 1)).toEqual({ 'Cache-Control': 'no-store' });
    expect(await headers(T0, T0 + DAY)).toEqual({});
  });

  it('without the service the route says so with a 503, not a 500', async () => {
    const { db } = fakeDb();
    const error = await new SeriesController(db).candles('BTCUSDT', String(T0), String(T0 + DAY), '1h').catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(503);
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

describe('WD-009: funding, OI and long-short come from the venues, not the tape', () => {
  const ok: [string, string] = [String(T0), String(T0 + 7 * DAY)];

  it('funding: the service answer, settled thinned per venue, unavailable venues named, no database query', async () => {
    const { db, queries } = fakeDb();
    const many = series(WEB_MAX_POINTS + 10).map((time) => ({ time, rate: 0.0001 }));
    const funding = fakeFunding({
      settled: [{ venue: 'binance', points: many }, { venue: 'bybit', points: many.slice(0, 3) }],
      predicted: [{ time: T0 / 1000, rate: 0.0002 }],
      unavailable: ['okx'],
    });
    const res = await new SeriesController(db, undefined, funding.service).funding('BTCUSDT', ...ok);
    expect(res.settled.map((v) => v.venue)).toEqual(['binance', 'bybit']);
    expect(res.settled[0].points.length).toBeLessThanOrEqual(WEB_MAX_POINTS + 1);
    expect(res.settled[0].points.at(-1)).toEqual(many.at(-1)); // the right edge survives thinning
    expect(res.settled[1].points).toHaveLength(3);
    expect(res.downsampled).toBe(true);
    expect(res.predicted).toEqual([{ time: T0 / 1000, rate: 0.0002 }]);
    expect(res.unavailable).toEqual(['okx']);
    expect(queries).toEqual([]);
  });

  it('OI: thins after the fetch and passes the venue coverage through', async () => {
    const { db, queries } = fakeDb();
    const oiLs = fakeOiLs(WEB_MAX_POINTS + 50, { coverageFrom: T0 / 1000, truncated: true });
    const res = await new SeriesController(db, undefined, undefined, oiLs.service).oi('BTCUSDT', ...ok);
    expect(oiLs.calls).toEqual([['oi', 'BTCUSDT', T0, T0 + 7 * DAY]]);
    expect(res.downsampled).toBe(true);
    expect(res.points.length).toBeLessThanOrEqual(WEB_MAX_POINTS + 1);
    expect(res).toMatchObject({ venue: 'binance', coverageFrom: T0 / 1000, truncated: true });
    expect(queries).toEqual([]);
  });

  it('long-short: the kind reaches the service; a window that fits is not marked downsampled', async () => {
    const { db } = fakeDb();
    const oiLs = fakeOiLs(10);
    const res = await new SeriesController(db, undefined, undefined, oiLs.service).ls('BTCUSDT', ...ok, 'top_position');
    expect(oiLs.calls).toEqual([['ls', 'BTCUSDT', 'top_position', T0, T0 + 7 * DAY]]);
    expect(res).toMatchObject({ kind: 'top_position', downsampled: false });
    expect(res.points).toHaveLength(10);
  });

  it('OI and long-short for another venue are refused with 400, never an empty series', async () => {
    const { db } = fakeDb();
    const oiLs = fakeOiLs(10);
    const c = new SeriesController(db, undefined, undefined, oiLs.service);
    for (const call of [() => c.oi('BTCUSDT', ...ok, 'bybit'), () => c.ls('BTCUSDT', ...ok, 'global_account', 'okx')]) {
      const error = await call().catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(400);
    }
    expect(oiLs.calls).toEqual([]);
  });

  it('without the services each route answers 503, not a 500', async () => {
    const { db } = fakeDb();
    const c = new SeriesController(db);
    for (const call of [() => c.funding('BTCUSDT', ...ok), () => c.oi('BTCUSDT', ...ok), () => c.ls('BTCUSDT', ...ok)]) {
      const error = await call().catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(503);
    }
  });
});
