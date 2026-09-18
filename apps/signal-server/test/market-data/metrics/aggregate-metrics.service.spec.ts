import { NotFoundException } from '@nestjs/common';
import { MetricAggregate, MetricObservation } from '@trade-automation/contracts';
import { MetricAggregatesController } from '../../../src/api/rest/metric-aggregates.controller';
import { AggregateMetricsService } from '../../../src/market-data/metrics/aggregate-metrics.service';
import { MetricCache } from '../../../src/market-data/metrics/metric-cache.service';

/** architecture/aggregate-oi.md §5 — REST composition, cache-then-store, lead drop, health. */

const M5 = 5 * 60_000;
const T0 = 1_789_228_800_000;

const AGG: MetricAggregate = {
  id: 'btc-perp-oi',
  displayName: 'BTC perps · 3 venues',
  metric: 'openInterest',
  countingConvention: 'one-sided',
  members: [
    { id: 'binance:BTCUSDT', venue: 'binance', symbol: 'BTCUSDT', quoteCurrency: 'USDT' },
    { id: 'bybit:BTCUSDT', venue: 'bybit', symbol: 'BTCUSDT', quoteCurrency: 'USDT' },
    { id: 'hyperliquid:BTC', venue: 'hyperliquid', symbol: 'BTC', quoteCurrency: 'USDC' },
  ],
};

function leg(instrument: MetricObservation['instrument'], slot: number, value: number): MetricObservation {
  return { metric: 'openInterest', instrument, time: T0 + slot * M5, value, unit: 'base', notional: value * 10, notionalBasis: 'venue' };
}

/** Binance + Bybit on slots 0–19; Hyperliquid from slot 8 with a 2-slot blip at 12–13. */
function rows(): MetricObservation[] {
  const out: MetricObservation[] = [];
  for (let i = 0; i < 20; i++) {
    out.push(leg('binance:BTCUSDT', i, 100 + i), leg('bybit:BTCUSDT', i, 200 + i));
    if (i >= 8 && (i < 12 || i > 13)) out.push(leg('hyperliquid:BTC', i, 300 + i));
  }
  return out;
}

/** Store holds everything; cache holds only slots ≥ 10 (as after a 30-day cache trim). */
function makeService() {
  const all = rows();
  const cache = new MetricCache();
  for (const o of all) if (o.time >= T0 + 10 * M5) cache.upsert(o);
  const store = {
    query: jest.fn(async (instrument: string, _metric: string, from: number, to: number) =>
      all.filter((o) => o.instrument === instrument && o.time >= from && o.time <= to),
    ),
    upsert: async () => undefined,
    latestTime: async () => null,
  };
  const service = new AggregateMetricsService({ metricAggregates: [AGG] } as never, cache, store as never);
  return { service, cache, store, controller: new MetricAggregatesController(service) };
}

describe('GET /api/metric-aggregates (architecture/aggregate-oi.md §5)', () => {
  it('lists the configured definitions', () => {
    expect(makeService().controller.list()).toEqual([AGG]);
  });

  it('serves a seam (+Hyperliquid) and drops the 2-slot blip, reading cache then store', async () => {
    const { controller, store } = makeService();
    const res = await controller.points({ aggregate: AGG.id, timeframe: '5m', from: T0, to: T0 + 19 * M5, limit: 1500 });
    expect(res.aggregate).toBe(AGG);
    const bySlot = new Map(res.points.map((p) => [(p.time - T0) / M5, p]));
    expect(res.points).toHaveLength(18); // 20 slots − the 2 blip slots
    expect(bySlot.get(7)).toMatchObject({ complete: false, coverage: ['binance:BTCUSDT', 'bybit:BTCUSDT'] });
    expect(bySlot.get(8)).toMatchObject({ complete: true, coverageStart: true });
    expect(bySlot.get(8)!.ohlc.open).toBe(bySlot.get(8)!.ohlc.close);
    expect(bySlot.has(12)).toBe(false);
    expect(bySlot.has(13)).toBe(false);
    expect(bySlot.get(14)).toMatchObject({ complete: true });
    expect(store.query).toHaveBeenCalled(); // slots < 10 come from the store
  });

  it('a page starting mid-series equals the same buckets fetched from further back (lead dropped)', async () => {
    const { controller } = makeService();
    const query = { aggregate: AGG.id, timeframe: '15m' as const, to: T0 + 19 * M5, limit: 1500 };
    const full = await controller.points({ ...query, from: T0 });
    const page = await controller.points({ ...query, from: T0 + 9 * M5 });
    expect(page.points[0].time).toBe(T0 + 9 * M5);
    expect(page.points).toEqual(full.points.filter((p) => p.time >= T0 + 9 * M5));
  });

  it('keeps the last `limit` points', async () => {
    const { controller } = makeService();
    const res = await controller.points({ aggregate: AGG.id, timeframe: '5m', from: T0, to: T0 + 19 * M5, limit: 2 });
    expect(res.points.map((p) => p.time)).toEqual([T0 + 18 * M5, T0 + 19 * M5]);
  });

  it('404s an unknown aggregate', async () => {
    const { controller } = makeService();
    await expect(
      controller.points({ aggregate: 'nope', timeframe: '5m', from: T0, to: T0 + M5, limit: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AggregateMetricsService.health (architecture/aggregate-oi.md §5)', () => {
  it('reports the latest 5 m coverage, and nothing when it is stale', () => {
    const { service, cache } = makeService();
    expect(service.health(T0 + 19 * M5 + 60_000)).toEqual([
      { id: AGG.id, coverageNow: ['binance:BTCUSDT', 'bybit:BTCUSDT', 'hyperliquid:BTC'], complete: true },
    ]);
    // Hyperliquid stops reporting for K slots → partial epoch now.
    for (let i = 20; i < 23; i++) {
      cache.upsert(leg('binance:BTCUSDT', i, 120));
      cache.upsert(leg('bybit:BTCUSDT', i, 220));
    }
    expect(service.health(T0 + 22 * M5 + 60_000)[0]).toEqual({
      id: AGG.id,
      coverageNow: ['binance:BTCUSDT', 'bybit:BTCUSDT'],
      complete: false,
    });
    expect(service.health(T0 + 30 * 24 * M5)[0]).toEqual({ id: AGG.id, coverageNow: [], complete: false });
  });
});
