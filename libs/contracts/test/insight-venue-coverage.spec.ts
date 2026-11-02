import { WebLongShortResponseSchema, WebOpenInterestResponseSchema } from '../src/insight/series';

/**
 * WD-008 — OI and long-short read from the venue reach back only ~30 days, so the answer can say
 * where it starts. Both fields are optional: the tape-backed routes that never set them must still
 * parse (they serve the dashboard until WD-009 switches them).
 */
describe('venue coverage on OI and long-short (WD-008)', () => {
  const ls = { symbol: 'BTCUSDT', kind: 'global_account', points: [{ time: 1_790_602_200, ratio: 1.37 }], downsampled: false };
  const oi = { symbol: 'BTCUSDT', venue: 'binance', points: [{ time: 1_790_602_200, value: 95_026.9, notional: 7.77e9 }], downsampled: false };

  it('a tape answer without the fields still parses, and gains none', () => {
    expect(WebLongShortResponseSchema.parse(ls)).not.toHaveProperty('truncated');
    expect(WebOpenInterestResponseSchema.parse(oi)).not.toHaveProperty('coverageFrom');
  });

  it('a venue answer carries where it starts and that it was cut', () => {
    const parsed = WebOpenInterestResponseSchema.parse({ ...oi, points: [], coverageFrom: 1_790_000_000, truncated: true });
    expect(parsed).toMatchObject({ points: [], coverageFrom: 1_790_000_000, truncated: true });
    expect(WebLongShortResponseSchema.parse({ ...ls, truncated: true }).truncated).toBe(true);
  });

  it('coverageFrom is epoch SECONDS, like every other time on the wire', () => {
    expect(() => WebOpenInterestResponseSchema.parse({ ...oi, coverageFrom: 1.5 })).toThrow();
    expect(() => WebOpenInterestResponseSchema.parse({ ...oi, coverageFrom: -1 })).toThrow();
  });

  it('OI notional may be null (a venue that gives none) but never missing', () => {
    expect(WebOpenInterestResponseSchema.parse({ ...oi, points: [{ time: 1, value: 2, notional: null }] }).points[0].notional).toBeNull();
    expect(() => WebOpenInterestResponseSchema.parse({ ...oi, points: [{ time: 1, value: 2 }] })).toThrow();
  });
});
