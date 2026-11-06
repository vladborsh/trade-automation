import {
  WEB_KPI_IDS, WEB_POSITIONING_QUADRANTS, WEB_POSITIONING_SIGNALS, WEB_POSITIONING_UNAVAILABLE,
  WebKpisResponseSchema, WebPositioningCellSchema, WebPositioningResponseSchema,
} from '../src/insight';

/** IB-085 — positioning (D9) and KPIs (D10). The example fixtures are what IB-088/090 build against. */
describe('IB-085 contracts', () => {
  it('the vocabularies are closed', () => {
    expect([...WEB_POSITIONING_QUADRANTS]).toEqual(['new_longs', 'new_shorts', 'long_closing', 'short_closing', 'flat']);
    expect([...WEB_POSITIONING_SIGNALS]).toEqual(['squeeze', 'capitulation', 'crowded_long', 'crowded_short', 'quiet']);
    expect([...WEB_KPI_IDS]).toEqual(['market_cap', 'btc_dominance', 'liquidations_24h', 'btc_oi', 'btc_funding']);
  });

  it('a cell refuses rarity outside 0..1 and parses a stated absence', () => {
    expect(WebPositioningCellSchema.safeParse({ value: 1, rarity: 1.2, unavailable: null, sample: 3 }).success).toBe(false);
    expect(WebPositioningCellSchema.parse({ value: null, rarity: null, unavailable: 'insufficient_history', sample: 0 }).unavailable).toBe('insufficient_history');
  });

  it('IB-BUG-037: "never rated at this period" is its own reason, not "under 20 days"', () => {
    expect([...WEB_POSITIONING_UNAVAILABLE]).toEqual(['insufficient_history', 'not_rated_at_period', 'venue_unavailable', 'not_listed']);
    expect(WebPositioningCellSchema.parse({ value: 4.2, rarity: null, unavailable: 'not_rated_at_period', sample: 0 }).unavailable).toBe('not_rated_at_period');
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

  it('IB-BUG-040: priceRefTime is when the price change starts — whole seconds, null when no reference, never omitted', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fixture = require('./fixtures/positioning.24h.json');
    const parsed = WebPositioningResponseSchema.parse(fixture);
    // the fixture's 24h reference: the 5 m close nearest asOf − 24 h
    expect(parsed.rows.map((r) => r.priceRefTime)).toEqual(parsed.rows.map(() => Math.round((parsed.asOf - 86_400) / 300) * 300));
    const row = (priceRefTime: unknown) => ({ ...fixture, rows: [{ ...fixture.rows[0], priceRefTime }] });
    expect(WebPositioningResponseSchema.safeParse(row(null)).success).toBe(true);
    expect(WebPositioningResponseSchema.safeParse(row(1.5)).success).toBe(false);
    const { priceRefTime: _dropped, ...without } = fixture.rows[0];
    expect(WebPositioningResponseSchema.safeParse({ ...fixture, rows: [without] }).success).toBe(false);
  });

  it('the example KPI fixture parses, with all five tiles in order', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parsed = WebKpisResponseSchema.parse(require('./fixtures/kpis.json'));
    expect(parsed.tiles.map((t) => t.id)).toEqual([...WEB_KPI_IDS]);
    expect(parsed.tiles.find((t) => t.id === 'market_cap')?.source.name).toBe('CoinGecko');
  });

  it('IB-106: the KPI note is a closed key with numeric params; required, null allowed', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kpis = require('./fixtures/kpis.json');
    const parsed = WebKpisResponseSchema.parse(kpis);
    expect(parsed.tiles.map((t) => t.note?.key ?? null)).toEqual([null, 'kpi.note.eth_share', null, null, 'kpi.note.ls_accounts']);
    const withNote = (note: unknown) => ({ ...kpis, tiles: [{ ...kpis.tiles[0], note }, ...kpis.tiles.slice(1)] });
    expect(WebKpisResponseSchema.safeParse(withNote({ key: 'kpi.note.eth_share', params: { ethPct: 10.6 } })).success).toBe(true);
    expect(WebKpisResponseSchema.safeParse(withNote({ key: 'kpi.note.fng_history', params: { yesterday: 37, weekAgo: null } })).success).toBe(false); // IB-117: left with the tile
    expect(WebKpisResponseSchema.safeParse(withNote({ key: 'kpi.note.source', params: {} })).success).toBe(false); // closed set
    expect(WebKpisResponseSchema.safeParse(withNote({ key: 'kpi.note.eth_share', params: { ethPct: '10.6' } })).success).toBe(false); // numbers only
    const { note: _dropped, ...without } = kpis.tiles[0];
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: [without, ...kpis.tiles.slice(1)] }).success).toBe(false); // absence is stated
  });

  it('IB-118: the tile history is required, null allowed, a closed kind, at least one point, from ≤ to and min ≤ max', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kpis = require('./fixtures/kpis.json');
    const parsed = WebKpisResponseSchema.parse(kpis);
    expect(parsed.tiles.map((t) => t.history?.kind ?? null)).toEqual(['area', 'lines', null, 'area', 'bars']);
    const cap = kpis.tiles[0];
    const withHistory = (history: unknown) => ({ ...kpis, tiles: [{ ...cap, history }, ...kpis.tiles.slice(1)] });
    expect(WebKpisResponseSchema.safeParse(withHistory(null)).success).toBe(true);
    expect(WebKpisResponseSchema.safeParse(withHistory({ ...cap.history, kind: 'line' })).success).toBe(false);
    expect(WebKpisResponseSchema.safeParse(withHistory({ ...cap.history, points: [] })).success).toBe(false); // empty is null, not []
    expect(WebKpisResponseSchema.safeParse(withHistory({ ...cap.history, from: cap.history.to + 1 })).success).toBe(false);
    expect(WebKpisResponseSchema.safeParse(withHistory({ ...cap.history, min: cap.history.max + 1 })).success).toBe(false);
    const { history: _dropped, ...without } = cap;
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: [without, ...kpis.tiles.slice(1)] }).success).toBe(false); // absence is stated
    const collecting = { ...cap, history: null, note: { key: 'kpi.note.collecting', params: { hours: 3 } } };
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: [collecting, ...kpis.tiles.slice(1)] }).success).toBe(true);
  });

  it('IB-131: `lines` carries ETH in a required `second`; area/bars carry null; from/to cover both lines', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kpis = require('./fixtures/kpis.json');
    const [cap, dom] = kpis.tiles;
    const withTile = (i: number, tile: unknown) => ({ ...kpis, tiles: kpis.tiles.map((t: unknown, k: number) => (k === i ? tile : t)) });
    const parsed = WebKpisResponseSchema.parse(kpis).tiles[1].history;
    expect(parsed?.second?.label).toBe('ETH');
    expect(parsed?.second?.points.length).toBe((parsed?.points.length ?? 0) - 1); // the fixture's ETH hole
    const { second: _s, ...linesWithout } = dom.history;
    expect(WebKpisResponseSchema.safeParse(withTile(1, { ...dom, history: linesWithout })).success).toBe(false); // absence is not null
    expect(WebKpisResponseSchema.safeParse(withTile(1, { ...dom, history: { ...dom.history, second: null } })).success).toBe(false); // lines without ETH
    expect(WebKpisResponseSchema.safeParse(withTile(0, { ...cap, history: { ...cap.history, second: dom.history.second } })).success).toBe(false); // area with second
    const { second: _c, ...areaWithout } = cap.history;
    expect(WebKpisResponseSchema.safeParse(withTile(0, { ...cap, history: areaWithout })).success).toBe(false); // required on area too
    expect(WebKpisResponseSchema.safeParse(withTile(1, { ...dom, history: { ...dom.history, second: { ...dom.history.second, label: 'SOL' } } })).success).toBe(false);
    expect(WebKpisResponseSchema.safeParse(withTile(1, { ...dom, history: { ...dom.history, second: { ...dom.history.second, points: [] } } })).success).toBe(false);
    expect(WebKpisResponseSchema.safeParse(withTile(1, { ...dom, history: { ...dom.history, second: { ...dom.history.second, min: dom.history.second.max + 1 } } })).success).toBe(false);
    const late = { ...dom.history.second, points: [...dom.history.second.points, { time: dom.history.to + 600, value: 11 }] };
    expect(WebKpisResponseSchema.safeParse(withTile(1, { ...dom, history: { ...dom.history, second: late } })).success).toBe(false); // an ETH point outside from/to
  });

  it('four tiles do not parse — an unavailable tile says so, it does not vanish', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kpis = require('./fixtures/kpis.json');
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: kpis.tiles.slice(1) }).success).toBe(false);
  });

  it('IB-117: the Fear & Greed tile is gone — a sixth tile, a fear_greed id and its context key all refuse', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const kpis = require('./fixtures/kpis.json');
    expect(kpis.tiles).toHaveLength(5);
    expect(WebKpisResponseSchema.safeParse(kpis).success).toBe(true); // the positive control: the five parse
    const fearGreed = { ...kpis.tiles[0], id: 'fear_greed', value: 26, delta: -11, note: null,
      source: { name: 'alternative.me', url: 'https://alternative.me/crypto/fear-and-greed-index/' } };
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: [...kpis.tiles, kpis.tiles[4]] }).success).toBe(false); // a sixth tile
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: [...kpis.tiles, fearGreed] }).success).toBe(false); // the old tile appended
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: [fearGreed, ...kpis.tiles.slice(1)] }).success).toBe(false); // in a slot
    const withContext = { ...kpis.tiles[0], context: { key: 'kpi.ctx.fng_band', params: { band: 'fear' } } };
    expect(WebKpisResponseSchema.safeParse({ ...kpis, tiles: [withContext, ...kpis.tiles.slice(1)] }).success).toBe(false);
  });
});
