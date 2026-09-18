import * as zlib from 'zlib';
import { Readable } from 'stream';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
