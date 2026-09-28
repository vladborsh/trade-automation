import type { Candle1mRow } from '../../src/collectors/writers/tables';
import { AGG_TIMEFRAMES, bucketStart, compensatedSum, foldAll, foldBucket, justClosedBucket, TF_MINUTES } from '../../src/derive/bucket';

const H = 3_600_000;
const M = 60_000;
const T0 = Date.UTC(2026, 7, 1, 0, 0); // 2026-08-01T00:00Z, a UTC midnight and a 4h boundary

function bar(minute: number, over: Partial<Candle1mRow> = {}): Candle1mRow {
  return {
    venue: 'binance',
    market: 'perp',
    symbol: 'BTCUSDT',
    openTime: new Date(T0 + minute * M),
    open: 100 + minute,
    high: 110 + minute,
    low: 90 + minute,
    close: 105 + minute,
    volume: 1,
    quoteVolume: 10,
    trades: 2,
    takerBuyVolume: 0.5,
    takerBuyQuoteVolume: 5,
    source: 'archive',
    ...over,
  };
}

describe('bucketStart', () => {
  it('lands 4h buckets on 00/04/08/12/16/20 UTC, where the venue puts its own', () => {
    const at = (h: number, m = 0) => bucketStart('4h', Date.UTC(2026, 7, 1, h, m));
    expect(new Date(at(0)).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(new Date(at(3, 59)).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(new Date(at(4)).toISOString()).toBe('2026-08-01T04:00:00.000Z');
    expect(new Date(at(23, 59)).toISOString()).toBe('2026-08-01T20:00:00.000Z');
  });

  it('lands 1d buckets on UTC midnight', () => {
    expect(new Date(bucketStart('1d', Date.UTC(2026, 7, 5, 23, 59))).toISOString()).toBe('2026-08-05T00:00:00.000Z');
  });

  it('is idempotent — flooring a bucket start returns it unchanged', () => {
    for (const tf of AGG_TIMEFRAMES) {
      const start = bucketStart(tf, Date.UTC(2026, 7, 13, 7, 43));
      expect(bucketStart(tf, start)).toBe(start);
    }
  });
});

describe('justClosedBucket', () => {
  it('names the bucket that just closed, on its boundary only', () => {
    expect(justClosedBucket('1h', Date.UTC(2026, 7, 1, 5, 0))).toBe(Date.UTC(2026, 7, 1, 4, 0));
    expect(justClosedBucket('1h', Date.UTC(2026, 7, 1, 5, 1))).toBeNull();
    expect(justClosedBucket('4h', Date.UTC(2026, 7, 1, 4, 0))).toBe(Date.UTC(2026, 7, 1, 0, 0));
    expect(justClosedBucket('1d', Date.UTC(2026, 7, 2, 0, 0))).toBe(Date.UTC(2026, 7, 1, 0, 0));
  });

  it('ignores the seconds of grace the clock adds', () => {
    // the job ticks at the minute + 5 s; that must still count as the boundary
    expect(justClosedBucket('1h', Date.UTC(2026, 7, 1, 5, 0, 5))).toBe(Date.UTC(2026, 7, 1, 4, 0));
  });
});

describe('foldBucket', () => {
  it('takes open from the earliest minute and close from the latest, whatever order they arrive in', () => {
    const rows = [bar(30), bar(0), bar(59), bar(12)]; // deliberately unordered
    const folded = foldBucket(rows, '1h', T0)!;
    expect(folded.open).toBe(bar(0).open);
    expect(folded.close).toBe(bar(59).close);
    expect(folded.high).toBe(Math.max(...rows.map((r) => r.high)));
    expect(folded.low).toBe(Math.min(...rows.map((r) => r.low)));
  });

  it('sums volume, quote volume, trades and both taker fields', () => {
    const folded = foldBucket([bar(0), bar(1), bar(2)], '15m', T0)!;
    expect(folded.volume).toBe(3);
    expect(folded.quoteVolume).toBe(30);
    expect(folded.trades).toBe(6);
    expect(folded.takerBuyVolume).toBe(1.5);
    expect(folded.takerBuyQuoteVolume).toBe(15);
  });

  it('marks a bucket complete only when every minute is present', () => {
    const full = Array.from({ length: 15 }, (_, i) => bar(i));
    expect(foldBucket(full, '15m', T0)).toMatchObject({ bars: 15, complete: true });
    expect(foldBucket(full.slice(0, 14), '15m', T0)).toMatchObject({ bars: 14, complete: false });
  });

  it('ignores rows outside the bucket rather than widening the bar', () => {
    const folded = foldBucket([bar(0), bar(14), bar(15), bar(-1)], '15m', T0)!;
    expect(folded.bars).toBe(2); // minute 15 belongs to the next bucket, minute -1 to the previous
    expect(folded.close).toBe(bar(14).close);
  });

  it('keeps an absent optional field absent instead of reporting 0', () => {
    const rows = [bar(0, { takerBuyVolume: null, quoteVolume: null, trades: null }), bar(1, { takerBuyVolume: null, quoteVolume: null, trades: null })];
    const folded = foldBucket(rows, '15m', T0)!;
    expect(folded.takerBuyVolume).toBeNull();
    expect(folded.quoteVolume).toBeNull();
    expect(folded.trades).toBeNull();
  });

  it('sums the fields that ARE present when only some rows report them', () => {
    const folded = foldBucket([bar(0), bar(1, { takerBuyVolume: null })], '15m', T0)!;
    expect(folded.takerBuyVolume).toBe(0.5);
  });

  it('carries the bucket start as open_time, not the first row’s time', () => {
    const folded = foldBucket([bar(7)], '1h', T0)!;
    expect(folded.openTime.getTime()).toBe(T0);
    expect(folded.tf).toBe('1h');
  });

  it('returns null for a bucket with no rows, rather than a zero bar', () => {
    expect(foldBucket([], '1h', T0)).toBeNull();
    expect(foldBucket([bar(70)], '1h', T0)).toBeNull();
  });
});

describe('foldAll', () => {
  it('folds a day of 1m bars into the expected number of buckets per timeframe', () => {
    const day = Array.from({ length: 1440 }, (_, i) => bar(i));
    for (const tf of AGG_TIMEFRAMES) {
      const bars = foldAll(day, tf);
      expect(bars).toHaveLength(1440 / TF_MINUTES[tf]);
      expect(bars.every((b) => b.complete)).toBe(true);
    }
  });

  it('returns the buckets in time order and marks a ragged edge incomplete', () => {
    const rows = Array.from({ length: 70 }, (_, i) => bar(i)); // 1h + 10 minutes
    const bars = foldAll(rows, '1h');
    expect(bars.map((b) => b.openTime.getTime())).toEqual([T0, T0 + H]);
    expect(bars.map((b) => b.complete)).toEqual([true, false]);
    expect(bars[1].bars).toBe(10);
  });

  it('is a pure function of its input — folding twice gives identical rows', () => {
    const rows = Array.from({ length: 240 }, (_, i) => bar(i));
    expect(foldAll(rows, '4h')).toEqual(foldAll(rows, '4h'));
  });
});

describe('compensatedSum (IB-014: why the derived volume matches the venue)', () => {
  it('beats a naive sum on the classic case a naive sum gets wrong', () => {
    const values = [1e16, 1, -1e16];
    expect(values.reduce((a, b) => a + b, 0)).toBe(0); // the 1 is lost
    expect(compensatedSum(values)).toBe(1);
  });

  it('is order-independent where a naive sum is not', () => {
    const values = [0.1, 0.2, 0.3, 1e15, -1e15];
    const reversed = [...values].reverse();
    expect(compensatedSum(values)).toBe(compensatedSum(reversed));
  });

  it('sums a realistic bucket of 1m volumes exactly', () => {
    // 240 three-decimal volumes: a naive sum drifts off the exact decimal total, this does not
    const values = Array.from({ length: 240 }, (_, i) => Number(((i % 17) + 0.123).toFixed(3)));
    const exact = values.reduce((acc, v) => acc + Math.round(v * 1000), 0) / 1000;
    expect(compensatedSum(values)).toBeCloseTo(exact, 10);
  });

  it('returns 0 for no values, and the value itself for one', () => {
    expect(compensatedSum([])).toBe(0);
    expect(compensatedSum([42.5])).toBe(42.5);
  });
});
