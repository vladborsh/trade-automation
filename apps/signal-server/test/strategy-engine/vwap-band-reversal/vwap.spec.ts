import { computeVwapBand } from '../../../src/strategy-engine/strategies/vwap-band-reversal/indicators/vwap';
import { bar } from './test-helpers';

const MIN = 60_000;

describe('vwap-band-reversal VWAP band (knowledge/vwap-band-reversal-ict.md §1)', () => {
  it('computes cumulative VWAP and a population-stdev band, hand-verified over 3 bars', () => {
    // bar1: close=10, vol=2 -> cumValue=20, cumVol=2, vwap=10, deviation=0
    // bar2: close=12, vol=1 -> cumValue=32, cumVol=3, vwap=32/3=10.6667, deviation=1.3333
    // bar3: close=8,  vol=1 -> cumValue=40, cumVol=4, vwap=10, deviation=-2
    const bars = [
      bar(0 * MIN, { open: 10, high: 10, low: 10, close: 10 }, 2),
      bar(1 * MIN, { open: 12, high: 12, low: 12, close: 12 }, 1),
      bar(2 * MIN, { open: 8, high: 8, low: 8, close: 8 }, 1),
    ];

    const result = computeVwapBand(bars);

    expect(result.nBias).toBe(3);
    expect(result.vwap).toBeCloseTo(10, 10);

    // deviations (close_i - vwap_i, vwap as-of bar i) = [0, 12 - 32/3, -2]
    const deviations = [0, 12 - 32 / 3, -2];
    const mean = deviations.reduce((acc, v) => acc + v, 0) / deviations.length;
    const variance = deviations.reduce((acc, v) => acc + (v - mean) ** 2, 0) / deviations.length;
    const stdev = Math.sqrt(variance);

    expect(result.vwapTop).toBeCloseTo(10 + stdev, 10);
    expect(result.vwapBottom).toBeCloseTo(10 - stdev, 10);
  });

  it('reports no band for an empty window', () => {
    expect(computeVwapBand([])).toEqual({ nBias: 0 });
  });

  it('reports no band on zero cumulative volume (guard, not an expected path)', () => {
    const bars = [bar(0, { open: 10, high: 10, low: 10, close: 10 }, 0)];
    const result = computeVwapBand(bars);
    expect(result.vwap).toBeUndefined();
    expect(result.vwapTop).toBeUndefined();
    expect(result.vwapBottom).toBeUndefined();
  });
});
