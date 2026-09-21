import { Candle } from '@trade-automation/contracts';
import { aheadEnd, closedBarsEnd, formingRange, holesToFold, mergeBars, toCompactTuple } from '../../src/backtest/replay-window';

const H = 3_600_000;
const T0 = Date.UTC(2021, 5, 1);

const bar = (openTime: number, source: Candle['source'], close = 1): Candle => ({
  instrument: 'binance:BTCUSDT',
  timeframe: '1h',
  openTime,
  open: 1,
  high: 2,
  low: 0.5,
  close,
  volume: 3,
  closed: true,
  source,
});

describe('replay-window (backtest-app-system-design.md §5.1, §5.3)', () => {
  it('closedBarsEnd: every closed bar opens before floor(before / tfMs) * tfMs', () => {
    expect(closedBarsEnd(T0 + 90 * 60_000, '1h')).toBe(T0 + H); // mid-bar: the 01:00 bar is forming
    expect(closedBarsEnd(T0 + 2 * H, '1h')).toBe(T0 + 2 * H); // boundary: the 01:00 bar just closed
    expect(closedBarsEnd(T0 + 90 * 60_000 + 30_000, '1m')).toBe(T0 + 90 * 60_000);
  });

  it('formingRange: the cursor bucket up to before; none on a boundary, none for 1m', () => {
    expect(formingRange(T0 + 90 * 60_000, '1h')).toEqual({ from: T0 + H, to: T0 + 90 * 60_000 });
    expect(formingRange(T0 + 2 * H, '1h')).toBeNull();
    expect(formingRange(T0 + 90 * 60_000, '1m')).toBeNull();
    expect(formingRange(T0 + 90 * 60_000 + 1, '1m')).toBeNull();
  });

  describe('holesToFold', () => {
    const window = { from: T0, to: T0 + 10 * H };
    const at = (...hours: number[]) => hours.map((h) => T0 + h * H);

    it('the whole window when it holds no persisted bar', () => {
      expect(holesToFold(window, [], '1h')).toEqual([window]);
    });

    it('none when the persisted bars are contiguous across the window', () => {
      expect(holesToFold(window, at(0, 1, 2, 3, 4, 5, 6, 7, 8, 9), '1h')).toEqual([]);
    });

    it('an inner hole between two bars more than tfMs apart', () => {
      expect(holesToFold(window, at(0, 1, 2, 6, 7, 8, 9), '1h')).toEqual([{ from: T0 + 3 * H, to: T0 + 6 * H }]);
    });

    it('the head before the first bar and the tail after the last', () => {
      expect(holesToFold(window, at(3, 4, 5), '1h')).toEqual([
        { from: T0, to: T0 + 3 * H },
        { from: T0 + 6 * H, to: T0 + 10 * H },
      ]);
    });

    it('several holes, in order', () => {
      expect(holesToFold(window, at(1, 4, 8), '1h')).toEqual([
        { from: T0, to: T0 + H },
        { from: T0 + 2 * H, to: T0 + 4 * H },
        { from: T0 + 5 * H, to: T0 + 8 * H },
        { from: T0 + 9 * H, to: T0 + 10 * H },
      ]);
    });

    it('an empty window has no holes', () => {
      expect(holesToFold({ from: T0, to: T0 }, [], '1h')).toEqual([]);
    });
  });

  it('mergeBars: ascending, one per openTime, persisted (venue or resampled) wins over folded', () => {
    const merged = mergeBars([bar(T0 + H, 'venue-rest', 10), bar(T0, 'resampled', 20)], [bar(T0, 'resampled', 99), bar(T0 + 2 * H, 'resampled', 30)]);
    expect(merged.map((c) => [c.openTime, c.source, c.close])).toEqual([
      [T0, 'resampled', 20],
      [T0 + H, 'venue-rest', 10],
      [T0 + 2 * H, 'resampled', 30],
    ]);
  });

  it('aheadEnd: a 1m candle is inside the period only if it closes by periodToMs', () => {
    const periodTo = T0 + 10 * 60_000;
    const end = aheadEnd(periodTo);
    expect(T0 + 9 * 60_000 < end).toBe(true); // closes exactly at periodTo
    expect(T0 + 10 * 60_000 < end).toBe(false); // would close after it
    expect(T0 + 9 * 60_000 + 1 < aheadEnd(periodTo + 1)).toBe(true);
  });

  it('toCompactTuple: [openTime, o, h, l, c, v]', () => {
    expect(toCompactTuple(bar(T0, 'venue-rest', 1.5))).toEqual([T0, 1, 2, 0.5, 1.5, 3]);
  });
});
