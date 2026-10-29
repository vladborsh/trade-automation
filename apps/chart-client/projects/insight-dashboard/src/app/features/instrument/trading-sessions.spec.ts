import { SESSIONS, sessionBands, showsSessions, zonedTimeToUtc, zoneOffsetSec } from './trading-sessions';

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
const london = SESSIONS.find((s) => s.key === 'london')!;
const newYork = SESSIONS.find((s) => s.key === 'newYork')!;

describe('zone offsets, from Intl (DST is the zone\'s own)', () => {
  it('London is UTC in winter and UTC+1 in summer', () => {
    expect(zoneOffsetSec('Europe/London', utc(2026, 1, 15, 12))).toBe(0);
    expect(zoneOffsetSec('Europe/London', utc(2026, 7, 15, 12))).toBe(3_600);
  });

  it('New York is UTC-5 in winter and UTC-4 in summer', () => {
    expect(zoneOffsetSec('America/New_York', utc(2026, 1, 15, 12))).toBe(-5 * 3_600);
    expect(zoneOffsetSec('America/New_York', utc(2026, 7, 15, 12))).toBe(-4 * 3_600);
  });
});

describe('session hours in UTC', () => {
  it('London opens 08:00 UTC in winter and 07:00 UTC in summer', () => {
    expect(zonedTimeToUtc('Europe/London', utc(2026, 1, 15), london.openMin)).toBe(utc(2026, 1, 15, 8));
    expect(zonedTimeToUtc('Europe/London', utc(2026, 7, 15), london.openMin)).toBe(utc(2026, 7, 15, 7));
    expect(zonedTimeToUtc('Europe/London', utc(2026, 7, 15), london.closeMin)).toBe(utc(2026, 7, 15, 15, 30));
  });

  it('New York opens 14:30 UTC in winter and 13:30 UTC in summer', () => {
    expect(zonedTimeToUtc('America/New_York', utc(2026, 1, 15), newYork.openMin)).toBe(utc(2026, 1, 15, 14, 30));
    expect(zonedTimeToUtc('America/New_York', utc(2026, 7, 15), newYork.openMin)).toBe(utc(2026, 7, 15, 13, 30));
  });

  it('the weeks the two zones disagree: US on summer time, UK not yet (2026-03-09 .. 03-27)', () => {
    // US DST began 2026-03-08, UK BST 2026-03-29: New York opens 13:30 UTC, London still 08:00 UTC
    expect(zonedTimeToUtc('America/New_York', utc(2026, 3, 16), newYork.openMin)).toBe(utc(2026, 3, 16, 13, 30));
    expect(zonedTimeToUtc('Europe/London', utc(2026, 3, 16), london.openMin)).toBe(utc(2026, 3, 16, 8));
  });
});

describe('sessionBands', () => {
  const hourly = (from: number, hours: number) => Array.from({ length: hours }, (_, i) => from + 3_600 * i);

  it('one band per session per weekday, from the bar the open falls in to the last bar before the close', () => {
    const bands = sessionBands(hourly(utc(2026, 1, 15), 24), 3_600); // a Thursday in winter
    expect(bands).toEqual([
      { key: 'london', colour: london.colour, first: utc(2026, 1, 15, 8), last: utc(2026, 1, 15, 16) },
      { key: 'newYork', colour: newYork.colour, first: utc(2026, 1, 15, 14), last: utc(2026, 1, 15, 20) },
    ]);
  });

  it('none on a weekend', () => {
    expect(sessionBands(hourly(utc(2026, 1, 17), 48), 3_600)).toEqual([]); // Sat + Sun
  });

  it('a session with no candles in it has no band', () => {
    const night = hourly(utc(2026, 1, 15), 6); // 00:00–05:00 UTC
    expect(sessionBands(night, 3_600)).toEqual([]);
  });

  it('band edges are candle times, so they never add a slot to the time scale', () => {
    const times = hourly(utc(2026, 7, 13), 24 * 5);
    for (const b of sessionBands(times, 3_600)) {
      expect(times).toContain(b.first);
      expect(times).toContain(b.last);
    }
  });
});

describe('showsSessions', () => {
  it('on 1m, 15m and 1h; a session is narrower than a 4h or 1d bar', () => {
    expect(['1m', '15m', '1h'].every(showsSessions)).toBe(true);
    expect(showsSessions('4h')).toBe(false);
    expect(showsSessions('1d')).toBe(false);
  });

  it('IB-065: on 3m and 5m too, not on 1w', () => {
    expect(['3m', '5m'].every(showsSessions)).toBe(true);
    expect(showsSessions('1w')).toBe(false);
  });
});
