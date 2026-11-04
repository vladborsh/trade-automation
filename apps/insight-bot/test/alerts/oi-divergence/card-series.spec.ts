import { cardOiSeries } from '../../../src/alerts/oi-divergence/card-series';

/** IB-113 (V16, V4) — the card's spark: per-bar OI from A to B, min for lows, max for highs, ≤ 30. */
const H = 3_600;
const A = 1_792_000_800; // a 1h open
// two readings per bar, owned by the bar they close (open < t ≤ open + TF): one low, one high
const points = (bars: number) => Array.from({ length: bars }, (_, i) => [
  { time: A + i * H + 1_800, oi: 100 + i },
  { time: A + (i + 1) * H, oi: 200 + i },
]).flat();

describe('cardOiSeries', () => {
  it('bullish: the per-bar MIN from A to B inclusive; bearish: the MAX', () => {
    const alert = (direction: 'bullish' | 'bearish') => ({ tf: '1h' as const, direction, a: { time: A, price: 1, oiTime: A, oi: 1 }, b: { time: A + 4 * H, price: 1, oiTime: A, oi: 1 } });
    expect(cardOiSeries(alert('bullish'), points(5))).toEqual([100, 101, 102, 103, 104]);
    expect(cardOiSeries(alert('bearish'), points(5))).toEqual([200, 201, 202, 203, 204]);
  });
  it('a bar with no reading is dropped, not drawn as zero', () => {
    const alert = { tf: '1h' as const, direction: 'bullish' as const, a: { time: A, price: 1, oiTime: A, oi: 1 }, b: { time: A + 4 * H, price: 1, oiTime: A, oi: 1 } };
    const holed = points(5).filter((p) => p.time <= A + 2 * H || p.time > A + 3 * H);
    expect(cardOiSeries(alert, holed)).toEqual([100, 101, 103, 104]);
  });
  it('a long A–B (120 bars) is sampled to 30, keeping A and B', () => {
    const alert = { tf: '1h' as const, direction: 'bullish' as const, a: { time: A, price: 1, oiTime: A, oi: 1 }, b: { time: A + 119 * H, price: 1, oiTime: A, oi: 1 } };
    const out = cardOiSeries(alert, points(120));
    expect(out).toHaveLength(30);
    expect([out[0], out[29]]).toEqual([100, 219]);
  });
});
