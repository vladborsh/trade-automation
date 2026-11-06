import { TickMarkType } from 'lightweight-charts';
import { axisTickLabel, crosshairTimeLabel } from './crosshair-time-label';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;
const KYIV = 'Europe/Kyiv';
const NY = 'America/New_York';

describe('crosshairTimeLabel (IB-064 weekday, IB-152 the viewer\'s zone and one format)', () => {
  it('intraday: weekday, then the site\'s `dd.MM HH:mm` in the viewer\'s zone', () => {
    expect(crosshairTimeLabel(at(2026, 11, 6, 15, 15), 'ru', '15m', 'UTC')).toBe('пт 06.11 15:15');
    expect(crosshairTimeLabel(at(2026, 11, 6, 15, 15), 'ru', '15m', KYIV)).toBe('пт 06.11 17:15');
    expect(crosshairTimeLabel(at(2026, 11, 6, 15, 15), 'en', '1m', NY)).toBe('Fri 06.11 10:15');
  });

  it('intraday: the weekday is the viewer\'s on both sides of their midnight', () => {
    // 22:30 UTC Thursday is 00:30 Friday in Kyiv
    expect(crosshairTimeLabel(at(2026, 10, 29, 22, 30), 'en', '15m', KYIV)).toBe('Fri 30.10 00:30');
    expect(crosshairTimeLabel(at(2026, 10, 29, 22, 30), 'en', '15m', 'UTC')).toBe('Thu 29.10 22:30');
  });

  it('1d / 1w: a bar is a UTC day, named by its UTC date and weekday in every zone', () => {
    const day = at(2026, 10, 29);
    for (const zone of ['UTC', KYIV, NY]) {
      expect(crosshairTimeLabel(day, 'ru', '1d', zone)).toBe('чт 29.10.2026');
      expect(crosshairTimeLabel(day, 'en', '1d', zone)).toBe('Thu 29.10.2026');
    }
    expect(crosshairTimeLabel(at(2026, 10, 26), 'en', '1w', NY)).toBe('Mon 26.10.2026');
  });

  it('the DST change moves the label, not the bar (Kyiv, 2026-10-25 01:00 UTC)', () => {
    expect(crosshairTimeLabel(at(2026, 10, 25, 0, 30), 'en', '1h', KYIV)).toBe('Sun 25.10 03:30');
    expect(crosshairTimeLabel(at(2026, 10, 25, 1, 30), 'en', '1h', KYIV)).toBe('Sun 25.10 03:30');
  });
});

describe('axisTickLabel (IB-152)', () => {
  it('a time tick is HH:mm in the viewer\'s zone', () => {
    expect(axisTickLabel(at(2026, 11, 6, 15, 0), TickMarkType.Time, '5m', 'UTC')).toBe('15:00');
    expect(axisTickLabel(at(2026, 11, 6, 15, 0), TickMarkType.Time, '5m', KYIV)).toBe('17:00');
  });

  it('a day tick sits on the UTC midnight bar: a bare date in UTC, the local time where that is not midnight', () => {
    const utcMidnight = at(2026, 11, 6);
    expect(axisTickLabel(utcMidnight, TickMarkType.DayOfMonth, '15m', 'UTC')).toBe('06.11');
    expect(axisTickLabel(utcMidnight, TickMarkType.DayOfMonth, '15m', KYIV)).toBe('06.11 02:00');
    expect(axisTickLabel(utcMidnight, TickMarkType.Month, '1h', NY)).toBe('05.11 19:00');
  });

  it('a local midnight that is not a UTC one is an ordinary 00:00', () => {
    expect(axisTickLabel(at(2026, 11, 5, 22, 0), TickMarkType.Time, '15m', KYIV)).toBe('00:00');
    // were the library to give it a day weight, it would read as the plain date
    expect(axisTickLabel(at(2026, 11, 5, 22, 0), TickMarkType.DayOfMonth, '15m', KYIV)).toBe('06.11');
  });

  it('1d / 1w ticks name the UTC day (or the year), in every zone', () => {
    for (const zone of ['UTC', KYIV, NY]) {
      expect(axisTickLabel(at(2026, 11, 6), TickMarkType.DayOfMonth, '1d', zone)).toBe('06.11');
      expect(axisTickLabel(at(2026, 1, 1), TickMarkType.Year, '1w', zone)).toBe('2026');
    }
  });
});
