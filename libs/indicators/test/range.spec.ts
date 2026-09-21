import { computeRange } from '../src/range';
import { bar } from './test-helpers';

const MIN = 60_000;

describe('vwap-band-reversal range (knowledge/vwap-band-reversal-ict.md §5, Researcher D-06)', () => {
  it('computes the 200-bar high/low EXCLUDING the current (last) bar', () => {
    const bars: ReturnType<typeof bar>[] = [];
    for (let i = 0; i < 200; i++) {
      // a flat series except one deliberate high/low spike inside the 200-bar window
      const isSpikeHigh = i === 50;
      const isSpikeLow = i === 75;
      bars.push(
        bar(i * MIN, {
          open: 100,
          close: 100,
          high: isSpikeHigh ? 110 : 101,
          low: isSpikeLow ? 90 : 99,
        }),
      );
    }
    // the 201st (current) bar has an extreme range that must NOT be included in top/bottom
    bars.push(bar(200 * MIN, { open: 100, high: 999, low: 1, close: 100 }));

    const result = computeRange(bars, 200);

    expect(result.rangeTop).toBe(110); // from the window, not the excluded current bar's 999
    expect(result.rangeBottom).toBe(90); // from the window, not the excluded current bar's 1
  });

  it('is undefined with fewer than length+1 bars (needs >= 201 for length=200)', () => {
    const bars: ReturnType<typeof bar>[] = [];
    for (let i = 0; i < 200; i++) {
      bars.push(bar(i * MIN, { open: 100, high: 101, low: 99, close: 100 }));
    }
    const result = computeRange(bars, 200);
    expect(result.rangeTop).toBeUndefined();
    expect(result.rangeBottom).toBeUndefined();
    expect(result.inDiscount).toBe(false);
  });

  it('priceInDiscount is close[last] < midpoint of the 200-bar window', () => {
    const bars: ReturnType<typeof bar>[] = [];
    for (let i = 0; i < 200; i++) {
      bars.push(bar(i * MIN, { open: 100, high: 110, low: 90, close: 100 })); // midpoint = 100
    }
    bars.push(bar(200 * MIN, { open: 95, high: 96, low: 94, close: 95 })); // close < 100 -> discount
    const result = computeRange(bars, 200);
    expect(result.inDiscount).toBe(true);
  });
});
