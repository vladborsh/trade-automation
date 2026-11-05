import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import { LiquidationTracking, TRACK_REFRESH_MS } from '../liquidation-tracking/pg/liquidation-tracking.repo';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { UptimeRecorder } from '../uptime/uptime.recorder';
import { Writers } from '../writers/batch-writer';
import { describeFailure } from '../writers/write-isolated';
import { contractSpecs } from '../../venues/okx/contract-size';
import { OkxCollector, STREAM_LIQUIDATION, writeOkxDrain } from './okx-collector';
import { OkxRest } from '../../venues/okx/okx-rest';
import { OkxSocket, OkxSubscription } from './okx-socket';
import { VENUE } from './mappers';
import { OkxLiquidation } from './payloads';

const TICK_MS = 1_000;

/**
 * IB-009, slimmed by WD-010 — the Nest shell around `OkxCollector`: it loads the contract-size table
 * (REST, once at boot — a liquidation's size is in contracts), opens the socket, runs the clock and
 * writes what the collector drains.
 *
 * Subscribed: `liquidation-orders` (all SWAPs; filtered to the universe by the collector) and ONE
 * instrument's `mark-price`, as the socket's liveness signal. The socket's dead-socket rule is "no
 * data for 90 s → reconnect"; liquidations alone go quiet for minutes (5 min seen on 2026-11-03), so
 * timed on them the socket would be torn down every 90 s, and a mute socket would look like a calm
 * market. The mark price is never stored. The funding-rate channel and the settlement backfill went
 * with the funding tape (storage ruling S1).
 */
@Injectable()
export class OkxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OkxCollector');
  private collector: OkxCollector | null = null;
  private socket: OkxSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private trackTimer: ReturnType<typeof setInterval> | null = null;
  private readonly tracking: LiquidationTracking;

  constructor(
    private readonly config: AppConfigService,
    private readonly writers: Writers,
    private readonly registry: StreamRegistry,
    private readonly metrics: MetricsService,
    private readonly uptime: UptimeRecorder,
    @Optional() @Inject(DB) db?: Db | null,
  ) {
    this.tracking = new LiquidationTracking(db ?? null, config.symbols, { warn: (m) => this.logger.warn(m) });
  }

  async onApplicationBootstrap(): Promise<void> {
    // the universe's okx_swap ids and (IB-122, L5) the enabled alert coins as `{BASE}-USDT-SWAP`
    const instIds = await this.tracking.symbols('okx');
    if (instIds.length === 0) {
      this.logger.warn('no universe symbols carry an okx_swap mapping — OKX collector idle');
      return;
    }
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
      contractSpecs: specs,
      onSkipped: (instId, reason) => this.logger.warn(`liquidation skipped for ${instId}: ${reason}`),
    });

    this.registry.register(STREAM_LIQUIDATION, VENUE);

    this.openSocket(instIds);
    // IB-BUG-010: writes a collector_gaps row for however long we were NOT running, then starts
    // the heartbeat that makes the next such window measurable.
    await this.uptime.begin([{ stream: STREAM_LIQUIDATION, venue: VENUE, market: 'perp' }]);
    this.startClock();
    // IB-122 (L5): the alert list is re-read every 5 min; the filter widens without touching the socket
    this.trackTimer = setInterval(() => void this.refreshInstIds(specs), TRACK_REFRESH_MS);
    this.trackTimer.unref?.();
  }

  async refreshInstIds(specs: ReadonlyMap<string, unknown>): Promise<void> {
    try {
      const change = this.collector?.setInstIds(await this.tracking.symbols('okx'));
      if (change && change.added.length + change.removed.length > 0) {
        this.logger.log(`OKX liquidation filter: +${change.added.join(',') || '—'} −${change.removed.join(',') || '—'}`);
        const unsized = change.added.filter((id) => !specs.has(id));
        if (unsized.length > 0) this.logger.warn(`no contract size for ${unsized.join(', ')}: their liquidations are skipped, not guessed`);
      }
    } catch (error) {
      this.logger.warn(`OKX symbol refresh failed: ${(error as Error).message}`);
    }
  }

  private subscriptions(instIds: readonly string[]): OkxSubscription[] {
    return okxSubscriptions(instIds);
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
          this.registry.recordReconnect(STREAM_LIQUIDATION);
          this.metrics.wsReconnects.inc({ stream: STREAM_LIQUIDATION });
        },
        onError: (message) => this.logger.warn(`OKX socket error: ${message}`),
      },
    });
    this.socket.open();
  }

  /** Only liquidations are data; the liveness mark price has already reset the socket's clock. */
  private onMessage(channel: string, data: unknown[]): void {
    if (channel !== 'liquidation-orders' || this.collector === null) return;
    const now = Date.now();
    this.registry.recordMessage(STREAM_LIQUIDATION, now);
    for (const message of data as OkxLiquidation[]) this.collector.acceptLiquidation(message);
  }

  private startClock(): void {
    this.timer = setInterval(() => {
      const now = Date.now();
      // Dead-socket rule, as IB-005/IB-008 (the socket owns it; no degraded REST mode exists for
      // these channels, so silence means reconnect).
      this.socket?.checkSilence(now);
      void this.flush().catch((err) => this.logger.error(`OKX flush failed: ${(err as Error).message}`));
    }, TICK_MS);
    this.timer.unref?.();
  }

  private async flush(): Promise<void> {
    const drained = this.collector?.drain();
    if (drained === undefined) return;
    for (const failure of await writeOkxDrain(drained, this.writers)) this.logger.error(describeFailure('OKX', failure));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.trackTimer !== null) clearInterval(this.trackTimer);
    this.trackTimer = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    // a last heartbeat, so the outage is dated from when we stopped
    await this.uptime.end();
  }
}

/** Every SWAP's liquidations, and ONE instrument's mark price for liveness (see the class comment). */
export function okxSubscriptions(instIds: readonly string[]): OkxSubscription[] {
  if (instIds.length === 0) throw new RangeError('okxSubscriptions: no instruments — nothing to carry the liveness channel');
  return [
    { channel: 'liquidation-orders', instType: 'SWAP' },
    { channel: 'mark-price', instId: instIds[0] },
  ];
}
