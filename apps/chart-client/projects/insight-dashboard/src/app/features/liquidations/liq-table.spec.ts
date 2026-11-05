import type { WebLiquidationLargeRow } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../../libs/contracts/test/fixtures/liquidations-large.24h.json';
import { LIQ_COLUMNS, LIQ_DEFAULT_SORT, LIQ_PHONE_HIDDEN, formatPrice, liqRowView, nextLiqSort, parseLiqSort, seriesOf, sortLiqRows } from './liq-table';

/** IB-120 — the /liquidations table's cells and sorting, on the contract fixture. */
const rows = fixture.rows as WebLiquidationLargeRow[];
const by = (column: (typeof LIQ_COLUMNS)[number], dir: 'asc' | 'desc') => sortLiqRows(rows, { column, dir });

describe('sortLiqRows', () => {
  it('default: newest first, as the server sends', () => {
    expect(by('time', 'desc').map((r) => r.time)).toEqual(rows.map((r) => r.time));
  });

  it('every column sorts, both ways', () => {
    expect(by('usd', 'desc').map((r) => r.usd)).toEqual([11_000_000, 9_700_000, 5_700_000, 1_200_000, 240_000, 130_000]);
    expect(by('usd', 'asc').map((r) => r.usd)).toEqual([130_000, 240_000, 1_200_000, 5_700_000, 9_700_000, 11_000_000]);
    expect(by('base', 'asc').map((r) => r.base)).toEqual(['BTC', 'BTC', 'BTC', 'DOGE', 'ETH', 'SOL']);
    expect(by('side', 'asc')[0].side).toBe('long');
    expect(by('price', 'asc')[0].base).toBe('DOGE');
    expect(by('venue', 'asc').map((r) => r.venue)).toEqual(['binance', 'binance', 'binance', 'bybit', 'okx', 'okx']);
    expect(by('series', 'desc').slice(0, 3).every((r) => r.seriesCount === 44)).toBe(true);
    expect(by('time', 'asc')[0].base).toBe('DOGE');
  });

  it('ties fall back to newest first', () => {
    // the three BTC rows share the base; newest of them first
    const btc = by('base', 'asc').filter((r) => r.base === 'BTC').map((r) => r.time);
    expect(btc).toEqual([...btc].sort((a, b) => b - a));
  });

  it('does not reorder its input', () => {
    const before = rows.map((r) => r.time);
    by('usd', 'asc');
    expect(rows.map((r) => r.time)).toEqual(before);
  });
});

describe('nextLiqSort / parseLiqSort', () => {
  it('the same header flips; a new header starts biggest/newest first, words A→Z', () => {
    expect(nextLiqSort(LIQ_DEFAULT_SORT, 'time')).toEqual({ column: 'time', dir: 'asc' });
    expect(nextLiqSort(LIQ_DEFAULT_SORT, 'usd')).toEqual({ column: 'usd', dir: 'desc' });
    expect(nextLiqSort(LIQ_DEFAULT_SORT, 'base')).toEqual({ column: 'base', dir: 'asc' });
  });

  it('a URL sort it does not know is the default', () => {
    expect(parseLiqSort('usd', 'asc')).toEqual({ column: 'usd', dir: 'asc' });
    expect(parseLiqSort('nope', 'asc')).toEqual(LIQ_DEFAULT_SORT);
    expect(parseLiqSort(null, null)).toEqual(LIQ_DEFAULT_SORT);
  });
});

describe('cells', () => {
  it('series «{count} за {min} мин» by the Market card\'s rule; none below 3 or without an id', () => {
    expect(seriesOf(rows[1])).toEqual({ count: 44, minutes: 9 });
    expect(seriesOf(rows[0])).toBeNull();
    expect(seriesOf({ ...rows[1], seriesCount: 2 })).toBeNull();
    expect(seriesOf({ ...rows[1], seriesSpanSec: 10 })).toEqual({ count: 44, minutes: 1 });
  });

  it('price as the mockup groups it', () => {
    expect(formatPrice(69_412)).toBe('69\u202f412');
    expect(formatPrice(2_391.4)).toBe('2\u202f391');
    expect(formatPrice(182.35)).toBe('182.35');
    expect(formatPrice(0.1712)).toBe('0.1712');
  });

  it('a row view: venue spelled by its owner, link to the instrument at that minute, day shown on 7d', () => {
    const v = liqRowView(rows[1], false, 'UTC');
    expect(v.venue).toBe('OKX');
    expect(v.usd).toBe('$5.7M');
    expect(v.link).toEqual({ commands: ['/instrument', 'BTCUSDT'], queryParams: { at: rows[1].time } });
    expect(v.time).toMatch(/^\d\d:\d\d$/);
    expect(liqRowView(rows[1], true, 'UTC').time).toMatch(/^\d\d\/\d\d \d\d:\d\d$/);
  });

  it('on a phone, exactly price and venue are dropped', () => {
    expect([...LIQ_PHONE_HIDDEN]).toEqual(['price', 'venue']);
  });
});
