import { FUNDING_PAGE_LIMIT, MAX_FUNDING_PAGES, OkxRest } from '../../../src/venues/okx/okx-rest';

const BASE = 'https://www.okx.test';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

/** A fetch stand-in answering from a queue, recording every URL. */
function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
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
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    };
  }) as unknown as typeof fetch;
  return { impl, urls, calls: () => i };
}

const page = (oldest: number, count: number) => ({
  code: '0',
  data: Array.from({ length: count }, (_, i) => ({
    instId: 'BTC-USDT-SWAP',
    fundingRate: '0.0001',
    realizedRate: '0.0001',
    fundingTime: String(oldest + i * EIGHT_HOURS),
  })),
});

describe('OkxRest error handling', () => {
  it('treats a non-zero body code as an error, even on HTTP 200', () => {
    // OKX reports application errors in the envelope, not the status line.
    const f = fakeFetch([{ body: { code: '51001', msg: 'Instrument ID does not exist' } }]);
    const rest = new OkxRest({ baseUrl: BASE, fetchImpl: f.impl });
    return expect(rest.instruments()).rejects.toThrow(/code 51001 Instrument ID does not exist/);
  });

  it('reports an HTTP failure with its status', () => {
    const f = fakeFetch([{ status: 403, body: { msg: 'forbidden' } }]);
    const rest = new OkxRest({ baseUrl: BASE, fetchImpl: f.impl });
    return expect(rest.instruments()).rejects.toThrow(/HTTP 403/);
  });

  it('returns an empty list when the venue sends no data array', async () => {
    const f = fakeFetch([{ body: { code: '0' } }]);
    expect(await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).instruments()).toEqual([]);
  });
});

describe('fundingHistory paging', () => {
  it('pages backward with `after`, as measured against the live endpoint', async () => {
    const newest = 1_790_000_000_000;
    const first = page(newest - 99 * EIGHT_HOURS, 100);
    const second = page(newest - 199 * EIGHT_HOURS, 100);
    const f = fakeFetch([{ body: first }, { body: second }, { body: { code: '0', data: [] } }]);

    const { rows } = await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('BTC-USDT-SWAP');

    expect(f.urls[0]).toContain(`limit=${FUNDING_PAGE_LIMIT}`);
    expect(f.urls[0]).not.toContain('after=');
    // The second request asks for rows older than the first page's oldest.
    expect(f.urls[1]).toContain(`after=${first.data[0].fundingTime}`);
    expect(rows).toHaveLength(200);
    expect(rows[0].fundingTime).toBe(second.data[0].fundingTime); // oldest first
  });

  it('stops at an empty page', async () => {
    const f = fakeFetch([{ body: { code: '0', data: [] } }]);
    expect((await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('X')).rows).toEqual([]);
    expect(f.calls()).toBe(1);
  });

  it('stops rather than looping when a page does not go further back', async () => {
    const same = page(1_700_000_000_000, 10);
    const f = fakeFetch([{ body: same }, { body: same }, { body: same }]);
    await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('X');
    expect(f.calls()).toBeLessThanOrEqual(2);
  });

  it('never walks past the page guard', async () => {
    // A venue that always serves a strictly older page would otherwise page forever.
    let oldest = 1_700_000_000_000;
    const impl = (async () => {
      oldest -= 10 * EIGHT_HOURS;
      return { ok: true, status: 200, json: async () => page(oldest, 10), text: async () => '' };
    }) as unknown as typeof fetch;
    const { rows } = await new OkxRest({ baseUrl: BASE, fetchImpl: impl }).fundingHistory('X');
    expect(rows.length).toBeLessThanOrEqual(MAX_FUNDING_PAGES * 10);
  });

  it('de-duplicates overlapping pages on fundingTime', async () => {
    const newer = page(1_700_000_000_000, 10);
    const overlapping = page(1_700_000_000_000 - 5 * EIGHT_HOURS, 10);
    const f = fakeFetch([{ body: newer }, { body: overlapping }, { body: { code: '0', data: [] } }]);
    const { rows } = await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('X');
    expect(new Set(rows.map((r) => r.fundingTime)).size).toBe(rows.length);
    expect(rows).toEqual([...rows].sort((a, b) => Number(a.fundingTime) - Number(b.fundingTime)));
  });

  it('reports each page to the caller, for pacing', async () => {
    const f = fakeFetch([{ body: page(1_700_000_000_000, 10) }, { body: { code: '0', data: [] } }]);
    const seen: number[] = [];
    await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('X', {
      onPage: (rows) => {
        seen.push(rows.length);
      },
    });
    expect(seen).toEqual([10]);
  });
});

describe('the folded IB-012 contract (IB-BUG-003)', () => {
  const SLOT = 8 * 60 * 60 * 1000;
  const now = 1_790_000_000_000;

  it('drops rows older than stopAtMs and stops walking there', async () => {
    const floor = now - 10 * SLOT;
    const f = fakeFetch([{ body: page(now - 19 * SLOT, 20) }, { body: { code: '0', data: [] } }]);
    const { rows, reachedWall } = await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('X', {
      stopAtMs: floor,
    });

    expect(rows.every((r) => Number(r.fundingTime) >= floor)).toBe(true);
    // Stopped at OUR floor, not the venue's wall — the distinction IB-012 logs.
    expect(reachedWall).toBe(false);
  });

  it('reports reachedWall when the VENUE runs out before the floor', async () => {
    const f = fakeFetch([{ body: page(now - 4 * SLOT, 5) }, { body: { code: '0', data: [] } }]);
    const { reachedWall } = await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('X', {
      stopAtMs: now - 10_000 * SLOT, // a floor far beyond anything the venue holds
    });
    expect(reachedWall).toBe(true);
  });

  it('reports reachedWall when a page stops advancing above the floor', async () => {
    const same = page(now - 4 * SLOT, 5);
    const f = fakeFetch([{ body: same }, { body: same }]);
    const { reachedWall } = await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('X', {
      stopAtMs: now - 10_000 * SLOT,
    });
    expect(reachedWall).toBe(true);
  });

  it('walks to the wall when no floor is given — what the collector wants', async () => {
    const f = fakeFetch([{ body: page(now - 9 * SLOT, 10) }, { body: { code: '0', data: [] } }]);
    const { rows, reachedWall } = await new OkxRest({ baseUrl: BASE, fetchImpl: f.impl }).fundingHistory('X');
    expect(rows).toHaveLength(10);
    expect(reachedWall).toBe(true);
  });
});
