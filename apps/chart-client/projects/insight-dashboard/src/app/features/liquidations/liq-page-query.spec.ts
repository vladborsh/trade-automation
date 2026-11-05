import { describe, expect, it } from 'vitest';
import { liqPageParams, liquidationsPageLink, parseLiqPage } from './liq-page-query';

/** IB-120 — the /liquidations view in its URL. */
const from = (params: Record<string, string>) => parseLiqPage((name) => params[name] ?? null);

describe('parseLiqPage / liqPageParams', () => {
  it('an empty URL is the default view', () => {
    expect(from({})).toEqual({
      query: { period: '24h', symbol: 'all', minUsd: 100_000, side: 'all', venue: 'all' },
      sort: { column: 'time', dir: 'desc' },
    });
    expect(Object.values(liqPageParams(from({}))).every((v) => v === null)).toBe(true);
  });

  it('every filter and the sort survive a reload: params → state → params is the identity', () => {
    const url = { p: '7d', coin: 'BTCUSDT', min: '1000000', side: 'short', venue: 'okx', sort: 'usd', dir: 'asc' };
    const state = from(url);
    expect(state.query).toEqual({ period: '7d', symbol: 'BTCUSDT', minUsd: 1_000_000, side: 'short', venue: 'okx' });
    expect(liqPageParams(state)).toEqual(url);
  });

  it('a hand-edited value falls back for that filter only', () => {
    const s = from({ p: '1h', coin: 'btc!', min: '5', side: 'long', venue: 'kraken' });
    expect(s.query).toEqual({ period: '24h', symbol: 'all', minUsd: 100_000, side: 'long', venue: 'all' });
  });
});

describe('liquidationsPageLink (Market\'s «Все ликвидации →»)', () => {
  it('carries Market\'s period; 1h and 4h open the 24h view, which contains them', () => {
    expect(liquidationsPageLink('7d')).toEqual({ commands: ['/liquidations'], queryParams: { p: '7d' } });
    expect(liquidationsPageLink('24h').queryParams.p).toBe('24h');
    expect(liquidationsPageLink('1h').queryParams.p).toBe('24h');
    expect(liquidationsPageLink('4h').queryParams.p).toBe('24h');
  });
});
