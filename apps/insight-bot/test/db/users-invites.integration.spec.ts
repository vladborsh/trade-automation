import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import * as repo from '../../src/users/pg/users.repo';
import { generateInviteCode } from '../../src/users/invite-code';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-021 against a real Postgres: migration 005, and the single-use guarantee that only a
 * database can actually prove — two people opening the same deep link at the same moment.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('users-invites.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const NOW = new Date('2026-09-28T12:00:00Z');
const LATER = new Date('2026-10-06T12:00:00Z'); // past a 7-day expiry

maybeDescribe('IB-021 users and invites against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let adminId: number;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_users', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    adminId = (await repo.bootstrapAdmin(db, 111)).id;
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('bootstrapAdmin is idempotent and promotes an existing member', async () => {
    const again = await repo.bootstrapAdmin(db, 111);
    expect(again.id).toBe(adminId);
    expect(again.role).toBe('admin');
    expect((await repo.listUsers(db)).filter((u) => u.tgUserId === 111)).toHaveLength(1);
  });

  it('a valid invite creates exactly one member and is then spent', async () => {
    const code = generateInviteCode();
    await repo.createInvite(db, code, adminId, new Date(NOW.getTime() + 86_400_000));

    const first = await repo.consumeInvite(db, code, 222, 2220, NOW);
    expect(first.kind).toBe('joined');

    // the same code, a DIFFERENT person: single use means refused
    const second = await repo.consumeInvite(db, code, 333, 3330, NOW);
    expect(second.kind).toBe('refused');
    expect(await repo.findByTgUserId(db, 333)).toBeNull();
  });

  it('TWO PEOPLE RACING the same link: exactly one joins', async () => {
    const code = generateInviteCode();
    await repo.createInvite(db, code, adminId, new Date(NOW.getTime() + 86_400_000));

    const [a, b] = await Promise.all([
      repo.consumeInvite(db, code, 444, 4440, NOW),
      repo.consumeInvite(db, code, 555, 5550, NOW),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(['joined', 'refused']);

    const joined = [await repo.findByTgUserId(db, 444), await repo.findByTgUserId(db, 555)].filter(Boolean);
    expect(joined).toHaveLength(1);
  });

  it('an expired invite is refused', async () => {
    const code = generateInviteCode();
    await repo.createInvite(db, code, adminId, new Date(NOW.getTime() + 86_400_000));
    expect((await repo.consumeInvite(db, code, 666, 6660, LATER)).kind).toBe('refused');
  });

  it('an existing member re-opening a link is recognised, and their chat id is refreshed', async () => {
    const code = generateInviteCode();
    await repo.createInvite(db, code, adminId, new Date(NOW.getTime() + 86_400_000));
    const result = await repo.consumeInvite(db, code, 222, 9999, NOW);
    expect(result.kind).toBe('already_member');
    expect((await repo.findByTgUserId(db, 222))?.chatId).toBe(9999);
  });

  it('settings round-trip through the real column types', async () => {
    const user = await repo.findByTgUserId(db, 222);
    const updated = await repo.updateSettings(db, user!.id, {
      deposit: 12500.5, riskPct: 1.5, dailyLossLimitPct: 3, dexAlerts: true, lang: 'en',
    });
    expect(updated).toMatchObject({ deposit: 12500.5, riskPct: 1.5, dailyLossLimitPct: 3, dexAlerts: true, lang: 'en' });

    // numeric comes back from pg as a string; the mapper must not hand a string to sizing
    expect(typeof updated!.deposit).toBe('number');
    expect(typeof updated!.tgUserId).toBe('number');
  });

  it('the schema refuses a role or language it does not know', async () => {
    await expect(db.query("insert into users (tg_user_id, role) values (777, 'owner')")).rejects.toThrow();
    await expect(db.query("insert into users (tg_user_id, role, lang) values (778, 'member', 'de')")).rejects.toThrow();
  });
});
