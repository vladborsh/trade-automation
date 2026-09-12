import { fromZonedTime } from 'date-fns-tz';
import { toZoned } from '../../../src/strategy-engine/clock';
import { isWithinEntryWindow } from '../../../src/strategy-engine/strategies/vwap-band-reversal/session';

const TZ = 'America/New_York';

/** Builds a UTC timestamp for a given NY wall-clock hh:mm on `dateIso`. */
function nyTime(dateIso: string, hh: number, mm: number): number {
  return fromZonedTime(`${dateIso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`, TZ).getTime();
}

const INSTRUMENT_WINDOWS: Record<string, readonly [string, string]> = {
  'capitalcom:US100': ['09:40', '11:40'],
  'capitalcom:US500': ['09:40', '11:40'],
  'capitalcom:EURCHF': ['03:02', '03:20'],
  'capitalcom:GBPCHF': ['03:03', '03:20'],
};

// US DST transitions always fall on a Sunday: 2025-03-09 (spring-forward, EST->EDT at
// 02:00 local) and 2025-11-02 (fall-back, EDT->EST at 02:00 local). Both dates are used below
// to pin the zoning arithmetic (toZoned) across the offset change; because they are Sundays,
// the entry-window predicate's own Mon-Fri weekday gate correctly rejects them regardless of
// the hour, which is verified separately from the offset arithmetic.
const DST_DATES = ['2025-03-09', '2025-11-02'] as const;

describe('vwap-band-reversal: ctx.clock.toZoned across the DST transition (architecture/vwap-band-reversal-plugin.md §2.5)', () => {
  for (const date of DST_DATES) {
    for (const [instrument, window] of Object.entries(INSTRUMENT_WINDOWS)) {
      describe(`${instrument} on the DST date ${date}`, () => {
        it('zones the window start back to the exact NY wall-clock hour:minute', () => {
          const [startHh, startMm] = window[0].split(':').map(Number);
          const now = nyTime(date, startHh, startMm);
          const zoned = toZoned(now, TZ);
          expect(zoned.hour).toBe(startHh);
          expect(zoned.minute).toBe(startMm);
        });

        it('zones the window end back to the exact NY wall-clock hour:minute', () => {
          const [endHh, endMm] = window[1].split(':').map(Number);
          const now = nyTime(date, endHh, endMm);
          const zoned = toZoned(now, TZ);
          expect(zoned.hour).toBe(endHh);
          expect(zoned.minute).toBe(endMm);
        });
      });
    }
  }

  it('the DST dates themselves are Sundays: the weekday gate rejects them regardless of the hour', () => {
    for (const date of DST_DATES) {
      const now = nyTime(date, 9, 40);
      expect(new Date(now).getUTCDay()).toBe(0); // Sunday
      const zoned = toZoned(now, TZ);
      expect(isWithinEntryWindow(now, zoned, ['09:40', '11:40'])).toBe(false);
    }
  });
});

describe('vwap-band-reversal isWithinEntryWindow — full predicate on weekdays adjacent to the DST transitions', () => {
  // The Monday immediately after each transition already carries the new UTC offset forward,
  // so this exercises the post-transition arithmetic through a weekday that actually passes
  // the Mon-Fri gate.
  const POST_TRANSITION_MONDAYS = ['2025-03-10', '2025-11-03'];

  for (const date of POST_TRANSITION_MONDAYS) {
    for (const [instrument, window] of Object.entries(INSTRUMENT_WINDOWS)) {
      describe(`${instrument} on ${date}`, () => {
        it('is true at the window start and end (inclusive)', () => {
          const [startHh, startMm] = window[0].split(':').map(Number);
          const [endHh, endMm] = window[1].split(':').map(Number);
          const start = nyTime(date, startHh, startMm);
          const end = nyTime(date, endHh, endMm);
          expect(isWithinEntryWindow(start, toZoned(start, TZ), window)).toBe(true);
          expect(isWithinEntryWindow(end, toZoned(end, TZ), window)).toBe(true);
        });

        it('is false just outside the window on both sides', () => {
          const [startHh, startMm] = window[0].split(':').map(Number);
          const [endHh, endMm] = window[1].split(':').map(Number);
          const before = startMm === 0 ? nyTime(date, startHh - 1, 59) : nyTime(date, startHh, startMm - 1);
          const after = endMm === 59 ? nyTime(date, endHh + 1, 0) : nyTime(date, endHh, endMm + 1);
          expect(isWithinEntryWindow(before, toZoned(before, TZ), window)).toBe(false);
          expect(isWithinEntryWindow(after, toZoned(after, TZ), window)).toBe(false);
        });
      });
    }
  }
});
