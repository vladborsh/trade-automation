import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetricObservation } from '@trade-automation/contracts';
import { FileMetricStore } from '../../src/storage/file/file-metric-store';

function obs(time: number, value: number): MetricObservation {
  return { metric: 'openInterest', instrument: 'binance:BTCUSDT', time, value, unit: 'base' };
}

describe('FileMetricStore upsert idempotency (architecture/chart-layouts.md §4.4)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-server-file-metric-store-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('upserting the same (instrument, metric, time) twice does not duplicate the row', async () => {
    const store = new FileMetricStore(root);
    const time = Date.UTC(2026, 8, 12, 0, 0, 0);

    await store.upsert([obs(time, 100)]);
    await store.upsert([obs(time, 100)]);

    const rows = await store.query('binance:BTCUSDT', 'openInterest', time, time);
    expect(rows).toHaveLength(1);
  });

  it('re-upserting with a new value replaces the row in place', async () => {
    const store = new FileMetricStore(root);
    const time = Date.UTC(2026, 8, 12, 0, 0, 0);

    await store.upsert([obs(time, 100)]);
    await store.upsert([obs(time, 999)]);

    const rows = await store.query('binance:BTCUSDT', 'openInterest', time, time);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(999);
  });

  it('query returns observations ascending, at the metrics/ prefix Hive-style path', async () => {
    const t0 = Date.UTC(2026, 8, 12, 0, 0, 0);
    const store = new FileMetricStore(root);
    await store.upsert([obs(t0 + 2 * 60_000, 3), obs(t0, 1), obs(t0 + 60_000, 2)]);

    const rows = await store.query('binance:BTCUSDT', 'openInterest', t0, t0 + 2 * 60_000);
    expect(rows.map((r) => r.value)).toEqual([1, 2, 3]);

    const expectedFile = path.join(
      root,
      'metrics',
      'venue=binance',
      'symbol=BTCUSDT',
      'metric=openInterest',
      `date=${new Date(t0).toISOString().slice(0, 10)}.jsonl`,
    );
    expect(fs.existsSync(expectedFile)).toBe(true);
  });

  it('latestTime reflects the most recent upserted observation across day files', async () => {
    const store = new FileMetricStore(root);
    const day1 = Date.UTC(2026, 8, 12, 23, 59, 0);
    const day2 = Date.UTC(2026, 8, 13, 0, 1, 0);

    await store.upsert([obs(day1, 1)]);
    expect(await store.latestTime('binance:BTCUSDT', 'openInterest')).toBe(day1);

    await store.upsert([obs(day2, 2)]);
    expect(await store.latestTime('binance:BTCUSDT', 'openInterest')).toBe(day2);
  });

  it('upgrades legacy JSONL rows (no unit / notionalBasis) on read, and writes both back on merge', async () => {
    const store = new FileMetricStore(root);
    const t0 = Date.UTC(2026, 8, 12, 0, 0, 0);
    const file = path.join(
      root,
      'metrics',
      'venue=binance',
      'symbol=BTCUSDT',
      'metric=openInterest',
      'date=2026-09-12.jsonl',
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        '{"metric":"openInterest","instrument":"binance:BTCUSDT","time":' + t0 + ',"value":103141.33,"notional":7962510.46}',
        '{"metric":"openInterest","instrument":"binance:BTCUSDT","time":' + (t0 + 60_000) + ',"value":103150}',
      ].join('\n') + '\n',
    );

    const rows = await store.query('binance:BTCUSDT', 'openInterest', t0, t0 + 60_000);
    expect(rows).toEqual([
      { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: t0, value: 103141.33, unit: 'base', notional: 7962510.46, notionalBasis: 'venue' },
      { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: t0 + 60_000, value: 103150, unit: 'base' },
    ]);
    expect(rows[1]).not.toHaveProperty('notionalBasis');

    await store.upsert([obs(t0 + 120_000, 1)]);
    const written = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(written[0]).toMatchObject({ unit: 'base', notionalBasis: 'venue' });
    expect(written[1]).toMatchObject({ unit: 'base' });
  });
});
