import { HttpException } from '@nestjs/common';
import { LiquidationsController } from '../../src/web/liquidations/liquidations.controller';
import { LiquidationsOverviewService, OVERVIEW_CACHE_MS } from '../../src/web/liquidations/overview.service';
import { stubClassifier } from '../web/liquidations-test-classifier';
import type { Db } from '../../src/db/db.port';

/**
 * IB-038 — the cache and the controller's guards. §12.3 budgets one set of queries per 15 s,
 * "so several members polling do not multiply the query"; this is that promise, tested.
 */

/** Counts queries and answers every one with nothing, which is a valid empty market. */
const countingDb = () => {
  const queries: string[] = [];
  const db: Db = {
    query: async (sql: string) => { queries.push(sql); return [] as never; },
    transaction: async (fn) => fn(db),
  };
  return { db, queries };
};

const body = (error: unknown) => (error as HttpException).getResponse() as { code: string };

describe('the 5 s cache (IB-084, was 15 s)', () => {
  it('serves a second caller from the cache instead of querying again', async () => {
    const { db, queries } = countingDb();
    let clock = 1_000_000;
    const service = new LiquidationsOverviewService(db, stubClassifier(), () => clock);

    await service.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const });
    const afterFirst = queries.length;
    expect(afterFirst).toBeGreaterThan(0);

    clock += OVERVIEW_CACHE_MS - 1;
    await service.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const });
    expect(queries.length).toBe(afterFirst);
  });

  it('queries again once the entry is stale', async () => {
    const { db, queries } = countingDb();
    let clock = 1_000_000;
    const service = new LiquidationsOverviewService(db, stubClassifier(), () => clock);

    await service.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const });
    const afterFirst = queries.length;

    clock += OVERVIEW_CACHE_MS;
    await service.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const });
    // the answer is re-read; only the slower-moving class keys (CLASS_KEYS_CACHE_MS) are reused
    expect(queries.length).toBe(afterFirst * 2 - 1);
  });

  it('SHARES ONE QUERY between callers that arrive together', async () => {
    // The cache holds the promise, not the value. Holding the value would let two members
    // arriving in the same 50 ms both miss and both query — the exact multiplication §12.3
    // exists to prevent, and the one that only shows up under load.
    const { db, queries } = countingDb();
    const service = new LiquidationsOverviewService(db, stubClassifier(), () => 1_000_000);

    await Promise.all([
      service.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const }),
      service.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const }),
      service.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const }),
    ]);
    const once = queries.length;

    const fresh = countingDb();
    await new LiquidationsOverviewService(fresh.db, stubClassifier(), () => 1).overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const });
    expect(once).toBe(fresh.queries.length);
  });

  it('a different threshold is a different answer, so it is a different entry', async () => {
    const { db, queries } = countingDb();
    const service = new LiquidationsOverviewService(db, stubClassifier(), () => 1_000_000);
    await service.overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const });
    const afterFirst = queries.length;
    await service.overview({ topN: 20, feedMinUsd: 1_000_000, feedLimit: 30, period: '24h' as const });
    expect(queries.length).toBeGreaterThan(afterFirst);
  });

  it('DOES NOT CACHE A FAILURE for 15 seconds', async () => {
    // One blip must not become a quarter-minute outage for everyone.
    let fail = true;
    const db: Db = {
      query: async () => { if (fail) throw new Error('connection reset'); return [] as never; },
      transaction: async (fn) => fn(db),
    };
    const service = new LiquidationsOverviewService(db, stubClassifier(), () => 1_000_000);

    await expect(service.overview({ topN: 20, feedMinUsd: 1, feedLimit: 1, period: '24h' as const })).rejects.toThrow('connection reset');
    fail = false;
    await expect(service.overview({ topN: 20, feedMinUsd: 1, feedLimit: 1, period: '24h' as const })).resolves.toBeDefined();
  });
});

describe('the overview endpoint', () => {
  const service = (db: Db) => new LiquidationsOverviewService(db, stubClassifier(), () => 1_000_000);

  it('reports every known venue as missing when nothing has been collected', async () => {
    const { db } = countingDb();
    const result = await service(db).overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period: '24h' as const });
    // §12.4: Bybit + OKX are never presented as the whole market, and neither is nothing at all.
    expect(result.venues.present).toEqual([]);
    expect(result.venues.missing).toEqual(['binance', 'bybit', 'okx']);
    expect(result.windows.map((w) => w.window)).toEqual(['1h', '4h', '24h']);
    // no history, so no ratio — and the reason is stated rather than left to a bare null
    expect(result.windows.every((w) => w.total.ratio === null)).toBe(true);
    expect(result.windows.every((w) => w.basis.unavailable === 'insufficient_history')).toBe(true);
  });

  it('IB-084: an empty database gives honest refusals in the block, never zeros dressed as norms', async () => {
    const { db } = countingDb();
    for (const period of ['1h', '4h', '24h', '7d'] as const) {
      const { block } = await service(db).overview({ topN: 20, feedMinUsd: 100_000, feedLimit: 30, period });
      expect(block.period).toBe(period);
      expect(block.basis.unavailable).toBe('insufficient_history');
      expect(block.hourly.norm).toEqual({ long: null, short: null, total: null });
      expect(block.hourly.buckets.every((b) => b.rarity === null && !b.outlier)).toBe(true);
      expect(block.large).toEqual([]);
      expect(block.availableFrom[period]).not.toBeNull(); // no tape yet: not available
    }
  });

  it('IB-084: an unknown period is a 400, not a silent 24h', async () => {
    const { db } = countingDb();
    const controller = new LiquidationsController(service(db));
    await expect(controller.overview('top20', '100000', '30', '3d')).rejects.toMatchObject({ status: 400 });
    await expect(controller.overview('top20', '100000', '30', '7d')).resolves.toMatchObject({ block: { period: '7d' } });
  });

  it('refuses a symbols selection it does not serve rather than quietly substituting one', async () => {
    const { db } = countingDb();
    const controller = new LiquidationsController(service(db));
    await expect(controller.overview('top100')).rejects.toThrow(HttpException);
    try {
      await controller.overview('top100');
    } catch (error) {
      expect(body(error)).toMatchObject({ code: 'BAD_REQUEST' });
    }
  });

  it('clamps a silly threshold instead of failing: it is a slider, not a protocol error', async () => {
    const { db } = countingDb();
    const controller = new LiquidationsController(service(db));
    await expect(controller.overview('top20', '-5')).resolves.toMatchObject({ feedMinUsd: 0 });
    await expect(controller.overview('top20', 'banana')).resolves.toMatchObject({ feedMinUsd: 0 });
  });

  it('answers 503 rather than 500 when there is no database', async () => {
    const controller = new LiquidationsController(new LiquidationsOverviewService(null, stubClassifier(), () => 1));
    try {
      await controller.overview();
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect(body(error)).toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});
