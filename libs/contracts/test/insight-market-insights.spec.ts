import { WEB_INSIGHT_BLOCKS, WEB_INSIGHT_KEYS, WEB_INSIGHT_SOURCES, WebInsightBlockLineSchema, WebInsightSparkSchema, WebInsightStatementSchema, WebInsightsResponseSchema } from '../src/insight';

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


describe('IB-107 (D24): a statement carries the series behind it, or says it had none', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const s = require('./fixtures/insights.24h.json').top[0];
  const spark = (values: number[], highlight: number | null) => WebInsightSparkSchema.safeParse({ values, highlight }).success;

  it('spark is required on the wire and may be null', () => {
    expect(WebInsightStatementSchema.safeParse({ ...s, spark: null }).success).toBe(true);
    const { spark: _omitted, ...without } = s;
    expect(WebInsightStatementSchema.safeParse(without).success).toBe(false);
  });

  it('2 to 30 values; highlight is an index inside them, or null', () => {
    expect(spark([1, 2], null)).toBe(true);
    expect(spark(Array.from({ length: 30 }, (_, i) => i), 29)).toBe(true);
    expect(spark([1], null)).toBe(false);
    expect(spark(Array.from({ length: 31 }, (_, i) => i), null)).toBe(false);
    expect(spark([1, 2, 3], 3)).toBe(false);
    expect(spark([1, 2, 3], -1)).toBe(false);
    expect(spark([1, 2, 3], 1.5)).toBe(false);
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
