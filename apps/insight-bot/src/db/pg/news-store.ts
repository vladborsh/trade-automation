import type { Db } from '../db.port';
import type { AssetDictionaryEntry } from '../../news/assets';
import { matchAssets } from '../../news/assets';
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

/**
 * Cluster **representatives** in the window — each cluster's founding item, never every stored
 * item.
 *
 * Returning every item would make a cluster the transitive closure of pairwise similarity: A~B,
 * B~C, and A and C unrelated merges two stories, and once merged the evidence that they were
 * separate is exactly what got absorbed. Representatives bound the cluster by construction —
 * every member is within the threshold of one fixed title.
 */
export async function recentForClustering(db: Db, since: Date): Promise<ClusterCandidate[]> {
  const rows = await db.query<{ id: string; title: string; published_at: Date; symbols: string[] | null }>(
    // the representative's tagged assets come with it: clustering refuses a match whose asset set
    // is known and disjoint, and that test needs both sides
    `select n.id, n.title, n.published_at,
            array_remove(array_agg(a.symbol), null) as symbols
       from news_clusters c
       join raw_news n on n.id = c.first_news_id
       left join news_assets a on a.news_id = n.id
      where n.published_at >= $1
      group by n.id, n.title, n.published_at
      order by n.published_at`,
    [since],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    publishedAt: new Date(r.published_at),
    // an untagged representative gets an EMPTY set, which imposes no constraint — not `undefined`,
    // which would mean the same here but says something different to a reader
    symbols: new Set(r.symbols ?? []),
  }));
}

export interface PersistResult {
  inserted: number;
  clustersCreated: number;
  clustersJoined: number;
  /** Rows written to `news_assets` — candidate symbols, not a classification. */
  assetsTagged: number;
}

/** The universe to tag against. Empty disables tagging rather than tagging nothing silently. */
export interface PersistOptions {
  ofSources: number;
  dictionary?: readonly AssetDictionaryEntry[];
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
export async function persistPlan(db: Db, plan: IngestPlan, options: PersistOptions | number): Promise<PersistResult> {
  const { ofSources, dictionary } = typeof options === 'number' ? { ofSources: options, dictionary: undefined } : options;
  const result: PersistResult = { inserted: 0, clustersCreated: 0, clustersJoined: 0, assetsTagged: 0 };
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

      // Candidate symbols, inside the same transaction as the article: a tagged article with no
      // tags and a genuinely untagged one are indistinguishable afterwards, so they must not be
      // able to come apart.
      if (dictionary !== undefined && dictionary.length > 0) {
        for (const match of matchAssets(`${item.title}\n${item.body ?? ''}`, dictionary)) {
          await tx.query(
            `insert into news_assets (news_id, symbol, via, matched) values ($1, $2, $3, $4)
             on conflict do nothing`,
            [item.id, match.symbol, match.kind, match.matched],
          );
          result.assetsTagged += 1;
        }
      }

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
        await recount(tx, cluster.id, ofSources);
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
        await recount(tx, cluster.id, ofSources);
        result.clustersCreated += 1;
        await joinCluster(tx, cluster.id, item.id, planned.similarity, ofSources);
        result.clustersJoined += 1;
        continue;
      }

      await joinCluster(tx, member.cluster_id, item.id, planned.similarity, ofSources);
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
  ofSources: number,
): Promise<void> {
  await tx.query(
    `insert into news_cluster_members (cluster_id, news_id, similarity) values ($1, $2, $3)
     on conflict do nothing`,
    [clusterId, newsId, similarity],
  );
  await recount(tx, clusterId, ofSources);
}

/**
 * Recomputes `confirmations` as **distinct sources**, and records what it is counted out of.
 *
 * Counting member ROWS would let one chatty outlet publishing an RSS copy and an API copy of the
 * same announcement look like two independent confirmations — corroboration manufactured out of a
 * single voice, which is a venue count without its denominator. Exchange announcement feeds are
 * the obvious trap: the same text reaches us through an official RSS and an API, and those are one
 * source.
 *
 * Recomputed, never incremented: the membership insert above carries `on conflict do nothing` for
 * concurrent writers, and an increment drifts from the rows the moment that clause skips one. A
 * recomputed count is definitionally equal to the thing it counts.
 */
async function recount(tx: { query: Db['query'] }, clusterId: string, ofSources: number): Promise<void> {
  await tx.query(
    `update news_clusters
        set confirmations = (
              select count(distinct n.source)
                from news_cluster_members m
                join raw_news n on n.id = m.news_id
               where m.cluster_id = $1),
            of_sources = $2,
            updated_at = now()
      where id = $1`,
    [clusterId, ofSources],
  );
}
