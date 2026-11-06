import { WEB_MAX_ALERT_MARKS, WebAlertMarkSchema, WebAlertMarksResponseSchema } from '../src/insight';

/** IB-129 — the chart's alert marks (alerts design §5). */
describe('alert mark contracts (IB-129)', () => {
  const liq = { type: 'liq', at: 1_793_900_000, side: 'long', sumUsd: 7.4e6, thresholdUsd: 5e6, byVenue: { binance: 3.1e6, bybit: 2.9e6, okx: 1.4e6 } };
  const funding = { type: 'funding', event: 'enter', at: 1_793_900_000, side: 'high', ratePer8h: 0.0005, episodeHours: null };

  it('a liquidation crossing and a funding entry parse; the type picks the shape', () => {
    expect(WebAlertMarkSchema.parse(liq)).toEqual(liq);
    expect(WebAlertMarkSchema.parse(funding)).toEqual(funding);
    expect(WebAlertMarkSchema.safeParse({ ...liq, type: 'funding' }).success).toBe(false);
  });

  it('a flip carries how long its episode lasted', () => {
    expect(WebAlertMarkSchema.parse({ ...funding, event: 'flip', episodeHours: 31.5 })).toMatchObject({ episodeHours: 31.5 });
  });

  it('only the journal events that are marks: no level type, no liq event names, no unknown fields', () => {
    expect(WebAlertMarkSchema.safeParse({ ...liq, type: 'level' }).success).toBe(false);
    expect(WebAlertMarkSchema.safeParse({ ...funding, event: 'event' }).success).toBe(false);
    expect(WebAlertMarkSchema.safeParse({ ...liq, late: false }).success).toBe(false);
    expect(WebAlertMarkSchema.safeParse({ ...liq, side: 'high' }).success).toBe(false);
  });

  it('the response holds at most WEB_MAX_ALERT_MARKS marks and says when it cut', () => {
    const marks = Array.from({ length: WEB_MAX_ALERT_MARKS + 1 }, () => liq);
    expect(WebAlertMarksResponseSchema.safeParse({ symbol: 'BTCUSDT', marks: marks.slice(1), truncated: true }).success).toBe(true);
    expect(WebAlertMarksResponseSchema.safeParse({ symbol: 'BTCUSDT', marks, truncated: true }).success).toBe(false);
  });
});
