import { ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AdminInviteSchema, AdminUserSchema } from '@trade-automation/contracts';
import { AdminService, inviteUrl } from '../../src/auth/admin.service';
import { INVITE_TTL_MS } from '../../src/auth/auth.service';
import { SESSION_TTL_MS, sha256Hex } from '../../src/auth/session-cookie';
import { FakeAuthRepositories, FakeClock, fakeConfig, fastHasher, makeAuthService } from './fake-auth';

const BASE = 'https://bt.example.test';

describe('AdminService (backtest-app-system-design.md §7.1, decision 30)', () => {
  let repos: FakeAuthRepositories;
  let clock: FakeClock;
  let admin: AdminService;
  let adminId: string;
  let aliceId: string;

  beforeEach(async () => {
    repos = new FakeAuthRepositories();
    clock = new FakeClock();
    admin = new AdminService(repos, fakeConfig({ APP_BASE_URL: BASE }), clock.now);
    adminId = repos.addUser('admin@x.test', 'x', 'admin').id;
    aliceId = repos.addUser('alice@x.test', await fastHasher().hash('alice-password')).id;
  });

  it('lists users with exactly id, email, role, createdAt, disabledAt', async () => {
    const users = await admin.listUsers();
    expect(users.map((u) => u.email)).toEqual(['admin@x.test', 'alice@x.test']);
    for (const u of users) {
      expect(AdminUserSchema.strict().parse(u)).toEqual(u);
      expect(Object.keys(u).sort()).toEqual(['createdAt', 'disabledAt', 'email', 'id', 'role']);
    }
  });

  describe('disable / enable', () => {
    it('disable sets disabled_at and signs the user out everywhere; enable clears it', async () => {
      const auth = makeAuthService(repos, clock);
      const s1 = await auth.login('alice@x.test', 'alice-password', 'a');
      const s2 = await auth.login('alice@x.test', 'alice-password', 'b');

      await admin.disableUser(adminId, aliceId);
      expect(repos.userRows.get(aliceId)!.disabledAtMs).toBe(clock.ms);
      expect([...repos.sessionRows.values()].filter((r) => r.userId === aliceId)).toHaveLength(0);
      await expect(auth.authenticate(s1.token)).resolves.toBeNull();
      await expect(auth.authenticate(s2.token)).resolves.toBeNull();
      await expect(auth.login('alice@x.test', 'alice-password', null)).rejects.toMatchObject({ status: 403 });

      await admin.enableUser(aliceId);
      expect(repos.userRows.get(aliceId)!.disabledAtMs).toBeNull();
      await expect(auth.login('alice@x.test', 'alice-password', null)).resolves.toMatchObject({ expiresAtMs: clock.ms + SESSION_TTL_MS });
    });

    it('an admin cannot disable themselves (plain 409)', async () => {
      await expect(admin.disableUser(adminId, adminId)).rejects.toBeInstanceOf(ConflictException);
      expect(repos.userRows.get(adminId)!.disabledAtMs).toBeNull();
    });

    it('404 for an unknown or non-uuid user', async () => {
      await expect(admin.disableUser(adminId, '00000000-0000-4000-8000-00000000dead')).rejects.toBeInstanceOf(NotFoundException);
      await expect(admin.enableUser('not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('invites', () => {
    it('creates a 7-day invite; the token is only in the url and only its sha256 is stored', async () => {
      const created = await admin.createInvite(adminId, 'bob@x.test');
      expect(created.expiresAt).toBe(clock.ms + INVITE_TTL_MS);
      const token = created.url.slice(`${BASE}/invite/`.length);
      expect(created.url).toBe(`${BASE}/invite/${token}`);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const stored = repos.inviteRows.get(created.id)!;
      expect(stored).toMatchObject({ tokenHash: sha256Hex(token), email: 'bob@x.test', createdBy: adminId });
      expect(JSON.stringify(stored)).not.toContain(token);

      // the url's token is a working invite
      const auth = makeAuthService(repos, clock);
      await expect(auth.inviteInfo(token)).resolves.toEqual({ email: 'bob@x.test', expiresAt: created.expiresAt });
    });

    it('lists invites without the token or its hash', async () => {
      const created = await admin.createInvite(adminId, null);
      const token = created.url.split('/invite/')[1];
      const list = await admin.listInvites();
      expect(list).toHaveLength(1);
      expect(AdminInviteSchema.strict().parse(list[0])).toEqual(list[0]);
      expect(JSON.stringify(list)).not.toContain(token);
      expect(JSON.stringify(list)).not.toContain(sha256Hex(token));
    });

    it('revokes an unused invite, expired or not; a used one is 409 INVITE_USED; unknown is 404', async () => {
      const fresh = await admin.createInvite(adminId, null);
      await admin.revokeInvite(fresh.id);
      expect(repos.inviteRows.has(fresh.id)).toBe(false);

      const expired = await admin.createInvite(adminId, null);
      clock.advance(INVITE_TTL_MS + 1);
      await admin.revokeInvite(expired.id);
      expect(repos.inviteRows.has(expired.id)).toBe(false);

      const used = await admin.createInvite(adminId, null);
      await makeAuthService(repos, clock).acceptInvite(used.url.split('/invite/')[1], 'carol@x.test', 'carol-password', null);
      const err = (await admin.revokeInvite(used.id).catch((e) => e)) as HttpException;
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toEqual({ error: { code: 'INVITE_USED', message: expect.any(String) } });
      expect(repos.inviteRows.has(used.id)).toBe(true);

      await expect(admin.revokeInvite('00000000-0000-4000-8000-00000000dead')).rejects.toBeInstanceOf(NotFoundException);
      await expect(admin.revokeInvite('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('inviteUrl tolerates a trailing slash on APP_BASE_URL', () => {
    expect(inviteUrl('http://h:3000/', 'tok')).toBe('http://h:3000/invite/tok');
    expect(inviteUrl('http://h:3000', 'tok')).toBe('http://h:3000/invite/tok');
  });

  it('503 for everything without a database', async () => {
    const off = new AdminService(null, fakeConfig({ APP_BASE_URL: BASE }), clock.now);
    for (const p of [off.listUsers(), off.disableUser(adminId, aliceId), off.enableUser(aliceId), off.createInvite(adminId, null), off.listInvites(), off.revokeInvite(aliceId)]) {
      await expect(p).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
  });
});
