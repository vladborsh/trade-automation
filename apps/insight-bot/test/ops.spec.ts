import { NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { AppConfigService } from '../src/config/config.service';
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

describe('GET /healthz (WD-011: liveness only)', () => {
  it('answers exactly { status } — no streams, db lag, Binance weight or noSpot', () => {
    // toStrictEqual on the whole object: any field added here is a field served unauthenticated
    expect(new HealthController().get()).toStrictEqual({ status: 'ok' });
  });

  it('is routed at /healthz, not /health (the dashboard owns /health)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HealthController)).toBe('healthz');
  });

  it('takes no dependencies, so it cannot report on a collector', () => {
    expect(HealthController.length).toBe(0);
    expect(Reflect.getMetadata('design:paramtypes', HealthController) ?? []).toEqual([]);
  });
});

describe('GET /metrics', () => {
  it('exposes the §6.1 metric names, spot weight as its own series', async () => {
    const streams = new StreamRegistry();
    const metrics = new MetricsService(streams);
    streams.register('binance-perp:kline_1m', 'binance');
    streams.recordMessage('binance-perp:kline_1m');
    metrics.rowsWritten.inc({ table: 'candles_1m' }, 3);
    metrics.gapsDetected.inc({ stream: 'binance-perp:kline_1m' });
    metrics.gapsUnrepaired.inc({ stream: 'binance-perp:kline_1m' });
    metrics.wsReconnects.inc({ stream: 'binance-perp:kline_1m' });

    const body = await new MetricsController(metrics, envWith({})).get(request());
    for (const name of [
      'ib_stream_last_message_age_seconds',
      'ib_rows_written_total',
      'ib_gaps_detected_total',
      'ib_gaps_unrepaired_total',
      'ib_binance_weight_used_1m',
      'ib_binance_spot_weight_used_1m',
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
    const body = await new MetricsController(metrics, envWith({})).get(request());
    expect(body).not.toContain('ib_stream_last_message_age_seconds{stream="silent"}');
  });
});

/** `env.get` over a plain object, the only part of AppConfigService the metrics route reads. */
function envWith(values: Record<string, unknown>): AppConfigService {
  return { env: { get: (key: string) => values[key] } } as unknown as AppConfigService;
}
function request(headers: Record<string, string> = {}): { headers: Record<string, string> } {
  return { headers };
}

/**
 * WD-011 H7 (architecture/https-without-domain-2026-11-03.md) — on the box Caddy sets x-real-ip on
 * every request it proxies, so a request that carries CLIENT_IP_HEADER came from outside and gets
 * 404. Unset (every slot), the endpoint stays open.
 */
describe('GET /metrics from outside (H7)', () => {
  const metrics = () => new MetricsService(new StreamRegistry());

  it('variable set + header present → 404, shaped like Nest\'s unrouted 404', async () => {
    const controller = new MetricsController(metrics(), envWith({ CLIENT_IP_HEADER: 'x-real-ip' }));
    const attempt = controller.get(request({ 'x-real-ip': '203.0.113.7' }));
    await expect(attempt).rejects.toThrow(NotFoundException);
    await expect(attempt).rejects.toMatchObject({
      response: { statusCode: 404, message: 'Cannot GET /metrics', error: 'Not Found' },
    });
  });

  it('variable set + header absent (a scrape from inside the box) → 200 with the metrics', async () => {
    const controller = new MetricsController(metrics(), envWith({ CLIENT_IP_HEADER: 'x-real-ip' }));
    await expect(controller.get(request())).resolves.toContain('ib_binance_weight_used_1m');
  });

  it('variable unset → 200 even WITH the header (a slot has no proxy; the header means nothing)', async () => {
    const controller = new MetricsController(metrics(), envWith({}));
    await expect(controller.get(request({ 'x-real-ip': '203.0.113.7' }))).resolves.toContain('ib_binance_weight_used_1m');
  });

  it('an empty header value still counts as carried — Caddy decides presence, not content', async () => {
    const controller = new MetricsController(metrics(), envWith({ CLIENT_IP_HEADER: 'x-real-ip' }));
    await expect(controller.get(request({ 'x-real-ip': '' }))).rejects.toThrow(NotFoundException);
  });

  it('the configured name is matched case-insensitively, as Node lower-cases incoming header names', async () => {
    const controller = new MetricsController(metrics(), envWith({ CLIENT_IP_HEADER: ' X-Real-IP ' }));
    await expect(controller.get(request({ 'x-real-ip': '203.0.113.7' }))).rejects.toThrow(NotFoundException);
  });

  it('a blank variable is unset, the same reading the login throttle uses', async () => {
    const controller = new MetricsController(metrics(), envWith({ CLIENT_IP_HEADER: '   ' }));
    await expect(controller.get(request({ 'x-real-ip': '203.0.113.7' }))).resolves.toContain('ib_binance_weight_used_1m');
  });
});
