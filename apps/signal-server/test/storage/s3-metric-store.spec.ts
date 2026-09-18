import * as zlib from 'zlib';
import { Readable } from 'stream';
import { GetObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { MetricObservation } from '@trade-automation/contracts';
import { S3MetricStore } from '../../src/storage/s3/s3-metric-store';

function obs(time: number, value: number): MetricObservation {
  return { metric: 'openInterest', instrument: 'binance:BTCUSDT', time, value, unit: 'base' };
}

function gzBody(observations: MetricObservation[]) {
  const jsonl = observations.map((o) => JSON.stringify(o)).join('\n') + '\n';
  return Readable.from(zlib.gzipSync(Buffer.from(jsonl, 'utf8')));
}

describe('S3MetricStore upsert idempotency (architecture/chart-layouts.md §4.4)', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it('upsert on an empty day PUTs a single gzip JSONL object at the metrics/ Hive-style key', async () => {
    s3Mock.on(GetObjectCommand).rejects(new NoSuchKey({ message: 'not found', $metadata: {} }));
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3MetricStore(new S3Client({}), 'test-bucket');
    const time = Date.UTC(2026, 8, 12, 0, 0, 0);
    await store.upsert([obs(time, 100)]);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0].args[0].input.Key).toBe(
      'metrics/venue=binance/symbol=BTCUSDT/metric=openInterest/date=2026-09-12.jsonl.gz',
    );
    expect(puts[0].args[0].input.ContentEncoding).toBe('gzip');
  });

  it('re-upserting the same time merges into the existing day object instead of duplicating', async () => {
    const time = Date.UTC(2026, 8, 12, 0, 0, 0);
    s3Mock.on(GetObjectCommand).resolves({ Body: gzBody([obs(time, 100)]) as never });
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3MetricStore(new S3Client({}), 'test-bucket');
    await store.upsert([obs(time, 999)]);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    const written = zlib.gunzipSync(puts[0].args[0].input.Body as Buffer).toString('utf8').trim();
    const rows = written.split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(999);
  });

  it('earliestTime / latestTime follow the ListObjectsV2 continuation token (> 1 000 day objects: a 3-year crawl)', async () => {
    const prefix = 'metrics/venue=binance/symbol=BTCUSDT/metric=openInterest/';
    const dayKey = (d: number) => `${prefix}date=${new Date(Date.UTC(2023, 0, 1) + d * 86_400_000).toISOString().slice(0, 10)}.jsonl.gz`;
    s3Mock
      .on(ListObjectsV2Command, { ContinuationToken: undefined })
      .resolves({ Contents: Array.from({ length: 1000 }, (_, d) => ({ Key: dayKey(d) })), IsTruncated: true, NextContinuationToken: 'p2' })
      .on(ListObjectsV2Command, { ContinuationToken: 'p2' })
      .resolves({ Contents: Array.from({ length: 100 }, (_, d) => ({ Key: dayKey(1000 + d) })), IsTruncated: false });
    const first = Date.UTC(2023, 0, 1, 0, 5);
    const last = Date.UTC(2023, 0, 1) + 1099 * 86_400_000 + 300_000;
    s3Mock.on(GetObjectCommand, { Key: dayKey(0) }).callsFake(() => ({ Body: gzBody([obs(first, 1)]) }));
    s3Mock.on(GetObjectCommand, { Key: dayKey(1099) }).callsFake(() => ({ Body: gzBody([obs(last, 2)]) }));

    const store = new S3MetricStore(new S3Client({}), 'test-bucket');
    expect(await store.earliestTime('binance:BTCUSDT', 'openInterest')).toBe(first);
    expect(await store.latestTime('binance:BTCUSDT', 'openInterest')).toBe(last);
  });

  it('query returns [] instead of throwing when the day object does not exist', async () => {
    s3Mock.on(GetObjectCommand).rejects(new NoSuchKey({ message: 'not found', $metadata: {} }));
    const store = new S3MetricStore(new S3Client({}), 'test-bucket');

    const rows = await store.query('binance:BTCUSDT', 'openInterest', 0, 1);
    expect(rows).toEqual([]);
  });

  it('upgrades legacy JSONL rows (no unit / notionalBasis) on read', async () => {
    const t0 = Date.UTC(2026, 8, 12, 0, 0, 0);
    const legacy =
      '{"metric":"openInterest","instrument":"binance:BTCUSDT","time":' + t0 + ',"value":103141.33,"notional":7962510.46}\n' +
      '{"metric":"openInterest","instrument":"binance:BTCUSDT","time":' + (t0 + 60_000) + ',"value":103150}\n';
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from(zlib.gzipSync(Buffer.from(legacy, 'utf8'))) as never });
    const store = new S3MetricStore(new S3Client({}), 'test-bucket');

    const rows = await store.query('binance:BTCUSDT', 'openInterest', t0, t0 + 60_000);
    expect(rows).toEqual([
      { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: t0, value: 103141.33, unit: 'base', notional: 7962510.46, notionalBasis: 'venue' },
      { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: t0 + 60_000, value: 103150, unit: 'base' },
    ]);
  });
});
