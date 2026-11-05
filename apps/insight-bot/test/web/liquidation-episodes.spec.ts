import { readFileSync } from 'fs';
import { join } from 'path';
import {
  WEB_LIQUIDATION_EPISODES_CAP, WebLiquidationEpisodesQuerySchema, WebLiquidationEpisodesResponseSchema,
  type WebLiquidationEpisodeNorm,
} from '@trade-automation/contracts';
import { EPISODE_FLOOR_USD, EPISODE_GAP_SEC, EPISODE_TARGET_PER_WEEK } from '../../src/insights/thresholds';
import { episodesAnswer } from '../../src/web/liquidations/episodes.assemble';
import { episodeSums, groupEpisodes, largestRemainder, type EpisodePrint } from '../../src/web/liquidations/episodes.group';
import { episodeNorm } from '../../src/web/liquidations/episodes.norm';
import { pathComplete, pathWindow, priceFacts } from '../../src/web/liquidations/episodes.price';
import { COIN_M_PATTERNS } from '../../src/web/liquidations/pg/episodes.repo';

/** IB-133 — liquidation «episodes», the pure parts (liquidation-episodes design E1–E8). */

const T0 = 1_793_880_000_000; // a minute boundary
const DAY = 86_400_000;
const p = (sec: number, over: Partial<EpisodePrint> = {}): EpisodePrint => ({
  timeMs: T0 + sec * 1000, side: 'short', usd: 200_000, symbol: 'BTCUSDT', base: 'BTC', venue: 'binance', ...over,
});
const q = (over: Record<string, unknown> = {}) => WebLiquidationEpisodesQuerySchema.parse(over);
const ready = (thresholdUsd: number): WebLiquidationEpisodeNorm => ({ status: 'ready', thresholdUsd, heldDays: 7, k: 8, targetPerWeek: 7.5 });

describe('E1 grouping', () => {
  it('the gap constant is the owner\'s 3 minutes', () => {
    expect(EPISODE_GAP_SEC).toBe(180);
  });

  it('a pause of exactly 180 s starts a new episode; 179 s does not', () => {
    expect(groupEpisodes([p(0), p(180)]).map((e) => e.count)).toEqual([1, 1]);
    expect(groupEpisodes([p(0), p(179)]).map((e) => e.count)).toEqual([2]);
    // measured in ms on the tape's timestamps, not on rounded seconds
    expect(groupEpisodes([p(0), p(179.999)]).map((e) => e.count)).toEqual([2]);
    // the gap is between NEIGHBOURS: a long chain of 170 s steps is one episode
    expect(groupEpisodes([0, 170, 340, 510, 680].map((s) => p(s))).map((e) => [e.count, (e.toMs - e.fromMs) / 1000])).toEqual([[5, 680]]);
  });

  it('sides never mix: interleaved long and short prints are two episodes', () => {
    const eps = groupEpisodes([p(0), p(30, { side: 'long' }), p(60), p(90, { side: 'long', usd: 500_000 })]);
    expect(eps.map((e) => [e.side, e.count, e.usd])).toEqual([['short', 2, 400_000], ['long', 2, 700_000]]);
    expect(eps.every((e) => e.prints.every((x) => x.side === e.side))).toBe(true);
  });

  it('fields: id, from/to, per coin across venues, per minute, venue shares to 100, prints largest first', () => {
    const [e] = groupEpisodes([
      p(0, { usd: 1_000_000 }),
      p(20, { venue: 'okx', usd: 1_000_000 }),
      p(70, { symbol: 'ETHUSDT', base: 'ETH', venue: 'bybit', usd: 1_000_000 }),
    ]);
    expect(e?.id).toBe(`short-${T0 / 1000}`);
    expect([e?.fromMs, e?.toMs]).toEqual([T0, T0 + 70_000]);
    expect(e?.coins).toEqual([{ base: 'BTC', symbol: 'BTCUSDT', usd: 2_000_000 }, { base: 'ETH', symbol: 'ETHUSDT', usd: 1_000_000 }]);
    expect(e?.perMinute).toEqual([{ time: T0 / 1000, usd: 2_000_000 }, { time: T0 / 1000 + 60, usd: 1_000_000 }]);
    // thirds: 33.3 each → 34 + 33 + 33, and always 100
    expect(e?.venues.map((v) => v.pct).reduce((s, v) => s + v, 0)).toBe(100);
    expect(e?.venues.map((v) => v.pct).sort()).toEqual([33, 33, 34]);
  });

  it('largest remainder always sums to 100', () => {
    expect(largestRemainder([1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainder([71.4, 18, 10.6])).toEqual([71, 18, 11]);
    // an exact tie of remainders goes to the earlier (larger) venue
    expect(largestRemainder([71.5, 18, 10.5])).toEqual([72, 18, 10]);
    expect(largestRemainder([996, 2, 2])).toEqual([100, 0, 0]);
    for (const v of [[3, 7, 11, 13], [1e6, 1, 1], [5, 5], [7]]) expect(largestRemainder(v).reduce((s, x) => s + x, 0)).toBe(100);
    expect(largestRemainder([])).toEqual([]);
  });

  it('episodeSums is the same grouping, sums only', () => {
    const prints = [p(0), p(100), p(400, { usd: 3_000_000 }), p(410, { side: 'long' })];
    expect(episodeSums(prints)).toEqual(groupEpisodes(prints).map((e) => e.usd));
  });
});

describe('E2 the norm, set by rate', () => {
  const sums = Array.from({ length: 200 }, (_, i) => (i + 1) * 1_000_000); // $1M … $200M

  it('the target is 7.5 a week and the floor $1M', () => {
    expect(EPISODE_TARGET_PER_WEEK).toBe(7.5);
    expect(EPISODE_FLOOR_USD).toBe(1_000_000);
  });

  it('a short hold (2.54 days, the box on 2026-11-05): k = 3, T = the 3rd largest', () => {
    const n = episodeNorm({ candidateSums: sums, heldMs: 2.54 * DAY });
    expect(n).toEqual({ status: 'ready', k: 3, thresholdUsd: 198_000_000, heldDays: 2.5, targetPerWeek: 7.5 });
  });

  it('a 30-day hold: k = round(7.5 × 30 / 7) = 32', () => {
    const n = episodeNorm({ candidateSums: sums, heldMs: 30 * DAY });
    expect(n.status === 'ready' && [n.k, n.thresholdUsd, n.heldDays]).toEqual([32, 169_000_000, 30]);
  });

  it('never below $1M, including when there are fewer than k candidates', () => {
    const n = episodeNorm({ candidateSums: [400_000, 300_000, 250_000, 200_000], heldMs: 3 * DAY });
    expect(n.status === 'ready' && n.thresholdUsd).toBe(1_000_000);
    const few = episodeNorm({ candidateSums: [50_000_000], heldMs: 14 * DAY });
    expect(few.status === 'ready' && [few.k, few.thresholdUsd]).toEqual([15, 1_000_000]);
  });

  it('under a day of tape there is no norm, only whole hours collected', () => {
    expect(episodeNorm({ candidateSums: sums, heldMs: 23.9 * 3_600_000 })).toEqual({ status: 'collecting', collectingHours: 23 });
    expect(episodeNorm({ candidateSums: [], heldMs: 0 })).toEqual({ status: 'collecting', collectingHours: 0 });
    expect(episodeNorm({ candidateSums: sums, heldMs: DAY }).status).toBe('ready');
  });

  it('the target is the one knob', () => {
    const n = episodeNorm({ candidateSums: sums, heldMs: 7 * DAY, targetPerWeek: 5 });
    expect(n.status === 'ready' && [n.k, n.thresholdUsd]).toEqual([5, 196_000_000]);
  });
});

describe('E3–E5 the answer', () => {
  // 12 short episodes $2M … $13M, 10 minutes apart; one long $50M episode with ETH on bybit
  const prints: EpisodePrint[] = [];
  for (let i = 0; i < 12; i += 1) {
    prints.push(p(i * 600, { usd: (i + 2) * 500_000 }), p(i * 600 + 10, { usd: (i + 2) * 500_000, venue: 'okx' }));
  }
  prints.push(
    p(30, { side: 'long', usd: 40_000_000 }),
    p(40, { side: 'long', usd: 9_000_000, symbol: 'ETHUSDT', base: 'ETH', venue: 'bybit' }),
    p(50, { side: 'long', usd: 500_000 }),
  );
  const candidates = groupEpisodes(prints);
  const answer = (query = q({ period: '7d' }), norm: WebLiquidationEpisodeNorm = ready(2_000_000)) =>
    episodesAnswer({ asOf: T0 / 1000 + 86_400, candidates, norm, query });

  it('only candidates ≥ T, the largest first, capped at 10 (7d) / 5 (24h), the rest folded, counted before the cap', () => {
    const a = answer();
    expect(a.response.summary).toEqual({ count: 13, shorts: 12, longs: 1, largestId: `long-${T0 / 1000 + 30}` });
    expect(a.response.episodes).toHaveLength(WEB_LIQUIDATION_EPISODES_CAP['7d']);
    expect(a.response.folded).toBe(3);
    expect(a.response.episodes.map((e) => e.usd)).toEqual([...a.response.episodes.map((e) => e.usd)].sort((x, y) => y - x));
    const day = answer(q({ period: '24h' }));
    expect([day.response.episodes.length, day.response.folded, day.response.summary.count]).toEqual([5, 8, 13]);
    const high = answer(q({ period: '7d' }), ready(10_000_000));
    expect(high.response.summary.count).toBe(5); // $10M … $13M shorts and the $49.5M long
    expect(high.response.episodes.every((e) => e.usd >= 10_000_000)).toBe(true);
    expect(WebLiquidationEpisodesResponseSchema.safeParse(a.response).success).toBe(true);
  });

  it('a coin or venue filter keeps the whole episode: the ETH long keeps its BTC money and its count', () => {
    const eth = answer(q({ period: '7d', symbol: 'ETHUSDT' })).response;
    expect(eth.episodes.map((e) => [e.count, e.usd, e.coins.map((c) => c.symbol)])).toEqual([[3, 49_500_000, ['BTCUSDT', 'ETHUSDT']]]);
    const bybit = answer(q({ period: '7d', venue: 'bybit' })).response;
    expect(bybit.episodes.map((e) => e.id)).toEqual(eth.episodes.map((e) => e.id));
    expect(bybit.episodes[0]?.venues.map((v) => v.venue)).toEqual(['binance', 'bybit']);
    const longs = answer(q({ period: '7d', side: 'long' })).response;
    expect([longs.summary.count, longs.summary.shorts]).toEqual([1, 0]);
  });

  it('minUsd never changes the episodes, only the prints inside them', () => {
    const low = answer(q({ period: '7d' })).response;
    const big = answer(q({ period: '7d', minUsd: '1000000' })).response;
    expect(big.episodes.map((e) => [e.id, e.usd, e.count])).toEqual(low.episodes.map((e) => [e.id, e.usd, e.count]));
    expect(big.summary).toEqual(low.summary);
    expect(low.episodes[0]?.prints.map((x) => x.usd)).toEqual([40_000_000, 9_000_000, 500_000]);
    expect(big.episodes[0]?.prints.map((x) => x.usd)).toEqual([40_000_000, 9_000_000]);
    // a $1M filter can leave an episode with no prints to list — the card says so, the episode stays
    const small = groupEpisodes([0, 30, 60, 90, 120].map((sec) => p(sec, { usd: 300_000 })));
    const none = episodesAnswer({ asOf: T0 / 1000, candidates: small, norm: ready(1_000_000), query: q({ minUsd: '1000000' }) }).response;
    expect(none.episodes.map((e) => [e.usd, e.count, e.prints.length])).toEqual([[1_500_000, 5, 0]]);
  });

  it('at most 20 prints, the largest', () => {
    const many = groupEpisodes(Array.from({ length: 30 }, (_, i) => p(i, { usd: 1_000_000 + i })));
    const a = episodesAnswer({ asOf: T0 / 1000, candidates: many, norm: ready(1_000_000), query: q() }).response;
    expect(a.episodes[0]?.prints).toHaveLength(20);
    expect(a.episodes[0]?.prints[0]?.usd).toBe(1_000_029);
  });

  it('while the norm is collecting there are no episodes at all', () => {
    const a = answer(q({ period: '7d' }), { status: 'collecting', collectingHours: 5 }).response;
    expect([a.summary.count, a.episodes.length, a.folded]).toEqual([0, 0, 0]);
    expect(WebLiquidationEpisodesResponseSchema.safeParse(a).success).toBe(true);
  });
});

describe('E8 the price path', () => {
  const from = T0 + 25_000; // 25 s into a minute
  const to = T0 + 7 * 60_000 + 59_000; // the 8th minute
  const w = pathWindow(from, to);
  const bar = (ms: number, close: number) => ({ time: ms / 1000, open: close - 1, close });

  it('from − 60 min to to + 240 min, one request at weight 2 (100 ≤ limit < 500)', () => {
    expect(w.fromMs).toBe(T0 - 3_600_000);
    expect(w.after4hMinuteMs).toBe(T0 + 7 * 60_000 + 240 * 60_000);
    expect(w.limit).toBe(60 + 7 + 240 + 1);
    expect(w.limit >= 100 && w.limit < 500).toBe(true);
  });

  it('during: open of from\'s minute → close of to\'s minute; +4 h is null until that minute has closed', () => {
    const bars: Array<{ time: number; open: number; close: number }> = [];
    for (let t = w.fromMs; t <= T0 + 60 * 60_000; t += 60_000) bars.push(bar(t, 100 + (t - w.fromMs) / 60_000));
    const pending = priceFacts('BTCUSDT', bars, w);
    expect(pending?.startOpen).toBe(160 - 1);
    expect(pending?.endClose).toBe(167);
    expect(pending?.after4hClose).toBeNull();
    expect(pathComplete(w, T0 + 60 * 60_000)).toBe(false);
    // the minute at to + 4 h closes one minute after it opens
    expect(pathComplete(w, w.after4hMinuteMs + 59_999)).toBe(false);
    expect(pathComplete(w, w.after4hMinuteMs + 60_000)).toBe(true);
    const full = [...bars];
    for (let t = T0 + 61 * 60_000; t <= w.after4hMinuteMs; t += 60_000) full.push(bar(t, 500));
    expect(priceFacts('BTCUSDT', full, w)?.after4hClose).toBe(500);
    expect(priceFacts('BTCUSDT', full, w)?.points).toHaveLength(w.limit);
  });

  it('no bar for the episode\'s own minutes → null (a coin that did not trade, or to\'s minute still open)', () => {
    expect(priceFacts('BTCUSDT', [bar(w.startMinuteMs, 1)], w)).toBeNull();
    expect(priceFacts('BTCUSDT', [], w)).toBeNull();
  });
});

describe('COIN-M stays out (IB-BUG-039)', () => {
  it('the read excludes migration 022\'s two patterns, verbatim', () => {
    const sql = readFileSync(join(__dirname, '../../migrations/022.do.liquidations-mispriced-repair.sql'), 'utf8');
    for (const pattern of COIN_M_PATTERNS) expect(sql).toContain(`symbol ~ '${pattern}'`);
    const re = COIN_M_PATTERNS.map((s) => new RegExp(s));
    expect(['BTCUSD_PERP', 'BTCUSD_270326', 'ETHBTC'].every((s) => re.some((r) => r.test(s)))).toBe(true);
    expect(['BTCUSDT', 'BTCUSDT_261225', 'BTCUSDC'].some((s) => re.some((r) => r.test(s)))).toBe(false);
  });
});
