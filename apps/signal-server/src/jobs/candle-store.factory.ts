import { S3Client } from '@aws-sdk/client-s3';
import { Env } from '../config/env.schema';
import { CandleStore } from '../storage/candle-store.port';
import { FileCandleStore } from '../storage/file/file-candle-store';
import { S3CandleStore } from '../storage/s3/s3-candle-store';

/**
 * The `CandleStore` the standalone jobs write to (derive-timeframes, backfill): the same
 * `CANDLE_STORE` / `FILE_STORE_ROOT` / `S3_*` env the server reads. Extracted from
 * derive-timeframes.ts for T-031, as noted at T-012's review.
 */
export function buildCandleStore(env: Env): CandleStore {
  if (env.CANDLE_STORE === 's3') {
    if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required when CANDLE_STORE=s3');
    const client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
    });
    return new S3CandleStore(client, env.S3_BUCKET);
  }
  return new FileCandleStore(env.FILE_STORE_ROOT);
}
