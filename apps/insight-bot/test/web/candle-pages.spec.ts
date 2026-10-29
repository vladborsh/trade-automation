import {
  LruCache, MAX_BARS_PER_REQUEST, SETTLE_MS, barsIn, closedUntil, maxDaysFor, pageSpanMs, pagesFor,
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
