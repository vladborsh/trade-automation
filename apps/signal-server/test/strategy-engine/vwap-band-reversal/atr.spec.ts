import { computeAtr } from '../../../src/strategy-engine/strategies/vwap-band-reversal/indicators/atr';
import { bar } from './test-helpers';

const MIN = 60_000;

describe('vwap-band-reversal ATR (knowledge/vwap-band-reversal-ict.md §7)', () => {
  it('is the arithmetic mean of the true range over the last `length` bars', () => {
    // Every bar has high-low = 2 and close chosen so |high-prevClose|/|low-prevClose| < 2,
    // so true range is always exactly 2 -> ATR(20) = 2.
    const bars = Array.from({ length: 22 }, (_, i) =>
      bar(i * MIN, { open: 100, high: 101, low: 99, close: 100 }),
    );
    expect(computeAtr(bars, 20)).toBe(2);
  });

  it('is undefined with fewer than length+1 bars', () => {
    const bars = Array.from({ length: 20 }, (_, i) => bar(i * MIN, { open: 100, high: 101, low: 99, close: 100 }));
    expect(computeAtr(bars, 20)).toBeUndefined();
  });

  it('reflects a gap: true range widened by |high - prevClose|', () => {
    const flat = Array.from({ length: 20 }, (_, i) => bar(i * MIN, { open: 100, high: 101, low: 99, close: 100 }));
    const gapBar = bar(20 * MIN, { open: 120, high: 121, low: 119, close: 120 }); // prevClose=100, |121-100|=21 dominates
    const atr = computeAtr([...flat, gapBar], 20);
    // mean of 19 true ranges of 2 plus one of 21, over 20 bars
    expect(atr).toBeCloseTo((19 * 2 + 21) / 20, 10);
  });
});
