import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ScreenshotObject, ScreenshotStore, assertScreenshotPrefix } from '../screenshot-store.port';

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return true;
  return (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
}

/**
 * architecture/backtest-app-system-design.md §9.2, D8 — screenshots in the (private) bucket.
 * The server proxies reads (no presigned URLs, §7.2). `deleteByPrefix` lists and deletes in
 * batches of up to 1000 (the DeleteObjects limit), and fails loudly if S3 reports any key it
 * could not delete, so a session delete never goes ahead over a half-deleted prefix.
 */
export class S3ScreenshotStore implements ScreenshotStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string): Promise<ScreenshotObject | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { bytes: await streamToBuffer(res.Body), contentType: res.ContentType ?? 'image/png' };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    assertScreenshotPrefix(prefix);
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
      );
      const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => typeof k === 'string');
      if (keys.length > 0) {
        const res = await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
        );
        if (res.Errors && res.Errors.length > 0) {
          throw new Error(`S3 could not delete ${res.Errors.length} screenshot object(s) under ${prefix}: ${res.Errors[0].Code ?? 'unknown'}`);
        }
        deleted += keys.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
