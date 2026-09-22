import { padToBucket } from './pad-to-bucket';

const M = 60_000;
const M5 = 5 * M;
const T = Date.UTC(2026, 8, 18, 21, 0); // a Friday evening

describe('padToBucket (T-056, option A: every missing bucket from the first bar to the cursor)', () => {
  it('nothing for an unbroken, up-to-date tape, or no bars', () => {
    expect(padToBucket([{ openTime: T - M5 }, { openTime: T }], '5m', T + 4 * M)).toEqual([]);
    expect(padToBucket([{ openTime: T }], '5m', T + M5)).toEqual([]); // on the boundary: 21:00 just closed, nothing to pad
    expect(padToBucket([], '5m', T + 60 * M)).toEqual([]);
  });

  it('after a tape that ends early: one time per bucket up to and including the cursor\'s bucket', () => {
    expect(padToBucket([{ openTime: T - M5 }, { openTime: T }], '5m', T + 17 * M)).toEqual([T + M5, T + 2 * M5, T + 3 * M5]);
    expect(padToBucket([{ openTime: T }], '5m', T + 10 * M)).toEqual([T + M5]); // exclusive cursor on a boundary
  });

  it('interior gaps too: a hole between bars is padded, and stays padded once the market reopens', () => {
    const bars = [{ openTime: T }, { openTime: T + M5 }, { openTime: T + 4 * M5 }, { openTime: T + 5 * M5 }];
    expect(padToBucket(bars, '5m', T + 5 * M5 + M)).toEqual([T + 2 * M5, T + 3 * M5]);
  });

  it('a weekend at 1h: 49 buckets Friday 21:00 → Sunday 22:00, before and after the reopen', () => {
    const friday = Date.UTC(2026, 8, 18, 20, 0);
    const sunday22 = Date.UTC(2026, 8, 20, 22, 0);
    const before = padToBucket([{ openTime: friday }], '1h', sunday22); // cursor at the reopen: the 21:00 bucket is the last revealed
    expect(before[0]).toBe(friday + 3_600_000);
    expect(before.at(-1)).toBe(sunday22 - 3_600_000);
    const after = padToBucket([{ openTime: friday }, { openTime: sunday22 }], '1h', sunday22 + 3_600_000);
    expect(after).toEqual(before); // the reopened bar takes its own bucket; the weekend keeps its padding
    expect(after).toHaveLength(49);
  });

  it('a first bar off the grid still pads from its own bucket', () => {
    expect(padToBucket([{ openTime: T + 2 * M }], '5m', T + 12 * M)).toEqual([T + M5, T + 2 * M5]); // cursor 21:12 → its bucket is 21:10
  });
});
