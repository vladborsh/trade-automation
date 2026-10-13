import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Db, DB } from '../../db/db.port';
import { Writers } from '../writers/batch-writer';
import { CoingeckoGate } from './coingecko.gate';
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

/** The cadence the two daily jobs speak at, for the watchdog to judge them against. */
export const DAILY_INTERVAL_SEC = 24 * 60 * 60;

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
  /** The one clock. `Date.now` in production; a spec's own function under test (IB-050). */
  private readonly clock: () => number;
  /**
   * IB-BUG-006 — every CoinGecko request in this process goes through one queue, so the
   * forward-only `/global` poll cannot be starved by the 365-day backfill sharing its allowance.
   * Null in the specs, which inject their own client.
   */
  private readonly gate: CoingeckoGate | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private globalDueAt = 0;
  private lastDailyDay = '';
  /**
   * One `/global` poll at a time, and one daily pass at a time.
   *
   * **Measured on the failure-path run of this fix (2026-10-12, 20:15–20:18Z).** A 429 keeps a
   * poll alive for minutes — three internal retries, 60 s apart — while the clock goes on firing
   * every 30 seconds. `globalDueAt` is only advanced when the poll *settles*, so every tick in
   * between started ANOTHER poll: three concurrent attempts, each logging «retry 1/3», each
   * taking a gate slot ahead of the backfill, which collected **zero coins in two minutes**.
   * That is the original starvation with the victims swapped — exactly what this task exists to
   * remove, so it is guarded rather than left for the next person to measure again.
   */
  private globalInFlight = false;
  private dailyInFlight = false;

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) private readonly db: Db,
    private readonly writers: Writers,
    private readonly registry: StreamRegistry,
    private readonly metrics: MetricsService,
    // @Optional(): the specs' injection point; the real client is built below from config.
    @Optional() client?: ContextClient,
    @Optional() sleep?: (ms: number) => Promise<void>,
    /**
     * IB-050 — **the clock, injected**, because this service schedules on the UTC time of day.
     *
     * It used to take `now` as a parameter on `tick` while reading `new Date()` / `Date.now()`
     * internally: a partially-threaded clock, which is worse than no injection at all. A spec
     * passing a fixed instant got the service's own wall clock in the places that mattered, so
     * the two disagreed about what day it was — and across a UTC midnight that silently changed
     * the answer (`lastDailyDay` marked 10-13 while the spec asked about 10-12, so the daily pass
     * ran twice and the duplicate-suppression spec read 6 fetches where it expected 3).
     *
     * One clock, used everywhere an instant is taken.
     */
    @Optional() now?: () => number,
  ) {
    this.clock = now ?? Date.now;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.gate = client
      ? null
      : new CoingeckoGate({
          // the same spacing the backfill was already measured to need, now applied to every
          // CoinGecko request rather than only between coins: the total rate is unchanged
          minSpacingMs: COIN_REQUEST_SPACING_MS,
          sleep: this.sleep,
          onPreempt: ({ queuedBehind, waitedMs }) =>
            this.logger.log(
              `/global took the next CoinGecko slot ahead of ${queuedBehind} backfill request(s) ` +
                `after ${Math.round(waitedMs / 1000)} s — this series cannot be backfilled`,
            ),
        });
    this.client =
      client ??
      new ContextClient({
        fngBaseUrl: this.config.env.get('FNG_BASE_URL'),
        coingeckoBaseUrl: this.config.env.get('COINGECKO_BASE_URL'),
        gate: this.gate ?? undefined,
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
    // IB-BUG-006: each stream declares the cadence it actually speaks at. Registered without one,
    // all three were judged against the watchdog's 3-minute default — so a HEALTHY 10-minute
    // `/global` poll and a once-a-day job would both be reported silent within minutes. The
    // September alert («молчит 4 мин») was true because the poll really was starved; with the
    // starvation fixed the same alert would fire on a working collector every single cycle, and
    // an alert that cries wolf on correct behaviour is worth less than no alert at all.
    for (const [stream, venue, intervalSec] of [
      [STREAM_FNG, VENUE_FNG, DAILY_INTERVAL_SEC],
      [STREAM_GLOBAL, VENUE_CG, GLOBAL_POLL_MS / 1000],
      [STREAM_COINS, VENUE_CG, DAILY_INTERVAL_SEC],
    ] as const) {
      this.registry.register(stream, venue, intervalSec);
    }

    this.startClock();
    // IB-BUG-006: the FIRST request this process makes is the forward-only one, and only then
    // does the backfill start queueing behind it.
    void this.primeThenBackfill().catch((err) =>
      this.logger.error(`context backfill failed: ${(err as Error).message}`),
    );
  }

  /**
   * One `/global` sample, then the backfills.
   *
   * On a fresh database — the Tokyo box's first boot, and every rehearsal of it — the backfill
   * fetches 365 days for twenty coins and holds the keyless allowance for ten minutes. Before
   * IB-BUG-006 the `/global` poll simply lost that race: one row in twenty minutes, then none,
   * and those samples are unrecoverable because CoinGecko's history endpoint is paid.
   *
   * **A failed first sample does not block the backfill.** If `/global` is broken or the venue is
   * down, waiting for it would trade one missing series for two; the gate already guarantees the
   * priority from here on, so one attempt is enough to put the forward-only series first.
   */
  private async primeThenBackfill(now = new Date(this.clock())): Promise<void> {
    await this.pollGlobalGuarded();

    // **On a fresh database the backfills ARE today's collection**, so the daily passes must not
    // run alongside them. Measured on the first run of this fix: the 30-second clock fired half a
    // minute into a 24-minute backfill, found both daily tasks due (`lastRunDay` is empty on a new
    // process) and started a SECOND coin loop — twenty extra requests for two days of data whose
    // 365 were already in flight, interleaved with the backfill through the one queue, which is
    // why the backfill ran at a coin a minute instead of a coin every thirty seconds.
    //
    // Marked BEFORE the backfill rather than after it: the clock fires during the backfill, so a
    // flag set at the end would be set long after the duplicate pass had already run. If the
    // backfill then fails outright the mark is lifted, because a day that was not collected must
    // not look collected.
    const fresh = await this.isFreshDatabase();
    const today = now.toISOString().slice(0, 10);
    if (fresh) this.lastDailyDay = today;
    try {
      await this.backfill(now);
    } catch (err) {
      if (fresh) this.lastDailyDay = '';
      throw err;
    }
  }

  /**
   * A database with neither series in it — the Tokyo box's first boot, and every rehearsal of it.
   *
   * Deliberately strict: when only *some* coins are missing, the daily pass still has work to do
   * for the others, so only the all-or-nothing case suppresses it.
   */
  private async isFreshDatabase(): Promise<boolean> {
    const [needsFng, missing] = await Promise.all([this.needsFearGreedBackfill(), this.coinsNeedingBackfill()]);
    return needsFng && missing.length > 0 && missing.length === this.coins().length;
  }

  private startClock(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.logger.error(`context poll failed: ${(err as Error).message}`));
    }, 30_000);
    this.timer.unref?.();
  }

  /** Drives both cadences off one cheap timer; every decision is in `schedule.ts` and spec'd. */
  async tick(now = new Date(this.clock())): Promise<void> {
    if (now.getTime() >= this.globalDueAt && !this.globalInFlight) {
      await this.pollGlobalGuarded();
    }
    const due = dueDailyTasks(now, this.lastDailyDay);
    if (due.length > 0 && !this.dailyInFlight) {
      this.lastDailyDay = now.toISOString().slice(0, 10);
      this.dailyInFlight = true;
      try {
        if (due.includes('fear-greed')) await this.pollFearGreed(2);
        if (due.includes('coins')) await this.pollCoins(2);
      } finally {
        this.dailyInFlight = false;
      }
    }
  }

  /**
   * One `/global` poll, with the due-time rule and the in-flight guard in one place.
   *
   * The slot is retried soon, not skipped: this series is forward-only, so a lost 10-minute slot
   * is lost for good, and advancing the clock before the poll succeeded (which this code used to
   * do) turned one 429 into a permanently missing sample.
   */
  private async pollGlobalGuarded(): Promise<void> {
    this.globalInFlight = true;
    try {
      await this.pollGlobal();
      this.globalDueAt = globalDueAfter(this.clock(), 'ok');
    } catch (err) {
      this.globalDueAt = globalDueAfter(this.clock(), 'failed');
      this.logger.warn(`/global poll failed: ${(err as Error).message}`);
    } finally {
      this.globalInFlight = false;
    }
  }

  /**
   * `fetched_at` is the instant the venue ANSWERED, not the instant the poll was scheduled.
   *
   * Measured on the failure-path run (2026-10-12): a poll that began at 20:20:09 and survived
   * three 60-second back-offs wrote `fetched_at = 20:20:09` against a payload CoinGecko stamped
   * `20:22:12` — a row that claims to have been fetched before the data it contains existed. The
   * column is also what the cadence evidence for this very task is measured from, so a column
   * that means "when we decided to ask" instead of "when we were told" quietly misdates both the
   * data and the proof.
   */
  async pollGlobal(): Promise<number> {
    const payload = await this.client.global();
    const arrivedAt = new Date(this.clock());
    const written = await this.writers.marketCapGlobal.write([marketCapGlobalRow(payload, arrivedAt)]);
    this.registry.recordMessage(STREAM_GLOBAL, arrivedAt.getTime());
    return written;
  }

  async pollFearGreed(limit = 2): Promise<number> {
    const payload = await this.client.fearGreed(limit);
    // same rule as pollGlobal: the answer's arrival, not the question's departure
    const arrivedAt = new Date(this.clock());
    const written = await this.writers.fearGreed.write(fearGreedRows(payload, arrivedAt));
    this.registry.recordMessage(STREAM_FNG, arrivedAt.getTime());
    return written;
  }

  async pollCoins(days = 2, coins = this.coins()): Promise<number> {
    let written = 0;
    for (const coin of coins) {
      // The pacing moved into the gate (IB-BUG-006). It used to be this loop's own sleep, which
      // spaced coin from coin but knew nothing about `/global`, so the two schedulers competed.
      // The interval is unchanged — 30 s between any two CoinGecko requests, measured — but it is
      // now one queue, and `/global` can take a slot in the middle of a backfill.
      try {
        const payload = await this.client.coinMarketChart(coin, days);
        // per coin, because a 20-coin backfill spans ten minutes: one `now` for the whole pass
        // would stamp the twentieth coin with the first coin's clock
        written += await this.writers.marketCapCoin.write(marketCapCoinRows(payload, coin, new Date(this.clock())));
        // Per coin, NOT per pass: the 365-day backfill takes ten minutes at the measured rate,
        // and a pass-level record would leave this stream reading silent throughout. The
        // watchdog's threshold is 3 minutes, so a first boot on a fresh box would raise a false
        // alert on its very first run — the cry-wolf case, at exactly the moment trust in the
        // alerts is being established.
        this.registry.recordMessage(STREAM_COINS, this.clock());
      } catch (err) {
        // One coin failing must not cost the other nineteen their day.
        this.logger.warn(`market cap for ${coin}: ${(err as Error).message}`);
        this.metrics.gapsDetected.inc({ stream: STREAM_COINS });
      }
    }
    this.registry.recordMessage(STREAM_COINS, this.clock());
    return written;
  }

  /**
   * The one-shot backfills: the whole Fear & Greed history (`limit=0`, since 2018) and 365 days
   * per coin. Both are skipped when the tables already hold them, so a restart is cheap.
   * `market_cap_global` has no backfill — there is nothing to backfill from.
   */
  async backfill(now = new Date(this.clock())): Promise<void> {
    // Both one-shot backfills are skipped when the tables already hold them. Without this a
    // restart re-fetches 20 x 365-day charts and spends the keyless allowance on data it already
    // has — which is exactly how the first live run ran into 429.
    if (await this.needsFearGreedBackfill()) {
      const fng = await this.pollFearGreed(0);
      this.logger.log(`Fear & Greed: ${fng} day(s) loaded (full history since 2018).`);
    } else {
      this.logger.log('Fear & Greed history already stored — skipping the one-shot backfill.');
    }

    const missing = await this.coinsNeedingBackfill();
    if (missing.length === 0) {
      this.logger.log(`Market caps: all ${this.coins().length} coin(s) already have their ${COIN_CHART_DAYS} days.`);
      return;
    }
    const written = await this.pollCoins(COIN_CHART_DAYS, missing);
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
