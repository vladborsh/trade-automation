import type { Db } from '../db.port';
import type { ClusterCandidate } from '../../news/cluster';
import type { IngestPlan, KnownNews } from '../../news/ingest-plan';

/**
 * IB-027 — the news tape's reads and writes (§10). SQL lives in `src/db/pg/` (IB-004).
 *
 * The planning is pure (`news/ingest-plan.ts`); this is the part that has to be right against a
 * real database, which is why its spec is an integration one.
 */

/** The hashes already stored for a set of sources, so a pass knows what it may skip. */
export async function knownNews(
  db: Db,
  sources: readonly string[],
  since: Date,
): Promise<Map<string, KnownNews>> {
  if (sources.length === 0) return new Map();
  const rows = await db.query<{ source: string; url_hash: string; title_hash: string }>(
    // bounded by `since`: the feeds are a rolling 3-4 day window, so the dedupe set only needs to
    // cover what a source can still be serving. Unbounded, this grows without limit and every poll
    // pays for the whole tape.
    `select source, url_hash, title_hash
       from raw_news
      where source = any($1) and published_at >= $2`,
    [sources as string[], since],
  );
  const out = new Map<string, KnownNews>();
  for (const row of rows) {
    const entry = out.get(row.source) ?? { urlHashes: new Set<string>(), titleHashes: new Set<string>() };
    (entry.urlHashes as Set<string>).add(row.url_hash);
    (entry.titleHashes as Set<string>).add(row.title_hash);
    out.set(row.source, entry);
  }
  return out;
}

/** Recent items, any source, that a new one may cluster with. */
export async function recentForClustering(db: Db, since: Date): Promise<ClusterCandidate[]> {
  const rows = await db.query<{ id: string; title: string; published_at: Date }>(
    `select id, title, published_at from raw_news where published_at >= $1 order by published_at`,
    [since],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, publishedAt: new Date(r.published_at) }));
}

export interface PersistResult {
  inserted: number;
  clustersCreated: number;
  clustersJoined: number;
}

/**
 * Writes a plan.
 *
 * **One transaction for the whole pass.** A half-written pass would leave `raw_news` rows with no
 * cluster, and the next pass would not re-offer them — they are no longer new — so the story would
 * sit in the tape permanently unclustered and uncounted.
 *
 * `on conflict do nothing` on the insert is belt-and-braces over the plan's own dedupe: two
 * processes polling the same source concurrently would otherwise race, and the unique index on
 * `(source, url_hash)` would abort the transaction and lose the whole pass rather than one row.
 */
export async function persistPlan(db: Db, plan: IngestPlan): Promise<PersistResult> {
  const result: PersistResult = { inserted: 0, clustersCreated: 0, clustersJoined: 0 };
  if (plan.inserts.length === 0) return result;

  await db.transaction(async (tx) => {
    for (const planned of plan.inserts) {
      const { item } = planned;
      const inserted = await tx.query<{ id: string }>(
        `insert into raw_news (id, source, url, title, body, published_at, url_hash, title_hash)
              values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict do nothing
           returning id`,
        [item.id, item.source, item.url, item.title, item.body, item.publishedAt, item.urlHash, item.titleHash],
      );
      if (inserted.length === 0) continue; // another writer got there first
      result.inserted += 1;

      if (planned.joins === null) {
        const [cluster] = await tx.query<{ id: string }>(
          `insert into news_clusters (first_news_id) values ($1) returning id`,
          [item.id],
        );
        await tx.query(
          `insert into news_cluster_members (cluster_id, news_id, similarity) values ($1, $2, null)
           on conflict do nothing`,
          [cluster.id, item.id],
        );
        result.clustersCreated += 1;
        continue;
      }

      // The cluster of the item we matched. Looked up through its membership rather than assumed
      // to be the founder's own cluster: the match may itself be a member of an older cluster, and
      // joining the founder's would split one story in two.
      const [member] = await tx.query<{ cluster_id: string }>(
        `select cluster_id from news_cluster_members where news_id = $1 limit 1`,
        [planned.joins.id],
      );
      if (member === undefined) {
        // the match predates clustering, or its cluster was deleted: found one on it, then join
        const [cluster] = await tx.query<{ id: string }>(
          `insert into news_clusters (first_news_id) values ($1) returning id`,
          [planned.joins.id],
        );
        await tx.query(
          `insert into news_cluster_members (cluster_id, news_id, similarity) values ($1, $2, null)
           on conflict do nothing`,
          [cluster.id, planned.joins.id],
        );
        result.clustersCreated += 1;
        await joinCluster(tx, cluster.id, item.id, planned.similarity);
        result.clustersJoined += 1;
        continue;
      }

      await joinCluster(tx, member.cluster_id, item.id, planned.similarity);
      result.clustersJoined += 1;
    }
  });

  return result;
}

async function joinCluster(
  tx: { query: Db['query'] },
  clusterId: string,
  newsId: string,
  similarity: number,
): Promise<void> {
  await tx.query(
    `insert into news_cluster_members (cluster_id, news_id, similarity) values ($1, $2, $3)
     on conflict do nothing`,
    [clusterId, newsId, similarity],
  );
  // confirmations counts members, so it is recomputed rather than incremented: an increment drifts
  // the moment a membership insert is skipped by the conflict clause above.
  await tx.query(
    `update news_clusters
        set confirmations = (select count(*) from news_cluster_members m where m.cluster_id = $1),
            updated_at = now()
      where id = $1`,
    [clusterId],
  );
}
