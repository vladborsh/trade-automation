import { Candle } from '@trade-automation/contracts';
import { Resampler } from '../../src/market-data/resampler';

function bar(openTime: number, o: number, h: number, l: number, c: number, v = 1): Candle {
  return {
    instrument: 'binance:BTCUSDT',
    timeframe: '1m',
    openTime,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
    closed: true,
    source: 'venue-stream',
  };
}

const MIN = 60_000;

describe('Resampler (architecture/live-signal-server.md §3.2, §4.1)', () => {
  it('closes a 5m bar only once a 1m candle from the next bucket arrives, aggregating OHLCV correctly', () => {
    const r = new Resampler();
    const base = Date.UTC(2026, 0, 1, 0, 0, 0); // 00:00:00 UTC, aligned to every boundary

    const results = [0, 1, 2, 3, 4, 5].map((i) =>
      r.onClosed1m(bar(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i)),
    );

    // bars 0..3 (the first 4 minutes of the 5m bucket) must not close it yet
    for (let i = 0; i < 4; i++) {
      expect(results[i].closed.find((c) => c.timeframe === '5m')).toBeUndefined();
    }
    // the 5th 1m bar (minute index 4, still bucket 0) also keeps it open;
    // the 6th (index 5, first minute of the next bucket) closes bucket 0.
    const closing5m = results[5].closed.find((c) => c.timeframe === '5m');
    expect(closing5m).toBeDefined();
    expect(closing5m!.openTime).toBe(base);
    expect(closing5m!.open).toBe(100); // bar 0's open
    expect(closing5m!.close).toBe(101 + 4); // bar 4's close
    expect(closing5m!.high).toBe(105 + 4); // max across bars 0..4
    expect(closing5m!.low).toBe(95); // min across bars 0..4
    expect(closing5m!.volume).toBe(5); // 5 bars x volume 1
    expect(closing5m!.closed).toBe(true);
    expect(closing5m!.source).toBe('resampled');
  });

  it('closes an H1/1d bar exactly on a UTC day boundary', () => {
    const r = new Resampler();
    const dayStart = Date.UTC(2026, 0, 1, 23, 59, 0); // last minute of Jan 1
    const nextDayFirstMinute = Date.UTC(2026, 0, 2, 0, 0, 0);

    r.onClosed1m(bar(dayStart, 10, 11, 9, 10));
    const { closed } = r.onClosed1m(bar(nextDayFirstMinute, 20, 21, 19, 20));

    const closed1h = closed.find((c) => c.timeframe === '1h');
    const closed1d = closed.find((c) => c.timeframe === '1d');
    expect(closed1h?.openTime).toBe(Date.UTC(2026, 0, 1, 23, 0, 0));
    expect(closed1d?.openTime).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
  });

  it('still aggregates correctly across a gap in the 1m stream (missing minutes just contribute nothing)', () => {
    const r = new Resampler();
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);

    r.onClosed1m(bar(base, 100, 110, 90, 105));
    // minutes 1..3 are missing (a gap) — resampler only ever sees what it's fed
    const { closed } = r.onClosed1m(bar(base + 5 * MIN, 200, 210, 190, 205));

    const closed5m = closed.find((c) => c.timeframe === '5m');
    expect(closed5m).toBeDefined();
    expect(closed5m!.open).toBe(100);
    expect(closed5m!.close).toBe(105); // only bar 0 was ever in this bucket
    expect(closed5m!.high).toBe(110);
    expect(closed5m!.low).toBe(90);
  });
});
