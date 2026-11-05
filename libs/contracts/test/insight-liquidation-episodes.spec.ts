import {
  WEB_LIQUIDATION_EPISODES_CAP, WEB_LIQUIDATION_EPISODE_PRINTS,
  WebLiquidationEpisodeSchema, WebLiquidationEpisodesQuerySchema, WebLiquidationEpisodesResponseSchema,
} from '../src/insight';

/** IB-133 — `/api/web/liquidations/episodes` (liquidation-episodes design E3, E7). */
describe('IB-133 episodes query', () => {
  it('parses exactly as /large does: the same chips, the same 400s', () => {
    expect(WebLiquidationEpisodesQuerySchema.parse({})).toEqual({ period: '24h', symbol: 'all', minUsd: 100_000, side: 'all', venue: 'all' });
    expect(WebLiquidationEpisodesQuerySchema.safeParse({ period: '1h' }).success).toBe(false);
    expect(WebLiquidationEpisodesQuerySchema.safeParse({ side: 'both' }).success).toBe(false);
  });
});

describe('IB-133 episodes response', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const example = require('./fixtures/liquidation-episodes.7d.json');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const collecting = require('./fixtures/liquidation-episodes.collecting.json');
  const clone = () => JSON.parse(JSON.stringify(example));

  it('the fixtures clients build against parse, so they cannot drift from the contract', () => {
    const parsed = WebLiquidationEpisodesResponseSchema.parse(example);
    // the fixture covers: a complete path, a pending +4 h, no price, a single print, an empty print list
    expect(parsed.episodes.map((e) => e.price?.after4hClose === null)).toEqual([false, true, false]);
    expect(parsed.episodes[2]?.price).toBeNull();
    expect(parsed.episodes[2]?.count).toBe(1);
    expect(parsed.episodes[1]?.prints).toEqual([]);
    expect(WebLiquidationEpisodesResponseSchema.parse(collecting).norm).toEqual({ status: 'collecting', collectingHours: 17 });
  });

  it('the cap is 10 for 7d and 5 for 24h', () => {
    expect(WEB_LIQUIDATION_EPISODES_CAP).toEqual({ '24h': 5, '7d': 10 });
    const r = clone();
    r.query.period = '24h';
    r.episodes = Array.from({ length: 6 }, () => r.episodes[0]);
    r.summary = { count: 6, shorts: 6, longs: 0, largestId: r.episodes[0].id };
    r.folded = 0;
    expect(WebLiquidationEpisodesResponseSchema.safeParse(r).success).toBe(false);
  });

  it('count = shown + folded, and shorts + longs = count', () => {
    const r = clone();
    r.folded = 2;
    expect(WebLiquidationEpisodesResponseSchema.safeParse(r).success).toBe(false);
    const s = clone();
    s.summary.shorts = 2;
    expect(WebLiquidationEpisodesResponseSchema.safeParse(s).success).toBe(false);
  });

  it('episodes are ordered by sum and all clear the threshold', () => {
    const r = clone();
    r.episodes = [r.episodes[1], r.episodes[0], r.episodes[2]];
    r.summary.largestId = r.episodes[0].id;
    expect(WebLiquidationEpisodesResponseSchema.safeParse(r).success).toBe(false);
    const t = clone();
    t.norm.thresholdUsd = 30_000_000;
    expect(WebLiquidationEpisodesResponseSchema.safeParse(t).success).toBe(false);
  });

  it('no episodes while the norm is collecting', () => {
    const r = clone();
    r.norm = { status: 'collecting', collectingHours: 3 };
    expect(WebLiquidationEpisodesResponseSchema.safeParse(r).success).toBe(false);
  });

  it('venue shares sum to exactly 100, the id is side-from, prints are at most 20', () => {
    const e = clone().episodes[0];
    expect(WebLiquidationEpisodeSchema.safeParse({ ...e, venues: [{ venue: 'binance', pct: 70 }, { venue: 'bybit', pct: 29 }] }).success).toBe(false);
    expect(WebLiquidationEpisodeSchema.safeParse({ ...e, id: `long-${e.from}` }).success).toBe(false);
    const prints = Array.from({ length: WEB_LIQUIDATION_EPISODE_PRINTS + 1 }, () => e.prints[0]);
    expect(WebLiquidationEpisodeSchema.safeParse({ ...e, prints }).success).toBe(false);
  });

  it('a price names one symbol and +4 h may be null until it has passed', () => {
    const e = clone().episodes[1];
    expect(e.price.after4hClose).toBeNull();
    expect(WebLiquidationEpisodeSchema.safeParse(e).success).toBe(true);
  });
});
