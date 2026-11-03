import {
  BinancePerpCollector, LIQUIDATION_ONLY_RETRY_MS, STREAM_LIQUIDATION,
  type CollectorSocket, type PerpCollectorPorts,
} from '../../../src/collectors/binance-perp/perp-collector';
import { perpStreamNames } from '../../../src/collectors/binance-perp/streams';
import type { CollectorGapRow, LiquidationRow } from '../../../src/collectors/writers/tables';

/**
 * IB-005, slimmed by WD-010 — the liquidation-only collector driven through its ports: no socket,
 * no network, a clock the spec advances. What is left to prove: `!forceOrder` is stored, the one
 * liveness mark price is not, the liveness stream is what keeps a quiet market from looking like a
 * dead socket, and a socket that is down leaves an honest gap row.
 */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

const markEvent = (symbol: string, at: number) => ({
  e: 'markPriceUpdate', E: at, s: symbol, p: '100', i: '99.9', r: '0.0001', T: Date.UTC(2026, 8, 28, 16),
});

// The limit sits on the far side of the fill, as the engine's IOC order requires (IB-BUG-012).
const forceOrder = (symbol: string, at: number, side: 'BUY' | 'SELL' = 'SELL') => ({
  e: 'forceOrder', E: at,
  o: { s: symbol, S: side, o: 'LIMIT', f: 'IOC', q: '2', p: side === 'SELL' ? '99' : '100', ap: '99.5', X: 'FILLED', l: '2', z: '2', T: at },
});

function harness(over: Partial<PerpCollectorPorts> = {}) {
  const written = { liquidations: [] as LiquidationRow[], gaps: [] as CollectorGapRow[] };
  const collect = <T>(sink: T[]) => ({ write: async (rows: readonly T[]) => (sink.push(...rows), rows.length) });
  const registry = {
    registered: [] as string[], messages: [] as string[], reconnects: 0,
    modes: new Map<string, { mode: string; reason: string | null }>(),
    register(id: string) { this.registered.push(id); },
    recordMessage(id: string) { this.messages.push(id); },
    recordReconnect() { this.reconnects++; },
    setMode(id: string, mode: string, reason?: string | null) { this.modes.set(id, { mode, reason: reason ?? null }); },
  };
  const sockets: Array<{ opened: number; stopped: number; streams: readonly string[] }> = [];
  const warnings: string[] = [];
  let now = T0;

  const ports: PerpCollectorPorts = {
    symbols: SYMBOLS,
    writers: { liquidations: collect(written.liquidations), collectorGaps: collect(written.gaps) },
    registry,
    // a real socket completes its handshake and reports it; the fake does the same so the mode
    // policy sees what production sees
    socketFactory: (handlers, streams): CollectorSocket => {
      const state = { opened: 0, stopped: 0, streams };
      sockets.push(state);
      return {
        open: () => {
          state.opened++;
          handlers.onOpen();
        },
        stop: () => void state.stopped++,
      };
    },
    logger: { log: () => undefined, warn: (m: string) => void warnings.push(m) },
    now: () => now,
    ...over,
  };

  const collector = new BinancePerpCollector(ports);
  return {
    collector, written, registry, sockets, warnings,
    at(ms: number) { now = ms; },
    advance(ms: number) { now += ms; },
    get now() { return now; },
  };
}

describe('perpStreamNames (WD-010)', () => {
  it('is one liveness mark price for the first symbol plus the liquidation array — no klines, no all-market mark', () => {
    expect(perpStreamNames(SYMBOLS)).toEqual(['btcusdt@markPrice@1s', '!forceOrder@arr']);
  });

  it('refuses an empty universe: nothing would carry the liveness stream', () => {
    expect(() => perpStreamNames([])).toThrow(RangeError);
  });
});

describe('BinancePerpCollector — liquidations (§4.1)', () => {
  it('registers the one liquidation stream and opens one socket on start', async () => {
    const h = harness();
    await h.collector.start();
    expect(h.registry.registered).toEqual([STREAM_LIQUIDATION]);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].streams).toEqual(['btcusdt@markPrice@1s', '!forceOrder@arr']);
  });

  it('forceOrder becomes one liquidation row, side normalised to the side liquidated, and counts as the stream\'s message', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.onMessage('!forceOrder@arr', forceOrder('ETHUSDT', T0 + 1_000, 'SELL'));
    await h.collector.onMessage('!forceOrder@arr', forceOrder('BTCUSDT', T0 + 2_000, 'BUY'));
    expect(h.written.liquidations.map((r) => [r.symbol, r.side, r.notional])).toEqual([
      ['ETHUSDT', 'long', 199], ['BTCUSDT', 'short', 199],
    ]);
    expect(h.registry.messages).toEqual([STREAM_LIQUIDATION, STREAM_LIQUIDATION]);
  });

  it('the liveness mark price is neither stored nor counted as a liquidation message (/health keeps the real age)', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.onMessage('btcusdt@markPrice@1s', markEvent('BTCUSDT', T0 + 1_000));
    expect(h.written.liquidations).toEqual([]);
    expect(h.written.gaps).toEqual([]);
    expect(h.registry.messages).toEqual([]);
  });

  it('IB-BUG-018: a COIN-M / delivery / BTC-quoted forceOrder is NOT stored — counted on the metric, logged once per symbol', async () => {
    const skipped: Array<Record<string, string>> = [];
    const logs: string[] = [];
    const metrics = {
      gapsUnrepaired: { inc: () => undefined }, wsReconnects: { inc: () => undefined },
      liquidationsSkipped: { inc: (labels: Record<string, string>) => void skipped.push(labels) },
    };
    const h = harness({ metrics, logger: { log: (m: string) => void logs.push(m), warn: () => undefined } });
    await h.collector.start();
    for (const symbol of ['BTCUSD_PERP', 'BTCUSD_PERP', 'BTCUSD_261225', 'ETHBTC', 'BTCUSDT_261225', 'ETHUSDC']) {
      await h.collector.onMessage('!forceOrder@arr', forceOrder(symbol, T0 + 1_000));
    }
    await h.collector.onMessage('!forceOrder@arr', forceOrder('ETHUSDT', T0 + 2_000));

    expect(h.written.liquidations.map((r) => r.symbol)).toEqual(['ETHUSDT']);
    expect(h.collector.skippedLiquidations).toBe(6);
    expect(skipped).toEqual(Array(6).fill({ venue: 'binance', reason: 'not-usdt-linear' }));
    expect(logs.filter((m) => m.includes('skipping liquidations of BTCUSD_PERP'))).toHaveLength(1); // once, not per event
  });

  it('IB-BUG-018: a universe symbol the rule would refuse is a configuration error at construction', () => {
    expect(() => harness({ symbols: ['BTCUSDT', 'BTCUSD_PERP'] })).toThrow(/non-USDT-linear symbols BTCUSD_PERP/);
  });

  it('a malformed forceOrder through the socket handler is logged by stream, not thrown', async () => {
    let handlers!: Parameters<PerpCollectorPorts['socketFactory']>[0];
    const h = harness({
      socketFactory: (hs) => {
        handlers = hs;
        return { open: () => hs.onOpen(), stop: () => undefined };
      },
    });
    await h.collector.start();
    const bad = forceOrder('ETHUSDT', T0 + 1_000);
    (bad.o as Record<string, unknown>).S = 'HOLD';
    expect(() => handlers.onMessage('!forceOrder@arr', bad)).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(h.warnings.some((w) => w.includes('!forceOrder@arr'))).toBe(true);
    expect(h.written.liquidations).toEqual([]);
  });
});

describe('BinancePerpCollector — why the liveness stream exists', () => {
  it('a quiet market with the mark price flowing stays on the socket well past the 90 s silence rule', async () => {
    const h = harness();
    await h.collector.start();
    for (let s = 1; s <= 300; s++) {
      h.at(T0 + s * 1_000);
      await h.collector.onMessage('btcusdt@markPrice@1s', markEvent('BTCUSDT', h.now));
      if (s % 5 === 0) await h.collector.tick();
    }
    expect(h.collector.mode).toBe('ws');
    expect(h.sockets).toHaveLength(1);
    expect(h.written.gaps).toEqual([]);
  });

  it('the control: the same five minutes WITHOUT any message is a dead socket — degraded, and /health says so', async () => {
    const h = harness();
    await h.collector.start();
    h.at(T0 + 31_000);
    await h.collector.tick();
    expect(h.collector.mode).toBe('degraded');
    expect(h.registry.modes.get(STREAM_LIQUIDATION)).toEqual({ mode: 'degraded', reason: 'silent-after-open' });
  });
});

describe('BinancePerpCollector — socket down (§16.1)', () => {
  async function degraded() {
    const h = harness();
    await h.collector.start();
    h.at(T0 + 31_000);
    await h.collector.tick();
    expect(h.collector.mode).toBe('degraded');
    return h;
  }

  it('retries the socket every 30 s, not the old 5 min: there is no REST fallback carrying the data', async () => {
    expect(LIQUIDATION_ONLY_RETRY_MS).toBe(30_000);
    const h = await degraded();
    const before = h.sockets.length;
    h.advance(LIQUIDATION_ONLY_RETRY_MS);
    await h.collector.tick();
    expect(h.sockets.length).toBe(before + 1);
  });

  it('the liquidations lost while down become one unrepaired gap when the socket comes back', async () => {
    const h = await degraded();
    h.at(T0 + 10 * 60_000);
    await h.collector.onMessage('btcusdt@markPrice@1s', markEvent('BTCUSDT', h.now));
    expect(h.collector.mode).toBe('ws');
    expect(h.written.gaps).toHaveLength(1);
    expect(h.written.gaps[0]).toMatchObject({ stream: STREAM_LIQUIDATION, repaired: 0 });
    expect(h.written.gaps[0].gapFrom.getTime()).toBe(T0 + 31_000);
    expect(h.written.gaps[0].gapTo.getTime()).toBe(T0 + 10 * 60_000);
    expect(h.written.gaps[0].error).toMatch(/no REST equivalent/);
    expect(h.registry.modes.get(STREAM_LIQUIDATION)).toEqual({ mode: 'ws', reason: null });
  });

  it('a down spell crossing UTC midnight is cut at the boundary — one gap row per day', async () => {
    const h = harness();
    const late = Date.UTC(2026, 8, 28, 23, 59, 0);
    h.at(late);
    await h.collector.start();
    h.at(late + 31_000);
    await h.collector.tick();
    h.at(Date.UTC(2026, 8, 29, 0, 5, 0));
    await h.collector.tick();
    await h.collector.onMessage('!forceOrder@arr', forceOrder('ETHUSDT', h.now));
    const midnight = Date.UTC(2026, 8, 29);
    expect(h.written.gaps.map((g) => [g.gapFrom.getTime(), g.gapTo.getTime()])).toEqual([
      [late + 31_000, midnight],
      [midnight, Date.UTC(2026, 8, 29, 0, 5, 0)],
    ]);
  });

  it('stopping while down still writes the gap', async () => {
    const h = await degraded();
    h.at(T0 + 5 * 60_000);
    await h.collector.stop();
    expect(h.written.gaps).toHaveLength(1);
    expect(h.written.gaps[0].gapTo.getTime()).toBe(T0 + 5 * 60_000);
  });
});
