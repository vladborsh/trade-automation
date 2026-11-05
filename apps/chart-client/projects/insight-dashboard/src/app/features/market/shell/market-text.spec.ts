import { describe, expect, it } from 'vitest';
import { WEB_INSIGHT_KEYS, WEB_KPI_IDS, WEB_VENUE_NAMES } from '@trade-automation/contracts';
import { en } from '../../../i18n/en';
import { ru } from '../../../i18n/ru';
import { basisView, conclusionView, fundingPct, insightView, kpiView, neutralLine, sourceNames, wordInsight, parsePeriod, periodAvailability, restatesDelta, signedFixed, signedPct } from './market-text';

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
    expect(v.basis.params).toMatchObject({ venues: 'Binance+Bybit+OKX', sample: 720, observed: 690, from: '2026-10-04' });
    expect(v.basis.nested).toEqual({ window: 'market.period.24h' }); // IB-BUG-024: a word, translated
  });

  it('a block anchor stays an anchor; no basis is said in words', () => {
    expect(insightView({ ...(st as object), link: { anchor: 'positioning' } } as never, 1).link).toEqual({ anchor: 'positioning' });
    expect(basisView(null, 1).key).toBe('insight.basis.none');
  });
});

describe('conclusionView — D15, one line per block', () => {
  const basis = { window: '24h', venues: ['binance'], sampleWindows: 0, observedWindows: 0, from: 1_793_714_400 };
  it('a statement is worded with its nested keys translated into it', () => {
    const line = { block: 'liquidations', neutral: null, statement: {
      ruleId: 'R1', block: 'liquidations', key: 'insight.liq_surge', params: { side: 'long', ratio: 3.2, usd: 4.2e6 },
      rarity: 0.97, magnitude: 3.2, basis, link: { anchor: 'liquidations' },
    } } as never;
    const v = conclusionView(line, 0);
    expect(v?.kind).toBe('statement');
    const said = wordInsight((v as unknown as { view: never }).view, (k, p) => (k === 'insight.side.long' ? 'LONGS' : `${k}|${JSON.stringify(p)}`));
    expect(said).toContain('"side":"LONGS"');
    expect(said).toContain('"ratio":"×3.2"');
  });
  it('a neutral line says WHY, with its basis; every reason is translated', () => {
    for (const reason of ['nothing_unusual', 'insufficient_history', 'no_rules'] as const) {
      const v = conclusionView({ block: 'liquidations', statement: null, neutral: { key: 'insight.neutral', reason, basis } } as never, 0);
      expect(v).toMatchObject({ kind: 'neutral', key: `insight.neutral.${reason}`, basis: { key: 'insight.basis' } });
      for (const t of [ru, en]) expect((t as Record<string, string>)[`insight.neutral.${reason}`]).toBeTruthy();
    }
  });
  it('a reason without a basis (no rules for the block) carries no basis line', () => {
    const v = conclusionView({ block: 'caps', statement: null, neutral: { key: 'insight.neutral', reason: 'no_rules', basis: null } } as never, 0);
    expect(v).toEqual({ kind: 'neutral', key: 'insight.neutral.no_rules', basis: null, sources: [] });
  });

  it('before insights load there is no line at all (not «nothing unusual»)', () => {
    expect(conclusionView(null, 0)).toBeNull();
  });
});

describe('neutralLine (IB-BUG-022)', () => {
  it('unavailable beats everything, with its date and no basis; then thin history; then nothing unusual', () => {
    expect(neutralLine('2026-11-10', false)).toEqual({ key: 'insight.neutral.unavailable', date: '2026-11-10', basis: false, sources: [] });
    expect(neutralLine('2026-11-10', true).key).toBe('insight.neutral.unavailable');
    expect(neutralLine(null, true)).toEqual({ key: 'insight.neutral.insufficient_history', date: null, basis: true, sources: [] });
    expect(neutralLine(null, false)).toEqual({ key: 'insight.neutral.nothing_unusual', date: null, basis: true, sources: [] });
  });

  it('the unavailability line names the period and the date in both languages', () => {
    expect(ru['insight.neutral.unavailable']).toBe('За {period} данных пока нет — будут с {date}');
    expect(en['insight.neutral.unavailable']).toContain('{date}');
  });
});

describe('insight links (IB-BUG-023)', () => {
  const basis = { window: '24h' as const, venues: ['binance'], sampleWindows: 697, observedWindows: 697, from: 1_791_157_260 };
  const st = (ruleId: 'R3' | 'R4', timeSec: number | null) => ({
    ruleId, block: 'positioning' as const, key: 'insight.oi_vs_price' as const, params: { symbol: 'TRUMPUSDT' }, rarity: 0.92, magnitude: 7,
    basis, link: { route: 'instrument' as const, symbol: 'TRUMPUSDT', timeSec }, spark: null,
  });
  it('an R4 link carries span=<its period>: the page opens on the whole period with its start marked', () => {
    expect(insightView(st('R4', 1_793_670_000), 1_793_756_400).link).toEqual({ commands: ['/instrument', 'TRUMPUSDT'], queryParams: { at: 1_793_670_000, span: '24h' } });
  });
  it('a moment (R3) stays a moment; no time stays no query', () => {
    expect(insightView(st('R3', 1_793_670_000), 1_793_756_400).link).toEqual({ commands: ['/instrument', 'TRUMPUSDT'], queryParams: { at: 1_793_670_000 } });
    expect(insightView(st('R4', null), 1_793_756_400).link).toEqual({ commands: ['/instrument', 'TRUMPUSDT'], queryParams: null });
  });
});

describe('the basis line says the period as a word (IB-BUG-024)', () => {
  const fill = (dict: Record<string, string>) => (key: string, params: Record<string, string | number> = {}) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
  const b = { window: '24h' as const, venues: ['binance'], sampleWindows: 697, observedWindows: 697, from: 1_791_157_260 };
  it('ru «за 24ч», en «over 24h»-style label — never the bare code next to Russian words', () => {
    const ruLine = wordInsight(basisView(b, 0), fill(ru as Record<string, string>) as never);
    expect(ruLine.startsWith(`за ${ru['market.period.24h']} ·`)).toBe(true);
    expect(ruLine).not.toContain('24h');
    expect(wordInsight(basisView({ ...b, window: '1h' }, 0), fill(ru as Record<string, string>) as never)).toContain(`за ${ru['market.period.1h']}`);
  });
});

describe('IB-BUG-028: a line that could not look names what did not answer', () => {
  const t = (k: string) => (ru as Record<string, string>)[k] ?? k;
  it('a source_unavailable block line carries its sources; the tape is a phrase, venues are names', () => {
    const v = conclusionView({ block: 'flows', statement: null, neutral: { key: 'insight.neutral', reason: 'source_unavailable', basis: null, sources: ['deribit', 'coinbase', 'binance'] } }, 0);
    expect(v).toMatchObject({ kind: 'neutral', key: 'insight.neutral.source_unavailable', sources: ['deribit', 'coinbase', 'binance'] });
    expect(sourceNames(['tape', 'binance'], t as never)).toBe('наша лента ликвидаций, Binance');
  });
  it('«Главное сейчас»: every source down → that, never «nothing unusual»; an unavailable period still comes first', () => {
    expect(neutralLine(null, true, ['tape', 'binance'])).toEqual({ key: 'insight.neutral.source_unavailable', date: null, basis: false, sources: ['tape', 'binance'] });
    expect(neutralLine('2026-11-10', false, ['tape']).key).toBe('insight.neutral.unavailable');
  });
});


/** An ASCII hyphen directly before a digit, not inside a word or a date («2026-10-04», «top-50»). */
const ASCII_MINUS = /(?<![\w.])-\d/;

describe('IB-BUG-032: every signed figure takes the page\'s minus «−», never the ASCII hyphen', () => {
  it('signedFixed', () => {
    expect([2.4, -2.4, 0].map((v) => signedFixed(v, 1))).toEqual(['+2.4', '−2.4', '0.0']);
  });

  it('a statement with EVERY signed parameter negative prints no hyphen-minus', () => {
    const negative = {
      ruleId: 'R8', block: 'flows', key: 'insight.dvol_spike',
      params: { usd: -9.06e8, oiPct: -20.5, pricePct: -2.15, altGapPct: -1.2, change: -2.4, pct: -0.014, rate: -0.00025, value: 37.4 },
      rarity: 0.95, magnitude: 1, basis: null, link: { anchor: 'flows' },
    } as never;
    const params = insightView(negative, 1).params;
    for (const k of ['usd', 'oiPct', 'pricePct', 'altGapPct', 'change', 'pct', 'rate']) {
      expect(String(params[k]), k).toContain('−');
      expect(String(params[k]), k).not.toMatch(ASCII_MINUS);
    }
    expect(params['change']).toBe('−2.4');
  });

  // a level (a cap, a dominance, an index) is never negative; funding is the one signed tile value
  it('a negative delta on EVERY KPI tile, and a negative funding rate', () => {
    for (const id of WEB_KPI_IDS) {
      const v = kpiView({ id, value: id === 'btc_funding' ? -0.00025 : 1, delta: -3.06, deltaBasis: '24h', split: null, context: null, source: { name: 'X', url: null }, unavailable: null, asOf: 1 } as never);
      expect(`${v.value} ${v.delta?.text}`, id).not.toMatch(ASCII_MINUS);
      expect(v.delta?.text, id).toContain('−');
    }
    expect(kpiView({ id: 'btc_funding', value: -0.00025, delta: null, deltaBasis: '24h', split: null, context: null, source: { name: 'X', url: null }, unavailable: null, asOf: 1 } as never).value).toBe('−0.0250 %');
  });
});

describe('IB-BUG-032: a basis line spells every venue as the credit line does, never its raw key', () => {
  const fill = (key: string, params: Record<string, string | number> = {}) =>
    ((ru as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
  const line = (venues: string[]) => wordInsight(basisView({ window: '24h', venues, sampleWindows: 30, observedWindows: 22, from: 1_791_157_260 }, 0), fill as never);

  it.each(Object.entries(WEB_VENUE_NAMES))('%s → «%s»', (key, name) => {
    const l = line([key]);
    expect(l).toContain(name);
    expect(l).not.toMatch(new RegExp(`\\b${key}\\b`)); // case-sensitive: «okx» fails, «OKX» passes
  });

  it('the lists the rules send today (R1–R10)', () => {
    expect(line(['binance', 'bybit', 'okx'])).toContain('Binance+Bybit+OKX');
    expect(line(['defillama'])).toContain('DefiLlama');
    expect(line(['coinbase', 'binance'])).toContain('Coinbase+Binance');
  });

  it('the «could not read» list uses the same spelling', () => {
    expect(sourceNames(['deribit', 'defillama', 'coinbase', 'binance'], fill as never)).toBe('Deribit, DefiLlama, Coinbase, Binance');
  });
});
