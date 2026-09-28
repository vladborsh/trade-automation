import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import type { WebFearGreedResponse, WebMarketCapResponse } from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import { coinCapsBetween, dominanceBetween, dominanceStart, fearGreedBetween, latestFearGreed } from '../../db/pg/web-context-reads';
import { DAY_MS, thin } from '../series/range';
import { marketCapCurrent, marketCapDays } from './market-shares';

/**
 * IB-037 (design §2, §4, §10) — the market-context page's reads: Fear & Greed, BTC dominance and
 * the top-20 market-cap shares. Behind IB-029's module-wide `APP_GUARD`, so no decorator here.
 *
 * Both endpoints return stored rows plus shares derived at read time by `market-shares.ts`
 * (pure, spec'd). Nothing derived is stored: the top-20 membership changes, and a stored ratio
 * would be a second truth that silently disagrees with the rows the moment it does.
 *
 * `thin` is IB-031's, not a second downsampler: the same cap and the same "keep the last point"
 * rule the series endpoints use, so one page cannot be quietly denser than another.
 */
@Controller('api/web/context')
export class WebContextController {
  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  /** `GET …/context/fear-greed?from&to` — epoch ms, `to` exclusive; defaults to the last year. */
  @Get('fear-greed')
  async fearGreed(@Query('from') from?: string, @Query('to') to?: string): Promise<WebFearGreedResponse> {
    if (!this.db) return { points: [], latest: null, downsampled: false };
    const { fromMs, toMs } = this.window(from, to, 365);
    const [points, latest] = await Promise.all([
      fearGreedBetween(this.db, dayOf(fromMs), dayOf(toMs)),
      // the whole series' newest point, not the window's: the gauge says "today", and a range
      // picker must not be able to make an old value look current
      latestFearGreed(this.db),
    ]);
    const thinned = thin(points);
    return { points: thinned.rows, latest, downsampled: thinned.downsampled };
  }

  /** `GET …/context/market-cap?from&to` — the stacked shares, the table and the dominance line. */
  @Get('market-cap')
  async marketCap(@Query('from') from?: string, @Query('to') to?: string): Promise<WebMarketCapResponse> {
    if (!this.db) return { days: [], current: [], dominance: [], dominanceStart: null, downsampled: false };
    const { fromMs, toMs } = this.window(from, to, 365);
    const coins = this.topCoins();

    const [capRows, dominance, start] = await Promise.all([
      coinCapsBetween(this.db, coins, dayOf(fromMs), dayOf(toMs)),
      dominanceBetween(this.db, fromMs, toMs),
      dominanceStart(this.db),
    ]);

    const days = marketCapDays(capRows, coins);
    const thinnedDays = thin(days);
    const thinnedDominance = thin(dominance);
    return {
      days: thinnedDays.rows,
      // the table is always the newest day held, never a thinned one — it is "now", not history
      current: marketCapCurrent(days, capRows),
      dominance: thinnedDominance.rows,
      dominanceStart: start,
      downsampled: thinnedDays.downsampled || thinnedDominance.downsampled,
    };
  }

  /**
   * The top 20 of the universe's stored 30-day volume rank, mapped to CoinGecko ids (§10).
   * Symbols without a `coingecko_id` are skipped rather than guessed: an id we invented would
   * silently read another coin's cap.
   */
  private topCoins(): string[] {
    return [...this.config.symbols]
      .filter((symbol) => symbol.coingecko_id)
      .sort((a, b) => (a.volume_rank ?? Number.MAX_SAFE_INTEGER) - (b.volume_rank ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 20)
      .map((symbol) => symbol.coingecko_id as string);
  }

  /** Parses the window, defaulting to `days` back from now; both series are daily. */
  private window(from: string | undefined, to: string | undefined, days: number): { fromMs: number; toMs: number } {
    const toMs = to === undefined ? Date.now() : Number(to);
    const fromMs = from === undefined ? toMs - days * DAY_MS : Number(from);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'from and to must be epoch milliseconds' });
    }
    if (toMs <= fromMs) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'to must be after from' });
    }
    return { fromMs, toMs };
  }
}

/** The UTC day an instant falls in — both context series are stored by day. */
function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
