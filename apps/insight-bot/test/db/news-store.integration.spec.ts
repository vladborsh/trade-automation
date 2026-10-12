import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { knownNews, persistPlan, recentForClustering } from '../../src/db/pg/news-store';
import { planIngest } from '../../src/news/ingest-plan';
import { newsId, titleHash, urlHash } from '../../src/news/normalise';
import type { NewsItem } from '../../src/news/parse';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-027 — the news tape against a real Postgres.
 *
 * The planning is pure and spec'd separately; what needs a real database is everything the schema
 * enforces or computes: the unique index on `(source, url_hash)`, the foreign keys between the
 * three tables, and `confirmations` being a count rather than a drifting increment. A fake would
 * only re-assert what I believe the SQL does.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('news-store.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);
const SINCE = new Date(T0 - 7 * 86_400_000);
/** What `confirmations` is counted out of — the number of sources being polled. */
const SOURCE_COUNT = 10;

function item(source: string, url: string, title: string, atMs = T0): NewsItem {
  return {
    id: newsId(source, url), source, url, title, body: null,
    publishedAt: new Date(atMs), urlHash: urlHash(url), titleHash: titleHash(title),
  };
}

maybeDescribe('IB-027 news store against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_news', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  async function ingest(items: readonly NewsItem[]) {
    const sources = [...new Set(items.map((i) => i.source))];
    const plan = planIngest({
      items,
      known: await knownNews(db, sources, SINCE),
      recent: await recentForClustering(db, SINCE),
    });
    return { plan, result: await persistPlan(db, plan, SOURCE_COUNT) };
  }

  it('stores a first article and founds a cluster of one', async () => {
    const a = item('coindesk', 'https://coindesk.com/one', 'Regulator approves the first thing');
    const { result } = await ingest([a]);
    expect(result).toEqual({ inserted: 1, clustersCreated: 1, clustersJoined: 0 });

    const [row] = await db.query<{ confirmations: number }>(
      `select c.confirmations from news_clusters c where c.first_news_id = $1`, [a.id],
    );
    expect(Number(row.confirmations)).toBe(1);
  });

  it('a second source reporting the same story joins the cluster and raises confirmations', async () => {
    const b = item('theblock', 'https://theblock.co/one', 'Regulator approves the first thing', T0 + 60_000);
    const { result } = await ingest([b]);
    expect(result.inserted).toBe(1);
    expect(result.clustersJoined).toBe(1);
    expect(result.clustersCreated).toBe(0);

    const [row] = await db.query<{ confirmations: number; members: number }>(
      `select c.confirmations, (select count(*) from news_cluster_members m where m.cluster_id = c.id) members
         from news_clusters c
         join news_cluster_members mm on mm.cluster_id = c.id
        where mm.news_id = $1`, [b.id],
    );
    // the number the dashboard would show, and the number of rows behind it, must agree
    expect(Number(row.confirmations)).toBe(2);
    expect(Number(row.members)).toBe(2);
  });

  it('a THIRD source joins the same cluster, not the founder\'s own new one', async () => {
    // the trap: resolving the cluster by "the matched item's id" rather than by its membership
    // splits one story once the match is itself a member rather than a founder
    const c = item('decrypt', 'https://decrypt.co/one', 'Regulator approves the first thing', T0 + 120_000);
    await ingest([c]);

    const rows = await db.query<{ n: string }>(
      `select count(distinct cluster_id) n from news_cluster_members
        where news_id in ($1, $2, $3)`,
      [newsId('coindesk', 'https://coindesk.com/one'), newsId('theblock', 'https://theblock.co/one'), c.id],
    );
    expect(Number(rows[0].n)).toBe(1); // one cluster, three members
    const [cluster] = await db.query<{ confirmations: number }>(
      `select confirmations from news_clusters c
         join news_cluster_members m on m.cluster_id = c.id where m.news_id = $1`, [c.id],
    );
    expect(Number(cluster.confirmations)).toBe(3);
  });

  it('re-polling the same feed stores nothing new — the rolling window re-serves everything', async () => {
    const again = item('coindesk', 'https://coindesk.com/one', 'Regulator approves the first thing');
    const { plan, result } = await ingest([again]);
    expect(result.inserted).toBe(0);
    expect(plan.skipped[0]).toMatchObject({ reason: 'url-seen' });

    const [{ n }] = await db.query<{ n: string }>(`select count(*) n from raw_news`, []);
    expect(Number(n)).toBe(3); // still the three distinct articles
  });

  it('an unrelated story gets its own cluster', async () => {
    const d = item('cftc', 'https://cftc.gov/x', 'Commission charges firm over derivatives misconduct', T0 + 180_000);
    const { result } = await ingest([d]);
    expect(result).toEqual({ inserted: 1, clustersCreated: 1, clustersJoined: 0 });
    const [{ n }] = await db.query<{ n: string }>(`select count(*) n from news_clusters`, []);
    expect(Number(n)).toBe(2);
  });

  it('knownNews is bounded by `since`, so the dedupe set does not grow without limit', async () => {
    const old = item('sec', 'https://sec.gov/ancient', 'An old press release', T0 - 30 * 86_400_000);
    await ingest([old]);
    const known = await knownNews(db, ['sec'], SINCE);
    // stored, but outside the window the next poll asks about
    expect(known.get('sec')).toBeUndefined();
    const [{ n }] = await db.query<{ n: string }>(`select count(*) n from raw_news where source = 'sec'`, []);
    expect(Number(n)).toBe(1);
  });

  it('the whole pass is one transaction — a bad row takes none of it', async () => {
    const good = item('blockworks', 'https://blockworks.co/ok', 'A perfectly fine headline', T0 + 240_000);
    const poisoned = { ...item('blockworks', 'https://blockworks.co/bad', 'Another headline', T0 + 250_000), source: null as unknown as string };
    const before = await db.query<{ n: string }>(`select count(*) n from raw_news`, []);

    const plan = planIngest({ items: [good, poisoned], known: new Map(), recent: [] });
    await expect(persistPlan(db, plan, SOURCE_COUNT)).rejects.toThrow();

    const after = await db.query<{ n: string }>(`select count(*) n from raw_news`, []);
    // the good row rolled back with the bad one: a half-written pass would leave raw_news rows
    // with no cluster, and the next pass would not re-offer them because they are not new
    expect(after[0].n).toBe(before[0].n);
  });

  it('counts DISTINCT SOURCES, so one chatty outlet cannot corroborate itself', async () => {
    // the trap: binance publishes the same announcement through an official RSS and an API. Two
    // members, two different URLs and titles — but ONE voice. Counting member rows would read as
    // independent corroboration.
    const rss = item('binance-announcements', 'https://binance.com/en/support/announcement/x', 'Binance will list NEWCOIN perpetual contract', T0 + 600_000);
    const api = item('binance-announcements', 'https://binance.com/bapi/composite/v1/x', 'Binance will list NEWCOIN perpetual', T0 + 660_000);

    await ingest([rss]);
    await ingest([api]);

    const [row] = await db.query<{ confirmations: number; of_sources: number; members: number }>(
      `select c.confirmations, c.of_sources,
              (select count(*) from news_cluster_members m where m.cluster_id = c.id) members
         from news_clusters c
         join news_cluster_members mm on mm.cluster_id = c.id
        where mm.news_id = $1`, [api.id],
    );
    expect(Number(row.members)).toBe(2);        // two articles
    expect(Number(row.confirmations)).toBe(1);  // one source
    expect(Number(row.of_sources)).toBe(SOURCE_COUNT); // and the figure carries its denominator
  });

  it('a bridging item cannot chain two unrelated stories through the database either', async () => {
    // the pure planner has its own version of this; here it is end to end, because the bound only
    // holds if recentForClustering returns REPRESENTATIVES and not every stored item
    const SHARED = 'Agency publishes long awaited guidance on';
    const a = item('coindesk', 'https://coindesk.com/ch-a', `${SHARED} stablecoin reserve attestations`, T0 + 700_000);
    const b = item('theblock', 'https://theblock.co/ch-b', `${SHARED} stablecoin reserve attestations and on custody bankruptcy rules`, T0 + 760_000);
    const c = item('decrypt', 'https://decrypt.co/ch-c', `${SHARED} custody bankruptcy rules`, T0 + 820_000);

    await ingest([a]);
    await ingest([b]);
    await ingest([c]);

    const [{ n }] = await db.query<{ n: string }>(
      `select count(distinct cluster_id) n from news_cluster_members where news_id in ($1, $2, $3)`,
      [a.id, b.id, c.id],
    );
    // a and b are one story; c is another. Chaining through b would make this 1.
    expect(Number(n)).toBe(2);
  });
});
