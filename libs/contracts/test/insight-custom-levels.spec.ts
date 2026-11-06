import {
  CUSTOM_LEVEL_EVENTS, CUSTOM_LEVEL_NOTE_MAX, CustomLevelAlertDetailsSchema, LEVEL_SIDE_EVENTS, WebChartCustomLevelsResponseSchema,
  WebCustomLevelCreateSchema, WebCustomLevelPatchSchema, WebLevelAlertRowSchema, customLevelDedupeKey, customLevelEventOn,
  isCustomLevelEvent,
} from '../src/insight';

/** IB-128 — the owner's custom levels (design §4 P9). */
describe('custom level contracts (IB-128)', () => {
  const bar = { openMs: 900_000, open: 71_700, high: 72_300, low: 71_650, close: 72_140 };

  it('P9: a custom level gets an open\'s events — both breakouts and both sweeps, no crossunder/crossover', () => {
    expect([...CUSTOM_LEVEL_EVENTS]).toEqual([...LEVEL_SIDE_EVENTS.open]);
    expect(isCustomLevelEvent('breakout_down')).toBe(true);
    expect(isCustomLevelEvent('crossunder')).toBe(false);
    expect(isCustomLevelEvent('crossover')).toBe(false);
  });

  it('P9: the once-key names the level and the UTC day, so the next day may speak again', () => {
    const day = Date.UTC(2026, 10, 6);
    expect(customLevelDedupeKey('BTCUSDT', 7, day, 'breakout_up')).toBe(`level:BTCUSDT:custom-7:${day}:breakout_up`);
    expect(customLevelDedupeKey('BTCUSDT', 7, day, 'breakout_up')).not.toBe(customLevelDedupeKey('BTCUSDT', 7, day + 86_400_000, 'breakout_up'));
    expect(customLevelDedupeKey('BTCUSDT', 7, day, 'breakout_up')).not.toBe(customLevelDedupeKey('BTCUSDT', 8, day, 'breakout_up'));
  });

  it('an event switch absent is on; false switches just that one off', () => {
    expect(customLevelEventOn({}, 'sweep_above')).toBe(true);
    expect(customLevelEventOn({ sweep_above: false }, 'sweep_above')).toBe(false);
    expect(customLevelEventOn({ sweep_above: false }, 'sweep_below')).toBe(true);
  });

  it('create: a listed-looking symbol, a positive price, an optional trimmed note; strict', () => {
    expect(WebCustomLevelCreateSchema.parse({ symbol: 'BTCUSDT', price: 72_000, note: '  range high ' })).toEqual({ symbol: 'BTCUSDT', price: 72_000, note: 'range high' });
    expect(WebCustomLevelCreateSchema.safeParse({ symbol: 'BTCUSDT', price: 0 }).success).toBe(false);
    expect(WebCustomLevelCreateSchema.safeParse({ symbol: 'BTCUSDT', price: -1 }).success).toBe(false);
    expect(WebCustomLevelCreateSchema.safeParse({ symbol: 'BTCUSDT', price: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(WebCustomLevelCreateSchema.safeParse({ symbol: 'btc', price: 1 }).success).toBe(false);
    expect(WebCustomLevelCreateSchema.safeParse({ symbol: 'BTCUSDT', price: 1, note: 'x'.repeat(CUSTOM_LEVEL_NOTE_MAX + 1) }).success).toBe(false);
    expect(WebCustomLevelCreateSchema.safeParse({ symbol: 'BTCUSDT', price: 1, extra: true }).success).toBe(false);
    expect(WebCustomLevelCreateSchema.safeParse({ symbol: 'BTCUSDT', price: 1, events: { crossunder: false } }).success).toBe(false);
  });

  it('patch: only the four events, at least one', () => {
    expect(WebCustomLevelPatchSchema.safeParse({ events: { sweep_below: false } }).success).toBe(true);
    expect(WebCustomLevelPatchSchema.safeParse({ events: {} }).success).toBe(false);
    expect(WebCustomLevelPatchSchema.safeParse({ events: { crossover: false } }).success).toBe(false);
    expect(WebCustomLevelPatchSchema.safeParse({ events: { sweep_below: false }, price: 1 }).success).toBe(false);
  });

  it('details: kind custom, the level, its day and the bar', () => {
    const d = { kind: 'custom', levelId: 7, price: 72_000, note: null, dayStartMs: 0, bar, prevClose: 71_900 };
    expect(CustomLevelAlertDetailsSchema.safeParse(d).success).toBe(true);
    expect(CustomLevelAlertDetailsSchema.safeParse({ ...d, kind: 'WO' }).success).toBe(false);
    expect(CustomLevelAlertDetailsSchema.safeParse({ ...d, firstBeyondAtMs: null }).success).toBe(false);
  });

  it('the levels journal row may be a custom level, with its id', () => {
    const row = { id: 1, source: 'live', event: 'breakout_up', symbol: 'BTCUSDT', price: 72_000, at: 1, close: 72_100, firedAt: null, late: false, recipients: 0, mutedBy: null };
    expect(WebLevelAlertRowSchema.safeParse({ ...row, kind: 'custom', customLevelId: 7 }).success).toBe(true);
    expect(WebLevelAlertRowSchema.safeParse({ ...row, kind: 'PWH', customLevelId: null }).success).toBe(true);
    expect(WebLevelAlertRowSchema.safeParse({ ...row, kind: 'CUSTOM', customLevelId: 7 }).success).toBe(false);
  });

  it('chart: a coin\'s active levels', () => {
    expect(WebChartCustomLevelsResponseSchema.safeParse({ symbol: 'BTCUSDT', levels: [{ id: 1, price: 72_000, note: 'x' }] }).success).toBe(true);
    expect(WebChartCustomLevelsResponseSchema.safeParse({ symbol: 'BTCUSDT', levels: [{ id: 1, price: 0, note: null }] }).success).toBe(false);
  });
});
