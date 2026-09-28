import { detectTimeUnit, TimeUnitError, toEpochMs } from '../src/archive/time-unit';
import { looksLikeHeader, parseCsv } from '../src/archive/csv';

/**
 * IB-012 §5 — the per-file ms/µs rule. Getting this wrong shifts a whole month of bars by a
 * factor of 1000 and the rows still look plausible, so the parser refuses rather than guesses.
 */

const MS = '1735689600000'; // 2025-01-01T00:00:00Z, 13 digits
const US = '1735689600000000'; // the same instant in a 2025-01 spot file, 16 digits

describe('detectTimeUnit', () => {
  it('reads milliseconds as 13 digits and microseconds as 16', () => {
    expect(detectTimeUnit([MS, MS])).toBe('ms');
    expect(detectTimeUnit([US, US])).toBe('us');
  });

  it('both units resolve to the same instant', () => {
    expect(toEpochMs(MS, 'ms')).toBe(toEpochMs(US, 'us'));
    expect(new Date(toEpochMs(US, 'us')).toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('refuses a file whose rows disagree rather than guessing a unit', () => {
    expect(() => detectTimeUnit([MS, US])).toThrow(TimeUnitError);
  });

  it('refuses an unknown digit count and an empty column', () => {
    expect(() => detectTimeUnit(['123456'])).toThrow(/undeterminable/);
    expect(() => detectTimeUnit([])).toThrow(/empty/);
    expect(() => detectTimeUnit(['   '])).toThrow(/empty/);
  });

  it('refuses a non-integer timestamp (a header row that slipped through)', () => {
    expect(() => detectTimeUnit(['open_time'])).toThrow(TimeUnitError);
  });
});

describe('parseCsv', () => {
  it('drops a header row, keeps a headerless file whole', () => {
    expect(parseCsv('open_time,open\n1,2\n')).toEqual([['1', '2']]);
    expect(parseCsv('1,2\n3,4')).toEqual([['1', '2'], ['3', '4']]);
  });

  it('survives a missing trailing newline and blank lines', () => {
    expect(parseCsv('1,2\n\n3,4')).toEqual([['1', '2'], ['3', '4']]);
  });

  it('a header is neither a number nor a date', () => {
    expect(looksLikeHeader(['open_time'])).toBe(true);
    expect(looksLikeHeader(['create_time'])).toBe(true);
    expect(looksLikeHeader(['1735689600000'])).toBe(false);
    expect(looksLikeHeader(['-1.5'])).toBe(false);
    // the metrics files' first column is a formatted datetime: data, not a header
    expect(looksLikeHeader(['2026-09-27 00:05:00'])).toBe(false);
  });
});
