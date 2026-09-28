import { HealthController } from '../src/ops/health.controller';
import { MetricsController } from '../src/ops/metrics.controller';
import { MetricsService } from '../src/ops/metrics.service';
import { StreamRegistry } from '../src/ops/stream-registry';

describe('StreamRegistry', () => {
  it('reports a registered stream with no message yet as null, not 0', () => {
    const registry = new StreamRegistry();
    registry.register('binance-perp:kline_1m', 'binance');
    expect(registry.snapshot()).toEqual([
      { id: 'binance-perp:kline_1m', venue: 'binance', lastMessageAgeSec: null, reconnects24h: 0, gapsOpen: 0, mode: 'ws', degradedReason: null, expectedIntervalSec: null },
    ]);
  });

  it('ages the last message in whole seconds', () => {
    const registry = new StreamRegistry();
    registry.register('okx:liquidation-orders', 'okx');
    registry.recordMessage('okx:liquidation-orders', 1_000_000);
    expect(registry.snapshot(1_000_000)[0].lastMessageAgeSec).toBe(0);
    expect(registry.snapshot(1_090_000)[0].lastMessageAgeSec).toBe(90);
  });

  it('IB-005 / §16.1: a stream reports its mode, and the reason only while degraded', () => {
    const registry = new StreamRegistry();
    registry.register('binance-perp:kline_1m', 'binance');
    expect(registry.snapshot()[0]).toMatchObject({ mode: 'ws', degradedReason: null });

    registry.setMode('binance-perp:kline_1m', 'degraded', 'silent-after-open');
    expect(registry.snapshot()[0]).toMatchObject({ mode: 'degraded', degradedReason: 'silent-after-open' });

    registry.setMode('binance-perp:kline_1m', 'ws');
    expect(registry.snapshot()[0]).toMatchObject({ mode: 'ws', degradedReason: null });
    registry.setMode('unregistered', 'degraded', 'x'); // ignored, like the other writes
    expect(registry.snapshot()).toHaveLength(1);
  });

  it('counts reconnects in the trailing 24h only', () => {
    const now = Date.UTC(2026, 8, 28, 12);
    const registry = new StreamRegistry();
    registry.register('bybit:allLiquidation', 'bybit');
    registry.recordReconnect('bybit:allLiquidation', now - 25 * 3600_000);
    registry.recordReconnect('bybit:allLiquidation', now - 2 * 3600_000);
    expect(registry.snapshot(now)[0].reconnects24h).toBe(1);
  });

  it('ignores writes for a stream nobody registered, rather than inventing one', () => {
    const registry = new StreamRegistry();
    registry.recordMessage('nope');
    registry.recordReconnect('nope');
    registry.setGapsOpen('nope', 4);
    expect(registry.snapshot()).toEqual([]);
  });

  it('registers a stream once, keeping its recorded state', () => {
    const registry = new StreamRegistry();
    registry.register('binance-spot:kline_1m', 'binance');
    registry.recordMessage('binance-spot:kline_1m', 5_000);
    registry.register('binance-spot:kline_1m', 'binance');
    expect(registry.snapshot(5_000)[0].lastMessageAgeSec).toBe(0);
  });
});

describe('GET /health', () => {
  it('answers the §6.1 shape, with no streams and no measurable db lag at this stage', () => {
    const streams = new StreamRegistry();
    const controller = new HealthController(streams, new MetricsService(streams));
    expect(controller.get()).toEqual({ streams: [], db: { lagSec: null }, budget: { binanceWeightUsed1m: 0 } });
  });

  it('reports each registered stream and the current Binance weight', () => {
    const streams = new StreamRegistry();
    const metrics = new MetricsService(streams);
    streams.register('binance-perp:markPrice', 'binance');
    streams.setGapsOpen('binance-perp:markPrice', 2);
    metrics.setBinanceWeightUsed1m(240);

    const health = new HealthController(streams, metrics).get();
    expect(health.streams).toEqual([
      { id: 'binance-perp:markPrice', venue: 'binance', lastMessageAgeSec: null, reconnects24h: 0, gapsOpen: 2, mode: 'ws', degradedReason: null, expectedIntervalSec: null },
    ]);
    expect(health.budget.binanceWeightUsed1m).toBe(240);
  });
});

describe('GET /metrics', () => {
  it('exposes the six §6.1 metric names', async () => {
    const streams = new StreamRegistry();
    const metrics = new MetricsService(streams);
    streams.register('binance-perp:kline_1m', 'binance');
    streams.recordMessage('binance-perp:kline_1m');
    metrics.rowsWritten.inc({ table: 'candles_1m' }, 3);
    metrics.gapsDetected.inc({ stream: 'binance-perp:kline_1m' });
    metrics.gapsUnrepaired.inc({ stream: 'binance-perp:kline_1m' });
    metrics.wsReconnects.inc({ stream: 'binance-perp:kline_1m' });

    const body = await new MetricsController(metrics).get();
    for (const name of [
      'ib_stream_last_message_age_seconds',
      'ib_rows_written_total',
      'ib_gaps_detected_total',
      'ib_gaps_unrepaired_total',
      'ib_binance_weight_used_1m',
      'ib_ws_reconnects_total',
    ]) {
      expect(body).toContain(name);
    }
    expect(body).toContain('ib_rows_written_total{table="candles_1m"} 3');
  });

  it('samples the age gauge only for a stream that has had a message', async () => {
    const streams = new StreamRegistry();
    const metrics = new MetricsService(streams);
    streams.register('silent', 'binance');
    const body = await new MetricsController(metrics).get();
    expect(body).not.toContain('ib_stream_last_message_age_seconds{stream="silent"}');
  });
});
