import { Candle, CandleSource } from '@trade-automation/contracts';
import { CandleCache } from '../../src/market-data/candle-cache.service';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const INSTRUMENT = 'capitalcom:US100';

function bar(openTime: number, tf: Candle['timeframe'], source: CandleSource, close = 100): Candle {
  return {
    instrument: INSTRUMENT,
    timeframe: tf,
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    closed: true,
    source,
  };
}

describe('CandleCache (architecture/live-signal-server.md §12.1, §12.2, §12.3)', () => {
  describe('§12.1 source-priority: resampled/storage wins over venue-native in the overlap window', () => {
    it('lets a resampled bar replace an already-cached venue-native bar at the same slot', () => {
      const cache = new CandleCache();
      const openTime = Date.UTC(2026, 0, 1, 0, 0, 0);
      cache.upsert(bar(openTime, '1h', 'venue-native', 100));
      cache.upsert(bar(openTime, '1h', 'resampled', 101));

      const slot = cache.query(INSTRUMENT, '1h', openTime, openTime);
      expect(slot).toHaveLength(1);
      expect(slot[0].source).toBe('resampled');
      expect(slot[0].close).toBe(101);
    });

    it('never lets a late-arriving venue-native bar overwrite an already-resampled slot', () => {
      const cache = new CandleCache();
      const openTime = Date.UTC(2026, 0, 1, 0, 0, 0);
      cache.upsert(bar(openTime, '1h', 'resampled', 101));
      cache.upsert(bar(openTime, '1h', 'venue-native', 999)); // arrives after, must be dropped

      const slot = cache.query(INSTRUMENT, '1h', openTime, openTime);
      expect(slot).toHaveLength(1);
      expect(slot[0].source).toBe('resampled');
      expect(slot[0].close).toBe(101);
    });

    it('lets storage bars win over venue-native the same way resampled does', () => {
      const cache = new CandleCache();
      const openTime = Date.UTC(2026, 0, 1, 0, 0, 0);
      cache.upsert(bar(openTime, '1d', 'venue-native', 100));
      cache.upsert(bar(openTime, '1d', 'storage', 105));
      cache.upsert(bar(openTime, '1d', 'venue-native', 999));

      expect(cache.query(INSTRUMENT, '1d', openTime, openTime)[0]).toMatchObject({ source: 'storage', close: 105 });
    });

    it('still lets a same-tier re-fetch replace an existing bar (unchanged upsert-by-openTime behavior)', () => {
      const cache = new CandleCache();
      const openTime = Date.UTC(2026, 0, 1, 0, 0, 0);
      cache.upsert(bar(openTime, '1h', 'venue-native', 100));
      cache.upsert(bar(openTime, '1h', 'venue-native', 102)); // corrected re-fetch, same tier

      expect(cache.query(INSTRUMENT, '1h', openTime, openTime)[0].close).toBe(102);
    });
  });

  describe('§12.2 depth-bump regression', () => {
    it('holds ~800 1d bars by default (bumped from 400, margin over the 730-bar/2-year Binance target)', () => {
      const cache = new CandleCache();
      const base = Date.UTC(2020, 0, 1);
      for (let i = 0; i < 900; i++) {
        cache.upsert(bar(base + i * DAY, '1d', 'venue-native'));
      }
      const held = cache.window(INSTRUMENT, '1d');
      expect(held.length).toBeGreaterThanOrEqual(800);
      expect(held.length).toBeLessThan(900); // still bounded — not unlimited
      // the retained window is the *newest* 800+, matching the boot target (recent history first)
      expect(held[held.length - 1].openTime).toBe(base + 899 * DAY);
    });
  });

  describe('§12.3 Phase 2 backward extension must not corrupt covers() contiguity mid-run', () => {
    it('keeps covers() correct after every backward-extending page, never claiming coverage it does not have', () => {
      const cache = new CandleCache();
      const now = Date.UTC(2026, 2, 1, 0, 0, 0);
      const bootFrom = now - 3 * DAY;

      // Phase 1: 3-day boot warm-up, ascending (forward), like the real warm-up path.
      cache.setMinDepth(INSTRUMENT, '1m', (45 * DAY) / MIN);
      for (let t = bootFrom; t < now; t += MIN) {
        cache.upsert(bar(t, '1m', 'venue-rest'));
      }
      expect(cache.covers(INSTRUMENT, '1m', bootFrom)).toBe(true);
      expect(cache.covers(INSTRUMENT, '1m', bootFrom - MIN)).toBe(false);

      // Phase 2: walk backward from bootFrom towards a 45-day target, one page at a time,
      // "oldest page last" — each page strictly older than the last, upserted in that order.
      const target = now - 45 * DAY;
      const PAGE_MS = 3 * DAY;
      let pageTo = bootFrom - MIN;
      const coverageCheckpoints: { requestedFrom: number; coveredBefore: boolean }[] = [];

      while (pageTo >= target) {
        const pageFrom = Math.max(target, pageTo - PAGE_MS + MIN);

        // Before this page lands, the cache must NOT claim to cover anything older than what
        // it already holds — a request reaching into "not yet backfilled" territory must see
        // covers() === false, never a false positive.
        expect(cache.covers(INSTRUMENT, '1m', pageFrom)).toBe(false);
        coverageCheckpoints.push({ requestedFrom: pageFrom, coveredBefore: cache.covers(INSTRUMENT, '1m', pageFrom) });

        for (let t = pageFrom; t <= pageTo; t += MIN) {
          cache.upsert(bar(t, '1m', 'venue-rest'));
        }

        // Immediately after, coverage must extend exactly to this page's start — no further,
        // no less (the front of the ring buffer is the true boundary of what's covered).
        expect(cache.covers(INSTRUMENT, '1m', pageFrom)).toBe(true);
        expect(cache.window(INSTRUMENT, '1m')[0].openTime).toBe(pageFrom);

        pageTo = pageFrom - MIN;
      }

      expect(coverageCheckpoints.every((c) => c.coveredBefore === false)).toBe(true);
      expect(cache.covers(INSTRUMENT, '1m', target)).toBe(true);
      // Newest bar is still intact — backward growth never evicted the live tail.
      expect(cache.latest(INSTRUMENT, '1m')?.openTime).toBe(now - MIN);
    });

    it('would corrupt coverage without setMinDepth first (documents why IngestionService calls it)', () => {
      const cache = new CandleCache();
      const now = Date.UTC(2026, 2, 1, 0, 0, 0);
      const bootFrom = now - 3 * DAY;
      // Deliberately no setMinDepth call — default 1m depth is only 3 days' worth of bars.
      for (let t = bootFrom; t < now; t += MIN) {
        cache.upsert(bar(t, '1m', 'venue-rest'));
      }

      // One backward page beyond the default depth: the ring buffer's shift()-based eviction
      // trims the very bars this page just prepended, so coverage does NOT reliably extend.
      const pageFrom = bootFrom - 3 * DAY;
      for (let t = pageFrom; t < bootFrom; t += MIN) {
        cache.upsert(bar(t, '1m', 'venue-rest'));
      }

      expect(cache.covers(INSTRUMENT, '1m', pageFrom)).toBe(false);
    });
  });
});
