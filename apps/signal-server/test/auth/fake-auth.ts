import { randomUUID } from 'crypto';
import { UserRole } from '@trade-automation/contracts';
import { AuthRepositories } from '../../src/auth/auth-repositories.port';
import { AuthSessionRepository, AuthSessionWithUser } from '../../src/auth/auth-session.repository.port';
import { AuthService } from '../../src/auth/auth.service';
import { InviteRecord, InviteRepository } from '../../src/auth/invite.repository.port';
import { LoginThrottle } from '../../src/auth/login-throttle';
import { PasswordHasher } from '../../src/auth/password';
import { sha256Hex } from '../../src/auth/session-cookie';
import { EmailTakenError, UserRecord, UserRepository } from '../../src/auth/user.repository.port';

/** In-memory `AuthRepositories` for unit specs. `transaction` does not roll back — the real
 * transactional behaviour is covered by auth.integration.spec.ts against Postgres. */
export class FakeAuthRepositories implements AuthRepositories {
  readonly userRows = new Map<string, UserRecord>();
  readonly inviteRows = new Map<string, InviteRecord & { tokenHash: string }>();
  readonly sessionRows = new Map<string, { userId: string; expiresAtMs: number; lastSeenAtMs: number }>();

  readonly users: UserRepository = {
    findByEmail: async (email) => [...this.userRows.values()].find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null,
    findById: async (id) => this.userRows.get(id) ?? null,
    insert: async ({ email, passwordHash, role }) => {
      if (await this.users.findByEmail(email)) throw new EmailTakenError(email);
      return this.addUser(email, passwordHash, role);
    },
    upsertAdmin: async (email, passwordHash) => {
      const existing = await this.users.findByEmail(email);
      if (!existing) return this.addUser(email, passwordHash, 'admin');
      Object.assign(existing, { passwordHash, role: 'admin', disabledAtMs: null });
      return existing;
    },
    listAll: async () => [...this.userRows.values()].sort((a, b) => a.createdAtMs - b.createdAtMs),
    setDisabledAt: async (id, disabledAtMs) => {
      const user = this.userRows.get(id);
      if (!user) return null;
      user.disabledAtMs = disabledAtMs;
      return user;
    },
  };

  readonly invites: InviteRepository = {
    findByTokenHash: async (h) => [...this.inviteRows.values()].find((i) => i.tokenHash === h) ?? null,
    claim: async (h, nowMs) => {
      const invite = await this.invites.findByTokenHash(h);
      if (!invite || invite.usedAtMs !== null || invite.expiresAtMs <= nowMs) return null;
      invite.usedAtMs = nowMs;
      return invite.id;
    },
    setUsedBy: async (id, userId) => {
      this.inviteRows.get(id)!.usedBy = userId;
    },
    create: async ({ tokenHash, email, createdBy, nowMs, expiresAtMs }) => {
      const invite = { id: randomUUID(), tokenHash, email, createdBy, createdAtMs: nowMs, expiresAtMs, usedAtMs: null, usedBy: null };
      this.inviteRows.set(invite.id, invite);
      const { tokenHash: _hash, ...record } = invite;
      return record;
    },
    listAll: async () =>
      [...this.inviteRows.values()].sort((a, b) => b.createdAtMs - a.createdAtMs).map(({ tokenHash: _hash, ...record }) => record),
    deleteUnused: async (id) => {
      const invite = this.inviteRows.get(id);
      if (!invite) return 'missing';
      if (invite.usedAtMs !== null) return 'used';
      this.inviteRows.delete(id);
      return 'deleted';
    },
  };

  readonly sessions: AuthSessionRepository = {
    insert: async ({ id, userId, expiresAtMs, nowMs }) => {
      this.sessionRows.set(id, { userId, expiresAtMs, lastSeenAtMs: nowMs });
    },
    findWithUser: async (id): Promise<AuthSessionWithUser | null> => {
      const row = this.sessionRows.get(id);
      return row ? { id, expiresAtMs: row.expiresAtMs, lastSeenAtMs: row.lastSeenAtMs, user: this.userRows.get(row.userId)! } : null;
    },
    touch: async (id, nowMs, expiresAtMs) => {
      Object.assign(this.sessionRows.get(id)!, { lastSeenAtMs: nowMs, expiresAtMs });
    },
    delete: async (id) => {
      this.sessionRows.delete(id);
    },
    deleteAllForUser: async (userId) => {
      for (const [id, row] of this.sessionRows) if (row.userId === userId) this.sessionRows.delete(id);
    },
    deleteExpiredForUser: async (userId, nowMs) => {
      for (const [id, row] of this.sessionRows) if (row.userId === userId && row.expiresAtMs <= nowMs) this.sessionRows.delete(id);
    },
  };

  transaction<T>(fn: (repos: Omit<AuthRepositories, 'transaction'>) => Promise<T>): Promise<T> {
    return fn(this);
  }

  private userSeq = 0;

  addUser(email: string, passwordHash: string, role: UserRole = 'user'): UserRecord {
    const user: UserRecord = { id: randomUUID(), email, passwordHash, role, disabledAtMs: null, createdAtMs: this.userSeq++ };
    this.userRows.set(user.id, user);
    return user;
  }

  addInvite(token: string, fields: { expiresAtMs: number; email?: string | null; usedAtMs?: number | null }): InviteRecord {
    const invite = {
      id: randomUUID(),
      tokenHash: sha256Hex(token),
      email: fields.email ?? null,
      createdBy: randomUUID(),
      createdAtMs: 0,
      expiresAtMs: fields.expiresAtMs,
      usedAtMs: fields.usedAtMs ?? null,
      usedBy: null,
    };
    this.inviteRows.set(invite.id, invite);
    return invite;
  }
}

/** Cheap scrypt parameters so unit specs stay fast; production parameters are covered in password.spec.ts. */
export const fastHasher = () => new PasswordHasher({ N: 2 ** 10, r: 8, p: 1 });

export function fakeConfig(env: Record<string, unknown> = {}) {
  return { env: { get: (key: string) => env[key] } } as never;
}

export class FakeClock {
  constructor(public ms = Date.UTC(2026, 8, 21, 12)) {}
  readonly now = () => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
}

export function makeAuthService(repos: FakeAuthRepositories | null, clock = new FakeClock(), env: Record<string, unknown> = {}) {
  return new AuthService(repos, fastHasher(), new LoginThrottle(), fakeConfig(env), clock.now);
}
