import { barCloseAfter, isWeekend, mondayAfter, nextCursor } from '../../src/calendar/calendar';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe('calendar primitives (architecture/backtest-app-system-design.md §5.2)', () => {
  describe('barCloseAfter', () => {
    it('returns the close of the bar containing the cursor', () => {
      const base = Date.UTC(2026, 0, 1, 0, 30, 0); // 00:30 UTC, mid-bar for 1h
      expect(barCloseAfter(base, '1h')).toBe(Date.UTC(2026, 0, 1, 1, 0, 0));
    });

    it('when the cursor is exactly on a boundary, returns the close of the NEXT bar', () => {
      const onBoundary = Date.UTC(2026, 0, 1, 1, 0, 0);
      expect(barCloseAfter(onBoundary, '1h')).toBe(Date.UTC(2026, 0, 1, 2, 0, 0));
    });
  });

  describe('isWeekend', () => {
    it('is true for the whole UTC interval [Saturday 00:00, Monday 00:00)', () => {
      expect(isWeekend(Date.UTC(2026, 0, 3, 0, 0, 0))).toBe(true); // Sat 00:00
      expect(isWeekend(Date.UTC(2026, 0, 3, 23, 59, 0))).toBe(true); // Sat 23:59
      expect(isWeekend(Date.UTC(2026, 0, 4, 12, 0, 0))).toBe(true); // Sun noon
    });

    it('is false at Monday 00:00 and on weekdays', () => {
      expect(isWeekend(Date.UTC(2026, 0, 5, 0, 0, 0))).toBe(false); // Mon 00:00
      expect(isWeekend(Date.UTC(2026, 0, 7, 12, 0, 0))).toBe(false); // Wed noon
    });
  });

  describe('mondayAfter', () => {
    it('resolves a Saturday timestamp to the following Monday 00:00 UTC', () => {
      expect(mondayAfter(Date.UTC(2026, 0, 3, 15, 0, 0))).toBe(Date.UTC(2026, 0, 5, 0, 0, 0));
    });

    it('resolves a Sunday timestamp to the following Monday 00:00 UTC', () => {
      expect(mondayAfter(Date.UTC(2026, 0, 4, 23, 30, 0))).toBe(Date.UTC(2026, 0, 5, 0, 0, 0));
    });
  });

  describe('nextCursor', () => {
    const periodToMs = Date.UTC(2026, 1, 1, 0, 0, 0);

    it('a tf boundary with data at the very next bar: steps exactly one bar', () => {
      const barOpen = Date.UTC(2026, 0, 1, 0, 0, 0);
      const next = nextCursor(barOpen, '1h', false, (fromMs) => fromMs, periodToMs);
      expect(next).toBe(Date.UTC(2026, 0, 1, 1, 0, 0));
    });

    it('skips the weekend when skipWeekends is true', () => {
      // next 1h bar after Friday 23:00 opens at Friday 23:00's close -> actually the bar
      // *containing* the cursor closes at 00:00 Saturday, so its open (23:00 Fri) is not a
      // weekend; push the cursor one bar further so the candidate bar opens inside the weekend.
      const fridayLastBarOpen = Date.UTC(2026, 0, 3, 23, 0, 0); // Saturday 23:00 UTC — inside weekend
      const cursorBeforeIt = fridayLastBarOpen - HOUR; // Saturday 22:00, so barCloseAfter lands at 23:00
      const next = nextCursor(cursorBeforeIt, '1h', true, () => 0, periodToMs);
      expect(next).toBe(Date.UTC(2026, 0, 5, 1, 0, 0)); // first bar closing after Monday 00:00 UTC
    });

    it('does NOT skip the weekend when skipWeekends is false', () => {
      const saturday2200 = Date.UTC(2026, 0, 3, 22, 0, 0);
      const next = nextCursor(saturday2200, '1h', false, (fromMs) => fromMs, periodToMs);
      expect(next).toBe(Date.UTC(2026, 0, 3, 23, 0, 0));
    });

    it('jumps an empty stretch to the bar that has data', () => {
      const cursor = Date.UTC(2026, 0, 1, 0, 0, 0);
      const dataStartsAt = Date.UTC(2026, 0, 1, 5, 30, 0); // well past several empty 1h bars
      const next = nextCursor(cursor, '1h', false, () => dataStartsAt, periodToMs);
      expect(next).toBe(Date.UTC(2026, 0, 1, 6, 0, 0)); // close of the bucket containing dataStartsAt
    });

    it('returns periodToMs when the tape is exhausted (nextDataAt returns null)', () => {
      const cursor = Date.UTC(2026, 0, 1, 0, 0, 0);
      const next = nextCursor(cursor, '1h', false, () => null, periodToMs);
      expect(next).toBe(periodToMs);
    });

    it('clamps to periodToMs when the cursor is already there', () => {
      const cursor = periodToMs;
      // data exists right at the bar's open, so the loop would otherwise stop past periodToMs
      const next = nextCursor(cursor, '1h', false, (fromMs) => fromMs, periodToMs);
      expect(next).toBe(periodToMs);
    });
  });
});
