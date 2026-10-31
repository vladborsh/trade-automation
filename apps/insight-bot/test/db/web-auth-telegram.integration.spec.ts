import { createHash, createHmac, randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as users from '../../src/users/pg/users.repo';
import * as repo from '../../src/web/auth/pg/auth.repo';
import { sha256Hex } from '../../src/web/auth/session-cookie';
import { WebAuthService } from '../../src/web/auth/web-auth.service';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-072 — "Log in with Telegram" against a real database: the session the widget opens is the
 * same `web_sessions` row the link opens, the widget never inserts into `users`, and a disabled
 * member is refused like a forged payload.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('web-auth-telegram.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const TOKEN = '42:FakeIntegrationToken';
const NOW = new Date('2026-11-01T12:00:00Z');

function signed(id: number): Record<string, string | number> {
  const f: Record<string, string | number> = { id, first_name: 'X', auth_date: Math.floor(NOW.getTime() / 1000) };
  const dcs = Object.keys(f).sort().map((k) => `${k}=${f[k]}`).join('\n');
  return { ...f, hash: createHmac('sha256', createHash('sha256').update(TOKEN).digest()).update(dcs).digest('hex') };
}

maybeDescribe('IB-072 widget login against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let auth: WebAuthService;
  let bob: number;

  const userCount = async () => Number((await db.query<{ n: string }>('select count(*) as n from users'))[0].n);

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_tglogin', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    auth = new WebAuthService(db, { env: { get: (k: string) => (k === 'TELEGRAM_BOT_TOKEN' ? TOKEN : undefined) } } as never);

    const alice = (await users.bootstrapAdmin(db, 111)).id;
    await users.createInvite(db, 'bbbbbbbbbbbbbbbb', alice, new Date(NOW.getTime() + 86_400_000));
    bob = ((await users.consumeInvite(db, 'bbbbbbbbbbbbbbbb', 222, 2220, NOW)) as { user: { id: number } }).user.id;
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a member logs in: a web_sessions row for them, resolvable like a link session', async () => {
    const out = await auth.loginWithTelegram(signed(222), NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.user.id).toBe(bob);
    const resolved = await auth.resolveSession(out.token, NOW);
    expect(resolved?.user.tgUserId).toBe(222);
    // stored under its hash, like every other session
    expect(await db.query('select 1 from web_sessions where id = $1', [sha256Hex(out.token)])).toHaveLength(1);
    expect(await db.query('select 1 from web_sessions where id = $1', [out.token])).toHaveLength(0);
  });

  it('a stranger is NOT_A_MEMBER and the users table does not grow', async () => {
    const before = await userCount();
    expect(await auth.loginWithTelegram(signed(999), NOW)).toEqual({ ok: false, code: 'NOT_A_MEMBER', status: 403 });
    expect(await userCount()).toBe(before);
    expect(await db.query('select 1 from users where tg_user_id = 999')).toHaveLength(0);
  });

  it('a disabled member is TOKEN_INVALID and gets no session row', async () => {
    await db.query('update users set disabled = true where id = $1', [bob]);
    await repo.deleteSessionsForUser(db, bob);
    expect(await auth.loginWithTelegram(signed(222), NOW)).toEqual({ ok: false, code: 'TOKEN_INVALID', status: 401 });
    expect(await db.query('select 1 from web_sessions where user_id = $1', [bob])).toHaveLength(0);
  });
});
