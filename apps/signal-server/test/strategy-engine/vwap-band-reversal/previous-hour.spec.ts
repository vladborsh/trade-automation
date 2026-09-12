import { computePreviousHourLH } from '../../../src/strategy-engine/strategies/vwap-band-reversal/indicators/previous-hour';
import { bar } from './test-helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('vwap-band-reversal previous-hour high/low (knowledge/vwap-band-reversal-ict.md §6)', () => {
  it('scans the previous UTC clock hour, excluding the current (last) bar even when it falls in-window', () => {
    // now = 03:00:00 UTC on day 0 -> previous hour window = [02:00, 02:59]
    const dayStart = Date.UTC(2025, 0, 1, 0, 0, 0);
    const now = dayStart + 3 * HOUR;

    const bars = [
      bar(dayStart + 2 * HOUR + 0 * MIN, { open: 100, high: 105, low: 95, close: 100 }), // 02:00 — in window
      bar(dayStart + 2 * HOUR + 30 * MIN, { open: 100, high: 110, low: 90, close: 100 }), // 02:30 — in window (extremes)
      // the array's LAST element also falls in [02:00, 02:59] with even more extreme
      // high/low, but the bot's loop stops at n-2 — this bar must NOT contribute.
      bar(dayStart + 2 * HOUR + 59 * MIN, { open: 100, high: 999, low: -999, close: 100 }),
    ];

    const result = computePreviousHourLH(bars, now);

    expect(result.prevFound).toBe(true);
    expect(result.prevHigh).toBe(110); // not 999
    expect(result.prevLow).toBe(90); // not -999
    expect(result.firstBarTime).toBe(dayStart + 2 * HOUR);
  });

  it('reports not-found when no bar falls in the previous hour (a data gap)', () => {
    const dayStart = Date.UTC(2025, 0, 1, 0, 0, 0);
    const now = dayStart + 3 * HOUR;
    const bars = [
      bar(dayStart + 0 * HOUR, { open: 1, high: 1, low: 1, close: 1 }),
      bar(now, { open: 1, high: 1, low: 1, close: 1 }),
    ];
    const result = computePreviousHourLH(bars, now);
    expect(result.prevFound).toBe(false);
    expect(result.prevHigh).toBeUndefined();
    expect(result.prevLow).toBeUndefined();
  });
});
