import {
  LEVEL_DEFAULT_PARAMS, LEVEL_EVENTS, LEVEL_EVENT_DIRECTION, LEVEL_KINDS, LEVEL_KIND_SIDE, LevelAlertDetailsSchema, LevelParamsSchema,
  LevelTouchDetailsSchema, WebLevelAlertSettingsPatchSchema, WebMemberSettingsPatchSchema, levelEventOn, levelKindEvents,
} from '../src/insight';

/** IB-126 — the price-level alerts' vocabulary (design §4, P1–P7, P10). */
describe('level alert contracts (IB-126)', () => {
  const inForce = { kind: 'PWH', price: 71_850, periodStartMs: 0, periodEndMs: 604_800_000 };
  const bar = { openMs: 900_000, open: 71_700, high: 72_300, low: 71_650, close: 72_140 };

  it('P2: the defaults have no coin overrides and no event switched off, and they parse', () => {
    expect(LEVEL_DEFAULT_PARAMS).toEqual({ touchBand: 0.001, events: {}, perCoin: {} });
    expect(LevelParamsSchema.parse(LEVEL_DEFAULT_PARAMS)).toEqual(LEVEL_DEFAULT_PARAMS);
  });

  it('P3: a high level gets up/above/crossunder, a low one down/below/crossover, an open both breakouts and sweeps and no cross', () => {
    expect(levelKindEvents('PWH')).toEqual(['breakout_up', 'sweep_above', 'crossunder']);
    expect(levelKindEvents('PML')).toEqual(['breakout_down', 'sweep_below', 'crossover']);
    expect(levelKindEvents('WO')).toEqual(['breakout_up', 'breakout_down', 'sweep_above', 'sweep_below']);
    for (const k of LEVEL_KINDS) expect(['high', 'low', 'open']).toContain(LEVEL_KIND_SIDE[k]);
    // every event belongs to some kind
    expect(new Set(LEVEL_KINDS.flatMap((k) => levelKindEvents(k)))).toEqual(new Set(LEVEL_EVENTS));
  });

  it('the stored direction is the side of L the bar closed on', () => {
    expect(LEVEL_EVENT_DIRECTION).toEqual({
      breakout_up: 'bullish', sweep_below: 'bullish', crossover: 'bullish', breakout_down: 'bearish', sweep_above: 'bearish', crossunder: 'bearish',
    });
  });

  it('P2: an event absent from the switches is on; false switches only that one off', () => {
    const params = { events: { PWH: { crossunder: false } } };
    expect(levelEventOn(params, 'PWH', 'crossunder')).toBe(false);
    expect(levelEventOn(params, 'PWH', 'breakout_up')).toBe(true);
    expect(levelEventOn(params, 'PMH', 'crossunder')).toBe(true);
  });

  it('details: a crossunder carries its first close beyond; touch names its side and distance', () => {
    expect(LevelAlertDetailsSchema.safeParse({ ...inForce, bar, prevClose: 71_600, firstBeyondAtMs: 450_000 }).success).toBe(true);
    expect(LevelAlertDetailsSchema.safeParse({ ...inForce, bar, prevClose: 71_600, firstBeyondAtMs: null }).success).toBe(true);
    expect(LevelAlertDetailsSchema.safeParse({ ...inForce, kind: 'PQH', bar, prevClose: 1, firstBeyondAtMs: null }).success).toBe(false);
    expect(LevelTouchDetailsSchema.safeParse({ ...inForce, bar, from: 'below', distance: 0.0004, touchBand: 0.001 }).success).toBe(true);
    expect(LevelTouchDetailsSchema.safeParse({ ...inForce, bar, from: 'side', distance: 0.0004, touchBand: 0.001 }).success).toBe(false);
  });

  it('the admin patch needs one field and refuses an event that does not apply to its kind', () => {
    expect(WebLevelAlertSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(WebLevelAlertSettingsPatchSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(WebLevelAlertSettingsPatchSchema.safeParse({ events: { PWH: { crossunder: false } } }).success).toBe(true);
    expect(WebLevelAlertSettingsPatchSchema.safeParse({ events: { PWH: { crossover: false } } }).success).toBe(false);
    expect(WebLevelAlertSettingsPatchSchema.safeParse({ events: { WO: { crossunder: false } } }).success).toBe(false);
    expect(WebLevelAlertSettingsPatchSchema.safeParse({ perCoin: { BTCUSDT: { enabled: true, daily: true } } }).success).toBe(true);
    expect(WebLevelAlertSettingsPatchSchema.safeParse({ perCoin: { BTCUSDT: { enabled: true } } }).success).toBe(false);
    expect(WebLevelAlertSettingsPatchSchema.safeParse({ touchBand: 0 }).success).toBe(false);
    expect(WebLevelAlertSettingsPatchSchema.safeParse({ band: 1 }).success).toBe(false);
  });

  it('a member patch may carry levelAlerts', () => {
    expect(WebMemberSettingsPatchSchema.safeParse({ levelAlerts: 'on' }).success).toBe(true);
  });
});
