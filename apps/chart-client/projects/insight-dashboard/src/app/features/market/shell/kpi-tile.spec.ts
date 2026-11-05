import { describe, expect, it } from 'vitest';
import { WEB_KPI_IDS, WebKpisResponseSchema, type WebKpiTile } from '@trade-automation/contracts';
import { en } from '../../../i18n/en';
import { ru } from '../../../i18n/ru';
import { FULL_SPAN_SEC, kpiTileView, ruPlural } from './kpi-tile';
import kpisFixture from '../../../../../../../../../libs/contracts/test/fixtures/kpis.json';

/** IB-106 (§7.5) — what goes where on a KPI tile: inline word or delta, bar, note, visible credit. */
const base = (id: WebKpiTile['id'], over: Partial<WebKpiTile> = {}): WebKpiTile => ({
  id, value: 1, delta: null, deltaBasis: '24h', split: null, context: null, note: null,
  source: { name: 'Binance', url: null }, unavailable: null, asOf: 1, history: null, ...over,
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

describe('IB-118: the 7-day chart, its min / max row and its caption', () => {
  const DAY = 86_400;
  const area = (values: number[], spanSec: number, breakAfterSec = 1800): WebKpiTile['history'] => {
    const step = spanSec / (values.length - 1);
    const points = values.map((value, i) => ({ time: 1_000_000 + Math.round(i * step), value }));
    return { kind: 'area', points, from: points[0].time, to: points[points.length - 1].time, min: Math.min(...values), max: Math.max(...values), breakAfterSec, second: null };
  };
  const settlements = (n: number): WebKpiTile['history'] => {
    const points = Array.from({ length: n }, (_, i) => ({ time: 1_000_000 + i * 28_800, value: (i % 5 - 1) / 1e5 }));
    const v = points.map((p) => p.value);
    return { kind: 'bars', points, from: points[0].time, to: points[n - 1].time, min: Math.min(...v), max: Math.max(...v), breakAfterSec: null, second: null };
  };

  it('IB-BUG-038: a tile with NO history field (a server older than IB-118) is a tile without a chart, not a crash', () => {
    for (const id of ['market_cap', 'btc_oi', 'btc_funding'] as const) {
      const { history: _absent, ...old } = base(id, { value: 1 });
      const v = kpiTileView(old as WebKpiTile);
      expect(v).toMatchObject({ chart: null, range: null, caption: null });
    }
    const { history: _h, ...oi } = base('btc_oi', { value: 7.7e9 });
    expect(kpiTileView(oi as WebKpiTile).note).toEqual({ key: 'kpi.note.venue_over.24h', params: { venue: 'Binance' } }); // as before IB-118
  });

  it('null history draws no chart: the tile is as before (cap: CoinGecko credited, no range)', () => {
    const v = kpiTileView(base('market_cap', { value: 2.68e12, source: COINGECKO, history: null }));
    expect(v).toMatchObject({ chart: null, range: null, caption: null, attribution: COINGECKO });
  });

  it('cap over 7 days: the chart, «7д мин $2.61T» / «макс $2.79T» (the points\' own min and max), «CoinGecko · 7 дней» with the link', () => {
    const history = area([2.70e12, 2.79e12, 2.61e12, 2.68e12], 7 * DAY - 600);
    const v = kpiTileView(base('market_cap', { value: 2.68e12, source: COINGECKO, history }));
    expect(v.chart?.kind).toBe('area');
    expect(v.range).toEqual({ left: { key: 'kpi.range.min_7d', params: { value: '$2.61T' } }, right: { key: 'kpi.range.max', params: { value: '$2.79T' } } });
    expect(v.caption).toEqual({ source: { ...COINGECKO, link: true }, text: { key: 'kpi.caption.7d', params: {} } });
    expect(v.attribution).toBeNull(); // the caption carries the credit
  });

  it('a shorter span is named, not passed off as 7 days: «мин» and «за 2 д 5 ч»', () => {
    const v = kpiTileView(base('market_cap', { value: 2.68e12, source: COINGECKO, history: area([2.6e12, 2.7e12], 2 * DAY + 5 * 3_600 + 1_200) }));
    expect(v.range?.left).toEqual({ key: 'kpi.range.min', params: { value: '$2.60T' } });
    expect(v.caption?.text).toEqual({ key: 'kpi.caption.span', params: { d: 2, h: 5 } });
    expect(kpiTileView(base('market_cap', { history: area([1, 2], FULL_SPAN_SEC) })).caption?.text.key).toBe('kpi.caption.7d');
    expect(kpiTileView(base('market_cap', { history: area([1, 2], FULL_SPAN_SEC - 1) })).caption?.text.key).toBe('kpi.caption.span');
  });

  it('cap table still filling: no chart, «копим историю: 3 ч» in the range row, no note', () => {
    const v = kpiTileView(base('market_cap', { value: 2.68e12, source: COINGECKO, history: null, note: { key: 'kpi.note.collecting', params: { hours: 3 } } }));
    expect(v).toMatchObject({ chart: null, note: null, range: { left: { key: 'kpi.note.collecting', params: { hours: 3 } }, right: null }, attribution: COINGECKO });
  });

  it('BTC OI: USD min / max ($7.4B), «Binance · 7 дней» as plain text in place of «Binance, за 24ч»', () => {
    const v = kpiTileView(base('btc_oi', { value: 7.7e9, delta: -0.65, history: area([7.9e9, 7.4e9, 8.1e9, 7.7e9], 7 * DAY - 3_600, 5_400) }));
    expect(v.range).toEqual({ left: { key: 'kpi.range.min_7d', params: { value: '$7.4B' } }, right: { key: 'kpi.range.max', params: { value: '$8.1B' } } });
    expect(v.caption).toEqual({ source: { name: 'Binance', url: null, link: false }, text: { key: 'kpi.caption.7d', params: {} } });
    expect(v.note).toBeNull();
    expect(v.inline).toMatchObject({ text: '−0.65 %', overKey: 'kpi.over.24h' }); // the delta stays 24 h
  });

  it('BTC funding: bars, «последние 21 выплата» / «L/S счета 1.40» (the L/S note moves to the range row)', () => {
    const v = kpiTileView(base('btc_funding', { value: 0.0001, history: settlements(21), note: { key: 'kpi.note.ls_accounts', params: { ratio: 1.4 } } }));
    expect(v.chart?.kind).toBe('bars');
    expect(v.range).toEqual({ left: { key: 'kpi.range.settlements.one', params: { n: 21 } }, right: { key: 'kpi.range.ls_accounts', params: { ratio: '1.40' } } });
    expect(v.caption?.text.key).toBe('kpi.caption.funding');
    expect(v.note).toBeNull();
    expect(kpiTileView(base('btc_funding', { history: settlements(20) })).range?.left?.key).toBe('kpi.range.settlements.many');
  });

  it('liquidations keep their bar even if a history came', () => {
    const v = kpiTileView(base('liquidations_24h', { value: 10, split: { long: 4, short: 6 }, history: area([1, 2], 7 * DAY) }));
    expect(v).toMatchObject({ chart: null, range: null, caption: null, bar: [{ pct: 40 }, { pct: 60 }] });
  });

  it('ruPlural: 1, 21 one; 2–4, 22 few; 5–20, 11–14, 25 many', () => {
    expect([1, 21, 2, 4, 22, 5, 11, 12, 14, 20, 25, 111].map(ruPlural)).toEqual(['one', 'one', 'few', 'few', 'few', 'many', 'many', 'many', 'many', 'many', 'many', 'many']);
  });
  it('the committed fixture: the four charts map, and every key the view can name exists in both languages', () => {
    const views = WebKpisResponseSchema.parse(kpisFixture).tiles.map(kpiTileView);
    expect(views.map((v) => v.chart?.kind ?? null)).toEqual(['area', 'lines', null, 'area', 'bars']);
    const keys = views.flatMap((v): Array<string | undefined> => [v.range?.left?.key, v.range?.right?.key, v.caption?.text.key]).filter((k): k is string => !!k);
    keys.push('kpi.range.min', 'kpi.range.min_7d', 'kpi.range.dominance_btc', 'kpi.range.dominance_btc_7d', 'kpi.range.dominance_eth', 'kpi.caption.7d', 'kpi.caption.span', 'kpi.note.collecting',
      'kpi.range.settlements.one', 'kpi.range.settlements.few', 'kpi.range.settlements.many');
    for (const t of [ru, en]) expect(keys.filter((k) => !(t as Record<string, string>)[k])).toEqual([]);
  });
});

describe('IB-131: dominance — BTC and ETH strips, «7д BTC a–b %» / «ETH c–d %», the ETH note kept', () => {
  const DAY = 86_400;
  /** BTC and ETH every 10 min over `spanSec`; `ethSkip` drops those ETH indices (a BTC row without ETH). */
  const lines = (btc: number[], eth: number[], spanSec: number, ethSkip: number[] = []): WebKpiTile['history'] => {
    const step = spanSec / (btc.length - 1);
    const t = (i: number) => 1_000_000 + Math.round(i * step);
    const points = btc.map((value, i) => ({ time: t(i), value }));
    const ethPoints = eth.map((value, i) => ({ time: t(i), value })).filter((_, i) => !ethSkip.includes(i));
    const ev = ethPoints.map((p) => p.value);
    return {
      kind: 'lines', points, from: points[0].time, to: points[points.length - 1].time, min: Math.min(...btc), max: Math.max(...btc), breakAfterSec: 1800,
      second: { label: 'ETH', points: ethPoints, min: Math.min(...ev), max: Math.max(...ev) },
    };
  };
  const ethNote = { key: 'kpi.note.eth_share' as const, params: { ethPct: 11.04 } };
  const dom = (history: WebKpiTile['history']) =>
    kpiTileView(base('btc_dominance', { value: 60.07, delta: 0.4, source: COINGECKO, history, note: ethNote }));

  it('a week: the lines chart in place of the bar, the range from each line\'s own min / max (one decimal), the ETH note after the caption', () => {
    const v = dom(lines([60.07, 59.84, 60.46, 60.12], [10.97, 11.31, 10.88, 11.04], 7 * DAY - 600));
    expect(v.chart?.kind).toBe('lines');
    expect(v.range).toEqual({ left: { key: 'kpi.range.dominance_btc_7d', params: { min: '59.8', max: '60.5' } }, right: { key: 'kpi.range.dominance_eth', params: { min: '10.9', max: '11.3' } } });
    expect(v.caption).toEqual({ source: { ...COINGECKO, link: true }, text: { key: 'kpi.caption.7d', params: {} } });
    expect(v.note).toEqual({ key: 'kpi.note.eth_share', params: { ethPct: '11.0' } }); // kept: the owner asked for it
    expect(v.value).not.toBeNull(); // the value and its 24 h delta stay
    expect(v.inline).toMatchObject({ text: expect.any(String), overKey: 'kpi.over.24h' });
    expect(v.attribution).toBeNull(); // the caption carries the CoinGecko link
  });

  it('under 7 days the span is named and the range drops «7д», as on the cap tile', () => {
    const v = dom(lines([60, 61], [11, 10], 1 * DAY + 3 * 3_600));
    expect(v.range?.left?.key).toBe('kpi.range.dominance_btc');
    expect(v.caption?.text).toEqual({ key: 'kpi.caption.span', params: { d: 1, h: 3 } });
  });

  it('null history leaves the tile exactly as before: the amber share bar and the ETH note, no range, no «копим историю»', () => {
    const v = dom(null);
    expect(v).toMatchObject({ chart: null, range: null, caption: null, bar: [{ pct: 60.07, colour: 'var(--amber-500)' }], attribution: COINGECKO });
    expect(v.note).toEqual({ key: 'kpi.note.eth_share', params: { ethPct: '11.0' } });
  });

  it('the rendered words: «7д BTC 59.8–60.5 %» / «ETH 10.9–11.3 %» in Russian, «7d BTC …» in English', () => {
    expect(ru['kpi.range.dominance_btc_7d']).toBe('7д BTC {min}–{max} %');
    expect(en['kpi.range.dominance_btc_7d']).toBe('7d BTC {min}–{max} %');
    expect(ru['kpi.range.dominance_btc']).not.toContain('7д');
    expect([ru['kpi.range.dominance_eth'], en['kpi.range.dominance_eth']]).toEqual(['ETH {min}–{max} %', 'ETH {min}–{max} %']);
  });
});
