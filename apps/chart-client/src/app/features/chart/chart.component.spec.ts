import { TIMEFRAME_MS } from '@trade-automation/contracts';
import { isNearOldestLoaded } from './chart.component';

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
