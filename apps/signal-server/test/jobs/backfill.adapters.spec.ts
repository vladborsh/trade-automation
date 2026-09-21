import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Instrument } from '@trade-automation/contracts';
import { BackfillClock, backfill1m } from '../../src/jobs/backfill.job';
import { buildLiveVenueAdapter } from '../../src/market-data/venue-adapters.provider';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { StubVenueServer, startStubVenue } from './stub-venues';

/**
 * T-031 — the backfill through the REAL venue adapters (built by `buildLiveVenueAdapter`, as the
 * CLI builds them) against loopback stubs of the venues' REST endpoints. What this pins: one job
 * page is exactly one HTTP data request (so the job's 1 request/s throttle is the venue's rate),
 * with the documented page sizes, `limit=1500` for Binance (weight 10 each → 600 weight/min) and
 * `max=720` for Capital.com, and the Capital.com 404 read as the vendor floor.
 */
const MIN = 60_000;
const BTC = { id: 'binance:BTCUSDT', venue: 'binance', symbol: 'BTCUSDT', assetClass: 'crypto-perp', displayName: 'BTC', pricePrecision: 2, quoteCurrency: 'USDT', sessionCurrency: 'USD', sessionTimezone: 'UTC' } as Instrument;
const EURUSD = { id: 'capitalcom:EURUSD', venue: 'capitalcom', symbol: 'EURUSD', assetClass: 'forex-cfd', displayName: 'EUR/USD', pricePrecision: 5, quoteCurrency: 'USD', sessionCurrency: 'USD', sessionTimezone: 'UTC' } as Instrument;

/** Real time for the HTTP, a fake one for the throttle (no 1 s sleeps in the spec). */
function fakeClock(start: number): BackfillClock & { sleeps: number[] } {
  let t = start;
  const sleeps: number[] = [];
  return { sleeps, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } };
}

const env = (url: string) => ({
  BINANCE_REST_BASE_URL: url, BINANCE_WS_BASE_URL: 'ws://127.0.0.1:1',
  CAPITAL_COM_BASE_URL: url, CAPITAL_COM_IDENTIFIER: 'stub', CAPITAL_COM_PASSWORD: 'stub', CAPITAL_COM_API_KEY: 'stub',
});

describe('backfill through the real adapters, over loopback (T-031)', () => {
  let root: string;
  let stub: StubVenueServer | undefined;
  beforeEach(() => (root = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-http-'))));
  afterEach(async () => {
    await stub?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('Binance: one GET /fapi/v1/klines per page, limit=1500, 1500-minute windows, down to the listing', async () => {
    const now = Date.UTC(2026, 0, 8, 12, 0, 30);
    const listing = Date.UTC(2026, 0, 6, 0, 0);
    stub = await startStubVenue({ listingMs: listing, lastMs: now });
    const clock = fakeClock(now);
    const store = new FileCandleStore(root);

    const counts = await backfill1m(store, buildLiveVenueAdapter('binance', env(stub.url))!, BTC, {}, { clock });

    const klines = stub.requests.filter((r) => r.path === '/fapi/v1/klines');
    expect(klines).toHaveLength(counts.requests); // one HTTP request per page
    for (const r of klines) {
      expect(r.query).toMatchObject({ symbol: 'BTCUSDT', interval: '1m', limit: '1500' });
      expect(Number(r.query.endTime) - Number(r.query.startTime)).toBe(1499 * MIN);
    }
    expect(counts).toMatchObject({ stop: 'empty-page', candles: 2 * 1440 + 720, fromMs: listing, toMs: Date.UTC(2026, 0, 8, 11, 59) });
    expect(clock.sleeps.every((s) => s <= 1000)).toBe(true);
    expect((await store.query(BTC.id, '1m', 0, now)).every((c) => c.source === 'venue-rest')).toBe(true);
  });

  it('Capital.com: one session login, then one GET /prices per page with max=720; a 404 is the vendor floor', async () => {
    const now = Date.UTC(2024, 5, 5, 12, 0, 30);
    const floor = Date.UTC(2024, 5, 4, 0, 0);
    stub = await startStubVenue({ floorMs: floor, lastMs: now });
    const clock = fakeClock(now);
    const store = new FileCandleStore(root);

    const counts = await backfill1m(store, buildLiveVenueAdapter('capitalcom', env(stub.url))!, EURUSD, {}, { clock });

    expect(stub.requests.filter((r) => r.path === '/api/v1/session')).toHaveLength(1);
    const prices = stub.requests.filter((r) => r.path === '/api/v1/prices/EURUSD');
    expect(prices).toHaveLength(counts.requests);
    for (const r of prices) {
      expect(r.query).toMatchObject({ resolution: 'MINUTE', max: '720' });
      expect(Date.parse(`${r.query.to}Z`) - Date.parse(`${r.query.from}Z`)).toBe(719 * MIN);
    }
    expect(counts.stop).toBe('not-found');
    const bars = await store.query(EURUSD.id, '1m', 0, now);
    expect(bars[0].openTime).toBe(floor);
    expect(bars.at(-1)!.openTime).toBe(Date.UTC(2024, 5, 5, 11, 59));
    expect(bars).toHaveLength(1440 + 720);
  });
});
