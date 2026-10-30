import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { WebPushVapidKeyResponseSchema, type WebPushSubscription } from '@trade-automation/contracts';
import { AppConfigService } from '../../src/config/config.service';
import { DB } from '../../src/db/db.port';
import type { PushTarget, WebPushStore } from '../../src/delivery/pg/web-push.repo';
import type { User } from '../../src/users/user.model';
import { SESSION_COOKIE_NAME } from '../../src/web/auth/session-cookie';
import { WebAuthGuard } from '../../src/web/auth/web-auth.guard';
import { WebAuthService } from '../../src/web/auth/web-auth.service';
import { WEB_PUSH_SUBSCRIPTIONS, WebPushController } from '../../src/web/push/push.controller';

/**
 * IB-069 — `/api/web/push/*` over real HTTP with the real `WebAuthGuard` registered the way
 * `WebModule` registers it (APP_GUARD): without a session every route is 401 and the store is never
 * touched; with one, the subscription is saved under that session's member.
 */
const member: User = {
  id: 7, tgUserId: 777, chatId: 777, role: 'member', lang: 'ru', deposit: null, riskPct: 1,
  dailyLossLimitPct: null, dexAlerts: false, calendarAlerts: true, invitedBy: 1, disabled: false, createdAt: new Date(),
};
const SUB: WebPushSubscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPk', auth: 'q1w' } };
const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

class MemoryStore implements WebPushStore {
  rows: Array<{ userId: number; s: WebPushSubscription }> = [];
  async save(userId: number, s: WebPushSubscription) {
    this.rows = [...this.rows.filter((r) => r.s.endpoint !== s.endpoint), { userId, s }];
  }
  async remove(userId: number, endpoint: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.s.endpoint === endpoint));
    return this.rows.length < before;
  }
  async targets(): Promise<PushTarget[]> { return []; }
  async drop() {}
  async sentKeys() { return new Map(); }
  async claim() { return true; }
}

async function start(env: Record<string, unknown>) {
  const store = new MemoryStore();
  const auth = {
    resolveSession: async (token: string) => (token === 'good' ? { user: member } : null),
    cookieSecure: false,
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [WebPushController],
    providers: [
      { provide: AppConfigService, useValue: { env: { get: (k: string) => env[k] } } },
      { provide: DB, useValue: null },
      { provide: WEB_PUSH_SUBSCRIPTIONS, useValue: store },
      { provide: WebAuthService, useValue: auth },
      { provide: APP_GUARD, useClass: WebAuthGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  return { app, store };
}

const ENV = { WEB_PUSH_VAPID_PUBLIC: KEY, WEB_PUSH_VAPID_PRIVATE: 'priv', WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.com' };

function client(app: INestApplication) {
  const port = (app.getHttpServer().address() as { port: number }).port;
  return (method: string, path: string, opts: { session?: string; body?: unknown } = {}) =>
    fetch(`http://127.0.0.1:${port}/api/web/push${path}`, {
      method,
      headers: {
        ...(opts.session ? { cookie: `${SESSION_COOKIE_NAME}=${opts.session}` } : {}),
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
}

describe('WebPushController (IB-069)', () => {
  let app: INestApplication;
  let store: MemoryStore;
  let call: ReturnType<typeof client>;

  beforeAll(async () => {
    ({ app, store } = await start(ENV));
    call = client(app);
  });
  afterAll(async () => app.close());
  beforeEach(() => { store.rows = []; });

  describe('without a session', () => {
    it.each([
      ['GET', '/vapid-key', undefined],
      ['POST', '/subscription', SUB],
      ['DELETE', '/subscription', { endpoint: SUB.endpoint }],
    ])('%s %s is 401 and touches nothing', async (method, path, body) => {
      for (const session of [undefined, 'forged']) {
        const res = await call(method, path, { session, body });
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
      }
      expect(store.rows).toEqual([]);
    });
  });

  describe('with a session', () => {
    it('GET /vapid-key answers the public key, never the private one', async () => {
      const res = await call('GET', '/vapid-key', { session: 'good' });
      const body = await res.json();
      expect(WebPushVapidKeyResponseSchema.parse(body)).toEqual({ publicKey: KEY });
      expect(JSON.stringify(body)).not.toContain('priv');
    });

    it('POST saves the subscription under the session\'s member; again from the same browser replaces it', async () => {
      expect((await call('POST', '/subscription', { session: 'good', body: SUB })).status).toBe(204);
      const rotated = { ...SUB, keys: { p256dh: 'BNew', auth: 'new' } };
      expect((await call('POST', '/subscription', { session: 'good', body: rotated })).status).toBe(204);
      expect(store.rows).toEqual([{ userId: 7, s: rotated }]);
    });

    it('POST refuses a body that is not a subscription', async () => {
      for (const body of [{}, { endpoint: 'not a url', keys: SUB.keys }, { endpoint: SUB.endpoint }]) {
        const res = await call('POST', '/subscription', { session: 'good', body });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'BAD_SUBSCRIPTION' });
      }
      expect(store.rows).toEqual([]);
    });

    it('DELETE removes it, and is still 204 when the server had already forgotten it', async () => {
      await call('POST', '/subscription', { session: 'good', body: SUB });
      expect((await call('DELETE', '/subscription', { session: 'good', body: { endpoint: SUB.endpoint } })).status).toBe(204);
      expect(store.rows).toEqual([]);
      expect((await call('DELETE', '/subscription', { session: 'good', body: { endpoint: SUB.endpoint } })).status).toBe(204);
    });
  });
});

describe('WebPushController with push off (no VAPID keys)', () => {
  let app: INestApplication;
  let store: MemoryStore;
  beforeAll(async () => ({ app, store } = await start({})));
  afterAll(async () => app.close());

  it('says so with a null key, refuses to subscribe, and still lets a member unsubscribe', async () => {
    const call = client(app);
    expect(await (await call('GET', '/vapid-key', { session: 'good' })).json()).toEqual({ publicKey: null });
    const res = await call('POST', '/subscription', { session: 'good', body: SUB });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'PUSH_DISABLED' });
    expect(store.rows).toEqual([]);
    expect((await call('DELETE', '/subscription', { session: 'good', body: { endpoint: SUB.endpoint } })).status).toBe(204);
  });
});
