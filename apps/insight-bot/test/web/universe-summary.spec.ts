import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpException } from '@nestjs/common';
import { WebUniverseSummaryResponseSchema } from '@trade-automation/contracts';
import type { FetchLike } from '../../src/venues/binance/rest.base';
import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import {
  OiHistRowSchema, PremiumIndexSummaryRowSchema, Ticker24hRowSchema,
} from '../../src/web/market/summary.payloads';
import { assembleSummary, numberOrNull, oiChangePct } from '../../src/web/market/universe-summary';
import {
  CACHE_TTL_MS, UniverseSummaryService, VenueUnavailableError,
} from '../../src/web/market/universe-summary.service';
import { SUMMARY_MAX, UniverseController } from '../../src/web/universe.controller';
import type { Db } from '../../src/db/db.port';

/**
 * The symbol dropdown's live summary. The fixtures are real Binance answers captured 2026-10-24,
 * so a renamed venue field fails here (AGENTS.md: shapes are pinned by fixtures).
 */
const fixture = (name: string): unknown[] =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'binance', name), 'utf8')) as unknown[];

const TICKERS = fixture('ticker24hr.json');
const PREMIUM = fixture('premiumIndex.json');
const OI_1H = fixture('openInterestHist-1h.json');

const SYMBOLS = [
  { id: 'BTCUSDT', base: 'BTC', volumeRank: 1 },
  { id: 'ETHUSDT', base: 'ETH', volumeRank: 2 },
  { id: 'NOPEUSDT', base: 'NOPE', volumeRank: 3 }, // in our top list, absent from the venue
];

interface Route { status?: number; body: unknown; weight?: number }

/** A URL-routed fake: each path answers its canned body; every call is recorded. */
function fakeFetch(routes: Record<string, Route | ((url: string) => Route)>) {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) throw new Error(`unrouted ${url}`);
    const r = typeof route === 'function' ? route(url) : route;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'ERR',
      headers: { get: (name: string) => (name.toLowerCase() === 'x-mbx-used-weight-1m' && r.weight !== undefined ? String(r.weight) : null) },
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as never;
  };
  return { impl, calls };
}

const venueRoutes = (overrides: Record<string, Route | ((url: string) => Route)> = {}) => ({
  '/fapi/v1/ticker/24hr': { body: TICKERS, weight: 140 },
  '/fapi/v1/premiumIndex': { body: PREMIUM, weight: 150 },
  '/futures/data/openInterestHist': (url: string) => {
    const symbol = new URL(url).searchParams.get('symbol');
    return { body: (OI_1H as Array<{ symbol: string }>).map((r) => ({ ...r, symbol })) };
  },
  ...overrides,
});

describe('the venue shapes the summary reads (committed fixtures)', () => {
  it('parses every fixture row with its schema', () => {
    expect(TICKERS.map((r) => Ticker24hRowSchema.parse(r)).map((r) => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    expect(PREMIUM.map((r) => PremiumIndexSummaryRowSchema.parse(r))).toHaveLength(3);
    expect(OI_1H.map((r) => OiHistRowSchema.parse(r))).toHaveLength(25);
  });

  it('numbers arrive as strings, so a string schema is the right one', () => {
    const btc = TICKERS[0] as Record<string, unknown>;
    expect(typeof btc.lastPrice).toBe('string');
    expect(typeof (PREMIUM[0] as Record<string, unknown>).nextFundingTime).toBe('number');
  });
});

describe('numberOrNull', () => {
  it('turns an empty or junk string into null, never 0 or NaN', () => {
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('  ')).toBeNull();
    expect(numberOrNull('abc')).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
    expect(numberOrNull('-0.00216731')).toBeCloseTo(-0.00216731, 10);
  });
});

describe('oiChangePct', () => {
  it('compares the oldest and newest sample, whatever order they arrive in', () => {
    const rows = OI_1H.map((r) => OiHistRowSchema.parse(r));
    const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);
    const expected = (Number(sorted[24].sumOpenInterest) / Number(sorted[0].sumOpenInterest) - 1) * 100;
    expect(oiChangePct([...rows].reverse())).toBeCloseTo(expected, 9);
  });

  it('is null with fewer than two samples or from a zero base', () => {
    expect(oiChangePct([])).toBeNull();
    expect(oiChangePct([{ symbol: 'X', sumOpenInterest: '5', timestamp: 1 }])).toBeNull();
    expect(oiChangePct([
      { symbol: 'X', sumOpenInterest: '0', timestamp: 1 },
      { symbol: 'X', sumOpenInterest: '5', timestamp: 2 },
    ])).toBeNull();
  });
});

describe('assembleSummary', () => {
  it('keeps the top list order and gives a venue-absent symbol nulls, not a dropped row', () => {
    const rows = assembleSummary(
      SYMBOLS,
      TICKERS.map((r) => Ticker24hRowSchema.parse(r)),
      PREMIUM.map((r) => PremiumIndexSummaryRowSchema.parse(r)),
      new Map(),
    );
    expect(rows.map((r) => r.id)).toEqual(['BTCUSDT', 'ETHUSDT', 'NOPEUSDT']);
    const btc = TICKERS.find((r) => (r as { symbol: string }).symbol === 'BTCUSDT') as { lastPrice: string; priceChangePercent: string };
    expect(rows[0].lastPrice).toBe(Number(btc.lastPrice));
    expect(rows[0].changePct24h).toBe(Number(btc.priceChangePercent));
    expect(rows[0].oiChangePct24h).toBeNull(); // no OI entry: a dash, not a zero
    expect(rows[2]).toEqual({
      id: 'NOPEUSDT', base: 'NOPE', volumeRank: 3,
      lastPrice: null, changePct24h: null, fundingRate: null, nextFundingTimeMs: null, oiChangePct24h: null,
    });
  });
});

describe('UniverseSummaryService', () => {
  const BASE = 'https://fapi.example.test';

  it('reads the venue once and answers a valid contract', async () => {
    const { impl, calls } = fakeFetch(venueRoutes());
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, now: () => 1_000 });
    const result = await service.summary(SYMBOLS);
    expect(WebUniverseSummaryResponseSchema.parse(result).rows).toHaveLength(3);
    expect(result.rows[0].oiChangePct24h).not.toBeNull();
    // OI is asked only for symbols the venue lists: NOPEUSDT costs nothing
    expect(calls.filter((c) => c.includes('openInterestHist'))).toHaveLength(2);
    expect(calls.every((c) => c.startsWith(BASE))).toBe(true);
  });

  it('serves the cache inside the TTL and refreshes after it', async () => {
    let now = 0;
    const { impl, calls } = fakeFetch(venueRoutes());
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, now: () => now });
    await service.summary(SYMBOLS);
    const first = calls.length;
    now = CACHE_TTL_MS - 1;
    await service.summary(SYMBOLS);
    expect(calls.length).toBe(first);
    now = CACHE_TTL_MS + 1;
    await service.summary(SYMBOLS);
    expect(calls.length).toBe(first * 2);
  });

  it('shares one in-flight read between concurrent callers', async () => {
    const { impl, calls } = fakeFetch(venueRoutes());
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, now: () => 0 });
    await Promise.all([service.summary(SYMBOLS), service.summary(SYMBOLS), service.summary(SYMBOLS)]);
    expect(calls.filter((c) => c.includes('ticker/24hr'))).toHaveLength(1);
  });

  it('one failing OI call costs that coin its figure, not the list', async () => {
    const { impl } = fakeFetch(venueRoutes({
      '/futures/data/openInterestHist': (url: string) => {
        const symbol = new URL(url).searchParams.get('symbol');
        if (symbol === 'ETHUSDT') return { status: 500, body: { code: -1000 } };
        return { body: (OI_1H as Array<{ symbol: string }>).map((r) => ({ ...r, symbol })) };
      },
    }));
    const result = await new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl }).summary(SYMBOLS);
    expect(result.rows[0].oiChangePct24h).not.toBeNull();
    expect(result.rows[1].oiChangePct24h).toBeNull();
    expect(result.rows[1].lastPrice).not.toBeNull();
  });

  it('a failed backbone call is VenueUnavailableError, not an empty list', async () => {
    const { impl } = fakeFetch(venueRoutes({ '/fapi/v1/ticker/24hr': { status: 418, body: {} } }));
    await expect(new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl }).summary(SYMBOLS))
      .rejects.toBeInstanceOf(VenueUnavailableError);
  });

  it('a renamed venue field throws rather than filling the column with dashes', async () => {
    const renamed = (TICKERS as Array<Record<string, unknown>>).map(({ lastPrice, ...rest }) => ({ ...rest, last: lastPrice }));
    const { impl } = fakeFetch(venueRoutes({ '/fapi/v1/ticker/24hr': { body: renamed } }));
    await expect(new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl }).summary(SYMBOLS)).rejects.toThrow();
  });

  it('refuses to add load when the venue reports the budget nearly spent', async () => {
    let now = 0;
    const weight = new BinanceWeightTracker();
    const { impl, calls } = fakeFetch(venueRoutes({ '/fapi/v1/premiumIndex': { body: PREMIUM, weight: 1_900 } }));
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, weight, now: () => now });
    await service.summary(SYMBOLS); // this read learns 1 900 from the header
    now = CACHE_TTL_MS + 1;
    const before = calls.length;
    await expect(service.summary(SYMBOLS)).rejects.toBeInstanceOf(VenueUnavailableError);
    expect(calls.length).toBe(before); // refused before calling
  });
});

describe('GET /api/web/universe/summary', () => {
  const db: Db = {
    query: async () => [
      { id: 'BTCUSDT', base: 'BTC', quote: 'USDT', volume_rank: 1, in_signal_set: true, binance_perp: 'BTCUSDT', binance_spot: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' },
    ] as never,
    transaction: async (fn) => fn(db),
  };

  it('maps a venue failure to 503 VENUE_UNAVAILABLE', async () => {
    const { impl } = fakeFetch(venueRoutes({ '/fapi/v1/premiumIndex': { status: 503, body: {} } }));
    const controller = new UniverseController(db, new UniverseSummaryService({ futuresBaseUrl: 'https://x.test', fetchImpl: impl }));
    try {
      await controller.summary('20');
      throw new Error('expected a 503');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toMatchObject({ code: 'VENUE_UNAVAILABLE' });
    }
  });

  it('answers the rows for the top list', async () => {
    const { impl } = fakeFetch(venueRoutes());
    const controller = new UniverseController(db, new UniverseSummaryService({ futuresBaseUrl: 'https://x.test', fetchImpl: impl }));
    const result = await controller.summary('20');
    expect(result.rows.map((r) => r.id)).toEqual(['BTCUSDT']);
  });

  it('reads the whole universe the picker asks for (IB-070: 40 symbols), capped at SUMMARY_MAX', async () => {
    const limits: unknown[] = [];
    const spy: Db = { ...db, query: async (sql, params) => { limits.push(params?.[0]); return db.query(sql, params); } };
    const { impl } = fakeFetch(venueRoutes());
    const controller = new UniverseController(spy, new UniverseSummaryService({ futuresBaseUrl: 'https://x.test', fetchImpl: impl }));
    await controller.summary('40');
    await controller.summary('100000');
    expect(limits).toEqual([40, SUMMARY_MAX]);
    expect(SUMMARY_MAX).toBeGreaterThanOrEqual(40);
  });
});
