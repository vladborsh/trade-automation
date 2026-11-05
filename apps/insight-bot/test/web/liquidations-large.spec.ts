import { HttpException } from '@nestjs/common';
import { WEB_LIQUIDATIONS_LARGE_LIMIT, WebLiquidationsLargeQuerySchema, WebLiquidationsLargeResponseSchema } from '@trade-automation/contracts';
import type { Db } from '../../src/db/db.port';
import { largeEvents } from '../../src/web/liquidations/block.assemble';
import { LARGE_PAGE_BASE_CAP, largeAnswer, largeBase } from '../../src/web/liquidations/large.assemble';
import { LARGE_CACHE_KEYS, LARGE_CACHE_MS, LiquidationsLargeService } from '../../src/web/liquidations/large.service';
import { LiquidationsLargeController } from '../../src/web/liquidations/liquidations-large.controller';
import { LiquidationsOverviewService } from '../../src/web/liquidations/overview.service';
import type { FeedRow } from '../../src/web/liquidations/pg/overview.repo';
import { stubClassifier } from './liquidations-test-classifier';

/** IB-120 — `GET /api/web/liquidations/large` (market-round2 design §4). */

const NOW_MS = 1_793_880_000_000;
const NOW = NOW_MS / 1000;
const q = (over: Record<string, unknown> = {}) => WebLiquidationsLargeQuerySchema.parse(over);

const ev = (agoSec: number, over: Partial<FeedRow> = {}): FeedRow => ({
  timeSec: NOW - agoSec, symbolId: 'BTCUSDT', venueSymbol: 'BTCUSDT', base: 'BTC', side: 'short', usd: 200_000, price: 69_000, venue: 'binance', ...over,
});

/** A short cascade of 4 within 3 minutes (one of them $5M), a lone ETH long, an unmapped coin. */
const tape: FeedRow[] = [
  ev(3_600 + 180, { usd: 150_000, venue: 'okx' }),
  ev(3_600 + 120, { usd: 5_000_000 }),
  ev(3_600 + 60, { usd: 300_000, venue: 'bybit' }),
  ev(3_600, { usd: 120_000 }),
  ev(600, { symbolId: 'ETHUSDT', base: 'ETH', venueSymbol: 'ETHUSDT', side: 'long', usd: 1_200_000, venue: 'bybit' }),
  ev(60, { symbolId: null, base: null, venueSymbol: 'NEWCOINUSDT', usd: 110_000 }),
];
const base = () => largeBase(tape, { nowMs: NOW_MS, periodSec: 86_400, cap: LARGE_PAGE_BASE_CAP });

describe('largeBase / largeAnswer (pure)', () => {
  it('rows are newest first and the period axis ends at asOf', () => {
    const b = base();
    expect(b.rows.map((r) => r.time)).toEqual([...b.rows.map((r) => r.time)].sort((x, y) => y - x));
    expect(b.from).toBe(NOW - 86_400);
    expect(b.capped).toBe(false);
  });

  it('a cascade carries the same series the Market block\'s cards give it (one definition)', () => {
    const page = base().rows.filter((r) => r.seriesId !== null);
    const market = largeEvents({ events: tape, minUsd: 100_000, limit: 50, medianEventUsd: null, normPeriodDays: 0, minHistoryDays: 7 })
      .filter((e) => e.seriesId !== null);
    expect(page).toHaveLength(4);
    expect(page.map((r) => [r.time, r.seriesId, r.seriesCount, r.seriesSpanSec]).sort())
      .toEqual(market.map((e) => [e.time, e.seriesId, e.seriesCount, e.seriesSpanSec]).sort());
    expect(page[0]).toMatchObject({ seriesCount: 4, seriesSpanSec: 180 });
  });

  it('«от $1M» shows the $5M member with the WHOLE cascade\'s count, not a series of one', () => {
    const a = largeAnswer(base(), q({ minUsd: '1000000', symbol: 'BTCUSDT' }), WEB_LIQUIDATIONS_LARGE_LIMIT);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ usd: 5_000_000, seriesCount: 4 });
  });

  it('filters by coin, side and venue together', () => {
    expect(largeAnswer(base(), q({ symbol: 'BTCUSDT', side: 'short', venue: 'binance' }), 1000).rows.map((r) => r.usd)).toEqual([120_000, 5_000_000]);
    expect(largeAnswer(base(), q({ side: 'long' }), 1000).rows.map((r) => r.symbol)).toEqual(['ETHUSDT']);
    expect(largeAnswer(base(), q({ venue: 'okx' }), 1000).total).toBe(1);
  });

  it('an unmapped coin is listed under the venue\'s own spelling, not dropped', () => {
    const a = largeAnswer(base(), q(), 1000);
    expect(a.rows[0]).toMatchObject({ symbol: 'NEWCOINUSDT', base: 'NEWCOINUSDT' });
  });

  it('the coin options ignore the coin, side and venue filters but follow the minimum', () => {
    expect(largeAnswer(base(), q({ symbol: 'ETHUSDT', side: 'long', venue: 'bybit' }), 1000).coins.map((c) => c.base)).toEqual(['BTC', 'ETH', 'NEWCOINUSDT']);
    expect(largeAnswer(base(), q({ minUsd: '1000000' }), 1000).coins.map((c) => c.base)).toEqual(['BTC', 'ETH']);
  });

  it('cuts at the limit, newest kept, and says how many there were', () => {
    const many = Array.from({ length: 1_005 }, (_, i) => ev(i * 700, { side: i % 2 ? 'long' : 'short' }));
    const a = largeAnswer(largeBase(many, { nowMs: NOW_MS, periodSec: 7 * 86_400, cap: LARGE_PAGE_BASE_CAP }), q({ period: '7d' }), WEB_LIQUIDATIONS_LARGE_LIMIT);
    expect(a.rows).toHaveLength(1_000);
    expect(a.total).toBe(1_005);
    expect(a.truncated).toBe(true);
    expect(a.rows[0].time).toBe(NOW);
    expect(() => WebLiquidationsLargeResponseSchema.parse(a)).not.toThrow();
  });

  it('at or under the limit: not truncated', () => {
    const a = largeAnswer(base(), q(), 1000);
    expect(a).toMatchObject({ total: 6, truncated: false });
    expect(() => WebLiquidationsLargeResponseSchema.parse(a)).not.toThrow();
  });

  it('a base read that hits the cap says so', () => {
    expect(largeBase(tape, { nowMs: NOW_MS, periodSec: 86_400, cap: tape.length }).capped).toBe(true);
  });
});

/** A DB that answers the feed query with `tape` and everything else with nothing; counts feed reads. */
function tapeDb(rows: FeedRow[] = tape) {
  const feeds: unknown[][] = [];
  const db: Db = {
    query: async (sql: string, params?: unknown[]) => {
      if (!/order by l\.ts desc/.test(sql)) return [] as never;
      feeds.push(params ?? []);
      return rows.map((r) => ({
        ts: new Date(r.timeSec * 1000), symbol_id: r.symbolId, venue_symbol: r.venueSymbol, base: r.base,
        side: r.side, notional: String(r.usd), price: String(r.price), venue: r.venue,
      })) as never;
    },
    transaction: async (fn) => fn(db),
  };
  return { db, feeds };
}

function service(db: Db | null, clock: { now: number }) {
  return new LiquidationsLargeService(db, new LiquidationsOverviewService(db, stubClassifier(), () => clock.now), () => clock.now);
}

describe('LiquidationsLargeService (the caches)', () => {
  it('ONE tape read per period, whatever the filters clicked within 10 s', async () => {
    const { db, feeds } = tapeDb();
    const clock = { now: NOW_MS };
    const s = service(db, clock);
    await s.large(q());
    await s.large(q({ side: 'long' }));
    await s.large(q({ minUsd: '1000000', venue: 'okx' }));
    expect(feeds).toHaveLength(1);
    await s.large(q({ period: '7d' }));
    expect(feeds).toHaveLength(2);
  });

  it('the read is the tape from $100K over the period, newest first, bounded by the base cap', async () => {
    const { db, feeds } = tapeDb();
    await service(db, { now: NOW_MS }).large(q({ period: '7d', minUsd: '1000000' }));
    const [from, to, minUsd, limit] = feeds[0] as [Date, Date, number, number];
    expect(to.getTime() - from.getTime()).toBe(7 * 86_400_000);
    expect(minUsd).toBe(100_000);
    expect(limit).toBe(LARGE_PAGE_BASE_CAP);
  });

  it('reads again once 10 s have passed', async () => {
    const { db, feeds } = tapeDb();
    const clock = { now: NOW_MS };
    const s = service(db, clock);
    await s.large(q());
    clock.now += LARGE_CACHE_MS - 1;
    await s.large(q());
    expect(feeds).toHaveLength(1);
    clock.now += 1;
    await s.large(q());
    expect(feeds).toHaveLength(2);
  });

  it('holds at most 32 filter keys: a crawler walking every coin cannot grow it', async () => {
    const { db } = tapeDb();
    const s = service(db, { now: NOW_MS });
    for (let i = 0; i < 100; i++) await s.large(q({ symbol: `COIN${i}USDT` }));
    const answers = (s as unknown as { answers: { size: number } }).answers;
    expect(answers.size).toBe(LARGE_CACHE_KEYS);
    expect(LARGE_CACHE_KEYS).toBe(32);
  });

  it('cached answers share the base\'s row objects rather than copying them', async () => {
    const { db } = tapeDb();
    const s = service(db, { now: NOW_MS });
    const all = await s.large(q());
    const shorts = await s.large(q({ side: 'short' }));
    expect(shorts.rows[0]).toBe(all.rows.find((r) => r.time === shorts.rows[0].time));
  });
});

describe('LiquidationsLargeController', () => {
  const body = (error: unknown) => (error as HttpException).getResponse() as { code: string; message: string };

  it.each([
    [{ period: '1h' }, 'period'],
    [{ minUsd: '250000' }, 'minUsd'],
    [{ side: 'both' }, 'side'],
    [{ venue: 'deribit' }, 'venue'],
  ])('%j is a 400 naming %s, never a silent default', async (raw, field) => {
    const controller = new LiquidationsLargeController(service(tapeDb().db, { now: NOW_MS }));
    const error = await controller.large(raw).catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(400);
    expect(body(error).message).toContain(field);
  });

  it('no database is a 503, as on the overview', async () => {
    const controller = new LiquidationsLargeController(service(null, { now: NOW_MS }));
    const error = await controller.large({}).catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(503);
  });

  it('an empty query answers the page default, and the answer parses against the contract', async () => {
    const controller = new LiquidationsLargeController(service(tapeDb().db, { now: NOW_MS }));
    const a = await controller.large({});
    expect(a.query).toEqual({ period: '24h', symbol: 'all', minUsd: 100_000, side: 'all', venue: 'all' });
    expect(() => WebLiquidationsLargeResponseSchema.parse(a)).not.toThrow();
  });
});
