import type { EconomicEvent } from '@trade-automation/contracts';
import { calendarMarks, eventTimeLabel, isMarkedEvent, markAt } from './calendar-marks';

const D0 = Date.UTC(2026, 9, 28) / 1000; // Wednesday 2026-10-28 00:00 UTC
const M15 = 900;

function ev(over: Partial<EconomicEvent>): EconomicEvent {
  return {
    id: 'ff:1:2026-10-28', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
    country: 'USD', impact: 'high', scheduledAt: (D0 + 12.5 * 3600) * 1000, scheduledDay: '2026-10-28',
    forecast: '0.3%', previous: '0.2%', actual: null, actualSource: null, actualAt: null, status: 'scheduled',
    firstSeenAt: 0, lastSeenAt: 0, revision: 1, ...over,
  };
}

const quarterHours = Array.from({ length: 96 }, (_, i) => D0 + i * M15);

describe('calendarMarks', () => {
  it('puts a high-impact USD event on the bar its instant falls in', () => {
    const at1237 = ev({ scheduledAt: (D0 + 12 * 3600 + 37 * 60) * 1000 });
    expect(calendarMarks([at1237], quarterHours, M15)).toEqual([{ time: D0 + 12.5 * 3600, events: [at1237] }]);
  });

  it('groups events of one bar into one mark, in time order', () => {
    const statement = ev({ id: 'a', title: 'FOMC Statement', scheduledAt: (D0 + 18 * 3600) * 1000 });
    const presser = ev({ id: 'b', title: 'FOMC Press Conference', scheduledAt: (D0 + 18.5 * 3600) * 1000 });
    const hourly = Array.from({ length: 24 }, (_, i) => D0 + i * 3600);
    expect(calendarMarks([presser, statement], hourly, 3600)).toEqual([
      { time: D0 + 18 * 3600, events: [statement, presser] },
    ]);
  });

  it('marks nothing for medium impact, other currencies, holidays or withdrawn events', () => {
    const skipped = [
      ev({ impact: 'medium' }), ev({ country: 'EUR' }), ev({ impact: 'holiday' }), ev({ status: 'removed' }),
    ];
    expect(skipped.some(isMarkedEvent)).toBe(false);
    expect(calendarMarks(skipped, quarterHours, M15)).toEqual([]);
  });

  it('draws no line in a data hole or past the last candle — never an off-grid slot', () => {
    const withHole = quarterHours.filter((t) => t !== D0 + 12.5 * 3600);
    expect(calendarMarks([ev({})], withHole, M15)).toEqual([]);
    expect(calendarMarks([ev({ scheduledAt: (D0 + 2 * 86_400) * 1000 })], quarterHours, M15)).toEqual([]);
  });

  it('on 1d the line sits on the day\'s bar', () => {
    const days = [D0 - 86_400, D0, D0 + 86_400];
    expect(calendarMarks([ev({})], days, 86_400).map((m) => m.time)).toEqual([D0]);
  });

  it('markAt finds the mark under the crosshair, and nothing between marks', () => {
    const marks = calendarMarks([ev({})], quarterHours, M15);
    expect(markAt(marks, D0 + 12.5 * 3600)?.events).toHaveLength(1);
    expect(markAt(marks, D0 + 12 * 3600)).toBeNull();
    expect(markAt(marks, null)).toBeNull();
  });
});

describe('eventTimeLabel', () => {
  it('is UTC to the minute, whatever the browser zone', () => {
    expect(eventTimeLabel(Date.UTC(2026, 9, 28, 12, 30, 59))).toBe('2026-10-28 12:30 UTC');
  });
});
