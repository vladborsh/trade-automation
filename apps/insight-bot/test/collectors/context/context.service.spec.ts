import { ContextClient } from '../../../src/collectors/context/context.client';
import { ContextService, STREAM_COINS } from '../../../src/collectors/context/context.service';
import { BatchWriter } from '../../../src/collectors/writers/batch-writer';
import { Db, DbHandle } from '../../../src/db/db.port';
import { MetricsService } from '../../../src/ops/metrics.service';
import { StreamRegistry } from '../../../src/ops/stream-registry';

const COINS = ['bitcoin', 'ethereum', 'solana'];

class FakeDb implements Db {
  async query<T>(): Promise<T[]> {
    return [] as T[];
  }
  async transaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function build(opts: { chart?: (coin: string) => unknown | Error; calls?: string[] } = {}) {
  const writer = { write: async (rows: unknown[]) => rows.length } as unknown as BatchWriter<never>;
  const writers = { marketCapCoin: writer, fearGreed: writer, marketCapGlobal: writer } as never;
  const streams = new StreamRegistry();
  const metrics = new MetricsService(streams);
  const client = {
    async coinMarketChart(coin: string) {
      opts.calls?.push(`coin:${coin}`);
      const out = opts.chart?.(coin) ?? { prices: [[1790380800000, 1]], market_caps: [[1790380800000, 2]] };
      if (out instanceof Error) throw out;
      return out;
    },
    async global() {
      opts.calls?.push('global');
      return { data: { total_market_cap: { usd: 1 }, market_cap_percentage: { btc: 50, eth: 10 } } };
    },
    async fearGreed() {
      opts.calls?.push('fear-greed');
      return { data: [] };
    },
  } as unknown as ContextClient;

  const config = {
    symbols: COINS.map((id) => ({ coingecko_id: id })),
    signalSet: [],
    env: { get: () => 'https://unused.test' },
  } as never;

  // No pacing in the spec: the delay is the subject of schedule.spec.ts, not of this one.
  const service = new ContextService(config, new FakeDb(), writers, streams, metrics, client, async () => undefined);
  return { service, streams, metrics };
}

describe('pollCoins records the stream per coin, not per pass', () => {
  it('marks the stream alive after the FIRST coin, not only at the end', async () => {
    // The 365-day backfill takes ~10 minutes at the measured rate. A pass-level record leaves the
    // stream reading silent throughout, and the watchdog fires at 3 minutes — so a fresh box
    // would raise a false alert on its very first run.
    const seen: Array<number | null> = [];
    const { service, streams } = build({
      chart: (coin) => {
        seen.push(streams.snapshot()[0]?.lastMessageAgeSec ?? null);
        return { prices: [[1790380800000, 1]], market_caps: [[1790380800000, 2]] };
      },
    });
    streams.register(STREAM_COINS, 'coingecko');

    await service.pollCoins(new Date(), 365);

    // Before the first coin the stream has never reported; by the time the third is fetched it
    // has, because the first two recorded on their own.
    expect(seen[0]).toBeNull();
    expect(seen[2]).not.toBeNull();
  });

  it('keeps the stream fresh across every coin in the pass', async () => {
    const ages: Array<number | null> = [];
    const { service, streams } = build({
      chart: () => {
        ages.push(streams.snapshot()[0]?.lastMessageAgeSec ?? null);
        return { prices: [], market_caps: [] };
      },
    });
    streams.register(STREAM_COINS, 'coingecko');
    await service.pollCoins(new Date(), 2);
    expect(streams.snapshot()[0].lastMessageAgeSec).not.toBeNull();
  });

  it('a coin that fails does not cost the others their day, and is counted as a gap', async () => {
    const { service, streams, metrics } = build({
      chart: (coin) => (coin === 'ethereum' ? new Error('HTTP 500') : { prices: [], market_caps: [] }),
    });
    streams.register(STREAM_COINS, 'coingecko');

    await expect(service.pollCoins(new Date(), 2)).resolves.toBeGreaterThanOrEqual(0);
    const metric = await metrics.registry.getSingleMetricAsString('ib_gaps_detected_total');
    expect(metric).toContain(STREAM_COINS);
  });
});


/** Drains the microtask queue so the bootstrap's fire-and-forget work gets to run. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('IB-BUG-006: the forward-only series goes first', () => {
  it('polls /global BEFORE the backfill queues a single coin', async () => {
    // On a fresh database the backfill fetches 365 days for twenty coins and holds the keyless
    // allowance for ten minutes. Measured 2026-09-28, /global got one row in twenty minutes and
    // then none — and CoinGecko's history endpoint is paid, so those samples are gone for good.
    const calls: string[] = [];
    const { service } = build({ calls });

    service.onApplicationBootstrap();
    for (let i = 0; i < 10; i += 1) await flush();
    service.onModuleDestroy();

    expect(calls[0]).toBe('global');
    expect(calls.indexOf('global')).toBeLessThan(calls.findIndex((c) => c.startsWith('coin:')));
  });

  it('backfills anyway when the first /global fails, rather than trading one missing series for two', async () => {
    const calls: string[] = [];
    const { service } = build({ calls });
    (service as unknown as { client: { global: () => Promise<unknown> } }).client.global = async () => {
      calls.push('global');
      throw new Error('HTTP 429');
    };

    service.onApplicationBootstrap();
    for (let i = 0; i < 10; i += 1) await flush();
    service.onModuleDestroy();

    expect(calls[0]).toBe('global');
    expect(calls.some((c) => c.startsWith('coin:'))).toBe(true);
  });
});
