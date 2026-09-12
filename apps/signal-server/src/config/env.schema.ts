import { z } from 'zod';

/**
 * architecture/live-signal-server.md §4.7 — env for secrets and storage selection.
 * Validated at boot with zod; an invalid config is a boot failure, not a warning.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  INSTRUMENTS_FILE: z.string().default('config/instruments.yaml'),
  STRATEGIES_FILE: z.string().default('config/strategies.yaml'),
  LAYOUTS_FILE: z.string().default('config/layouts.yaml'),

  CANDLE_STORE: z.enum(['file', 's3']).default('file'),
  FILE_STORE_ROOT: z.string().default('data'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_ENDPOINT: z.string().optional(), // for a local S3-compatible stand-in (MinIO) — see storage/s3 tests

  MARKET_DATA_MODE: z.enum(['live', 'replay']).default('replay'),
  REPLAY_FIXTURES_DIR: z.string().default('test/fixtures'),
  REPLAY_SPEED: z.enum(['realtime', 'fast']).default('fast'),

  BINANCE_WS_BASE_URL: z.string().default('wss://fstream.binance.com'),
  BINANCE_REST_BASE_URL: z.string().default('https://fapi.binance.com'),

  // architecture/chart-layouts.md §4.4 — metric poll cadence, aligned to BarClock's 1m tick;
  // an env value rather than hard-coded so it can be widened without a code change.
  METRIC_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  CAPITAL_COM_BASE_URL: z.string().default('https://api-capital.backend-capital.com'),
  CAPITAL_COM_IDENTIFIER: z.string().optional(),
  CAPITAL_COM_PASSWORD: z.string().optional(),
  CAPITAL_COM_API_KEY: z.string().optional(),

  WS_SHARED_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});
export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.toString()}`);
  }
  return result.data;
}
