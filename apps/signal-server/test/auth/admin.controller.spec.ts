import { INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AdminInviteSchema, AdminUserSchema, CreateInviteResponseSchema } from '@trade-automation/contracts';
import { AdminController } from '../../src/api/rest/admin.controller';
import { AuthController } from '../../src/api/rest/auth.controller';
import { SessionsController } from '../../src/api/rest/backtest/sessions.controller';
import { AdminGuard } from '../../src/auth/admin-only.decorator';
import { AdminService } from '../../src/auth/admin.service';
import { AuthGuard } from '../../src/auth/auth.guard';
import { AuthService } from '../../src/auth/auth.service';
import { sha256Hex } from '../../src/auth/session-cookie';
import { SessionService } from '../../src/backtest/session.service';
import { FakeBacktestRepositories, createBody, makeSessionService } from '../backtest/fake-backtest';
import { FakeAuthRepositories, FakeClock, fakeConfig, fastHasher, makeAuthService } from './fake-auth';

const BASE = 'https://bt.example.test';

/** Every admin route, with a body where it takes one. `:user` / `:invite` are filled per test. */
const ADMIN_ROUTES: [method: string, path: string, body?: unknown][] = [
  ['GET', '/api/admin/users'],
  ['POST', '/api/admin/users/:user/disable'],
  ['POST', '/api/admin/users/:user/enable'],
  ['POST', '/api/admin/invites', {}],
  ['GET', '/api/admin/invites'],
  ['DELETE', '/api/admin/invites/:invite'],
];

async function boot(auth: AuthService, admin: AdminService, sessions: SessionService) {
  @Module({
    controllers: [AuthController, AdminController, SessionsController],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: AdminService, useValue: admin },
      { provide: SessionService, useValue: sessions },
      AdminGuard,
      { provide: APP_GUARD, useClass: AuthGuard },
    ],
  })
  class TestModule {}
  const app = (await Test.createTestingModule({ imports: [TestModule] }).compile()).createNestApplication({ logger: false });
  await app.listen(0);
  return { app, base: await app.getUrl() };
}

describe('/api/admin/* over HTTP (backtest-app-system-design.md §7.1, decision 30)', () => {
  let app: INestApplication;
  let base: string;
  let authRepos: FakeAuthRepositories;
  let btRepos: FakeBacktestRepositories;
  let sessions: SessionService;
  let ids: Record<string, string>;
  const cookies: Record<string, string> = {};

  beforeEach(async () => {
    authRepos = new FakeAuthRepositories();
    const clock = new FakeClock();
    ids = {
      admin: authRepos.addUser('admin@x.test', await fastHasher().hash('admin-password'), 'admin').id,
      alice: authRepos.addUser('alice@x.test', await fastHasher().hash('alice-password')).id,
    };
    btRepos = new FakeBacktestRepositories();
    sessions = makeSessionService(btRepos);
    const auth = makeAuthService(authRepos, clock);
    ({ app, base } = await boot(auth, new AdminService(authRepos, fakeConfig({ APP_BASE_URL: BASE }), clock.now), sessions));
    for (const name of ['admin', 'alice']) cookies[name] = await login(name);
  });
  afterEach(() => app.close());

  async function login(name: string): Promise<string> {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${name}@x.test`, password: `${name}-password` }),
    });
    expect(res.status).toBe(200);
    return res.headers.get('set-cookie')!.split(';')[0];
  }

  const call = (who: string | null, method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(who && { cookie: cookies[who] }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const fill = (path: string, invite = '00000000-0000-4000-8000-00000000beef') =>
    path.replace(':user', ids.alice).replace(':invite', invite);

  it('every admin route: 401 without a cookie, plain 403 for a signed-in user', async () => {
    for (const [method, path, body] of ADMIN_ROUTES) {
      expect([method, path, (await call(null, method, fill(path), body)).status]).toEqual([method, path, 401]);
      const res = await call('alice', method, fill(path), body);
      expect([method, path, res.status]).toEqual([method, path, 403]);
      expect(await res.json()).toEqual({ statusCode: 403, message: 'admin only', error: 'Forbidden' });
    }
    expect(authRepos.userRows.get(ids.alice)!.disabledAtMs).toBeNull(); // the 403s changed nothing
  });

  it('the invite token is shown exactly once: in the POST url, never in the list', async () => {
    const res = await call('admin', 'POST', '/api/admin/invites', { email: 'bob@x.test' });
    expect(res.status).toBe(201);
    const created = CreateInviteResponseSchema.strict().parse(await res.json());
    const token = created.url.slice(`${BASE}/invite/`.length);
    expect(token.length).toBeGreaterThan(20);

    const listRes = await call('admin', 'GET', '/api/admin/invites');
    const raw = await listRes.text();
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(sha256Hex(token));
    const list = JSON.parse(raw) as unknown[];
    expect(list.map((i) => AdminInviteSchema.strict().parse(i))).toEqual([
      { id: created.id, email: 'bob@x.test', createdAt: expect.any(Number), expiresAt: created.expiresAt, usedAt: null, usedBy: null },
    ]);
  });

  it('disable signs the user out (their cookie gets 401) and blocks login; enable restores it', async () => {
    expect((await call('alice', 'GET', '/api/auth/me')).status).toBe(200);
    expect((await call('admin', 'POST', `/api/admin/users/${ids.alice}/disable`)).status).toBe(204);
    expect((await call('alice', 'GET', '/api/auth/me')).status).toBe(401);
    expect((await call('alice', 'GET', '/api/backtest/sessions')).status).toBe(401);

    const users = (await (await call('admin', 'GET', '/api/admin/users')).json()) as { id: string; disabledAt: number | null }[];
    expect(users.find((u) => u.id === ids.alice)!.disabledAt).toEqual(expect.any(Number));

    expect((await call('admin', 'POST', `/api/admin/users/${ids.alice}/enable`)).status).toBe(204);
    cookies.alice = await login('alice');
    expect((await call('alice', 'GET', '/api/auth/me')).status).toBe(200);
  });

  it('the admin cannot disable themselves (plain 409); unknown user 404', async () => {
    const res = await call('admin', 'POST', `/api/admin/users/${ids.admin}/disable`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ statusCode: 409 });
    expect((await call('admin', 'POST', '/api/admin/users/00000000-0000-4000-8000-00000000dead/disable')).status).toBe(404);
  });

  it('revoke: an unused invite 204, a used one 409 INVITE_USED', async () => {
    const fresh = (await (await call('admin', 'POST', '/api/admin/invites', {})).json()) as { id: string; url: string };
    expect((await call('admin', 'DELETE', `/api/admin/invites/${fresh.id}`)).status).toBe(204);
    expect((await call('admin', 'DELETE', `/api/admin/invites/${fresh.id}`)).status).toBe(404);

    const used = (await (await call('admin', 'POST', '/api/admin/invites', {})).json()) as { id: string; url: string };
    const token = used.url.split('/invite/')[1];
    const accept = await call(null, 'POST', `/api/auth/invites/${token}/accept`, { email: 'carol@x.test', password: 'carol-password' });
    expect(accept.status).toBe(201);
    const revoke = await call('admin', 'DELETE', `/api/admin/invites/${used.id}`);
    expect(revoke.status).toBe(409);
    expect(await revoke.json()).toEqual({ error: { code: 'INVITE_USED', message: expect.any(String) } });
  });

  it('400 for a malformed invite body', async () => {
    expect((await call('admin', 'POST', '/api/admin/invites', { email: 'not-an-email' })).status).toBe(400);
  });

  describe('decision 30: the admin cannot see sessions or journals', () => {
    let aliceSession: { id: string; name: string };

    beforeEach(async () => {
      const s = await sessions.create(ids.alice, createBody({ name: 'alice-private-journal' }));
      aliceSession = { id: s.id, name: s.name };
      btRepos.closedOrders.set(s.id, []);
    });

    it('no admin response carries session, order or journal data', async () => {
      const invite = (await (await call('admin', 'POST', '/api/admin/invites', {})).json()) as { id: string };
      const bodies: string[] = [];
      for (const [method, path, body] of ADMIN_ROUTES) {
        const res = await call('admin', method, fill(path, invite.id), body);
        expect([method, path, res.status < 300]).toEqual([method, path, true]);
        bodies.push(await res.text());
      }
      const all = bodies.join('\n');
      expect(all).not.toContain(aliceSession.id);
      expect(all).not.toContain(aliceSession.name);
      for (const field of ['session', 'order', 'journal', 'balance', 'pnl', 'trades', 'stats', 'cursor', 'layout']) {
        expect([field, all.toLowerCase().includes(`"${field}`)]).toEqual([field, false]);
      }
      // and the two list shapes are exactly the contract's, nothing extra
      const users = (await (await call('admin', 'GET', '/api/admin/users')).json()) as unknown[];
      users.forEach((u) => AdminUserSchema.strict().parse(u));
      const invites = (await (await call('admin', 'GET', '/api/admin/invites')).json()) as unknown[];
      invites.forEach((i) => AdminInviteSchema.strict().parse(i));
    });

    it('an admin cookie on another user’s session is a 404 (tenancy is by user id, not role)', async () => {
      expect((await call('admin', 'GET', `/api/backtest/sessions/${aliceSession.id}`)).status).toBe(404);
      expect((await call('admin', 'PATCH', `/api/backtest/sessions/${aliceSession.id}`, { name: 'x' })).status).toBe(404);
      expect((await call('admin', 'DELETE', `/api/backtest/sessions/${aliceSession.id}`)).status).toBe(404);
      expect(await (await call('admin', 'GET', '/api/backtest/sessions')).json()).toEqual([]);
      // alice still has it, untouched
      expect((await call('alice', 'GET', `/api/backtest/sessions/${aliceSession.id}`)).status).toBe(200);
    });
  });
});

describe('/api/admin/* without a database', () => {
  it('503, like the auth routes', async () => {
    const { app, base } = await boot(
      makeAuthService(null),
      new AdminService(null, fakeConfig({ APP_BASE_URL: BASE }), () => 0),
      makeSessionService(null),
    );
    try {
      for (const [method, path, body] of ADMIN_ROUTES) {
        const res = await fetch(`${base}${path.replace(':user', '00000000-0000-4000-8000-000000000001').replace(':invite', '00000000-0000-4000-8000-000000000002')}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        expect([method, path, res.status]).toEqual([method, path, 503]);
      }
    } finally {
      await app.close();
    }
  });
});
