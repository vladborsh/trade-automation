import { z } from 'zod';

/**
 * architecture/live-signal-server.md §4.7 — env for secrets and storage selection.
 * Validated at boot with zod; an invalid config is a boot failure, not a warning.
 */
// z.coerce.boolean() would map the string 'false' to `true` (Boolean('false') === true) — an
// explicit preprocess avoids that classic zod footgun for CALENDAR_ENABLED (§8).
function booleanFlag(defaultValue: boolean) {
  return z.preprocess((v) => {
    if (v === undefined) return defaultValue;
    if (typeof v === 'boolean') return v;
    return String(v).toLowerCase() === 'true' || String(v) === '1';
  }, z.boolean());
}

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  INSTRUMENTS_FILE: z.string().default('config/instruments.yaml'),
  STRATEGIES_FILE: z.string().default('config/strategies.yaml'),
  LAYOUTS_FILE: z.string().default('config/layouts.yaml'),
  // architecture/aggregate-oi.md §3.3 — cross-venue metric aggregates referenced by layouts.yaml.
  METRIC_AGGREGATES_FILE: z.string().default('config/metric-aggregates.yaml'),

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

  // architecture/economic-calendar.md §8 — CALENDAR_ENABLED=false cleanly disables the module:
  // no poll loop, no notification scheduler, REST returns 503 (§6.1, calendar.controller.ts).
  CALENDAR_ENABLED: booleanFlag(true),
  CALENDAR_FEED_BASE_URL: z.string().default('https://nfs.faireconomy.media/ff_calendar_thisweek'),
  CALENDAR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),
  CALENDAR_POLL_HOT_INTERVAL_MS: z.coerce.number().int().positive().default(120_000),
  CALENDAR_CACHE_LOOKBACK_DAYS: z.coerce.number().int().positive().default(400),
  CALENDAR_DIGEST_TIME: z.string().regex(/^\d{2}:\d{2}$/).default('00:00'),
  CALENDAR_DIGEST_TZ: z.string().default('America/New_York'),
  CALENDAR_NOTIFY_MIN_IMPACT: z.enum(['low', 'medium', 'high']).default('low'),
  CALENDAR_NOTIFY_COUNTRIES: z.string().default(''), // empty = all; else 'USD,EUR,GBP'
  CALENDAR_DUE_CATCHUP_MS: z.coerce.number().int().positive().default(900_000),
});
export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${result.error.toString()}`);
  }
  return result.data;
}
