import {
  WEB_MARKET_PERIODS, WebCapsResponseSchema, WebMarketPeriodSchema, type WebCapsResponse,
} from '../src/insight';

/** IB-087 — the caps contract. Every rule here is one the server could break. */
const coin = (over: Partial<WebCapsResponse['coins'][number]> = {}) => ({
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', capUsd: 1.5e12, priceUsd: 77_000, changePct: -1.2, stable: false, ...over,
});
const dominance = { btcPct: 50, ethPct: 9, stablesPct: 10, restPct: 31, totalCapUsd: 3e12, totalCapChangePct24h: -0.4, stablesCounted: 40, asOf: '2026-11-03T14:00:00.000Z' };
const ok = (): WebCapsResponse => ({
  period: '24h', coins: [coin()], coinsUnavailable: null, changeUnavailable: null,
  dominance, dominanceUnavailable: null,
  source: { name: 'CoinGecko', url: 'https://www.coingecko.com' }, generatedAt: '2026-11-03T14:00:05.000Z',
});

describe('market period (D14)', () => {
  it('is exactly the four page-wide periods', () => {
    expect([...WEB_MARKET_PERIODS]).toEqual(['1h', '4h', '24h', '7d']);
    expect(WebMarketPeriodSchema.safeParse('30d').success).toBe(false);
  });
});

describe('WebCapsResponseSchema (IB-087)', () => {
  it('accepts a full answer', () => {
    expect(WebCapsResponseSchema.parse(ok())).toBeTruthy();
  });

  it('accepts an explicit refusal of the coins, and rejects an unexplained empty list', () => {
    expect(WebCapsResponseSchema.safeParse({ ...ok(), coins: [], coinsUnavailable: 'source_unavailable' }).success).toBe(true);
    expect(WebCapsResponseSchema.safeParse({ ...ok(), coins: [] }).success).toBe(false);
    expect(WebCapsResponseSchema.safeParse({ ...ok(), coinsUnavailable: 'source_unavailable' }).success).toBe(false);
  });

  it('requires a reason exactly when the dominance bar is missing', () => {
    expect(WebCapsResponseSchema.safeParse({ ...ok(), dominance: null, dominanceUnavailable: 'sources_disagree' }).success).toBe(true);
    expect(WebCapsResponseSchema.safeParse({ ...ok(), dominance: null }).success).toBe(false);
    expect(WebCapsResponseSchema.safeParse({ ...ok(), dominanceUnavailable: 'source_unavailable' }).success).toBe(false);
  });

  it('a refused period (4h) carries no per-coin change', () => {
    const refused = { ...ok(), period: '4h' as const, changeUnavailable: 'period_not_served' as const };
    expect(WebCapsResponseSchema.safeParse({ ...refused, coins: [coin({ changePct: null })] }).success).toBe(true);
    expect(WebCapsResponseSchema.safeParse({ ...refused, coins: [coin({ changePct: 0.5 })] }).success).toBe(false);
  });

  it('the dominance parts sum to 100, and none is negative', () => {
    expect(WebCapsResponseSchema.safeParse({ ...ok(), dominance: { ...dominance, restPct: 30 } }).success).toBe(false);
    expect(WebCapsResponseSchema.safeParse({ ...ok(), dominance: { ...dominance, restPct: -1, btcPct: 82 } }).success).toBe(false);
  });

  it('carries an attribution with a real URL', () => {
    expect(WebCapsResponseSchema.safeParse({ ...ok(), source: { name: 'CoinGecko', url: 'coingecko' } }).success).toBe(false);
  });
});
