import { WEB_MAX_1M_RANGE_DAYS, WEB_MAX_POINTS } from '@trade-automation/contracts';
import { barsTouched, checkRange, DAY_MS, floorToGrid, strideFor, thin, timeframeMs } from '../../src/web/series/range';

/**
 * IB-031 §4 — the caps. The box runs Postgres and Node in 1 GB, so these are real; and the
 * distinction between refusing and thinning is what stops a chart lying about its own grain.
 */

const T0 = Date.UTC(2026, 5, 1);

describe('checkRange', () => {
  it('accepts an ordinary window', () => {
    expect(checkRange(T0, T0 + DAY_MS, '1m')).toEqual({ ok: true, fromMs: T0, toMs: T0 + DAY_MS });
  });

  it('REFUSES a 1m range over 90 days, and says what is allowed', () => {
    const result = checkRange(T0, T0 + 91 * DAY_MS, '1m');
    expect(result).toEqual({
      ok: false, code: 'RANGE_TOO_WIDE', maxDays: WEB_MAX_1M_RANGE_DAYS,
      message: expect.stringContaining('90'),
    });
  });

  it('allows exactly 90 days at 1m — the boundary is inclusive', () => {
    expect(checkRange(T0, T0 + WEB_MAX_1M_RANGE_DAYS * DAY_MS, '1m').ok).toBe(true);
  });

  it('the 90-day rule is about 1m only — coarser frames may span years', () => {
    // a year of 4h bars is ~2,190 points, well inside the cap; refusing it would be arbitrary
    expect(checkRange(T0, T0 + 365 * DAY_MS, '4h').ok).toBe(true);
    expect(checkRange(T0, T0 + 365 * DAY_MS, '1d').ok).toBe(true);
  });

  it('rejects a backwards or empty range rather than returning nothing', () => {
    expect(checkRange(T0, T0, '1h')).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(checkRange(T0 + DAY_MS, T0, '1h')).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });

  it('rejects junk instead of coercing it to an epoch', () => {
    expect(checkRange(Number.NaN, T0, '1h')).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(checkRange(T0, Number.POSITIVE_INFINITY, '1h')).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });
});

describe('strideFor', () => {
  it('is 1 when the window already fits — no thinning, no flag', () => {
    expect(strideFor(T0, T0 + 1000 * 60_000, '1m')).toBe(1);
    expect(timeframeMs('1m')).toBe(60_000);
  });

  it('grows so the result fits the cap', () => {
    const ninetyDays = 90 * DAY_MS;
    const stride = strideFor(T0, T0 + ninetyDays, '1m');
    const expected = ninetyDays / 60_000; // 129,600 minutes
    expect(Math.ceil(expected / stride)).toBeLessThanOrEqual(WEB_MAX_POINTS);
  });
});

describe('thin', () => {
  it('leaves a short series untouched and says so', () => {
    const rows = Array.from({ length: 10 }, (_, i) => i);
    expect(thin(rows, 100)).toEqual({ rows, downsampled: false });
  });

  it('thins to the cap and FLAGS it — a silent trim would let a chart lie', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => i);
    const out = thin(rows, 1_000);
    expect(out.downsampled).toBe(true);
    expect(out.rows.length).toBeLessThanOrEqual(1_001); // the cap, plus the preserved last point
  });

  it('always keeps the first and the LAST point', () => {
    // a right edge older than the requested range reads as "the data stops here"
    const rows = Array.from({ length: 9_999 }, (_, i) => i);
    const out = thin(rows, 1_000);
    expect(out.rows[0]).toBe(0);
    expect(out.rows[out.rows.length - 1]).toBe(9_998);
  });

  it('does not duplicate the last point when the stride already lands on it', () => {
    const rows = Array.from({ length: 10 }, (_, i) => i);
    const out = thin(rows, 5);
    expect(out.rows.filter((r) => r === 9)).toHaveLength(1);
  });
});

describe('IB-065: the new widths and the Monday grid', () => {
  it('3m, 5m and 1w are their Binance widths', () => {
    expect(timeframeMs('3m')).toBe(180_000);
    expect(timeframeMs('5m')).toBe(300_000);
    expect(timeframeMs('1w')).toBe(7 * DAY_MS);
  });

  it('every width up to a day keeps the epoch grid', () => {
    const t = Date.UTC(2026, 9, 29, 14, 37, 12);
    expect(floorToGrid(t, '3m')).toBe(Date.UTC(2026, 9, 29, 14, 36));
    expect(floorToGrid(t, '5m')).toBe(Date.UTC(2026, 9, 29, 14, 35));
    expect(floorToGrid(t, '1d')).toBe(Date.UTC(2026, 9, 29));
  });

  it('a week floors to its Monday 00:00 UTC, from any day of it', () => {
    const monday = Date.UTC(2026, 9, 26); // Mon 26 Oct 2026
    for (let d = 0; d < 7; d++) expect(floorToGrid(monday + d * DAY_MS + 5 * 3_600_000, '1w')).toBe(monday);
    expect(floorToGrid(monday - 1, '1w')).toBe(monday - 7 * DAY_MS);
  });
});

describe('IB-068: barsTouched', () => {
  it('counts a bar only partly covered at either edge', () => {
    const h = 3_600_000;
    const t = Date.UTC(2026, 9, 29);
    expect(barsTouched(t, t + h, '1h')).toBe(1);
    expect(barsTouched(t + 1, t + h + 1, '1h')).toBe(2);
    expect(barsTouched(t, t + 24 * h, '1h')).toBe(24);
    expect(barsTouched(t, t, '1h')).toBe(0);
  });

  it('counts weeks on the Monday grid, not the epoch one', () => {
    const monday = Date.UTC(2026, 9, 26);
    // Sunday to Tuesday crosses one Monday: two weeks touched
    expect(barsTouched(monday - DAY_MS, monday + DAY_MS, '1w')).toBe(2);
    expect(barsTouched(monday, monday + 7 * DAY_MS, '1w')).toBe(1);
  });
});
