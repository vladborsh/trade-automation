import { BinancePerpCollector, type PerpCollectorPorts } from '../../src/collectors/binance-perp/perp-collector';
import type { LiquidationRow } from '../../src/collectors/writers/tables';

/**
 * A socket handler cannot be awaited: `onMessage` is async and `BinanceSocket` calls it from an
 * event listener, so a rejection has nowhere to return to. The collectors used to write
 * `void this.onMessage(...)`, which **dropped the rejection silently** — one failing write and that
 * message was gone with the stream still looking healthy.
 *
 * The contract asserted here (WD-010: the perp collector's only stored stream is liquidations):
 *   1. a throwing handler is reported through the logger, naming the stream;
 *   2. it does not kill the feed — the socket is not stopped and the next message is ingested.
 */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);

type Handlers = Parameters<PerpCollectorPorts['socketFactory']>[0];

const forceOrder = (symbol: string, at: number) => ({
  e: 'forceOrder', E: at,
  o: { s: symbol, S: 'SELL', o: 'LIMIT', f: 'IOC', q: '2', p: '99', ap: '99.5', X: 'FILLED', l: '2', z: '2', T: at },
});

/** Lets the handler's promise chain settle; the socket itself never awaits it. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

describe('socket handler errors (perp collector)', () => {
  it('a failed liquidation write is logged with its stream, the socket stays up, and the next message is written', async () => {
    const warnings: string[] = [];
    const written: LiquidationRow[] = [];
    let failNext = true;
    let handlers!: Handlers;
    const socket = { opened: 0, stopped: 0 };

    const collector = new BinancePerpCollector({
      symbols: ['BTCUSDT'],
      writers: {
        liquidations: {
          write: async (rows) => {
            if (failNext) {
              failNext = false;
              throw new Error('no partition of relation liquidations found for row');
            }
            written.push(...rows);
            return rows.length;
          },
        },
        collectorGaps: { write: async (rows) => rows.length },
      },
      registry: { register: () => undefined, recordMessage: () => undefined, recordReconnect: () => undefined },
      socketFactory: (hs) => {
        handlers = hs;
        return { open: () => (socket.opened++, hs.onOpen()), stop: () => void socket.stopped++ };
      },
      logger: { log: () => undefined, warn: (m) => void warnings.push(m) },
      now: () => T0,
    });
    await collector.start();

    handlers.onMessage('!forceOrder@arr', forceOrder('ETHUSDT', T0 + 1_000));
    await flush();
    expect(warnings).toEqual([expect.stringMatching(/!forceOrder@arr.*no partition of relation liquidations/)]);
    expect(written).toEqual([]);

    handlers.onMessage('!forceOrder@arr', forceOrder('ETHUSDT', T0 + 2_000));
    await flush();
    expect(written).toHaveLength(1);
    expect(socket).toEqual({ opened: 1, stopped: 0 });
  });
});
