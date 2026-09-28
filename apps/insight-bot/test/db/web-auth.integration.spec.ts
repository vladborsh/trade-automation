import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as users from '../../src/users/pg/users.repo';
import * as repo from '../../src/web/auth/pg/auth.repo';
import { sha256Hex, SESSION_TTL_MS, LOGIN_TOKEN_TTL_MS } from '../../src/web/auth/session-cookie';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-029 — the token exchange and the session, against a real database (migration 006).
 *
 * The done-line names four cases: valid, used, expired, foreign user. The first three are the
 * exchange's own states; "foreign user" is the one that matters most — a token issued for one
 * member must never open a session as another.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('web-auth.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const NOW = new Date('2026-09-28T12:00:00Z');

maybeDescribe('IB-029 web auth against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let alice: number;
  let bob: number;

  const issue = async (userId: number, token: string, expiresAt = new Date(NOW.getTime() + LOGIN_TOKEN_TTL_MS)) => {
    await repo.createLoginToken(db, sha256Hex(token), userId, expiresAt);
  };

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_webauth', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());

    alice = (await users.bootstrapAdmin(db, 111)).id;
    const code = 'aaaaaaaaaaaaaaaa';
    await users.createInvite(db, code, alice, new Date(NOW.getTime() + 86_400_000));
    const joined = await users.consumeInvite(db, code, 222, 2220, NOW);
    bob = (joined as { user: { id: number } }).user.id;
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a valid token is claimed once and names its own user', async () => {
    await issue(bob, 'tok-valid');
    expect(await repo.consumeLoginToken(db, sha256Hex('tok-valid'), NOW)).toEqual({ kind: 'ok', userId: bob });
  });

  it('the same token a second time is USED, not valid — a forwarded link is already dead', async () => {
    expect(await repo.consumeLoginToken(db, sha256Hex('tok-valid'), NOW)).toEqual({ kind: 'used' });
  });

  it('an expired token is EXPIRED', async () => {
    await issue(bob, 'tok-old', new Date(NOW.getTime() - 1));
    expect(await repo.consumeLoginToken(db, sha256Hex('tok-old'), NOW)).toEqual({ kind: 'expired' });
  });

  it('a token we never issued is UNKNOWN', async () => {
    expect(await repo.consumeLoginToken(db, sha256Hex('never-issued'), NOW)).toEqual({ kind: 'unknown' });
  });

  it('FOREIGN USER: a token issued for one member never opens a session as another', async () => {
    await issue(alice, 'tok-alice');
    const claim = await repo.consumeLoginToken(db, sha256Hex('tok-alice'), NOW);
    expect(claim).toEqual({ kind: 'ok', userId: alice });
    expect(claim.userId).not.toBe(bob);

    await repo.createSession(db, sha256Hex('sess-alice'), claim.userId as number, new Date(NOW.getTime() + SESSION_TTL_MS));
    const found = await repo.findLiveSession(db, sha256Hex('sess-alice'), NOW);
    expect(found?.user.id).toBe(alice);
    expect(found?.user.tgUserId).toBe(111);
  });

  it('the plaintext token is nowhere in the database', async () => {
    const rows = await db.query<{ n: string }>(
      'select count(*) as n from web_login_tokens where token_hash = $1', ['tok-valid'],
    );
    expect(Number(rows[0].n)).toBe(0); // stored under its hash, never itself
  });

  it('an expired session is not returned, even though the row still exists', async () => {
    await repo.createSession(db, sha256Hex('sess-old'), bob, new Date(NOW.getTime() - 1));
    expect(await repo.findLiveSession(db, sha256Hex('sess-old'), NOW)).toBeNull();
    const rows = await db.query('select 1 from web_sessions where id = $1', [sha256Hex('sess-old')]);
    expect(rows).toHaveLength(1);
  });

  it('touchSession slides the window', async () => {
    const id = sha256Hex('sess-slide');
    await repo.createSession(db, id, bob, new Date(NOW.getTime() + 1000));
    const later = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    await repo.touchSession(db, id, later, new Date(later.getTime() + SESSION_TTL_MS));

    const found = await repo.findLiveSession(db, id, later);
    expect(found).not.toBeNull();
    expect(found!.session.expiresAt.getTime()).toBe(later.getTime() + SESSION_TTL_MS);
  });

  it('disabling a member deletes their sessions (§4)', async () => {
    await repo.createSession(db, sha256Hex('s1'), bob, new Date(NOW.getTime() + SESSION_TTL_MS));
    await repo.createSession(db, sha256Hex('s2'), bob, new Date(NOW.getTime() + SESSION_TTL_MS));
    const removed = await repo.deleteSessionsForUser(db, bob);
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await repo.findLiveSession(db, sha256Hex('s1'), NOW)).toBeNull();
  });

  it('a deleted user takes their tokens and sessions with them (ON DELETE CASCADE)', async () => {
    const rows = await db.query<{ id: number }>(
      "insert into users (tg_user_id, role) values (444, 'member') returning id",
    );
    const dave = rows[0].id;
    await issue(dave, 'tok-dave');
    await repo.createSession(db, sha256Hex('sess-dave'), dave, new Date(NOW.getTime() + SESSION_TTL_MS));

    await db.query('delete from users where id = $1', [dave]);
    expect(await db.query('select 1 from web_sessions where user_id = $1', [dave])).toHaveLength(0);
    expect(await db.query('select 1 from web_login_tokens where user_id = $1', [dave])).toHaveLength(0);
  });

  it('a member with invite history CANNOT be hard-deleted — soft delete is the supported path', async () => {
    // invites.used_by references users(id) with no cascade, on purpose: removing a member must
    // not silently erase who invited whom. `disabled` + revoking sessions is how access is
    // taken away (§3.5), which the test above this one covers.
    await expect(db.query('delete from users where id = $1', [bob])).rejects.toThrow(/invites_used_by_fkey/);
  });

  it('sweepExpired removes stale rows and leaves live ones', async () => {
    // both created here: this must not depend on what earlier tests happened to leave behind
    await repo.createSession(db, sha256Hex('stale'), bob, new Date(NOW.getTime() - 1));
    await repo.createSession(db, sha256Hex('live'), bob, new Date(NOW.getTime() + SESSION_TTL_MS));

    const swept = await repo.sweepExpired(db, NOW);
    expect(swept.sessions).toBeGreaterThan(0);
    expect(await db.query('select 1 from web_sessions where id = $1', [sha256Hex('stale')])).toHaveLength(0);
    expect(await repo.findLiveSession(db, sha256Hex('live'), NOW)).not.toBeNull();
  });
});
