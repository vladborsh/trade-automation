import { Instrument } from '@trade-automation/contracts';
import { CapComPriceNotFoundError, CapitalComAdapter } from '../../src/market-data/capitalcom/capitalcom.adapter';
import { CapComPriceRow } from '../../src/market-data/capitalcom/capitalcom.mapper';

const instrument: Instrument = {
  id: 'capitalcom:US100',
  venue: 'capitalcom',
  symbol: 'US100',
  assetClass: 'index-cfd',
  displayName: 'US100',
  pricePrecision: 1,
  quoteCurrency: 'USD',
  sessionCurrency: 'USD',
  sessionTimezone: 'UTC',
};

function row(snapshotTimeUTC: string): CapComPriceRow {
  return {
    snapshotTime: snapshotTimeUTC,
    snapshotTimeUTC,
    openPrice: { bid: 100, ask: 100.2 },
    highPrice: { bid: 101, ask: 101.2 },
    lowPrice: { bid: 99, ask: 99.2 },
    closePrice: { bid: 100.5, ask: 100.7 },
    lastTradedVolume: 0,
  };
}

function fakeSession() {
  return { authHeaders: jest.fn(async () => ({ 'X-CAP-API-KEY': 'k' })) } as never;
}

describe('CapitalComAdapter.fetchCandles native coarse fetch (architecture/live-signal-server.md §12.4/§12.5 item 3)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('sets `resolution` to the CAP_COM_RESOLUTION value for the requested timeframe and maps rows as venue-native', async () => {
    const rows = [row('2024-01-02T00:00:00'), row('2024-01-03T00:00:00')];
    const fetchMock = jest.fn(async (url: URL) => {
      expect(url.searchParams.get('resolution')).toBe('DAY');
      return { ok: true, status: 200, json: async () => ({ prices: rows, instrumentType: 'INDICES' }) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new CapitalComAdapter('https://api-capital.example', fakeSession());
    const from = Date.parse('2024-01-02T00:00:00Z');
    const to = Date.parse('2024-01-03T00:00:00Z');
    const candles = await adapter.fetchCandles(instrument, '1d', from, to);

    expect(candles).toHaveLength(2);
    expect(candles.every((c) => c.timeframe === '1d' && c.source === 'venue-native')).toBe(true);
  });

  it('sets `resolution` to HOUR_4 for 4h (not independently re-verified live — corroborated by cmc-bot-main, §12.4)', async () => {
    const fetchMock = jest.fn(async (url: URL) => {
      expect(url.searchParams.get('resolution')).toBe('HOUR_4');
      return { ok: true, status: 200, json: async () => ({ prices: [], instrumentType: 'INDICES' }) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new CapitalComAdapter('https://api-capital.example', fakeSession());
    await adapter.fetchCandles(instrument, '4h', 0, 60 * 60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('§12.2/§12.4 vendor floor: a 404 becomes CapComPriceNotFoundError, not a generic Error', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }) as Response) as unknown as typeof fetch;

    const adapter = new CapitalComAdapter('https://api-capital.example', fakeSession());

    await expect(adapter.fetchCandles(instrument, '1m', 0, 60_000)).rejects.toBeInstanceOf(CapComPriceNotFoundError);
  });

  it('surfaces a non-404 failure as a plain Error (never silently swallowed as a floor)', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' }) as Response,
    ) as unknown as typeof fetch;

    const adapter = new CapitalComAdapter('https://api-capital.example', fakeSession());

    await expect(adapter.fetchCandles(instrument, '1h', 0, 60 * 60_000)).rejects.not.toBeInstanceOf(
      CapComPriceNotFoundError,
    );
  });
});

/**
 * BUG-021 — `health()` used to be a constant `'up'`, so a venue failing every poll still reported
 * healthy (the coordinator's instruments sat 25-41 h stale with the key rejected, T-061). Same shape
 * as BUG-019's Binance fix: consecutive failures per stream, a venue-wide BehaviorSubject, recovery
 * on the first good poll. Fake timers, so the bar-boundary poll is driven, not waited for.
 */
describe('CapitalComAdapter health (BUG-021)', () => {
  const realFetch = global.fetch;
  const second = (instrument: Instrument) => instrument; // readability in the two-instrument test

  beforeEach(() => jest.useFakeTimers({ now: Date.UTC(2026, 8, 28, 12, 0, 0) }));
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  /** Advances past the next bar boundary + jitter and lets the poll's promise chain settle. */
  async function nextPoll(): Promise<void> {
    jest.advanceTimersByTime(62_000);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }

  function statusesOf(adapter: CapitalComAdapter): string[] {
    const seen: string[] = [];
    adapter.health().subscribe((v) => seen.push(v));
    return seen;
  }

  const okResponse = () =>
    ({ ok: true, status: 200, json: async () => ({ prices: [row('2026-09-28T11:58:00'), row('2026-09-28T11:59:00')], instrumentType: 'INDICES' }) }) as Response;
  const rejected = () => ({ ok: false, status: 401, statusText: 'Unauthorized' }) as Response;

  it('starts up, and stays up while a single poll fails (one 429 is not a degraded venue)', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => (++calls === 1 ? rejected() : okResponse())) as never;
    const adapter = new CapitalComAdapter('https://x', fakeSession(), { failuresToDegrade: 3 });
    const seen = statusesOf(adapter);
    const sub = adapter.streamCandles(instrument).subscribe({ next: () => undefined });

    await nextPoll();
    await nextPoll();

    expect(seen).toEqual(['up']);
    sub.unsubscribe();
  });

  it('reports degraded once the venue has failed the configured number of polls in a row', async () => {
    global.fetch = jest.fn(async () => rejected()) as never;
    const adapter = new CapitalComAdapter('https://x', fakeSession(), { failuresToDegrade: 3 });
    const seen = statusesOf(adapter);
    const sub = adapter.streamCandles(instrument).subscribe({ next: () => undefined });

    await nextPoll();
    await nextPoll();
    expect(seen).toEqual(['up']); // two failures: not yet
    await nextPoll();

    expect(seen).toEqual(['up', 'degraded']);
    sub.unsubscribe();
  });

  it('recovers on the first good poll, and does not re-emit degraded while it stays broken', async () => {
    let fail = true;
    global.fetch = jest.fn(async () => (fail ? rejected() : okResponse())) as never;
    const adapter = new CapitalComAdapter('https://x', fakeSession(), { failuresToDegrade: 2 });
    const seen = statusesOf(adapter);
    const sub = adapter.streamCandles(instrument).subscribe({ next: () => undefined });

    await nextPoll();
    await nextPoll();
    expect(seen).toEqual(['up', 'degraded']);

    await nextPoll(); // still failing: one degraded, not one per poll
    expect(seen).toEqual(['up', 'degraded']);

    fail = false;
    await nextPoll();
    expect(seen).toEqual(['up', 'degraded', 'up']);
    sub.unsubscribe();
  });

  it('a run of failures broken by one good poll starts the count again', async () => {
    const outcomes = [rejected(), rejected(), okResponse(), rejected(), rejected()];
    let i = 0;
    global.fetch = jest.fn(async () => outcomes[i++] ?? okResponse()) as never;
    const adapter = new CapitalComAdapter('https://x', fakeSession(), { failuresToDegrade: 3 });
    const seen = statusesOf(adapter);
    const sub = adapter.streamCandles(instrument).subscribe({ next: () => undefined });

    for (let poll = 0; poll < 5; poll++) await nextPoll();

    // fail, fail, OK, fail, fail — never three in a row, so the venue was never degraded
    expect(seen).toEqual(['up']);
    sub.unsubscribe();
  });

  it('stays degraded while ANY instrument is failing, and returns up when the last one recovers', async () => {
    const other: Instrument = { ...second(instrument), id: 'capitalcom:EURUSD', symbol: 'EURUSD' };
    const failing = new Set<string>(['US100', 'EURUSD']);
    global.fetch = jest.fn(async (url: URL) => {
      const epic = url.pathname.split('/').pop() as string;
      return failing.has(epic) ? rejected() : okResponse();
    }) as never;

    const adapter = new CapitalComAdapter('https://x', fakeSession(), { failuresToDegrade: 2 });
    const seen = statusesOf(adapter);
    const subs = [
      adapter.streamCandles(instrument).subscribe({ next: () => undefined }),
      adapter.streamCandles(other).subscribe({ next: () => undefined }),
    ];

    await nextPoll();
    await nextPoll();
    expect(seen).toEqual(['up', 'degraded']);

    failing.delete('US100');
    await nextPoll();
    expect(seen).toEqual(['up', 'degraded']); // EURUSD is still failing

    failing.delete('EURUSD');
    await nextPoll();
    expect(seen).toEqual(['up', 'degraded', 'up']);
    for (const sub of subs) sub.unsubscribe();
  });

  it('unsubscribing a failing stream releases the venue, rather than pinning it degraded forever', async () => {
    global.fetch = jest.fn(async () => rejected()) as never;
    const adapter = new CapitalComAdapter('https://x', fakeSession(), { failuresToDegrade: 2 });
    const seen = statusesOf(adapter);
    const sub = adapter.streamCandles(instrument).subscribe({ next: () => undefined });

    await nextPoll();
    await nextPoll();
    expect(seen).toEqual(['up', 'degraded']);

    sub.unsubscribe();
    expect(seen).toEqual(['up', 'degraded', 'up']);
  });

  it('replays the current status to a late subscriber (what /api/health reads)', async () => {
    global.fetch = jest.fn(async () => rejected()) as never;
    const adapter = new CapitalComAdapter('https://x', fakeSession(), { failuresToDegrade: 1 });
    const sub = adapter.streamCandles(instrument).subscribe({ next: () => undefined });
    await nextPoll();

    expect(statusesOf(adapter)).toEqual(['degraded']);
    sub.unsubscribe();
  });
});
