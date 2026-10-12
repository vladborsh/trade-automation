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
