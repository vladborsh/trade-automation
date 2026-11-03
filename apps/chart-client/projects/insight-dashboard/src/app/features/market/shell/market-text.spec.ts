import { describe, expect, it } from 'vitest';
import { WEB_INSIGHT_KEYS, WEB_KPI_IDS } from '@trade-automation/contracts';
import { en } from '../../../i18n/en';
import { ru } from '../../../i18n/ru';
import { basisView, fundingPct, insightView, kpiView, parsePeriod, periodAvailability, restatesDelta, signedPct } from './market-text';

/** IB-088 — the shell's text: periods, KPI tiles, insight cards. */
describe('period', () => {
  it('?p= parses the four periods and defaults anything else to 24h', () => {
    expect(['1h', '4h', '24h', '7d', 'x', null].map(parsePeriod)).toEqual(['1h', '4h', '24h', '7d', '24h', '24h']);
  });

  it('a period whose availableFrom is in the future is not offered, with the day it will be', () => {
    expect(periodAvailability({ '7d': 1_794_269_312 }, '7d', 1_793_700_000)).toEqual({ available: false, fromDay: '2026-11-10' });
    expect(periodAvailability({ '7d': null }, '7d', 1)).toEqual({ available: true, fromDay: null });
    expect(periodAvailability(undefined, '24h', 1)).toEqual({ available: true, fromDay: null });
  });
});

describe('number formats — the sign is explicit, a missing number stays null', () => {
  it('signed percent with a real minus sign', () => {
    expect([2.1, -0.3, 0, null].map((v) => signedPct(v))).toEqual(['+2.10 %', '−0.30 %', '0.00 %', null]);
  });
  it('funding as percent per settlement', () => {
    expect([0.0001, -0.00025, null].map(fundingPct)).toEqual(['0.0100 %', '−0.0250 %', null]);
  });
});

describe('kpiView', () => {
  const tile = (id: string, value: number | null, delta: number | null) => ({
    id, value, delta, deltaBasis: '24h', split: null, context: null, source: { name: 'X', url: null }, unavailable: value === null ? 'venue_unavailable' : null, asOf: 1,
  }) as never;

  it('each tile in its own unit, delta with sign and tone', () => {
    expect(kpiView(tile('market_cap', 2.62e12, -3.06))).toMatchObject({ value: '$2.62T', delta: { text: '−3.06 %', tone: 'down' } });
    expect(kpiView(tile('btc_dominance', 59.2, 0.4))).toMatchObject({ value: '59.2 %', delta: { text: '+0.40 pp', tone: 'up' } });
    expect(kpiView(tile('fear_greed', 26, -11))).toMatchObject({ value: '26', delta: { text: '−11', tone: 'down' } });
    expect(kpiView(tile('btc_funding', 0.0001, null))).toMatchObject({ value: '0.0100 %', delta: null });
    expect(kpiView(tile('btc_oi', null, null))).toMatchObject({ value: null, delta: null });
  });

  it('the 24h move is said ONCE: a context that restates the delta is dropped, one that adds something stays', () => {
    const withCtx = (delta: number, ctx: unknown, basis = '24h') => ({ ...(tile('market_cap', 2.62e12, delta) as object), deltaBasis: basis, context: ctx }) as never;
    const change = (deltaPct: number) => ({ key: 'kpi.ctx.change', params: { deltaPct } });
    expect(kpiView(withCtx(-2.58, change(-2.58)))).toMatchObject({ delta: { text: '−2.58 %', overKey: 'kpi.over.24h' }, context: null });
    expect(restatesDelta(withCtx(-2.58, change(-2.58), '7d'))).toBe(false); // a different period is information
    expect(restatesDelta(withCtx(-2.58, change(1.2)))).toBe(false); // a different number is information
    expect(kpiView(withCtx(2.03, { key: 'kpi.ctx.liq_side', params: { side: 'short', sharePct: 71 } })).context).toEqual({ key: 'kpi.ctx.liq.short', params: { share: 71 } });
    for (const t of [ru, en]) for (const k of ['kpi.over.24h', 'kpi.over.7d']) expect((t as Record<string, string>)[k]).toBeTruthy();
  });

  it('every tile has a label in both languages', () => {
    for (const id of WEB_KPI_IDS) for (const t of [ru, en]) expect((t as Record<string, string>)[`kpi.${id}`]).toBeTruthy();
  });
});

describe('insight keys — EVERY key in the contract has a translation (a new key without one fails here)', () => {
  it.each([...WEB_INSIGHT_KEYS])('%s', (key) => {
    for (const t of [ru, en]) {
      const s = (t as Record<string, string>)[key];
      expect(s).toBeTruthy();
      expect(s).not.toBe(key);
    }
  });
});

describe('insightView', () => {
  const st = {
    ruleId: 'R3', block: 'liquidations', key: 'insight.liq_cascade',
    params: { side: 'short', count: 4, minutes: 9, usd: 3.1e6, symbol: 'ETHUSDT' }, rarity: 0.96, magnitude: 3.1e6,
    basis: { window: '24h', venues: ['binance', 'bybit', 'okx'], sampleWindows: 720, observedWindows: 690, from: 1_791_127_530 },
    link: { route: 'instrument', symbol: 'ETHUSDT', timeSec: 1_793_712_533 },
  } as never;

  it('formats the numbers, names the nested words, and links to the chart at the moment', () => {
    const v = insightView(st, 1);
    expect(v.params).toMatchObject({ usd: '$3.1M', count: 4, minutes: 9, symbol: 'ETHUSDT' });
    expect(v.nested['side']).toBe('insight.side.short');
    expect(v.link).toEqual({ commands: ['/instrument', 'ETHUSDT'], queryParams: { at: 1_793_712_533 } });
    expect(v.basis.params).toMatchObject({ window: '24h', venues: 'binance+bybit+okx', sample: 720, observed: 690, from: '2026-10-04' });
  });

  it('a block anchor stays an anchor; no basis is said in words', () => {
    expect(insightView({ ...(st as object), link: { anchor: 'positioning' } } as never, 1).link).toEqual({ anchor: 'positioning' });
    expect(basisView(null, 1).key).toBe('insight.basis.none');
  });
});
