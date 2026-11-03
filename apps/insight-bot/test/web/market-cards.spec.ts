import type { WebDominancePoint, WebFearGreedPoint, WebMarketCapDay } from '@trade-automation/contracts';
import { btcVsTopCard, dominanceCard, fearGreedCard, shiftDay } from '../../src/web/context/market-cards';

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 12, 12, 0); // 2026-10-12T12:00Z

function fg(day: string, value: number, classification = 'Greed'): WebFearGreedPoint {
  return { day, value, classification };
}
function dom(ts: number, btcPct: number | null, totalUsd = 2_000_000_000_000): WebDominancePoint {
  return { ts, totalUsd, btcPct, ethPct: 13, dominance: {} } as WebDominancePoint;
}
function capDay(day: string, btcShare: number | null, coinsCounted: number): WebMarketCapDay {
  return {
    day,
    totalUsd: 1,
    coinsCounted,
    coins: [{ coin: 'bitcoin', capUsd: 1, share: btcShare }, { coin: 'ethereum', capUsd: 1, share: 0.1 }],
  } as WebMarketCapDay;
}

describe('fearGreedCard', () => {
  it('takes the newest published day as the headline', () => {
    const card = fearGreedCard([fg('2026-10-10', 44, 'Neutral'), fg('2026-10-12', 69)])!;
    expect(card.now).toEqual({ day: '2026-10-12', value: 69, classification: 'Greed' });
    expect(card.source).toBe('alternative.me');
  });

  it('uses the previous PUBLISHED day, not the calendar yesterday', () => {
    // the venue has missed days; a card saying «вчера» about a three-day-old reading would mislead
    const card = fearGreedCard([fg('2026-10-08', 30, 'Fear'), fg('2026-10-12', 69)])!;
    expect(card.previous).toMatchObject({ day: '2026-10-08', value: 30 });
  });

  it('finds a week ago by date, and leaves it null when that day is not held', () => {
    const withWeek = fearGreedCard([fg('2026-10-05', 50), fg('2026-10-11', 60), fg('2026-10-12', 69)])!;
    expect(withWeek.weekAgo).toMatchObject({ day: '2026-10-05', value: 50 });
    const without = fearGreedCard([fg('2026-10-11', 60), fg('2026-10-12', 69)])!;
    expect(without.weekAgo).toBeNull();
  });

  it('IB-102: history is the published days, oldest first, ending with now; a missed day stays missing', () => {
    const card = fearGreedCard([fg('2026-10-12', 69), fg('2026-10-10', 44, 'Neutral'), fg('2026-10-09', 40, 'Fear')])!;
    expect(card.history.map((r) => r.day)).toEqual(['2026-10-09', '2026-10-10', '2026-10-12']); // 10-11 never published
    expect(card.history.at(-1)).toEqual(card.now);
  });

  it('IB-102: history keeps at most the newest 31 days', () => {
    const days = Array.from({ length: 40 }, (_, i) => fg(shiftDay('2026-10-01', i), 50, 'Neutral'));
    const card = fearGreedCard(days)!;
    expect(card.history).toHaveLength(31);
    expect(card.history[0].day).toBe(shiftDay('2026-10-01', 9));
    expect(card.history.at(-1)!.day).toBe(card.now.day);
  });

  it('copes with a single day, and with none at all', () => {
    expect(fearGreedCard([fg('2026-10-12', 69)])).toMatchObject({ previous: null, weekAgo: null });
    expect(fearGreedCard([])).toBeNull();
  });
});

describe('dominanceCard', () => {
  it('reports the newest sample with the instant it was measured', () => {
    const card = dominanceCard([dom(T - DAY, 70), dom(T, 72)], T - 9 * DAY, T)!;
    expect(card.btcPct).toBe(72);
    expect(card.atMs).toBe(T);
    expect(card.source).toBe('coingecko');
  });

  it('gives the 24h and 7d moves in percentage POINTS', () => {
    const card = dominanceCard([dom(T - 7 * DAY, 68), dom(T - DAY, 70), dom(T, 72)], T - 9 * DAY, T)!;
    expect(card.changePct24h).toBe(2);
    expect(card.changePct7d).toBe(4);
  });

  it('returns null for a move whose comparison sample is missing, never 0', () => {
    const card = dominanceCard([dom(T, 72)], T, T)!;
    expect(card.changePct24h).toBeNull();
    expect(card.changePct7d).toBeNull();
  });

  it('refuses a comparison sample that is too far from the target to mean "24h ago"', () => {
    // the nearest earlier sample is three days old; calling that "24 h" would be a quiet lie
    const card = dominanceCard([dom(T - 3 * DAY, 60), dom(T, 72)], T - 3 * DAY, T)!;
    expect(card.changePct24h).toBeNull();
  });

  it('counts coverage in whole days, which is what the card says instead of an unknown delta', () => {
    expect(dominanceCard([dom(T, 72)], T - 4 * DAY - 1000, T)!.coverageDays).toBe(4);
    expect(dominanceCard([dom(T, 72)], null, T)!.coverageDays).toBe(0);
  });

  it('ignores samples the venue sent without a btcPct rather than reading them as 0', () => {
    expect(dominanceCard([dom(T, null)], T, T)).toBeNull();
    const card = dominanceCard([dom(T - DAY, 70), dom(T, null)], T - DAY, T)!;
    expect(card.btcPct).toBe(70); // the newest sample that actually carries the number
  });
});

describe('btcVsTopCard', () => {
  it('states the denominator alongside the share', () => {
    const card = btcVsTopCard([capDay('2026-10-12', 0.8349, 3)], 20)!;
    expect(card.sharePct).toBeCloseTo(83.49, 6);
    expect(card.coinsCounted).toBe(3);
    expect(card.coinsExpected).toBe(20);
  });

  it('compares only against days with the SAME coverage', () => {
    // a 3-coin day against a 20-coin day would show a swing that is collection, not market
    const days = [capDay('2026-10-05', 0.6, 20), capDay('2026-10-12', 0.8349, 3)];
    expect(btcVsTopCard(days, 20)!.changePct7d).toBeNull();
  });

  it('computes the move when coverage matches', () => {
    const days = [capDay('2026-10-05', 0.8, 20), capDay('2026-10-12', 0.82, 20)];
    expect(btcVsTopCard(days, 20)!.changePct7d).toBeCloseTo(2, 6);
  });

  it('returns null when the newest day holds no BTC share at all', () => {
    expect(btcVsTopCard([capDay('2026-10-12', null, 2)], 20)).toBeNull();
    expect(btcVsTopCard([], 20)).toBeNull();
  });
});

describe('shiftDay', () => {
  it('moves whole UTC days across a month boundary', () => {
    expect(shiftDay('2026-10-01', -7)).toBe('2026-09-24');
    expect(shiftDay('2026-10-12', -30)).toBe('2026-09-12');
  });
});
