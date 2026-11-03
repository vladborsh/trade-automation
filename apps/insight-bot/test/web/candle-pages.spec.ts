import {
  LruCache, MAX_BARS_PER_REQUEST, SETTLE_MS, TAIL_LIMIT, barsIn, closedUntil, isTail, maxDaysFor, pageSpanMs, pagesFor,
  CANDLE_FIELDS, packCandles, reachesFormingBar, unpackCandles,
} from '../../src/web/market/candle-pages';

/** IB-063 — how a window is cut into venue pages and which part of a page may be remembered. */

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('pagesFor', () => {
  it('aligns pages to a fixed grid, so two windows that start anywhere inside one page share it', () => {
    const span = pageSpanMs('perp', '1h'); // 1500 h
    const a = pagesFor('perp', '1h', 3 * span + 10 * HOUR, 3 * span + 20 * HOUR);
    const b = pagesFor('perp', '1h', 3 * span + 400 * HOUR, 3 * span + 700 * HOUR);
    expect(a).toEqual([3 * span]);
    expect(b).toEqual([3 * span]);
  });

  it('a window across a page boundary takes both pages, oldest first', () => {
    const span = pageSpanMs('perp', '15m');
    expect(pagesFor('perp', '15m', 2 * span - HOUR, 2 * span + HOUR)).toEqual([span, 2 * span]);
  });

  it('`to` is exclusive: a window ending exactly on a boundary does not take the next page', () => {
    const span = pageSpanMs('spot', '1m');
    expect(pagesFor('spot', '1m', 0, span)).toEqual([0]);
  });

  it('spot pages are 1000 bars, perp pages 1500', () => {
    expect(pageSpanMs('spot', '1h')).toBe(1000 * HOUR);
    expect(pageSpanMs('perp', '1h')).toBe(1500 * HOUR);
  });
});

describe('closedUntil', () => {
  const span = pageSpanMs('perp', '1h');

  it('a page wholly in the past is final to its end', () => {
    expect(closedUntil('1h', 0, span, span + DAY)).toBe(span);
  });

  it('on the live edge it stops at the bar still forming', () => {
    const now = 100 * HOUR + 30 * 60_000; // half way through the bar that opened at 100 h
    expect(closedUntil('1h', 0, span, now)).toBe(100 * HOUR);
  });

  it('a bar that closed less than SETTLE_MS ago is not final yet', () => {
    expect(closedUntil('1h', 0, span, 100 * HOUR + SETTLE_MS - 1)).toBe(99 * HOUR);
    expect(closedUntil('1h', 0, span, 100 * HOUR + SETTLE_MS)).toBe(100 * HOUR);
  });

  it('never before the page start', () => {
    expect(closedUntil('1h', 10 * span, 11 * span, 10 * span + 1)).toBe(10 * span);
  });
});

describe('the request budget', () => {
  it('maxDays is the widest whole-day window the bar cap allows', () => {
    expect(maxDaysFor('1m')).toBe(7);
    expect(barsIn('1m', 0, 7 * DAY)).toBeLessThanOrEqual(MAX_BARS_PER_REQUEST);
    expect(barsIn('1m', 0, 8 * DAY)).toBeGreaterThan(MAX_BARS_PER_REQUEST);
    expect(maxDaysFor('1h')).toBe(420);
  });
});

describe('LruCache', () => {
  it('evicts the least recently USED entry, not the oldest written', () => {
    const lru = new LruCache<number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // a is now the most recent
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
    expect(lru.size).toBe(2);
  });

  it('re-setting a key replaces it without growing', () => {
    const lru = new LruCache<number>(2);
    lru.set('a', 1);
    lru.set('a', 2);
    expect(lru.size).toBe(1);
    expect(lru.get('a')).toBe(2);
  });
});

describe('IB-065: weekly pages', () => {
  const WEEK = 7 * DAY;
  const MONDAY = Date.UTC(2026, 9, 26);

  it('a 1w page starts on a Monday, not on the epoch\'s Thursday grid', () => {
    for (const start of pagesFor('perp', '1w', Date.UTC(2019, 8, 8), Date.UTC(2026, 9, 30))) {
      expect(new Date(start).getUTCDay()).toBe(1);
    }
  });

  it('the live edge of a 1w page is the forming week\'s Monday', () => {
    const [pageStart] = pagesFor('perp', '1w', MONDAY, MONDAY + WEEK);
    const end = pageStart + pageSpanMs('perp', '1w');
    expect(closedUntil('1w', pageStart, end, MONDAY + 3 * DAY)).toBe(MONDAY);
    expect(closedUntil('1w', pageStart, end, MONDAY + WEEK + SETTLE_MS)).toBe(MONDAY + WEEK);
  });

  it('3m and 5m keep the 1500-bar perp page', () => {
    expect(pageSpanMs('perp', '3m')).toBe(1500 * 180_000);
    expect(pageSpanMs('spot', '5m')).toBe(1000 * 300_000);
  });
});

describe('IB-066: the live tail', () => {
  const now = 100 * HOUR + 30 * 60_000; // half way through the 100th hour

  it('TAIL_LIMIT is the largest limit Binance documents at weight 1 ([1, 100))', () => {
    expect(TAIL_LIMIT).toBe(99);
  });

  it('is a short window reaching the forming bar', () => {
    expect(isTail('1h', 99 * HOUR, now + 1, now)).toBe(true);
    expect(isTail('1h', now - 97 * HOUR, now + 1, now)).toBe(true); // 98 bars
    expect(isTail('1h', now - 98 * HOUR, now + 1, now)).toBe(false); // 99 bars: a page
  });

  it('is not a short window that ended before the forming bar', () => {
    expect(isTail('1h', 90 * HOUR, 99 * HOUR, now)).toBe(false);
    expect(reachesFormingBar('1h', 90 * HOUR, 99 * HOUR, now)).toBe(false);
  });

  it('the bar that closed under SETTLE_MS ago still counts as forming', () => {
    const justClosed = 100 * HOUR + SETTLE_MS - 1;
    expect(reachesFormingBar('1h', 98 * HOUR, 100 * HOUR, justClosed)).toBe(true);
    expect(reachesFormingBar('1h', 98 * HOUR, 100 * HOUR, 100 * HOUR + SETTLE_MS)).toBe(false);
  });
});

describe('packCandles / unpackCandles (IB-096)', () => {
  const rows = [
    { time: 1_750_000_000, open: 104_321.17, high: 104_400.5, low: 104_100.03, close: 104_222.9, volume: 1_234.567, takerBuyVolume: 611.2 },
    { time: 1_750_003_600, open: 0.000_012_34, high: 0.000_013, low: 0.000_012, close: 0.000_012_5, volume: 9e12, takerBuyVolume: null },
    { time: 1_750_007_200, open: 1, high: 1, low: 1, close: 1, volume: 0, takerBuyVolume: 0 },
  ];

  it('round-trips every field exactly, a null taker volume included (stored as NaN, read back as null)', () => {
    expect(unpackCandles(packCandles(rows))).toEqual(rows);
    expect(unpackCandles(packCandles([]))).toEqual([]);
  });

  it('is 56 bytes a candle: one Float64Array, no objects', () => {
    const packed = packCandles(rows);
    expect(packed).toBeInstanceOf(Float64Array);
    expect(packed.byteLength).toBe(rows.length * CANDLE_FIELDS * 8);
  });
});
