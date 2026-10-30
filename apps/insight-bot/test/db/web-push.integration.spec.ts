import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { PgWebPushStore } from '../../src/delivery/pg/web-push.repo';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-069 against a real Postgres: migration 020's two tables and `PgWebPushStore` — the upsert on
 * the endpoint, a member removing only their own row, the journal claim, and the cascade that
 * clears the journal when a subscription goes. Skipped without DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('web-push.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPk', auth: 'q1w' } };

maybeDescribe('IB-069 web_push_subscriptions against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let store: PgWebPushStore;
  let alice: number;
  let bob: number;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_webpush', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    db = new PgDatabase(url.toString());
    await runMigrations({ connectionString: url.toString() });
    store = new PgWebPushStore(db);
    const users = await db.query<{ id: number }>(
      `insert into users (tg_user_id, chat_id, role, lang) values (2001, 2001, 'member', 'en'), (2002, 2002, 'member', 'ru') returning id`,
    );
    [alice, bob] = users.map((u) => u.id);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await admin.end();
    await dropOwn(async () => {
      const c = new Client({ connectionString: DATABASE_URL });
      await c.connect();
      return c;
    }, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    await db.query('delete from web_push_subscriptions');
    await db.query('update users set disabled = false');
  });

  it('saves a subscription with its member\'s language; the same endpoint again replaces keys and owner', async () => {
    await store.save(alice, SUB);
    expect(await store.targets()).toEqual([expect.objectContaining({ userId: alice, lang: 'en', subscription: SUB })]);

    const rotated = { ...SUB, keys: { p256dh: 'BNew', auth: 'new' } };
    await store.save(bob, rotated);
    const targets = await store.targets();
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ userId: bob, lang: 'ru', subscription: rotated });
  });

  it('a member removes only their own subscription', async () => {
    await store.save(alice, SUB);
    expect(await store.remove(bob, SUB.endpoint)).toBe(false);
    expect(await store.targets()).toHaveLength(1);
    expect(await store.remove(alice, SUB.endpoint)).toBe(true);
    expect(await store.targets()).toEqual([]);
  });

  it('a disabled member\'s browsers get nothing', async () => {
    await store.save(alice, SUB);
    await db.query('update users set disabled = true where id = $1', [alice]);
    expect(await store.targets()).toEqual([]);
  });

  it('claims once per (subscription, key), and dropping the subscription clears its journal', async () => {
    await store.save(alice, SUB);
    const [{ id }] = await store.targets();
    const at = Date.UTC(2026, 9, 29, 12, 15);
    expect(await store.claim(id, 'due:1', at)).toBe(true);
    expect(await store.claim(id, 'due:1', at)).toBe(false);
    expect(await store.sentKeys(at - 1)).toEqual(new Map([[id, new Set(['due:1'])]]));

    await store.drop(id);
    expect(await store.targets()).toEqual([]);
    const left = await db.query('select 1 from web_push_notifications_sent where subscription_id = $1', [id]);
    expect(left).toEqual([]);
  });
});
