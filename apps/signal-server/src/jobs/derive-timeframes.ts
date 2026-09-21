/**
 * CLI entry point: `npm run derive-timeframes -- [--instrument <id>] [--from <iso>] [--force]`
 * (→ `node dist/jobs/derive-timeframes.js`). architecture/backtest-app-system-design.md §10.
 *
 * Standalone — it does not boot Nest or any ingestion module. It reads only the env (the same
 * `CANDLE_STORE` / `FILE_STORE_ROOT` / `S3_*` / `INSTRUMENTS_FILE` variables the server uses) and
 * `instruments.yaml`, builds the `CandleStore`, and runs `deriveTimeframes` for every configured
 * instrument that has 1m (or the one named by `--instrument`). One JSON log line per instrument.
 */
import { S3Client } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { Env, validateEnv } from '../config/env.schema';
import { InstrumentsFileSchema } from '../config/instruments.schema';
import { CandleStore } from '../storage/candle-store.port';
import { FileCandleStore } from '../storage/file/file-candle-store';
import { S3CandleStore } from '../storage/s3/s3-candle-store';
import { deriveTimeframes, parseDeriveArgs } from './derive-timeframes.job';

function buildCandleStore(env: Env): CandleStore {
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

async function main(): Promise<void> {
  const args = parseDeriveArgs(process.argv.slice(2));
  const env = validateEnv(process.env);
  const configured = InstrumentsFileSchema.parse(yaml.load(fs.readFileSync(env.INSTRUMENTS_FILE, 'utf8')))
    .instruments.map((i) => i.id);
  if (args.instrument && !configured.includes(args.instrument)) {
    throw new Error(`--instrument ${args.instrument} is not in ${env.INSTRUMENTS_FILE}`);
  }
  const store = buildCandleStore(env);

  for (const instrument of args.instrument ? [args.instrument] : configured) {
    const startedAt = Date.now();
    const counts = await deriveTimeframes(store, instrument, { fromMs: args.fromMs, force: args.force });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(counts ? { ...counts, ms: Date.now() - startedAt } : { instrument, skipped: 'no 1m coverage' }),
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('derive-timeframes failed:', err);
  process.exit(1);
});
