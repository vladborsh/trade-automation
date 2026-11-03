import { matchAssets, type AssetDictionaryEntry } from './assets';
import { chooseCluster, CLUSTER_WINDOW_MS, SIMILARITY_THRESHOLD, type ClusterCandidate } from './cluster';
import type { NewsItem } from './parse';

/**
 * IB-027 — what a polling pass should actually write (§10). Pure: no I/O, so the rules below are
 * spec'd rather than observed against a live feed.
 *
 * A pass fetches every source, parses it, and arrives here with the items and with what the
 * database already holds. This decides three things, and each one is a judgement the design
 * depends on:
 *
 * ## 1. What counts as a duplicate, and what counts as a confirmation
 *
 * The feeds are a **rolling window** (measured 2026-09-28: roughly 3–4 days for the crypto
 * sources), so every poll re-reads items it has already stored. Re-storing them would multiply the
 * tape; that is the duplicate case, and it is scoped **to the source**: the same source serving the
 * same URL or the same normalised title again is the same article.
 *
 * The same story from a *different* source is **not** a duplicate — it is the thing
 * `news_clusters.confirmations` exists to count. Three outlets carrying one story is a stronger
 * signal than one outlet carrying it, and collapsing them would erase exactly that. So a
 * cross-source match is inserted and joined to the cluster, never skipped.
 *
 * ## 2. A member must match the cluster's REPRESENTATIVE, not merely some member
 *
 * Joining by "whatever existing item I matched" makes a cluster the transitive closure of pairwise
 * similarity: A~B, B~C, and A and C unrelated collapses two stories into one blob. With trigram
 * similarity a single bridging headline straddling two stories is enough, and **once merged nothing
 * records that it was wrong** — the evidence that they were separate is exactly what got absorbed.
 *
 * So `recent` carries cluster **representatives** (each cluster's founding title), never every
 * stored item, and an accepted item becomes a candidate only when it founds a cluster of its own.
 * Every member is then within the threshold of one fixed title, which bounds the cluster by
 * construction rather than by a size cap. The cost is the opposite failure — a story whose wording
 * drifts far enough from the first telling starts a second cluster — and that one stays visible,
 * where a wrong merge does not.
 *
 * ## 3. Items inside one pass must be able to cluster with each other
 *
 * A single pass regularly brings in two outlets' versions of the same story at once. Clustering
 * only against what was already stored would put them in two clusters that no later pass ever
 * merges, because neither is new by then. Accepted items are therefore folded into the candidate
 * set as the plan is built — the trap here is that it looks correct in a test that feeds one item
 * at a time.
 *
 * ## 4. Nothing is invented
 *
 * Items the parser refused are already gone before this point (`parse.ts` drops anything without a
 * URL, a title or a usable date rather than stamping it with our clock). Nothing here fills a gap.
 */

export interface KnownNews {
  /** `url_hash` values already stored, per source. */
  urlHashes: ReadonlySet<string>;
  /** `title_hash` values already stored, per source. */
  titleHashes: ReadonlySet<string>;
}

export interface IngestPlanInput {
  items: readonly NewsItem[];
  /** What the database already holds for the sources in this pass, keyed by source id. */
  known: ReadonlyMap<string, KnownNews>;
  /**
   * Cluster REPRESENTATIVES in the window — one per cluster, its founding item. Not every recent
   * item: see the transitive-closure note above.
   */
  recent: readonly ClusterCandidate[];
  windowMs?: number;
  threshold?: number;
  /**
   * The symbol dictionary, so an incoming item's assets are known before it is clustered.
   *
   * Tagging runs ahead of clustering because two formulaic announcements about DIFFERENT assets
   * match on words alone; the asset sets are what tell them apart. Omitted means no constraint —
   * clustering falls back to similarity only, rather than refusing everything.
   */
  dictionary?: readonly AssetDictionaryEntry[];
}

export interface PlannedInsert {
  item: NewsItem;
  /** The item this one clusters with, or null to start a cluster of its own. */
  joins: ClusterCandidate | null;
  similarity: number;
}

export interface IngestPlan {
  inserts: PlannedInsert[];
  /** Why each skipped item was skipped — a silent skip and a silent failure look identical. */
  skipped: Array<{ id: string; reason: 'url-seen' | 'title-seen' | 'duplicate-in-pass' }>;
}

export function planIngest(input: IngestPlanInput): IngestPlan {
  const windowMs = input.windowMs ?? CLUSTER_WINDOW_MS;
  const threshold = input.threshold ?? SIMILARITY_THRESHOLD;

  const inserts: PlannedInsert[] = [];
  const skipped: IngestPlan['skipped'] = [];

  // Representatives grow as the pass proceeds, so two outlets' versions of one story arriving
  // together land in the same cluster instead of two that never merge — but ONLY founders are
  // added, so a chain cannot form through a joining member.
  const representatives: ClusterCandidate[] = [...input.recent];
  // what this pass has already accepted, per source, so a feed repeating an item inside one
  // response does not produce two rows
  const acceptedUrl = new Map<string, Set<string>>();
  const acceptedTitle = new Map<string, Set<string>>();

  // Oldest first: a cluster should be founded by the earliest telling of the story, not by
  // whichever source happened to sort first.
  const ordered = [...input.items].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());

  for (const item of ordered) {
    const known = input.known.get(item.source);
    const seenUrl = acceptedUrl.get(item.source) ?? new Set<string>();
    const seenTitle = acceptedTitle.get(item.source) ?? new Set<string>();

    if (known?.urlHashes.has(item.urlHash)) {
      skipped.push({ id: item.id, reason: 'url-seen' });
      continue;
    }
    if (known?.titleHashes.has(item.titleHash)) {
      // the same source re-publishing one story under a new URL
      skipped.push({ id: item.id, reason: 'title-seen' });
      continue;
    }
    if (seenUrl.has(item.urlHash) || seenTitle.has(item.titleHash)) {
      skipped.push({ id: item.id, reason: 'duplicate-in-pass' });
      continue;
    }

    const symbols = input.dictionary === undefined || input.dictionary.length === 0
      ? undefined
      : new Set(matchAssets(`${item.title}\n${item.body ?? ''}`, input.dictionary).map((m) => m.symbol));
    const incoming: ClusterCandidate = { id: item.id, title: item.title, publishedAt: item.publishedAt, symbols };
    const decision = chooseCluster(incoming, representatives, windowMs, threshold);
    inserts.push({ item, joins: decision.joins, similarity: decision.similarity });

    // only a founder becomes a representative; a joining member must never bridge two stories
    if (decision.joins === null) representatives.push(incoming);
    seenUrl.add(item.urlHash);
    seenTitle.add(item.titleHash);
    acceptedUrl.set(item.source, seenUrl);
    acceptedTitle.set(item.source, seenTitle);
  }

  return { inserts, skipped };
}
