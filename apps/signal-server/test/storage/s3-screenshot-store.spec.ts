import { Readable } from 'stream';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { S3ScreenshotStore } from '../../src/storage/s3/s3-screenshot-store';
import { screenshotKey, sessionScreenshotPrefix } from '../../src/storage/screenshot-store.port';

const U = '00000000-0000-4000-8000-00000000000a';
const S = '00000000-0000-4000-8000-0000000000b1';
const O = '00000000-0000-4000-8000-00000000000c';

describe('S3ScreenshotStore (aws-sdk-client-mock)', () => {
  const s3 = mockClient(S3Client);
  const store = () => new S3ScreenshotStore(new S3Client({ region: 'eu-central-1' }), 'bt-bucket');
  const key = screenshotKey(U, S, O, 'entry');

  beforeEach(() => s3.reset());

  it('put writes the bytes with their content type', async () => {
    s3.on(PutObjectCommand).resolves({});
    await store().put(key, Buffer.from('png!'), 'image/png');
    const input = s3.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(input).toEqual({ Bucket: 'bt-bucket', Key: key, Body: Buffer.from('png!'), ContentType: 'image/png' });
  });

  it('get returns the bytes, and null for a missing key', async () => {
    s3.on(GetObjectCommand, { Key: key }).resolves({ Body: Readable.from([Buffer.from('pn'), Buffer.from('g!')]) as never, ContentType: 'image/png' });
    await expect(store().get(key)).resolves.toEqual({ bytes: Buffer.from('png!'), contentType: 'image/png' });
    s3.on(GetObjectCommand, { Key: 'missing' }).rejects(new NoSuchKey({ message: 'nope', $metadata: {} }));
    await expect(store().get('missing')).resolves.toBeNull();
  });

  it('deleteByPrefix pages through the listing and deletes each page, returning the count', async () => {
    const prefix = sessionScreenshotPrefix(U, S);
    s3.on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: `${prefix}a` }, { Key: `${prefix}b` }], IsTruncated: true, NextContinuationToken: 't1' })
      .resolvesOnce({ Contents: [{ Key: `${prefix}c` }], IsTruncated: false });
    s3.on(DeleteObjectsCommand).resolves({});
    await expect(store().deleteByPrefix(prefix)).resolves.toBe(3);
    const lists = s3.commandCalls(ListObjectsV2Command).map((c) => c.args[0].input);
    expect(lists.map((l) => [l.Prefix, l.ContinuationToken])).toEqual([[prefix, undefined], [prefix, 't1']]);
    const deletes = s3.commandCalls(DeleteObjectsCommand).map((c) => c.args[0].input.Delete?.Objects?.map((o) => o.Key));
    expect(deletes).toEqual([[`${prefix}a`, `${prefix}b`], [`${prefix}c`]]);
  });

  it('fails loudly when S3 reports keys it could not delete, and on a listing error', async () => {
    const prefix = sessionScreenshotPrefix(U, S);
    s3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: `${prefix}a` }] });
    s3.on(DeleteObjectsCommand).resolves({ Errors: [{ Key: `${prefix}a`, Code: 'AccessDenied' }] });
    await expect(store().deleteByPrefix(prefix)).rejects.toThrow(/could not delete 1 .*AccessDenied/);
    s3.reset();
    s3.on(ListObjectsV2Command).rejects(new Error('network down'));
    await expect(store().deleteByPrefix(prefix)).rejects.toThrow('network down');
  });

  it('refuses a broad prefix without calling S3', async () => {
    await expect(store().deleteByPrefix('backtest/screenshots/')).rejects.toThrow(/refusing/);
    await expect(store().deleteByPrefix('')).rejects.toThrow(/refusing/);
    expect(s3.calls()).toHaveLength(0);
  });
});
