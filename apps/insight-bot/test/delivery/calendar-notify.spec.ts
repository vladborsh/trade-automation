import type { EconomicEvent } from '@trade-automation/contracts';
import { DIGEST_LATE_MS, REMIND_LATE_MS, selectDue, type SelectDueInput } from '../../src/delivery/calendar-notify';

const MIN = 60_000;
const DAY0 = Date.UTC(2026, 9, 29); // Thursday 2026-10-29, 00:00 UTC
const CPI_AT = DAY0 + (12 * 60 + 30) * MIN;

function ev(over: Partial<EconomicEvent>): EconomicEvent {
  return {
    id: 'ff:1:2026-10-29', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
    country: 'USD', impact: 'high', scheduledAt: CPI_AT, scheduledDay: '2026-10-29', forecast: '0.3%',
    previous: '0.2%', actual: null, actualSource: null, actualAt: null, status: 'scheduled',
    firstSeenAt: DAY0, lastSeenAt: DAY0, revision: 1, ...over,
  };
}

const CPI = ev({});
const CORE = ev({ id: 'ff:2:2026-10-29', seriesId: '2', title: 'Core CPI m/m' });
const LATER = ev({ id: 'ff:3:2026-10-29', seriesId: '3', title: 'FOMC Statement', scheduledAt: DAY0 + 18 * 60 * MIN });
const MEDIUM = ev({ id: 'ff:4:2026-10-29', seriesId: '4', title: 'Pending Home Sales', impact: 'medium' });
const EUR = ev({ id: 'ff:5:2026-10-29', seriesId: '5', title: 'ECB', country: 'EUR' });
const TOMORROW = ev({ id: 'ff:6:2026-10-30', seriesId: '6', title: 'GDP', scheduledAt: CPI_AT + 86_400_000 });

function input(over: Partial<SelectDueInput> = {}): SelectDueInput {
  return { events: [CPI, CORE, LATER, MEDIUM, EUR, TOMORROW], collectedToday: true, digestAtMin: 7 * 60, leadMs: 15 * MIN, ...over };
}

const AT_0700 = DAY0 + 7 * 60 * MIN;

describe('selectDue (IB-062)', () => {
  describe('digest', () => {
    it('is due from 07:00 UTC with the day\'s high-impact USD events, in time order (then by title)', () => {
      const due = selectDue(AT_0700, input(), new Set());
      expect(due).toHaveLength(1);
      expect(due[0]).toMatchObject({ kind: 'digest', key: 'digest:2026-10-29', day: '2026-10-29' });
      expect(due[0].events.map((e) => e.title)).toEqual(['Core CPI m/m', 'CPI m/m', 'FOMC Statement']);
    });

    it('is not due before its time, nor before today\'s fetch has succeeded', () => {
      expect(selectDue(AT_0700 - 1, input(), new Set())).toEqual([]);
      expect(selectDue(AT_0700, input({ collectedToday: false }), new Set())).toEqual([]);
    });

    it('goes once: a key in the journal stops it, which is what survives a restart', () => {
      expect(selectDue(AT_0700 + 5 * MIN, input(), new Set(['digest:2026-10-29']))).toEqual([]);
    });

    it('is still sent after a late restart, but not in the evening', () => {
      expect(selectDue(AT_0700 + DIGEST_LATE_MS, input(), new Set())).toHaveLength(1);
      expect(selectDue(AT_0700 + DIGEST_LATE_MS + 1, input(), new Set())).toEqual([]);
    });

    it('carries a USD holiday by its ET day, and says nothing on a day with neither', () => {
      const thanksgiving = ev({
        id: 'ff:9:2026-11-26', seriesId: '9', title: 'Bank Holiday', impact: 'holiday',
        scheduledAt: Date.parse('2026-11-26T05:00:00Z'), scheduledDay: '2026-11-26',
      });
      const at = Date.UTC(2026, 10, 26, 7, 0);
      const due = selectDue(at, input({ events: [thanksgiving] }), new Set());
      expect(due).toMatchObject([{ kind: 'digest', events: [], holidays: [{ title: 'Bank Holiday' }] }]);

      expect(selectDue(at, input({ events: [] }), new Set())).toEqual([]);
    });
  });

  describe('reminder', () => {
    const REMIND = CPI_AT - 15 * MIN;
    // today's digest already went out, so only the reminder is in question
    const DIGESTED = new Set(['digest:2026-10-29']);

    it('is due 15 minutes before, grouping events that share the instant into one key', () => {
      const due = selectDue(REMIND, input(), DIGESTED);
      expect(due).toEqual([
        { kind: 'due', key: `due:${CPI_AT}`, scheduledAt: CPI_AT, events: [CORE, CPI] },
      ]);
    });

    it('is not due a millisecond early', () => {
      expect(selectDue(REMIND - 1, input(), DIGESTED)).toEqual([]);
    });

    it('is skipped once more than 5 minutes late — the bot was down through it', () => {
      expect(selectDue(REMIND + REMIND_LATE_MS, input(), DIGESTED)).toHaveLength(1);
      expect(selectDue(REMIND + REMIND_LATE_MS + 1, input(), DIGESTED)).toEqual([]);
    });

    it('rings once: a sent key is not repeated on the next tick', () => {
      expect(selectDue(REMIND + MIN, input(), new Set([...DIGESTED, `due:${CPI_AT}`]))).toEqual([]);
    });

    it('ignores medium impact, other currencies and cancelled events', () => {
      const cancelled = ev({ id: 'ff:7:2026-10-29', title: 'Withdrawn', status: 'removed', scheduledAt: CPI_AT + 60 * MIN });
      expect(selectDue(CPI_AT - 15 * MIN, input({ events: [MEDIUM, EUR] }), DIGESTED)).toEqual([]);
      expect(selectDue(CPI_AT + 45 * MIN, input({ events: [cancelled] }), DIGESTED)).toEqual([]);
    });

    it('honours a different lead', () => {
      expect(selectDue(CPI_AT - 30 * MIN, input({ leadMs: 30 * MIN }), DIGESTED)).toHaveLength(1);
    });
  });
});
