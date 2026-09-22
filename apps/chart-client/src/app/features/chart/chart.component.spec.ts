import { TIMEFRAME_MS } from '@trade-automation/contracts';
import { isNearOldestLoaded, logicalToTimeSec, nearestBarIndexByTime, timeSecToLogical } from './chart-time';

// architecture/scroll-back-freeze-diagnosis.md's "loadOlder() pagination trigger unreachable
// at real-data buffer depth" follow-up: the old NEAR_START_LOGICAL_INDEX check compared an
// absolute bar index against a buffer that can be up to HISTORY_LIMIT=1500 bars deep, which
// lightweight-charts' own zoom floor (minBarSpacing) makes structurally unreachable via a
// zoom-drag once the buffer exceeds ~1260-1300 bars at typical panel widths. These tests
// exercise the time-based replacement directly, asserting the invariant the fix depends on:
// the trigger fires based on elapsed calendar time from the oldest loaded bar, independent of
// how many bars happen to be in the buffer.
describe('isNearOldestLoaded', () => {
  const tf = '5m' as const;
  const barMs = TIMEFRAME_MS[tf];

  it('is false when nothing is loaded yet (oldestMs === null)', () => {
    expect(isNearOldestLoaded(1_000_000, null, tf, 5)).toBe(false);
  });

  it('fires once the visible from lands within the bar-multiplier window of the oldest bar, regardless of buffer depth', () => {
    // A shallow buffer (mock-fixture scale): oldest bar a few hundred bars back.
    const shallowOldestMs = 0;
    const nearFromSec = (shallowOldestMs + 3 * barMs) / 1000; // within a 5-bar window
    expect(isNearOldestLoaded(nearFromSec, shallowOldestMs, tf, 5)).toBe(true);

    // A deep buffer (real HISTORY_LIMIT=1500 scale): same oldest bar time, same proximity —
    // the trigger doesn't care how many bars sit between `from` and "now", only how close
    // `from` is to the panel's own oldest loaded bar.
    const deepOldestMs = shallowOldestMs; // same oldest bar, "buffer depth" is irrelevant here
    expect(isNearOldestLoaded(nearFromSec, deepOldestMs, tf, 5)).toBe(true);
  });

  it('does not fire while comfortably far from the oldest loaded bar', () => {
    const oldestMs = 0;
    const farFromSec = (oldestMs + 50 * barMs) / 1000;
    expect(isNearOldestLoaded(farFromSec, oldestMs, tf, 5)).toBe(false);
  });

  it('fires at exactly the threshold boundary and not just past it', () => {
    const oldestMs = 1_000_000;
    const atBoundarySec = (oldestMs + 5 * barMs) / 1000;
    expect(isNearOldestLoaded(atBoundarySec, oldestMs, tf, 5)).toBe(true);

    const pastBoundarySec = (oldestMs + 5 * barMs + 1) / 1000 + 1; // clearly past, in whole seconds
    expect(isNearOldestLoaded(pastBoundarySec, oldestMs, tf, 5)).toBe(false);
  });

  it('scales the window with the panel timeframe, not a fixed elapsed-time constant', () => {
    const oldestMs = 0;
    const oneHourBarMs = TIMEFRAME_MS['1h' as const];
    // 5 bars' worth of 1h time is well within a 5-bar '1h' window, but far past a 5-bar '1m'
    // window — the same elapsed calendar time should fire for the coarser timeframe (whose
    // bars are bigger) but not the finer one.
    const fromSec = (oldestMs + 5 * oneHourBarMs) / 1000;
    expect(isNearOldestLoaded(fromSec, oldestMs, '1h', 5)).toBe(true);
    expect(isNearOldestLoaded(fromSec, oldestMs, '1m', 5)).toBe(false);
  });
});

// architecture/panel-sync-and-oi-depth-diagnosis.md bug 3: lightweight-charts' visible TIME
// range clamps `to`/`from` to [first bar, last bar] (`timeRangeForLogicalRange`) and
// `setVisibleRange`'s `timeToIndex(findNearest=true)` maps any time beyond the data onto the
// nearest existing bar — so a pan past the right (or left) edge is literally unrepresentable on
// that channel: the void collapses to "the same last bar, `from` creeping rightward", which is
// exactly the desync the live repro (architecture/scratch/repro-right-edge-desync.mjs) caught.
// These two pure helpers are the fix: drive/follow on the LOGICAL range instead, converting to/
// from wall-clock seconds by extrapolating past the data at the shared timeframe.
describe('logicalToTimeSec / timeSecToLogical', () => {
  const tf = '5m' as const;
  const tfSec = TIMEFRAME_MS[tf] / 1000; // 300
  // A gapless grid: bar i at time i * tfSec.
  const gapless = Array.from({ length: 10 }, (_, i) => i * tfSec);
  // The same 10 bars, but with a multi-hour gap inserted after index 4 (e.g. a real session
  // closure) — bars 5..9 are shifted 3 hours later.
  const GAP_SEC = 3 * 60 * 60;
  const withGap = gapless.map((t, i) => (i <= 4 ? t : t + GAP_SEC));

  it('round-trips on a gapless grid, including fractional logical indices', () => {
    for (const logical of [0, 2, 2.5, 7, 9]) {
      const t = logicalToTimeSec(logical, gapless, tfSec);
      expect(timeSecToLogical(t, gapless, tfSec)).toBeCloseTo(logical, 6);
    }
  });

  it('interpolates a fractional logical index between its two neighbouring bars', () => {
    // logical 2.5 is exactly halfway between bar 2 and bar 3.
    expect(logicalToTimeSec(2.5, gapless, tfSec)).toBeCloseTo(2.5 * tfSec, 6);
  });

  it('interpolating across a multi-hour gap lands INSIDE the gap, not on a bar', () => {
    // logical 4.5 is halfway between bar 4 (pre-gap) and bar 5 (post-gap): the interpolated
    // instant must fall strictly inside the 3-hour void, not snap to either real bar.
    const t = logicalToTimeSec(4.5, withGap, tfSec);
    expect(t).toBeGreaterThan(withGap[4]);
    expect(t).toBeLessThan(withGap[5]);
    expect(t).toBeCloseTo((withGap[4] + withGap[5]) / 2, 6);
  });

  it('extrapolates beyond the last bar by the timeframe — this is the whitespace the bug could not represent', () => {
    const lastIdx = gapless.length - 1;
    expect(logicalToTimeSec(lastIdx + 4, gapless, tfSec)).toBeCloseTo(gapless[lastIdx] + 4 * tfSec, 6);
    // Inverse: a time 4 bars past the last bar maps back to logical lastIdx + 4.
    expect(timeSecToLogical(gapless[lastIdx] + 4 * tfSec, gapless, tfSec)).toBeCloseTo(lastIdx + 4, 6);
  });

  it('extrapolates before the first bar by the timeframe (left-edge whitespace)', () => {
    expect(logicalToTimeSec(-3.5, gapless, tfSec)).toBeCloseTo(gapless[0] - 3.5 * tfSec, 6);
    expect(timeSecToLogical(gapless[0] - 3.5 * tfSec, gapless, tfSec)).toBeCloseTo(-3.5, 6);
  });

  it('round-trips beyond both ends and across the gap', () => {
    for (const logical of [-5, -0.5, 4.5, lastIndexPlus(withGap, 6)]) {
      const t = logicalToTimeSec(logical, withGap, tfSec);
      expect(timeSecToLogical(t, withGap, tfSec)).toBeCloseTo(logical, 6);
    }
  });
});

function lastIndexPlus(arr: readonly number[], n: number): number {
  return arr.length - 1 + n;
}

// architecture/panel-sync-and-oi-depth-diagnosis.md bug 1's follower rule: each follower draws
// its OWN horizontal line at ITS OWN nearest bar to the driver's hovered instant, never the
// driver's price. `nearestBarIndexByTime` is the lookup that decides which bar that is.
describe('nearestBarIndexByTime', () => {
  const tf = '5m' as const;
  const tfSec = TIMEFRAME_MS[tf] / 1000;
  const times = Array.from({ length: 5 }, (_, i) => i * tfSec); // 0, 300, 600, 900, 1200

  it('returns the exact index on an exact hit', () => {
    expect(nearestBarIndexByTime(600, times)).toBe(2);
  });

  it('returns the closer of two neighbours for a time strictly between bars', () => {
    expect(nearestBarIndexByTime(600 + 50, times)).toBe(2); // closer to bar 2 (600) than bar 3 (900)
    expect(nearestBarIndexByTime(600 + 200, times)).toBe(3); // closer to bar 3 (900) than bar 2 (600)
  });

  it('clamps to index 0 before the first bar', () => {
    expect(nearestBarIndexByTime(-1000, times)).toBe(0);
  });

  it('clamps to the last index after the last bar', () => {
    expect(nearestBarIndexByTime(10_000, times)).toBe(4);
  });
});
