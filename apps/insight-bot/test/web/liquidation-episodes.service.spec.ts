import { HttpException } from '@nestjs/common';
import { WebLiquidationEpisodesQuerySchema, WebLiquidationEpisodesResponseSchema } from '@trade-automation/contracts';
import type { Db } from '../../src/db/db.port';
import {
  EPISODES_CACHE_KEYS, EPISODE_NORM_CACHE_MS, LiquidationEpisodesService, PATH_CACHE_KEYS, PATH_RETRY_MS, type EpisodePriceReader,
} from '../../src/web/liquidations/episodes.service';
import { LiquidationEpisodesController } from '../../src/web/liquidations/liquidation-episodes.controller';
import type { LiquidationsOverviewService } from '../../src/web/liquidations/overview.service';

/** IB-133 — the episodes service and controller over a fake tape and a fake Binance (E7, E8). */

const MIN = 60_000;
const START = Date.UTC(2026, 10, 3, 0, 0); // the tape's first row
const q = (over: Record<string, unknown> = {}) => WebLiquidationEpisodesQuerySchema.parse(over);

interface Row { ts: Date; symbol_id: string | null; venue_symbol: string; base: string | null; side: 'long' | 'short'; notional: string; venue: string }
const row = (ms: number, usd: number, side: 'long' | 'short' = 'short', symbol = 'BTCUSDT', venue = 'binance'): Row =>
  ({ ts: new Date(ms), symbol_id: symbol, venue_symbol: symbol, base: symbol.replace('USDT', ''), side, notional: String(usd), venue });

function setup(opts: { rows: Row[]; now: number; failKlines?: boolean }) {
  const clock = { now: opts.now };
  const sql: string[] = [];
  const db: Db = {
    query: async (text: string, params?: unknown[]) => {
      sql.push(text);
      if (text.includes('as first_seen')) {
        return [{ symbol_id: 'BTCUSDT', venue: 'binance', first_seen: new Date(START) }] as never;
      }
      const [from, to, min] = params as [Date, Date, number];
      return opts.rows
        .filter((r) => r.ts >= from && r.ts < to && Number(r.notional) >= min)
        .sort((a, b) => b.ts.getTime() - a.ts.getTime()) as never;
    },
  } as unknown as Db;
  const overview = { cryptoScope: async () => ({ keys: ['binance:BTCUSDT', 'binance:ETHUSDT'], aliases: [] }) } as unknown as LiquidationsOverviewService;
  const calls: Array<{ symbol: string; fromMs: number; limit: number }> = [];
  const prices: EpisodePriceReader = {
    binancePerp: (id) => (id === 'BTCUSDT' || id === 'ETHUSDT' ? id : null),
    closedKlines1m: async (symbol, fromMs, limit) => {
      calls.push({ symbol, fromMs, limit });
      if (opts.failKlines) throw new Error('HTTP 503');
      const out: Array<{ time: number; open: number; close: number }> = [];
      for (let i = 0; i < limit; i += 1) {
        const t = fromMs + i * MIN;
        if (t + MIN > clock.now) break; // closed bars only, as closedKlines does
        out.push({ time: t / 1000, open: 100 + i, close: 100.5 + i });
      }
      return out;
    },
  };
  const service = new LiquidationEpisodesService(db, overview, prices, () => clock.now);
  return { service, clock, calls, sql };
}

// 2.5 days of tape: three big short episodes, two smaller ones, and a long one; plus noise
const big = (startMs: number, n: number, usd: number, side: 'long' | 'short' = 'short', symbol = 'BTCUSDT') =>
  Array.from({ length: n }, (_, i) => row(startMs + i * 30_000, usd, side, symbol));
const NOW = START + 2.5 * 86_400_000;
const rows = [
  ...big(START + 30 * 3_600_000, 40, 2_500_000), // $100M, 11-04 06:00
  ...big(START + 40 * 3_600_000, 20, 2_000_000, 'long', 'ETHUSDT'), // $40M
  ...big(START + 50 * 3_600_000, 10, 2_500_000), // $25M
  ...big(START + 55 * 3_600_000, 10, 1_000_000), // $10M, below T
  ...big(NOW - 30 * MIN, 15, 2_000_000), // $30M, 30 min ago: +4 h still ahead
  row(START + 10 * 3_600_000, 90_000), // below $100K: not a print
];

describe('LiquidationEpisodesService', () => {
  it('2.5 days held → k = 3; T is the 3rd largest sum ($30M); 7d shows them by sum, 24h only its own', async () => {
    const { service } = setup({ rows, now: NOW });
    const a = await service.episodes(q({ period: '7d' }));
    expect(WebLiquidationEpisodesResponseSchema.parse(a)).toBeTruthy();
    expect(a.norm).toEqual({ status: 'ready', thresholdUsd: 30_000_000, heldDays: 2.5, k: 3, targetPerWeek: 7.5 });
    expect(a.episodes.map((e) => e.usd)).toEqual([100_000_000, 40_000_000, 30_000_000]);
    expect(a.summary).toEqual({ count: 3, shorts: 2, longs: 1, largestId: a.episodes[0]?.id });
    const day = await service.episodes(q({ period: '24h' }));
    expect(day.episodes.map((e) => e.usd)).toEqual([40_000_000, 30_000_000]);
  });

  it('price: the largest coin\'s 1m path, one read per episode, +4 h known only once passed', async () => {
    const { service, calls } = setup({ rows, now: NOW });
    const a = await service.episodes(q({ period: '7d' }));
    expect(calls.map((c) => c.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'BTCUSDT']);
    expect(calls.every((c) => c.limit >= 100 && c.limit < 500)).toBe(true); // weight 2 each: 6 cold
    expect(a.episodes[1]?.price?.symbol).toBe('ETHUSDT');
    expect(a.episodes.map((e) => e.price?.after4hClose === null)).toEqual([false, false, true]);
    // the pending path ends at the last closed minute and its facts are the episode's own minutes
    const recent = a.episodes[2]?.price;
    expect(recent?.points[recent.points.length - 1]?.time).toBe(NOW / 1000 - 60);
    expect([recent?.startOpen, recent?.endClose]).toEqual([100 + 60, 100.5 + 60 + 7]);
  });

  it('weight: answers and paths are cached — 10 s polls for an hour cost the cold reads only', async () => {
    const { service, clock, calls } = setup({ rows, now: NOW });
    for (let t = 0; t < 60 * MIN; t += 10_000) {
      clock.now = NOW + t;
      await service.episodes(q({ period: '7d' }));
      await service.episodes(q({ period: '24h' }));
    }
    // 3 complete paths once; the pending one (30 min old) at most once an hour
    expect(calls.length).toBeLessThanOrEqual(4);
    clock.now = NOW + 4 * 3_600_000;
    await service.episodes(q({ period: '7d' }));
    // past +4 h: the pending path is read once more, then held for a day
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it('the norm is read once an hour, the base once per 10 s per period', async () => {
    const { service, clock, sql } = setup({ rows, now: NOW });
    await service.episodes(q({ period: '7d' }));
    const firstSeen = () => sql.filter((s) => s.includes('as first_seen')).length;
    expect(firstSeen()).toBe(1);
    clock.now = NOW + EPISODE_NORM_CACHE_MS - 1;
    await service.episodes(q({ period: '7d' }));
    expect(firstSeen()).toBe(1);
    clock.now = NOW + EPISODE_NORM_CACHE_MS + 10_000; // past the 10 s answer too
    await service.episodes(q({ period: '7d' }));
    expect(firstSeen()).toBe(2);
  });

  it('a failed price read is soft: price null, the card stays, retried after a minute', async () => {
    const { service, clock, calls } = setup({ rows, now: NOW, failKlines: true });
    const a = await service.episodes(q({ period: '7d' }));
    expect(a.episodes.map((e) => e.price)).toEqual([null, null, null]);
    const n = calls.length;
    clock.now = NOW + 10_000;
    await service.episodes(q({ period: '7d' }));
    expect(calls.length).toBe(n);
    clock.now = NOW + PATH_RETRY_MS + 10_000;
    await service.episodes(q({ period: '7d' }));
    expect(calls.length).toBe(2 * n);
  });

  it('a coin with no Binance perp in the universe has no price and no venue call', async () => {
    const { service, calls } = setup({ rows: [...rows, ...big(START + 20 * 3_600_000, 50, 4_000_000, 'long', 'HYPEUSDT')], now: NOW });
    const a = await service.episodes(q({ period: '7d', symbol: 'HYPEUSDT' }));
    expect(a.episodes.map((e) => [e.usd, e.price])).toEqual([[200_000_000, null]]);
    expect(calls.map((c) => c.symbol)).not.toContain('HYPEUSDT');
  });

  it('under a day of tape: collecting, no episodes', async () => {
    const { service } = setup({ rows, now: START + 20 * 3_600_000 });
    const a = await service.episodes(q({ period: '24h' }));
    expect(a.norm).toEqual({ status: 'collecting', collectingHours: 20 });
    expect(a.episodes).toEqual([]);
  });

  it('bounded: 32 filter keys, 64 paths', () => {
    expect([EPISODES_CACHE_KEYS, PATH_CACHE_KEYS]).toEqual([32, 64]);
  });
});

describe('LiquidationEpisodesController', () => {
  it('an unknown value is a 400 naming the field; no database is a 503', async () => {
    const { service } = setup({ rows, now: NOW });
    const c = new LiquidationEpisodesController(service);
    await expect(c.episodes({ period: '1h' })).rejects.toMatchObject({ status: 400 });
    await expect(c.episodes({ minUsd: '5' })).rejects.toBeInstanceOf(HttpException);
    const none = new LiquidationEpisodesController(new LiquidationEpisodesService(null, {} as never, {} as never, () => NOW));
    await expect(none.episodes({})).rejects.toMatchObject({ status: 503 });
  });
});
