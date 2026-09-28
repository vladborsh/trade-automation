import type { Candle1mRow, CandleAggRow } from '../../src/collectors/writers/tables';
import { DeriveService } from '../../src/derive/derive.service';

/**
 * IB-014 — the service around the pure fold: which buckets a minute closes, and that re-running is
 * idempotent. The fold itself is spec'd in `bucket.spec.ts`; here the database and the writer are
 * fakes, so nothing touches Postgres.
 */
const T0 = Date.UTC(2026, 7, 1, 0, 0);
const M = 60_000;

function minutes(count: number, from = T0): Candle1mRow[] {
  return Array.from({ length: count }, (_, i) => ({
    venue: 'binance', market: 'perp' as const, symbol: 'BTCUSDT',
    openTime: new Date(from + i * M),
    open: 100, high: 110, low: 90, close: 105, volume: 1,
    quoteVolume: 10, trades: 2, takerBuyVolume: 0.5, takerBuyQuoteVolume: 5,
    source: 'ws' as const,
  }));
}

function build(rows: Candle1mRow[]) {
  const written: CandleAggRow[][] = [];
  const db = {
    query: async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('select distinct venue')) return [{ venue: 'binance', market: 'perp', symbol: 'BTCUSDT' }];
      const from = (params?.[3] ?? params?.[0]) as Date;
      const to = (params?.[4] ?? params?.[1]) as Date;
      return rows
        .filter((r) => r.openTime >= from && r.openTime < to)
        .map((r) => ({
          venue: r.venue, market: r.market, symbol: r.symbol, open_time: r.openTime,
          open: String(r.open), high: String(r.high), low: String(r.low), close: String(r.close),
          volume: String(r.volume), quote_volume: String(r.quoteVolume), trades: r.trades,
          taker_buy_volume: String(r.takerBuyVolume), taker_buy_quote_volume: String(r.takerBuyQuoteVolume),
          source: r.source,
        }));
    },
  };
  const writers = { candlesAgg: { write: async (batch: readonly CandleAggRow[]) => (written.push([...batch]), batch.length) } };
  return { service: new DeriveService(db as never, writers as never), written };
}

describe('DeriveService.deriveClosedBuckets', () => {
  it('writes nothing on a minute that closes no bucket', async () => {
    const { service, written } = build(minutes(60));
    expect(await service.deriveClosedBuckets(T0 + 7 * M)).toBe(0);
    expect(written).toEqual([]);
  });

  it('writes the 15m bucket that just closed, and only that one', async () => {
    const { service, written } = build(minutes(60));
    await service.deriveClosedBuckets(T0 + 15 * M);
    const bars = written.flat();
    expect(bars.map((b) => b.tf)).toEqual(['15m']);
    expect(bars[0].openTime.getTime()).toBe(T0);
    expect(bars[0].bars).toBe(15);
    expect(bars[0].complete).toBe(true);
  });

  it('writes every timeframe that closes on the same boundary — a day closes 15m, 1h, 4h and 1d', async () => {
    const { service, written } = build(minutes(1440));
    await service.deriveClosedBuckets(T0 + 1440 * M);
    expect(written.flat().map((b) => b.tf).sort()).toEqual(['15m', '1d', '1h', '4h']);
  });

  it('still writes an incomplete bucket, flagged, rather than skipping the bar', async () => {
    const { service, written } = build(minutes(10)); // 10 of the 15 minutes
    await service.deriveClosedBuckets(T0 + 15 * M);
    expect(written.flat()[0]).toMatchObject({ bars: 10, complete: false });
  });

  it('writes nothing when the bucket holds no rows at all', async () => {
    const { service, written } = build(minutes(15, T0 + 60 * M));
    expect(await service.deriveClosedBuckets(T0 + 15 * M)).toBe(0);
    expect(written).toEqual([]);
  });
});

describe('DeriveService.deriveRange', () => {
  it('derives every bucket the range touches, in time order', async () => {
    const { service, written } = build(minutes(240));
    await service.deriveRange(T0, T0 + 240 * M, ['1h']);
    expect(written.flat().map((b) => b.openTime.toISOString())).toEqual([
      '2026-08-01T00:00:00.000Z', '2026-08-01T01:00:00.000Z', '2026-08-01T02:00:00.000Z', '2026-08-01T03:00:00.000Z',
    ]);
  });

  it('is idempotent: the same rows fold to identical bars every run', async () => {
    const { service, written } = build(minutes(240));
    await service.deriveRange(T0, T0 + 240 * M, ['4h']);
    await service.deriveRange(T0, T0 + 240 * M, ['4h']);
    expect(written[0]).toEqual(written[1]);
  });

  it('widens a partial request to whole buckets, so a typed range cannot invent an incomplete bar', async () => {
    const { service, written } = build(minutes(240));
    // asking for 00:10–00:50 must still produce the WHOLE 1h bucket, complete
    await service.deriveRange(T0 + 10 * M, T0 + 50 * M, ['1h']);
    const bars = written.flat();
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ openTime: new Date(T0), bars: 60, complete: true });
  });
});

describe('DeriveService.healIncomplete (the late-minute case, measured on a live run)', () => {
  function healBuild(rows: Candle1mRow[], incomplete: Array<{ tf: string; openTime: Date }>) {
    const written: CandleAggRow[][] = [];
    const db = {
      query: async (sql: string, params?: readonly unknown[]) => {
        if (sql.includes('complete = false')) {
          return incomplete.map((i) => ({ venue: 'binance', market: 'perp', symbol: 'BTCUSDT', tf: i.tf, openTime: i.openTime }));
        }
        if (sql.includes('select distinct venue')) return [{ venue: 'binance', market: 'perp', symbol: 'BTCUSDT' }];
        const from = (params?.[3] ?? params?.[0]) as Date;
        const to = (params?.[4] ?? params?.[1]) as Date;
        return rows
          .filter((r) => r.openTime >= from && r.openTime < to)
          .map((r) => ({
            venue: r.venue, market: r.market, symbol: r.symbol, open_time: r.openTime,
            open: String(r.open), high: String(r.high), low: String(r.low), close: String(r.close),
            volume: String(r.volume), quote_volume: String(r.quoteVolume), trades: r.trades,
            taker_buy_volume: String(r.takerBuyVolume), taker_buy_quote_volume: String(r.takerBuyQuoteVolume),
            source: r.source,
          }));
      },
    };
    const writers = { candlesAgg: { write: async (batch: readonly CandleAggRow[]) => (written.push([...batch]), batch.length) } };
    return { service: new DeriveService(db as never, writers as never), written };
  }

  it('re-folds a bucket whose missing minute has since arrived, and reports it complete', async () => {
    // the live case: 14 of 15 at derive time, all 15 present a few seconds later
    const { service, written } = healBuild(minutes(15), [{ tf: '15m', openTime: new Date(T0) }]);
    const healed = await service.healIncomplete(T0 + 20 * M);
    expect(healed).toBe(1);
    expect(written.flat()[0]).toMatchObject({ bars: 15, complete: true });
  });

  it('rewrites the bar but does not count it healed while it is still short', async () => {
    const { service, written } = healBuild(minutes(14), [{ tf: '15m', openTime: new Date(T0) }]);
    expect(await service.healIncomplete(T0 + 20 * M)).toBe(0);
    expect(written.flat()[0]).toMatchObject({ bars: 14, complete: false });
  });

  it('leaves a bucket that has not closed yet alone — it is unfinished, not late', async () => {
    const { service, written } = healBuild(minutes(15), [{ tf: '1h', openTime: new Date(T0) }]);
    expect(await service.healIncomplete(T0 + 30 * M)).toBe(0);
    expect(written).toEqual([]);
  });

  it('is idempotent — healing twice writes the same bar', async () => {
    const { service, written } = healBuild(minutes(15), [{ tf: '15m', openTime: new Date(T0) }]);
    await service.healIncomplete(T0 + 20 * M);
    await service.healIncomplete(T0 + 20 * M);
    expect(written[0]).toEqual(written[1]);
  });
});
