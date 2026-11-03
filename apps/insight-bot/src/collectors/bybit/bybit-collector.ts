import type { FundingSettlementRow, LiquidationRow, MarkFundingRow } from '../writers/tables';
import { fundingSettlementRow, liquidationRows, VENUE } from './mappers';
import { isLiquidationMessage, isTickerMessage } from './payloads';
import type { BybitRest } from '../../venues/bybit/bybit.rest';
import { shouldPageFurther } from '../../venues/bybit/bybit.rest';
import { TickerState } from './ticker-state';
import { describeFailure, step, writeIsolated } from '../writers/write-isolated';

/**
 * IB-008 — the Bybit collector (design §4.3).
 *
 * What it writes: `liquidations` from `allLiquidation.{symbol}`, and `mark_funding_1m` from
 * `tickers.{symbol}` — **per minute for the signal set, at the settlement second for everyone
 * else** (§3.3's volume rule) — plus `funding_settlements` from the REST history when an interval
 * settles, and on boot as far back as the venue serves.
 *
 * As in IB-005, the decisions are pure (`TickerState`, the mappers) and this class is the wiring,
 * driven in specs through ports with no socket and no network.
 */

export const STREAM_TICKERS = 'bybit:tickers';
export const STREAM_LIQUIDATION = 'bybit:allLiquidation';

export interface BybitWriters {
  markFunding: { write(rows: readonly MarkFundingRow[]): Promise<number> };
  fundingSettlements: { write(rows: readonly FundingSettlementRow[]): Promise<number> };
  liquidations: { write(rows: readonly LiquidationRow[]): Promise<number> };
}

export interface BybitRegistry {
  register(id: string, venue: string): void;
  recordMessage(id: string, at?: number): void;
  recordReconnect(id: string, at?: number): void;
}

export interface BybitSocketLike {
  open(): void;
  stop(): void;
  checkSilence(now?: number): boolean;
}

export interface BybitLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface BybitCollectorPorts {
  /** Universe symbols that carry a `bybit_linear` mapping, as the venue names them. */
  symbols: readonly string[];
  signalSet: readonly string[];
  writers: BybitWriters;
  registry: BybitRegistry;
  rest: BybitRest;
  socketFactory(handlers: {
    onOpen(): void;
    onMessage(payload: unknown): void;
    onClose(code: number): void;
    onError(message: string): void;
    onSubscribeFailed(message: string): void;
  }, topics: readonly string[]): BybitSocketLike;
  /** Earliest stored settlement per symbol, so the boot backfill stops when it catches up. */
  earliestFundingTimes?(): Promise<Map<string, number>>;
  logger: BybitLogger;
  now?: () => number;
  /** Safety rail on the cold backfill: the measured depth is ~36 pages per symbol. */
  maxBackfillPages?: number;
}

export const DEFAULT_MAX_BACKFILL_PAGES = 40;

export class BybitCollector {
  private readonly state: TickerState;
  private readonly symbols: ReadonlySet<string>;
  private readonly now: () => number;
  private socket: BybitSocketLike | null = null;
  private backfill: Promise<void> | undefined;
  private lastMinute: number | null = null;
  private ticking = false;
  private stopped = false;

  constructor(private readonly ports: BybitCollectorPorts) {
    this.now = ports.now ?? Date.now;
    this.symbols = new Set(ports.symbols);
    this.state = new TickerState(new Set(ports.signalSet.filter((s) => this.symbols.has(s))));
  }

  /**
   * Boot: register, **open the socket first**, then backfill funding history in the background.
   *
   * The order matters and the first live run proved it: awaiting the backfill blocked Nest's
   * bootstrap for minutes (102 762 rows over 30 symbols), so `/health` never came up and — worse
   * for this venue — every liquidation in that window was lost, because `allLiquidation` is
   * websocket-only and has no REST equivalent to recover it. Settled funding, by contrast, is
   * historical: fetching it a minute later costs nothing.
   */
  async start(): Promise<void> {
    this.ports.registry.register(STREAM_TICKERS, VENUE);
    this.ports.registry.register(STREAM_LIQUIDATION, VENUE);
    const topics = this.ports.symbols.flatMap((symbol) => [`tickers.${symbol}`, `allLiquidation.${symbol}`]);
    this.socket = this.ports.socketFactory(this.handlers(), topics);
    this.socket.open();
    this.backfill = this.backfillFunding().catch((error) => {
      this.ports.logger.warn(`bybit funding backfill failed: ${(error as Error).message}`);
    });
  }

  /** Resolves when the boot backfill has finished — specs await it; production does not. */
  async whenBackfilled(): Promise<void> {
    await this.backfill;
  }

  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const now = this.now();
      this.socket?.checkSilence(now);
      await this.onMinuteBoundary(now);
    } catch (error) {
      this.ports.logger.warn(`bybit tick failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.socket?.stop();
    this.socket = null;
  }

  private handlers() {
    return {
      onOpen: () => this.ports.logger.log(`bybit socket open (${this.ports.symbols.length} symbols)`),
      onMessage: (payload: unknown) => void this.onMessage(payload),
      onClose: (code: number) => {
        this.ports.registry.recordReconnect(STREAM_TICKERS, this.now());
        this.ports.logger.warn(`bybit socket closed (${code})`);
      },
      onError: (message: string) => this.ports.logger.warn(`bybit socket: ${message}`),
      // A refused topic is the failure mode this task was told to watch for: `liquidation.{symbol}`
      // is retired and answers "handler not found". Never swallow it.
      onSubscribeFailed: (message: string) => this.ports.logger.warn(`bybit REFUSED a subscription: ${message}`),
    };
  }

  /** One data message. Public so specs can drive the collector without a socket. */
  async onMessage(payload: unknown): Promise<void> {
    const now = this.now();
    if (isLiquidationMessage(payload)) {
      this.ports.registry.recordMessage(STREAM_LIQUIDATION, now);
      const rows = liquidationRows(payload.data);
      if (rows.length > 0) await this.ports.writers.liquidations.write(rows);
      return;
    }
    if (isTickerMessage(payload)) {
      this.ports.registry.recordMessage(STREAM_TICKERS, now);
      const symbol = payload.data.symbol ?? payload.topic.slice('tickers.'.length);
      this.state.accept(symbol, payload.data, payload.type);
      await this.settleFunding();
    }
  }

  /** Per-minute rows for the signal set only (§3.3). */
  private async onMinuteBoundary(now: number): Promise<void> {
    const boundary = Math.floor(now / 60_000) * 60_000;
    if (this.lastMinute === null) {
      this.lastMinute = boundary;
      return;
    }
    if (boundary <= this.lastMinute) return;
    this.lastMinute = boundary;
    const rows = this.state.sampleMinute(new Date(boundary));
    if (rows.length > 0) await this.ports.writers.markFunding.write(rows);
  }

  /**
   * A settlement: keep the last prediction at the settlement second (every symbol, which is how
   * the non-signal-set symbols get their rows) and fetch the settled rate.
   */
  private async settleFunding(): Promise<void> {
    const rollovers = this.state.rollovers();
    if (rollovers.length === 0) return;
    // IB-BUG-015: a refused prediction row must not cost the settled rate fetched below.
    const predictions = rollovers.map((r) => r.lastPrediction);
    for (const failure of await writeIsolated([step('mark_funding_1m', predictions, (rows) => this.ports.writers.markFunding.write(rows))])) {
      this.ports.logger.warn(describeFailure('bybit', failure));
    }
    const settled: FundingSettlementRow[] = [];
    for (const rollover of rollovers) {
      try {
        const [row] = await this.ports.rest.fundingHistory(rollover.symbol, undefined, 1);
        if (row) settled.push(fundingSettlementRow(row));
      } catch (error) {
        this.ports.logger.warn(`bybit funding fetch failed for ${rollover.symbol}: ${(error as Error).message}`);
      }
    }
    if (settled.length > 0) await this.ports.writers.fundingSettlements.write(settled);
  }

  /**
   * Boot: page settled funding backwards per symbol until the rows reach what is already stored
   * (or the venue runs out). Measured cold depth: ~30–36 pages per symbol, back to listing.
   */
  private async backfillFunding(): Promise<void> {
    const maxPages = this.ports.maxBackfillPages ?? DEFAULT_MAX_BACKFILL_PAGES;
    let stored = new Map<string, number>();
    if (this.ports.earliestFundingTimes) {
      try {
        stored = await this.ports.earliestFundingTimes();
      } catch (error) {
        this.ports.logger.warn(`bybit funding coverage read failed: ${(error as Error).message}`);
      }
    }

    for (const symbol of this.ports.symbols) {
      const earliestStored = stored.get(symbol) ?? null;
      let endTime: number | undefined;
      let pages = 0;
      let written = 0;
      let oldest: number | null = null;
      try {
        for (;;) {
          const list = await this.ports.rest.fundingHistory(symbol, endTime);
          if (list.length === 0) break;
          pages++;
          const rows = list.map(fundingSettlementRow);
          written += await this.ports.writers.fundingSettlements.write(rows);
          const times = rows.map((r) => r.fundingTime.getTime());
          oldest = Math.min(...times, oldest ?? Number.POSITIVE_INFINITY);
          endTime = (oldest as number) - 1;
          if (!shouldPageFurther(oldest as number, earliestStored, pages, maxPages)) break;
        }
        if (pages > 0) {
          this.ports.logger.log(
            `bybit funding backfill ${symbol}: ${written} rows over ${pages} page(s)` +
              (oldest ? `, back to ${new Date(oldest).toISOString().slice(0, 10)}` : ''),
          );
        }
      } catch (error) {
        this.ports.logger.warn(`bybit funding backfill failed for ${symbol}: ${(error as Error).message}`);
      }
    }
  }
}
