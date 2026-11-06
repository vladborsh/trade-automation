import {
  BybitCollector, STREAM_LIQUIDATION, bybitTopics, type BybitCollectorPorts, type BybitSocketLike,
} from '../../../src/collectors/bybit/bybit-collector';
import type { LiquidationRow } from '../../../src/collectors/writers/tables';
import { LIQUIDATIONS, TICKER_DELTA, TICKER_SNAPSHOT } from './fixtures';

/**
 * IB-008, slimmed by WD-010 — the liquidation-only collector through its ports: no socket, no
 * network. Liquidations are stored; the one liveness ticker is not.
 */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);

function harness(over: Partial<BybitCollectorPorts> = {}) {
  const written = { liquidations: [] as LiquidationRow[] };
  const registry = {
    registered: [] as string[], messages: [] as string[], reconnects: 0,
    register(id: string) { this.registered.push(id); },
    recordMessage(id: string) { this.messages.push(id); },
    recordReconnect() { this.reconnects++; },
  };
  const sockets: Array<{ opened: number; stopped: number; silenceChecks: number; fires: boolean; topics: readonly string[] }> = [];
  const warnings: string[] = [];
  let handlers!: Parameters<BybitCollectorPorts['socketFactory']>[0];

  const ports: BybitCollectorPorts = {
    symbols: ['BTCUSDT', 'XRPUSDT'],
    writers: { liquidations: { write: async (rows) => (written.liquidations.push(...rows), rows.length) } },
    registry,
    socketFactory: (hs, topics): BybitSocketLike => {
      handlers = hs;
      const state = { opened: 0, stopped: 0, silenceChecks: 0, fires: false, topics };
      sockets.push(state);
      return {
        setTopics: (next) => {
          const added = next.filter((t) => !state.topics.includes(t));
          const removed = state.topics.filter((t) => !next.includes(t));
          state.topics = [...next];
          return { added, removed };
        },
        open: () => void state.opened++,
        stop: () => void state.stopped++,
        checkSilence: () => (state.silenceChecks++, state.fires),
      };
    },
    logger: { log: () => undefined, warn: (m: string) => void warnings.push(m) },
    now: () => T0,
    ...over,
  };
  return { collector: new BybitCollector(ports), written, registry, sockets, warnings, handlers: () => handlers };
}

describe('bybitTopics (WD-010)', () => {
  it('one liveness ticker for the first symbol, then every symbol\'s allLiquidation — no other tickers', () => {
    expect(bybitTopics(['BTCUSDT', 'XRPUSDT'])).toEqual(['tickers.BTCUSDT', 'allLiquidation.BTCUSDT', 'allLiquidation.XRPUSDT']);
  });

  it('refuses an empty universe', () => {
    expect(() => bybitTopics([])).toThrow(RangeError);
  });
});

describe('BybitCollector — liquidations (§4.3)', () => {
  it('IB-BUG-018: a universe symbol that is not <BASE>USDT is a configuration error at construction', () => {
    expect(() => harness({ symbols: ['BTCUSDT', 'BTCUSD'] })).toThrow(/non-USDT-linear symbols BTCUSD/);
  });

  it('registers the one liquidation stream and opens one socket with those topics', () => {
    const h = harness();
    h.collector.start();
    expect(h.registry.registered).toEqual([STREAM_LIQUIDATION]);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].topics).toEqual(bybitTopics(['BTCUSDT', 'XRPUSDT']));
  });

  it('a liquidation push becomes one row per event, side normalised', async () => {
    const h = harness();
    h.collector.start();
    await h.collector.onMessage(LIQUIDATIONS[0]);
    expect(h.written.liquidations).toHaveLength(1);
    expect(h.written.liquidations[0]).toMatchObject({ venue: 'bybit', symbol: 'ETHUSDT', side: 'short', price: 2679.27 });
    expect(h.registry.messages).toEqual([STREAM_LIQUIDATION]);
  });

  it('the liveness ticker (snapshot and delta) is neither stored nor counted as a liquidation message', async () => {
    const h = harness();
    h.collector.start();
    await h.collector.onMessage(TICKER_SNAPSHOT);
    await h.collector.onMessage(TICKER_DELTA);
    expect(h.written.liquidations).toEqual([]);
    expect(h.registry.messages).toEqual([]);
  });

  it('the tick asks the socket about silence; after stop it does not', () => {
    const h = harness();
    h.collector.start();
    h.collector.tick();
    expect(h.sockets[0].silenceChecks).toBe(1);
    h.collector.stop();
    h.collector.tick();
    expect(h.sockets[0]).toMatchObject({ silenceChecks: 1, stopped: 1 });
  });

  it('IB-BUG-051: a silence reconnect is recorded as a reconnect; a quiet tick is not', () => {
    const h = harness();
    h.collector.start();
    h.collector.tick();
    expect(h.registry.reconnects).toBe(0);
    h.sockets[0].fires = true;
    h.collector.tick();
    expect(h.registry.reconnects).toBe(1);
  });

  it('a failing write through the socket handler is logged, not thrown; a refused topic is shouted', async () => {
    const h = harness({ writers: { liquidations: { write: async () => { throw new Error('db down'); } } } });
    h.collector.start();
    expect(() => h.handlers().onMessage(LIQUIDATIONS[0])).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(h.warnings.some((w) => w.includes('db down'))).toBe(true);
    h.handlers().onSubscribeFailed('handler not found');
    expect(h.warnings.some((w) => w.includes('REFUSED'))).toBe(true);
  });
});

describe('IB-BUG-018: only USDT-linear symbols can be subscribed', () => {
  it('a non-USDT universe symbol (an inverse BTCUSD) is refused at construction', () => {
    expect(() => harness({ symbols: ['BTCUSDT', 'BTCUSD'] })).toThrow(/non-USDT-linear symbols BTCUSD/);
  });
});

describe('IB-122 (L5): the tracked set changes without a deploy', () => {
  it('a coin added to the alert list is subscribed on the same socket; the liveness topic stays', () => {
    const h = harness();
    h.collector.start();
    const change = h.collector.setSymbols(['BTCUSDT', 'XRPUSDT', 'TRXUSDT']);
    expect(change).toEqual({ added: ['allLiquidation.TRXUSDT'], removed: [] });
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].topics).toEqual(['tickers.BTCUSDT', 'allLiquidation.BTCUSDT', 'allLiquidation.XRPUSDT', 'allLiquidation.TRXUSDT']);
  });

  it('a non-USDT symbol in the new set is refused and logged, never subscribed', () => {
    const h = harness();
    h.collector.start();
    h.collector.setSymbols(['BTCUSDT', 'XRPUSDT', 'BTCUSD_PERP']);
    expect(h.sockets[0].topics).not.toContain('allLiquidation.BTCUSD_PERP');
    expect(h.warnings.some((w) => w.includes('BTCUSD_PERP'))).toBe(true);
  });
});
