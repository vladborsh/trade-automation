import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { User } from '@trade-automation/contracts';
import { AuthGuard } from '../../src/auth/auth.guard';
import { AuthService } from '../../src/auth/auth.service';
import { CurrentUser } from '../../src/auth/current-user.decorator';
import { Public } from '../../src/auth/public.decorator';
import { AuthController } from '../../src/api/rest/auth.controller';
import { FakeAuthRepositories, FakeClock, fastHasher, makeAuthService } from './fake-auth';

@Controller('api/probe')
class ProbeController {
  @Get('protected')
  protectedRoute(@CurrentUser() user: User | undefined) {
    return { user: user ?? null };
  }

  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }
}

/** Boots a real Nest HTTP app with AuthGuard as the global APP_GUARD, as auth.module.ts does. */
async function boot(service: AuthService): Promise<{ app: INestApplication; url: string }> {
  @Module({
    controllers: [ProbeController, AuthController],
    providers: [{ provide: AuthService, useValue: service }, { provide: APP_GUARD, useClass: AuthGuard }],
  })
  class ProbeModule {}

  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0);
  return { app, url: await app.getUrl() };
}

function cookieFrom(res: Response): string | null {
  const header = res.headers.get('set-cookie');
  return header ? header.split(';')[0] : null;
}

describe('AuthGuard as APP_GUARD (backtest-app-system-design.md §7.1, D7)', () => {
  describe('with the DB module enabled', () => {
    let app: INestApplication;
    let url: string;
    let clock: FakeClock;

    beforeAll(async () => {
      const repos = new FakeAuthRepositories();
      repos.addUser('alice@x.test', await fastHasher().hash('alice-password'));
      clock = new FakeClock();
      ({ app, url } = await boot(makeAuthService(repos, clock)));
    });
    afterAll(() => app.close());

    const login = async () => {
      const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'alice@x.test', password: 'alice-password' }),
      });
      expect(res.status).toBe(200);
      return cookieFrom(res)!;
    };

    it('401 on a protected route without a cookie, or with a bogus one', async () => {
      expect((await fetch(`${url}/api/probe/protected`)).status).toBe(401);
      expect((await fetch(`${url}/api/probe/protected`, { headers: { cookie: 'bt_session=bogus' } })).status).toBe(401);
      expect((await fetch(`${url}/api/auth/me`)).status).toBe(401);
    });

    it('a @Public() route needs no cookie', async () => {
      const res = await fetch(`${url}/api/probe/public`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it('login -> protected route sees @CurrentUser() -> logout -> 401', async () => {
      const cookie = await login();
      const res = await fetch(`${url}/api/probe/protected`, { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: expect.objectContaining({ email: 'alice@x.test' }) });
      expect(res.headers.get('set-cookie')).toBeNull(); // fresh session: no refresh

      const me = await fetch(`${url}/api/auth/me`, { headers: { cookie } });
      expect(await me.json()).toEqual({ user: expect.objectContaining({ email: 'alice@x.test', role: 'user' }) });

      const out = await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { cookie } });
      expect(out.status).toBe(204);
      expect(out.headers.get('set-cookie')).toMatch(/^bt_session=; Max-Age=0/);
      expect((await fetch(`${url}/api/probe/protected`, { headers: { cookie } })).status).toBe(401);
    });

    it('re-sends the cookie with a slid expiry when more than an hour has passed', async () => {
      const cookie = await login();
      clock.advance(61 * 60 * 1000);
      const res = await fetch(`${url}/api/probe/protected`, { headers: { cookie } });
      expect(res.status).toBe(200);
      const refreshed = res.headers.get('set-cookie')!;
      expect(refreshed.split(';')[0]).toBe(cookie); // same token, new expiry
      expect(refreshed).toContain(`Expires=${new Date(clock.ms + 30 * 24 * 3600 * 1000).toUTCString()}`);
    });
  });

  describe('without a database (documented dev/mock behaviour)', () => {
    let app: INestApplication;
    let url: string;

    beforeAll(async () => ({ app, url } = await boot(makeAuthService(null))));
    afterAll(() => app.close());

    it('the guard is a pass-through and the auth routes answer 503', async () => {
      const res = await fetch(`${url}/api/probe/protected`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: null });
      expect((await fetch(`${url}/api/auth/me`)).status).toBe(503);
      expect((await fetch(`${url}/api/auth/logout`, { method: 'POST' })).status).toBe(503);
      expect((await fetch(`${url}/api/auth/invites/x`)).status).toBe(503);
      const login = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@x.test', password: 'whatever' }),
      });
      expect(login.status).toBe(503);
    });
  });
});
