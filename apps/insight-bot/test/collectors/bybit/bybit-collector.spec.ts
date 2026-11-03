import {
  BybitCollector, STREAM_LIQUIDATION, STREAM_TICKERS, type BybitCollectorPorts, type BybitSocketLike,
} from '../../../src/collectors/bybit/bybit-collector';
import type { BybitRest } from '../../../src/venues/bybit/bybit.rest';
import type { FundingSettlementRow, LiquidationRow, MarkFundingRow } from '../../../src/collectors/writers/tables';
import { LIQUIDATIONS, TICKER_DELTA, TICKER_SNAPSHOT } from './fixtures';

/** IB-008 — the collector through its ports: no socket, no network, a clock the spec advances. */

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const NEXT_FUNDING = Date.UTC(2026, 8, 28, 16, 0, 0);

const ticker = (symbol: string, type: 'snapshot' | 'delta', data: Record<string, string>) => ({
  topic: `tickers.${symbol}`, type, ts: T0, data: { symbol, ...data },
});

function harness(over: Partial<BybitCollectorPorts> = {}) {
  const written = { mark: [] as MarkFundingRow[], funding: [] as FundingSettlementRow[], liquidations: [] as LiquidationRow[] };
  const collect = <T>(sink: T[]) => ({ write: async (rows: readonly T[]) => (sink.push(...rows), rows.length) });
  const registry = {
    registered: [] as string[], messages: [] as string[], reconnects: 0,
    register(id: string) { this.registered.push(id); },
    recordMessage(id: string) { this.messages.push(id); },
    recordReconnect() { this.reconnects++; },
  };
  const sockets: Array<{ opened: number; stopped: number; silenceChecks: number }> = [];
  const restCalls: Array<{ symbol: string; endTime?: number; limit?: number }> = [];
  let now = T0;
  let fundingPages: Record<string, Array<Array<{ symbol: string; fundingRate: string; fundingRateTimestamp: string }>>> = {};

  const rest = {
    fundingHistory: async (symbol: string, endTime?: number, limit?: number) => {
      restCalls.push({ symbol, endTime, limit });
      const pages = fundingPages[symbol];
      if (!pages) return [{ symbol, fundingRate: '0.0001', fundingRateTimestamp: String(NEXT_FUNDING) }];
      return pages.shift() ?? [];
    },
  } as unknown as BybitRest;

  const ports: BybitCollectorPorts = {
    symbols: ['BTCUSDT', 'XRPUSDT'],
    signalSet: ['BTCUSDT'],
    writers: { markFunding: collect(written.mark), fundingSettlements: collect(written.funding), liquidations: collect(written.liquidations) },
    registry,
    rest,
    socketFactory: (): BybitSocketLike => {
      const state = { opened: 0, stopped: 0, silenceChecks: 0 };
      sockets.push(state);
      return {
        open: () => void state.opened++,
        stop: () => void state.stopped++,
        checkSilence: () => (state.silenceChecks++, false),
      };
    },
    logger: { log: () => undefined, warn: () => undefined },
    now: () => now,
    ...over,
  };

  return {
    ports, written, registry, sockets, restCalls,
    collector: new BybitCollector(ports),
    setPages(p: typeof fundingPages) { fundingPages = p; },
    at(ms: number) { now = ms; },
    advance(ms: number) { now += ms; },
  };
}

describe('BybitCollector — streams (§4.3)', () => {
  it('registers both streams and opens one socket with a topic pair per symbol', async () => {
    const h = harness();
    let topics: readonly string[] = [];
    h.ports.socketFactory = ((_handlers: unknown, t: readonly string[]) => {
      topics = t;
      return { open: () => undefined, stop: () => undefined, checkSilence: () => false };
    }) as BybitCollectorPorts['socketFactory'];
    const collector = new BybitCollector(h.ports);
    await collector.start();

    expect(h.registry.registered).toEqual([STREAM_TICKERS, STREAM_LIQUIDATION]);
    expect(topics).toEqual(['tickers.BTCUSDT', 'allLiquidation.BTCUSDT', 'tickers.XRPUSDT', 'allLiquidation.XRPUSDT']);
  });

  it('a liquidation push becomes one row per event, side normalised', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.whenBackfilled();
    h.written.funding.length = 0;

    await h.collector.onMessage(LIQUIDATIONS[0]);

    expect(h.written.liquidations).toHaveLength(1);
    expect(h.written.liquidations[0]).toMatchObject({ venue: 'bybit', symbol: 'ETHUSDT', side: 'short', price: 2679.27 });
    expect(h.registry.messages).toContain(STREAM_LIQUIDATION);
  });

  it('tickers: one row per minute for the signal set, and none for the others', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.tick(); // adopt the current minute
    h.written.mark.length = 0;

    await h.collector.onMessage(ticker('BTCUSDT', 'snapshot', { markPrice: '80000', fundingRate: '0.0001', nextFundingTime: String(NEXT_FUNDING) }));
    await h.collector.onMessage(ticker('XRPUSDT', 'snapshot', { markPrice: '2.1', fundingRate: '0.0002', nextFundingTime: String(NEXT_FUNDING) }));
    await h.collector.onMessage(ticker('BTCUSDT', 'delta', { markPrice: '80100' }));

    h.at(T0 + 61_000);
    await h.collector.tick();

    expect(h.written.mark.map((r) => [r.symbol, r.markPrice])).toEqual([['BTCUSDT', 80100]]); // the LAST sample, signal set only
    expect(h.registry.messages).toContain(STREAM_TICKERS);
  });

  it('at a settlement EVERY symbol gets a mark row and its settled rate is fetched', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.whenBackfilled(); // the boot backfill runs in the background now: let it settle
    h.written.funding.length = 0;
    h.written.mark.length = 0;
    h.restCalls.length = 0;

    await h.collector.onMessage(ticker('XRPUSDT', 'snapshot', { markPrice: '2.1', fundingRate: '0.00031', nextFundingTime: String(NEXT_FUNDING) }));
    await h.collector.onMessage(ticker('XRPUSDT', 'delta', { nextFundingTime: String(NEXT_FUNDING + 8 * 3_600_000) }));

    expect(h.written.mark).toContainEqual(expect.objectContaining({ symbol: 'XRPUSDT', ts: new Date(NEXT_FUNDING), predictedFundingRate: 0.00031 }));
    expect(h.restCalls.map((c) => c.symbol)).toEqual(['XRPUSDT']);
    expect(h.written.funding).toEqual([
      { venue: 'bybit', symbol: 'XRPUSDT', fundingTime: new Date(NEXT_FUNDING), rate: 0.0001, markPrice: null, source: 'rest' },
    ]);
  });

  it('IB-BUG-015: a refused prediction row does not cost the settled rate, and the warning names the table', async () => {
    const funding: FundingSettlementRow[] = [];
    const warnings: string[] = [];
    const h = harness({
      writers: {
        markFunding: { write: async () => { throw new Error('mark_funding_1m: write of 1 of 1 row(s) failed: boom'); } },
        fundingSettlements: { write: async (rows) => (funding.push(...rows), rows.length) },
        liquidations: { write: async (rows) => rows.length },
      },
      logger: { log: () => undefined, warn: (m: string) => void warnings.push(m) },
    });
    await h.collector.start();
    await h.collector.whenBackfilled();
    funding.length = 0;

    await h.collector.onMessage(ticker('XRPUSDT', 'snapshot', { markPrice: '2.1', fundingRate: '0.00031', nextFundingTime: String(NEXT_FUNDING) }));
    await h.collector.onMessage(ticker('XRPUSDT', 'delta', { nextFundingTime: String(NEXT_FUNDING + 8 * 3_600_000) }));

    expect(funding).toEqual([
      { venue: 'bybit', symbol: 'XRPUSDT', fundingTime: new Date(NEXT_FUNDING), rate: 0.0001, markPrice: null, source: 'rest' },
    ]);
    expect(warnings).toContainEqual(expect.stringMatching(/^bybit write to mark_funding_1m failed, 1 row\(s\) not written: .*boom/));
  });

  it('the recorded snapshot+delta pair keeps the mark price through the delta', async () => {
    const h = harness({ symbols: ['BTCUSDT'], signalSet: ['BTCUSDT'] });
    await h.collector.start();
    await h.collector.tick();
    h.written.mark.length = 0;

    await h.collector.onMessage(TICKER_SNAPSHOT);
    await h.collector.onMessage(TICKER_DELTA);

    h.at(T0 + 61_000);
    await h.collector.tick();
    expect(h.written.mark[0]).toMatchObject({ markPrice: 82997.4, indexPrice: 83032.8 });
  });

  it('the tick asks the socket about silence', async () => {
    const h = harness();
    await h.collector.start();
    await h.collector.tick();
    expect(h.sockets[0].silenceChecks).toBe(1);
  });
});

describe('BybitCollector — boot funding backfill (§4.3)', () => {
  const page = (symbol: string, times: number[]) => times.map((t) => ({ symbol, fundingRate: '0.0001', fundingRateTimestamp: String(t) }));

  it('with nothing stored it pages back until the venue runs out', async () => {
    const h = harness({ symbols: ['BTCUSDT'], signalSet: ['BTCUSDT'], earliestFundingTimes: async () => new Map() });
    h.setPages({ BTCUSDT: [page('BTCUSDT', [NEXT_FUNDING, NEXT_FUNDING - 8 * 3_600_000]), page('BTCUSDT', [NEXT_FUNDING - 16 * 3_600_000]), []] });
    await h.collector.start();
    await h.collector.whenBackfilled();

    expect(h.written.funding).toHaveLength(3);
    expect(h.restCalls.length).toBeGreaterThanOrEqual(2);
    expect(h.restCalls[1].endTime).toBe(NEXT_FUNDING - 8 * 3_600_000 - 1); // pages backwards by endTime
  });

  it('stops as soon as it reaches what is already stored — a restart costs one page', async () => {
    const earliest = NEXT_FUNDING - 8 * 3_600_000;
    const h = harness({ symbols: ['BTCUSDT'], signalSet: ['BTCUSDT'], earliestFundingTimes: async () => new Map([['BTCUSDT', earliest]]) });
    h.setPages({ BTCUSDT: [page('BTCUSDT', [NEXT_FUNDING, earliest]), page('BTCUSDT', [earliest - 8 * 3_600_000])] });
    await h.collector.start();
    await h.collector.whenBackfilled();

    expect(h.restCalls).toHaveLength(1);
    expect(h.written.funding).toHaveLength(2);
  });

  it('honours the page cap, so a venue that never ends cannot spin', async () => {
    const h = harness({ symbols: ['BTCUSDT'], signalSet: ['BTCUSDT'], earliestFundingTimes: async () => new Map(), maxBackfillPages: 3 });
    h.setPages({ BTCUSDT: Array.from({ length: 10 }, (_, i) => page('BTCUSDT', [NEXT_FUNDING - i * 8 * 3_600_000])) });
    await h.collector.start();
    await h.collector.whenBackfilled();
    expect(h.restCalls).toHaveLength(3);
  });

  it('the socket opens BEFORE the backfill finishes — liquidations are websocket-only (found live)', async () => {
    const h = harness({ symbols: ['BTCUSDT'], signalSet: ['BTCUSDT'], earliestFundingTimes: async () => new Map() });
    let released: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (released = resolve));
    h.ports.rest = {
      fundingHistory: async () => {
        await gate; // the venue is slow: the backfill cannot finish yet
        return [];
      },
    } as unknown as BybitRest;
    const collector = new BybitCollector(h.ports);

    await collector.start();
    expect(h.sockets[0].opened).toBe(1); // already listening, with the backfill still in flight

    // and a liquidation arriving during the backfill is written, not lost
    await collector.onMessage(LIQUIDATIONS[0]);
    expect(h.written.liquidations).toHaveLength(1);

    released?.();
    await collector.whenBackfilled();
  });

  it('a failing backfill does not stop the socket from opening', async () => {
    const h = harness({
      symbols: ['BTCUSDT'], signalSet: ['BTCUSDT'],
      earliestFundingTimes: async () => { throw new Error('db down'); },
      rest: { fundingHistory: async () => { throw new Error('venue down'); } } as unknown as BybitRest,
    });
    await h.collector.start();
    await h.collector.whenBackfilled();
    expect(h.sockets[0].opened).toBe(1);
  });
});
