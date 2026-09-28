import { zipSync } from 'fflate';
import { ArchiveClient, mapWithConcurrency, unzipSingle } from '../src/archive/archive-client';
import { dailyMetricsUrl, metricsFloor, monthlyKlinesUrl } from '../src/archive/archive-paths';

/** IB-012 §5 — downloading an archive file, and the 404-is-an-answer rule. */

const zipOf = (name: string, body: string) => zipSync({ [name]: new TextEncoder().encode(body) });

const response = (status: number, body?: Uint8Array): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => (body as Uint8Array).buffer,
  }) as unknown as Response;

describe('unzipSingle', () => {
  it('returns the single CSV inside the zip', () => {
    expect(unzipSingle(zipOf('BTCUSDT-1m-2025-01.csv', 'a,b\n'))).toBe('a,b\n');
  });

  it('picks the .csv when a zip carries more than one entry', () => {
    expect(unzipSingle(zipSync({ 'notes.txt': new Uint8Array([1]), 'x.csv': new TextEncoder().encode('1,2') }))).toBe('1,2');
  });
});

describe('ArchiveClient', () => {
  const noSleep = async () => {};

  it('404 comes back as "absent" — the archive simply has no such month', async () => {
    const fetchImpl = jest.fn(async () => response(404));
    const client = new ArchiveClient({ fetchImpl: fetchImpl as never, sleep: noSleep });
    expect(await client.get('u')).toEqual({ kind: 'absent' });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // and is NOT retried
  });

  it('retries a 5xx and succeeds', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => (++calls < 3 ? response(503) : response(200, zipOf('a.csv', 'ok'))));
    const client = new ArchiveClient({ fetchImpl: fetchImpl as never, sleep: noSleep });
    expect(await client.get('u')).toMatchObject({ kind: 'ok', text: 'ok' });
    expect(calls).toBe(3);
  });

  it('gives up after the retry budget and throws the last error', async () => {
    const fetchImpl = jest.fn(async () => response(500));
    const client = new ArchiveClient({ fetchImpl: fetchImpl as never, sleep: noSleep, retries: 2 });
    await expect(client.get('u')).rejects.toThrow(/HTTP 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // the first try plus two retries
  });

  it('retries a transport error too', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      if (++calls === 1) throw new Error('ECONNRESET');
      return response(200, zipOf('a.csv', 'fine'));
    });
    const client = new ArchiveClient({ fetchImpl: fetchImpl as never, sleep: noSleep });
    expect(await client.get('u')).toMatchObject({ text: 'fine' });
  });
});

describe('mapWithConcurrency', () => {
  it('never exceeds the limit and keeps input order (§5: ≤ 4 parallel)', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });
});

describe('archive paths and the measured depth floors', () => {
  it('builds the perp and spot monthly kline urls', () => {
    expect(monthlyKlinesUrl('perp', 'BTCUSDT', '2025-01')).toBe(
      'https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2025-01.zip');
    expect(monthlyKlinesUrl('spot', 'BTCUSDT', '2025-01')).toContain('/data/spot/monthly/klines/');
  });

  it('metrics are DAILY only — the monthly prefix does not exist', () => {
    expect(dailyMetricsUrl('BTCUSDT', '2026-09-27')).toContain('/futures/um/daily/metrics/');
  });

  it('the OI floor is per symbol: BTC 2020-09, everything else 2021-12', () => {
    // measured in research/squeeze-full-form — asking earlier returns 404 forever, and treating
    // that as a hole would put a permanent red line in the daily gap report
    expect(metricsFloor('BTCUSDT')).toBe('2020-09-01');
    expect(metricsFloor('ETHUSDT')).toBe('2021-12-01');
    expect(metricsFloor('SOLUSDT')).toBe('2021-12-01');
  });
});
