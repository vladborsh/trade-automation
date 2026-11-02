import type { Candle, Instrument, Timeframe } from '@trade-automation/contracts';
import {
  BinancePerpCollector, MARKET, STREAM_KLINE, STREAM_LIQUIDATION, STREAM_MARK,
  type CollectorSocket, type PerpCollectorPorts,
} from '../../../src/collectors/binance-perp/perp-collector';
import type { PerpRest } from '../../../src/venues/binance/perp.rest';
import type { Candle1mRow, CollectorGapRow, FundingSettlementRow, LiquidationRow, MarkFundingRow } from '../../../src/collectors/writers/tables';

/**
 * IB-005 — the collector driven end to end through its ports: no socket, no network, a clock the
 * spec advances. Covers the WS path, the §16.1 degraded transitions, gap repair, the funding
 * rollover and the boot seed.
 */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

function kline(symbol: string, openTime: number, closed = true, over: Record<string, unknown> = {}) {
  return {
    e: 'kline', E: openTime + 59_999, s: symbol,
    k: { t: openTime, T: openTime + 59_999, s: symbol, i: '1m', o: '100', h: '110', l: '90', c: '105', v: '10', x: closed, q: '1050', n: 7, V: '4', Q: '420', ...over },
  };
}

const markEvent = (symbol: string, at: number, over: Record<string, unknown> = {}) => ({
  e: 'markPriceUpdate', E: at, s: symbol, p: '100', i: '99.9', r: '0.0001', T: Date.UTC(2026, 8, 28, 16), ...over,
});

// The limit sits on the far side of the fill, as the engine's IOC order requires (IB-BUG-012).
const forceOrder = (symbol: string, at: number, side: 'BUY' | 'SELL' = 'SELL') => ({
  e: 'forceOrder', E: at,
  o: { s: symbol, S: side, o: 'LIMIT', f: 'IOC', q: '2', p: side === 'SELL' ? '99' : '100', ap: '99.5', X: 'FILLED', l: '2', z: '2', T: at },
});

function harness(over: Partial<PerpCollectorPorts> = {}) {
  const written = {
    candles: [] as Candle1mRow[], mark: [] as MarkFundingRow[], funding: [] as FundingSettlementRow[],
    liquidations: [] as LiquidationRow[], gaps: [] as CollectorGapRow[],
  };
  const collect = <T>(sink: T[]) => ({ write: async (rows: readonly T[]) => (sink.push(...rows), rows.length) });
  const registry = {
    registered: [] as string[], messages: [] as string[], reconnects: 0,
    modes: new Map<string, { mode: string; reason: string | null }>(),
    register(id: string) { this.registered.push(id); },
    recordMessage(id: string) { this.messages.push(id); },
    recordReconnect() { this.reconnects++; },
    setMode(id: string, mode: string, reason?: string | null) { this.modes.set(id, { mode, reason: reason ?? null }); },
  };
  const sockets: Array<{ opened: number; stopped: number }> = [];
  const restCalls = { klines: [] as string[], premiumIndex: 0, fundingRate: [] as string[] };
  let now = T0;

  const rest = {
    klines: async (symbol: string) => {
      restCalls.klines.push(symbol);
      const openTime = Math.floor(now / 60_000) * 60_000 - 60_000;
      return [[openTime, '100', '110', '90', '105', '10', openTime + 59_999, '1050', 7, '4', '420', '0']];
    },
    premiumIndex: async () => {
      restCalls.premiumIndex++;
      return SYMBOLS.map((symbol) => ({
        symbol, markPrice: '101', indexPrice: '100.9', lastFundingRate: '0.0002',
        nextFundingTime: Date.UTC(2026, 8, 28, 16), time: now,
      }));
    },
    fundingRate: async (symbol: string) => {
      restCalls.fundingRate.push(symbol);
      return [{ symbol, fundingTime: Date.UTC(2026, 8, 28, 16), fundingRate: '0.00031', markPrice: '100' }];
    },
  } as unknown as PerpRest;

  const fetched: Array<{ from: number; to: number }> = [];
  const candles = {
    fetchCandles: async (instrument: Instrument, _tf: Timeframe, from: number, to: number): Promise<Candle[]> => {
      fetched.push({ from, to });
      const out: Candle[] = [];
      for (let t = from; t <= to; t += 60_000) {
        out.push({ instrument: instrument.id, timeframe: '1m', openTime: t, open: 1, high: 1, low: 1, close: 1, volume: 1, closed: true, source: 'venue-rest' });
      }
      return out;
    },
  };

  const ports: PerpCollectorPorts = {
    symbols: SYMBOLS,
    signalSet: ['BTCUSDT'],
    writers: { candles1m: collect(written.candles), markFunding: collect(written.mark), fundingSettlements: collect(written.funding), liquidations: collect(written.liquidations), collectorGaps: collect(written.gaps) },
    registry,
    rest,
    candles,
    // a real socket completes its handshake and reports it; the fake does the same so the mode
    // policy sees what production sees
    socketFactory: (handlers): CollectorSocket => {
      const state = { opened: 0, stopped: 0 };
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

  const collector = new BinancePerpCollector(ports);
  return {
    collector, written, registry, sockets, restCalls, fetched,
    at(ms: number) { now = ms; },
    advance(ms: number) { now += ms; },
    get now() { return now; },
  };
}

describe('BinancePerpCollector — the websocket path (§4.1)', () => {
  it('registers its three streams and opens one socket on start', async () => {
    const h = harness();
    await h.collector.start();
    expect(h.registry.registered).toEqual([STREAM_KLINE, STREAM_MARK, STREAM_LIQUIDATION]);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].opened).toBe(1);
  });

  it('writes a closed kline with its taker fields, and ignores the forming one', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0, false));
    expect(h.written.candles).toEqual([]);

    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0));
    expect(h.written.candles).toEqual([{
      venue: 'binance', market: MARKET, symbol: 'BTCUSDT', openTime: new Date(T0),
      open: 100, high: 110, low: 90, close: 105, volume: 10,
      quoteVolume: 1050, trades: 7, takerBuyVolume: 4, takerBuyQuoteVolume: 420, source: 'ws',
    }]);
    expect(h.registry.messages).toContain(STREAM_KLINE);
  });

  it('a hole between two closed bars is repaired in order and logged to collector_gaps', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0));
    h.written.candles.length = 0;

    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 + 3 * 60_000)); // two bars missing

    expect(h.fetched).toEqual([{ from: T0 + 60_000, to: T0 + 2 * 60_000 }]);
    expect(h.written.candles.map((r) => [r.openTime.getTime(), r.source])).toEqual([
      [T0 + 60_000, 'rest'], [T0 + 2 * 60_000, 'rest'], [T0 + 3 * 60_000, 'ws'], // repaired first, in order
    ]);
    expect(h.written.gaps).toHaveLength(1);
    expect(h.written.gaps[0]).toMatchObject({ stream: STREAM_KLINE, symbol: 'BTCUSDT', expected: 2, repaired: 2, error: null });
  });

  it('forceOrder becomes one liquidation row, side normalised to the side liquidated', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.onMessage('!forceOrder@arr', forceOrder('ETHUSDT', T0 + 1_000, 'SELL'));
    await h.collector.onMessage('!forceOrder@arr', forceOrder('ETHUSDT', T0 + 2_000, 'BUY'));
    expect(h.written.liquidations.map((r) => [r.symbol, r.side, r.notional])).toEqual([
      ['ETHUSDT', 'long', 199], ['ETHUSDT', 'short', 199],
    ]);
    expect(h.registry.messages).toContain(STREAM_LIQUIDATION);
  });

  it('writes one mark row per symbol per minute — the last sample (D5)', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.tick(); // first tick just adopts the current minute
    await h.collector.onMessage('!markPrice@arr@1s', [markEvent('BTCUSDT', T0 + 1_000, { p: '100' }), markEvent('ETHUSDT', T0 + 1_000)]);
    await h.collector.onMessage('!markPrice@arr@1s', [markEvent('BTCUSDT', T0 + 50_000, { p: '103' })]);

    h.at(T0 + 61_000);
    await h.collector.tick();

    expect(h.written.mark.map((r) => [r.symbol, r.markPrice, r.ts.getTime()])).toEqual([
      ['BTCUSDT', 103, T0 + 60_000], ['ETHUSDT', 100, T0 + 60_000],
    ]);
  });

  it('a funding rollover keeps the last prediction at the settlement second and fetches the settled rate', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.tick();
    const settlement = Date.UTC(2026, 8, 28, 16);
    await h.collector.onMessage('!markPrice@arr@1s', [markEvent('BTCUSDT', T0 + 1_000, { r: '0.00031', T: settlement })]);
    await h.collector.onMessage('!markPrice@arr@1s', [markEvent('BTCUSDT', T0 + 2_000, { r: '0.00005', T: settlement + 8 * 3_600_000 })]);

    h.at(T0 + 61_000);
    await h.collector.tick();

    expect(h.written.mark).toContainEqual(expect.objectContaining({ symbol: 'BTCUSDT', ts: new Date(settlement), predictedFundingRate: 0.00031 }));
    expect(h.restCalls.fundingRate).toEqual(['BTCUSDT']);
    expect(h.written.funding).toEqual([{ venue: 'binance', symbol: 'BTCUSDT', fundingTime: new Date(settlement), rate: 0.00031, markPrice: 100, source: 'rest' }]);
  });
});

describe('BinancePerpCollector — degraded mode (§16.1)', () => {
  it('a socket that opens and stays mute falls back to REST after 30 s, and /health says so', async () => {
    const h = harness();
    await h.collector.start();
    h.advance(30_000); // the socket opened on start and then said nothing
    await h.collector.tick();

    expect(h.collector.mode).toBe('degraded');
    expect(h.sockets[0].stopped).toBe(1);
    for (const id of [STREAM_KLINE, STREAM_MARK, STREAM_LIQUIDATION]) {
      expect(h.registry.modes.get(id)).toEqual({ mode: 'degraded', reason: 'silent-after-open' });
    }
  });

  it('degraded: klines are polled per symbol at the ruling cadence and written with source rest', async () => {
    const h = harness();
    await h.collector.start();
    h.advance(30_000); // opened on start, then mute
    await h.collector.tick(); // degrade + first poll of both symbols
    expect(h.restCalls.klines.sort()).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(h.written.candles.every((r) => r.source === 'rest')).toBe(true);

    h.advance(3_000); // the signal set only
    await h.collector.tick();
    expect(h.restCalls.klines.filter((s) => s === 'BTCUSDT')).toHaveLength(2);
    expect(h.restCalls.klines.filter((s) => s === 'ETHUSDT')).toHaveLength(1);

    h.advance(12_000); // now the rest as well
    await h.collector.tick();
    expect(h.restCalls.klines.filter((s) => s === 'ETHUSDT')).toHaveLength(2);
    // a degraded collector that is answering is not a silent one: the watchdog must not alert
    expect(h.registry.messages.filter((id) => id === STREAM_KLINE).length).toBeGreaterThan(0);
  });

  it('degraded: mark rows come from one symbol-less premiumIndex per minute', async () => {
    const h = harness();
    await h.collector.start();
    h.advance(30_000); // opened on start, then mute
    await h.collector.tick();
    h.written.mark.length = 0;

    h.at(T0 + 120_000); // cross a minute boundary
    await h.collector.tick();

    expect(h.restCalls.premiumIndex).toBe(1);
    expect(h.written.mark.map((r) => [r.symbol, r.markPrice, r.source, r.ts.getTime()])).toEqual([
      ['BTCUSDT', 101, 'rest', T0 + 120_000], ['ETHUSDT', 101, 'rest', T0 + 120_000],
    ]);
  });

  it('the liquidations lost while degraded become an unrepaired gap when the spell ends', async () => {
    const h = harness();
    await h.collector.start();
    h.advance(30_000); // opened on start, then mute
    await h.collector.tick();
    const degradedAt = h.now;

    h.advance(300_000); // the 5-minute retry
    await h.collector.tick();
    expect(h.sockets).toHaveLength(2); // a fresh socket was opened to test the venue

    h.advance(1_000);
    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0 + 60_000)); // it speaks: recovery

    expect(h.collector.mode).toBe('ws');
    const gap = h.written.gaps.find((g) => g.stream === STREAM_LIQUIDATION);
    expect(gap).toMatchObject({ symbol: null, expected: 0, repaired: 0 });
    expect(gap?.error).toMatch(/no REST equivalent/);
    expect(gap?.gapFrom.getTime()).toBe(degradedAt);
    expect(h.registry.modes.get(STREAM_KLINE)).toEqual({ mode: 'ws', reason: null });
  });

  it('a degraded spell crossing UTC midnight is cut at the boundary — one gap row per day', async () => {
    const h = harness();
    h.at(Date.UTC(2026, 8, 28, 23, 59, 0));
    await h.collector.start();
    h.advance(30_000); // opened on start, then mute
    await h.collector.tick(); // degraded at 23:59:30

    h.at(Date.UTC(2026, 8, 29, 0, 0, 30)); // past midnight
    await h.collector.tick();

    const gaps = h.written.gaps.filter((g) => g.stream === STREAM_LIQUIDATION);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapTo.getTime()).toBe(Date.UTC(2026, 8, 29)); // cut exactly at midnight
    expect(h.collector.mode).toBe('degraded'); // still degraded, now counting the new day
  });

  it('stopping while degraded still writes the gap', async () => {
    const h = harness();
    await h.collector.start();
    h.advance(30_000); // opened on start, then mute
    await h.collector.tick();
    h.advance(10_000);
    await h.collector.stop();
    expect(h.written.gaps.filter((g) => g.stream === STREAM_LIQUIDATION)).toHaveLength(1);
  });
});

describe('BinancePerpCollector — boot (§4.1, D12)', () => {
  it('seeds from the last stored bar and REST-fills to now before the socket opens', async () => {
    const lastStored = T0 - 5 * 60_000;
    const h = harness({ lastOpenTimes: async () => new Map([['BTCUSDT', lastStored]]) });
    h.at(T0 + 30_000);
    await h.collector.start();

    expect(h.fetched).toEqual([{ from: lastStored + 60_000, to: T0 - 60_000 }]);
    expect(h.written.candles.map((r) => r.openTime.getTime())).toEqual([
      lastStored + 60_000, lastStored + 2 * 60_000, lastStored + 3 * 60_000, lastStored + 4 * 60_000,
    ]);
    // the restart's repair is recorded, repaired in full (§6.2 reads this; the Tester's restart check too)
    expect(h.written.gaps).toHaveLength(1);
    expect(h.written.gaps[0]).toMatchObject({ stream: STREAM_KLINE, symbol: 'BTCUSDT', expected: 4, repaired: 4, error: null });

    // and the seed holds: the next closed bar continues the series without a spurious gap
    await h.collector.onMessage('btcusdt@kline_1m', kline('BTCUSDT', T0));
    expect(h.written.gaps).toHaveLength(1);
  });

  it('a boot backfill that comes back short is recorded as a gap, and the collector still starts', async () => {
    const h = harness({
      lastOpenTimes: async () => new Map([['BTCUSDT', T0 - 5 * 60_000]]),
      candles: { fetchCandles: async () => [] },
    });
    h.at(T0 + 30_000);
    await h.collector.start();
    expect(h.written.gaps[0]).toMatchObject({ stream: STREAM_KLINE, symbol: 'BTCUSDT', expected: 4, repaired: 0, error: 'boot backfill incomplete' });
    expect(h.sockets[0].opened).toBe(1);
  });

  it('a symbol outside the universe in storage is ignored; a read failure does not stop the boot', async () => {
    const ignored = harness({ lastOpenTimes: async () => new Map([['DOGEUSDT', T0 - 60_000]]) });
    await ignored.collector.start();
    expect(ignored.fetched).toEqual([]);

    const failed = harness({ lastOpenTimes: async () => { throw new Error('db down'); } });
    await failed.collector.start();
    expect(failed.sockets[0].opened).toBe(1);
  });
});
