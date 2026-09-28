import type { Candle, Instrument } from '@trade-automation/contracts';
import { mapRestKline, mapWsKline, type BinanceRestKline, type BinanceWsKlineMessage } from '@trade-automation/binance-client';
import { GapRepair, type CandleSource } from '@trade-automation/market-data-core';
import type { Candle1mRow, CollectorGapRow, FundingSettlementRow, LiquidationRow, MarkFundingRow } from '../writers/tables';
import { DegradedGapTracker } from './degraded-gaps';
import { fundingSettlementRow, liquidationRowFromEvent, markRowFromPremiumIndex, VENUE } from './mappers';
import { MarkSampler, minuteBoundary } from './mark-sampler';
import { ModePolicy, klinePollIntervalMs, type CollectorMode, type ModePolicyOptions } from './mode';
import { isForceOrderEvent, isMarkPriceEvent, type MarkPriceEvent } from './payloads';
import { candleRow, expectedBars, gapRow } from './rows';
import type { PerpRest } from './rest';
import { perpStreamNames } from './perp-socket';

/**
 * IB-005 — the Binance USD-M perp collector (design §4.1, §16.1).
 *
 * **REST weight**: ≈ 0.1 weight/min in steady state (gap repair only, 5 per repaired range, plus
 * one `fundingRate` per symbol per 8 h settlement); ≈ 178 weight/min while degraded (§16.1), which
 * is ~7 % of the 2400 budget and never the resting state.
 *
 * Everything that decides is pure and lives beside this file (`ModePolicy`, `MarkSampler`,
 * `DegradedGapTracker`, the mappers); this class is the wiring: it owns the socket, the clock tick
 * and the writers, and is driven in specs through injected ports with no network at all.
 */

export const STREAM_KLINE = 'binance-perp:kline_1m';
export const STREAM_MARK = 'binance-perp:markPrice';
export const STREAM_LIQUIDATION = 'binance-perp:forceOrder';
export const MARKET = 'perp' as const;
export const VENUE_LOGGER_NAME = 'BinancePerpCollector';

/** The writers this collector uses; `Writers` satisfies it structurally. */
export interface CollectorWriters {
  candles1m: { write(rows: readonly Candle1mRow[]): Promise<number> };
  markFunding: { write(rows: readonly MarkFundingRow[]): Promise<number> };
  fundingSettlements: { write(rows: readonly FundingSettlementRow[]): Promise<number> };
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
  gapsDetected: { inc(labels: Record<string, string>, value?: number): void };
  gapsUnrepaired: { inc(labels: Record<string, string>, value?: number): void };
  wsReconnects: { inc(labels: Record<string, string>, value?: number): void };
  setBinanceWeightUsed1m(weight: number): void;
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
  symbols: readonly string[];
  signalSet: readonly string[];
  writers: CollectorWriters;
  registry: CollectorRegistry;
  metrics?: CollectorMetrics;
  rest: PerpRest;
  /** The lifted REST paginator, for gap repair (`BinanceAdapter` satisfies it). */
  candles: CandleSource;
  /** Builds the socket from the handlers this collector supplies. */
  socketFactory(handlers: {
    onOpen(): void;
    onMessage(stream: string, data: unknown): void;
    onClose(code: number): void;
    onError(message: string): void;
  }, streams: readonly string[]): CollectorSocket;
  /** Last stored bar per symbol, for the boot seed; omitted when the DB is not readable. */
  lastOpenTimes?(): Promise<Map<string, number>>;
  logger: CollectorLogger;
  now?: () => number;
  mode?: ModePolicyOptions;
}

export class BinancePerpCollector {
  private readonly policy: ModePolicy;
  private readonly sampler = new MarkSampler();
  private readonly gapRepair = new GapRepair();
  private readonly degradedGaps = new DegradedGapTracker();
  private readonly instruments = new Map<string, Instrument>();
  private readonly lastKlinePoll = new Map<string, number>();
  private readonly now: () => number;
  private socket: CollectorSocket | null = null;
  private lastMinute: number | null = null;
  private ticking = false;
  private stopped = false;

  constructor(private readonly ports: PerpCollectorPorts) {
    this.now = ports.now ?? Date.now;
    this.policy = new ModePolicy(ports.mode);
    for (const symbol of ports.symbols) this.instruments.set(symbol, perpInstrument(symbol));
  }

  get mode(): CollectorMode {
    return this.policy.mode;
  }

  /** Boot: register the streams, seed gap repair from storage and REST-fill before the socket opens. */
  async start(): Promise<void> {
    for (const id of [STREAM_KLINE, STREAM_MARK, STREAM_LIQUIDATION]) this.ports.registry.register(id, VENUE);
    await this.seedFromStorage();
    this.act({ kind: 'reconnect' });
  }

  /** The one clock: mode transitions, the minute boundary, and degraded polling. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const now = this.now();
      const transition = this.policy.tick(now);
      if (transition) await this.act(transition, now);
      await this.rollDegradedDays(now);
      await this.onMinuteBoundary(now);
      if (this.policy.mode === 'degraded') await this.pollDegraded(now);
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
      onMessage: (stream: string, data: unknown) => void this.onMessage(stream, data),
      onClose: (code: number) => {
        this.policy.onClosed();
        this.ports.metrics?.wsReconnects.inc({ stream: STREAM_KLINE });
        this.ports.registry.recordReconnect(STREAM_KLINE, this.now());
        this.ports.logger.warn(`binance-perp socket closed (${code})`);
      },
      onError: (message: string) => this.ports.logger.warn(`binance-perp socket error: ${message}`),
    };
  }

  /** One demultiplexed payload. Public so a spec can drive the collector without a socket. */
  async onMessage(stream: string, data: unknown): Promise<void> {
    const now = this.now();
    const recovered = this.policy.onMessage(now);
    if (recovered) await this.onRecovered(now);

    if (isMarkPriceEvent(data)) return this.onMarkPrice([data], now);
    if (Array.isArray(data) && data.length > 0 && isMarkPriceEvent(data[0])) return this.onMarkPrice(data as MarkPriceEvent[], now);
    if (isForceOrderEvent(data)) return this.onForceOrder(data, now);
    if (stream.endsWith('@kline_1m')) return this.onKline(data as BinanceWsKlineMessage, now);
  }

  private onMarkPrice(events: readonly MarkPriceEvent[], now: number): void {
    for (const event of events) this.sampler.accept(event);
    this.ports.registry.recordMessage(STREAM_MARK, now);
  }

  private async onForceOrder(event: Parameters<typeof liquidationRowFromEvent>[0], now: number): Promise<void> {
    this.ports.registry.recordMessage(STREAM_LIQUIDATION, now);
    await this.ports.writers.liquidations.write([liquidationRowFromEvent(event)]);
  }

  private async onKline(message: BinanceWsKlineMessage, now: number): Promise<void> {
    if (message?.k === undefined) return;
    this.ports.registry.recordMessage(STREAM_KLINE, now);
    if (!message.k.x) return; // the forming bar is /health's business only (§4.1)
    const symbol = message.k.s;
    await this.writeClosed(symbol, mapWsKline(`${VENUE}:${symbol}`, message), 'ws', now);
  }

  // ---------------------------------------------------------------------------------------------
  // writing
  // ---------------------------------------------------------------------------------------------

  /** A closed 1m bar: through GapRepair, then the rows and any hole it reports. */
  private async writeClosed(symbol: string, candle: Candle, source: 'ws' | 'rest', now: number): Promise<void> {
    const instrument = this.instrumentOf(symbol);
    const { ordered, gap } = await this.gapRepair.onClosed1m(instrument, candle, this.ports.candles, 'up');
    const rows = ordered.map((c) => candleRow(c, MARKET, c === candle ? source : 'rest'));
    if (rows.length > 0) await this.ports.writers.candles1m.write(rows);
    if (!gap) return;

    const expected = expectedBars(gap.from, gap.to);
    this.ports.metrics?.gapsDetected.inc({ stream: STREAM_KLINE });
    if (gap.count < expected) this.ports.metrics?.gapsUnrepaired.inc({ stream: STREAM_KLINE });
    await this.ports.writers.collectorGaps.write([
      gapRow({
        stream: STREAM_KLINE, market: MARKET, symbol,
        from: gap.from, to: gap.to, expected, repaired: gap.count, error: gap.error, detectedAt: new Date(now),
      }),
    ]);
  }

  /** Every minute: the mark sample (D5), any funding settlement, and degraded mark polling. */
  private async onMinuteBoundary(now: number): Promise<void> {
    const boundary = minuteBoundary(now).getTime();
    if (this.lastMinute === null) {
      this.lastMinute = boundary;
      return; // the first tick is mid-minute: its sample belongs to a minute we did not watch whole
    }
    if (boundary <= this.lastMinute) return;
    this.lastMinute = boundary;

    if (this.policy.mode === 'degraded') await this.pollMark(new Date(boundary));
    else {
      const rows = this.sampler.sampleMinute(new Date(boundary));
      if (rows.length > 0) await this.ports.writers.markFunding.write(rows);
    }
    await this.settleFunding();
  }

  /** §4.1: on rollover, keep the last prediction at the settlement second and fetch the settled rate. */
  private async settleFunding(): Promise<void> {
    const rollovers = this.sampler.rollovers();
    if (rollovers.length === 0) return;
    await this.ports.writers.markFunding.write(rollovers.map((r) => r.lastPrediction));
    const settled: FundingSettlementRow[] = [];
    for (const rollover of rollovers) {
      try {
        const [row] = await this.ports.rest.fundingRate(rollover.symbol, 1);
        if (row) settled.push(fundingSettlementRow(row));
      } catch (error) {
        this.ports.logger.warn(`funding settlement fetch failed for ${rollover.symbol}: ${(error as Error).message}`);
      }
    }
    if (settled.length > 0) await this.ports.writers.fundingSettlements.write(settled);
  }

  // ---------------------------------------------------------------------------------------------
  // degraded mode (§16.1)
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
      this.ports.logger.warn(`binance-perp degraded (${event.reason}): REST polling, liquidations unavailable`);
      this.socket?.stop();
      this.socket = null;
      this.degradedGaps.begin(now);
      this.setMode('degraded', event.reason);
      return;
    }
    await this.onRecovered(now);
  }

  private async onRecovered(now: number): Promise<void> {
    const span = this.degradedGaps.end(now);
    if (span) await this.writeLiquidationGap(span.from, span.to);
    this.setMode('ws', null);
    this.ports.logger.log('binance-perp back on the websocket');
  }

  private setMode(mode: CollectorMode, reason: string | null): void {
    for (const id of [STREAM_KLINE, STREAM_MARK, STREAM_LIQUIDATION]) this.ports.registry.setMode?.(id, mode, reason);
  }

  /** A degraded spell that crosses UTC midnight is cut there, so each day's report sees its own row. */
  private async rollDegradedDays(now: number): Promise<void> {
    for (const span of this.degradedGaps.rollDay(now)) await this.writeLiquidationGap(span.from, span.to);
  }

  /** The liquidations lost while degraded: `repaired = 0`, with the reason (§16.1). */
  private async writeLiquidationGap(from: number, to: number): Promise<void> {
    this.ports.metrics?.gapsUnrepaired.inc({ stream: STREAM_LIQUIDATION });
    await this.ports.writers.collectorGaps.write([
      gapRow({
        stream: STREAM_LIQUIDATION, market: MARKET, symbol: null,
        from, to, expected: 0, repaired: 0,
        error: 'degraded mode: !forceOrder has no REST equivalent, liquidations in this window are lost',
        detectedAt: new Date(to),
      }),
    ]);
  }

  /** Degraded kline polling: the signal set every 3 s, the rest every 15 s (§16.1). */
  private async pollDegraded(now: number): Promise<void> {
    for (const symbol of this.ports.symbols) {
      const interval = klinePollIntervalMs(this.ports.signalSet.includes(symbol));
      const last = this.lastKlinePoll.get(symbol) ?? 0;
      if (now - last < interval) continue;
      this.lastKlinePoll.set(symbol, now);
      try {
        const rows = await this.ports.rest.klines(symbol, 2);
        // the venue answered: the stream is alive, just on REST — otherwise the watchdog (IB-011)
        // would call a working degraded collector silent
        this.ports.registry.recordMessage(STREAM_KLINE, now);
        const closed = rows.find((row) => isClosedRow(row, now));
        if (closed) await this.writeClosed(symbol, mapRestKline(`${VENUE}:${symbol}`, closed), 'rest', now);
      } catch (error) {
        this.ports.logger.warn(`degraded kline poll failed for ${symbol}: ${(error as Error).message}`);
      }
    }
  }

  /** Degraded mark/funding: one symbol-less premiumIndex per minute (§16.1). */
  private async pollMark(boundary: Date): Promise<void> {
    try {
      const rows = await this.ports.rest.premiumIndex();
      const wanted = rows.filter((row) => this.instruments.has(row.symbol));
      if (wanted.length > 0) await this.ports.writers.markFunding.write(wanted.map((row) => markRowFromPremiumIndex(row, boundary)));
      // the rollover check still runs off the samples the REST rows produce
      for (const row of wanted) {
        this.sampler.accept({ e: 'markPriceUpdate', E: row.time, s: row.symbol, p: row.markPrice, i: row.indexPrice, r: row.lastFundingRate, T: row.nextFundingTime });
      }
      this.sampler.sampleMinute(boundary); // drain: the rows were written from the REST payload
      this.ports.registry.recordMessage(STREAM_MARK, boundary.getTime());
    } catch (error) {
      this.ports.logger.warn(`degraded premiumIndex poll failed: ${(error as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------------------------------

  /** Seed `GapRepair` from the newest stored bar and REST-fill to now, before any socket (§4.1). */
  private async seedFromStorage(): Promise<void> {
    if (!this.ports.lastOpenTimes) return;
    let stored: Map<string, number>;
    try {
      stored = await this.ports.lastOpenTimes();
    } catch (error) {
      this.ports.logger.warn(`boot seed read failed, starting without it: ${(error as Error).message}`);
      return;
    }
    const now = this.now();
    for (const [symbol, openTime] of stored) {
      if (!this.instruments.has(symbol)) continue;
      this.gapRepair.seed(`${VENUE}:${symbol}`, openTime);
      const from = openTime + 60_000;
      const to = minuteBoundary(now).getTime() - 60_000;
      if (to < from) continue;
      try {
        const candles = await this.ports.candles.fetchCandles(this.instrumentOf(symbol), '1m', from, to);
        if (candles.length > 0) {
          await this.ports.writers.candles1m.write(candles.map((c) => candleRow(c, MARKET, 'rest')));
          this.gapRepair.seed(`${VENUE}:${symbol}`, candles[candles.length - 1].openTime);
        }
        // Every hole a restart left is recorded, repaired or not: "the restart repaired N bars"
        // is exactly what the daily gap report (§6.2) and the Tester's restart check read.
        const expected = expectedBars(from, to);
        await this.ports.writers.collectorGaps.write([
          gapRow({
            stream: STREAM_KLINE, market: MARKET, symbol, from, to,
            expected, repaired: candles.length,
            error: candles.length < expected ? 'boot backfill incomplete' : undefined,
            detectedAt: new Date(now),
          }),
        ]);
        if (candles.length < expected) this.ports.metrics?.gapsUnrepaired.inc({ stream: STREAM_KLINE });
        this.ports.metrics?.gapsDetected.inc({ stream: STREAM_KLINE });
      } catch (error) {
        this.ports.logger.warn(`boot backfill failed for ${symbol}: ${(error as Error).message}`);
      }
    }
  }

  private instrumentOf(symbol: string): Instrument {
    const known = this.instruments.get(symbol);
    if (known) return known;
    const made = perpInstrument(symbol);
    this.instruments.set(symbol, made);
    return made;
  }
}

/** A closed REST kline row: its close time is in the past (column 6). */
function isClosedRow(row: BinanceRestKline, now: number): boolean {
  return typeof row?.[6] === 'number' && row[6] <= now;
}

/** The minimal `Instrument` the lifted REST paginator and GapRepair need for a perp symbol. */
export function perpInstrument(symbol: string): Instrument {
  return {
    id: `${VENUE}:${symbol}`,
    venue: VENUE,
    symbol,
    assetClass: 'crypto-perp',
    displayName: symbol,
    pricePrecision: 8,
    quoteCurrency: symbol.endsWith('USDT') ? 'USDT' : 'USD',
    sessionTimezone: 'UTC',
  } as Instrument;
}
