import { WEB_INSIGHT_BLOCKS, WEB_INSIGHT_KEYS, WEB_INSIGHT_SOURCES, WEB_INSIGHT_CHART_MAX_POINTS, WebInsightBlockLineSchema, WebInsightChartSchema, WebInsightStatementSchema, WebInsightsResponseSchema } from '../src/insight';

/** IB-086 — «Главное сейчас» (design D1–D5, D15). Fixtures are what IB-088 builds against. */
describe('IB-086 contracts', () => {
  it('blocks and sentence keys are closed lists', () => {
    expect([...WEB_INSIGHT_BLOCKS]).toEqual(['liquidations', 'positioning', 'caps', 'flows', 'sentiment']);
    expect(WEB_INSIGHT_KEYS).toContain('insight.neutral');
    expect(WEB_INSIGHT_KEYS).toHaveLength(12); // IB-091: R8–R10; IB-113: R11
  });

  it('a statement whose key is not in the list does not parse', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const s = require('./fixtures/insights.24h.json').top[0];
    expect(WebInsightStatementSchema.safeParse(s).success).toBe(true);
    expect(WebInsightStatementSchema.safeParse({ ...s, key: 'insight.made_up' }).success).toBe(false);
  });

  it('the 24h example and the first-week example parse; the first week says WHY liquidations are silent', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const day = WebInsightsResponseSchema.parse(require('./fixtures/insights.24h.json'));
    expect(day.top.length).toBeLessThanOrEqual(5);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const week = WebInsightsResponseSchema.parse(require('./fixtures/insights.first-week.json'));
    expect(week.blocks[0]).toMatchObject({ block: 'liquidations', statement: null, neutral: { reason: 'insufficient_history' } });
  });

  it('six statements do not parse — the top is at most five', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const day = require('./fixtures/insights.24h.json');
    const six = [...day.top, ...day.top].slice(0, 6);
    expect(WebInsightsResponseSchema.safeParse({ ...day, top: six }).success).toBe(false);
  });
});

describe('IB-BUG-028: a block line that could not look says so, and names the source', () => {
  const line = (neutral: object) => WebInsightBlockLineSchema.safeParse({ block: 'flows', statement: null, neutral: { key: 'insight.neutral', basis: null, ...neutral } });
  it('source_unavailable carries the sources; no other reason may', () => {
    expect(line({ reason: 'source_unavailable', sources: ['deribit', 'defillama'] }).success).toBe(true);
    expect(line({ reason: 'source_unavailable' }).success).toBe(false);
    expect(line({ reason: 'source_unavailable', sources: [] }).success).toBe(false);
    expect(line({ reason: 'nothing_unusual', sources: ['deribit'] }).success).toBe(false);
    expect(line({ reason: 'nothing_unusual' }).success).toBe(true); // additive: old lines still parse
  });
  it('the sources are a closed list', () => {
    expect([...WEB_INSIGHT_SOURCES]).toEqual(['tape', 'binance', 'deribit', 'defillama', 'coinbase']);
    expect(line({ reason: 'source_unavailable', sources: ['somewhere'] }).success).toBe(false);
  });
});


describe('IB-BUG-048: a block whose rules never rate at this period says so', () => {
  const line = (neutral: object) => WebInsightBlockLineSchema.safeParse({ block: 'sentiment', statement: null, neutral: { key: 'insight.neutral', basis: null, ...neutral } });
  it('not_rated_at_period is a reason of its own, with no sources', () => {
    expect(line({ reason: 'not_rated_at_period' }).success).toBe(true);
    expect(line({ reason: 'not_rated_at_period', sources: ['binance'] }).success).toBe(false);
  });
});

describe('IB-119 (round 2 §3): a statement carries a real chart, or says it has none', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const day = require('./fixtures/insights.24h.json');
  const s = day.top[0];
  const chart = s.chart;
  const ok = (c: unknown) => WebInsightChartSchema.safeParse(c).success;
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ time: 1_793_700_000 + i * 60, value: i }));

  it('chart is required on the wire and may be null; the old spark field is gone', () => {
    expect(WebInsightStatementSchema.safeParse({ ...s, chart: null }).success).toBe(true);
    const { chart: _omitted, ...without } = s;
    expect(WebInsightStatementSchema.safeParse(without).success).toBe(false);
    expect(WebInsightStatementSchema.parse({ ...s, spark: { values: [1, 2], highlight: null } })).not.toHaveProperty('spark');
  });

  it('the fixture charts parse: R4 two lines from 0, R5 bars with a band, R3 mirrored minutes', () => {
    const top = WebInsightsResponseSchema.parse(day).top;
    expect(top.map((t) => [t.ruleId, t.chart?.kind])).toEqual([['R4', 'lines'], ['R5', 'bars'], ['R3', 'bars_mirror']]);
    expect(top[1]?.chart?.band).not.toBeNull();
  });

  it('at most 300 points a series and at most 2 series; at least one point', () => {
    const one = { key: 'price', points: points(300) };
    expect(ok({ ...chart, series: [one] })).toBe(true);
    expect(ok({ ...chart, series: [{ ...one, points: points(301) }] })).toBe(false);
    expect(ok({ ...chart, series: [one, { ...one, key: 'oi' }, { ...one, key: 'funding' }] })).toBe(false);
    expect(ok({ ...chart, series: [] })).toBe(false);
    expect(ok({ ...chart, series: [{ key: 'price', points: [] }] })).toBe(false);
    expect(WEB_INSIGHT_CHART_MAX_POINTS).toBe(300);
  });

  it('kinds, units and series keys are closed lists; no non-finite value', () => {
    expect(ok({ ...chart, kind: 'pie' })).toBe(false);
    expect(ok({ ...chart, unit: 'btc' })).toBe(false);
    expect(ok({ ...chart, series: [{ key: 'made_up', points: points(2) }] })).toBe(false);
    expect(ok({ ...chart, series: [{ key: 'price', points: [{ time: 1, value: Number.NaN }] }] })).toBe(false);
  });

  it('band lo ≤ hi, span and highlight from ≤ to, at most two marks', () => {
    expect(ok({ ...chart, band: { lo: 1, hi: 0 } })).toBe(false);
    expect(ok({ ...chart, span: { from: 2, to: 1 } })).toBe(false);
    expect(ok({ ...chart, highlight: { from: 5, to: 5 } })).toBe(true);
    expect(ok({ ...chart, highlight: { from: 6, to: 5 } })).toBe(false);
    expect(ok({ ...chart, marks: [1, 2] })).toBe(true);
    expect(ok({ ...chart, marks: [1, 2, 3] })).toBe(false);
  });
});

describe('IB-113 (V16): R11, the OI divergence card', () => {
  it('is a rule and a key; an event carries rarity 1 and still parses', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const s = require('./fixtures/insights.24h.json').top[0];
    const r11 = {
      ...s, ruleId: 'R11', block: 'positioning', key: 'insight.oi_divergence', rarity: 1, magnitude: 3.2,
      params: { symbol: 'BTCUSDT', tf: '1h', direction: 'bullish', pricePct: -1.8, oiPct: 3.2, runLength: 2 },
      link: { route: 'instrument', symbol: 'BTCUSDT', timeSec: 1_793_790_000 },
    };
    expect(WebInsightStatementSchema.safeParse(r11).success).toBe(true);
    expect(WebInsightStatementSchema.safeParse({ ...r11, ruleId: 'R12' }).success).toBe(false);
  });
});
