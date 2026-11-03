import type { LiquidationRow } from '../writers/tables';
import { liquidationRows, VENUE } from './mappers';
import { isLiquidationMessage, isTickerMessage } from './payloads';

/**
 * IB-008, slimmed by WD-010 — the Bybit liquidation collector (design §4.3; storage ruling
 * 2026-11-03: liquidations are stored because no venue serves their history).
 *
 * Writes `liquidations` from `allLiquidation.{symbol}`, nothing else: the tickers, the per-minute
 * mark rows and the funding settlements went with the funding tape (S1 — funding is read from the
 * venue on demand, WD-009).
 *
 * **One `tickers.{symbol}` topic stays, for ONE symbol, as the socket's liveness signal** and is
 * never stored. The socket's dead-socket rule is "no message for 90 s → reconnect"; liquidations
 * alone are legitimately silent for many minutes (11 min seen on 2026-11-03), so timed on them the
 * socket would be torn down every 90 s and lose what arrived during each reconnect, and a socket
 * that subscribed to nothing would look like a calm market. One symbol's ticker keeps "silent"
 * meaning "dead".
 */
export const STREAM_LIQUIDATION = 'bybit:allLiquidation';

export interface BybitWriters {
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
  /** Universe symbols that carry a `bybit_linear` mapping; the first carries the liveness topic. */
  symbols: readonly string[];
  writers: BybitWriters;
  registry: BybitRegistry;
  socketFactory(handlers: {
    onOpen(): void;
    onMessage(payload: unknown): void;
    onClose(code: number): void;
    onError(message: string): void;
    onSubscribeFailed(message: string): void;
  }, topics: readonly string[]): BybitSocketLike;
  logger: BybitLogger;
  now?: () => number;
}

/** The topics: every symbol's liquidations, and one symbol's ticker for liveness. */
export function bybitTopics(symbols: readonly string[]): string[] {
  if (symbols.length === 0) throw new RangeError('bybitTopics: no symbols — nothing to carry the liveness topic');
  return [`tickers.${symbols[0]}`, ...symbols.map((symbol) => `allLiquidation.${symbol}`)];
}

export class BybitCollector {
  private readonly now: () => number;
  private socket: BybitSocketLike | null = null;
  private stopped = false;

  constructor(private readonly ports: BybitCollectorPorts) {
    this.now = ports.now ?? Date.now;
    // IB-BUG-018: `allLiquidation.{symbol}` is subscribed per universe symbol on the LINEAR endpoint
    // (BYBIT_WS_URL …/v5/public/linear), so an inverse `BTCUSD` cannot arrive. The universe is the
    // only way one could: refuse a symbol that is not `<BASE>USDT` instead of storing its
    // price × qty as USD.
    const misfit = ports.symbols.filter((symbol) => !/^[^_\s]+USDT$/u.test(symbol));
    if (misfit.length > 0) throw new RangeError(`bybit universe has non-USDT-linear symbols ${misfit.join(', ')}`);
  }

  start(): void {
    this.ports.registry.register(STREAM_LIQUIDATION, VENUE);
    this.socket = this.ports.socketFactory(this.handlers(), bybitTopics(this.ports.symbols));
    this.socket.open();
  }

  /** The silence watchdog (the socket owns the rule; this is its clock). */
  tick(): void {
    if (this.stopped) return;
    this.socket?.checkSilence(this.now());
  }

  stop(): void {
    this.stopped = true;
    this.socket?.stop();
    this.socket = null;
  }

  private handlers() {
    return {
      onOpen: () => this.ports.logger.log(`bybit socket open (${this.ports.symbols.length} symbols)`),
      onMessage: (payload: unknown) =>
        void this.onMessage(payload).catch((error: unknown) =>
          this.ports.logger.warn(`bybit handler failed: ${(error as Error).message}`),
        ),
      onClose: (code: number) => {
        this.ports.registry.recordReconnect(STREAM_LIQUIDATION, this.now());
        this.ports.logger.warn(`bybit socket closed (${code})`);
      },
      onError: (message: string) => this.ports.logger.warn(`bybit socket: ${message}`),
      // A refused topic is the failure mode this collector was told to watch for: `liquidation.{symbol}`
      // is retired and answers "handler not found". Never swallow it.
      onSubscribeFailed: (message: string) => this.ports.logger.warn(`bybit REFUSED a subscription: ${message}`),
    };
  }

  /** One data message. Public so specs can drive the collector without a socket. */
  async onMessage(payload: unknown): Promise<void> {
    if (isLiquidationMessage(payload)) {
      this.ports.registry.recordMessage(STREAM_LIQUIDATION, this.now());
      const rows = liquidationRows(payload.data);
      if (rows.length > 0) await this.ports.writers.liquidations.write(rows);
      return;
    }
    if (isTickerMessage(payload)) return; // liveness only: the socket has already timed it
  }
}
