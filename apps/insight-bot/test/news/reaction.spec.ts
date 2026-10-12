import { anchorSkewSec, computeReaction, reactionWindow, type ReactionInput } from '../../src/news/reaction';

/**
 * IB-027 — the measured move after a story.
 *
 * **Positive control (IB-027 rule).** This spec carries fixtures that MUST produce a number, not
 * only ones that must refuse. A reaction engine tested only on refusals is unfalsifiable in exactly
 * the way the cashtag matcher was: one that refuses everything passes every refusal test.
 *
 * The refusals matter just as much, because this table feeds the AI-1 calibration — it is where an
 * attribution error becomes a correlation and a correlation becomes a feature.
 */

const PUBLISHED = new Date('2026-10-12T12:00:00Z');
const FIRST_SEEN = new Date('2026-10-12T12:03:00Z'); // three minutes later, an ordinary poll lag

const input = (over: Partial<ReactionInput> = {}): ReactionInput => ({
  horizon: '1h',
  publishedAt: PUBLISHED,
  firstSeenAt: FIRST_SEEN,
  priceAtAnchor: 100,
  priceAtHorizon: 103,
  windowClosed: true,
  windowCovered: true,
  symbolSpelling: 'BTCUSDT',
  othersInWindow: 0,
  ...over,
});

describe('a measured reaction', () => {
  it('computes the percentage move over the horizon', () => {
    const r = computeReaction(input());
    expect(r.returnPct).toBeCloseTo(3, 10);
    expect(r.refused).toBeNull();
  });

  it('measures a fall as a negative number, not an absolute one', () => {
    expect(computeReaction(input({ priceAtHorizon: 97 })).returnPct).toBeCloseTo(-3, 10);
  });

  it('reports a genuine zero as zero, distinct from a refusal', () => {
    // "the market did not move" and "we cannot say" are different claims; anything averaging them
    // together would be measuring its own ignorance
    const flat = computeReaction(input({ priceAtHorizon: 100 }));
    expect(flat.returnPct).toBe(0);
    expect(flat.refused).toBeNull();
  });
});

describe('the anchor, because published_at is the publisher\'s claim', () => {
  it('defaults to our first-seen instant, not the publisher\'s timestamp', () => {
    // a window anchored on a self-reported stamp can contain price action from before the news was
    // knowable — measuring what CAUSED the publication rather than what it caused
    const r = computeReaction(input());
    expect(r.anchor).toBe('first_seen');
    expect(r.anchorAt).toEqual(FIRST_SEEN);
  });

  it('uses published_at when asked, and says so in the row', () => {
    const r = computeReaction(input({ anchor: 'published' }));
    expect(r.anchor).toBe('published');
    expect(r.anchorAt).toEqual(PUBLISHED);
  });

  it('records how far the two anchors disagree, so a suspect one is visible', () => {
    expect(computeReaction(input()).anchorSkewSec).toBe(180);
    // a feed back-dating by six hours: still computable, but the row now says it is odd
    const backdated = computeReaction(input({ publishedAt: new Date('2026-10-12T06:00:00Z') }));
    expect(backdated.anchorSkewSec).toBe(6 * 3600 + 180);
    expect(backdated.returnPct).not.toBeNull();
  });

  it('signs the skew so a stamp AFTER our first sight is distinguishable', () => {
    // a publisher clock running fast, which is a different fault from a slow feed
    expect(anchorSkewSec(new Date('2026-10-12T12:05:00Z'), new Date('2026-10-12T12:00:00Z'))).toBe(-300);
  });
});

describe('an article first seen long after publication (live-pass ruling)', () => {
  // Threshold is 7 days, bracketed by measurement: news outlets lag 0.4-1.2 d, exchange
  // announcement feeds 3.5-4.6 d, dormant Binance catalogs 109-388 d. Both sides are pinned so the
  // judgement cannot drift unnoticed in either direction.
  const daysOld = (d: number) => input({
    publishedAt: new Date(FIRST_SEEN.getTime() - d * 86_400_000),
  });

  it('still measures an article inside the threshold — the positive control', () => {
    // 6 days: slower than any feed measured, still measurable
    const r = computeReaction(daysOld(6));
    expect(r.refused).toBeNull();
    expect(r.returnPct).toBeCloseTo(3, 10);
  });

  it('refuses one beyond it', () => {
    const r = computeReaction(daysOld(8));
    expect(r.refused).toBe('stale_at_ingest');
    expect(r.returnPct).toBeNull();
  });

  it('refuses a dormant-catalog item by a wide margin', () => {
    // the real case: a 2022 Binance airdrop announcement arriving today
    expect(computeReaction(daysOld(388)).refused).toBe('stale_at_ingest');
  });

  it('is NOT triggered by a publisher clock running fast', () => {
    // negative skew means the stamp is after our first sight; that is a different pathology and
    // must not be read as staleness
    const ahead = input({ publishedAt: new Date(FIRST_SEEN.getTime() + 600_000) });
    expect(ahead.publishedAt.getTime()).toBeGreaterThan(FIRST_SEEN.getTime());
    expect(computeReaction(ahead).refused).toBeNull();
  });

  it('is reported ahead of a missing spelling, since age makes the rest moot', () => {
    const r = computeReaction({ ...daysOld(400), symbolSpelling: null, windowClosed: false });
    expect(r.refused).toBe('stale_at_ingest');
  });
});

describe('refusals carry a reason and never a number', () => {
  it('refuses a window that has not closed yet, rather than measuring it early', () => {
    // a partial window does not fail; it understates the magnitude and looks like a real small
    // reaction. The row says the window is open, so it cannot be mistaken for a closed one.
    const r = computeReaction(input({ windowClosed: false }));
    expect(r.returnPct).toBeNull();
    expect(r.refused).toBe('window_not_closed');
  });

  it('reports an open window rather than a missing horizon price, which it causes', () => {
    const r = computeReaction(input({ windowClosed: false, priceAtHorizon: null }));
    expect(r.refused).toBe('window_not_closed');
  });

  it('refuses a window that cannot be shown covered', () => {
    // IB-BUG-010's coverage: a collection gap makes the magnitude confidently wrong, and the gap is
    // invisible in the output unless the output says so
    const r = computeReaction(input({ windowCovered: false }));
    expect(r.returnPct).toBeNull();
    expect(r.refused).toBe('window_not_covered');
  });

  it('refuses when the symbol has no spelling on that venue', () => {
    const r = computeReaction(input({ symbolSpelling: null }));
    expect(r.refused).toBe('no_venue_spelling');
  });

  it('reports the most fundamental absence, not the first one checked', () => {
    // no spelling AND no price: the spelling is why there is no price, and reporting
    // "no_price_at_anchor" would send someone looking at the price tape for a mapping bug
    const r = computeReaction(input({ symbolSpelling: null, priceAtAnchor: null, windowCovered: false }));
    expect(r.refused).toBe('no_venue_spelling');
  });

  it('refuses a missing price at either end', () => {
    expect(computeReaction(input({ priceAtAnchor: null })).refused).toBe('no_price_at_anchor');
    expect(computeReaction(input({ priceAtHorizon: null })).refused).toBe('no_price_at_horizon');
  });

  it('refuses a zero anchor price rather than dividing by it', () => {
    expect(computeReaction(input({ priceAtAnchor: 0 })).refused).toBe('no_price_at_anchor');
  });

  it('never returns both a number and a reason, or neither', () => {
    const cases = [input(), input({ windowCovered: false }), input({ priceAtHorizon: null }), input({ symbolSpelling: null })];
    for (const c of cases) {
      const r = computeReaction(c);
      expect(r.returnPct === null).toBe(r.refused !== null);
    }
  });
});

describe('confounders, as {count, of}', () => {
  it('carries the count and its denominator', () => {
    // three tagged stories in one window: the move belongs to none of them in particular, and a
    // consumer must be able to discard it rather than average it into noise
    const r = computeReaction(input({ othersInWindow: 2 }));
    expect(r.othersInWindow).toBe(2);
    expect(r.ofWindowItems).toBe(3); // this story plus the two others
  });

  it('an uncontested reaction is of 1, not of 0', () => {
    const r = computeReaction(input());
    expect(r.othersInWindow).toBe(0);
    expect(r.ofWindowItems).toBe(1);
  });

  it('counts confounders even on a refusal, since that is still evidence about the window', () => {
    const r = computeReaction(input({ windowCovered: false, othersInWindow: 4 }));
    expect(r.refused).toBe('window_not_covered');
    expect(r.ofWindowItems).toBe(5);
  });
});

describe('the window', () => {
  it('runs from the anchor forward by the horizon', () => {
    const w = reactionWindow(FIRST_SEEN, '4h');
    expect(w.from).toEqual(FIRST_SEEN);
    expect(w.to.toISOString()).toBe('2026-10-12T16:03:00.000Z');
  });

  it('is the horizon wide for each horizon', () => {
    expect(reactionWindow(FIRST_SEEN, '15m').to.getTime() - FIRST_SEEN.getTime()).toBe(900_000);
    expect(reactionWindow(FIRST_SEEN, '1h').to.getTime() - FIRST_SEEN.getTime()).toBe(3_600_000);
  });
});
