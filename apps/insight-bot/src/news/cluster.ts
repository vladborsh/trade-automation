import { normaliseTitle } from './normalise';

/**
 * IB-027 — near-duplicate clustering (§10): the same story carried by several outlets inside
 * 24 h becomes one cluster whose `confirmations` count is the signal. One outlet reporting
 * something is a report; five carrying it within the hour is an event.
 *
 * The similarity itself is Postgres' `pg_trgm` in the live path — it has the GIN index and does
 * this far faster than JS over a day of rows. The function here is the **same measure in
 * TypeScript**, so the threshold can be specced against real near-duplicate headlines without a
 * database, and so a reader can see what 0.6 actually means.
 */

/** §10's threshold: titles at or above this, inside the window, are the same story. */
export const SIMILARITY_THRESHOLD = 0.6;
export const CLUSTER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The trigram set of a string, matching `pg_trgm`'s construction **exactly**.
 *
 * Postgres splits the input into alphanumeric words and pads **each word** with two leading and
 * one trailing space — it does not pad the string as a whole, and it emits **no cross-word
 * trigrams**. Verified against `show_trgm('ab cd')`, which returns
 * `{"  a","  c"," ab"," cd","ab ","cd "}`: note `  c` present and `b c` absent.
 *
 * My first version padded the whole string, which produced `b c` and missed `  c`. It agreed
 * with Postgres on 4 of 5 sample pairs and disagreed on the fifth (0.5769 vs 0.5800) — close
 * enough to look right and wrong enough that the 0.6 threshold specced here would not have been
 * the 0.6 applied in the live query. `trigram-parity.spec.ts` now pins the two together.
 */
export function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  for (const word of value.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length === 0) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/**
 * Jaccard similarity over trigram sets — `pg_trgm.similarity()`'s definition:
 * |A ∩ B| / |A ∪ B|. Two empty strings are treated as similarity 0, not 1: an empty title is
 * missing data, and calling two absences identical would cluster every one of them together.
 */
export function similarity(a: string, b: string): number {
  // Checked on the INPUT, not on the trigram set: padding gives even '' a set of one all-space
  // trigram, so a set-size guard never fires and two empty titles would score 1.
  if (a.trim().length === 0 || b.trim().length === 0) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Similarity of two raw headlines, normalised first — what the clustering actually compares. */
export function titleSimilarity(a: string, b: string): number {
  return similarity(normaliseTitle(a), normaliseTitle(b));
}

export interface ClusterCandidate {
  id: string;
  title: string;
  publishedAt: Date;
}

export interface ClusterDecision {
  /** The candidate this one joins, or null to start a cluster of its own. */
  joins: ClusterCandidate | null;
  similarity: number;
}

/**
 * Which existing item (if any) a new article clusters with: the **most similar** one at or above
 * the threshold and inside the window — not merely the first found, so the cluster a story joins
 * does not depend on row order.
 *
 * `existing` is expected to be the recent window the caller already queried; this function does
 * no I/O and applies the window itself so a caller cannot widen it by accident.
 */
export function chooseCluster(
  incoming: ClusterCandidate,
  existing: readonly ClusterCandidate[],
  windowMs: number = CLUSTER_WINDOW_MS,
  threshold: number = SIMILARITY_THRESHOLD,
): ClusterDecision {
  let best: ClusterCandidate | null = null;
  let bestScore = 0;

  for (const candidate of existing) {
    if (candidate.id === incoming.id) continue;
    const apart = Math.abs(incoming.publishedAt.getTime() - candidate.publishedAt.getTime());
    if (apart > windowMs) continue;
    const score = titleSimilarity(incoming.title, candidate.title);
    if (score >= threshold && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return { joins: best, similarity: best === null ? 0 : bestScore };
}
