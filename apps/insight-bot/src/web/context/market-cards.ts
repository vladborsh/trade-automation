import { FEAR_GREED_HISTORY_MAX } from '@trade-automation/contracts';
import type {
  WebBtcVsTopCard,
  WebDominanceCard,
  WebDominancePoint,
  WebFearGreedCard,
  WebFearGreedPoint,
  WebMarketCapCurrent,
  WebMarketCapDay,
} from '@trade-automation/contracts';

/**
 * IB-037 (§12.1, ruling 2026-10-07) — the market cards are built here, server-side and pure, so the
 * client renders a payload and derives nothing.
 *
 * The shape follows one rule: **a figure arrives with the instant it was measured, and a change it
 * cannot compute is `null`, never 0.** These series are snapshots of other people's numbers —
 * alternative.me publishes once a day, CoinGecko's dominance is collected forward and cannot be
 * backfilled — so "we do not know yet" is a real answer and the cards say it in words.
 */

const DAY_MS = 86_400_000;
const BTC = 'bitcoin';

/** `YYYY-MM-DD` shifted by whole days, in UTC. */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Fear & Greed: today's reading plus the two a sentence needs.
 *
 * `previous` is the previous **published** day rather than "yesterday": the venue has missed days
 * before, and a card that said «вчера» about a reading from three days ago would be lying in a way
 * nobody could see. Seven days back is looked up by date, and is simply absent when not held.
 */
export function fearGreedCard(points: readonly WebFearGreedPoint[]): WebFearGreedCard | null {
  if (points.length === 0) return null;
  const byDay = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const now = byDay[byDay.length - 1];
  const previous = byDay.length > 1 ? byDay[byDay.length - 2] : null;
  const weekAgoDay = shiftDay(now.day, -7);
  const weekAgo = byDay.find((p) => p.day === weekAgoDay) ?? null;

  return {
    now: { day: now.day, value: now.value, classification: now.classification },
    previous: previous && { day: previous.day, value: previous.value, classification: previous.classification },
    weekAgo: weekAgo && { day: weekAgo.day, value: weekAgo.value, classification: weekAgo.classification },
    // IB-102: the published days themselves, oldest first, ending with `now`; a missed day stays missing
    history: byDay.slice(-FEAR_GREED_HISTORY_MAX).map((p) => ({ day: p.day, value: p.value, classification: p.classification })),
    source: 'alternative.me',
  };
}

/**
 * BTC dominance from the forward-only global series.
 *
 * The deltas are in **percentage points**, not percent-of-percent: dominance is already a percentage,
 * and "BTC dominance rose 2 %" is ambiguous where "rose 2 points" is not. `coverageDays` is what the
 * card shows instead of a delta it cannot have — a database that started yesterday cannot know the
 * 7-day move, and §10 says this series can never be reconstructed.
 */
export function dominanceCard(
  points: readonly WebDominancePoint[],
  firstSampleMs: number | null,
  nowMs: number,
): WebDominanceCard | null {
  if (points.length === 0) return null;
  // a sample whose btcPct the venue omitted cannot be the card's headline number: §10 keeps it null
  // rather than 0, and a card showing "0 %" dominance would be a lie with a confident face
  const sorted = [...points].filter((p) => p.btcPct !== null).sort((a, b) => a.ts - b.ts);
  const latest = sorted[sorted.length - 1];
  if (!latest || latest.btcPct === null) return null;

  const at = (ms: number): WebDominancePoint | null => {
    // the nearest sample at or before the target, and only if it is within half a day of it —
    // otherwise the "24h ago" figure is really "whenever we last collected", which is not the same
    const target = sorted.filter((p) => p.ts <= ms).at(-1);
    return target && ms - target.ts <= DAY_MS / 2 ? target : null;
  };
  const dayAgo = at(latest.ts - DAY_MS);
  const weekAgo = at(latest.ts - 7 * DAY_MS);
  const points_ = (then: number | null | undefined, now: number | null | undefined): number | null =>
    then === null || then === undefined || now === null || now === undefined ? null : now - then;

  return {
    btcPct: latest.btcPct,
    ethPct: latest.ethPct ?? null,
    totalUsd: latest.totalUsd ?? null,
    atMs: latest.ts,
    changePct24h: points_(dayAgo?.btcPct, latest.btcPct),
    changePct7d: points_(weekAgo?.btcPct, latest.btcPct),
    totalChangePct24h:
      dayAgo?.totalUsd && latest.totalUsd ? ((latest.totalUsd - dayAgo.totalUsd) / dayAgo.totalUsd) * 100 : null,
    coverageDays: firstSampleMs === null ? 0 : Math.max(0, Math.floor((nowMs - firstSampleMs) / DAY_MS)),
    source: 'coingecko',
  };
}

/**
 * BTC's share of the top-20 caps actually held.
 *
 * `coinsCounted` is the point of the card as much as the percentage is: the collector can be behind,
 * and a share of three coins is not a share of twenty. The deltas compare against days with the
 * **same** coverage — comparing a 20-coin day with a 3-coin day would produce a swing that is an
 * artefact of collection, not a market move, which is the worst kind of wrong number because it
 * looks like news.
 */
export function btcVsTopCard(days: readonly WebMarketCapDay[], coinsExpected: number): WebBtcVsTopCard | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const latest = sorted[sorted.length - 1];
  const shareOf = (day: WebMarketCapDay | undefined): number | null => {
    const btc = day?.coins.find((c) => c.coin === BTC);
    return btc?.share === undefined || btc.share === null ? null : btc.share * 100;
  };
  const sharePct = shareOf(latest);
  if (sharePct === null) return null;

  const comparable = (offset: number): WebMarketCapDay | undefined => {
    const day = sorted.find((d) => d.day === shiftDay(latest.day, -offset));
    return day && day.coinsCounted === latest.coinsCounted ? day : undefined;
  };
  const delta = (offset: number): number | null => {
    const then = shareOf(comparable(offset));
    return then === null ? null : sharePct - then;
  };

  return {
    sharePct,
    day: latest.day,
    coinsCounted: latest.coinsCounted,
    coinsExpected,
    changePct7d: delta(7),
    changePct30d: delta(30),
    source: 'coingecko',
  };
}

/** The newest caps, largest first — a small table on the card, not a series. */
export function capsCard(current: readonly WebMarketCapCurrent[]): WebMarketCapCurrent[] {
  return [...current].sort((a, b) => (b.capUsd ?? -1) - (a.capUsd ?? -1));
}
