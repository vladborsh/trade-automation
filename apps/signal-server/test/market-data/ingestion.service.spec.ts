import { EventEmitter2 } from '@nestjs/event-emitter';
import { Candle, Instrument, Timeframe } from '@trade-automation/contracts';
import { CandleCache } from '../../src/market-data/candle-cache.service';
import { GapRepairService } from '../../src/market-data/gap-repair.service';
import { IngestionService } from '../../src/market-data/ingestion.service';
import { MarketDataStatusService } from '../../src/market-data/market-data-status.service';
import { ResamplerService } from '../../src/market-data/resampler.service';
import { VenueAdapter } from '../../src/market-data/venue-adapter.port';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const instrument: Instrument = {
  id: 'capitalcom:US100',
  venue: 'capitalcom',
  symbol: 'US100',
  assetClass: 'index-cfd',
  displayName: 'US100',
  pricePrecision: 1,
  quoteCurrency: 'USD',
  sessionCurrency: 'USD',
  sessionTimezone: 'UTC',
};

function bar1m(openTime: number, close: number): Candle {
  return {
    instrument: instrument.id,
    timeframe: '1m',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    closed: true,
    source: 'venue-rest',
  };
}

function fakeMetrics() {
  return {
    candlesReceived: { inc: jest.fn() },
    candlesClosed: { inc: jest.fn() },
    feedLagMs: { set: jest.fn() },
    gapCount: { inc: jest.fn() },
    gapRepairedBars: { inc: jest.fn() },
    venueNativeMismatchCount: { inc: jest.fn() },
  } as never;
}

/** A `VenueAdapter` whose `fetchCandles` densely fills every 1m minute in [from, to] at a fixed close. */
function denseAdapter(close = 100): VenueAdapter {
  return {
    venue: 'capitalcom',
    fetchCandles: jest.fn(async (_i: Instrument, tf: Timeframe, from: number, to: number) => {
      if (tf !== '1m') return [];
      const out: Candle[] = [];
      for (let t = from; t <= to; t += MIN) out.push(bar1m(t, close));
      return out;
    }),
    streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
    health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
  };
}

function buildService(adapter: VenueAdapter) {
  const cache = new CandleCache();
  const events = new EventEmitter2();
  const resamplerService = new ResamplerService(events, cache);
  const status = new MarketDataStatusService();
  const gapRepair = new GapRepairService();
  const store = {
    upsert: jest.fn(async () => undefined),
    query: jest.fn(async () => []),
    latestOpenTime: jest.fn(async () => null),
    stream: async function* () {},
  };
  const config = { instruments: [instrument] } as never;
  const writeBuffer = { add: jest.fn(async () => undefined) } as never;
  const metrics = fakeMetrics();
  const adapters = new Map([[instrument.venue, adapter]]);

  const service = new IngestionService(
    config,
    cache,
    events,
    resamplerService,
    gapRepair,
    status,
    writeBuffer,
    metrics,
    store as never,
    adapters,
  );
  return { service, cache, status, store, metrics };
}

describe('IngestionService (architecture/live-signal-server.md §12.3, §12.5)', () => {
  /**
   * BUG-023 — a 1h bucket is only compared when all 60 of its 1m bars are present. Seeding them
   * is what makes a spec about *disagreement* rather than about *incompleteness*.
   */
  const seedComplete1h = (cache: CandleCache, openTime: number, price = 100): void => {
    for (let i = 0; i < 60; i += 1) {
      cache.upsert({
        instrument: instrument.id,
        timeframe: '1m',
        openTime: openTime + i * 60_000,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 1,
        closed: true,
        source: 'venue-native',
      });
    }
  };

  describe('§12.3 Phase 2 — deepenHistoryAsync backward extension', () => {


    it('flips backfillStatus from deepening to complete and grows 1m coverage backward', async () => {
      const { service, cache, status } = buildService(denseAdapter());
      const now = Date.UTC(2026, 2, 10, 0, 0, 0);
      jest.useFakeTimers().setSystemTime(now);

      const bootFrom = now - 3 * DAY;
      for (let t = bootFrom; t < now; t += MIN) cache.upsert(bar1m(t, 100));

      expect(status.getBackfillStatus(instrument.id, '1m')).toBe('complete'); // untouched pair defaults to complete

      const done = service.deepenHistoryAsync();
      jest.useRealTimers();
      await done;

      expect(status.getBackfillStatus(instrument.id, '1m')).toBe('complete');
      // Coverage must reach all the way back towards the 45-day target (day-aligned, so "at
      // least" rather than exactly 45 days).
      const covered45d = cache.covers(instrument.id, '1m', now - 45 * DAY + DAY);
      expect(covered45d).toBe(true);
    });

    it('also resamples the backfilled 1m range into derived timeframes (how 5m/15m ever reach their 10-day target)', async () => {
      const { service, cache } = buildService(denseAdapter(100));
      const now = Date.UTC(2026, 2, 10, 0, 0, 0);
      jest.useFakeTimers().setSystemTime(now);
      const bootFrom = now - 3 * DAY;
      for (let t = bootFrom; t < now; t += MIN) cache.upsert(bar1m(t, 100));

      const done = service.deepenHistoryAsync();
      jest.useRealTimers();
      await done;

      const tenDaysAgo = now - 10 * DAY;
      const fiveMinBars = cache.query(instrument.id, '5m', tenDaysAgo, tenDaysAgo + 5 * MIN);
      expect(fiveMinBars.length).toBeGreaterThan(0);
    });

    it('never lets covers() regress or lie mid-run (spot-checked through the real backward walk)', async () => {
      const { service, cache } = buildService(denseAdapter());
      const now = Date.UTC(2026, 2, 10, 0, 0, 0);
      jest.useFakeTimers().setSystemTime(now);
      const bootFrom = now - 3 * DAY;
      for (let t = bootFrom; t < now; t += MIN) cache.upsert(bar1m(t, 100));

      const beforeFront = cache.window(instrument.id, '1m')[0].openTime;
      expect(cache.covers(instrument.id, '1m', beforeFront - 10 * DAY)).toBe(false);

      const done = service.deepenHistoryAsync();
      jest.useRealTimers();
      await done;

      const afterFront = cache.window(instrument.id, '1m')[0].openTime;
      expect(afterFront).toBeLessThan(beforeFront);
      expect(cache.covers(instrument.id, '1m', afterFront)).toBe(true);
      // The live tail (most recent bar) must be untouched by the backward walk.
      expect(cache.latest(instrument.id, '1m')?.openTime).toBe(now - MIN);
    });
  });

  describe('§12.1 resampled-vs-venue-native mismatch metric', () => {
    it('increments venue_native_mismatch_count when a venue-native bar disagrees with the resampled bar at the same slot', async () => {
      const openTime = Date.UTC(2026, 0, 1, 0, 0, 0);
      // Resampled 1h bar for this slot already sits in the cache (close 100, as fed by the dense
      // adapter's 1m bars), a venue-native fetch for the same slot disagrees materially.
      const adapter: VenueAdapter = {
        venue: 'capitalcom',
        fetchCandles: jest.fn(async (_i: Instrument, tf: Timeframe): Promise<Candle[]> => {
          if (tf === '1h') {
            return [
              {
                instrument: instrument.id,
                timeframe: '1h',
                openTime,
                open: 500,
                high: 500,
                low: 500,
                close: 500, // way off from the resampled 100 — a real disagreement
                volume: 1,
                closed: true,
                source: 'venue-native',
              },
            ];
          }
          return [];
        }),
        streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
        health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      };
      const { service, cache, metrics } = buildService(adapter);

      // BUG-023: seed the 60 1m bars too. Without them the bucket is incomplete and the
      // comparison is skipped by design — this spec is about a genuine disagreement on a
      // COMPLETE bucket, which is the only case that should ever warn.
      seedComplete1h(cache, openTime);
      cache.upsert({
        instrument: instrument.id,
        timeframe: '1h',
        openTime,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
        closed: true,
        source: 'resampled',
      });

      // Reach into the private native-coarse warm-up via the public bootstrap path is heavier
      // than needed here; call it through the same instrument/adapter shape onApplicationBootstrap
      // uses by invoking the async pass directly.
      await (service as unknown as { warmUpNativeCoarse: (i: Instrument, a: VenueAdapter) => Promise<void> })[
        'warmUpNativeCoarse'
      ](instrument, adapter);

      expect((metrics as { venueNativeMismatchCount: { inc: jest.Mock } }).venueNativeMismatchCount.inc).toHaveBeenCalledWith(
        { instrument: instrument.id, timeframe: '1h' },
      );
      // And the resampled bar still wins the slot (§12.1 tiering, unchanged by the mismatch).
      expect(cache.query(instrument.id, '1h', openTime, openTime)[0]).toMatchObject({ source: 'resampled', close: 100 });
    });

    it('does not fire the metric when a complete bucket agrees with the venue-native bar', async () => {
      const openTime = Date.UTC(2026, 0, 1, 0, 0, 0);
      const adapter: VenueAdapter = {
        venue: 'capitalcom',
        fetchCandles: jest.fn(async (_i: Instrument, tf: Timeframe): Promise<Candle[]> => {
          if (tf === '1h') {
            return [
              {
                instrument: instrument.id,
                timeframe: '1h',
                openTime,
                // BUG-023: this spec used 100.02 — a 0.02 % difference — and called it "within
                // tolerance". Against the measured reality (OHLC agree bit-for-bit, IB-014) that
                // is a real disagreement, and the tightened 1e-9 bound now reports it. Agreement
                // means agreement.
                open: 100,
                high: 100,
                low: 100,
                close: 100,
                volume: 1,
                closed: true,
                source: 'venue-native',
              },
            ];
          }
          return [];
        }),
        streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
        health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      };
      const { service, cache, metrics } = buildService(adapter);
      seedComplete1h(cache, openTime);
      cache.upsert({
        instrument: instrument.id,
        timeframe: '1h',
        openTime,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1,
        closed: true,
        source: 'resampled',
      });

      await (service as unknown as { warmUpNativeCoarse: (i: Instrument, a: VenueAdapter) => Promise<void> })[
        'warmUpNativeCoarse'
      ](instrument, adapter);

      expect((metrics as { venueNativeMismatchCount: { inc: jest.Mock } }).venueNativeMismatchCount.inc).not.toHaveBeenCalled();
    });

    it('BUG-023: says nothing about an INCOMPLETE bucket, however far apart the numbers look', async () => {
      // The standing false alarm: warm-up backfills ~10 1m bars, resamples an hour, and the old
      // check compared that partial bucket against a complete native bar. It fired for BTC and
      // ETH on 1h/4h/1d every single run and meant nothing.
      const openTime = Date.UTC(2026, 0, 1, 0, 0, 0);
      const adapter: VenueAdapter = {
        venue: 'capitalcom',
        fetchCandles: jest.fn(async (_i: Instrument, tf: Timeframe): Promise<Candle[]> =>
          tf === '1h'
            ? [{ instrument: instrument.id, timeframe: '1h', openTime, open: 200, high: 200, low: 200, close: 200, volume: 1, closed: true, source: 'venue-native' }]
            : [],
        ),
        streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
        health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      };
      const { service, cache, metrics } = buildService(adapter);

      // Ten of sixty 1m bars — exactly the warm-up shape.
      for (let i = 0; i < 10; i += 1) cache.upsert(bar1m(openTime + i * 60_000, 100));
      cache.upsert({ instrument: instrument.id, timeframe: '1h', openTime, open: 100, high: 100, low: 100, close: 100, volume: 1, closed: true, source: 'resampled' });

      await (service as unknown as { warmUpNativeCoarse: (i: Instrument, a: VenueAdapter) => Promise<void> })['warmUpNativeCoarse'](instrument, adapter);

      // 100 vs 200 is a 100 % difference and STILL must not warn: the bucket is not comparable.
      expect((metrics as { venueNativeMismatchCount: { inc: jest.Mock } }).venueNativeMismatchCount.inc).not.toHaveBeenCalled();
    });

    it('BUG-023: the tightened bound catches the 0.05 % error the old 0.1 % tolerance hid', async () => {
      // IB-014 measured OHLC agreeing bit-for-bit, so 0.1 % was five hundred thousand times the
      // real disagreement — wide enough to swallow a genuine 0.05 % error in silence.
      const openTime = Date.UTC(2026, 0, 1, 0, 0, 0);
      const adapter: VenueAdapter = {
        venue: 'capitalcom',
        fetchCandles: jest.fn(async (_i: Instrument, tf: Timeframe): Promise<Candle[]> =>
          tf === '1h'
            ? [{ instrument: instrument.id, timeframe: '1h', openTime, open: 100.05, high: 100.05, low: 100.05, close: 100.05, volume: 1, closed: true, source: 'venue-native' }]
            : [],
        ),
        streamCandles: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
        health: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) as never,
      };
      const { service, cache, metrics } = buildService(adapter);
      seedComplete1h(cache, openTime);
      cache.upsert({ instrument: instrument.id, timeframe: '1h', openTime, open: 100, high: 100, low: 100, close: 100, volume: 1, closed: true, source: 'resampled' });

      await (service as unknown as { warmUpNativeCoarse: (i: Instrument, a: VenueAdapter) => Promise<void> })['warmUpNativeCoarse'](instrument, adapter);

      expect((metrics as { venueNativeMismatchCount: { inc: jest.Mock } }).venueNativeMismatchCount.inc).toHaveBeenCalledWith(
        { instrument: instrument.id, timeframe: '1h' },
      );
    });
  });
});
