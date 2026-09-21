import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AcceptInviteResponse,
  AdminInvitesResponse,
  AdminUsersResponse,
  BacktestErrorCode,
  CreateInviteResponse,
  InviteInfo,
  LoginResponse,
  MeResponse,
  User,
  UserRole,
} from '@trade-automation/contracts';

/**
 * architecture/backtest-app-system-design.md §7.1 — an in-memory stand-in for the auth/admin
 * surface of the real server, so the client runs against the mock without a database. Paths,
 * status codes and error codes match §7.1; the client must work unchanged against either.
 *
 * Fixed accounts (every instance, every boot):
 *   admin@example.com    / admin-password     (role admin)
 *   disabled@example.com / disabled-password  (disabled → 403 USER_DISABLED)
 * Seeded invite tokens: `mock-invite-used` (410 INVITE_USED), `mock-invite-expired`
 * (410 INVITE_EXPIRED). Any other unknown token is 404 INVITE_UNKNOWN; create a fresh one with
 * `POST /api/admin/invites` as the admin.
 *
 * Session tokens are `mock.<userId>.<random>`, validated by user id, not by a per-instance
 * table: cookies are not port-scoped, so a login on :4300 must also be honoured by the :4301
 * and :4302 e2e instances. Logout revokes the token on the instance that received it.
 */

export const MOCK_ADMIN = { email: 'admin@example.com', password: 'admin-password' } as const;

const COOKIE = 'bt_session';
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const THROTTLE_WINDOW_MS = 15 * 60_000;
const THROTTLE_MAX_FAILURES = 10;
const MIN_PASSWORD_LENGTH = 10;

interface MockUser extends User {
  password: string;
  createdAt: number;
  disabledAt: number | null;
}

interface MockInvite {
  id: string;
  token: string;
  email: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
}

/** Routes reachable without a session (§7.1 "public", plus the infrastructure health probe). */
export function isPublicPath(method: string, pathname: string): boolean {
  if (pathname === '/api/health') return true;
  if (method === 'POST' && pathname === '/api/auth/login') return true;
  return /^\/api\/auth\/invites\/[^/]+(\/accept)?$/.test(pathname);
}

export class MockAuthState {
  private readonly users = new Map<string, MockUser>();
  private readonly invites = new Map<string, MockInvite>(); // by token
  private readonly revoked = new Set<string>();
  private readonly failures = new Map<string, number[]>(); // email -> failure timestamps

  constructor(private readonly appBaseUrl: string) {
    const now = Date.now();
    // Fixed ids so a session minted by one mock instance resolves on the others.
    this.addUser({ id: '00000000-0000-4000-8000-000000000001', email: MOCK_ADMIN.email, role: 'admin', password: MOCK_ADMIN.password, createdAt: now, disabledAt: null });
    this.addUser({ id: '00000000-0000-4000-8000-000000000002', email: 'disabled@example.com', role: 'user', password: 'disabled-password', createdAt: now, disabledAt: now });
    this.invites.set('mock-invite-used', { id: randomUUID(), token: 'mock-invite-used', email: null, createdAt: now - 60_000, expiresAt: now + INVITE_TTL_MS, usedAt: now - 30_000, usedBy: '00000000-0000-4000-8000-000000000002' });
    this.invites.set('mock-invite-expired', { id: randomUUID(), token: 'mock-invite-expired', email: 'late@example.com', createdAt: now - INVITE_TTL_MS - 60_000, expiresAt: now - 60_000, usedAt: null, usedBy: null });
  }

  private addUser(user: MockUser): void {
    this.users.set(user.id, user);
  }

  private findByEmail(email: string): MockUser | undefined {
    const wanted = email.toLowerCase();
    return [...this.users.values()].find((u) => u.email.toLowerCase() === wanted);
  }

  /** The signed-in user for this request, or null. */
  currentUser(req: IncomingMessage): MockUser | null {
    const token = readCookie(req, COOKIE);
    if (!token || this.revoked.has(token)) return null;
    const [prefix, userId] = token.split('.');
    if (prefix !== 'mock') return null;
    const user = this.users.get(userId ?? '');
    return user && user.disabledAt === null ? user : null;
  }

  /**
   * Handles every `/api/auth/*` and `/api/admin/*` route. Returns false when the path is not
   * an auth/admin route, so the caller falls through to the market-data routes.
   */
  async handle(req: IncomingMessage, res: ServerResponse, pathname: string, send: SendJson): Promise<boolean> {
    const method = req.method ?? 'GET';

    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJsonBody(req);
      const email = typeof body?.['email'] === 'string' ? body['email'] : '';
      const password = typeof body?.['password'] === 'string' ? body['password'] : '';
      if (!email || !password) { badRequest(send, res); return true; }
      if (this.throttled(email)) {
        fail(send, res, 429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts; try again later');
        return true;
      }
      const user = this.findByEmail(email);
      if (!user || user.password !== password) {
        this.recordFailure(email);
        fail(send, res, 401, 'INVALID_CREDENTIALS', 'Wrong email or password');
        return true;
      }
      if (user.disabledAt !== null) { fail(send, res, 403, 'USER_DISABLED', 'This account is disabled'); return true; }
      this.failures.delete(email.toLowerCase());
      this.setSession(res, user);
      const response: LoginResponse = { user: publicUser(user) };
      send(res, 200, response);
      return true;
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      const user = this.currentUser(req);
      if (!user) { unauthenticated(send, res); return true; }
      const token = readCookie(req, COOKIE);
      if (token) this.revoked.add(token);
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      send(res, 204, null);
      return true;
    }

    if (method === 'GET' && pathname === '/api/auth/me') {
      const user = this.currentUser(req);
      if (!user) { unauthenticated(send, res); return true; }
      const response: MeResponse = { user: publicUser(user) };
      send(res, 200, response);
      return true;
    }

    const inviteMatch = /^\/api\/auth\/invites\/([^/]+)(\/accept)?$/.exec(pathname);
    if (inviteMatch) {
      const token = decodeURIComponent(inviteMatch[1]);
      const accepting = inviteMatch[2] !== undefined;
      if (accepting ? method !== 'POST' : method !== 'GET') return false;
      const invite = this.invites.get(token);
      if (!invite) { fail(send, res, 404, 'INVITE_UNKNOWN', 'This invite link is not valid'); return true; }
      if (invite.usedAt !== null) { fail(send, res, 410, 'INVITE_USED', 'This invite has already been used'); return true; }
      if (invite.expiresAt <= Date.now()) { fail(send, res, 410, 'INVITE_EXPIRED', 'This invite has expired'); return true; }
      if (!accepting) {
        const response: InviteInfo = { email: invite.email, expiresAt: invite.expiresAt };
        send(res, 200, response);
        return true;
      }
      const body = await readJsonBody(req);
      const email = typeof body?.['email'] === 'string' ? body['email'] : '';
      const password = typeof body?.['password'] === 'string' ? body['password'] : '';
      if (!email.includes('@') || password.length < MIN_PASSWORD_LENGTH) { badRequest(send, res); return true; }
      if (this.findByEmail(email)) { fail(send, res, 409, 'EMAIL_TAKEN', 'An account with this email already exists'); return true; }
      const user: MockUser = { id: randomUUID(), email, role: 'user', password, createdAt: Date.now(), disabledAt: null };
      this.addUser(user);
      invite.usedAt = Date.now();
      invite.usedBy = user.id;
      this.setSession(res, user);
      const response: AcceptInviteResponse = { user: publicUser(user) };
      send(res, 201, response);
      return true;
    }

    if (!pathname.startsWith('/api/admin/')) return false;
    const admin = this.currentUser(req);
    if (!admin) { unauthenticated(send, res); return true; }
    if (admin.role !== 'admin') { forbidden(send, res); return true; }

    if (method === 'GET' && pathname === '/api/admin/users') {
      const response: AdminUsersResponse = [...this.users.values()].map((u) => ({
        ...publicUser(u),
        createdAt: u.createdAt,
        disabledAt: u.disabledAt,
      }));
      send(res, 200, response);
      return true;
    }

    if (method === 'POST' && pathname === '/api/admin/invites') {
      const body = (await readJsonBody(req)) ?? {};
      const email = typeof body['email'] === 'string' ? body['email'] : null;
      const now = Date.now();
      const invite: MockInvite = { id: randomUUID(), token: randomBytes(24).toString('base64url'), email, createdAt: now, expiresAt: now + INVITE_TTL_MS, usedAt: null, usedBy: null };
      this.invites.set(invite.token, invite);
      const response: CreateInviteResponse = { id: invite.id, url: `${this.appBaseUrl}/invite/${invite.token}`, expiresAt: invite.expiresAt };
      send(res, 201, response);
      return true;
    }

    if (method === 'GET' && pathname === '/api/admin/invites') {
      const response: AdminInvitesResponse = [...this.invites.values()].map(({ token: _token, ...rest }) => rest);
      send(res, 200, response);
      return true;
    }

    return false;
  }

  private setSession(res: ServerResponse, user: MockUser): void {
    const token = `mock.${user.id}.${randomBytes(12).toString('base64url')}`;
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`);
  }

  private throttled(email: string): boolean {
    const cutoff = Date.now() - THROTTLE_WINDOW_MS;
    const recent = (this.failures.get(email.toLowerCase()) ?? []).filter((t) => t > cutoff);
    this.failures.set(email.toLowerCase(), recent);
    return recent.length >= THROTTLE_MAX_FAILURES;
  }

  private recordFailure(email: string): void {
    const key = email.toLowerCase();
    this.failures.set(key, [...(this.failures.get(key) ?? []), Date.now()]);
  }
}

export type SendJson = (res: ServerResponse, status: number, body: unknown) => void;

function publicUser(user: MockUser): User {
  const role: UserRole = user.role;
  return { id: user.id, email: user.email, role };
}

function fail(send: SendJson, res: ServerResponse, status: number, code: BacktestErrorCode, message: string): void {
  send(res, status, { error: { code, message } });
}

/**
 * The guard's plain 401 carries no contract error code (BacktestErrorCodeSchema has none for
 * "no session"); the client keys on the status alone.
 */
export function unauthenticated(send: SendJson, res: ServerResponse): void {
  send(res, 401, { statusCode: 401, message: 'Unauthorized' });
}

function forbidden(send: SendJson, res: ServerResponse): void {
  send(res, 403, { statusCode: 403, message: 'Forbidden' });
}

/** Mirrors the server's ZodValidationPipe: a 400 with no contract error code. */
function badRequest(send: SendJson, res: ServerResponse): void {
  send(res, 400, { statusCode: 400, message: 'Bad Request' });
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
