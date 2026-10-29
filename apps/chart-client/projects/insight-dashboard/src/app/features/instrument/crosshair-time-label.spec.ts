import { crosshairTimeLabel } from './crosshair-time-label';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

describe('crosshairTimeLabel', () => {
  it('weekday, date and time in Russian', () => {
    expect(crosshairTimeLabel(at(2026, 10, 29, 14, 35), 'ru', '15m')).toBe('чт 29 окт 2026 14:35');
  });

  it('weekday, date and time in English', () => {
    expect(crosshairTimeLabel(at(2026, 10, 29, 14, 35), 'en', '15m')).toBe('Thu 29 Oct 2026 14:35');
  });

  it('1d shows the date without a time', () => {
    expect(crosshairTimeLabel(at(2026, 10, 29), 'ru', '1d')).toBe('чт 29 окт 2026');
    expect(crosshairTimeLabel(at(2026, 10, 29), 'en', '1d')).toBe('Thu 29 Oct 2026');
  });

  it('IB-065: 1w shows its Monday\'s date without a time', () => {
    expect(crosshairTimeLabel(at(2026, 10, 26), 'en', '1w')).toBe('Mon 26 Oct 2026');
  });

  // Either side of a UTC midnight: any non-UTC zone in the browser running this puts one of the
  // two on the wrong day, so a label built from local time fails here wherever it runs.
  it('the weekday is the UTC one on both sides of midnight', () => {
    expect(crosshairTimeLabel(at(2026, 10, 29, 23, 45), 'en', '15m')).toBe('Thu 29 Oct 2026 23:45');
    expect(crosshairTimeLabel(at(2026, 10, 30, 0, 15), 'en', '15m')).toBe('Fri 30 Oct 2026 00:15');
    expect(crosshairTimeLabel(at(2026, 10, 30, 0, 15), 'ru', '15m')).toBe('пт 30 окт 2026 00:15');
  });

  it('the hour after midnight is 00, not 24', () => {
    expect(crosshairTimeLabel(at(2026, 11, 2, 0, 0), 'en', '1h')).toBe('Mon 2 Nov 2026 00:00');
  });

  it('ru months read as in a date, without the abbreviation full stop', () => {
    expect(crosshairTimeLabel(at(2026, 5, 1), 'ru', '1d')).toBe('пт 1 мая 2026');
    expect(crosshairTimeLabel(at(2026, 9, 1), 'ru', '1d')).toBe('вт 1 сент 2026');
  });
});
