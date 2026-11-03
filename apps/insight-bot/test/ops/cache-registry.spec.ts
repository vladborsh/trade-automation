import { cacheSnapshot, familyStats, keyFamily, registerCache } from '../../src/ops/cache-registry';
import { MetricsService } from '../../src/ops/metrics.service';
import { StreamRegistry } from '../../src/ops/stream-registry';
import { TtlCache } from '../../src/venues/ttl-cache';

/** IB-096 — what each cache holds, by family, on /metrics: the attribution a 1 GB box needs. */
describe('keyFamily', () => {
  it('window keys drop the symbol and the times; candle pages drop the symbol and page; named keys drop periods', () => {
    expect(keyFamily('binance|perp|BTCUSDT|openInterestHist.5m|1793000000000|1793086400000')).toBe('binance|perp|openInterestHist.5m');
    expect(keyFamily('perp:ETHUSDT:1m:1793000000000')).toBe('candles:perp:1m');
    expect(keyFamily('positioning:24h')).toBe('positioning');
    expect(keyFamily('positioning:baselines')).toBe('positioning:baselines');
    expect(keyFamily('coingecko:markets:top')).toBe('coingecko:markets:top');
    expect(keyFamily('overview:24h:20:100000:30')).toBe('overview');
    expect(keyFamily('kpis')).toBe('kpis');
  });

  it('counts per family, and the expired ones apart', () => {
    const stats = familyStats([['positioning:1h', 1], ['positioning:24h', 0], ['kpis', 1]], (v) => v === 0);
    expect(stats).toEqual([{ family: 'positioning', entries: 2, expired: 1 }, { family: 'kpis', entries: 1, expired: 0 }]);
  });
});

describe('a named TtlCache reports itself, expired entries included (they are dropped only on read)', () => {
  it('stats and /metrics', async () => {
    let now = 0;
    const cache = new TtlCache({ name: 'spec', now: () => now });
    cache.set('binance|perp|BTCUSDT|5m|0|1', 'a', 10);
    cache.set('binance|perp|ETHUSDT|5m|0|1', 'b', 1_000);
    now = 100;
    expect(cache.stats()).toEqual([{ family: 'binance|perp|5m', entries: 2, expired: 1 }]);
    expect(cacheSnapshot()).toContainEqual({ cache: 'spec', family: 'binance|perp|5m', entries: 2, expired: 1 });

    const text = await new MetricsService(new StreamRegistry()).registry.metrics();
    expect(text).toContain('ib_cache_entries{cache="spec",family="binance|perp|5m",state="live"} 1');
    expect(text).toContain('ib_cache_entries{cache="spec",family="binance|perp|5m",state="expired"} 1');
    expect(text).toMatch(/ib_process_memory_bytes\{kind="rss"\} \d+/);
    expect(text).toMatch(/ib_process_memory_bytes\{kind="heap_used"\} \d+/);
    registerCache('spec', { stats: () => [] });
  });
});
