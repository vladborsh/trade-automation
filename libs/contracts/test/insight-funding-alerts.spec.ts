import {
  FUNDING_DEFAULT_PARAMS, FUNDING_SIDE_DIRECTION, FundingEnterDetailsSchema, FundingFlipDetailsSchema, FundingNearMissDetailsSchema,
  FundingParamsSchema, WebFundingAlertSettingsPatchSchema, WebMemberSettingsPatchSchema,
} from '../src/insight';

/** IB-124 — the funding alerts' vocabulary (design §3, F1–F8). */
describe('funding alert contracts (IB-124)', () => {
  const facts = {
    rate: 0.0004, intervalH: 8, ratePer8h: 0.0004, rarity: 0.97, band: { lo: -0.0001, hi: 0.0003 }, sample: 90,
    floorPer8h: 0.0003, rateTimeMs: 1_000, nextFundingTimeMs: 2_000,
  };

  it('F5: the defaults are 24 h and 72 h, no coin overrides, and they parse', () => {
    expect(FUNDING_DEFAULT_PARAMS).toEqual({ minEpisodeHours: 24, flipWithinHours: 72, perCoin: {} });
    expect(FundingParamsSchema.parse(FUNDING_DEFAULT_PARAMS)).toEqual(FUNDING_DEFAULT_PARAMS);
  });

  it('F3: a coin floor is optional (absent = the shared default), positive and at most 1 %/8 h; unknown fields refused', () => {
    const p = (c: unknown) => FundingParamsSchema.safeParse({ ...FUNDING_DEFAULT_PARAMS, perCoin: { BTCUSDT: c } }).success;
    expect(p({ enabled: true })).toBe(true);
    expect(p({ enabled: true, floorPer8h: 0.0005 })).toBe(true);
    expect(p({ enabled: true, floorPer8h: 0 })).toBe(false);
    expect(p({ enabled: true, floorPer8h: 0.02 })).toBe(false);
    expect(p({ enabled: true, thresholdUsd: 1 })).toBe(false);
  });

  it('F8: the stored direction is the crowded side as it is: longs pay → bearish, shorts pay → bullish', () => {
    expect(FUNDING_SIDE_DIRECTION).toEqual({ high: 'bearish', low: 'bullish' });
  });

  it('enter, flip and near-miss details parse; a flip needs its episode, a near-miss names the one condition it failed', () => {
    expect(FundingEnterDetailsSchema.safeParse({ ...facts, side: 'high', episodeStartMs: 1_000 }).success).toBe(true);
    expect(FundingEnterDetailsSchema.safeParse({ ...facts, side: 'up', episodeStartMs: 1_000 }).success).toBe(false);
    const flip = { ...facts, side: 'high', episodeStartMs: 0, episodeEndMs: 90_000_000, episodeHours: 25, flipSinceMs: 91_000_000 };
    expect(FundingFlipDetailsSchema.safeParse(flip).success).toBe(true);
    expect(FundingFlipDetailsSchema.safeParse({ ...flip, episodeEndMs: undefined }).success).toBe(false);
    expect(FundingNearMissDetailsSchema.safeParse({ ...facts, side: 'low', failed: 'floor' }).success).toBe(true);
    expect(FundingNearMissDetailsSchema.safeParse({ ...facts, side: 'low', failed: 'both' }).success).toBe(false);
  });

  it('an unknown interval is null (counted as 8 h by the bot), never a guessed number', () => {
    expect(FundingEnterDetailsSchema.safeParse({ ...facts, intervalH: null, side: 'low', episodeStartMs: 0 }).success).toBe(true);
    expect(FundingEnterDetailsSchema.safeParse({ ...facts, intervalH: 0, side: 'low', episodeStartMs: 0 }).success).toBe(false);
  });

  it('the admin patch needs one field; a coin floor null returns it to the default', () => {
    expect(WebFundingAlertSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(WebFundingAlertSettingsPatchSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(WebFundingAlertSettingsPatchSchema.safeParse({ minEpisodeHours: 12 }).success).toBe(true);
    expect(WebFundingAlertSettingsPatchSchema.safeParse({ perCoin: { BTCUSDT: { enabled: true, floorPer8h: null } } }).success).toBe(true);
    expect(WebFundingAlertSettingsPatchSchema.safeParse({ perCoin: { BTCUSDT: { enabled: true } } }).success).toBe(false);
    expect(WebFundingAlertSettingsPatchSchema.safeParse({ floor: 1 }).success).toBe(false);
  });

  it('a member patch may carry fundingAlerts', () => {
    expect(WebMemberSettingsPatchSchema.safeParse({ fundingAlerts: 'on' }).success).toBe(true);
  });
});
