import type { WebCoinShare, WebMarketCapCurrent, WebMarketCapDay } from '@trade-automation/contracts';

/**
 * IB-037 (design §10) — the derived shares, computed at read time and never stored.
 *
 * Pure on purpose: these are the only figures on the market page that no venue sent us, so they
 * are the only ones that can be wrong in a way no collector would catch. They live here, away
 * from SQL and Nest, with the edge cases spelled out in `market-shares.spec.ts`.
 *
 * The rules, each of which exists because the honest answer differs from the convenient one:
 *
 * - **A missing cap is `null`, never 0.** A coin CoinGecko returned a price but no cap for has an
 *   unknown share, and a 0 % slice in a stacked chart is a claim we cannot support. It is also
 *   left out of the denominator, so the remaining shares still sum to 1 among the coins we
 *   actually hold — rather than every slice quietly shrinking to make room for a coin we know
 *   nothing about.
 * - **The denominator is Σ of the top-20 caps HELD THAT DAY**, and `coinsCounted` says how many
 *   that was. §10 asks for "BTC share of Σ top-20"; on a day when only 12 coins were collected
 *   that is a share of 12, and the page can say so instead of implying 20.
 * - **`btcShare` is not `/global`'s BTC dominance** and the two are never mixed: dominance is
 *   BTC over the whole market (thousands of coins, forward-collected every 10 min), this is BTC
 *   over the top 20 (365 days, daily). The page draws both, labelled apart.
 */

/** The Coingecko id of Bitcoin, as `universe.yaml` maps it. */
export const BITCOIN_ID = 'bitcoin';

/** One stored `market_cap_coin` row, as the reads hand it over. */
export interface CoinCapRow {
  day: string;
  coin: string;
  capUsd: number | null;
  priceUsd: number | null;
}

/**
 * Groups the rows by day and derives each coin's share of that day's Σ top-20.
 *
 * `coins` is the order the caller wants the slices stacked in (the universe's rank), so the
 * chart's band order is stable across days even as caps move; a coin with no row that day is
 * present with `capUsd: null` rather than absent, because a hole in a stacked chart must be
 * visible as a hole.
 */
export function marketCapDays(rows: readonly CoinCapRow[], coins: readonly string[]): WebMarketCapDay[] {
  const byDay = new Map<string, Map<string, CoinCapRow>>();
  for (const row of rows) {
    const day = byDay.get(row.day) ?? new Map<string, CoinCapRow>();
    day.set(row.coin, row);
    byDay.set(row.day, day);
  }

  return [...byDay.keys()].sort().map((day) => {
    const held = byDay.get(day) as Map<string, CoinCapRow>;
    const capOf = (coin: string): number | null => {
      const cap = held.get(coin)?.capUsd;
      return cap === undefined || cap === null || !Number.isFinite(cap) || cap < 0 ? null : cap;
    };

    const counted = coins.filter((coin) => capOf(coin) !== null);
    const totalUsd = counted.reduce((sum, coin) => sum + (capOf(coin) as number), 0);
    const share = (coin: string): number | null => {
      const cap = capOf(coin);
      // A zero denominator is "we hold nothing for this day", not "everything is 0 %".
      return cap === null || totalUsd <= 0 ? null : cap / totalUsd;
    };

    const coinShares: WebCoinShare[] = coins.map((coin) => ({ coin, capUsd: capOf(coin), share: share(coin) }));
    return { day, totalUsd, coinsCounted: counted.length, coins: coinShares, btcShare: share(BITCOIN_ID) };
  });
}

/**
 * The current table: the newest day's caps and prices with 24 h and 7 d changes.
 *
 * A change is `null` when the comparison day is not held — the series is daily and young, and a
 * missing yesterday is not a 0 % move. Rows are ordered by cap, largest first; a coin with no cap
 * sorts last rather than being dropped, so the reader sees that we hold nothing for it.
 */
export function marketCapCurrent(days: readonly WebMarketCapDay[], rows: readonly CoinCapRow[]): WebMarketCapCurrent[] {
  const latest = days.at(-1);
  if (!latest) return [];
  const capOn = (day: WebMarketCapDay | undefined, coin: string): number | null =>
    day?.coins.find((c) => c.coin === coin)?.capUsd ?? null;
  const dayOffsetBack = (offset: number): WebMarketCapDay | undefined => {
    const target = shiftDay(latest.day, -offset);
    return days.find((d) => d.day === target);
  };
  const previous24h = dayOffsetBack(1);
  const previous7d = dayOffsetBack(7);
  // the price the venue sent for the newest day; the day rows carry caps only, because a share is
  // a share of caps and a price has no part in it
  const priceOf = new Map(rows.filter((r) => r.day === latest.day).map((r) => [r.coin, r.priceUsd ?? null]));

  return latest.coins
    .map((coin) => ({
      coin: coin.coin,
      capUsd: coin.capUsd,
      priceUsd: priceOf.get(coin.coin) ?? null,
      change24h: fractionalChange(capOn(previous24h, coin.coin), coin.capUsd),
      change7d: fractionalChange(capOn(previous7d, coin.coin), coin.capUsd),
      share: coin.share,
    }))
    .sort((a, b) => (b.capUsd ?? -1) - (a.capUsd ?? -1));
}

/** `(now - then) / then`, or null when either end is missing or `then` is 0 (an undefined move). */
export function fractionalChange(then: number | null, now: number | null): number | null {
  if (then === null || now === null || then <= 0) return null;
  return (now - then) / then;
}

/** `YYYY-MM-DD` shifted by whole days, in UTC. */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
