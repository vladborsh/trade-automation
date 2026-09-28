import { Instrument } from '@trade-automation/contracts';
import { BinanceAdapter } from '../src/binance.adapter';
import { BinanceRestKline } from '../src/binance.mapper';

/**
 * A fake `ws` socket (the factory is hoisted, so the class lives inside it): records the URL it was
 * opened with on `globalThis` and lets a test fire the socket's events.
 */
interface FakeSocket {
  fire(event: string, arg?: unknown): void;
}
interface WsProbe {
  opened: string[];
  sockets: FakeSocket[];
}

jest.mock('ws', () => {
  const probe: WsProbe = { opened: [], sockets: [] };
  (globalThis as unknown as { __wsProbe: WsProbe }).__wsProbe = probe;
  class FakeWebSocket {
    private readonly handlers = new Map<string, (arg?: unknown) => void>();
    constructor(url: string) {
      probe.opened.push(url);
      probe.sockets.push(this);
    }
    on(event: string, handler: (arg?: unknown) => void): this {
      this.handlers.set(event, handler);
      return this;
    }
    fire(event: string, arg?: unknown): void {
      this.handlers.get(event)?.(arg);
    }
    close(): void {
      /* the subscription's teardown closes it; nothing for the fake to do */
    }
  }
  return { __esModule: true, default: FakeWebSocket };
});

const probe = () => (globalThis as unknown as { __wsProbe: WsProbe }).__wsProbe;


const instrument: Instrument = {
  id: 'binance:BTCUSDT',
  venue: 'binance',
  symbol: 'BTCUSDT',
  assetClass: 'crypto-perp',
  displayName: 'BTC',
  pricePrecision: 2,
  quoteCurrency: 'USDT',
  sessionCurrency: 'USDT',
  sessionTimezone: 'UTC',
};

function kline(openTime: number, closeTime: number): BinanceRestKline {
  return [openTime, '100', '101', '99', '100.5', '10', closeTime, '1000', 5, '5', '500', '0'];
}

describe('BinanceAdapter.fetchCandles native coarse fetch (architecture/live-signal-server.md §12.5 item 3)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('sets `interval` to the requested timeframe and maps rows with source venue-native', async () => {
    const from = 1_700_000_000_000;
    const to = from + 3 * 60 * 60_000;
    const rows = [kline(from, from + 3_599_999), kline(from + 3_600_000, from + 7_199_999)];

    const fetchMock = jest.fn(async (url: URL) => {
      expect(url.searchParams.get('interval')).toBe('1h');
      return { ok: true, json: async () => rows } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example');
    const candles = await adapter.fetchCandles(instrument, '1h', from, to);

    expect(candles).toHaveLength(2);
    expect(candles.every((c) => c.timeframe === '1h' && c.source === 'venue-native')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // both rows fit in one REST_PAGE_LIMIT page
  });

  it('still maps 1m fetches with source venue-rest (unchanged default path)', async () => {
    const from = 1_700_000_000_000;
    const rows = [kline(from, from + 59_999)];
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => rows }) as Response) as unknown as typeof fetch;

    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example');
    const candles = await adapter.fetchCandles(instrument, '1m', from, from);

    expect(candles[0].source).toBe('venue-rest');
    expect(candles[0].timeframe).toBe('1m');
  });

  it('paginates using the requested timeframe\'s bar duration, not a hardcoded 1m step', async () => {
    const REST_PAGE_LIMIT = 1500;
    const from = 1_700_000_000_000;
    const HOUR = 60 * 60_000;
    const firstPage = Array.from({ length: REST_PAGE_LIMIT }, (_, i) =>
      kline(from + i * HOUR, from + i * HOUR + HOUR - 1),
    );
    const secondPage = [kline(from + REST_PAGE_LIMIT * HOUR, from + REST_PAGE_LIMIT * HOUR + HOUR - 1)];

    let call = 0;
    const fetchMock = jest.fn(async (url: URL) => {
      call += 1;
      expect(url.searchParams.get('interval')).toBe('1h');
      return { ok: true, json: async () => (call === 1 ? firstPage : secondPage) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example');
    const to = from + (REST_PAGE_LIMIT + 1) * HOUR;
    const candles = await adapter.fetchCandles(instrument, '1h', from, to);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(candles).toHaveLength(REST_PAGE_LIMIT + 1);
  });
});

/**
 * IB-001's WS edit: the socket is opened on the combined-stream URL with a list of stream names, so a
 * later caller can multiplex; Binance wraps every combined payload as `{stream, data}`, and unwrapping
 * it leaves a single-stream caller with exactly what `/ws/<stream>` used to give.
 */
describe('BinanceAdapter.streamCandles over the combined-stream URL', () => {
  const silent = { log: () => undefined, warn: () => undefined };

  function wsKline(openTime: number, closed: boolean) {
    return {
      e: 'kline',
      E: openTime + 1,
      s: 'BTCUSDT',
      k: { t: openTime, T: openTime + 59_999, s: 'BTCUSDT', i: '1m', o: '100', h: '101', l: '99', c: '100.5', v: '10', x: closed },
    };
  }

  afterEach(() => {
    probe().opened.length = 0;
    probe().sockets.length = 0;
  });

  it('opens /stream?streams=… for one stream and emits the candle out of the {stream,data} envelope', () => {
    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example', silent);
    const seen: number[] = [];
    const sub = adapter.streamCandles(instrument).subscribe((c) => seen.push(c.openTime));

    expect(probe().opened).toEqual(['wss://example/stream?streams=btcusdt@kline_1m']);
    probe().sockets[0].fire('open');
    probe().sockets[0].fire('message', Buffer.from(JSON.stringify({ stream: 'btcusdt@kline_1m', data: wsKline(1_700_000_000_000, true) })));
    probe().sockets[0].fire('message', Buffer.from(JSON.stringify(wsKline(1_700_000_060_000, false)))); // a bare payload still works
    sub.unsubscribe();

    expect(seen).toEqual([1_700_000_000_000, 1_700_000_060_000]);
  });

  it('takes a list of streams on one socket (what a multiplexing caller needs)', () => {
    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example', silent);
    const sub = adapter.streamKlines(['btcusdt@kline_1m', 'ethusdt@kline_1m'], instrument).subscribe();
    expect(probe().opened).toEqual(['wss://example/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m']);
    sub.unsubscribe();
  });
});

/**
 * BUG-019: a socket that is accepted and then goes silent — with no `close` event — used to strand the
 * feed forever: the REST fallback armed only if the socket had NEVER spoken, and the reconnect needed
 * a `close`. That is how the coordinator's live candles went ~25 h stale.
 */
describe('BinanceAdapter silence watchdog (BUG-019)', () => {
  const silent = { log: () => undefined, warn: () => undefined };
  const timings = { silenceAfterOpenMs: 30, silenceMs: 90, muteRetryMs: 300, restPollMs: 10 };

  function kmsg(openTime: number) {
    return Buffer.from(
      JSON.stringify({
        stream: 'btcusdt@kline_1m',
        data: {
          e: 'kline',
          E: openTime + 1,
          s: 'BTCUSDT',
          k: { t: openTime, T: openTime + 59_999, s: 'BTCUSDT', i: '1m', o: '100', h: '101', l: '99', c: '100.5', v: '10', x: true },
        },
      }),
    );
  }

  /** Lets the REST poll's promise chain settle under fake timers. */
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  let restCalls = 0;

  beforeEach(() => {
    jest.useFakeTimers();
    restCalls = 0;
    probe().opened.length = 0;
    probe().sockets.length = 0;
    global.fetch = jest.fn(async () => {
      restCalls += 1;
      return { ok: true, json: async () => [kline(1_700_000_000_000, 1_700_000_059_999), kline(1_700_000_060_000, 1_700_000_119_999)] } as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('mute after delivering: reconnects, serves REST meanwhile, reports degraded, then recovers on the first message back', async () => {
    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example', silent, timings);
    const statuses: string[] = [];
    adapter.health().subscribe((s) => statuses.push(s));
    const seen: number[] = [];
    const sub = adapter.streamCandles(instrument).subscribe((c) => seen.push(c.openTime));

    probe().sockets[0].fire('open');
    probe().sockets[0].fire('message', kmsg(1_700_000_000_000));
    expect(seen).toEqual([1_700_000_000_000]);
    expect(statuses).toEqual(['up']);

    // it then goes silent, with no close event of its own
    jest.advanceTimersByTime(timings.silenceMs);
    await flush();
    expect(statuses).toEqual(['up', 'degraded']); // GET /api/health shows the degraded venue
    jest.advanceTimersByTime(timings.restPollMs * 2);
    await flush();
    expect(restCalls).toBeGreaterThan(0); // candles keep coming from REST while it is mute

    jest.advanceTimersByTime(timings.muteRetryMs); // the socket is retried, which it never was before
    expect(probe().opened).toHaveLength(2);

    const callsBefore = restCalls;
    probe().sockets[1].fire('open');
    probe().sockets[1].fire('message', kmsg(1_700_000_060_000));
    await flush();
    expect(seen).toContain(1_700_000_060_000);
    expect(statuses).toEqual(['up', 'degraded', 'up']); // recovery is visible
    jest.advanceTimersByTime(timings.restPollMs * 3);
    await flush();
    expect(restCalls).toBe(callsBefore); // the REST poll stopped

    sub.unsubscribe();
  });

  it('mute from the first byte: the same watchdog arms after the shorter open timeout', async () => {
    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example', silent, timings);
    const statuses: string[] = [];
    adapter.health().subscribe((s) => statuses.push(s));
    const sub = adapter.streamCandles(instrument).subscribe();

    probe().sockets[0].fire('open');
    jest.advanceTimersByTime(timings.silenceAfterOpenMs);
    await flush();
    expect(statuses).toEqual(['up', 'degraded']);
    jest.advanceTimersByTime(timings.restPollMs);
    await flush();
    expect(restCalls).toBeGreaterThan(0);

    sub.unsubscribe();
    expect(statuses).toEqual(['up', 'degraded', 'up']); // the subscription's teardown clears the degraded mark
  });

  it('an ordinary close still reconnects with backoff, and the watchdog does not double-schedule it', () => {
    const adapter = new BinanceAdapter('https://fapi.example', 'wss://example', silent, timings);
    const sub = adapter.streamCandles(instrument).subscribe();

    probe().sockets[0].fire('open');
    probe().sockets[0].fire('close');
    expect(probe().opened).toHaveLength(1); // scheduled, not immediate
    jest.advanceTimersByTime(1000);
    expect(probe().opened).toHaveLength(2);

    sub.unsubscribe();
  });
});
