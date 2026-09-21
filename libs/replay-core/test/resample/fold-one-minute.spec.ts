import { Candle } from '@trade-automation/contracts';
import { foldOneMinute } from '../../src/resample/fold-one-minute';

const MIN = 60_000;

function bar1m(openTime: number, o: number, h: number, l: number, c: number, v = 1): Candle {
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

describe('foldOneMinute (architecture/backtest-app-system-design.md §2.1, §5.1)', () => {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);

  it('closes a tf bar and reports no forming bar when upToMs lands exactly on a tf boundary', () => {
    const bars = [0, 1, 2, 3, 4].map((i) => bar1m(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i));
    const { closed, forming } = foldOneMinute(bars, '5m', base + 5 * MIN);

    expect(forming).toBeNull();
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      timeframe: '5m',
      openTime: base,
      open: 100,
      close: 101 + 4,
      high: 105 + 4,
      low: 95,
      closed: true,
    });
  });

  it('produces a forming bar for a mid-bar cursor, without closing it', () => {
    const bars = [0, 1, 2].map((i) => bar1m(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i));
    const { closed, forming } = foldOneMinute(bars, '5m', base + 3 * MIN);

    expect(closed).toHaveLength(0);
    expect(forming).toMatchObject({
      timeframe: '5m',
      openTime: base,
      open: 100,
      close: 101 + 2,
      high: 105 + 2,
      low: 95,
      closed: false,
    });
  });

  it('ignores 1m candles whose interval is not yet fully revealed at upToMs', () => {
    const bars = [0, 1].map((i) => bar1m(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i));
    // upToMs sits inside minute index 1's interval (not yet closed at upToMs)
    const { forming } = foldOneMinute(bars, '5m', base + MIN + 30_000);

    expect(forming).toMatchObject({ openTime: base, close: 101 }); // only minute 0 folded in
  });

  it('returns no forming bar when nothing has arrived yet for the bucket containing the cursor', () => {
    // an empty stretch precedes upToMs: the last revealed 1m candle belongs to an earlier bucket
    const bars = [bar1m(base, 100, 105, 95, 101)];
    const { closed, forming } = foldOneMinute(bars, '5m', base + 20 * MIN);

    expect(closed).toHaveLength(0);
    expect(forming).toBeNull();
  });

  it('tf=1m: closed is exactly the fully-revealed 1m candles, forming is always null', () => {
    const bars = [0, 1, 2].map((i) => bar1m(base + i * MIN, 100 + i, 105 + i, 95 + i, 101 + i));
    const { closed, forming } = foldOneMinute(bars, '1m', base + 2 * MIN);

    expect(closed).toHaveLength(2);
    expect(forming).toBeNull();
  });
});
