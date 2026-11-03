import {
  WEB_KPI_IDS, WEB_POSITIONING_QUADRANTS, WEB_POSITIONING_SIGNALS,
  WebKpisResponseSchema, WebPositioningCellSchema, WebPositioningResponseSchema,
} from '../src/insight';

/** IB-085 — positioning (D9) and KPIs (D10). The example fixtures are what IB-088/090 build against. */
describe('IB-085 contracts', () => {
  it('the vocabularies are closed', () => {
    expect([...WEB_POSITIONING_QUADRANTS]).toEqual(['new_longs', 'new_shorts', 'long_closing', 'short_closing', 'flat']);
    expect([...WEB_POSITIONING_SIGNALS]).toEqual(['squeeze', 'capitulation', 'crowded_long', 'crowded_short', 'quiet']);
    expect([...WEB_KPI_IDS]).toEqual(['market_cap', 'btc_dominance', 'fear_greed', 'liquidations_24h', 'btc_oi', 'btc_funding']);
  });

  it('a cell refuses rarity outside 0..1 and parses a stated absence', () => {
    expect(WebPositioningCellSchema.safeParse({ value: 1, rarity: 1.2, unavailable: null, sample: 3 }).success).toBe(false);
    expect(WebPositioningCellSchema.parse({ value: null, rarity: null, unavailable: 'insufficient_history', sample: 0 }).unavailable).toBe('insufficient_history');
  });

  it('the example positioning fixture parses', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parsed = WebPositioningResponseSchema.parse(require('./fixtures/positioning.24h.json'));
    expect(parsed.rows.map((r) => r.quadrant)).toEqual(['new_shorts', 'long_closing', 'new_longs', 'flat']);
  });

  it('IB-090: oiUsd is the dot size — a level in USD, null when the venue did not answer, never negative', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fixture = require('./fixtures/positioning.24h.json');
    const parsed = WebPositioningResponseSchema.parse(fixture);
    expect(parsed.rows.map((r) => r.oiUsd)).toEqual([8.1e9, 5.2e9, 9.4e8, 3.1e8]);
    const row = (oiUsd: unknown) => ({ ...fixture, rows: [{ ...fixture.rows[0], oiUsd }] });
    expect(WebPositioningResponseSchema.safeParse(row(null)).success).toBe(true);
    expect(WebPositioningResponseSchema.safeParse(row(-1)).success).toBe(false);
    const { oiUsd: _dropped, ...without } = fixture.rows[0];
    expect(WebPositioningResponseSchema.safeParse({ ...fixture, rows: [without] }).success).toBe(false); // absence is stated, not omitted
  });

  it('the example KPI fixture parses, with all six tiles in order', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parsed = WebKpisResponseSchema.parse(require('./fixtures/kpis.json'));
    expect(parsed.tiles.map((t) => t.id)).toEqual([...WEB_KPI_IDS]);
    expect(parsed.tiles.find((t) => t.id === 'fear_greed')?.source.name).toBe('alternative.me');
  });

  it('five tiles do not parse — an unavailable tile says so, it does not vanish', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kpis = require('./fixtures/kpis.json');
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: kpis.tiles.slice(1) }).success).toBe(false);
  });
});
