import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppConfigService } from '../../src/config/config.service';
import { DB } from '../../src/db/db.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as users from '../../src/users/pg/users.repo';
import { UsersService } from '../../src/users/users.service';
import { WebAuthGuard } from '../../src/web/auth/web-auth.guard';
import { WebAuthService } from '../../src/web/auth/web-auth.service';
import { OI_ALERTS_VISIBILITY, WebMeSettingsController, LIQ_ALERTS_VISIBILITY } from '../../src/web/members/me-settings.controller';
import { PgLiqAlertsVisibility } from '../../src/alerts/liquidations/pg/liq-alerts.repo';
import { PgOiAlertsVisibility } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { WebMembersController } from '../../src/web/members/members.controller';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-035 against a real database and the real guard, over HTTP:
 * - disable ends the member's sessions, so their NEXT request is 401;
 * - the 409s;
 * - the settings PATCH is strict;
 * - two admins disabling each other at once leave exactly one admin. That race is what the
 *   last-admin rule really guards: sequentially, an active admin acting on another admin always
 *   means two are active.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('members-admin.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

maybeDescribe('IB-035 members admin against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let app: INestApplication;
  let base: string;
  let auth: WebAuthService;
  let usersService: UsersService;
  let adminId: number;
  let memberId: number;

  const config = { env: { get: (key: string) => (key === 'TELEGRAM_BOT_USERNAME' ? 'insight_test_bot' : undefined) } } as unknown as AppConfigService;
  const session = async (userId: number) => (await auth.openSession(userId, new Date()))!.token;
  const call = (method: string, path: string, token: string | null, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { cookie: `ib_session=${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_members', DATABASE_URL as string);
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

    @Module({
      controllers: [WebMembersController, WebMeSettingsController],
      providers: [
        { provide: DB, useValue: db },
        { provide: AppConfigService, useValue: config },
        UsersService, WebAuthService,
        { provide: OI_ALERTS_VISIBILITY, useFactory: () => new PgOiAlertsVisibility(db) },
        { provide: LIQ_ALERTS_VISIBILITY, useFactory: () => new PgLiqAlertsVisibility(db) },
        { provide: APP_GUARD, useClass: WebAuthGuard },
      ],
    })
    class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    auth = app.get(WebAuthService);
    usersService = app.get(UsersService);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a member is refused the admin API (403), and sees their own settings', async () => {
    const t = await session(memberId);
    expect((await call('GET', '/api/web/admin/members', t)).status).toBe(403);
    expect((await call('POST', '/api/web/admin/members/1/disable', t)).status).toBe(403);
    const me = await call('GET', '/api/web/me/settings', t);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ lang: 'ru', calendarAlerts: true, oiAlerts: false, oiAlertsVisible: false, liqAlerts: false, liqAlertsVisible: false });
  });

  it('the settings PATCH writes the same column the bot reads; an unknown field or a bad value is 400', async () => {
    const t = await session(memberId);
    const ok = await call('PATCH', '/api/web/me/settings', t, { lang: 'EN', calendarAlerts: 'выкл' });
    expect(await ok.json()).toEqual({ lang: 'en', calendarAlerts: false, oiAlerts: false, oiAlertsVisible: false, liqAlerts: false, liqAlertsVisible: false });
    expect((await users.findByTgUserId(db, 222))).toMatchObject({ lang: 'en', calendarAlerts: false });
    expect((await call('PATCH', '/api/web/me/settings', t, { deposit: 1000 })).status).toBe(400);
    const bad = await call('PATCH', '/api/web/me/settings', t, { lang: 'de' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'INVALID_SETTING', field: 'lang' });
  });

  it('IB-112: the OI alerts toggle — hidden from a member until members_visible (403 when changed hidden); an admin always; an admin may always change it', async () => {
    const member = await session(memberId);
    const adm = await session(adminId);
    // migration 025 turns oi_alerts on for admins that EXIST when it runs (the box's owner); this admin was
    // bootstrapped after it, so starts off like any new user (V13 as written — reported, not changed here)
    expect(await (await call('GET', '/api/web/me/settings', adm)).json()).toMatchObject({ oiAlerts: false, oiAlertsVisible: true });
    expect(await (await call('PATCH', '/api/web/me/settings', adm, { oiAlerts: true })).json()).toMatchObject({ oiAlerts: true });
    const hidden = await call('PATCH', '/api/web/me/settings', member, { oiAlerts: 'on' });
    expect(hidden.status).toBe(403);
    expect(await hidden.json()).toMatchObject({ code: 'SETTING_NOT_AVAILABLE', field: 'oiAlerts' });
    expect((await users.findByTgUserId(db, 222))?.oiAlerts).toBe(false);
    expect(await (await call('PATCH', '/api/web/me/settings', adm, { oiAlerts: false })).json()).toMatchObject({ oiAlerts: false });
    await db.query('update alert_settings set members_visible = true where id = 1');
    try {
      const shown = await call('PATCH', '/api/web/me/settings', member, { oiAlerts: 'вкл' });
      expect(await shown.json()).toMatchObject({ oiAlerts: true, oiAlertsVisible: true });
      expect((await users.findByTgUserId(db, 222))?.oiAlerts).toBe(true);
      expect((await call('PATCH', '/api/web/me/settings', member, { oiAlerts: 'maybe' })).status).toBe(400);
    } finally {
      await db.query('update alert_settings set members_visible = false where id = 1');
      await db.query('update users set oi_alerts = (role = \'admin\')');
    }
  });

  it('IB-122: the liquidation alerts toggle — the same rule, behind alert_type_settings(liq).members_visible', async () => {
    const member = await session(memberId);
    const adm = await session(adminId);
    expect(await (await call('GET', '/api/web/me/settings', adm)).json()).toMatchObject({ liqAlertsVisible: true });
    expect(await (await call('GET', '/api/web/me/settings', member)).json()).toMatchObject({ liqAlerts: false, liqAlertsVisible: false });
    const hidden = await call('PATCH', '/api/web/me/settings', member, { liqAlerts: 'on' });
    expect(hidden.status).toBe(403);
    expect(await hidden.json()).toMatchObject({ code: 'SETTING_NOT_AVAILABLE', field: 'liqAlerts' });
    // the OI switch does not open the liquidation toggle
    await db.query('update alert_settings set members_visible = true where id = 1');
    try {
      expect((await call('PATCH', '/api/web/me/settings', member, { liqAlerts: 'on' })).status).toBe(403);
      await db.query(`update alert_type_settings set members_visible = true where type = 'liq'`);
      const shown = await call('PATCH', '/api/web/me/settings', member, { liqAlerts: 'вкл' });
      expect(await shown.json()).toMatchObject({ liqAlerts: true, liqAlertsVisible: true });
      expect((await users.findByTgUserId(db, 222))?.liqAlerts).toBe(true);
    } finally {
      await db.query('update alert_settings set members_visible = false where id = 1');
      await db.query(`update alert_type_settings set members_visible = false where type = 'liq'`);
      await db.query('update users set liq_alerts = (role = \'admin\')');
    }
  });

  it('the members list: login null without a password, live sessions counted, no invite code anywhere', async () => {
    const res = await call('GET', '/api/web/admin/members', await session(adminId));
    const body = (await res.json()) as { members: Array<{ id: number; login: string | null; activeSessions: number }> };
    const m = body.members.find((x) => x.id === memberId)!;
    expect(m.login).toBeNull();
    expect(m.activeSessions).toBeGreaterThanOrEqual(2); // the sessions opened above
    expect(JSON.stringify(body)).not.toContain('aaaaaaaaaaaaaaaa');
  });

  it('an invite: the deep link once, and it does not appear in the list afterwards', async () => {
    const t = await session(adminId);
    const res = await call('POST', '/api/web/admin/invites', t);
    expect(res.status).toBe(201);
    const { link } = (await res.json()) as { link: string };
    expect(link).toMatch(/^https:\/\/t\.me\/insight_test_bot\?start=/);
    const code = link.split('start=')[1];
    expect(JSON.stringify(await (await call('GET', '/api/web/admin/members', t)).json())).not.toContain(code);
  });

  it('an admin cannot disable themselves: 409 CANNOT_DISABLE_SELF', async () => {
    const res = await call('POST', `/api/web/admin/members/${adminId}/disable`, await session(adminId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'CANNOT_DISABLE_SELF' });
  });

  it('disable deletes the member\'s sessions in the same step: their NEXT request is 401; enable lets them back in', async () => {
    const memberToken = await session(memberId);
    expect((await call('GET', '/api/web/me/settings', memberToken)).status).toBe(200);

    const res = await call('POST', `/api/web/admin/members/${memberId}/disable`, await session(adminId));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ member: { id: memberId, disabled: true, activeSessions: 0 } });
    expect(Number((await db.query<{ n: string }>('select count(*) n from web_sessions where user_id = $1', [memberId]))[0].n)).toBe(0);

    expect((await call('GET', '/api/web/me/settings', memberToken)).status).toBe(401);
    expect(await auth.openSession(memberId, new Date())).toBeNull(); // nor can a new one be opened

    const back = await call('POST', `/api/web/admin/members/${memberId}/enable`, await session(adminId));
    expect(await back.json()).toMatchObject({ member: { id: memberId, disabled: false } });
    expect(await auth.openSession(memberId, new Date())).not.toBeNull();
  });

  it('two admins disabling EACH OTHER at the same moment leave exactly one admin (the last-admin rule under a race)', async () => {
    await db.query("update users set role = 'admin' where id = $1", [memberId]);
    const a = (await users.findById(db, adminId))!;
    const b = (await users.findById(db, memberId))!;
    const results = await Promise.all([usersService.setDisabled(a, b.id, true), usersService.setDisabled(b, a.id, true)]);
    const refused = results.filter((r) => !r.ok);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(refused).toEqual([{ ok: false, reason: 'LAST_ADMIN' }]);
    expect(await users.countActiveAdmins(db)).toBe(1);
  });
});
