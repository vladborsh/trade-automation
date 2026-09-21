import * as zlib from 'zlib';
import { Readable } from 'stream';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { Candle } from '@trade-automation/contracts';
import { S3CandleStore } from '../../src/storage/s3/s3-candle-store';

// No real AWS credentials exist in this build environment (per the Architect's routing note,
// §9.1) — this exercises S3CandleStore against a mocked S3Client (aws-sdk-client-mock), not a
// live bucket. A local S3-compatible stand-in (e.g. MinIO via docker-compose) is an alternative
// the README documents for a more end-to-end check.
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

function gzBody(candles: Candle[]) {
  const jsonl = candles.map((c) => JSON.stringify(c)).join('\n') + '\n';
  return Readable.from(zlib.gzipSync(Buffer.from(jsonl, 'utf8')));
}

describe('S3CandleStore upsert idempotency (architecture/live-signal-server.md §6.3, §6.4)', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it('upsert on an empty day PUTs a single gzip JSONL object at the Hive-style key', async () => {
    s3Mock.on(GetObjectCommand).rejects(new NoSuchKey({ message: 'not found', $metadata: {} }));
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3CandleStore(new S3Client({}), 'test-bucket');
    const openTime = Date.UTC(2026, 8, 12, 0, 0, 0);
    await store.upsert([bar(openTime, 100)]);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0].args[0].input.Key).toBe(
      'candles/venue=binance/symbol=BTCUSDT/tf=1m/date=2026-09-12.jsonl.gz',
    );
    expect(puts[0].args[0].input.ContentEncoding).toBe('gzip');
  });

  it('re-upserting the same openTime merges into the existing day object instead of duplicating', async () => {
    const openTime = Date.UTC(2026, 8, 12, 0, 0, 0);
    s3Mock.on(GetObjectCommand).resolves({ Body: gzBody([bar(openTime, 100)]) as never });
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3CandleStore(new S3Client({}), 'test-bucket');
    await store.upsert([bar(openTime, 999)]);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    const written = zlib.gunzipSync(puts[0].args[0].input.Body as Buffer).toString('utf8').trim();
    const rows = written.split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0].close).toBe(999);
  });

  it('query returns [] instead of throwing when the day object does not exist', async () => {
    s3Mock.on(GetObjectCommand).rejects(new NoSuchKey({ message: 'not found', $metadata: {} }));
    const store = new S3CandleStore(new S3Client({}), 'test-bucket');

    const rows = await store.query('binance:BTCUSDT', '1m', 0, 1);
    expect(rows).toEqual([]);
  });
});

describe('S3CandleStore.coverage (backtest-app-system-design.md §2.2)', () => {
  const s3Mock = mockClient(S3Client);
  const prefix = 'candles/venue=binance/symbol=BTCUSDT/tf=1m/';
  const key = (d: string) => `${prefix}date=${d}.jsonl.gz`;
  const at = (d: number, h = 0, m = 0) => Date.UTC(2026, 8, d, h, m);

  beforeEach(() => {
    s3Mock.reset();
  });

  it('returns null when the tf prefix lists no objects, without any GET', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ KeyCount: 0 });
    const store = new S3CandleStore(new S3Client({}), 'test-bucket');

    expect(await store.coverage('binance:BTCUSDT', '1m')).toBeNull();
    expect(s3Mock.commandCalls(ListObjectsV2Command)[0].args[0].input).toMatchObject({
      Bucket: 'test-bucket',
      Prefix: prefix,
    });
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('single day: from/to are the earliest and latest openTime of the one object', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: key('2026-09-12') }] });
    s3Mock
      .on(GetObjectCommand, { Key: key('2026-09-12') })
      .callsFake(() => ({ Body: gzBody([bar(at(12, 0, 5), 1), bar(at(12, 23, 59), 1)]) }));
    const store = new S3CandleStore(new S3Client({}), 'test-bucket');

    expect(await store.coverage('binance:BTCUSDT', '1m')).toEqual({ from: at(12, 0, 5), to: at(12, 23, 59) });
  });

  it('multi-day across list pages: GETs only the first and last key', async () => {
    s3Mock
      .on(ListObjectsV2Command, { Prefix: prefix, ContinuationToken: undefined })
      .resolves({
        Contents: [{ Key: key('2026-09-10') }, { Key: key('2026-09-11') }],
        IsTruncated: true,
        NextContinuationToken: 'page-2',
      })
      .on(ListObjectsV2Command, { Prefix: prefix, ContinuationToken: 'page-2' })
      .resolves({ Contents: [{ Key: key('2026-09-14') }, { Key: key('2026-09-15') }], IsTruncated: false });
    s3Mock
      .on(GetObjectCommand, { Key: key('2026-09-10') })
      .callsFake(() => ({ Body: gzBody([bar(at(10, 4), 1), bar(at(10, 5), 1)]) }))
      .on(GetObjectCommand, { Key: key('2026-09-15') })
      .callsFake(() => ({ Body: gzBody([bar(at(15, 1), 1), bar(at(15, 2), 1)]) }));
    const store = new S3CandleStore(new S3Client({}), 'test-bucket');

    expect(await store.coverage('binance:BTCUSDT', '1m')).toEqual({ from: at(10, 4), to: at(15, 2) });
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(2);
    expect(s3Mock.commandCalls(GetObjectCommand).map((c) => c.args[0].input.Key)).toEqual([
      key('2026-09-10'),
      key('2026-09-15'),
    ]);
  });
});
