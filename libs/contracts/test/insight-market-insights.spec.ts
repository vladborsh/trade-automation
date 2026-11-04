import { WEB_INSIGHT_BLOCKS, WEB_INSIGHT_KEYS, WEB_INSIGHT_SOURCES, WebInsightBlockLineSchema, WebInsightStatementSchema, WebInsightsResponseSchema } from '../src/insight';

/** IB-086 — «Главное сейчас» (design D1–D5, D15). Fixtures are what IB-088 builds against. */
describe('IB-086 contracts', () => {
  it('blocks and sentence keys are closed lists', () => {
    expect([...WEB_INSIGHT_BLOCKS]).toEqual(['liquidations', 'positioning', 'caps', 'flows', 'sentiment']);
    expect(WEB_INSIGHT_KEYS).toContain('insight.neutral');
    expect(WEB_INSIGHT_KEYS).toHaveLength(11); // IB-091: R8–R10
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

