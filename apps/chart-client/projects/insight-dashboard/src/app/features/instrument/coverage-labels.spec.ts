import { describe, expect, it } from 'vitest';
import { joinedCoverage, joinedUnavailable, noAnswerLabel, seriesStartLabel, utcDate } from './coverage-labels';

/**
 * IB-081 — the labels a panel shows from what the server said. Each case is built to disagree with
 * a careless reading: `coverageFrom` alone is not truncation, an empty list is not a failure, and
 * the joined series' start is not the later read's.
 */
const OCT_5 = Date.UTC(2026, 9, 5, 13, 30) / 1000;

describe('seriesStartLabel (OI, long/short)', () => {
  it('truncated with a start: «данные с <date>», the UTC day', () => {
    expect(seriesStartLabel({ coverageFrom: OCT_5, truncated: true })).toEqual({ key: 'instrument.coverage.from', params: { date: '2026-10-05' } });
  });

  it('coverageFrom WITHOUT truncated shows nothing: the server stating where the answer starts is not news', () => {
    expect(seriesStartLabel({ coverageFrom: OCT_5 })).toBeNull();
    expect(seriesStartLabel({ coverageFrom: OCT_5, truncated: false })).toBeNull();
  });

  it('no fields at all (the tape-backed route, a full window) shows nothing', () => {
    expect(seriesStartLabel({})).toBeNull();
    expect(seriesStartLabel(undefined)).toBeNull();
  });

  it('truncated without a start shows nothing rather than an invented date', () => {
    expect(seriesStartLabel({ truncated: true })).toBeNull();
  });
});

describe('noAnswerLabel (funding)', () => {
  it('names the venues that did not answer, as the server names them', () => {
    expect(noAnswerLabel(['bybit', 'okx'])).toEqual({ key: 'instrument.coverage.noAnswer', params: { venues: 'Bybit, OKX' } }); // IB-BUG-033: names, not keys
  });

  it('absent or empty means every venue answered: nothing to say', () => {
    expect(noAnswerLabel(undefined)).toBeNull();
    expect(noAnswerLabel([])).toBeNull();
  });

  it('a venue named twice is said once', () => {
    expect(noAnswerLabel(['okx', 'okx'])?.params['venues']).toBe('OKX');
  });
});

describe('utcDate', () => {
  it('is the UTC day, not the local one, at the edge of midnight', () => {
    expect(utcDate(Date.UTC(2026, 9, 4, 23, 59, 59) / 1000)).toBe('2026-10-04');
    expect(utcDate(Date.UTC(2026, 9, 5, 0, 0, 0) / 1000)).toBe('2026-10-05');
  });
});

describe('joinedCoverage (scrolling left joins an earlier read)', () => {
  it('the earlier read reached its whole window: no truncation, whatever the later read said', () => {
    expect(joinedCoverage({}, 100)).toEqual({});
    expect(joinedCoverage(undefined, 100)).toEqual({});
  });

  it('the earlier read was truncated: the joined series begins at its first point', () => {
    expect(joinedCoverage({ coverageFrom: 500, truncated: true }, 520)).toEqual({ coverageFrom: 520, truncated: true });
  });

  it('a wholly empty earlier read states the retention edge; the label must say where the DRAWN series begins', () => {
    // the earlier window is before retention: the server says "from the edge" (900), but the first
    // point drawn is the later read's (1000)
    expect(joinedCoverage({ coverageFrom: 900, truncated: true }, 1000)).toEqual({ coverageFrom: 1000, truncated: true });
  });

  it('with nothing drawn at all, it falls back to what the server stated', () => {
    expect(joinedCoverage({ coverageFrom: 900, truncated: true }, undefined)).toEqual({ coverageFrom: 900, truncated: true });
  });
});

describe('joinedUnavailable (funding over two reads)', () => {
  it('a venue missing from either read is missing from part of what is drawn', () => {
    expect(joinedUnavailable(['okx'], ['bybit', 'okx'])).toEqual(['okx', 'bybit']);
  });

  it('both answered in full: still absent, so "everyone answered" stays the absence of the field', () => {
    expect(joinedUnavailable(undefined, [])).toBeUndefined();
    expect(joinedUnavailable([], undefined)).toBeUndefined();
  });
});
