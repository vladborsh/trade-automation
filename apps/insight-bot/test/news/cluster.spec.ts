import {
  chooseCluster,
  CLUSTER_WINDOW_MS,
  SIMILARITY_THRESHOLD,
  similarity,
  titleSimilarity,
  trigrams,
} from '../../src/news/cluster';

const at = (h: number) => new Date(Date.UTC(2026, 8, 28, h, 0));

/**
 * **Positive control (IB-027 rule).** This spec carries at least one fixture that MUST FIRE, and
 * this comment says why, so nobody "simplifies" the fixtures back to the cheap negative ones.
 *
 * A detector tested only on inputs that should NOT match is unfalsifiable: a dead pattern passes
 * every one of those tests. Not hypothetical — the cashtag rule in `assets.ts` had never worked at
 * all (a double-escaped pattern demanded a literal backslash in the article text), and its absence
 * was indistinguishable from "no cashtag in this article". One firing fixture found it instantly.
 *
 * Negative cases prove precision; positive ones prove the detector is alive. Neither half alone is
 * enough — the same pairing as the ON DELETE RESTRICT tests: the refusal AND the permitted case.
 */

describe('trigrams match pg_trgm construction', () => {
  it('pads two leading and one trailing space, as Postgres does', () => {
    // Without the padding a short title scores very differently here than in the database,
    // and the threshold specced in JS would not be the threshold applied live.
    expect([...trigrams('ab')]).toEqual(['  a', ' ab', 'ab ']);
  });

  it('is a set — a repeated trigram counts once', () => {
    expect(trigrams('aaaa').size).toBeLessThan(6);
  });
});

describe('similarity', () => {
  it('is 1 for identical strings and 0 for disjoint ones', () => {
    expect(similarity('bitcoin rallies', 'bitcoin rallies')).toBe(1);
    expect(similarity('aaaa', 'zzzz')).toBe(0);
  });

  it('treats an empty title as similarity 0, never as a match', () => {
    // Two absences are not the same story; calling them identical would cluster every
    // empty-titled item into one.
    expect(similarity('', '')).toBe(0);
    expect(similarity('', 'bitcoin rallies')).toBe(0);
  });

  it('is symmetric', () => {
    expect(similarity('abc def', 'abc xyz')).toBeCloseTo(similarity('abc xyz', 'abc def'), 12);
  });
});

describe('titleSimilarity on realistic near-duplicates', () => {
  it('scores the same story from two outlets above the threshold', () => {
    const pairs: Array<[string, string]> = [
      ['SEC Approves Spot Bitcoin ETF — CoinDesk', 'SEC approves spot bitcoin ETF | The Block'],
      ['Fed Holds Rates Steady', 'Fed holds rates steady!'],
      ['Binance Lists ONDO Perpetual Futures', 'Binance lists ONDO perpetual futures'],
    ];
    for (const [a, b] of pairs) {
      expect(titleSimilarity(a, b)).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    }
  });

  it('scores genuinely different stories below it', () => {
    const pairs: Array<[string, string]> = [
      ['SEC approves spot bitcoin ETF', 'CFTC fines derivatives exchange'],
      ['Binance lists ONDO perpetual futures', 'Coinbase delists three tokens'],
      ['Bitcoin rallies 5%', 'Ethereum upgrade scheduled for November'],
    ];
    for (const [a, b] of pairs) {
      expect(titleSimilarity(a, b)).toBeLessThan(SIMILARITY_THRESHOLD);
    }
  });

  it('separates two stories that share a subject but not an event', () => {
    // The threshold has to survive this: same ticker, opposite news.
    expect(titleSimilarity('Bitcoin rallies to a new high', 'Bitcoin slumps to a monthly low')).toBeLessThan(
      SIMILARITY_THRESHOLD,
    );
  });
});

describe('chooseCluster', () => {
  const base = { id: 'a', title: 'SEC approves spot bitcoin ETF', publishedAt: at(12) };

  it('joins the MOST similar candidate, not the first one seen', () => {
    // Otherwise which cluster a story joins depends on row order.
    const decision = chooseCluster(
      { id: 'new', title: 'SEC approves spot bitcoin ETF', publishedAt: at(13) },
      [
        { id: 'loose', title: 'SEC approves spot bitcoin ETF application from issuer', publishedAt: at(12) },
        { id: 'exact', title: 'SEC approves spot bitcoin ETF', publishedAt: at(12) },
      ],
    );
    expect(decision.joins?.id).toBe('exact');
    expect(decision.similarity).toBe(1);
  });

  it('starts its own cluster when nothing is similar enough', () => {
    const decision = chooseCluster({ id: 'new', title: 'CFTC fines an exchange', publishedAt: at(13) }, [base]);
    expect(decision.joins).toBeNull();
    expect(decision.similarity).toBe(0);
  });

  it('will not cluster across the 24 h window, however identical', () => {
    const decision = chooseCluster(
      { id: 'new', title: base.title, publishedAt: new Date(base.publishedAt.getTime() + CLUSTER_WINDOW_MS + 1) },
      [base],
    );
    expect(decision.joins).toBeNull();
  });

  it('clusters right up to the window edge', () => {
    const decision = chooseCluster(
      { id: 'new', title: base.title, publishedAt: new Date(base.publishedAt.getTime() + CLUSTER_WINDOW_MS) },
      [base],
    );
    expect(decision.joins?.id).toBe('a');
  });

  it('never clusters an item with itself', () => {
    expect(chooseCluster(base, [base]).joins).toBeNull();
  });

  it('holds the §10 threshold at 0.6', () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.6);
  });
});
