import type { Candle, Instrument, Timeframe } from '@trade-automation/contracts';
import {
  BinanceSpotCollector, MARKET, STREAM_KLINE_SPOT,
  type SpotCollectorPorts, type SpotCollectorSocket,
} from '../../../src/collectors/binance-spot/spot-collector';
import type { SpotRest } from '../../../src/collectors/binance-spot/rest';
import type { Candle1mRow, CollectorGapRow } from '../../../src/collectors/writers/tables';

/**
 * IB-006 — the spot collector driven end to end through its ports: no socket, no network, a clock
 * the spec advances. Spot is klines only, so this covers the WS path, gap repair, the §16.1
 * degraded transition and the boot seed; there are no marks, funding or liquidations to cover.
 */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const MINUTE = 60_000;

/** The spot frame, shape-identical to USD-M's (see `binance-spot/payloads.ts`). */
function kline(symbol: string, openTime: number, closed = true, over: Record<string, unknown> = {}) {
  return {
    e: 'kline', E: openTime + 59_999, s: symbol,
    k: { t: openTime, T: openTime + 59_999, s: symbol, i: '1m', o: '100', h: '110', l: '90', c: '105', v: '10', x: closed, q: '1050', n: 7, V: '4', Q: '420', ...over },
  };
}

function harness(over: Partial<SpotCollectorPorts> = {}) {
  const written = { candles: [] as Candle1mRow[], gaps: [] as CollectorGapRow[] };
  const collect = <T>(sink: T[]) => ({ write: async (rows: readonly T[]) => (sink.push(...rows), rows.length) });
  const registry = {
    registered: [] as Array<{ id: string; venue: string; expectedIntervalSec: number | null | undefined }>,
    messages: [] as string[], reconnects: 0,
    modes: new Map<string, { mode: string; reason: string | null }>(),
    register(id: string, venue: string, expectedIntervalSec?: number | null) { this.registered.push({ id, venue, expectedIntervalSec }); },
    recordMessage(id: string) { this.messages.push(id); },
    recordReconnect() { this.reconnects++; },
    setMode(id: string, mode: string, reason?: string | null) { this.modes.set(id, { mode, reason: reason ?? null }); },
  };
  const sockets: Array<{ opened: number; stopped: number; streams: readonly string[] }> = [];
  const restCalls = { klines: [] as string[] };
  let now = T0;

  const rest = {
    klines: async (symbol: string) => {
      restCalls.klines.push(symbol);
      const openTime = Math.floor(now / MINUTE) * MINUTE - MINUTE;
      return [[openTime, '100', '110', '90', '105', '10', openTime + 59_999, '1050', 7, '4', '420', '0']];
    },
  } as unknown as SpotRest;

  const fetched: Array<{ from: number; to: number }> = [];
  const candles = {
    fetchCandles: async (instrument: Instrument, _tf: Timeframe, from: number, to: number): Promise<Candle[]> => {
      fetched.push({ from, to });
      const out: Candle[] = [];
      for (let t = from; t <= to; t += MINUTE) {
        out.push({ instrument: instrument.id, timeframe: '1m', openTime: t, open: 1, high: 1, low: 1, close: 1, volume: 1, closed: true, source: 'venue-rest' });
      }
      return out;
    },
  };

  const ports: SpotCollectorPorts = {
    symbols: SYMBOLS,
    signalSet: ['BTCUSDT'],
    writers: { candles1m: collect(written.candles), collectorGaps: collect(written.gaps) },
    registry,
    rest,
    candles,
    socketFactory: (handlers, streams): SpotCollectorSocket => {
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
    logger: { log: () => undefined, warn: () => undefined },
    now: () => now,
    ...over,
  };

  const collector = new BinanceSpotCollector(ports);
  return {
    collector, written, registry, sockets, restCalls, fetched,
    at(ms: number) { now = ms; },
    advance(ms: number) { now += ms; },
    get now() { return now; },
  };
}

describe('BinanceSpotCollector — the websocket path (§4.2)', () => {
  it('registers one kline stream, with no expected interval (it is a socket, not a poller)', async () => {
    const h = harness();
    await h.collector.start();

    expect(h.registry.registered).toEqual([{ id: STREAM_KLINE_SPOT, venue: 'binance', expectedIntervalSec: undefined }]);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].opened).toBe(1);
    // IB-011's watchdog judges a declared period against its own cadence; a socket declares none
    expect(h.registry.registered[0].expectedIntervalSec ?? null).toBeNull();
  });

  it('subscribes to a kline stream per symbol and nothing else', async () => {
    const h = harness();
    await h.collector.start();
    expect(h.sockets[0].streams).toEqual(['btcusdt@kline_1m', 'ethusdt@kline_1m']);
  });

  it('writes a closed kline as a spot row, and ignores the forming one', async () => {
    const h = harness();
    await h.collector.start();

    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0, false));
    expect(h.written.candles).toEqual([]);
    expect(h.registry.messages).toContain(STREAM_KLINE_SPOT); // the forming bar still proves liveness

    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0));
    expect(h.written.candles).toHaveLength(1);
    expect(h.written.candles[0]).toMatchObject({ venue: 'binance', market: MARKET, symbol: 'BTCUSDT', openTime: new Date(T0), source: 'ws' });
  });

  it('a hole between two closed bars is repaired in order and logged to collector_gaps as spot', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0));
    h.advance(3 * MINUTE);
    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 + 3 * MINUTE));

    expect(h.fetched).toEqual([{ from: T0 + MINUTE, to: T0 + 2 * MINUTE }]);
    expect(h.written.candles.map((r) => r.openTime.getTime())).toEqual([T0, T0 + MINUTE, T0 + 2 * MINUTE, T0 + 3 * MINUTE]);
    expect(h.written.candles.map((r) => r.source)).toEqual(['ws', 'rest', 'rest', 'ws']);
    expect(h.written.gaps).toHaveLength(1);
    expect(h.written.gaps[0]).toMatchObject({ stream: STREAM_KLINE_SPOT, market: MARKET, symbol: 'BTCUSDT', expected: 2, repaired: 2 });
  });
});

describe('BinanceSpotCollector — degraded mode (§16.1)', () => {
  it('a socket that opens and stays mute falls back to REST, and /health says so', async () => {
    const h = harness();
    await h.collector.start();
    h.advance(31_000);
    await h.collector.tick();

    expect(h.collector.mode).toBe('degraded');
    expect(h.registry.modes.get(STREAM_KLINE_SPOT)?.mode).toBe('degraded');
    expect(h.sockets[0].stopped).toBe(1);
  });

  it('degraded: klines are polled per symbol at the ruling cadence, written with source rest, and count as liveness', async () => {
    const h = harness();
    await h.collector.start();
    h.advance(31_000);
    await h.collector.tick(); // degrades, and polls both symbols once

    expect(h.restCalls.klines).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(h.written.candles.map((r) => r.source)).toEqual(['rest', 'rest']);
    // the venue answered, so the stream is alive on REST — the watchdog must not call it silent
    expect(h.registry.messages.filter((id) => id === STREAM_KLINE_SPOT)).toHaveLength(2);

    h.advance(3_000); // the signal set's cadence, not the rest's
    await h.collector.tick();
    expect(h.restCalls.klines).toEqual(['BTCUSDT', 'ETHUSDT', 'BTCUSDT']);

    h.advance(12_000); // 15 s since ETH's poll
    await h.collector.tick();
    expect(h.restCalls.klines.filter((s) => s === 'ETHUSDT')).toHaveLength(2);
  });

  it('a message after the fallback puts it back on the websocket', async () => {
    const h = harness();
    await h.collector.start();
    h.advance(31_000);
    await h.collector.tick();
    expect(h.collector.mode).toBe('degraded');

    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 + MINUTE));
    expect(h.collector.mode).toBe('ws');
    expect(h.registry.modes.get(STREAM_KLINE_SPOT)).toEqual({ mode: 'ws', reason: null });
  });
});

describe('BinanceSpotCollector — boot (§4.1 seed, restart repair)', () => {
  it('seeds from the last stored spot bar and REST-fills to now before the socket opens', async () => {
    const stored = new Map([['BTCUSDT', T0 - 5 * MINUTE]]);
    const h = harness({ lastOpenTimes: async () => stored });
    await h.collector.start();

    expect(h.fetched).toEqual([{ from: T0 - 4 * MINUTE, to: T0 - MINUTE }]);
    expect(h.written.candles.map((r) => r.source)).toEqual(['rest', 'rest', 'rest', 'rest']);
    expect(h.written.gaps[0]).toMatchObject({ stream: STREAM_KLINE_SPOT, market: MARKET, symbol: 'BTCUSDT', expected: 4, repaired: 4 });
    // and the socket opened only after the backfill
    expect(h.sockets).toHaveLength(1);
  });

  it('the bar after the seed is continuous with it: no phantom gap on the first live message', async () => {
    const h = harness({ lastOpenTimes: async () => new Map([['BTCUSDT', T0 - 2 * MINUTE]]) });
    await h.collector.start();
    h.written.gaps.length = 0;

    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0));
    expect(h.written.gaps).toEqual([]);
  });

  it('a symbol outside the universe in storage is ignored, and a read failure does not stop the boot', async () => {
    const h = harness({ lastOpenTimes: async () => new Map([['DOGEUSDT', T0 - 3 * MINUTE]]) });
    await h.collector.start();
    expect(h.fetched).toEqual([]);
    expect(h.sockets).toHaveLength(1);

    const failing = harness({ lastOpenTimes: async () => { throw new Error('db down'); } });
    await failing.collector.start();
    expect(failing.sockets).toHaveLength(1);
  });
});
