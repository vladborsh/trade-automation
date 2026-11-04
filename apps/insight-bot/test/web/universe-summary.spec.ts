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
import type { AppConfigService } from '../../src/config/config.service';

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
  // WD-009: the list comes from config/universe.yaml (AppConfigService), not the symbols table
  const symbol = (id: string, rank: number) => ({ id, base: id.replace('USDT', ''), quote: 'USDT', binance_perp: id, volume_rank: rank });
  const config = (n: number) => ({ symbols: Array.from({ length: n }, (_, i) => symbol(i === 0 ? 'BTCUSDT' : `C${i}USDT`, i + 1)), signalSet: ['BTCUSDT'] }) as unknown as AppConfigService;

  it('maps a venue failure to 503 VENUE_UNAVAILABLE', async () => {
    const { impl } = fakeFetch(venueRoutes({ '/fapi/v1/premiumIndex': { status: 503, body: {} } }));
    const controller = new UniverseController(config(1), new UniverseSummaryService({ futuresBaseUrl: 'https://x.test', fetchImpl: impl }));
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
    const controller = new UniverseController(config(1), new UniverseSummaryService({ futuresBaseUrl: 'https://x.test', fetchImpl: impl }));
    const result = await controller.summary('20');
    expect(result.rows.map((r) => r.id)).toEqual(['BTCUSDT']);
  });

  it('reads the whole universe the picker asks for (IB-070: 40 symbols), capped at SUMMARY_MAX', async () => {
    const asked: number[] = [];
    const service = { summary: async (rows: unknown[]) => { asked.push(rows.length); return { rows: [] } as never; } } as unknown as UniverseSummaryService;
    const controller = new UniverseController(config(100), service);
    await controller.summary('40');
    await controller.summary('100000');
    expect(asked).toEqual([40, SUMMARY_MAX]);
    expect(SUMMARY_MAX).toBeGreaterThanOrEqual(40);
  });
});

describe('UniverseSummaryService — one snapshot for every list (IB-BUG-026)', () => {
  const BASE = 'https://fapi.example.test';
  const POSITIONING = SYMBOLS.slice(0, 2); // BTC, ETH — positioning's list, shortened
  const KPIS = [{ id: 'BTCUSDT', base: 'BTC', volumeRank: 1 }]; // the KPIs' [BTC]
  const PICKER = [{ id: 'SOLUSDT', base: 'SOL', volumeRank: 1 }]; // the instrument picker, a third list
  const count = (calls: string[], part: string) => calls.filter((c) => c.includes(part)).length;
  const clock = () => { let t = 1_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

  it('two callers with DIFFERENT lists inside 60 s: exactly ONE ticker/24hr and ONE premiumIndex call', async () => {
    // Red on master: its one cache slot was keyed by the list, so each list evicted the other.
    const { impl, calls } = fakeFetch(venueRoutes());
    const c = clock();
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, now: c.now });
    await service.summary(POSITIONING);
    c.advance(10_000);
    await service.summary(KPIS);
    c.advance(10_000);
    await service.summary(POSITIONING);
    await service.summary(PICKER);
    expect(count(calls, '/ticker/24hr')).toBe(1);
    expect(count(calls, '/premiumIndex')).toBe(1);
  });

  it('OI is cached per symbol: a symbol in two lists is asked once, a new symbol only for itself', async () => {
    const { impl, calls } = fakeFetch(venueRoutes());
    const c = clock();
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, now: c.now });
    await service.summary(POSITIONING); // BTC, ETH
    await service.summary(KPIS); // BTC again: cached
    await service.summary(PICKER); // SOL: new
    expect(calls.filter((u) => u.includes('openInterestHist')).map((u) => new URL(u).searchParams.get('symbol')).sort())
      .toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });

  it('each caller gets exactly the rows it would have got alone (no list leaks into another)', async () => {
    const shared = fakeFetch(venueRoutes());
    const c = clock();
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: shared.impl, now: c.now });
    const positioning = await service.summary(POSITIONING);
    const kpis = await service.summary(KPIS);
    const alone = async (list: typeof KPIS) =>
      new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: fakeFetch(venueRoutes()).impl, now: () => 1_000 }).summary(list);
    expect(kpis).toEqual(await alone(KPIS));
    expect(positioning).toEqual(await alone(POSITIONING));
    expect(kpis.rows.map((r) => r.id)).toEqual(['BTCUSDT']);
  });

  it('after the TTL the snapshot is read again, once', async () => {
    const { impl, calls } = fakeFetch(venueRoutes());
    const c = clock();
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, now: c.now });
    await service.summary(KPIS);
    c.advance(CACHE_TTL_MS);
    await service.summary(POSITIONING);
    await service.summary(KPIS);
    expect(count(calls, '/ticker/24hr')).toBe(2);
  });

  it('concurrent first callers with different lists share one snapshot request', async () => {
    const { impl, calls } = fakeFetch(venueRoutes());
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, now: () => 1_000 });
    await Promise.all([service.summary(POSITIONING), service.summary(KPIS), service.summary(PICKER)]);
    expect(count(calls, '/ticker/24hr')).toBe(1);
    expect(count(calls, 'openInterestHist')).toBe(3); // BTC once, though two lists asked for it at once
  });

  it('a symbol whose OI call failed is a dash for the TTL, not retried by every caller', async () => {
    const { impl, calls } = fakeFetch(venueRoutes({
      '/futures/data/openInterestHist': (url: string) => (new URL(url).searchParams.get('symbol') === 'ETHUSDT'
        ? { status: 500, body: {} }
        : { body: (OI_1H as Array<{ symbol: string }>).map((r) => ({ ...r, symbol: 'BTCUSDT' })) }),
    }));
    const service = new UniverseSummaryService({ futuresBaseUrl: BASE, fetchImpl: impl, now: () => 1_000 });
    const first = await service.summary(POSITIONING);
    const second = await service.summary(POSITIONING);
    expect(first.rows.find((r) => r.id === 'ETHUSDT')?.oiChangePct24h).toBeNull();
    expect(second).toEqual(first);
    expect(calls.filter((u) => u.includes('symbol=ETHUSDT'))).toHaveLength(1);
  });
});

describe('UniverseSummaryService — the slim snapshot loses nothing a caller reads (IB-BUG-026)', () => {
  it('rows equal assembleSummary over the FULL, untrimmed venue rows', async () => {
    // The service keeps only the fields assembleSummary reads; this pins that no read field was dropped.
    const { impl } = fakeFetch(venueRoutes());
    const service = new UniverseSummaryService({ futuresBaseUrl: 'https://fapi.example.test', fetchImpl: impl, now: () => 1_000 });
    const got = await service.summary(SYMBOLS);
    const oi = new Map(['BTCUSDT', 'ETHUSDT'].map((id) => [id, (OI_1H as Array<{ symbol: string }>).map((r) => OiHistRowSchema.parse({ ...r, symbol: id }))]));
    const full = assembleSummary(SYMBOLS, TICKERS.map((r) => Ticker24hRowSchema.parse(r)), PREMIUM.map((r) => PremiumIndexSummaryRowSchema.parse(r)), oi);
    expect(got.rows).toEqual(full);
    expect(got.rows[0].changePct24h).not.toBeNull();
    expect(got.rows[0].nextFundingTimeMs).not.toBeNull();
  });
});
