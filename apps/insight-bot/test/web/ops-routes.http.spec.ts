import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as http from 'node:http';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigService } from '../../src/config/config.service';
import { HealthController } from '../../src/ops/health.controller';
import { MetricsController } from '../../src/ops/metrics.controller';
import { MetricsService } from '../../src/ops/metrics.service';
import { StreamRegistry } from '../../src/ops/stream-registry';
import { DashboardStaticModule } from '../../src/web/static.module';

/**
 * WD-011 (storage ruling S7, https-without-domain H7) — the three paths that changed owner, checked
 * over real HTTP with the real controllers and the real `DashboardStaticModule`, because the bug this
 * guards against lives where they meet. The ops route and the SPA fallback each behave correctly on
 * their own, and the question is which one answers. The bundle is a temp `index.html` with a marker,
 * so the spec does not depend on whether someone has run `ng build` in this checkout.
 *
 * - `/health` is the dashboard's, so a reload of the admin Health page gets `index.html`;
 * - `/healthz` is the ops liveness probe, exactly `{"status":"ok"}`, and is never the SPA;
 * - `/metrics` 404s a request carrying `CLIENT_IP_HEADER` (on the box Caddy sets it on every
 *   proxied request) and answers one without it.
 */

const MARKER = '<!-- wd-011 spa marker -->';

async function boot(opts: { bundle: boolean; env: Record<string, unknown> }): Promise<{ app: INestApplication; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'wd011-spa-'));
  if (opts.bundle) writeFileSync(join(root, 'index.html'), `<!doctype html><html><body>${MARKER}</body></html>`);
  // NestFactory, NOT Test.createTestingModule: ServeStaticModule picks its loader from
  // HttpAdapterHost inside a provider factory, and the testing builder runs that factory in
  // compile(), before createNestApplication() attaches the adapter. It then gets the NoopLoader and
  // every SPA path is a 404, even '/'. NestFactory attaches the adapter first, as main.ts does.
  @Module({
    imports: [DashboardStaticModule.register(root)],
    controllers: [HealthController, MetricsController],
    providers: [
      StreamRegistry,
      MetricsService,
      { provide: AppConfigService, useValue: { env: { get: (k: string) => opts.env[k] } } },
    ],
  })
  class OpsRoutesModule {}
  const app = await NestFactory.create(OpsRoutesModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  return { app, root };
}

function get(app: INestApplication, path: string, headers: Record<string, string> = {}): Promise<{ status: number; type: string; body: string }> {
  const port = (app.getHttpServer().address() as { port: number }).port;
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }));
      })
      .on('error', reject);
  });
}

describe('WD-011 — who answers /health, /healthz and /metrics (box config: bundle + CLIENT_IP_HEADER)', () => {
  let app: INestApplication;
  let root: string;
  beforeAll(async () => ({ app, root } = await boot({ bundle: true, env: { CLIENT_IP_HEADER: 'x-real-ip' } })));
  afterAll(async () => {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['/health', '/health/'])('GET %s → the dashboard index.html (the admin Health page reloads)', async (path) => {
    const res = await get(app, path);
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/html');
    expect(res.body).toContain(MARKER);
  });

  it('GET /healthz → exactly {"status":"ok"} as JSON, never the SPA', async () => {
    const res = await get(app, '/healthz');
    expect(res.status).toBe(200);
    expect(res.type).toContain('application/json');
    expect(JSON.parse(res.body)).toStrictEqual({ status: 'ok' });
  });

  it('GET /metrics carrying x-real-ip (came through Caddy) → 404, and not the SPA either', async () => {
    const res = await get(app, '/metrics', { 'X-Real-IP': '203.0.113.7' });
    expect(res.status).toBe(404);
    expect(res.body).not.toContain(MARKER);
    expect(res.body).not.toContain('ib_');
  });

  it('GET /metrics without the header (a scrape on the box) → 200 Prometheus text', async () => {
    const res = await get(app, '/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toContain('ib_binance_weight_used_1m');
  });

  it('an unrouted /api path is still a 404, not the SPA (the other exclusions are unchanged)', async () => {
    const res = await get(app, '/api/web/nope');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain(MARKER);
  });
});

describe('WD-011 — the control: no bundle, no CLIENT_IP_HEADER (a dev slot)', () => {
  let app: INestApplication;
  let root: string;
  beforeAll(async () => ({ app, root } = await boot({ bundle: false, env: {} })));
  afterAll(async () => {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('GET /health → 404: the index.html above came from the SPA fallback, and no ops route is left there', async () => {
    expect((await get(app, '/health')).status).toBe(404);
  });

  it('GET /healthz → {"status":"ok"}', async () => {
    expect(JSON.parse((await get(app, '/healthz')).body)).toStrictEqual({ status: 'ok' });
  });

  it('GET /metrics → 200 even with an x-real-ip header (unset variable = open, as on every slot)', async () => {
    const res = await get(app, '/metrics', { 'X-Real-IP': '203.0.113.7' });
    expect(res.status).toBe(200);
    expect(res.body).toContain('ib_binance_weight_used_1m');
  });
});
