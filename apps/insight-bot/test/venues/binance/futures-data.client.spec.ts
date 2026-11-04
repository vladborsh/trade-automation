import { BinanceWeightTracker } from '../../../src/venues/binance/binance-weight.tracker';
import {
  CALL_WEIGHT,
  FuturesDataClient,
  PAGE_LIMIT,
  RetentionEdgeError,
  RETENTION_MS,
} from '../../../src/venues/binance/futures-data.client';

const BASE = 'https://fapi.binance.com';

/** A fetch stand-in: each call answers from `pages`, recording the URL it was given. */
function fakeFetch(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>) {
  const urls: string[] = [];
  let i = 0;
  const impl = (async (url: string) => {
    urls.push(String(url));
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => next.headers?.[name.toLowerCase()] ?? null },
      json: async () => next.body,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    };
  }) as unknown as typeof fetch;
  return { impl, urls, calls: () => i };
}

const client = (fetchImpl: typeof fetch, weight = new BinanceWeightTracker()) =>
  new FuturesDataClient({ baseUrl: BASE, weight, fetchImpl });

describe('buildUrl', () => {
  it('builds the venue path with only the params it was given', () => {
    const c = client(fakeFetch([{ body: [] }]).impl);
    expect(c.buildUrl({ endpoint: 'openInterestHist', symbol: 'BTCUSDT', period: '5m', limit: 1 })).toBe(
      `${BASE}/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=1`,
    );
    expect(c.buildUrl({ endpoint: 'takerlongshortRatio', symbol: 'ETHUSDT', period: '5m', limit: 500, endTime: 42 })).toBe(
      `${BASE}/futures/data/takerlongshortRatio?symbol=ETHUSDT&period=5m&limit=500&endTime=42`,
    );
  });
});

describe('fetchPage', () => {
  it('IB-BUG-030: books /futures/data at weight 0 — a whole pass leaves the gauge at 0, a /fapi header then reads as itself', async () => {
    // «IP Weight 0» (Binance docs) and measured: 8 clean runs on two occasions moved
    // X-MBX-USED-WEIGHT-1M by 0. Red on the old CALL_WEIGHT = 1: 150 here, then a flip to 2.
    const weight = new BinanceWeightTracker();
    const c = client(fakeFetch([{ body: [{ timestamp: 1 }] }]).impl, weight);
    for (let i = 0; i < 5 * 30; i += 1) await c.fetchPage({ endpoint: 'openInterestHist', symbol: 'BTCUSDT' });
    expect(CALL_WEIGHT).toBe(0);
    expect(weight.used1m()).toBe(0);
    expect(weight.isEstimate()).toBe(true); // no header from /futures/data
    weight.recordHeader(2); // a /fapi response in the same minute
    expect(weight.used1m()).toBe(2);
  });

  it('prefers the venue header when a response carries one', async () => {
    const weight = new BinanceWeightTracker();
    const f = fakeFetch([{ body: [], headers: { 'x-mbx-used-weight-1m': '137' } }]);
    await client(f.impl, weight).fetchPage({ endpoint: 'openInterestHist', symbol: 'BTCUSDT' });
    expect(weight.used1m()).toBe(137);
    expect(weight.isEstimate()).toBe(false);
  });

  it('turns -1130 into RetentionEdgeError, and any other failure into an ordinary error', async () => {
    const edge = fakeFetch([{ status: 400, body: { code: -1130, msg: "parameter 'endTime' is invalid." } }]);
    await expect(client(edge.impl).fetchPage({ endpoint: 'openInterestHist', symbol: 'BTCUSDT' })).rejects.toBeInstanceOf(
      RetentionEdgeError,
    );

    const boom = fakeFetch([{ status: 418, body: { code: -1003, msg: 'too many requests' } }]);
    await expect(client(boom.impl).fetchPage({ endpoint: 'openInterestHist', symbol: 'BTCUSDT' })).rejects.toThrow(/HTTP 418/);
  });

  it('refuses a payload that is not an array', async () => {
    const f = fakeFetch([{ body: { code: 0 } }]);
    await expect(client(f.impl).fetchPage({ endpoint: 'openInterestHist', symbol: 'BTCUSDT' })).rejects.toThrow(
      /expected an array/,
    );
  });
});

describe('fetchBackward', () => {
  const SLOT = 300_000;
  const page = (oldest: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({ timestamp: oldest + i * SLOT }));

  it('walks endTime backward, because the endpoint returns the NEWEST rows in the window', async () => {
    const now = 100_000_000;
    const first = page(now - 99 * SLOT, 100);
    const second = page(now - 199 * SLOT, 100);
    const f = fakeFetch([{ body: first }, { body: second }, { body: [] }]);

    const rows = await client(f.impl).fetchBackward<{ timestamp: number }>(
      { endpoint: 'openInterestHist', symbol: 'BTCUSDT', period: '5m', limit: 100 },
      now - 250 * SLOT,
      now,
    );

    expect(f.urls[0]).toContain(`endTime=${now}`);
    // The second request ends strictly before the first page's oldest row, so no page repeats.
    expect(f.urls[1]).toContain(`endTime=${first[0].timestamp - 1}`);
    expect(rows[0].timestamp).toBe(second[0].timestamp); // oldest first
    expect(rows).toHaveLength(200);
  });

  it('stops cleanly at the retention edge — -1130 means "no more history", not a failure', async () => {
    const now = 100_000_000;
    const f = fakeFetch([
      { body: page(now - 99 * SLOT, 100) },
      { status: 400, body: { code: -1130, msg: "parameter 'endTime' is invalid." } },
    ]);
    const rows = await client(f.impl).fetchBackward<{ timestamp: number }>(
      { endpoint: 'openInterestHist', symbol: 'BTCUSDT', limit: 100 },
      now - 10_000 * SLOT,
      now,
    );
    expect(rows).toHaveLength(100);
  });

  it('stops on an empty page', async () => {
    const f = fakeFetch([{ body: [] }]);
    expect(
      await client(f.impl).fetchBackward<{ timestamp: number }>({ endpoint: 'x', symbol: 'BTCUSDT' }, 0, 100_000_000),
    ).toEqual([]);
    expect(f.calls()).toBe(1);
  });

  it('stops rather than looping when a page does not go further back', async () => {
    // A venue that keeps answering with the same window would otherwise spin forever.
    const now = 100_000_000;
    const same = page(now - 9 * SLOT, 10);
    const f = fakeFetch([{ body: same }, { body: same }, { body: same }]);
    await client(f.impl).fetchBackward<{ timestamp: number }>({ endpoint: 'x', symbol: 'BTCUSDT' }, 0, now);
    expect(f.calls()).toBeLessThanOrEqual(2);
  });

  it('de-duplicates overlapping pages and clips to the requested window', async () => {
    const now = 100_000_000;
    const newer = page(now - 9 * SLOT, 10);
    const overlapping = page(now - 14 * SLOT, 10); // shares five stamps with `newer`
    const f = fakeFetch([{ body: newer }, { body: overlapping }, { body: [] }]);

    const from = now - 12 * SLOT;
    const rows = await client(f.impl).fetchBackward<{ timestamp: number }>({ endpoint: 'x', symbol: 'BTCUSDT' }, from, now);

    expect(new Set(rows.map((r) => r.timestamp)).size).toBe(rows.length); // no duplicates
    expect(rows.every((r) => r.timestamp >= from && r.timestamp <= now)).toBe(true);
    expect(rows).toEqual([...rows].sort((a, b) => a.timestamp - b.timestamp));
  });

  it('paces through the caller, awaiting it so a burst really is spread out', async () => {
    const now = 100_000_000;
    const f = fakeFetch([{ body: page(now - 99 * SLOT, 100) }, { body: [] }]);
    const order: string[] = [];
    await client(f.impl).fetchBackward<{ timestamp: number }>(
      { endpoint: 'x', symbol: 'BTCUSDT', limit: 100 },
      now - 500 * SLOT,
      now,
      async () => {
        order.push('pace-start');
        await new Promise((r) => setTimeout(r, 1));
        order.push('pace-end');
      },
    );
    expect(order).toEqual(['pace-start', 'pace-end']);
  });

  it('defaults to the venue page limit', () => {
    expect(PAGE_LIMIT).toBe(500);
    expect(RETENTION_MS).toBe(30 * 24 * 60 * 60_000);
  });
});
