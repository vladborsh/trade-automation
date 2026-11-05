import type { WebPositioningResponse, WebPositioningRow } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../../libs/contracts/test/fixtures/positioning.24h.json';
import { filterByTicker, normalizeQuery } from './pos-search';

/**
 * IB-136 — the ticker search. The fixture's BTC, ETH, SOL, DOGE, plus rows whose SYMBOL matches where
 * the ticker does not (a filter on `symbol` would keep them: every symbol ends in «USDT»).
 */
const rows = (fixture as unknown as WebPositioningResponse).rows;
const row = (base: string): WebPositioningRow => ({ ...rows[0], symbol: `${base}USDT`, base });
const all = [...rows, row('1000PEPE'), row('PEPE'), row('WIF')];
const bases = (rs: readonly WebPositioningRow[]) => rs.map((r) => r.base);

describe('filterByTicker', () => {
  it('an empty, missing or all-space query keeps every row, the same array', () => {
    for (const q of ['', '   ', null, undefined]) expect(filterByTicker(all, q)).toBe(all);
  });

  it('a substring of the ticker, ignoring case, in the given order', () => {
    expect(bases(filterByTicker(all, 'pe'))).toEqual(['1000PEPE', 'PEPE']);
    expect(bases(filterByTicker(all, 'PePe'))).toEqual(['1000PEPE', 'PEPE']);
    expect(bases(filterByTicker(all, 'o'))).toEqual(['SOL', 'DOGE']);
  });

  it('spaces around the query do not count', () => {
    expect(bases(filterByTicker(all, '  btc '))).toEqual(['BTC']);
  });

  it('matches the ticker, not the symbol: «USDT» finds nothing', () => {
    expect(all.every((r) => r.symbol.endsWith('USDT'))).toBe(true); // the case this test is about
    expect(filterByTicker(all, 'usdt')).toEqual([]);
  });

  it('no match is an empty list', () => {
    expect(filterByTicker(all, 'zzz')).toEqual([]);
  });
});

describe('normalizeQuery', () => {
  it('trims, and a missing query is empty', () => {
    expect(normalizeQuery('  eth ')).toBe('eth');
    expect(normalizeQuery(null)).toBe('');
    expect(normalizeQuery(undefined)).toBe('');
  });
});
