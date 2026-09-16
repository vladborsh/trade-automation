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
import { EconomicEvent } from '@trade-automation/contracts';
import { S3EventStore } from '../../src/storage/s3/s3-event-store';

function event(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:832:2026-09-14',
    source: 'forexfactory',
    seriesId: '832',
    sourceUrl: 'https://www.forexfactory.com/calendar/832-ez-ecb-president-lagarde-speaks',
    title: 'ECB President Lagarde Speaks',
    country: 'EUR',
    impact: 'medium',
    scheduledAt: Date.parse('2026-09-14T11:15:00-04:00'),
    scheduledDay: '2026-09-14',
    forecast: null,
    previous: null,
    actual: null,
    actualSource: null,
    actualAt: null,
    status: 'scheduled',
    firstSeenAt: 1000,
    lastSeenAt: 1000,
    revision: 1,
    ...overrides,
  };
}

function gzBody(rows: unknown[]) {
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  return Readable.from(zlib.gzipSync(Buffer.from(jsonl, 'utf8')));
}

describe('S3EventStore (architecture/economic-calendar.md §4.2–4.3)', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it('upsert on an empty day PUTs a single gzip JSONL object at the calendar/events/ Hive-style key', async () => {
    s3Mock.on(GetObjectCommand).rejects(new NoSuchKey({ message: 'not found', $metadata: {} }));
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3EventStore(new S3Client({}), 'test-bucket');
    await store.upsert([event()]);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0].args[0].input.Key).toBe('calendar/events/date=2026-09-14.jsonl.gz');
    expect(puts[0].args[0].input.ContentEncoding).toBe('gzip');
  });

  it('re-upserting the same id merges into the existing day object instead of duplicating (idempotent)', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: gzBody([event({ revision: 1 })]) as never });
    s3Mock.on(PutObjectCommand).resolves({});

    const store = new S3EventStore(new S3Client({}), 'test-bucket');
    await store.upsert([event({ revision: 2, impact: 'high' })]);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    const written = zlib.gunzipSync(puts[0].args[0].input.Body as Buffer).toString('utf8').trim();
    const rows = written.split('\n').map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0].revision).toBe(2);
    expect(rows[0].impact).toBe('high');
  });

  it('queryByScheduled returns [] instead of throwing when no day objects exist', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    const store = new S3EventStore(new S3Client({}), 'test-bucket');

    const rows = await store.queryByScheduled(0, 1);
    expect(rows).toEqual([]);
  });

  it('get(id) resolves an ff: id directly from its encoded day without listing', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: gzBody([event()]) as never });
    const store = new S3EventStore(new S3Client({}), 'test-bucket');

    const found = await store.get('ff:832:2026-09-14');
    expect(found?.id).toBe('ff:832:2026-09-14');
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });
});
