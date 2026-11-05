import { LIQ_ALERTS_ADMIN, WebLiqAlertsAdminController } from '../../src/web/admin/liq-alerts.controller';
import { LiqAlertsAdmin } from '../../src/alerts/liquidations/liq-alerts-admin';
import { PgLiqAlertStore } from '../../src/alerts/liquidations/pg/liq-alerts.repo';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { OI_DIVERGENCE_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { AlertsAdmin } from '../../src/alerts/oi-divergence/alerts-admin';
import { PgOiAlertStore } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { AppConfigService } from '../../src/config/config.service';
import { DB } from '../../src/db/db.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as users from '../../src/users/pg/users.repo';
import { UsersService } from '../../src/users/users.service';
import { ALERTS_ADMIN, WebAlertsAdminController } from '../../src/web/admin/alerts.controller';
import { WebAuthGuard } from '../../src/web/auth/web-auth.guard';
import { WebAuthService } from '../../src/web/auth/web-auth.service';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-112 (V17) — /api/web/admin/alerts over HTTP, the real guard and a real database; Binance's
 * exchangeInfo is the committed capture (or a venue that does not answer).
 */
const { DATABASE_URL } = process.env;
const describeDb = DATABASE_URL ? describe : describe.skip;
const INFO = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'binance', 'exchangeInfo-classes.json'), 'utf8'));
const QUARTERLY = (INFO.symbols as Array<{ symbol: string; contractType: string }>).find((s) => s.contractType === 'CURRENT_QUARTER')?.symbol as string;

describeDb('IB-112 alerts admin API against a real database', () => {
  let admin: Client;
  let db: PgDatabase;
  let name: string;
  let app: INestApplication;
  let base: string;
  let auth: WebAuthService;
  let adminId: number;
  let memberId: number;
  let venueUp = true;
  let infoCalls = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const session = async (userId: number) => (await auth.openSession(userId, new Date()))!.token;
  const call = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', cookie: `ib_session=${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_alertsadm', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    adminId = (await users.bootstrapAdmin(db, 111)).id;
    await users.createInvite(db, 'aaaaaaaaaaaaaaaa', adminId, new Date(Date.now() + 86_400_000));
    memberId = ((await users.consumeInvite(db, 'aaaaaaaaaaaaaaaa', 222, 222, new Date())) as { user: { id: number } }).user.id;
    const config = { env: { get: () => undefined } } as unknown as AppConfigService;
    @Module({
      controllers: [WebAlertsAdminController, WebLiqAlertsAdminController],
      providers: [
        { provide: DB, useValue: db },
        { provide: AppConfigService, useValue: config },
        UsersService, WebAuthService,
        { provide: ALERTS_ADMIN, useFactory: () => new AlertsAdmin(new PgOiAlertStore(db), async () => { infoCalls++; if (!venueUp) throw new Error('503'); return INFO; }) },
        { provide: LIQ_ALERTS_ADMIN, useFactory: () => new LiqAlertsAdmin(new PgLiqAlertStore(db)) },
        { provide: APP_GUARD, useClass: WebAuthGuard },
      ],
    })
    class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    auth = app.get(WebAuthService);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a member gets 403 on every route', async () => {
    const t = await session(memberId);
    expect((await call('GET', '/api/web/admin/alerts', t)).status).toBe(403);
    expect((await call('POST', '/api/web/admin/alerts/symbols', t, { symbol: 'DOGEUSDT' })).status).toBe(403);
    expect((await call('PATCH', '/api/web/admin/alerts/settings', t, { enabled: true })).status).toBe(403);
  });

  it('the page: both switches off, the five seeded coins, an empty journal', async () => {
    const res = await call('GET', '/api/web/admin/alerts', await session(adminId));
    expect(res.status).toBe(200);
    const page = await json(res);
    expect(page.settings).toMatchObject({ enabled: false, membersVisible: false, params: OI_DIVERGENCE_DEFAULT_PARAMS });
    expect(page.symbols.map((s: { symbol: string }) => s.symbol)).toEqual(['BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TRXUSDT']);
    expect([page.alerts, page.skips]).toEqual([[], []]);
  });

  it('adding a coin: checked against Binance; refusals are 409 with their code; nothing added on a refusal', async () => {
    const t = await session(adminId);
    const ok = await call('POST', '/api/web/admin/alerts/symbols', t, { symbol: 'XRPUSDT' });
    expect(ok.status).toBe(200);
    expect((await json(ok)).symbols.find((s: { symbol: string }) => s.symbol === 'XRPUSDT')).toMatchObject({ base: 'XRP', enabled: true, addedBy: adminId });
    const refuse = async (body: unknown) => { const r = await call('POST', '/api/web/admin/alerts/symbols', t, body); return [r.status, (await json(r)).code]; };
    expect(await refuse({ symbol: 'XRPUSDT' })).toEqual([409, 'already_listed']);
    // Binance names quarterlies `BTCUSDT_261225`: the underscore already fails the symbol's format (migration
    // 025's check, mirrored by the contract), so it is a 400 before the venue is asked; not_perpetual for a
    // well-formed one is the unit spec's (symbol-check.spec.ts, on the real exchangeInfo row)
    expect(await refuse({ symbol: QUARTERLY })).toEqual([400, 'INVALID_SYMBOL']);
    expect(await refuse({ symbol: 'NOSUCHUSDT' })).toEqual([409, 'not_found']);
    venueUp = false;
    try {
      expect(await refuse({ symbol: 'ADAUSDT' })).toEqual([409, 'venue_unavailable']);
    } finally { venueUp = true; }
    expect(await refuse({ symbol: 'xrpusdt' })).toEqual([400, 'INVALID_SYMBOL']);
    expect(await refuse({ symbol: 'ADAUSDT', enabled: true })).toEqual([400, 'INVALID_SYMBOL']);
    const symbols = (await json(call('GET', '/api/web/admin/alerts', t))).symbols.map((s: { symbol: string }) => s.symbol);
    expect(symbols).not.toContain(QUARTERLY);
    expect(symbols).not.toContain('ADAUSDT');
    expect(infoCalls).toBeGreaterThan(0);
  });

  it('pause, resume, remove; an unknown coin is 404', async () => {
    const t = await session(adminId);
    const paused = await json(call('PATCH', '/api/web/admin/alerts/symbols/TRXUSDT', t, { enabled: false }));
    expect(paused.symbols.find((s: { symbol: string }) => s.symbol === 'TRXUSDT').enabled).toBe(false);
    expect((await call('PATCH', '/api/web/admin/alerts/symbols/TRXUSDT', t, { enabled: 'no' })).status).toBe(400);
    expect((await call('PATCH', '/api/web/admin/alerts/symbols/NOPEUSDT', t, { enabled: true })).status).toBe(404);
    await call('PATCH', '/api/web/admin/alerts/symbols/TRXUSDT', t, { enabled: true });
    const removed = await json(call('DELETE', '/api/web/admin/alerts/symbols/XRPUSDT', t));
    expect(removed.symbols.map((s: { symbol: string }) => s.symbol)).not.toContain('XRPUSDT');
    expect((await call('DELETE', '/api/web/admin/alerts/symbols/XRPUSDT', t)).status).toBe(404);
  });

  it('settings: strict; each switch alone; params validated whole; who changed it is stamped', async () => {
    const t = await session(adminId);
    expect((await call('PATCH', '/api/web/admin/alerts/settings', t, {})).status).toBe(400);
    expect((await call('PATCH', '/api/web/admin/alerts/settings', t, { enabled: 'yes' })).status).toBe(400);
    const badN = { ...OI_DIVERGENCE_DEFAULT_PARAMS, perTf: { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf, '1h': { n: 0, k: 3, w: 120 } } };
    expect((await call('PATCH', '/api/web/admin/alerts/settings', t, { params: badN })).status).toBe(400);
    const on = await json(call('PATCH', '/api/web/admin/alerts/settings', t, { enabled: true }));
    expect(on.settings).toMatchObject({ enabled: true, membersVisible: false, updatedBy: adminId });
    const p = { ...OI_DIVERGENCE_DEFAULT_PARAMS, atrMult: 0.3 };
    const changed = await json(call('PATCH', '/api/web/admin/alerts/settings', t, { params: p }));
    expect(changed.settings).toMatchObject({ enabled: true, params: p });
    await call('PATCH', '/api/web/admin/alerts/settings', t, { enabled: false, params: OI_DIVERGENCE_DEFAULT_PARAMS });
  });

  it('IB-122: /admin/alerts/liq — admin only; strict body; a coin edit merges; an unlisted coin is 404', async () => {
    const m = await session(memberId);
    expect((await call('GET', '/api/web/admin/alerts/liq', m)).status).toBe(403);
    expect((await call('PATCH', '/api/web/admin/alerts/liq', m, { enabled: true })).status).toBe(403);
    const t = await session(adminId);
    const page = await json(call('GET', '/api/web/admin/alerts/liq', t));
    expect(page.settings).toMatchObject({ enabled: false, membersVisible: false });
    expect(page.coins.map((c: { symbol: string; thresholdUsd: number | null }) => `${c.symbol}:${c.thresholdUsd}`)).toEqual(
      expect.arrayContaining(['BTCUSDT:5000000', 'TRXUSDT:300000']));
    expect((await call('PATCH', '/api/web/admin/alerts/liq', t, {})).status).toBe(400);
    expect((await call('PATCH', '/api/web/admin/alerts/liq', t, { perCoin: { TRXUSDT: { enabled: true, thresholdUsd: -1 } } })).status).toBe(400);
    expect((await call('PATCH', '/api/web/admin/alerts/liq', t, { perCoin: { NOPEUSDT: { enabled: true, thresholdUsd: 1 } } })).status).toBe(404);
    const changed = await json(call('PATCH', '/api/web/admin/alerts/liq', t, { perCoin: { TRXUSDT: { enabled: true, thresholdUsd: 400_000 } } }));
    expect(changed.settings.params.perCoin.TRXUSDT).toEqual({ enabled: true, thresholdUsd: 400_000 });
    expect(changed.settings.params.perCoin.BTCUSDT).toEqual({ enabled: true, thresholdUsd: 5_000_000 });
    await call('PATCH', '/api/web/admin/alerts/liq', t, { perCoin: { TRXUSDT: { enabled: true, thresholdUsd: 300_000 } } });
  });
});
