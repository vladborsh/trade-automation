import type { WebFlowsResponse } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import example from '../../../../../../../../libs/contracts/test/fixtures/flows.24h.json';
import { flowsTiles, sourceNames, UNUSUAL } from './flows-layout';

/** IB-091 — the tiles from the contract's example (one real probe of each source). */
const base = example as unknown as WebFlowsResponse;
const tile = (r: WebFlowsResponse, id: string) => flowsTiles(r, '24h').find((t) => t.id === id)!;

describe('flowsTiles', () => {
  it('four tiles from the real answers, each with its figure, its words and its series', () => {
    const t = flowsTiles(base, '24h');
    expect(t.map((x) => x.id)).toEqual(['dvol', 'putCall', 'stablecoins', 'coinbasePremium']);
    expect(tile(base, 'dvol')).toMatchObject({ value: '39.7', detail: { key: 'flows.dvol.change', params: { change: '+1.1', period: '24h' } }, tone: 'up' });
    expect(tile(base, 'putCall')).toMatchObject({ value: '0.99', note: { params: { volume: '1.79', date: '2026-11-03' } } });
    expect(tile(base, 'stablecoins')).toMatchObject({ value: '$296B', tone: 'down' }); // in coins (D19)
    expect(tile(base, 'stablecoins').detail?.params['days']).toBe(1);
    expect(tile(base, 'stablecoins').detail?.params['usd']).toBe('−$906M'); // the page's minus, not '-'
    expect(tile(base, 'coinbasePremium').note.key).toBe('flows.premium.note'); // "against the dollar, USDT corrected"
    expect(tile(base, 'coinbasePremium').detail).toMatchObject({ key: 'flows.premium.minutes', params: { same: 60, minutes: 60 } });
    expect(t.every((x) => x.series.length > 0)).toBe(true);
  });

  it('unusual at the D2 threshold, not below', () => {
    const at = (rarity: number) => tile({ ...base, dvol: { ...base.dvol, change: { ...base.dvol.change!, rarity } } }, 'dvol').unusual;
    expect(at(UNUSUAL)).toBe(true);
    expect(at(0.89)).toBe(false);
  });

  it('D18: too few valid minutes → the value stands, the reason is said, and NO sign or colour is called', () => {
    const thin = { ...base, coinbasePremium: { ...base.coinbasePremium, unavailable: 'insufficient_minutes' as const, minutes: 44, premiumPct: { ...base.coinbasePremium.premiumPct!, value: -0.2, rarity: 0.99 } } };
    const p = tile(thin, 'coinbasePremium');
    expect(p.value).toBe('−0.200 %');
    expect(p.reason).toEqual({ key: 'flows.reason.insufficient_minutes', params: { minutes: 44 } });
    expect(p.tone).toBe('flat');
    expect(p.unusual).toBe(false);
    expect(p.detail).toBeNull();
  });

  it('a tile the source did not answer has no figure and says so', () => {
    const down = { ...base, dvol: { ...base.dvol, value: null, change: null, series: [], unavailable: 'source_unavailable' as const } };
    expect(tile(down, 'dvol')).toMatchObject({ value: null, detail: null, reason: { key: 'flows.reason.source_unavailable' } });
  });

  it('names every source once', () => {
    expect(sourceNames(base)).toBe('Deribit · OKX · DefiLlama · Coinbase');
  });
});
