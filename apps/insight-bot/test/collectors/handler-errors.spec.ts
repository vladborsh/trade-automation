import { BinancePerpCollector, type PerpCollectorPorts } from '../../src/collectors/binance-perp/perp-collector';
import type { PerpRest } from '../../src/venues/binance/perp.rest';
import { BinanceSpotCollector, type SpotCollectorPorts } from '../../src/collectors/binance-spot/spot-collector';
import type { SpotRest } from '../../src/venues/binance/spot.rest';
import type { Candle1mRow } from '../../src/collectors/writers/tables';

/**
 * A socket handler cannot be awaited: `onMessage` is async and `BinanceSocket` calls it from an
 * event listener, so a rejection has nowhere to return to. Both collectors used to write
 * `void this.onMessage(...)`, which **dropped the rejection silently** — one failing write and that
 * message was gone with the stream still looking healthy.
 *
 * The contract asserted here, for both collectors:
 *   1. a throwing handler is reported through the logger, naming the stream;
 *   2. it does not kill the feed — the socket is not stopped and the next message is ingested.
 */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const MINUTE = 60_000;

type Handlers = {
  onOpen(): void;
  onMessage(stream: string, data: unknown): void;
  onClose(code: number): void;
  onError(message: string): void;
};

function kline(symbol: string, openTime: number) {
  return {
    e: 'kline',
    E: openTime + 59_999,
    s: symbol,
    k: {
      t: openTime, T: openTime + 59_999, s: symbol, i: '1m',
      o: '100', h: '110', l: '90', c: '105', v: '10', x: true, q: '1050', n: 7, V: '4', Q: '420',
    },
  };
}

/** Lets the handler's promise chain settle; the socket itself never awaits it. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

function shared() {
  const warnings: string[] = [];
  const written: Candle1mRow[] = [];
  let failNext = true;
  const writers = {
    candles1m: {
      write: async (rows: readonly Candle1mRow[]) => {
        if (failNext) {
          failNext = false;
          throw new Error('no partition of relation candles_1m found for row');
        }
        written.push(...rows);
        return rows.length;
      },
    },
    collectorGaps: { write: async () => 0 },
  };
  const registry = {
    register: () => undefined,
    recordMessage: () => undefined,
    recordReconnect: () => undefined,
    setMode: () => undefined,
  };
  const candles = { fetchCandles: async () => [] };
  const logger = { log: () => undefined, warn: (m: string) => void warnings.push(m) };
  return { warnings, written, writers, registry, candles, logger };
}

describe('a throwing socket handler (both Binance collectors)', () => {
  it('spot: reports the failure, naming the stream, instead of dropping it', async () => {
    const s = shared();
    let handlers: Handlers | undefined;
    const sockets = { stopped: 0 };

    const ports: SpotCollectorPorts = {
      symbols: ['BTCUSDT'],
      signalSet: [],
      writers: s.writers,
      registry: s.registry,
      rest: { klines: async () => [] } as unknown as SpotRest,
      candles: s.candles,
      socketFactory: (h) => {
        handlers = h as Handlers;
        return { open: () => handlers?.onOpen(), stop: () => void sockets.stopped++ };
      },
      logger: s.logger,
      now: () => T0,
    };
    const collector = new BinanceSpotCollector(ports);
    await collector.start();

    handlers?.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 - MINUTE));
    await flush();

    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain('btcusdt@kline_1m');
    expect(s.warnings[0]).toContain('no partition of relation');
    expect(s.written).toEqual([]); // the bar really was lost — but now it is on the record
  });

  it('spot: keeps the feed alive — the next message is still ingested', async () => {
    const s = shared();
    let handlers: Handlers | undefined;
    const sockets = { stopped: 0 };

    const collector = new BinanceSpotCollector({
      symbols: ['BTCUSDT'],
      signalSet: [],
      writers: s.writers,
      registry: s.registry,
      rest: { klines: async () => [] } as unknown as SpotRest,
      candles: s.candles,
      socketFactory: (h) => {
        handlers = h as Handlers;
        return { open: () => handlers?.onOpen(), stop: () => void sockets.stopped++ };
      },
      logger: s.logger,
      now: () => T0,
    });
    await collector.start();

    handlers?.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 - 2 * MINUTE));
    await flush();
    handlers?.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 - MINUTE));
    await flush();

    expect(s.written.map((r) => r.symbol)).toEqual(['BTCUSDT']);
    expect(s.written[0].market).toBe('spot');
    expect(sockets.stopped).toBe(0); // one bad message must not take the socket down
  });

  it('perp: reports the failure, naming the stream, and keeps the feed alive', async () => {
    const s = shared();
    let handlers: Handlers | undefined;
    const sockets = { stopped: 0 };

    const ports: PerpCollectorPorts = {
      symbols: ['BTCUSDT'],
      signalSet: [],
      writers: {
        ...s.writers,
        markFunding: { write: async () => 0 },
        fundingSettlements: { write: async () => 0 },
        liquidations: { write: async () => 0 },
      },
      registry: s.registry,
      rest: { klines: async () => [], premiumIndex: async () => [], fundingRate: async () => [] } as unknown as PerpRest,
      candles: s.candles,
      socketFactory: (h) => {
        handlers = h as Handlers;
        return { open: () => handlers?.onOpen(), stop: () => void sockets.stopped++ };
      },
      logger: s.logger,
      now: () => T0,
    };
    const collector = new BinancePerpCollector(ports);
    await collector.start();

    handlers?.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 - 2 * MINUTE));
    await flush();

    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain('btcusdt@kline_1m');

    handlers?.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 - MINUTE));
    await flush();

    expect(s.written.map((r) => r.market)).toEqual(['perp']);
    expect(sockets.stopped).toBe(0);
  });
});
