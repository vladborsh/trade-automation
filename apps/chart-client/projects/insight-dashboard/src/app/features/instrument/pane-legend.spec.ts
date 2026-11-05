import { ru } from '../../i18n/ru';
import type { StringKey } from '../../i18n/keys';
import { legendEntries, paneLegends } from './pane-legend';
import { PANELS } from './panels.model';
import { LEVEL_COLOURS } from './prior-levels';
import { SESSIONS } from './trading-sessions';
import { EVENT_LINE_COLOUR } from './calendar-marks';
import { CLOSED_BAND_SWATCH } from './weekend-bands';
import { DIVERGENCE_COLOURS, OI_CONTRACTS_COLOUR } from './oi-divergence-lines';
import type { WebOiDivergenceLine } from '@trade-automation/contracts';

const t = (key: StringKey): string => (ru as Record<string, string>)[key] ?? `MISSING:${key}`;
const price = PANELS.find((p) => p.key === 'price')!;
const funding = PANELS.find((p) => p.key === 'funding')!;

describe('legendEntries', () => {
  it('keys the session bands, the level lines, the event lines and the closed bands on the price pane', () => {
    const entries = legendEntries(price, { timeframe: '15m' }, t);
    expect(entries).toHaveLength(price.legend.length + SESSIONS.length + 4);
    expect(entries.slice(price.legend.length).map((e) => e.colour)).toEqual([
      ...SESSIONS.map((s) => s.swatch), LEVEL_COLOURS.day, LEVEL_COLOURS.week, EVENT_LINE_COLOUR, CLOSED_BAND_SWATCH,
    ]);
    expect(entries.at(-2)?.line).toBe(true);
    expect(entries.at(-1)?.line).toBe(false);
    for (const e of entries) expect(e.label).not.toMatch(/MISSING/);
  });

  it('drops the sessions where they are not drawn (4h, 1d), keeps the levels and the events', () => {
    expect(legendEntries(price, { timeframe: '4h' }, t)).toHaveLength(price.legend.length + 4);
    // and on 1d the closed bands too: every bar is a day there
    const daily = legendEntries(price, { timeframe: '1d' }, t);
    expect(daily).toHaveLength(price.legend.length + 3);
    expect(daily.map((e) => e.colour)).not.toContain(CLOSED_BAND_SWATCH);
  });

  it('leaves the other panes alone', () => {
    expect(legendEntries(funding, { timeframe: '1m' }, t)).toHaveLength(funding.legend.length);
  });

  it('before data, the price pane shows only its own entries', () => {
    expect(legendEntries(price, null, t)).toHaveLength(price.legend.length);
  });
});

describe('paneLegends (moved out of the chart component, IB-098)', () => {
  it('one box per pane in PANELS order, at its pane\'s top, headed with the symbol\'s units', () => {
    const edges = PANELS.map((_, i) => ({ top: i * 100 }));
    const boxes = paneLegends(t, { timeframe: '1m' }, 'BTCUSDT', edges);
    expect(boxes.map((b) => b.key)).toEqual(PANELS.map((p) => p.key));
    expect(boxes.map((b) => b.top)).toEqual(edges.map((e) => e.top));
    expect(boxes[0].heading).toBe('Цена · USDT');
    expect(boxes[0].entries).toEqual(legendEntries(price, { timeframe: '1m' }, t));
  });
});

describe('IB-081 — the coverage statements on the OI, long/short and funding panes', () => {
  const oi = PANELS.find((p) => p.key === 'openInterest')!;
  const longShort = PANELS.find((p) => p.key === 'longShort')!;
  const fundingPane = PANELS.find((p) => p.key === 'funding')!;
  const tp = (key: StringKey, params?: Record<string, string>): string =>
    ((ru as Record<string, string>)[key] ?? `MISSING:${key}`).replace(/\{(\w+)\}/g, (_, n: string) => params?.[n] ?? `{${n}}`);
  const OCT_5 = Date.UTC(2026, 9, 5) / 1000;
  const fundingWith = (unavailable?: string[]) =>
    ({ symbol: 'BTCUSDT', settled: [], predicted: [], downsampled: false, ...(unavailable ? { unavailable } : {}) });
  const lsWith = (cov: object) => ({ symbol: 'BTCUSDT', kind: 'global_account' as const, points: [], downsampled: false, ...cov });

  it('OI truncated: the pane says where its series begins, as a statement (no swatch)', () => {
    const last = legendEntries(oi, { timeframe: '1h', openInterestCoverage: { coverageFrom: OCT_5, truncated: true } }, tp).at(-1)!;
    expect(last).toEqual({ label: 'данные с 2026-10-05', colour: null, line: false });
  });

  it('long/short truncated: the same statement from its own response', () => {
    expect(legendEntries(longShort, { timeframe: '1h', longShort: lsWith({ coverageFrom: OCT_5, truncated: true }) }, tp).at(-1)?.label).toBe('данные с 2026-10-05');
  });

  it('coverageFrom without truncated adds nothing (the spec that can disagree)', () => {
    expect(legendEntries(oi, { timeframe: '1h', openInterestCoverage: { coverageFrom: OCT_5 } }, tp)).toHaveLength(oi.legend.length);
    expect(legendEntries(longShort, { timeframe: '1h', longShort: lsWith({ coverageFrom: OCT_5 }) }, tp)).toHaveLength(longShort.legend.length);
  });

  it('funding: «нет ответа: bybit, okx» when venues failed, nothing when every venue answered', () => {
    expect(legendEntries(fundingPane, { timeframe: '1h', funding: fundingWith(['bybit', 'okx']) }, tp).at(-1)?.label).toBe('нет ответа: Bybit, OKX');
    expect(legendEntries(fundingPane, { timeframe: '1h', funding: fundingWith() }, tp)).toHaveLength(fundingPane.legend.length);
    expect(legendEntries(fundingPane, { timeframe: '1h', funding: fundingWith([]) }, tp)).toHaveLength(fundingPane.legend.length);
  });

  it('each statement stays on its own pane: OI truncation does not label long/short or funding', () => {
    const data = { timeframe: '1h', openInterestCoverage: { coverageFrom: OCT_5, truncated: true }, funding: fundingWith(), longShort: lsWith({}) };
    expect(legendEntries(longShort, data, tp)).toHaveLength(longShort.legend.length);
    expect(legendEntries(fundingPane, data, tp)).toHaveLength(fundingPane.legend.length);
    expect(legendEntries(price, data, tp).map((e) => e.label)).not.toContain('данные с 2026-10-05');
  });
});

describe('IB-144 (V44) — two divergence switches: «Дивергенции OI» (regular) and «Скрытые дивергенции OI» (hidden)', () => {
  const oi = PANELS.find((p) => p.key === 'openInterest')!;
  const line = { kind: 'hidden', direction: 'bullish' } as WebOiDivergenceLine;
  const switches = (entries: ReturnType<typeof legendEntries>) => entries.filter((e) => e.toggle).map((e) => [e.label, e.toggle, e.off, e.dotted ?? false]);

  it('both entries on the price and OI panes when the frame has divergences, an empty list included; none on other panes', () => {
    for (const pane of [price, oi]) {
      expect(switches(legendEntries(pane, { timeframe: '1h', divergences: [] }, t))).toEqual([
        ['Дивергенции OI', 'regular', false, false], ['Скрытые дивергенции OI', 'hidden', false, true],
      ]);
    }
    expect(switches(legendEntries(funding, { timeframe: '1h', divergences: [] }, t))).toEqual([]);
    expect(switches(legendEntries(price, { timeframe: '1m' }, t))).toEqual([]); // a frame without divergences
  });

  it('each entry is off by its own switch only', () => {
    const data = { timeframe: '1h', divergences: [] };
    expect(switches(legendEntries(price, data, t, { regular: false, hidden: true })).map((e) => e[2])).toEqual([false, true]);
    expect(switches(legendEntries(oi, data, t, { regular: true, hidden: false })).map((e) => e[2])).toEqual([true, false]);
    const boxes = paneLegends(t, data, 'BTCUSDT', PANELS.map(() => ({ top: 0 })), { regular: false, hidden: true });
    expect(switches(boxes.find((b) => b.key === 'openInterest')!.entries).map((e) => e[2])).toEqual([false, true]);
  });

  it('the swatch colour is the bullish teal on both (colour carries direction); the hidden one is dotted', () => {
    const entries = legendEntries(price, { timeframe: '1h', divergences: [] }, t).filter((e) => e.toggle);
    expect(entries.map((e) => e.colour)).toEqual([DIVERGENCE_COLOURS.bullish, DIVERGENCE_COLOURS.bullish]);
  });

  it('the contracts line is keyed while any OI stroke is drawn — a hidden line alone counts; none drawn, no entry', () => {
    const contracts = (divergences: WebOiDivergenceLine[]) =>
      legendEntries(oi, { timeframe: '1h', divergences }, t).filter((e) => e.colour === OI_CONTRACTS_COLOUR).length;
    expect(contracts([line])).toBe(1);
    expect(contracts([])).toBe(0);
  });
});
