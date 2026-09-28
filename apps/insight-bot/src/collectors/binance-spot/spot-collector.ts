import type { Instrument } from '@trade-automation/contracts';
import { mapWsKline, type BinanceWsKlineMessage } from '@trade-automation/binance-client';
import type { CandleSource } from '@trade-automation/market-data-core';
import { KlineIngest, type KlineIngestMetrics, type KlineIngestWriters } from '../binance-common/kline-ingest';
import { ModePolicy, type CollectorMode, type ModePolicyOptions } from '../binance-common/mode';
import { VENUE } from '../binance-common/venue';
import type { SpotRest } from './rest';
import { spotStreamNames } from './streams';

/**
 * IB-006 — the Binance spot collector (design §4.2, §16.1).
 *
 * Spot is klines and nothing else: no marks, no funding, no liquidations. So this class is the
 * socket, the mode policy and the clock, over the shared `KlineIngest` — the same ingest the perp
 * collector runs, with spot's stream id, `market = 'spot'` and `/api/v3/klines` for repair.
 *
 * **REST weight**: repair only in steady state, against spot's own 6000/min budget (§4.5);
 * degraded mode polls `klines?limit=2` per symbol at the §16.1 cadence (3 s for the signal set,
 * 15 s for the rest) — for a 30-symbol universe ≈ 168 weight/min, under 3 % of that budget, and
 * only while the socket is mute.
 *
 * A universe symbol with no `binance_spot` mapping never reaches this class: the service filters
 * it out and `/health` lists it under `noSpot` (§2.3 — no spot market is a fact, not a fault).
 */

export const STREAM_KLINE_SPOT = 'binance-spot:kline_1m';
export const MARKET = 'spot' as const;
export const VENUE_LOGGER_NAME = 'BinanceSpotCollector';

export interface SpotCollectorRegistry {
  /**
   * IB-011: the third argument is a poller's period. Spot's kline stream is a socket that ticks
   * whenever the market trades, so it declares none and the watchdog judges it on silence alone.
   */
  register(id: string, venue: string, expectedIntervalSec?: number | null): void;
  recordMessage(id: string, at?: number): void;
  recordReconnect(id: string, at?: number): void;
  setMode?(id: string, mode: CollectorMode, reason?: string | null): void;
}

export interface SpotCollectorSocket {
  open(): void;
  stop(): void;
}

export interface SpotCollectorPorts {
  symbols: readonly string[];
  signalSet: readonly string[];
  writers: KlineIngestWriters;
  registry: SpotCollectorRegistry;
  metrics?: KlineIngestMetrics & { wsReconnects: { inc(labels: Record<string, string>, value?: number): void } };
  rest: SpotRest;
  /** The lifted REST paginator, for gap repair (`BinanceAdapter` satisfies it). */
  candles: CandleSource;
  socketFactory(handlers: {
    onOpen(): void;
    onMessage(stream: string, data: unknown): void;
    onClose(code: number): void;
    onError(message: string): void;
  }, streams: readonly string[]): SpotCollectorSocket;
  /** Last stored spot bar per symbol, for the boot seed; omitted when the DB is not readable. */
  lastOpenTimes?(): Promise<Map<string, number>>;
  logger: { log(message: string): void; warn(message: string): void };
  now?: () => number;
  mode?: ModePolicyOptions;
}

export class BinanceSpotCollector {
  private readonly policy: ModePolicy;
  private readonly instruments = new Map<string, Instrument>();
  private readonly klines: KlineIngest;
  private readonly now: () => number;
  private socket: SpotCollectorSocket | null = null;
  private ticking = false;
  private stopped = false;

  constructor(private readonly ports: SpotCollectorPorts) {
    this.now = ports.now ?? Date.now;
    this.policy = new ModePolicy(ports.mode);
    for (const symbol of ports.symbols) this.instruments.set(symbol, spotInstrument(symbol));
    this.klines = new KlineIngest({
      stream: STREAM_KLINE_SPOT,
      market: MARKET,
      symbols: ports.symbols,
      signalSet: ports.signalSet,
      instrumentOf: (symbol) => this.instrumentOf(symbol),
      writers: ports.writers,
      candles: ports.candles,
      restKlines: (symbol, limit) => ports.rest.klines(symbol, limit),
      registry: ports.registry,
      metrics: ports.metrics,
      logger: ports.logger,
      lastOpenTimes: ports.lastOpenTimes,
      now: () => this.now(),
    });
  }

  get mode(): CollectorMode {
    return this.policy.mode;
  }

  /** Boot: register the stream, seed gap repair from storage and REST-fill before the socket opens. */
  async start(): Promise<void> {
    this.ports.registry.register(STREAM_KLINE_SPOT, VENUE);
    await this.klines.seedFromStorage();
    this.connect();
  }

  /** The one clock: mode transitions and degraded polling. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const now = this.now();
      const transition = this.policy.tick(now);
      if (transition) this.act(transition);
      if (this.policy.mode === 'degraded') await this.klines.pollDegraded(now);
    } catch (error) {
      this.ports.logger.warn(`binance-spot tick failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.socket?.stop();
    this.socket = null;
  }

  /** One demultiplexed payload. Public so a spec can drive the collector without a socket. */
  async onMessage(stream: string, data: unknown): Promise<void> {
    const now = this.now();
    if (this.policy.onMessage(now)) this.onRecovered();
    if (!stream.endsWith('@kline_1m')) return;
    const message = data as BinanceWsKlineMessage;
    if (message?.k === undefined) return;
    this.ports.registry.recordMessage(STREAM_KLINE_SPOT, now);
    if (!message.k.x) return; // the forming bar is /health's business only (§4.1)
    const symbol = message.k.s;
    await this.klines.writeClosed(symbol, mapWsKline(`${VENUE}:${symbol}`, message), 'ws', now);
  }

  private handlers() {
    return {
      onOpen: () => {
        this.policy.onOpen(this.now());
        this.ports.logger.log('binance-spot socket open');
      },
      onMessage: (stream: string, data: unknown) => void this.onMessage(stream, data),
      onClose: (code: number) => {
        this.policy.onClosed();
        this.ports.metrics?.wsReconnects.inc({ stream: STREAM_KLINE_SPOT });
        this.ports.registry.recordReconnect(STREAM_KLINE_SPOT, this.now());
        this.ports.logger.warn(`binance-spot socket closed (${code})`);
      },
      onError: (message: string) => this.ports.logger.warn(`binance-spot socket error: ${message}`),
    };
  }

  private act(event: { kind: 'reconnect' } | { kind: 'degrade'; reason: string } | { kind: 'recover' }): void {
    if (event.kind === 'reconnect') return this.connect();
    if (event.kind === 'degrade') {
      // Spot loses nothing while degraded: every bar REST returns is the bar the socket would
      // have sent, so unlike perp's liquidations there is no unrepairable window to record.
      this.ports.logger.warn(`binance-spot degraded (${event.reason}): klines over REST`);
      this.socket?.stop();
      this.socket = null;
      this.setMode('degraded', event.reason);
      return;
    }
    this.onRecovered();
  }

  private connect(): void {
    this.socket?.stop();
    this.socket = this.ports.socketFactory(this.handlers(), spotStreamNames(this.ports.symbols));
    this.policy.onConnecting(this.now()); // the handshake takes seconds: no second socket meanwhile
    this.socket.open();
  }

  private onRecovered(): void {
    this.setMode('ws', null);
    this.ports.logger.log('binance-spot back on the websocket');
  }

  private setMode(mode: CollectorMode, reason: string | null): void {
    this.ports.registry.setMode?.(STREAM_KLINE_SPOT, mode, reason);
  }

  private instrumentOf(symbol: string): Instrument {
    const known = this.instruments.get(symbol);
    if (known) return known;
    const made = spotInstrument(symbol);
    this.instruments.set(symbol, made);
    return made;
  }
}

/**
 * The minimal `Instrument` the lifted REST paginator and GapRepair need for a spot symbol. The id
 * is the same `binance:SYMBOL` the perp collector uses — one venue, and `candles_1m` keys on
 * `(venue, market, symbol, open_time)`, so the market is what separates the two markets' rows.
 */
export function spotInstrument(symbol: string): Instrument {
  return {
    id: `${VENUE}:${symbol}`,
    venue: VENUE,
    symbol,
    assetClass: 'crypto-spot',
    displayName: symbol,
    pricePrecision: 8,
    quoteCurrency: symbol.endsWith('USDT') ? 'USDT' : 'USD',
    sessionTimezone: 'UTC',
  } as Instrument;
}
