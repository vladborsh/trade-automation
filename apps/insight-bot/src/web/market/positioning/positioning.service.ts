import { Logger } from '@nestjs/common';
import {
  WEB_MARKET_PERIOD_SECONDS, type WebMarketPeriod, type WebPositioningCell, type WebPositioningResponse, type WebPositioningRow,
} from '@trade-automation/contracts';
import type { UniverseSymbol } from '../../../config/universe.schema';
import {
  POSITIONING_BASELINE_CACHE_MS, POSITIONING_BASELINE_DAYS, POSITIONING_CURRENT_CACHE_MS, POSITIONING_MIN_HISTORY_DAYS,
} from '../../../insights/thresholds';
import type { TtlCache } from '../../../venues/ttl-cache';
import type { LiquidationsOverviewService } from '../../liquidations/overview.service';
import type { CandlesService } from '../candles.service';
import type { FundingService } from '../funding.service';
import type { OiLsService } from '../oi-ls.service';
import type { UniverseSummaryService } from '../universe-summary.service';
import { cell, changeRarity, levelRarity, quadrantOf, rollingChangesPct, signalOf } from './positioning.rules';

/**
 * IB-085 (market-page design D9) — `GET /api/web/market/positioning?period=`: one row per CRYPTO
 * universe coin (D6), each cell with its two-sided rarity against the coin's own 30 days.
 *
 * **Reads, all existing services, nothing new against a venue:**
 * | read | via | cached | Binance weight |
 * |---|---|---|---|
 * | 1 h klines × 720 (price baseline + reference price) | CandlesService | 1 h | 10 / coin / h |
 * | settled funding 30 d (funding baseline) | FundingService (Binance only) | 1 h | 1 / coin / h |
 * | OI + 2 L/S kinds, 30 d at 1 h (baselines) | OiLsService (IB-080 path) | 1 h | 3 `/futures/data` / coin / h |
 * | OI over the period + 2 L/S kinds, last 2 h (current) | OiLsService | its 5 min | 3 `/futures/data` / coin / 5 min |
 * | last price + current funding (premiumIndex, ticker/24hr) | UniverseSummaryService | its 60 s | shared, unchanged |
 * | liquidations over the period + their sample | LiquidationsOverviewService | 5 s | 0 (our tape) |
 * At 30 coins: ≈ 5.5 weight/min of `fapi` (klines + funding) and ≈ 19.5 calls/min of `/futures/data`
 * on average — arithmetic from the documented weights; the measured figure is in the IB-085 report.
 *
 * **Minimums (D3):** a rarity needs ≥ 20 days of the coin's own series, else `insufficient_history`.
 * A 7d change has no rarity: 30 days hold four 7-day windows (the D14 rule for liquidations, applied
 * to every change). The value is still shown.
 */
export interface PositioningOptions {
  symbols: readonly UniverseSymbol[];
  cache: TtlCache;
  summary: UniverseSummaryService;
  candles: CandlesService;
  funding: FundingService;
  oiLs: OiLsService;
  liquidations: LiquidationsOverviewService | null;
  now?: () => number;
}

interface Baseline {
  /** Hourly closes, oldest first, and the open time of each (ms). */
  closes: number[];
  closeTimes: number[];
  oiHourly: number[];
  lsGlobalHourly: number[];
  lsTopHourly: number[];
  fundingSettled: number[];
}

const H = 3_600_000;
const CONCURRENCY = 4;

export class PositioningService {
  private readonly logger = new Logger(PositioningService.name);
  private readonly now: () => number;
  private baselinesAt: number | null = null;

  constructor(private readonly options: PositioningOptions) {
    this.now = options.now ?? Date.now;
  }

  private get coins(): UniverseSymbol[] {
    return this.options.symbols.filter((s) => s.asset_class === 'crypto');
  }

  async positioning(period: WebMarketPeriod): Promise<WebPositioningResponse> {
    return this.options.cache.getOrLoad(`positioning:${period}`, POSITIONING_CURRENT_CACHE_MS, () => this.compute(period));
  }

  private async compute(period: WebMarketPeriod): Promise<WebPositioningResponse> {
    const now = this.now();
    const coins = this.coins;
    const [baselines, summary, liq] = await Promise.all([
      this.baselines(),
      this.options.summary.summary(coins.map((c, i) => ({ id: c.id, base: c.base, volumeRank: c.volume_rank ?? i + 1 })))
        .catch((error: unknown) => { this.logger.warn(`summary failed: ${(error as Error).message}`); return null; }),
      this.options.liquidations?.coinPeriodSamples(period).catch(() => null) ?? Promise.resolve(null),
    ]);
    const current = await mapLimited(coins, CONCURRENCY, (c) => this.currentFor(c.id, period, now));
    const rows = coins.map((coin, i) => this.row(coin, period, now, baselines.get(coin.id) ?? null,
      summary?.rows.find((r) => r.id === coin.id) ?? null, current[i] as Current, liq?.get(coin.id) ?? null));
    return {
      period,
      asOf: Math.floor(now / 1000),
      baselinesAsOf: this.baselinesAt === null ? null : Math.floor(this.baselinesAt / 1000),
      rows,
    };
  }

  private row(
    coin: UniverseSymbol, period: WebMarketPeriod, now: number, base: Baseline | null,
    summary: { lastPrice: number | null; fundingRate: number | null } | null, current: Current,
    liq: { usd: number; sample: number[]; days: number } | null,
  ): WebPositioningRow {
    const steps = WEB_MARKET_PERIOD_SECONDS[period] / 3_600;
    const enoughHours = (n: number) => n >= POSITIONING_MIN_HISTORY_DAYS * 24;
    const changeSample = (series: readonly number[] | undefined) =>
      period === '7d' || !series || !enoughHours(series.length) ? null : rollingChangesPct(series, steps);

    // price: the last price now vs the close of the 1h bar that ended at (or just before) now − P
    const ref = base ? refClose(base, now - WEB_MARKET_PERIOD_SECONDS[period] * 1000) : null;
    const price = summary?.lastPrice ?? null;
    const priceChange = price !== null && ref !== null && ref > 0 ? (price / ref - 1) * 100 : null;
    const priceChangePct = cell(priceChange, changeSample(base?.closes), changeRarity);

    const oiChangePct = cell(current.oiChangePct, changeSample(base?.oiHourly), changeRarity);
    const fundingSample = base && base.fundingSettled.length >= POSITIONING_MIN_HISTORY_DAYS * 3 ? base.fundingSettled : null;
    const fundingRate = cell(summary?.fundingRate ?? null, fundingSample, levelRarity);
    const levelSample = (s: readonly number[] | undefined) => (s && enoughHours(s.length) ? s : null);
    const lsGlobal = cell(current.lsGlobal, levelSample(base?.lsGlobalHourly), levelRarity);
    const lsTopPosition = cell(current.lsTop, levelSample(base?.lsTopHourly), levelRarity);
    const liqUsd = liq === null
      ? cell(null, null, levelRarity, this.options.liquidations ? 'venue_unavailable' : 'not_listed')
      : cell(liq.usd, period !== '7d' && liq.days >= POSITIONING_MIN_HISTORY_DAYS ? liq.sample : null, levelRarity);

    const quadrant = quadrantOf(priceChangePct.value, oiChangePct.value, fundingRate.value);
    const cells: WebPositioningCell[] = [priceChangePct, oiChangePct, fundingRate, lsGlobal, lsTopPosition, liqUsd];
    return {
      symbol: coin.id, base: coin.base, priceChangePct, oiChangePct, fundingRate, lsGlobal, lsTopPosition, liqUsd,
      quadrant, signal: signalOf({ quadrant, priceChangePct, fundingRate, lsGlobal, cells }),
    };
  }

  /** The hourly baselines for every coin, rebuilt once an hour (D9). A coin whose reads fail is absent. */
  private async baselines(): Promise<Map<string, Baseline>> {
    return this.options.cache.getOrLoad('positioning:baselines', POSITIONING_BASELINE_CACHE_MS, async () => {
      const now = this.now();
      const from = Math.floor((now - POSITIONING_BASELINE_DAYS * 24 * H) / H) * H;
      const coins = this.coins;
      const built = await mapLimited(coins, CONCURRENCY, async (c): Promise<Baseline | null> => {
        try {
          const [candles, oi, lsG, lsT, funding] = await Promise.all([
            this.options.candles.candles('perp', c.binance_perp, '1h', from, now),
            this.options.oiLs.openInterest(c.binance_perp, from, now),
            this.options.oiLs.longShort(c.binance_perp, 'global_account', from, now),
            this.options.oiLs.longShort(c.binance_perp, 'top_position', from, now),
            this.options.funding.binanceSettledHistory(c.binance_perp, from, now),
          ]);
          const closed = candles.filter((k) => (k.time + 3_600) * 1000 <= now);
          return {
            closes: closed.map((k) => k.close),
            closeTimes: closed.map((k) => k.time * 1000),
            oiHourly: oi.points.map((p) => p.value),
            lsGlobalHourly: lsG.points.map((p) => p.ratio),
            lsTopHourly: lsT.points.map((p) => p.ratio),
            fundingSettled: funding.map((p) => p.rate),
          };
        } catch (error) {
          this.logger.warn(`positioning baseline ${c.id}: ${(error as Error).message}`);
          return null;
        }
      });
      this.baselinesAt = now;
      return new Map(coins.flatMap((c, i) => (built[i] ? [[c.id, built[i] as Baseline] as const] : [])));
    });
  }

  /** Current OI change over the period and the latest L/S, each `null` when the venue did not answer. */
  private async currentFor(symbol: string, period: WebMarketPeriod, now: number): Promise<Current> {
    const p = WEB_MARKET_PERIOD_SECONDS[period] * 1000;
    const settle = async <T>(f: () => Promise<T>): Promise<T | null> => f().catch(() => null);
    const [oi, lsG, lsT] = await Promise.all([
      settle(() => this.options.oiLs.openInterest(symbol, now - p - 15 * 60_000, now)),
      settle(() => this.options.oiLs.longShort(symbol, 'global_account', now - 2 * H, now)),
      settle(() => this.options.oiLs.longShort(symbol, 'top_position', now - 2 * H, now)),
    ]);
    let oiChangePct: number | null = null;
    if (oi && oi.points.length >= 2) {
      const start = oi.points.find((x) => x.time * 1000 >= now - p) ?? oi.points[0];
      const last = oi.points[oi.points.length - 1];
      if (start && last && start.value > 0 && last.time > start.time) oiChangePct = (last.value / start.value - 1) * 100;
    }
    return {
      oiChangePct,
      lsGlobal: lsG?.points.at(-1)?.ratio ?? null,
      lsTop: lsT?.points.at(-1)?.ratio ?? null,
    };
  }
}

interface Current {
  oiChangePct: number | null;
  lsGlobal: number | null;
  lsTop: number | null;
}

/** The close of the last complete 1 h bar that ended at or before `atMs`; null when none is held. */
export function refClose(base: Pick<Baseline, 'closes' | 'closeTimes'>, atMs: number): number | null {
  for (let i = base.closeTimes.length - 1; i >= 0; i--) {
    if ((base.closeTimes[i] as number) + H <= atMs) return base.closes[i] as number;
  }
  return null;
}

/** `Promise.all` with at most `limit` in flight — 30 coins must not become 150 simultaneous requests. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
