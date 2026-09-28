import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Db, DB } from '../../db/db.port';
import { Writers } from '../writers/batch-writer';
import { COIN_CHART_DAYS, ContextClient } from './context.client';
import { fearGreedRows, marketCapCoinRows, marketCapGlobalRow } from './mappers';
import { COIN_REQUEST_SPACING_MS, dueDailyTasks, globalDueAfter, GLOBAL_POLL_MS } from './schedule';

export const STREAM_FNG = 'context:fear-greed';
export const STREAM_GLOBAL = 'context:market-cap-global';
export const STREAM_COINS = 'context:market-cap-coins';
export const VENUE_FNG = 'alternative.me';
export const VENUE_CG = 'coingecko';

/** §10 — the dashboard charts the top 20 of the universe's 30-day volume rank. */
export const TOP_N_COINS = 20;

/**
 * IB-036 — Fear & Greed and the two market-cap series (§10).
 *
 * **`market_cap_global` is forward-only**: CoinGecko's historical endpoint is paid, so a day not
 * collected is permanently missing. That is the whole reason this collector was dispatched ahead
 * of the remaining queue, and it is why the 10-minute poll starts before the first backfill
 * finishes rather than after it.
 *
 * Request rate (stated in `payloads.ts` against each source's published limit): ≈165 CoinGecko
 * requests/day ≈ 0.11/min, about 1 % of the keyless allowance, plus 1/day to alternative.me.
 */
@Injectable()
export class ContextService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ContextCollector');
  private readonly client: ContextClient;
  private readonly sleep: (ms: number) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private globalDueAt = 0;
  private lastDailyDay = '';

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) private readonly db: Db,
    private readonly writers: Writers,
    private readonly registry: StreamRegistry,
    private readonly metrics: MetricsService,
    // @Optional(): the specs' injection point; the real client is built below from config.
    @Optional() client?: ContextClient,
    @Optional() sleep?: (ms: number) => Promise<void>,
  ) {
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.client =
      client ??
      new ContextClient({
        fngBaseUrl: this.config.env.get('FNG_BASE_URL'),
        coingeckoBaseUrl: this.config.env.get('COINGECKO_BASE_URL'),
        onRetry: ({ url, attempt, of, waitMs }) =>
          this.logger.warn(
            `rate limited (429) by ${new URL(url).host}${new URL(url).pathname} — retry ${attempt}/${of} in ${waitMs / 1000} s`,
          ),
      });
  }

  /** The top-N universe coins that carry a CoinGecko id, in the file's volume-rank order (§10). */
  coins(): string[] {
    return this.config.symbols
      .slice(0, TOP_N_COINS)
      .map((s) => (s as { coingecko_id?: string }).coingecko_id)
      .filter((id): id is string => typeof id === 'string');
  }

  onApplicationBootstrap(): void {
    for (const [stream, venue] of [
      [STREAM_FNG, VENUE_FNG],
      [STREAM_GLOBAL, VENUE_CG],
      [STREAM_COINS, VENUE_CG],
    ] as const) {
      this.registry.register(stream, venue);
    }

    this.startClock();
    // Fire-and-forget: the one-shot backfills take a minute or two and must not delay the
    // 10-minute poll, which is the series that cannot be recovered.
    void this.backfill().catch((err) => this.logger.error(`context backfill failed: ${(err as Error).message}`));
  }

  private startClock(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.logger.error(`context poll failed: ${(err as Error).message}`));
    }, 30_000);
    this.timer.unref?.();
  }

  /** Drives both cadences off one cheap timer; every decision is in `schedule.ts` and spec'd. */
  async tick(now = new Date()): Promise<void> {
    if (now.getTime() >= this.globalDueAt) {
      try {
        await this.pollGlobal(now);
        this.globalDueAt = globalDueAfter(now.getTime(), 'ok');
      } catch (err) {
        // The slot is retried soon, not skipped: this series is forward-only, so a lost 10-minute
        // slot is lost for good. Advancing the clock before the poll succeeded (which is what this
        // code used to do) turned one 429 into a permanently missing sample.
        this.globalDueAt = globalDueAfter(now.getTime(), 'failed');
        throw err;
      }
    }
    const due = dueDailyTasks(now, this.lastDailyDay);
    if (due.length > 0) {
      this.lastDailyDay = now.toISOString().slice(0, 10);
      if (due.includes('fear-greed')) await this.pollFearGreed(now, 2);
      if (due.includes('coins')) await this.pollCoins(now, 2);
    }
  }

  async pollGlobal(now = new Date()): Promise<number> {
    const row = marketCapGlobalRow(await this.client.global(), now);
    const written = await this.writers.marketCapGlobal.write([row]);
    this.registry.recordMessage(STREAM_GLOBAL, now.getTime());
    return written;
  }

  async pollFearGreed(now = new Date(), limit = 2): Promise<number> {
    const rows = fearGreedRows(await this.client.fearGreed(limit), now);
    const written = await this.writers.fearGreed.write(rows);
    this.registry.recordMessage(STREAM_FNG, now.getTime());
    return written;
  }

  async pollCoins(now = new Date(), days = 2, coins = this.coins()): Promise<number> {
    let written = 0;
    let first = true;
    for (const coin of coins) {
      // Paced: 20 calls back-to-back is ~60/min instantaneously, however small the daily average
      // is, and CoinGecko answers that with 429 (observed 2026-09-28 — it cost the first live run
      // its /global samples). The average rate was never the binding constraint; the burst was.
      if (!first) await this.sleep(COIN_REQUEST_SPACING_MS);
      first = false;
      try {
        const rows = marketCapCoinRows(await this.client.coinMarketChart(coin, days), coin, now);
        written += await this.writers.marketCapCoin.write(rows);
        // Per coin, NOT per pass: the 365-day backfill takes ten minutes at the measured rate,
        // and a pass-level record would leave this stream reading silent throughout. The
        // watchdog's threshold is 3 minutes, so a first boot on a fresh box would raise a false
        // alert on its very first run — the cry-wolf case, at exactly the moment trust in the
        // alerts is being established.
        this.registry.recordMessage(STREAM_COINS, Date.now());
      } catch (err) {
        // One coin failing must not cost the other nineteen their day.
        this.logger.warn(`market cap for ${coin}: ${(err as Error).message}`);
        this.metrics.gapsDetected.inc({ stream: STREAM_COINS });
      }
    }
    this.registry.recordMessage(STREAM_COINS, Date.now());
    return written;
  }

  /**
   * The one-shot backfills: the whole Fear & Greed history (`limit=0`, since 2018) and 365 days
   * per coin. Both are skipped when the tables already hold them, so a restart is cheap.
   * `market_cap_global` has no backfill — there is nothing to backfill from.
   */
  async backfill(now = new Date()): Promise<void> {
    // Both one-shot backfills are skipped when the tables already hold them. Without this a
    // restart re-fetches 20 x 365-day charts and spends the keyless allowance on data it already
    // has — which is exactly how the first live run ran into 429.
    if (await this.needsFearGreedBackfill()) {
      const fng = await this.pollFearGreed(now, 0);
      this.logger.log(`Fear & Greed: ${fng} day(s) loaded (full history since 2018).`);
    } else {
      this.logger.log('Fear & Greed history already stored — skipping the one-shot backfill.');
    }

    const missing = await this.coinsNeedingBackfill();
    if (missing.length === 0) {
      this.logger.log(`Market caps: all ${this.coins().length} coin(s) already have their ${COIN_CHART_DAYS} days.`);
      return;
    }
    const written = await this.pollCoins(now, COIN_CHART_DAYS, missing);
    this.logger.log(
      `Market caps: ${written} row(s) across ${missing.length} coin(s), ${COIN_CHART_DAYS} days each ` +
        '(365 is the free limit; days=max is paid).',
    );
  }

  /** True when the stored history is shorter than what one `limit=0` call would bring. */
  private async needsFearGreedBackfill(): Promise<boolean> {
    const [row] = await this.db.query<{ n: number }>('select count(*)::int as n from fear_greed');
    return (row?.n ?? 0) < 1000; // the real history is ~3 000 days; anything less is a partial load
  }

  /** The coins whose stored history falls short of the free 365-day window. */
  private async coinsNeedingBackfill(): Promise<string[]> {
    const rows = await this.db.query<{ coin: string; n: number }>(
      'select coin, count(*)::int as n from market_cap_coin group by coin',
    );
    const have = new Map(rows.map((r) => [r.coin, r.n]));
    // A few days short is normal (a coin younger than a year); an order of magnitude short is not.
    return this.coins().filter((coin) => (have.get(coin) ?? 0) < COIN_CHART_DAYS - 30);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}

export { GLOBAL_POLL_MS };
