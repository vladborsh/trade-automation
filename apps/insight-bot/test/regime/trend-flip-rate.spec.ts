import { countSlopeFlips } from '../../src/regime/trend-flip-rate.cli';

/**
 * The counting rule behind the flip-rate measurement, spec'd — because the number it produces is
 * what justifies the slope having no deadband, and a measurement whose arithmetic nobody checked
 * is an assertion with a decimal point.
 */
describe('countSlopeFlips', () => {
  it('counts a sign change, not a direction', () => {
    // up for three frames, then down for three: one flip, however far it moves either way
    const values = [1, 2, 3, 4, 3, 2, 1];
    expect(countSlopeFlips(values, 1)).toEqual({ frames: 6, flips: 1, flatSlopes: 0 });
  });

  it('counts a flat slope as its own thing rather than as a direction', () => {
    // a dead-flat series is not "up" and not "down": it would be a flip at every boundary if zero
    // were folded into either sign, which is exactly the flapping the deadband question is about
    expect(countSlopeFlips([5, 5, 5, 5], 1)).toEqual({ frames: 3, flips: 0, flatSlopes: 3 });
  });

  it('measures the slope over the stated lookback, so noise inside it does not count', () => {
    // zig-zag bar to bar, but every 3-bar slope is strictly positive: one-bar noise is not a
    // trend flip. (The first version of this fixture, [1,0,2,1,3,2,4], has 3-bar slopes of exactly
    // ZERO — which the counter reports as sign changes, correctly, since a flat slope is neither
    // up nor down. The fixture was wrong, not the rule.)
    const values = [1, 0, 3, 2, 5, 4, 7];
    expect(countSlopeFlips(values, 3).flips).toBe(0);
    expect(countSlopeFlips(values, 1).flips).toBeGreaterThan(0);
  });

  it('evaluates no frames when the series is shorter than the lookback', () => {
    expect(countSlopeFlips([1, 2], 6)).toEqual({ frames: 0, flips: 0, flatSlopes: 0 });
  });
});
