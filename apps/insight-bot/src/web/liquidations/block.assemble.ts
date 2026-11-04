import {
  WEB_MARKET_PERIODS, WEB_MARKET_PERIOD_SECONDS,
  type WebLiquidationHourBar, type WebLiquidationHourly, type WebLiquidationLargeEvent, type WebLiquidationNormBasis,
  type WebLiquidationPeriodTotals, type WebLiquidationSideStats, type WebLiquidationVerdict, type WebMarketPeriod,
} from '@trade-automation/contracts';
import { groupSeries } from '../../insights/liquidation-series';
import { rarity } from '../../insights/rarity';
import { RARITY_SHOW } from '../../insights/thresholds';
import { normBasis, sideStats } from './norm';
import { completeWindowStarts, sampleFor } from './overview.assemble';
import type { BucketRow, FeedRow, TrailingRow } from './pg/overview.repo';

/**
 * IB-084 (market-page design D8, D14) — the liquidation block for one `?period=`, as pure
 * functions over the repo's reads (each with its spec). The service decides WHICH rows (crypto
 * only, D6); nothing here sees a TradFi row except `periodTotals` for the `tradfi`/`unknown` lines.
 */

/** Σ over the trailing period, for one scope (`null` = every row given, unmapped included). */
export function periodTotals(rows: readonly TrailingRow[], periodSec: number, symbolId: string | null = null): WebLiquidationPeriodTotals {
  const scoped = symbolId === null ? rows : rows.filter((r) => r.symbolId === symbolId);
  const side = (s: 'long' | 'short') => scoped.filter((r) => r.side === s).reduce((sum, r) => sum + (r.usdByWindow[periodSec] ?? 0), 0);
  const long = side('long');
  const short = side('short');
  return { usd: long + short, long, short, events: scoped.reduce((n, r) => n + (r.eventsByWindow[periodSec] ?? 0), 0) };
}

/**
 * IB-BUG-025: the crypto in the period that is in NO shown coin row — universe coins below the
 * rows, and coins the universe does not list — summed from the rows themselves (never total minus
 * rows), with the distinct coins it holds. `coinOf` names a row's coin (universe id, or Binance's
 * base asset for an unlisted contract, so BTCUSDC and BTCUSDT would be one coin). Pure.
 */
export function otherCoins(
  rows: readonly TrailingRow[], periodSec: number, shown: ReadonlySet<string>, coinOf: (row: TrailingRow) => string,
): { totals: WebLiquidationPeriodTotals; coins: number } {
  const other = rows.filter((r) => r.symbolId === null || !shown.has(r.symbolId));
  const coins = new Set(other.filter((r) => (r.eventsByWindow[periodSec] ?? 0) > 0).map(coinOf));
  return { totals: periodTotals(other, periodSec), coins: coins.size };
}

export interface PeriodNorm {
  long: WebLiquidationSideStats;
  short: WebLiquidationSideStats;
  total: WebLiquidationSideStats;
  basis: WebLiquidationNormBasis;
}

/**
 * The period's «× от нормы» for one scope: trailing period ÷ median of complete aligned windows of
 * the period's own length. **7d always refuses `insufficient_history` (D14)**: 30 days hold four
 * 7-day windows, which is not a norm — refused here, by period, not by the data happening to be short.
 */
export function periodNorm(args: {
  period: WebMarketPeriod;
  totals: WebLiquidationPeriodTotals;
  /** Aligned buckets of length `periodSec`, restricted to the scope; ignored for 7d. */
  buckets: readonly BucketRow[];
  periodStartMs: number;
  nowMs: number;
  venues: readonly string[];
}): PeriodNorm {
  const periodSec = WEB_MARKET_PERIOD_SECONDS[args.period];
  const starts = args.period === '7d' ? [] : completeWindowStarts(args.periodStartMs, args.nowMs, periodSec);
  const periodDays = args.period === '7d' ? 0 : (starts.length * periodSec) / 86_400;
  const long = sideStats({ trailing: args.totals.long, alignedSums: sampleFor(args.buckets, starts, 'long'), periodDays });
  const short = sideStats({ trailing: args.totals.short, alignedSums: sampleFor(args.buckets, starts, 'short'), periodDays });
  const total = sideStats({ trailing: args.totals.usd, alignedSums: sampleFor(args.buckets, starts, null), periodDays });
  return { long, short, total, basis: normBasis({ periodDays, alignedSums: sampleFor(args.buckets, starts, null), venues: args.venues, sides: [long, short, total] }) };
}

/** D8(b): the side further above its own norm; null when neither side has a ratio. */
export function verdict(norm: Pick<PeriodNorm, 'long' | 'short'>): WebLiquidationVerdict | null {
  const sides = (['long', 'short'] as const)
    .map((side) => ({ side, ratio: norm[side].ratio }))
    .filter((s): s is { side: 'long' | 'short'; ratio: number } => s.ratio !== null);
  if (sides.length === 0) return null;
  return sides.reduce((a, b) => (b.ratio > a.ratio ? b : a));
}

/**
 * D8(a): market-wide bars over the period, aligned to `bucketSec` (an end that sticks out past the
 * period is `partial`). Each
 * complete bar gets its rarity within the norm sample — complete aligned buckets of the same length
 * over the norm period, **empty buckets counted as 0** — and `outlier` at `RARITY_SHOW`. Under 7
 * days of history there is no norm, so no rarity and no outlier, only bars.
 */
export function hourly(args: {
  periodSec: number;
  bucketSec: number;
  /** Aligned `bucketSec` buckets, market-wide, covering the norm period AND the display range. */
  buckets: readonly BucketRow[];
  periodStartMs: number;
  nowMs: number;
  venues: readonly string[];
}): WebLiquidationHourly {
  const { bucketSec, nowMs } = args;
  const w = bucketSec * 1000;
  const sampleStarts = completeWindowStarts(args.periodStartMs, nowMs, bucketSec);
  const periodDays = (sampleStarts.length * bucketSec) / 86_400;
  const sample = sampleFor(args.buckets, sampleStarts, null);
  const longNorm = sideStats({ trailing: 0, alignedSums: sampleFor(args.buckets, sampleStarts, 'long'), periodDays });
  const shortNorm = sideStats({ trailing: 0, alignedSums: sampleFor(args.buckets, sampleStarts, 'short'), periodDays });
  const totalNorm = sideStats({ trailing: 0, alignedSums: sample, periodDays });
  const basis = normBasis({ periodDays, alignedSums: sample, venues: args.venues, sides: [longNorm, shortNorm, totalNorm] });
  const measurable = basis.unavailable !== 'insufficient_history';

  // every aligned bucket that overlaps the period [now − P, now); one sticking out past either end
  // is partial — so with `now` on a boundary the bars are exactly the period and sum to its total
  const periodFrom = nowMs - args.periodSec * 1000;
  const first = Math.floor(periodFrom / w) * w;
  const bars: WebLiquidationHourBar[] = [];
  for (let t = first; t < nowMs; t += w) {
    const long = sampleFor(args.buckets, [t], 'long')[0] ?? 0;
    const short = sampleFor(args.buckets, [t], 'short')[0] ?? 0;
    const partial = t < periodFrom || t + w > nowMs;
    const r = measurable && !partial ? rarity(long + short, sample) : null;
    bars.push({ time: t / 1000, long, short, partial, rarity: r, outlier: r !== null && r >= RARITY_SHOW });
  }
  return {
    bucketSec,
    buckets: bars,
    norm: { long: measurable ? longNorm.median : null, short: measurable ? shortNorm.median : null, total: measurable ? totalNorm.median : null },
    basis,
  };
}

/**
 * D8(c): the period's largest events, biggest first, each with `xMedian` (÷ the median single
 * event over the norm period, null under 7 days of history) and its series from `groupSeries`
 * (computed over ALL candidates of the period, so a series is found even when only some of its
 * members make the top `limit`).
 */
export function largeEvents(args: {
  events: readonly FeedRow[];
  minUsd: number;
  limit: number;
  medianEventUsd: number | null;
  normPeriodDays: number;
  minHistoryDays: number;
}): WebLiquidationLargeEvent[] {
  const keyed = args.events.map((e, i) => ({ e, key: String(i) }));
  const series = groupSeries(keyed.map(({ e, key }) => ({ key, timeSec: e.timeSec, side: e.side, usd: e.usd })));
  const seriesOf = new Map<string, { id: string; count: number; spanSec: number }>();
  for (const s of series) for (const key of s.keys) seriesOf.set(key, { id: s.id, count: s.count, spanSec: s.spanSec });
  const median = args.normPeriodDays >= args.minHistoryDays && args.medianEventUsd !== null && args.medianEventUsd > 0 ? args.medianEventUsd : null;

  return keyed
    .filter(({ e }) => e.usd >= args.minUsd)
    .sort((a, b) => b.e.usd - a.e.usd || b.e.timeSec - a.e.timeSec)
    .slice(0, args.limit)
    .map(({ e, key }) => {
      const s = seriesOf.get(key);
      return {
        time: e.timeSec,
        symbol: e.symbolId ?? e.venueSymbol,
        base: e.base ?? e.venueSymbol,
        side: e.side,
        usd: e.usd,
        price: e.price,
        venue: e.venue,
        xMedian: median === null ? null : e.usd / median,
        seriesId: s?.id ?? null,
        seriesCount: s?.count ?? 0,
        seriesSpanSec: s?.spanSec ?? 0,
      };
    });
}

/**
 * D14: when each period first has one complete window of tape, from the earliest crypto row seen.
 * Null = available now. With no row at all, the earliest possible is a full period from now.
 */
export function availableFrom(firstSeenMs: number | null, nowMs: number): Record<WebMarketPeriod, number | null> {
  const out = {} as Record<WebMarketPeriod, number | null>;
  for (const p of WEB_MARKET_PERIODS) {
    const ready = (firstSeenMs ?? nowMs) + WEB_MARKET_PERIOD_SECONDS[p] * 1000;
    out[p] = ready <= nowMs ? null : Math.floor(ready / 1000);
  }
  return out;
}
