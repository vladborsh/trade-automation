import {
  missingRanges,
  missingSlots,
  nextPollAt,
  POLL_OFFSET_MS,
  slotForPoll,
  SLOT_MS,
  slotOf,
  slotsBetween,
} from '../src/collectors/binance-perp/slot-grid';

const utc = (h: number, m: number, s = 0) => Date.UTC(2026, 8, 28, h, m, s);

describe('the 5-minute grid', () => {
  it('floors a timestamp to its slot', () => {
    expect(slotOf(utc(12, 7, 42))).toBe(utc(12, 5));
    expect(slotOf(utc(12, 5))).toBe(utc(12, 5));
    expect(slotOf(utc(12, 4, 59))).toBe(utc(12, 0));
  });

  it('lists the slots in a range, both ends included', () => {
    expect(slotsBetween(utc(12, 0), utc(12, 12))).toEqual([utc(12, 0), utc(12, 5), utc(12, 10)]);
    expect(slotsBetween(utc(12, 0), utc(12, 0))).toEqual([utc(12, 0)]);
    expect(slotsBetween(utc(12, 10), utc(12, 0))).toEqual([]);
  });
});

describe('missingSlots', () => {
  it('finds the holes, tolerating duplicates, off-grid stamps and out-of-range values', () => {
    const present = [utc(12, 0), utc(12, 0), utc(12, 7, 30), new Date(utc(12, 20))];
    expect(missingSlots(utc(12, 0), utc(12, 15), present)).toEqual([utc(12, 10), utc(12, 15)]);
  });

  it('is empty for a complete grid, and full for an empty one', () => {
    const complete = slotsBetween(utc(12, 0), utc(12, 55));
    expect(missingSlots(utc(12, 0), utc(12, 55), complete)).toEqual([]);
    expect(missingSlots(utc(12, 0), utc(12, 55), [])).toHaveLength(12);
  });
});

describe('missingRanges', () => {
  it('collapses consecutive missing slots into one range, counting the slots in it', () => {
    // Present at :00 and :20; missing :05, :10, :15 as one run.
    expect(missingRanges(utc(12, 0), utc(12, 20), [utc(12, 0), utc(12, 20)])).toEqual([
      { from: utc(12, 5), to: utc(12, 15), expected: 3 },
    ]);
  });

  it('keeps separate runs separate', () => {
    expect(missingRanges(utc(12, 0), utc(12, 25), [utc(12, 0), utc(12, 10), utc(12, 25)])).toEqual([
      { from: utc(12, 5), to: utc(12, 5), expected: 1 },
      { from: utc(12, 15), to: utc(12, 20), expected: 2 },
    ]);
  });

  it('reports nothing for a complete grid', () => {
    expect(missingRanges(utc(12, 0), utc(12, 10), slotsBetween(utc(12, 0), utc(12, 10)))).toEqual([]);
  });

  it('covers every missing slot exactly once, across a messy hour', () => {
    const present = [utc(12, 0), utc(12, 15), utc(12, 20), utc(12, 45)];
    const ranges = missingRanges(utc(12, 0), utc(12, 55), present);
    const covered = ranges.reduce((sum, r) => sum + r.expected, 0);
    expect(covered).toBe(missingSlots(utc(12, 0), utc(12, 55), present).length);
  });
});

describe('the poll schedule (§4.1: boundary + 20 s)', () => {
  it('fires 20 s after the boundary', () => {
    expect(nextPollAt(utc(12, 0, 0))).toBe(utc(12, 0) + POLL_OFFSET_MS);
    expect(POLL_OFFSET_MS).toBe(20_000);
  });

  it('moves to the next boundary once this one has passed', () => {
    expect(nextPollAt(utc(12, 0, 20))).toBe(utc(12, 5) + POLL_OFFSET_MS);
    expect(nextPollAt(utc(12, 0, 21))).toBe(utc(12, 5) + POLL_OFFSET_MS);
    expect(nextPollAt(utc(12, 4, 59))).toBe(utc(12, 5) + POLL_OFFSET_MS);
  });

  it('never returns the same instant twice when called from the timer it scheduled', () => {
    // The guard against a zero-delay reschedule loop: strictly-after, not at-or-after.
    const first = nextPollAt(utc(12, 0, 0));
    expect(nextPollAt(first)).toBe(first + SLOT_MS);
  });

  it('collects the slot that just closed', () => {
    expect(slotForPoll(utc(12, 5, 20))).toBe(utc(12, 5));
  });
});
