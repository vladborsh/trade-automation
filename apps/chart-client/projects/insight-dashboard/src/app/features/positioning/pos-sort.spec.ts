import type { WebPositioningResponse, WebPositioningRow } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../../libs/contracts/test/fixtures/positioning.24h.json';
import { DEFAULT_SORT, nextSort, parseSort, sortQuery, sortRows } from './pos-sort';

/**
 * IB-103 — the table's sort, on the contract fixture (BTC, ETH, SOL, DOGE) plus rows built to
 * disagree with a careless implementation: missing values, ties, a rarity that differs from the value.
 */
const rows = (fixture as unknown as WebPositioningResponse).rows;
const cell = (value: number | null, rarity: number | null) =>
  ({ value, rarity, unavailable: value === null ? 'insufficient_history' : null, sample: 30 }) as WebPositioningRow['priceChangePct'];
const row = (base: string, price: number | null, priceRarity: number | null, oiUsd: number | null = 1e9): WebPositioningRow => ({
  ...rows[0], symbol: `${base}USDT`, base, priceChangePct: cell(price, priceRarity), oiUsd,
});
const bases = (rs: WebPositioningRow[]) => rs.map((r) => r.base);

describe('sortRows', () => {
  it('default: the most unusual row first (the old table\'s order on the fixture)', () => {
    expect(bases(sortRows(rows, 'rarity', 'desc'))).toEqual(['SOL', 'ETH', 'BTC', 'DOGE']);
  });

  it('by a column\'s value, both ways; a missing value is LAST in both directions', () => {
    const rs = [row('B', 2, 0.1), row('N', null, null), row('A', -1, 0.9), row('C', 5, 0.5)];
    expect(bases(sortRows(rs, 'priceChangePct', 'desc'))).toEqual(['C', 'B', 'A', 'N']);
    expect(bases(sortRows(rs, 'priceChangePct', 'asc'))).toEqual(['A', 'B', 'C', 'N']);
  });

  it('by a column\'s RARITY, which is not its value: a small move can be the rare one', () => {
    const rs = [row('BIG', 9, 0.2), row('SMALL', 0.5, 0.99), row('MID', 3, 0.6)];
    expect(bases(sortRows(rs, 'priceChangePct.rarity', 'desc'))).toEqual(['SMALL', 'MID', 'BIG']);
    expect(bases(sortRows(rs, 'priceChangePct', 'desc'))).toEqual(['BIG', 'MID', 'SMALL']);
  });

  it('by OI (USD), with a coin of unknown OI last', () => {
    const rs = [row('S', 1, 0.5, 1e8), row('U', 1, 0.5, null), row('L', 1, 0.5, 5e9)];
    expect(bases(sortRows(rs, 'oi', 'desc'))).toEqual(['L', 'S', 'U']);
    expect(bases(sortRows(rs, 'oi', 'asc'))).toEqual(['S', 'L', 'U']);
  });

  it('by ticker', () => {
    expect(bases(sortRows(rows, 'base', 'asc'))).toEqual(['BTC', 'DOGE', 'ETH', 'SOL']);
    expect(bases(sortRows(rows, 'base', 'desc'))).toEqual(['SOL', 'ETH', 'DOGE', 'BTC']);
  });

  it('equal on the key → by ticker, whatever order the server listed them in', () => {
    const rs = [row('ZED', 1, 0.5), row('ABC', 1, 0.5), row('MMM', 1, 0.5)];
    expect(bases(sortRows(rs, 'priceChangePct', 'desc'))).toEqual(['ABC', 'MMM', 'ZED']);
    expect(bases(sortRows([...rs].reverse(), 'priceChangePct', 'asc'))).toEqual(['ABC', 'MMM', 'ZED']);
    // several missing values: also by ticker, at the bottom
    const gaps = [row('Y', null, null), row('X', null, null), row('A', 1, 0.5)];
    expect(bases(sortRows(gaps, 'priceChangePct', 'desc'))).toEqual(['A', 'X', 'Y']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    sortRows(rows, 'base', 'desc');
    expect(rows).toEqual(copy);
  });
});

describe('the sort in the URL', () => {
  it('parses every key, both ways', () => {
    expect(parseSort('oiChangePct.rarity', 'asc')).toEqual({ key: 'oiChangePct.rarity', dir: 'asc' });
    expect(parseSort('base', null)).toEqual({ key: 'base', dir: 'asc' }); // a new key's first direction
    expect(parseSort('oi', 'sideways')).toEqual({ key: 'oi', dir: 'desc' });
  });

  it('an unknown or missing key falls back to the default instead of throwing', () => {
    expect(parseSort('nonsense', 'asc')).toEqual(DEFAULT_SORT);
    expect(parseSort(null, null)).toEqual(DEFAULT_SORT);
  });

  it('round-trips, and the default writes no params (the plain link stays plain)', () => {
    const s = { key: 'fundingRate' as const, dir: 'asc' as const };
    const q = sortQuery(s);
    expect(parseSort(q.sort, q.dir)).toEqual(s);
    expect(sortQuery(DEFAULT_SORT)).toEqual({ sort: null, dir: null });
  });

  it('a tapped header: same key flips, a new key starts biggest-first, the ticker A→Z', () => {
    expect(nextSort(DEFAULT_SORT, 'rarity')).toEqual({ key: 'rarity', dir: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'liqUsd')).toEqual({ key: 'liqUsd', dir: 'desc' });
    expect(nextSort(DEFAULT_SORT, 'base')).toEqual({ key: 'base', dir: 'asc' });
  });
});
