import type { Candle, Instrument } from '@trade-automation/contracts';
import { mapRestKline, type BinanceRestKline } from '@trade-automation/binance-client';
import { GapRepair, type CandleSource } from '@trade-automation/market-data-core';
import type { Candle1mRow, CollectorGapRow } from '../writers/tables';
import { klinePollIntervalMs } from './mode';
import { candleRow, expectedBars, gapRow } from './rows';

/**
 * IB-006 — the 1m kline half of a Binance collector, which is the whole of spot (§4.2) and the
 * part of perp (§4.1) that is not marks, funding or liquidations: a closed bar goes through
 * `GapRepair` and becomes rows plus any hole it reports, a restart is seeded from storage and
 * REST-filled, and degraded mode polls the same bars over REST at the ruling cadence.
 *
 * Both collectors keep their own instance, so each has its own `GapRepair` and its own stream id,
 * market and REST path; nothing about a venue's market lives in here.
 */

export interface KlineIngestWriters {
  candles1m: { write(rows: readonly Candle1mRow[]): Promise<number> };
  collectorGaps: { write(rows: readonly CollectorGapRow[]): Promise<number> };
}

export interface KlineIngestMetrics {
  gapsDetected: { inc(labels: Record<string, string>, value?: number): void };
  gapsUnrepaired: { inc(labels: Record<string, string>, value?: number): void };
}

export interface KlineIngestPorts {
  /** The registry stream id these bars belong to (`binance-perp:kline_1m`, `binance-spot:kline_1m`). */
  stream: string;
  market: 'perp' | 'spot';
  symbols: readonly string[];
  /** The symbols polled at the fast degraded cadence (§16.1). */
  signalSet: readonly string[];
  instrumentOf(symbol: string): Instrument;
  writers: KlineIngestWriters;
  candles: CandleSource;
  /** The venue's `klines?limit=` call — `/fapi/v1/klines` or `/api/v3/klines`. */
  restKlines(symbol: string, limit: number): Promise<BinanceRestKline[]>;
  registry: { recordMessage(id: string, at?: number): void };
  metrics?: KlineIngestMetrics;
  logger: { log(message: string): void; warn(message: string): void };
  /** Last stored bar per symbol, for the boot seed; omitted when the DB is not readable. */
  lastOpenTimes?(): Promise<Map<string, number>>;
  now(): number;
}

export class KlineIngest {
  private readonly gapRepair = new GapRepair();
  private readonly lastPoll = new Map<string, number>();

  constructor(private readonly ports: KlineIngestPorts) {}

  /** A closed 1m bar: through GapRepair, then the rows and any hole it reports. */
  async writeClosed(symbol: string, candle: Candle, source: 'ws' | 'rest', now: number): Promise<void> {
    const { stream, market, metrics } = this.ports;
    const instrument = this.ports.instrumentOf(symbol);
    const { ordered, gap } = await this.gapRepair.onClosed1m(instrument, candle, this.ports.candles, 'up');
    const rows = ordered.map((c) => candleRow(c, market, c === candle ? source : 'rest'));
    if (rows.length > 0) await this.ports.writers.candles1m.write(rows);
    if (!gap) return;

    const expected = expectedBars(gap.from, gap.to);
    metrics?.gapsDetected.inc({ stream });
    if (gap.count < expected) metrics?.gapsUnrepaired.inc({ stream });
    await this.ports.writers.collectorGaps.write([
      gapRow({
        stream, market, symbol,
        from: gap.from, to: gap.to, expected, repaired: gap.count, error: gap.error, detectedAt: new Date(now),
      }),
    ]);
  }

  /** Degraded kline polling: the signal set every 3 s, the rest every 15 s (§16.1). */
  async pollDegraded(now: number): Promise<void> {
    for (const symbol of this.ports.symbols) {
      const interval = klinePollIntervalMs(this.ports.signalSet.includes(symbol));
      const last = this.lastPoll.get(symbol) ?? 0;
      if (now - last < interval) continue;
      this.lastPoll.set(symbol, now);
      try {
        const rows = await this.ports.restKlines(symbol, 2);
        // the venue answered: the stream is alive, just on REST — otherwise the watchdog (IB-011)
        // would call a working degraded collector silent
        this.ports.registry.recordMessage(this.ports.stream, now);
        const closed = rows.find((row) => isClosedRow(row, now));
        if (closed) await this.writeClosed(symbol, mapRestKline(this.ports.instrumentOf(symbol).id, closed), 'rest', now);
      } catch (error) {
        this.ports.logger.warn(`degraded kline poll failed for ${symbol}: ${(error as Error).message}`);
      }
    }
  }

  /** Seed `GapRepair` from the newest stored bar and REST-fill to now, before any socket (§4.1). */
  async seedFromStorage(): Promise<void> {
    if (!this.ports.lastOpenTimes) return;
    let stored: Map<string, number>;
    try {
      stored = await this.ports.lastOpenTimes();
    } catch (error) {
      this.ports.logger.warn(`boot seed read failed, starting without it: ${(error as Error).message}`);
      return;
    }
    const { stream, market, metrics } = this.ports;
    const known = new Set(this.ports.symbols);
    const now = this.ports.now();
    for (const [symbol, openTime] of stored) {
      if (!known.has(symbol)) continue;
      const instrument = this.ports.instrumentOf(symbol);
      this.gapRepair.seed(instrument.id, openTime);
      const from = openTime + 60_000;
      const to = minuteFloor(now) - 60_000;
      if (to < from) continue;
      try {
        const candles = await this.ports.candles.fetchCandles(instrument, '1m', from, to);
        if (candles.length > 0) {
          await this.ports.writers.candles1m.write(candles.map((c) => candleRow(c, market, 'rest')));
          this.gapRepair.seed(instrument.id, candles[candles.length - 1].openTime);
        }
        // Every hole a restart left is recorded, repaired or not: "the restart repaired N bars"
        // is exactly what the daily gap report (§6.2) and the Tester's restart check read.
        const expected = expectedBars(from, to);
        await this.ports.writers.collectorGaps.write([
          gapRow({
            stream, market, symbol, from, to,
            expected, repaired: candles.length,
            error: candles.length < expected ? 'boot backfill incomplete' : undefined,
            detectedAt: new Date(now),
          }),
        ]);
        if (candles.length < expected) metrics?.gapsUnrepaired.inc({ stream });
        metrics?.gapsDetected.inc({ stream });
      } catch (error) {
        this.ports.logger.warn(`boot backfill failed for ${symbol}: ${(error as Error).message}`);
      }
    }
  }
}

/** A closed REST kline row: its close time is in the past (column 6). */
function isClosedRow(row: BinanceRestKline, now: number): boolean {
  return typeof row?.[6] === 'number' && row[6] <= now;
}

/** The open of the minute `now` falls in. */
function minuteFloor(now: number): number {
  return Math.floor(now / 60_000) * 60_000;
}
