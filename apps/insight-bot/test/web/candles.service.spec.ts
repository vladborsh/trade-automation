import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpException, Logger } from '@nestjs/common';
import { mapRestKline, type BinanceRestKline } from '@trade-automation/binance-client';
import { WebCandleSchema, type WebMarket, type WebTimeframe } from '@trade-automation/contracts';
import { BinanceWeightTracker } from '../../src/collectors/binance-perp/binance-weight.tracker';
import { pageSpanMs } from '../../src/web/market/candle-pages';
import { CandlesService, PERP_PAGE_WEIGHT } from '../../src/web/market/candles.service';
import { timeframeMs } from '../../src/web/series/range';

/**
 * IB-063 — the chart's candles from Binance on demand.
 *
 * The venue is a fake `fetch`, but every row it serves is a copy of a REAL row: the fixture is
 * `GET /api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=1748736000000&limit=3`, captured
 * 2026-10-29 from `data-api.binance.vision` (Binance's spot market-data host, same path and shape
 * as api.binance.com, which answers 451 from the capturing machine's US egress). USD-M's
 * `/fapi/v1/klines` row is the same 12-column array (`BinanceRestKline`); it could not be captured
 * from that network, which is why the shape spec below is spot's.
 */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'binance', name), 'utf8'));

const SPOT_1H = fixture('spot-klines-1h.json') as BinanceRestKline[];
const INVALID_SYMBOL = fixture('spot-klines-invalid-symbol.json');

const HOUR = 3_600_000;
const DAY = 86_400_000;
const JUNE_2025 = Date.UTC(2025, 5, 1);
const JULY_2025 = Date.UTC(2025, 6, 1);
const NOW = Date.UTC(2026, 9, 29, 12, 30);
const LISTED = Date.UTC(2019, 8, 8); // BTCUSDT perp's first bar

describe('the kline payload (fixture)', () => {
  it('is an array of 12-column rows in the order BinanceRestKline names', () => {
    expect(SPOT_1H).toHaveLength(3);
    for (const row of SPOT_1H) {
      expect(row).toHaveLength(12);
      const [openTime, open, high, low, close, volume, closeTime, quote, trades, takerBase, takerQuote] = row;
      expect(typeof openTime).toBe('number');
      expect(closeTime).toBe(openTime + HOUR - 1);
      for (const s of [open, high, low, close, volume, quote, takerBase, takerQuote]) expect(typeof s).toBe('string');
      expect(Number.isInteger(trades)).toBe(true);
      expect(Number(high)).toBeGreaterThanOrEqual(Math.max(Number(open), Number(close), Number(low)));
      expect(Number(takerBase)).toBeLessThanOrEqual(Number(volume));
    }
    expect(SPOT_1H[0][0]).toBe(JUNE_2025);
  });

  it('maps onto the wire contract', () => {
    const c = mapRestKline('binance:BTCUSDT', SPOT_1H[0], '1h');
    expect(c).toMatchObject({ openTime: JUNE_2025, open: 104591.88, volume: 293.78295, takerBuyVolume: 131.48518 });
  });

  it('an unknown symbol is 400 with code -1121', () => {
    expect(INVALID_SYMBOL).toEqual({ code: -1121, msg: 'Invalid symbol.' });
  });
});

interface Call { path: string; params: URLSearchParams; signal: AbortSignal | undefined }

/**
 * A venue that serves a bar for every `interval` step from `LISTED` up to the bar forming at
 * `now()`, honouring `startTime`/`endTime`/`limit` as Binance does. Each row is the fixture's first
 * row with the times replaced.
 */
function fakeVenue(opts: { now: () => number; status?: (call: Call) => { status: number; body: unknown } | null; header?: number }) {
  const calls: Call[] = [];
  const impl = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = { path: url.pathname, params: url.searchParams, signal: init?.signal ?? undefined };
    calls.push(call);
    const failure = opts.status?.(call);
    const headers = { get: (n: string) => (n.toLowerCase() === 'x-mbx-used-weight-1m' && opts.header !== undefined ? String(opts.header) : null) };
    if (failure) {
      return { ok: false, status: failure.status, statusText: 'ERR', headers, json: async () => failure.body } as unknown as Response;
    }
    const tf = url.searchParams.get('interval') as WebTimeframe;
    const step = timeframeMs(tf);
    const start = Math.max(Number(url.searchParams.get('startTime')), LISTED);
    const end = Math.min(Number(url.searchParams.get('endTime')), opts.now());
    const limit = Number(url.searchParams.get('limit'));
    const rows: BinanceRestKline[] = [];
    for (let t = Math.ceil(start / step) * step; t <= end && rows.length < limit; t += step) {
      const row = [...SPOT_1H[0]] as BinanceRestKline;
      row[0] = t;
      row[6] = t + step - 1;
      rows.push(row);
    }
    return { ok: true, status: 200, statusText: 'OK', headers, json: async () => rows } as unknown as Response;
  }) as typeof fetch;
  return { impl, calls };
}

function setup(opts: { now?: number; status?: Parameters<typeof fakeVenue>[0]['status']; header?: number } = {}) {
  let now = opts.now ?? NOW;
  const clock = () => now;
  const venue = fakeVenue({ now: clock, status: opts.status, header: opts.header });
  const weight = new BinanceWeightTracker();
  const spotWeight: number[] = [];
  const service = new CandlesService({
    futuresBaseUrl: 'https://fapi.example',
    spotBaseUrl: 'https://api.example',
    weight,
    onSpotWeight: (w) => spotWeight.push(w),
    fetchImpl: venue.impl,
    now: clock,
  });
  return { service, venue, weight, spotWeight, advance: (ms: number) => { now += ms; } };
}

const wireError = (error: unknown) => ({
  status: (error as HttpException).getStatus(),
  body: (error as HttpException).getResponse() as { code: string; maxDays?: number },
});

describe('CandlesService — reading the venue', () => {
  it('1h over June 2025: 720 candles, in order, across the two aligned pages that cover it', async () => {
    const { service, venue } = setup();
    const candles = await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025);

    expect(candles).toHaveLength(720);
    expect(candles[0].time).toBe(JUNE_2025 / 1000);
    expect(candles[719].time).toBe((JULY_2025 - HOUR) / 1000);
    expect(candles.every((c, i) => i === 0 || c.time - candles[i - 1].time === 3600)).toBe(true);
    for (const c of candles.slice(0, 3)) expect(WebCandleSchema.safeParse(c).success).toBe(true);
    expect(candles[0]).toMatchObject({ open: 104591.88, takerBuyVolume: 131.48518 });

    // June 2025 straddles a 1500-hour page boundary: two requests, both aligned
    const span = pageSpanMs('perp', '1h');
    expect(venue.calls.map((c) => Number(c.params.get('startTime')) % span)).toEqual([0, 0]);
  });

  it.each<[WebTimeframe]>([['1m'], ['15m'], ['1h'], ['4h'], ['1d']])(
    '%s: interval is the timeframe, one page of 1500 bars per request, on fapi',
    async (tf) => {
      const { service, venue } = setup();
      const step = timeframeMs(tf);
      const span = pageSpanMs('perp', tf);
      const from = Math.floor(JUNE_2025 / span) * span; // one whole page
      const candles = await service.candles('perp', 'BTCUSDT', tf, from, from + 100 * step);

      expect(candles).toHaveLength(100);
      expect(venue.calls).toHaveLength(1);
      const p = venue.calls[0].params;
      expect(venue.calls[0].path).toBe('/fapi/v1/klines');
      expect(p.get('interval')).toBe(tf);
      expect(p.get('limit')).toBe('1500');
      expect(Number(p.get('endTime')) - Number(p.get('startTime'))).toBe(span - 1);
    },
  );

  it('1m for one day in 2024 crosses page boundaries and returns every minute', async () => {
    const { service, venue } = setup();
    const from = Date.UTC(2024, 2, 15);
    const candles = await service.candles('perp', 'BTCUSDT', '1m', from, from + DAY);
    expect(candles).toHaveLength(1440);
    expect(venue.calls.length).toBe(2); // 1440 minutes against 1500-minute pages
  });

  it('spot reads /api/v3/klines in pages of 1000', async () => {
    const { service, venue } = setup();
    const candles = await service.candles('spot', 'BTCUSDT', '1h', JUNE_2025, JULY_2025);
    expect(candles).toHaveLength(720);
    expect(venue.calls.every((c) => c.path === '/api/v3/klines' && c.params.get('limit') === '1000')).toBe(true);
    const span = pageSpanMs('spot', '1h');
    expect(venue.calls.map((c) => Number(c.params.get('startTime')) % span)).toEqual([0, 0]);
  });

  it('before the listing the venue has nothing, and the answer is empty — the history-start signal', async () => {
    const { service } = setup();
    expect(await service.candles('perp', 'BTCUSDT', '1h', Date.UTC(2019, 0, 1), Date.UTC(2019, 1, 1))).toEqual([]);
  });

  it('every request carries a timeout signal', async () => {
    const { service, venue } = setup();
    await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JUNE_2025 + DAY);
    await service.candles('spot', 'BTCUSDT', '1h', JUNE_2025, JUNE_2025 + DAY);
    expect(venue.calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
  });
});

describe('CandlesService — the cache', () => {
  it('a repeated window costs the venue nothing and adds no weight', async () => {
    const { service, venue, weight } = setup();
    await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025);
    const callsAfterFirst = venue.calls.length;
    const weightAfterFirst = weight.used1m(NOW);

    const again = await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025);
    expect(again).toHaveLength(720);
    expect(venue.calls).toHaveLength(callsAfterFirst);
    expect(weight.used1m(NOW)).toBe(weightAfterFirst);
  });

  it('a different window inside cached pages is a hit too (aligned pages)', async () => {
    const { service, venue } = setup();
    await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025);
    const n = venue.calls.length;
    const week = await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025 + 3 * DAY, JUNE_2025 + 10 * DAY);
    expect(week).toHaveLength(7 * 24);
    expect(venue.calls).toHaveLength(n);
  });

  it('the key includes market, symbol and timeframe', async () => {
    const { service, venue } = setup();
    await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JUNE_2025 + DAY);
    await service.candles('spot', 'BTCUSDT', '1h', JUNE_2025, JUNE_2025 + DAY);
    await service.candles('perp', 'ETHUSDT', '1h', JUNE_2025, JUNE_2025 + DAY);
    await service.candles('perp', 'BTCUSDT', '4h', JUNE_2025, JUNE_2025 + DAY);
    expect(venue.calls).toHaveLength(4);
  });

  it('the live edge is not cached: a window reaching now goes back to the venue every time', async () => {
    const { service, venue } = setup();
    const from = NOW - 2 * DAY;
    const first = await service.candles('perp', 'BTCUSDT', '1h', from, NOW + HOUR);
    expect(first[first.length - 1].time).toBe(Math.floor(NOW / HOUR) * 3600); // the forming bar is served
    const n = venue.calls.length;

    await service.candles('perp', 'BTCUSDT', '1h', from, NOW + HOUR);
    expect(venue.calls.length).toBeGreaterThan(n);
  });

  it('...but the closed part of that page is cached: an earlier window on it is a hit', async () => {
    const { service, venue } = setup();
    await service.candles('perp', 'BTCUSDT', '1d', NOW - 90 * DAY, NOW + DAY);
    const n = venue.calls.length;

    const earlier = await service.candles('perp', 'BTCUSDT', '1d', NOW - 200 * DAY, NOW - 100 * DAY);
    expect(earlier).toHaveLength(100);
    expect(venue.calls).toHaveLength(n);
  });

  it('a bar that closes later is fetched once it has closed, not served stale from the cache', async () => {
    const { service, venue, advance } = setup();
    await service.candles('perp', 'BTCUSDT', '1h', NOW - DAY, NOW + HOUR);
    advance(2 * HOUR);
    const n = venue.calls.length;
    const later = await service.candles('perp', 'BTCUSDT', '1h', NOW - DAY, NOW + 2 * HOUR);
    expect(venue.calls.length).toBeGreaterThan(n);
    expect(later[later.length - 1].time).toBe(Math.floor(NOW / HOUR) * 3600 + 2 * 3600); // 14:00, closed at 15:00
  });

  it('two charts asking for one page at once share one request', async () => {
    const { service, venue } = setup();
    await Promise.all([
      service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JUNE_2025 + DAY),
      service.candles('perp', 'BTCUSDT', '1h', JUNE_2025 + DAY, JUNE_2025 + 2 * DAY),
    ]);
    expect(venue.calls).toHaveLength(1);
  });

  it('is bounded: the least recently used page is evicted', async () => {
    const venue = fakeVenue({ now: () => NOW });
    const service = new CandlesService({
      futuresBaseUrl: 'https://fapi.example', spotBaseUrl: 'https://api.example',
      weight: new BinanceWeightTracker(), fetchImpl: venue.impl, now: () => NOW, maxPages: 2,
    });
    const span = pageSpanMs('perp', '1m');
    const page = (i: number) => service.candles('perp', 'BTCUSDT', '1m', i * span, i * span + HOUR);
    const base = Math.ceil(LISTED / span);
    await page(base);
    await page(base + 1);
    await page(base + 2); // evicts base
    expect(venue.calls).toHaveLength(3);
    await page(base + 2);
    await page(base + 1);
    expect(venue.calls).toHaveLength(3);
    await page(base);
    expect(venue.calls).toHaveLength(4);
  });
});

describe('CandlesService — weight', () => {
  it('every perp page is recorded at its documented weight, and the venue header is read', async () => {
    const { service, weight } = setup({ header: 37 });
    const bare = setup();
    await bare.service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025);
    expect(bare.weight.used1m(NOW)).toBe(2 * PERP_PAGE_WEIGHT);
    expect(bare.weight.isEstimate(NOW)).toBe(true);

    await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025);
    expect(weight.isEstimate(NOW)).toBe(false); // the venue's figure wins while fresh
    expect(weight.used1m(NOW)).toBe(37);
  });

  it('spot weight goes to spot\'s own gauge, never to the futures tracker', async () => {
    const { service, weight, spotWeight } = setup({ header: 4 });
    await service.candles('spot', 'BTCUSDT', '1h', JUNE_2025, JUNE_2025 + DAY);
    expect(spotWeight).toEqual([4]);
    expect(weight.used1m(NOW)).toBe(0);
  });

  it('above the ceiling a read that needs the venue is refused with 503; a cached read still answers', async () => {
    const { service, venue, weight } = setup();
    await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025);
    weight.recordCall(1_800, NOW);
    const n = venue.calls.length;

    const error = await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025 - 90 * DAY, JUNE_2025 - 60 * DAY).catch((e) => e);
    expect(wireError(error)).toEqual({ status: 503, body: expect.objectContaining({ code: 'VENUE_UNAVAILABLE' }) });
    expect(venue.calls).toHaveLength(n);

    await expect(service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025)).resolves.toHaveLength(720);
  });
});

describe('CandlesService — errors', () => {
  const failing = (status: number, body: unknown = { code: -1, msg: 'x' }) => () => ({ status, body });

  it.each<[number]>([[500], [502], [503], [504]])('a %s from the venue is 502 VENUE_UNAVAILABLE', async (status) => {
    const { service } = setup({ status: failing(status) });
    const error = await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025).catch((e) => e);
    expect(wireError(error)).toEqual({ status: 502, body: expect.objectContaining({ code: 'VENUE_UNAVAILABLE' }) });
  });

  it('a timeout or a dropped connection is 502, not a 500', async () => {
    for (const thrown of [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), new TypeError('fetch failed')]) {
      const service = new CandlesService({
        futuresBaseUrl: 'https://fapi.example', spotBaseUrl: 'https://api.example', weight: new BinanceWeightTracker(),
        fetchImpl: (async () => { throw thrown; }) as typeof fetch,
      });
      for (const market of ['perp', 'spot'] as WebMarket[]) {
        const error = await service.candles(market, 'BTCUSDT', '1h', JUNE_2025, JULY_2025).catch((e) => e);
        expect(wireError(error).status).toBe(502);
      }
    }
  });

  it.each<[number]>([[429], [418]])('a %s is 503 and a warning in the log', async (status) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = setup({ status: failing(status) });
    const error = await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025).catch((e) => e);
    expect(wireError(error)).toEqual({ status: 503, body: expect.objectContaining({ code: 'VENUE_UNAVAILABLE' }) });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(String(status)));
    warn.mockRestore();
  });

  it.each<[WebMarket]>([['perp'], ['spot']])('%s: Invalid symbol is an empty chart, remembered', async (market) => {
    const { service, venue } = setup({ status: (c) => (c.params.get('symbol') === 'NOPEUSDT' ? { status: 400, body: INVALID_SYMBOL } : null) });
    expect(await service.candles(market, 'NOPEUSDT', '1h', JUNE_2025, JUNE_2025 + DAY)).toEqual([]);
    expect(await service.candles(market, 'NOPEUSDT', '1h', JUNE_2025, JUNE_2025 + DAY)).toEqual([]);
    expect(venue.calls).toHaveLength(1);
  });

  it('any other 400 is not mistaken for an unknown symbol', async () => {
    const { service } = setup({ status: failing(400, { code: -1100, msg: 'Illegal characters' }) });
    const error = await service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JULY_2025).catch((e) => e);
    expect(wireError(error).status).toBe(502);
  });

  it('a failed page is not cached: the next read asks again', async () => {
    let fail = true;
    const { service, venue } = setup({ status: () => (fail ? { status: 503, body: {} } : null) });
    await expect(service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JUNE_2025 + DAY)).rejects.toBeInstanceOf(HttpException);
    fail = false;
    await expect(service.candles('perp', 'BTCUSDT', '1h', JUNE_2025, JUNE_2025 + DAY)).resolves.toHaveLength(24);
    expect(venue.calls).toHaveLength(2);
  });

  it('a window over the bar cap is 400 RANGE_TOO_WIDE before any request', async () => {
    const { service, venue } = setup();
    const error = await service.candles('perp', 'BTCUSDT', '1m', JUNE_2025, JUNE_2025 + 8 * DAY).catch((e) => e);
    expect(wireError(error)).toEqual({ status: 400, body: expect.objectContaining({ code: 'RANGE_TOO_WIDE', maxDays: 7 }) });
    expect(venue.calls).toHaveLength(0);
    await expect(service.candles('perp', 'BTCUSDT', '1m', JUNE_2025, JUNE_2025 + 7 * DAY)).resolves.toHaveLength(7 * 1440);
  });
});
