import {
  WEB_LIQUIDATIONS_LARGE_LIMIT, WEB_LIQUIDATION_VENUES,
  WebLiquidationsLargeQuerySchema, WebLiquidationsLargeResponseSchema,
} from '../src/insight';

/** IB-120 — the /liquidations page's endpoint (market-round2 design §4). */
describe('IB-120 large-liquidations query', () => {
  it('an empty query is the page default: 24h, every coin, from $100K, both sides, every venue', () => {
    expect(WebLiquidationsLargeQuerySchema.parse({})).toEqual({ period: '24h', symbol: 'all', minUsd: 100_000, side: 'all', venue: 'all' });
  });

  it('reads the query string as it arrives (minUsd is a string there)', () => {
    const q = WebLiquidationsLargeQuerySchema.parse({ period: '7d', symbol: 'BTCUSDT', minUsd: '1000000', side: 'short', venue: 'okx' });
    expect(q).toEqual({ period: '7d', symbol: 'BTCUSDT', minUsd: 1_000_000, side: 'short', venue: 'okx' });
  });

  it.each([
    ['period', '1h'],
    ['minUsd', '250000'],
    ['minUsd', 'abc'],
    ['side', 'both'],
    ['venue', 'deribit'],
    ['symbol', 'btc;drop'],
  ])('refuses %s=%s instead of quietly defaulting it', (key, value) => {
    expect(WebLiquidationsLargeQuerySchema.safeParse({ [key]: value }).success).toBe(false);
  });

  it('the venue chip offers exactly the venues the tape is collected from', () => {
    expect([...WEB_LIQUIDATION_VENUES]).toEqual(['binance', 'bybit', 'okx']);
  });
});

describe('IB-120 large-liquidations response', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const example = require('./fixtures/liquidations-large.24h.json');

  it('the example clients build against parses, so the fixture cannot drift from the contract', () => {
    const parsed = WebLiquidationsLargeResponseSchema.parse(example);
    expect(parsed.rows.map((r) => r.time)).toEqual([...parsed.rows.map((r) => r.time)].sort((a, b) => b - a));
    expect(parsed.rows.filter((r) => r.seriesId !== null).every((r) => r.seriesCount >= 3)).toBe(true);
  });

  it('truncated is total > rows.length, both ways — the page\'s «показаны 1 000 из N» cannot lie', () => {
    expect(WebLiquidationsLargeResponseSchema.safeParse({ ...example, total: 10, truncated: false }).success).toBe(false);
    expect(WebLiquidationsLargeResponseSchema.safeParse({ ...example, truncated: true }).success).toBe(false);
    expect(WebLiquidationsLargeResponseSchema.safeParse({ ...example, total: 10, truncated: true }).success).toBe(true);
    expect(WebLiquidationsLargeResponseSchema.safeParse({ ...example, total: 2, truncated: false }).success).toBe(false);
  });

  it('never more than the limit of rows', () => {
    const rows = Array.from({ length: WEB_LIQUIDATIONS_LARGE_LIMIT + 1 }, () => example.rows[0]);
    expect(WebLiquidationsLargeResponseSchema.safeParse({ ...example, rows, total: rows.length + 5, truncated: true }).success).toBe(false);
  });
});
