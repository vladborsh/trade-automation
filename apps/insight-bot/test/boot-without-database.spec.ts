import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as http from 'http';

/**
 * IB-BUG-001 — the regression guard for IB-003's rule (§2.1, §7): `DATABASE_URL` has no default,
 * and **without one the app still boots and serves `/healthz` and `/metrics`** (WD-011: the liveness
 * probe moved from `/health` to `/healthz`). IB-010's
 * `CalendarModule` broke that by importing `WritersModule` statically (`Writers` throws with no
 * database), so the process exited before the HTTP server was listening.
 *
 * This boots the real `AppModule` — not a stand-in — because the bug was in the module graph, not
 * in any one provider. `DATABASE_URL` is deleted *before* `app.module` is imported: `ConfigModule`
 * validates `process.env` once, synchronously, the first time `config.module.ts` is loaded in a
 * process, and `CalendarModule.register()` reads `process.env` while the graph is built. Both
 * happen at import time, which is why the require is inside the test file's own `beforeAll` and
 * this spec lives in a file of its own (jest gives each file a fresh module registry).
 */
describe('booting with no DATABASE_URL (IB-BUG-001)', () => {
  let app: INestApplication;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module') as { AppModule: unknown };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule as never] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });

  const get = (path: string): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const port = (app.getHttpServer().address() as { port: number }).port;
      http
        .get({ host: '127.0.0.1', port, path }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        })
        .on('error', reject);
    });

  it('boots at all — the process must not exit while wiring the collectors', () => {
    expect(app).toBeDefined();
  });

  it('serves /healthz with 200 and exactly {"status":"ok"}', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toStrictEqual({ status: 'ok' });
  });

  it('no longer serves the ops JSON at /health (that path is the dashboard\'s)', async () => {
    // Never the old { streams, db, budget, noSpot } payload. The SPA answer is not checked here:
    // under Test.createTestingModule ServeStaticModule gets its NoopLoader whatever public/ holds
    // (see test/web/ops-routes.http.spec.ts, which boots through NestFactory to check it)
    const res = await get('/health');
    expect([200, 404]).toContain(res.status);
    expect(res.body).not.toContain('streams');
    expect(res.body).not.toContain('noSpot');
  });

  it('serves /metrics with 200', async () => {
    const res = await get('/metrics');
    expect(res.status).toBe(200);
  });

  it('registers no calendar collector, rather than one that cannot write', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CalendarCollectorService } = require('../src/collectors/calendar/calendar-collector.service');
    expect(() => app.get(CalendarCollectorService)).toThrow();
  });
});
