import type { CollectorGapRow, LiquidationRow } from '../writers/tables';
import { DegradedGapTracker } from './degraded-gaps';
import { isUsdtLinearPerp, liquidationRowFromEvent, VENUE } from './mappers';
import { ModePolicy, type CollectorMode, type ModePolicyOptions } from '../binance-common/mode';
import { isForceOrderEvent, isMarkPriceEvent } from './payloads';
import { gapRow } from '../binance-common/rows';
import { perpStreamNames } from './streams';

/**
 * IB-005, slimmed by WD-010 — the Binance USD-M liquidation collector (design §4.1, §16.1; storage
 * ruling 2026-11-03: liquidations are stored because no venue serves their history).
 *
 * **One stored stream, `!forceOrder@arr`, plus one liveness stream that is never stored**:
 * `<symbol>@markPrice@1s` for a single symbol. WD-010 removed the klines and the all-market mark
 * stream, and with them the constant traffic the dead-socket rule (`ModePolicy`) timed. The
 * liquidation stream alone is legitimately silent for minutes in a quiet market; timed on it, the
 * socket would be torn down every 90 s — losing whatever arrived during each reconnect — and a
 * socket that is open but MUTE (IB-BUG-012's legacy route) would look the same as a calm market.
 * One symbol's 1 s mark price keeps "no data for 90 s" meaning "this socket is dead".
 *
 * **No REST weight.** There is no degraded REST mode any more: nothing here has a REST equivalent.
 * "Degraded" now means "the socket is down": the liquidations lost meanwhile are written to
 * `collector_gaps` (as before), and the socket is retried every `retryMs` — 30 s, not the old
 * 5 min, because there is no REST fallback to carry the data while we wait.
 */

export const STREAM_LIQUIDATION = 'binance-perp:forceOrder';
export const MARKET = 'perp' as const;
export const VENUE_LOGGER_NAME = 'BinancePerpCollector';
export const LIQUIDATION_ONLY_RETRY_MS = 30_000;

/** The writers this collector uses; `Writers` satisfies it structurally. */
export interface CollectorWriters {
  liquidations: { write(rows: readonly LiquidationRow[]): Promise<number> };
  collectorGaps: { write(rows: readonly CollectorGapRow[]): Promise<number> };
}

export interface CollectorRegistry {
  register(id: string, venue: string): void;
  recordMessage(id: string, at?: number): void;
  recordReconnect(id: string, at?: number): void;
  setMode?(id: string, mode: CollectorMode, reason?: string | null): void;
}

export interface CollectorMetrics {
  gapsUnrepaired: { inc(labels: Record<string, string>, value?: number): void };
  wsReconnects: { inc(labels: Record<string, string>, value?: number): void };
  /** IB-BUG-018: events not stored, per venue and reason. Optional so older ports still compile. */
  liquidationsSkipped?: { inc(labels: Record<string, string>, value?: number): void };
}

export interface CollectorSocket {
  open(): void;
  stop(): void;
}

export interface CollectorLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface PerpCollectorPorts {
  /** The universe's perp symbols; the first one carries the liveness stream. */
  symbols: readonly string[];
  writers: CollectorWriters;
  registry: CollectorRegistry;
  metrics?: CollectorMetrics;
  /** Builds the socket from the handlers this collector supplies. */
  socketFactory(handlers: {
    onOpen(): void;
    onMessage(stream: string, data: unknown): void;
    onClose(code: number): void;
    onError(message: string): void;
  }, streams: readonly string[]): CollectorSocket;
  logger: CollectorLogger;
  now?: () => number;
  mode?: ModePolicyOptions;
}

export class BinancePerpCollector {
  private readonly policy: ModePolicy;
  private readonly degradedGaps = new DegradedGapTracker();
  private readonly now: () => number;
  private socket: CollectorSocket | null = null;
  private ticking = false;
  private stopped = false;
  /** IB-BUG-018: each skipped symbol is logged once per process, then only counted. */
  private readonly skippedSymbols = new Set<string>();
  /** How many forceOrder events were skipped as not USDT-linear (also on the metric). */
  skippedLiquidations = 0;

  constructor(private readonly ports: PerpCollectorPorts) {
    // IB-BUG-018: a universe symbol the liquidation rule would refuse is a configuration error —
    // its liquidations would all be dropped. Refuse at construction rather than count them away.
    const misfit = ports.symbols.filter((symbol) => !isUsdtLinearPerp(symbol));
    if (misfit.length > 0) {
      throw new RangeError(`binance-perp universe has non-USDT-linear symbols ${misfit.join(', ')}: their liquidations could not be priced`);
    }
    this.now = ports.now ?? Date.now;
    this.policy = new ModePolicy({ retryMs: LIQUIDATION_ONLY_RETRY_MS, ...ports.mode });
  }

  get mode(): CollectorMode {
    return this.policy.mode;
  }

  /** Boot: register the stream and open the socket. */
  async start(): Promise<void> {
    this.ports.registry.register(STREAM_LIQUIDATION, 'binance');
    await this.act({ kind: 'reconnect' });
  }

  /** The one clock: mode transitions and the degraded spell's day boundary. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const now = this.now();
      const transition = this.policy.tick(now);
      if (transition) await this.act(transition, now);
      await this.rollDegradedDays(now);
    } catch (error) {
      this.ports.logger.warn(`binance-perp tick failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.socket?.stop();
    this.socket = null;
    const span = this.degradedGaps.end(this.now());
    if (span) await this.writeLiquidationGap(span.from, span.to);
  }

  // ---------------------------------------------------------------------------------------------
  // socket handlers
  // ---------------------------------------------------------------------------------------------

  private handlers() {
    return {
      onOpen: () => {
        this.policy.onOpen(this.now());
        this.ports.logger.log('binance-perp socket open');
      },
      // `onMessage` is async and the socket cannot await it: a rejection is caught and named here,
      // so one bad payload neither disappears silently nor takes the feed down.
      onMessage: (stream: string, data: unknown) =>
        void this.onMessage(stream, data).catch((error: unknown) =>
          this.ports.logger.warn(`binance-perp handler failed for ${stream}: ${(error as Error).message}`),
        ),
      onClose: (code: number) => {
        this.policy.onClosed();
        this.ports.metrics?.wsReconnects.inc({ stream: STREAM_LIQUIDATION });
        this.ports.registry.recordReconnect(STREAM_LIQUIDATION, this.now());
        this.ports.logger.warn(`binance-perp socket closed (${code})`);
      },
      onError: (message: string) => this.ports.logger.warn(`binance-perp socket error: ${message}`),
    };
  }

  /**
   * One demultiplexed payload. Public so a spec can drive the collector without a socket. Every
   * message proves the socket alive (the policy); only a `forceOrder` is liquidation data — the
   * liveness mark price is neither stored nor counted as the stream's last message, so /health and
   * the watchdog still see the real age of the last liquidation.
   */
  async onMessage(_stream: string, data: unknown): Promise<void> {
    const now = this.now();
    const recovered = this.policy.onMessage(now);
    if (recovered) await this.onRecovered(now);

    if (isForceOrderEvent(data)) {
      this.ports.registry.recordMessage(STREAM_LIQUIDATION, now);
      if (!isUsdtLinearPerp(data.o.s)) {
        // IB-BUG-018: COIN-M / delivery / non-USDT-quoted contracts — skipped and counted, never stored
        this.skippedLiquidations++;
        this.ports.metrics?.liquidationsSkipped?.inc({ venue: VENUE, reason: 'not-usdt-linear' });
        if (!this.skippedSymbols.has(data.o.s)) {
          this.skippedSymbols.add(data.o.s);
          this.ports.logger.log(`binance-perp: skipping liquidations of ${data.o.s} (not a USDT-linear perpetual; counted on ib_liquidations_skipped_total, logged once)`);
        }
        return;
      }
      await this.ports.writers.liquidations.write([liquidationRowFromEvent(data)]);
      return;
    }
    if (isMarkPriceEvent(data)) return; // liveness only
  }

  // ---------------------------------------------------------------------------------------------
  // socket down ("degraded", §16.1)
  // ---------------------------------------------------------------------------------------------

  private async act(event: { kind: 'reconnect' } | { kind: 'degrade'; reason: string } | { kind: 'recover' }, now = this.now()): Promise<void> {
    if (event.kind === 'reconnect') {
      this.socket?.stop();
      this.socket = this.ports.socketFactory(this.handlers(), perpStreamNames(this.ports.symbols));
      this.policy.onConnecting(now); // the handshake takes seconds: no second socket meanwhile
      this.socket.open();
      return;
    }
    if (event.kind === 'degrade') {
      this.ports.logger.warn(`binance-perp socket down (${event.reason}): liquidations unavailable, retrying every ${LIQUIDATION_ONLY_RETRY_MS / 1000} s`);
      this.socket?.stop();
      this.socket = null;
      this.degradedGaps.begin(now);
      this.ports.registry.setMode?.(STREAM_LIQUIDATION, 'degraded', event.reason);
      return;
    }
    await this.onRecovered(now);
  }

  private async onRecovered(now: number): Promise<void> {
    const span = this.degradedGaps.end(now);
    if (span) await this.writeLiquidationGap(span.from, span.to);
    this.ports.registry.setMode?.(STREAM_LIQUIDATION, 'ws', null);
    this.ports.logger.log('binance-perp back on the websocket');
  }

  /** A down spell that crosses UTC midnight is cut there, so each day's report sees its own row. */
  private async rollDegradedDays(now: number): Promise<void> {
    for (const span of this.degradedGaps.rollDay(now)) await this.writeLiquidationGap(span.from, span.to);
  }

  /** The liquidations lost while the socket was down: `repaired = 0`, with the reason (§16.1). */
  private async writeLiquidationGap(from: number, to: number): Promise<void> {
    this.ports.metrics?.gapsUnrepaired.inc({ stream: STREAM_LIQUIDATION });
    await this.ports.writers.collectorGaps.write([
      gapRow({
        stream: STREAM_LIQUIDATION, market: MARKET, symbol: null,
        from, to, expected: 0, repaired: 0,
        error: 'socket down: !forceOrder has no REST equivalent, liquidations in this window are lost',
        detectedAt: new Date(to),
      }),
    ]);
  }
}
