import { titleSimilarity } from '../../src/news/cluster';
import { planIngest, type KnownNews } from '../../src/news/ingest-plan';
import { newsId, titleHash, urlHash } from '../../src/news/normalise';
import type { NewsItem } from '../../src/news/parse';

/**
 * IB-027 — what a polling pass writes.
 *
 * The feeds are a rolling window, so every pass re-reads items already stored: the duplicate rules
 * are not an edge case here, they are the main path. Each test below pins a decision that a
 * plausible wrong implementation gets differently — cross-source collapsing, same-pass clustering,
 * founding order — rather than asserting that something was written.
 */

const T0 = Date.UTC(2026, 9, 12, 12, 0, 0);

function item(source: string, url: string, title: string, atMs = T0): NewsItem {
  return {
    id: newsId(source, url),
    source,
    url,
    title,
    body: null,
    publishedAt: new Date(atMs),
    urlHash: urlHash(url),
    titleHash: titleHash(title),
  };
}

const nothingKnown = new Map<string, KnownNews>();

describe('duplicates within one source', () => {
  it('skips an article the source has already given us, by URL', () => {
    const existing = item('coindesk', 'https://coindesk.com/a', 'SEC approves the thing');
    const known = new Map<string, KnownNews>([
      ['coindesk', { urlHashes: new Set([existing.urlHash]), titleHashes: new Set() }],
    ]);
    const plan = planIngest({ items: [existing], known, recent: [] });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.skipped).toEqual([{ id: existing.id, reason: 'url-seen' }]);
  });

  it('skips a re-publish under a NEW url when the title is one we already have from that source', () => {
    const first = item('coindesk', 'https://coindesk.com/a', 'SEC approves the thing');
    const republished = item('coindesk', 'https://coindesk.com/a-updated', 'SEC approves the thing');
    const known = new Map<string, KnownNews>([
      ['coindesk', { urlHashes: new Set([first.urlHash]), titleHashes: new Set([first.titleHash]) }],
    ]);
    const plan = planIngest({ items: [republished], known, recent: [] });
    expect(plan.inserts).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe('title-seen');
  });

  it('skips a repeat inside a single response, which a feed does serve', () => {
    const a = item('decrypt', 'https://decrypt.co/x', 'Ether rallies');
    const plan = planIngest({ items: [a, a], known: nothingKnown, recent: [] });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.skipped).toEqual([{ id: a.id, reason: 'duplicate-in-pass' }]);
  });
});

describe('the same story from a different source is a confirmation, not a duplicate', () => {
  it('inserts BOTH and clusters them — collapsing them would erase the confirmation count', () => {
    // this is the test that fails on the tempting "dedupe by title_hash globally" implementation,
    // which looks tidier and destroys exactly the signal news_clusters.confirmations exists for
    const a = item('coindesk', 'https://coindesk.com/a', 'SEC approves spot ETF for Ether');
    const b = item('theblock', 'https://theblock.co/b', 'SEC approves spot ETF for Ether', T0 + 60_000);

    const plan = planIngest({ items: [a, b], known: nothingKnown, recent: [] });

    expect(plan.inserts).toHaveLength(2);
    expect(plan.skipped).toHaveLength(0);
    // the second joins the first, rather than founding a cluster of its own
    expect(plan.inserts[0].joins).toBeNull();
    expect(plan.inserts[1].joins?.id).toBe(a.id);
    expect(plan.inserts[1].similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('clusters two versions that arrive in the SAME pass, not only against stored ones', () => {
    // the subtle one: clustering only against `recent` leaves these in two clusters that no later
    // pass ever merges, because by then neither is new. It passes a test that feeds one item at a
    // time, which is why this test feeds both.
    const a = item('cointelegraph', 'https://cointelegraph.com/a', 'Bitcoin ETF sees record inflows today');
    const b = item('decrypt', 'https://decrypt.co/b', 'Bitcoin ETF sees record inflows', T0 + 120_000);

    const plan = planIngest({ items: [a, b], known: nothingKnown, recent: [] });
    expect(plan.inserts.map((i) => i.joins?.id ?? null)).toEqual([null, a.id]);
  });

  it('founds the cluster on the EARLIEST telling, whatever order the sources arrive in', () => {
    // fed newest-first on purpose: whoever broke the story owns the cluster, not whoever sorted first
    const early = item('theblock', 'https://theblock.co/early', 'Exchange halts withdrawals', T0);
    const late = item('decrypt', 'https://decrypt.co/late', 'Exchange halts withdrawals', T0 + 300_000);

    const plan = planIngest({ items: [late, early], known: nothingKnown, recent: [] });
    expect(plan.inserts[0].item.id).toBe(early.id);
    expect(plan.inserts[0].joins).toBeNull();
    expect(plan.inserts[1].joins?.id).toBe(early.id);
  });
});

describe('clustering against what is already stored', () => {
  it('joins a story already in the recent window', () => {
    const stored = { id: 'coindesk:old', title: 'Fed holds rates steady', publishedAt: new Date(T0) };
    const fresh = item('decrypt', 'https://decrypt.co/n', 'Fed holds rates steady', T0 + 60_000);

    const plan = planIngest({ items: [fresh], known: nothingKnown, recent: [stored] });
    expect(plan.inserts[0].joins?.id).toBe('coindesk:old');
  });

  it('does NOT join a similar headline outside the window — a recurring story is not one story', () => {
    // "Bitcoin falls below $100k" every few weeks is several events; one cluster spanning them
    // would make confirmations meaningless
    const stored = { id: 'old', title: 'Bitcoin falls below 100k', publishedAt: new Date(T0 - 40 * 3_600_000) };
    const fresh = item('decrypt', 'https://decrypt.co/n', 'Bitcoin falls below 100k');

    const plan = planIngest({ items: [fresh], known: nothingKnown, recent: [stored] });
    expect(plan.inserts[0].joins).toBeNull();
  });

  it('keeps unrelated headlines apart', () => {
    const stored = { id: 'old', title: 'Fed holds rates steady', publishedAt: new Date(T0) };
    const fresh = item('decrypt', 'https://decrypt.co/n', 'Solana outage halts block production', T0 + 60_000);

    const plan = planIngest({ items: [fresh], known: nothingKnown, recent: [stored] });
    expect(plan.inserts[0].joins).toBeNull();
    expect(plan.inserts[0].similarity).toBe(0);
  });
});

describe('an empty pass', () => {
  it('plans nothing and claims nothing', () => {
    expect(planIngest({ items: [], known: nothingKnown, recent: [] })).toEqual({ inserts: [], skipped: [] });
  });
});

describe('a bridging item must not chain two unrelated stories (IB-027 Q1)', () => {
  // The hazard: resolving a join through "whichever member I matched" makes a cluster the
  // transitive closure of pairwise similarity. A~B and B~C merges A and C even when they share
  // nothing — and once merged, the evidence that they were separate is exactly what got absorbed,
  // so nothing downstream can tell the cluster is wrong.
  //
  // Jaccard distance is a metric, so the chain is BOUNDED but real: with a 0.6 threshold,
  // J(A,C) >= 0.6 + 0.6 - 1 = 0.2, which still leaves A and C about different subjects. These
  // three are a shared framing plus two distinct tails, with B the roundup that straddles them —
  // measured A~B 0.67, B~C 0.73, A~C 0.43.
  const SHARED = 'Federal regulator announces decision on';
  const A = `${SHARED} spot Ether ETF applications`;
  const B = `${SHARED} spot Ether ETF applications and on derivatives firm misconduct charges`;
  const C = `${SHARED} derivatives firm misconduct charges`;

  it('the chain is real — B matches both ends while the ends do not match each other', () => {
    // asserted explicitly, so this test cannot quietly stop testing anything if the measure changes
    expect(titleSimilarity(A, B)).toBeGreaterThanOrEqual(0.6);
    expect(titleSimilarity(B, C)).toBeGreaterThanOrEqual(0.6);
    expect(titleSimilarity(A, C)).toBeLessThan(0.6);
  });

  it('keeps the two stories apart: C founds its own cluster rather than joining A through B', () => {
    const a = item('coindesk', 'https://coindesk.com/a', A, T0);
    const b = item('theblock', 'https://theblock.co/b', B, T0 + 60_000);
    const c = item('decrypt', 'https://decrypt.co/c', C, T0 + 120_000);

    const plan = planIngest({ items: [a, b, c], known: nothingKnown, recent: [] });

    expect(plan.inserts).toHaveLength(3);
    // a founds; b joins a (it genuinely is the same story plus an extra clause)
    expect(plan.inserts[0].joins).toBeNull();
    expect(plan.inserts[1].joins?.id).toBe(a.id);
    // c must NOT reach a's cluster through b — b is a member, never a representative
    expect(plan.inserts[2].joins).toBeNull();
  });

  it('every joiner matched the REPRESENTATIVE, so similarity is to one fixed title', () => {
    const a = item('coindesk', 'https://coindesk.com/a', A, T0);
    const b = item('theblock', 'https://theblock.co/b', B, T0 + 60_000);
    const plan = planIngest({ items: [a, b], known: nothingKnown, recent: [] });
    // the schema documents news_cluster_members.similarity as "to the cluster's first title";
    // this is what makes that true rather than aspirational
    expect(plan.inserts[1].similarity).toBeCloseTo(titleSimilarity(A, B), 5);
  });
});

describe('cluster identity depends on ARRIVAL order — known, not assumed away', () => {
  const EARLY = 'Exchange suspends withdrawals after security incident';
  const LATE = 'Exchange suspends withdrawals following security incident';

  it('within one pass it is deterministic: the earliest PUBLISHED founds the cluster', () => {
    const early = item('theblock', 'https://theblock.co/e', EARLY, T0);
    const late = item('decrypt', 'https://decrypt.co/l', LATE, T0 + 300_000);

    // fed both ways round; the plan is identical because the pass sorts by published_at
    const forwards = planIngest({ items: [early, late], known: nothingKnown, recent: [] });
    const backwards = planIngest({ items: [late, early], known: nothingKnown, recent: [] });

    expect(forwards.inserts.map((i) => i.item.id)).toEqual([early.id, late.id]);
    expect(backwards.inserts.map((i) => i.item.id)).toEqual([early.id, late.id]);
    expect(forwards.inserts[0].joins).toBeNull();
    expect(backwards.inserts[0].joins).toBeNull();
  });

  it('across passes it is NOT: the first INGESTED represents, even if published later', () => {
    // live polling order. The later-published telling arrives first and founds the cluster; the
    // earlier-published one then JOINS and can never retroactively become the representative.
    const early = item('theblock', 'https://theblock.co/e', EARLY, T0);
    const late = item('decrypt', 'https://decrypt.co/l', LATE, T0 + 300_000);

    const pass1 = planIngest({ items: [late], known: nothingKnown, recent: [] });
    expect(pass1.inserts[0].joins).toBeNull(); // `late` is the representative

    const representatives = [{ id: late.id, title: late.title, publishedAt: late.publishedAt }];
    const pass2 = planIngest({ items: [early], known: nothingKnown, recent: representatives });
    expect(pass2.inserts[0].joins?.id).toBe(late.id);

    // ...whereas a one-pass replay of the same two items makes `early` the representative. Same
    // inputs, different cluster composition — systematically, not randomly. This is why a replay
    // is documented as NOT reproducing clusters.
    const replay = planIngest({ items: [early, late], known: nothingKnown, recent: [] });
    expect(replay.inserts[0].item.id).toBe(early.id);
    expect(replay.inserts[0].joins).toBeNull();
  });
});
