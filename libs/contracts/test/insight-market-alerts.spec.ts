import {
  LIQ_DEFAULT_PARAMS, LiqAlertDetailsSchema, LiqNearMissDetailsSchema, LiqParamsSchema, WebLiqAlertSettingsPatchSchema,
  WebMemberSettingsPatchSchema,
} from '../src/insight';

/** IB-122 — the generic alert journal's vocabulary, liquidations first (design C1, L1–L8). */
describe('market alert contracts (IB-122)', () => {
  it('L4: the owner\'s default thresholds, in USD per 5 min, and they parse', () => {
    expect(Object.fromEntries(Object.entries(LIQ_DEFAULT_PARAMS.perCoin).map(([s, c]) => [s, c.thresholdUsd]))).toEqual({
      BTCUSDT: 5e6, ETHUSDT: 3e6, SOLUSDT: 1e6, BNBUSDT: 3e5, TRXUSDT: 3e5,
    });
    expect(LiqParamsSchema.parse(LIQ_DEFAULT_PARAMS)).toEqual(LIQ_DEFAULT_PARAMS);
  });

  it('a threshold must be a positive number; an unknown field is refused, not ignored', () => {
    expect(LiqParamsSchema.safeParse({ perCoin: { BTCUSDT: { enabled: true, thresholdUsd: 0 } } }).success).toBe(false);
    expect(LiqParamsSchema.safeParse({ perCoin: { BTCUSDT: { enabled: true, thresholdUsd: 1, extra: 1 } } }).success).toBe(false);
    expect(LiqParamsSchema.safeParse({ perCoin: { btcusdt: { enabled: true, thresholdUsd: 1 } } }).success).toBe(false);
  });

  it('the admin patch needs at least one field', () => {
    expect(WebLiqAlertSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(WebLiqAlertSettingsPatchSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(WebLiqAlertSettingsPatchSchema.safeParse({ perCoin: { TRXUSDT: { enabled: false, thresholdUsd: 300_000 } } }).success).toBe(true);
  });

  it('L3: a silent venue is a reason, not a $0', () => {
    const base = {
      side: 'long', windowStartMs: 0, sumUsd: 6e6, thresholdUsd: 5e6, byVenue: { binance: 3e6, bybit: 3e6, okx: 0 }, count: 12,
      largest: { usd: 1e6, venue: 'bybit' }, binanceFootnote: true,
    };
    expect(LiqAlertDetailsSchema.safeParse({ ...base, silentVenues: [{ venue: 'okx', reason: 'stream_silent' }] }).success).toBe(true);
    expect(LiqAlertDetailsSchema.safeParse({ ...base, silentVenues: [{ venue: 'okx', reason: 'quiet' }] }).success).toBe(false);
  });

  it('L8: a near-miss ratio is in [0.5, 1)', () => {
    const nm = { side: 'short', windowStartMs: 0, sumUsd: 1, thresholdUsd: 2, hour: 0 };
    expect(LiqNearMissDetailsSchema.safeParse({ ...nm, ratio: 0.5 }).success).toBe(true);
    expect(LiqNearMissDetailsSchema.safeParse({ ...nm, ratio: 0.49 }).success).toBe(false);
    expect(LiqNearMissDetailsSchema.safeParse({ ...nm, ratio: 1 }).success).toBe(false);
  });

  it('a member may patch liqAlerts, parsed like the other toggles', () => {
    expect(WebMemberSettingsPatchSchema.safeParse({ liqAlerts: 'on' }).success).toBe(true);
    expect(WebMemberSettingsPatchSchema.safeParse({ liqAlerts: true }).success).toBe(true);
  });
});
