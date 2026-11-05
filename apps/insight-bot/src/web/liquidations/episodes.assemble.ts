import {
  WEB_LIQUIDATION_EPISODES_CAP, WEB_LIQUIDATION_EPISODE_PRINTS,
  type WebLiquidationEpisode, type WebLiquidationEpisodeNorm, type WebLiquidationEpisodesQuery, type WebLiquidationEpisodesResponse,
} from '@trade-automation/contracts';
import type { EpisodeCandidate } from './episodes.group';

/**
 * IB-133 (liquidation-episodes design E3–E5, E7) — one filter set's answer from the period's
 * candidates, which were grouped ONCE over the whole market (E5: a filter never splits an episode).
 *
 * - norm `collecting`: no episodes at all;
 * - an episode is a candidate with `usd ≥ T`;
 * - side keeps that side; coin / venue keep the episodes CONTAINING it, with whole-episode figures;
 * - `minUsd` touches `prints` only;
 * - `summary` counts every survivor BEFORE the cap; the cap keeps the largest by sum.
 *
 * `price` is left null here; the service fills it for the shown episodes only.
 */
export function episodesAnswer(args: {
  asOf: number;
  candidates: readonly EpisodeCandidate[];
  norm: WebLiquidationEpisodeNorm;
  query: WebLiquidationEpisodesQuery;
}): { response: WebLiquidationEpisodesResponse; shown: EpisodeCandidate[] } {
  const { asOf, candidates, norm, query } = args;
  const survivors = norm.status !== 'ready' ? [] : candidates
    .filter((c) => c.usd >= norm.thresholdUsd)
    .filter((c) => query.side === 'all' || c.side === query.side)
    .filter((c) => query.symbol === 'all' || c.coins.some((x) => x.symbol === query.symbol))
    .filter((c) => query.venue === 'all' || c.venues.some((v) => v.venue === query.venue))
    .sort((a, b) => b.usd - a.usd || b.fromMs - a.fromMs);
  const shown = survivors.slice(0, WEB_LIQUIDATION_EPISODES_CAP[query.period]);
  const shorts = survivors.filter((c) => c.side === 'short').length;
  return {
    shown,
    response: {
      asOf,
      query,
      norm,
      summary: { count: survivors.length, shorts, longs: survivors.length - shorts, largestId: shown[0]?.id ?? null },
      episodes: shown.map((c) => toWire(c, query.minUsd)),
      folded: survivors.length - shown.length,
    },
  };
}

function toWire(c: EpisodeCandidate, minUsd: number): WebLiquidationEpisode {
  return {
    id: c.id,
    side: c.side,
    from: Math.floor(c.fromMs / 1000),
    to: Math.floor(c.toMs / 1000),
    count: c.count,
    usd: c.usd,
    coins: c.coins.map((x) => ({ base: x.base, symbol: x.symbol, usd: x.usd })),
    venues: c.venues.map((v) => ({ venue: v.venue, pct: v.pct })),
    perMinute: c.perMinute,
    price: null,
    prints: c.prints
      .filter((p) => p.usd >= minUsd)
      .slice(0, WEB_LIQUIDATION_EPISODE_PRINTS)
      .map((p) => ({ time: Math.floor(p.timeMs / 1000), base: p.base, venue: p.venue, usd: p.usd })),
  };
}
