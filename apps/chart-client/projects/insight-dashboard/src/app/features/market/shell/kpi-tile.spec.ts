import { describe, expect, it } from 'vitest';
import { WEB_KPI_IDS, WebKpisResponseSchema, type WebKpiTile } from '@trade-automation/contracts';
import { en } from '../../../i18n/en';
import { ru } from '../../../i18n/ru';
import { kpiTileView } from './kpi-tile';
import kpisFixture from '../../../../../../../../../libs/contracts/test/fixtures/kpis.json';

/** IB-106 (§7.5) — what goes where on a KPI tile: inline word or delta, bar, note, visible credit. */
const base = (id: WebKpiTile['id'], over: Partial<WebKpiTile> = {}): WebKpiTile => ({
  id, value: 1, delta: null, deltaBasis: '24h', split: null, context: null, note: null,
  source: { name: 'Binance', url: null }, unavailable: null, asOf: 1, ...over,
});
const COINGECKO = { name: 'CoinGecko', url: 'https://www.coingecko.com' };

describe('kpiTileView', () => {
  it('cap: the delta inline with its tone and its basis, an empty track, no note, CoinGecko credited', () => {
    const v = kpiTileView(base('market_cap', { value: 2.62e12, delta: -2.97, source: COINGECKO }));
    expect(v).toMatchObject({ value: '$2.62T', inline: { text: '−2.97 %', tone: 'down', overKey: 'kpi.over.24h' }, bar: [], note: null, attribution: COINGECKO });
  });

  it('dominance: BTC share of 100 as an amber bar, ETH share as the note (one decimal)', () => {
    const v = kpiTileView(base('btc_dominance', { value: 59.31, delta: 0.4, source: COINGECKO, note: { key: 'kpi.note.eth_share', params: { ethPct: 10.64 } } }));
    expect(v.bar).toEqual([{ pct: 59.31, colour: 'var(--amber-500)' }]);
    expect(v.note).toEqual({ key: 'kpi.note.eth_share', params: { ethPct: '10.6' } });
    expect(v.inline).toMatchObject({ text: '+0.40 pp', tone: 'up' });
    expect(v.attribution).toEqual(COINGECKO);
  });

  it('liquidations: long red / short teal bar from the split, the shares as the note (summing to 100), nothing inline', () => {
    const v = kpiTileView(base('liquidations_24h', { value: 17.4e6, split: { long: 5_813_960, short: 11_580_111 },
      context: { key: 'kpi.ctx.liq_side', params: { side: 'short', sharePct: 67 } }, source: { name: 'Binance, Bybit, OKX', url: null } }));
    expect(v.bar).toEqual([{ pct: 33.4, colour: 'var(--color-down)' }, { pct: 66.6, colour: 'var(--color-up)' }]);
    expect(v.note).toEqual({ key: 'kpi.note.liq_split', params: { long: 33, short: 67 } });
    expect(v.inline).toBeNull();
    expect(v.attribution).toBeNull(); // venues: tooltip only
    expect(kpiTileView(base('liquidations_24h', { value: 0, split: { long: 0, short: 0 } }))).toMatchObject({ bar: [], note: null });
  });

  it('BTC OI: delta inline, «Binance, за 24ч» as the note, Binance in the tooltip only', () => {
    const v = kpiTileView(base('btc_oi', { value: 7.74e9, delta: 3.7 }));
    expect(v).toMatchObject({ inline: { text: '+3.70 %', tone: 'up' }, bar: [], note: { key: 'kpi.note.venue_over.24h', params: { venue: 'Binance' } }, attribution: null, sourceName: 'Binance' });
  });

  it('BTC funding: the side word inline (muted), account L/S as the note (two decimals)', () => {
    const v = kpiTileView(base('btc_funding', { value: 0.0001, context: { key: 'kpi.ctx.funding_side', params: { side: 'longs_pay' } },
      note: { key: 'kpi.note.ls_accounts', params: { ratio: 2.6189 } } }));
    expect(v).toMatchObject({ value: '0.0100 %', inline: { key: 'kpi.ctx.funding.longs_pay', tone: 'muted' }, bar: [], note: { key: 'kpi.note.ls_accounts', params: { ratio: '2.62' } }, attribution: null });
  });

  it('an unavailable tile: no value, nothing inline, an empty track — but a note the server still sent stands', () => {
    const v = kpiTileView(base('btc_funding', { value: null, unavailable: 'venue_unavailable', note: { key: 'kpi.note.ls_accounts', params: { ratio: 1.9 } } }));
    expect(v).toMatchObject({ value: null, inline: null, bar: [], note: { key: 'kpi.note.ls_accounts', params: { ratio: '1.90' } } });
    expect(kpiTileView(base('btc_oi', { value: null, unavailable: 'venue_unavailable' })).note).toBeNull();
  });

  it('the committed fixture: every tile maps, and every key the view can name exists in both languages', () => {
    const tiles = WebKpisResponseSchema.parse(kpisFixture).tiles;
    expect(tiles).toHaveLength(5); // IB-117: no Fear & Greed tile — the gauge panel carries it
    expect(tiles.map((t) => t.id)).toEqual([...WEB_KPI_IDS]);
    const keys = tiles.map(kpiTileView).flatMap((v): Array<string | null | undefined> => [v.labelKey, v.inline?.key, v.inline?.overKey, v.note?.key]).filter((k): k is string => !!k);
    keys.push('kpi.note.venue_over.7d');
    for (const t of [ru, en]) expect(keys.filter((k) => !(t as Record<string, string>)[k])).toEqual([]);
  });
});
