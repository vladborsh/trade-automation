import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Writers } from '../writers/batch-writer';
import { CollectorGapRow } from '../writers/tables';
import { contractSpecs } from './contract-size';
import { OkxCollector, STREAM_FUNDING, STREAM_LIQUIDATION, STREAM_MARK } from './okx-collector';
import { OkxRest } from './okx-rest';
import { OkxSocket, OkxSubscription } from './okx-socket';
import { settlementRowsFromHistory, VENUE } from './mappers';
import { OkxFundingRate, OkxLiquidation, OkxMarkPrice } from './payloads';

const TICK_MS = 1_000;
const MINUTE_MS = 60_000;

/**
 * IB-009 — the Nest shell around `OkxCollector`: it builds the socket and REST client, loads the
 * contract-size table, runs the clock and writes what the collector drains. All the rules live in
 * the pure modules beside it, which is why there is nothing here worth testing on its own.
 */
@Injectable()
export class OkxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OkxCollector');
  private collector: OkxCollector | null = null;
  private socket: OkxSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMinute = 0;

  constructor(
    private readonly config: AppConfigService,
    private readonly writers: Writers,
    private readonly registry: StreamRegistry,
    private readonly metrics: MetricsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const instIds = this.config.symbols.map((s) => s.okx_swap).filter((id): id is string => typeof id === 'string');
    if (instIds.length === 0) {
      this.logger.warn('no universe symbols carry an okx_swap mapping — OKX collector idle');
      return;
    }
    const signalSet = this.config.symbols
      .filter((s) => this.config.signalSet.includes(s.id) && typeof s.okx_swap === 'string')
      .map((s) => s.okx_swap as string);

    const rest = new OkxRest({ baseUrl: this.config.env.get('OKX_REST_BASE_URL') });
    const specs = contractSpecs(await rest.instruments());
    const missing = instIds.filter((id) => !specs.has(id));
    if (missing.length > 0) {
      // Not fatal, and deliberately loud: a missing contract size means that instrument's
      // liquidation quantities would be wrong, so its rows are skipped rather than guessed.
      this.logger.warn(`no contract size for ${missing.length} instrument(s): ${missing.join(', ')}`);
    }

    this.collector = new OkxCollector({
      instIds,
      signalSetInstIds: signalSet,
      contractSpecs: specs,
      onSkipped: (instId, reason) => this.logger.warn(`liquidation skipped for ${instId}: ${reason}`),
    });

    for (const stream of [STREAM_LIQUIDATION, STREAM_MARK, STREAM_FUNDING]) {
      this.registry.register(stream, VENUE);
    }

    this.openSocket(instIds);
    this.startClock();

    void this.backfillFunding(rest, instIds).catch((err) =>
      this.logger.error(`OKX funding backfill failed: ${(err as Error).message}`),
    );
  }

  private subscriptions(instIds: readonly string[]): OkxSubscription[] {
    return [
      { channel: 'liquidation-orders', instType: 'SWAP' },
      ...instIds.map((instId) => ({ channel: 'mark-price', instId })),
      ...instIds.map((instId) => ({ channel: 'funding-rate', instId })),
    ];
  }

  private openSocket(instIds: readonly string[]): void {
    this.socket = new OkxSocket({
      wsUrl: this.config.env.get('OKX_WS_URL'),
      subscriptions: this.subscriptions(instIds),
      handlers: {
        onOpen: () => this.logger.log(`OKX socket open; subscribed ${this.subscriptions(instIds).length} channels`),
        onMessage: (channel, data) => this.onMessage(channel, data),
        onVenueError: (code, message) => this.logger.warn(`OKX said error ${code}: ${message}`),
        onClose: (code) => {
          this.logger.warn(`OKX socket closed (${code}); reconnecting`);
          for (const stream of [STREAM_LIQUIDATION, STREAM_MARK, STREAM_FUNDING]) {
            this.registry.recordReconnect(stream);
            this.metrics.wsReconnects.inc({ stream });
          }
        },
        onError: (message) => this.logger.warn(`OKX socket error: ${message}`),
      },
    });
    this.socket.open();
  }

  private onMessage(channel: string, data: unknown[]): void {
    const now = Date.now();
    const stream =
      channel === 'liquidation-orders' ? STREAM_LIQUIDATION : channel === 'mark-price' ? STREAM_MARK : STREAM_FUNDING;
    this.registry.recordMessage(stream, now);

    if (this.collector === null) return;
    if (channel === 'mark-price') {
      for (const event of data as OkxMarkPrice[]) this.collector.acceptMarkPrice(event);
    } else if (channel === 'funding-rate') {
      for (const event of data as OkxFundingRate[]) this.collector.acceptFundingRate(event);
    } else if (channel === 'liquidation-orders') {
      for (const message of data as OkxLiquidation[]) this.collector.acceptLiquidation(message);
    }
  }

  private startClock(): void {
    this.timer = setInterval(() => {
      const now = Date.now();
      const minute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
      if (minute !== this.lastMinute) {
        this.lastMinute = minute;
        this.collector?.sampleMinute(new Date(minute));
      }
      // Dead-socket rule, as IB-005/IB-008 (the socket owns it; no degraded REST mode exists for
      // these channels, so silence means reconnect).
      this.socket?.checkSilence(now);
      void this.flush().catch((err) => this.logger.error(`OKX write failed: ${(err as Error).message}`));
    }, TICK_MS);
    this.timer.unref?.();
  }

  private async flush(): Promise<void> {
    const drained = this.collector?.drain();
    if (drained === undefined) return;
    if (drained.markFunding.length > 0) await this.writers.markFunding.write(drained.markFunding);
    if (drained.liquidations.length > 0) await this.writers.liquidations.write(drained.liquidations);
    if (drained.settlements.length > 0) await this.writers.fundingSettlements.write(drained.settlements);
  }

  /**
   * "Boot backfill as far as served, depth recorded" (the task): every instrument's settled
   * funding, walked back until OKX stops serving, with the depth reached logged and written to
   * `collector_gaps` as an informational row so §6.2's report shows how far history actually goes.
   */
  private async backfillFunding(rest: OkxRest, instIds: readonly string[]): Promise<void> {
    let total = 0;
    const depths: string[] = [];
    for (const instId of instIds) {
      const { rows } = await rest.fundingHistory(instId);
      if (rows.length === 0) {
        depths.push(`${instId}: none served`);
        continue;
      }
      total += await this.writers.fundingSettlements.write(settlementRowsFromHistory(rows));
      const oldest = new Date(Number(rows[0].fundingTime));
      depths.push(`${instId}: ${rows.length} rows back to ${oldest.toISOString().slice(0, 10)}`);
      await this.recordDepth(instId, oldest, rows.length);
    }
    this.logger.log(`OKX funding backfill: ${total} settlement rows across ${instIds.length} instruments.`);
    this.logger.log(`OKX funding depth — ${depths.join('; ')}`);
  }

  /**
   * The depth itself is the record: `expected` and `repaired` are equal, so this is not an open
   * gap, but the row states how far back the venue served for this instrument at this time.
   */
  private async recordDepth(instId: string, oldest: Date, rows: number): Promise<void> {
    const gap: CollectorGapRow = {
      stream: STREAM_FUNDING,
      venue: VENUE,
      market: 'perp',
      symbol: instId,
      gapFrom: oldest,
      gapTo: oldest,
      expected: rows,
      repaired: rows,
      error: `funding history depth: ${rows} settlements served, oldest ${oldest.toISOString()}`,
      detectedAt: new Date(),
    };
    await this.writers.collectorGaps.write([gap]);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
  }
}
