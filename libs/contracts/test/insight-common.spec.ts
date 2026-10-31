import {
  WEB_ERROR_CODES, WEB_MAX_1M_RANGE_DAYS, WEB_MAX_POINTS, WebErrorSchema, WebTimeframeSchema,
} from '../src/insight/common';

/**
 * IB-031 — the shared `/api/web` contract. Specced because two pages must not drift into two
 * error shapes, and because the caps are a promise about a 1 GB box, not a suggestion.
 */

describe('WebError', () => {
  it('accepts a bare code — message is optional', () => {
    expect(WebErrorSchema.parse({ code: 'NOT_FOUND' })).toEqual({ code: 'NOT_FOUND' });
  });

  it('carries maxDays for RANGE_TOO_WIDE so a client can retry correctly', () => {
    const parsed = WebErrorSchema.parse({ code: 'RANGE_TOO_WIDE', message: 'too wide', maxDays: 90 });
    expect(parsed).toMatchObject({ code: 'RANGE_TOO_WIDE', maxDays: 90 });
  });

  it('rejects a code that is not in the list — a new endpoint cannot invent one quietly', () => {
    expect(WebErrorSchema.safeParse({ code: 'KABOOM' }).success).toBe(false);
    expect(WebErrorSchema.safeParse({}).success).toBe(false);
  });

  it('covers the auth codes too, so /auth and the pages share one error shape', () => {
    for (const code of ['TOKEN_INVALID', 'TOKEN_USED', 'TOKEN_EXPIRED', 'UNAUTHENTICATED', 'FORBIDDEN']) {
      expect(WebErrorSchema.safeParse({ code }).success).toBe(true);
    }
    expect(new Set(WEB_ERROR_CODES).size).toBe(WEB_ERROR_CODES.length); // no duplicates
  });

  it('maxDays must be a positive integer, not a float or zero', () => {
    expect(WebErrorSchema.safeParse({ code: 'RANGE_TOO_WIDE', maxDays: 0 }).success).toBe(false);
    expect(WebErrorSchema.safeParse({ code: 'RANGE_TOO_WIDE', maxDays: 1.5 }).success).toBe(false);
  });
});

describe('WebTimeframe', () => {
  it('is the set the dashboard actually serves', () => {
    expect(WebTimeframeSchema.options).toEqual(['1m', '3m', '5m', '15m', '1h', '4h', '1d', '1w']); // IB-065 added 3m, 5m, 1w
    expect(WebTimeframeSchema.safeParse('3s').success).toBe(false);
  });
});

describe('the caps', () => {
  it('are the numbers the design states (§4)', () => {
    // a change here is a change to what the box promises to survive, so it should break a test
    expect(WEB_MAX_POINTS).toBe(5_000);
    expect(WEB_MAX_1M_RANGE_DAYS).toBe(90);
  });

  it('90 days of 1m is well over the point cap, which is why both limits exist', () => {
    const minutesIn90Days = (90 * 24 * 60);
    expect(minutesIn90Days).toBeGreaterThan(WEB_MAX_POINTS);
  });
});
