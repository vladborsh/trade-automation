import type { EconomicEvent } from '@trade-automation/contracts';
import { CLOSED_BAND_COLOUR, closedBands, showsClosedBands } from './weekend-bands';

const H = 3600;
const FRI = Date.UTC(2026, 9, 23) / 1000; // Friday 2026-10-23 00:00 UTC
const hourly = (from: number, hours: number) => Array.from({ length: hours }, (_, i) => from + i * H);

function holiday(day: string, over: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: `ff:9:${day}`, source: 'forexfactory', seriesId: '9', sourceUrl: null, title: 'Bank Holiday',
    country: 'USD', impact: 'holiday', scheduledAt: 0, scheduledDay: day, forecast: null, previous: null,
    actual: null, actualSource: null, actualAt: null, status: 'scheduled', firstSeenAt: 0, lastSeenAt: 0,
    revision: 1, ...over,
  };
}

describe('closedBands', () => {
  it('shades Saturday 00:00 to Sunday\'s last bar, UTC', () => {
    const times = hourly(FRI, 24 * 4); // Fri..Mon
    expect(closedBands(times, '1h', [])).toEqual([
      { first: FRI + 24 * H, last: FRI + 72 * H - H, colour: CLOSED_BAND_COLOUR },
    ]);
  });

  it('a window starting on Sunday still shades the part of the weekend it holds', () => {
    const sunday = FRI + 48 * H;
    expect(closedBands(hourly(sunday, 48), '1h', [])).toEqual([
      { first: sunday, last: sunday + 23 * H, colour: CLOSED_BAND_COLOUR },
    ]);
  });

  it('shades a US holiday as the whole New York day, DST included', () => {
    // Thanksgiving 2026-11-26: EST, so 05:00 UTC to 05:00 UTC next day
    const thu = Date.UTC(2026, 10, 26) / 1000;
    const bands = closedBands(hourly(thu, 48), '1h', [holiday('2026-11-26')]);
    expect(bands).toEqual([{ first: thu + 5 * H, last: thu + 28 * H, colour: CLOSED_BAND_COLOUR }]);

    // Independence Day observed 2026-07-03 (a Friday): EDT, so 04:00 UTC onwards, and the weekend after it
    const fri = Date.UTC(2026, 6, 3) / 1000;
    const july = closedBands(hourly(fri, 24), '1h', [holiday('2026-07-03')]);
    expect(july[0]).toEqual({ first: fri + 4 * H, last: fri + 23 * H, colour: CLOSED_BAND_COLOUR });
  });

  it('ignores other currencies\' holidays and withdrawn ones', () => {
    const wed = Date.UTC(2026, 9, 28) / 1000;
    expect(closedBands(hourly(wed, 24), '1h', [holiday('2026-10-28', { country: 'EUR' }), holiday('2026-10-28', { status: 'removed' })])).toEqual([]);
  });

  it('is off on 1d and empty without candles', () => {
    expect(showsClosedBands('1d')).toBe(false);
    expect(['1m', '15m', '1h', '4h'].every(showsClosedBands)).toBe(true);
    expect(closedBands(hourly(FRI, 96), '1d', [])).toEqual([]);
    expect(closedBands([], '1h', [])).toEqual([]);
  });
});
