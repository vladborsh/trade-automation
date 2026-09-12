import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Candle } from '@trade-automation/contracts';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';

function bar(openTime: number, close: number): Candle {
  return {
    instrument: 'binance:BTCUSDT',
    timeframe: '1m',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    closed: true,
    source: 'venue-rest',
  };
}

describe('FileCandleStore upsert idempotency (architecture/live-signal-server.md §4.3, §6.4)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-server-file-store-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('upserting the same (instrument, timeframe, openTime) twice does not duplicate the row', async () => {
    const store = new FileCandleStore(root);
    const openTime = Date.UTC(2026, 8, 12, 0, 0, 0);

    await store.upsert([bar(openTime, 100)]);
    await store.upsert([bar(openTime, 100)]);

    const rows = await store.query('binance:BTCUSDT', '1m', openTime, openTime);
    expect(rows).toHaveLength(1);
  });

  it('re-upserting with a new close value replaces the row in place (repair semantics)', async () => {
    const store = new FileCandleStore(root);
    const openTime = Date.UTC(2026, 8, 12, 0, 0, 0);

    await store.upsert([bar(openTime, 100)]);
    await store.upsert([bar(openTime, 999)]);

    const rows = await store.query('binance:BTCUSDT', '1m', openTime, openTime);
    expect(rows).toHaveLength(1);
    expect(rows[0].close).toBe(999);
  });

  it('query returns bars ascending, and stream yields the same ordered sequence', async () => {
    const store = new FileCandleStore(root);
    const t0 = Date.UTC(2026, 8, 12, 0, 0, 0);
    await store.upsert([bar(t0 + 2 * 60_000, 3), bar(t0, 1), bar(t0 + 60_000, 2)]);

    const rows = await store.query('binance:BTCUSDT', '1m', t0, t0 + 2 * 60_000);
    expect(rows.map((r) => r.close)).toEqual([1, 2, 3]);

    const streamed: number[] = [];
    for await (const c of store.stream('binance:BTCUSDT', '1m', t0, t0 + 2 * 60_000)) {
      streamed.push(c.close);
    }
    expect(streamed).toEqual([1, 2, 3]);
  });

  it('latestOpenTime reflects the most recent upserted bar across day files', async () => {
    const store = new FileCandleStore(root);
    const day1 = Date.UTC(2026, 8, 12, 23, 59, 0);
    const day2 = Date.UTC(2026, 8, 13, 0, 1, 0);

    await store.upsert([bar(day1, 1)]);
    expect(await store.latestOpenTime('binance:BTCUSDT', '1m')).toBe(day1);

    await store.upsert([bar(day2, 2)]);
    expect(await store.latestOpenTime('binance:BTCUSDT', '1m')).toBe(day2);
  });
});
