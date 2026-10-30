import type { EconomicEvent } from '@trade-automation/contracts';
import { TOOLTIP_MAX_WIDTH, calendarMarks, eventTimeLabel, isMarkedEvent, markAt, tooltipSide, untilLabel } from './calendar-marks';

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

describe('untilLabel (IB-067)', () => {
  const t = (key: string, p: Record<string, string | number> = {}) => `${key}:${JSON.stringify(p)}`;
  const NOW = Date.UTC(2026, 9, 29, 12, 0);
  const at = (min: number) => NOW + min * 60_000;

  it('null for an event that is due or past', () => {
    expect(untilLabel(NOW, NOW, t as never)).toBeNull();
    expect(untilLabel(at(-5), NOW, t as never)).toBeNull();
  });

  it('minutes under an hour, rounded up so it never reads «0 min»', () => {
    expect(untilLabel(NOW + 1_000, NOW, t as never)).toBe('calendar.until.minutes:{"m":1}');
    expect(untilLabel(at(45), NOW, t as never)).toBe('calendar.until.minutes:{"m":45}');
  });

  it('hours, with minutes when there are any', () => {
    expect(untilLabel(at(120), NOW, t as never)).toBe('calendar.until.hours:{"h":2}');
    expect(untilLabel(at(135), NOW, t as never)).toBe('calendar.until.hoursMinutes:{"h":2,"m":15}');
  });

  it('days and hours from a day on', () => {
    expect(untilLabel(at(51 * 60 + 10), NOW, t as never)).toBe('calendar.until.daysHours:{"d":2,"h":3}');
  });
});

describe('tooltipSide (IB-067)', () => {
  it('right of the crosshair where the widest tooltip fits', () => {
    expect(tooltipSide(100, 1000)).toEqual({ left: 112, right: null });
    expect(tooltipSide(1000 - 12 - TOOLTIP_MAX_WIDTH, 1000)).toEqual({ left: 1000 - TOOLTIP_MAX_WIDTH, right: null });
  });

  it('left of it near the right edge, where upcoming events are, hugging the crosshair', () => {
    expect(tooltipSide(1050, 1100)).toEqual({ left: null, right: 62 });
  });

  it('an unknown width (not laid out) keeps it on the right', () => {
    expect(tooltipSide(1050, 0)).toEqual({ left: 1062, right: null });
  });
});
