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

describe('FileCandleStore.coverage (backtest-app-system-design.md §2.2)', () => {
  let root: string;
  const day = (d: number, h = 0, m = 0) => Date.UTC(2026, 8, d, h, m);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-server-file-store-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null when nothing is stored for (instrument, tf)', async () => {
    const store = new FileCandleStore(root);
    expect(await store.coverage('binance:BTCUSDT', '1m')).toBeNull();

    // A tf directory that exists but holds no day files is also empty.
    fs.mkdirSync(path.join(root, 'candles/venue=binance/symbol=BTCUSDT/tf=1m'), { recursive: true });
    expect(await store.coverage('binance:BTCUSDT', '1m')).toBeNull();
  });

  it('single day: from/to are the earliest and latest openTime in that day', async () => {
    const store = new FileCandleStore(root);
    await store.upsert([bar(day(12, 9, 30), 1), bar(day(12, 0, 5), 2), bar(day(12, 23, 59), 3)]);

    expect(await store.coverage('binance:BTCUSDT', '1m')).toEqual({ from: day(12, 0, 5), to: day(12, 23, 59) });
  });

  it('multi-day: first bar of the first day to last bar of the last day, reading only those two day files', async () => {
    const store = new FileCandleStore(root);
    await store.upsert([
      bar(day(10, 4, 0), 1),
      bar(day(10, 5, 0), 1),
      bar(day(11, 12, 0), 1),
      bar(day(14, 7, 0), 1), // gap on the 12th/13th — coverage says nothing about gaps
      bar(day(15, 1, 0), 1),
      bar(day(15, 2, 0), 1),
    ]);
    // Other timeframes and instruments must not leak in.
    await store.upsert([{ ...bar(day(1), 1), timeframe: '1h' }, { ...bar(day(20), 1), instrument: 'binance:ETHUSDT' }]);
    // Corrupt the middle days: coverage must never parse them (it reads first and last only).
    const dir = path.join(root, 'candles/venue=binance/symbol=BTCUSDT/tf=1m');
    fs.writeFileSync(path.join(dir, 'date=2026-09-11.jsonl'), 'not json\n');
    fs.writeFileSync(path.join(dir, 'date=2026-09-14.jsonl'), 'not json\n');

    expect(await store.coverage('binance:BTCUSDT', '1m')).toEqual({ from: day(10, 4, 0), to: day(15, 2, 0) });
  });

  it('skips empty day files at either end and ignores non-day files', async () => {
    const store = new FileCandleStore(root);
    await store.upsert([bar(day(11, 3, 0), 1), bar(day(13, 4, 0), 1)]);
    const dir = path.join(root, 'candles/venue=binance/symbol=BTCUSDT/tf=1m');
    fs.writeFileSync(path.join(dir, 'date=2026-09-10.jsonl'), '');
    fs.writeFileSync(path.join(dir, 'date=2026-09-14.jsonl'), '\n');
    fs.writeFileSync(path.join(dir, '.DS_Store'), 'junk');

    expect(await store.coverage('binance:BTCUSDT', '1m')).toEqual({ from: day(11, 3, 0), to: day(13, 4, 0) });
  });
});
