import {
  LIQ_ALERT_EVENTS, LIQ_EVENT_MAX_SEC, LIQ_QUIET_SEC, LIQ_SEND_CAP_SEC, LIQ_SETTLE_SEC, LIQ_TICK_SEC,
  LiqEventContinuingDetailsSchema, LiqEventDetailsSchema,
  LIQ_DEFAULT_PARAMS, LIQ_MERGE_RATIO, LIQ_MERGE_SEC, LIQ_SMALL_MULT, LiqAlertDetailsSchema, LiqNearMissDetailsSchema, LiqParamsSchema, WebLiqAlertSettingsPatchSchema,
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

/** IB-143 — one message per market event (design §2a, L10–L15). */
describe('liquidation event contracts (IB-143)', () => {
  const coin = {
    symbol: 'BTCUSDT', crossedAt: 1_000_000, windowStartMs: 700_000, sumUsd: 6e6, thresholdUsd: 5e6,
    byVenue: { binance: 3e6, bybit: 2e6, okx: 1e6 }, count: 12, largest: { usd: 1e6, venue: 'bybit' }, silentVenues: [],
  };
  const event = {
    side: 'long', eventAt: 1_000_000, sentAt: 1_100_000, settled: 'quiet', coins: [coin], totalUsd: 6e6, count: 12,
    largest: { usd: 1e6, venue: 'bybit', symbol: 'BTCUSDT' }, binanceFootnote: false,
  };

  it('the rulings are constants: settle 60 s, cap 3 min, an event lives at most the 30-min quiet; tick 10 s', () => {
    expect([LIQ_SETTLE_SEC, LIQ_SEND_CAP_SEC, LIQ_EVENT_MAX_SEC, LIQ_TICK_SEC]).toEqual([60, 180, LIQ_QUIET_SEC, 10]);
    expect(LIQ_QUIET_SEC).toBe(1_800);
  });

  it('an event row parses; it needs at least one coin and says how S came', () => {
    expect(LiqEventDetailsSchema.parse(event)).toEqual(event);
    expect(LiqEventDetailsSchema.safeParse({ ...event, coins: [] }).success).toBe(false);
    expect(LiqEventDetailsSchema.safeParse({ ...event, settled: 'late' }).success).toBe(false);
  });

  it('IB-148 (L16–L19): the merge rulings are constants; an event row may say it was held, merged, or took small ones in', () => {
    expect([LIQ_SMALL_MULT, LIQ_MERGE_RATIO, LIQ_MERGE_SEC]).toEqual([3, 10, 120]);
    const held = { ...event, heldUntil: 1_220_000 };
    const absorbed = { ...event, mergedInto: { eventAt: 900_000, how: 'after' } };
    const taker = { ...event, merged: [{ symbol: 'BNBUSDT', eventAt: 950_000, sumUsd: 4e5, how: 'before' }] };
    for (const x of [held, absorbed, taker]) expect(LiqEventDetailsSchema.parse(x)).toEqual(x);
    expect(LiqEventDetailsSchema.safeParse({ ...event, mergedInto: { eventAt: 900_000, how: 'during' } }).success).toBe(false);
    expect(LiqEventDetailsSchema.safeParse({ ...event, merged: [] }).success).toBe(false);
  });

  it('a continuation carries the close, the first message and why it is news; strict', () => {
    const { settled: _settled, ...shape } = event;
    const cont = { ...shape, closedAt: 1_500_000, closedBy: 'quiet', firstMessageId: 9, newCoins: ['ETHUSDT'], addedCoins: [], news: true };
    expect(LiqEventContinuingDetailsSchema.parse(cont)).toEqual(cont);
    expect(LiqEventContinuingDetailsSchema.safeParse({ ...cont, settled: 'cap' }).success).toBe(false);
    expect(LiqEventContinuingDetailsSchema.safeParse({ ...cont, closedBy: 'cap' }).success).toBe(false);
  });

  it('a crossing row carries its event\'s T0, optional for rows written before IB-143', () => {
    const alert = {
      side: 'short', windowStartMs: 0, sumUsd: 6e6, thresholdUsd: 5e6, byVenue: { binance: 6e6, bybit: 0, okx: 0 }, count: 1,
      largest: { usd: 6e6, venue: 'binance' }, silentVenues: [], binanceFootnote: false,
    };
    expect(LiqAlertDetailsSchema.parse(alert)).toEqual(alert);
    expect(LiqAlertDetailsSchema.parse({ ...alert, eventAt: 5 })).toEqual({ ...alert, eventAt: 5 });
    expect(LIQ_ALERT_EVENTS).toEqual(['alert', 'continuing', 'event', 'event_continuing']);
  });
});
