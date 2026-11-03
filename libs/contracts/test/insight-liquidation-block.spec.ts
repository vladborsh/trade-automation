import {
  WEB_LIQUIDATION_BUCKET_SECONDS, WEB_MARKET_PERIOD_SECONDS, WEB_MARKET_PERIODS,
  WebLiquidationBlockSchema, WebLiquidationLargeEventSchema,
} from '../src/insight';

/** IB-084 — the market page's liquidation block (design D6, D8, D14). */
const basis = { periodDays: 0, windowsInPeriod: 0, windowsObserved: 0, venues: [], unavailable: 'insufficient_history' as const };
const zero = { usd: 0, long: 0, short: 0, events: 0 };
const block = {
  period: '24h' as const,
  totals: zero,
  basis,
  hourly: { bucketSec: 3600, buckets: [{ time: 1, long: 0, short: 0, partial: true, rarity: null, outlier: false }], norm: { long: null, short: null, total: null }, basis },
  perCoin: [{ symbol: 'BTCUSDT', base: 'BTC', totals: zero, verdict: null, basis }],
  large: [],
  largeMinUsd: 100_000,
  tradfi: zero,
  unknown: zero,
  availableFrom: { '1h': null, '4h': null, '24h': 1_793_000_000, '7d': 1_793_500_000 },
};

describe('IB-084 liquidation block contract', () => {
  it('periods and their seconds come from one table; 7d bars are 4-hour', () => {
    expect([...WEB_MARKET_PERIODS]).toEqual(['1h', '4h', '24h', '7d']);
    expect(WEB_MARKET_PERIOD_SECONDS['7d']).toBe(7 * 86_400);
    expect(WEB_LIQUIDATION_BUCKET_SECONDS).toEqual({ '1h': 3_600, '4h': 3_600, '24h': 3_600, '7d': 14_400 });
  });

  it('an empty fresh box parses: refusals, not zeros pretending to be norms', () => {
    expect(WebLiquidationBlockSchema.parse(block).basis.unavailable).toBe('insufficient_history');
  });

  it('TradFi and unknown are separate fields — there is no way to put them in totals by shape', () => {
    expect(Object.keys(WebLiquidationBlockSchema.shape)).toEqual(expect.arrayContaining(['tradfi', 'unknown', 'totals']));
  });

  it('a large event carries its context and series, and refuses a negative multiple', () => {
    const e = { time: 1, symbol: 'BTCUSDT', base: 'BTC', side: 'long', usd: 250_000, price: 1, venue: 'binance', xMedian: 12.5, seriesId: 's1', seriesCount: 4, seriesSpanSec: 540 };
    expect(WebLiquidationLargeEventSchema.parse(e).seriesCount).toBe(4);
    expect(WebLiquidationLargeEventSchema.safeParse({ ...e, xMedian: -1 }).success).toBe(false);
  });
});

describe('the example block clients build against (test/fixtures/liquidation-block.24h.json)', () => {
  it('parses against the contract, so the fixture cannot drift from it', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const example = require('./fixtures/liquidation-block.24h.json');
    const parsed = WebLiquidationBlockSchema.parse(example);
    expect(parsed.hourly.buckets).toHaveLength(24);
    expect(parsed.large[0].seriesCount).toBe(4);
  });
});
