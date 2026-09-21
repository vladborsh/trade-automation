import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminBootstrap } from '../../src/auth/admin-bootstrap.service';
import { AdminService } from '../../src/auth/admin.service';
import { AuthService, INVITE_TTL_MS } from '../../src/auth/auth.service';
import { LoginThrottle } from '../../src/auth/login-throttle';
import { PgAuthRepositories } from '../../src/auth/pg/pg-auth-repositories';
import { SESSION_TTL_MS, sha256Hex } from '../../src/auth/session-cookie';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { FakeClock, fakeConfig, fastHasher } from './fake-auth';

/**
 * T-007 done-when, against a real Postgres: invite accept succeeds exactly once under concurrent
 * calls (the conditional UPDATE), expiry, and the sliding session refresh as stored. Skipped
 * (loudly) when DATABASE_URL is unset, like T-004's integration specs. Use your own slot's DB:
 *   DATABASE_URL=postgres://backtest@localhost:5432/backtest_dev3 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('auth.integration.spec.ts: DATABASE_URL not set — skipping real-Postgres auth tests.');
}

const maybeDescribe = DATABASE_URL ? describe : describe.skip;

maybeDescribe('auth against a real Postgres (T-007 done-when)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (name: string) => `${name}-${run}@auth-it.test`;
  let db: PgDatabase;
  let repos: PgAuthRepositories;
  let clock: FakeClock;
  let service: AuthService;
  let adminId: string;

  beforeAll(async () => {
    await runMigrations({ connectionString: DATABASE_URL as string });
    db = new PgDatabase(DATABASE_URL as string);
    repos = new PgAuthRepositories(db);
    adminId = (await repos.users.insert({ email: email('inviter'), passwordHash: 'x', role: 'admin' })).id;
  });

  beforeEach(() => {
    clock = new FakeClock(Date.now());
    service = new AuthService(repos, fastHasher(), new LoginThrottle(), fakeConfig(), clock.now);
  });

  afterAll(async () => {
    // invites cascade from their creator
    await db.query(`delete from users where email like $1`, [`%-${run}@auth-it.test`]);
    await db.end();
  });

  async function createInvite(expiresAtMs: number): Promise<string> {
    const token = `inv-${randomUUID()}`;
    await db.query(
      `insert into invites (token_hash, created_by, expires_at) values ($1, $2, to_timestamp($3::double precision / 1000))`,
      [sha256Hex(token), adminId, expiresAtMs],
    );
    return token;
  }

  const codeOf = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected' ? ((r.reason as HttpException).getResponse() as { error: { code: string } }).error.code : 'ok';

  it.each([
    ['different emails', (i: number) => email(`racer${i}`)],
    ['the same email', () => email('same-racer')],
  ])('invite accept succeeds exactly once under 8 concurrent calls with %s', async (_label, emailFor) => {
    const token = await createInvite(clock.ms + INVITE_TTL_MS);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => service.acceptInvite(token, emailFor(i), 'racer-password', null)),
    );

    const codes = results.map(codeOf);
    expect(codes.filter((c) => c === 'ok')).toHaveLength(1);
    expect(codes.filter((c) => c !== 'ok')).toEqual(Array(7).fill('INVITE_USED'));

    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ user: { id: string; email: string } }>).value;
    const [invite] = await db.query<{ used_by: string; used_at: Date }>(`select used_by, used_at from invites where token_hash = $1`, [sha256Hex(token)]);
    expect(invite.used_by).toBe(winner.user.id);
    // the losers' user rows were rolled back with their transactions
    const racers = await db.query(`select id from users where email = any($1::citext[])`, [Array.from({ length: 8 }, (_, i) => emailFor(i))]);
    expect(racers).toHaveLength(1);
  });

  it('an expired invite cannot be read or accepted', async () => {
    const token = await createInvite(clock.ms - 1000);
    await expect(service.inviteInfo(token)).rejects.toMatchObject({ response: { error: { code: 'INVITE_EXPIRED' } } });
    await expect(service.acceptInvite(token, email('late'), 'late-password', null)).rejects.toMatchObject({
      response: { error: { code: 'INVITE_EXPIRED' } },
    });
    expect(await repos.users.findByEmail(email('late'))).toBeNull();
  });

  it('login stores sha256(token), and the sliding refresh moves expires_at/last_seen_at in the row', async () => {
    await repos.users.insert({ email: email('slider'), passwordHash: await fastHasher().hash('slider-password'), role: 'user' });
    const { token } = await service.login(email('slider'), 'slider-password', 'jest-agent');
    const id = sha256Hex(token);
    const [before] = await db.query<{ expires_at: Date; user_agent: string }>(`select expires_at, user_agent from auth_sessions where id = $1`, [id]);
    expect(before.expires_at.getTime()).toBe(clock.ms + SESSION_TTL_MS);
    expect(before.user_agent).toBe('jest-agent');

    clock.advance(2 * 3600 * 1000);
    const result = await service.authenticate(token);
    expect(result!.refreshedExpiresAtMs).toBe(clock.ms + SESSION_TTL_MS);
    const [after] = await db.query<{ expires_at: Date; last_seen_at: Date }>(`select expires_at, last_seen_at from auth_sessions where id = $1`, [id]);
    expect(after.expires_at.getTime()).toBe(clock.ms + SESSION_TTL_MS);
    expect(after.last_seen_at.getTime()).toBe(clock.ms);

    clock.advance(SESSION_TTL_MS);
    await expect(service.authenticate(token)).resolves.toBeNull();
    expect(await db.query(`select id from auth_sessions where id = $1`, [id])).toHaveLength(0);
  });

  describe('admin (T-008) against Postgres', () => {
    let admin: AdminService;
    beforeEach(() => {
      admin = new AdminService(repos, fakeConfig({ APP_BASE_URL: 'http://localhost:3030' }), clock.now);
    });

    it('invite create stores only sha256(token); list never returns it; revoke deletes unused, 409s used', async () => {
      const created = await admin.createInvite(adminId, email('invitee'));
      const token = created.url.split('/invite/')[1];
      const [row] = await db.query<{ token_hash: string; email: string; created_by: string; expires_at: Date }>(
        `select token_hash, email, created_by, expires_at from invites where id = $1`,
        [created.id],
      );
      expect(row).toEqual({ token_hash: sha256Hex(token), email: email('invitee'), created_by: adminId, expires_at: new Date(created.expiresAt) });
      expect(created.expiresAt).toBe(clock.ms + INVITE_TTL_MS);
      const stored = await db.query<{ n: number }>(`select count(*)::int as n from invites where token_hash = $1 or email = $1`, [token]);
      expect(stored[0].n).toBe(0); // the raw token is nowhere in the table

      const listed = (await admin.listInvites()).find((i) => i.id === created.id)!;
      expect(listed).toEqual({ id: created.id, email: email('invitee'), createdAt: clock.ms, expiresAt: created.expiresAt, usedAt: null, usedBy: null });

      // accept it, then revoke is 409 INVITE_USED and the row stays
      const accepted = await service.acceptInvite(token, email('invitee'), 'invitee-password', null);
      await expect(admin.revokeInvite(created.id)).rejects.toMatchObject({ status: 409, response: { error: { code: 'INVITE_USED' } } });
      expect((await admin.listInvites()).find((i) => i.id === created.id)).toMatchObject({ usedBy: accepted.user.id });

      // an unused one, even expired, is deleted
      const expired = await createInvite(clock.ms - 1000);
      const expiredId = (await repos.invites.findByTokenHash(sha256Hex(expired)))!.id;
      await admin.revokeInvite(expiredId);
      expect(await repos.invites.findByTokenHash(sha256Hex(expired))).toBeNull();
      await expect(admin.revokeInvite(expiredId)).rejects.toMatchObject({ status: 404 });
    });

    it('disable sets disabled_at and deletes every auth_sessions row of the user; enable clears it', async () => {
      await repos.users.insert({ email: email('victim'), passwordHash: await fastHasher().hash('victim-password'), role: 'user' });
      const victim = (await repos.users.findByEmail(email('victim')))!;
      await service.login(email('victim'), 'victim-password', 'one');
      await service.login(email('victim'), 'victim-password', 'two');
      const count = async () => (await db.query<{ n: number }>(`select count(*)::int as n from auth_sessions where user_id = $1`, [victim.id]))[0].n;
      expect(await count()).toBe(2);

      await admin.disableUser(adminId, victim.id);
      expect(await count()).toBe(0);
      expect((await repos.users.findById(victim.id))!.disabledAtMs).toBe(clock.ms);
      expect((await admin.listUsers()).find((u) => u.id === victim.id)).toEqual({
        id: victim.id,
        email: email('victim'),
        role: 'user',
        createdAt: victim.createdAtMs,
        disabledAt: clock.ms,
      });

      await admin.enableUser(victim.id);
      expect((await repos.users.findById(victim.id))!.disabledAtMs).toBeNull();
      await expect(admin.disableUser(adminId, randomUUID())).rejects.toMatchObject({ status: 404 });
    });
  });

  it('AdminBootstrap upserts the admin from env: creates, then resets password/role/disabled on re-boot', async () => {
    const adminEmail = email('boot-admin');
    const boot = (password: string) =>
      new AdminBootstrap(repos, fastHasher(), fakeConfig({ ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD: password })).onApplicationBootstrap();

    await boot('first-admin-password');
    await expect(service.login(adminEmail, 'first-admin-password', null)).resolves.toMatchObject({ user: { role: 'admin' } });

    await db.query(`update users set role = 'user', disabled_at = now() where email = $1`, [adminEmail]);
    await boot('second-admin-password');
    const admin = await repos.users.findByEmail(adminEmail);
    expect(admin).toMatchObject({ role: 'admin', disabledAtMs: null });
    await expect(service.login(adminEmail, 'second-admin-password', null)).resolves.toBeDefined();
    await expect(boot('short')).rejects.toThrow(/at least 10 characters/);
  });
});
