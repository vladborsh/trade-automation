import {
  FEAR_GREED_HISTORY_MAX, FEAR_GREED_ZONES, fearGreedZone, WebFearGreedCardSchema,
} from '../src/insight';
import fixture from './fixtures/fear-greed-card.json';

/**
 * IB-102 — the Fear & Greed card's contract: the zone table both sides read, and `history`. The
 * fixture keeps a missed venue day (2026-10-30 is absent): a gap stays a gap.
 */
describe('the Fear & Greed zones (alternative.me)', () => {
  it.each([
    [0, 'extreme_fear'], [24, 'extreme_fear'], [25, 'fear'], [44, 'fear'], [45, 'neutral'],
    [55, 'neutral'], [56, 'greed'], [75, 'greed'], [76, 'extreme_greed'], [100, 'extreme_greed'],
  ] as const)('%i → %s', (value, band) => {
    expect(fearGreedZone(value)).toBe(band);
  });

  it('five zones, contiguous, ending at 100', () => {
    expect(FEAR_GREED_ZONES.map((z) => z.upTo)).toEqual([24, 44, 55, 75, 100]);
  });

  it('clamps out-of-range readings instead of inventing a sixth zone', () => {
    expect([fearGreedZone(-5), fearGreedZone(140)]).toEqual(['extreme_fear', 'extreme_greed']);
  });
});

describe('WebFearGreedCard.history', () => {
  it("the fixture parses, oldest first, ending with now, with the venue's missed day left out", () => {
    const card = WebFearGreedCardSchema.parse(fixture);
    const days = card.history.map((r) => r.day);
    expect(days).toEqual([...days].sort());
    expect(card.history.at(-1)).toEqual(card.now);
    expect(days).not.toContain('2026-10-30');
  });

  it('is required, and at most 31 days', () => {
    const { history: _history, ...without } = fixture;
    expect(WebFearGreedCardSchema.safeParse(without).success).toBe(false);
    const day = (i: number) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, value: 50, classification: 'Neutral' });
    expect(WebFearGreedCardSchema.safeParse({ ...fixture, history: Array.from({ length: FEAR_GREED_HISTORY_MAX }, (_, i) => day(i % 31)) }).success).toBe(true);
    expect(WebFearGreedCardSchema.safeParse({ ...fixture, history: Array.from({ length: FEAR_GREED_HISTORY_MAX + 1 }, (_, i) => day(i % 31)) }).success).toBe(false);
  });
});
